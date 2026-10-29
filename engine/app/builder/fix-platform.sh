cat << 'EOT' > src/platform/backend.ts
import {
  createBackend,
  createOfflineBackend,
  type Backend,
} from '@lumen/backend-supabase';
import { createClient } from '@supabase/supabase-js';

export type BackendMode = 'hosted' | 'offline';

const supabaseUrl = 'https://bgqkqcvebizjnkjcbedf.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncWtxY3ZlYml6am5ramNiZWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mzc1NzEsImV4cCI6MjEwMzUxMzU3MX0.rtdPaMfwlP6aq8-mmZDxIQbAma9iLAJKUEcOXYfD9c4';

const client = createClient(supabaseUrl, supabaseAnonKey);
export const backend: Backend = createBackend({ VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_ANON_KEY: supabaseAnonKey }, { client });
export const backendMode: BackendMode = 'hosted';
export const backendHost: string = new URL(supabaseUrl).host;

export const backendReady: Promise<Backend> = Promise.resolve(backend);

export async function backendUserLabel(): Promise<string | undefined> {
  const user = await backend.auth.getUser();
  return user?.email ?? user?.id;
}
EOT

cd ../..
npm run build --workspace=app/builder
npx vercel deploy app/builder/dist --prod
