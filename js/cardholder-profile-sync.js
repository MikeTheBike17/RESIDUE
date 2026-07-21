export function buildCardholderProfileSyncEndpoint(cfg = window.env || {}) {
  const explicitEndpoint = String(cfg.CARDHOLDER_PROFILE_SYNC_ENDPOINT || '').trim();
  if (explicitEndpoint) return explicitEndpoint;

  const supabaseUrl = String(cfg.SUPABASE_URL || '').trim();
  if (!supabaseUrl) return '';

  try {
    const url = new URL(supabaseUrl);
    return `${url.origin}/functions/v1/sync-cardholder-profiles`;
  } catch {
    return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/sync-cardholder-profiles`;
  }
}

export async function syncCardholderProfiles({
  cfg = window.env || {},
  session,
  payload
} = {}) {
  const endpoint = buildCardholderProfileSyncEndpoint(cfg);
  const anonKey = String(cfg.SUPABASE_ANON_KEY || '').trim();
  const accessToken = String(session?.access_token || '').trim();

  if (!endpoint) throw new Error('Cardholder profile sync endpoint is not configured.');
  if (!anonKey) throw new Error('Supabase anon key is not configured.');
  if (!accessToken) throw new Error('You must be signed in to sync cardholder profile URLs.');

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload || {})
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Could not reach the cardholder profile sync function. Check that the Edge Function is deployed with preflight/CORS access enabled.'
      );
    }
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.detail || 'Could not sync cardholder profile URLs.');
  }

  return data;
}

export function countSyncedProfileUrls(data) {
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.filter(row => String(row?.url || '').trim()).length;
}
