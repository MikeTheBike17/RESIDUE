(() => {
  const SCRIPT_ID = "residue-turnstile-api";
  const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const widgets = new Map();
  let scriptPromise = null;

  const getSiteKey = () => String(window.env?.TURNSTILE_SITE_KEY || "").trim();
  const hasConfig = () => Boolean(getSiteKey());

  const isVisible = el => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  };

  const loadApi = () => {
    if (!hasConfig()) return Promise.resolve(null);
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
        existing.addEventListener("error", () => reject(new Error("Could not load security check.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error("Could not load security check."));
      document.head.appendChild(script);
    });

    return scriptPromise;
  };

  const tokenFieldFor = container => {
    const selector = container.getAttribute("data-turnstile-token");
    if (selector) return document.querySelector(selector);
    const root = container.closest("form") || container.closest("[data-turnstile-root]") || container.parentElement;
    return root?.querySelector('input[name="turnstile_token"]') || null;
  };

  const setToken = (container, token = "") => {
    container.dataset.turnstileToken = token;
    const field = tokenFieldFor(container);
    if (field) field.value = token;
  };

  const showMessage = (container, message) => {
    if (!container) return;
    container.innerHTML = "";
    const placeholder = document.createElement("span");
    placeholder.className = "turnstile-placeholder";
    placeholder.textContent = message;
    container.appendChild(placeholder);
  };

  const render = async container => {
    if (!container || widgets.has(container) || !isVisible(container)) return null;
    const turnstile = await loadApi();
    if (!turnstile || widgets.has(container) || !isVisible(container)) return null;

    container.innerHTML = "";

    const widgetId = turnstile.render(container, {
      sitekey: getSiteKey(),
      theme: container.getAttribute("data-turnstile-theme") || "auto",
      size: container.getAttribute("data-turnstile-size") || "normal",
      callback: token => setToken(container, token),
      "expired-callback": () => setToken(container, ""),
      "error-callback": () => setToken(container, "")
    });

    widgets.set(container, widgetId);
    return widgetId;
  };

  const renderAll = async (root = document) => {
    const containers = Array.from(root.querySelectorAll("[data-turnstile-widget]"));
    if (!hasConfig()) {
      containers.forEach(container => showMessage(container, "Security check unavailable. Add TURNSTILE_SITE_KEY."));
      return [];
    }
    await loadApi();
    return Promise.all(containers.map(render));
  };

  const getWidget = root => {
    if (!root) return null;
    return root.matches?.("[data-turnstile-widget]") ? root : root.querySelector?.("[data-turnstile-widget]");
  };

  const requireToken = async root => {
    if (!hasConfig()) return "";
    await renderAll(root || document);
    const container = getWidget(root || document);
    if (!container) return "";
    const field = tokenFieldFor(container);
    const token = String(container.dataset.turnstileToken || field?.value || "").trim();
    if (!token) throw new Error("Complete the security check.");
    return token;
  };

  const reset = root => {
    const container = getWidget(root || document);
    if (!container) return;
    const widgetId = widgets.get(container);
    if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId);
    setToken(container, "");
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderAll().catch(() => {});
  });

  window.residueTurnstile = {
    hasConfig,
    renderAll,
    requireToken,
    reset
  };
})();
