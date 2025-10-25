document.addEventListener('DOMContentLoaded', function () {
    // --- GLOBAL STATE ---
    let allProducts = [];
    let cart = [];

    // --- UTILITY FUNCTIONS ---
    // Función para cargar componentes HTML (header, footer)
    const loadComponent = async (component, selector) => {
        try {
            const response = await fetch(component); // Pide el archivo HTML
            if (!response.ok) throw new Error(`Could not load ${component}`);
            const text = await response.text(); // Obtiene el HTML como texto
            const element = document.querySelector(selector); // Encuentra el placeholder
            if (element) {
                // Reemplaza el placeholder con el contenido cargado
                const tempWrapper = document.createElement('div');
                tempWrapper.innerHTML = text;
                element.replaceWith(...tempWrapper.childNodes);
            }
        } catch (error) {
            console.error(error); // Muestra error en consola si falla
        }
    };

    // --- FUNCIÓN CENTRALIZADA PARA EL ÍCONO DE DESCUENTO ---
    // Crea el SVG de la insignia de descuento si aplica
    const createDiscountBadgeHTML = (product, options = {}) => {
        const salePrice = parseFloat(product.sale_price);
        const discountPrice = parseFloat(product.discount_price);
        const isOutOfStock = product.stock <= 0;

        // No muestra insignia si no hay descuento válido o está agotado
        if (isOutOfStock || !discountPrice || !salePrice || discountPrice >= salePrice) {
            return '';
        }

        // Calcula el porcentaje de descuento
        const discountPercentage = Math.round(((salePrice - discountPrice) / salePrice) * 100);
        // Define clases de tamaño según las opciones (para tarjetas o página de producto)
        const sizeClass = options.size === 'large' ? 'w-12 h-12 ml-3' : 'absolute bottom-2 left-2 w-11 h-11 z-10';
        const percentFontSize = options.size === 'large' ? '60' : '58';
        const offFontSize = options.size === 'large' ? '50' : '48';

        // Retorna el código SVG con el porcentaje calculado
        return `
            <div class="${sizeClass}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
                    <defs>
                        <linearGradient id="grad-badge-${product.id}" x1="100" y1="0" x2="100" y2="200" gradientUnits="userSpaceOnUse">
                            <stop offset="0" stop-color="#fb6404"/>
                            <stop offset="1" stop-color="#e20919"/>
                        </linearGradient>
                    </defs>
                    <circle cx="100" cy="100" r="100" fill="url(#grad-badge-${product.id})" />
                    <text x="100" y="95" font-family="Inter, sans-serif" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">
                        <tspan font-size="${percentFontSize}">${discountPercentage}%</tspan>
                        <tspan x="100" dy="1.1em" font-size="${offFontSize}">OFF</tspan>
                    </text>
                </svg>
            </div>`;
    };

    // --- FUNCIÓN PARA CREAR TARJETA DE PRODUCTO ---
    // Genera el HTML para una tarjeta de producto individual
    const createProductCard = (product) => {
        let priceHTML = '';
        let stockOverlayHTML = '';

        const salePrice = parseFloat(product.sale_price);
        const discountPrice = parseFloat(product.discount_price);
        const isOutOfStock = product.stock <= 0;

        // Define cómo mostrar el precio (normal o con descuento)
        if (!isOutOfStock && discountPrice && salePrice && discountPrice < salePrice) {
            priceHTML = `<div class="mt-1 flex items-baseline justify-center space-x-2 flex-wrap"><span class="text-gray-500 line-through text-sm">Bs. ${Math.round(salePrice)}</span><span class="font-bold text-red-600 text-base">Bs. ${Math.round(discountPrice)}</span></div>`;
        } else {
            priceHTML = `<p class="text-gray-600 mt-1 text-center font-semibold">Bs. ${Math.round(salePrice)}</p>`;
        }

        // Obtiene la insignia de descuento usando la función centralizada
        const discountBadgeHTML = createDiscountBadgeHTML(product, { size: 'small' });

        // Añade marca de agua si está agotado
        if (isOutOfStock) {
            stockOverlayHTML = `<div class="sold-out-watermark"><span>AGOTADO</span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="white"><path d="M620-520q25 0 42.5-17.5T680-580q0-25-17.5-42.5T620-640q-25 0-42.5 17.5T560-580q0 25 17.5 42.5T620-520Zm-280 0q25 0 42.5-17.5T400-580q0-25-17.5-42.5T340-640q-25 0-42.5 17.5T280-580q0 25 17.5 42.5T340-520Zm140 100q-68 0-123.5 38.5T276-280h66q22-37 58.5-58.5T480-360q43 0 79.5 21.5T618-280h66q-25-63-80.5-101.5T480-420Zm0 340q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 320q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Z"/></svg></div>`;
        }

        // Lógica para mostrar imagen alternativa al pasar el mouse (hover)
        const hasSecondImage = product.photo_url_2;
        const imageClass = `w-full h-full object-cover transition-all duration-300 ${isOutOfStock ? 'opacity-50' : ''}`;
        let imageHTML;

        if (hasSecondImage) {
            // Si hay segunda imagen, cambia entre img1 y img2 al hacer hover
            imageHTML = `
                <img src="${product.photo_url_1 || 'https://placehold.co/400x400/e2e8f0/cbd5e0?text=Producto'}" alt="${product.name}" class="${imageClass} block group-hover:hidden" onerror="this.onerror=null;this.src='https://placehold.co/400x400/e2e8f0/cbd5e0?text=Error';">
                <img src="${product.photo_url_2}" alt="${product.name} (vista alternativa)" class="${imageClass} hidden group-hover:block" onerror="this.style.display='none';">`;
        } else {
            // Si no hay segunda imagen, solo hace zoom al hacer hover
            imageHTML = `
                <img src="${product.photo_url_1 || 'https://placehold.co/400x400/e2e8f0/cbd5e0?text=Producto'}" alt="${product.name}" class="${imageClass} group-hover:scale-110" onerror="this.onerror=null;this.src='https://placehold.co/400x400/e2e8f0/cbd5e0?text=Error';">`;
        }

        // Retorna el HTML completo de la tarjeta
        return `
            <div class="bg-white rounded-lg shadow-md overflow-hidden group">
                <a href="product.html?id=${product.id}" class="block h-full flex flex-col">
                    <div class="aspect-square overflow-hidden relative">
                        ${stockOverlayHTML}
                        ${discountBadgeHTML}
                        ${imageHTML}
                    </div>
                    <div class="p-2 text-center mt-auto">
                        <h3 class="product-title font-semibold text-gray-800 text-sm">${product.name}</h3>
                        ${priceHTML}
                    </div>
                </a>
            </div>
        `;
    };

    // --- CART LOGIC ---
    // Guarda el carrito en el almacenamiento local del navegador
    const saveCart = () => localStorage.setItem('arelyshopCart', JSON.stringify(cart));
    // Carga el carrito desde el almacenamiento local
    const loadCart = () => {
        const cartData = localStorage.getItem('arelyshopCart');
        cart = cartData ? JSON.parse(cartData) : [];
        renderCart(); // Actualiza la interfaz del carrito
    };

    // Añade un producto al carrito
    const addToCart = (productName, productPrice) => {
        cart.push({ name: productName, price: parseFloat(productPrice) });
        saveCart(); // Guarda el carrito actualizado
        renderCart(); // Actualiza la interfaz
        // Animación de rebote en los íconos del carrito
        [document.getElementById('mobile-cart-btn'), document.getElementById('desktop-cart-btn')].forEach(icon => {
            if (icon) {
                icon.classList.add('cart-bounce-animation');
                setTimeout(() => icon.classList.remove('cart-bounce-animation'), 500);
            }
        });
    };

    // Elimina un producto del carrito por su índice
    const removeFromCart = (index) => {
        cart.splice(index, 1);
        saveCart();
        renderCart();
    };

    // Actualiza la interfaz del carrito (flyout)
    const renderCart = () => {
        const cartItemsContainer = document.getElementById('cart-items-container');
        const cartTotalEl = document.getElementById('cart-total');
        const mobileCartCount = document.getElementById('mobile-cart-count');
        const desktopCartCount = document.getElementById('desktop-cart-count');

        // Si no se encuentra el contenedor, no hacer nada (ej. en POS)
        if (!cartItemsContainer) return;

        cartItemsContainer.innerHTML = ''; // Limpiar contenido anterior
        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="text-gray-500 text-center">Tu carrito está vacío.</p>';
        } else {
            // Crear elemento HTML para cada item en el carrito
            cart.forEach((item, index) => {
                const cartItem = document.createElement('div');
                cartItem.className = 'flex justify-between items-center mb-4 pb-4 border-b';
                cartItem.innerHTML = `
                    <div>
                        <h4 class="font-semibold">${item.name}</h4>
                        <p class="text-gray-600">Bs. ${item.price.toFixed(2)}</p>
                    </div>
                    <button class="remove-from-cart-btn text-red-500 hover:text-red-700" data-index="${index}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg>
                    </button>
                `;
                cartItemsContainer.appendChild(cartItem);
            });
        }

        // Calcular y mostrar el total
        const total = cart.reduce((sum, item) => sum + item.price, 0);
        if (cartTotalEl) cartTotalEl.textContent = `Bs. ${total.toFixed(2)}`;
        // Actualizar contadores en los íconos del carrito
        if (mobileCartCount) mobileCartCount.textContent = cart.length;
        if (desktopCartCount) desktopCartCount.textContent = cart.length;
    };


    // --- SHARED COMPONENT INITIALIZATION & LOGIC ---
    // Carga productos y configura elementos comunes (menús, búsqueda, carrito)
    async function initializeSharedComponents() {
        try {
            // Llama a la función Netlify para obtener los productos
            const response = await fetch('/.netlify/functions/products'); // Usa la función unificada
             if (!response.ok) {
                 const errorText = await response.text();
                 throw new Error(`Error ${response.status}: ${errorText || 'No se pudieron cargar los productos'}`);
             }
            const result = await response.json();
             if (result.status !== 'success' || !Array.isArray(result.data)) {
                 throw new Error('Formato de respuesta de productos inválido');
             }
            allProducts = result.data; // Almacena los productos globalmente
        } catch (error) {
            console.error('Fallo al inicializar componentes compartidos (fetch products):', error);
            // Mostrar un mensaje al usuario podría ser útil aquí
            const loadingMsg = document.getElementById('loading-message');
            if (loadingMsg) loadingMsg.textContent = 'Error al cargar productos.';
            allProducts = []; // Asegurar que sea un array vacío
            // No continuar si falla la carga de productos
            return;
        }

        // Actualizar año en el footer
        const yearSpan = document.getElementById('current-year');
        if (yearSpan) yearSpan.textContent = new Date().getFullYear();

        // Llenar menús de filtros (categorías, marcas)
        populateFilterMenus(allProducts);

        // --- Lógica para menús laterales (sidenav y cart) ---
        const sidenav = document.getElementById('sidenav');
        const cartFlyout = document.getElementById('cart-flyout');
        const sidenavOverlay = document.getElementById('sidenav-overlay');
        const cartOverlay = document.getElementById('cart-overlay');

        const isMobile = () => window.innerWidth < 768;

        // Ajusta la posición y altura de los menús laterales en móvil
        function adjustFlyoutPosition(flyoutEl, overlayEl) {
            const header = document.querySelector('header');
            if (!header || !flyoutEl) return;
            const headerRect = header.getBoundingClientRect();
            const totalTopOffset = headerRect.bottom; // Distancia desde top de la ventana hasta abajo del header
            const calculatedHeight = `calc(100dvh - ${totalTopOffset}px)`; // Altura restante de la ventana
            flyoutEl.style.top = `${totalTopOffset}px`;
            flyoutEl.style.height = calculatedHeight;
            if (overlayEl) {
                overlayEl.style.top = `${totalTopOffset}px`;
                overlayEl.style.height = calculatedHeight;
            }
        }

        // Abre un menú lateral
        const openFlyout = (flyoutEl, overlayEl) => {
            if (!flyoutEl) return; // Salir si el elemento no existe

            // Ajustes específicos para móvil
            if (isMobile()) {
                if (flyoutEl === cartFlyout) { // Carrito ocupa toda la pantalla
                    flyoutEl.classList.add('w-full');
                    flyoutEl.classList.remove('w-72', 'md:w-96');
                } else { // Menú lateral ocupa ancho fijo
                    flyoutEl.classList.add('w-72');
                    flyoutEl.classList.remove('w-full', 'md:w-96');
                }
                adjustFlyoutPosition(flyoutEl, overlayEl); // Ajusta top y height
            } else { // Ajustes para escritorio
                 if(flyoutEl === cartFlyout) { // Carrito tiene ancho fijo en escritorio
                    flyoutEl.classList.remove('w-72', 'w-full');
                    flyoutEl.classList.add('md:w-96');
                }
                // En escritorio, ocupan toda la altura
                flyoutEl.style.top = '0px';
                flyoutEl.style.height = '100%';
                if (overlayEl) {
                    overlayEl.style.top = '0px';
                    overlayEl.style.height = '100%';
                }
            }
            // Muestra el menú y el overlay
            flyoutEl.classList.remove('-translate-x-full', 'translate-x-full'); // Quita la clase que lo oculta
            if (overlayEl) {
                overlayEl.classList.remove('hidden');
                requestAnimationFrame(() => overlayEl.classList.remove('opacity-0')); // Anima la opacidad
            }
            document.body.style.overflow = 'hidden'; // Evita scroll del fondo
        };

        // Cierra un menú lateral
        const closeFlyout = (flyoutEl, overlayEl, direction) => {
            if (flyoutEl) flyoutEl.classList.add(direction === 'left' ? '-translate-x-full' : 'translate-x-full'); // Añade clase para ocultar
            if (overlayEl) {
                overlayEl.classList.add('opacity-0'); // Anima opacidad
                setTimeout(() => overlayEl.classList.add('hidden'), 500); // Oculta después de la animación
            }
            document.body.style.overflow = ''; // Restaura scroll
        };

        // Asignar eventos a los botones y overlays para abrir/cerrar menús
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => openFlyout(sidenav, sidenavOverlay));
        document.getElementById('close-sidenav')?.addEventListener('click', () => closeFlyout(sidenav, sidenavOverlay, 'left'));
        sidenavOverlay?.addEventListener('click', () => closeFlyout(sidenav, sidenavOverlay, 'left'));

        document.getElementById('mobile-cart-btn')?.addEventListener('click', () => openFlyout(cartFlyout, cartOverlay));
        document.getElementById('desktop-cart-btn')?.addEventListener('click', () => openFlyout(cartFlyout, cartOverlay));
        document.getElementById('close-cart-btn')?.addEventListener('click', () => closeFlyout(cartFlyout, cartOverlay, 'right'));
        cartOverlay?.addEventListener('click', () => closeFlyout(cartFlyout, cartOverlay, 'right'));

        // --- Lógica de Búsqueda ---
        const searchInputs = [document.getElementById('mobile-search-input'), document.getElementById('desktop-search-input')];
        const searchResultsContainers = [document.getElementById('mobile-search-results'), document.getElementById('desktop-search-results')];

        // Muestra resultados de búsqueda mientras escribes
        const handleSearchPopup = (e) => {
            const input = e.target;
            const resultsContainer = input.id.includes('mobile') ? searchResultsContainers[0] : searchResultsContainers[1];
            const searchTerm = input.value.toLowerCase();

            if (!resultsContainer) return; // Salir si no hay contenedor
            resultsContainer.innerHTML = ''; // Limpiar
            if (searchTerm.length === 0) {
                resultsContainer.innerHTML = `<p class="p-4 text-center text-sm text-gray-500">Comienza a escribir...</p>`;
                return;
            }
            // Filtrar productos y mostrar máximo 10
            const filtered = allProducts.filter(p => p.name.toLowerCase().includes(searchTerm)).slice(0, 10);
            if (filtered.length > 0) {
                filtered.forEach(p => {
                    const item = document.createElement('a');
                    item.href = `product.html?id=${p.id}`; // Enlace a página de producto
                    item.className = 'flex items-center p-2 hover:bg-gray-100 transition-colors';
                    const price = p.discount_price || p.sale_price; // Usar precio con descuento si existe
                    item.innerHTML = `
                        <img src="${p.photo_url_1 || 'https://placehold.co/100x100'}" alt="${p.name}" class="w-12 h-12 object-cover rounded-md mr-4">
                        <div class="flex-1">
                            <p class="text-sm font-semibold text-gray-800">${p.name}</p>
                            <p class="text-xs text-gray-600">Bs. ${Math.round(price)}</p>
                        </div>`;
                    resultsContainer.appendChild(item);
                });
            } else {
                resultsContainer.innerHTML = `<p class="p-4 text-center text-sm text-gray-500">No se encontraron productos.</p>`;
            }
        };

        // Muestra el contenedor de resultados al enfocar el input
        const showResults = (e) => {
            const resultsContainer = e.target.id.includes('mobile') ? searchResultsContainers[0] : searchResultsContainers[1];
            if (resultsContainer) resultsContainer.classList.remove('hidden');
        }
        // Oculta el contenedor al quitar el foco (con delay para permitir clics)
        const hideResults = (e) => {
            const resultsContainer = e.target.id.includes('mobile') ? searchResultsContainers[0] : searchResultsContainers[1];
            if (resultsContainer) setTimeout(() => resultsContainer.classList.add('hidden'), 200);
        }
        // Redirige a la página de todos los productos con el término de búsqueda al presionar Enter
        const handleSearchRedirect = (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
                e.preventDefault();
                window.location.href = `all-products.html?search=${encodeURIComponent(e.target.value.trim())}`;
            }
        };

        // Asignar eventos a los inputs de búsqueda
        searchInputs.forEach(input => {
            if (input) {
                input.addEventListener('input', handleSearchPopup);
                input.addEventListener('focus', showResults);
                input.addEventListener('blur', hideResults);
                input.addEventListener('keydown', handleSearchRedirect);
            }
        });

        // Evento para eliminar items del carrito (delegación)
        document.getElementById('cart-items-container')?.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-from-cart-btn');
            if (removeBtn) removeFromCart(parseInt(removeBtn.dataset.index));
        });

        // Evento para el botón de pedido por WhatsApp
        document.getElementById('whatsapp-order-btn')?.addEventListener('click', () => {
            if (cart.length === 0) return;
            // Crear mensaje predefinido para WhatsApp
            let message = '¡Hola! Quisiera hacer el siguiente pedido:\n\n' + cart.map(item => `- ${item.name} (Bs. ${item.price.toFixed(2)})`).join('\n');
            const total = cart.reduce((sum, item) => sum + item.price, 0);
            message += `\n\n*Total a pagar: Bs. ${total.toFixed(2)}*`;
            // Abrir WhatsApp con el mensaje
            window.open(`https://wa.me/59167500044?text=${encodeURIComponent(message)}`, '_blank');
        });

        // --- Lógica para menús desplegables (móvil y escritorio) ---
        document.getElementById('mobile-categories-btn')?.addEventListener('click', () => {
            document.getElementById('mobile-categories-submenu').classList.toggle('hidden');
            document.getElementById('mobile-categories-arrow').classList.toggle('rotate-180');
        });
        document.getElementById('mobile-marcas-btn')?.addEventListener('click', () => {
            document.getElementById('mobile-marcas-submenu').classList.toggle('hidden');
            document.getElementById('mobile-marcas-arrow').classList.toggle('rotate-180');
        });

        const desktopCategoriesContainer = document.getElementById('desktop-categories-dropdown-container');
        desktopCategoriesContainer?.addEventListener('mouseenter', () => desktopCategoriesContainer.querySelector('div[id$="-submenu"]')?.classList.remove('hidden'));
        desktopCategoriesContainer?.addEventListener('mouseleave', () => desktopCategoriesContainer.querySelector('div[id$="-submenu"]')?.classList.add('hidden'));

        const desktopMarcasContainer = document.getElementById('desktop-marcas-dropdown-container');
        desktopMarcasContainer?.addEventListener('mouseenter', () => desktopMarcasContainer.querySelector('div[id$="-submenu"]')?.classList.remove('hidden'));
        desktopMarcasContainer?.addEventListener('mouseleave', () => desktopMarcasContainer.querySelector('div[id$="-submenu"]')?.classList.add('hidden'));

        // --- DISPATCH EVENT ---
        // Dispara un evento personalizado para indicar que los componentes compartidos y los datos están listos
        // Otras páginas (como index.html) pueden escuchar este evento
        window.dispatchEvent(new CustomEvent('shared-components-loaded', {
            detail: {
                allProducts, // Pasa la lista de productos
                addToCart, // Pasa la función para añadir al carrito (si es necesario en otras páginas)
                createProductCard, // Pasa la función para crear tarjetas
                createDiscountBadgeHTML // Pasa la función para crear insignias
            }
        }));
    }

    // --- Llenar menús de Categorías y Marcas ---
    function populateFilterMenus(products) {
        // Extraer listas únicas y ordenadas
        const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
        const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort();

        // Selectores para los menús
        const catMenuDesk = document.getElementById('desktop-categories-submenu');
        const catMenuMob = document.getElementById('mobile-categories-submenu');
        const brandMenuDesk = document.getElementById('desktop-marcas-submenu');
        const brandMenuMob = document.getElementById('mobile-marcas-submenu');

        // Función para crear los enlaces HTML
        const createLinks = (items, type) => items.map(item =>
            `<a href="all-products.html?${type}=${encodeURIComponent(item)}"
                class="block pl-6 pr-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                ${item}
             </a>`
        ).join('');

        // Generar HTML de los enlaces
        const catLinks = createLinks(categories, 'category');
        const brandLinks = createLinks(brands, 'brand');

        // Insertar HTML en los menús (si existen)
        if (catMenuDesk) catMenuDesk.innerHTML = catLinks || '<p class="px-4 py-2 text-xs text-gray-400">No hay categorías.</p>'; // Añadir fallback
        if (catMenuMob) catMenuMob.innerHTML = catLinks.replace(/pl-6 pr-4 py-2/g, 'py-2 px-4') || '<p class="py-2 px-4 text-xs text-gray-400">No hay categorías.</p>';
        if (brandMenuDesk) brandMenuDesk.innerHTML = brandLinks || '<p class="px-4 py-2 text-xs text-gray-400">No hay marcas.</p>';
        if (brandMenuMob) brandMenuMob.innerHTML = brandLinks.replace(/pl-6 pr-4 py-2/g, 'py-2 px-4') || '<p class="py-2 px-4 text-xs text-gray-400">No hay marcas.</p>';
    }

    // --- INICIALIZACIÓN PRINCIPAL ---
    // Carga header/footer y luego inicializa la lógica compartida
    async function init() {
        await Promise.all([
            loadComponent('/header.html', '#header-placeholder'), // Usar ruta absoluta desde la raíz
            loadComponent('/footer.html', '#footer-placeholder')  // Usar ruta absoluta desde la raíz
        ]);
        initializeSharedComponents(); // Carga productos y configura elementos comunes
        loadCart(); // Carga el carrito al iniciar
    }

    init(); // Ejecuta la inicialización
});
