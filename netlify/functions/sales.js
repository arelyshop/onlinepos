// netlify/functions/sales.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/*
  IMPORTANTE: Antes de usar esta función, necesitas crear las tablas de ventas en tu base de datos de Neon.
  Aquí tienes el código SQL que puedes ejecutar:

  -- Tabla para almacenar la información principal de cada venta
  CREATE TABLE sales (
      sale_id VARCHAR(50) PRIMARY KEY,
      customer_name VARCHAR(255),
      customer_contact VARCHAR(100),
      customer_id VARCHAR(100),
      total NUMERIC(10, 2) NOT NULL,
      status VARCHAR(50) DEFAULT 'Completada', -- Puede ser 'Completada' o 'Anulada'
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  -- Tabla para almacenar los productos específicos de cada venta
  CREATE TABLE sale_items (
      id SERIAL PRIMARY KEY,
      sale_id VARCHAR(50) REFERENCES sales(sale_id),
      product_sku VARCHAR(100),
      product_name VARCHAR(255),
      quantity INT NOT NULL,
      price NUMERIC(10, 2) NOT NULL,
      purchase_price NUMERIC(10, 2)
  );
*/


exports.handler = async (event, context) => {
  const client = await pool.connect();
  const path = event.path.replace('/.netlify/functions/sales', '');
  const method = event.httpMethod;

  try {
    // ---- OBTENER TODAS LAS VENTAS ----
    if (method === 'GET') {
        const { rows: salesRows } = await client.query(`
            SELECT 
                s.sale_id as "saleId",
                s.customer_name as "nombreCliente",
                s.customer_contact as "contacto",
                s.customer_id as "nitCi",
                s.total as "totalVenta",
                s.status as "estado",
                s.created_at as "fechaVenta",
                json_agg(json_build_object(
                    'Nombre', si.product_name,
                    'SKU', si.product_sku,
                    'cantidad', si.quantity,
                    'precio', si.price,
                    'Precio (Compra)', si.purchase_price
                )) as "productosVendidos"
            FROM sales s
            LEFT JOIN sale_items si ON s.sale_id = si.sale_id
            GROUP BY s.sale_id
            ORDER BY s.created_at DESC
        `);
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'success', data: salesRows }),
        };
    }

    // ---- CREAR UNA NUEVA VENTA ----
    if (method === 'POST') {
        const { data: saleData } = JSON.parse(event.body);
        const { customer, items, total } = saleData;

        await client.query('BEGIN'); // Iniciar transacción

        // 1. Obtener el último ID de venta para generar el siguiente
        const lastSaleResult = await client.query("SELECT sale_id FROM sales ORDER BY created_at DESC LIMIT 1");
        let nextIdNumber = 1;
        if (lastSaleResult.rows.length > 0) {
            const lastId = lastSaleResult.rows[0].sale_id;
            const lastNumber = parseInt(lastId.replace('AS', ''), 10);
            if (!isNaN(lastNumber)) {
                nextIdNumber = lastNumber + 1;
            }
        }
        const newSaleId = `AS${nextIdNumber}`;
        
        // 2. Insertar la venta en la tabla 'sales'
        await client.query(
            'INSERT INTO sales (sale_id, customer_name, customer_contact, customer_id, total) VALUES ($1, $2, $3, $4, $5)',
            [newSaleId, customer.name, customer.contact, customer.id, total]
        );

        // 3. Insertar cada producto en 'sale_items' y actualizar el stock en 'products'
        for (const item of items) {
            await client.query(
                'INSERT INTO sale_items (sale_id, product_sku, product_name, quantity, price, purchase_price) VALUES ($1, $2, $3, $4, $5, $6)',
                [newSaleId, item.SKU, item.Nombre, item.cantidad, item.precio, item['Precio (Compra)']]
            );
            await client.query(
                'UPDATE products SET stock = stock - $1 WHERE sku = $2',
                [item.cantidad, item.SKU]
            );
        }

        await client.query('COMMIT'); // Finalizar transacción
        return {
            statusCode: 201,
            body: JSON.stringify({ status: 'success', message: 'Venta registrada con éxito.', saleId: newSaleId }),
        };
    }
    
    // ---- ANULAR UNA VENTA ----
    if (method === 'PUT' && path === '/annul') {
        const { data } = JSON.parse(event.body);
        const { saleId } = data;

        await client.query('BEGIN'); // Iniciar transacción
        
        // 1. Verificar que la venta exista y no esté ya anulada
        const saleResult = await client.query('SELECT * FROM sales WHERE sale_id = $1', [saleId]);
        if (saleResult.rows.length === 0 || saleResult.rows[0].status === 'Anulada') {
            await client.query('ROLLBACK');
            return {
                statusCode: 404,
                body: JSON.stringify({ status: 'error', message: 'La venta no existe o ya ha sido anulada.' }),
            };
        }
        
        // 2. Actualizar el estado de la venta a 'Anulada'
        await client.query("UPDATE sales SET status = 'Anulada' WHERE sale_id = $1", [saleId]);

        // 3. Obtener los productos de la venta para restaurar el stock
        const { rows: itemsToRestore } = await client.query('SELECT product_sku, quantity FROM sale_items WHERE sale_id = $1', [saleId]);
        
        // 4. Restaurar el stock de cada producto
        for (const item of itemsToRestore) {
            await client.query(
                'UPDATE products SET stock = stock + $1 WHERE sku = $2',
                [item.quantity, item.product_sku]
            );
        }
        
        await client.query('COMMIT'); // Finalizar transacción
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'success', message: `Venta ${saleId} anulada con éxito. Stock restaurado.` }),
        };
    }

    return {
      statusCode: 405,
      body: JSON.stringify({ status: 'error', message: 'Método no permitido o ruta no encontrada.' }),
    };

  } catch (error) {
    await client.query('ROLLBACK'); // Revertir transacción en caso de error
    console.error('Error en la transacción:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.', details: error.message }),
    };
  } finally {
    client.release();
  }
};
