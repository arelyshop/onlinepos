// netlify/functions/sales.js
const { Pool } = require('pg');

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

exports.handler = async (event) => {
    console.log(`[${event.httpMethod}] Inicio de la función sales.`); // LOG INICIAL

    if (event.httpMethod === 'OPTIONS') {
        console.log("Respondiendo a solicitud OPTIONS (preflight)");
        return {
            statusCode: 204,
            headers,
            body: ''
        };
    }

    let pool; // Definir pool fuera del try para usarlo en finally si es necesario

    try {
        console.log("Intentando crear pool de conexión...");
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            },
            // Añadir timeouts para conexión y consulta
            connectionTimeoutMillis: 5000, // 5 segundos para conectar
            query_timeout: 8000 // 8 segundos por consulta (ajustar si es necesario)
        });
        console.log("Pool de conexión creado.");
    } catch (poolError) {
        console.error("!!! Error CRÍTICO al crear el pool de conexión:", poolError);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ status: 'error', message: 'Error al inicializar la conexión a la base de datos.', details: poolError.message }),
        };
    }


    let client; // Definir cliente fuera del try principal

    try {
        console.log("Intentando obtener cliente del pool...");
        client = await pool.connect();
        console.log("Cliente obtenido del pool.");

        // --- OBTENER TODAS LAS VENTAS (Método GET) ---
        if (event.httpMethod === 'GET') {
            console.log("[GET] Intentando obtener ventas...");
            try {
                const { rows } = await client.query('SELECT * FROM sales ORDER BY "fechaVenta" DESC');
                console.log(`[GET] Consulta de ventas exitosa. ${rows.length} ventas encontradas.`);
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ status: 'success', data: rows }),
                };
            } catch (queryError) {
                 console.error("[GET] !!! Error al ejecutar la consulta de ventas:", queryError);
                 // Devolver error específico de la consulta
                 return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Error al consultar las ventas.', details: queryError.message }),
                 }
            }
        }

        // --- REGISTRAR NUEVA VENTA (Método POST) ---
        if (event.httpMethod === 'POST') {
             console.log("[POST] Intentando registrar nueva venta...");
             // ... (resto del código POST sin cambios, pero podrías añadir logs similares si falla) ...
             // Asegúrate de que los logs de error dentro del try/catch de la transacción POST sigan presentes.
            const saleData = JSON.parse(event.body);

            if (!saleData || !saleData.saleId || !Array.isArray(saleData.items) || !saleData.user) {
                 console.error("[POST] Datos de venta inválidos recibidos:", saleData);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Datos de venta incompletos o inválidos.' }),
                };
            }

            try {
                await client.query('BEGIN');
                console.log(`[POST ${saleData.saleId}] Transacción iniciada.`);

                const saleQuery = `
                    INSERT INTO sales ("saleId", "nombreCliente", "contacto", "nitCi", "totalVenta", "productosVendidos", "userId", "userName", "estado")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Completada')
                    RETURNING *;
                `;
                const itemsJsonString = Array.isArray(saleData.items) ? JSON.stringify(saleData.items) : '[]';

                const saleValues = [
                    saleData.saleId,
                    saleData.customer.name,
                    saleData.customer.contact,
                    saleData.customer.id,
                    saleData.total,
                    itemsJsonString,
                    saleData.user.id,
                    saleData.user.fullName
                ];
                 console.log(`[POST ${saleData.saleId}] Insertando venta...`);
                const saleResult = await client.query(saleQuery, saleValues);
                const newSale = saleResult.rows[0];
                 console.log(`[POST ${saleData.saleId}] Venta insertada.`);

                if (!Array.isArray(saleData.items)) {
                    throw new Error("Formato de items inválido recibido del frontend.");
                }

                 console.log(`[POST ${saleData.saleId}] Actualizando stock para ${saleData.items.length} items...`);
                const updateStockPromises = saleData.items.map(item => {
                    const updateQuery = `
                        UPDATE products SET stock = stock - $1
                        WHERE id = $2 AND stock >= $1;
                    `;
                    const quantity = parseInt(item.cantidad, 10);
                    const productId = parseInt(item.productId, 10);

                    if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) {
                        throw new Error(`Datos de producto inválidos en la venta: ${item.Nombre || 'Desconocido'} (ID: ${item.productId}, Cant: ${item.cantidad})`);
                    }
                    return client.query(updateQuery, [quantity, productId]);
                });

                const updateResults = await Promise.all(updateStockPromises);
                 console.log(`[POST ${saleData.saleId}] Actualizaciones de stock (promesas) completadas.`);

                for (let i = 0; i < updateResults.length; i++) {
                    if (updateResults[i].rowCount === 0) {
                        const failedItem = saleData.items[i];
                        const productCheck = await client.query('SELECT name, stock FROM products WHERE id = $1', [failedItem.productId]);
                        const productName = productCheck.rows.length > 0 ? productCheck.rows[0].name : `ID ${failedItem.productId}`;
                        const currentStock = productCheck.rows.length > 0 ? productCheck.rows[0].stock : 'desconocido';
                        throw new Error(`Stock insuficiente para el producto: "${productName}". Stock actual: ${currentStock}, se intentó vender: ${failedItem.cantidad}.`);
                    }
                }
                 console.log(`[POST ${saleData.saleId}] Verificación de stock suficiente pasada.`);

                await client.query('COMMIT');
                 console.log(`[POST ${saleData.saleId}] Transacción COMMIT exitosa.`);
                return {
                    statusCode: 201,
                    headers,
                    body: JSON.stringify({ status: 'success', data: newSale }),
                };

            } catch (transactionError) {
                await client.query('ROLLBACK');
                 // Loguear el error específico de la transacción
                 console.error(`[POST ${saleData.saleId || 'N/A'}] !!! Error en transacción de venta, ROLLBACK ejecutado:`, transactionError);
                const specificErrorMessages = ["Datos de producto inválidos", "Stock insuficiente", "Formato de items inválido"];
                const errorMessage = specificErrorMessages.some(msg => transactionError.message.includes(msg))
                    ? transactionError.message
                    : 'Error general al procesar la venta.';

                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ status: 'error', message: errorMessage, details: transactionError.message }),
                };
            }
        }

        // --- ANULAR VENTA (Método PUT) ---
        if (event.httpMethod === 'PUT') {
            console.log("[PUT] Intentando anular venta...");
            // ... (resto del código PUT sin cambios, pero podrías añadir logs similares si falla) ...
             // Asegúrate de que los logs de error dentro del try/catch de la transacción PUT sigan presentes.
             const { saleId } = JSON.parse(event.body);
             console.log(`[ANULACIÓN ${saleId}] Iniciando proceso.`);

             if (!saleId) {
                  return {
                     statusCode: 400,
                     headers,
                     body: JSON.stringify({ status: 'error', message: 'Se requiere el ID de la venta para anularla.' }),
                 };
             }

              try {
                 await client.query('BEGIN');
                 console.log(`[ANULACIÓN ${saleId}] Transacción iniciada.`);

                 const getSaleQuery = 'SELECT * FROM sales WHERE "saleId" = $1 FOR UPDATE';
                 const saleResult = await client.query(getSaleQuery, [saleId]);

                 if (saleResult.rows.length === 0) {
                     throw new Error(`Venta con ID "${saleId}" no encontrada.`);
                 }
                 const sale = saleResult.rows[0];
                 console.log(`[ANULACIÓN ${saleId}] Venta encontrada. Estado actual: ${sale.estado}`);
                 if (sale.estado === 'Anulada') {
                     throw new Error(`La venta "${saleId}" ya ha sido anulada previamente.`);
                 }

                  const annulQuery = 'UPDATE sales SET estado = $1 WHERE "saleId" = $2';
                  await client.query(annulQuery, ['Anulada', saleId]);
                  console.log(`[ANULACIÓN ${saleId}] Estado de venta actualizado a 'Anulada'.`);

                 let productsSold;
                 try {
                     console.log(`[ANULACIÓN ${saleId}] Tipo de dato 'productosVendidos': ${typeof sale.productosVendidos}`);
                     console.log(`[ANULACIÓN ${saleId}] Contenido 'productosVendidos' antes de parsear:`, sale.productosVendidos);

                     if (sale.productosVendidos == null) {
                          console.warn(`[ANULACIÓN ${saleId}] 'productosVendidos' es null o undefined. No se restaurará stock.`);
                          productsSold = [];
                     } else if (typeof sale.productosVendidos === 'string') {
                         productsSold = JSON.parse(sale.productosVendidos);
                         console.log(`[ANULACIÓN ${saleId}] JSON 'productosVendidos' (string) parseado correctamente.`);
                     } else if (typeof sale.productosVendidos === 'object') {
                         productsSold = sale.productosVendidos;
                          console.log(`[ANULACIÓN ${saleId}] 'productosVendidos' ya es un objeto (JSONB?), usando directamente.`);
                     } else {
                          throw new Error(`Tipo inesperado para 'productosVendidos': ${typeof sale.productosVendidos}`);
                     }
                 } catch (parseError) {
                      console.error(`[ANULACIÓN ${saleId}] Error procesando 'productosVendidos':`, parseError);
                      throw new Error(`Formato de productos inválido en la venta ${saleId}. No se pudo restaurar stock.`);
                 }

                 if (Array.isArray(productsSold)) {
                     console.log(`[ANULACIÓN ${saleId}] Procesando ${productsSold.length} productos para restaurar stock.`);
                     const restoreStockPromises = productsSold.map((item, index) => {
                          console.log(`[ANULACIÓN ${saleId}] Procesando item ${index + 1}:`, item);
                          if (!item || typeof item !== 'object') {
                               console.warn(`[ANULACIÓN ${saleId}] Item ${index + 1} inválido (no es objeto). Saltando.`);
                               return Promise.resolve();
                          }
                          const quantity = parseInt(item.cantidad, 10);
                          const productId = parseInt(item.productId, 10);

                          console.log(`[ANULACIÓN ${saleId}] Item ${index + 1}: Cantidad parseada=${quantity}, ProductId parseado=${productId}`);

                          if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) {
                              console.warn(`[ANULACIÓN ${saleId}] Datos inválidos para item ${index + 1} (cantidad o ID). Saltando.`);
                              return Promise.resolve();
                          }

                          console.log(`[ANULACIÓN ${saleId}] Ejecutando UPDATE para productId ${productId}, cantidad +${quantity}`);
                          const restoreQuery = 'UPDATE products SET stock = stock + $1 WHERE id = $2';
                          return client.query(restoreQuery, [quantity, productId])
                            .then(result => {
                                console.log(`[ANULACIÓN ${saleId}] UPDATE para productId ${productId} completado. Filas afectadas: ${result.rowCount}`);
                            })
                            .catch(updateError => {
                                console.error(`[ANULACIÓN ${saleId}] Error al actualizar stock para productId ${productId}:`, updateError);
                                throw updateError;
                            });
                     });
                     await Promise.all(restoreStockPromises);
                     console.log(`[ANULACIÓN ${saleId}] Todas las promesas de restauración de stock completadas.`);
                 } else {
                      console.warn(`[ANULACIÓN ${saleId}] 'productsSold' no es un array después del procesamiento. No se restauró stock.`);
                 }

                 await client.query('COMMIT');
                 console.log(`[ANULACIÓN ${saleId}] Transacción COMMIT exitosa.`);
                 return {
                     statusCode: 200,
                     headers,
                     body: JSON.stringify({ status: 'success', message: `Venta ${saleId} anulada y stock restaurado.` }),
                 };

             } catch (transactionError) {
                 await client.query('ROLLBACK');
                 // Loguear el error específico de la transacción
                 console.error(`[ANULACIÓN ${saleId || 'N/A'}] !!! Error en transacción de anulación, ROLLBACK ejecutado:`, transactionError);
                  const userFriendlyMessage = transactionError.message.includes("ya ha sido anulada") || transactionError.message.includes("no encontrada") || transactionError.message.includes("Formato de productos inválido") || transactionError.message.includes("Tipo inesperado")
                     ? transactionError.message
                     : 'Error al intentar anular la venta.';
                 return {
                     statusCode: 500,
                     headers,
                     body: JSON.stringify({ status: 'error', message: userFriendlyMessage, details: transactionError.message }),
                 };
             }
        }

        // Si el método no coincide con GET, POST o PUT
        console.warn(`Método no permitido recibido: ${event.httpMethod}`);
        return {
            statusCode: 405, // Method Not Allowed
            headers,
            body: JSON.stringify({ status: 'error', message: 'Método no permitido' }),
        };

    } catch (error) {
        // Capturar errores generales (ej. error al obtener cliente del pool)
        console.error('!!! Error general en la función sales (antes de entrar a métodos específicos):', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message }),
        };
    } finally {
        // Asegurarse de liberar siempre el cliente si se obtuvo
        if (client) {
            client.release();
            console.log("Cliente de base de datos liberado.");
        } else {
             console.log("No se obtuvo cliente, no se libera.");
        }
        // No cerrar el pool aquí si quieres reutilizarlo en futuras invocaciones (Netlify maneja esto)
        // await pool.end();
    }
};

