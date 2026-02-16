(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile nav toggle
  const toggle = document.querySelector('.menu-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });

    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        toggle.setAttribute('aria-expanded', false);
      });
    });
  }

  // Smooth scroll for internal anchors
  document.querySelectorAll('a[href^=\"#\"]').forEach(anchor => {
    anchor.addEventListener('click', evt => {
      const targetId = anchor.getAttribute('href');
      const target = document.querySelector(targetId);
      if (target) {
        evt.preventDefault();
        target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      }
    });
  });

  // Intersection Observer reveal
  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const revealEls = document.querySelectorAll('.reveal');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });

    revealEls.forEach(el => observer.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  }

  // Header scroll state
  const header = document.querySelector('header');
  const setHeaderState = () => {
    if (!header) return;
    if (window.scrollY > 20) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  setHeaderState();
  window.addEventListener('scroll', setHeaderState, { passive: true });

  // Fake page transitions
  const body = document.body;
  body.classList.add('page-fade-in');
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    link.addEventListener('click', evt => {
      evt.preventDefault();
      const url = link.getAttribute('href');
      body.classList.add('page-fade-out');
      setTimeout(() => { window.location.href = url; }, prefersReducedMotion ? 0 : 180);
    });
  });

  // Theme toggle
  const themeToggles = document.querySelectorAll('.theme-toggle');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const storedTheme = localStorage.getItem('residue-theme');

  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    body.setAttribute('data-theme', theme);
    localStorage.setItem('residue-theme', theme);
    themeToggles.forEach(btn => {
      const isDark = theme === 'dark';
      btn.setAttribute('aria-pressed', isDark);
      const label = btn.querySelector('.theme-label');
      if (label) label.textContent = isDark ? 'Dark' : 'Light';
    });
  };

  applyTheme(storedTheme || (prefersDark ? 'dark' : 'light'));

  themeToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = currentTheme === 'dark' ? 'light' : 'dark';
      if (prefersReducedMotion) {
        applyTheme(next);
        return;
      }
      body.classList.add('page-fade-out');
      setTimeout(() => {
        applyTheme(next);
        body.classList.remove('page-fade-out');
      }, 160);
    });
  });

  // Access form inline success
  const handleFormSubmit = (form, statusEl, successMessage) => {
    form.addEventListener('submit', async evt => {
      const isExternal = form.dataset.external === 'true';
      if (!isExternal) {
        // fallback: local demo behaviour
        evt.preventDefault();
        form.classList.add('submitted');
        if (statusEl) statusEl.hidden = false;
        return;
      }

      evt.preventDefault();
      const action = form.dataset.endpoint || form.getAttribute('action') || '';
      const next = form.querySelector('input[name=\"_next\"]')?.value || '/thank-you.html';
      const data = new FormData(form);
      try {
        const res = await fetch(action, {
          method: 'POST',
          body: data,
          headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error('Network response was not ok');
        form.reset();
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = successMessage || 'Sent.';
          statusEl.classList.add('success');
        }
        window.location.href = next;
      } catch (err) {
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = 'Could not send. Try again.';
          statusEl.classList.add('error');
        }
      }
    });
  };

  const attachHandled = (selector, successMessage) => {
    document.querySelectorAll(selector).forEach(form => {
      const statusEl =
        form.querySelector('.status') ||
        form.querySelector('.configure-status') ||
        form.querySelector('.enterprise-status');
      handleFormSubmit(form, statusEl, successMessage);
    });
  };

  attachHandled('.quote-form', 'Request sent.');
  attachHandled('.configure-form', 'Configuration sent.');
  attachHandled('.enterprise-form', 'Enterprise request sent.');
  attachHandled('form[data-external="true"]', 'Request sent.');

  // Access gate
  const validCodes = ['FOUNDER-001'];
  const gateForm = document.querySelector('.gate-form');
  if (gateForm) {
    const codeInput = gateForm.querySelector('#access-code');
    const statusEl = gateForm.querySelector('.gate-status');
    const gateButton = gateForm.querySelector('button[type="submit"]');
    gateForm.addEventListener('submit', evt => {
      evt.preventDefault();
      const code = (codeInput.value || '').trim().toUpperCase();
      if (!statusEl) return;
      statusEl.hidden = false;
      statusEl.textContent = 'Checking code';
      statusEl.className = 'status loading-dots';
      gateButton && (gateButton.disabled = true);
      codeInput && (codeInput.disabled = true);

      setTimeout(() => {
        const unlocked = validCodes.includes(code);
        if (unlocked) {
          localStorage.setItem('residue-access', 'granted');
          statusEl.hidden = false;
          statusEl.textContent = 'Access granted.';
          statusEl.className = 'status success';
          setTimeout(() => { window.location.href = 'residue-private.html'; }, 1000);
        } else {
          localStorage.removeItem('residue-access');
          statusEl.hidden = false;
          statusEl.textContent = 'Access not recognised.';
          statusEl.className = 'status error';
        }
        gateButton && (gateButton.disabled = false);
        codeInput && (codeInput.disabled = false);
      }, 4000);
    });
  }

  // Auto-redirect if already unlocked
  if (localStorage.getItem('residue-access') === 'granted' && window.location.pathname.endsWith('residue-private.html')) {
    // already in premium
  }
})();
