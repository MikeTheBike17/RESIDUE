import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cfg = window.env || {};
const MANAGER_EMAIL = 'check.email@residue.com';
const MANAGER_ACCESS_KEY = 'residue_manager_access';
const INVOICE_TABLE = cfg.SUPABASE_INVOICES_TABLE || 'purchase_invoices';

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
const urlsBody = document.getElementById('card-urls-body');
const invoiceBody = document.getElementById('invoice-rows-body');
const refreshBtn = document.getElementById('card-urls-refresh');
const invoiceRefreshBtn = document.getElementById('invoice-refresh');

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

function renderUrlRows(rows) {
  if (!urlsBody) return;
  if (!rows.length) {
    urlsBody.innerHTML = '<tr><td colspan="3" class="card-urls-empty">No users found.</td></tr>';
    return;
  }

  urlsBody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');

    const emailTd = document.createElement('td');
    emailTd.textContent = row.auth_email || '';

    const urlTd = document.createElement('td');
    const urlText = document.createElement('span');
    urlText.className = 'card-urls-link-text';
    urlText.textContent = row.url;
    urlTd.appendChild(urlText);

    const copyTd = document.createElement('td');
    copyTd.className = 'card-urls-copy-col';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'card-urls-copy-btn';
    copyBtn.setAttribute('aria-label', `Copy URL for ${row.auth_email}`);
    copyBtn.innerHTML = '<span class="card-urls-copy-icon" aria-hidden="true"></span>';
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
    urlsBody.appendChild(tr);
  });
}

function paymentLabel(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'COMPLETE') return 'Complete';
  if (normalized === 'FAILED' || normalized === 'CANCELLED') return 'Declined';
  return normalized || 'Pending';
}

function formatConfig(value) {
  const config = Number(value);
  if (Number.isInteger(config) && config > 0) return `Card ${config}`;
  return '';
}

function formatInvoiceNo(value) {
  return String(value || '').trim() || '';
}

function formatLogoValue(row) {
  if (!row.custom_logo_requested) return 'No';
  if (row.custom_logo_file_name) return row.custom_logo_file_name;
  return 'Yes';
}

function buildLogoDownload(row) {
  const dataUrl = String(row.custom_logo_image || '').trim();
  if (!row.custom_logo_requested || !dataUrl) return null;

  const anchor = document.createElement('a');
  anchor.className = 'card-urls-download-btn';
  anchor.href = dataUrl;
  anchor.download = row.custom_logo_file_name || `${row.invoice_no || 'residue-logo'}.png`;
  anchor.textContent = 'Download';
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noopener noreferrer');
  anchor.setAttribute('aria-label', `Download logo for invoice ${row.invoice_no || 'unknown'}`);
  return anchor;
}

function formatShipping(row) {
  return [
    row.shipping_name,
    row.shipping_street,
    row.shipping_suburb,
    row.shipping_city,
    row.shipping_postal
  ].filter(Boolean).join(', ');
}

function renderInvoiceRows(rows) {
  if (!invoiceBody) return;
  if (!rows.length) {
    invoiceBody.innerHTML = '<tr><td colspan="10" class="card-urls-empty">No invoices found.</td></tr>';
    return;
  }

  invoiceBody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    const cells = [
      row.invoice_no,
      row.customer_name,
      row.customer_email,
      row.customer_phone,
      String(row.quantity),
      row.card_configuration,
      row.logo_value
    ];

    cells.forEach((value, index) => {
      const td = document.createElement('td');
      if (index === 5) td.className = 'card-urls-inline-text';
      td.textContent = value || '';
      tr.appendChild(td);
    });

    const downloadTd = document.createElement('td');
    const downloadLink = buildLogoDownload(row);
    if (downloadLink) {
      downloadTd.appendChild(downloadLink);
    } else {
      downloadTd.textContent = '—';
    }
    tr.appendChild(downloadTd);

    const shippingTd = document.createElement('td');
    shippingTd.classList.add('card-urls-shipping');
    shippingTd.textContent = row.shipping || '';
    tr.appendChild(shippingTd);

    const paymentTd = document.createElement('td');
    paymentTd.textContent = row.payment_status || '';
    tr.appendChild(paymentTd);

    invoiceBody.appendChild(tr);
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

async function fetchProfileRows() {
  const { data, error } = await supabase
    .from('profiles')
    .select('auth_email, slug')
    .not('auth_email', 'is', null)
    .order('auth_email', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load card URLs.');

  return (data || [])
    .filter(row => row.auth_email && row.slug)
    .map(row => ({
      auth_email: row.auth_email,
      url: buildProfileUrl(row.slug)
    }));
}

async function fetchInvoiceRows() {
  const { data, error } = await supabase
    .from(INVOICE_TABLE)
    .select('invoice_no, customer_name, customer_email, customer_phone, quantity, card_configuration, custom_logo_requested, custom_logo_file_name, custom_logo_image, shipping_name, shipping_street, shipping_suburb, shipping_city, shipping_postal, payment_status, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'Could not load invoices.');

  return (data || []).map(row => ({
    invoice_no: formatInvoiceNo(row.invoice_no),
    customer_name: row.customer_name || '',
    customer_email: row.customer_email || '',
    customer_phone: row.customer_phone || '',
    quantity: row.quantity ?? '',
    card_configuration: formatConfig(row.card_configuration),
    logo_value: formatLogoValue(row),
    custom_logo_image: row.custom_logo_image || '',
    custom_logo_file_name: row.custom_logo_file_name || '',
    shipping: formatShipping(row),
    payment_status: paymentLabel(row.payment_status)
  }));
}

async function fetchAllRows() {
  if (!supabase) {
    setStatus('Supabase is not configured.', 'error');
    return;
  }

  setStatus('Refreshing...', 'loading');
  if (refreshBtn) refreshBtn.disabled = true;
   if (invoiceRefreshBtn) invoiceRefreshBtn.disabled = true;

  try {
    const [profileRows, invoiceRows] = await Promise.all([
      fetchProfileRows(),
      fetchInvoiceRows()
    ]);

    renderUrlRows(profileRows);
    renderInvoiceRows(invoiceRows);
    setStatus(`Loaded ${profileRows.length} URLs and ${invoiceRows.length} invoice rows.`, 'success');
  } catch (error) {
    renderUrlRows([]);
    renderInvoiceRows([]);
    setStatus(error.message || 'Could not load manager data.', 'error');
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
    if (invoiceRefreshBtn) invoiceRefreshBtn.disabled = false;
  }
}

async function refreshInvoicesOnly() {
  if (!supabase) {
    setStatus('Supabase is not configured.', 'error');
    return;
  }

  setStatus('Refreshing invoices...', 'loading');
  if (invoiceRefreshBtn) invoiceRefreshBtn.disabled = true;

  try {
    const invoiceRows = await fetchInvoiceRows();
    renderInvoiceRows(invoiceRows);
    setStatus(`Loaded ${invoiceRows.length} invoice rows.`, 'success');
  } catch (error) {
    renderInvoiceRows([]);
    setStatus(error.message || 'Could not load invoices.', 'error');
  } finally {
    if (invoiceRefreshBtn) invoiceRefreshBtn.disabled = false;
  }
}

refreshBtn?.addEventListener('click', fetchAllRows);
invoiceRefreshBtn?.addEventListener('click', refreshInvoicesOnly);

(async () => {
  await guardManagerAccess();
  await fetchAllRows();
})();
