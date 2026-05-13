const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json"
};

const STITCH_CLIENT_ID = Deno.env.get("STITCH_CLIENT_ID") ?? "";
const STITCH_CLIENT_SECRET = Deno.env.get("STITCH_CLIENT_SECRET") ?? "";
const STITCH_TOKEN_URL = "https://secure.stitch.money/connect/token";
const STITCH_PAYMENT_REQUESTS_URL = "https://api.stitch.money/v2/payment-requests";
const STITCH_EXPIRY_MINUTES = Number(Deno.env.get("STITCH_PAYMENT_REQUEST_EXPIRY_MINUTES") ?? "60");

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

function validateRedirectUrl(rawUrl: string, originHeader: string | null) {
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(rawUrl);
  } catch {
    throw new Error("redirectUrl must be a valid absolute URL.");
  }

  if (!["http:", "https:"].includes(redirectUrl.protocol)) {
    throw new Error("redirectUrl must use http or https.");
  }

  if (originHeader) {
    try {
      const requestOrigin = new URL(originHeader).origin;
      if (redirectUrl.origin !== requestOrigin) {
        throw new Error("redirectUrl origin must match the request origin.");
      }
    } catch {
      throw new Error("Could not validate redirectUrl origin.");
    }
  }

  return redirectUrl.toString();
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

function buildRequestBody(order: Record<string, unknown>) {
  const amount = Number(order?.total_amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Order total_amount must be greater than 0.");
  }

  const invoiceNo = String(order?.invoice_no || "").trim();
  const email = String(order?.customer_email || "").trim().toLowerCase();
  const customerName = String(order?.customer_name || "").trim();
  const phone = String(order?.customer_phone || "").trim();
  const quantity = Number(order?.quantity ?? 0);
  const product = String(order?.product || "").trim();
  const shippingAddress = {
    name: String(order?.shipping_name || "").trim(),
    street: String(order?.shipping_street || "").trim(),
    suburb: String(order?.shipping_suburb || "").trim(),
    city: String(order?.shipping_city || "").trim(),
    province: String(order?.shipping_province || "").trim(),
    postalCode: String(order?.shipping_postal || "").trim()
  };

  if (!invoiceNo) throw new Error("Order invoice_no is required.");
  if (!email) throw new Error("Order customer_email is required.");
  if (!customerName) throw new Error("Order customer_name is required.");

  const expireAt = new Date(Date.now() + Math.max(15, STITCH_EXPIRY_MINUTES) * 60 * 1000).toISOString();

  return {
    amount: {
      currency: "ZAR",
      quantity: amount
    },
    externalReference: invoiceNo,
    expireAt,
    payer: {
      identifier: invoiceNo,
      email,
      fullName: customerName,
      ...(phone ? { mobileNumber: phone } : {})
    },
    paymentMethods: {
      eft: {
        enabled: false
      },
      card: {
        enabled: true
      }
    },
    metadata: {
      invoiceNo,
      product,
      quantity: Number.isFinite(quantity) ? String(quantity) : "",
      deliveryMethod: "delivery",
      shippingAddress: JSON.stringify(shippingAddress)
    }
  };
}

function appendRedirectUri(interactionUrl: string, redirectUrl: string) {
  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(interactionUrl);
  } catch {
    throw new Error("Stitch returned an invalid checkout URL.");
  }

  checkoutUrl.searchParams.set("redirect_uri", redirectUrl);
  return checkoutUrl.toString();
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    assertSecrets();

    const payload = await req.json().catch(() => ({}));
    const order = (payload?.order && typeof payload.order === "object") ? payload.order as Record<string, unknown> : null;
    const redirectUrl = validateRedirectUrl(String(payload?.redirectUrl || ""), req.headers.get("origin"));

    if (!order) {
      throw new Error("Request body must include an order object.");
    }

    const accessToken = await getAccessToken();
    const response = await fetch(STITCH_PAYMENT_REQUESTS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(buildRequestBody(order))
    });

    const stitchPayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(stitchPayload?.detail || stitchPayload?.title || "Could not create the Stitch payment request.");
    }

    const requestId = String(stitchPayload?.id || "").trim();
    const interactionUrl = String(stitchPayload?.interaction?.url || "").trim();
    if (!requestId || !interactionUrl) {
      throw new Error("Stitch response was missing the checkout URL.");
    }

    return json({
      id: requestId,
      status: stitchPayload?.status || null,
      externalReference: stitchPayload?.externalReference || null,
      redirectUrl: appendRedirectUri(interactionUrl, redirectUrl)
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unexpected Stitch payment request error."
    }, 400);
  }
});
