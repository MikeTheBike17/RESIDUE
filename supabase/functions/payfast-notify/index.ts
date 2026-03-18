const PAYFAST_MERCHANT_ID = Deno.env.get("PAYFAST_MERCHANT_ID") ?? "";
const PAYFAST_MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY") ?? "";
const PAYFAST_PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

Deno.serve(async req => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!PAYFAST_MERCHANT_ID || !PAYFAST_MERCHANT_KEY) {
    return json({
      error: "Missing PayFast secrets",
      detail: "Set PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY in Supabase Edge Function secrets."
    }, 500);
  }

  const bodyText = await req.text().catch(() => "");
  const form = new URLSearchParams(bodyText);

  // Scaffold only: this endpoint is the server-side home for PayFast verification.
  // When PayFast approves your account, add signature validation, source checks,
  // and trusted order/invoice status updates here instead of in browser code.
  return json({
    ok: true,
    received: true,
    payment_id: form.get("pf_payment_id"),
    merchant_id_configured: true,
    passphrase_configured: !!PAYFAST_PASSPHRASE
  }, 202);
});
