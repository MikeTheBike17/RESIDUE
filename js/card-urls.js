import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cfg = window.env || {};
const MANAGER_EMAIL = 'check.email@residue.com';
const MANAGER_ACCESS_KEY = 'residue_manager_access';
const INVOICING_ACCESS_KEY = 'residue_manager_invoicing_access';
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
const searchInput = document.getElementById('manager-search');
const isCardUrlsPage = !!urlsBody;
const isInvoicingPage = !!invoiceBody && !urlsBody;
let profileRowsCache = [];
let invoiceRowsCache = [];
const INVOICE_TABLE_COLSPAN = 13;

function normalizeEmail(value) {
  return (value || '').trim().toLowerCase();
}

function normalizeSearchTerm(value) {
  return String(value || '').trim().toLowerCase();
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

function grantInvoicingAccess() {
  try {
    sessionStorage.setItem(INVOICING_ACCESS_KEY, String(Date.now()));
  } catch {}
}

function hasInvoicingAccess() {
  try {
    return !!sessionStorage.getItem(INVOICING_ACCESS_KEY);
  } catch {
    return false;
  }
}

function getActiveSearchTerm() {
  return normalizeSearchTerm(searchInput?.value);
}

function filterProfileRows(rows, query) {
  if (!query) return rows;
  return rows.filter(row => normalizeSearchTerm(row.auth_email).includes(query));
}

function filterInvoiceRows(rows, query) {
  if (!query) return rows;
  return rows.filter(row => (
    normalizeSearchTerm(row.customer_name).includes(query) ||
    normalizeSearchTerm(row.customer_email).includes(query) ||
    normalizeSearchTerm(row.customer_phone).includes(query)
  ));
}

function renderUrlRows(rows, emptyMessage = 'No users found.') {
  if (!urlsBody) return;
  if (!rows.length) {
    urlsBody.innerHTML = `<tr><td colspan="3" class="card-urls-empty">${emptyMessage}</td></tr>`;
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
  if (normalized === 'COMPLETE') return 'Paid';
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
    row.shipping_province,
    row.shipping_postal
  ].filter(Boolean).join(', ');
}

function renderInvoiceRows(rows, emptyMessage = 'No invoices found.') {
  if (!invoiceBody) return;
  if (!rows.length) {
    invoiceBody.innerHTML = `<tr><td colspan="${INVOICE_TABLE_COLSPAN}" class="card-urls-empty">${emptyMessage}</td></tr>`;
    return;
  }

  invoiceBody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    const cells = [
      row.invoice_no,
      row.customer_name,
      row.customer_title,
      row.customer_email,
      row.customer_phone,
      String(row.quantity),
      row.card_configuration,
      row.logo_value
    ];

    cells.forEach((value, index) => {
      const td = document.createElement('td');
      if (index === 6) td.className = 'card-urls-inline-text';
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

    const invoiceSentTd = document.createElement('td');
    invoiceSentTd.className = 'card-urls-check-col';
    invoiceSentTd.appendChild(buildInvoiceFlagCheckbox(row, 'invoice_sent_to_client', 'invoice sent'));
    tr.appendChild(invoiceSentTd);

    const orderSentTd = document.createElement('td');
    orderSentTd.className = 'card-urls-check-col';
    orderSentTd.appendChild(buildInvoiceFlagCheckbox(row, 'order_sent_to_client', 'order sent'));
    tr.appendChild(orderSentTd);

    invoiceBody.appendChild(tr);
  });
}

function buildInvoiceFlagCheckbox(row, field, label) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'card-urls-check';
  input.checked = !!row[field];
  input.setAttribute('aria-label', `Mark ${label} for invoice ${row.invoice_no || 'unknown'}`);
  input.addEventListener('change', () => updateInvoiceFlag(row, field, input.checked, input));
  return input;
}

