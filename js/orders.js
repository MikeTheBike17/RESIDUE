import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cfg = window.env || {};
const INVOICE_TABLE = cfg.SUPABASE_INVOICES_TABLE || 'purchase_invoices';
const ORDER_EMAILS_TABLE = cfg.SUPABASE_ORDER_EMAILS_TABLE || 'order_card_emails';

const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
  ? null
  : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

const statusEl = document.getElementById('orders-status');
const ordersList = document.getElementById('orders-list');
const introModal = document.getElementById('orders-intro-modal');
const introContinue = document.getElementById('orders-intro-continue');

let activeSession = null;
let activeOrders = [];
let assignmentsByInvoice = new Map();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function setStatus(message, type = '') {
  if (!statusEl) return;
  statusEl.hidden = !message;
  statusEl.textContent = message;
  statusEl.className = 'status orders-status';
  if (type) statusEl.classList.add(type);
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
}

function formatCardType(order) {
  if (order.custom_logo_requested) return 'Custom company logo card';
  const config = Number(order.card_configuration);
  return Number.isInteger(config) && config > 0 ? `Residue Card Type ${config}` : 'Residue NFC card';
}

function cardCount(order) {
  const quantity = Math.trunc(Number(order.quantity) || 0);
  return Math.max(1, quantity);
}

function showIntroModal() {
  if (!introModal) return;
  introModal.classList.remove('hidden');
  introModal.setAttribute('aria-hidden', 'false');
}

function closeIntroModal() {
  if (!introModal) return;
  introModal.classList.add('hidden');
  introModal.setAttribute('aria-hidden', 'true');
}

function redirectToOrdersLogin() {
  window.location.href = 'residue-inside.html?auth=orders';
}

async function guardSession() {
  if (!supabase) {
    setStatus('Supabase is not configured.', 'error');
    return null;
  }

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    setStatus(error.message || 'Could not read your session.', 'error');
    return null;
  }

  if (!session?.user?.id) {
    redirectToOrdersLogin();
    return null;
  }

  return session;
}

async function fetchPaidOrders(userId) {
  const { data, error } = await supabase
    .from(INVOICE_TABLE)
    .select('invoice_no, customer_name, customer_email, quantity, card_configuration, custom_logo_requested, total_amount, payment_status, created_at')
    .eq('profile_id', userId)
    .eq('payment_status', 'COMPLETE')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message || 'Could not load your successful orders.');
  return data || [];
}

