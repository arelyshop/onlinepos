// netlify/functions/products.js
const { Pool } = require('pg');

// Configuración de la conexión a la base de datos de Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

exports.handler = async (event, context) => {
    const httpMethod = event.httpMethod;
    const client = await pool.connect();
    
    // Cabeceras CORS para permitir la comunicación desde tu página web
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*' // Permite el acceso desde cualquier origen
    };

    try {
        if (httpMethod === 'GET') {
            const result = await client.query('SELECT * FROM products ORDER BY created_at DESC');
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', data: result.rows }),
            };
        } else if (httpMethod === 'POST') {
            const { data } = JSON.parse(event.body);
            
            const query = `
                INSERT INTO products(name, sku, description, sale_price, purchase_price, wholesale_price, stock, barcode, ciudad_sucursal, photo_url_1)
                VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *;
            `;
            const values = [data.name, data.sku, data.description, data.sale_price, data.purchase_price, data.wholesale_price, data.stock, data.barcode, data.ciudad_sucursal, data.photo_url_1];
            
            const result = await client.query(query, values);
            
            return {
                statusCode: 201,
                headers,
                body: JSON.stringify({ status: 'success', data: result.rows[0] }),
            };

        } else if (httpMethod === 'PUT') {
            const { data } = JSON.parse(event.body);

            const query = `
                UPDATE products
                SET name = $1, sku = $2, description = $3, sale_price = $4, purchase_price = $5, wholesale_price = $6, stock = $7, barcode = $8, ciudad_sucursal = $9, photo_url_1 = $10
                WHERE sku = $11
                RETURNING *;
            `;
            const values = [data.name, data.sku, data.description, data.sale_price, data.purchase_price, data.wholesale_price, data.stock, data.barcode, data.ciudad_sucursal, data.photo_url_1, data.originalSku];

            const result = await client.query(query, values);
            if (result.rows.length === 0) {
                 return { statusCode: 404, headers, body: JSON.stringify({ status: 'error', message: 'Producto no encontrado.' }) };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', data: result.rows[0] }),
            };
        } else {
            return { statusCode: 405, headers, body: 'Method Not Allowed' };
        }
    } catch (error) {
        console.error('Error en la función de products:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ status: 'error', message: error.message }),
        };
    } finally {
        client.release();
    }
};

