import {
  cfg,
  guardManagerAccess,
  normalizeEmail,
  normalizeSearchTerm,
  supabase
} from './admin-access.js';
import {
  countSyncedProfileUrls,
  profileSyncIssueSummary,
  syncCardholderProfiles
} from './cardholder-profile-sync.js';

const INVOICE_TABLE = cfg.SUPABASE_INVOICES_TABLE || 'purchase_invoices';
const ORDER_EMAILS_TABLE = cfg.SUPABASE_ORDER_EMAILS_TABLE || 'order_card_emails';
const MANUAL_ALLOCATIONS_TABLE = cfg.SUPABASE_MANUAL_ALLOCATIONS_TABLE || 'manual_card_allocations';
const MANUAL_CARD_EMAILS_TABLE = cfg.SUPABASE_MANUAL_CARD_EMAILS_TABLE || 'manual_card_emails';
const CARDHOLDER_PROFILE_URLS_TABLE = cfg.SUPABASE_CARDHOLDER_PROFILE_URLS_TABLE || 'cardholder_profile_urls';

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
let orderEmailAssignmentsCache = [];
let activeSession = null;
const INVOICE_TABLE_COLSPAN = 15;

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

function buildCopyButton(value, label, successMessage) {
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'card-urls-copy-btn';
  copyBtn.disabled = !String(value || '').trim();
  copyBtn.setAttribute('aria-label', label);
  copyBtn.innerHTML = '<span class="card-urls-copy-icon" aria-hidden="true"></span>';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(successMessage, 'success');
    } catch {
      setStatus('Could not copy.', 'error');
    }
  });
  return copyBtn;
}

function getActiveSearchTerm() {
  return normalizeSearchTerm(searchInput?.value);
}

function filterProfileRows(rows, query) {
  if (!query) return rows;
  return rows.filter(row => (
    normalizeSearchTerm(row.auth_email).includes(query) ||
    normalizeSearchTerm(row.name).includes(query) ||
    (row.order_emails || []).some(item => (
      normalizeSearchTerm(item.card_email).includes(query) ||
      normalizeSearchTerm(item.card_name).includes(query) ||
      normalizeSearchTerm(item.url).includes(query)
    ))
  ));
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
    urlsBody.innerHTML = `<tr><td colspan="5" class="card-urls-empty">${emptyMessage}</td></tr>`;
    return;
  }

  urlsBody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');

    const emailTd = document.createElement('td');
    emailTd.textContent = row.auth_email || '';

    const nameTd = document.createElement('td');
    nameTd.textContent = row.name || '';

    const urlTd = document.createElement('td');
    const urlText = document.createElement('span');
    urlText.className = 'card-urls-link-text';
    urlText.textContent = row.url;
    urlTd.appendChild(urlText);

    const assignedTd = document.createElement('td');
    assignedTd.appendChild(buildAssignedEmailDropdown(row));

    const copyTd = document.createElement('td');
    copyTd.className = 'card-urls-copy-col';
    copyTd.appendChild(buildCopyButton(
      row.url,
      `Copy URL for ${row.auth_email}`,
      `Copied URL for ${row.auth_email}.`
    ));

    tr.append(emailTd, nameTd, urlTd, assignedTd, copyTd);
    urlsBody.appendChild(tr);
  });
}

