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
    // El navegador envía esta solicitud antes de PUT/POST/DELETE para verificar permisos
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content - Respuesta estándar para OPTIONS exitoso
            headers,
            body: ''
        };
    }

    // Configuración de la conexión a la base de datos Neon
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL, // Lee la URL desde las variables de entorno de Netlify
        ssl: {
            rejectUnauthorized: false // Necesario para conexiones a Neon
        }
    });

    // Obtener un cliente del pool para manejar transacciones
    const client = await pool.connect();

    try {
        // --- OBTENER TODAS LAS VENTAS (Método GET) ---
        if (event.httpMethod === 'GET') {
            // Consulta para obtener todas las ventas, ordenadas por fecha más reciente primero
            const { rows } = await client.query('SELECT * FROM sales ORDER BY "fechaVenta" DESC');
            return {
                statusCode: 200, // OK
                headers,
                body: JSON.stringify({ status: 'success', data: rows }), // Devuelve los datos en formato JSON
            };
        }

        // --- REGISTRAR NUEVA VENTA (Método POST) ---
        if (event.httpMethod === 'POST') {
            const saleData = JSON.parse(event.body); // Obtener datos de la venta desde el cuerpo de la solicitud

            // Validación básica de los datos recibidos
            if (!saleData || !saleData.saleId || !Array.isArray(saleData.items) || !saleData.user) {
                return {
                    statusCode: 400, // Bad Request
                    headers,
                    body: JSON.stringify({ status: 'error', message: 'Datos de venta incompletos o inválidos.' }),
                };
            }

            try {
                // Iniciar una transacción para asegurar la atomicidad (o todo funciona o nada)
                await client.query('BEGIN');

                // 1. Insertar la nueva venta en la tabla 'sales'
                const saleQuery = `
                    INSERT INTO sales ("saleId", "nombreCliente", "contacto", "nitCi", "totalVenta", "productosVendidos", "userId", "userName", "estado")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Completada')
                    RETURNING *; -- Devuelve la fila insertada
                `;
                const saleValues = [
                    saleData.saleId,
                    saleData.customer.name,
                    saleData.customer.contact,
                    saleData.customer.id,
                    saleData.total,
                    JSON.stringify(saleData.items), // Convertir el array de items a texto JSON para guardarlo
                    saleData.user.id,
                    saleData.user.fullName // Asegúrate que el frontend envíe fullName aquí
                ];
                const saleResult = await client.query(saleQuery, saleValues);
                const newSale = saleResult.rows[0];

                // 2. Actualizar (disminuir) el stock de cada producto vendido en la tabla 'products'
                const updateStockPromises = saleData.items.map(item => {
                    const updateQuery = `
                        UPDATE products SET stock = stock - $1
                        WHERE id = $2 AND stock >= $1; -- Solo actualiza si hay stock suficiente
                    `;
                    const quantity = parseInt(item.cantidad, 10);
                    const productId = parseInt(item.productId, 10); // Asegúrate que el frontend envíe productId

                    // Validar que la cantidad y el ID sean números válidos
                    if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) {
                        // Si hay datos inválidos, cancelar la transacción
                        throw new Error(`Datos de producto inválidos en la venta: ${item.Nombre || 'Desconocido'} (ID: ${item.productId}, Cant: ${item.cantidad})`);
                    }
                    return client.query(updateQuery, [quantity, productId]);
                });

                // Esperar a que todas las actualizaciones de stock terminen
                const updateResults = await Promise.all(updateStockPromises);

                // Verificar si alguna actualización falló (rowCount === 0 significa que no se actualizó, probablemente por stock insuficiente)
                for (let i = 0; i < updateResults.length; i++) {
                    if (updateResults[i].rowCount === 0) {
                        const failedItem = saleData.items[i];
                        // Obtener info del producto que falló para dar un mensaje claro
                        const productCheck = await client.query('SELECT name, stock FROM products WHERE id = $1', [failedItem.productId]);
                        const productName = productCheck.rows.length > 0 ? productCheck.rows[0].name : `ID ${failedItem.productId}`;
                        const currentStock = productCheck.rows.length > 0 ? productCheck.rows[0].stock : 'desconocido';
                        // Cancelar la transacción por stock insuficiente
                        throw new Error(`Stock insuficiente para el producto: "${productName}". Stock actual: ${currentStock}, se intentó vender: ${failedItem.cantidad}.`);
                    }
                }

                // Si todo fue bien, confirmar la transacción
                await client.query('COMMIT');
                return {
                    statusCode: 201, // Created
                    headers,
                    body: JSON.stringify({ status: 'success', data: newSale }), // Devuelve los datos de la venta creada
                };

            } catch (transactionError) {
                // Si algo falló (datos inválidos, stock insuficiente, error DB), revertir la transacción
                await client.query('ROLLBACK');
                console.error('Error en transacción de venta:', transactionError);
                // Determinar si el error fue por validación nuestra o un error general
                const specificErrorMessages = ["Datos de producto inválidos", "Stock insuficiente"];
                const errorMessage = specificErrorMessages.some(msg => transactionError.message.includes(msg))
                    ? transactionError.message // Usar nuestro mensaje específico
                    : 'Error general al procesar la venta.'; // Mensaje genérico

                return {
                    statusCode: 500, // Internal Server Error (o 400 si fue error de datos)
                    headers,
                    body: JSON.stringify({ status: 'error', message: errorMessage, details: transactionError.message }),
                };
            }
        }

        // --- ANULAR VENTA (Método PUT) ---
        if (event.httpMethod === 'PUT') {
            const { saleId } = JSON.parse(event.body); // Obtener el ID de la venta a anular

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

                // 1. Obtener la venta y bloquear la fila para evitar problemas de concurrencia
                const getSaleQuery = 'SELECT * FROM sales WHERE "saleId" = $1 FOR UPDATE';
                const saleResult = await client.query(getSaleQuery, [saleId]);

                // Verificar si la venta existe
                if (saleResult.rows.length === 0) {
                    throw new Error(`Venta con ID "${saleId}" no encontrada.`);
                }
                const sale = saleResult.rows[0];

                // Verificar si ya está anulada
                if (sale.estado === 'Anulada') {
                    throw new Error(`La venta "${saleId}" ya ha sido anulada previamente.`);
                }

                 // 2. Actualizar el estado de la venta a 'Anulada'
                 const annulQuery = 'UPDATE sales SET estado = $1 WHERE "saleId" = $2';
                 await client.query(annulQuery, ['Anulada', saleId]);

                // 3. Restaurar (aumentar) el stock de los productos vendidos
                let productsSold;
                try {
                    // Verificar si 'productosVendidos' es null o undefined
                    if (sale.productosVendidos == null) {
                         console.warn(`[ANULACIÓN ${saleId}] 'productosVendidos' es null o undefined. No se restaurará stock.`);
                         productsSold = []; // Considerar como si no hubiera productos
                    } else {
                        // Intentar parsear el JSON almacenado
                        productsSold = JSON.parse(sale.productosVendidos);
                    }
                } catch (parseError) {
                     // Si falla el parseo, la transacción fallará
                     console.error(`[ANULACIÓN ${saleId}] Error parseando 'productosVendidos':`, parseError);
                     throw new Error(`Formato de productos inválido en la venta ${saleId}. No se pudo restaurar stock.`);
                }

                // Asegurarse de que 'productsSold' sea un array
                if (Array.isArray(productsSold)) {
                    // Crear promesas para actualizar el stock de cada producto
                    const restoreStockPromises = productsSold.map((item, index) => {
                         // Validar que el item sea un objeto válido
                         if (!item || typeof item !== 'object') {
                              console.warn(`[ANULACIÓN ${saleId}] Item ${index + 1} inválido (no es objeto). Saltando.`);
                              return Promise.resolve(); // Saltar este item
                         }
                         const quantity = parseInt(item.cantidad, 10);
                         const productId = parseInt(item.productId, 10); // Leer el ID del producto

                         // Validar cantidad y ID
                         if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) {
                             console.warn(`[ANULACIÓN ${saleId}] Datos inválidos para item ${index + 1} (cantidad o ID). Saltando.`);
                             // Considerar lanzar error si es crítico que TODO se restaure
                             // throw new Error(`Datos inválidos para producto en venta ${saleId}`);
                             return Promise.resolve(); // Saltar este item
                         }

                         // Consulta para aumentar el stock
                         const restoreQuery = 'UPDATE products SET stock = stock + $1 WHERE id = $2';
                         return client.query(restoreQuery, [quantity, productId])
                           .catch(updateError => {
                               // Si falla la actualización de un producto, registrar el error y cancelar todo
                               console.error(`[ANULACIÓN ${saleId}] Error al actualizar stock para productId ${productId}:`, updateError);
                               throw updateError;
                           });
                    });
                    // Esperar a que todas las actualizaciones de stock terminen
                    await Promise.all(restoreStockPromises);
                } else {
                     // Si 'productsSold' no fue un array (después del parseo y verificación de null)
                     console.warn(`[ANULACIÓN ${saleId}] 'productosVendidos' no es un array después del parseo. No se restauró stock.`);
                     // Podrías lanzar un error aquí si esto no debería pasar
                     // throw new Error(`'productosVendidos' no es un array válido para la venta ${saleId}.`);
                }

                // Si todo fue bien, confirmar la transacción
                await client.query('COMMIT');
                return {
                    statusCode: 200, // OK
                    headers,
                    body: JSON.stringify({ status: 'success', message: `Venta ${saleId} anulada y stock restaurado.` }),
                };

            } catch (transactionError) {
                // Si algo falló (venta no encontrada, ya anulada, error de parseo, error al actualizar stock), revertir
                await client.query('ROLLBACK');
                console.error(`[ANULACIÓN ${saleId}] Error en transacción, ROLLBACK ejecutado:`, transactionError);
                 // Devolver un mensaje más específico si es posible
                 const userFriendlyMessage = transactionError.message.includes("ya ha sido anulada") || transactionError.message.includes("no encontrada") || transactionError.message.includes("Formato de productos inválido")
                    ? transactionError.message // Usar nuestro mensaje específico
                    : 'Error al intentar anular la venta.'; // Mensaje genérico
                return {
                    statusCode: 500, // Internal Server Error (o 404, 409 según el caso)
                    headers,
                    body: JSON.stringify({ status: 'error', message: userFriendlyMessage, details: transactionError.message }),
                };
            }
        }

        // Si el método HTTP no es GET, POST o PUT, retornar error
        return {
            statusCode: 405, // Method Not Allowed
            headers,
            body: JSON.stringify({ status: 'error', message: 'Método no permitido' }),
        };

    } catch (error) {
        // Capturar cualquier error inesperado general
        console.error('Error general en la función sales:', error);
        return {
            statusCode: 500, // Internal Server Error
            headers,
            body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message }),
        };
    } finally {
        // Asegurarse de liberar siempre el cliente de base de datos al pool
        if (client) {
            client.release();
        }
    }
};

