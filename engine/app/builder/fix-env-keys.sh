cat << 'EOT' > src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bgqkqcvebizjnkjcbedf.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncWtxY3ZlYml6am5ramNiZWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mzc1NzEsImV4cCI6MjEwMzUxMzU3MX0.rtdPaMfwlP6aq8-mmZDxIQbAma9iLAJKUEcOXYfD9c4'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
EOT

cd ../..
npm run build --workspace=app/builder
npx vercel deploy app/builder/dist --prod
