import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export const cfg = window.env || {};
export const MANAGER_EMAIL = 'check.email@residue.com';
export const MANAGER_ACCESS_KEY = 'residue_manager_access';

export const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
  ? null
  : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeSearchTerm(value) {
  return String(value || '').trim().toLowerCase();
}

export function ensureManagerFlag(email) {
  try {
    localStorage.setItem(MANAGER_ACCESS_KEY, JSON.stringify({
      email: normalizeEmail(email),
      granted_at: new Date().toISOString()
    }));
  } catch {}
}

export function clearManagerFlag() {
  try {
    localStorage.removeItem(MANAGER_ACCESS_KEY);
  } catch {}
}

export async function guardManagerAccess() {
  if (!supabase) {
    clearManagerFlag();
    window.location.href = 'residue-inside.html?auth=login';
    return null;
  }

  const { data: { session }, error } = await supabase.auth.getSession();
  const sessionEmail = normalizeEmail(session?.user?.email);

  if (error || sessionEmail !== MANAGER_EMAIL) {
    clearManagerFlag();
    window.location.href = 'residue-inside.html?auth=login';
    return null;
  }

  ensureManagerFlag(sessionEmail);
  return session;
}
