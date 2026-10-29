cat << 'EOT' > src/components/BackendStatus.tsx
import { useEffect, useState } from 'react';
import {
  backendHost,
  backendMode,
  backendReady,
  backendUserLabel,
} from '../platform/backend';

export function BackendStatus() {
  const [, setTick] = useState(0);
  const [userLabel, setUserLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void backendReady.then(async (b) => {
      if (!alive) return;
      setTick((n) => n + 1);
      setUserLabel(await backendUserLabel());
      void b;
    });
    return () => {
      alive = false;
    };
  }, []);

  const hosted = backendMode === 'hosted';
  return (
    <span
      className={`text-[10px] font-mono border rounded px-2 py-0.5 ${
        hosted
          ? 'text-emerald-300 border-emerald-900'
          : 'text-ink-300 border-ink-700'
      }`}
      title={
        hosted
          ? `Supabase-backed backend (${backendHost})`
          : 'Local offline backend — zero Supabase config'
      }
    >
      {hosted ? `Hosted: ${backendHost}` : 'Offline (local)'}
      {userLabel ? ` · ${userLabel}` : ''}
    </span>
  );
}
EOT

cd ../..
npm run build --workspace=app/builder
npx vercel deploy app/builder/dist --prod
