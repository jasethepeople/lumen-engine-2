/**
 * P12: a11y hydration (wire SceneIR.a11y → islands) + live-region announcer.
 * Runs against compiled dists with a minimal fake DOM.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

function makeEl(tag = 'div') {
  const el = {
    tagName: tag,
    attrs: {},
    children: [],
    className: '',
    textContent: '',
    style: {},
    parentElement: null,
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
    remove() { el.parentElement?.children.splice(el.parentElement.children.indexOf(el), 1); },
    querySelector(sel) {
      const cls = sel.replace('.', '');
      const walk = (n) => {
        for (const c of n.children ?? []) {
          if (c.className === cls) return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(el);
    },
    dispatchEvent(ev) { el.lastEvent = ev; return true; },
  };
  return el;
}

const byId = new Map();
globalThis.document = {
  getElementById: (id) => byId.get(id) ?? null,
  createElement: (tag) => makeEl(tag),
};
globalThis.CustomEvent = class {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

const { hydrateIslands, createA11yAnnouncer } = await import('../dist/index.js');

function fakeEngine(a11y) {
  const handlers = new Map();
  return {
    ir: { a11y },
    on: (ev, fn) => { handlers.set(ev, fn); return () => handlers.delete(ev); },
    emit: (ev, payload) => handlers.get(ev)?.(payload),
  };
}

test('island with an a11y entry gets aria-label and summary node', async () => {
  const el = makeEl();
  byId.set('hero', el);
  await hydrateIslands(fakeEngine({ hero: { label: 'Hero', summary: 'Intro scene' } }), ['hero']);
  assert.equal(el.attrs['aria-label'], 'Hero');
  const desc = el.querySelector('.lumen-visually-hidden');
  assert.ok(desc, 'description node added');
  assert.equal(desc.textContent, 'Intro scene');
  assert.ok('data-lumen-hydrated' in el.attrs);
  byId.clear();
});

test('hydration is idempotent: re-run does not duplicate the description node', async () => {
  const el = makeEl();
  byId.set('hero', el);
  const engine = fakeEngine({ hero: { label: 'Hero', summary: 'Intro scene' } });
  await hydrateIslands(engine, ['hero']);
  await hydrateIslands(engine, ['hero']);
  assert.equal(el.children.filter((c) => c.className === 'lumen-visually-hidden').length, 1);
  byId.clear();
});

test('island without an a11y entry gets no aria attributes (legacy behavior)', async () => {
  const el = makeEl();
  byId.set('plain', el);
  await hydrateIslands(fakeEngine({}), ['plain']);
  assert.equal(el.attrs['aria-label'], undefined);
  assert.equal(el.children.length, 0);
  assert.ok('data-lumen-hydrated' in el.attrs);
  byId.clear();
});

test('announcer updates the live region on scene:enter with the scene label', () => {
  const root = makeEl();
  const engine = fakeEngine({ hero: { label: 'Hero scene' } });
  const dispose = createA11yAnnouncer(engine, root);
  const region = root.children[0];
  assert.equal(region.attrs['aria-live'], 'polite');
  engine.emit('scene:enter', { sceneId: 'hero', index: 0 });
  assert.equal(region.textContent, 'Hero scene');
  engine.emit('scene:enter', { sceneId: 'unknown', index: 1 });
  assert.equal(region.textContent, 'Hero scene', 'unknown scene leaves the last announcement');
  dispose();
  assert.equal(root.children.length, 0, 'region removed on dispose');
  engine.emit('scene:enter', { sceneId: 'hero', index: 2 }); // unsubscribed: no throw
});
