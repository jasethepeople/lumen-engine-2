JS_FILE=$(curl -s https://lumen-builder-seven.vercel.app | grep -oE '/assets/index-[a-zA-Z0-9]+\.js')
echo "Found JS bundle: https://lumen-builder-seven.vercel.app$JS_FILE"
echo "Checking if Supabase URL is embedded in the bundle..."
curl -s "https://lumen-builder-seven.vercel.app$JS_FILE" | grep -oE "https://[a-zA-Z0-9.-]+\.supabase\.co" || echo "Supabase URL not found in bundle!"
