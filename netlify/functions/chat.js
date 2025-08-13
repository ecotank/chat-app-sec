const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
});

// Auto-create table messages jika belum ada
async function ensureTableExists(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id TEXT NOT NULL,
      content TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      custom_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_room_time
      ON messages(room_id, created_at);
  `);
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  // Validate payload
  if (!payload.action || !payload.roomId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing required fields' })
    };
  }

  let client;
  try {
    client = await pool.connect();

    // Pastikan tabel ada
    await ensureTableExists(client);

    switch (payload.action) {
      case 'send':
        if (!payload.message) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing message' })
          };
        }

        const insertResult = await client.query(
          `INSERT INTO messages (
            room_id, 
            content, 
            sender_id,
            custom_id
          ) VALUES ($1, $2, $3, $4)
          RETURNING id, created_at`,
          [
            payload.roomId,
            payload.message,
            payload.sender || 'anonymous',
            payload.messageId || uuidv4()
          ]
        );

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            id: insertResult.rows[0].id,
            timestamp: insertResult.rows[0].created_at
          })
        };

      case 'get':
        const selectResult = await client.query(
          `SELECT 
            id,
            content as message,
            sender_id as sender,
            created_at as timestamp
          FROM messages
          WHERE room_id = $1
          AND created_at > to_timestamp($2/1000.0)
          ORDER BY created_at ASC
          LIMIT 100`,
          [payload.roomId, payload.lastUpdate || 0]
        );

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ messages: selectResult.rows })
        };

      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (err) {
    console.error('Database error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Database error',
        details: err.message 
      })
    };
  } finally {
    if (client) client.release();
  }
};
