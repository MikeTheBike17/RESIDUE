import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_SITE_URL = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.residue.cc";
const MANAGER_EMAIL = Deno.env.get("RESIDUE_MANAGER_EMAIL") ?? "check.email@residue.com";
const ALLOWED_ORIGINS = Deno.env.get("CARDHOLDER_PROFILE_SYNC_ALLOWED_ORIGINS") ?? "*";

const INVOICE_TABLE = Deno.env.get("SUPABASE_INVOICES_TABLE") ?? "purchase_invoices";
const ORDER_EMAILS_TABLE = Deno.env.get("SUPABASE_ORDER_EMAILS_TABLE") ?? "order_card_emails";
const MANUAL_ALLOCATIONS_TABLE = Deno.env.get("SUPABASE_MANUAL_ALLOCATIONS_TABLE") ?? "manual_card_allocations";
const MANUAL_CARD_EMAILS_TABLE = Deno.env.get("SUPABASE_MANUAL_CARD_EMAILS_TABLE") ?? "manual_card_emails";

type SyncSource = "purchase" | "manual" | "all-missing" | "assignments";

type ExplicitAssignmentRow = {
  source?: unknown;
  invoice_no?: unknown;
  allocation_id?: unknown;
  card_index?: unknown;
  card_name?: unknown;
  card_email?: unknown;
  purchaser_profile_id?: unknown;
  purchaser_email?: unknown;
  customer_email?: unknown;
};

type SyncPayload = {
  source?: SyncSource;
  invoice_no?: string;
  allocation_id?: string;
  cardholders?: ExplicitAssignmentRow[];
  assignments?: ExplicitAssignmentRow[];
};

type RequestUser = {
  id: string;
  email?: string | null;
};

type CardholderEntry = {
  source: "purchase" | "manual";
  source_id: string;
  card_index: number;
  card_name: string;
  card_email: string;
  purchaser_profile_id: string;
  purchaser_email: string;
};

type ProfileRow = {
  id: string;
  auth_email: string;
  name: string;
  slug: string;
};

type SyncResult = {
  source: "purchase" | "manual";
  source_id: string;
  card_index: number;
  card_email: string;
  card_name: string;
  slug: string;
  url: string;
  created_auth_user: boolean;
};

type SyncSkipped = {
  source?: "purchase" | "manual";
  source_id?: string;
  card_email: string;
  card_index: number;
  reason: string;
  detail?: string;
};

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function buildCorsHeaders(origin: string | null) {
  const allowList = ALLOWED_ORIGINS
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
    "content-type": "application/json"
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  const value = error as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown };
  return String(value?.message || value?.error || value?.details || value?.hint || "Unexpected server error.");
}

function classifySyncError(error: unknown) {
  const message = errorMessage(error);
  if (/ensure_profile_for_auth_email|schema cache|could not find the function/i.test(message)) {
    return "missing_sql_helper";
  }
  if (/permission denied|not authorized|row-level security|rls/i.test(message)) {
    return "permission_error";
  }
  if (/service.*role|server misconfiguration|SUPABASE_SERVICE_ROLE_KEY/i.test(message)) {
    return "server_misconfiguration";
  }
  if (/auth user creation failed|create user|internal server error/i.test(message)) {
    return "auth_user_create_error";
  }
  return "sync_error";
}

