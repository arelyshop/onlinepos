// netlify/functions/products.js
const { Pool } = require('pg');

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

exports.handler = async (event) => {
    // Manejar la solicitud pre-vuelo (preflight) de CORS, crucial para que los navegadores permitan las peticiones
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers,
            body: ''
        };
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // --- OBTENER TODOS LOS PRODUCTOS (Método GET) ---
        if (event.httpMethod === 'GET') {
            const { rows } = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', data: rows }),
            };
        }

        const body = JSON.parse(event.body);

        // --- CREAR UN NUEVO PRODUCTO (Método POST) ---
        if (event.httpMethod === 'POST') {
            const p = body.data;
            const query = `
                INSERT INTO products (
                    name, sku, description, sale_price, discount_price, 
                    purchase_price, wholesale_price, stock, barcode, 
                    category, brand, ciudad_sucursal, 
                    photo_url_1, photo_url_2, photo_url_3, photo_url_4, 
                    photo_url_5, photo_url_6, photo_url_7, photo_url_8
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                RETURNING *;
            `;
            const values = [
                p.name, p.sku, p.description, p.sale_price, p.discount_price, 
                p.purchase_price, p.wholesale_price, p.stock, p.barcode,
                p.category, p.brand, p.ciudad_sucursal, // Campo de sucursal incluido
                p.photo_url_1, p.photo_url_2, p.photo_url_3, p.photo_url_4,
                p.photo_url_5, p.photo_url_6, p.photo_url_7, p.photo_url_8
            ];
            const { rows } = await pool.query(query, values);
            return {
                statusCode: 201, // 201 Creado
                headers,
                body: JSON.stringify({ status: 'success', data: rows[0] }),
            };
        }

        // --- ACTUALIZAR UN PRODUCTO (Método PUT) ---
        if (event.httpMethod === 'PUT') {
            const p = body.data;
            const query = `
                UPDATE products SET
                    name = $1, sku = $2, description = $3, sale_price = $4, discount_price = $5,
                    purchase_price = $6, wholesale_price = $7, stock = $8, barcode = $9,
                    category = $10, brand = $11, ciudad_sucursal = $12, -- Campo de sucursal incluido
                    photo_url_1 = $13, photo_url_2 = $14, photo_url_3 = $15, photo_url_4 = $16,
                    photo_url_5 = $17, photo_url_6 = $18, photo_url_7 = $19, photo_url_8 = $20
                WHERE id = $21
                RETURNING *;
            `;
            const values = [
                p.name, p.sku, p.description, p.sale_price, p.discount_price, 
                p.purchase_price, p.wholesale_price, p.stock, p.barcode,
                p.category, p.brand, p.ciudad_sucursal, // Campo de sucursal incluido
                p.photo_url_1, p.photo_url_2, p.photo_url_3, p.photo_url_4,
                p.photo_url_5, p.photo_url_6, p.photo_url_7, p.photo_url_8,
                p.id
            ];
            const { rows } = await pool.query(query, values);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', data: rows[0] }),
            };
        }

        // --- ELIMINAR UN PRODUCTO (Método DELETE) ---
        if (event.httpMethod === 'DELETE') {
            const { id } = body;
            if (!id) {
                return {
                    statusCode: 400, // Bad Request
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Se requiere el ID del producto para eliminarlo.' }),
                };
            }
            await pool.query('DELETE FROM products WHERE id = $1', [id]);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', message: 'Producto eliminado correctamente.' }),
            };
        }

        // Si el método no es ninguno de los anteriores, retorna un error
        return {
            statusCode: 405, // Method Not Allowed
            headers,
            body: JSON.stringify({ status: 'error', message: 'Método no permitido' }),
        };

    } catch (error) {
        console.error('Database Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message }),
        };
    } finally {
        // Asegura que la conexión a la base de datos se cierre siempre
        await pool.end();
    }
};

