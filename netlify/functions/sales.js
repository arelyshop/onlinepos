// netlify/functions/sales.js
const { Pool } = require('pg');

// Cabeceras CORS para permitir la comunicación entre el frontend y la función
const headers = {
    'Access-Control-Allow-Origin': '*', // Permite solicitudes desde cualquier origen (ajusta si es necesario por seguridad)
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', // Métodos HTTP permitidos
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

    // Configuración de la conexión a la base de datos Neon
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL, // Lee la URL desde las variables de entorno de Netlify
        ssl: {
            rejectUnauthorized: false // Necesario para conexiones a Neon
        },
        // Timeouts para evitar que la función se quede colgada
        connectionTimeoutMillis: 5000, // 5 segundos para conectar
        query_timeout: 8000 // 8 segundos por consulta
    });

    // Obtener un cliente del pool para manejar transacciones
    let client; // Definir fuera para usar en finally

    try {
        client = await pool.connect(); // Intentar conectar

        // --- OBTENER TODAS LAS VENTAS (Método GET) ---
        if (event.httpMethod === 'GET') {
            try {
                const { rows } = await client.query('SELECT * FROM sales ORDER BY "fechaVenta" DESC');
                return {
                    statusCode: 200, // OK
                    headers,
                    body: JSON.stringify({ status: 'success', data: rows }),
                };
            } catch (queryError) {
                 console.error("[GET] Error al ejecutar la consulta de ventas:", queryError);
                 return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Error al consultar las ventas.', details: queryError.message }),
                 }
            }
        }

        // --- REGISTRAR NUEVA VENTA (Método POST) ---
        if (event.httpMethod === 'POST') {
            const saleData = JSON.parse(event.body);

            // Validación básica
            if (!saleData || !saleData.saleId || !Array.isArray(saleData.items) || !saleData.user) {
                return {
                    statusCode: 400, // Bad Request
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Datos de venta incompletos o inválidos.' }),
                };
            }

            try {
                // Iniciar transacción
                await client.query('BEGIN');

                // 1. Insertar venta
                const saleQuery = `
                    INSERT INTO sales ("saleId", "nombreCliente", "contacto", "nitCi", "totalVenta", "productosVendidos", "userId", "userName", "estado")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Completada')
                    RETURNING *;
                `;
                // Asegurar que items sea array antes de stringify
                const itemsJsonString = Array.isArray(saleData.items) ? JSON.stringify(saleData.items) : '[]';

                const saleValues = [
                    saleData.saleId,
                    saleData.customer.name,
                    saleData.customer.contact,
                    saleData.customer.id,
                    saleData.total,
                    itemsJsonString,
                    saleData.user.id,
                    saleData.user.fullName // Asegúrate que el frontend envíe fullName
                ];
                const saleResult = await client.query(saleQuery, saleValues);
                const newSale = saleResult.rows[0];

                // Asegurar que items sea array para el map
                 if (!Array.isArray(saleData.items)) {
                    // Este error debería ser capturado antes, pero por seguridad
                    throw new Error("Formato de items inválido recibido del frontend.");
                }

                // 2. Actualizar stock
                const updateStockPromises = saleData.items.map(item => {
                    const updateQuery = `
                        UPDATE products SET stock = stock - $1
                        WHERE id = $2 AND stock >= $1;
                    `;
                    const quantity = parseInt(item.cantidad, 10);
                    const productId = parseInt(item.productId, 10); // Asegúrate que el frontend envíe productId

                    if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) {
                        throw new Error(`Datos de producto inválidos en la venta: ${item.Nombre || 'Desconocido'} (ID: ${item.productId}, Cant: ${item.cantidad})`);
                    }
                    return client.query(updateQuery, [quantity, productId]);
                });

                const updateResults = await Promise.all(updateStockPromises);

                // Verificar fallos de stock
                for (let i = 0; i < updateResults.length; i++) {
                    if (updateResults[i].rowCount === 0) {
                        const failedItem = saleData.items[i];
                        const productCheck = await client.query('SELECT name, stock FROM products WHERE id = $1', [failedItem.productId]);
                        const productName = productCheck.rows.length > 0 ? productCheck.rows[0].name : `ID ${failedItem.productId}`;
                        const currentStock = productCheck.rows.length > 0 ? productCheck.rows[0].stock : 'desconocido';
                        throw new Error(`Stock insuficiente para el producto: "${productName}". Stock actual: ${currentStock}, se intentó vender: ${failedItem.cantidad}.`);
                    }
                }

                // Confirmar transacción
                await client.query('COMMIT');
                return {
                    statusCode: 201, // Created
                    headers,
                    body: JSON.stringify({ status: 'success', data: newSale }),
                };

            } catch (transactionError) {
                // Revertir transacción en caso de error
                await client.query('ROLLBACK');
                console.error(`[POST ${saleData.saleId || 'N/A'}] Error en transacción de venta:`, transactionError);
                const specificErrorMessages = ["Datos de producto inválidos", "Stock insuficiente", "Formato de items inválido"];
                const errorMessage = specificErrorMessages.some(msg => transactionError.message.includes(msg))
                    ? transactionError.message
                    : 'Error general al procesar la venta.';

                return {
                    statusCode: 500, // Internal Server Error (o 400 Bad Request)
                    headers,
                    body: JSON.stringify({ status: 'error', message: errorMessage, details: transactionError.message }),
                };
            }
        }

        // --- ANULAR VENTA (Método PUT) ---
        if (event.httpMethod === 'PUT') {
            const { saleId } = JSON.parse(event.body);

            if (!saleId) {
                 return {
                    statusCode: 400, // Bad Request
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Se requiere el ID de la venta para anularla.' }),
                };
            }

             try {
                // Iniciar transacción
                await client.query('BEGIN');

                // 1. Obtener venta y bloquearla
                const getSaleQuery = 'SELECT * FROM sales WHERE "saleId" = $1 FOR UPDATE';
                const saleResult = await client.query(getSaleQuery, [saleId]);

                if (saleResult.rows.length === 0) {
                    throw new Error(`Venta con ID "${saleId}" no encontrada.`);
                }
                const sale = saleResult.rows[0];

                if (sale.estado === 'Anulada') {
                    throw new Error(`La venta "${saleId}" ya ha sido anulada previamente.`);
                }

                 // 2. Marcar como Anulada
                 const annulQuery = 'UPDATE sales SET estado = $1 WHERE "saleId" = $2';
                 await client.query(annulQuery, ['Anulada', saleId]);

                // 3. Restaurar stock
                let productsSold;
                try {
                    // Verificar si es null/undefined, string o ya objeto (JSONB)
                    if (sale.productosVendidos == null) {
                         productsSold = [];
                    } else if (typeof sale.productosVendidos === 'string') {
                        productsSold = JSON.parse(sale.productosVendidos);
                    } else if (typeof sale.productosVendidos === 'object') {
                        productsSold = sale.productosVendidos; // Usar directamente si es JSONB
                    } else {
                         throw new Error(`Tipo inesperado para 'productosVendidos': ${typeof sale.productosVendidos}`);
                    }
                } catch (parseError) {
                     console.error(`[ANULACIÓN ${saleId}] Error procesando 'productosVendidos':`, parseError);
                     throw new Error(`Formato de productos inválido en la venta ${saleId}. No se pudo restaurar stock.`);
                }

                // Asegurarse de que sea un array
                if (Array.isArray(productsSold)) {
                    // Crear promesas para restaurar stock
                    const restoreStockPromises = productsSold.map((item, index) => {
                         // Validar item
                         if (!item || typeof item !== 'object') {
                              console.warn(`[ANULACIÓN ${saleId}] Item ${index + 1} inválido (no es objeto). Saltando.`);
                              return Promise.resolve();
                         }
                         const quantity = parseInt(item.cantidad, 10);
                         const productId = parseInt(item.productId, 10); // Leer productId

                         // Validar quantity y productId
                         if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) {
                             console.warn(`[ANULACIÓN ${saleId}] Datos inválidos para item ${index + 1} (cantidad o ID). Saltando.`);
                             return Promise.resolve();
                         }

                         // Consulta para aumentar stock
                         const restoreQuery = 'UPDATE products SET stock = stock + $1 WHERE id = $2';
                         return client.query(restoreQuery, [quantity, productId])
                           .catch(updateError => {
                               console.error(`[ANULACIÓN ${saleId}] Error al actualizar stock para productId ${productId}:`, updateError);
                               throw updateError; // Fallar transacción si una actualización falla
                           });
                    });
                    // Esperar a que terminen todas las actualizaciones
                    await Promise.all(restoreStockPromises);
                } else {
                     // Si no fue array después de procesar
                     console.warn(`[ANULACIÓN ${saleId}] 'productsSold' no es un array después del procesamiento. No se restauró stock.`);
                }

                // Confirmar transacción
                await client.query('COMMIT');
                return {
                    statusCode: 200, // OK
                    headers,
                    body: JSON.stringify({ status: 'success', message: `Venta ${saleId} anulada y stock restaurado.` }),
                };

            } catch (transactionError) {
                // Revertir transacción en caso de error
                await client.query('ROLLBACK');
                console.error(`[ANULACIÓN ${saleId || 'N/A'}] Error en transacción de anulación:`, transactionError);
                 const userFriendlyMessage = transactionError.message.includes("ya ha sido anulada") || transactionError.message.includes("no encontrada") || transactionError.message.includes("Formato de productos inválido") || transactionError.message.includes("Tipo inesperado")
                    ? transactionError.message
                    : 'Error al intentar anular la venta.';
                return {
                    statusCode: 500, // Internal Server Error (o 4xx según el caso)
                    headers,
                    body: JSON.stringify({ status: 'error', message: userFriendlyMessage, details: transactionError.message }),
                };
            }
        }

        // Si el método no es GET, POST o PUT
        return {
            statusCode: 405, // Method Not Allowed
            headers,
            body: JSON.stringify({ status: 'error', message: 'Método no permitido' }),
        };

    } catch (error) {
        // Capturar errores generales (ej., fallo al conectar al pool)
        console.error('Error general en la función sales:', error);
        return {
            statusCode: 500, // Internal Server Error
            headers,
            body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message }),
        };
    } finally {
        // Asegurarse de liberar siempre el cliente si se obtuvo
        if (client) {
            client.release();
        }
    }
};

