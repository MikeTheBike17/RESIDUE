import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHash } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json"
};

const PAYFAST_MERCHANT_ID = Deno.env.get("PAYFAST_MERCHANT_ID") ?? "";
const PAYFAST_MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY") ?? "";
const PAYFAST_PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
const PAYFAST_VALIDATE_URL = Deno.env.get("PAYFAST_VALIDATE_URL") ?? "https://www.payfast.co.za/eng/query/validate";
const PAYFAST_VALID_HOSTS = (Deno.env.get("PAYFAST_VALID_HOSTS") ?? "www.payfast.co.za,w1w.payfast.co.za,w2w.payfast.co.za,sandbox.payfast.co.za")
  .split(",")
  .map(host => host.trim().toLowerCase())
  .filter(Boolean);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INVOICE_TABLE = Deno.env.get("SUPABASE_INVOICES_TABLE") || "purchase_invoices";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function payFastEncode(value: string) {
  return encodeURIComponent(value.trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildPayFastParamString(entries: [string, string][]) {
  return entries
    .filter(([key, value]) => key !== "signature" && String(value || "").trim() !== "")
    .map(([key, value]) => `${key}=${payFastEncode(String(value))}`)
    .join("&");
}

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

function normalizeStatus(status: string) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "COMPLETE" || normalized === "SUCCESS") return "COMPLETE";
  if (normalized === "CANCELLED" || normalized === "CANCELED" || normalized === "CLOSED") return "CANCELLED";
  if (normalized === "FAILED") return "FAILED";
  if (normalized === "EXPIRED") return "EXPIRED";
  return "PENDING";
}

function clientIps(req: Request) {
  return [
    req.headers.get("cf-connecting-ip") || "",
    req.headers.get("x-real-ip") || "",
    ...(req.headers.get("x-forwarded-for") || "").split(",")
  ]
    .map(ip => ip.trim())
    .filter(Boolean);
}

async function validPayFastSource(req: Request) {
  const ips = clientIps(req);
  if (ips.length === 0) return false;

  const validIps = new Set<string>();
  for (const host of PAYFAST_VALID_HOSTS) {
    try {
      const records = await Deno.resolveDns(host, "A");
      records.forEach(ip => validIps.add(ip));
    } catch {
      // Keep checking other hosts. A full miss fails closed below.
    }
  }

  return ips.some(ip => validIps.has(ip));
}

async function validServerConfirmation(paramString: string) {
  const response = await fetch(PAYFAST_VALIDATE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/plain"
    },
    body: paramString
  });
  const text = (await response.text()).trim().toUpperCase();
  return response.ok && text === "VALID";
}

function amountsMatch(expected: unknown, paid: string | null) {
  const expectedAmount = Number(expected);
  const paidAmount = Number(paid);
  return Number.isFinite(expectedAmount)
    && Number.isFinite(paidAmount)
    && Math.abs(expectedAmount - paidAmount) < 0.01;
}

function isMissingColumnError(error: { message?: string } | null) {
  return /(column .* does not exist|could not find .* column .* schema cache)/i.test(error?.message || "");
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!PAYFAST_MERCHANT_ID || !PAYFAST_MERCHANT_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({
      error: "Missing PayFast/Supabase secrets",
      detail: "Set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY."
    }, 500);
  }

  const bodyText = await req.text().catch(() => "");
  const form = new URLSearchParams(bodyText);
  const entries = Array.from(form.entries());
  const data = Object.fromEntries(entries);
  const invoiceNo = String(data.m_payment_id || data.custom_str1 || "").trim();
  const paymentStatus = normalizeStatus(String(data.payment_status || ""));
  const paymentReference = String(data.pf_payment_id || "").trim() || null;

  if (!invoiceNo) {
    return json({ error: "Missing invoice reference." }, 400);
  }

  if (String(data.merchant_id || "").trim() !== PAYFAST_MERCHANT_ID) {
    return json({ error: "Merchant ID mismatch." }, 400);
  }

  const paramString = buildPayFastParamString(entries);
  const receivedSignature = String(data.signature || "").trim().toLowerCase();
  const expectedSignature = md5(PAYFAST_PASSPHRASE ? `${paramString}&passphrase=${payFastEncode(PAYFAST_PASSPHRASE)}` : paramString);
  if (!receivedSignature || receivedSignature !== expectedSignature) {
    return json({ error: "Invalid PayFast signature." }, 400);
  }

  if (!(await validPayFastSource(req))) {
    return json({ error: "Invalid PayFast source." }, 400);
  }

  if (!(await validServerConfirmation(paramString))) {
    return json({ error: "PayFast server validation failed." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const { data: invoice, error: invoiceError } = await supabase
    .from(INVOICE_TABLE)
    .select("invoice_no,payment_status,total_amount")
    .eq("invoice_no", invoiceNo)
    .maybeSingle();

  if (invoiceError) {
    return json({ error: "Could not load invoice.", detail: invoiceError.message }, 500);
  }

  if (!invoice) {
    return json({ error: "Invoice not found." }, 404);
  }

  if (!amountsMatch(invoice.total_amount, String(data.amount_gross || ""))) {
    return json({ error: "Amount mismatch.", invoice: invoiceNo }, 400);
  }

  const existingStatus = normalizeStatus(String(invoice.payment_status || ""));
  const nextStatus = existingStatus === "COMPLETE" ? "COMPLETE" : paymentStatus;
  const now = new Date().toISOString();

  let { error: updateError } = await supabase
    .from(INVOICE_TABLE)
    .update({
      payment_provider: "payfast",
      payment_status: nextStatus,
      payment_reference: paymentReference,
      payment_updated_at: now,
      updated_at: now
    })
    .eq("invoice_no", invoiceNo);

  if (isMissingColumnError(updateError)) {
    ({ error: updateError } = await supabase
      .from(INVOICE_TABLE)
      .update({
        payment_provider: "payfast",
        payment_status: nextStatus,
        updated_at: now
      })
      .eq("invoice_no", invoiceNo));
  }

  if (updateError) {
    return json({ error: "Could not update invoice.", detail: updateError.message }, 500);
  }

  await supabase.from("purchase_activity_log").insert({
    visitor_id: "payfast-itn",
    invoice_no: invoiceNo,
    order_ref: invoiceNo,
    stage: "payfast_itn",
    outcome: "success",
    payment_provider: "payfast",
    payment_status: nextStatus,
    amount_total: Number(data.amount_gross || 0),
    currency: "ZAR",
    detail: "PayFast ITN verified and invoice status updated.",
    metadata: {
      pf_payment_id: paymentReference,
      amount_fee: data.amount_fee || null,
      amount_net: data.amount_net || null
    }
  });

  return json({
    ok: true,
    invoice: invoiceNo,
    payment_status: nextStatus,
    payment_reference: paymentReference
  });
});
