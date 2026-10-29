/**
 * FakeSupabaseClient — hand-rolled in-memory implementation of the
 * SupabaseClientLike structural interface. Captures every query (table,
 * op, columns, filters, order, limit, values) for assertion and executes
 * against plain in-memory tables. Zero network.
 */

let idSeq = 0;
const nextId = () => `fake-${++idSeq}`;

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.op = 'select';
    this.columns = undefined;
    this.filters = [];
    this.orderSpec = undefined;
    this.limitN = undefined;
    this.values = undefined;
    this.onConflict = undefined;
  }

  select(columns) {
    this.columns = columns;
    return this;
  }

  insert(values) {
    this.op = 'insert';
    this.values = values;
    return this;
  }

  update(values) {
    this.op = 'update';
    this.values = values;
    return this;
  }

  upsert(values, options) {
    this.op = 'upsert';
    this.values = values;
    this.onConflict = options?.onConflict;
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  match(query) {
    this.filters.push({ kind: 'match', query });
    return this;
  }

  order(column, options) {
    this.orderSpec = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count) {
    this.limitN = count;
    return this;
  }

  matches(row) {
    for (const f of this.filters) {
      if (f.kind === 'eq' && row[f.column] !== f.value) return false;
      if (f.kind === 'match') {
        for (const [k, v] of Object.entries(f.query)) if (row[k] !== v) return false;
      }
    }
    return true;
  }

  execute() {
    this.client.calls.push(this);
    const table = this.client.tables[this.table] ?? (this.client.tables[this.table] = []);
    const now = new Date().toISOString();
    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = (Array.isArray(this.values) ? this.values : [this.values]).map((v) => ({
        id: nextId(),
        created_at: now,
        updated_at: now,
        ...v,
      }));
      table.push(...rows);
      return Promise.resolve({ data: rows, error: null });
    }
    if (this.op === 'update') {
      const updated = [];
      for (const row of table) {
        if (this.matches(row)) {
          Object.assign(row, this.values);
          updated.push(row);
        }
      }
      return Promise.resolve({ data: updated, error: null });
    }
    if (this.op === 'delete') {
      const kept = [];
      const removed = [];
      for (const row of table) (this.matches(row) ? removed : kept).push(row);
      this.client.tables[this.table] = kept;
      return Promise.resolve({ data: removed, error: null });
    }
    let rows = table.filter((r) => this.matches(r));
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      rows = [...rows].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitN !== undefined) rows = rows.slice(0, this.limitN);
    return Promise.resolve({ data: rows, error: null });
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  single() {
    return this.execute().then(({ data, error }) => {
      if (error) return { data: null, error };
      if (!data || data.length === 0) {
        return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      }
      return { data: data[0], error: null };
    });
  }
}

class FakeChannel {
  constructor(name) {
    this.name = name;
    this.listeners = [];
    this.tracked = [];
    this.subscribed = false;
  }

  on(type, filter, callback) {
    this.listeners.push({ type, filter, callback });
    return this;
  }

  track(payload) {
    this.tracked.push(payload);
    return Promise.resolve('ok');
  }

  untrack() {
    return Promise.resolve('ok');
  }

  subscribe(callback) {
    this.subscribed = true;
    callback?.('SUBSCRIBED');
    return this;
  }

  unsubscribe() {
    this.subscribed = false;
    return Promise.resolve('ok');
  }

  /** Test helper: fire a postgres_changes payload at matching listeners. */
  emit(payload) {
    for (const l of this.listeners) l.callback(payload);
  }
}

export class FakeSupabaseClient {
  constructor({ userId = 'user-1' } = {}) {
    this.tables = {};
    this.calls = [];
    this.channels = [];
    this.uploads = [];
    this.rpcCalls = [];
    this.invocations = [];
    this.userId = userId;
    /** Pre-seeded error for the next single() (e.g. unique violation). */
    this.nextError = null;
    /** Queue of edge-function responses: {name, body} -> set via respond(). */
    this.invokeResponses = new Map();
    this.rpcResponses = new Map();
    this.auth = {
      signUp: async ({ email }) => ({
        data: { user: { id: this.userId, email } },
        error: null,
      }),
      signInWithPassword: async ({ email }) => ({
        data: { user: { id: this.userId, email } },
        error: null,
      }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getUser: async () => ({ data: { id: this.userId, email: 'u@example.com' }, error: null }),
      onAuthStateChange: (cb) => {
        this.authCallback = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    };
    this.storage = {
      from: (bucket) => ({
        upload: async (path, body, options) => {
          this.uploads.push({ bucket, path, body, options });
          return { data: { path }, error: null };
        },
        download: async (path) => ({ data: new Blob(['fake']), error: null }),
        getPublicUrl: (path) => ({
          data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    };
    this.functions = {
      invoke: async (name, options) => {
        this.invocations.push({ name, body: options?.body });
        const responder = this.invokeResponses.get(name);
        if (responder) return responder(options?.body);
        return { data: {}, error: null };
      },
    };
  }

  respond(name, responder) {
    this.invokeResponses.set(name, responder);
  }

  respondRpc(name, responder) {
    this.rpcResponses.set(name, responder);
  }

  from(table) {
    const q = new FakeQuery(this, table);
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      q.execute = () => {
        this.calls.push(q);
        return Promise.resolve({ data: null, error: err });
      };
    }
    return q;
  }

  channel(name) {
    const ch = new FakeChannel(name);
    this.channels.push(ch);
    return ch;
  }

  rpc(fn, args) {
    this.rpcCalls.push({ fn, args });
    const responder = this.rpcResponses.get(fn);
    if (responder) return Promise.resolve(responder(args));
    return Promise.resolve({ data: null, error: null });
  }

  /** Seed a table with rows. */
  seed(table, rows) {
    this.tables[table] = rows;
  }

  /** All captured calls against a table. */
  callsFor(table) {
    return this.calls.filter((c) => c.table === table);
  }

  lastCall(table) {
    const list = this.callsFor(table);
    return list[list.length - 1];
  }
}
