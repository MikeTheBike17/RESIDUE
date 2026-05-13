const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "content-type": "application/json"
};

const STITCH_CLIENT_ID = Deno.env.get("STITCH_CLIENT_ID") ?? "";
const STITCH_CLIENT_SECRET = Deno.env.get("STITCH_CLIENT_SECRET") ?? "";
const STITCH_TOKEN_URL = "https://secure.stitch.money/connect/token";
const STITCH_PAYMENT_REQUESTS_URL = "https://api.stitch.money/v2/payment-requests";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function assertSecrets() {
  if (!STITCH_CLIENT_ID || !STITCH_CLIENT_SECRET) {
    throw new Error("Set STITCH_CLIENT_ID and STITCH_CLIENT_SECRET in Supabase Edge Function secrets.");
  }
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: STITCH_CLIENT_ID,
    client_secret: STITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
    audience: "https://secure.stitch.money/connect/token",
    scope: "client_paymentrequest"
  });

  const response = await fetch(STITCH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.detail || "Could not authenticate with Stitch.");
  }

  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("Stitch access token response was missing access_token.");
  }

  return accessToken;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    assertSecrets();

    const url = new URL(req.url);
    const requestId = String(url.searchParams.get("id") || "").trim();
    if (!requestId) {
      throw new Error("Missing Stitch payment request id.");
    }

    const accessToken = await getAccessToken();
    const response = await fetch(`${STITCH_PAYMENT_REQUESTS_URL}/${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      }
    });

    const stitchPayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(stitchPayload?.detail || stitchPayload?.title || "Could not fetch the Stitch payment status.");
    }

    return json({
      id: stitchPayload?.id || requestId,
      status: stitchPayload?.status || null,
      externalReference: stitchPayload?.externalReference || null,
      amount: stitchPayload?.amount || null
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unexpected Stitch payment status error."
    }, 400);
  }
});
