(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const telemetry = () => window.residueTelemetry;
  const logAuth = payload => telemetry()?.logAuthEvent?.(payload);

  const decodeEmailLinks = () => {
    document.querySelectorAll('a[data-email-code]').forEach(link => {
      const code = (link.getAttribute('data-email-code') || '').trim();
      if (!code) return;
      try {
        let email = atob(code);
        if (link.getAttribute('data-email-rev') === '1') {
          email = email.split('').reverse().join('');
        }
        link.href = `mailto:${email}`;
        link.textContent = email;
      } catch {
        // Keep placeholder if decode fails.
      }
    });
  };
  decodeEmailLinks();

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

  // Footer copyright
  const updateFooterCopyright = () => {
    const year = new Date().getFullYear();
    document.querySelectorAll('[data-footer-copyright]').forEach(el => {
      const brand = (el.getAttribute('data-brand') || 'Residue').trim() || 'Residue';
      el.textContent = `© ${year} ${brand}. All rights reserved.`;
    });
  };
  updateFooterCopyright();

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
    // Prevent multiple listeners when the same form matches several selectors
    if (form.dataset.formHandled === 'true') return;
    form.dataset.formHandled = 'true';

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

  // Media fade-in
  const fadeImages = () => {
    document.querySelectorAll('img:not(.no-fade)').forEach(img => {
      img.classList.add('lazy-fade');
      if (img.complete) {
        img.classList.add('loaded');
      } else {
        img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
        img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
      }
    });
  };
  fadeImages();
  const observer = new MutationObserver(() => fadeImages());
  observer.observe(document.body, { childList: true, subtree: true });

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
      logAuth({
        action: 'access_code_check',
        outcome: 'attempt',
        detail: 'Access code submitted.',
        metadata: { code_prefix: code.slice(0, 8) }
      });
      statusEl.hidden = false;
      statusEl.textContent = 'Checking code';
      statusEl.className = 'status loading-dots';
      gateButton && (gateButton.disabled = true);
      codeInput && (codeInput.disabled = true);

      setTimeout(() => {
        if (validCodes.includes(code)) {
          localStorage.setItem('residue-access', 'granted');
          logAuth({
            action: 'access_code_check',
            outcome: 'success',
            detail: 'Access code accepted.',
            metadata: { code_prefix: code.slice(0, 8) }
          });
          statusEl.textContent = 'Access granted.';
          statusEl.className = 'status success';
          if (typeof window.openAuthModal === 'function') {
            window.openAuthModal('signin');
          }
        } else {
          logAuth({
            action: 'access_code_check',
            outcome: 'failure',
            detail: 'Access code rejected.',
            metadata: { code_prefix: code.slice(0, 8) }
          });
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

    const CURRENT_USER_KEY = "residue_current_user";
    const MANAGER_ACCESS_KEY = "residue_manager_access";
    const MANAGER_EMAIL = "check.email@residue.com";
    const MANAGER_PASSWORD = "Mike&Lim1";
    const PRIVATE_PAGE = "residue-private.html";
    const CARD_URLS_PAGE = "card-urls.html";
    const cfg = window.env || {};
    const profileTableFromEnv = (cfg.SUPABASE_PROFILE_TABLE || "").trim().toLowerCase();
    const PROFILE_TABLES = [...new Set(
      [profileTableFromEnv, "users", "profiles"].filter(Boolean)
    )];
    let supabaseClientPromise = null;

    async function getSupabaseClient() {
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
      if (!supabaseClientPromise) {
        supabaseClientPromise = import('https://esm.sh/@supabase/supabase-js@2.45.0')
          .then(({ createClient }) => createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
            auth: { persistSession: true, autoRefreshToken: true }
          }))
          .catch(() => null);
      }
      return supabaseClientPromise;
    }

    function normalizeEmail(value) {
      return (value || "").trim().toLowerCase();
    }

    function resolveSlug(...parts) {
      for (const raw of parts) {
        const normalized = String(raw || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (normalized) return normalized;
      }
      return "";
    }

    async function ensureProfileRow(supabase, user, fallbackEmail = "") {
      if (!supabase || !user?.id) return { ok: false, reason: "missing_context" };
      const authEmail = normalizeEmail(user.email || fallbackEmail);
      const slug = resolveSlug(authEmail.split("@")[0], `user-${String(user.id).replace(/-/g, "").slice(0, 8)}`);

      const payloadFor = (table) => {
        if (table === "users") {
          return { id: user.id, email: authEmail || null };
        }
        return {
          id: user.id,
          auth_email: authEmail || null,
          name: user.email || authEmail || "Residue User",
          slug,
          theme: "dark"
        };
      };

      let lastError = null;
      for (const table of PROFILE_TABLES) {
        const { error } = await supabase.from(table).upsert(payloadFor(table), { onConflict: "id" });
        if (!error) {
          logAuth({
            action: "profile_sync",
            outcome: "success",
            email: authEmail,
            user_id: user.id,
            detail: `Upserted ${table} row from auth session.`
          });
          return { ok: true };
        }
        lastError = error;
      }

      logAuth({
        action: "user_sync",
        outcome: "failure",
        email: authEmail,
        user_id: user.id,
        detail: `User row sync failed in all targets: ${PROFILE_TABLES.join(", ")}. Last error: ${lastError?.message || "unknown error"}`
      });
      return { ok: false, reason: lastError?.message || "unknown_error" };
    }

    async function syncProfileForCurrentSession() {
      const supabase = await getSupabaseClient();
      if (!supabase) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          await ensureProfileRow(supabase, session.user, session.user.email || "");
        }
      } catch {
        // Silent fail: user can still proceed with auth flows.
      }
    }

    function setStatus(el, msg, show = true) {
      if (!el) return;
      el.textContent = msg;
      el.hidden = !show;
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

    // Backfill legacy users missing app rows when an auth session already exists.
    syncProfileForCurrentSession();

    // SIGN IN submit
    signinForm?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = normalizeEmail($("#signin-email")?.value || "");
      const password = $("#signin-password")?.value || "";
      const managerEmail = MANAGER_EMAIL.toLowerCase();
      logAuth({ action: 'signin', outcome: 'attempt', email, detail: 'Sign in submitted.' });

      if (email === managerEmail && password === MANAGER_PASSWORD) {
        const supabase = await getSupabaseClient();
        if (!supabase) {
          logAuth({ action: 'signin', outcome: 'failure', email, detail: 'Supabase not configured for manager access.' });
          return setStatus(signinStatus, "Auth is not configured yet. Contact support.", true);
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          logAuth({ action: 'signin', outcome: 'failure', email, detail: error.message || 'Manager sign in failed.' });
          return setStatus(signinStatus, error.message || "Could not sign in.", true);
        }

        if (data?.user?.id) await ensureProfileRow(supabase, data.user, email);

        localStorage.setItem(CURRENT_USER_KEY, (data?.user?.email || email).toLowerCase());
        localStorage.setItem(MANAGER_ACCESS_KEY, JSON.stringify({
          email: (data?.user?.email || email).toLowerCase(),
          granted_at: new Date().toISOString()
        }));
        logAuth({ action: 'signin', outcome: 'success', email, detail: 'Signed in via manager credentials.' });
        setStatus(signinStatus, "Signed in.", true);

        setTimeout(() => {
          closeAuthModal();
          signinForm.reset();
          window.location.href = CARD_URLS_PAGE;
        }, 500);
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        logAuth({ action: 'signin', outcome: 'failure', email, detail: 'Invalid email format.' });
        return setStatus(signinStatus, "Enter a valid email.", true);
      }
      if (password.length < 6) {
        logAuth({ action: 'signin', outcome: 'failure', email, detail: 'Password too short.' });
        return setStatus(signinStatus, "Password must be at least 6 characters.", true);
      }

      const supabase = await getSupabaseClient();
      if (!supabase) {
        logAuth({ action: 'signin', outcome: 'failure', email, detail: 'Supabase not configured on public auth page.' });
        return setStatus(signinStatus, "Auth is not configured yet. Contact support.", true);
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        logAuth({ action: 'signin', outcome: 'failure', email, detail: error.message || 'Supabase sign in failed.' });
        return setStatus(signinStatus, error.message || "Could not sign in.", true);
      }

      if (data?.user?.id) await ensureProfileRow(supabase, data.user, email);

      localStorage.setItem(CURRENT_USER_KEY, (data?.user?.email || email).toLowerCase());
      logAuth({ action: 'signin', outcome: 'success', email, detail: 'Signed in via Supabase auth.' });
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

      const email = normalizeEmail($("#create-email")?.value || "");
      const password = $("#create-password")?.value || "";
      const confirm = $("#create-confirm")?.value || "";
      logAuth({ action: 'signup', outcome: 'attempt', email, detail: 'Create account submitted.' });

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        logAuth({ action: 'signup', outcome: 'failure', email, detail: 'Invalid email format.' });
        return setStatus(createStatus, "Enter a valid email.", true);
      }
      if (password.length < 6) {
        logAuth({ action: 'signup', outcome: 'failure', email, detail: 'Password too short.' });
        return setStatus(createStatus, "Password must be at least 6 characters.", true);
      }
      if (password !== confirm) {
        logAuth({ action: 'signup', outcome: 'failure', email, detail: 'Password confirmation mismatch.' });
        return setStatus(createStatus, "Passwords do not match.", true);
      }

      const supabase = await getSupabaseClient();
      if (!supabase) {
        logAuth({ action: 'signup', outcome: 'failure', email, detail: 'Supabase not configured on public auth page.' });
        return setStatus(createStatus, "Auth is not configured yet. Contact support.", true);
      }

      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo }
      });
      if (error) {
        logAuth({ action: 'signup', outcome: 'failure', email, detail: error.message || 'Supabase sign up failed.' });
        return setStatus(createStatus, error.message || "Could not create account.", true);
      }

      if (data?.user && !data?.session) {
        logAuth({ action: 'signup', outcome: 'success', email, detail: 'Supabase signup created; awaiting email confirmation.' });
        return setStatus(createStatus, "Account created. Check your email to confirm and sign in.", true);
      }

      if (data?.user?.id) await ensureProfileRow(supabase, data.user, email);

      localStorage.setItem(CURRENT_USER_KEY, email);
      logAuth({ action: 'signup', outcome: 'success', email, detail: 'Account created via Supabase auth.' });
      setStatus(createStatus, "Account created.", true);

      setTimeout(() => {
        closeAuthModal();
        createForm.reset();
        // Take new users straight into the private page (same as sign-in)
        window.location.href = PRIVATE_PAGE;
      }, 600);
    });


  // ROTATING HERO HEADER
  const heroCopy = [
    {
      head: ["You don’t need to be the", "loudest in the room."],
      sub: "You never did. You care about what remains after the introduction."
    },
    {
      head: ["First impressions fade.", "Residue remains."],
      sub: "Leave a signal that outlasts hello."
    },
    {
      head: ["Luxury is remembered.", "Not announced."],
      sub: "Presence without noise. Clarity after the tap."
    }
  ];

  const quoteElement = document.getElementById("rotating-quote");
  const subheadElement = document.getElementById("rotating-subhead");
  let heroIndex = 0;
  const FADE_DURATION = 800;
  const ROTATE_INTERVAL = 8000;

  function swapText(el, html) {
    if (!el) return;
    el.classList.add("fade-out");
    setTimeout(() => {
      el.innerHTML = html;
      el.classList.remove("fade-out");
      el.classList.add("fade-in");
      setTimeout(() => el.classList.remove("fade-in"), FADE_DURATION);
    }, FADE_DURATION);
  }

  function changeHeroCopy() {
    if (!quoteElement) return;
    heroIndex = (heroIndex + 1) % heroCopy.length;
    const { head, sub } = heroCopy[heroIndex];
    swapText(
      quoteElement,
      `<span class="nowrap">${head[0]}</span><br><span class="nowrap">${head[1]}</span>`
    );
    if (subheadElement) {
      swapText(subheadElement, `<span>${sub}</span>`);
    }
  }

  setInterval(changeHeroCopy, ROTATE_INTERVAL);
})();
