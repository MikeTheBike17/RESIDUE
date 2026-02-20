// Module version of the link app
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

(async () => {
  const cfg = window.env || {};
  const MAX_LINKS = 5;
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
    const overlayMin = 3000;
    const start = performance.now();
    const finishOverlay = () => {
      if (!overlay) return;
      const elapsed = performance.now() - start;
      const remaining = Math.max(0, overlayMin - elapsed);
      setTimeout(() => overlay.classList.remove('active'), remaining);
    };
    if (overlay) overlay.classList.add('active');
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
    fillPublic(data);
    const { data: links } = await supabase.from('links').select('*').eq('profile_id', data.id).order('sort', { ascending: true });
    renderLinks('lt-links', links || []);
    finishOverlay();
  }

  function fillPublic(profile) {
    setTheme(profile.theme || 'dark');
    setText('lt-name', profile.name || 'Your name');
    setText('lt-title', profile.title || 'Your title');
    setText('lt-bio', profile.bio || 'Add a short description.');
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
  function bindAuth() {
    const loginBtn = document.getElementById('lt-login');
    const signupBtn = document.getElementById('lt-signup');
    const emailInput = document.getElementById('lt-auth-email');
    const passInput = document.getElementById('lt-auth-pass');
    const statusEl = document.getElementById('lt-auth-status');

    const doAuth = async mode => {
      try {
        if (isFileProtocol) return showStatusEl(statusEl, 'Run over http://, not file://', 'error');
        if (!supabase) return showStatusEl(statusEl, 'Missing Supabase config', 'error');
        const email = emailInput.value.trim();
        const password = passInput.value.trim();
        if (!email || !password) return showStatusEl(statusEl, 'Enter email and password', 'error');
        showStatusEl(statusEl, mode === 'login' ? 'Logging in…' : 'Creating account…', 'loading');
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
          return showStatusEl(statusEl, 'Check your email to confirm, then log in.', 'success');
        }
        showStatusEl(statusEl, 'Success', 'success');
        initSession(true);
      } catch (err) {
        console.error('Auth error', err);
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
    const { data: links } = await supabase.from('links').select('*').eq('profile_id', user.id).order('sort', { ascending: true });
    fillEditor(profile || {}, links || []);
    const codeRow = await fetchOrCreateCode(user.id);
    renderCodePanel(codeRow);
  }

  function toggleEditor(show) {
    document.getElementById('lt-auth-card').hidden = show;
    document.getElementById('lt-editor').hidden = !show;
  }

  function fillEditor(profile, links) {
    setValue('lt-avatar-url', profile.avatar_url || '');
    setValue('lt-name', profile.name || '');
    setValue('lt-title', profile.title || '');
    setValue('lt-bio', profile.bio || '');
    setValue('lt-slug', profile.slug || '');
    document.querySelectorAll('input[name="lt-theme"]').forEach(r => {
      r.checked = (profile.theme || 'dark') === r.value;
    });
    const publicUrl = `${window.location.origin}${window.location.pathname.replace(/link-admin\\.html$/, 'link-profile.html')}?u=${profile.slug || ''}`;
    const urlEl = document.getElementById('lt-public-url');
    if (urlEl) urlEl.textContent = publicUrl;
    renderLinkEditor(links);
  }

  function renderLinkEditor(links) {
    const wrap = document.getElementById('lt-links-editor');
    if (!wrap) return;
    wrap.innerHTML = '';
    (links || []).slice(0, MAX_LINKS).forEach((link, i) => {
      wrap.appendChild(linkRow(link.label, link.url, i));
    });
    for (let i = (links || []).length; i < MAX_LINKS; i++) {
      wrap.appendChild(linkRow('', '', i));
    }
  }

  function linkRow(label, url, index) {
    const div = document.createElement('div');
    div.className = 'lt-link-row';
    div.innerHTML = `
      <input class="lt-input" placeholder="Label" value="${label || ''}" data-idx="${index}" data-field="label">
      <input class="lt-input" placeholder="https://link" value="${url || ''}" data-idx="${index}" data-field="url">
    `;
    return div;
  }

  function collectLinks() {
    const inputs = Array.from(document.querySelectorAll('.lt-link-row input'));
    const grouped = {};
    inputs.forEach(input => {
      const idx = input.dataset.idx;
      const field = input.dataset.field;
      grouped[idx] = grouped[idx] || { label: '', url: '' };
      grouped[idx][field] = input.value.trim();
    });
    return Object.values(grouped)
      .filter(l => l.label || l.url)
      .map(link => {
        let url = link.url || '';
        if (url && !/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }
        let label = link.label;
        if (!label && url) {
          try {
            const u = new URL(url);
            const host = u.hostname.replace('www.', '');
            const base = host.split('.')[0] || 'Link';
            label = base.charAt(0).toUpperCase() + base.slice(1);
          } catch {
            label = 'Link';
          }
        }
        return { label: label || 'Link', url };
      })
      .filter(l => l.url)
      .slice(0, MAX_LINKS)
      .map((l, i) => ({ ...l, sort: i }));
  }

  function bindEditorActions() {
    const addBtn = document.getElementById('lt-add-link');
    addBtn?.addEventListener('click', () => {
      const wrap = document.getElementById('lt-links-editor');
      const existing = wrap.querySelectorAll('.lt-link-row').length;
      if (existing >= MAX_LINKS) return;
      wrap.appendChild(linkRow('', '', existing));
    });

    const saveBtn = document.getElementById('lt-save');
    const statusEl = document.getElementById('lt-save-status');
    saveBtn?.addEventListener('click', async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return showStatusEl(statusEl, 'Not signed in.', 'error');
        const profile = collectProfilePayload(session.user.id);
        if (!profile.name) return showStatusEl(statusEl, 'Name is required.', 'error');
        if (!profile.slug) return showStatusEl(statusEl, 'Slug / URL is required.', 'error');
        const links = collectLinks();
        showStatusEl(statusEl, 'Saving…', 'loading');
        const { error: pErr } = await supabase.from('profiles').upsert(profile);
        if (pErr) {
          showStatusEl(statusEl, pErr.message, 'error');
          return;
        }
        await supabase.from('links').delete().eq('profile_id', session.user.id);
        if (links.length) {
          await supabase.from('links').insert(links.map(l => ({ ...l, profile_id: session.user.id })));
        }
        showStatusEl(statusEl, 'Saved. Redirecting…', 'success');
        const target = `${window.location.origin}/link-profile.html?u=${encodeURIComponent(profile.slug)}`;
        setTimeout(() => { window.location.href = target; }, 500);
      } catch (err) {
        console.error(err);
        showStatusEl(statusEl, err.message || 'Save failed.', 'error');
      }
    });
  }

  function collectProfilePayload(userId) {
    const name = getValue('lt-name');
    const slug = getValue('lt-slug');
    const title = getValue('lt-title');
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
        return;
      }
      if (!supabase) {
        showStatusEl(document.getElementById('lt-auth-status'), 'Missing Supabase config', 'error');
        return;
      }
      setAuthOnly(true);
      bindAuth();
      bindEditorActions();
      initSession();
    }
  };
})();
