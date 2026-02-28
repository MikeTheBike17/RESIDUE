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
      const code = (codeInput?.value || '').trim().toUpperCase();
      if (!statusEl) return;
      statusEl.hidden = false;
      statusEl.textContent = 'Checking code';
      statusEl.className = 'status loading-dots';
      gateButton && (gateButton.disabled = true);
      codeInput && (codeInput.disabled = true);

      setTimeout(() => {
        if (validCodes.includes(code)) {
          localStorage.setItem('residue-access', 'granted');
          statusEl.textContent = 'Access granted.';
          statusEl.className = 'status success';
          if (typeof window.openAuthModal === 'function') {
            window.openAuthModal('signin');
          }
        } else {
          statusEl.textContent = 'Invalid access code.';
          statusEl.className = 'status error';
          gateButton && (gateButton.disabled = false);
          codeInput && (codeInput.disabled = false);
          codeInput?.focus();
        }
      }, 300);
    });
  }

  // Auto-redirect if already unlocked
  if (localStorage.getItem('residue-access') === 'granted' && window.location.pathname.endsWith('residue-private.html')) {
    // already in premium
  }

  // ===== AUTH MODAL (Sign in / Create) =====
    const $ = (sel, root = document) => root.querySelector(sel);

    const USERS_KEY = "residue_users";
    const CURRENT_USER_KEY = "residue_current_user";
    const TEMP_MOCK_EMAIL = "mike@residue.com";
    const TEMP_MOCK_PASSWORD = "123456";
    const PRIVATE_PAGE = "residue-private.html";

    function getUsers() {
      try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); }
      catch { return []; }
    }
    function saveUsers(users) {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function setStatus(el, msg, show = true) {
      if (!el) return;
      el.textContent = msg;
      el.hidden = !show;
    }

    async function sha256Hex(text) {
      const data = new TextEncoder().encode(text);
      const hashBuf = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    const modal = $("#authModal");
    const title = $("#authTitle");
    const subtitle = $("#authSubtitle");

    const tabSignin = $("#tab-signin");
    const tabCreate = $("#tab-create");

    const signinForm = $("#signinForm");
    const createForm = $("#createForm");

    const signinStatus = $("#signinStatus");
    const createStatus = $("#createStatus");

    function openAuthModal(defaultMode = "signin") {
      if (!modal) return;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      setMode(defaultMode);
    }

    function closeAuthModal() {
      if (!modal) return;
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      setStatus(signinStatus, "", false);
      setStatus(createStatus, "", false);
    }

    // expose so your access gate can call it
    window.openAuthModal = openAuthModal;

    // close handlers
    modal?.querySelectorAll("[data-close]")?.forEach(el => el.addEventListener("click", closeAuthModal));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal?.classList.contains("is-open")) closeAuthModal();
    });

    // force closed on load
    if (modal) closeAuthModal();

    function setMode(mode) {
      const isSignin = mode === "signin";

      tabSignin?.classList.toggle("is-active", isSignin);
      tabCreate?.classList.toggle("is-active", !isSignin);

      tabSignin?.setAttribute("aria-selected", String(isSignin));
      tabCreate?.setAttribute("aria-selected", String(!isSignin));

      if (signinForm) {
        signinForm.style.display = isSignin ? "grid" : "none";
        signinForm.setAttribute("aria-hidden", String(!isSignin));
        signinForm.tabIndex = isSignin ? 0 : -1;
      }
      if (createForm) {
        createForm.style.display = isSignin ? "none" : "grid";
        createForm.setAttribute("aria-hidden", String(isSignin));
        createForm.tabIndex = isSignin ? -1 : 0;
      }

      if (title) title.textContent = isSignin ? "Sign in" : "Create account";
      if (subtitle) subtitle.textContent = isSignin
        ? "Enter your credentials to continue."
        : "Set your email and password to continue.";

      setStatus(signinStatus, "", false);
      setStatus(createStatus, "", false);

      // focus first field
      setTimeout(() => {
        const first = isSignin ? $("#signin-email") : $("#create-email");
        first?.focus();
      }, 50);
    }

    tabSignin?.addEventListener("click", () => setMode("signin"));
    tabCreate?.addEventListener("click", () => setMode("create"));

    // SIGN IN submit
    signinForm?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = ($("#signin-email")?.value || "").trim().toLowerCase();
      const password = $("#signin-password")?.value || "";
      const mockEmail = TEMP_MOCK_EMAIL.toLowerCase();

      if (email === mockEmail && password === TEMP_MOCK_PASSWORD) {
        localStorage.setItem(CURRENT_USER_KEY, TEMP_MOCK_EMAIL);
        setStatus(signinStatus, "Signed in.", true);
        setTimeout(() => {
          closeAuthModal();
          signinForm.reset();
          window.location.href = PRIVATE_PAGE;
        }, 500);
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setStatus(signinStatus, "Enter a valid email.", true);
      if (password.length < 6) return setStatus(signinStatus, "Password must be at least 6 characters.", true);

      const users = getUsers();
      const user = users.find(u => (u.email || "").toLowerCase() === email);
      if (!user) return setStatus(signinStatus, "Account not found. Create one instead.", true);

      const hash = await sha256Hex(password);
      if (hash !== user.passwordHash) return setStatus(signinStatus, "Incorrect password.", true);

      localStorage.setItem(CURRENT_USER_KEY, email);
      setStatus(signinStatus, "Signed in.", true);

      setTimeout(() => {
        closeAuthModal();
        signinForm.reset();
        window.location.href = PRIVATE_PAGE;
      }, 500);
    });

    // CREATE submit
    createForm?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = ($("#create-email")?.value || "").trim().toLowerCase();
      const password = $("#create-password")?.value || "";
      const confirm = $("#create-confirm")?.value || "";

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setStatus(createStatus, "Enter a valid email.", true);
      if (password.length < 6) return setStatus(createStatus, "Password must be at least 6 characters.", true);
      if (password !== confirm) return setStatus(createStatus, "Passwords do not match.", true);

      const users = getUsers();
      if (users.some(u => (u.email || "").toLowerCase() === email)) return setStatus(createStatus, "That email is already in use.", true);

      const passwordHash = await sha256Hex(password);
      users.push({ email, passwordHash, createdAt: new Date().toISOString() });
      saveUsers(users);

      localStorage.setItem(CURRENT_USER_KEY, email);
      setStatus(createStatus, "Account created.", true);

      setTimeout(() => {
        closeAuthModal();
        createForm.reset();
        // OPTIONAL redirect:
        // window.location.href = "residue-private.html";
      }, 600);
    });


  // ROTATING HERO HEADER
  const quotes = [
    [
      "You don’t need to be the",
      "loudest in the room."
    ],
    [
      "First impressions fade.",
      "Residue remains."
    ],
    [
      "Luxury is remembered.",
      "Not announced."
    ]
  ];

  const quoteElement = document.getElementById("rotating-quote");
  let index = 0;

  function changeQuote() {
    if (!quoteElement) return;
    quoteElement.classList.add("fade-out");

    setTimeout(() => {
      index = (index + 1) % quotes.length;

      quoteElement.innerHTML = `
        <span class="nowrap">${quotes[index][0]}</span><br>
        <span class="nowrap">${quotes[index][1]}</span>
      `;

      quoteElement.classList.remove("fade-out");
      quoteElement.classList.add("fade-in");

      setTimeout(() => {
        quoteElement.classList.remove("fade-in");
      }, 600);

    }, 600);
  }

  setInterval(changeQuote, 5000);
})();
