const { writeFileSync } = require('fs');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';
const shippingFee = process.env.SHIPPING_FEE || '';
const ordersTable = process.env.SUPABASE_ORDERS_TABLE || '';
const invoicesTable = process.env.SUPABASE_INVOICES_TABLE || '';
const payfastProcessUrl = process.env.PAYFAST_PROCESS_URL || '';
const accessRequestFunctionUrl = process.env.ACCESS_REQUEST_FUNCTION_URL || '';
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '0x4AAAAAADAvI_1p6qpg5G_E';

// Only publish values that are safe to ship to every browser.
// Never add merchant credentials, webhook secrets, or private API keys here.
const output = `window.env = {
  SUPABASE_URL: '${url}',
  SUPABASE_ANON_KEY: '${key}',
  SHIPPING_FEE: '${shippingFee}',
  SUPABASE_ORDERS_TABLE: '${ordersTable}',
  SUPABASE_INVOICES_TABLE: '${invoicesTable}',
  PAYFAST_PROCESS_URL: '${payfastProcessUrl}',
  ACCESS_REQUEST_FUNCTION_URL: '${accessRequestFunctionUrl}',
  TURNSTILE_SITE_KEY: '${turnstileSiteKey}'
};`;
writeFileSync('js/env.js', output);
console.log('js/env.js written');
