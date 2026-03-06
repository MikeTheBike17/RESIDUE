import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cfg = window.env || {};
const MANAGER_EMAIL = 'check.email@residue.com';
const MANAGER_ACCESS_KEY = 'residue_manager_access';

const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
  ? null
  : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

const statusEl = document.getElementById('card-urls-status');
const tbody = document.getElementById('card-urls-body');
const refreshBtn = document.getElementById('card-urls-refresh');

function normalizeEmail(value) {
  return (value || '').trim().toLowerCase();
}

function setStatus(message, type = '') {
  if (!statusEl) return;
  statusEl.hidden = !message;
  statusEl.textContent = message;
  statusEl.className = 'status';
  if (type) statusEl.classList.add(type);
}

function buildProfileUrl(slug) {
  return `${window.location.origin}/link-profile?u=${encodeURIComponent(slug || '')}`;
}

function ensureManagerFlag(email) {
  localStorage.setItem(MANAGER_ACCESS_KEY, JSON.stringify({
    email: normalizeEmail(email),
    granted_at: new Date().toISOString()
  }));
}

function clearManagerFlag() {
  localStorage.removeItem(MANAGER_ACCESS_KEY);
}

function renderRows(rows) {
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="card-urls-empty">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');

    const emailTd = document.createElement('td');
    emailTd.textContent = row.auth_email || '';

    const urlTd = document.createElement('td');
    const link = document.createElement('a');
    link.href = row.url;
    link.textContent = row.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    urlTd.appendChild(link);

    const copyTd = document.createElement('td');
    copyTd.className = 'card-urls-copy-col';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'card-urls-copy-btn';
    copyBtn.setAttribute('aria-label', `Copy URL for ${row.auth_email}`);
    copyBtn.textContent = '⧉';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(row.url);
        setStatus(`Copied URL for ${row.auth_email}.`, 'success');
      } catch {
        setStatus('Could not copy URL.', 'error');
      }
    });
    copyTd.appendChild(copyBtn);

    tr.append(emailTd, urlTd, copyTd);
    tbody.appendChild(tr);
  });
}

async function guardManagerAccess() {
  if (!supabase) {
    clearManagerFlag();
    window.location.href = 'access.html';
    return null;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const sessionEmail = normalizeEmail(session?.user?.email);
  if (sessionEmail !== MANAGER_EMAIL) {
    clearManagerFlag();
    window.location.href = 'access.html';
    return null;
  }

  ensureManagerFlag(sessionEmail);
  return session;
}

async function fetchRows() {
  if (!supabase) {
    setStatus('Supabase is not configured.', 'error');
    return;
  }

  setStatus('Refreshing...', 'loading');
  refreshBtn && (refreshBtn.disabled = true);
  const { data, error } = await supabase
    .from('profiles')
    .select('auth_email, slug')
    .not('auth_email', 'is', null)
    .order('auth_email', { ascending: true });

  refreshBtn && (refreshBtn.disabled = false);
  if (error) {
    setStatus(error.message || 'Could not load card URLs.', 'error');
    renderRows([]);
    return;
  }

  const rows = (data || [])
    .filter(row => row.auth_email && row.slug)
    .map(row => ({
      auth_email: row.auth_email,
      url: buildProfileUrl(row.slug)
    }));

  renderRows(rows);
  setStatus(`Loaded ${rows.length} card URL${rows.length === 1 ? '' : 's'}.`, 'success');
}

refreshBtn?.addEventListener('click', fetchRows);

(async () => {
  await guardManagerAccess();
  await fetchRows();
})();