async function fetchEmailAssignments(invoiceNumbers) {
  if (!invoiceNumbers.length) return [];

  const { data, error } = await supabase
    .from(ORDER_EMAILS_TABLE)
    .select('invoice_no, purchaser_profile_id, purchaser_email, card_index, card_email, is_purchaser, updated_at')
    .in('invoice_no', invoiceNumbers)
    .order('card_index', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load saved cardholder emails.');
  return data || [];
}

function buildAssignmentsMap(rows) {
  const next = new Map();
  rows.forEach(row => {
    const invoiceNo = String(row.invoice_no || '').trim();
    const cardIndex = Math.trunc(Number(row.card_index) || 0);
    if (!invoiceNo || cardIndex < 1) return;
    if (!next.has(invoiceNo)) next.set(invoiceNo, new Map());
    next.get(invoiceNo).set(cardIndex, row);
  });
  return next;
}

function orderAssignment(order, cardIndex) {
  return assignmentsByInvoice.get(order.invoice_no)?.get(cardIndex) || null;
}

function makeOrderMeta(order) {
  const meta = document.createElement('div');
  meta.className = 'orders-card-meta';

  [
    `Invoice ${order.invoice_no || ''}`,
    `${cardCount(order)} card${cardCount(order) === 1 ? '' : 's'}`,
    formatCardType(order),
    formatDate(order.created_at)
  ].filter(Boolean).forEach(value => {
    const item = document.createElement('span');
    item.textContent = value;
    meta.appendChild(item);
  });

  return meta;
}

function makeEmailTable(order) {
  const count = cardCount(order);
  const purchaserEmail = normalizeEmail(order.customer_email || activeSession?.user?.email || '');
  const wrap = document.createElement('div');
  wrap.className = 'orders-table-wrap';

  const table = document.createElement('table');
  table.className = 'orders-email-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Card', 'Cardholder email', 'Status'].forEach(label => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let index = 1; index <= count; index += 1) {
    const row = document.createElement('tr');

    const cardTd = document.createElement('td');
    cardTd.textContent = `Card ${index}`;

    const emailTd = document.createElement('td');
    if (index === 1) {
      const locked = document.createElement('span');
      locked.className = 'orders-purchaser-email';
      locked.textContent = purchaserEmail;
      emailTd.appendChild(locked);
    } else {
      const input = document.createElement('input');
      input.type = 'email';
      input.inputMode = 'email';
      input.autocomplete = 'email';
      input.placeholder = `cardholder-${index}@example.com`;
      input.value = normalizeEmail(orderAssignment(order, index)?.card_email || '');
      input.dataset.orderEmailInput = 'true';
      input.dataset.invoiceNo = order.invoice_no || '';
      input.dataset.cardIndex = String(index);
      input.setAttribute('aria-label', `Email for card ${index} of order ${order.invoice_no}`);
      emailTd.appendChild(input);
    }

    const statusTd = document.createElement('td');
    statusTd.className = 'orders-row-status';
    statusTd.textContent = index === 1 ? 'Purchaser' : (normalizeEmail(orderAssignment(order, index)?.card_email) ? 'Assigned' : 'Open');

    row.append(cardTd, emailTd, statusTd);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderOrders() {
  if (!ordersList) return;

  if (!activeOrders.length) {
    ordersList.innerHTML = '<div class="orders-empty">No successful card purchases were found for this account.</div>';
    return;
  }

  ordersList.innerHTML = '';
  activeOrders.forEach(order => {
    const article = document.createElement('article');
    article.className = 'orders-card';
    article.dataset.invoiceNo = order.invoice_no || '';

    const header = document.createElement('div');
    header.className = 'orders-card-head';

    const copy = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'orders-card-label';
    label.textContent = 'Successful purchase';
    const title = document.createElement('h2');
    title.className = 'h3';
    title.textContent = order.customer_name ? `${order.customer_name}'s order` : 'Residue card order';
    copy.append(label, title, makeOrderMeta(order));

    header.appendChild(copy);

    const table = makeEmailTable(order);
    const actions = document.createElement('div');
    actions.className = 'orders-actions';

    const status = document.createElement('div');
    status.className = 'status orders-card-status';
    status.hidden = true;
    status.setAttribute('aria-live', 'polite');

    const save = document.createElement('button');
    save.className = 'btn orders-save-btn';
    save.type = 'button';
    save.textContent = 'Save Emails';
    save.addEventListener('click', () => saveOrderEmails(order, article, status, save));

    actions.append(status, save);
    article.append(header, table, actions);
    ordersList.appendChild(article);
  });

  focusRequestedInvoice();
}

function setCardStatus(el, message, type = '') {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message;
  el.className = 'status orders-card-status';
  if (type) el.classList.add(type);
}

function payloadForOrder(order, article) {
  const purchaserEmail = normalizeEmail(order.customer_email || activeSession?.user?.email || '');
  const payload = [{
    invoice_no: order.invoice_no,
    purchaser_profile_id: activeSession.user.id,
    purchaser_email: purchaserEmail,
    card_index: 1,
    card_email: purchaserEmail,
    is_purchaser: true,
    updated_at: new Date().toISOString()
  }];

  const inputs = Array.from(article.querySelectorAll('[data-order-email-input]'));
  for (const input of inputs) {
    const email = normalizeEmail(input.value);
    if (!isValidEmail(email)) {
      input.focus();
      throw new Error('Enter a valid email address before saving.');
    }

    payload.push({
      invoice_no: order.invoice_no,
      purchaser_profile_id: activeSession.user.id,
      purchaser_email: purchaserEmail,
      card_index: Math.trunc(Number(input.dataset.cardIndex) || 0),
      card_email: email,
      is_purchaser: false,
      updated_at: new Date().toISOString()
    });
  }

  return payload.filter(row => row.invoice_no && row.card_index > 0);
}

async function saveOrderEmails(order, article, status, saveButton) {
  try {
    const payload = payloadForOrder(order, article);
    saveButton.disabled = true;
    setCardStatus(status, 'Saving emails...', 'loading');

    const { data, error } = await supabase
      .from(ORDER_EMAILS_TABLE)
      .upsert(payload, { onConflict: 'invoice_no,card_index' })
      .select('invoice_no, purchaser_profile_id, purchaser_email, card_index, card_email, is_purchaser, updated_at');

    if (error) throw new Error(error.message || 'Could not save cardholder emails.');

    const savedRows = (data && data.length ? data : payload);
    const existing = assignmentsByInvoice.get(order.invoice_no) || new Map();
    savedRows.forEach(row => existing.set(Number(row.card_index), row));
    assignmentsByInvoice.set(order.invoice_no, existing);

    article.querySelectorAll('[data-order-email-input]').forEach(input => {
      const row = input.closest('tr');
      const statusCell = row?.querySelector('.orders-row-status');
      if (statusCell) statusCell.textContent = normalizeEmail(input.value) ? 'Assigned' : 'Open';
    });

    setCardStatus(status, 'Emails saved.', 'success');
  } catch (error) {
    setCardStatus(status, error.message || 'Could not save emails.', 'error');
  } finally {
    saveButton.disabled = false;
  }
}

function focusRequestedInvoice() {
  let invoice = '';
  try {
    invoice = new URLSearchParams(window.location.search).get('invoice') || '';
  } catch {
    invoice = '';
  }
  if (!invoice) return;

  const target = Array.from(ordersList?.querySelectorAll('.orders-card') || [])
    .find(card => card.dataset.invoiceNo === invoice);
  if (!target) return;
  target.classList.add('is-highlighted');
  window.setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}

async function loadOrders() {
  activeSession = await guardSession();
  if (!activeSession) return;

  setStatus('Loading your successful purchases...', 'loading');
  try {
    activeOrders = await fetchPaidOrders(activeSession.user.id);
    let assignments = [];
    let assignmentErrorMessage = '';

    try {
      assignments = await fetchEmailAssignments(activeOrders.map(order => order.invoice_no).filter(Boolean));
    } catch (error) {
      assignmentErrorMessage = error.message || 'Could not load saved cardholder emails.';
    }

    assignmentsByInvoice = buildAssignmentsMap(assignments);
    renderOrders();
    if (assignmentErrorMessage) {
      setStatus(assignmentErrorMessage, 'error');
    } else if (activeOrders.length) {
      setStatus(`Loaded ${activeOrders.length} successful purchase${activeOrders.length === 1 ? '' : 's'}.`, 'success');
    } else {
      setStatus('', '');
    }
  } catch (error) {
    activeOrders = [];
    assignmentsByInvoice = new Map();
    if (ordersList) {
      ordersList.innerHTML = '<div class="orders-empty">Could not load your orders.</div>';
    }
    setStatus(error.message || 'Could not load your orders.', 'error');
  }
}

introContinue?.addEventListener('click', closeIntroModal);
introModal?.addEventListener('click', event => {
  if (event.target === introModal) closeIntroModal();
});

document.addEventListener('DOMContentLoaded', () => {
  showIntroModal();
  loadOrders();
});
