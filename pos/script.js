// --- GLOBAL APP STATE ---
const API_BASE_URL = '/.netlify/functions';

let products = [];
let sales = [];
let cart = [];
let preloadedLogo = null;
let preloadedPdfQr = null;
let html5QrCode = null;
let currentPdfBlob = null;
let currentPdfFileName = '';
let currentUser = null;
let saleIdToAnnul = null;
// let currentPdfViewerUrl = null; // No longer needed for summary

// --- AUTHENTICATION & INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('current-year').textContent = new Date().getFullYear();
    try {
         html5QrCode = new Html5Qrcode("reader");
    } catch (e) {
         console.error("Error inicializando Html5Qrcode:", e);
    }
    setupLoginListener();
    checkAuth();
    document.getElementById('logout-button').addEventListener('click', logout);
});

function setupLoginListener() {
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    const loginButton = document.getElementById('login-button');
    const buttonText = document.getElementById('login-button-text');
    const loader = document.getElementById('login-loader');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.textContent = '';
        buttonText.classList.add('hidden');
        loader.classList.remove('hidden');
        loginButton.disabled = true;

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            // Usar fetch normal, NO robustFetch aquí
            const response = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            // Parsear respuesta independientemente del status code
            let result;
            try {
                result = await response.json();
            } catch (jsonError) {
                 // Si la respuesta no es JSON (ej. error 502 HTML)
                 console.error("Respuesta del login no es JSON:", response.status, response.statusText);
                 throw new Error(`Error ${response.status}: ${response.statusText || 'Respuesta inválida del servidor'}`); // Usar statusText o mensaje genérico
            }


            if (response.ok && result.status === 'success') {
                sessionStorage.setItem('arelyShopUser', JSON.stringify(result.user));
                currentUser = result.user;
                initializeApp();
            } else {
                // Usar mensaje del backend si existe, si no, mensaje genérico
                errorMessage.textContent = result.message || 'Credenciales incorrectas o error del servidor.';
            }
        } catch (error) {
            // Captura errores de red (fetch falló) o errores de parseo/status
            console.error('Error en el proceso de login:', error);
            errorMessage.textContent = error.message.includes('Failed to fetch') || error.message.includes('Load failed') ? 'No se pudo conectar al servidor. Revisa tu conexión.' : error.message; // Mensaje más específico para error de red
        } finally {
            buttonText.classList.remove('hidden');
            loader.classList.add('hidden');
            loginButton.disabled = false;
        }
    });
}


function checkAuth() {
    const userString = sessionStorage.getItem('arelyShopUser');
    if (userString) {
        try {
            currentUser = JSON.parse(userString);
            // Validar si currentUser tiene las propiedades esperadas
            if (currentUser && currentUser.id && currentUser.username) {
                initializeApp();
            } else {
                console.warn("Datos de usuario en sessionStorage inválidos. Limpiando.");
                logout(); // Limpiar sesión si los datos no son válidos
            }
        } catch (e) {
            console.error("Error parseando datos de usuario desde sessionStorage:", e);
            logout(); // Limpiar sesión si hay error de parseo
        }
    } else {
         // Asegurarse que el panel esté oculto si no hay sesión
        const appContainer = document.getElementById('app-container');
        if (appContainer) appContainer.classList.add('hidden');
        const loginContainer = document.getElementById('login-container');
        if (loginContainer) loginContainer.classList.remove('hidden'); // Mostrar login
    }
}


function logout() {
    sessionStorage.removeItem('arelyShopUser');
    currentUser = null;
    products = [];
    sales = [];
    cart = [];

     // Ocultar app, mostrar login
     const appContainer = document.getElementById('app-container');
     if (appContainer) appContainer.classList.add('hidden');
     const loginContainer = document.getElementById('login-container');
     if (loginContainer) loginContainer.classList.remove('hidden');


    // Resetear UI (asegurándose que los elementos existen)
     const cartItemsEl = document.getElementById('cart-items');
     if(cartItemsEl) cartItemsEl.innerHTML = '<tr id="empty-cart-row"><td colspan="6" class="text-center py-8 text-gray-500">El carrito está vacío</td></tr>';
     const salesResultsEl = document.getElementById('sales-results-container');
     if(salesResultsEl) salesResultsEl.innerHTML = '';
     const customerFormEl = document.getElementById('customer-form');
     if(customerFormEl) customerFormEl.reset();
    updateTotal(); // Llama a updateTotal para resetear botones si es necesario
     // Considerar no recargar si el manejo de estado es robusto
     // window.location.reload();
}

async function initializeApp() {
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('app-container').classList.add('flex');

    document.getElementById('user-fullname').textContent = currentUser.full_name || 'Usuario';
    document.getElementById('user-role').textContent = currentUser.role || 'Rol';

    initTabs();
    setupEventListeners();
    updateDateTime();
    setInterval(updateDateTime, 60000); // Actualizar fecha cada minuto es suficiente

    // Mostrar "Cargando..." mientras se obtienen los datos
    const salesContainer = document.getElementById('sales-results-container');
    if (salesContainer) salesContainer.innerHTML = '<p class="text-gray-500 text-center">Cargando ventas...</p>';
    const productSearch = document.getElementById('search-product');
    if (productSearch) productSearch.disabled = true; // Deshabilitar búsqueda mientras cargan productos


    try {
        await Promise.all([
            fetchProducts(),
            loadImageAsPngDataUrl('/images/logo-escritorio.svg').then(logo => preloadedLogo = logo),
            loadImageAsJpegDataUrl('/images/qr-pdf.webp').then(qr => preloadedPdfQr = qr)
        ]);
        await fetchSales(); // Cargar ventas después

        renderSalesResults();
        displayNextSaleId();
    } catch (error) {
         console.error("Error durante la inicialización (carga de datos):", error);
         // Mostrar error general si falla la carga inicial
         showNotification(`Error al cargar datos iniciales: ${error.message}. Intenta recargar.`, 'error');
    } finally {
         if (productSearch) productSearch.disabled = false; // Habilitar búsqueda al terminar (o fallar)
    }
}

function updateDateTime() {
    const now = new Date();
    const dateOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
     const dateEl = document.getElementById('current-date');
     if (dateEl) dateEl.textContent = now.toLocaleDateString('es-ES', dateOptions);
}

