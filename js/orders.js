import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  countSyncedProfileUrls,
  profileSyncIssueSummary,
  syncCardholderProfiles
} from './cardholder-profile-sync.js';

const cfg = window.env || {};
const INVOICE_TABLE = cfg.SUPABASE_INVOICES_TABLE || 'purchase_invoices';
const ORDER_EMAILS_TABLE = cfg.SUPABASE_ORDER_EMAILS_TABLE || 'order_card_emails';
const MANUAL_ALLOCATIONS_TABLE = cfg.SUPABASE_MANUAL_ALLOCATIONS_TABLE || 'manual_card_allocations';
const MANUAL_CARD_EMAILS_TABLE = cfg.SUPABASE_MANUAL_CARD_EMAILS_TABLE || 'manual_card_emails';

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
let assignmentsByOrderKey = new Map();

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
  if (isManualOrder(order)) return 'Admin-created card access';
  if (order.custom_logo_requested) return 'Custom company logo card';
  const config = Number(order.card_configuration);
  return Number.isInteger(config) && config > 0 ? `Residue Card Type ${config}` : 'Residue NFC card';
}

function cardCount(order) {
  const quantity = Math.trunc(Number(order.quantity) || 0);
  return Math.max(1, quantity);
}

function orderGroupKey(order) {
  if (order?.source === 'manual') {
    return order.allocation_id ? `manual:${order.allocation_id}` : '';
  }
  return order?.invoice_no ? `purchase:${order.invoice_no}` : '';
}

function assignmentGroupKey(row) {
  if (row?.allocation_id) return `manual:${row.allocation_id}`;
  return row?.invoice_no ? `purchase:${row.invoice_no}` : '';
}

function isManualOrder(order) {
  return order?.source === 'manual';
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
  return (data || []).map(row => ({ ...row, source: 'purchase' }));
}

async function fetchManualAllocations(userId) {
  const { data, error } = await supabase
    .from(MANUAL_ALLOCATIONS_TABLE)
    .select('id, profile_id, quantity, quote_reference, account_email, account_name, created_at, updated_at')
    .eq('profile_id', userId)
    .gt('quantity', 0)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message || 'Could not load your manual card access.');

  return (data || []).map(row => ({
    source: 'manual',
    allocation_id: row.id,
    profile_id: row.profile_id,
    quantity: row.quantity,
    quote_reference: row.quote_reference || '',
    customer_email: normalizeEmail(row.account_email || activeSession?.user?.email || ''),
    customer_name: String(row.account_name || '').trim(),
    card_configuration: null,
    custom_logo_requested: false,
    total_amount: null,
    payment_status: 'MANUAL',
    created_at: row.updated_at || row.created_at
  }));
}

