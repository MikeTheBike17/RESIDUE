(() => {
  const SCRIPT_ID = "residue-turnstile-api";
  const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  const WIDGET_SELECTOR = ".cf-turnstile, [data-turnstile-widget]";
  const widgets = new Map();
  let scriptPromise = null;

  const getSiteKey = () => String(window.env?.TURNSTILE_SITE_KEY || "").trim();
  const siteKeyFor = container => String(container?.getAttribute("data-sitekey") || getSiteKey()).trim();

  const widgetContainers = (root = document) => {
    const containers = [];
    if (root?.matches?.(WIDGET_SELECTOR)) containers.push(root);
    root?.querySelectorAll?.(WIDGET_SELECTOR).forEach(container => containers.push(container));
    return [...new Set(containers)];
  };

  const hasConfig = (root = document) => {
    const containers = widgetContainers(root);
    return containers.length ? containers.some(container => Boolean(siteKeyFor(container))) : Boolean(getSiteKey());
  };

  const isVisible = el => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  };

  const loadApi = () => {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID)
        || [...document.scripts].find(el => String(el.src || "").startsWith(SCRIPT_SRC));
      if (existing) {
        if (window.turnstile) {
          resolve(window.turnstile);
          return;
        }
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
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("Could not load security check."));
      };
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

  const responseFieldFor = container => {
    const root = container.closest("form") || container.closest("[data-turnstile-root]") || container.parentElement;
    return root?.querySelector('input[name="cf-turnstile-response"]') || null;
  };

  const setToken = (container, token = "") => {
    container.dataset.turnstileToken = token;
    const field = tokenFieldFor(container);
    if (field) field.value = token;
  };

  const clearResponse = container => {
    const responseField = responseFieldFor(container);
    if (responseField) responseField.value = "";
  };

  const showMessage = (container, message) => {
    if (!container) return;
    container.innerHTML = "";
    const placeholder = document.createElement("span");
    placeholder.className = "turnstile-placeholder";
    placeholder.textContent = message;
    container.appendChild(placeholder);
  };

  const showError = (container, message) => {
    widgets.delete(container);
    setToken(container, "");
    clearResponse(container);
    showMessage(container, message);
  };

  const hasVisibleFrame = container => {
    const frame = container?.querySelector("iframe");
    return Boolean(frame && frame.offsetWidth > 0 && frame.offsetHeight > 0);
  };

  const tokenFor = container => {
    const field = tokenFieldFor(container);
    const responseField = responseFieldFor(container);
    return String(container.dataset.turnstileToken || field?.value || responseField?.value || "").trim();
  };

  const render = async container => {
    if (!container || widgets.has(container) || !isVisible(container)) return null;
    const siteKey = siteKeyFor(container);
    if (!siteKey) {
      showError(container, "Security check unavailable. Add TURNSTILE_SITE_KEY.");
      return null;
    }

    let turnstile;
    try {
      turnstile = await loadApi();
    } catch (err) {
      showError(container, "Security check could not load. Refresh and try again.");
      return null;
    }

    if (!turnstile || widgets.has(container) || !isVisible(container)) return null;

    await new Promise(resolve => window.setTimeout(resolve, 0));
    if (container.classList.contains("cf-turnstile")) return widgets.get(container) || null;
    if (hasVisibleFrame(container)) return widgets.get(container) || null;

    try {
      container.innerHTML = "";
      const widgetId = turnstile.render(container, {
        sitekey: siteKey,
        theme: container.getAttribute("data-theme") || "auto",
        size: container.getAttribute("data-size") || "normal",
        appearance: container.getAttribute("data-appearance") || "always",
        callback: token => setToken(container, token),
        "expired-callback": () => setToken(container, ""),
        "timeout-callback": () => setToken(container, ""),
        "unsupported-callback": () => {
          showError(container, "Security check is not supported in this browser.");
          return true;
        },
        "error-callback": errorCode => {
          showError(container, `Security check could not render (${errorCode}). Check the Turnstile site key and allowed hostname.`);
          return true;
        }
      });

      widgets.set(container, widgetId);
      window.setTimeout(() => {
        if (widgets.get(container) === widgetId && !hasVisibleFrame(container) && !container.dataset.turnstileToken) {
          showError(container, "Security check is not visible. Check the Turnstile site key and allowed hostname.");
        }
      }, 6000);
      return widgetId;
    } catch (err) {
      showError(container, "Security check could not render. Refresh and try again.");
      return null;
    }
  };

  const renderAll = async (root = document) => {
    const containers = widgetContainers(root);
    return Promise.all(containers.map(render));
  };

  const getWidget = root => {
    if (!root) return null;
    return widgetContainers(root)[0] || null;
  };

  const requireToken = async root => {
    if (!hasConfig(root || document)) return "";
    await renderAll(root || document);
    const container = getWidget(root || document);
    if (!container) return "";
    const token = tokenFor(container);
    if (!token) throw new Error("Complete the security check.");
    return token;
  };

  const reset = root => {
    const container = getWidget(root || document);
    if (!container) return;
    const widgetId = widgets.get(container);
    if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId);
    setToken(container, "");
    clearResponse(container);
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderAll().catch(() => {});
  });

  window.residueTurnstileCallback = token => {
    widgetContainers().forEach(container => setToken(container, token));
  };

  window.residueTurnstileExpired = () => {
    widgetContainers().forEach(container => {
      setToken(container, "");
      clearResponse(container);
    });
  };

  window.residueTurnstileError = errorCode => {
    widgetContainers().forEach(container => {
      showError(container, `Security check could not render (${errorCode}). Check the Turnstile site key and allowed hostname.`);
    });
    return true;
  };

  window.residueTurnstile = {
    hasConfig,
    renderAll,
    requireToken,
    reset
  };
})();