// --- Fetch Simplificado y Manejo de Errores ---
async function simpleFetch(url, options) {
    let response; // Declarar fuera para usar en catch
    try {
        response = await fetch(url, options);

        // Intentar obtener el cuerpo para logs/errores
        let responseBodyText = null;
        try {
            responseBodyText = await response.text();
        } catch (bodyError) {
            console.warn(`No se pudo leer el cuerpo de la respuesta desde ${url} (status ${response.status}):`, bodyError);
             // Si el status es OK pero no hay cuerpo, puede ser normal (ej. 204)
             if (response.ok && response.status !== 204) {
                 throw new Error("Respuesta exitosa pero cuerpo ilegible.");
             }
             // Si no es OK y no hay cuerpo, usar statusText
             if (!response.ok) {
                  throw new Error(`Error HTTP ${response.status}: ${response.statusText || 'Sin mensaje'}`);
             }
        }

        // Si la respuesta NO fue OK (status >= 400)
        if (!response.ok) {
            let errorData = { message: `Error HTTP ${response.status}: ${response.statusText || 'Error desconocido'}` };
            if (responseBodyText) {
                try {
                    const parsedBody = JSON.parse(responseBodyText);
                    errorData.message = parsedBody.message || parsedBody.error || errorData.message;
                    errorData.details = parsedBody.details;
                } catch (parseError) {
                    if (responseBodyText.trim().length > 0) {
                        errorData.message = responseBodyText; // Usar texto plano si no es JSON
                    }
                }
            }
            console.error(`Error en fetch a ${url}:`, errorData);
            throw new Error(errorData.message); // Lanzar error con mensaje descriptivo
        }

        // Si la respuesta fue OK (status 2xx)
        // Si es 204 No Content, devolver éxito sin datos
        if (response.status === 204) {
             return { status: 'success', message: 'Operación exitosa sin contenido.' };
        }

        // Intentar parsear como JSON (si leímos texto antes, usarlo)
        try {
            const jsonData = responseBodyText ? JSON.parse(responseBodyText) : await response.json(); // .json() puede fallar si ya leímos text()
            // Asegurarse de que la respuesta tenga una estructura esperada (ej. {status: 'success', ...})
            if (typeof jsonData === 'object' && jsonData !== null /*&& jsonData.hasOwnProperty('status')*/) {
                 return jsonData;
            } else {
                 console.warn(`Respuesta JSON inesperada desde ${url}:`, jsonData);
                 throw new Error("Formato de respuesta JSON inesperado.");
            }
        } catch (jsonError) {
             console.error(`Respuesta OK pero no es JSON válido desde ${url}:`, jsonError, responseBodyText);
             throw new Error("Respuesta inválida del servidor (no es JSON).");
        }

    } catch (networkOrProcessingError) {
        // Captura errores de red (fetch falló), errores lanzados arriba, etc.
        console.error(`Error durante fetch a ${url}:`, networkOrProcessingError);
        // Lanzar un error consistente
        throw new Error(networkOrProcessingError.message || 'Error de conexión con el servidor.');
    }
}


function showNotification(message, type) {
    const banner = document.getElementById('notification-banner');
    const messageSpan = document.getElementById('notification-message');
     // Verificar si existen los elementos
     if (!banner || !messageSpan) {
          console.warn("Elementos de notificación no encontrados. Mensaje:", message);
          // Considerar alert como fallback extremo si las notificaciones son críticas
          // alert(`${type === 'success' ? 'Éxito' : 'Error'}: ${message}`);
          return;
     }
    messageSpan.textContent = message;
    // Resetear clases antes de añadir nuevas
    banner.className = 'fixed top-0 left-0 right-0 p-4 text-white text-center z-50 transition-transform duration-500 ease-in-out transform -translate-y-full';
    // Forzar reflow para reiniciar la animación si es necesario
    void banner.offsetWidth;
    // Añadir clase de color y clase para mostrar
    banner.classList.add(type === 'success' ? 'bg-green-600' : 'bg-red-600');
    banner.style.transform = 'translateY(0)'; // Mostrar

    clearTimeout(banner.timeoutId);
    banner.timeoutId = setTimeout(() => {
        banner.style.transform = 'translateY(-100%)'; // Ocultar
    }, 4000);
}

const loadImageAsPngDataUrl = (url) => new Promise((resolve) => {
     if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve({dataURL: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight});
    };
    img.onerror = (e) => {
         console.error("Error cargando imagen PNG:", url, e);
         resolve(null);
    }
     // Añadir timestamp solo si no es ya una URL de datos
     img.src = url.startsWith('data:') ? url : (url + (url.includes('?') ? '&' : '?') + Date.now());
});

const loadImageAsJpegDataUrl = (url) => new Promise((resolve) => {
     if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
         // Rellenar fondo blanco para JPEGs que puedan tener transparencia convertida
         ctx.fillStyle = '#FFFFFF';
         ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve({dataURL: canvas.toDataURL('image/jpeg', 0.8), width: img.naturalWidth, height: img.naturalHeight});
    };
    img.onerror = (e) => {
         console.error("Error cargando imagen JPEG:", url, e);
         resolve(null);
    }
     img.src = url.startsWith('data:') ? url : (url + (url.includes('?') ? '&' : '?') + Date.now());
});

function initTabs() {
    const tabs = {
        pos: { btn: document.getElementById('tab-pos'), content: document.getElementById('content-pos') },
        salesRegistry: { btn: document.getElementById('tab-sales-registry'), content: document.getElementById('content-sales-registry') }
    };

    Object.keys(tabs).forEach(key => {
         if(tabs[key].btn) {
            tabs[key].btn.addEventListener('click', () => {
                Object.values(tabs).forEach(t => {
                    if(t.btn) t.btn.classList.remove('tab-active', 'tab-inactive'); // Limpiar ambas
                    if(t.btn) t.btn.classList.add('tab-inactive'); // Poner inactivo por defecto
                    if(t.content) t.content.style.display = 'none';
                });
                tabs[key].btn.classList.remove('tab-inactive'); // Quitar inactivo
                tabs[key].btn.classList.add('tab-active'); // Poner activo
                if(tabs[key].content) tabs[key].content.style.display = 'block';
                if (key === 'salesRegistry') renderSalesResults();
            });
         }
    });
     if(tabs.pos.btn) tabs.pos.btn.classList.add('tab-active');
     if(tabs.pos.btn) tabs.pos.btn.classList.remove('tab-inactive');
     if(tabs.pos.content) tabs.pos.content.style.display = 'block';
     if(tabs.salesRegistry.content) tabs.salesRegistry.content.style.display = 'none';
}


