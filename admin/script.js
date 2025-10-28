document.addEventListener('DOMContentLoaded', () => {
    // --- Lógica de Autenticación ---
    const API_BASE_URL = '/.netlify/functions';
    let currentUser = null;

    const loginContainer = document.getElementById('login-container');
    const adminPanel = document.getElementById('admin-panel');
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    const loginButton = document.getElementById('login-button');
    const buttonText = document.getElementById('login-button-text');
    const loader = document.getElementById('login-loader');
    const logoutButton = document.getElementById('logout-button');

    function setupLoginListener() {
        if (!loginForm) return;

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if(errorMessage) errorMessage.textContent = '';
            if(buttonText) buttonText.classList.add('hidden');
            if(loader) loader.classList.remove('hidden');
            if(loginButton) loginButton.disabled = true;

            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                // Esta es la llamada a tu función de backend login.js
                const response = await fetch(`${API_BASE_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });

                let result;
                try {
                    result = await response.json();
                } catch (jsonError) {
                     console.error("Respuesta del login no es JSON:", response.status, response.statusText);
                     throw new Error(`Error ${response.status}: ${response.statusText || 'Respuesta inválida del servidor'}`);
                }

                if (response.ok && result.status === 'success') {
                    // Solo permitir 'admin' en este panel
                    if (result.user.role !== 'admin') {
                        throw new Error('Acceso denegado. Se requiere rol de administrador.');
                    }
                    sessionStorage.setItem('arelyShopUser', JSON.stringify(result.user));
                    currentUser = result.user;
                    initializeApp();
                } else {
                    throw new Error(result.message || 'Credenciales incorrectas o error del servidor.');
                }
            } catch (error) {
                console.error('Error en el proceso de login:', error);
                if(errorMessage) errorMessage.textContent = error.message;
            } finally {
                if(buttonText) buttonText.classList.remove('hidden');
                if(loader) loader.classList.add('hidden');
                if(loginButton) loginButton.disabled = false;
            }
        });
    }

    function checkAuth() {
        const userString = sessionStorage.getItem('arelyShopUser');
        if (userString) {
            try {
                currentUser = JSON.parse(userString);
                // Validar rol de admin
                if (currentUser && currentUser.id && currentUser.username && currentUser.role === 'admin') {
                    initializeApp();
                } else {
                    logout(); // Rol no válido o datos corruptos
                }
            } catch (e) {
                logout();
            }
        } else {
             if (adminPanel) adminPanel.classList.add('hidden');
             if (loginContainer) loginContainer.classList.remove('hidden');
        }
    }

    function logout() {
        sessionStorage.removeItem('arelyShopUser');
        currentUser = null;
        if (adminPanel) adminPanel.classList.add('hidden');
        if (loginContainer) loginContainer.classList.remove('hidden');
        // Opcional: recargar para limpiar todo el estado
        // window.location.reload(); 
    }

    function initializeApp() {
        if (!currentUser) return; // Doble chequeo

        // Ocultar login, mostrar panel
        if (loginContainer) loginContainer.classList.add('hidden');
        if (adminPanel) adminPanel.classList.remove('hidden');
        if (adminPanel) adminPanel.classList.add('flex');

        // Mostrar info de usuario en el header
        const userFullnameEl = document.getElementById('user-fullname');
        const userRoleEl = document.getElementById('user-role');
        if (userFullnameEl) userFullnameEl.textContent = currentUser.full_name || 'Admin';
        if (userRoleEl) userRoleEl.textContent = currentUser.role || 'admin';

        // Mostrar info de usuario en el header móvil
        const userFullnameMobileEl = document.getElementById('user-fullname-mobile');
        const userRoleMobileEl = document.getElementById('user-role-mobile');
        if (userFullnameMobileEl) userFullnameMobileEl.textContent = currentUser.full_name || 'Admin';
        if (userRoleMobileEl) userRoleMobileEl.textContent = currentUser.role || 'admin';

        // Iniciar la lógica específica del panel de administración
        initializeAdminLogic();
    }

    // Registrar listener de logout
    if (logoutButton) logoutButton.addEventListener('click', logout);
    
    // Iniciar listeners de login y chequeo de autenticación
    setupLoginListener();
    checkAuth();

    // --- FIN Lógica de Autenticación ---


    // La lógica del panel de administración se inicializa desde initializeApp()
    function initializeAdminLogic() {
        // --- STATE ---
        let allProducts = [];
        let currentProductId = null;
        let html5QrCode = null;
        let currentScannerTarget = null;
        let sortable = null;

        // --- ELEMENT SELECTORS ---
        const productForm = document.getElementById('product-form');
        const productFormContainer = document.getElementById('product-form-container');
        const productListContainer = document.getElementById('product-list-container');
        const backToListBtn = document.getElementById('back-to-list-btn');
        const formTitle = document.getElementById('form-title');
        const productListEl = document.getElementById('product-list');
        const searchInput = document.getElementById('search-product-input');
        const newProductBtn = document.getElementById('new-product-btn');
        const saveBtn = document.getElementById('save-btn');
        const deleteBtn = document.getElementById('delete-btn');
        const suggestSkuBtn = document.getElementById('suggest-sku-btn');
        const skuInput = document.getElementById('sku');
        const categorySelect = document.getElementById('category-select');
        const categoryCustomInput = document.getElementById('category-custom');
        const brandSelect = document.getElementById('brand-select');
        const brandCustomInput = document.getElementById('brand-custom');
        const barcodeInput = document.getElementById('barcode');
        const scanBarcodeBtn = document.getElementById('scan-barcode-btn');
        const scanSearchBtn = document.getElementById('scan-search-btn');
        const clearSearchBtn = document.getElementById('clear-search-btn'); // <-- Añadir esta línea
        const scannerContainer = document.getElementById('scanner-container');
        const closeScannerBtn = document.getElementById('close-scanner-btn');
        const imagePreviewModal = document.getElementById('image-preview-modal');
        const previewImage = document.getElementById('preview-image');
        const closePreviewBtn = document.getElementById('close-preview-btn');
        const imageUrlList = document.getElementById('image-url-list');
        const processUrlsBtn = document.getElementById('process-urls-btn');
        const imageSortableList = document.getElementById('image-sortable-list');
        const singleImageInputsContainer = document.getElementById('single-image-inputs-container');
        const addSingleUrlFieldBtn = document.getElementById('add-single-url-field-btn');
        const csvFileInput = document.getElementById('csv-file-input');
        const importCsvBtn = document.getElementById('import-csv-btn');
        const csvLogs = document.getElementById('csv-logs');

        // La URL de la API ya está definida globalmente (API_BASE_URL)
        const API_URL = `${API_BASE_URL}/products`; // Endpoint RESTful de productos

        // --- FUNCTIONS ---
        
        const showNotification = (message, type = 'success') => {
            const banner = document.getElementById('notification-banner');
            const messageSpan = document.getElementById('notification-message');
            if (!banner || !messageSpan) return;

            messageSpan.textContent = message;
            
            // 1. Limpiar clases de color antiguas
            banner.classList.remove('bg-green-600', 'bg-red-600');
            
            // 2. Añadir la nueva clase de color
            banner.classList.add(type === 'success' ? 'bg-green-600' : 'bg-red-600');
            
            // 3. Mostrar el banner (quitando la clase que lo oculta)
            banner.classList.remove('-translate-y-[120%]');
            
            // 4. Ocultar el banner después de 4 segundos
            setTimeout(() => {
                banner.classList.add('-translate-y-[120%]');
                
                // 5. Opcional: Limpiar la clase de color después de que termine la animación de salida (500ms)
                setTimeout(() => {
                    banner.classList.remove('bg-green-600', 'bg-red-600');
                }, 500); // Debe coincidir con la duración de la transición (duration-500)
                
            }, 4000);
        };

        // Modificamos handleSearch para que también controle la visibilidad del botón 'x'
        const handleSearch = () => {
            const searchTerm = searchInput.value;
            renderProductList(allProducts); // Esta función ya usa el valor de searchInput

            // Mostrar u ocultar el botón de limpiar
            if (clearSearchBtn) {
                clearSearchBtn.classList.toggle('hidden', searchTerm.length === 0);
            }
        };

        function suggestSku() {
            const prefix = "ASP";
            let maxNumber = 0;
            allProducts.forEach(product => {
                if (product.sku && product.sku.toUpperCase().startsWith(prefix)) {
                    const numberPart = parseInt(product.sku.substring(prefix.length), 10);
                    if (!isNaN(numberPart) && numberPart > maxNumber) maxNumber = numberPart;
                }
            });
            skuInput.value = `${prefix}${maxNumber + 1}`;
        }

        function startScanner(target) {
            currentScannerTarget = target;
            scannerContainer.classList.remove('hidden');
            scannerContainer.classList.add('flex');

            if (!html5QrCode) {
                html5QrCode = new Html5Qrcode("reader");
            }

            const qrCodeSuccessCallback = (decodedText, decodedResult) => {
                if (currentScannerTarget === 'barcode') {
                    barcodeInput.value = decodedText;
                } else if (currentScannerTarget === 'search') {
                    searchInput.value = decodedText;
                    handleSearch();
                }
                stopScanner();
            };

            const config = { fps: 10, qrbox: { width: 250, height: 250 } };
            html5QrCode.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
                .catch(err => console.log(`Unable to start scanning, error: ${err}`));
        }

        function stopScanner() {
            if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().then(() => {}).catch(err => {});
            }
            scannerContainer.classList.add('hidden');
            scannerContainer.classList.remove('flex');
        }

        function openImagePreview(imageUrl) {
            if (imageUrl && !imageUrl.includes('placehold.co')) {
                previewImage.src = imageUrl;
                imagePreviewModal.classList.remove('hidden');
            }
        }


        function closeImagePreview() {
            imagePreviewModal.classList.add('hidden');
            previewImage.src = '';
        }

        const handleCsvUpload = () => {
            const file = csvFileInput.files[0];
            if (!file) {
                showNotification('Por favor, selecciona un archivo CSV.', 'error');
                return;
            }

            importCsvBtn.disabled = true;
            importCsvBtn.textContent = 'Importando...';
            const logContainer = csvLogs.querySelector('pre');
            csvLogs.classList.remove('hidden');
            logContainer.textContent = 'Procesando archivo...\n';

            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: async (results) => {
                    logContainer.textContent += `Archivo CSV leído. ${results.data.length} filas encontradas.\n`;
                    
                    const products = results.data.map(row => {
                        // Limpiar y validar datos de la fila
                        const cleanedRow = {};
                        for (const key in row) {
                            const value = row[key];
                            cleanedRow[key] = (value === "" || value === undefined) ? null : value;
                        }
                        return cleanedRow;
                    }).filter(p => p.sku || p.name); // Filtrar filas sin SKU o nombre

                    if (products.length === 0) {
                        logContainer.textContent += `No se encontraron productos válidos para importar.\n`;
                        showNotification('El archivo CSV no contiene productos válidos.', 'error');
                        importCsvBtn.disabled = false;
                        importCsvBtn.textContent = 'Importar CSV';
                        return;
                    }


                    logContainer.textContent += `Enviando ${products.length} productos al servidor...\n`;
                    try {
                         // Esta es la llamada a tu función de backend products-batch.js
                        const response = await fetch(`${API_BASE_URL}/products-batch`, {
                            method: 'POST',
                            body: JSON.stringify({ products }),
                            headers: { 'Content-Type': 'application/json' }
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.message || 'Error en el servidor');
                        
                        logContainer.textContent += `Proceso completado con éxito.\n`;
                        logContainer.textContent += `- ${result.details}\n`;
                        showNotification(result.message, 'success');
                        await fetchAndRenderProducts(); // Refresh list
                    } catch (error) {
                        logContainer.textContent += `Error en el servidor: ${error.message}\n`;
                        showNotification('Hubo un error al importar el CSV.', 'error');
                    } finally {
                        importCsvBtn.disabled = false;
                        importCsvBtn.textContent = 'Importar CSV';
csvFileInput.value = '';
                    }
                },
                error: (error) => {
                    logContainer.textContent += `Error al leer el archivo CSV: ${error.message}\n`;
                    showNotification('No se pudo leer el archivo CSV.', 'error');
                    importCsvBtn.disabled = false;
                    importCsvBtn.textContent = 'Importar CSV';
                }
            });
        };

        // --- EVENT LISTENERS ---
        productForm.addEventListener('submit', handleFormSubmit);

        newProductBtn.addEventListener('click', () => {
            resetForm();
            if (window.innerWidth < 1024) {
                productListContainer.classList.add('hidden');
                productFormContainer.classList.remove('hidden');
                productFormContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                backToListBtn.classList.remove('hidden');
            }
        });

        deleteBtn.addEventListener('click', handleDelete);
        searchInput.addEventListener('input', handleSearch);
        suggestSkuBtn.addEventListener('click', suggestSku);
        scanBarcodeBtn.addEventListener('click', () => startScanner('barcode'));
        scanSearchBtn.addEventListener('click', () => startScanner('search'));
        closeScannerBtn.addEventListener('click', stopScanner);

        // --- NUEVO: Event listener para el botón de limpiar ---
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = ''; // Limpiar el input
                handleSearch();         // Ejecutar la búsqueda (que mostrará todo y ocultará la 'x')
                searchInput.focus();      // Devolver el foco al input
            });
        }
        // --- Fin del nuevo listener ---

        productListEl.addEventListener('click', (event) => {
            const productElement = event.target.closest('[data-id]');
            if (productElement) {
                // ParseInt para asegurar que el ID es un número
                populateFormForEdit(parseInt(productElement.dataset.id, 10));
            }
        });

        backToListBtn.addEventListener('click', () => {
            resetForm();
            productListContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        processUrlsBtn.addEventListener('click', () => {
            const urls = imageUrlList.value.split(',')
                .map(url => convertGoogleDriveUrl(url.trim()))
                .filter(url => url);
            urls.forEach(url => addUrlToSorter(url));
            imageUrlList.value = '';
        });

        addSingleUrlFieldBtn.addEventListener('click', createNewSingleImageInput);

        closePreviewBtn.addEventListener('click', closeImagePreview);
        imagePreviewModal.addEventListener('click', (e) => {
            if (e.target === imagePreviewModal) {
                closeImagePreview();
            }
        });

        categorySelect.addEventListener('change', (e) => {
            categoryCustomInput.classList.toggle('hidden', e.target.value !== 'custom');
            if (e.target.value === 'custom') categoryCustomInput.focus();
        });

        brandSelect.addEventListener('change', (e) => {
            brandCustomInput.classList.toggle('hidden', e.target.value !== 'custom');
            if (e.target.value === 'custom') brandCustomInput.focus();
        });

        csvFileInput.addEventListener('change', () => {
             importCsvBtn.disabled = !csvFileInput.files.length;
        });

        importCsvBtn.addEventListener('click', handleCsvUpload);

        // --- INITIALIZATION ---
        fetchAndRenderProducts(); // Carga productos cuando la lógica del admin inicia
        createNewSingleImageInput(); // Create the first single image input
        sortable = new Sortable(imageSortableList, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: function () {
                updateImageNumbers();
            }
        });

        // Set initial view for mobile
        if (window.innerWidth < 1024) {
            productFormContainer.classList.add('hidden');
            productListContainer.classList.remove('hidden');
        }
    }
});





