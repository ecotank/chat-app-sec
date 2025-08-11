const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Dari env Netlify
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event) => {
  const { roomId, message, action } = JSON.parse(event.body);

  switch (action) {
    case 'send':
      await pool.query(
        'INSERT INTO chats (room_id, encrypted_message) VALUES ($1, $2)',
        [roomId, message]
      );
      return { statusCode: 200, body: 'OK' };

    case 'get':
      const res = await pool.query(
        'SELECT * FROM chats WHERE room_id = $1 ORDER BY created_at DESC LIMIT 100',
        [roomId]
      );
      return { statusCode: 200, body: JSON.stringify(res.rows) };

    default:
      return { statusCode: 400, body: 'Invalid action' };
  }
};