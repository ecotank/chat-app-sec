const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
});

async function ensureTableExists(client) {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id TEXT NOT NULL,
      content TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      custom_id TEXT,
      deleted BOOLEAN DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_room_time
      ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_updated_time
      ON messages(room_id, updated_at);
  `);
}

// Auto-delete pesan lebih lama dari 1 hari
async function autoDeleteOldMessages(client) {
  await client.query(`
    DELETE FROM messages
    WHERE created_at < NOW() - INTERVAL '1 day'
  `);
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

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
    await ensureTableExists(client);
    await autoDeleteOldMessages(client);

    switch (payload.action) {
      case 'send': {
        if (!payload.message) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing message' })
          };
        }

        const insertResult = await client.query(
          `INSERT INTO messages (room_id, content, sender_id, custom_id)
           VALUES ($1, $2, $3, $4)
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
      }

      case 'get': {
        const last = Number(payload.lastUpdate || 0);
        const messagesRes = await client.query(
          `SELECT id, content as message, sender_id as sender, created_at as timestamp
           FROM messages
           WHERE room_id = $1
             AND deleted = FALSE
             AND created_at > to_timestamp($2/1000.0)
           ORDER BY created_at ASC
           LIMIT 200`,
          [payload.roomId, last]
        );

        const deletesRes = await client.query(
          `SELECT id, updated_at
           FROM messages
           WHERE room_id = $1
             AND deleted = TRUE
             AND updated_at > to_timestamp($2/1000.0)
           ORDER BY updated_at ASC
           LIMIT 500`,
          [payload.roomId, last]
        );

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ messages: messagesRes.rows, deletes: deletesRes.rows })
        };
      }

      case 'delete': {
        if (!payload.messageIds || !Array.isArray(payload.messageIds) || payload.messageIds.length === 0) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Missing messageIds' })
          };
        }

        await client.query(
          `UPDATE messages
             SET deleted = TRUE, updated_at = NOW()
           WHERE room_id = $1
             AND id = ANY($2::uuid[])`,
          [payload.roomId, payload.messageIds]
        );

        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ success: true, deleted: payload.messageIds })
        };
      }

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
      body: JSON.stringify({ error: 'Database error', details: err.message })
    };
  } finally {
    if (client) client.release();
  }
};
