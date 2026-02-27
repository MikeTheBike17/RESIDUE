import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

(() => {
  const cfg = window.env || {};
  const ORDER_TABLE = cfg.SUPABASE_ORDERS_TABLE || "orders";
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
    purchaseBtn: qs("#purchase-btn"),
    validationModal: qs("#validation-modal"),
    missingFields: qs("#missing-fields-list"),
    validationClose: qs("#validation-close-btn"),
    paymentModal: qs("#payment-modal"),
    payClose: qs("#payment-modal .close-btn"),
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

  let selectedProduct = null;

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

  function unitPrice(product, qty) {
    if (product === "standard") {
      if (qty >= 5) return 299;
      if (qty >= 2) return 349;
      return 399;
    }
    if (qty >= 5) return 499;
    if (qty >= 2) return 549;
    return 599;
  }

  function titleCaseProduct(product) {
    return product === "standard" ? "Standard Cards" : "Premium Cards";
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

  async function insertOrder(order) {
    if (!supabase) throw new Error("Supabase is not configured in js/env.js.");
    const { error } = await supabase.from(ORDER_TABLE).insert(order);
    if (error) throw new Error(`Could not create order in Supabase: ${error.message}`);
  }

  async function updateOrderStatus(invoiceNo, updates) {
    if (!supabase || !invoiceNo) return;
    const { error } = await supabase.from(ORDER_TABLE).update(updates).eq("invoice_no", invoiceNo);
    if (error) throw new Error(`Could not update payment in Supabase: ${error.message}`);
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
    pfFields.itemName.value = `${titleCaseProduct(order.product)} x ${order.quantity}`;
    pfFields.itemDescription.value = `Residue order ${order.invoice_no}`;
    pfFields.customInvoice.value = order.invoice_no;
    pfFields.customEmail.value = order.customer_email;
    pfFields.customProduct.value = order.product;
    pfFields.customQty.value = String(order.quantity);
    els.payfastForm.action = PAYFAST_PROCESS_URL;
  }

  function getCheckoutData() {
    const qty = Number.parseInt(els.quantity?.value || "0", 10);
    const safeQty = Number.isNaN(qty) ? 0 : qty;
    const perItem = unitPrice(selectedProduct, safeQty);
    const subtotal = safeQty * perItem;
    const shipping = SHIPPING_FEE;
    const total = subtotal + shipping;
    return { qty: safeQty, perItem, subtotal, shipping, total };
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
    if (!selectedProduct) missing.push("Select a product");
    return missing;
  }

  function setSummaryDisplay(subtotal, shipping, total) {
    if (els.subtotal) els.subtotal.textContent = formatCurrency(subtotal);
    if (els.shipping) els.shipping.textContent = formatCurrency(shipping);
    if (els.total) els.total.textContent = formatCurrency(total);
  }

  function setProductSelection() {
    const boxes = qsa(".product-box");
    boxes.forEach((box) => {
      box.addEventListener("click", () => {
        boxes.forEach((b) => b.classList.remove("selected"));
        box.classList.add("selected");
        selectedProduct = box.getAttribute("data-product") || null;
      });
    });
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
      setStatus(els.payfastStatus, "Complete shipping details before payment.", "error");
      return;
    }

    const checkout = getCheckoutData();
    const order = {
      invoice_no: generateInvoiceNo(),
      customer_name: (els.fullName?.value || "").trim(),
      customer_email: (els.email?.value || "").trim().toLowerCase(),
      customer_phone: (els.phone?.value || "").trim(),
      product: selectedProduct,
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

    try {
      setStatus(els.payfastStatus, "Creating invoice and saving order...", "loading");
      await insertOrder(order);
      persistPending(order);
      configurePayFastForm(order);
      setStatus(els.payfastStatus, "Redirecting to PayFast...", "success");
      setTimeout(() => els.payfastForm.submit(), 250);
    } catch (err) {
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
    } catch (err) {
      console.error(err);
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
    setProductSelection();
    wireModalClose();
    els.purchaseBtn?.addEventListener("click", onPurchaseClick);
    els.payBtn?.addEventListener("click", onPayFastClick);
    els.redirectBtn?.addEventListener("click", () => {
      window.location.href = "residue-private.html";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    wireEvents();
    await handleReturnFromPayFast();
  });
})();