function normalizeEmail(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

function normalizeName(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function normalizeSlug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function profileUrl(slug: string) {
  return `${PUBLIC_SITE_URL.replace(/\/+$/, "")}/link-profile?u=${encodeURIComponent(slug)}`;
}

function sourceIdForPayload(payload: SyncPayload) {
  if (payload.source === "manual") return String(payload.allocation_id || "").trim();
  if (payload.source === "purchase") return String(payload.invoice_no || "").trim();
  return "";
}

function addEntry(entries: Map<string, CardholderEntry>, entry: CardholderEntry, quantity: number) {
  const cardIndex = Math.trunc(Number(entry.card_index) || 0);
  if (cardIndex < 1 || cardIndex > quantity) return;

  entries.set(`${entry.source}:${entry.source_id}:${cardIndex}`, {
    ...entry,
    card_index: cardIndex,
    card_email: normalizeEmail(entry.card_email),
    purchaser_email: normalizeEmail(entry.purchaser_email),
    card_name: normalizeName(entry.card_name)
  });
}

function addPayloadRows(
  entries: Map<string, CardholderEntry>,
  rows: ExplicitAssignmentRow[] | undefined,
  options: {
    source?: "purchase" | "manual";
    sourceId?: string;
    purchaserProfileId?: string;
    purchaserEmail?: string;
    quantity?: number;
    fallbackProfileId: string;
  }
) {
  if (!Array.isArray(rows) || !rows.length) return;

  rows.slice(0, 250).forEach(row => {
    const source = options.source
      || (String(row.source || "").trim() === "manual" || row.allocation_id ? "manual" : "purchase");
    const sourceId = options.sourceId
      || String(source === "manual" ? row.allocation_id : row.invoice_no).trim();
    if (!sourceId) return;
    if (options.source && source !== options.source) return;
    if (options.sourceId && sourceId !== options.sourceId) return;

    addEntry(entries, {
      source,
      source_id: sourceId,
      card_index: row.card_index as number,
      card_name: normalizeName(row.card_name),
      card_email: normalizeEmail(row.card_email),
      purchaser_profile_id: String(row.purchaser_profile_id || options.purchaserProfileId || options.fallbackProfileId),
      purchaser_email: normalizeEmail(row.purchaser_email || row.customer_email || options.purchaserEmail)
    }, Math.max(1, Math.trunc(Number(options.quantity) || 10000)));
  });
}

async function getRequestUser(req: Request): Promise<RequestUser> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Missing authorization token."), { status: 401 });
  if (!supabase) throw Object.assign(new Error("Server misconfiguration."), { status: 500 });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) {
    throw Object.assign(new Error("Invalid authorization token."), { status: 401 });
  }

  return {
    id: data.user.id,
    email: normalizeEmail(data.user.email)
  };
}

async function collectPurchaseEntries(
  invoiceNo: string,
  user: RequestUser,
  isAdmin: boolean,
  payloadRows?: ExplicitAssignmentRow[]
) {
  if (!supabase) throw new Error("Server misconfiguration.");
  if (!invoiceNo) throw Object.assign(new Error("Invoice number is required."), { status: 400 });

  const { data: invoice, error: invoiceError } = await supabase
    .from(INVOICE_TABLE)
    .select("invoice_no, profile_id, customer_name, customer_email, quantity, payment_status")
    .eq("invoice_no", invoiceNo)
    .maybeSingle();

  if (invoiceError) throw invoiceError;
  if (!invoice) throw Object.assign(new Error("Invoice was not found."), { status: 404 });
  if (!isAdmin && invoice.profile_id !== user.id) {
    throw Object.assign(new Error("You can only sync your own orders."), { status: 403 });
  }
  if (String(invoice.payment_status || "").toUpperCase() !== "COMPLETE") {
    throw Object.assign(new Error("Only completed orders can create cardholder URLs."), { status: 403 });
  }

  const quantity = Math.max(1, Math.trunc(Number(invoice.quantity) || 0));
  const entries = new Map<string, CardholderEntry>();
  const sourceId = String(invoice.invoice_no || "");
  const purchaserEmail = normalizeEmail(invoice.customer_email);

  addEntry(entries, {
    source: "purchase",
    source_id: sourceId,
    card_index: 1,
    card_name: normalizeName(invoice.customer_name) || "Purchaser",
    card_email: purchaserEmail,
    purchaser_profile_id: invoice.profile_id,
    purchaser_email: purchaserEmail
  }, quantity);

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from(ORDER_EMAILS_TABLE)
    .select("invoice_no, purchaser_profile_id, purchaser_email, card_index, card_name, card_email")
    .eq("invoice_no", invoiceNo)
    .order("card_index", { ascending: true });

  if (assignmentError) throw assignmentError;

  (assignmentRows || []).forEach(row => addEntry(entries, {
    source: "purchase",
    source_id: sourceId,
    card_index: row.card_index,
    card_name: row.card_name || "",
    card_email: row.card_email || "",
    purchaser_profile_id: row.purchaser_profile_id || invoice.profile_id,
    purchaser_email: row.purchaser_email || purchaserEmail
  }, quantity));

  addPayloadRows(entries, payloadRows, {
    source: "purchase",
    sourceId,
    purchaserProfileId: invoice.profile_id,
    purchaserEmail,
    quantity,
    fallbackProfileId: user.id
  });

  return Array.from(entries.values());
}

