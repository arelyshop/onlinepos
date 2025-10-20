// netlify/functions/sales.js
const { Pool } = require('pg');

// Configuración de la conexión a la base de datos de Neon
// Se añade la configuración SSL requerida por Neon.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

/*
-- SQL para crear las tablas necesarias en tu base de datos de Neon (PostgreSQL):

-- Tabla para almacenar las ventas generales
CREATE TABLE sales (
    id SERIAL PRIMARY KEY,
    sale_id VARCHAR(50) UNIQUE NOT NULL,
    customer_name VARCHAR(255),
    customer_contact VARCHAR(100),
    customer_nit_ci VARCHAR(100),
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'Completada', -- Puede ser 'Completada' o 'Anulada'
    sale_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para almacenar los productos de cada venta
CREATE TABLE sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INT NOT NULL REFERENCES sales(id),
    product_sku VARCHAR(100),
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    purchase_price NUMERIC(10, 2) -- Precio de compra en el momento de la venta
);

*/


exports.handler = async (event, context) => {
    const client = await pool.connect();
    
    try {
        const httpMethod = event.httpMethod;

        if (httpMethod === 'GET') {
            const result = await client.query(`
                SELECT 
                    s.sale_id as "saleId",
                    s.customer_name as "nombreCliente",
                    s.customer_contact as "contacto",
                    s.customer_nit_ci as "nitCi",
                    s.total_amount as "totalVenta",
                    s.status as "estado",
                    s.sale_date as "fechaVenta",
                    json_agg(json_build_object(
                        'Nombre', si.product_name,
                        'SKU', si.product_sku,
                        'cantidad', si.quantity,
                        'precio', si.price,
                        'Precio (Compra)', si.purchase_price
                    )) as "productosVendidos"
                FROM sales s
                JOIN sale_items si ON s.id = si.sale_id
                GROUP BY s.id
                ORDER BY s.sale_date DESC;
            `);
            return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'success', data: result.rows }) };
        } else if (httpMethod === 'POST') {
            const { data } = JSON.parse(event.body);
            
            await client.query('BEGIN');

            const lastSaleResult = await client.query("SELECT sale_id FROM sales ORDER BY id DESC LIMIT 1;");
            let nextIdNumber = 1;
            if (lastSaleResult.rows.length > 0) {
                const lastId = lastSaleResult.rows[0].sale_id;
                nextIdNumber = parseInt(lastId.substring(2)) + 1;
            }
            const newSaleId = 'AS' + nextIdNumber;

            const saleInsertQuery = `
                INSERT INTO sales (sale_id, customer_name, customer_contact, customer_nit_ci, total_amount)
                VALUES ($1, $2, $3, $4, $5) RETURNING id;
            `;
            const saleValues = [newSaleId, data.customer.name, data.customer.contact, data.customer.id, data.total];
            const saleResult = await client.query(saleInsertQuery, saleValues);
            const saleDbId = saleResult.rows[0].id;

            for (const item of data.items) {
                const itemInsertQuery = `
                    INSERT INTO sale_items (sale_id, product_sku, product_name, quantity, price, purchase_price)
                    VALUES ($1, $2, $3, $4, $5, $6);
                `;
                const itemValues = [saleDbId, item.SKU, item.Nombre, item.cantidad, item.precio, item['Precio (Compra)']];
                await client.query(itemInsertQuery, itemValues);

                const updateStockQuery = `
                    UPDATE products SET stock = stock - $1 WHERE sku = $2;
                `;
                await client.query(updateStockQuery, [item.cantidad, item.SKU]);
            }

            await client.query('COMMIT');
            return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'success', saleId: newSaleId }) };

        } else if (event.path.includes('/annul') && httpMethod === 'PUT') {
            const { data } = JSON.parse(event.body);
            const { saleId } = data;

            await client.query('BEGIN');

            const saleResult = await client.query('SELECT id, status FROM sales WHERE sale_id = $1', [saleId]);
            if (saleResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return { statusCode: 404, body: JSON.stringify({ status: 'error', message: 'Venta no encontrada.' }) };
            }
            if (saleResult.rows[0].status === 'Anulada') {
                await client.query('ROLLBACK');
                return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'La venta ya ha sido anulada.' }) };
            }
            
            const saleDbId = saleResult.rows[0].id;
            const itemsResult = await client.query('SELECT product_sku, quantity FROM sale_items WHERE sale_id = $1', [saleDbId]);
            
            for (const item of itemsResult.rows) {
                await client.query('UPDATE products SET stock = stock + $1 WHERE sku = $2', [item.quantity, item.product_sku]);
            }

            await client.query("UPDATE sales SET status = 'Anulada' WHERE id = $1", [saleDbId]);
            
            await client.query('COMMIT');
            return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'success', message: `Venta ${saleId} anulada y stock restaurado.` }) };

        } else {
            return { statusCode: 405, body: 'Method Not Allowed' };
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en la función de sales:', error);
        return { statusCode: 500, body: JSON.stringify({ status: 'error', message: error.message }) };
    } finally {
        client.release();
    }
};

