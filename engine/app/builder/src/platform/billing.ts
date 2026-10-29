const SUPABASE_URL = 'https://bgqkqcvebizjnkjcbedf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncWtxY3ZlYml6am5ramNiZWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mzc1NzEsImV4cCI6MjEwMzUxMzU3MX0.rtdPaMfwlP6aq8-mmZDxIQbAma9iLAJKUEcOXYfD9c4';

export const STRIPE_PRICES = {
  NOCTURNE_FOLIO: 'price_1UA4FHDRsBAIUDAqPK2qzVL',
};

export async function handleUpgrade(priceId: string) {
  try {
    let accessToken = SUPABASE_ANON_KEY;
    let userId = undefined;
    let email = undefined;

    const storedSession = localStorage.getItem('sb-bgqkqcvebizjnkjcbedf-auth-token');
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession);
        if (parsed?.access_token) accessToken = parsed.access_token;
        if (parsed?.user?.id) userId = parsed.user.id;
        if (parsed?.user?.email) email = parsed.user.email;
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ 
        priceId, 
        userId, 
        email 
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create checkout session');

    if (data?.url) {
      window.location.href = data.url;
    }
  } catch (err: any) {
    console.error('Failed to create checkout session:', err.message);
    alert('Error starting checkout: ' + err.message);
  }
}
