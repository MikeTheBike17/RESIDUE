const crypto = require('crypto');

const DEFAULT_ACCESS_CODE_SHA256 = '01810e66ba6d21239428f3815c311d944035f6ff43228352ea372752c0a6f10d';
const ACCESS_CODE_VERIFY_ALLOWED_ORIGINS = process.env.ACCESS_CODE_VERIFY_ALLOWED_ORIGINS || '*';

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function resolveExpectedCodeHash() {
  const explicitHash = String(process.env.RESIDUE_ACCESS_CODE_SHA256 || '')
    .trim()
    .toLowerCase();
  if (/^[a-f0-9]{64}$/.test(explicitHash)) return explicitHash;

  const explicitCode = normalizeCode(process.env.RESIDUE_ACCESS_CODE || '');
  if (explicitCode) return sha256Hex(explicitCode);

  return DEFAULT_ACCESS_CODE_SHA256;
}

function timingSafeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildCorsHeaders(origin) {
  const allowList = ACCESS_CODE_VERIFY_ALLOWED_ORIGINS
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
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body || '{}');
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body.' }, corsHeaders);
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body;
  }
  const submittedCode = normalizeCode(body.code);
  if (!submittedCode) {
    sendJson(res, 400, { error: 'Access code is required.' }, corsHeaders);
    return;
  }

  const expectedHash = resolveExpectedCodeHash();
  const submittedHash = sha256Hex(submittedCode);
  if (!timingSafeEqualHex(submittedHash, expectedHash)) {
    sendJson(res, 401, { ok: false, error: 'Invalid access code.' }, corsHeaders);
    return;
  }

  sendJson(res, 200, { ok: true }, corsHeaders);
};
