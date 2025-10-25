// netlify/functions/sales.js
const { Pool } = require('pg');

const headers = {
    'Access-Control-Allow-Origin': '*', // Permite solicitudes desde cualquier origen
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', // Permite GET, POST, PUT y OPTIONS
};

exports.handler = async (event) => {
    // --- Manejo de OPTIONS (Preflight CORS) ---
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
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

    const client = await pool.connect(); // Usar un cliente para la transacción

    try {
        // --- OBTENER TODAS LAS VENTAS ---
        if (event.httpMethod === 'GET') {
            const { rows } = await client.query('SELECT * FROM sales ORDER BY "fechaVenta" DESC');
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', data: rows }),
            };
        }

        // --- REGISTRAR NUEVA VENTA ---
        if (event.httpMethod === 'POST') {
            const saleData = JSON.parse(event.body);

            // Validar datos básicos
            if (!saleData || !saleData.saleId || !Array.isArray(saleData.items) || !saleData.user) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Datos de venta incompletos o inválidos.' }),
                };
            }

            try {
                await client.query('BEGIN'); // Iniciar transacción

                // 1. Insertar la venta
                const saleQuery = `
                    INSERT INTO sales ("saleId", "nombreCliente", "contacto", "nitCi", "totalVenta", "productosVendidos", "userId", "userName", "estado")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Completada')
                    RETURNING *;
                `;
                const saleValues = [
                    saleData.saleId,
                    saleData.customer.name,
                    saleData.customer.contact,
                    saleData.customer.id,
                    saleData.total,
                    JSON.stringify(saleData.items), // Guardar productos como JSON
                    saleData.user.id,
                    saleData.user.fullName
                ];
                const saleResult = await client.query(saleQuery, saleValues);
                const newSale = saleResult.rows[0];

                // 2. Actualizar stock de cada producto
                const updateStockPromises = saleData.items.map(item => {
                    const updateQuery = `
                        UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1;
                    `;
                    // Asegurarse de que productId y cantidad existan y sean números
                    const quantity = parseInt(item.cantidad, 10);
                    const productId = parseInt(item.productId, 10);
                    if (isNaN(quantity) || isNaN(productId)) {
                        throw new Error(`Producto inválido en la venta: ${item.Nombre} (ID: ${item.productId}, Cant: ${item.cantidad})`);
                    }
                    return client.query(updateQuery, [quantity, productId]);
                });

                const updateResults = await Promise.all(updateStockPromises);

                // Verificar si alguna actualización de stock falló (ej. stock insuficiente)
                for (let i = 0; i < updateResults.length; i++) {
                    if (updateResults[i].rowCount === 0) {
                        // Intentar obtener el nombre del producto que falló
                        const failedItem = saleData.items[i];
                        const productCheck = await client.query('SELECT name, stock FROM products WHERE id = $1', [failedItem.productId]);
                        const productName = productCheck.rows.length > 0 ? productCheck.rows[0].name : `ID ${failedItem.productId}`;
                        const currentStock = productCheck.rows.length > 0 ? productCheck.rows[0].stock : 'desconocido';
                        throw new Error(`Stock insuficiente para el producto: ${productName}. Stock actual: ${currentStock}, se intentó vender: ${failedItem.cantidad}.`);
                    }
                }


                await client.query('COMMIT'); // Confirmar transacción
                return {
                    statusCode: 201, // Created
                    headers,
                    body: JSON.stringify({ status: 'success', data: newSale }),
                };

            } catch (transactionError) {
                await client.query('ROLLBACK'); // Revertir en caso de error
                console.error('Error en transacción de venta:', transactionError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Error al procesar la venta.', details: transactionError.message }),
                };
            }
        }

        // --- ANULAR VENTA (NUEVO) ---
        if (event.httpMethod === 'PUT') {
            const { saleId } = JSON.parse(event.body);

            if (!saleId) {
                 return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Se requiere el ID de la venta para anularla.' }),
                };
            }

             try {
                await client.query('BEGIN'); // Iniciar transacción

                // 1. Obtener la venta y verificar que no esté ya anulada
                const getSaleQuery = 'SELECT * FROM sales WHERE "saleId" = $1';
                const saleResult = await client.query(getSaleQuery, [saleId]);

                if (saleResult.rows.length === 0) {
                    throw new Error('Venta no encontrada.');
                }
                const sale = saleResult.rows[0];
                if (sale.estado === 'Anulada') {
                    throw new Error('Esta venta ya ha sido anulada.');
                }

                 // 2. Marcar la venta como Anulada
                 const annulQuery = 'UPDATE sales SET estado = $1 WHERE "saleId" = $2';
                 await client.query(annulQuery, ['Anulada', saleId]);

                // 3. Restaurar stock de los productos
                const productsSold = JSON.parse(sale.productosVendidos); // Asumiendo que está guardado como JSON
                if (Array.isArray(productsSold)) {
                    const restoreStockPromises = productsSold.map(item => {
                         const restoreQuery = 'UPDATE products SET stock = stock + $1 WHERE id = $2';
                         // Asegurarse de que productId y cantidad existan y sean números
                         const quantity = parseInt(item.cantidad, 10);
                         const productId = parseInt(item.productId, 10);
                         if (isNaN(quantity) || isNaN(productId)) {
                             console.warn(`Producto inválido encontrado al anular venta ${saleId}:`, item);
                             return Promise.resolve(); // Saltar este item si es inválido
                         }
                         return client.query(restoreQuery, [quantity, productId]);
                    });
                    await Promise.all(restoreStockPromises);
                } else {
                     console.warn(`No se pudo restaurar stock para la venta ${saleId} porque 'productosVendidos' no es un array válido.`);
                }


                await client.query('COMMIT'); // Confirmar transacción
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ status: 'success', message: `Venta ${saleId} anulada y stock restaurado.` }),
                };

            } catch (transactionError) {
                await client.query('ROLLBACK'); // Revertir en caso de error
                console.error(`Error en transacción de anulación (${saleId}):`, transactionError);
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Error al anular la venta.', details: transactionError.message }),
                };
            }
        }


        // Si no es GET, POST o PUT, retornar método no permitido
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ status: 'error', message: 'Método no permitido' }),
        };

    } catch (error) {
        console.error('Error general en la función sales:', error);
        return {
            statusCode: 500,
            headers, // Incluir headers también en errores generales
            body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message }),
        };
    } finally {
        if (client) {
            client.release(); // Liberar el cliente de vuelta al pool
        }
    }
};

