cat << 'EOT' > src/platform/backend.ts
import {
  createBackend,
  createOfflineBackend,
  type Backend,
} from '@lumen/backend-supabase';
import { createClient } from '@supabase/supabase-js';

export type BackendMode = 'hosted' | 'offline';

export let backend: Backend = createOfflineBackend();
export let backendMode: BackendMode = 'offline';
export let backendHost: string | undefined;

const env = import.meta.env as {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export const backendReady: Promise<Backend> = (async () => {
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return backend;
  try {
    const client = createClient(url, anonKey);
    backend = createBackend(env, { client });
    if (backend.mode === 'hosted') {
      backendMode = 'hosted';
      try {
        backendHost = new URL(url).host;
      } catch {
        backendHost = url;
      }
    }
  } catch {
    /* fallback to offline */
  }
  return backend;
})();

export async function backendUserLabel(): Promise<string | undefined> {
  const user = await backend.auth.getUser();
  return user?.email ?? user?.id;
}
EOT

cd ../..
npm run build --workspace=app/builder
npx vercel deploy dist --prod
