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
                    if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) { // Añadida validación quantity > 0
                        throw new Error(`Datos de producto inválidos en la venta: ${item.Nombre || 'Desconocido'} (ID: ${item.productId}, Cant: ${item.cantidad})`);
                    }
                    return client.query(updateQuery, [quantity, productId]);
                });

                const updateResults = await Promise.all(updateStockPromises);

                // Verificar si alguna actualización de stock falló (ej. stock insuficiente)
                for (let i = 0; i < updateResults.length; i++) {
                    if (updateResults[i].rowCount === 0) {
                        const failedItem = saleData.items[i];
                        const productCheck = await client.query('SELECT name, stock FROM products WHERE id = $1', [failedItem.productId]);
                        const productName = productCheck.rows.length > 0 ? productCheck.rows[0].name : `ID ${failedItem.productId}`;
                        const currentStock = productCheck.rows.length > 0 ? productCheck.rows[0].stock : 'desconocido';
                        throw new Error(`Stock insuficiente para el producto: "${productName}". Stock actual: ${currentStock}, se intentó vender: ${failedItem.cantidad}.`);
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
                // Devolver el mensaje de error específico si es una validación nuestra
                const specificErrorMessages = ["Datos de producto inválidos", "Stock insuficiente"];
                const errorMessage = specificErrorMessages.some(msg => transactionError.message.includes(msg))
                    ? transactionError.message
                    : 'Error general al procesar la venta.';

                return {
                    statusCode: 500, // Usar 400 Bad Request si es error de datos? Podría ser. Dejemos 500 por ahora.
                    headers,
                    body: JSON.stringify({ status: 'error', message: errorMessage, details: transactionError.message }),
                };
            }
        }

        // --- ANULAR VENTA (Depuración Mejorada) ---
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
                const getSaleQuery = 'SELECT * FROM sales WHERE "saleId" = $1 FOR UPDATE'; // Bloquear la fila para evitar concurrencia
                const saleResult = await client.query(getSaleQuery, [saleId]);

                if (saleResult.rows.length === 0) {
                    throw new Error(`Venta con ID "${saleId}" no encontrada.`);
                }
                const sale = saleResult.rows[0];
                if (sale.estado === 'Anulada') {
                    throw new Error(`La venta "${saleId}" ya ha sido anulada previamente.`);
                }

                 // 2. Marcar la venta como Anulada
                 const annulQuery = 'UPDATE sales SET estado = $1 WHERE "saleId" = $2';
                 await client.query(annulQuery, ['Anulada', saleId]);

                // 3. Restaurar stock de los productos
                let productsSold;
                try {
                    // Validar si productosVendidos es null o undefined antes de parsear
                    if (sale.productosVendidos == null) {
                         console.warn(`'productosVendidos' es null o undefined para la venta ${saleId}. No se restaurará stock.`);
                         productsSold = []; // Tratar como si no hubiera productos
                    } else {
                        productsSold = JSON.parse(sale.productosVendidos);
                    }
                } catch (parseError) {
                     console.error(`Error parseando 'productosVendidos' para la venta ${saleId}:`, parseError);
                     throw new Error(`Formato de productos inválido en la venta ${saleId}. No se pudo restaurar stock.`);
                }


                if (Array.isArray(productsSold)) {
                    const restoreStockPromises = productsSold.map(item => {
                         // Validaciones más estrictas antes de ejecutar la query
                         if (!item || typeof item !== 'object') {
                              console.warn(`Item inválido (no es objeto) encontrado al anular venta ${saleId}:`, item);
                              return Promise.resolve(); // Saltar item
                         }
                         const quantity = parseInt(item.cantidad, 10);
                         const productId = parseInt(item.productId, 10);

                         if (isNaN(quantity) || quantity <= 0 || isNaN(productId)) {
                             console.warn(`Datos de producto inválidos (cantidad o ID) encontrados al anular venta ${saleId}:`, item);
                             // Considerar lanzar un error aquí si es crítico que TODOS los stocks se restauren
                             // throw new Error(`Datos inválidos para producto ${item.Nombre || item.productId} en venta ${saleId}`);
                             return Promise.resolve(); // O saltar este item problemático
                         }

                         const restoreQuery = 'UPDATE products SET stock = stock + $1 WHERE id = $2';
                         return client.query(restoreQuery, [quantity, productId]);
                    });
                    await Promise.all(restoreStockPromises);
                } else {
                     // Esto no debería ocurrir si el parseo fue exitoso y no era null/undefined, pero por si acaso.
                     console.warn(`No se pudo restaurar stock para la venta ${saleId} porque 'productosVendidos' no es un array válido después del parseo.`);
                     // Podrías lanzar un error aquí si consideras esto crítico
                     // throw new Error(`'productosVendidos' no es un array válido para la venta ${saleId}.`);
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
                 // Devolver un mensaje más específico si es posible
                 const userFriendlyMessage = transactionError.message.includes("ya ha sido anulada") || transactionError.message.includes("no encontrada") || transactionError.message.includes("Formato de productos inválido")
                    ? transactionError.message
                    : 'Error al intentar anular la venta.';
                return {
                    statusCode: 500, // O 404 si no se encontró, 409 si ya estaba anulada?
                    headers,
                    body: JSON.stringify({ status: 'error', message: userFriendlyMessage, details: transactionError.message }), // Pasar el mensaje original en details
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

