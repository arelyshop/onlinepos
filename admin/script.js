document.addEventListener('DOMContentLoaded', () => {
    // La lógica del panel de administración se inicializa directamente
    initializeAdminLogic();

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


        const API_URL = '/.netlify/functions/products'; // RESTful endpoint

        // --- FUNCTIONS ---
        
        const showNotification = (message, type = 'success') => {
            const banner = document.getElementById('notification-banner');
            const messageSpan = document.getElementById('notification-message');
            if (!banner || !messageSpan) return;

            messageSpan.textContent = message;
            banner.className = 'fixed top-5 left-1/2 -translate-x-1/2 w-full max-w-md p-4 text-white text-center z-50 rounded-lg shadow-lg'; // Reset classes
            
            if (type === 'success') {
                banner.classList.add('bg-green-600');
            } else {
                banner.classList.add('bg-red-600');
            }
            
            banner.style.transform = 'translateY(0)';
            
            setTimeout(() => {
                banner.style.transform = 'translateY(-120%)';
            }, 4000);
        };


        const updateImageNumbers = () => {
            const imageItems = imageSortableList.querySelectorAll('div[data-url]');
            imageItems.forEach((item, index) => {
                const numberEl = item.querySelector('.image-number');
                if (numberEl) {
                    numberEl.textContent = `${index + 1}.`;
                }
            });
        };

        function convertGoogleDriveUrl(url) {
            if (!url) return '';
            const regex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
            const match = url.match(regex);
            return (match && match[1]) ? `https://lh3.googleusercontent.com/d/${match[1]}=w1000?authuser=0` : url;
        }

        const addUrlToSorter = (url) => {
            if (!url) return;
            const existingUrls = Array.from(imageSortableList.querySelectorAll('div[data-url]')).map(div => div.dataset.url);
            if (existingUrls.includes(url)) {
                showNotification('Esta URL ya ha sido agregada.', 'error');
                return;
            }

            const div = document.createElement('div');
            div.className = 'flex items-center space-x-2 p-2 bg-gray-600 rounded-md';
            div.dataset.url = url;

            div.innerHTML = `
                <span class="image-number text-sm font-semibold text-gray-400 w-5 text-center"></span>
                <svg class="w-5 h-5 text-gray-400 drag-handle" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                <img src="${url}" onerror="this.onerror=null;this.src='https://placehold.co/40x40/1f2937/9ca3af?text=Err';" class="w-10 h-10 rounded-md object-cover bg-gray-700 cursor-pointer hover:opacity-80 transition-opacity">
                <p class="flex-grow text-sm text-gray-300 truncate">${url}</p>
                <button type="button" class="text-xl text-red-400 hover:text-red-300 remove-image-btn">&times;</button>
            `;

            div.querySelector('img').addEventListener('click', () => openImagePreview(url));
            div.querySelector('.remove-image-btn').addEventListener('click', () => {
                div.remove();
                updateImageNumbers();
            });

            imageSortableList.appendChild(div);
            updateImageNumbers();
        };

        const createNewSingleImageInput = () => {
            const wrapper = document.createElement('div');
            wrapper.className = 'flex items-center space-x-2 single-url-wrapper';

            wrapper.innerHTML = `
                <input type="url" class="w-full px-3 py-2 bg-gray-600 border border-gray-500 text-white rounded-lg" placeholder="Pegar URL y hacer clic en Guardar">
                <button type="button" class="text-sm bg-green-600 text-white font-bold p-2 rounded-lg hover:bg-green-700 transition-colors save-single-url-btn">Guardar</button>
                <button type="button" class="text-xl text-red-500 font-bold p-1 rounded-lg hover:bg-red-700 transition-colors remove-single-url-btn">&times;</button>
            `;

            const input = wrapper.querySelector('input');
            const saveBtn = wrapper.querySelector('.save-single-url-btn');
            const removeBtn = wrapper.querySelector('.remove-single-url-btn');

            const saveUrlAction = () => {
                const url = convertGoogleDriveUrl(input.value.trim());
                if (url) {
                    addUrlToSorter(url);
                    input.value = ''; // Clear input after adding
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveUrlAction();
                }
            });

            saveBtn.addEventListener('click', saveUrlAction);
            removeBtn.addEventListener('click', () => wrapper.remove());

            singleImageInputsContainer.appendChild(wrapper);
            input.focus();
        };

        const fetchAndRenderProducts = async () => {
            try {
                productListEl.innerHTML = '<p class="text-gray-400">Cargando productos...</p>';
                const response = await fetch(API_URL); // GET request
                if (!response.ok) throw new Error('Failed to fetch products');
                const result = await response.json();
                if (result.status === 'success') {
                    allProducts = result.data;
                    renderProductList(allProducts);
                } else {
                    throw new Error(result.message || 'Error from server');
                }
            } catch (error) {
                console.error('Error fetching products:', error);
                productListEl.innerHTML = `<p class="text-red-500">Error al cargar productos.</p>`;
                showNotification('Error al cargar productos. Revisa la conexión y la consola.', 'error');
            }
        };

        const renderProductList = (products) => {
            const searchTerm = searchInput.value.toLowerCase().trim();
            const filteredProducts = products.filter(p =>
                p.name.toLowerCase().includes(searchTerm) ||
                (p.sku && p.sku.toLowerCase().includes(searchTerm)) ||
                (p.barcode && p.barcode.toLowerCase().includes(searchTerm))
            );

            if (filteredProducts.length === 0) {
                productListEl.innerHTML = '<p class="text-gray-500">No se encontraron productos.</p>';
                return;
            }

            productListEl.innerHTML = filteredProducts.map(product => `
                <div class="flex items-center justify-between p-3 mb-2 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors ${product.id === currentProductId ? 'bg-blue-900' : 'bg-gray-800'}" data-id="${product.id}">
                    <div class="flex-grow">
                        <p class="font-semibold text-white">${product.name}</p>
                        <p class="text-sm text-gray-400">SKU: ${product.sku || 'N/A'}</p>
                    </div>
                    <div class="text-sm text-gray-300">Stock: ${product.stock || 0}</div>
                </div>
            `).join('');
        };

        const populateFormForEdit = (productId) => {
            const product = allProducts.find(p => p.id === productId);
            if (!product) return;
            resetForm();
            currentProductId = productId;
            productForm.elements['id'].value = product.id;

            for (const key in product) {
                if (productForm.elements[key]) {
                    productForm.elements[key].value = product[key] ?? '';
                }
            }
            
            if (product.ciudad_sucursal) {
                productForm.elements['ciudad_sucursal'].value = product.ciudad_sucursal;
            }

            const imageUrls = [];
            for (let i = 1; i <= 8; i++) {
                if (product[`photo_url_${i}`]) { imageUrls.push(product[`photo_url_${i}`]); }
            }
            imageSortableList.innerHTML = '';
            imageUrls.forEach(url => addUrlToSorter(url));

            const categoryOptionExists = [...categorySelect.options].some(opt => opt.value === product.category);
            if (product.category && categoryOptionExists) {
                categorySelect.value = product.category;
                categoryCustomInput.classList.add('hidden');
            } else if (product.category) {
                categorySelect.value = 'custom';
                categoryCustomInput.value = product.category;
                categoryCustomInput.classList.remove('hidden');
            }
            const brandOptionExists = [...brandSelect.options].some(opt => opt.value === product.brand);
            if (product.brand && brandOptionExists) {
                brandSelect.value = product.brand;
                brandCustomInput.classList.add('hidden');
            } else if (product.brand) {
                brandSelect.value = 'custom';
                brandCustomInput.value = product.brand;
                brandCustomInput.classList.remove('hidden');
            }
            formTitle.textContent = 'Editar Producto';
            saveBtn.textContent = 'Guardar Cambios';
            deleteBtn.classList.remove('hidden');
            renderProductList(allProducts);

            if (window.innerWidth < 1024) {
                productListContainer.classList.add('hidden');
                productFormContainer.classList.remove('hidden');
                productFormContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                backToListBtn.classList.remove('hidden');
            }
        };

        const resetForm = () => {
            productForm.reset();
            currentProductId = null;
            formTitle.textContent = 'Agregar Nuevo Producto';
            saveBtn.textContent = 'Guardar Producto';
            deleteBtn.classList.add('hidden');
            categoryCustomInput.classList.add('hidden');
            brandCustomInput.classList.add('hidden');
            imageSortableList.innerHTML = '';
            singleImageInputsContainer.innerHTML = '';
            createNewSingleImageInput();
            imageUrlList.value = '';
            renderProductList(allProducts);

            if (window.innerWidth < 1024) {
                productFormContainer.classList.add('hidden');
                productListContainer.classList.remove('hidden');
            }
            backToListBtn.classList.add('hidden');
        };

        const handleFormSubmit = async (event) => {
            event.preventDefault();
            saveBtn.disabled = true;
            saveBtn.textContent = 'Guardando...';

            const formData = new FormData(productForm);
            const productData = Object.fromEntries(formData.entries());

            const imageItems = imageSortableList.querySelectorAll('div[data-url]');
            for (let i = 0; i < 8; i++) {
                productData[`photo_url_${i + 1}`] = imageItems[i] ? imageItems[i].dataset.url : null;
            }

            productData.category = categorySelect.value === 'custom' ? categoryCustomInput.value : categorySelect.value;
            productData.brand = brandSelect.value === 'custom' ? brandCustomInput.value : brandSelect.value;
            delete productData['category-select'];
            delete productData['category-custom'];
            delete productData['brand-select'];
            delete productData['brand-custom'];

            const numericFields = ['sale_price', 'discount_price', 'purchase_price', 'wholesale_price', 'stock'];
            numericFields.forEach(field => {
                productData[field] = productData[field] === '' ? null : Number(productData[field]);
            });
            
            const isUpdating = !!productData.id;
            const method = isUpdating ? 'PUT' : 'POST';

            try {
                const response = await fetch(API_URL, {
                    method,
                    body: JSON.stringify({ data: productData }),
                    headers: { 'Content-Type': 'application/json' }
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(JSON.parse(errorText).message || errorText);
                }
                showNotification(`¡Producto ${isUpdating ? 'actualizado' : 'agregado'} con éxito!`, 'success');
                await fetchAndRenderProducts();
                setTimeout(() => {
                    resetForm();
                    if (window.innerWidth < 1024) {
                        productListContainer.scrollIntoView({ behavior: 'smooth' });
                    }
                }, 1500);
            } catch (error) {
                console.error('Error saving product:', error);
                showNotification(`Error: ${error.message}`, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = isUpdating ? 'Guardar Cambios' : 'Guardar Producto';
            }
        };

        const handleDelete = async () => {
            const productIdToDelete = document.getElementById('id').value;
            if (!productIdToDelete || !confirm('¿Estás seguro de que quieres eliminar este producto? Esta acción no se puede deshacer.')) return;
            deleteBtn.disabled = true;
            deleteBtn.textContent = 'Eliminando...';
            try {
                const response = await fetch(API_URL, {
                    method: 'DELETE',
                    body: JSON.stringify({ id: productIdToDelete }),
                    headers: { 'Content-Type': 'application/json' },
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Server error');
                }
                const result = await response.json();
                showNotification(result.message || 'Producto eliminado.', 'success');
                await fetchAndRenderProducts();
                setTimeout(() => {
                    resetForm();
                    if (window.innerWidth < 1024) {
                        productListContainer.scrollIntoView({ behavior: 'smooth' });
                    }
                }, 1500);
            } catch (error) {
                console.error('Error deleting product:', error);
                showNotification(`Error: ${error.message}`, 'error');
            } finally {
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Eliminar Producto';
            }
        };

        const handleSearch = () => renderProductList(allProducts);

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
                        const response = await fetch('/.netlify/functions/products-batch', {
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

        productListEl.addEventListener('click', (event) => {
            const productElement = event.target.closest('[data-id]');
            if (productElement) {
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
        fetchAndRenderProducts();
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

