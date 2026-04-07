import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.residue.cc").replace(/\/+$/, "");
const CARD_IMAGE_PATH = "/images/card-images/card-front-1.jpeg";

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 42);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const url = new URL(req.url);
  const slug = normalizeSlug(url.searchParams.get("slug"));
  let name = normalizeName(url.searchParams.get("name"));

  if (!name && slug && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data } = await supabase.from("profiles").select("name").eq("slug", slug).maybeSingle();
    name = normalizeName(data?.name);
  }

  if (!name) name = "Residue User";
  const cardImageUrl = `${PUBLIC_SITE_URL}${CARD_IMAGE_PATH}`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1032" height="636" viewBox="0 0 1032 636" role="img" aria-label="Residue virtual card">
  <defs>
    <linearGradient id="shade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(0,0,0,0.08)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.34)" />
    </linearGradient>
  </defs>
  <image href="${escapeXml(cardImageUrl)}" x="0" y="0" width="1032" height="636" preserveAspectRatio="xMidYMid slice" />
  <rect x="0" y="0" width="1032" height="636" fill="url(#shade)" />
  <text x="516" y="330" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF"
        font-size="58" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="1.2">
    ${escapeXml(name)}
  </text>
</svg>`;

  return new Response(svg, {
    status: 200,
    headers: {
      ...corsHeaders,
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
});
