const STITCH_PAYMENT_REQUEST_ALLOWED_ORIGINS = process.env.STITCH_PAYMENT_REQUEST_ALLOWED_ORIGINS || '*';

function buildCorsHeaders(origin) {
  const allowList = STITCH_PAYMENT_REQUEST_ALLOWED_ORIGINS
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const allowAll = allowList.includes('*') || allowList.length === 0;
  const allowedOrigin = allowAll
    ? (origin || '*')
    : (origin && allowList.includes(origin) ? origin : 'null');

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

function sendJson(res, status, body, headers = {}) {
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  res.status(status).json(body);
}

function resolveFunctionsBaseUrl() {
  const raw = String(process.env.SUPABASE_URL || '').trim();
  if (!raw) throw new Error('Missing SUPABASE_URL.');
  const url = new URL(raw);
  return `${url.origin}/functions/v1`;
}

function buildUpstreamHeaders(req) {
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!anonKey) throw new Error('Missing SUPABASE_ANON_KEY.');

  const headers = {
    apikey: anonKey,
    accept: 'application/json',
    'content-type': 'application/json'
  };

  const forwardedAuth = String(req.headers.authorization || '').trim();
  if (forwardedAuth) {
    headers.authorization = forwardedAuth;
  } else if ((anonKey.match(/\./g) || []).length === 2) {
    headers.authorization = `Bearer ${anonKey}`;
  }

  return headers;
}

function parseBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    res.status(200).send('ok');
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' }, corsHeaders);
    return;
  }

  let body = {};
  try {
    body = parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' }, corsHeaders);
    return;
  }

  try {
    const response = await fetch(`${resolveFunctionsBaseUrl()}/stitch-payment-request`, {
      method: 'POST',
      headers: buildUpstreamHeaders(req),
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: 'Unexpected upstream response.', detail: text };
      }
    }

    sendJson(res, response.status, payload, corsHeaders);
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Could not proxy Stitch payment request.'
    }, corsHeaders);
  }
};
