echo "Checking headers for https://lumen-builder-seven.vercel.app..."
curl -i https://lumen-builder-seven.vercel.app

echo -e "\nChecking response body for Supabase initialization or offline state..."
curl -s https://lumen-builder-seven.vercel.app | grep -i -E "supabase|offline|local"
