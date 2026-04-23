// Module version of the link app
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { residueTelemetry } from './supabase-telemetry.js';

(async () => {
  const cfg = window.env || {};
  const isFileProtocol = window.location.protocol === 'file:';
  const qs = new URLSearchParams(window.location.search);

  const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
    ? null
    : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

  const setTheme = theme => document.body.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  const setAuthOnly = flag => {
    if (flag) document.body.classList.add('auth-only');
    else document.body.classList.remove('auth-only');
  };

  /* Invite code helpers */
  const makeCode = () => {
    const n = Math.floor(Math.random() * 9000) + 1000;
    return `R-${n}`;
  };

  async function fetchOrCreateCode(userId) {
    if (!supabase || !userId) return null;
    // try existing
    const { data: existing } = await supabase.from('codes').select('*').eq('owner_profile', userId).limit(1).maybeSingle();
    if (existing) return existing;
    // create new code server-side via RPC for atomicity
    const { data, error } = await supabase.rpc('create_code_for_user', { p_owner: userId });
    if (!error && data) return data;
    console.warn('RPC create_code_for_user missing; falling back to client insert', error);
    const code = makeCode();
    const { data: inserted, error: insErr } = await supabase.from('codes').insert({ code, owner_profile: userId, max_uses: 5, used_count: 0, active: true }).select('*').single();
    if (insErr) {
      console.error('insert code failed', insErr);
      return null;
    }
    return inserted;
  }

  function renderCodePanel(codeRow) {
    const block = document.getElementById('lt-code-block');
    if (!block) return;
    if (!codeRow) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    const usesEl = document.getElementById('lt-code-uses');
    const valEl = document.getElementById('lt-code-value');
    if (valEl) valEl.textContent = codeRow.code;
    if (usesEl) usesEl.textContent = `${codeRow.used_count || 0} / ${codeRow.max_uses || 5} uses`;
  }

  /* Public profile rendering */
  async function renderPublicProfile() {
    const slug = qs.get('u');
    const isPreview = qs.get('preview') === '1';
    const overlay = document.getElementById('lt-overlay');
    const finishOverlay = () => overlay?.classList.remove('active');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.classList.add('active');
    }
    const localFallback = loadLocalProfile(slug);
    if (isPreview && localFallback) {
      const { meta, normalLinks } = extractMetaFromLinks(localFallback.links || []);
      fillPublic(localFallback.profile || {}, meta);
      renderLinks('lt-links', normalLinks || []);
      setupContactDownload(localFallback.profile || {}, normalLinks || []);
      setupVirtualCard(localFallback.profile || {});
      finishOverlay();
      if (overlay) setTimeout(() => { overlay.style.display = 'none'; }, 220);
      return;
    }

    if (isFileProtocol || !supabase) {
      if (localFallback) {
        const { meta, normalLinks } = extractMetaFromLinks(localFallback.links || []);
        fillPublic(localFallback.profile || {}, meta);
        renderLinks('lt-links', normalLinks || []);
        setupContactDownload(localFallback.profile || {}, normalLinks || []);
        setupVirtualCard(localFallback.profile || {});
      } else {
        showPlaceholder('Run via http:// (not file://) or add data first.');
      }
      finishOverlay();
      return;
    }
    if (!slug) {
      showPlaceholder('No profile yet. Tap manage to add yours.');
      finishOverlay();
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('slug', slug).maybeSingle();
    let profile = data;
    if (error || !data) {
      profile = localFallback?.profile;
      if (!profile) {
        showPlaceholder('Profile not found. Tap manage to create it.');
        finishOverlay();
        return;
      }
    }
    const { data: linksData } = profile?.id
      ? await supabase.from('links').select('*').eq('profile_id', profile.id).order('sort', { ascending: true })
      : { data: [] };
    const links = (linksData && linksData.length ? linksData : (localFallback?.links || []));
    const { meta, normalLinks } = extractMetaFromLinks(links || []);
    const hydratedLinks = (normalLinks || []).map(l => ({ ...l, hidden: parseBool(meta[`hidden_${l.sort}`], false) }));
    fillPublic(profile || {}, meta);
    renderLinks('lt-links', hydratedLinks || []);
    setupContactDownload(profile || {}, hydratedLinks || []);
    setupVirtualCard(profile || {});
    finishOverlay();
    if (overlay) setTimeout(() => { overlay.style.display = 'none'; }, 220);
  }

  function fillPublic(profile, meta = {}) {
    setTheme(profile.theme || 'light');
    const includeCompanyName = parseBool(meta.show_company_name, false);
    const includeCompanyBio = parseBool(meta.show_company_bio, false);
    const includeCompanyLogo = parseBool(meta.show_company_logo, false);
    setText('lt-company-name', includeCompanyName ? (meta.company_name || '') : '');
    setText('lt-company-bio', includeCompanyBio ? (meta.company_bio || '') : '');
    setPublicCompanyLogo(includeCompanyLogo ? (meta.company_logo_url || '') : '');
    setText('lt-name', deriveDisplayName(profile?.name, null));
    const includeRole = parseBool(meta.show_role, false);
    const includeBio = parseBool(meta.show_bio, false);
    setText('lt-title', includeRole ? (profile.title || '') : '');
    setText('lt-bio', includeBio ? (profile.bio || '') : '');
    const avatar = document.getElementById('lt-avatar');
    if (avatar) avatar.src = profile.avatar_url || 'https://placehold.co/200x200?text=Add+photo';
  }

  function showPlaceholder(message) {
    setTheme('light');
    setText('lt-company-name', '');
    setText('lt-company-bio', '');
    setPublicCompanyLogo('');
    setText('lt-name', 'Your name');
    setText('lt-title', 'Your title');
    setText('lt-bio', 'Add a short description.');
    const avatar = document.getElementById('lt-avatar');
    if (avatar) avatar.src = 'https://placehold.co/200x200?text=Add+photo';
    renderLinks('lt-links', []);
    setupContactDownload({}, []);
    setupVirtualCard({});
    showStatus('lt-status', message || '');
  }

  /* Admin */
  const USERS_KEY = 'residue_users';
  const CURRENT_USER_KEY = 'residue_current_user';
  const LOCAL_PROFILE_KEY_PREFIX = 'residue_link_profile_';
  const META_PREFIX = '__meta__';
  const BIO_MAX_CHARS = 180;
  const WHATSAPP_MESSAGE_MAX_CHARS = 180;
  const AUTOSAVE_DELAY_MS = 900;
  let authStateSubscription = null;
  const contactDownloadState = { name: '', phone: '' };
  const walletCardState = { name: '', slug: '' };
  let contactDownloadBound = false;
  let walletCardBound = false;
  let editorActionsBound = false;
  let isFillingEditor = false;
  let autosaveTimer = null;
  let autosaveInFlight = false;
  let autosaveQueued = false;
  let persistQueue = Promise.resolve();
  const DEFAULT_PROFILE_NAME = 'Your name';
  const socialConfig = [
    { id: 'social', label: 'LinkedIn', toggle: 'show-social' },
    { id: 'social-2', label: 'Instagram', toggle: 'show-social-2' },
    { id: 'social-3', label: 'WhatsApp Social', toggle: 'show-social-3' },
    { id: 'social-4', label: 'YouTube', toggle: 'show-social-4' },
    { id: 'social-5', label: 'Facebook', toggle: 'show-social-5' },
    { id: 'social-6', label: 'X', toggle: 'show-social-6' },
    { id: 'social-7', label: 'Pinterest', toggle: 'show-social-7' },
    { id: 'social-8', label: 'TikTok', toggle: 'show-social-8' }
  ];

  function showAdminLoader() {
    const overlay = document.getElementById('lt-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.classList.remove('hide');
    overlay.classList.add('active');
  }

  function hideAdminLoader() {
    const overlay = document.getElementById('lt-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    overlay.classList.add('hide');
    setTimeout(() => { overlay.style.display = 'none'; }, 240);
  }

  function normalizeCoordinates(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    let lat = null;
    let lng = null;

    if (match) {
      lat = Number(match[1]);
      lng = Number(match[2]);
    } else {
      const dmsMatches = [...value.matchAll(/(\d{1,3})\s*°\s*(\d{1,2})\s*['’]\s*(\d{1,2}(?:\.\d+)?)\s*["”]?\s*([NSEW])/gi)];
      if (dmsMatches.length === 2) {
        const dmsToDecimal = ([, degRaw, minRaw, secRaw, dirRaw]) => {
          const degrees = Number(degRaw);
          const minutes = Number(minRaw);
          const seconds = Number(secRaw);
          const direction = String(dirRaw || '').toUpperCase();
          if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
          if (minutes >= 60 || seconds >= 60) return null;
          let decimal = degrees + minutes / 60 + seconds / 3600;
          if (direction === 'S' || direction === 'W') decimal *= -1;
          return decimal;
        };

        const firstDir = dmsMatches[0][4].toUpperCase();
        const secondDir = dmsMatches[1][4].toUpperCase();
        const firstValue = dmsToDecimal(dmsMatches[0]);
        const secondValue = dmsToDecimal(dmsMatches[1]);

        if (firstValue != null && secondValue != null) {
          if ('NS'.includes(firstDir) && 'EW'.includes(secondDir)) {
            lat = firstValue;
            lng = secondValue;
          } else if ('EW'.includes(firstDir) && 'NS'.includes(secondDir)) {
            lng = firstValue;
            lat = secondValue;
          }
        }
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return '';
    return `${lat},${lng}`;
  }

  function buildLocationUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    const coords = normalizeCoordinates(raw);
    return `https://www.google.com/maps?q=${encodeURIComponent(coords || value)}`;
  }

  function extractLocationFromUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    const direct = normalizeCoordinates(value);
    if (direct) return direct;
    try {
      const url = new URL(value);
      const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
      const queryCoords = normalizeCoordinates(query);
      if (queryCoords) return queryCoords;
      if (query) return query;
      const atMatch = decodeURIComponent(url.href).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (atMatch) return normalizeCoordinates(`${atMatch[1]},${atMatch[2]}`);
    } catch {}
    return value;
  }

  function isEmailLike(value) {
    return /@/.test(String(value || '').trim());
  }

  const parseBool = (val, fallback = true) => {
    if (val == null) return fallback;
    const s = String(val).toLowerCase();
    return !(s === '0' || s === 'false' || s === 'no' || s === 'off');
  };

  function extractVisiblePhone(links = []) {
    const callLink = (links || []).find(link => {
      const url = String(link?.url || '');
      const label = String(link?.label || '').toLowerCase();
      return !link?.hidden && (label === 'call' || /^tel:/i.test(url));
    });
    return callLink ? String(callLink.url || '').replace(/^tel:/i, '').trim() : '';
  }

  function escapeVCardValue(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function openContactModal() {
    const modal = document.getElementById('lt-contact-consent');
    if (modal) modal.hidden = false;
  }

  function closeContactModal() {
    const modal = document.getElementById('lt-contact-consent');
    if (modal) modal.hidden = true;
  }

  function downloadContactVcf() {
    const name = contactDownloadState.name || 'Residue Contact';
    const phone = contactDownloadState.phone || '';
    if (!phone) {
      showStatus('lt-status', 'Phone number is not available for download.');
      return;
    }
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${escapeVCardValue(name)}`,
      `TEL;TYPE=CELL:${escapeVCardValue(phone)}`,
      'END:VCARD'
    ].join('\r\n');
    const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(name) || 'contact'}.vcf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showStatus('lt-status', 'Contact downloaded.');
  }

  function bindContactDownloadOnce() {
    if (contactDownloadBound) return;
    const saveBtn = document.getElementById('lt-save-contact-btn');
    const agreeBtn = document.getElementById('lt-contact-agree');
    const disagreeBtn = document.getElementById('lt-contact-disagree');
    const backdrop = document.getElementById('lt-contact-backdrop');

    saveBtn?.addEventListener('click', () => {
      if (!contactDownloadState.phone) {
        showStatus('lt-status', 'Phone number is not available for download.');
        return;
      }
      openContactModal();
    });
    agreeBtn?.addEventListener('click', () => {
      closeContactModal();
      downloadContactVcf();
    });
    disagreeBtn?.addEventListener('click', closeContactModal);
    backdrop?.addEventListener('click', closeContactModal);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeContactModal();
    });
    contactDownloadBound = true;
  }

  function setupContactDownload(profile = {}, links = []) {
    bindContactDownloadOnce();
    const saveBtn = document.getElementById('lt-save-contact-btn');
    const consentMsg = document.getElementById('lt-contact-message');
    const name = (profile?.name || '').trim();
    const phone = extractVisiblePhone(links);
    contactDownloadState.name = name;
    contactDownloadState.phone = phone;
    if (saveBtn) saveBtn.disabled = !name || !phone;
    if (consentMsg) {
      consentMsg.textContent = 'You are requesting to save contact details to your device. Do you agree to continue?';
    }
  }

  function openWalletModal() {
    const modal = document.getElementById('lt-wallet-modal');
    if (modal) modal.hidden = false;
  }

  function closeWalletModal() {
    const modal = document.getElementById('lt-wallet-modal');
    if (modal) modal.hidden = true;
  }

  function buildWalletFunctionUrl(fnName) {
    const base = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    return `${base}/functions/v1/${fnName}`;
  }

  function setWalletMessage(message) {
    const walletMsg = document.getElementById('lt-wallet-message');
    if (walletMsg && message) walletMsg.textContent = message;
  }

  async function requestVirtualCard(platform) {
    const slug = String(walletCardState.slug || '').trim().toLowerCase();
    const name = String(walletCardState.name || '').trim();
    if (!slug) {
      showStatus('lt-status', 'Profile link is not ready yet.');
      setWalletMessage('Profile link is not ready yet.');
      return false;
    }
    const endpoint = buildWalletFunctionUrl('wallet-pass');
    if (!endpoint) {
      showStatus('lt-status', 'Wallet service is unavailable in this environment.');
      setWalletMessage('Wallet service is unavailable in this environment.');
      return false;
    }

    showStatus('lt-status', 'Preparing virtual card...');
    setWalletMessage('Preparing virtual card...');
    const headers = { 'content-type': 'application/json' };
    if (cfg.SUPABASE_ANON_KEY) {
      headers.apikey = cfg.SUPABASE_ANON_KEY;
      headers.Authorization = `Bearer ${cfg.SUPABASE_ANON_KEY}`;
    }
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug, name, platform })
      });
    } catch (error) {
      const detail = error?.message || 'Could not reach wallet service.';
      showStatus('lt-status', detail);
      setWalletMessage(detail);
      return false;
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {}

    if (!res.ok) {
      const detail = payload?.error || payload?.detail || 'Failed to generate virtual card.';
      showStatus('lt-status', detail);
      setWalletMessage(detail);
      return false;
    }

    if (platform === 'apple') {
      if (payload?.notReady || payload?.appleReady === false) {
        const detail = payload?.detail || 'Apple Wallet is not configured yet.';
        showStatus('lt-status', detail);
        setWalletMessage(detail);
        return false;
      }
      if (payload?.applePassUrl) {
        window.location.href = payload.applePassUrl;
        return true;
      }
    }

    if (platform === 'google' && payload?.googleSaveUrl) {
      window.location.href = payload.googleSaveUrl;
      return true;
    }
    if (platform === 'google' && (payload?.notReady || payload?.googleReady === false)) {
      const detail = payload?.detail || 'Google Wallet is not configured yet.';
      showStatus('lt-status', detail);
      setWalletMessage(detail);
      return false;
    }

    showStatus('lt-status', 'Virtual card generated, but no wallet link was returned.');
    setWalletMessage('Virtual card generated, but no wallet link was returned.');
    return false;
  }

  function bindVirtualCardOnce() {
    if (walletCardBound) return;
    const virtualBtn = document.getElementById('lt-virtual-card-btn');
    const appleBtn = document.getElementById('lt-wallet-apple');
    const googleBtn = document.getElementById('lt-wallet-google');
    const cancelBtn = document.getElementById('lt-wallet-cancel');
    const backdrop = document.getElementById('lt-wallet-backdrop');
    const withBusy = async fn => {
      const buttons = [appleBtn, googleBtn, cancelBtn].filter(Boolean);
      buttons.forEach(btn => { btn.disabled = true; });
      try {
        await fn();
      } finally {
        buttons.forEach(btn => { btn.disabled = false; });
      }
    };

    virtualBtn?.addEventListener('click', () => {
      if (!walletCardState.slug) {
        showStatus('lt-status', 'Profile link is not ready yet.');
        setWalletMessage('Profile link is not ready yet.');
        return;
      }
      openWalletModal();
    });
    appleBtn?.addEventListener('click', () => withBusy(async () => {
      const navigated = await requestVirtualCard('apple');
      if (navigated) closeWalletModal();
    }));
    googleBtn?.addEventListener('click', () => withBusy(async () => {
      const navigated = await requestVirtualCard('google');
      if (navigated) closeWalletModal();
    }));
    cancelBtn?.addEventListener('click', closeWalletModal);
    backdrop?.addEventListener('click', closeWalletModal);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeWalletModal();
    });
    walletCardBound = true;
  }

  function setupVirtualCard(profile = {}) {
    const virtualBtn = document.getElementById('lt-virtual-card-btn');
    const walletModal = document.getElementById('lt-wallet-modal');
    if (!virtualBtn || !walletModal) return;

    bindVirtualCardOnce();
    const walletMsg = document.getElementById('lt-wallet-message');
    const slug = String(profile?.slug || '').trim().toLowerCase();
    const name = String(profile?.name || '').trim();
    walletCardState.slug = slug;
    walletCardState.name = name;
    if (virtualBtn) virtualBtn.disabled = !slug;
    if (walletMsg) {
      walletMsg.textContent = slug
        ? `Choose your wallet type to save ${name || 'this'} virtual card.`
        : 'Profile link is not ready yet.';
    }
  }

  function extractMetaFromLinks(links) {
    const meta = {};
    const normalLinks = [];
    (links || []).forEach(link => {
      const label = (link.label || '').trim();
      if (label.startsWith(META_PREFIX)) {
        const key = label.slice(META_PREFIX.length);
        const rawUrl = (link.url || '').trim();
        const value = rawUrl.startsWith('meta:') ? decodeURIComponent(rawUrl.slice(5)) : rawUrl;
        meta[key] = value;
      } else {
        normalLinks.push(link);
      }
    });
    return { meta, normalLinks };
  }

  function hydrateStoredLinks(links) {
    const storedLinks = Array.isArray(links) ? links : [];
    const { meta } = extractMetaFromLinks(storedLinks);
    return storedLinks.map((link, index) => {
      const label = (link.label || '').trim();
      if (label.startsWith(META_PREFIX)) return link;
      const hiddenKey = `hidden_${link.sort ?? index}`;
      return {
        ...link,
        hidden: parseBool(meta[hiddenKey], parseBool(link.hidden, false))
      };
    });
  }

  const metaLink = (key, value, sort) => ({
    label: `${META_PREFIX}${key}`,
    url: `meta:${encodeURIComponent(String(value))}`,
    hidden: true,
    sort
  });

  const applyHiddenMeta = (links) => {
    const metaEntries = links.map((l, i) =>
      metaLink(`hidden_${l.sort ?? i}`, l.hidden ? '1' : '0', links.length + i)
    );
    return links.concat(metaEntries);
  };

  function inferLabel(url, fallback) {
    if (!url) return fallback || 'Link';
    const u = url.replace(/^mailto:/i, 'mailto:').replace(/^tel:/i, 'tel:');
    if (u.startsWith('mailto:')) return 'Email';
    if (u.startsWith('tel:')) return 'Call';
    try {
      const host = new URL(u.startsWith('http') ? u : `https://${u}`).hostname.toLowerCase();
      if (host.includes('linkedin')) return 'LinkedIn';
      if (host.includes('instagram')) return 'Instagram';
      if (host.includes('pinterest')) return 'Pinterest';
      if (host.includes('tiktok')) return 'TikTok';
      if (host.includes('whatsapp') || host.includes('wa.me')) return 'WhatsApp';
      if (host.includes('youtube')) return 'YouTube';
      if (host.includes('facebook')) return 'Facebook';
      if (host.includes('x.com') || host.includes('twitter')) return 'X';
      if (host.includes('google.') && host.includes('maps')) return 'Location';
      if (host.includes('maps.apple')) return 'Location';
      if (host.includes('residue')) return 'Residue';
      if (host.includes('spotify')) return 'Spotify';
      if (host.includes('apple')) return 'Apple';
    } catch {}
    return fallback || 'Link';
  }

  function getLocalUsers() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveLocalUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizeEmail(value) {
    return (value || '').trim().toLowerCase();
  }

  function readStoredCurrentUser() {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
    const email = normalizeEmail(raw);
    return email ? { email } : null;
  }

  function persistCurrentUser(user) {
    if (!user) {
      localStorage.removeItem(CURRENT_USER_KEY);
      return;
    }
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({
      id: user.id || null,
      email: normalizeEmail(user.email) || null
    }));
  }

  function slugify(value) {
    return (value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  const RESERVED_SLUGS = new Set(['preview-card', 'preview', 'card-preview']);
  function resolveSlug(rawSlug, fallbackSource = '') {
    const cleaned = slugify(rawSlug || '');
    if (!cleaned || RESERVED_SLUGS.has(cleaned)) {
      return slugify(fallbackSource || '');
    }
    return cleaned;
  }

const localProfileKey = slug => `${LOCAL_PROFILE_KEY_PREFIX}${(slug || '').toLowerCase()}`;

async function ensureLocalDraftForUser(user) {
  if (!user?.email) return;
  const email = normalizeEmail(user.email);
  const slug = await ensureUniqueSlug(resolveSlug(email.split('@')[0], email), {
    excludeId: user.id || null,
    fallbackSlug: 'card',
    supabaseClient: null
  });
  const key = localProfileKey(slug);
  const existing = localStorage.getItem(key);
  if (existing) {
    localStorage.setItem('residue_link_last_profile_key', key);
    return;
  }
  const profile = {
    id: user.id || null,
    name: DEFAULT_PROFILE_NAME,
    title: '',
    bio: '',
    avatar_url: '',
    theme: 'light',
    slug,
    links: [
      { label: 'Call', url: 'tel:+', sort: 1, hidden: true },
      { label: 'Email', url: `mailto:${email}`, sort: 2, hidden: false }
    ]
  };
  localStorage.setItem(key, JSON.stringify(profile));
  localStorage.setItem('residue_link_last_profile_key', key);
}

  function getStoredLocalProfiles() {
    return Object.keys(localStorage)
      .filter(key => key.startsWith(LOCAL_PROFILE_KEY_PREFIX))
      .map(key => {
        try {
          return JSON.parse(localStorage.getItem(key) || 'null');
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async function ensureUniqueSlug(baseSlug, { excludeId = null, fallbackSlug = '', supabaseClient = supabase } = {}) {
    const base = resolveSlug(baseSlug, fallbackSlug) || fallbackSlug || 'card';
    const localProfiles = getStoredLocalProfiles();
    const hasLocalConflict = candidate => localProfiles.some(profile => {
      if (!profile?.slug) return false;
      if (excludeId && profile.id && profile.id === excludeId) return false;
      return profile.slug === candidate;
    });
    const hasRemoteConflict = async candidate => {
      if (!supabaseClient) return false;
      let query = supabaseClient.from('profiles').select('id').eq('slug', candidate).limit(1);
      if (excludeId) query = query.neq('id', excludeId);
      const { data, error } = await query;
      if (error) return false;
      return Array.isArray(data) && data.length > 0;
    };

    let candidate = base;
    let suffix = 2;
    while (hasLocalConflict(candidate) || await hasRemoteConflict(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function deriveDisplayName(profileName, user) {
    const fromProfile = String(profileName || '').trim();
    if (fromProfile) return fromProfile;
    const fromMeta = String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim();
    if (fromMeta && !isEmailLike(fromMeta)) return fromMeta;
    return DEFAULT_PROFILE_NAME;
  }

  function buildPublicProfileUrl(slug) {
    const normalizedSlug = resolveSlug(slug || '', '');
    const suffix = normalizedSlug || 'full-name';
    const profilePath = window.location.pathname
      .replace(/link-admin(?:\.html)?$/i, 'link-profile.html')
      .replace(/link-profile(?:\.html)?$/i, 'link-profile.html');
    return `${window.location.origin}${profilePath}?u=${suffix}`;
  }

  function buildAdminContextUrl(slug) {
    const url = new URL(window.location.href);
    const normalizedSlug = resolveSlug(slug || '', '');
    if (normalizedSlug) url.searchParams.set('u', normalizedSlug);
    else url.searchParams.delete('u');
    url.hash = '';
    return `${url.pathname}${url.search}`;
  }

  function buildAdminPageUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`;
  }

  function buildResetPasswordPageUrl() {
    return `${window.location.origin}/reset-password`;
  }

  function isRecoveryReturn() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    return search.get('reset') === '1'
      || hash.get('type') === 'recovery'
      || (!!hash.get('access_token') && !!hash.get('refresh_token'));
  }

  function updateAdminContextUrl(slug) {
    const nextUrl = buildAdminContextUrl(slug);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, '', nextUrl);
    }
  }

  function updatePublicUrl(slug) {
    const urlEl = document.getElementById('lt-public-url');
    const urlWrap = document.getElementById('lt-public-url-wrap');
    if (!urlEl) return;
    const publicUrl = buildPublicProfileUrl(slug);
    urlEl.textContent = publicUrl;
    urlEl.hidden = false;
    if (urlWrap) urlWrap.hidden = false;
    if (urlEl instanceof HTMLAnchorElement) {
      urlEl.href = publicUrl;
    }
  }

  function syncAutoSlug(nameValue, fallbackSource = '') {
    const generatedSlug = resolveSlug(nameValue, fallbackSource);
    updatePublicUrl(generatedSlug || '');
    return generatedSlug;
  }

  function bindAuth() {
    const loginBtn = document.getElementById('lt-login');
    const signupBtn = document.getElementById('lt-signup') || document.getElementById('lt-signup-inline');
    const emailInput = document.getElementById('lt-auth-email');
    const passInput = document.getElementById('lt-auth-pass');
    const statusEl = document.getElementById('lt-auth-status');
    const forgotToggle = document.getElementById('lt-forgot-toggle');
    const resetModal = document.getElementById('lt-reset-modal');
    const resetCloseEls = resetModal?.querySelectorAll('[data-reset-close]');
    const resetEmail = document.getElementById('lt-reset-email');
    const resetEmailDisplay = document.getElementById('lt-reset-email-display');
    const sendOtpBtn = document.getElementById('lt-send-otp');
    const otpInput = document.getElementById('lt-reset-otp');
    const resetPass = document.getElementById('lt-reset-pass');
    const resetConfirm = document.getElementById('lt-reset-confirm');
    const resetSubmit = document.getElementById('lt-reset-submit');
    const resetStatus = document.getElementById('lt-reset-status');
    const hasRecoveryReturn = isRecoveryReturn();

    const setResetMode = mode => {
      const isRecovery = mode === 'recovery';
      if (resetEmail) resetEmail.hidden = isRecovery;
      if (resetEmailDisplay) resetEmailDisplay.hidden = isRecovery;
      if (sendOtpBtn) {
        sendOtpBtn.hidden = isRecovery;
        sendOtpBtn.textContent = 'Send reset email';
      }
      if (otpInput) otpInput.hidden = true;
      if (resetPass) resetPass.hidden = !isRecovery;
      if (resetConfirm) resetConfirm.hidden = !isRecovery;
      if (resetSubmit) resetSubmit.hidden = !isRecovery;
    };

    const openResetModal = async () => {
      if (!resetModal) return;
      resetModal.hidden = false;
      document.body.style.overflow = 'hidden';
      setResetMode('request');
      showStatusEl(resetStatus, '', '');
      let currentEmail = normalizeEmail(emailInput?.value || '');
      if (!currentEmail && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        currentEmail = normalizeEmail(session?.user?.email || '');
      }
      if (resetEmail) resetEmail.value = currentEmail;
      if (resetEmailDisplay) {
        resetEmailDisplay.textContent = currentEmail
          ? `Send email to ${currentEmail}`
          : 'Send email to your account email';
      }
    };

    const openRecoveryModal = email => {
      if (!resetModal) return;
      resetModal.hidden = false;
      document.body.style.overflow = 'hidden';
      setResetMode('recovery');
      showStatusEl(resetStatus, 'Enter your new password.', 'success');
      if (resetEmail && email) resetEmail.value = email;
      if (resetPass) resetPass.value = '';
      if (resetConfirm) resetConfirm.value = '';
      setTimeout(() => resetPass?.focus(), 0);
    };

    document.addEventListener('lt-password-recovery', event => {
      openRecoveryModal(normalizeEmail(event.detail?.email || ''));
    });

    if (hasRecoveryReturn) {
      setTimeout(() => openRecoveryModal(normalizeEmail(resetEmail?.value || emailInput?.value || '')), 0);
    }

    const closeResetModal = () => {
      if (!resetModal) return;
      resetModal.hidden = true;
      document.body.style.overflow = '';
      setResetMode('request');
    };

    forgotToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      openResetModal();
    });
    resetCloseEls?.forEach(el => el.addEventListener('click', closeResetModal));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !resetModal?.hidden) closeResetModal();
    });

    sendOtpBtn?.addEventListener('click', async () => {
      const email = normalizeEmail(resetEmail?.value);
      if (!email) return showStatusEl(resetStatus, 'Enter your account email.', 'error');
      if (!supabase) return showStatusEl(resetStatus, 'Password reset requires Supabase auth.', 'error');
      showStatusEl(resetStatus, 'Sending reset email...', 'loading');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildResetPasswordPageUrl()
      });
      if (error) return showStatusEl(resetStatus, error.message, 'error');
      showStatusEl(resetStatus, `Reset email sent to ${email}.`, 'success');
    });

    resetSubmit?.addEventListener('click', async () => {
      const nextPassword = resetPass?.value || '';
      const confirmPassword = resetConfirm?.value || '';

      if (!nextPassword || !confirmPassword) return showStatusEl(resetStatus, 'Complete all reset fields.', 'error');
      if (nextPassword.length < 6) return showStatusEl(resetStatus, 'Password must be at least 6 characters.', 'error');
      if (nextPassword !== confirmPassword) return showStatusEl(resetStatus, 'Passwords do not match.', 'error');
      if (!supabase) return showStatusEl(resetStatus, 'Password reset requires Supabase auth.', 'error');
      showStatusEl(resetStatus, 'Updating password...', 'loading');
      const { error } = await supabase.auth.updateUser({ password: nextPassword });
      if (error) return showStatusEl(resetStatus, error.message, 'error');
      if (passInput) passInput.value = '';
      if (emailInput && resetEmail?.value) emailInput.value = normalizeEmail(resetEmail.value);
      if (resetPass) resetPass.value = '';
      if (resetConfirm) resetConfirm.value = '';
      showStatusEl(resetStatus, 'Password updated. You can log in now.', 'success');
      setTimeout(() => closeResetModal(), 900);
    });

    async function localAuth(mode, email, password) {
      const users = getLocalUsers();
      if (mode === 'login') {
        const user = users.find(u => normalizeEmail(u.email) === email);
        if (!user) throw new Error('Account not found. Try creating one first.');
        const hash = await sha256Hex(password);
        if (user.passwordHash !== hash) throw new Error('Incorrect email or password.');
        return { user };
      }
      // signup
      if (users.some(u => normalizeEmail(u.email) === email)) {
        throw new Error('Account already exists. Please log in.');
      }
      const user = {
        id: `local-${Date.now()}`,
        email,
        passwordHash: await sha256Hex(password),
        createdAt: new Date().toISOString()
      };
      users.push(user);
      saveLocalUsers(users);
      return { user };
    }

  async function startLocalSession(user, statusEl) {
    showAdminLoader();
    persistCurrentUser(user);
    try {
      await ensureLocalDraftForUser(user);
      loadLocalDraft();
      toggleEditor(true);
      setAuthOnly(false);
      showStatusEl(statusEl, 'Signed in (local)', 'success');
    } finally {
      hideAdminLoader();
    }
  }

  async function startSupabaseSession(user, statusEl) {
    if (!user) throw new Error('Signed in, but no user was returned.');
    showAdminLoader();
    persistCurrentUser(user);
    try {
      await loadProfile(user);
      toggleEditor(true);
      setAuthOnly(false);
      showStatusEl(statusEl, 'Signed in.', 'success');
    } catch (err) {
      console.error('Profile load failed after direct sign-in', err);
      showStatusEl(document.getElementById('lt-save-status'), 'Signed in, but profile data failed to load.', 'error');
      loadLocalDraft();
      toggleEditor(true);
      setAuthOnly(false);
    } finally {
      hideAdminLoader();
    }
  }

    const doAuth = async mode => {
      try {
        const email = normalizeEmail(emailInput?.value);
        const password = passInput?.value?.trim() || '';
        residueTelemetry.logAuthEvent({
          action: mode === 'login' ? 'signin' : 'signup',
          outcome: 'attempt',
          email,
          detail: `link-admin ${mode} submitted.`
        });
        if (!email || !password) return showStatusEl(statusEl, 'Enter email and password', 'error');
        showStatusEl(statusEl, mode === 'login' ? 'Logging in...' : 'Creating account...', 'loading');

        const canUseSupabase = !isFileProtocol && !!supabase;

        if (canUseSupabase) {
          let error, data;
          if (mode === 'login') {
            ({ error, data } = await supabase.auth.signInWithPassword({ email, password }));
          } else {
              ({ error, data } = await supabase.auth.signUp({
                email,
                password,
                options: { emailRedirectTo: buildAdminPageUrl() }
              }));
          }
          if (error) return showStatusEl(statusEl, error.message, 'error');
          if (mode === 'signup' && data?.user && !data.session) {
            residueTelemetry.logAuthEvent({
              action: 'signup',
              outcome: 'success',
              email,
              detail: 'Supabase signup created; awaiting email confirmation.'
            });
            return showStatusEl(statusEl, 'Check your email to confirm, then log in.', 'success');
          }
          residueTelemetry.logAuthEvent({
            action: mode === 'login' ? 'signin' : 'signup',
            outcome: 'success',
            email,
            user_id: data?.user?.id || null,
            detail: `Supabase ${mode} succeeded on link-admin.`
          });
          await startSupabaseSession(data?.user || data?.session?.user, statusEl);
          return;
        }

        // Local fallback (demo / offline)
        const { user } = await localAuth(mode, email, password);
        residueTelemetry.logAuthEvent({
          action: mode === 'login' ? 'signin' : 'signup',
          outcome: 'success',
          email,
          user_id: user.id,
          detail: `Local ${mode} succeeded on link-admin.`
        });
        await startLocalSession(user, statusEl);
      } catch (err) {
        console.error('Auth error', err);
        residueTelemetry.logAuthEvent({
          action: mode === 'login' ? 'signin' : 'signup',
          outcome: 'failure',
          email: normalizeEmail(emailInput?.value),
          detail: err.message || `Unexpected ${mode} error on link-admin.`
        });
        showStatusEl(statusEl, err.message || 'Auth failed', 'error');
      }
    };

    loginBtn?.addEventListener('click', (evt) => {
      evt.preventDefault();
      doAuth('login');
    });
    signupBtn?.addEventListener('click', (evt) => {
      evt.preventDefault();
      doAuth('signup');
    });
    passInput?.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter') return;
      evt.preventDefault();
      doAuth('login');
    });
  }

  async function ensureProfileRow(user) {
    if (!user) return;
    const authEmail = normalizeEmail(user.email);
    const emailPrefix = (authEmail || user.email || '').split('@')[0];
    const fallbackSlug = await ensureUniqueSlug(
      resolveSlug(emailPrefix, authEmail),
      {
        excludeId: user.id,
        fallbackSlug: `user-${String(user.id || '').replace(/-/g, '').slice(0, 8)}`
      }
    );
    await supabase.from('profiles').upsert({
      id: user.id,
      auth_email: authEmail || null,
      name: DEFAULT_PROFILE_NAME,
      slug: fallbackSlug,
      theme: 'light'
    });
  }

  async function initSession(forceLoad = false) {
    if (!supabase) {
      toggleEditor(false);
      setAuthOnly(true);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !forceLoad) {
      toggleEditor(false);
      setAuthOnly(true);
    } else {
      persistCurrentUser(session.user);
      showAdminLoader();
      toggleEditor(true);
      setAuthOnly(false);
      try {
        await loadProfile(session.user);
      } catch (err) {
        console.error('Profile load failed after session init', err);
        showStatusEl(document.getElementById('lt-save-status'), 'Signed in, but profile data failed to load.', 'error');
        loadLocalDraft();
      } finally {
        hideAdminLoader();
      }
    }
    if (authStateSubscription) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sessionNow) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') return;
      if (event === 'PASSWORD_RECOVERY') {
        document.dispatchEvent(new CustomEvent('lt-password-recovery', {
          detail: { email: normalizeEmail(sessionNow?.user?.email || '') }
        }));
        return;
      }
      if (event !== 'SIGNED_OUT' && sessionNow) return;
      if (!sessionNow) {
        persistCurrentUser(null);
        toggleEditor(false);
        setAuthOnly(true);
      }
    });
    authStateSubscription = subscription;
  }

  async function loadProfile(user) {
    const { data: initialProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    let profile = initialProfile;
    if (!profile) {
      await ensureProfileRow(user);
      const { data: createdProfile, error: createdErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (createdErr) throw createdErr;
      profile = createdProfile;
    }
    const adminSlug = resolveSlug(profile?.slug, profile?.auth_email, user?.email);
    updateAdminContextUrl(adminSlug);
    // Fetch links; add hidden default false so toggles work locally
    const { data: links } = await supabase.from('links').select('*').eq('profile_id', user.id).order('sort', { ascending: true });
    const { data: cardConfig } = await supabase
      .from('card_configs')
      .select('config_data')
      .eq('profile_id', user.id)
      .maybeSingle();
    const snapshot = cardConfig?.config_data || null;
    const snapshotLinks = Array.isArray(snapshot?.links) ? snapshot.links : [];
    const effectiveLinks = (links && links.length) ? links : snapshotLinks;
    const mergedProfile = {
      ...(snapshot?.profile || {}),
      ...(profile || {})
    };
    const hydratedLinks = hydrateStoredLinks(effectiveLinks || []);
    fillEditor(mergedProfile || {}, hydratedLinks, user, snapshot);
    const codeRow = await fetchOrCreateCode(user.id);
    renderCodePanel(codeRow);
  }

  function toggleEditor(show) {
    const authCard = document.getElementById('lt-auth-card');
    const editorCard = document.getElementById('lt-editor');
    if (authCard) {
      authCard.hidden = show;
      authCard.style.display = show ? 'none' : 'grid';
    }
    if (editorCard) {
      editorCard.hidden = !show;
      editorCard.style.display = show ? 'grid' : 'none';
    }
  }

  function loadLocalDraft() {
    const lastKey = localStorage.getItem('residue_link_last_profile_key');
    const keys = Object.keys(localStorage);
    const pickProfile = key => {
      if (!key) return null;
      try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
    };
    let profile = pickProfile(lastKey);
    if (!profile) {
      const anyKey = keys.find(k => k.startsWith(LOCAL_PROFILE_KEY_PREFIX));
      profile = pickProfile(anyKey);
    }
    if (profile) {
      const links = Array.isArray(profile.links) ? profile.links : [];
      fillEditor(profile, hydrateStoredLinks(links));
    }
  }

  function fillEditor(profile, links, user = null, snapshot = null) {
    isFillingEditor = true;
    const snapshotFields = snapshot?.fields || {};
    const displayName = deriveDisplayName(profile?.name, user);
    const savedTitle = typeof profile?.title === 'string'
      ? profile.title
      : (typeof snapshotFields.role === 'string' ? snapshotFields.role : '');
    const savedBio = typeof profile?.bio === 'string'
      ? profile.bio
      : (typeof snapshotFields['lt-bio'] === 'string' ? snapshotFields['lt-bio'] : '');
    const savedEmail = Object.prototype.hasOwnProperty.call(snapshotFields, 'email-config')
      ? String(snapshotFields['email-config'] ?? '')
      : normalizeEmail(profile?.auth_email || user?.email || '');
    const savedTheme = profile?.theme === 'dark' ? 'dark' : 'light';
    setValue('lt-avatar-url', profile.avatar_url || '');
    updateLogoPreview(profile.avatar_url || '');
    setValue('full-name', displayName || '');
    setValue('role', savedTitle || '');
    setValue('lt-bio', (savedBio || '').slice(0, BIO_MAX_CHARS));
    const themeInput = document.querySelector(`input[name="lt-theme"][value="${savedTheme}"]`);
    if (themeInput) themeInput.checked = true;
    setTheme(savedTheme);
    setupVirtualCard(profile || {});
    if (profile?.slug) updatePublicUrl(profile.slug);
    else syncAutoSlug(displayName || '', profile.auth_email || displayName || profile.name || '');
    const setToggle = (id, checked = false) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!checked;
    };

    socialConfig.forEach(s => setValue(s.id, ''));
    setValue('website', '');
    setValue('location-coordinates', '');
    setValue('phone', '');
    setValue('email-config', savedEmail || '');
    setValue('whatsapp-number', '');
    setValue('whatsapp-message', '');
    setValue('company-name', '');
    setValue('lt-company-bio', '');
    setValue('lt-company-logo-url', '');
    updateCompanyLogoPreview('');

    const { meta, normalLinks } = extractMetaFromLinks(Array.isArray(links) ? links : []);
    const hasMeta = key => Object.prototype.hasOwnProperty.call(meta, key);
    const hasSnapshotField = key => Object.prototype.hasOwnProperty.call(snapshotFields, key);
    const parseToggleMeta = (key, fallback = false) => parseBool(meta[key], fallback);

    const fallbackShowRole = snapshotFields['show-role'];
    const fallbackShowBio = snapshotFields['show-bio'];
    setToggle('show-role', hasMeta('show_role') ? parseBool(meta.show_role, false) : parseBool(fallbackShowRole, false));
    setToggle('show-bio', hasMeta('show_bio') ? parseBool(meta.show_bio, false) : parseBool(fallbackShowBio, false));
    setToggle('show-company-name', parseToggleMeta('show_company_name', hasSnapshotField('show-company-name') ? parseBool(snapshotFields['show-company-name'], false) : false));
    setToggle('show-company-bio', parseToggleMeta('show_company_bio', hasSnapshotField('show-company-bio') ? parseBool(snapshotFields['show-company-bio'], false) : false));
    setToggle('show-company-logo', parseToggleMeta('show_company_logo', hasSnapshotField('show-company-logo') ? parseBool(snapshotFields['show-company-logo'], false) : false));
    setToggle('show-website', parseToggleMeta('show_website', false));
    setToggle('show-location', parseToggleMeta('show_location', false));
    setToggle('show-phone', parseToggleMeta('show_phone', false));
    setToggle('show-email', parseToggleMeta('show_email', false));
    const snapshotShowWhatsapp = hasSnapshotField('show-whatsapp')
      ? parseBool(snapshotFields['show-whatsapp'], false)
      : false;
    setToggle('show-whatsapp', parseToggleMeta('show_whatsapp', snapshotShowWhatsapp));
    const legacyShowTemplate = parseToggleMeta('show_whatsapp_template', false);
    const legacyShowCustom = parseToggleMeta('show_whatsapp_custom', false);
    const snapshotShowWhatsappMessage = hasSnapshotField('show-whatsapp-message')
      ? parseBool(snapshotFields['show-whatsapp-message'], false)
      : (legacyShowTemplate && legacyShowCustom);
    setToggle('show-whatsapp-message', parseToggleMeta('show_whatsapp_message', snapshotShowWhatsappMessage));
    socialConfig.forEach(s => {
      const toggleKey = s.toggle.replace(/-/g, '_');
      setToggle(s.toggle, parseToggleMeta(toggleKey, false));
    });
    const snapshotWhatsappNumber = hasSnapshotField('whatsapp-number') ? String(snapshotFields['whatsapp-number'] || '') : '';
    if (hasMeta('whatsapp_number')) setValue('whatsapp-number', meta.whatsapp_number || '');
    else if (snapshotWhatsappNumber) setValue('whatsapp-number', snapshotWhatsappNumber);
    const legacyMessage = meta.whatsapp_custom || meta.whatsapp_template || '';
    const snapshotMessage = hasSnapshotField('whatsapp-message') ? String(snapshotFields['whatsapp-message'] || '') : '';
    if (hasMeta('whatsapp_message')) setValue('whatsapp-message', String(meta.whatsapp_message || '').slice(0, WHATSAPP_MESSAGE_MAX_CHARS));
    else if (legacyMessage) setValue('whatsapp-message', String(legacyMessage).slice(0, WHATSAPP_MESSAGE_MAX_CHARS));
    else if (snapshotMessage) setValue('whatsapp-message', snapshotMessage.slice(0, WHATSAPP_MESSAGE_MAX_CHARS));
    if (hasMeta('company_name')) setValue('company-name', String(meta.company_name || ''));
    else if (hasSnapshotField('company-name')) setValue('company-name', String(snapshotFields['company-name'] || ''));
    if (hasMeta('company_bio')) setValue('lt-company-bio', String(meta.company_bio || '').slice(0, BIO_MAX_CHARS));
    else if (hasSnapshotField('lt-company-bio')) setValue('lt-company-bio', String(snapshotFields['lt-company-bio'] || '').slice(0, BIO_MAX_CHARS));
    if (hasMeta('company_logo_url')) setValue('lt-company-logo-url', String(meta.company_logo_url || ''));
    else if (hasSnapshotField('lt-company-logo-url')) setValue('lt-company-logo-url', String(snapshotFields['lt-company-logo-url'] || ''));
    updateCompanyLogoPreview(getValue('lt-company-logo-url'));

    normalLinks.forEach(link => {
      const label = (link.label || '').toLowerCase();
      if (label === 'website') {
        setValue('website', link.url || '');
        if (!hasMeta('show_website')) setToggle('show-website', !link.hidden);
        return;
      }
      if (label === 'location') {
        setValue('location-coordinates', extractLocationFromUrl(link.url || ''));
        if (!hasMeta('show_location')) setToggle('show-location', !link.hidden);
        return;
      }
      if (label === 'call') {
        setValue('phone', (link.url || '').replace(/^tel:/i, ''));
        if (!hasMeta('show_phone')) setToggle('show-phone', !link.hidden);
        return;
      }
      if (label === 'email') {
        setValue('email-config', (link.url || '').replace(/^mailto:/i, ''));
        if (!hasMeta('show_email')) setToggle('show-email', !link.hidden);
        return;
      }
      if (label === 'whatsapp') {
        if (!hasMeta('show_whatsapp')) setToggle('show-whatsapp', !link.hidden);
        const m = String(link.url || '').match(/^https:\/\/wa\.me\/(\d+)(?:\?text=(.*))?$/i);
        if (m?.[1]) setValue('whatsapp-number', m[1]);
        if (m?.[2]) {
          const msg = decodeURIComponent(m[2]);
          if (!hasMeta('whatsapp_message')) setValue('whatsapp-message', msg);
        }
        return;
      }
      const socialIdx = socialConfig.findIndex(s => s.label.toLowerCase() === label);
      if (socialIdx >= 0) {
        const social = socialConfig[socialIdx];
        setValue(social.id, link.url || '');
        const toggleKey = social.toggle.replace(/-/g, '_');
        if (!hasMeta(toggleKey)) setToggle(social.toggle, !link.hidden);
      }
    });

    updateCharacterCount('lt-bio', 'lt-bio-count', BIO_MAX_CHARS);
    updateCharacterCount('lt-company-bio', 'lt-company-bio-count', BIO_MAX_CHARS);
    updateCharacterCount('whatsapp-message', 'whatsapp-message-count', WHATSAPP_MESSAGE_MAX_CHARS);
    isFillingEditor = false;
  }

  function buildWhatsappLink() {
    const numInput = document.getElementById('whatsapp-number');
    const messageInput = document.getElementById('whatsapp-message');
    const showWhatsapp = document.getElementById('show-whatsapp');
    const showMessage = document.getElementById('show-whatsapp-message');
    const rawNumber = (numInput?.value || '').replace(/[^\d]/g, '');
    if (!rawNumber) return null;
    if (showWhatsapp && !showWhatsapp.checked) {
      return {
        label: 'WhatsApp',
        url: `https://wa.me/${rawNumber}`,
        hidden: true
      };
    }
    const text = (showMessage && !showMessage.checked)
      ? ''
      : (messageInput?.value || '').trim().slice(0, WHATSAPP_MESSAGE_MAX_CHARS);
    const encoded = text ? `?text=${encodeURIComponent(text)}` : '';
    return {
      label: 'WhatsApp',
      url: `https://wa.me/${rawNumber}${encoded}`,
      hidden: false
    };
  }

  function collectLinks() {
    const linksOut = [];

    // Contact toggles
    const sw = document.getElementById('show-website');
    const sl = document.getElementById('show-location');
    const sp = document.getElementById('show-phone');
    const se = document.getElementById('show-email');
    const website = getValue('website');
    const locationCoordinates = getValue('location-coordinates');
    const phone = getValue('phone');
    const email = getValue('email-config');
    if (website) linksOut.push({ label: 'Website', url: website.startsWith('http') ? website : `https://${website}`, hidden: sw ? !sw.checked : false, sort: linksOut.length });
    if (locationCoordinates) {
      const locationUrl = buildLocationUrl(locationCoordinates);
      if (locationUrl) {
        linksOut.push({ label: 'Location', url: locationUrl, hidden: sl ? !sl.checked : false, sort: linksOut.length });
      }
    }
    if (phone) linksOut.push({ label: 'Call', url: `tel:${phone}`, hidden: sp ? !sp.checked : false, sort: linksOut.length });
    if (email) linksOut.push({ label: 'Email', url: `mailto:${email}`, hidden: se ? !se.checked : false, sort: linksOut.length });

    // WhatsApp quick link
    const waLink = buildWhatsappLink();
    if (waLink?.url) linksOut.push({ ...waLink, sort: linksOut.length });

    socialConfig.forEach(social => {
      const raw = getValue(social.id);
      const show = document.getElementById(social.toggle);
      if (!raw) return;
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      linksOut.push({
        label: social.label,
        url,
        hidden: show ? !show.checked : false,
        sort: linksOut.length
      });
    });

    linksOut.push(metaLink('show_role', document.getElementById('show-role')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_bio', document.getElementById('show-bio')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_company_name', document.getElementById('show-company-name')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_company_bio', document.getElementById('show-company-bio')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_company_logo', document.getElementById('show-company-logo')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_website', document.getElementById('show-website')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_location', document.getElementById('show-location')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_phone', document.getElementById('show-phone')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_email', document.getElementById('show-email')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_whatsapp', document.getElementById('show-whatsapp')?.checked ?? false, linksOut.length));
    linksOut.push(metaLink('show_whatsapp_message', document.getElementById('show-whatsapp-message')?.checked ?? false, linksOut.length));
    socialConfig.forEach(social => {
      const toggleKey = social.toggle.replace(/-/g, '_');
      linksOut.push(metaLink(toggleKey, document.getElementById(social.toggle)?.checked ?? false, linksOut.length));
    });
    linksOut.push(metaLink('company_name', getValue('company-name'), linksOut.length));
    linksOut.push(metaLink('company_bio', getValue('lt-company-bio').slice(0, BIO_MAX_CHARS), linksOut.length));
    linksOut.push(metaLink('company_logo_url', getValue('lt-company-logo-url'), linksOut.length));
    linksOut.push(metaLink('whatsapp_number', getValue('whatsapp-number'), linksOut.length));
    linksOut.push(metaLink('whatsapp_message', getValue('whatsapp-message').slice(0, WHATSAPP_MESSAGE_MAX_CHARS), linksOut.length));

    return linksOut;
  }

  function collectConfigureSnapshot(user, profile, links) {
    const form = document.querySelector('#lt-editor form.configure-form');
    const fields = {};
    if (form) {
      const controls = form.querySelectorAll('input, textarea, select');
      controls.forEach(control => {
        const key = control.id || control.name;
        if (!key) return;
        if (control.type === 'checkbox') {
          fields[key] = !!control.checked;
          return;
        }
        if (control.type === 'file') {
          const file = control.files?.[0] || null;
          fields[key] = file
            ? { name: file.name, size: file.size, type: file.type || '', last_modified: file.lastModified || null }
            : null;
          return;
        }
        fields[key] = control.value ?? '';
      });
    }
    return {
      profile_id: user?.id || null,
      auth_email: normalizeEmail(user?.email) || null,
      saved_at: new Date().toISOString(),
      fields,
      profile,
      links
    };
  }

  async function cropImageWithModal(file) {
    const modal = document.getElementById('lt-cropper-modal');
    const backdrop = document.getElementById('lt-cropper-backdrop');
    const stage = document.getElementById('lt-cropper-stage');
    const imageEl = document.getElementById('lt-cropper-image');
    const boxEl = document.getElementById('lt-cropper-box');
    const cancelBtn = document.getElementById('lt-crop-cancel');
    const applyBtn = document.getElementById('lt-crop-apply');
    const sourceDataUrl = await fileToDataURL(file);

    if (!modal || !stage || !imageEl || !boxEl || !cancelBtn || !applyBtn) {
      return sourceDataUrl;
    }

    const sourceImage = await loadImage(sourceDataUrl);
    imageEl.src = sourceDataUrl;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';

    return await new Promise(resolve => {
      let settled = false;
      let dragging = false;
      let pinchStartDistance = null;
      let pinchStartSize = null;
      let pinchCenter = null;
      const activePointers = new Map();
      let dragOffsetX = 0;
      let dragOffsetY = 0;
      let imageRect = { left: 0, top: 0, width: 0, height: 0 };
      const box = { left: 0, top: 0, size: 0 };
      const MIN_BOX_SIZE = 64;

      const cleanup = result => {
        if (settled) return;
        settled = true;
        modal.hidden = true;
        document.body.style.overflow = '';
        window.removeEventListener('resize', updateLayout);
        document.removeEventListener('keydown', onKeyDown);
        backdrop?.removeEventListener('click', onCancel);
        cancelBtn.removeEventListener('click', onCancel);
        applyBtn.removeEventListener('click', onApply);
        boxEl.removeEventListener('pointerdown', onPointerDown);
        stage.removeEventListener('wheel', onWheel);
        stage.removeEventListener('pointermove', onPointerMove);
        stage.removeEventListener('pointerup', onPointerUp);
        stage.removeEventListener('pointercancel', onPointerUp);
        stage.removeEventListener('pointerdown', trackPointer);
        stage.removeEventListener('pointerup', untrackPointer);
        stage.removeEventListener('pointercancel', untrackPointer);
        resolve(result);
      };

      const clampBox = () => {
        const maxLeft = imageRect.left + imageRect.width - box.size;
        const maxTop = imageRect.top + imageRect.height - box.size;
        box.left = Math.max(imageRect.left, Math.min(box.left, maxLeft));
        box.top = Math.max(imageRect.top, Math.min(box.top, maxTop));
      };

      const clampSize = size => {
        const maxSize = Math.min(imageRect.width, imageRect.height);
        return Math.min(Math.max(size, MIN_BOX_SIZE), maxSize);
      };

      const setBoxSize = (nextSize, anchor = null) => {
        const size = clampSize(nextSize);
        const currentCenter = {
          x: box.left + box.size / 2,
          y: box.top + box.size / 2
        };
        const targetCenter = anchor || currentCenter;
        box.size = size;
        box.left = targetCenter.x - size / 2;
        box.top = targetCenter.y - size / 2;
        clampBox();
        renderBox();
      };

      const renderBox = () => {
        boxEl.style.width = `${box.size}px`;
        boxEl.style.height = `${box.size}px`;
        boxEl.style.left = `${box.left}px`;
        boxEl.style.top = `${box.top}px`;
      };

      const updateLayout = () => {
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        if (!sw || !sh) return;
        const scale = Math.min(sw / sourceImage.width, sh / sourceImage.height);
        const width = sourceImage.width * scale;
        const height = sourceImage.height * scale;
        imageRect = {
          left: (sw - width) / 2,
          top: (sh - height) / 2,
          width,
          height
        };

        if (!box.size) {
          box.size = Math.max(80, Math.floor(Math.min(width, height) * 0.7));
          box.left = imageRect.left + (width - box.size) / 2;
          box.top = imageRect.top + (height - box.size) / 2;
        } else {
          box.size = clampSize(Math.floor(Math.min(width, height)));
          clampBox();
        }
        renderBox();
      };

      const stagePoint = event => {
        const rect = stage.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      };

      const onPointerDown = event => {
        event.preventDefault();
        dragging = true;
        const { x, y } = stagePoint(event);
        dragOffsetX = x - box.left;
        dragOffsetY = y - box.top;
        boxEl.setPointerCapture?.(event.pointerId);
        boxEl.classList.add('is-dragging');
      };

      const onPointerMove = event => {
        const { x, y } = stagePoint(event);

        // Pinch-to-zoom when two pointers are active
        if (activePointers.size === 2 && pinchStartDistance && pinchStartSize) {
          activePointers.set(event.pointerId, { x, y });
          const points = Array.from(activePointers.values());
          const dx = points[0].x - points[1].x;
          const dy = points[0].y - points[1].y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0) {
            const scale = distance / pinchStartDistance;
            setBoxSize(pinchStartSize * scale, pinchCenter);
          }
          return;
        }

        if (!dragging) return;
        box.left = x - dragOffsetX;
        box.top = y - dragOffsetY;
        clampBox();
        renderBox();
      };

      const onPointerUp = event => {
        dragging = false;
        boxEl.releasePointerCapture?.(event.pointerId);
        boxEl.classList.remove('is-dragging');
      };

      const onWheel = event => {
        event.preventDefault();
        const { x, y } = stagePoint(event);
        const scale = event.deltaY > 0 ? 1.08 : 0.92;
        const nextSize = box.size * scale;
        setBoxSize(nextSize, { x, y });
      };

      const trackPointer = event => {
        const { x, y } = stagePoint(event);
        activePointers.set(event.pointerId, { x, y });
        if (activePointers.size === 2) {
          dragging = false;
          boxEl.classList.remove('is-dragging');
          const points = Array.from(activePointers.values());
          const dx = points[0].x - points[1].x;
          const dy = points[0].y - points[1].y;
          pinchStartDistance = Math.hypot(dx, dy);
          pinchStartSize = box.size;
          pinchCenter = {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2
          };
        }
      };

      const untrackPointer = event => {
        activePointers.delete(event.pointerId);
        pinchStartDistance = null;
        pinchStartSize = null;
        pinchCenter = null;
      };

      const onCancel = () => cleanup(null);

      const onApply = () => {
        if (!imageRect.width || !imageRect.height) return cleanup(sourceDataUrl);
        const scaleX = sourceImage.width / imageRect.width;
        const scaleY = sourceImage.height / imageRect.height;
        const sx = Math.max(0, (box.left - imageRect.left) * scaleX);
        const sy = Math.max(0, (box.top - imageRect.top) * scaleY);
        const sWidth = Math.min(sourceImage.width - sx, box.size * scaleX);
        const sHeight = Math.min(sourceImage.height - sy, box.size * scaleY);
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 900;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(sourceImage, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
        cleanup(canvas.toDataURL('image/jpeg', 0.92));
      };

      const onKeyDown = event => {
        if (event.key === 'Escape') onCancel();
      };

      window.addEventListener('resize', updateLayout);
      document.addEventListener('keydown', onKeyDown);
      backdrop?.addEventListener('click', onCancel);
      cancelBtn.addEventListener('click', onCancel);
      applyBtn.addEventListener('click', onApply);
      boxEl.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('pointermove', onPointerMove);
      stage.addEventListener('pointerup', onPointerUp);
      stage.addEventListener('pointercancel', onPointerUp);
      stage.addEventListener('pointerdown', trackPointer);
      stage.addEventListener('pointerup', untrackPointer);
      stage.addEventListener('pointercancel', untrackPointer);
      updateLayout();
    });
  }

  function persistEditorState(options = {}) {
    const run = () => runPersistEditorState(options);
    const next = persistQueue.then(run, run);
    persistQueue = next.catch(() => {});
    return next;
  }

  async function runPersistEditorState({ statusEl = document.getElementById('lt-save-status'), redirect = false, silent = false } = {}) {
    let session = null;
    if (supabase) {
      ({ data: { session } } = await supabase.auth.getSession());
      if (!session) {
        if (!silent) showStatusEl(statusEl, 'Not signed in.', 'error');
        return false;
      }
    }

    const profile = await collectProfilePayload(session?.user || null);
    if (!profile.name) {
      if (!silent) showStatusEl(statusEl, 'Name is required.', 'error');
      return false;
    }
    const locationCoordinates = getValue('location-coordinates');
    if (locationCoordinates && !buildLocationUrl(locationCoordinates)) {
      if (!silent) showStatusEl(statusEl, 'Location must be an address or coordinates.', 'error');
      return false;
    }

    const links = collectLinks();
    if (!silent) showStatusEl(statusEl, 'Saving...', 'loading');

    if (supabase && session) {
      const { error: pErr } = await supabase.from('profiles').upsert(profile);
      if (pErr) {
        if (!silent) showStatusEl(statusEl, pErr.message, 'error');
        return false;
      }
      await supabase.from('links').delete().eq('profile_id', session.user.id);
      if (links.length) {
        const supaLinks = applyHiddenMeta(links).map(l => ({
          label: l.label,
          url: l.url,
          sort: l.sort,
          profile_id: session.user.id
        }));
        const { error: lErr } = await supabase.from('links').insert(supaLinks);
        if (lErr) {
          if (!silent) showStatusEl(statusEl, lErr.message, 'error');
          return false;
        }
      }
      const snapshot = collectConfigureSnapshot(session.user, profile, applyHiddenMeta(links));
      const { error: cErr } = await supabase.from('card_configs').upsert({
        profile_id: session.user.id,
        auth_email: normalizeEmail(session.user.email) || null,
        config_data: snapshot,
        updated_at: new Date().toISOString()
      });
      if (cErr) {
        if (!silent) showStatusEl(statusEl, cErr.message, 'error');
        return false;
      }
    }

    const localProfile = {
      id: profile.id,
      name: profile.name,
      title: profile.title,
      bio: profile.bio,
      avatar_url: profile.avatar_url,
      theme: profile.theme,
      slug: profile.slug,
      links: applyHiddenMeta(links)
    };
    const draftKey = localProfileKey(profile.slug);
    localStorage.setItem(draftKey, JSON.stringify(localProfile));
    localStorage.setItem('residue_link_last_profile_key', draftKey);
    updatePublicUrl(profile.slug);
    setupVirtualCard(profile);
    updateLogoPreview(profile.avatar_url || '');

    if (!silent) {
      showStatusEl(statusEl, redirect ? 'Saved. Redirecting...' : 'Saved.', 'success');
    }
    if (redirect) {
      const target = `${window.location.origin}/link-profile.html?u=${encodeURIComponent(profile.slug)}`;
      setTimeout(() => { window.location.href = target; }, 500);
    }
    return true;
  }

  function scheduleEditorAutosave(delay = AUTOSAVE_DELAY_MS) {
    if (isFillingEditor) return;
    const editor = document.getElementById('lt-editor');
    if (!editor || editor.hidden) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(runEditorAutosave, delay);
  }

  async function runEditorAutosave() {
    if (isFillingEditor) return;
    if (autosaveInFlight) {
      autosaveQueued = true;
      return;
    }
    autosaveInFlight = true;
    try {
      await persistEditorState({ statusEl: document.getElementById('lt-save-status'), redirect: false, silent: false });
    } catch (err) {
      console.error('Autosave failed', err);
      showStatusEl(document.getElementById('lt-save-status'), err.message || 'Autosave failed.', 'error');
    } finally {
      autosaveInFlight = false;
      if (autosaveQueued) {
        autosaveQueued = false;
        scheduleEditorAutosave();
      }
    }
  }

  function bindEditorActions() {
    if (editorActionsBound) return;
    editorActionsBound = true;
    const fullNameInput = document.getElementById('full-name');
    const logoInput = document.getElementById('logo');
    const avatarUrlInput = document.getElementById('lt-avatar-url');
    const companyLogoInput = document.getElementById('company-logo');
    const companyLogoUrlInput = document.getElementById('lt-company-logo-url');
    const saveStatusEl = document.getElementById('lt-save-status');
    const bioInput = document.getElementById('lt-bio');
    const bioCount = document.getElementById('lt-bio-count');
    const companyBioInput = document.getElementById('lt-company-bio');
    const companyBioCount = document.getElementById('lt-company-bio-count');
    const waMessage = document.getElementById('whatsapp-message');
    const waMessageCount = document.getElementById('whatsapp-message-count');
    const themeInputs = Array.from(document.querySelectorAll('input[name="lt-theme"]'));

    fullNameInput?.addEventListener('input', () => {
      syncAutoSlug(fullNameInput.value, getValue('email-config'));
    });

    themeInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        setTheme(input.value);
      });
    });

    const handleImageChange = async ({
      fileInput,
      valueInput,
      updatePreview,
      invalidMessage,
      canceledMessage,
      successMessage,
      fallbackError,
      readyLabel
    }) => {
      const file = fileInput?.files?.[0];
      if (!file) {
        if (valueInput) valueInput.value = '';
        updatePreview('');
        scheduleEditorAutosave(0);
        return;
      }
      if (!(file.type || '').startsWith('image/')) {
        showStatusEl(saveStatusEl, invalidMessage, 'error');
        fileInput.value = '';
        return;
      }
      try {
        const cropped = await cropImageWithModal(file);
        if (!cropped) {
          showStatusEl(saveStatusEl, canceledMessage, 'error');
          fileInput.value = '';
          return;
        }
        const optimized = await compressDataUrl(cropped, 700 * 1024, 900);
        if (valueInput) valueInput.value = optimized;
        updatePreview(optimized, readyLabel);
        showStatusEl(saveStatusEl, successMessage, 'success');
        scheduleEditorAutosave(0);
      } catch (err) {
        showStatusEl(saveStatusEl, err.message || fallbackError, 'error');
        fileInput.value = '';
      }
    };
    const handleLogoChange = () => handleImageChange({
      fileInput: logoInput,
      valueInput: avatarUrlInput,
      updatePreview: updateLogoPreview,
      invalidMessage: 'Logo must be an image.',
      canceledMessage: 'Logo selection canceled.',
      successMessage: 'Logo optimized.',
      fallbackError: 'Could not process logo.',
      readyLabel: 'New photo ready'
    });
    const handleCompanyLogoChange = () => handleImageChange({
      fileInput: companyLogoInput,
      valueInput: companyLogoUrlInput,
      updatePreview: updateCompanyLogoPreview,
      invalidMessage: 'Company logo must be an image.',
      canceledMessage: 'Company logo selection canceled.',
      successMessage: 'Company logo optimized.',
      fallbackError: 'Could not process company logo.',
      readyLabel: 'New logo ready'
    });
    logoInput?.addEventListener('change', handleLogoChange);
    companyLogoInput?.addEventListener('change', handleCompanyLogoChange);
    const editorForm = document.querySelector('#lt-editor form.configure-form');
    const managedImageFieldIds = new Set(['logo', 'company-logo']);
    editorForm?.addEventListener('input', evt => {
      if (managedImageFieldIds.has(evt.target?.id)) return;
      scheduleEditorAutosave();
    });
    editorForm?.addEventListener('change', evt => {
      if (managedImageFieldIds.has(evt.target?.id)) return;
      scheduleEditorAutosave(0);
    });
    bindCharacterLimit(bioInput, bioCount, BIO_MAX_CHARS, 'Bio');
    bindCharacterLimit(companyBioInput, companyBioCount, BIO_MAX_CHARS, 'Company bio');
    bindCharacterLimit(waMessage, waMessageCount, WHATSAPP_MESSAGE_MAX_CHARS, 'WhatsApp message');

    const saveBtn = document.getElementById('lt-save');
    const statusEl = document.getElementById('lt-save-status');
    saveBtn?.addEventListener('click', async evt => {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      clearTimeout(autosaveTimer);
      try {
        await persistEditorState({ statusEl, redirect: true, silent: false });
      } catch (err) {
        console.error(err);
        showStatusEl(statusEl, err.message || 'Save failed.', 'error');
      }
    }, { capture: true });
  }
  async function collectProfilePayload(user) {
    const name = getValue('full-name') || getValue('lt-name') || DEFAULT_PROFILE_NAME;
    const auth_email = normalizeEmail(user?.email);
    const fallbackSlug = resolveSlug(auth_email.split('@')[0], auth_email) || `user-${String(user?.id || '').replace(/-/g, '').slice(0, 8)}`;
    const slug = await ensureUniqueSlug(name, {
      excludeId: user?.id || null,
      fallbackSlug
    });
    const title = getValue('role') || getValue('lt-title');
    const bio = getValue('lt-bio').slice(0, BIO_MAX_CHARS);
    const avatar_url = getValue('lt-avatar-url');
    const theme = document.querySelector('input[name="lt-theme"]:checked')?.value || 'light';
    const id = user?.id || CURRENT_USER_KEY;
    return { id, auth_email: auth_email || null, name, slug, title, bio, avatar_url, theme };
  }

  /* Helpers */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function setPublicCompanyLogo(url) {
    const logo = document.getElementById('lt-company-logo');
    const header = document.querySelector('.lt-header');
    const value = String(url || '').trim();
    if (logo) {
      if (value) {
        logo.src = value;
        logo.hidden = false;
      } else {
        logo.removeAttribute('src');
        logo.hidden = true;
      }
    }
    header?.classList.toggle('has-company-logo', !!value);
  }
  function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function updateCharacterCount(inputId, countId, maxChars) {
    const input = document.getElementById(inputId);
    const count = document.getElementById(countId);
    if (input && count) count.textContent = `${(input.value || '').length} / ${maxChars}`;
  }
  function bindCharacterLimit(input, count, maxChars, label) {
    const update = () => {
      if (input && count) count.textContent = `${(input.value || '').length} / ${maxChars}`;
    };
    input?.addEventListener('beforeinput', e => {
      if (e.inputType && e.inputType.startsWith('delete')) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      const nextLength = input.value.length - (end - start) + (e.data?.length || 0);
      if (nextLength > maxChars) {
        e.preventDefault();
        alert(`${label} cannot exceed ${maxChars} characters.`);
      }
    });
    input?.addEventListener('input', () => {
      if (input.value.length > maxChars) {
        input.value = input.value.slice(0, maxChars);
        alert(`${label} cannot exceed ${maxChars} characters.`);
      }
      update();
    });
    update();
  }
  function updateLogoPreview(url, label = 'Current photo saved') {
    updateSavedImagePreview({
      previewId: 'lt-current-photo',
      imageId: 'lt-current-photo-img',
      textId: 'lt-current-photo-text',
      emptyId: 'lt-current-photo-empty'
    }, url, label);
  }
  function updateCompanyLogoPreview(url, label = 'Current logo saved') {
    updateSavedImagePreview({
      previewId: 'lt-company-logo-current',
      imageId: 'lt-company-logo-current-img',
      textId: 'lt-company-logo-current-text',
      emptyId: 'lt-company-logo-empty'
    }, url, label);
  }
  function updateSavedImagePreview(ids, url, label) {
    const preview = document.getElementById(ids.previewId);
    const image = document.getElementById(ids.imageId);
    const text = document.getElementById(ids.textId);
    const empty = document.getElementById(ids.emptyId);
    const value = String(url || '').trim();
    if (!preview || !image || !empty) return;
    if (value) {
      image.src = value;
      if (text) text.textContent = label;
      preview.hidden = false;
      empty.hidden = true;
    } else {
      image.removeAttribute('src');
      preview.hidden = true;
      empty.hidden = false;
    }
  }
  function getPublicLinkRenderEntries(links = []) {
    const seen = new Set();
    return (links || []).reduce((acc, link) => {
      if (!link?.url) return acc;
      if (link.hidden) return acc;
      const inferredLabel = inferLabel(link.url, link.label || link.url);
      if (inferredLabel === 'Call' || /^tel:/i.test(link.url)) return acc;
      const key = `${inferredLabel.toLowerCase()}::${String(link.url).trim().toLowerCase()}`;
      if (seen.has(key)) return acc;
      seen.add(key);
      acc.push({ url: link.url, label: inferredLabel });
      return acc;
    }, []);
  }
  function renderLinks(containerId, links) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    const visibleLinks = getPublicLinkRenderEntries(links);
    wrap.innerHTML = '';
    if (!visibleLinks.length) {
      wrap.innerHTML = '<div class="lt-note lt-center">No links yet.</div>';
      return;
    }
    visibleLinks.forEach(link => {
      const a = document.createElement('a');
      a.href = link.url;
      a.textContent = link.label;
      a.className = 'lt-link';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      wrap.appendChild(a);
    });
  }
  function showStatus(id, message) {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  }
  function showStatusEl(el, message, type = '') {
    if (!el) return;
    el.textContent = message;
    el.className = 'lt-status';
    if (type) el.classList.add(type);
  }

  function loadLocalProfile(slug) {
    if (!slug) return null;
    try {
      const profile = JSON.parse(localStorage.getItem(localProfileKey(slug)) || 'null');
      const links = Array.isArray(profile?.links) ? profile.links : [];
      return { profile, links };
    } catch {
      return null;
    }
  }

  /* Avatar file handling */
  const avatarFile = document.getElementById('lt-avatar-file');
  const avatarUrlInput = document.getElementById('lt-avatar-url');
  avatarFile?.addEventListener('change', async () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 900 * 1024, 900);
      avatarUrlInput.value = dataUrl;
      showStatusEl(document.getElementById('lt-save-status'), 'Image optimized.', 'success');
    } catch (err) {
      showStatusEl(document.getElementById('lt-save-status'), err.message || 'Image failed.', 'error');
      avatarFile.value = '';
    }
  });

  async function compressDataUrl(dataUrl, maxBytes, maxSize) {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.85;
    let outputDataUrl = canvas.toDataURL('image/jpeg', quality);
    while (outputDataUrl.length * 0.75 > maxBytes && quality > 0.4) {
      quality -= 0.05;
      outputDataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    return outputDataUrl;
  }

  async function compressImage(file, maxBytes, maxSize) {
    const blob = await fileToDataURL(file);
    return compressDataUrl(blob, maxBytes, maxSize);
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  }

  /* Pricing calculator on configure page */
  const qtyInput = document.getElementById('quantity');
  const totalDue = document.getElementById('total-due');
  const formatRand = n => 'R' + n.toLocaleString('en-ZA');
  const getUnitPrice = qty => {
    if (qty >= 5) return 499;
    if (qty >= 2) return 549;
    return 599;
  };
  const updateTotal = () => {
    if (!qtyInput || !totalDue) return;
    const qty = Math.max(1, parseInt(qtyInput.value || '1', 10));
    const unit = getUnitPrice(qty);
    const total = qty * unit;
    totalDue.textContent = formatRand(total);
  };
  qtyInput?.addEventListener('input', updateTotal);
  updateTotal();

  // Expose
  window.linktree = {
    renderPublicProfile,
    renderAdmin: async () => {
      hideAdminLoader();
      if (isFileProtocol) {
        showStatusEl(document.getElementById('lt-auth-status'), 'Run over http://, not file://', 'error');
      }
      if (!supabase) {
        showStatusEl(document.getElementById('lt-auth-status'), 'Local mode: data stays on this device.', 'success');
      }
      persistCurrentUser(null);
      updateAdminContextUrl('');
      setAuthOnly(true);
      toggleEditor(false);
      bindAuth();
      bindEditorActions();
      await initSession(false);
    }
  };
})();
