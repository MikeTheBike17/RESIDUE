const { writeFileSync } = require('fs');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';
const shippingFee = process.env.SHIPPING_FEE || '';
const ordersTable = process.env.SUPABASE_ORDERS_TABLE || '';
const invoicesTable = process.env.SUPABASE_INVOICES_TABLE || '';
const manualAllocationsTable = process.env.SUPABASE_MANUAL_ALLOCATIONS_TABLE || '';
const manualCardEmailsTable = process.env.SUPABASE_MANUAL_CARD_EMAILS_TABLE || '';
const cardholderProfileUrlsTable = process.env.SUPABASE_CARDHOLDER_PROFILE_URLS_TABLE || '';
const payfastProcessUrl = process.env.PAYFAST_PROCESS_URL || '';
const accessRequestFunctionUrl = process.env.ACCESS_REQUEST_FUNCTION_URL || '';
const accessCodeVerifyEndpoint = process.env.ACCESS_CODE_VERIFY_ENDPOINT || '';
const cardholderProfileSyncEndpoint = process.env.CARDHOLDER_PROFILE_SYNC_ENDPOINT || '';
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '0x4AAAAAADAvI_1p6qpg5G_E';

// Only publish values that are safe to ship to every browser.
// Never add merchant credentials, webhook secrets, or private API keys here.
const output = `window.env = {
  SUPABASE_URL: '${url}',
  SUPABASE_ANON_KEY: '${key}',
  SHIPPING_FEE: '${shippingFee}',
  SUPABASE_ORDERS_TABLE: '${ordersTable}',
  SUPABASE_INVOICES_TABLE: '${invoicesTable}',
  SUPABASE_MANUAL_ALLOCATIONS_TABLE: '${manualAllocationsTable}',
  SUPABASE_MANUAL_CARD_EMAILS_TABLE: '${manualCardEmailsTable}',
  SUPABASE_CARDHOLDER_PROFILE_URLS_TABLE: '${cardholderProfileUrlsTable}',
  PAYFAST_PROCESS_URL: '${payfastProcessUrl}',
  ACCESS_REQUEST_FUNCTION_URL: '${accessRequestFunctionUrl}',
  ACCESS_CODE_VERIFY_ENDPOINT: '${accessCodeVerifyEndpoint}',
  CARDHOLDER_PROFILE_SYNC_ENDPOINT: '${cardholderProfileSyncEndpoint}',
  TURNSTILE_SITE_KEY: '${turnstileSiteKey}'
};`;
writeFileSync('js/env.js', output);
console.log('js/env.js written');