async function fetchPurchaseEmailAssignments(invoiceNumbers) {
  if (!invoiceNumbers.length) return [];

  const { data, error } = await supabase
    .from(ORDER_EMAILS_TABLE)
    .select('invoice_no, purchaser_profile_id, purchaser_email, card_index, card_name, card_email, is_purchaser, updated_at')
    .in('invoice_no', invoiceNumbers)
    .order('card_index', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load saved cardholder emails.');
  return (data || []).map(row => ({ ...row, source: 'purchase' }));
}

async function fetchManualEmailAssignments(allocationIds) {
  if (!allocationIds.length) return [];

  const { data, error } = await supabase
    .from(MANUAL_CARD_EMAILS_TABLE)
    .select('allocation_id, purchaser_profile_id, purchaser_email, card_index, card_name, card_email, is_purchaser, updated_at')
    .in('allocation_id', allocationIds)
    .order('card_index', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load saved manual cardholder emails.');
  return (data || []).map(row => ({ ...row, source: 'manual' }));
}

function buildAssignmentsMap(rows) {
  const next = new Map();
  rows.forEach(row => {
    const groupKey = assignmentGroupKey(row);
    const cardIndex = Math.trunc(Number(row.card_index) || 0);
    if (!groupKey || cardIndex < 1) return;
    if (!next.has(groupKey)) next.set(groupKey, new Map());
    next.get(groupKey).set(cardIndex, row);
  });
  return next;
}

function orderAssignment(order, cardIndex) {
  return assignmentsByOrderKey.get(orderGroupKey(order))?.get(cardIndex) || null;
}

function makeOrderMeta(order) {
  const meta = document.createElement('div');
  meta.className = 'orders-card-meta';

  [
    isManualOrder(order)
      ? (order.quote_reference ? `Reference ${order.quote_reference}` : 'Manual allocation')
      : (order.invoice_no ? `Invoice ${order.invoice_no}` : ''),
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
  const purchaserName = String(order.customer_name || '').trim();
  const orderLabel = isManualOrder(order)
    ? 'manual allocation'
    : `order ${order.invoice_no || ''}`.trim();
  const wrap = document.createElement('div');
  wrap.className = 'orders-table-wrap';

  const table = document.createElement('table');
  table.className = 'orders-email-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Card', 'Name', 'Cardholder email', 'Status'].forEach(label => {
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

    const nameTd = document.createElement('td');
    if (index === 1) {
      const locked = document.createElement('span');
      locked.className = 'orders-purchaser-name';
      locked.textContent = purchaserName || 'Purchaser';
      nameTd.appendChild(locked);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'name';
      input.placeholder = `Cardholder ${index}`;
      input.value = String(orderAssignment(order, index)?.card_name || '').trim();
      input.dataset.orderNameInput = 'true';
      input.dataset.invoiceNo = order.invoice_no || '';
      input.dataset.orderKey = orderGroupKey(order);
      input.dataset.cardIndex = String(index);
      input.setAttribute('aria-label', `Name for card ${index} of ${orderLabel}`);
      nameTd.appendChild(input);
    }

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
      input.dataset.orderKey = orderGroupKey(order);
      input.dataset.cardIndex = String(index);
      input.setAttribute('aria-label', `Email for card ${index} of ${orderLabel}`);
      emailTd.appendChild(input);
    }

    const statusTd = document.createElement('td');
    statusTd.className = 'orders-row-status';
    statusTd.textContent = index === 1 ? 'Purchaser' : (normalizeEmail(orderAssignment(order, index)?.card_email) ? 'Assigned' : 'Open');

    row.append(cardTd, nameTd, emailTd, statusTd);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderOrders() {
  if (!ordersList) return;

  if (!activeOrders.length) {
    ordersList.innerHTML = '<div class="orders-empty">No card purchases or manual card allocations were found for this account.</div>';
    return;
  }

  ordersList.innerHTML = '';
  activeOrders.forEach(order => {
    const article = document.createElement('article');
    article.className = 'orders-card';
    article.dataset.orderKey = orderGroupKey(order);
    article.dataset.invoiceNo = order.invoice_no || '';

    const header = document.createElement('div');
    header.className = 'orders-card-head';

    const copy = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'orders-card-label';
    label.textContent = isManualOrder(order) ? 'Manual allocation' : 'Successful purchase';
    const title = document.createElement('h2');
    title.className = 'h3';
    title.textContent = isManualOrder(order)
      ? (order.customer_name ? `${order.customer_name}'s access` : 'Residue card access')
      : (order.customer_name ? `${order.customer_name}'s order` : 'Residue card order');
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
  const sharedPurchaserFields = {
    purchaser_profile_id: activeSession.user.id,
    purchaser_email: purchaserEmail,
  };
  const sourceField = isManualOrder(order)
    ? { allocation_id: order.allocation_id }
    : { invoice_no: order.invoice_no };
  const payload = [{
    ...sourceField,
    ...sharedPurchaserFields,
    card_index: 1,
    card_name: String(order.customer_name || '').trim(),
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

    const cardIndex = Math.trunc(Number(input.dataset.cardIndex) || 0);
    const nameInput = article.querySelector(`[data-order-name-input][data-card-index="${cardIndex}"]`);

    payload.push({
      ...sourceField,
      ...sharedPurchaserFields,
      card_index: cardIndex,
      card_name: String(nameInput?.value || '').trim(),
      card_email: email,
      is_purchaser: false,
      updated_at: new Date().toISOString()
    });
  }

  return payload.filter(row => (
    (isManualOrder(order) ? row.allocation_id : row.invoice_no) &&
    row.card_index > 0
  ));
}

function syncPayloadForSavedRows(rows) {
  return (rows || []).map(row => ({
    source: row.allocation_id ? 'manual' : 'purchase',
    invoice_no: row.invoice_no || '',
    allocation_id: row.allocation_id || '',
    purchaser_profile_id: row.purchaser_profile_id || '',
    purchaser_email: row.purchaser_email || '',
    card_index: row.card_index || '',
    card_name: row.card_name || '',
    card_email: row.card_email || ''
  }));
}

async function syncProfilesForOrder(order, savedRows = []) {
  const payload = isManualOrder(order)
    ? {
        source: 'manual',
        allocation_id: order.allocation_id,
        cardholders: syncPayloadForSavedRows(savedRows)
      }
    : {
        source: 'purchase',
        invoice_no: order.invoice_no,
        cardholders: syncPayloadForSavedRows(savedRows)
      };
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id) activeSession = session;

  return syncCardholderProfiles({
    cfg,
    session: activeSession,
    payload
  });
}

async function saveOrderEmails(order, article, status, saveButton) {
  try {
    const payload = payloadForOrder(order, article);
    saveButton.disabled = true;
    setCardStatus(status, 'Saving emails...', 'loading');

    const { data, error } = await supabase
      .from(isManualOrder(order) ? MANUAL_CARD_EMAILS_TABLE : ORDER_EMAILS_TABLE)
      .upsert(payload, { onConflict: isManualOrder(order) ? 'allocation_id,card_index' : 'invoice_no,card_index' })
      .select(isManualOrder(order)
        ? 'allocation_id, purchaser_profile_id, purchaser_email, card_index, card_name, card_email, is_purchaser, updated_at'
        : 'invoice_no, purchaser_profile_id, purchaser_email, card_index, card_name, card_email, is_purchaser, updated_at');

    if (error) throw new Error(error.message || 'Could not save cardholder emails.');

    const savedRows = (data && data.length ? data : payload);
    const existing = assignmentsByOrderKey.get(orderGroupKey(order)) || new Map();
    savedRows.forEach(row => existing.set(Number(row.card_index), row));
    assignmentsByOrderKey.set(orderGroupKey(order), existing);

    article.querySelectorAll('[data-order-email-input]').forEach(input => {
      const row = input.closest('tr');
      const statusCell = row?.querySelector('.orders-row-status');
      if (statusCell) statusCell.textContent = normalizeEmail(input.value) ? 'Assigned' : 'Open';
    });

    try {
      const syncData = await syncProfilesForOrder(order, savedRows);
      const syncedCount = countSyncedProfileUrls(syncData);
      const syncIssue = profileSyncIssueSummary(syncData);
      if (syncIssue) {
        setCardStatus(status, `Emails saved, but ${syncIssue}`, 'error');
        return;
      }
      setCardStatus(
        status,
        syncedCount
          ? `Emails saved. Profile URLs ready for ${syncedCount} card${syncedCount === 1 ? '' : 's'}.`
          : 'Emails saved.',
        'success'
      );
    } catch (syncError) {
      setCardStatus(
        status,
        `Emails saved, but profile URLs could not be created: ${syncError.message || 'sync failed'}`,
        'error'
      );
    }
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

  setStatus('Loading your card access...', 'loading');
  try {
    const loadErrors = [];
    const assignmentErrors = [];
    let paidOrders = [];
    let manualOrders = [];
    let purchaseAssignments = [];
    let manualAssignments = [];

    try {
      paidOrders = await fetchPaidOrders(activeSession.user.id);
    } catch (error) {
      loadErrors.push(error.message || 'Could not load your successful orders.');
    }

    try {
      manualOrders = await fetchManualAllocations(activeSession.user.id);
    } catch (error) {
      loadErrors.push(error.message || 'Could not load your manual card access.');
    }

    activeOrders = [...paidOrders, ...manualOrders]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    if (!activeOrders.length && loadErrors.length) {
      throw new Error(loadErrors.join(' '));
    }

    try {
      purchaseAssignments = await fetchPurchaseEmailAssignments(
        paidOrders.map(order => order.invoice_no).filter(Boolean)
      );
    } catch (error) {
      assignmentErrors.push(error.message || 'Could not load saved cardholder emails.');
    }

    try {
      manualAssignments = await fetchManualEmailAssignments(
        manualOrders.map(order => order.allocation_id).filter(Boolean)
      );
    } catch (error) {
      assignmentErrors.push(error.message || 'Could not load saved manual cardholder emails.');
    }

    assignmentsByOrderKey = buildAssignmentsMap([...purchaseAssignments, ...manualAssignments]);
    renderOrders();
    const statusMessages = [...loadErrors, ...assignmentErrors];
    if (statusMessages.length) {
      setStatus(statusMessages.join(' '), 'error');
    } else {
      setStatus('', '');
    }
  } catch (error) {
    activeOrders = [];
    assignmentsByOrderKey = new Map();
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
