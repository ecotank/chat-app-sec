const { Pool } = require('pg');

exports.handler = async (event) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Allow': 'POST, OPTIONS'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Parse and validate request
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  if (!payload.action || !payload.roomId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields' })
    };
  }

  // Initialize database
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 5000
  });

  try {
    // Process actions
    switch (payload.action) {
      case 'send':
        if (!payload.encryptedMsg) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing message' })
          };
        }

        const { rows } = await pool.query(
          `INSERT INTO chats (room_id, message) 
           VALUES ($1, $2) 
           RETURNING id, created_at`,
          [payload.roomId, payload.encryptedMsg]
        );

        return {
          statusCode: 200,
          body: JSON.stringify({ 
            id: rows[0].id,
            timestamp: rows[0].created_at
          })
        };

      case 'get':
        const { rows: messages } = await pool.query(
          `SELECT id, message as encrypted_message, created_at 
           FROM chats 
           WHERE room_id = $1 
           ORDER BY created_at DESC 
           LIMIT 100`,
          [payload.roomId]
        );

        return {
          statusCode: 200,
          body: JSON.stringify({ messages })
        };

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (err) {
    console.error('Database error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  } finally {
    await pool.end().catch(console.error);
  }
};