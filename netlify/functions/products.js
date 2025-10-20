// netlify/functions/products.js
const { Pool } = require('pg');

// Configuración de la conexión a la base de datos de Neon
// Se añade la configuración SSL requerida por Neon.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Mapeo de nombres de columnas de la base de datos a los nombres de campo del frontend
const mapToFrontend = (product) => ({
    nombre: product.name,
    sku: product.sku,
    descripcion: product.description,
    precioVenta: product.sale_price,
    precioCompra: product.purchase_price,
    precioMayoreo: product.wholesale_price,
    cantidad: product.stock,
    codigoBarras: product.barcode,
    ciudadSucursal: product.ciudad_sucursal,
    urlFoto1: product.photo_url_1
});

// Mapeo de nombres de campos del frontend a los nombres de columnas de la base de datos
const mapToBackend = (productData) => ({
    name: productData.name,
    sku: productData.sku,
    description: productData.description,
    sale_price: productData.sale_price,
    purchase_price: productData.purchase_price,
    wholesale_price: productData.wholesale_price,
    stock: productData.stock,
    barcode: productData.barcode,
    ciudad_sucursal: productData.ciudad_sucursal,
    photo_url_1: productData.photo_url_1
});

exports.handler = async (event, context) => {
    const httpMethod = event.httpMethod;
    const client = await pool.connect();

    try {
        if (httpMethod === 'GET') {
            const result = await client.query('SELECT * FROM products ORDER BY created_at DESC');
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'success', data: result.rows }),
            };
        } else if (httpMethod === 'POST') {
            const { data } = JSON.parse(event.body);
            const p = mapToBackend(data);
            
            const query = `
                INSERT INTO products(name, sku, description, sale_price, purchase_price, wholesale_price, stock, barcode, ciudad_sucursal, photo_url_1)
                VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *;
            `;
            const values = [p.name, p.sku, p.description, p.sale_price, p.purchase_price, p.wholesale_price, p.stock, p.barcode, p.ciudad_sucursal, p.photo_url_1];
            
            const result = await client.query(query, values);
            
            return {
                statusCode: 201,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'success', data: result.rows[0] }),
            };

        } else if (httpMethod === 'PUT') {
            const { data } = JSON.parse(event.body);
            const p = mapToBackend(data);

            const query = `
                UPDATE products
                SET name = $1, sku = $2, description = $3, sale_price = $4, purchase_price = $5, wholesale_price = $6, stock = $7, barcode = $8, ciudad_sucursal = $9, photo_url_1 = $10
                WHERE sku = $11
                RETURNING *;
            `;
            const values = [p.name, p.sku, p.description, p.sale_price, p.purchase_price, p.wholesale_price, p.stock, p.barcode, p.ciudad_sucursal, p.photo_url_1, data.originalSku];

            const result = await client.query(query, values);
            if (result.rows.length === 0) {
                 return { statusCode: 404, body: JSON.stringify({ status: 'error', message: 'Producto no encontrado.' }) };
            }

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'success', data: result.rows[0] }),
            };
        } else {
            return { statusCode: 405, body: 'Method Not Allowed' };
        }
    } catch (error) {
        console.error('Error en la función de products:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ status: 'error', message: error.message }),
        };
    } finally {
        client.release();
    }
};

