import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

(() => {
  const cfg = window.env || {};
  const subtitleEl = document.getElementById('rp-subtitle');
  const passwordEl = document.getElementById('rp-password');
  const confirmEl = document.getElementById('rp-confirm-password');
  const submitEl = document.getElementById('rp-submit');
  const statusEl = document.getElementById('rp-status');

  const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
    ? null
    : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

  const adminUrl = () => `${window.location.origin}/link-admin`;

  function showStatus(message, state = '') {
    if (!statusEl) return;
    statusEl.className = 'lt-status';
    if (state) statusEl.classList.add(state);
    statusEl.textContent = message || '';
  }

  function setInputsDisabled(disabled) {
    [passwordEl, confirmEl, submitEl].forEach(el => {
      if (el) el.disabled = !!disabled;
    });
  }

  function hasRecoveryParams() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    return search.get('type') === 'recovery'
      || hash.get('type') === 'recovery'
      || search.has('code')
      || search.has('token_hash')
      || hash.has('access_token');
  }

  function setRecoveryReady(email = '') {
    setInputsDisabled(false);
    if (subtitleEl) {
      subtitleEl.textContent = email
        ? `Create a new password for ${email}.`
        : 'Enter your new password twice to finish resetting your account.';
    }
    showStatus('', '');
    setTimeout(() => passwordEl?.focus(), 0);
  }

  async function resolveRecoveryState() {
    if (!supabase) {
      setInputsDisabled(true);
      showStatus('Supabase auth is not configured on this site.', 'error');
      return;
    }

    if (hasRecoveryParams()) {
      setInputsDisabled(true);
      showStatus('Validating your recovery link...', 'loading');
    } else {
      setInputsDisabled(true);
      showStatus('Open this page from your password reset email to choose a new password.', 'error');
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setRecoveryReady((session.user.email || '').trim().toLowerCase());
      return;
    }

    if (hasRecoveryParams()) {
      showStatus('This reset link is invalid or expired. Request a new reset email from the sign-in page.', 'error');
    }
  }

  supabase?.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' || (session?.user && hasRecoveryParams())) {
      setRecoveryReady((session.user.email || '').trim().toLowerCase());
    }
  });

  submitEl?.addEventListener('click', async () => {
    const password = passwordEl?.value || '';
    const confirmPassword = confirmEl?.value || '';

    if (!supabase) {
      showStatus('Supabase auth is not configured on this site.', 'error');
      return;
    }
    if (!password || !confirmPassword) {
      showStatus('Enter your new password in both fields.', 'error');
      return;
    }
    if (password.length < 6) {
      showStatus('Password must be at least 6 characters.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      showStatus('Passwords do not match.', 'error');
      return;
    }

    setInputsDisabled(true);
    showStatus('Saving your new password...', 'loading');
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setInputsDisabled(false);
      showStatus(error.message, 'error');
      return;
    }

    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.warn('Post-reset sign out failed', signOutError);
    }

    showStatus('Password updated. Redirecting you to sign in...', 'success');
    setTimeout(() => {
      window.location.assign(adminUrl());
    }, 1200);
  });

  resolveRecoveryState().catch(error => {
    console.error('Recovery page failed to initialize', error);
    setInputsDisabled(true);
    showStatus('This reset link is invalid or expired. Request a new reset email from the sign-in page.', 'error');
  });
})();