function buildAssignedEmailDropdown(row) {
  const assignments = row.order_emails || [];
  if (!assignments.length) {
    const empty = document.createElement('span');
    empty.textContent = '-';
    return empty;
  }

  const details = document.createElement('details');
  details.className = 'card-urls-assigned';

  const summary = document.createElement('summary');
  summary.textContent = `${assignments.length} email${assignments.length === 1 ? '' : 's'}`;
  details.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'card-urls-assigned-list';
  assignments.forEach(item => {
    const rowEl = document.createElement('div');
    rowEl.className = 'card-urls-assigned-card';

    const name = document.createElement('strong');
    name.className = 'card-urls-assigned-name';
    name.textContent = item.card_name || item.profile_name || 'Name not set';

    const emailRow = document.createElement('div');
    emailRow.className = 'card-urls-assigned-line';
    const emailLabel = document.createElement('span');
    emailLabel.className = 'card-urls-assigned-label';
    emailLabel.textContent = 'Email';
    const email = document.createElement('span');
    email.className = 'card-urls-assigned-email';
    email.textContent = item.card_email;
    emailRow.append(
      emailLabel,
      email,
      buildCopyButton(
        item.card_email,
        `Copy assigned email ${item.card_email}`,
        `Copied ${item.card_email}.`
      )
    );

    const urlRow = document.createElement('div');
    urlRow.className = 'card-urls-assigned-line';
    const urlLabel = document.createElement('span');
    urlLabel.className = 'card-urls-assigned-label';
    urlLabel.textContent = 'URL';
    const url = document.createElement('span');
    url.className = item.url ? 'card-urls-assigned-url' : 'card-urls-assigned-missing';
    url.textContent = item.url || 'No profile URL yet';
    urlRow.append(urlLabel, url);
    if (item.url) {
      urlRow.appendChild(buildCopyButton(
        item.url,
        `Copy profile URL for ${item.card_email}`,
        `Copied URL for ${item.card_email}.`
      ));
    } else {
      urlRow.classList.add('card-urls-assigned-line--missing');
    }

    const note = document.createElement('span');
    note.className = 'card-urls-assigned-note';
    const sourceNote = item.source === 'manual'
      ? (item.quote_reference ? `Manual ${item.quote_reference}` : 'Manual allocation')
      : (item.invoice_no || 'Order');
    note.textContent = `${sourceNote} - Card ${item.card_index || ''}`.trim();

    rowEl.append(name, emailRow, urlRow, note);
    list.appendChild(rowEl);
  });
  details.appendChild(list);
  return details;
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

function formatInvoiceDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
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
      row.invoice_date,
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
      if (index === 7) td.className = 'card-urls-inline-text';
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

    const cardLaseredTd = document.createElement('td');
    cardLaseredTd.className = 'card-urls-check-col';
    cardLaseredTd.appendChild(buildInvoiceFlagCheckbox(row, 'card_lasered', 'card lasered'));
    tr.appendChild(cardLaseredTd);

    const orderShippedTd = document.createElement('td');
    orderShippedTd.className = 'card-urls-check-col';
    orderShippedTd.appendChild(buildInvoiceFlagCheckbox(row, 'order_shipped', 'order shipped'));
    tr.appendChild(orderShippedTd);

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
    renderUrlRows(filteredRows, query ? 'No users match this search.' : 'No users found.');
    return;
  }

  if (isInvoicingPage) {
    const filteredRows = filterInvoiceRows(invoiceRowsCache, query);
    renderInvoiceRows(filteredRows, query ? 'No users match this search.' : 'No invoices found.');
  }
}

async function fetchProfileRows() {
  const { data, error } = await supabase
    .from('profiles')
    .select('auth_email, name, slug')
    .not('auth_email', 'is', null)
    .order('auth_email', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load card URLs.');

  return (data || [])
    .filter(row => row.auth_email && row.slug)
    .map(row => ({
      auth_email: row.auth_email,
      name: row.name || '',
      slug: row.slug || '',
      url: buildProfileUrl(row.slug),
      order_emails: []
    }));
}

function attachOrderEmailsToProfiles(profileRows, assignments, reservedUrlsByEmail = new Map()) {
  const profilesByEmail = new Map(profileRows.map(row => [
    normalizeEmail(row.auth_email),
    row
  ]));
  const grouped = new Map();
  assignments.forEach(item => {
    const purchaserEmail = normalizeEmail(item.purchaser_email || item.customer_email);
    const cardEmail = normalizeEmail(item.card_email);
    if (!purchaserEmail || !cardEmail) return;
    const profile = profilesByEmail.get(cardEmail);
    const reserved = reservedUrlsByEmail.get(cardEmail);
    const slug = profile?.slug || reserved?.profile_slug || '';
    if (!grouped.has(purchaserEmail)) grouped.set(purchaserEmail, []);
    grouped.get(purchaserEmail).push({
      source: item.source || 'purchase',
      invoice_no: item.invoice_no || '',
      allocation_id: item.allocation_id || '',
      quote_reference: item.quote_reference || '',
      card_index: item.card_index || '',
      card_name: String(item.card_name || profile?.name || '').trim(),
      profile_name: profile?.name || '',
      card_email: cardEmail,
      slug,
      url: slug ? buildProfileUrl(slug) : ''
    });
  });

  return profileRows.map(row => ({
    ...row,
    order_emails: (grouped.get(normalizeEmail(row.auth_email)) || [])
      .sort((a, b) => {
        const aGroup = a.source === 'manual' ? `manual:${a.quote_reference || a.allocation_id}` : `purchase:${a.invoice_no}`;
        const bGroup = b.source === 'manual' ? `manual:${b.quote_reference || b.allocation_id}` : `purchase:${b.invoice_no}`;
        return aGroup.localeCompare(bGroup) || Number(a.card_index) - Number(b.card_index);
      })
  }));
}

function missingProfileAssignments(profileRows, assignments, reservedUrlsByEmail = new Map()) {
  const profileEmails = new Set(profileRows.map(row => normalizeEmail(row.auth_email)).filter(Boolean));
  return (assignments || []).filter(item => {
    const cardEmail = normalizeEmail(item.card_email);
    return cardEmail && !profileEmails.has(cardEmail) && !reservedUrlsByEmail.has(cardEmail);
  });
}

async function fetchReservedProfileUrls(assignments) {
  const emails = Array.from(new Set(
    (assignments || [])
      .map(item => normalizeEmail(item.card_email))
      .filter(Boolean)
  ));
  if (!emails.length) return new Map();

  const { data, error } = await supabase
    .from(CARDHOLDER_PROFILE_URLS_TABLE)
    .select('card_email, profile_slug, display_name')
    .in('card_email', emails);

  if (error) throw new Error(error.message || 'Could not load reserved cardholder URLs.');

  return new Map((data || [])
    .filter(row => row.card_email && row.profile_slug)
    .map(row => [normalizeEmail(row.card_email), row]));
}

function syncPayloadForAssignments(assignments) {
  return (assignments || []).map(item => ({
    source: item.source || 'purchase',
    invoice_no: item.invoice_no || '',
    allocation_id: item.allocation_id || '',
    purchaser_profile_id: item.purchaser_profile_id || '',
    purchaser_email: item.purchaser_email || item.customer_email || '',
    card_index: item.card_index || '',
    card_name: item.card_name || '',
    card_email: item.card_email || ''
  }));
}

async function backfillMissingProfileUrls(missingAssignments = []) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id) activeSession = session;

  return syncCardholderProfiles({
    cfg,
    session: activeSession,
    payload: missingAssignments.length
      ? { source: 'assignments', assignments: syncPayloadForAssignments(missingAssignments) }
      : { source: 'all-missing' }
  });
}

