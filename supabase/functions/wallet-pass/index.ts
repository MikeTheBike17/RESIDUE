import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.residue.cc").replace(/\/+$/, "");
const WALLET_SIGNING_SECRET = Deno.env.get("WALLET_SIGNING_SECRET") ?? "";

const GOOGLE_WALLET_ISSUER_ID = Deno.env.get("GOOGLE_WALLET_ISSUER_ID") ?? "";
const GOOGLE_WALLET_CLASS_SUFFIX = Deno.env.get("GOOGLE_WALLET_CLASS_SUFFIX") ?? "residue_virtual_card";
const GOOGLE_SERVICE_ACCOUNT_EMAIL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeName(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 70);
}

function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(value: string) {
  return toBase64Url(new TextEncoder().encode(value));
}

function fromBase64ToBytes(value: string) {
  const normalized = value.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeIdPart(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "card";
}

async function signJwtRS256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKeyPem: string) {
  const encodedHeader = textToBase64Url(JSON.stringify(header));
  const encodedPayload = textToBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const keyData = fromBase64ToBytes(privateKeyPem.replace(/\\n/g, "\n"));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
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

async function createAppleToken(slug: string) {
  if (!WALLET_SIGNING_SECRET) return "";
  const payload = textToBase64Url(JSON.stringify({
    slug,
    exp: Math.floor(Date.now() / 1000) + 60 * 10,
  }));
  const signature = await signHmac(payload, WALLET_SIGNING_SECRET);
  return `${payload}.${signature}`;
}

function buildGooglePayload(slug: string, displayName: string, cardUrl: string) {
  const classId = `${GOOGLE_WALLET_ISSUER_ID}.${safeIdPart(GOOGLE_WALLET_CLASS_SUFFIX)}`;
  const objectId = `${GOOGLE_WALLET_ISSUER_ID}.${safeIdPart(`residue-${slug}`)}`;
  const cardArtUrl = `${PUBLIC_SITE_URL}/functions/v1/wallet-card-art?slug=${encodeURIComponent(slug)}`;

  return {
    classId,
    objectId,
    payload: {
      genericClasses: [
        {
          id: classId,
          issuerName: "Residue",
          reviewStatus: "UNDER_REVIEW",
        },
      ],
      genericObjects: [
        {
          id: objectId,
          classId,
          state: "ACTIVE",
          cardTitle: { defaultValue: { language: "en-US", value: "Residue Virtual Card" } },
          header: { defaultValue: { language: "en-US", value: displayName || "Residue User" } },
          subheader: { defaultValue: { language: "en-US", value: `residue.cc/${slug}` } },
          barcode: {
            type: "QR_CODE",
            value: cardUrl,
            alternateText: "Open profile",
          },
          heroImage: {
            sourceUri: { uri: cardArtUrl, description: "Residue virtual card art" },
            contentDescription: { defaultValue: { language: "en-US", value: "Residue virtual card" } },
          },
          textModulesData: [
            { id: "profile-link", header: "Profile", body: cardUrl },
            { id: "tap-hint", header: "Tap Action", body: "Open this profile in your browser." },
          ],
          linksModuleData: {
            uris: [
              { id: "open-profile", uri: cardUrl, description: "Open Profile", kind: "URI" },
            ],
          },
        },
      ],
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({
      error: "Missing Supabase service role configuration",
      detail: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Edge Function secrets.",
    }, 500);
  }

  const body = await req.json().catch(() => null);
  const slug = normalizeSlug(body?.slug);
  const requestedName = normalizeName(body?.name);
  const requestedPlatform = String(body?.platform || "").trim().toLowerCase();
  if (!slug) return json({ error: "A valid slug is required." }, 400);
  if (requestedPlatform && requestedPlatform !== "apple" && requestedPlatform !== "google") {
    return json({ error: "platform must be 'apple' or 'google' when provided." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id,slug,name")
    .eq("slug", slug)
    .maybeSingle();

  if (profileErr) return json({ error: "Failed to load profile", detail: profileErr.message }, 500);
  if (!profile) return json({ error: "Profile not found." }, 404);

  const displayName = normalizeName(profile.name || requestedName || "Residue User");
  const profileUrl = `${PUBLIC_SITE_URL}/link-profile.html?u=${encodeURIComponent(profile.slug)}`;
  const appleToken = await createAppleToken(profile.slug);
  const applePassUrl = `${SUPABASE_URL}/functions/v1/wallet-apple-pass?slug=${encodeURIComponent(profile.slug)}${
    appleToken ? `&token=${encodeURIComponent(appleToken)}` : ""
  }`;

  let googleSaveUrl = "";
  let googleReady = false;
  if (GOOGLE_WALLET_ISSUER_ID && GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    const walletPayload = buildGooglePayload(profile.slug, displayName, profileUrl);
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iss: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      aud: "google",
      typ: "savetowallet",
      iat: now,
      origins: [PUBLIC_SITE_URL],
      payload: walletPayload.payload,
    };
    const jwt = await signJwtRS256({ alg: "RS256", typ: "JWT" }, jwtPayload, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
    googleSaveUrl = `https://pay.google.com/gp/v/save/${jwt}`;
    googleReady = true;
    await supabase.from("wallet_passes").upsert({
      profile_id: profile.id,
      slug: profile.slug,
      platform: "google",
      status: "issued",
      serial: walletPayload.objectId,
      wallet_object_id: walletPayload.objectId,
      pass_url: googleSaveUrl,
      meta: { class_id: walletPayload.classId, card_url: profileUrl },
    }, { onConflict: "slug,platform" }).then(() => null).catch(() => null);
  } else {
    await supabase.from("wallet_passes").upsert({
      profile_id: profile.id,
      slug: profile.slug,
      platform: "google",
      status: "pending_config",
      serial: `residue-${profile.slug}`,
      meta: { missing: "google_credentials" },
    }, { onConflict: "slug,platform" }).then(() => null).catch(() => null);
  }

  await supabase.from("wallet_passes").upsert({
    profile_id: profile.id,
    slug: profile.slug,
    platform: "apple",
    status: "pending_config",
    serial: `residue-${profile.slug}`,
    pass_url: applePassUrl,
    meta: { card_url: profileUrl },
  }, { onConflict: "slug,platform" }).then(() => null).catch(() => null);

  const appleReady = Boolean(
    Deno.env.get("APPLE_WALLET_CERT_PEM") &&
    Deno.env.get("APPLE_WALLET_KEY_PEM") &&
    Deno.env.get("APPLE_WALLET_WWDR_PEM") &&
    Deno.env.get("APPLE_WALLET_PASS_TYPE_IDENTIFIER") &&
    Deno.env.get("APPLE_WALLET_TEAM_IDENTIFIER"),
  );

  return json({
    ok: true,
    slug: profile.slug,
    name: displayName,
    cardUrl: profileUrl,
    cardArtUrl: `${PUBLIC_SITE_URL}/functions/v1/wallet-card-art?slug=${encodeURIComponent(profile.slug)}`,
    applePassUrl,
    appleReady,
    googleSaveUrl,
    googleReady,
    notReady: requestedPlatform === "apple" ? !appleReady : requestedPlatform === "google" ? !googleReady : false,
    detail: !appleReady && requestedPlatform === "apple"
      ? "Apple Wallet signer secrets are not configured yet."
      : (!googleReady && requestedPlatform === "google")
      ? "Google Wallet issuer credentials are not configured yet."
      : "",
  });
});
