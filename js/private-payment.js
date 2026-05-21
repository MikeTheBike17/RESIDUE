import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { residueTelemetry } from "./supabase-telemetry.js";

(() => {
  const cfg = window.env || {};
  const INVOICE_TABLE = cfg.SUPABASE_INVOICES_TABLE || "purchase_invoices";
  const CARD_CONFIG_TABLE = "card_configs";
  const SHIPPING_FEE = 0;
  const PAYFAST_PROCESS_URL = cfg.PAYFAST_PROCESS_URL || "https://www.payfast.co.za/eng/process";
  const PENDING_ORDER_KEY = "residue_pending_order";
  const THANK_YOU_REDIRECT_MS = 7000;

  const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
    ? null
    : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    checkoutFlowCard: qs("#checkout-flow-card"),
    checkoutLayout: qs(".checkout-layout"),
    checkoutSummaryCard: qs(".checkout-summary-card"),
    configureForm: qs(".configure-form"),
    checkoutStagePanels: qsa("[data-checkout-stage]"),
    fullName: qs("#full-name"),
    customerTitle: qs("#customer-title"),
    email: qs("#email-config"),
    phone: qs("#phone"),
    quantity: qs("#quantity"),
    cardConfigurator: qs(".card-configurator"),
    cardTypeButtons: qsa("[data-card-type]"),
    cardConfigOptions: qsa("[data-card-config]"),
    standardCardPanel: qs("#standard-card-panel"),
    customLogoPanel: qs("#custom-logo-panel"),
    customLogoFile: qs("#custom-logo-file"),
    customLogoFileName: qs("#custom-logo-file-name"),
    configurePrice: qs("#configure-price"),
    configurePriceNote: qs("#configure-price-note"),
    purchaseBtn: qs("#purchase-btn"),
    continueToDeliveryButtons: qsa('[data-checkout-continue="delivery"]'),
    validationModal: qs("#validation-modal"),
    missingFields: qs("#missing-fields-list"),
    validationClose: qs("#validation-close-btn"),
    paymentModal: qs("#payment-modal"),
    payClose: qs("#payment-modal .close-btn"),
    termsModal: qs("#terms-modal"),
    termsClose: qs("#terms-modal .close-btn"),
    termsAgreeBtn: qs("#terms-agree-btn"),
    termsDisagreeBtn: qs("#terms-disagree-btn"),
    subtotal: qs("#modal-subtotal"),
    shipping: qs("#modal-shipping"),
    total: qs("#modal-total"),
    shippingName: qs("#shipping-name"),
    shippingStreet: qs("#shipping-street"),
    shippingSuburb: qs("#shipping-suburb"),
    shippingCity: qs("#shipping-city"),
    shippingProvince: qs("#shipping-province"),
    shippingPostal: qs("#shipping-postal"),
    shippingBackBtn: qs("#shipping-back-btn"),
    shippingNextBtn: qs("#shipping-next-btn"),
    payfastStatus: qs("#payfast-status"),
    payfastConfirmStatus: qs("#payfast-confirm-status"),
    summaryPaymentStatus: qs("#summary-payment-status"),
    payfastConfirmModal: qs("#payfast-confirm-modal"),
    payfastConfirmClose: qs("#payfast-confirm-modal .close-btn"),
    payfastSubtotal: qs("#payfast-subtotal"),
    payfastShipping: qs("#payfast-shipping"),
    payfastTotal: qs("#payfast-total"),
    payfastBackBtn: qs("#payfast-back-btn"),
    payfastContinueBtn: qs("#payfast-continue-btn"),
    stitchContinueBtn: qs("#stitch-continue-btn"),
    paymentProviderButtons: qsa("[data-payment-provider]"),
    payfastRedirectNote: qs("#payfast-redirect-note"),
    payfastForm: qs("#payfast-form"),
    thankYouModal: qs("#thank-you-modal"),
    thankYouHeading: qs("#thank-you-heading"),
    thankYouMessage: qs("#thank-you-message"),
    thankYouInvoice: qs("#thank-you-invoice"),
    thankYouPaymentStatus: qs("#thank-you-payment-status"),
    thankYouRedirectNote: qs("#thank-you-redirect-note"),
    redirectBtn: qs("#redirect-btn"),
    termsBackBtn: qs("#terms-back-btn"),
    checkoutStepItems: qsa("[data-checkout-step]"),
    checkoutStepLines: qsa(".checkout-stepper-line"),
    summaryPreviewImage: qs("#summary-preview-image"),
    summaryCardType: qs("#summary-card-type"),
    summaryCardDetail: qs("#summary-card-detail"),
    summaryQuantity: qs("#summary-quantity")
  };

  const pfFields = {
    merchantId: qs("#pf-merchant-id"),
    merchantKey: qs("#pf-merchant-key"),
    returnUrl: qs("#pf-return-url"),
    cancelUrl: qs("#pf-cancel-url"),
    notifyUrl: qs("#pf-notify-url"),
    nameFirst: qs("#pf-name-first"),
    nameLast: qs("#pf-name-last"),
    email: qs("#pf-email"),
    paymentId: qs("#pf-payment-id"),
    amount: qs("#pf-amount"),
    itemName: qs("#pf-item-name"),
    itemDescription: qs("#pf-item-description"),
    customInvoice: qs("#pf-custom-invoice"),
    customEmail: qs("#pf-custom-email"),
    customProduct: qs("#pf-custom-product"),
    customQty: qs("#pf-custom-qty")
  };

  let selectedCardConfiguration = null;
  let activeCardType = null;
  let customLogoDataUrl = "";
  let customLogoMeta = null;
  let pendingTermsOrder = null;
  let payFastCredentialsPromise = null;
  let thankYouRedirectTimer = null;
  let currentCheckoutStage = 1;
  let termsAccepted = false;
  let summaryShippingUnlocked = false;
  let selectedPaymentProvider = "payfast";

  function setStatus(el, message, type = "") {
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
    el.className = "status configure-status";
    if (type) el.classList.add(type);
  }

  function setPayFastStatus(message, type = "") {
    setStatus(els.payfastStatus, message, type);
    setStatus(els.payfastConfirmStatus, message, type);
    setStatus(els.summaryPaymentStatus, message, type);
  }

  function shippingAmountForQuantity(qty) {
    return SHIPPING_FEE;
  }

  function sidebarShippingAmount() {
    return summaryShippingUnlocked ? shippingAmountForQuantity(getCheckoutData().qty) : 0;
  }

  function setPaymentProviderButtonsDisabled(disabled) {
    if (els.payfastContinueBtn) els.payfastContinueBtn.disabled = disabled;
    if (els.stitchContinueBtn) els.stitchContinueBtn.disabled = disabled;
    if (els.payfastBackBtn) els.payfastBackBtn.disabled = disabled;
    if (els.purchaseBtn) els.purchaseBtn.disabled = Boolean(disabled && currentCheckoutStage === 4);
  }

  function setSelectedPaymentProvider(provider = "payfast") {
    const normalized = "payfast";
    selectedPaymentProvider = normalized;
    els.paymentProviderButtons.forEach((button) => {
      const isSelected = button.getAttribute("data-payment-provider") === normalized;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
    if (normalized) setPayFastStatus("");
    updatePurchaseButtonLabel();
  }

  function clearThankYouRedirect() {
    if (thankYouRedirectTimer) {
      window.clearTimeout(thankYouRedirectTimer);
      thankYouRedirectTimer = null;
    }
  }

  function scheduleThankYouRedirect() {
    clearThankYouRedirect();
    if (els.thankYouRedirectNote) {
      els.thankYouRedirectNote.hidden = false;
      els.thankYouRedirectNote.textContent = "Redirecting you back to the homepage...";
    }
    thankYouRedirectTimer = window.setTimeout(() => {
      window.location.href = "index.html";
    }, THANK_YOU_REDIRECT_MS);
  }

  function openModal(el) {
    if (!el) return;
    if (el.hasAttribute?.("data-checkout-stage")) {
      el.classList.remove("hidden");
      el.setAttribute("aria-hidden", "false");
      return;
    }
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }

  function closeModal(el) {
    if (!el) return;
    if (el.hasAttribute?.("data-checkout-stage")) {
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
      return;
    }
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }

  function checkoutStageFor(el) {
    return Number(el?.getAttribute?.("data-checkout-stage") || 1);
  }

  function checkoutStageSections() {
    return els.checkoutStagePanels.filter(Boolean);
  }

  function mainFieldErrors() {
    const missing = [];
    const requiredMain = qsa("[required]", els.configureForm || document);
    requiredMain.forEach((input) => {
      if (!input.value.trim()) {
        const label = qs(`label[for="${input.id}"]`);
        missing.push(label ? label.textContent.trim() : input.id);
      }
    });
    const { qty } = getCheckoutData();
    if (qty <= 0) missing.push("Quantity (must be greater than 0)");
    if (!activeCardType) missing.push("Select a card type");
    if (standardCardsEnabled() && !selectedCardConfiguration) missing.push("Select a card configuration");
    if (customLogoEnabled() && !els.customLogoFile?.files?.length) missing.push("Upload custom logo image");
    return missing;
  }

  function shippingFieldErrors() {
    const missing = [];
    [
      els.email,
      els.phone,
      els.shippingName,
      els.shippingStreet,
      els.shippingSuburb,
      els.shippingCity,
      els.shippingProvince,
      els.shippingPostal
    ].forEach((input) => {
      if (!input) return;
      if ((input.value || "").trim()) return;
      const label = qs(`label[for="${input.id}"]`);
      missing.push(label ? label.textContent.trim() : input.id);
    });
    return missing;
  }

  function showValidationModal(missing) {
    if (!els.missingFields) return;
    els.missingFields.innerHTML = missing
      .map((field) => `<div class="validation-list-item">&bull; ${field}</div>`)
      .join("");
    openModal(els.validationModal);
  }

  function canAccessStage(step) {
    if (step <= 1) return true;
    if (mainFieldErrors().length > 0) return false;
    if (step === 2) return true;
    if (shippingFieldErrors().length > 0) return false;
    if (step === 3) return true;
    return termsAccepted;
  }

  function invalidateStageProgress(fromStage) {
    if (fromStage <= 3) {
      pendingTermsOrder = null;
      termsAccepted = false;
      setPaymentProviderButtonsDisabled(false);
      setPayFastStatus("");
    }

    if (fromStage <= 2 && currentCheckoutStage > 2) {
      updateCheckoutStage(2);
      return;
    }

    if (fromStage <= 3 && currentCheckoutStage > 3) {
      updateCheckoutStage(3);
      return;
    }

    updateCheckoutStage(currentCheckoutStage);
  }

  function updateCheckoutStage(stage = 1, { scroll = false } = {}) {
    currentCheckoutStage = Math.max(1, Math.min(4, Number(stage) || 1));

    checkoutStageSections().forEach(panel => {
      const visible = currentCheckoutStage === checkoutStageFor(panel);
      panel.classList.toggle("hidden", !visible);
      panel.setAttribute("aria-hidden", String(!visible));
    });

    els.checkoutStepItems.forEach(item => {
      const step = Number(item.getAttribute("data-checkout-step") || 0);
      const bubble = item.querySelector(".purchase-step");
      const isActive = step === currentCheckoutStage;
      const isComplete = step < currentCheckoutStage;
      const isLocked = !isComplete && !isActive && !canAccessStage(step);
      item.classList.toggle("is-active", isActive);
      item.classList.toggle("is-complete", isComplete);
      item.classList.toggle("is-locked", isLocked);
      item.setAttribute("aria-disabled", String(isLocked));
      if (bubble) {
        bubble.classList.toggle("is-active", isActive);
        bubble.classList.toggle("is-complete", isComplete);
        if (isActive) bubble.setAttribute("aria-current", "step");
        else bubble.removeAttribute("aria-current");
      }
      if (isActive) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });

    els.checkoutStepLines.forEach((line, index) => {
      line.classList.toggle("is-complete", index < currentCheckoutStage - 1);
    });

    updatePurchaseButtonLabel();
    els.checkoutLayout?.classList.toggle("is-payment-focus", currentCheckoutStage === 4);
    if (els.payfastRedirectNote) els.payfastRedirectNote.hidden = currentCheckoutStage !== 4;

    if (scroll) {
      const target = currentCheckoutStage === 4
        ? els.checkoutSummaryCard || els.payfastRedirectNote || els.purchaseBtn
        : els.checkoutFlowCard
        || checkoutStageSections().find(panel => checkoutStageFor(panel) === currentCheckoutStage)
        || els.configureForm;
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }

  function showPurchaseStep(nextModal, previousModal = null) {
    if (nextModal?.hasAttribute?.("data-checkout-stage")) {
      updateCheckoutStage(checkoutStageFor(nextModal), { scroll: true });
      return;
    }
    if (previousModal) closeModal(previousModal);
    openModal(nextModal);
  }

  function formatCurrency(value) {
    return "R" + value.toLocaleString("en-ZA");
  }

  function amountForPayFast(value) {
    return Number(value).toFixed(2);
  }

  function baseUnitPrice(qty) {
    if (standardCardsEnabled()) return 5;
    if (qty > 4) return 400;
    if (qty >= 2) return 500;
    return 500;
  }

  function standardCardsEnabled() {
    return activeCardType === "standard";
  }

  function customLogoEnabled() {
    return activeCardType === "custom";
  }

  function customLogoFeePerCard() {
    return customLogoEnabled() ? 100 : 0;
  }

  function configurationLabel(configNumber) {
    if (customLogoEnabled()) return "Custom company logo card";
    return `Card configuration ${configNumber || ""}`.trim();
  }

  function standardCardPreviewSource(configNumber) {
    if (String(configNumber || "") === "3") return "images/card-images/card-front-3.jpeg";
    return `images/card-images/card-front-${configNumber}.jpg`;
  }

  function selectedCardPreviewSource() {
    if (customLogoEnabled()) return customLogoDataUrl || "images/card-images/card-front-custom.jpg";
    if (standardCardsEnabled() && selectedCardConfiguration) {
      return standardCardPreviewSource(selectedCardConfiguration);
    }
    return "images/card-images/card-front-1.jpg";
  }

  function updateCheckoutSummary() {
    const checkout = getCheckoutData();
    let typeLabel = "Awaiting selection";
    let detailLabel = "Choose a card type to personalise your order.";

    if (customLogoEnabled()) {
      typeLabel = "Custom company logo card";
      detailLabel = customLogoMeta?.name
        ? `Logo file: ${customLogoMeta.name}`
        : "Upload your logo to complete the custom card.";
    } else if (standardCardsEnabled() && selectedCardConfiguration) {
      typeLabel = `Residue Card Type ${selectedCardConfiguration}`;
      detailLabel = configurationLabel(selectedCardConfiguration);
    } else if (standardCardsEnabled()) {
      typeLabel = "Standard Residue card";
      detailLabel = "Choose one of the three Residue layouts.";
    }

    if (els.summaryPreviewImage) {
      els.summaryPreviewImage.src = selectedCardPreviewSource();
      els.summaryPreviewImage.alt = `${typeLabel} preview`;
    }
    if (els.summaryCardType) els.summaryCardType.textContent = typeLabel;
    if (els.summaryCardDetail) els.summaryCardDetail.textContent = detailLabel;
    if (els.summaryQuantity) els.summaryQuantity.textContent = String(checkout.qty || 0);
  }

  function updatePurchaseButtonLabel() {
    if (!els.continueToDeliveryButtons.length) return;

    let label = "Continue to Delivery";

    if (currentCheckoutStage === 2) {
      label = "Continue to Review & Terms";
    } else if (currentCheckoutStage === 3) {
      label = "Review Terms Below";
    } else if (currentCheckoutStage === 4) {
      label = "Pay Now";
    } else if (standardCardsEnabled()) {
      label = selectedCardConfiguration
        ? `Continue to Delivery - Card Type ${selectedCardConfiguration}`
        : "Continue to Delivery - Select Card Type";
    } else if (customLogoEnabled()) {
      label = els.customLogoFile?.files?.length
        ? "Continue to Delivery - Custom Logo"
        : "Continue to Delivery - Insert Logo Image";
    }

    els.continueToDeliveryButtons.forEach((button) => {
      button.textContent = label;
    });
  }

  function buildPendingTermsOrder() {
    const checkout = getCheckoutData();
    return {
      invoice_no: generateInvoiceNo(),
      customer_name: (els.fullName?.value || "").trim(),
      customer_title: (els.customerTitle?.value || "").trim(),
      customer_email: (els.email?.value || "").trim().toLowerCase(),
      customer_phone: (els.phone?.value || "").trim(),
      product: customLogoEnabled() ? "custom-company-logo-card" : `card-configuration-${selectedCardConfiguration}`,
      card_configuration: standardCardsEnabled() ? selectedCardConfiguration : null,
      custom_logo_requested: customLogoEnabled(),
      custom_logo_file_name: customLogoMeta?.name || null,
      quantity: checkout.qty,
      unit_price: checkout.perItem,
      subtotal_amount: checkout.subtotal,
      shipping_amount: checkout.shipping,
      total_amount: checkout.total,
      payment_provider: null,
      payment_status: "PENDING",
      shipping_name: (els.shippingName?.value || "").trim(),
      shipping_street: (els.shippingStreet?.value || "").trim(),
      shipping_suburb: (els.shippingSuburb?.value || "").trim(),
      shipping_city: (els.shippingCity?.value || "").trim(),
      shipping_province: (els.shippingProvince?.value || "").trim(),
      shipping_postal: (els.shippingPostal?.value || "").trim(),
      created_at: new Date().toISOString()
    };
  }

  function splitName(fullName) {
    const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { first: "", last: "" };
    if (parts.length === 1) return { first: parts[0], last: "." };
    return { first: parts[0], last: parts.slice(1).join(" ") };
  }

  function generateInvoiceNo() {
    const now = new Date();
    const stamp = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
      String(now.getUTCHours()).padStart(2, "0"),
      String(now.getUTCMinutes()).padStart(2, "0"),
      String(now.getUTCSeconds()).padStart(2, "0")
    ].join("");
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-${stamp}-${rand}`;
  }

  function providerLabel(provider) {
    if (provider === "stitch") return "Stitch";
    return "PayFast";
  }

  function normalizePayFastStatus(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "COMPLETE" || normalized === "SUCCESS") return "COMPLETE";
    if (normalized === "FAILED") return "FAILED";
    if (normalized === "CANCELLED" || normalized === "CANCELED" || normalized === "CLOSED") return "CANCELLED";
    if (normalized === "EXPIRED") return "EXPIRED";
    return normalized || "PENDING";
  }

  function normalizeStitchCallbackStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "complete") return "COMPLETE";
    if (normalized === "closed") return "CANCELLED";
    if (normalized === "failed") return "FAILED";
    return "PENDING";
  }

  function normalizeStitchRequestStatus(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "completed") return "COMPLETE";
    if (normalized === "cancelled") return "CANCELLED";
    if (normalized === "expired") return "EXPIRED";
    return "PENDING";
  }

  function paymentStatusText(status, provider = "") {
    const via = provider ? ` via ${providerLabel(provider)}` : "";
    if (status === "COMPLETE") return `Payment received${via}.`;
    if (status === "FAILED") return `Payment failed${via}.`;
    if (status === "CANCELLED") return `Payment cancelled${via}.`;
    if (status === "EXPIRED") return `Payment session expired${via}.`;
    return `Payment status${via}: ${status || "PENDING"}.`;
  }

  function buildPostPaymentMessage(status, provider = "") {
    const providerName = providerLabel(provider);
    if (status === "COMPLETE") {
      return {
        heading: "Payment received",
        message: `Your payment was successfully completed through ${providerName}. We are now processing your Residue NFC card order and will continue with fulfilment.`,
        shouldRedirect: true
      };
    }
    if (status === "FAILED") {
      return {
        heading: "Payment not completed",
        message: `Your ${providerName} payment was not completed successfully. You can try again from the purchase flow or contact support if the issue continues.`,
        shouldRedirect: false
      };
    }
    if (status === "CANCELLED") {
      return {
        heading: "Payment cancelled",
        message: `The ${providerName} checkout was cancelled before payment was completed. Your order has not moved into production.`,
        shouldRedirect: false
      };
    }
    if (status === "EXPIRED") {
      return {
        heading: "Payment expired",
        message: `The ${providerName} payment session expired before completion. Please start the payment step again when you're ready.`,
        shouldRedirect: false
      };
    }
    return {
      heading: "Order awaiting payment",
      message: `Your order is saved, but ${providerName} has not confirmed payment yet. If you already paid, the status may update shortly.`,
      shouldRedirect: false
    };
  }

  function parsePaymentReturnState() {
    const params = new URLSearchParams(window.location.search);
    const provider = String(params.get("provider") || "").trim().toLowerCase();

    if (provider === "stitch" || params.has("externalReference") || (params.has("id") && params.has("status"))) {
      return {
        provider: "stitch",
        params,
        invoice: params.get("externalReference") || params.get("invoice") || "",
        callbackStatus: params.get("status") || "",
        stitchPaymentRequestId: params.get("id") || ""
      };
    }

    const payfastInvoice = params.get("m_payment_id") || params.get("invoice") || "";
    const payfastPaymentId = params.get("pf_payment_id") || "";
    const payfastStatus = params.get("payment_status") || params.get("payment") || "";
    if (provider === "payfast" || payfastInvoice || payfastPaymentId || payfastStatus) {
      return {
        provider: "payfast",
        params,
        invoice: payfastInvoice,
        paymentStatus: normalizePayFastStatus(payfastStatus),
        payfastPaymentId
      };
    }

    return null;
  }

  function buildPaymentReturnUrl(provider, params = {}) {
    const safeProvider = provider === "stitch" ? "stitch" : "payfast";
    const u = new URL("residue-private.html", window.location.origin);
    u.searchParams.set("provider", safeProvider);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && String(value).trim()) {
        u.searchParams.set(key, String(value));
      }
    });
    return u.toString();
  }

  function buildSupabaseFunctionsBaseUrl() {
    if (!cfg.SUPABASE_URL) return "";
    try {
      const url = new URL(cfg.SUPABASE_URL);
      return `${url.origin}/functions/v1`;
    } catch {
      return "";
    }
  }

  function buildSiteApiUrl(path) {
    try {
      return new URL(`/api/${path}`, window.location.origin).toString();
    } catch {
      return `/api/${path}`;
    }
  }

  async function getFunctionsRequestHeaders() {
    const headers = {
      apikey: cfg.SUPABASE_ANON_KEY || "",
      Accept: "application/json"
    };

    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    }

    return headers;
  }

  function getPayFastPublicConfig(order) {
    const functionsBaseUrl = buildSupabaseFunctionsBaseUrl();
    return {
      returnUrl: buildPaymentReturnUrl("payfast", { invoice: order?.invoice_no || "" }),
      cancelUrl: buildPaymentReturnUrl("payfast", {
        invoice: order?.invoice_no || "",
        payment: "cancelled"
      }),
      notifyUrl: functionsBaseUrl ? `${functionsBaseUrl}/payfast-notify` : ""
    };
  }

  async function getPayFastCredentials() {
    if (payFastCredentialsPromise) return payFastCredentialsPromise;

    payFastCredentialsPromise = (async () => {
      if (!supabase) throw new Error("Supabase is not configured in js/env.js.");

      const functionsBaseUrl = buildSupabaseFunctionsBaseUrl();
      if (!functionsBaseUrl) {
        throw new Error("Could not determine the Supabase Functions URL.");
      }

      const headers = await getFunctionsRequestHeaders();

      const response = await fetch(`${functionsBaseUrl}/payfast-config`, {
        method: "GET",
        headers
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load PayFast checkout configuration.");
      }

      const merchantId = String(payload?.merchantId || "").trim();
      const merchantKey = String(payload?.merchantKey || "").trim();
      if (!merchantId || !merchantKey) {
        throw new Error("PayFast checkout configuration is incomplete.");
      }

      return { merchantId, merchantKey };
    })();

    try {
      return await payFastCredentialsPromise;
    } catch (error) {
      payFastCredentialsPromise = null;
      throw error;
    }
  }

  async function createStitchPaymentRequest(order) {
    const headers = await getFunctionsRequestHeaders();
    headers["Content-Type"] = "application/json";

    const response = await fetch(buildSiteApiUrl("stitch-payment-request"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        order,
        redirectUrl: buildPaymentReturnUrl("stitch", { invoice: order.invoice_no })
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || payload?.detail || "Could not create the Stitch payment request.");
    }

    const redirectUrl = String(payload?.redirectUrl || "").trim();
    const requestId = String(payload?.id || "").trim();
    if (!redirectUrl || !requestId) {
      throw new Error("Stitch payment setup is incomplete.");
    }

    return {
      id: requestId,
      redirectUrl,
      status: String(payload?.status || "").trim()
    };
  }

  async function getStitchPaymentStatus(requestId) {
    const headers = await getFunctionsRequestHeaders();
    const response = await fetch(`${buildSiteApiUrl("stitch-payment-status")}?id=${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || payload?.detail || "Could not verify the Stitch payment status.");
    }

    return payload;
  }

  async function getAuthenticatedUser() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user || null;
  }

  function buildInvoiceRecord(order, userId = null) {
    return {
      invoice_no: order.invoice_no,
      profile_id: userId,
      customer_name: order.customer_name,
      customer_title: order.customer_title,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      quantity: order.quantity,
      card_configuration: order.card_configuration,
      custom_logo_requested: order.custom_logo_requested,
      custom_logo_file_name: order.custom_logo_file_name || null,
      custom_logo_image: customLogoDataUrl || null,
      shipping_name: order.shipping_name,
      shipping_street: order.shipping_street,
      shipping_suburb: order.shipping_suburb,
      shipping_city: order.shipping_city,
      shipping_province: order.shipping_province,
      shipping_postal: order.shipping_postal,
      unit_price: order.unit_price,
      subtotal_amount: order.subtotal_amount,
      shipping_amount: order.shipping_amount,
      total_amount: order.total_amount,
      payment_provider: order.payment_provider,
      payment_status: order.payment_status,
      created_at: order.created_at,
      updated_at: new Date().toISOString()
    };
  }

  async function upsertInvoice(order, userId = null) {
    if (!supabase) throw new Error("Supabase is not configured in js/env.js.");
    const { error } = await supabase
      .from(INVOICE_TABLE)
      .upsert(buildInvoiceRecord(order, userId), { onConflict: "invoice_no" });
    if (!error) return;

    if (/column .* does not exist/i.test(error.message || "")) {
      const fallbackRecord = buildInvoiceRecord(order, userId);
      delete fallbackRecord.unit_price;
      delete fallbackRecord.subtotal_amount;
      delete fallbackRecord.shipping_amount;
      delete fallbackRecord.total_amount;
      const { error: fallbackError } = await supabase
        .from(INVOICE_TABLE)
        .upsert(fallbackRecord, { onConflict: "invoice_no" });
      if (!fallbackError) return;
      throw new Error(`Could not save invoice in Supabase: ${fallbackError.message}`);
    }

    throw new Error(`Could not save invoice in Supabase: ${error.message}`);
  }

  async function updateInvoiceStatus(invoiceNo, updates) {
    if (!supabase || !invoiceNo) return;
    const payload = Object.fromEntries(
      Object.entries({ ...updates, updated_at: new Date().toISOString() })
        .filter(([, value]) => value !== undefined)
    );

    let { error } = await supabase
      .from(INVOICE_TABLE)
      .update(payload)
      .eq("invoice_no", invoiceNo);

    if (error && /column .* does not exist/i.test(error.message || "")) {
      const fallbackPayload = {
        payment_provider: payload.payment_provider,
        payment_status: payload.payment_status,
        updated_at: payload.updated_at
      };
      ({ error } = await supabase
        .from(INVOICE_TABLE)
        .update(fallbackPayload)
        .eq("invoice_no", invoiceNo));
    }

    if (error) throw new Error(`Could not update invoice in Supabase: ${error.message}`);
  }

  async function fetchInvoicePaymentState(invoiceNo) {
    if (!supabase || !invoiceNo) return null;
    const { data, error } = await supabase
      .from(INVOICE_TABLE)
      .select("payment_provider,payment_status,payment_reference")
      .eq("invoice_no", invoiceNo)
      .maybeSingle();
    if (error) return null;
    return data || null;
  }

  async function configurePayFastForm(order) {
    const { merchantId, merchantKey } = await getPayFastCredentials();
    const publicConfig = getPayFastPublicConfig(order);
    if (!publicConfig.notifyUrl) {
      throw new Error("PayFast notify URL could not be derived from SUPABASE_URL.");
    }

    const names = splitName(order.customer_name);

    pfFields.merchantId.value = merchantId;
    pfFields.merchantKey.value = merchantKey;
    pfFields.notifyUrl.value = publicConfig.notifyUrl;
    pfFields.returnUrl.value = publicConfig.returnUrl;
    pfFields.cancelUrl.value = publicConfig.cancelUrl;
    pfFields.nameFirst.value = names.first;
    pfFields.nameLast.value = names.last;
    pfFields.email.value = order.customer_email;
    pfFields.paymentId.value = order.invoice_no;
    pfFields.amount.value = amountForPayFast(order.total_amount);
    pfFields.itemName.value = `${configurationLabel(order.card_configuration)} x ${order.quantity}`;
    pfFields.itemDescription.value = `Residue order ${order.invoice_no}${order.custom_logo_requested ? " with custom logo" : ""}`;
    pfFields.customInvoice.value = order.invoice_no;
    pfFields.customEmail.value = order.customer_email;
    pfFields.customProduct.value = order.product;
    pfFields.customQty.value = String(order.quantity);
    els.payfastForm.action = PAYFAST_PROCESS_URL;
  }

  function getCheckoutData() {
    const qty = Number.parseInt(els.quantity?.value || "0", 10);
    const safeQty = Number.isNaN(qty) ? 0 : qty;
    const basePerItem = baseUnitPrice(safeQty);
    const logoFee = customLogoFeePerCard();
    const perItem = basePerItem + logoFee;
    const subtotal = safeQty * perItem;
    const shipping = shippingAmountForQuantity(safeQty);
    const total = subtotal + shipping;
    return { qty: safeQty, basePerItem, logoFee, perItem, subtotal, shipping, total };
  }

  function requiredFieldErrors() {
    return mainFieldErrors();
  }

  function setSidebarSummaryDisplay(subtotal) {
    const shipping = sidebarShippingAmount();
    const total = subtotal + shipping;
    if (els.subtotal) els.subtotal.textContent = formatCurrency(subtotal);
    if (els.shipping) els.shipping.textContent = formatCurrency(shipping);
    if (els.total) els.total.textContent = formatCurrency(total);
  }

  function setPaymentSummaryDisplay(subtotal, shipping, total) {
    if (els.payfastSubtotal) els.payfastSubtotal.textContent = formatCurrency(subtotal);
    if (els.payfastShipping) els.payfastShipping.textContent = formatCurrency(shipping);
    if (els.payfastTotal) els.payfastTotal.textContent = formatCurrency(total);
  }

  function unlockSidebarShippingSummary() {
    if (summaryShippingUnlocked) return;
    summaryShippingUnlocked = true;
    setSidebarSummaryDisplay(getCheckoutData().subtotal);
  }

  function updatePriceDisplay() {
    const checkout = getCheckoutData();
    if (els.configurePrice) {
      els.configurePrice.textContent = formatCurrency(checkout.subtotal);
    }
    if (els.configurePriceNote) {
      if (!activeCardType || checkout.qty <= 0 || (standardCardsEnabled() && !selectedCardConfiguration)) {
        els.configurePriceNote.textContent = "Select a quantity and card type.";
      } else if (customLogoEnabled()) {
        els.configurePriceNote.textContent = `${checkout.qty} custom card${checkout.qty === 1 ? "" : "s"} at ${formatCurrency(checkout.perItem)} each. Includes custom logo at ${formatCurrency(checkout.logoFee)} per card.`;
      } else {
        els.configurePriceNote.textContent = `${checkout.qty} card${checkout.qty === 1 ? "" : "s"} at ${formatCurrency(checkout.perItem)} each.`;
      }
    }
    setSidebarSummaryDisplay(checkout.subtotal);
    updateCheckoutSummary();
    updatePurchaseButtonLabel();
  }

  function setCardConfigurationSelection() {
    els.cardConfigOptions.forEach((option) => {
      option.addEventListener("click", () => {
        els.cardConfigOptions.forEach((item) => {
          item.classList.remove("is-selected");
          item.setAttribute("aria-pressed", "false");
        });
        option.classList.add("is-selected");
        option.setAttribute("aria-pressed", "true");
        selectedCardConfiguration = Number(option.getAttribute("data-card-config")) || null;
        updatePriceDisplay();
        invalidateStageProgress(2);
      });
    });
  }

  function updateCustomLogoFileName() {
    if (!els.customLogoFileName) return;
    els.customLogoFileName.textContent = els.customLogoFile?.files?.[0]?.name || "No logo selected.";
    updateCheckoutSummary();
    updatePurchaseButtonLabel();
  }

  function setCardType(type) {
    activeCardType = type;
    els.cardTypeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-card-type") === type));
    });
    if (els.standardCardPanel) els.standardCardPanel.hidden = type !== "standard";
    if (els.customLogoPanel) els.customLogoPanel.hidden = type !== "custom";
    updatePriceDisplay();
    invalidateStageProgress(2);
  }

  function resetCardTypeSelection() {
    activeCardType = null;
    els.cardTypeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", "false");
    });
    if (els.standardCardPanel) els.standardCardPanel.hidden = true;
    if (els.customLogoPanel) els.customLogoPanel.hidden = true;
    updatePriceDisplay();
    invalidateStageProgress(2);
  }

  function wireCardTypeToggle() {
    els.cardTypeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setCardType(button.getAttribute("data-card-type") || null);
      });
    });

    els.customLogoFile?.addEventListener("change", async () => {
      const file = els.customLogoFile?.files?.[0] || null;
      if (!file) {
        customLogoDataUrl = "";
        customLogoMeta = null;
        updateCustomLogoFileName();
        invalidateStageProgress(2);
        return;
      }
      if (!(file.type || "").startsWith("image/")) {
        setPayFastStatus("Custom logo must be an image file.", "error");
        els.customLogoFile.value = "";
        customLogoDataUrl = "";
        customLogoMeta = null;
        updateCustomLogoFileName();
        invalidateStageProgress(2);
        return;
      }
      customLogoMeta = { name: file.name, type: file.type || "", size: file.size || 0 };
      customLogoDataUrl = await readFileAsDataUrl(file);
      updateCustomLogoFileName();
      invalidateStageProgress(2);
    });

  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read custom logo file."));
      reader.readAsDataURL(file);
    });
  }

  async function saveCardConfiguration(user = null) {
    if (!supabase || !activeCardType) return;
    const sessionUser = user || await getAuthenticatedUser();
    if (!sessionUser?.id) return;
    const { data: existingRow } = await supabase
      .from(CARD_CONFIG_TABLE)
      .select("config_data")
      .eq("profile_id", sessionUser.id)
      .maybeSingle();
    const configData = {
      ...(existingRow?.config_data || {}),
      purchase_configuration: {
        customer_title: (els.customerTitle?.value || "").trim(),
        card_type: activeCardType,
        card_configuration: standardCardsEnabled() ? selectedCardConfiguration : null,
        quantity: getCheckoutData().qty,
        custom_logo_requested: customLogoEnabled(),
        custom_logo_file_name: customLogoMeta?.name || "",
        custom_logo_file_type: customLogoMeta?.type || "",
        custom_logo_file_size: customLogoMeta?.size || 0,
        custom_logo_image: customLogoDataUrl || "",
        updated_at: new Date().toISOString()
      }
    };
    const { error } = await supabase.from(CARD_CONFIG_TABLE).upsert({
      profile_id: sessionUser.id,
      auth_email: (sessionUser.email || "").trim().toLowerCase(),
      config_data: configData,
      updated_at: new Date().toISOString()
    });
    if (error) throw new Error(`Could not save card configuration: ${error.message}`);
  }

  function persistPending(order) {
    sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(order));
  }

  function clearPending() {
    sessionStorage.removeItem(PENDING_ORDER_KEY);
  }

  function buildProviderOrder(order, provider) {
    return {
      ...order,
      payment_provider: provider,
      payment_status: "PENDING"
    };
  }

  async function proceedWithSelectedProvider() {
    if (!pendingTermsOrder) {
      updateCheckoutStage(3, { scroll: true });
      return;
    }

    selectedPaymentProvider = "payfast";
    await proceedToPayFast(pendingTermsOrder);

    if (!els.payfastConfirmStatus?.classList.contains("error")) {
      pendingTermsOrder = null;
    }
  }

  async function onPurchaseClick() {
    if (currentCheckoutStage === 2) {
      await onShippingNextClick();
      return;
    }

    if (currentCheckoutStage === 4) {
      await proceedWithSelectedProvider();
      return;
    }

    if (currentCheckoutStage === 3) {
      updateCheckoutStage(currentCheckoutStage, { scroll: true });
      return;
    }

    const missing = requiredFieldErrors();
    if (missing.length > 0) {
      residueTelemetry.logPurchaseEvent({
        stage: "checkout_validate",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: "Checkout validation failed.",
        metadata: { missing_fields: missing }
      });
      showValidationModal(missing);
      return;
    }

    const summary = getCheckoutData();
    setSidebarSummaryDisplay(summary.subtotal);
    setPaymentSummaryDisplay(summary.subtotal, summary.shipping, summary.total);
    updateCheckoutSummary();
    if (els.shippingName && !els.shippingName.value.trim()) {
      els.shippingName.value = (els.fullName?.value || "").trim();
    }
    setPayFastStatus("");
    showPurchaseStep(els.paymentModal);
  }

  async function onShippingNextClick() {
    const missing = shippingFieldErrors();
    if (missing.length > 0) {
      residueTelemetry.logPurchaseEvent({
        stage: "shipping_validate",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: "Shipping details incomplete before payment."
      });
      setPayFastStatus("Complete all delivery fields before moving to review.", "error");
      return;
    }

    const summary = getCheckoutData();
    pendingTermsOrder = buildPendingTermsOrder();
    termsAccepted = false;
    setPayFastStatus("");
    setPaymentSummaryDisplay(summary.subtotal, summary.shipping, summary.total);
    unlockSidebarShippingSummary();

    showPurchaseStep(els.termsModal, els.paymentModal);
  }

  async function proceedToPayFast(order) {
    const payFastOrder = buildProviderOrder(order, "payfast");
    try {
      const sessionUser = await getAuthenticatedUser();
      setPaymentProviderButtonsDisabled(true);
      setPayFastStatus("Saving invoice and preparing payment...", "loading");
      await saveCardConfiguration(sessionUser);
      await upsertInvoice(payFastOrder, sessionUser?.id || null);
      residueTelemetry.logPurchaseEvent({
        stage: "invoice_created",
        outcome: "success",
        email: payFastOrder.customer_email,
        invoice_no: payFastOrder.invoice_no,
        order_ref: payFastOrder.invoice_no,
        payment_provider: payFastOrder.payment_provider,
        payment_status: payFastOrder.payment_status,
        amount_total: payFastOrder.total_amount,
        product: payFastOrder.product,
        quantity: payFastOrder.quantity,
        detail: "Invoice inserted in Supabase."
      });
      persistPending(payFastOrder);
      await configurePayFastForm(payFastOrder);
      residueTelemetry.logPurchaseEvent({
        stage: "redirect_payfast",
        outcome: "success",
        email: payFastOrder.customer_email,
        invoice_no: payFastOrder.invoice_no,
        order_ref: payFastOrder.invoice_no,
        payment_provider: "payfast",
        payment_status: "PENDING",
        amount_total: payFastOrder.total_amount,
        product: payFastOrder.product,
        quantity: payFastOrder.quantity,
        detail: "Redirecting user to PayFast."
      });
      setPayFastStatus("Redirecting to PayFast...", "success");
      setTimeout(() => {
        closeModal(els.payfastConfirmModal);
        els.payfastForm.submit();
      }, 250);
    } catch (err) {
      setPaymentProviderButtonsDisabled(false);
      residueTelemetry.logPurchaseEvent({
        stage: "invoice_created",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: err.message || "Could not save invoice/start payment."
      });
      setPayFastStatus(err.message || "Could not start payment.", "error");
    }
  }

  async function proceedToStitch(order) {
    const stitchOrder = buildProviderOrder(order, "stitch");

    try {
      const sessionUser = await getAuthenticatedUser();
      setPaymentProviderButtonsDisabled(true);
      setPayFastStatus("Saving invoice and preparing Stitch checkout...", "loading");
      await saveCardConfiguration(sessionUser);
      await upsertInvoice(stitchOrder, sessionUser?.id || null);
      residueTelemetry.logPurchaseEvent({
        stage: "invoice_created",
        outcome: "success",
        email: stitchOrder.customer_email,
        invoice_no: stitchOrder.invoice_no,
        order_ref: stitchOrder.invoice_no,
        payment_provider: stitchOrder.payment_provider,
        payment_status: stitchOrder.payment_status,
        amount_total: stitchOrder.total_amount,
        product: stitchOrder.product,
        quantity: stitchOrder.quantity,
        detail: "Invoice inserted in Supabase."
      });

      const stitchRequest = await createStitchPaymentRequest(stitchOrder);
      const pendingOrder = {
        ...stitchOrder,
        stitch_payment_request_id: stitchRequest.id
      };
      persistPending(pendingOrder);

      await updateInvoiceStatus(stitchOrder.invoice_no, {
        payment_provider: "stitch",
        payment_status: "PENDING",
        payment_reference: stitchRequest.id,
        stitch_payment_request_id: stitchRequest.id,
        payment_updated_at: new Date().toISOString()
      });

      residueTelemetry.logPurchaseEvent({
        stage: "redirect_stitch",
        outcome: "success",
        email: stitchOrder.customer_email,
        invoice_no: stitchOrder.invoice_no,
        order_ref: stitchOrder.invoice_no,
        payment_provider: "stitch",
        payment_status: "PENDING",
        amount_total: stitchOrder.total_amount,
        product: stitchOrder.product,
        quantity: stitchOrder.quantity,
        detail: "Redirecting user to Stitch."
      });

      setPayFastStatus("Redirecting to Stitch...", "success");
      setTimeout(() => {
        closeModal(els.payfastConfirmModal);
        window.location.assign(stitchRequest.redirectUrl);
      }, 250);
    } catch (err) {
      setPaymentProviderButtonsDisabled(false);
      residueTelemetry.logPurchaseEvent({
        stage: "redirect_stitch",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: err.message || "Could not start Stitch payment."
      });
      setPayFastStatus(err.message || "Could not start Stitch payment.", "error");
    }
  }

  function renderPostPaymentSummary({ provider, status, invoice, pendingOrder }) {
    const summary = buildPostPaymentMessage(status, provider);

    if (els.thankYouHeading) {
      els.thankYouHeading.textContent = summary.heading;
    }
    if (els.thankYouMessage) {
      els.thankYouMessage.textContent = summary.message;
    }
    if (els.thankYouInvoice) {
      els.thankYouInvoice.textContent = invoice || pendingOrder?.invoice_no || "Unknown";
      if (els.thankYouInvoice.parentElement) {
        els.thankYouInvoice.parentElement.hidden = false;
      }
    }
    if (els.thankYouPaymentStatus) {
      els.thankYouPaymentStatus.textContent = paymentStatusText(status, provider);
      els.thankYouPaymentStatus.hidden = false;
    }

    if (summary.shouldRedirect) {
      scheduleThankYouRedirect();
    } else {
      clearThankYouRedirect();
      if (els.thankYouRedirectNote) {
        els.thankYouRedirectNote.hidden = true;
      }
    }

    openModal(els.thankYouModal);
  }

  async function handleReturnFromPayFast(state, pendingOrder) {
    const invoice = state.invoice || pendingOrder?.invoice_no || "";
    const returnedStatus = state.paymentStatus || "PENDING";
    let status = returnedStatus === "CANCELLED" ? "CANCELLED" : "PENDING";

    try {
      const currentPaymentState = await fetchInvoicePaymentState(invoice);
      const currentStatus = normalizePayFastStatus(currentPaymentState?.payment_status || "");

      if (currentStatus === "COMPLETE") {
        status = "COMPLETE";
      } else if (status === "CANCELLED") {
        await updateInvoiceStatus(invoice, {
          payment_provider: "payfast",
          payment_status: "CANCELLED",
          payment_reference: state.payfastPaymentId || currentPaymentState?.payment_reference || null,
          payment_updated_at: new Date().toISOString()
        });
      } else if (currentStatus && currentStatus !== "PENDING") {
        status = currentStatus;
      }

      residueTelemetry.logPurchaseEvent({
        stage: "payment_return",
        outcome: "success",
        email: pendingOrder?.customer_email || null,
        invoice_no: invoice || pendingOrder?.invoice_no || null,
        order_ref: invoice || pendingOrder?.invoice_no || null,
        payment_provider: "payfast",
        payment_status: status || "PENDING",
        amount_total: pendingOrder?.total_amount ?? null,
        product: pendingOrder?.product ?? null,
        quantity: pendingOrder?.quantity ?? null,
        detail: "Processed PayFast browser return state. Trusted paid status is handled by PayFast ITN."
      });
    } catch (err) {
      console.error(err);
      residueTelemetry.logPurchaseEvent({
        stage: "payment_return",
        outcome: "failure",
        email: pendingOrder?.customer_email || null,
        invoice_no: invoice || pendingOrder?.invoice_no || null,
        order_ref: invoice || pendingOrder?.invoice_no || null,
        payment_provider: "payfast",
        payment_status: status || "PENDING",
        detail: err.message || "Could not update returned payment state."
      });
    }

    renderPostPaymentSummary({
      provider: "payfast",
      status,
      invoice,
      pendingOrder
    });
  }

  async function handleReturnFromStitch(state, pendingOrder) {
    const invoice = state.invoice || pendingOrder?.invoice_no || "";
    let status = normalizeStitchCallbackStatus(state.callbackStatus);

    try {
      if (state.stitchPaymentRequestId) {
        const stitchState = await getStitchPaymentStatus(state.stitchPaymentRequestId);
        status = normalizeStitchRequestStatus(stitchState?.status || state.callbackStatus);
      }

      await updateInvoiceStatus(invoice, {
        payment_provider: "stitch",
        payment_status: status,
        payment_reference: state.stitchPaymentRequestId || pendingOrder?.stitch_payment_request_id || null,
        stitch_payment_request_id: state.stitchPaymentRequestId || pendingOrder?.stitch_payment_request_id || null,
        payment_updated_at: new Date().toISOString()
      });

      residueTelemetry.logPurchaseEvent({
        stage: "payment_return",
        outcome: "success",
        email: pendingOrder?.customer_email || null,
        invoice_no: invoice || pendingOrder?.invoice_no || null,
        order_ref: invoice || pendingOrder?.invoice_no || null,
        payment_provider: "stitch",
        payment_status: status || "PENDING",
        amount_total: pendingOrder?.total_amount ?? null,
        product: pendingOrder?.product ?? null,
        quantity: pendingOrder?.quantity ?? null,
        detail: "Processed Stitch return state."
      });
    } catch (err) {
      console.error(err);
      residueTelemetry.logPurchaseEvent({
        stage: "payment_return",
        outcome: "failure",
        email: pendingOrder?.customer_email || null,
        invoice_no: invoice || pendingOrder?.invoice_no || null,
        order_ref: invoice || pendingOrder?.invoice_no || null,
        payment_provider: "stitch",
        payment_status: status || "PENDING",
        detail: err.message || "Could not verify/update Stitch payment state."
      });
    }

    renderPostPaymentSummary({
      provider: "stitch",
      status,
      invoice,
      pendingOrder
    });
  }

  async function handlePaymentReturn() {
    const state = parsePaymentReturnState();
    if (!state) return;

    const pending = sessionStorage.getItem(PENDING_ORDER_KEY);
    let pendingOrder = null;
    if (pending) {
      try {
        pendingOrder = JSON.parse(pending);
      } catch {
        pendingOrder = null;
      }
    }

    if (state.provider === "stitch") {
      await handleReturnFromStitch(state, pendingOrder);
    } else {
      await handleReturnFromPayFast(state, pendingOrder);
    }

    clearPending();
    if (window.history?.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  function goToCheckoutStep(step) {
    const targetStep = Math.max(1, Math.min(4, Number(step) || 1));

    if (targetStep === 1) {
      updateCheckoutStage(1, { scroll: true });
      return;
    }

    const mainMissing = requiredFieldErrors();
    if (mainMissing.length > 0) {
      residueTelemetry.logPurchaseEvent({
        stage: "checkout_validate",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: "Attempted to advance before completing purchase details.",
        metadata: { missing_fields: mainMissing }
      });
      showValidationModal(mainMissing);
      updateCheckoutStage(1, { scroll: true });
      return;
    }

    if (targetStep === 2) {
      const summary = getCheckoutData();
      setPaymentSummaryDisplay(summary.subtotal, summary.shipping, summary.total);
      if (els.shippingName && !els.shippingName.value.trim()) {
        els.shippingName.value = (els.fullName?.value || "").trim();
      }
      updateCheckoutStage(2, { scroll: true });
      return;
    }

    const shippingMissing = shippingFieldErrors();
    if (shippingMissing.length > 0) {
      setPayFastStatus("Complete all delivery fields before moving to review.", "error");
      updateCheckoutStage(2, { scroll: true });
      return;
    }

    if (!pendingTermsOrder) {
      pendingTermsOrder = buildPendingTermsOrder();
    }

    if (targetStep === 3) {
      const summary = getCheckoutData();
      termsAccepted = false;
      setPayFastStatus("");
      setPaymentSummaryDisplay(summary.subtotal, summary.shipping, summary.total);
      unlockSidebarShippingSummary();
      updateCheckoutStage(3, { scroll: true });
      return;
    }

    if (!termsAccepted) {
      setPayFastStatus("Agree to the terms before opening payment methods.", "error");
      updateCheckoutStage(3, { scroll: true });
      return;
    }

    const summary = getCheckoutData();
    setPaymentSummaryDisplay(summary.subtotal, summary.shipping, summary.total);
    updateCheckoutStage(4, { scroll: true });
  }

  function wireModalClose() {
    els.payClose?.addEventListener("click", () => updateCheckoutStage(1, { scroll: true }));

    const dismissTermsModal = () => {
      pendingTermsOrder = null;
      termsAccepted = false;
      updateCheckoutStage(2, { scroll: true });
    };

    els.termsClose?.addEventListener("click", dismissTermsModal);
    els.termsDisagreeBtn?.addEventListener("click", dismissTermsModal);
    els.termsBackBtn?.addEventListener("click", () => {
      termsAccepted = false;
      updateCheckoutStage(2, { scroll: true });
    });
    els.termsAgreeBtn?.addEventListener("click", async () => {
      if (!pendingTermsOrder) {
        updateCheckoutStage(2, { scroll: true });
        return;
      }
      termsAccepted = true;
      setSelectedPaymentProvider("payfast");
      setPaymentProviderButtonsDisabled(false);
      setPayFastStatus("");
      showPurchaseStep(els.payfastConfirmModal);
    });
    if (els.termsModal && !els.termsModal.hasAttribute("data-checkout-stage")) {
      els.termsModal.addEventListener("click", (e) => {
        if (e.target === els.termsModal) dismissTermsModal();
      });
    }

    const dismissPayFastConfirm = () => {
      setPaymentProviderButtonsDisabled(false);
      updateCheckoutStage(3, { scroll: true });
    };

    els.payfastConfirmClose?.addEventListener("click", dismissPayFastConfirm);
    els.payfastBackBtn?.addEventListener("click", () => {
      setPaymentProviderButtonsDisabled(false);
      updateCheckoutStage(3, { scroll: true });
    });
    els.payfastContinueBtn?.addEventListener("click", () => {
      setSelectedPaymentProvider("payfast");
    });
    if (els.payfastConfirmModal && !els.payfastConfirmModal.hasAttribute("data-checkout-stage")) {
      els.payfastConfirmModal.addEventListener("click", (e) => {
        if (e.target === els.payfastConfirmModal) dismissPayFastConfirm();
      });
    }

    const validationClose = qs("#validation-modal .close-btn");
    validationClose?.addEventListener("click", () => closeModal(els.validationModal));
    els.validationClose?.addEventListener("click", () => closeModal(els.validationModal));
    els.validationModal?.addEventListener("click", (e) => {
      if (e.target === els.validationModal) closeModal(els.validationModal);
    });

    els.thankYouModal?.addEventListener("click", (e) => {
      if (e.target === els.thankYouModal) closeModal(els.thankYouModal);
    });
  }

  function wireEvents() {
    setCardConfigurationSelection();
    wireCardTypeToggle();
    wireModalClose();
    els.continueToDeliveryButtons.forEach((button) => {
      button.addEventListener("click", onPurchaseClick);
    });
    els.checkoutStepItems.forEach((item) => {
      item.addEventListener("click", () => {
        const step = Number(item.getAttribute("data-checkout-step") || 1);
        goToCheckoutStep(step);
      });
    });
    [els.fullName, els.customerTitle, els.email, els.phone].forEach((input) => {
      input?.addEventListener("input", () => invalidateStageProgress(2));
    });
    els.quantity?.addEventListener("input", () => {
      updatePriceDisplay();
      invalidateStageProgress(2);
    });
    [
      els.shippingName,
      els.shippingStreet,
      els.shippingSuburb,
      els.shippingCity,
      els.shippingProvince,
      els.shippingPostal
    ].forEach((input) => {
      input?.addEventListener("input", () => invalidateStageProgress(3));
      input?.addEventListener("change", () => invalidateStageProgress(3));
    });
    els.shippingBackBtn?.addEventListener("click", () => updateCheckoutStage(1, { scroll: true }));
    els.shippingNextBtn?.addEventListener("click", onShippingNextClick);
    els.redirectBtn?.addEventListener("click", () => {
      clearThankYouRedirect();
      window.location.href = "index.html";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wireEvents();
    updateCheckoutStage(1);
    updateCustomLogoFileName();
    updatePriceDisplay();
    await handlePaymentReturn();
  });
})();
