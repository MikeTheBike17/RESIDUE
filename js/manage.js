import {
  cfg,
  guardManagerAccess,
  normalizeEmail,
  normalizeSearchTerm,
  supabase
} from './admin-access.js';

const MANUAL_ALLOCATIONS_TABLE = cfg.SUPABASE_MANUAL_ALLOCATIONS_TABLE || 'manual_card_allocations';

const statusEl = document.getElementById('manage-status');
const refreshBtn = document.getElementById('manage-refresh');
const searchInput = document.getElementById('manager-search');
const usersBody = document.getElementById('manage-users-body');
const form = document.getElementById('manage-form');
const emptySelection = document.getElementById('manage-empty-selection');
const selectedName = document.getElementById('manage-selected-name');
const selectedEmail = document.getElementById('manage-selected-email');
const quantityInput = document.getElementById('manual-quantity');
const quoteReferenceInput = document.getElementById('quote-reference');
const adminNoteInput = document.getElementById('admin-note');
const saveBtn = document.getElementById('manage-save');

let activeSession = null;
let profileRowsCache = [];
let selectedProfileId = '';

function setStatus(message, type = '') {
  if (!statusEl) return;
  statusEl.hidden = !message;
  statusEl.textContent = message;
  statusEl.className = 'status';
  if (type) statusEl.classList.add(type);
}

function getActiveSearchTerm() {
  return normalizeSearchTerm(searchInput?.value);
}

function selectedProfile() {
  return profileRowsCache.find(row => row.id === selectedProfileId) || null;
}

function allocationFor(row) {
  return row?.allocation || null;
}

function filterRows(rows, query) {
  if (!query) return rows;
  return rows.filter(row => (
    normalizeSearchTerm(row.name).includes(query) ||
    normalizeSearchTerm(row.auth_email).includes(query) ||
    normalizeSearchTerm(allocationFor(row)?.quote_reference).includes(query)
  ));
}

function renderRows(rows, emptyMessage = 'No accounts found.') {
  if (!usersBody) return;
  if (!rows.length) {
    usersBody.innerHTML = `<tr><td colspan="5" class="card-urls-empty">${emptyMessage}</td></tr>`;
    return;
  }

  usersBody.innerHTML = '';
  rows.forEach(row => {
    const allocation = allocationFor(row);
    const tr = document.createElement('tr');
    tr.className = row.id === selectedProfileId ? 'is-selected' : '';

    const nameTd = document.createElement('td');
    nameTd.textContent = row.name || 'Name not set';

    const emailTd = document.createElement('td');
    emailTd.className = 'card-urls-inline-text';
    emailTd.textContent = row.auth_email || '';

    const quantityTd = document.createElement('td');
    quantityTd.textContent = String(allocation?.quantity ?? 0);

    const referenceTd = document.createElement('td');
    referenceTd.textContent = allocation?.quote_reference || '-';

    const actionTd = document.createElement('td');
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'card-urls-download-btn manage-select-btn';
    selectBtn.textContent = row.id === selectedProfileId ? 'Selected' : 'Select';
    selectBtn.addEventListener('click', () => selectAccount(row.id));
    actionTd.appendChild(selectBtn);

    tr.append(nameTd, emailTd, quantityTd, referenceTd, actionTd);
    usersBody.appendChild(tr);
  });
}

function applySearchFilter() {
  const query = getActiveSearchTerm();
  renderRows(
    filterRows(profileRowsCache, query),
    query ? 'No accounts match this search.' : 'No accounts found.'
  );
}

function selectAccount(profileId) {
  selectedProfileId = profileId;
  const profile = selectedProfile();
  const allocation = allocationFor(profile);

  if (form) form.hidden = !profile;
  if (emptySelection) emptySelection.hidden = !!profile;
  if (!profile) return;

  if (selectedName) selectedName.textContent = profile.name || 'Name not set';
  if (selectedEmail) selectedEmail.textContent = profile.auth_email || '';
  if (quantityInput) quantityInput.value = String(allocation?.quantity ?? 0);
  if (quoteReferenceInput) quoteReferenceInput.value = allocation?.quote_reference || '';
  if (adminNoteInput) adminNoteInput.value = allocation?.admin_note || '';

  applySearchFilter();
}

