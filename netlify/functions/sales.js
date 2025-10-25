// netlify/functions/sales.js
const { Pool } = require('pg');

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

exports.handler = async (event) => {
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

    const client = await pool.connect();

    try {
        if (event.httpMethod === 'GET') {
            const { rows } = await client.query('SELECT * FROM sales ORDER BY "fechaVenta" DESC');
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ status: 'success', data: rows }),
            };
        }

        if (event.httpMethod === 'POST') {
            const saleData = JSON.parse(event.body);

            if (!saleData || !saleData.saleId || !Array.isArray(saleData.items) || !saleData.user) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Datos de venta incompletos o inválidos.' }),
                };
            }

            try {
                await client.query('BEGIN');

                const saleQuery = `
                    INSERT INTO sales ("saleId", "nombreCliente", "contacto", "nitCi", "totalVenta", "productosVendidos", "userId", "userName", "estado")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Completada')
                    RETURNING *;
                `;
                // IMPORTANTE: Asegurarse que saleData.items sea realmente un array antes de stringify
                const itemsJsonString = Array.isArray(saleData.items) ? JSON.stringify(saleData.items) : '[]'; // Guardar '[]' si no es array

                const saleValues = [
                    saleData.saleId,
                    saleData.customer.name,
                    saleData.customer.contact,
                    saleData.customer.id,
                    saleData.total,
                    itemsJsonString, // Usar la cadena JSON segura
                    saleData.user.id,
                    saleData.user.fullName
                ];
                const saleResult = await client.query(saleQuery, saleValues);
                const newSale = saleResult.rows[0];

                // Asegurarse de que saleData.items sea array para el map
                if (!Array.isArray(saleData.items)) {
                    throw new Error("Formato de items inválido recibido del frontend.");
                }

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

                for (let i = 0; i < updateResults.length; i++) {
                    if (updateResults[i].rowCount === 0) {
                        const failedItem = saleData.items[i];
                        const productCheck = await client.query('SELECT name, stock FROM products WHERE id = $1', [failedItem.productId]);
                        const productName = productCheck.rows.length > 0 ? productCheck.rows[0].name : `ID ${failedItem.productId}`;
                        const currentStock = productCheck.rows.length > 0 ? productCheck.rows[0].stock : 'desconocido';
                        throw new Error(`Stock insuficiente para el producto: "${productName}". Stock actual: ${currentStock}, se intentó vender: ${failedItem.cantidad}.`);
                    }
                }

                await client.query('COMMIT');
                return {
                    statusCode: 201,
                    headers,
                    body: JSON.stringify({ status: 'success', data: newSale }),
                };

            } catch (transactionError) {
                await client.query('ROLLBACK');
                console.error('Error en transacción de venta:', transactionError);
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

        if (event.httpMethod === 'PUT') {
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
                    // --- LOG CRUCIAL ---
                    console.log(`[ANULACIÓN ${saleId}] Tipo de dato 'productosVendidos': ${typeof sale.productosVendidos}`);
                    console.log(`[ANULACIÓN ${saleId}] Contenido 'productosVendidos' antes de parsear:`, sale.productosVendidos);
                    // --- FIN LOG CRUCIAL ---

                    if (sale.productosVendidos == null) {
                         console.warn(`[ANULACIÓN ${saleId}] 'productosVendidos' es null o undefined. No se restaurará stock.`);
                         productsSold = [];
                    } else if (typeof sale.productosVendidos === 'string') {
                        // Solo intentar parsear si es string
                        productsSold = JSON.parse(sale.productosVendidos);
                        console.log(`[ANULACIÓN ${saleId}] JSON 'productosVendidos' (string) parseado correctamente.`);
                    } else if (typeof sale.productosVendidos === 'object') {
                        // Si ya es un objeto (posiblemente por JSONB), usarlo directamente
                        productsSold = sale.productosVendidos;
                         console.log(`[ANULACIÓN ${saleId}] 'productosVendidos' ya es un objeto (JSONB?), usando directamente.`);
                    } else {
                         // Si es otro tipo, considerarlo inválido
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
                console.error(`[ANULACIÓN ${saleId}] Error en transacción, ROLLBACK ejecutado:`, transactionError);
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

        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ status: 'error', message: 'Método no permitido' }),
        };

    } catch (error) {
        console.error('Error general en la función sales:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message }),
        };
    } finally {
        if (client) {
            client.release();
            // console.log("Cliente de base de datos liberado."); // Puedes descomentar si necesitas confirmar liberación
        }
    }
};
```

**Cambios Clave:**

1.  **Verificación `typeof`:** Justo antes de `JSON.parse` en la sección `PUT`, he añadido:
    ```javascript
    console.log(`[ANULACIÓN ${saleId}] Tipo de dato 'productosVendidos': ${typeof sale.productosVendidos}`);
    console.log(`[ANULACIÓN ${saleId}] Contenido 'productosVendidos' antes de parsear:`, sale.productosVendidos);
    

