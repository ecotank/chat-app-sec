const { Pool } = require('pg');

exports.handler = async (event) => {
  // 1. Validasi request
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request body is empty" })
    };
  }

  let data;
  try {
    // 2. Parse JSON dengan error handling
    data = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: "Invalid JSON format" })
    };
  }

  // 3. Validasi field wajib
  if (!data.roomId || !data.action) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing required fields" })
    };
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Logika fungsi...
  } catch (err) {
    console.error('Database error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};