const ACCESS_CODE_VERIFY_ALLOWED_ORIGINS = Deno.env.get("ACCESS_CODE_VERIFY_ALLOWED_ORIGINS") ?? "*";
const DEFAULT_ACCESS_CODE_SHA256 = "01810e66ba6d21239428f3815c311d944035f6ff43228352ea372752c0a6f10d";

function normalizeCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

const expectedAccessCodeHashPromise = (async () => {
  const explicitHash = String(Deno.env.get("RESIDUE_ACCESS_CODE_SHA256") ?? "")
    .trim()
    .toLowerCase();
  if (/^[a-f0-9]{64}$/.test(explicitHash)) return explicitHash;

  const explicitCode = normalizeCode(Deno.env.get("RESIDUE_ACCESS_CODE") ?? "");
  if (explicitCode) return await sha256Hex(explicitCode);

  return DEFAULT_ACCESS_CODE_SHA256;
})();

function buildCorsHeaders(origin: string | null) {
  const allowList = ACCESS_CODE_VERIFY_ALLOWED_ORIGINS
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const allowAll = allowList.includes("*") || allowList.length === 0;
  const allowed = allowAll || (origin && allowList.includes(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? (origin ?? "*") : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "content-type": "application/json",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return json({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  const submittedCode = normalizeCode((payload as { code?: unknown }).code);
  if (!submittedCode) {
    return json({ error: "Access code is required." }, 400, corsHeaders);
  }
  const expectedHash = await expectedAccessCodeHashPromise;
  const submittedHash = await sha256Hex(submittedCode);
  if (!timingSafeEqualHex(submittedHash, expectedHash)) {
    return json({ ok: false, error: "Invalid access code." }, 401, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
});
