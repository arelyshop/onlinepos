// netlify/functions/products-batch.js
const { Pool } = require('pg');

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const client = await pool.connect();
    
    try {
        const { products } = JSON.parse(event.body);

        if (!products || !Array.isArray(products) || products.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: 'No products provided for import.' })
            };
        }

        await client.query('BEGIN');

        let updatedCount = 0;
        let insertedCount = 0;

        for (const p of products) {
            // Utiliza el SKU como identificador único para decidir si actualizar o insertar
            const query = `
                INSERT INTO products (
                    name, sku, description, sale_price, discount_price, purchase_price, 
                    wholesale_price, stock, category, brand, barcode, ciudad_sucursal, 
                    photo_url_1, photo_url_2, photo_url_3, photo_url_4, photo_url_5, 
                    photo_url_6, photo_url_7, photo_url_8
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 
                    $14, $15, $16, $17, $18, $19, $20
                )
                ON CONFLICT (sku) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    sale_price = EXCLUDED.sale_price,
                    discount_price = EXCLUDED.discount_price,
                    purchase_price = EXCLUDED.purchase_price,
                    wholesale_price = EXCLUDED.wholesale_price,
                    stock = EXCLUDED.stock,
                    category = EXCLUDED.category,
                    brand = EXCLUDED.brand,
                    barcode = EXCLUDED.barcode,
                    ciudad_sucursal = EXCLUDED.ciudad_sucursal,
                    photo_url_1 = EXCLUDED.photo_url_1,
                    photo_url_2 = EXCLUDED.photo_url_2,
                    photo_url_3 = EXCLUDED.photo_url_3,
                    photo_url_4 = EXCLUDED.photo_url_4,
                    photo_url_5 = EXCLUDED.photo_url_5,
                    photo_url_6 = EXcluded.photo_url_6,
                    photo_url_7 = EXCLUDED.photo_url_7,
                    photo_url_8 = EXCLUDED.photo_url_8;
            `;

            const values = [
                p.name, p.sku, p.description, p.sale_price, p.discount_price,
                p.purchase_price, p.wholesale_price, p.stock, p.category, p.brand,
                p.barcode, p.ciudad_sucursal, p.photo_url_1, p.photo_url_2,
                p.photo_url_3, p.photo_url_4, p.photo_url_5, p.photo_url_6,
                p.photo_url_7, p.photo_url_8
            ];
            
            // Determinar si fue inserción o actualización es complejo con ON CONFLICT.
            // Para simplificar, simplemente ejecutamos la consulta. Una lógica más avanzada
            // podría consultar primero los SKUs existentes.
            await client.query(query, values);
        }

        await client.query('COMMIT');

        const summary = `Se procesaron ${products.length} productos. La base de datos ha sido actualizada.`;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: 'Importación de CSV completada.',
                details: summary
            })
        };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Batch Import Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: 'Error durante la importación en lote.', details: error.message })
        };
    } finally {
        client.release();
        await pool.end();
    }
};