async function fetchProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, auth_email, name, slug')
    .not('auth_email', 'is', null)
    .order('auth_email', { ascending: true });

  if (error) throw new Error(error.message || 'Could not load accounts.');
  return (data || []).filter(row => row.id && row.auth_email);
}

async function fetchManualAllocations() {
  const { data, error } = await supabase
    .from(MANUAL_ALLOCATIONS_TABLE)
    .select('id, profile_id, quantity, quote_reference, admin_note, account_email, account_name, created_by_email, updated_by_email, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(error.message || 'Could not load manual allocations.');
  return data || [];
}

function mergeProfilesAndAllocations(profiles, allocations) {
  const allocationsByProfile = new Map((allocations || []).map(row => [row.profile_id, row]));
  return profiles.map(profile => ({
    ...profile,
    auth_email: normalizeEmail(profile.auth_email),
    name: String(profile.name || '').trim(),
    allocation: allocationsByProfile.get(profile.id) || null
  }));
}

async function fetchAllRows() {
  if (!supabase) {
    setStatus('Supabase is not configured.', 'error');
    return;
  }

  setStatus('Refreshing accounts...', 'loading');
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const [profiles, allocations] = await Promise.all([
      fetchProfiles(),
      fetchManualAllocations()
    ]);
    profileRowsCache = mergeProfilesAndAllocations(profiles, allocations);
    if (selectedProfileId && !selectedProfile()) selectedProfileId = '';
    applySearchFilter();
    selectAccount(selectedProfileId);
    setStatus(`Loaded ${profileRowsCache.length} accounts.`, 'success');
  } catch (error) {
    profileRowsCache = [];
    selectedProfileId = '';
    renderRows([]);
    selectAccount('');
    setStatus(error.message || 'Could not load manual access data.', 'error');
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function readQuantity() {
  const raw = Number.parseInt(quantityInput?.value || '0', 10);
  if (!Number.isFinite(raw) || raw < 0) {
    throw new Error('Quantity must be 0 or higher.');
  }
  if (raw > 999) {
    throw new Error('Quantity must be 999 or lower.');
  }
  return raw;
}

async function saveSelectedAllocation(event) {
  event.preventDefault();
  const profile = selectedProfile();
  if (!profile?.id) {
    setStatus('Select an account before saving.', 'error');
    return;
  }

  let quantity = 0;
  try {
    quantity = readQuantity();
  } catch (error) {
    setStatus(error.message, 'error');
    quantityInput?.focus();
    return;
  }

  const managerEmail = normalizeEmail(activeSession?.user?.email);
  const existing = allocationFor(profile);
  const payload = {
    profile_id: profile.id,
    quantity,
    quote_reference: String(quoteReferenceInput?.value || '').trim(),
    admin_note: String(adminNoteInput?.value || '').trim(),
    account_email: normalizeEmail(profile.auth_email),
    account_name: String(profile.name || '').trim(),
    created_by_email: existing?.created_by_email || managerEmail,
    updated_by_email: managerEmail,
    updated_at: new Date().toISOString()
  };

  if (!existing?.id) payload.created_at = new Date().toISOString();

  if (saveBtn) saveBtn.disabled = true;
  setStatus('Saving manual allocation...', 'loading');

  try {
    const { data, error } = await supabase
      .from(MANUAL_ALLOCATIONS_TABLE)
      .upsert(payload, { onConflict: 'profile_id' })
      .select('id, profile_id, quantity, quote_reference, admin_note, account_email, account_name, created_by_email, updated_by_email, created_at, updated_at')
      .single();

    if (error) throw new Error(error.message || 'Could not save manual allocation.');

    profile.allocation = data;
    applySearchFilter();
    selectAccount(profile.id);
    setStatus(
      quantity > 0
        ? `Manual allocation saved for ${quantity} card${quantity === 1 ? '' : 's'}.`
        : 'Manual allocation saved. Quantity 0 hides it from Orders.',
      'success'
    );
  } catch (error) {
    setStatus(error.message || 'Could not save manual allocation.', 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

refreshBtn?.addEventListener('click', fetchAllRows);
searchInput?.addEventListener('input', applySearchFilter);
form?.addEventListener('submit', saveSelectedAllocation);

(async () => {
  activeSession = await guardManagerAccess();
  if (!activeSession) return;
  await fetchAllRows();
})();
