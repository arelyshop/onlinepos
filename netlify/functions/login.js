// netlify/functions/login.js
const { Pool } = require('pg');
// Considera añadir: const bcrypt = require('bcryptjs'); // Si implementas hashing

// Cabeceras CORS
const headers = {
    'Access-Control-Allow-Origin': '*', // O tu dominio específico
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // Solo necesitamos POST y OPTIONS para login
};

exports.handler = async (event) => {
    // --- Log Inicial ---
    console.log("Función 'login' invocada.");
    console.log("Método HTTP:", event.httpMethod);
    console.log("Cuerpo de la solicitud (parcial):", event.body ? event.body.substring(0, 100) + '...' : 'Sin cuerpo'); // Loguear inicio del body

    // --- Manejo de OPTIONS (Preflight CORS) ---
    if (event.httpMethod === 'OPTIONS') {
        console.log("Respondiendo a solicitud OPTIONS (preflight).");
        return {
            statusCode: 204, // No Content
            headers,
            body: ''
        };
    }

    // --- Solo permitir POST ---
    if (event.httpMethod !== 'POST') {
        console.warn(`Método no permitido: ${event.httpMethod}`);
        return {
            statusCode: 405, // Method Not Allowed
            headers,
            body: JSON.stringify({ status: 'error', message: 'Método no permitido.' })
        };
    }

    let pool; // Definir fuera para posible uso en finally
    let client; // Definir fuera para liberar en finally

    try {
        // --- Parsear el cuerpo de la solicitud ---
        let username, password;
        try {
            const body = JSON.parse(event.body);
            username = body.username;
            password = body.password;
            if (!username || !password) {
                throw new Error("Usuario o contraseña faltantes en la solicitud.");
            }
            console.log("Cuerpo parseado, usuario:", username); // No loguear contraseña
        } catch (parseError) {
            console.error("Error al parsear el cuerpo de la solicitud:", parseError);
            return {
                statusCode: 400, // Bad Request
                headers,
                body: JSON.stringify({ status: 'error', message: 'Solicitud mal formada.' }),
            };
        }

        // --- Conectar a la Base de Datos ---
        console.log("Intentando crear pool de conexión...");
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            },
            connectionTimeoutMillis: 5000, // Timeout conexión
            query_timeout: 8000 // Timeout consulta
        });
         console.log("Pool creado. Intentando obtener cliente...");
        client = await pool.connect();
         console.log("Cliente conectado a la base de datos.");

        // --- Consultar Usuario ---
        // IMPORTANTE: ¡Esto compara contraseñas en texto plano! Implementar hashing.
        const query = 'SELECT id, username, password, role, full_name FROM users WHERE username = $1';
        console.log("Ejecutando consulta para usuario:", username);
        const { rows } = await client.query(query, [username]);
        console.log("Consulta ejecutada. Filas encontradas:", rows.length);

        if (rows.length === 0) {
            console.log("Usuario no encontrado:", username);
            return {
                statusCode: 401, // Unauthorized
                headers,
                body: JSON.stringify({ status: 'error', message: 'Credenciales incorrectas.' }) // Mensaje genérico por seguridad
            };
        }

        const user = rows[0];

        // --- Verificar Contraseña (¡INSEGURO! Usar bcrypt.compareSync) ---
        console.log("Comparando contraseña (¡INSEGURO!)...");
        // const isMatch = bcrypt.compareSync(password, user.password); // Forma SEGURA
        const isMatch = (password === user.password); // Forma INSEGURA actual

        if (!isMatch) {
            console.log("Contraseña incorrecta para usuario:", username);
            return {
                statusCode: 401, // Unauthorized
                headers,
                body: JSON.stringify({ status: 'error', message: 'Credenciales incorrectas.' }) // Mensaje genérico
            };
        }

        // --- Éxito ---
        console.log("Login exitoso para usuario:", username);
        // No devolver la contraseña en la respuesta
        const userResponse = {
            id: user.id,
            username: user.username,
            role: user.role,
            full_name: user.full_name
        };

        return {
            statusCode: 200, // OK
            headers,
            body: JSON.stringify({ status: 'success', user: userResponse })
        };

    } catch (error) {
        // --- Manejo de Errores ---
        console.error("!!! Error en la función login:", error);
        // Determinar si fue un error de conexión a DB u otro
        const errorMessage = error.message.includes('connect') || error.message.includes('timeout')
            ? 'Error al conectar con la base de datos.'
            : 'Error interno del servidor.';
        return {
            statusCode: 500, // Internal Server Error
            headers,
            body: JSON.stringify({ status: 'error', message: errorMessage, details: error.message })
        };
    } finally {
        // --- Liberar Cliente y Cerrar Pool (Opcional) ---
        if (client) {
            client.release();
            console.log("Cliente de base de datos liberado.");
        }
        // Netlify suele manejar el cierre del pool, pero puedes añadirlo si experimentas problemas
        // if (pool) {
        //     await pool.end();
        //     console.log("Pool de conexión cerrado.");
        // }
         console.log("Función 'login' finalizada.");
    }
};

