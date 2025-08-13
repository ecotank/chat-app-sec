const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000
});

exports.handler = async (event) => {
  // Handle CORS preflight
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
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  // Validate payload
  if (!payload.action || !payload.roomId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields' })
    };
  }

  try {
    const client = await pool.connect();
    
    try {
      switch (payload.action) {
        case 'send':
          if (!payload.message) {
            return {
              statusCode: 400,
              body: JSON.stringify({ error: 'Missing message' })
            };
          }

          const { rows } = await client.query(
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
            body: JSON.stringify({
              id: rows[0].id,
              timestamp: rows[0].created_at
            })
          };

        case 'get':
          const { rows: messages } = await client.query(
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
            body: JSON.stringify({ messages })
          };

        default:
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid action' })
          };
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Database error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Database error',
        details: err.message 
      })
    };
  }
};