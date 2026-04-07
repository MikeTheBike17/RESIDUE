import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "content-type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.residue.cc").replace(/\/+$/, "");
const WALLET_SIGNING_SECRET = Deno.env.get("WALLET_SIGNING_SECRET") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return atob(padded);
}

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function signHmac(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

async function verifyToken(token: string, slug: string) {
  if (!WALLET_SIGNING_SECRET) return true;
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart) return false;
  const expected = await signHmac(payloadPart, WALLET_SIGNING_SECRET);
  if (expected !== signaturePart) return false;
  const payloadRaw = fromBase64Url(payloadPart);
  const payload = JSON.parse(payloadRaw);
  if (normalizeSlug(payload?.slug) !== slug) return false;
  if (Number(payload?.exp || 0) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({
      error: "Missing Supabase service role configuration",
      detail: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Edge Function secrets.",
    }, 500);
  }

  const url = new URL(req.url);
  const slug = normalizeSlug(url.searchParams.get("slug"));
  const token = url.searchParams.get("token") || "";
  if (!slug) return json({ error: "A valid slug is required." }, 400);
  if (!(await verifyToken(token, slug))) return json({ error: "Invalid or expired token." }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id,slug,name,title")
    .eq("slug", slug)
    .maybeSingle();
  if (profileErr) return json({ error: "Failed to load profile", detail: profileErr.message }, 500);
  if (!profile) return json({ error: "Profile not found." }, 404);

  const certPem = Deno.env.get("APPLE_WALLET_CERT_PEM") ?? "";
  const keyPem = Deno.env.get("APPLE_WALLET_KEY_PEM") ?? "";
  const wwdrPem = Deno.env.get("APPLE_WALLET_WWDR_PEM") ?? "";
  const passTypeIdentifier = Deno.env.get("APPLE_WALLET_PASS_TYPE_IDENTIFIER") ?? "";
  const teamIdentifier = Deno.env.get("APPLE_WALLET_TEAM_IDENTIFIER") ?? "";
  const organizationName = Deno.env.get("APPLE_WALLET_ORGANIZATION_NAME") ?? "Residue";

  // This endpoint is intentionally a production scaffold:
  // it validates slug/token and returns deterministic pass metadata.
  // Add signing implementation once your Apple cert chain is available.
  if (!certPem || !keyPem || !wwdrPem || !passTypeIdentifier || !teamIdentifier) {
    await supabase.from("wallet_passes").upsert({
      profile_id: profile.id,
      slug: profile.slug,
      platform: "apple",
      status: "pending_config",
      serial: `residue-${profile.slug}`,
      meta: { missing: "apple_cert_chain" },
    }, { onConflict: "slug,platform" }).then(() => null).catch(() => null);

    return json({
      notReady: true,
      error: "Apple Wallet not configured",
      detail: "Configure APPLE_WALLET_CERT_PEM, APPLE_WALLET_KEY_PEM, APPLE_WALLET_WWDR_PEM, APPLE_WALLET_PASS_TYPE_IDENTIFIER, and APPLE_WALLET_TEAM_IDENTIFIER.",
      slug: profile.slug,
      cardUrl: `${PUBLIC_SITE_URL}/link-profile.html?u=${encodeURIComponent(profile.slug)}`,
    }, 501);
  }

  const serialNumber = `residue-${profile.slug}`;
  const cardUrl = `${PUBLIC_SITE_URL}/link-profile.html?u=${encodeURIComponent(profile.slug)}`;
  const applePassScaffold = {
    description: "Residue Virtual Card",
    formatVersion: 1,
    organizationName,
    passTypeIdentifier,
    serialNumber,
    teamIdentifier,
    logoText: profile.name || "Residue",
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: "rgb(10,10,12)",
    labelColor: "rgb(214,178,107)",
    generic: {
      primaryFields: [{ key: "name", label: "Name", value: profile.name || "Residue User" }],
      secondaryFields: [{ key: "title", label: "Title", value: profile.title || "Profile" }],
      backFields: [{ key: "profile", label: "Profile", value: cardUrl }],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: cardUrl, messageEncoding: "iso-8859-1" }],
    webServiceURL: `${SUPABASE_URL}/functions/v1/wallet-apple-pass`,
    authenticationToken: token || "",
  };

  await supabase.from("wallet_passes").upsert({
    profile_id: profile.id,
    slug: profile.slug,
    platform: "apple",
    status: "ready_for_signing",
    serial: serialNumber,
    pass_url: `${SUPABASE_URL}/functions/v1/wallet-apple-pass?slug=${encodeURIComponent(profile.slug)}&token=${encodeURIComponent(token)}`,
    meta: { scaffold: true, card_url: cardUrl },
  }, { onConflict: "slug,platform" }).then(() => null).catch(() => null);

  return json({
    ok: true,
    scaffold: true,
    message: "Apple Wallet pass payload is ready. Add signer integration to return a .pkpass file.",
    slug: profile.slug,
    pass: applePassScaffold,
  });
});