function setupEventListeners() {
    // --- General ---
     const logoutBtn = document.getElementById('logout-button');
     if(logoutBtn) logoutBtn.addEventListener('click', logout); // Mover aquí para asegurar que exista

    // --- POS Tab ---
    const searchInput = document.getElementById('search-product');
    if (searchInput) { searchInput.addEventListener('input', handleSearch); searchInput.addEventListener('keydown', handleBarcodeScan); }
    const completeSaleBtn = document.getElementById('complete-sale-button');
    if(completeSaleBtn) completeSaleBtn.addEventListener('click', completeSale);
    const generateQuoteBtn = document.getElementById('generate-quote-button');
    if(generateQuoteBtn) generateQuoteBtn.addEventListener('click', handleGenerateQuote);
    const cartItemsEl = document.getElementById('cart-items');
    if(cartItemsEl) {
        cartItemsEl.addEventListener('click', (e) => {
            const infoButton = e.target.closest('.info-btn');
            if (infoButton) {
                const cartIndex = infoButton.dataset.cartIndex;
                if (cartIndex !== undefined && cart[parseInt(cartIndex)]) { showProductModal(cart[parseInt(cartIndex)]); }
            }
        });
    }
    const scanPosBtn = document.getElementById('scan-pos-btn');
    if(scanPosBtn) scanPosBtn.addEventListener('click', () => startScanner('search-product'));

    // --- Sales Registry Tab ---
    const searchSalesInput = document.getElementById('search-sales-input');
    if(searchSalesInput) searchSalesInput.addEventListener('input', renderSalesResults);
    const salesResultsContainer = document.getElementById('sales-results-container');
    if(salesResultsContainer) {
        salesResultsContainer.addEventListener('click', (event) => {
            // Delegación para Ver Resumen, Reimprimir, Anular
            const summaryBtn = event.target.closest('.view-summary-btn'); // Usar clase para resumen
            const reprintBtn = event.target.closest('.reprint-btn');
            const annulBtn = event.target.closest('.annul-btn');

            const saleId = summaryBtn?.dataset.saleid || reprintBtn?.dataset.saleid || annulBtn?.dataset.saleid;

            if (summaryBtn && saleId) { showSaleSummaryModal(saleId); } // Llama a la nueva función
            else if (reprintBtn && saleId) { reprintSale(saleId); }
            else if (annulBtn && saleId && !annulBtn.disabled) { openAnnulConfirmModal(saleId); }
        });
    }

    // --- Modals ---
    const closeProductModalBtn = document.getElementById('closeProductModal');
    if(closeProductModalBtn) closeProductModalBtn.addEventListener('click', () => { document.getElementById('productDetailModal')?.classList.add('hidden'); });
    const closeQrModalBtn = document.getElementById('closeQrModal');
    if(closeQrModalBtn) closeQrModalBtn.addEventListener('click', () => { document.getElementById('qrCodeModal')?.classList.add('hidden'); });
    const closeScannerBtn = document.getElementById('close-scanner-btn');
    if(closeScannerBtn) closeScannerBtn.addEventListener('click', stopScanner);
    const cancelAnnulBtn = document.getElementById('cancel-annul-btn');
     if(cancelAnnulBtn) cancelAnnulBtn.addEventListener('click', () => { document.getElementById('annul-confirm-modal')?.classList.add('hidden'); saleIdToAnnul = null; });
    const confirmAnnulBtn = document.getElementById('confirm-annul-btn');
     if(confirmAnnulBtn) confirmAnnulBtn.addEventListener('click', () => { if (saleIdToAnnul) { annulSaleInBackend(saleIdToAnnul); } });
     const closeSummaryModalBtn = document.getElementById('close-summary-modal-btn'); // Botón de cierre para resumen
     if (closeSummaryModalBtn) closeSummaryModalBtn.addEventListener('click', closeSaleSummaryModal);


    // --- Copy Buttons ---
     const copyBtns = document.querySelectorAll('.copy-btn');
     copyBtns.forEach(button => {
        button.addEventListener('click', (e) => {
            const targetId = e.currentTarget.dataset.copyTarget;
            const targetElement = document.getElementById(targetId);
            const textToCopy = targetElement?.textContent || '';
            if (textToCopy) { copyToClipboard(textToCopy, e.currentTarget); }
        });
    });
}


// --- DATA MAPPING ---
const mapProductToFrontend = (p) => {
     if (!p || typeof p !== 'object') {
          console.warn("Intento de mapear un producto inválido:", p);
          return null;
     }
     return {
        id: p.id, nombre: p.name, sku: p.sku, precioVenta: p.sale_price, precioDescuento: p.discount_price,
        precioCompra: p.purchase_price, precioMayoreo: p.wholesale_price, cantidad: p.stock,
        codigoBarras: p.barcode, ciudadSucursal: p.ciudad_sucursal, urlFoto1: p.photo_url_1
    };
};


async function fetchProducts() {
    try {
        const result = await simpleFetch(`${API_BASE_URL}/products`);
         products = (result.status === 'success' && Array.isArray(result.data))
             ? result.data.map(mapProductToFrontend).filter(p => p !== null)
             : [];
         if (result.status !== 'success') {
              throw new Error(result.message || 'Error desconocido al obtener productos');
         }
    } catch (error) {
        console.error("Fallo al cargar productos:", error);
        showNotification(`No se pudieron cargar los productos: ${error.message}`, 'error'); products = [];
    }
}

async function fetchSales() {
    try {
        const result = await simpleFetch(`${API_BASE_URL}/sales`);
        if (result.status === 'success' && Array.isArray(result.data)) {
            sales = result.data.sort((a, b) => new Date(b.fechaVenta) - new Date(a.fechaVenta));
        } else {
             sales = []; if (result.status !== 'success') console.warn("La respuesta de fetchSales no fue exitosa:", result);
        }
    } catch (error) {
        console.error("Fallo al cargar las ventas:", error);
        showNotification(`No se pudieron cargar las ventas: ${error.message}`, 'error'); sales = [];
    }
}


function displayNextSaleId() {
    let nextId = "AS1";
    if (sales.length > 0 && sales[0].saleId) {
         const lastSaleId = sales[0].saleId; const lastIdNumber = parseInt(lastSaleId.substring(2));
        if (!isNaN(lastIdNumber)) nextId = 'AS' + (lastIdNumber + 1);
        else console.warn("El último saleId no tiene formato numérico:", lastSaleId);
    }
    const saleIdElement = document.getElementById('current-sale-id');
    if(saleIdElement) saleIdElement.textContent = nextId;
}


function handleBarcodeScan(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const barcode = e.target.value.trim();
        if (barcode === '') return;
        const foundProduct = products.find(p => p.codigoBarras?.toString() === barcode);
        if (foundProduct) {
            addToCart(foundProduct);
            e.target.value = '';
        } else {
            showNotification('Producto no encontrado con ese código de barras.', 'error');
        }
    }
}

function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    if (searchTerm.length < 2) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
        return;
    }
     const filteredProducts = Array.isArray(products) ? products.filter(p =>
        p?.nombre?.toLowerCase().includes(searchTerm) ||
        p?.sku?.toString().toLowerCase().includes(searchTerm)
    ) : [];

    resultsContainer.classList.remove('hidden');
    resultsContainer.innerHTML = '';
    if (filteredProducts.length > 0) {
        filteredProducts.forEach(p => {
             if (!p) return;
            const div = document.createElement('div');
            div.className = 'p-3 hover:bg-gray-100 cursor-pointer';
            const displayPrice = (p.precioDescuento && parseFloat(p.precioDescuento) > 0)
                                ? parseFloat(p.precioDescuento).toFixed(2)
                                : parseFloat(p.precioVenta || 0).toFixed(2);
            const stock = p.cantidad ?? 0;
            div.textContent = `${p.nombre} (Bs ${displayPrice}) - Stock: ${stock}`;
            div.onclick = () => addToCart(p);
            resultsContainer.appendChild(div);
        });
    } else {
        resultsContainer.innerHTML = '<div class="p-3 text-gray-500">No se encontraron productos</div>';
    }
}


