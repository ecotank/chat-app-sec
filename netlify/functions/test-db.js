const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_6zIqxe0rnCpW@ep-holy-math-ae2tq2sp-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected!');
    const res = await client.query('SELECT NOW()');
    console.log('Server time:', res.rows[0].now);
    client.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err);
  } finally {
    pool.end();
  }
})();
