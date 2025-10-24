// netlify/functions/login.js
const { Pool } = require('pg');

// Configuración de cabeceras CORS para permitir la conexión desde tu sitio web
const headers = {
    'Access-Control-Allow-Origin': '*', // Permite cualquier origen (ajusta en producción si es necesario)
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // Solo permitimos POST y OPTIONS
};

exports.handler = async (event) => {
    // Manejo de la solicitud 'pre-vuelo' (preflight) de CORS
    // El navegador envía esto automáticamente antes de la solicitud POST
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers,
            body: ''
        };
    }

    // Solo aceptamos solicitudes POST para el login
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // Method Not Allowed
            headers,
            body: JSON.stringify({ status: 'error', message: 'Method Not Allowed' })
        };
    }

    // Conexión a la base de datos Neon
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false // Requerido para conexiones a Neon
        }
    });

    try {
        const { username, password } = JSON.parse(event.body);

        // Validación simple de entrada
        if (!username || !password) {
            return {
                statusCode: 400, // Bad Request
                headers,
                body: JSON.stringify({ status: 'error', message: 'Usuario y contraseña son requeridos.' })
            };
        }

        // Buscamos al usuario en la base de datos
        const query = 'SELECT id, username, password, role, full_name FROM users WHERE username = $1';
        const { rows } = await pool.query(query, [username]);

        // Caso 1: Usuario no encontrado
        if (rows.length === 0) {
            return {
                statusCode: 401, // Unauthorized
                headers,
                body: JSON.stringify({ status: 'error', message: 'Credenciales incorrectas.' })
            };
        }

        const user = rows[0];

        // --- ADVERTENCIA DE SEGURIDAD ---
        // Estás comparando contraseñas en TEXTO PLANO. Esto no es seguro para producción.
        // En un sistema real, deberías usar 'bcrypt' para comparar contraseñas 'hasheadas'.
        // Ejemplo con bcrypt: const passwordMatch = await bcrypt.compare(password, user.password);
        // if (!passwordMatch) { ... }
        
        // Caso 2: Contraseña incorrecta
        if (password !== user.password) {
            return {
                statusCode: 401, // Unauthorized
                headers,
                body: JSON.stringify({ status: 'error', message: 'Credenciales incorrectas.' })
            };
        }

        // Caso 3: Éxito
        // Devolvemos los datos del usuario (sin la contraseña)
        const userResponse = {
            id: user.id,
            username: user.username,
            role: user.role,
            full_name: user.full_name
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ status: 'success', user: userResponse })
        };

    } catch (error) {
        // Manejo de errores de base de datos o servidor
        console.error('Login Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message })
        };
    } finally {
        // Aseguramos cerrar la conexión a la base de datos
        await pool.end();
    }
};

