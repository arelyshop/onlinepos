// netlify/functions/sales.js
const { Pool } = require('pg');

// Configuración de cabeceras CORS
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event) => {
    // Manejo de la solicitud pre-vuelo (preflight) de CORS
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

    // --- OBTENER TODAS LAS VENTAS ---
    if (event.httpMethod === 'GET') {
        try {
            const { rows } = await pool.query('SELECT * FROM sales ORDER BY "fechaVenta" DESC');
            await pool.end();
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', data: rows }),
            };
        } catch (error) {
            console.error('Error al obtener ventas:', error);
            await pool.end();
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ status: 'error', message: 'Error al obtener el historial de ventas.' }),
            };
        }
    }

    // --- CREAR UNA NUEVA VENTA Y ACTUALIZAR STOCK (Transacción) ---
    if (event.httpMethod === 'POST') {
        const saleData = JSON.parse(event.body);
        const { saleId, customer, items, total, user } = saleData;

        // Validación básica
        if (!items || items.length === 0 || !user || !user.id || !saleId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ status: 'error', message: 'Faltan datos para registrar la venta.' }),
            };
        }

        const client = await pool.connect();

        try {
            // Iniciar la transacción
            await client.query('BEGIN');

            // 1. Insertar la venta en la tabla 'sales'
            const saleQuery = `
                INSERT INTO sales (
                    "saleId", "fechaVenta", "nombreCliente", "contacto", "nitCi", 
                    "totalVenta", "productosVendidos", "estado", "userId", "userName"
                ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, 'Completada', $7, $8)
                RETURNING *;
            `;
            const saleValues = [
                saleId,
                customer.name,
                customer.contact,
                customer.id, // Esto es el NIT/CI del cliente
                total,
                JSON.stringify(items), // Guardar los productos como un JSON
                user.id,
                user.fullName
            ];
            
            const { rows: saleRows } = await client.query(saleQuery, saleValues);
            const newSale = saleRows[0];

            // 2. Actualizar el stock para cada producto vendido
            const stockUpdatePromises = items.map(item => {
                const stockQuery = `
                    UPDATE products 
                    SET stock = stock - $1 
                    WHERE sku = $2 AND stock >= $1;
                `;
                return client.query(stockQuery, [item.cantidad, item.SKU]);
            });

            const results = await Promise.all(stockUpdatePromises);

            // 3. Verificar si algún producto tuvo stock insuficiente
            for (const [index, result] of results.entries()) {
                if (result.rowCount === 0) {
                    // Si rowCount es 0, significa que el stock era menor que la cantidad a vender
                    throw new Error(`Stock insuficiente para el producto: ${items[index].Nombre} (SKU: ${items[index].SKU})`);
                }
            }

            // 4. Si todo salió bien, confirmar la transacción
            await client.query('COMMIT');
            
            return {
                statusCode: 201, // 201 Creado
                headers,
                body: JSON.stringify({ status: 'success', data: newSale }),
            };

        } catch (error) {
            // 5. Si algo falló, revertir la transacción
            await client.query('ROLLBACK');
            console.error('Error en la transacción de venta:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ status: 'error', message: error.message || 'Error al procesar la venta.' }),
            };
        } finally {
            // Liberar al cliente de vuelta al pool
            client.release();
            await pool.end();
        }
    }

    // Método no permitido
    return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ status: 'error', message: 'Método no permitido' }),
    };
};