async function collectManualEntries(
  allocationId: string,
  user: RequestUser,
  isAdmin: boolean,
  payloadRows?: ExplicitAssignmentRow[]
) {
  if (!supabase) throw new Error("Server misconfiguration.");
  if (!allocationId) throw Object.assign(new Error("Allocation id is required."), { status: 400 });

  const { data: allocation, error: allocationError } = await supabase
    .from(MANUAL_ALLOCATIONS_TABLE)
    .select("id, profile_id, quantity, quote_reference, account_email, account_name")
    .eq("id", allocationId)
    .maybeSingle();

  if (allocationError) throw allocationError;
  if (!allocation) throw Object.assign(new Error("Manual allocation was not found."), { status: 404 });
  if (!isAdmin && allocation.profile_id !== user.id) {
    throw Object.assign(new Error("You can only sync your own manual allocations."), { status: 403 });
  }

  const quantity = Math.max(1, Math.trunc(Number(allocation.quantity) || 0));
  const entries = new Map<string, CardholderEntry>();
  const sourceId = String(allocation.id || "");
  const purchaserEmail = normalizeEmail(allocation.account_email || user.email);

  addEntry(entries, {
    source: "manual",
    source_id: sourceId,
    card_index: 1,
    card_name: normalizeName(allocation.account_name) || "Purchaser",
    card_email: purchaserEmail,
    purchaser_profile_id: allocation.profile_id,
    purchaser_email: purchaserEmail
  }, quantity);

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from(MANUAL_CARD_EMAILS_TABLE)
    .select("allocation_id, purchaser_profile_id, purchaser_email, card_index, card_name, card_email")
    .eq("allocation_id", allocationId)
    .order("card_index", { ascending: true });

  if (assignmentError) throw assignmentError;

  (assignmentRows || []).forEach(row => addEntry(entries, {
    source: "manual",
    source_id: sourceId,
    card_index: row.card_index,
    card_name: row.card_name || "",
    card_email: row.card_email || "",
    purchaser_profile_id: row.purchaser_profile_id || allocation.profile_id,
    purchaser_email: row.purchaser_email || purchaserEmail
  }, quantity));

  addPayloadRows(entries, payloadRows, {
    source: "manual",
    sourceId,
    purchaserProfileId: allocation.profile_id,
    purchaserEmail,
    quantity,
    fallbackProfileId: user.id
  });

  return Array.from(entries.values());
}

async function collectExplicitAssignmentEntries(payload: SyncPayload, user: RequestUser, isAdmin: boolean) {
  if (!isAdmin) {
    throw Object.assign(new Error("Only the manager can sync explicit cardholder assignments."), { status: 403 });
  }

  const entries = new Map<string, CardholderEntry>();
  addPayloadRows(entries, payload.assignments, {
    fallbackProfileId: user.id
  });
  return Array.from(entries.values());
}

