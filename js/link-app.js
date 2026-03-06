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

  const setTheme = theme => document.body.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
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
    const { data, error } = await supabase.from('profiles').select('*').eq('slug', slug).single();
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
    finishOverlay();
    if (overlay) setTimeout(() => { overlay.style.display = 'none'; }, 220);
  }

  function fillPublic(profile, meta = {}) {
    setTheme(profile.theme || 'dark');
    setText('lt-name', profile.name || 'Your name');
    const includeRole = parseBool(meta.show_role, true);
    const includeBio = parseBool(meta.show_bio, true);
    setText('lt-title', includeRole ? (profile.title || '') : '');
    setText('lt-bio', includeBio ? (profile.bio || '') : '');
    const avatar = document.getElementById('lt-avatar');
    if (avatar) avatar.src = profile.avatar_url || 'https://placehold.co/200x200?text=Add+photo';
    const pill = document.getElementById('lt-theme-pill');
    if (pill) {
      pill.hidden = false;
      pill.textContent = (profile.theme || 'dark') === 'light' ? 'Light' : 'Dark';
    }
  }

  function showPlaceholder(message) {
    setTheme('dark');
    setText('lt-name', 'Your name');
    setText('lt-title', 'Your title');
    setText('lt-bio', 'Add a short description.');
    const avatar = document.getElementById('lt-avatar');
    if (avatar) avatar.src = 'https://placehold.co/200x200?text=Add+photo';
    renderLinks('lt-links', []);
    setupContactDownload({}, []);
    showStatus('lt-status', message || '');
  }

  /* Admin */
  const USERS_KEY = 'residue_users';
  const CURRENT_USER_KEY = 'residue_current_user';
  const RESET_OTP_KEY = 'residue_reset_otp';
  const LOCAL_PROFILE_KEY_PREFIX = 'residue_link_profile_';
  const META_PREFIX = '__meta__';
  const WHATSAPP_MESSAGE_MAX_CHARS = 180;
  let authStateSubscription = null;
  const contactDownloadState = { name: '', phone: '' };
  let contactDownloadBound = false;
  const socialConfig = [
    { id: 'social', label: 'LinkedIn', toggle: 'show-social' },
    { id: 'social-2', label: 'Instagram', toggle: 'show-social-2' },
    { id: 'social-3', label: 'WhatsApp Social', toggle: 'show-social-3' },
    { id: 'social-4', label: 'YouTube', toggle: 'show-social-4' },
    { id: 'social-5', label: 'Facebook', toggle: 'show-social-5' },
    { id: 'social-6', label: 'X', toggle: 'show-social-6' }
  ];

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
      if (host.includes('whatsapp') || host.includes('wa.me')) return 'WhatsApp';
      if (host.includes('youtube')) return 'YouTube';
      if (host.includes('facebook')) return 'Facebook';
      if (host.includes('x.com') || host.includes('twitter')) return 'X';
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

