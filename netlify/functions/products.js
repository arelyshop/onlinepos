// netlify/functions/products.js

const { Pool } = require('pg');

// Configura la conexión a tu base de datos de Neon (PostgreSQL).
// DEBES configurar la variable de entorno DATABASE_URL en la configuración de tu sitio de Netlify.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

exports.handler = async (event, context) => {
  const client = await pool.connect();
  const method = event.httpMethod;

  try {
    switch (method) {
      case 'GET':
        // Obtener todos los productos
        const { rows } = await client.query('SELECT * FROM products ORDER BY name ASC');
        return {
          statusCode: 200,
          body: JSON.stringify({ status: 'success', data: rows }),
        };

      case 'POST':
        // Crear un nuevo producto
        const { data: newProduct } = JSON.parse(event.body);
        const { name, sku, sale_price, purchase_price, wholesale_price, stock, barcode, photo_url_1 } = newProduct;
        
        await client.query(
          'INSERT INTO products (name, sku, sale_price, purchase_price, wholesale_price, stock, barcode, photo_url_1) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [name, sku, sale_price, purchase_price, wholesale_price, stock, barcode, photo_url_1]
        );
        return {
          statusCode: 201,
          body: JSON.stringify({ status: 'success', message: 'Producto creado con éxito.' }),
        };
        
      case 'PUT':
        // Actualizar un producto existente
        const { data: updatedProduct } = JSON.parse(event.body);
        const { name: uName, sku: uSku, sale_price: uSalePrice, purchase_price: uPurchasePrice, wholesale_price: uWholesalePrice, stock: uStock, barcode: uBarcode, photo_url_1: uPhotoUrl, originalSku } = updatedProduct;

        // Es importante usar el SKU original para encontrar el producto a actualizar.
        if (!originalSku) {
          return {
            statusCode: 400,
            body: JSON.stringify({ status: 'error', message: 'El SKU original es requerido para actualizar.' }),
          };
        }

        await client.query(
          'UPDATE products SET name = $1, sku = $2, sale_price = $3, purchase_price = $4, wholesale_price = $5, stock = $6, barcode = $7, photo_url_1 = $8 WHERE sku = $9',
          [uName, uSku, uSalePrice, uPurchasePrice, uWholesalePrice, uStock, uBarcode, uPhotoUrl, originalSku]
        );
        return {
          statusCode: 200,
          body: JSON.stringify({ status: 'success', message: 'Producto actualizado con éxito.' }),
        };

      default:
        return {
          statusCode: 405,
          body: JSON.stringify({ status: 'error', message: 'Método no permitido.' }),
        };
    }
  } catch (error) {
    console.error('Error en la base de datos:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: 'Error interno del servidor.' }),
    };
  } finally {
    client.release();
  }
};
