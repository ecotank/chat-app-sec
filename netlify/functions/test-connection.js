// Gunakan CommonJS syntax
const { Pool } = require('pg');

async function testConnection() {
  const pool = new Pool({
    connectionString: 'postgres://neondb_owner:npg_6zIqxe0rnCpW@ep-holy-math-ae2tq2sp-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require'
  });

  let client;
  try {
    client = await pool.connect();
    const res = await client.query('SELECT NOW()');
    console.log('✅ Database connected! Current time:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  } finally {
    if (client) client.release();
    await pool.end();
    process.exit();
  }
}

// Panggil fungsi async
testConnection().catch(console.error);