async function collectAllMissingEntries(user: RequestUser, isAdmin: boolean) {
  if (!isAdmin) {
    throw Object.assign(new Error("Only the manager can run a full cardholder URL backfill."), { status: 403 });
  }
  if (!supabase) throw new Error("Server misconfiguration.");

  const entries = new Map<string, CardholderEntry>();

  const { data: invoices, error: invoiceError } = await supabase
    .from(INVOICE_TABLE)
    .select("invoice_no, profile_id, customer_name, customer_email, quantity, payment_status")
    .eq("payment_status", "COMPLETE")
    .gt("quantity", 1)
    .order("created_at", { ascending: false });

  if (invoiceError) throw invoiceError;

  const invoiceRows = (invoices || []).filter(row => row.invoice_no && row.profile_id);
  invoiceRows.forEach(row => {
    const quantity = Math.max(1, Math.trunc(Number(row.quantity) || 0));
    addEntry(entries, {
      source: "purchase",
      source_id: row.invoice_no,
      card_index: 1,
      card_name: normalizeName(row.customer_name) || "Purchaser",
      card_email: row.customer_email || "",
      purchaser_profile_id: row.profile_id,
      purchaser_email: row.customer_email || ""
    }, quantity);
  });

  if (invoiceRows.length) {
    const quantityByInvoice = new Map(invoiceRows.map(row => [
      row.invoice_no,
      Math.max(1, Math.trunc(Number(row.quantity) || 0))
    ]));
    const purchaserByInvoice = new Map(invoiceRows.map(row => [row.invoice_no, {
      profile_id: row.profile_id,
      email: normalizeEmail(row.customer_email)
    }]));

    const { data: purchaseAssignments, error: purchaseAssignmentError } = await supabase
      .from(ORDER_EMAILS_TABLE)
      .select("invoice_no, purchaser_profile_id, purchaser_email, card_index, card_name, card_email")
      .in("invoice_no", invoiceRows.map(row => row.invoice_no))
      .order("invoice_no", { ascending: true })
      .order("card_index", { ascending: true });

    if (purchaseAssignmentError) throw purchaseAssignmentError;

    (purchaseAssignments || []).forEach(row => {
      const parent = purchaserByInvoice.get(row.invoice_no);
      addEntry(entries, {
        source: "purchase",
        source_id: row.invoice_no,
        card_index: row.card_index,
        card_name: row.card_name || "",
        card_email: row.card_email || "",
        purchaser_profile_id: row.purchaser_profile_id || parent?.profile_id || user.id,
        purchaser_email: row.purchaser_email || parent?.email || ""
      }, quantityByInvoice.get(row.invoice_no) || 0);
    });
  }

  const { data: allocations, error: allocationError } = await supabase
    .from(MANUAL_ALLOCATIONS_TABLE)
    .select("id, profile_id, quantity, quote_reference, account_email, account_name")
    .gt("quantity", 0)
    .order("updated_at", { ascending: false });

  if (allocationError) throw allocationError;

  const allocationRows = (allocations || []).filter(row => row.id && row.profile_id);
  allocationRows.forEach(row => {
    const quantity = Math.max(1, Math.trunc(Number(row.quantity) || 0));
    addEntry(entries, {
      source: "manual",
      source_id: row.id,
      card_index: 1,
      card_name: normalizeName(row.account_name) || "Purchaser",
      card_email: row.account_email || "",
      purchaser_profile_id: row.profile_id,
      purchaser_email: row.account_email || ""
    }, quantity);
  });

  if (allocationRows.length) {
    const quantityByAllocation = new Map(allocationRows.map(row => [
      row.id,
      Math.max(1, Math.trunc(Number(row.quantity) || 0))
    ]));
    const purchaserByAllocation = new Map(allocationRows.map(row => [row.id, {
      profile_id: row.profile_id,
      email: normalizeEmail(row.account_email)
    }]));

    const { data: manualAssignments, error: manualAssignmentError } = await supabase
      .from(MANUAL_CARD_EMAILS_TABLE)
      .select("allocation_id, purchaser_profile_id, purchaser_email, card_index, card_name, card_email")
      .in("allocation_id", allocationRows.map(row => row.id))
      .order("allocation_id", { ascending: true })
      .order("card_index", { ascending: true });

    if (manualAssignmentError) throw manualAssignmentError;

    (manualAssignments || []).forEach(row => {
      const parent = purchaserByAllocation.get(row.allocation_id);
      addEntry(entries, {
        source: "manual",
        source_id: row.allocation_id,
        card_index: row.card_index,
        card_name: row.card_name || "",
        card_email: row.card_email || "",
        purchaser_profile_id: row.purchaser_profile_id || parent?.profile_id || user.id,
        purchaser_email: row.purchaser_email || parent?.email || ""
      }, quantityByAllocation.get(row.allocation_id) || 0);
    });
  }

  return Array.from(entries.values());
}

async function findProfileByEmail(email: string) {
  if (!supabase) throw new Error("Server misconfiguration.");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, auth_email, name, slug")
    .eq("auth_email", email)
    .maybeSingle();

  if (error) throw error;
  return data as ProfileRow | null;
}

async function ensureProfileForEmail(entry: CardholderEntry) {
  if (!supabase) throw new Error("Server misconfiguration.");

  const email = normalizeEmail(entry.card_email);
  const displayName = normalizeName(entry.card_name) || email.split("@")[0] || "Residue User";
  const preferredSlug = normalizeSlug(displayName) || normalizeSlug(email.split("@")[0]);
  const existingProfile = await findProfileByEmail(email);

  if (existingProfile?.slug) {
    return { profile: existingProfile, createdAuthUser: false };
  }

  let createdAuthUser = false;
  let profile = await callEnsureProfileRpc(email, displayName, preferredSlug).catch(async error => {
    if (!/No auth user exists/i.test(error.message || "")) throw error;

    await createAuthUser(email, displayName);
    createdAuthUser = true;
    return callEnsureProfileRpc(email, displayName, preferredSlug);
  });

  if (!profile?.slug) {
    profile = await callEnsureProfileRpc(email, displayName, preferredSlug);
  }

  return { profile, createdAuthUser };
}

