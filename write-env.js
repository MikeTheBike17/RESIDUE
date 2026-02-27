const { writeFileSync } = require('fs');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

const output = `window.env = { SUPABASE_URL: '${url}', SUPABASE_ANON_KEY: '${key}' };`;
writeFileSync('js/env.js', output);
console.log('js/env.js written');
