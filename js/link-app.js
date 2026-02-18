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

  /* Public profile rendering */
  async function renderPublicProfile() {
    const slug = qs.get('u');
    if (isFileProtocol) {
      showPlaceholder('Run via http:// (not file://) so Supabase works.');
      return;
    }
    if (!supabase) {
      showPlaceholder('Missing Supabase configuration.');
      return;
    }
    if (!slug) {
      showPlaceholder('No profile yet. Tap manage to add yours.');
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('slug', slug).single();
    if (error || !data) {
      showPlaceholder('Profile not found. Tap manage to create it.');
      return;
    }
    fillPublic(data);
    const { data: links } = await supabase.from('links').select('*').eq('profile_id', data.id).order('sort', { ascending: true });
    renderLinks('lt-links', links || []);
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
    } else if (forceLoad || session) {
      toggleEditor(true);
      loadProfile(session.user);
    }
    supabase.auth.onAuthStateChange((event, sessionNow) => {
      if (sessionNow) {
        toggleEditor(true);
        loadProfile(sessionNow.user);
      } else {
        toggleEditor(false);
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
      .filter(l => l.label && l.url)
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return showStatusEl(statusEl, 'Not signed in.', 'error');
      const profile = collectProfilePayload(session.user.id);
      if (!profile.name) return showStatusEl(statusEl, 'Name is required.', 'error');
      if (!profile.slug) return showStatusEl(statusEl, 'Slug / URL is required.', 'error');
      const links = collectLinks();
      showStatusEl(statusEl, 'Saving…', 'loading');
      const { error: pErr } = await supabase.from('profiles').upsert(profile);
      if (pErr) return showStatusEl(statusEl, pErr.message, 'error');
      await supabase.from('links').delete().eq('profile_id', session.user.id);
      if (links.length) {
        await supabase.from('links').insert(links.map(l => ({ ...l, profile_id: session.user.id })));
      }
      showStatusEl(statusEl, 'Saved. Redirecting…', 'success');
      const target = `${window.location.origin}/link-profile.html?u=${encodeURIComponent(profile.slug)}`;
      setTimeout(() => { window.location.href = target; }, 800);
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
  avatarFile?.addEventListener('change', () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    if (file.size > 1.2 * 1024 * 1024) {
      showStatusEl(document.getElementById('lt-save-status'), 'Image too large (>1.2MB).', 'error');
      avatarFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      avatarUrlInput.value = reader.result;
    };
    reader.readAsDataURL(file);
  });

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
      bindAuth();
      bindEditorActions();
      initSession();
    }
  };
})();