async function callEnsureProfileRpc(email: string, displayName: string, preferredSlug: string) {
  if (!supabase) throw new Error("Server misconfiguration.");

  const { data, error } = await supabase
    .rpc("ensure_profile_for_auth_email", {
      p_email: email,
      p_display_name: displayName,
      p_preferred_slug: preferredSlug
    });

  if (error) {
    throw new Error(`Profile helper failed for ${email}: ${error.message || "Unknown RPC error"}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.slug) throw new Error(`Could not create a profile for ${email}.`);

  return {
    id: row.profile_id,
    auth_email: row.auth_email,
    name: row.name,
    slug: row.slug
  } as ProfileRow;
}

async function createAuthUser(email: string, displayName: string) {
  if (!supabase) throw new Error("Server misconfiguration.");

  const password = `${crypto.randomUUID()}${crypto.randomUUID()}Aa1!`;
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: displayName,
      name: displayName,
      residue_cardholder: true
    }
  });

  if (error && !/(already|registered|exists)/i.test(error.message || "")) {
    throw new Error(`Auth user creation failed for ${email}: ${error.message || "Unknown auth error"}`);
  }
}

async function syncEntries(entries: CardholderEntry[]) {
  const results: SyncResult[] = [];
  const skipped: SyncSkipped[] = [];
  const profilesByEmail = new Map<string, { profile: ProfileRow; createdAuthUser: boolean }>();

  for (const entry of entries) {
    const email = normalizeEmail(entry.card_email);
    if (!email || !isValidEmail(email)) {
      skipped.push({
        card_email: email,
        card_index: entry.card_index,
        reason: "invalid_email"
      });
      continue;
    }

    if (!profilesByEmail.has(email)) {
      try {
        const synced = await ensureProfileForEmail({ ...entry, card_email: email });
        profilesByEmail.set(email, synced);
      } catch (error) {
        const detail = errorMessage(error);
        console.error("Cardholder profile sync failed", {
          source: entry.source,
          source_id: entry.source_id,
          card_index: entry.card_index,
          card_email: email,
          error: detail
        });
        skipped.push({
          source: entry.source,
          source_id: entry.source_id,
          card_email: email,
          card_index: entry.card_index,
          reason: classifySyncError(error),
          detail
        });
        continue;
      }
    }

    const synced = profilesByEmail.get(email);
    if (!synced?.profile?.slug) {
      skipped.push({
        card_email: email,
        card_index: entry.card_index,
        reason: "missing_profile"
      });
      continue;
    }

    results.push({
      source: entry.source,
      source_id: entry.source_id,
      card_index: entry.card_index,
      card_email: email,
      card_name: entry.card_name,
      slug: synced.profile.slug,
      url: profileUrl(synced.profile.slug),
      created_auth_user: synced.createdAuthUser
    });
  }

  return { results, skipped };
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
  if (!supabase) {
    return json({
      error: "Server misconfiguration",
      detail: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Edge Function secrets."
    }, 500, corsHeaders);
  }

  try {
    const user = await getRequestUser(req);
    const isAdmin = normalizeEmail(user.email) === normalizeEmail(MANAGER_EMAIL);
    const payload = (await req.json().catch(() => null)) as SyncPayload | null;
    const source = payload?.source;

    if (source !== "purchase" && source !== "manual" && source !== "all-missing" && source !== "assignments") {
      return json({ error: "source must be purchase, manual, all-missing, or assignments." }, 400, corsHeaders);
    }

    const safePayload = payload || {};
    let entries: CardholderEntry[] = [];
    if (source === "purchase") {
      entries = await collectPurchaseEntries(sourceIdForPayload(safePayload), user, isAdmin, safePayload.cardholders);
    } else if (source === "manual") {
      entries = await collectManualEntries(sourceIdForPayload(safePayload), user, isAdmin, safePayload.cardholders);
    } else if (source === "assignments") {
      entries = await collectExplicitAssignmentEntries(safePayload, user, isAdmin);
    } else {
      entries = await collectAllMissingEntries(user, isAdmin);
    }

    const { results, skipped } = await syncEntries(entries);
    return json({
      ok: true,
      source,
      requested: entries.length,
      synced: results.length,
      results,
      skipped
    }, 200, corsHeaders);
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    return json({
      error: errorMessage(error)
    }, status, corsHeaders);
  }
});
