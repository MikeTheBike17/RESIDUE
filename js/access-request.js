(() => {
  const cfg = window.env || {};
  const form = document.getElementById('request-form');
  const statusEl = document.getElementById('request-status');
  if (!form || !statusEl) return;

  const submitBtn = form.querySelector('button[type="submit"]');
  const endpoint = String(cfg.ACCESS_REQUEST_FUNCTION_URL || '').trim()
    || `${String(cfg.SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/access-request`;
  const anonKey = String(cfg.SUPABASE_ANON_KEY || '').trim();
  let inFlight = false;

  const setStatus = (message, type = '') => {
    statusEl.textContent = message;
    statusEl.className = 'status';
    if (type) statusEl.classList.add(type);
    if (type === 'loading') statusEl.classList.add('loading-dots');
  };

  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const normalizeName = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const normalizeIntent = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 2000);
  const parseTeamSize = value => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 10000) return null;
    return n;
  };

  const setBusy = busy => {
    inFlight = busy;
    if (submitBtn) submitBtn.disabled = busy;
  };

  form.addEventListener('submit', async evt => {
    evt.preventDefault();
    if (inFlight) return;

    if (!cfg.SUPABASE_URL || !anonKey) {
      setStatus('Service is unavailable right now. Please try again later.', 'error');
      return;
    }

    const trap = String(form.elements.website?.value || '').trim();
    if (trap) {
      setStatus('Request received.', 'success');
      form.reset();
      return;
    }

    const payload = {
      name: normalizeName(form.elements.name?.value),
      email: normalizeEmail(form.elements.email?.value),
      intent: normalizeIntent(form.elements.intent?.value),
      team_size: parseTeamSize(form.elements.team_size?.value),
      turnstile_token: String(form.elements.turnstile_token?.value || '').trim()
    };

    if (!payload.name || !payload.email || !payload.intent) {
      setStatus('Please complete name, email, and intent.', 'error');
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(payload.email)) {
      setStatus('Please enter a valid email address.', 'error');
      return;
    }

    if (String(form.elements.team_size?.value || '').trim() && payload.team_size == null) {
      setStatus('Team size must be a whole number between 1 and 10000.', 'error');
      return;
    }

    try {
      payload.turnstile_token = await window.residueTurnstile?.requireToken?.(form) || payload.turnstile_token;
    } catch (err) {
      setStatus(err.message || 'Complete the security check.', 'error');
      return;
    }

    setBusy(true);
    setStatus('Submitting request...', 'loading');

    try {
      const headers = {
        'content-type': 'application/json',
        'apikey': anonKey
      };
      // Only send Bearer when the key looks like a JWT (three dot-separated parts).
      if ((anonKey.match(/\./g) || []).length === 2) {
        headers.authorization = `Bearer ${anonKey}`;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.detail || 'Could not submit request.');
      }

      setStatus('Request submitted. Our team will review it shortly.', 'success');
      form.reset();
      window.residueTurnstile?.reset?.(form);
    } catch (err) {
      window.residueTurnstile?.reset?.(form);
      setStatus(err.message || 'Could not submit request.', 'error');
    } finally {
      setBusy(false);
    }
  });
})();
