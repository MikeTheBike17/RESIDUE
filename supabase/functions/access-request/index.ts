import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "npm:resend@4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ACCESS_REQUEST_TEAM_EMAIL = Deno.env.get("ACCESS_REQUEST_TEAM_EMAIL") ?? "";
const ACCESS_REQUEST_FROM_EMAIL = Deno.env.get("ACCESS_REQUEST_FROM_EMAIL") ?? "Residue <residuecards@gmail.com>";
const ACCESS_REQUEST_ALLOWED_ORIGINS = Deno.env.get("ACCESS_REQUEST_ALLOWED_ORIGINS") ?? "*";
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
const ACCESS_REQUEST_EMAIL_RATE_LIMIT = Number(Deno.env.get("ACCESS_REQUEST_EMAIL_RATE_LIMIT") ?? "3");
const ACCESS_REQUEST_RATE_WINDOW_MINUTES = Number(Deno.env.get("ACCESS_REQUEST_RATE_WINDOW_MINUTES") ?? "15");

function normalizeName(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function normalizeEmail(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

function normalizeIntent(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 2000);
}

function normalizeTeamSize(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 10000) return null;
  return n;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCorsHeaders(origin: string | null) {
  const allowList = ACCESS_REQUEST_ALLOWED_ORIGINS
    .split(",")
    .map(v => v.trim())
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

function json(body: unknown, status = 200, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function verifyTurnstile(token: string, ip: string | null) {
  if (!TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };
  if (!token) return { ok: false, detail: "Captcha token missing." };

  const body = new URLSearchParams({
    secret: TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (ip) body.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    return {
      ok: false,
      detail: "Captcha validation failed.",
      code: Array.isArray(data?.["error-codes"]) ? data["error-codes"].join(",") : "",
    };
  }
  return { ok: true, skipped: false };
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

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({
      error: "Server misconfiguration",
      detail: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    }, 500, corsHeaders);
  }
  if (!RESEND_API_KEY || !ACCESS_REQUEST_TEAM_EMAIL) {
    return json({
      error: "Server misconfiguration",
      detail: "Missing RESEND_API_KEY or ACCESS_REQUEST_TEAM_EMAIL.",
    }, 500, corsHeaders);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return json({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  const honeypot = String(payload.website || "").trim();
  if (honeypot) {
    return json({ ok: true }, 202, corsHeaders);
  }

  const name = normalizeName(payload.name);
  const email = normalizeEmail(payload.email);
  const intent = normalizeIntent(payload.intent);
  const teamSize = normalizeTeamSize(payload.team_size);
  const turnstileToken = String(payload.turnstile_token || "").trim();

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (name.length < 2) return json({ error: "Name must be at least 2 characters." }, 400, corsHeaders);
  if (!emailPattern.test(email)) return json({ error: "Email is invalid." }, 400, corsHeaders);
  if (intent.length < 8) return json({ error: "Intent must be at least 8 characters." }, 400, corsHeaders);
  if (payload.team_size && teamSize == null) {
    return json({ error: "Team size must be a whole number between 1 and 10000." }, 400, corsHeaders);
  }

  const turnstileCheck = await verifyTurnstile(turnstileToken, ip);
  if (!turnstileCheck.ok) {
    return json({ error: turnstileCheck.detail || "Captcha failed." }, 400, corsHeaders);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(Date.now() - ACCESS_REQUEST_RATE_WINDOW_MINUTES * 60_000).toISOString();
  const { count: recentCount, error: rateErr } = await supabase
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", cutoff);

  if (rateErr) {
    return json({ error: "Could not validate request rate.", detail: rateErr.message }, 500, corsHeaders);
  }
  if ((recentCount || 0) >= ACCESS_REQUEST_EMAIL_RATE_LIMIT) {
    return json({ error: "Too many requests. Please try again later." }, 429, corsHeaders);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("access_requests")
    .insert({
      name,
      email,
      intent,
      team_size: teamSize,
      status: "pending",
    })
    .select("id, name, email, intent, team_size, status, created_at")
    .single();

  if (insertErr) {
    return json({ error: "Could not create access request.", detail: insertErr.message }, 500, corsHeaders);
  }

  const resend = new Resend(RESEND_API_KEY);
  const teamSubject = `New access request - ${name}`;
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeIntent = escapeHtml(intent);
  const safeTeamSize = teamSize == null ? "Not provided" : String(teamSize);
  const safeCreatedAt = escapeHtml(new Date(inserted.created_at).toISOString());
  const safeId = escapeHtml(inserted.id);

  const textBody = [
    "New access request received.",
    "",
    `ID: ${inserted.id}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Intent: ${intent}`,
    `Team Size: ${safeTeamSize}`,
    `Status: ${inserted.status}`,
    `Created At: ${inserted.created_at}`,
    ip ? `IP: ${ip}` : "IP: unavailable",
  ].join("\n");

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin-bottom:12px;">New access request received</h2>
      <table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr><td><strong>ID</strong></td><td>${safeId}</td></tr>
        <tr><td><strong>Name</strong></td><td>${safeName}</td></tr>
        <tr><td><strong>Email</strong></td><td>${safeEmail}</td></tr>
        <tr><td><strong>Intent</strong></td><td>${safeIntent}</td></tr>
        <tr><td><strong>Team Size</strong></td><td>${escapeHtml(safeTeamSize)}</td></tr>
        <tr><td><strong>Status</strong></td><td>${escapeHtml(inserted.status)}</td></tr>
        <tr><td><strong>Created At</strong></td><td>${safeCreatedAt}</td></tr>
        <tr><td><strong>IP</strong></td><td>${escapeHtml(ip || "unavailable")}</td></tr>
      </table>
    </div>
  `;

  const emailResult = await resend.emails.send({
    from: ACCESS_REQUEST_FROM_EMAIL,
    to: [ACCESS_REQUEST_TEAM_EMAIL],
    subject: teamSubject,
    text: textBody,
    html: htmlBody,
    replyTo: email,
  });

  if (emailResult.error) {
    return json({
      error: "Request saved but notification email failed.",
      detail: emailResult.error.message || "Email provider error.",
      request_id: inserted.id,
    }, 502, corsHeaders);
  }

  return json({
    ok: true,
    request_id: inserted.id,
    status: inserted.status,
    message: "Request submitted successfully.",
  }, 201, corsHeaders);
});