function addToCart(product) {
    if (!product || !product.id) {
         console.error("Intento de añadir producto inválido al carrito:", product);
         return;
    }

    const latestProductInfo = products.find(p => p.id === product.id);

    if (!latestProductInfo || latestProductInfo.cantidad <= 0) {
        showNotification('Este producto no tiene stock disponible.', 'error');
        const searchInput = document.getElementById('search-product');
        if(searchInput) searchInput.value = '';
        const searchResults = document.getElementById('search-results');
        if(searchResults) searchResults.classList.add('hidden');
        return;
    }

    const existingCartItem = cart.find(item => item.id === product.id);

    if (existingCartItem) {
        if (existingCartItem.quantity < latestProductInfo.cantidad) {
            existingCartItem.quantity++;
        } else {
            showNotification(`No se puede añadir más. Stock máximo: ${latestProductInfo.cantidad}`, 'error');
        }
    } else {
        const defaultPrice = (latestProductInfo.precioDescuento && parseFloat(latestProductInfo.precioDescuento) > 0)
                       ? parseFloat(latestProductInfo.precioDescuento)
                       : parseFloat(latestProductInfo.precioVenta || 0);
        cart.push({
             id: latestProductInfo.id,
             nombre: latestProductInfo.nombre,
             sku: latestProductInfo.sku,
             precioVenta: latestProductInfo.precioVenta,
             precioDescuento: latestProductInfo.precioDescuento,
             precioCompra: latestProductInfo.precioCompra,
             precioMayoreo: latestProductInfo.precioMayoreo,
             codigoBarras: latestProductInfo.codigoBarras,
             ciudadSucursal: latestProductInfo.ciudadSucursal,
             urlFoto1: latestProductInfo.urlFoto1,
             quantity: 1,
             customPrice: defaultPrice
         });
    }

    const searchInput = document.getElementById('search-product');
    if(searchInput) searchInput.value = '';
    const searchResults = document.getElementById('search-results');
    if(searchResults) searchResults.classList.add('hidden');
    renderCart();
}