async function updateInvoiceFlag(row, field, value, input) {
  if (!supabase || !row.invoice_no) return;

  const previousValue = !!row[field];
  row[field] = value;
  input.disabled = true;
  setStatus('Saving invoice status...', 'loading');

  const { error } = await supabase
    .from(INVOICE_TABLE)
    .update({
      [field]: value,
      updated_at: new Date().toISOString()
    })
    .eq('invoice_no', row.invoice_no);

  input.disabled = false;

  if (error) {
    row[field] = previousValue;
    input.checked = previousValue;
    setStatus(error.message || 'Could not save invoice status.', 'error');
    return;
  }

  const cachedRow = invoiceRowsCache.find(item => item.invoice_no === row.invoice_no);
  if (cachedRow) cachedRow[field] = value;
  setStatus('Invoice status saved.', 'success');
}

function applySearchFilter() {
  const query = getActiveSearchTerm();

  if (isCardUrlsPage) {
    const filteredRows = filterProfileRows(profileRowsCache, query);
    renderUrlRows(filteredRows, query ? 'No users match this email search.' : 'No users found.');
    return;
  }

  if (isInvoicingPage) {
    const filteredRows = filterInvoiceRows(invoiceRowsCache, query);
    renderInvoiceRows(filteredRows, query ? 'No users match this search.' : 'No invoices found.');
  }
}

async function guardManagerAccess() {
  if (isInvoicingPage && !hasInvoicingAccess()) {
    window.location.href = 'card-urls.html';
    return null;
  }

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
  if (isCardUrlsPage) grantInvoicingAccess();
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
    .select('invoice_no, customer_name, customer_title, customer_email, customer_phone, quantity, card_configuration, custom_logo_requested, custom_logo_file_name, custom_logo_image, shipping_name, shipping_street, shipping_suburb, shipping_city, shipping_province, shipping_postal, payment_status, invoice_sent_to_client, order_sent_to_client, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'Could not load invoices.');

  return (data || []).map(row => ({
    invoice_no: formatInvoiceNo(row.invoice_no),
    customer_name: row.customer_name || '',
    customer_title: row.customer_title || '',
    customer_email: row.customer_email || '',
    customer_phone: row.customer_phone || '',
    quantity: row.quantity ?? '',
    card_configuration: formatConfig(row.card_configuration),
    custom_logo_requested: !!row.custom_logo_requested,
    logo_value: formatLogoValue(row),
    custom_logo_image: row.custom_logo_image || '',
    custom_logo_file_name: row.custom_logo_file_name || '',
    shipping: formatShipping(row),
    payment_status: paymentLabel(row.payment_status),
    invoice_sent_to_client: !!row.invoice_sent_to_client,
    order_sent_to_client: !!row.order_sent_to_client
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
    if (isCardUrlsPage) {
      profileRowsCache = await fetchProfileRows();
      applySearchFilter();
      setStatus(`Loaded ${profileRowsCache.length} URLs.`, 'success');
    } else if (isInvoicingPage) {
      invoiceRowsCache = await fetchInvoiceRows();
      applySearchFilter();
      setStatus(`Loaded ${invoiceRowsCache.length} invoice rows.`, 'success');
    } else {
      setStatus('', '');
    }
  } catch (error) {
    profileRowsCache = [];
    invoiceRowsCache = [];
    if (isCardUrlsPage) renderUrlRows([]);
    if (isInvoicingPage) renderInvoiceRows([]);
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
    invoiceRowsCache = await fetchInvoiceRows();
    applySearchFilter();
    setStatus(`Loaded ${invoiceRowsCache.length} invoice rows.`, 'success');
  } catch (error) {
    invoiceRowsCache = [];
    renderInvoiceRows([]);
    setStatus(error.message || 'Could not load invoices.', 'error');
  } finally {
    if (invoiceRefreshBtn) invoiceRefreshBtn.disabled = false;
  }
}

refreshBtn?.addEventListener('click', fetchAllRows);
invoiceRefreshBtn?.addEventListener('click', refreshInvoicesOnly);
searchInput?.addEventListener('input', applySearchFilter);

(async () => {
  const session = await guardManagerAccess();
  if (!session) return;
  await fetchAllRows();
})();
