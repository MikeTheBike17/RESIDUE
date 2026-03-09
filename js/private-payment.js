import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { residueTelemetry } from "./supabase-telemetry.js";

(() => {
  const cfg = window.env || {};
  const ORDER_TABLE = cfg.SUPABASE_ORDERS_TABLE || "orders";
  const INVOICE_TABLE = cfg.SUPABASE_INVOICES_TABLE || "purchase_invoices";
  const CARD_CONFIG_TABLE = "card_configs";
  const SHIPPING_FEE = Number(cfg.SHIPPING_FEE || 99);
  const PAYFAST_PROCESS_URL = cfg.PAYFAST_PROCESS_URL || "https://www.payfast.co.za/eng/process";
  const PENDING_ORDER_KEY = "residue_pending_order";

  const supabase = (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY)
    ? null
    : createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    configureForm: qs(".configure-form"),
    fullName: qs("#full-name"),
    email: qs("#email-config"),
    phone: qs("#phone"),
    quantity: qs("#quantity"),
    cardConfigOptions: qsa("[data-card-config]"),
    customLogoToggle: qs("#custom-logo-toggle"),
    customLogoPanel: qs("#custom-logo-panel"),
    customLogoFile: qs("#custom-logo-file"),
    customLogoFileName: qs("#custom-logo-file-name"),
    configurePrice: qs("#configure-price"),
    configurePriceNote: qs("#configure-price-note"),
    purchaseBtn: qs("#purchase-btn"),
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
    shippingCity: qs("#shipping-city"),
    shippingPostal: qs("#shipping-postal"),
    payBtn: qs("#pay-btn"),
    payfastStatus: qs("#payfast-status"),
    payfastForm: qs("#payfast-form"),
    thankYouModal: qs("#thank-you-modal"),
    thankYouInvoice: qs("#thank-you-invoice"),
    thankYouPaymentStatus: qs("#thank-you-payment-status"),
    redirectBtn: qs("#redirect-btn")
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
  let customLogoDataUrl = "";
  let customLogoMeta = null;
  let pendingTermsOrder = null;

  function setStatus(el, message, type = "") {
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
    el.className = "status configure-status";
    if (type) el.classList.add(type);
  }

  function openModal(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }

  function closeModal(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }

  function formatCurrency(value) {
    return "R" + value.toLocaleString("en-ZA");
  }

  function amountForPayFast(value) {
    return Number(value).toFixed(2);
  }

  function baseUnitPrice(qty) {
    if (qty > 4) return 399;
    if (qty >= 2) return 449;
    return 499;
  }

  function customLogoEnabled() {
    return !!els.customLogoPanel && !els.customLogoPanel.hidden;
  }

  function customLogoFeePerCard() {
    return customLogoEnabled() ? 100 : 0;
  }

  function configurationLabel(configNumber) {
    return `Card configuration ${configNumber || ""}`.trim();
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

  function paymentStatusText(status) {
    if (status === "COMPLETE") return "Payment complete.";
    if (status === "FAILED") return "Payment failed.";
    if (status === "CANCELLED") return "Payment cancelled.";
    return `Payment status: ${status || "PENDING"}.`;
  }

  function parseReturnState() {
    const params = new URLSearchParams(window.location.search);
    const invoice = params.get("m_payment_id") || "";
    const paymentStatus = (params.get("payment_status") || "").toUpperCase();
    const payfastPaymentId = params.get("pf_payment_id") || "";
    if (!invoice && !payfastPaymentId && !paymentStatus) return null;
    return { params, invoice, paymentStatus, payfastPaymentId };
  }

  function buildReturnUrl(basePath, paymentState) {
    const u = new URL(basePath, window.location.origin);
    if (paymentState) u.searchParams.set("payment", paymentState);
    return u.toString();
  }

  async function getAuthenticatedUser() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user || null;
  }

  async function insertOrder(order) {
    if (!supabase) throw new Error("Supabase is not configured in js/env.js.");
    const orderRecord = {
      invoice_no: order.invoice_no,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      product: order.product,
      quantity: order.quantity,
      unit_price: order.unit_price,
      subtotal_amount: order.subtotal_amount,
      shipping_amount: order.shipping_amount,
      total_amount: order.total_amount,
      payment_provider: order.payment_provider,
      payment_status: order.payment_status,
      shipping_name: order.shipping_name,
      shipping_street: order.shipping_street,
      shipping_city: order.shipping_city,
      shipping_postal: order.shipping_postal,
      created_at: order.created_at
    };
    const { error } = await supabase.from(ORDER_TABLE).insert(orderRecord);
    if (error) throw new Error(`Could not create order in Supabase: ${error.message}`);
  }

  function buildInvoiceRecord(order, userId = null) {
    return {
      invoice_no: order.invoice_no,
      profile_id: userId,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      quantity: order.quantity,
      card_configuration: order.card_configuration,
      custom_logo_requested: order.custom_logo_requested,
      custom_logo_file_name: order.custom_logo_file_name || null,
      custom_logo_image: customLogoDataUrl || null,
      shipping_name: order.shipping_name,
      shipping_street: order.shipping_street,
      shipping_city: order.shipping_city,
      shipping_postal: order.shipping_postal,
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
    if (error) throw new Error(`Could not save invoice in Supabase: ${error.message}`);
  }

  async function updateOrderStatus(invoiceNo, updates) {
    if (!supabase || !invoiceNo) return;
    const { error } = await supabase.from(ORDER_TABLE).update(updates).eq("invoice_no", invoiceNo);
    if (error) throw new Error(`Could not update payment in Supabase: ${error.message}`);
  }

  async function updateInvoiceStatus(invoiceNo, updates) {
    if (!supabase || !invoiceNo) return;
    const { error } = await supabase
      .from(INVOICE_TABLE)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("invoice_no", invoiceNo);
    if (error) throw new Error(`Could not update invoice in Supabase: ${error.message}`);
  }

  function configurePayFastForm(order) {
    const merchantId = cfg.PAYFAST_MERCHANT_ID || "";
    const merchantKey = cfg.PAYFAST_MERCHANT_KEY || "";
    const notifyUrl = cfg.PAYFAST_NOTIFY_URL || "";
    const returnUrl = cfg.PAYFAST_RETURN_URL || buildReturnUrl("residue-private.html", "success");
    const cancelUrl = cfg.PAYFAST_CANCEL_URL || buildReturnUrl("residue-private.html", "cancelled");
    if (!merchantId || !merchantKey || !notifyUrl) {
      throw new Error("Missing PayFast config in js/env.js (merchant id/key/notify url).");
    }

    const names = splitName(order.customer_name);

    pfFields.merchantId.value = merchantId;
    pfFields.merchantKey.value = merchantKey;
    pfFields.notifyUrl.value = notifyUrl;
    pfFields.returnUrl.value = returnUrl;
    pfFields.cancelUrl.value = cancelUrl;
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
    const shipping = SHIPPING_FEE;
    const total = subtotal + shipping;
    return { qty: safeQty, basePerItem, logoFee, perItem, subtotal, shipping, total };
  }

  function requiredFieldErrors() {
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
    if (!selectedCardConfiguration) missing.push("Select a card configuration");
    if (customLogoEnabled() && !els.customLogoFile?.files?.length) missing.push("Upload custom logo image");
    return missing;
  }

  function setSummaryDisplay(subtotal, shipping, total) {
    if (els.subtotal) els.subtotal.textContent = formatCurrency(subtotal);
    if (els.shipping) els.shipping.textContent = formatCurrency(shipping);
    if (els.total) els.total.textContent = formatCurrency(total);
  }

  function updatePriceDisplay() {
    const checkout = getCheckoutData();
    if (els.configurePrice) {
      els.configurePrice.textContent = formatCurrency(checkout.subtotal);
    }
    if (els.configurePriceNote) {
      if (!selectedCardConfiguration || checkout.qty <= 0) {
        els.configurePriceNote.textContent = "Select a quantity and card configuration.";
        return;
      }
      const logoText = customLogoEnabled() ? ` Includes custom logo at ${formatCurrency(checkout.logoFee)} per card.` : "";
      els.configurePriceNote.textContent = `${checkout.qty} card${checkout.qty === 1 ? "" : "s"} at ${formatCurrency(checkout.perItem)} each.${logoText}`;
    }
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
      });
    });
  }

  function updateCustomLogoFileName() {
    if (!els.customLogoFileName) return;
    els.customLogoFileName.textContent = els.customLogoFile?.files?.[0]?.name || "No logo selected.";
  }

  function wireCustomLogoToggle() {
    els.customLogoToggle?.addEventListener("click", () => {
      const nextExpanded = !(els.customLogoPanel && !els.customLogoPanel.hidden);
      if (els.customLogoPanel) els.customLogoPanel.hidden = !nextExpanded;
      els.customLogoToggle?.setAttribute("aria-expanded", String(nextExpanded));
      if (!nextExpanded && els.customLogoFile) {
        els.customLogoFile.value = "";
        customLogoDataUrl = "";
        customLogoMeta = null;
        updateCustomLogoFileName();
      }
      updatePriceDisplay();
    });

    els.customLogoFile?.addEventListener("change", async () => {
      const file = els.customLogoFile?.files?.[0] || null;
      if (!file) {
        customLogoDataUrl = "";
        customLogoMeta = null;
        updateCustomLogoFileName();
        return;
      }
      if (!(file.type || "").startsWith("image/")) {
        setStatus(els.payfastStatus, "Custom logo must be an image file.", "error");
        els.customLogoFile.value = "";
        customLogoDataUrl = "";
        customLogoMeta = null;
        updateCustomLogoFileName();
        return;
      }
      customLogoMeta = { name: file.name, type: file.type || "", size: file.size || 0 };
      customLogoDataUrl = await readFileAsDataUrl(file);
      updateCustomLogoFileName();
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
    if (!supabase || !selectedCardConfiguration) return;
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
        card_configuration: selectedCardConfiguration,
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

  async function onPurchaseClick() {
    const missing = requiredFieldErrors();
    if (missing.length > 0) {
      residueTelemetry.logPurchaseEvent({
        stage: "checkout_validate",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: "Checkout validation failed.",
        metadata: { missing_fields: missing }
      });
      els.missingFields.innerHTML = missing
        .map((field) => `<div style="padding:4px 0; color:var(--muted);">&bull; ${field}</div>`)
        .join("");
      openModal(els.validationModal);
      return;
    }

    const summary = getCheckoutData();
    setSummaryDisplay(summary.subtotal, summary.shipping, summary.total);
    if (els.shippingName && !els.shippingName.value.trim()) {
      els.shippingName.value = (els.fullName?.value || "").trim();
    }
    setStatus(els.payfastStatus, "");
    openModal(els.paymentModal);
  }

  async function onPayFastClick() {
    const shippingName = (els.shippingName?.value || "").trim();
    const shippingStreet = (els.shippingStreet?.value || "").trim();
    const shippingCity = (els.shippingCity?.value || "").trim();
    const shippingPostal = (els.shippingPostal?.value || "").trim();
    if (!shippingName || !shippingStreet || !shippingCity || !shippingPostal) {
      residueTelemetry.logPurchaseEvent({
        stage: "shipping_validate",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: "Shipping details incomplete before payment."
      });
      setStatus(els.payfastStatus, "Complete shipping details before payment.", "error");
      return;
    }

    const checkout = getCheckoutData();
    pendingTermsOrder = {
      invoice_no: generateInvoiceNo(),
      customer_name: (els.fullName?.value || "").trim(),
      customer_email: (els.email?.value || "").trim().toLowerCase(),
      customer_phone: (els.phone?.value || "").trim(),
      product: `card-configuration-${selectedCardConfiguration}`,
      card_configuration: selectedCardConfiguration,
      custom_logo_requested: customLogoEnabled(),
      custom_logo_file_name: customLogoMeta?.name || null,
      quantity: checkout.qty,
      unit_price: checkout.perItem,
      subtotal_amount: checkout.subtotal,
      shipping_amount: checkout.shipping,
      total_amount: checkout.total,
      payment_provider: "payfast",
      payment_status: "PENDING",
      shipping_name: shippingName,
      shipping_street: shippingStreet,
      shipping_city: shippingCity,
      shipping_postal: shippingPostal,
      created_at: new Date().toISOString()
    };

    openModal(els.termsModal);
  }

  async function proceedToPayFast(order) {
    try {
      const sessionUser = await getAuthenticatedUser();
      setStatus(els.payfastStatus, "Creating invoice and saving order...", "loading");
      await saveCardConfiguration(sessionUser);
      await insertOrder(order);
      await upsertInvoice(order, sessionUser?.id || null);
      residueTelemetry.logPurchaseEvent({
        stage: "invoice_created",
        outcome: "success",
        email: order.customer_email,
        invoice_no: order.invoice_no,
        order_ref: order.invoice_no,
        payment_provider: order.payment_provider,
        payment_status: order.payment_status,
        amount_total: order.total_amount,
        product: order.product,
        quantity: order.quantity,
        detail: "Order and invoice inserted in Supabase."
      });
      persistPending(order);
      configurePayFastForm(order);
      residueTelemetry.logPurchaseEvent({
        stage: "redirect_payfast",
        outcome: "success",
        email: order.customer_email,
        invoice_no: order.invoice_no,
        order_ref: order.invoice_no,
        payment_provider: "payfast",
        payment_status: "PENDING",
        amount_total: order.total_amount,
        product: order.product,
        quantity: order.quantity,
        detail: "Redirecting user to PayFast."
      });
      setStatus(els.payfastStatus, "Redirecting to PayFast...", "success");
      setTimeout(() => els.payfastForm.submit(), 250);
    } catch (err) {
      residueTelemetry.logPurchaseEvent({
        stage: "invoice_created",
        outcome: "failure",
        email: (els.email?.value || "").trim().toLowerCase(),
        detail: err.message || "Could not create invoice/start payment."
      });
      setStatus(els.payfastStatus, err.message || "Could not start payment.", "error");
    }
  }

  async function handleReturnFromPayFast() {
    const state = parseReturnState();
    if (!state) return;

    const status = state.paymentStatus || "PENDING";
    const invoice = state.invoice;
    const pending = sessionStorage.getItem(PENDING_ORDER_KEY);
    const pendingOrder = pending ? JSON.parse(pending) : null;

    try {
      await updateOrderStatus(invoice, {
        payment_status: status,
        payfast_payment_id: state.payfastPaymentId || null,
        payment_reference: state.payfastPaymentId || null,
        payment_updated_at: new Date().toISOString()
      });
      await updateInvoiceStatus(invoice, {
        payment_status: status
      });
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
        detail: "Processed PayFast return state."
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

    if (els.thankYouInvoice) {
      els.thankYouInvoice.textContent = invoice || pendingOrder?.invoice_no || "Unknown";
    }
    if (els.thankYouPaymentStatus) {
      els.thankYouPaymentStatus.textContent = paymentStatusText(status);
    }
    openModal(els.thankYouModal);
    clearPending();
  }

  function wireModalClose() {
    els.payClose?.addEventListener("click", () => closeModal(els.paymentModal));
    els.paymentModal?.addEventListener("click", (e) => {
      if (e.target === els.paymentModal) closeModal(els.paymentModal);
    });

    const dismissTermsModal = () => {
      pendingTermsOrder = null;
      closeModal(els.termsModal);
    };

    els.termsClose?.addEventListener("click", dismissTermsModal);
    els.termsDisagreeBtn?.addEventListener("click", dismissTermsModal);
    els.termsAgreeBtn?.addEventListener("click", async () => {
      if (!pendingTermsOrder) {
        closeModal(els.termsModal);
        return;
      }
      closeModal(els.termsModal);
      await proceedToPayFast(pendingTermsOrder);
      pendingTermsOrder = null;
    });
    els.termsModal?.addEventListener("click", (e) => {
      if (e.target === els.termsModal) dismissTermsModal();
    });

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
    wireCustomLogoToggle();
    wireModalClose();
    els.purchaseBtn?.addEventListener("click", onPurchaseClick);
    els.payBtn?.addEventListener("click", onPayFastClick);
    els.quantity?.addEventListener("input", updatePriceDisplay);
    els.redirectBtn?.addEventListener("click", () => {
      window.location.href = "residue-private.html";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wireEvents();
    updateCustomLogoFileName();
    updatePriceDisplay();
    await handleReturnFromPayFast();
  });
})();