function renderCart() {
    const cartItemsContainer = document.getElementById('cart-items');
     if (!cartItemsContainer) return;

    cartItemsContainer.innerHTML = '';
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<tr id="empty-cart-row"><td colspan="6" class="text-center py-8 text-gray-500">El carrito está vacío</td></tr>';
    } else {
        cart.forEach((item, index) => {
             if (!item || typeof item !== 'object') { console.warn("Item inválido en el carrito:", item); return; }
             const currentProductInfo = products.find(p => p && p.id === item.id);
             const currentStock = currentProductInfo ? (currentProductInfo.cantidad ?? 0) : 0;
            const quantity = item.quantity ?? 0;
            const customPrice = item.customPrice ?? 0;
            const subtotal = quantity * customPrice;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-2 py-3 text-center align-middle">
                    <button class="info-btn text-gray-400 hover:text-blue-600" data-cart-index="${index}">
                        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
                    </button>
                </td>
                <td class="px-4 py-3 text-sm text-gray-800 align-middle">${item.nombre || 'Producto Desconocido'}</td>
                <td class="px-4 py-3 text-sm align-middle"><input type="number" step="0.01" value="${customPrice.toFixed(2)}" onchange="updateItemPrice(${index}, this.value)" class="w-24 text-center border rounded-lg py-1"></td>
                <td class="px-4 py-3 text-sm text-center align-middle"><input type="number" min="0" max="${currentStock}" value="${quantity}" onchange="setQuantity(${index}, this.value)" class="w-20 text-center border rounded-lg py-1"></td>
                <td class="px-4 py-3 text-sm text-right font-medium align-middle">Bs ${subtotal.toFixed(2)}</td>
                <td class="px-2 py-3 text-center align-middle"><button onclick="removeFromCart(${index})" class="text-red-500 hover:text-red-700 font-bold text-xl">&times;</button></td>
            `;
            cartItemsContainer.appendChild(row);
        });
    }
    updateTotal();
}


function updateItemPrice(index, newPrice) {
    if (index >= 0 && index < cart.length) {
         const price = parseFloat(newPrice);
         if (!isNaN(price) && price >= 0) {
             cart[index].customPrice = price;
         } else {
              const productInfo = products.find(p => p && p.id === cart[index].id);
              cart[index].customPrice = (productInfo?.precioDescuento && parseFloat(productInfo.precioDescuento) > 0)
                                       ? parseFloat(productInfo.precioDescuento)
                                       : parseFloat(productInfo?.precioVenta || 0);
         }
         renderCart();
    }
}


function setQuantity(index, newQuantity) {
     if (index < 0 || index >= cart.length) return;
    const cartItem = cart[index];
     if (!cartItem) return;
    const productInStock = products.find(p => p && p.id === cartItem.id);
    const maxStock = productInStock ? (productInStock.cantidad ?? 0) : 0;
    let quantity = parseInt(newQuantity);
    if (isNaN(quantity) || quantity < 0) quantity = 0;
    if (quantity > maxStock) { showNotification(`Stock insuficiente. Máximo: ${maxStock}`, 'error'); quantity = maxStock; }
    if (quantity === 0) cart.splice(index, 1);
    else if(cart[index]) cart[index].quantity = quantity;
    renderCart();
}

function removeFromCart(index) {
    if (index >= 0 && index < cart.length) { cart.splice(index, 1); renderCart(); }
}

function updateTotal() {
    const total = cart.reduce((sum, item) => sum + ((item?.quantity ?? 0) * (item?.customPrice ?? 0)), 0);
     const totalAmountEl = document.getElementById('total-amount');
     if(totalAmountEl) totalAmountEl.textContent = `Bs ${total.toFixed(2)}`;
    const isEmpty = cart.length === 0;
     const completeBtn = document.getElementById('complete-sale-button');
     if(completeBtn) completeBtn.disabled = isEmpty;
     const quoteBtn = document.getElementById('generate-quote-button');
     if(quoteBtn) quoteBtn.disabled = isEmpty;
}


async function completeSale() {
    if (cart.length === 0) return;
    if (!currentUser || !currentUser.id) { showNotification("Error: Sesión inválida.", "error"); logout(); return; }

    const button = document.getElementById('complete-sale-button');
    const buttonText = document.getElementById('sale-button-text');
    const loader = document.getElementById('sale-loader');
     if (!button || !buttonText || !loader) { console.error("Elementos del botón no encontrados."); return; }

    buttonText.classList.add('hidden'); loader.classList.remove('hidden'); button.disabled = true;

    const saleIdEl = document.getElementById('current-sale-id');
    const saleId = saleIdEl ? saleIdEl.textContent : `AS_ERR_${Date.now()}`;

    const saleData = {
        saleId: saleId,
        customer: { name: document.getElementById('customer-name')?.value || '', contact: document.getElementById('customer-contact')?.value || '', id: document.getElementById('customer-id')?.value || '' },
         items: cart.map(item => ({ productId: item.id, Nombre: item.nombre, SKU: item.sku, cantidad: item.quantity, precio: item.customPrice, 'Precio (Compra)': item.precioCompra })).filter(item => item.productId && item.cantidad > 0),
        total: cart.reduce((sum, item) => sum + ((item?.quantity ?? 0) * (item?.customPrice ?? 0)), 0),
        user: { id: currentUser.id, fullName: currentUser.full_name }
    };
     if (saleData.items.length === 0) {
         showNotification("Error: No hay productos válidos.", "error");
         buttonText.classList.remove('hidden'); loader.classList.add('hidden'); button.disabled = false;
         return;
     }

    try {
        const result = await simpleFetch(`${API_BASE_URL}/sales`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(saleData) });
        if (result.status === 'success' && result.data?.saleId) {
            const { pdfBlob, fileName } = generateSalePDF(result.data.saleId, saleData);
            showShareOptions(pdfBlob, fileName, 'Venta Completada', 'Venta guardada y PDF generado.');
            await Promise.all([fetchProducts(), fetchSales()]);
            cart = []; renderCart(); const customerForm = document.getElementById('customer-form'); if(customerForm) customerForm.reset(); renderSalesResults(); displayNextSaleId();
        } else { throw new Error(result.message || 'Error al guardar venta.'); }
    } catch (error) {
        console.error('Error al registrar venta:', error); showNotification(`Error: ${error.message}`, 'error');
         if (error.message?.toLowerCase().includes('stock insuficiente')) { await fetchProducts(); renderCart(); }
    } finally {
        buttonText.classList.remove('hidden'); loader.classList.add('hidden'); button.disabled = cart.length === 0;
    }
}


function generateSalePDF(saleId, saleData) {
    const validSaleData = { ...saleData, items: Array.isArray(saleData.items) ? saleData.items : [] };
    return generateDocumentPDF('Nota de Venta', `Nr: ${saleId}`, validSaleData);
}

function handleGenerateQuote() {
    if (cart.length === 0) { showNotification("Carrito vacío.", 'error'); return; }
    const quoteData = {
        customer: { name: document.getElementById('customer-name')?.value || '', contact: document.getElementById('customer-contact')?.value || '', id: document.getElementById('customer-id')?.value || '' },
        items: cart.map(item => ({ Nombre: item?.nombre || '', SKU: item?.sku || '', cantidad: item?.quantity ?? 0, precio: item?.customPrice ?? 0 })).filter(item => item.cantidad > 0),
        total: cart.reduce((sum, item) => sum + ((item?.quantity ?? 0) * (item?.customPrice ?? 0)), 0)
    };
     if (quoteData.items.length === 0) { showNotification("No hay productos válidos.", "error"); return; }
    const { pdfBlob, fileName } = generateQuotePDF(quoteData);
     if(pdfBlob && fileName) { showShareOptions(pdfBlob, fileName, 'Cotización Generada', 'PDF generado.'); }
     else { showNotification("Error al generar PDF.", "error"); }
}


function generateQuotePDF(quoteData) {
     const validQuoteData = { ...quoteData, items: Array.isArray(quoteData.items) ? quoteData.items : [] };
    return generateDocumentPDF('Cotización', 'Válido por 24hrs.', validQuoteData, 'Cotizacion');
}

function generateDocumentPDF(docType, docIdentifier, data, filePrefix = 'Nota_Venta') {
     if (!data || typeof data !== 'object') { console.error("generateDocumentPDF: Datos inválidos", data); return { pdfBlob: null, fileName: 'error.pdf' }; }
     data.customer = data.customer || {};
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') { console.error("jsPDF no cargado."); showNotification("Error: Librería PDF.", "error"); return { pdfBlob: null, fileName: 'error.pdf'}; }
    const { jsPDF } = window.jspdf; let doc; try { doc = new jsPDF(); } catch (e) { console.error("Error jsPDF:", e); return { pdfBlob: null, fileName: 'error.pdf'}; }

    const pageW = doc.internal.pageSize.getWidth(); const margin = 14; const headerW = pageW - (margin * 2); const headerH = 30; const r = 3;
    doc.setFillColor('#303c54'); doc.roundedRect(margin, margin, headerW, headerH, r, r, 'F'); doc.setTextColor('#FFFFFF');
    let textStartX = margin + 5;
    if (preloadedLogo && preloadedLogo.dataURL) { const logoH = 7.2; const logoW = (preloadedLogo.width / preloadedLogo.height) * logoH; const logoY = margin + (headerH - logoH) / 2; try { doc.addImage(preloadedLogo.dataURL, 'PNG', margin + 5, logoY, logoW, logoH, undefined, 'FAST'); textStartX = margin + logoW + 8; } catch (e) { console.error("Error logo PDF:", e); } }
    doc.setFontSize(17.6); doc.text("ArelyShop", textStartX, margin + 15); doc.setFontSize(8.8); doc.text("Santa Cruz, Bolivia", textStartX, margin + 21); // Simplificado
    doc.setFontSize(16); doc.text(docType, pageW - margin - 5, margin + 12, { align: 'right' }); doc.setFontSize(10); doc.text(docIdentifier, pageW - margin - 5, margin + 18, { align: 'right' }); doc.text(`Fecha: ${new Date().toLocaleDateString('es-BO')}`, pageW - margin - 5, margin + 24, { align: 'right' });
    const startY = margin + headerH + 10; doc.setTextColor('#000000'); doc.setFontSize(12); doc.text("Cliente:", margin, startY); doc.setFontSize(10); // Simplificado
    const customerInfo = `Nombre: ${data.customer.name || 'N/A'} | Contacto: ${data.customer.contact || 'N/A'} | NIT/CI: ${data.customer.id || 'N/A'}`; doc.text(customerInfo, margin, startY + 8);
    const tableColumn = ["Cant.", "Desc.", "P.U.", "Subt."]; // Abreviado
    const tableRows = [];
    if (Array.isArray(data.items)) { data.items.forEach(item => { if (!item || typeof item !== 'object') return; const price = typeof item.precio === 'number' ? item.precio : 0; const quantity = typeof item.cantidad === 'number' ? item.cantidad : 0; const subtotal = quantity * price; const description = `${item.Nombre || 'N/A'}\n(SKU: ${item.SKU || 'N/A'})`; const itemData = [ quantity, description, `Bs ${price.toFixed(2)}`, `Bs ${subtotal.toFixed(2)}` ]; tableRows.push(itemData); }); } else { console.error("items no es array:", data.items); }
    if (typeof doc.autoTable !== 'function') { console.error("autoTable no cargado."); showNotification("Error: Tablas PDF.", "error"); return { pdfBlob: null, fileName: 'error.pdf'}; }
     let finalY = startY + 15; try { doc.autoTable({ head: [tableColumn], body: tableRows, startY: startY + 15, margin: { left: margin, right: margin }, headStyles: { fillColor: '#cdcdcd', textColor: '#000000', fontSize: 8 }, styles: { cellPadding: 1.5, fontSize: 8 }, columnStyles: { 0: { halign: 'center', cellWidth: 15 }, 2: { halign: 'right', cellWidth: 25 }, 3: { halign: 'right', cellWidth: 25 } }, didParseCell: (data) => { if (data.column.index === 1) data.cell.styles.fontSize = 7; } }); finalY = doc.autoTable.previous.finalY; } catch (e) { console.error("Error autoTable:", e); }
     const total = typeof data.total === 'number' ? data.total : 0; doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text("TOTAL:", margin, finalY + 10); doc.text(`Bs ${total.toFixed(2)}`, pageW - margin, finalY + 10, { align: 'right' }); doc.setFont(undefined, 'normal');
    doc.setFontSize(9); const thankYou = filePrefix === 'Cotizacion' ? "¡Gracias por su interés!" : "¡Gracias por su compra!"; doc.text(thankYou, pageW / 2, finalY + 20, { align: 'center' }); doc.text("Visítanos: www.arelyshop.com", pageW / 2, finalY + 24, { align: 'center' });
    if (preloadedPdfQr && preloadedPdfQr.dataURL) { const qrSize = 20; const qrX = (pageW - qrSize) / 2; const qrY = finalY + 28; try { doc.addImage(preloadedPdfQr.dataURL, 'JPEG', qrX, qrY, qrSize, qrSize, undefined, 'FAST'); } catch (e) { console.error("Error QR PDF:", e); } }
    const customerName = (data.customer.name || '').trim().replace(/\s+/g, "_") || "sin-cliente"; let fileName; if (filePrefix === 'Nota_Venta') { const saleId = (docIdentifier.split(': ')[1] || '').replace(/\s+/g, "_"); fileName = `${filePrefix}_${saleId}_${customerName}.pdf`; } else { fileName = `${filePrefix}_${customerName}.pdf`; } fileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '');
    let pdfBlob = null; try { pdfBlob = doc.output('blob'); } catch (e) { console.error("Error generando Blob:", e); showNotification("Error al generar PDF.", "error"); }
    return { pdfBlob, fileName };
}


function renderSalesResults() {
    const searchTerm = document.getElementById('search-sales-input')?.value.toLowerCase() || '';
    const container = document.getElementById('sales-results-container');
     if(!container) return;
    container.innerHTML = '';
    if (!Array.isArray(sales)) { container.innerHTML = '<p class="text-gray-500 text-center">No hay datos.</p>'; return; }
    const filteredSales = sales.filter(s => s && typeof s === 'object' && ( s.saleId?.toLowerCase().includes(searchTerm) || s.nombreCliente?.toLowerCase().includes(searchTerm) || s.contacto?.toString().toLowerCase().includes(searchTerm) || s.userName?.toLowerCase().includes(searchTerm) ));
    if (filteredSales.length === 0) { container.innerHTML = '<p class="text-gray-500 text-center">No se encontraron ventas.</p>'; return; }
    filteredSales.forEach(sale => {
         if (!sale || typeof sale !== 'object') return;
        const isAnnulled = sale.estado === 'Anulada'; const statusText = isAnnulled ? 'Anulada' : 'Completada'; const statusColor = isAnnulled ? 'bg-red-500 text-white' : 'bg-green-500 text-white'; const card = document.createElement('div'); card.className = `p-4 border rounded-lg ${isAnnulled ? 'bg-gray-200 opacity-70' : 'bg-white'}`;
        let productsHtml = '<ul>'; try { let saleProducts; if (typeof sale.productosVendidos === 'string') { try { saleProducts = JSON.parse(sale.productosVendidos); } catch (e) { saleProducts = null; } } else { saleProducts = sale.productosVendidos; } if (Array.isArray(saleProducts)) { saleProducts.forEach(p => { if (p && typeof p === 'object' && p.hasOwnProperty('cantidad') && p.hasOwnProperty('Nombre') && p.hasOwnProperty('precio')) { const price = p.precio !== undefined ? parseFloat(p.precio).toFixed(2) : 'N/A'; const sku = p.SKU || 'N/A'; productsHtml += `<li class="text-xs">${p.cantidad} x ${p.Nombre} (SKU: ${sku}) @ Bs ${price}</li>`; } else { console.warn(`Item inválido venta ${sale.saleId}:`, p); productsHtml += `<li class="text-xs text-red-500">Error: Item</li>`; } }); } else { productsHtml += `<li class="text-xs text-red-500">Error: Datos prod.</li>`; } } catch(e) { console.error(`Error proc. prod. venta ${sale.saleId}:`, e); productsHtml += `<li class="text-xs text-red-500">Error leer prod.</li>`; } productsHtml += '</ul>';
        const totalVenta = sale.totalVenta !== undefined ? parseFloat(sale.totalVenta).toFixed(2) : 'N/A'; const fechaVentaStr = sale.fechaVenta ? new Date(sale.fechaVenta).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short'}) : 'Fecha inv.';
        // Cambiado botón Ver PDF a Ver Resumen y su clase
        card.innerHTML = `<div class="flex flex-wrap justify-between items-start gap-2"><div><p class="font-bold text-lg">Venta ${sale.saleId || 'ID Inv.'}</p><p class="text-sm text-gray-600">${fechaVentaStr} - ${sale.nombreCliente || 'N/A'}</p><p class="text-sm text-gray-600">Vendido por: <strong>${sale.userName || 'N/A'}</strong></p><p class="font-semibold text-blue-600">Total: Bs ${totalVenta}</p></div><div class="text-right"><span class="font-semibold text-sm px-2 py-1 rounded-lg ${statusColor}">${statusText}</span><div class="mt-2 flex space-x-2 justify-end flex-wrap gap-1"><button class="view-summary-btn text-xs bg-purple-600 text-white px-3 py-1 rounded-lg hover:bg-purple-700" data-saleid="${sale.saleId || ''}">Ver Resumen</button><button class="reprint-btn text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700" data-saleid="${sale.saleId || ''}">Reimprimir</button><button class="annul-btn text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 disabled:bg-gray-400" data-saleid="${sale.saleId || ''}" ${isAnnulled || !sale.saleId ? 'disabled' : ''}>Anular</button></div></div></div><div class="mt-2 text-sm border-t pt-2">${productsHtml}</div>`;
        container.appendChild(card);
    });
}


// --- Funciones de Anulación ---
function openAnnulConfirmModal(saleId) { if (!saleId) { showNotification("ID inválido.", "error"); return; } saleIdToAnnul = saleId; const sale = sales.find(s => s && s.saleId === saleId); if (!sale) { showNotification("Venta no encontrada.", "error"); return; } const modalTextEl = document.getElementById('annul-modal-text'); if(modalTextEl) modalTextEl.textContent = `¿Anular venta ${saleId}? Stock será restaurado.`; const modalEl = document.getElementById('annul-confirm-modal'); if(modalEl) modalEl.classList.remove('hidden'); }
async function annulSaleInBackend(saleId) { if (!saleId) { showNotification("ID faltante.", "error"); return; } const button = document.getElementById('confirm-annul-btn'); const buttonText = document.getElementById('annul-button-text'); const loader = document.getElementById('annul-loader'); if (!button || !buttonText || !loader) { console.error("Elementos modal anulación no encontrados."); const modal = document.getElementById('annul-confirm-modal'); if (modal) modal.classList.add('hidden'); saleIdToAnnul = null; return; } buttonText.classList.add('hidden'); loader.classList.remove('hidden'); button.disabled = true; try { const result = await simpleFetch(`${API_BASE_URL}/sales`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ saleId: saleId }) }); if (result.status === 'success') { showNotification(result.message || `Venta ${saleId} anulada.`, 'success'); await Promise.all([fetchSales(), fetchProducts()]); renderSalesResults(); } else { throw new Error(result.message || 'Error al anular.'); } } catch (error) { console.error('Error al anular:', error); showNotification(`Error: ${error.message}`, 'error'); } finally { const modal = document.getElementById('annul-confirm-modal'); if (modal) modal.classList.add('hidden'); buttonText.classList.remove('hidden'); loader.classList.add('hidden'); button.disabled = false; saleIdToAnnul = null; } }
// --- Fin Funciones de Anulación ---

function reprintSale(saleId) { if (!saleId) return; const saleToReprint = sales.find(s => s && s.saleId === saleId); if (!saleToReprint) { showNotification("Venta no encontrada.", 'error'); return; } try { let saleItems; if (typeof saleToReprint.productosVendidos === 'string') { try { saleItems = JSON.parse(saleToReprint.productosVendidos); } catch (e) { saleItems = []; } } else { saleItems = Array.isArray(saleToReprint.productosVendidos) ? saleToReprint.productosVendidos : []; } if (!Array.isArray(saleItems)) { console.warn(`productosVendidos (reprint ${saleId}) no es array:`, saleToReprint.productosVendidos); saleItems = []; } const saleData = { customer: { name: saleToReprint.nombreCliente, contact: saleToReprint.contacto, id: saleToReprint.nitCi }, items: saleItems, total: parseFloat(saleToReprint.totalVenta || 0) }; const { pdfBlob, fileName } = generateSalePDF(saleId, saleData); if(pdfBlob && fileName) { showShareOptions(pdfBlob, fileName, 'Reimprimir Nota Venta', 'PDF generado.'); } else { throw new Error("No se generó Blob PDF."); } } catch (error) { console.error("Error PDF reprint:", error); showNotification(`Error al generar PDF: ${error.message}`, 'error'); } }
function showProductModal(product) { if (!product || typeof product !== 'object') { console.error("showProductModal: Datos inválidos:", product); return; } const modal = document.getElementById('productDetailModal'); if(!modal) return; const imgEl = document.getElementById('modalProductImage'); const nameEl = document.getElementById('modalProductName'); const skuEl = document.getElementById('modalProductSku'); const codeEl = document.getElementById('modalProductCode'); const branchEl = document.getElementById('modalProductBranch'); const stockEl = document.getElementById('modalProductStock'); const priceEl = document.getElementById('modalProductPrice'); const purchasePriceEl = document.getElementById('modalProductPurchasePrice'); const wholesalePriceEl = document.getElementById('modalProductWholesalePrice'); const discountContainer = document.getElementById('discountPriceContainer'); const discountPriceEl = document.getElementById('modalProductDiscountPrice'); if(imgEl) imgEl.src = product.urlFoto1 || 'https://placehold.co/400x400/e2e8f0/94a3b8?text=Sin+Imagen'; if(nameEl) nameEl.textContent = product.nombre || 'S/N'; if(skuEl) skuEl.textContent = product.sku || 'N/A'; if(codeEl) codeEl.textContent = product.codigoBarras || 'N/A'; if(branchEl) branchEl.textContent = product.ciudadSucursal || 'N/A'; if(stockEl) stockEl.textContent = product.cantidad?.toString() || '0'; const salePrice = parseFloat(product.precioVenta || 0).toFixed(2); const discountPrice = parseFloat(product.precioDescuento || 0); const purchasePrice = parseFloat(product.precioCompra || 0).toFixed(2); const wholesalePrice = parseFloat(product.precioMayoreo || 0).toFixed(2); if(priceEl) priceEl.textContent = `Bs. ${salePrice}`; if(purchasePriceEl) purchasePriceEl.textContent = `Bs. ${purchasePrice}`; if(wholesalePriceEl) wholesalePriceEl.textContent = `Bs. ${wholesalePrice}`; if (discountContainer && discountPriceEl && priceEl) { if (discountPrice > 0) { discountPriceEl.textContent = `Bs. ${discountPrice.toFixed(2)}`; discountContainer.classList.remove('hidden'); priceEl.classList.add('line-through'); } else { discountContainer.classList.add('hidden'); priceEl.classList.remove('line-through'); } } modal.classList.remove('hidden'); }
function copyToClipboard(text, buttonElement) { if (!text || text === 'N/A' || !buttonElement) return; navigator.clipboard.writeText(text).then(() => { const originalHTML = buttonElement.innerHTML; buttonElement.innerHTML = '¡Copiado!'; clearTimeout(buttonElement.copyTimeoutId); buttonElement.copyTimeoutId = setTimeout(() => { buttonElement.innerHTML = originalHTML; }, 1500); }).catch(err => { console.warn('navigator.clipboard falló:', err); try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); if(ok) { const oHTML = buttonElement.innerHTML; buttonElement.innerHTML = '¡Copiado!'; clearTimeout(buttonElement.copyTimeoutId); buttonElement.copyTimeoutId = setTimeout(() => { buttonElement.innerHTML = oHTML; }, 1500); } else { throw new Error('execCommand falló'); } } catch (execErr) { showNotification('No se pudo copiar.', 'error'); console.error('Fallback execCommand falló:', execErr); } }); }
function showQrModal() { const qrImg = document.getElementById('pos-qr-code'); const modalImg = document.getElementById('modalQrImage'); const modal = document.getElementById('qrCodeModal'); if (qrImg && modalImg && modal && qrImg.src && !qrImg.src.includes('placehold.co')) { modalImg.src = qrImg.src; modal.classList.remove('hidden'); } }
function showShareOptions(pdfBlob, fileName, title, text) { if (!(pdfBlob instanceof Blob)) { console.error("showShareOptions: pdfBlob inválido", pdfBlob); showNotification("Error PDF.", "error"); return; } if (!fileName) fileName = "doc.pdf"; currentPdfBlob = pdfBlob; currentPdfFileName = fileName; const modal = document.getElementById('share-modal'); const modalTitle = document.getElementById('share-modal-title'); const modalText = document.getElementById('share-modal-text'); const shareBtn = document.getElementById('share-pdf-btn'); const downloadBtn = document.getElementById('download-pdf-btn'); const closeModalBtn = document.getElementById('close-share-modal'); if (!modal || !modalTitle || !modalText || !shareBtn || !downloadBtn || !closeModalBtn) { console.error("Elementos modal compartir no encontrados."); try { const link = document.createElement('a'); link.href = URL.createObjectURL(currentPdfBlob); link.download = currentPdfFileName; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(link.href); } catch (e) { showNotification("No se pudo descargar PDF.", "error"); } return; } modalTitle.textContent = title; modalText.textContent = text; let fileToShare; try { fileToShare = new File([currentPdfBlob], currentPdfFileName, { type: 'application/pdf' }); } catch (e) { console.error("Error creando File:", e); showNotification("No se pudo preparar archivo.", "error"); shareBtn.classList.add('hidden'); shareBtn.onclick = null; } const dataToShare = fileToShare ? { files: [fileToShare] } : null; if (dataToShare && navigator.share && navigator.canShare && navigator.canShare(dataToShare)) { shareBtn.classList.remove('hidden'); shareBtn.onclick = async () => { try { await navigator.share({ files: [fileToShare], title: `Doc: ${currentPdfFileName}`, text: 'Doc desde ArelyShop.' }); modal.classList.add('hidden'); } catch (error) { console.error('Error al compartir:', error); if (error.name !== 'AbortError') showNotification('No se pudo compartir.', 'error'); } }; } else { shareBtn.classList.add('hidden'); shareBtn.onclick = null; if(dataToShare) console.log("Web Share API no soportada."); } modal.classList.remove('hidden'); downloadBtn.onclick = () => { try { const link = document.createElement('a'); link.href = URL.createObjectURL(currentPdfBlob); link.download = currentPdfFileName; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(link.href); modal.classList.add('hidden'); } catch (e) { console.error("Error descarga PDF:", e); showNotification("No se pudo descargar.", "error"); } }; closeModalBtn.onclick = () => { modal.classList.add('hidden'); }; }

// --- Funciones del Visor Resumen ---
function showSaleSummaryModal(saleId) { if(!saleId) return; const sale = sales.find(s => s && s.saleId === saleId); if (!sale) { showNotification("Venta no encontrada.", "error"); return; } const modal = document.getElementById('sale-summary-modal'); const titleEl = document.getElementById('summary-modal-title'); const custNameEl = document.getElementById('summary-customer-name'); const custContactEl = document.getElementById('summary-customer-contact'); const custIdEl = document.getElementById('summary-customer-id'); const dateEl = document.getElementById('summary-sale-date'); const sellerEl = document.getElementById('summary-seller-name'); const prodListEl = document.getElementById('summary-products-list'); const totalEl = document.getElementById('summary-total-amount'); if(!modal || !titleEl || !custNameEl || !custContactEl || !custIdEl || !dateEl || !sellerEl || !prodListEl || !totalEl) { console.error("Elementos modal resumen no encontrados."); return; } try { titleEl.textContent = `Resumen - Venta ${sale.saleId}`; custNameEl.textContent = sale.nombreCliente || 'N/A'; custContactEl.textContent = sale.contacto || 'N/A'; custIdEl.textContent = sale.nitCi || 'N/A'; dateEl.textContent = sale.fechaVenta ? new Date(sale.fechaVenta).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short'}) : 'Inv.'; sellerEl.textContent = sale.userName || 'N/A'; totalEl.textContent = sale.totalVenta !== undefined ? parseFloat(sale.totalVenta).toFixed(2) : '0.00'; prodListEl.innerHTML = ''; let saleProducts; if (typeof sale.productosVendidos === 'string') { try { saleProducts = JSON.parse(sale.productosVendidos); } catch (e) { saleProducts = null; } } else { saleProducts = sale.productosVendidos; } if (Array.isArray(saleProducts) && saleProducts.length > 0) { saleProducts.forEach(p => { if (p && typeof p === 'object' && p.hasOwnProperty('cantidad') && p.hasOwnProperty('Nombre') && p.hasOwnProperty('precio')) { const price = p.precio !== undefined ? parseFloat(p.precio).toFixed(2) : 'N/A'; const sku = p.SKU || 'N/A'; const li = document.createElement('div'); li.className = 'text-xs py-1 border-b border-gray-200 last:border-b-0'; li.textContent = `${p.cantidad} x ${p.Nombre} (SKU: ${sku}) @ Bs ${price}`; prodListEl.appendChild(li); } else { const errLi = document.createElement('div'); errLi.className = 'text-xs py-1 text-red-500'; errLi.textContent = 'Error: Item'; prodListEl.appendChild(errLi); } }); } else { prodListEl.innerHTML = '<p class="text-xs text-gray-500">No hay productos.</p>'; } modal.classList.remove('hidden'); } catch (error) { console.error("Error mostrando resumen:", error); showNotification(`Error resumen: ${error.message}`, "error"); closeSaleSummaryModal(); } }
function closeSaleSummaryModal() { const modal = document.getElementById('sale-summary-modal'); if (modal) modal.classList.add('hidden'); const prodListEl = document.getElementById('summary-products-list'); if(prodListEl) prodListEl.innerHTML = '<p class="text-gray-500">...</p>'; }
// --- Fin Funciones del Visor Resumen ---

function startScanner(targetInputId) { if (!html5QrCode) { console.warn("Html5Qrcode no inicializado."); try { const readerElement = document.getElementById("reader"); if (!readerElement) throw new Error("Elemento 'reader' no encontrado."); html5QrCode = new Html5Qrcode("reader"); } catch (e) { console.error("Error re-inicializando:", e); showNotification("Error escáner.", "error"); return; } } const modal = document.getElementById('scanner-modal'); if(modal) modal.classList.remove('hidden'); const onScanSuccess = (decodedText, decodedResult) => { const targetInput = document.getElementById(targetInputId); if (targetInput) { targetInput.value = decodedText; const inputEvent = new Event('input', { bubbles: true }); targetInput.dispatchEvent(inputEvent); if (targetInputId === 'search-product') { const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }); targetInput.dispatchEvent(enterEvent); } } stopScanner(); }; const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 }; Html5Qrcode.getCameras().then(devices => { if (devices && devices.length) { const rearCam = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment')); const camId = rearCam ? rearCam.id : devices[0].id; const state = (typeof html5QrCode.getState === 'function') ? html5QrCode.getState() : null; const SCANNING = 2; if (state !== SCANNING) { html5QrCode.start( camId, config, onScanSuccess, (errorMessage) => {}) .catch(err => { console.warn("Fallo escanear cámara preferida, fallback:", err); const fallbackState = (typeof html5QrCode.getState === 'function') ? html5QrCode.getState() : null; if (fallbackState !== SCANNING) { html5QrCode.start( { facingMode: "environment" }, config, onScanSuccess, (e)=>{}) .catch(errFallback => { console.error("Fallback escáner falló.", errFallback); showNotification("No se pudo iniciar cámara.", 'error'); stopScanner(); }); } }); } else { console.log("Escáner ya activo."); } } else { console.error("No se encontraron cámaras."); showNotification("No hay cámaras.", 'error'); stopScanner(); } }).catch(err => { console.error("Error obteniendo cámaras:", err); showNotification("Error acceso cámaras.", 'error'); stopScanner(); }); }
function stopScanner() { const SCANNING = 2; const state = (html5QrCode && typeof html5QrCode.getState === 'function') ? html5QrCode.getState() : null; if (state === SCANNING) { html5QrCode.stop().then(ignore => { console.log("Scan stopped."); }).catch(err => { console.error("Fallo al detener:", err); }).finally(() => { const modal = document.getElementById('scanner-modal'); if(modal) modal.classList.add('hidden'); }); } else { const modal = document.getElementById('scanner-modal'); if(modal) modal.classList.add('hidden'); } }
