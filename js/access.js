(() => {
  const STORAGE_KEY = 'residueAccessUnlocked';
  const USED_CODES_KEY = 'usedCodes';

  const MASTER_CODES = ['FOUNDER-001'];

  const accessConfig = {
    validCodes: MASTER_CODES,
    productLinks: {
      core: '#', // replace with live link
      pair: '#', // replace with live link
      set:  '#', // replace with live link
    },
    brandCopy: {
      checking: 'Checking code',
      granted: 'Access granted.',
      invalid: 'Code not recognised. Request access if needed.',
      reused: 'This code was used on this device. Request access if needed.',
      missing: 'Enter a code to continue.',
      format: 'Use your issued access code.',
      requestMissing: 'Check your details. Some fields are missing.',
      requestEmail: 'Email looks off. Adjust and resend.',
      requestReceived: 'Received. We will respond if aligned.',
      requestSending: 'Sending…',
    }
  };

  // Future helper for generating codes (server should own this, not the client).
  // function generateCode(prefix = 'RES', number = 1) {
  //   const padded = String(number).padStart(4, '0');
  //   return `${prefix}-${padded}`;
  // }

  const codeForm = document.getElementById('code-form');
  const codeInput = document.getElementById('code-input');
  const codeStatus = document.getElementById('code-status');
  const codeSubmit = document.getElementById('code-submit');
  const purchaseOptions = document.getElementById('purchase-options');

  const requestForm = document.getElementById('request-form');
  const requestStatus = document.getElementById('request-status');

  const showStatus = (el, message, type = '') => {
    if (!el) return;
    el.textContent = message;
    el.className = 'status';
    if (type) el.classList.add(type);
    if (type === 'loading') el.classList.add('loading-dots');
  };

  // Local-only one-time-use simulation. Real enforcement requires server-side validation.
  const getUsedCodes = () => {
    try {
      return JSON.parse(localStorage.getItem(USED_CODES_KEY) || '[]');
    } catch {
      return [];
    }
  };

  const setUsedCodes = codes => localStorage.setItem(USED_CODES_KEY, JSON.stringify(codes));

  const redirectToPrivate = () => {
    window.location.href = 'residue-private.html';
  };

  const setUnlocked = (code, { redirect = true, showStatusMessage = true, showOptions = true, redirectDelay = 1000 } = {}) => {
    if (showOptions) purchaseOptions?.classList.add('show');
    if (showStatusMessage) showStatus(codeStatus, accessConfig.brandCopy.granted, 'success');
    localStorage.setItem(STORAGE_KEY, 'true');
    if (code) {
      const used = new Set(getUsedCodes());
      used.add(code.toUpperCase());
      setUsedCodes([...used]);
    }
    if (redirect) setTimeout(redirectToPrivate, redirectDelay);
  };

  // Replace this with a real API call when backend exists.
  const validateCode = code => accessConfig.validCodes.includes(code.toUpperCase().trim());

  // Restore access state
  if (localStorage.getItem(STORAGE_KEY) === 'true') {
    // Restore silently; keep access state but don't show success UI.
    setUnlocked(null, { redirect: false, showStatusMessage: false, showOptions: false });
  }

  codeForm?.addEventListener('submit', evt => {
    evt.preventDefault();
    const value = codeInput.value.trim();
    if (!value) {
      showStatus(codeStatus, accessConfig.brandCopy.missing, 'error');
      purchaseOptions?.classList.remove('show');
      return;
    }
    if (!/^FOUNDER-\d{3}$/i.test(value)) {
      showStatus(codeStatus, accessConfig.brandCopy.format, 'error');
      purchaseOptions?.classList.remove('show');
      return;
    }
    const upper = value.toUpperCase();
    const isMaster = MASTER_CODES.includes(upper);
    if (!isMaster && getUsedCodes().includes(upper)) {
      showStatus(codeStatus, accessConfig.brandCopy.reused, 'error');
      purchaseOptions?.classList.remove('show');
      return;
    }

    showStatus(codeStatus, accessConfig.brandCopy.checking, 'loading');
    codeSubmit.disabled = true;

    setTimeout(() => {
      const valid = validateCode(value);
      if (valid) {
        setUnlocked(isMaster ? null : upper, { redirectDelay: 1000 });
      } else {
        showStatus(codeStatus, accessConfig.brandCopy.invalid, 'error');
        purchaseOptions?.classList.remove('show');
        localStorage.removeItem(STORAGE_KEY);
      }
      codeSubmit.disabled = false;
    }, 4000);
  });

  // Skip custom handling if an external action is set (e.g., Formspree)
  requestForm?.addEventListener('submit', evt => {
    if (requestForm.hasAttribute('data-external') && requestForm.getAttribute('action') && requestForm.getAttribute('action') !== '#') return;
    evt.preventDefault();
    const name = requestForm.name.value.trim();
    const email = requestForm.email.value.trim();
    const social = requestForm.social.value.trim();
    const reason = requestForm.reason.value.trim();

    if (!name || !email || !social || !reason) {
      showStatus(requestStatus, accessConfig.brandCopy.requestMissing, 'error');
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      showStatus(requestStatus, accessConfig.brandCopy.requestEmail, 'error');
      return;
    }

    showStatus(requestStatus, accessConfig.brandCopy.requestSending);

    // Simulate network call. Replace with POST to your backend endpoint.
    setTimeout(() => {
      showStatus(requestStatus, accessConfig.brandCopy.requestReceived, 'success');
      requestForm.reset();
    }, 800);
  });

  // Wire product links from config
  if (purchaseOptions) {
    const links = purchaseOptions.querySelectorAll('a');
    links.forEach(link => {
      const label = link.textContent.toLowerCase();
      if (label.includes('core')) link.href = accessConfig.productLinks.core;
      if (label.includes('pair')) link.href = accessConfig.productLinks.pair;
      if (label.includes('set')) link.href = accessConfig.productLinks.set;
    });
  }
})();
