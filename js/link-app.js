// Module version of the link app
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { residueTelemetry } from './supabase-telemetry.js';

(async () => {
  const cfg = window.env || {};
  const isFileProtocol = window.location.protocol === 'file:';
  const qs = new URLSearchParams(window.location.search);

  const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
    ? null
    : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

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
    const overlay = document.getElementById('lt-overlay');
    const finishOverlay = () => overlay?.classList.remove('active');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.classList.add('active');
    }
    if (isFileProtocol) {
      showPlaceholder('Run via http:// (not file://) so Supabase works.');
      finishOverlay();
      return;
    }
    if (!supabase) {
      showPlaceholder('Missing Supabase configuration.');
      finishOverlay();
      return;
    }
    if (!slug) {
      showPlaceholder('No profile yet. Tap manage to add yours.');
      finishOverlay();
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('slug', slug).single();
    if (error || !data) {
      showPlaceholder('Profile not found. Tap manage to create it.');
      finishOverlay();
      return;
    }
    const { data: links } = await supabase.from('links').select('*').eq('profile_id', data.id).order('sort', { ascending: true });
    const { meta, normalLinks } = extractMetaFromLinks(links || []);
    fillPublic(data, meta);
    renderLinks('lt-links', normalLinks || []);
    finishOverlay();
    if (overlay) setTimeout(() => { overlay.style.display = 'none'; }, 220);
  }

  function fillPublic(profile, meta = {}) {
    setTheme(profile.theme || 'dark');
    setText('lt-name', profile.name || 'Your name');
    const includeRole = parseBool(meta.show_role, true);
    const includeBio = parseBool(meta.show_bio, true);
    setText('lt-title', includeRole ? (profile.title || 'Your title') : '');
    setText('lt-bio', includeBio ? (profile.bio || 'Add a short description.') : '');
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
    showStatus('lt-status', message || '');
  }

  /* Admin */
  const USERS_KEY = 'residue_users';
  const CURRENT_USER_KEY = 'residue_current_user';
  const RESET_OTP_KEY = 'residue_reset_otp';
  const LOCAL_PROFILE_KEY_PREFIX = 'residue_link_profile_';
  const META_PREFIX = '__meta__';
  const TEMP_ADMIN_EMAIL = 'mike@residue.com';
  const TEMP_ADMIN_PASSWORD = '123456';
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

  function slugify(value) {
    return (value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  const localProfileKey = slug => `${LOCAL_PROFILE_KEY_PREFIX}${(slug || '').toLowerCase()}`;

  function bindAuth() {
    const loginBtn = document.getElementById('lt-login');
    const signupBtn = document.getElementById('lt-signup');
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

        if (mode === 'login') {
          if (normalizeEmail(emailInput?.value) === normalizeEmail(TEMP_ADMIN_EMAIL) && password === TEMP_ADMIN_PASSWORD) {
            localStorage.setItem(CURRENT_USER_KEY, TEMP_ADMIN_EMAIL);
            residueTelemetry.logAuthEvent({
              action: 'signin',
              outcome: 'success',
              email,
              detail: 'Signed in via temp admin credentials from link-admin.'
            });
            showStatusEl(statusEl, 'Success', 'success');
            toggleEditor(true);
            setAuthOnly(false);
            loadLocalDraft();
            closeResetModal();
            return;
          }

          const users = getLocalUsers();
          const localUser = users.find(u => normalizeEmail(u.email) === email);
          if (localUser) {
            const hash = await sha256Hex(password);
            if (hash !== localUser.passwordHash) {
              residueTelemetry.logAuthEvent({
                action: 'signin',
                outcome: 'failure',
                email,
                detail: 'Incorrect local password on link-admin.'
              });
              return showStatusEl(statusEl, 'Incorrect password.', 'error');
            }

            localStorage.setItem(CURRENT_USER_KEY, localUser.email);
            residueTelemetry.logAuthEvent({
              action: 'signin',
              outcome: 'success',
              email,
              detail: 'Signed in via local account from link-admin.'
            });
            showStatusEl(statusEl, 'Success', 'success');
            toggleEditor(true);
            setAuthOnly(false);
            loadLocalDraft();
            closeResetModal();
            return;
          }
        }

        if (isFileProtocol) return showStatusEl(statusEl, 'Run over http://, not file://', 'error');
        if (!supabase) return showStatusEl(statusEl, mode === 'login' ? 'No matching local account found.' : 'Missing Supabase config', 'error');
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
        showStatusEl(statusEl, 'Success', 'success');
        initSession(true);
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

    loginBtn?.addEventListener('click', () => doAuth('login'));
    signupBtn?.addEventListener('click', () => doAuth('signup'));
  }

  async function ensureProfileRow(user) {
    if (!user) return;
    await supabase.from('profiles').upsert({
      id: user.id,
      name: user.email,
      slug: user.email.split('@')[0],
      theme: 'dark'
    });
  }

  async function initSession(forceLoad = false) {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toggleEditor(false);
      setAuthOnly(true);
    } else if (forceLoad || session) {
      toggleEditor(true);
      loadProfile(session.user);
      setAuthOnly(false);
    }
    supabase.auth.onAuthStateChange((event, sessionNow) => {
      if (sessionNow) {
        toggleEditor(true);
        loadProfile(sessionNow.user);
        setAuthOnly(false);
      } else {
        toggleEditor(false);
        setAuthOnly(true);
      }
    });
  }

  async function loadProfile(user) {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!profile) {
      await ensureProfileRow(user);
    }
    // Fetch links; add hidden default false so toggles work locally
    const { data: links } = await supabase.from('links').select('*').eq('profile_id', user.id).order('sort', { ascending: true });
    const hydratedLinks = (links || []).map(l => ({ ...l, hidden: l.hidden ?? false }));
    fillEditor(profile || {}, hydratedLinks);
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

  function fillEditor(profile, links) {
    setValue('lt-avatar-url', profile.avatar_url || '');
    setValue('full-name', profile.name || '');
    setValue('role', profile.title || '');
    setValue('lt-bio', profile.bio || '');
    setValue('lt-slug', profile.slug || '');
    const publicUrl = `${window.location.origin}${window.location.pathname.replace(/link-admin\\.html$/, 'link-profile.html')}?u=${profile.slug || ''}`;
    const urlEl = document.getElementById('lt-public-url');
    if (urlEl) urlEl.textContent = publicUrl;
    const setToggle = (id, checked = true) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!checked;
    };

    socialConfig.forEach(s => setValue(s.id, ''));
    setValue('website', '');
    setValue('phone', '');
    setValue('email-config', '');
    setValue('whatsapp-number', '');

    const { meta, normalLinks } = extractMetaFromLinks(Array.isArray(links) ? links : []);
    setToggle('show-role', parseBool(meta.show_role, true));
    setToggle('show-bio', parseBool(meta.show_bio, true));
    setToggle('show-website', true);
    setToggle('show-phone', true);
    setToggle('show-email', true);
    setToggle('show-whatsapp', true);
    setToggle('show-slug', parseBool(meta.show_slug, true));
    setToggle('show-whatsapp-template', parseBool(meta.show_whatsapp_template, true));
    setToggle('show-whatsapp-custom', parseBool(meta.show_whatsapp_custom, true));
    socialConfig.forEach(s => setToggle(s.toggle, true));

    normalLinks.forEach(link => {
      const label = (link.label || '').toLowerCase();
      if (label === 'website') {
        setValue('website', link.url || '');
        setToggle('show-website', !link.hidden);
        return;
      }
      if (label === 'call') {
        setValue('phone', (link.url || '').replace(/^tel:/i, ''));
        setToggle('show-phone', !link.hidden);
        return;
      }
      if (label === 'email') {
        setValue('email-config', (link.url || '').replace(/^mailto:/i, ''));
        setToggle('show-email', !link.hidden);
        return;
      }
      if (label === 'whatsapp') {
        setToggle('show-whatsapp', !link.hidden);
        const m = String(link.url || '').match(/^https:\/\/wa\.me\/(\d+)(?:\?text=(.*))?$/i);
        if (m?.[1]) setValue('whatsapp-number', m[1]);
        if (m?.[2]) {
          const msg = decodeURIComponent(m[2]);
          const tpl = document.getElementById('whatsapp-template');
          const custom = document.getElementById('whatsapp-custom');
          if (tpl) {
            const hasOpt = Array.from(tpl.options).some(o => o.value === msg);
            tpl.value = hasOpt ? msg : 'CUSTOM';
          }
          if (custom && (!tpl || tpl.value === 'CUSTOM')) custom.value = msg;
        }
        return;
      }
      const socialIdx = socialConfig.findIndex(s => s.label.toLowerCase() === label);
      if (socialIdx >= 0) {
        const social = socialConfig[socialIdx];
        setValue(social.id, link.url || '');
        setToggle(social.toggle, !link.hidden);
      }
    });

    const waCustom = document.getElementById('whatsapp-custom');
    const waTemplate = document.getElementById('whatsapp-template');
    if (waCustom && waTemplate) {
      const isCustom = waTemplate.value === 'CUSTOM';
      waCustom.style.display = isCustom ? 'block' : 'none';
      if (!isCustom) waCustom.value = '';
    }
  }

  function buildWhatsappLink() {
    const numInput = document.getElementById('whatsapp-number');
    const templateSelect = document.getElementById('whatsapp-template');
    const customMsg = document.getElementById('whatsapp-custom')?.value.trim();
    const showWhatsapp = document.getElementById('show-whatsapp');
    const showTemplate = document.getElementById('show-whatsapp-template');
    const showCustom = document.getElementById('show-whatsapp-custom');
    const rawNumber = (numInput?.value || '').replace(/[^\d]/g, '');
    if (!rawNumber) return null;
    if (showWhatsapp && !showWhatsapp.checked) {
      return {
        label: 'WhatsApp',
        url: `https://wa.me/${rawNumber}`,
        hidden: true
      };
    }
    const selected = templateSelect?.value || '';
    let text = '';
    if (!showTemplate || showTemplate.checked) {
      if (selected === 'CUSTOM') {
        if (!showCustom || showCustom.checked) text = customMsg || '';
      } else {
        text = selected || '';
      }
    }
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
      if (!raw) return;
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const show = document.getElementById(social.toggle);
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
    linksOut.push(metaLink('show_whatsapp_template', document.getElementById('show-whatsapp-template')?.checked ?? true, linksOut.length));
    linksOut.push(metaLink('show_whatsapp_custom', document.getElementById('show-whatsapp-custom')?.checked ?? true, linksOut.length));

    return linksOut;
  }

  function bindEditorActions() {
    const logoInput = document.getElementById('logo');
    const avatarUrlInput = document.getElementById('lt-avatar-url');
    const saveStatusEl = document.getElementById('lt-save-status');
    const waTemplate = document.getElementById('whatsapp-template');
    const waCustom = document.getElementById('whatsapp-custom');

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
        // Compress to <=700KB and max 900px on the largest side
        const optimized = await compressImage(file, 700 * 1024, 900);
        if (avatarUrlInput) avatarUrlInput.value = optimized;
        showStatusEl(saveStatusEl, 'Logo optimized.', 'success');
      } catch (err) {
        showStatusEl(saveStatusEl, err.message || 'Could not process logo.', 'error');
        logoInput.value = '';
      }
    };
    logoInput?.addEventListener('change', handleLogoChange);
    const toggleWaCustom = () => {
      if (!waTemplate || !waCustom) return;
      const isCustom = waTemplate.value === 'CUSTOM';
      waCustom.style.display = isCustom ? 'block' : 'none';
      if (!isCustom) waCustom.value = '';
    };
    waTemplate?.addEventListener('change', toggleWaCustom);
    toggleWaCustom();

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

        const profile = collectProfilePayload(session?.user?.id || CURRENT_USER_KEY);
        if (!profile.name) return showStatusEl(statusEl, 'Name is required.', 'error');
        if (!profile.slug) return showStatusEl(statusEl, 'Slug / URL is required.', 'error');
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
            const supaLinks = links.map(l => ({
              label: l.label,
              url: l.url,
              hidden: !!l.hidden,
              sort: l.sort,
              profile_id: session.user.id
            }));
            await supabase.from('links').insert(supaLinks);
          }
        }

        const localProfile = {
          name: profile.name,
          title: profile.title,
          bio: profile.bio,
          avatar_url: profile.avatar_url,
          theme: profile.theme,
          slug: profile.slug,
          links
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
  function collectProfilePayload(userId) {
    const name = getValue('full-name') || getValue('lt-name');
    const slug = getValue('lt-slug') || slugify(name || getValue('email-config'));
    const title = getValue('role') || getValue('lt-title');
    const bio = getValue('lt-bio');
    const avatar_url = getValue('lt-avatar-url');
    const theme = document.querySelector('input[name="lt-theme"]:checked')?.value || 'dark';
    return { id: userId, name, slug, title, bio, avatar_url, theme };
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
      a.textContent = l.label || l.url;
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

  async function compressImage(file, maxBytes, maxSize) {
    const blob = await fileToDataURL(file);
    const img = await loadImage(blob);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.85;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length * 0.75 > maxBytes && quality > 0.4) {
      quality -= 0.05;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    return dataUrl;
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
        showStatusEl(document.getElementById('lt-auth-status'), 'Supabase not configured. Local account login is still available.', 'success');
      }
      localStorage.removeItem(CURRENT_USER_KEY);
      setAuthOnly(true);
      toggleEditor(false);
      bindAuth();
      bindEditorActions();
    }
  };
})();
