const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// Konfigurasi koneksi database
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 5
};

// Cache untuk koneksi
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool(poolConfig);
    
    // Handle connection errors
    pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
      pool = null; // Force new pool creation
    });
  }
  return pool;
}

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
    const db = getPool();
    
    switch (payload.action) {
      case 'send':
        if (!payload.message || typeof payload.message !== 'string') {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid message format' })
          };
        }

        const insertResult = await db.query(
          `INSERT INTO chatis (
            room_id, 
            message, 
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
            id: insertResult.rows[0].id,
            timestamp: insertResult.rows[0].created_at
          })
        };

      case 'get':
        const queryResult = await db.query(
          `SELECT 
            id,
            message,
            sender_id as sender,
            created_at,
            custom_id
          FROM chatis
          WHERE room_id = $1
          ORDER BY created_at ASC
          LIMIT 100`,
          [payload.roomId]
        );

        return {
          statusCode: 200,
          body: JSON.stringify({
            messages: queryResult.rows.map(row => ({
              id: row.id,
              message: row.message,
              sender: row.sender,
              timestamp: row.created_at
            }))
          })
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
      body: JSON.stringify({ 
        error: 'Database error',
        details: err.message 
      })
    };
  }
};