async function fetchOrderEmailAssignments() {
  const { data: invoices, error: invoiceError } = await supabase
    .from(INVOICE_TABLE)
    .select('invoice_no, customer_name, customer_email, quantity, payment_status, created_at')
    .eq('payment_status', 'COMPLETE')
    .gt('quantity', 1)
    .order('created_at', { ascending: false });

  if (invoiceError) throw new Error(invoiceError.message || 'Could not load successful purchaser emails.');

  const invoiceRows = (invoices || []).filter(row => row.invoice_no);
  if (!invoiceRows.length) return [];

  const customerEmailByInvoice = new Map(invoiceRows.map(row => [
    row.invoice_no,
    normalizeEmail(row.customer_email)
  ]));

  const { data, error } = await supabase
    .from(ORDER_EMAILS_TABLE)
    .select('invoice_no, purchaser_email, card_index, card_name, card_email, is_purchaser')
    .in('invoice_no', invoiceRows.map(row => row.invoice_no))
    .order('invoice_no', { ascending: true })
    .order('card_index', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load assigned order emails.');

  const merged = new Map();
  invoiceRows.forEach(row => {
    const customerEmail = customerEmailByInvoice.get(row.invoice_no) || '';
    if (!customerEmail) return;
    merged.set(`${row.invoice_no}:1`, {
      source: 'purchase',
      invoice_no: row.invoice_no,
      customer_email: customerEmail,
      purchaser_email: customerEmail,
      card_index: 1,
      card_name: row.customer_name || '',
      card_email: customerEmail,
      is_purchaser: true
    });
  });

  (data || []).forEach(row => {
    const cardEmail = normalizeEmail(row.card_email);
    if (!row.invoice_no || !cardEmail) return;
    merged.set(`${row.invoice_no}:${row.card_index}`, {
      source: 'purchase',
      ...row,
      card_email: cardEmail,
      card_name: row.card_name || '',
      customer_email: customerEmailByInvoice.get(row.invoice_no) || '',
      purchaser_email: normalizeEmail(row.purchaser_email || customerEmailByInvoice.get(row.invoice_no))
    });
  });

  return Array.from(merged.values());
}

async function fetchManualEmailAssignments() {
  const { data: allocations, error: allocationError } = await supabase
    .from(MANUAL_ALLOCATIONS_TABLE)
    .select('id, profile_id, quantity, quote_reference, account_email, account_name')
    .gt('quantity', 0)
    .order('updated_at', { ascending: false });

  if (allocationError) throw new Error(allocationError.message || 'Could not load manual allocations.');

  const allocationRows = (allocations || []).filter(row => row.id && row.profile_id);
  if (!allocationRows.length) return [];

  const allocationsById = new Map(allocationRows.map(row => [row.id, row]));
  const merged = new Map();

  allocationRows.forEach(row => {
    const purchaserEmail = normalizeEmail(row.account_email);
    if (!purchaserEmail) return;
    merged.set(`${row.id}:1`, {
      source: 'manual',
      allocation_id: row.id,
      quote_reference: row.quote_reference || '',
      purchaser_profile_id: row.profile_id,
      purchaser_email: purchaserEmail,
      card_index: 1,
      card_name: row.account_name || '',
      card_email: purchaserEmail,
      is_purchaser: true
    });
  });

  const { data, error } = await supabase
    .from(MANUAL_CARD_EMAILS_TABLE)
    .select('allocation_id, purchaser_profile_id, purchaser_email, card_index, card_name, card_email, is_purchaser')
    .in('allocation_id', allocationRows.map(row => row.id))
    .order('allocation_id', { ascending: true })
    .order('card_index', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load manual cardholder emails.');

  (data || []).forEach(row => {
    const allocation = allocationsById.get(row.allocation_id);
    const cardIndex = Number(row.card_index);
    const cardEmail = normalizeEmail(row.card_email);
    if (!allocation || !cardEmail || !Number.isFinite(cardIndex) || cardIndex < 1 || cardIndex > Number(allocation.quantity || 0)) return;
    merged.set(`${row.allocation_id}:${row.card_index}`, {
      source: 'manual',
      allocation_id: row.allocation_id,
      quote_reference: allocation.quote_reference || '',
      purchaser_profile_id: row.purchaser_profile_id || allocation.profile_id,
      purchaser_email: normalizeEmail(row.purchaser_email || allocation.account_email),
      card_index: row.card_index,
      card_name: row.card_name || '',
      card_email: cardEmail,
      is_purchaser: !!row.is_purchaser
    });
  });

  return Array.from(merged.values());
}

async function fetchInvoiceRows() {
  const { data, error } = await supabase
    .from(INVOICE_TABLE)
    .select('invoice_no, customer_name, customer_title, customer_email, customer_phone, quantity, card_configuration, custom_logo_requested, custom_logo_file_name, custom_logo_image, shipping_name, shipping_street, shipping_suburb, shipping_city, shipping_province, shipping_postal, payment_status, invoice_sent_to_client, card_lasered, order_shipped, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'Could not load invoices.');

  return (data || []).map(row => ({
    invoice_date: formatInvoiceDate(row.created_at),
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
    card_lasered: !!row.card_lasered,
    order_shipped: !!row.order_shipped
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
      let profileRows = await fetchProfileRows();
      const assignmentErrors = [];
      let purchaseAssignments = [];
      let manualAssignments = [];
      let reservedUrlsByEmail = new Map();
      let syncMessage = '';

      try {
        purchaseAssignments = await fetchOrderEmailAssignments();
      } catch (assignmentError) {
        assignmentErrors.push(assignmentError.message || 'Could not load assigned order emails.');
      }

      try {
        manualAssignments = await fetchManualEmailAssignments();
      } catch (assignmentError) {
        assignmentErrors.push(assignmentError.message || 'Could not load manual cardholder emails.');
      }

      orderEmailAssignmentsCache = [...purchaseAssignments, ...manualAssignments];
      try {
        reservedUrlsByEmail = await fetchReservedProfileUrls(orderEmailAssignmentsCache);
      } catch (reservationError) {
        assignmentErrors.push(reservationError.message || 'Could not load reserved cardholder URLs.');
      }

      const missingAssignments = missingProfileAssignments(profileRows, orderEmailAssignmentsCache, reservedUrlsByEmail);
      if (missingAssignments.length) {
        try {
          setStatus('Creating missing profile URLs...', 'loading');
          const syncData = await backfillMissingProfileUrls(missingAssignments);
          const syncedCount = countSyncedProfileUrls(syncData);
          const syncIssue = profileSyncIssueSummary(syncData);
          profileRows = await fetchProfileRows();
          reservedUrlsByEmail = await fetchReservedProfileUrls(orderEmailAssignmentsCache);
          if (syncedCount) {
            syncMessage = `Created or confirmed ${syncedCount} linked profile URL${syncedCount === 1 ? '' : 's'}.`;
          }
          if (syncIssue) {
            assignmentErrors.push(syncIssue);
          }
        } catch (syncError) {
          assignmentErrors.push(syncError.message || 'Could not create missing profile URLs.');
        }
      }

      profileRowsCache = attachOrderEmailsToProfiles(profileRows, orderEmailAssignmentsCache, reservedUrlsByEmail);
      applySearchFilter();
      setStatus(
        assignmentErrors.length ? assignmentErrors.join(' ') : (syncMessage || `Loaded ${profileRowsCache.length} URLs.`),
        assignmentErrors.length ? 'error' : 'success'
      );
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
    orderEmailAssignmentsCache = [];
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
  activeSession = await guardManagerAccess();
  if (!activeSession) return;
  await fetchAllRows();
})();