function ensureLocalDraftForUser(user) {
  if (!user?.email) return;
  const email = normalizeEmail(user.email);
  const slug = resolveSlug(email.split('@')[0], email) || 'card';
  const key = localProfileKey(slug);
  const existing = localStorage.getItem(key);
  if (existing) {
    localStorage.setItem('residue_link_last_profile_key', key);
    return;
  }
  const profile = {
    name: email,
    title: '',
    bio: '',
    avatar_url: '',
    theme: 'dark',
    slug,
    links: [
      { label: 'Call', url: 'tel:+', sort: 1, hidden: true },
      { label: 'Email', url: `mailto:${email}`, sort: 2, hidden: false }
    ]
  };
  localStorage.setItem(key, JSON.stringify(profile));
  localStorage.setItem('residue_link_last_profile_key', key);
}

  function deriveDisplayName(profileName, user) {
    const fromProfile = String(profileName || '').trim();
    if (fromProfile && !fromProfile.includes('@')) return fromProfile;
    const fromMeta = String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim();
    if (fromMeta) return fromMeta;
    if (fromProfile) return fromProfile;
    const emailPrefix = String(user?.email || '').split('@')[0] || '';
    return emailPrefix.replace(/[._-]+/g, ' ').trim();
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

  function updateAdminContextUrl(slug) {
    const nextUrl = buildAdminContextUrl(slug);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, '', nextUrl);
    }
  }

  function updatePublicUrl(slug) {
    const urlEl = document.getElementById('lt-public-url');
    if (!urlEl) return;
    const publicUrl = buildPublicProfileUrl(slug);
    urlEl.textContent = publicUrl;
  }

  function syncAutoSlug(nameValue, fallbackSource = '') {
    const generatedSlug = resolveSlug(nameValue, fallbackSource);
    setText('lt-slug-display', buildPublicProfileUrl(generatedSlug || ''));
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
    const sendOtpBtn = document.getElementById('lt-send-otp');
    const otpInput = document.getElementById('lt-reset-otp');
    const resetPass = document.getElementById('lt-reset-pass');
    const resetConfirm = document.getElementById('lt-reset-confirm');
    const resetSubmit = document.getElementById('lt-reset-submit');
    const resetStatus = document.getElementById('lt-reset-status');

    const openResetModal = () => {
      if (!resetModal) return;
      resetModal.hidden = false;
      document.body.style.overflow = 'hidden';
      showStatusEl(resetStatus, '', '');
      const currentEmail = emailInput?.value?.trim() || '';
      if (resetEmail && currentEmail) resetEmail.value = currentEmail;
      setTimeout(() => resetEmail?.focus(), 0);
    };

    const closeResetModal = () => {
      if (!resetModal) return;
      resetModal.hidden = true;
      document.body.style.overflow = '';
    };

    forgotToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      openResetModal();
    });
    resetCloseEls?.forEach(el => el.addEventListener('click', closeResetModal));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !resetModal?.hidden) closeResetModal();
    });

    sendOtpBtn?.addEventListener('click', () => {
      const email = normalizeEmail(resetEmail?.value);
      if (!email) return showStatusEl(resetStatus, 'Enter your account email.', 'error');
      const users = getLocalUsers();
      const user = users.find(u => normalizeEmail(u.email) === email);
      if (!user) return showStatusEl(resetStatus, 'No account found for that email.', 'error');

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const payload = { email, otp, expiresAt: Date.now() + (10 * 60 * 1000) };
      sessionStorage.setItem(RESET_OTP_KEY, JSON.stringify(payload));
      showStatusEl(resetStatus, `OTP sent to ${email}. Demo OTP: ${otp}`, 'success');
    });

    resetSubmit?.addEventListener('click', async () => {
      const email = normalizeEmail(resetEmail?.value);
      const otp = (otpInput?.value || '').trim();
      const nextPassword = resetPass?.value || '';
      const confirmPassword = resetConfirm?.value || '';

      if (!email || !otp || !nextPassword || !confirmPassword) {
        return showStatusEl(resetStatus, 'Complete all reset fields.', 'error');
      }
      if (nextPassword.length < 6) return showStatusEl(resetStatus, 'Password must be at least 6 characters.', 'error');
      if (nextPassword !== confirmPassword) return showStatusEl(resetStatus, 'Passwords do not match.', 'error');

      let payload = null;
      try {
        payload = JSON.parse(sessionStorage.getItem(RESET_OTP_KEY) || 'null');
      } catch {
        payload = null;
      }

      if (!payload) return showStatusEl(resetStatus, 'Request a new OTP first.', 'error');
      if (payload.email !== email) return showStatusEl(resetStatus, 'OTP email does not match.', 'error');
      if (payload.otp !== otp) return showStatusEl(resetStatus, 'Invalid OTP.', 'error');
      if (Date.now() > payload.expiresAt) return showStatusEl(resetStatus, 'OTP expired. Request a new one.', 'error');

      const users = getLocalUsers();
      const idx = users.findIndex(u => normalizeEmail(u.email) === email);
      if (idx < 0) return showStatusEl(resetStatus, 'Account not found.', 'error');

      users[idx].passwordHash = await sha256Hex(nextPassword);
      users[idx].updatedAt = new Date().toISOString();
      saveLocalUsers(users);
      sessionStorage.removeItem(RESET_OTP_KEY);

      if (passInput) passInput.value = '';
      if (emailInput) emailInput.value = email;
      if (otpInput) otpInput.value = '';
      if (resetPass) resetPass.value = '';
      if (resetConfirm) resetConfirm.value = '';
      showStatusEl(resetStatus, 'Password reset. You can sign in now.', 'success');
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
    persistCurrentUser(user);
    showStatusEl(statusEl, 'Signed in (local)', 'success');
    toggleEditor(true);
    ensureLocalDraftForUser(user);
    loadLocalDraft();
    setAuthOnly(false);
  }

  async function startSupabaseSession(user, statusEl) {
    if (!user) throw new Error('Signed in, but no user was returned.');
    persistCurrentUser(user);
    toggleEditor(true);
    setAuthOnly(false);
    showStatusEl(statusEl, 'Signed in.', 'success');
    try {
      await loadProfile(user);
    } catch (err) {
      console.error('Profile load failed after direct sign-in', err);
      showStatusEl(document.getElementById('lt-save-status'), 'Signed in, but profile data failed to load.', 'error');
      loadLocalDraft();
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
              options: { emailRedirectTo: `${window.location.origin}/link-admin.html` }
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
          initSession(true).catch(err => {
            console.error('Session refresh failed after direct sign-in', err);
          });
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
    const fallbackSlug = resolveSlug(emailPrefix, authEmail) || `user-${String(user.id || '').replace(/-/g, '').slice(0, 8)}`;
    await supabase.from('profiles').upsert({
      id: user.id,
      auth_email: authEmail || null,
      name: user.email,
      slug: fallbackSlug,
      theme: 'dark'
    });
  }

  async function initSession(forceLoad = false) {
    if (!supabase) {
      // Local/demo mode: if a local user exists, show editor with local draft
      const localUser = readStoredCurrentUser();
      if (localUser) {
        toggleEditor(true);
        loadLocalDraft();
        setAuthOnly(false);
        return;
      }
      toggleEditor(false);
      setAuthOnly(true);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toggleEditor(false);
      setAuthOnly(true);
    } else if (forceLoad || session) {
      persistCurrentUser(session.user);
      toggleEditor(true);
      setAuthOnly(false);
      try {
        await loadProfile(session.user);
      } catch (err) {
        console.error('Profile load failed after session init', err);
        showStatusEl(document.getElementById('lt-save-status'), 'Signed in, but profile data failed to load.', 'error');
        loadLocalDraft();
      }
    }
    if (authStateSubscription) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sessionNow) => {
      if (sessionNow) {
        persistCurrentUser(sessionNow.user);
        toggleEditor(true);
        setAuthOnly(false);
        loadProfile(sessionNow.user).catch(err => {
          console.error('Profile load failed on auth state change', err);
          showStatusEl(document.getElementById('lt-save-status'), 'Signed in, but profile data failed to load.', 'error');
          loadLocalDraft();
        });
      } else {
        persistCurrentUser(null);
        toggleEditor(false);
        setAuthOnly(true);
      }
    });
    authStateSubscription = subscription;
  }

  async function loadProfile(user) {
    let { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!profile) {
      await ensureProfileRow(user);
      ({ data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single());
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
    const { meta, normalLinks } = extractMetaFromLinks(effectiveLinks || []);
    const hydratedLinks = (normalLinks || []).map(l => ({ ...l, hidden: parseBool(meta[`hidden_${l.sort}`], false) }));
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
      fillEditor(profile, links);
    }
  }

  function fillEditor(profile, links, user = null, snapshot = null) {
    const snapshotFields = snapshot?.fields || {};
    const displayName = deriveDisplayName(profile?.name, user);
    const savedTitle = typeof snapshotFields.role === 'string' ? snapshotFields.role : '';
    const savedBio = typeof snapshotFields['lt-bio'] === 'string' ? snapshotFields['lt-bio'] : '';
    setValue('lt-avatar-url', profile.avatar_url || '');
    setValue('full-name', displayName || '');
    setValue('role', savedTitle || profile.title || '');
    setValue('lt-bio', savedBio || profile.bio || '');
    syncAutoSlug(displayName || '', profile.auth_email || displayName || profile.name || '');
    const setToggle = (id, checked = true) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!checked;
    };

    socialConfig.forEach(s => setValue(s.id, ''));
    setValue('website', '');
    setValue('phone', '');
    setValue('email-config', '');
    setValue('whatsapp-number', '');
    setValue('whatsapp-message', '');

    const { meta, normalLinks } = extractMetaFromLinks(Array.isArray(links) ? links : []);
    const hasMeta = key => Object.prototype.hasOwnProperty.call(meta, key);
    const parseToggleMeta = (key, fallback = true) => parseBool(meta[key], fallback);

    const fallbackShowRole = snapshotFields['show-role'];
    const fallbackShowBio = snapshotFields['show-bio'];
    setToggle('show-role', hasMeta('show_role') ? parseBool(meta.show_role, true) : parseBool(fallbackShowRole, true));
    setToggle('show-bio', hasMeta('show_bio') ? parseBool(meta.show_bio, true) : parseBool(fallbackShowBio, true));
    setToggle('show-slug', parseBool(meta.show_slug, true));
    setToggle('show-website', parseToggleMeta('show_website', true));
    setToggle('show-phone', parseToggleMeta('show_phone', true));
    setToggle('show-email', parseToggleMeta('show_email', true));
    setToggle('show-whatsapp', parseToggleMeta('show_whatsapp', true));
    const legacyShowTemplate = parseToggleMeta('show_whatsapp_template', true);
    const legacyShowCustom = parseToggleMeta('show_whatsapp_custom', true);
    setToggle('show-whatsapp-message', parseToggleMeta('show_whatsapp_message', legacyShowTemplate && legacyShowCustom));
    socialConfig.forEach(s => {
      const toggleKey = s.toggle.replace(/-/g, '_');
      setToggle(s.toggle, parseToggleMeta(toggleKey, true));
    });
    if (hasMeta('whatsapp_number')) setValue('whatsapp-number', meta.whatsapp_number || '');
    const legacyMessage = meta.whatsapp_custom || meta.whatsapp_template || '';
    if (hasMeta('whatsapp_message')) setValue('whatsapp-message', meta.whatsapp_message || '');
    else if (legacyMessage) setValue('whatsapp-message', legacyMessage);

    normalLinks.forEach(link => {
      const label = (link.label || '').toLowerCase();
      if (label === 'website') {
        setValue('website', link.url || '');
        if (!hasMeta('show_website')) setToggle('show-website', !link.hidden);
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

    const waMessage = document.getElementById('whatsapp-message');
    const waCount = document.getElementById('whatsapp-message-count');
    if (waMessage && waCount) {
      waCount.textContent = `${(waMessage.value || '').length} / ${WHATSAPP_MESSAGE_MAX_CHARS}`;
    }
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
    const sp = document.getElementById('show-phone');
    const se = document.getElementById('show-email');
    const website = getValue('website');
    const phone = getValue('phone');
    const email = getValue('email-config');
    if (website) linksOut.push({ label: 'Website', url: website.startsWith('http') ? website : `https://${website}`, hidden: sw ? !sw.checked : false, sort: linksOut.length });
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

    linksOut.push(metaLink('show_role', document.getElementById('show-role')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_bio', document.getElementById('show-bio')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_slug', document.getElementById('show-slug')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_website', document.getElementById('show-website')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_phone', document.getElementById('show-phone')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_email', document.getElementById('show-email')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_whatsapp', document.getElementById('show-whatsapp')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_whatsapp_message', document.getElementById('show-whatsapp-message')?.checked ?? true, linksOut.length));
    socialConfig.forEach(social => {
      const toggleKey = social.toggle.replace(/-/g, '_');
      linksOut.push(metaLink(toggleKey, document.getElementById(social.toggle)?.checked ?? true, linksOut.length));
    });
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
      let dragOffsetX = 0;
      let dragOffsetY = 0;
      let imageRect = { left: 0, top: 0, width: 0, height: 0 };
      const box = { left: 0, top: 0, size: 0 };

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
        stage.removeEventListener('pointermove', onPointerMove);
        stage.removeEventListener('pointerup', onPointerUp);
        stage.removeEventListener('pointercancel', onPointerUp);
        resolve(result);
      };

      const clampBox = () => {
        const maxLeft = imageRect.left + imageRect.width - box.size;
        const maxTop = imageRect.top + imageRect.height - box.size;
        box.left = Math.max(imageRect.left, Math.min(box.left, maxLeft));
        box.top = Math.max(imageRect.top, Math.min(box.top, maxTop));
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
          box.size = Math.min(box.size, Math.floor(Math.min(width, height)));
          clampBox();
        }
        renderBox();
      };

      const onPointerDown = event => {
        event.preventDefault();
        dragging = true;
        dragOffsetX = event.clientX - box.left;
        dragOffsetY = event.clientY - box.top;
        boxEl.setPointerCapture?.(event.pointerId);
      };

      const onPointerMove = event => {
        if (!dragging) return;
        const stageRect = stage.getBoundingClientRect();
        box.left = event.clientX - stageRect.left - dragOffsetX;
        box.top = event.clientY - stageRect.top - dragOffsetY;
        clampBox();
        renderBox();
      };

      const onPointerUp = event => {
        dragging = false;
        boxEl.releasePointerCapture?.(event.pointerId);
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
      stage.addEventListener('pointermove', onPointerMove);
      stage.addEventListener('pointerup', onPointerUp);
      stage.addEventListener('pointercancel', onPointerUp);
      updateLayout();
    });
  }

  function bindEditorActions() {
    const fullNameInput = document.getElementById('full-name');
    const logoInput = document.getElementById('logo');
    const avatarUrlInput = document.getElementById('lt-avatar-url');
    const saveStatusEl = document.getElementById('lt-save-status');
    const waMessage = document.getElementById('whatsapp-message');
    const waMessageCount = document.getElementById('whatsapp-message-count');

    fullNameInput?.addEventListener('input', () => {
      syncAutoSlug(fullNameInput.value, getValue('email-config'));
    });

    const handleLogoChange = async () => {
      const file = logoInput?.files?.[0];
      if (!file) {
        if (avatarUrlInput) avatarUrlInput.value = '';
        return;
      }
      if (!(file.type || '').startsWith('image/')) {
        showStatusEl(saveStatusEl, 'Logo must be an image.', 'error');
        logoInput.value = '';
        return;
      }
      try {
        const cropped = await cropImageWithModal(file);
        if (!cropped) {
          showStatusEl(saveStatusEl, 'Logo selection canceled.', 'error');
          logoInput.value = '';
          return;
        }
        const optimized = await compressDataUrl(cropped, 700 * 1024, 900);
        if (avatarUrlInput) avatarUrlInput.value = optimized;
        showStatusEl(saveStatusEl, 'Logo optimized.', 'success');
      } catch (err) {
        showStatusEl(saveStatusEl, err.message || 'Could not process logo.', 'error');
        logoInput.value = '';
      }
    };
    logoInput?.addEventListener('change', handleLogoChange);
    const updateWaMessageCount = () => {
      if (!waMessage || !waMessageCount) return;
      waMessageCount.textContent = `${waMessage.value.length} / ${WHATSAPP_MESSAGE_MAX_CHARS}`;
    };
    waMessage?.addEventListener('beforeinput', e => {
      if (!waMessage) return;
      if (e.inputType && e.inputType.startsWith('delete')) return;
      const start = waMessage.selectionStart ?? waMessage.value.length;
      const end = waMessage.selectionEnd ?? waMessage.value.length;
      const nextLength = waMessage.value.length - (end - start) + (e.data?.length || 0);
      if (nextLength > WHATSAPP_MESSAGE_MAX_CHARS) {
        e.preventDefault();
        alert(`WhatsApp message cannot exceed ${WHATSAPP_MESSAGE_MAX_CHARS} characters.`);
      }
    });
    waMessage?.addEventListener('input', () => {
      if (!waMessage) return;
      if (waMessage.value.length > WHATSAPP_MESSAGE_MAX_CHARS) {
        waMessage.value = waMessage.value.slice(0, WHATSAPP_MESSAGE_MAX_CHARS);
        alert(`WhatsApp message cannot exceed ${WHATSAPP_MESSAGE_MAX_CHARS} characters.`);
      }
      updateWaMessageCount();
    });
    updateWaMessageCount();

    const saveBtn = document.getElementById('lt-save');
    const statusEl = document.getElementById('lt-save-status');
    saveBtn?.addEventListener('click', async evt => {
      evt.preventDefault();
      try {
        let session = null;
        if (supabase) {
          ({ data: { session } } = await supabase.auth.getSession());
          if (!session) return showStatusEl(statusEl, 'Not signed in.', 'error');
        }

        const profile = collectProfilePayload(session?.user || null);
        if (!profile.name) return showStatusEl(statusEl, 'Name is required.', 'error');
        const links = collectLinks();
        showStatusEl(statusEl, 'Saving...', 'loading');

        if (supabase && session) {
          const { error: pErr } = await supabase.from('profiles').upsert(profile);
          if (pErr) {
            showStatusEl(statusEl, pErr.message, 'error');
            return;
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
              showStatusEl(statusEl, lErr.message, 'error');
              return;
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
            showStatusEl(statusEl, cErr.message, 'error');
            return;
          }
        }

        const localProfile = {
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

        showStatusEl(statusEl, 'Saved. Redirecting...', 'success');
        const target = `${window.location.origin}/link-profile.html?u=${encodeURIComponent(profile.slug)}`;
        setTimeout(() => { window.location.href = target; }, 500);
      } catch (err) {
        console.error(err);
        showStatusEl(statusEl, err.message || 'Save failed.', 'error');
      }
    });
  }
  function collectProfilePayload(user) {
    const name = getValue('full-name') || getValue('lt-name');
    const slug = resolveSlug(name, getValue('email-config') || normalizeEmail(user?.email));
    const title = getValue('role') || getValue('lt-title');
    const bio = getValue('lt-bio');
    const avatar_url = getValue('lt-avatar-url');
    const theme = document.querySelector('input[name="lt-theme"]:checked')?.value || 'dark';
    const auth_email = normalizeEmail(user?.email);
    const id = user?.id || CURRENT_USER_KEY;
    return { id, auth_email: auth_email || null, name, slug, title, bio, avatar_url, theme };
  }

  /* Helpers */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function renderLinks(containerId, links) {
    const wrap = document.getElementById(containerId);
    wrap.innerHTML = '';
    if (!links.length) {
      wrap.innerHTML = '<div class="lt-note lt-center">No links yet.</div>';
      return;
    }
    links.forEach(l => {
      if (!l.url) return;
      if (l.hidden) return;
      const a = document.createElement('a');
      a.href = l.url;
      a.textContent = inferLabel(l.url, l.label || l.url);
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
    renderAdmin: () => {
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
    }
  };
})();
