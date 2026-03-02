const { writeFileSync } = require('fs');

const url = process.env.SUPABASE_URL || 'https://vqqcgknwobmssgfuvfyq.supabase.com';
const key = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxcWNna253b2Jtc3NnZnV2ZnlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNTcyMTAsImV4cCI6MjA4NjkzMzIxMH0.Ml5aPoGw5lEasxPfVLmxB0gK5mapS0UUuhQUMjmPk3E';

const output = `window.env = { SUPABASE_URL: '${url}', SUPABASE_ANON_KEY: '${key}' };`;
writeFileSync('js/env.js', output);
console.log('js/env.js written');
