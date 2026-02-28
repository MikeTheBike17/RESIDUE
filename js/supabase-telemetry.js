import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cfg = window.env || {};
const AUTH_LOG_TABLE = cfg.SUPABASE_AUTH_LOG_TABLE || 'auth_activity_log';
const PURCHASE_LOG_TABLE = cfg.SUPABASE_PURCHASE_LOG_TABLE || 'purchase_activity_log';
const VISITOR_KEY = 'residue_visitor_id';

const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
  ? null
  : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

function getVisitorId() {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const next = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    localStorage.setItem(VISITOR_KEY, next);
    return next;
  } catch {
    return 'unknown';
  }
}

async function getUserId() {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  } catch {
    return null;
  }
}

async function safeInsert(table, payload) {
  if (!supabase) return { ok: false, reason: 'missing_supabase' };
  try {
    const { error } = await supabase.from(table).insert(payload);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'unknown_error' };
  }
}

async function logAuthEvent(event = {}) {
  const payload = {
    occurred_at: new Date().toISOString(),
    visitor_id: getVisitorId(),
    user_id: event.user_id || await getUserId(),
    email: (event.email || '').toLowerCase() || null,
    action: event.action || 'unknown',
    outcome: event.outcome || 'unknown',
    provider: event.provider || 'password',
    source_page: event.source_page || window.location.pathname,
    detail: event.detail || null,
    metadata: event.metadata || {}
  };
  return safeInsert(AUTH_LOG_TABLE, payload);
}

async function logPurchaseEvent(event = {}) {
  const payload = {
    occurred_at: new Date().toISOString(),
    visitor_id: getVisitorId(),
    user_id: event.user_id || await getUserId(),
    email: (event.email || '').toLowerCase() || null,
    invoice_no: event.invoice_no || null,
    order_ref: event.order_ref || null,
    stage: event.stage || 'unknown',
    outcome: event.outcome || 'unknown',
    payment_provider: event.payment_provider || null,
    payment_status: event.payment_status || null,
    amount_total: Number.isFinite(Number(event.amount_total)) ? Number(event.amount_total) : null,
    currency: event.currency || 'ZAR',
    product: event.product || null,
    quantity: Number.isFinite(Number(event.quantity)) ? Number(event.quantity) : null,
    source_page: event.source_page || window.location.pathname,
    detail: event.detail || null,
    metadata: event.metadata || {}
  };
  return safeInsert(PURCHASE_LOG_TABLE, payload);
}

export const residueTelemetry = {
  enabled: !!supabase,
  logAuthEvent,
  logPurchaseEvent
};

window.residueTelemetry = residueTelemetry;

