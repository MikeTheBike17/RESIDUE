const ACCESS_CODE_VERIFY_ALLOWED_ORIGINS = Deno.env.get("ACCESS_CODE_VERIFY_ALLOWED_ORIGINS") ?? "*";
const RESIDUE_ACCESS_CODE = String(Deno.env.get("RESIDUE_ACCESS_CODE") ?? "res-1738")
  .trim()
  .toLowerCase();

function normalizeCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

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
  if (!RESIDUE_ACCESS_CODE) {
    return json({ error: "Server misconfiguration" }, 500, corsHeaders);
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return json({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  const submittedCode = normalizeCode((payload as { code?: unknown }).code);
  if (!submittedCode) {
    return json({ error: "Access code is required." }, 400, corsHeaders);
  }
  if (submittedCode !== RESIDUE_ACCESS_CODE) {
    return json({ ok: false, error: "Invalid access code." }, 401, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
});
