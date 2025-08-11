const { Pool } = require('pg');

exports.handler = async (event) => {
  // Handle OPTIONS (CORS Preflight)
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

  // Hanya izinkan POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Allow': 'POST, OPTIONS'
      },
      body: JSON.stringify({ 
        error: 'Method not allowed',
        allowed_methods: ['POST'] 
      })
    };
  }

  // 3. Validate Request Body
  if (!event.body) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Request body is empty' })
    };
  }

  // 4. Parse JSON
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON format' })
    };
  }

  // 5. Validate Required Fields
  if (!payload.action || !payload.roomId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Missing required fields',
        required: ['action', 'roomId']
      })
    };
  }

  // 6. Initialize Database Pool
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  try {
    // 7. Handle Different Actions
    switch (payload.action) {
      case 'send':
        if (!payload.encryptedMsg) {
          throw new Error('Missing encrypted message');
        }
        
        const insertRes = await pool.query(
          'INSERT INTO chats (room_id, message) VALUES ($1, $2) RETURNING *',
          [payload.roomId, payload.encryptedMsg]
        );
        
        return {
          statusCode: 201,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: insertRes.rows[0]
          })
        };

      case 'get':
        const getRes = await pool.query(
          'SELECT * FROM chats WHERE room_id = $1 ORDER BY created_at DESC LIMIT 100',
          [payload.roomId]
        );
        
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: getRes.rows
          })
        };

      default:
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (err) {
    console.error('Database operation failed:', err);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: err.message 
      })
    };
  } finally {
    // 8. Clean up database connection
    await pool.end().catch(e => console.error('Error closing pool:', e));
  }
};