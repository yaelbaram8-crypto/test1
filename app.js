/**
 * Family Shopping App - Core Logic
 * No-Build Architecture using ES Modules
 */

// Supabase configuration is injected from app-config.js (gitignored).
const APP_CONFIG = (typeof window !== 'undefined' && window.APP_CONFIG) ? window.APP_CONFIG : {};
const SUPABASE_URL = APP_CONFIG.SUPABASE_URL || 'https://your-project-id.supabase.co';
const SUPABASE_KEY = APP_CONFIG.SUPABASE_KEY || 'your-publishable-key';

class ShoppingApp {
    constructor() {
        this.items = [];
        this.categories = {
            'fruits_veg': { name: 'ירקות ופירות', emoji: '🥦', items: ['עגבניה', 'מלפפון', 'בצל', 'תפוח', 'בננה', 'חסה', 'גזר', 'פלפל', 'פטריות', 'תפו"א', 'לימון', 'אבוקדו'] },
            'dairy': { name: 'מוצרי חלב וביצים', emoji: '🧀', items: ['חלב', 'גבינה', 'קוטג\'', 'יוגורט', 'ביצים', 'חמאה', 'שמנת', 'צהובה', 'מעדן'] },
            'meat': { name: 'בשר ודגים', emoji: '🥩', items: ['עוף', 'בשר', 'דג', 'נקניקיות', 'המבורגר', 'שניצל', 'טחון'] },
            'bakery': { name: 'מאפה ולחם', emoji: '🥖', items: ['לחם', 'פיתות', 'לחמניות', 'חלה', 'עוגה', 'עוגיות', 'לחם קל'] },
            'dry_goods': { name: 'מוצרים יבשים', emoji: '🍝', items: ['פסטה', 'אורז', 'קוסקוס', 'קמח', 'סוכר', 'שמן', 'שימורים', 'קטניות', 'מלח'] },
            'cleaning': { name: 'ניקיון וטיפוח', emoji: '🧼', items: ['נייר טואלט', 'סבון', 'שמפו', 'נוזל כלים', 'אבקת כביסה', 'מרכך', 'מגבונים'] },
            'snacks': { name: 'חטיפים ושתייה', emoji: '🍿', items: ['במבה', 'ביסלי', 'צ\'יפס', 'קוקה קולה', 'מיץ', 'מים', 'קפה', 'תה', 'בירה', 'יין'] }
        };

        this.viewMode = 'category'; // 'category' | 'all'
        this.selectedCatalogProduct = null; // מוצר שנבחר מהקטלוג בעת הוספה

        // Initialize Supabase if keys provided
        if (SUPABASE_URL !== 'https://your-project-id.supabase.co') {
            this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }

        this.priceModule = new PriceCompareModule();
        this.init();
    }


    async init() {
        this.cacheDom();
        this.bindEvents();
        await this.fetchItems();
        this.setupRealtime();
        this.render();
        this.priceModule.init(this.supabase);
        console.log("🚀 Shopping App Initialized with Supabase");
    }


    cacheDom() {
        this.itemInput = document.getElementById('item-input');
        this.qtyInput = document.getElementById('qty-input');
        this.addBtn = document.getElementById('add-item-btn');
        this.listContainer = document.getElementById('shopping-list-container');
        this.statsContainer = document.getElementById('stats-container');
        this.historyContainer = document.getElementById('history-container');
        this.suggestionsContainer = document.getElementById('smart-suggestions-container');
        this.scanBtn = document.getElementById('scan-receipt-btn');
        this.optimizeBtn = document.getElementById('optimize-cart-btn');
        this.fileInput = document.getElementById('receipt-upload');
        this.clearBtn = document.getElementById('clear-list-btn');
        this.viewToggleBtn = document.getElementById('view-toggle-btn');
    }

    bindEvents() {
        this.addBtn.addEventListener('click', () => this.addItem());
        this.itemInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addItem();
        });

        // Catalog autocomplete
        this._catalogDebounce = null;
        this.itemInput.addEventListener('input', () => {
            this.selectedCatalogProduct = null; // איפוס בחירה קיימת בעת הקלדה חדשה
            const q = this.itemInput.value.trim();
            clearTimeout(this._catalogDebounce);
            if (q.length < 2) { this._closeCatalogDropdown(); return; }
            this._catalogDebounce = setTimeout(() => this._showCatalogDropdown(q), 300);
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.add-item-section')) this._closeCatalogDropdown();
        });

        // Quantity +/-
        document.getElementById('qty-plus').addEventListener('click', () => {
            this.qtyInput.value = Math.min(99, parseInt(this.qtyInput.value || 1) + 1);
        });
        document.getElementById('qty-minus').addEventListener('click', () => {
            this.qtyInput.value = Math.max(1, parseInt(this.qtyInput.value || 1) - 1);
        });

        // Clear all
        this.clearBtn.addEventListener('click', () => this.clearList());

        // View toggle
        this.viewToggleBtn.addEventListener('click', () => {
            this.viewMode = this.viewMode === 'category' ? 'all' : 'category';
            this.viewToggleBtn.querySelector('.icon').textContent =
                this.viewMode === 'category' ? '📌' : '📋';
            this.render();
        });

        // Price Intelligence Trigger
        if (this.optimizeBtn) {
            this.optimizeBtn.addEventListener('click', () => this.optimizeCartPrices());
        }

        // OCR Scan Trigger
        this.scanBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleReceiptUpload(e));

        // Tab switching
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const view = btn.dataset.view;
                this.switchView(view);
            });
        });
    }

    switchView(viewName) {
        document.querySelectorAll('.view-section').forEach(sect => sect.style.display = 'none');
        document.querySelector('.add-item-section').style.display = viewName === 'list' ? 'block' : 'none';

        if (viewName === 'list') {
            this.listContainer.style.display = 'block';
            if (this.suggestionsContainer.innerHTML.trim() !== '') {
                this.suggestionsContainer.style.display = 'block';
            }
            this.render();
        } else if (viewName === 'stats') {
            this.statsContainer.style.display = 'block';
            this.suggestionsContainer.style.display = 'none';
            this.renderStats();
        } else if (viewName === 'history') {
            this.historyContainer.style.display = 'block';
            this.suggestionsContainer.style.display = 'none';
            this.renderHistory();
        } else if (viewName === 'prices') {
            document.getElementById('prices-container').style.display = 'block';
            this.suggestionsContainer.style.display = 'none';
            this.priceModule.show();
        }
    }

    async fetchItems() {
        if (!this.supabase) {
            this.loadLocalData();
            return;
        }

        const { data, error } = await this.supabase
            .from('shopping_items')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching items:", error);
            this.loadLocalData();
        } else {
            // שמר priceData קיים (לא נשמר ב-DB) לפי id ולפי טקסט
            const priceCache = new Map();
            this.items.forEach(i => { if (i.priceData) priceCache.set(i.id, i.priceData); });
            this.items = (data || []).map(i => ({
                ...i,
                priceData: priceCache.get(i.id) || null
            }));
        }
    }

    setupRealtime() {
        if (!this.supabase) return;

        this.supabase
            .channel('public:shopping_items')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, () => {
                this.fetchItems().then(() => this.render());
            })
            .subscribe();
    }

    loadLocalData() {
        const saved = localStorage.getItem('shopping_list_items');
        if (saved) {
            this.items = JSON.parse(saved);
        }
    }

    saveLocalData() {
        if (!this.supabase) {
            localStorage.setItem('shopping_list_items', JSON.stringify(this.items));
        }
    }


    async handleReceiptUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.setLoading(true, "סורק קבלה... רק רגע");

        try {
            // Tesseract.js OCR
            const worker = await Tesseract.createWorker('heb');
            const { data: { text } } = await worker.recognize(file);
            await worker.terminate();

            // Refined Parser: Identify items vs prices
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
            const foundItems = [];

            lines.forEach(line => {
                // Ignore lines that are just dates or total numbers
                if (line.match(/\d{2}[\/.]\d{2}[\/.]\d{2}/)) return;

                // Try to separate name from price (e.g. "חלב 5.90")
                const priceMatch = line.match(/(\d+\.\d{2})/);
                let itemName = line;
                if (priceMatch) {
                    itemName = line.replace(priceMatch[0], '').trim();
                }

                // Filter out common receipt junk
                if (itemName.length > 2 && !itemName.match(/^[0-9*]+$/)) {
                    foundItems.push(itemName);
                }
            });

            if (foundItems.length > 0) {
                for (const item of foundItems) {
                    await this.addItem(item, false);
                }
                alert(`זוהו ${foundItems.length} פריטים מהקבלה!`);
                if (this.supabase) await this.fetchItems();
                this.render();
            } else {
                alert("לא הצלחנו לזהות פריטים ברורים. נסו לצלם שוב בסיבת תאורה טובה יותר.");
            }
        } catch (error) {
            console.error("OCR Error:", error);
            alert("שגיאה בסריקת הקבלה. וודאו שיש חיבור לאינטרנט לטעינת המנוע.");
        } finally {
            this.setLoading(false);
            this.fileInput.value = '';
        }
    }


    async optimizeCartPrices() {
        const activeItems = this.items.filter(i => !i.completed);
        if (activeItems.length === 0) {
            alert("הוסיפו פריטים כדי להשוות מחירים.");
            return;
        }

        if (this.optimizeBtn) this.optimizeBtn.innerHTML = '<span style="font-size:18px;">⏳</span>';

        if (this.supabase && navigator.onLine) {
            // מחירים אמיתיים מ-Supabase — חיפוש + מחיר הזול לכל פריט
            for (const item of activeItems) {
                try {
                    const { data: found } = await this.supabase.rpc('search_products', {
                        query_text: item.text, result_limit: 1
                    });
                    if (found?.length) {
                        const { data: prices } = await this.supabase.rpc('get_product_prices', {
                            p_product_id: found[0].id
                        });
                        if (prices?.length) {
                            item.priceData = {
                                chain: prices[0].chain_name,
                                price: parseFloat(prices[0].price)
                            };
                        }
                    }
                } catch (e) {
                    console.warn(`price lookup failed for "${item.text}":`, e.message);
                }
            }
            this.items = [...this.items];
        } else {
            // fallback: mock (אין Supabase או offline)
            const chains = ["שופרסל", "רמי לוי", "יוחננוף", "ויקטורי"];
            this.items = this.items.map(item => {
                if (!item.completed) {
                    item.priceData = {
                        chain: chains[Math.floor(Math.random() * chains.length)],
                        price: parseFloat((Math.random() * 10 + 3).toFixed(2))
                    };
                }
                return item;
            });
        }

        if (this.optimizeBtn) this.optimizeBtn.innerHTML = '<span class="icon">💰</span>';
        this.render();
    }

    setLoading(isLoading, message = "") {
        if (isLoading) {
            this.scanBtn.disabled = true;
            this.scanBtn.innerHTML = `<span class="spinner">⏳</span>`;
            // Optional: add a global loader overlay
        } else {
            this.scanBtn.disabled = false;
            this.scanBtn.innerHTML = `<span class="icon">📸</span>`;
        }
    }

    async addItem(manualText = null, manualQty = 1, shouldRender = true) {
        const text = manualText || this.itemInput.value.trim();
        const qty = manualText ? manualQty : parseInt(this.qtyInput.value || 1);
        if (!text) return;

        // Duplicate detection
        const existing = this.items.find(i =>
            i.text.trim().toLowerCase() === text.trim().toLowerCase() && !i.completed
        );
        if (existing) {
            const newQty = (existing.quantity || 1) + qty;
            await this.updateQuantity(existing.id, newQty);
            if (manualText === null) { this.itemInput.value = ''; this.qtyInput.value = 1; }
            return;
        }

        const categoryId = this.detectCategory(text);
        const newItem = { text, completed: false, category_id: categoryId, quantity: qty };

        // שמור מחיר אם נבחר מהקטלוג
        const catalogProduct = this.selectedCatalogProduct;
        this.selectedCatalogProduct = null;
        this._closeCatalogDropdown();

        const optimisticItem = { ...newItem, id: 'temp-' + Date.now(), created_at: new Date().toISOString() };
        if (catalogProduct?.cheapest) {
            optimisticItem.priceData = {
                chain: catalogProduct.cheapest.chain_name,
                price: parseFloat(catalogProduct.cheapest.price),
                catalogLinked: true
            };
        }

        // Optimistic update
        this.items.unshift(optimisticItem);
        if (shouldRender) this.render();

        if (this.supabase) {
            const { error } = await this.supabase.from('shopping_items').insert([newItem]);
            if (error) console.error('Error adding item:', error);
            else this.fetchItems(); // fetch real IDs assigned by Postgres
        } else {
            this.saveLocalData();
        }

        if (manualText === null) { this.itemInput.value = ''; this.qtyInput.value = 1; }
    }


    async _showCatalogDropdown(query) {
        const dropdown = document.getElementById('catalog-dropdown');
        if (!dropdown) return;
        if (!this.supabase) { dropdown.innerHTML = ''; return; }

        const { data: products } = await this.supabase.rpc('search_products', {
            query_text: query, result_limit: 8
        });
        if (!products?.length) { dropdown.innerHTML = ''; return; }

        // שלוף מחיר זול לכל מוצר
        const rows = await Promise.all(products.map(async p => {
            const { data: prices } = await this.supabase.rpc('get_product_prices', {
                p_product_id: p.id
            });
            const cheapest = prices?.[0];
            return { ...p, cheapest };
        }));

        dropdown.innerHTML = rows.map(p => `
            <div class="catalog-option" data-id="${p.id}">
                <span class="catalog-option-name">${p.product_name}</span>
                ${p.cheapest
                    ? `<span class="catalog-option-price">✨ ₪${Number(p.cheapest.price).toFixed(2)} ב${p.cheapest.chain_name}</span>`
                    : `<span class="catalog-option-free">ללא מחיר</span>`}
            </div>
        `).join('');

        dropdown.querySelectorAll('.catalog-option').forEach(el => {
            el.addEventListener('click', () => {
                const product = rows.find(p => p.id === el.dataset.id);
                this.itemInput.value = product.product_name;
                this.selectedCatalogProduct = product;
                this._closeCatalogDropdown();
            });
        });
    }

    _closeCatalogDropdown() {
        const dropdown = document.getElementById('catalog-dropdown');
        if (dropdown) dropdown.innerHTML = '';
    }

    detectCategory(text) {
        for (const [id, cat] of Object.entries(this.categories)) {
            if (cat.items.some(keyword => text.includes(keyword))) {
                return id;
            }
        }
        return 'other'; // Unknown category
    }

    async toggleItem(id) {
        const item = this.items.find(i => i.id === id);
        if (!item) return;

        // Optimistic update
        this.items = this.items.map(i => i.id === id ? { ...i, completed: !i.completed } : i);
        this.render();

        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .update({ completed: !item.completed })
                .eq('id', id);
            if (error) console.error('Error toggling item:', error);
        } else {
            this.saveLocalData();
        }
    }

    async deleteItem(id) {
        // Optimistic update
        this.items = this.items.filter(item => item.id !== id);
        this.render();

        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .delete()
                .eq('id', id);
            if (error) console.error('Error deleting item:', error);
        } else {
            this.saveLocalData();
        }
    }

    async updateQuantity(id, newQty) {
        if (newQty < 1) { await this.deleteItem(id); return; }
        
        // Optimistic update
        this.items = this.items.map(i => i.id === id ? { ...i, quantity: newQty } : i);
        this.render();

        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .update({ quantity: newQty })
                .eq('id', id);
            if (error) console.error('Error updating quantity:', error);
        } else {
            this.saveLocalData();
        }
    }

    async clearList() {
        if (!confirm('למחוק את כל הפריטים ברשימה?')) return;
        
        // Optimistic update
        this.items = [];
        this.render();

        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
            if (error) console.error('Error clearing list:', error);
        } else {
            this.saveLocalData();
        }
    }


    render() {
        if (this.items.length === 0) {
            this.listContainer.innerHTML = `
                <div class="empty-state">
                    <p>הרשימה ריקה. זמן למלא את המקרר! ✨</p>
                </div>
            `;
            return;
        }

        const itemRow = (item) => `
            <div class="list-item ${item.completed ? 'completed' : ''}" data-id="${item.id}">
                <div class="item-main" onclick="window.app.toggleItem('${item.id}')">
                    <div class="checkbox"></div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <span class="item-text">${item.text}</span>
                        ${item.priceData && !item.completed ? `<span style="font-size:0.75rem; color:#10b981; font-weight:600;">✨ הכי זול ב${item.priceData.chain}: ₪${item.priceData.price}</span>` : ''}
                    </div>
                </div>
                <div class="item-controls">
                    <div class="qty-inline">
                        <button class="qty-btn-sm" onclick="window.app.updateQuantity('${item.id}', ${(item.quantity || 1) - 1})">\u2212</button>
                        <span class="qty-badge">${item.quantity || 1}</span>
                        <button class="qty-btn-sm" onclick="window.app.updateQuantity('${item.id}', ${(item.quantity || 1) + 1})">+</button>
                    </div>
                    <button class="delete-btn" onclick="window.app.deleteItem('${item.id}')">
                        <span class="icon">\ud83d\uddd1\ufe0f</span>
                    </button>
                </div>
            </div>
        `;

        if (this.viewMode === 'all') {
            // Flat list view - all items sorted: pending first, completed last
            const sorted = [...this.items].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
            this.listContainer.innerHTML = `
                <div class="category-group">
                    <h2 class="category-title">\ud83d\udccb \u05db\u05dc \u05d4\u05e4\u05e8\u05d9\u05d8\u05d9\u05dd (${sorted.length})</h2>
                    ${sorted.map(item => itemRow(item)).join('')}
                </div>`;
        } else {
            // Group by categories
            const grouped = {};
            this.items.forEach(item => {
                const catId = item.category_id || 'other';
                if (!grouped[catId]) grouped[catId] = [];
                grouped[catId].push(item);
            });

            const catIds = Object.keys(grouped).sort((a, b) => {
                if (a === 'other') return 1;
                if (b === 'other') return -1;
                return 0;
            });

            this.listContainer.innerHTML = catIds.map(catId => {
                const catInfo = this.categories[catId] || { name: '\u05d0\u05d7\u05e8', emoji: '\ud83d\udce6' };
                return `
                    <div class="category-group" data-cat="${catId}">
                        <h2 class="category-title">${catInfo.emoji} ${catInfo.name}</h2>
                        ${grouped[catId].map(item => itemRow(item)).join('')}
                    </div>`;
            }).join('');
        }

        this._renderCartTotal();
        this.bindSwipeGestures();
        this.renderSmartSuggestions();
    }

    _renderCartTotal() {
        const activeItems = this.items.filter(i => !i.completed);
        const withPrice = activeItems.filter(i => i.priceData?.price);
        const total = withPrice.reduce((sum, i) => sum + i.priceData.price * (i.quantity || 1), 0);

        // הסר כל סכום קודם
        document.getElementById('cart-total-row')?.remove();
        if (!withPrice.length) return;

        const isPartial = withPrice.length < activeItems.length;
        const row = document.createElement('div');
        row.id = 'cart-total-row';
        row.className = 'cart-total';
        row.innerHTML = `
            <div>
                <div class="cart-total-label">סה"כ צפוי</div>
                ${isPartial ? `<div class="cart-total-partial">(${withPrice.length} מתוך ${activeItems.length} פריטים עם מחיר)</div>` : ''}
            </div>
            <span class="cart-total-amount">₪${total.toFixed(2)}</span>
        `;
        this.listContainer.appendChild(row);
    }

    async fetchPopularItems() {
        if (!this.supabase) return [];
        const { data, error } = await this.supabase
            .from('popular_items')
            .select('*')
            .limit(10);
        if (error) { console.error('Error fetching popular items:', error); return []; }
        return data || [];
    }

    async fetchPurchaseHistory() {
        if (!this.supabase) return [];
        const { data, error } = await this.supabase
            .from('purchase_history')
            .select('*')
            .order('purchased_at', { ascending: false })
            .limit(50);
        if (error) { console.error('Error fetching history:', error); return []; }
        return data || [];
    }

    async renderSmartSuggestions() {
        if (!this.supabase || this.viewMode !== 'category') {
            this.suggestionsContainer.style.display = 'none';
            return;
        }

        const popular = await this.fetchPopularItems();
        // Filter out items already on the active shopping list
        const activeItemNames = this.items.map(i => i.text.toLowerCase());
        const suggestions = popular.filter(p => !activeItemNames.includes(p.item_name.toLowerCase()) && p.days_since_last > 2);

        if (suggestions.length === 0) {
            this.suggestionsContainer.style.display = 'none';
            return;
        }

        this.suggestionsContainer.style.display = 'block';
        this.suggestionsContainer.innerHTML = `
            <div class="smart-suggestions">
                <h3 class="suggestions-title">💡 אולי שכחתם?</h3>
                <div class="suggestions-scroll">
                    ${suggestions.map(item => `
                        <button class="suggestion-chip" onclick="window.app.addItem('${item.item_name}')">
                            + ${item.item_name} <small>(${item.days_since_last} ימים)</small>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    }

    async renderStats() {
        const popular = await this.fetchPopularItems();
        if (popular.length === 0) {
            this.statsContainer.innerHTML = `<div class="empty-state"><p>אין מספיק נתונים לסטטיסטיקה. התחילו לקנות!</p></div>`;
            return;
        }

        this.statsContainer.innerHTML = `
            <div class="stats-dashboard">
                <h2>📊 המוצרים הנקנים ביותר</h2>
                <div class="stats-list">
                    ${popular.map((item, idx) => `
                        <div class="stat-card">
                            <div class="stat-rank">#${idx + 1}</div>
                            <div class="stat-info">
                                <strong>${item.item_name}</strong>
                                <span class="stat-meta">נקנה ${item.purchase_count} פעמים | לפני ${item.days_since_last} ימים</span>
                            </div>
                            <div class="stat-score" title="Popularity Score">${item.popularity_score} ⭐</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    async renderHistory() {
        const history = await this.fetchPurchaseHistory();
        if (history.length === 0) {
            this.historyContainer.innerHTML = `<div class="empty-state"><p>עוד לא ביצעת קניות במערכת.</p></div>`;
            return;
        }

        const formatDate = (dateString) => {
            const d = new Date(dateString);
            return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        };

        this.historyContainer.innerHTML = `
            <div class="history-timeline">
                <h2>🕒 קניות אחרונות</h2>
                <ul class="timeline-list">
                    ${history.map(item => `
                        <li class="timeline-item">
                            <div class="timeline-date">${formatDate(item.purchased_at)}</div>
                            <div class="timeline-content">
                                <strong>${item.item_name}</strong>
                                <span>(כמות: ${item.quantity || 1})</span>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }



    bindSwipeGestures() {
        this.listContainer.querySelectorAll('.list-item').forEach(item => {
            let startX = 0;
            item.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
            item.addEventListener('touchend', e => {
                const deltaX = e.changedTouches[0].clientX - startX;
                if (deltaX < -60) {
                    item.classList.add('deleting');
                    setTimeout(() => window.app.deleteItem(item.dataset.id), 250);
                }
            }, { passive: true });
        });
    }

}

// ─────────────────────────────────────────────────────────────
// Price Compare Module
// שלב נוכחי: mock data — יוחלף ב-Supabase RPCs בשלב 9
// ─────────────────────────────────────────────────────────────
class PriceCompareModule {

    init(supabaseClient) {
        this.supabase = supabaseClient || null;
        this.container = document.getElementById('prices-container');
        this.debounceTimer = null;
        this.selectedProduct = null;
    }

    show() {
        this._renderSearchView();
    }

    // ── תצוגת חיפוש ──────────────────────────────────────────
    _renderSearchView() {
        this.container.innerHTML = `
            <div class="price-search-wrapper">
                <div class="price-search-bar">
                    <input id="price-search-input" type="text" inputmode="search"
                           placeholder="חפשו מוצר... (למשל: חלב, לחם)"
                           autocomplete="off" autocorrect="off">
                    <button id="price-barcode-btn" class="btn btn-secondary" aria-label="סריקת ברקוד">
                        <span class="icon">📷</span>
                    </button>
                </div>
                <div id="price-results-dropdown" class="price-results-dropdown"></div>
            </div>
            <div id="price-panel" class="price-panel"></div>
        `;

        document.getElementById('price-search-input')
            .addEventListener('input', () => this._onSearchInput());
        document.getElementById('price-barcode-btn')
            .addEventListener('click', () => this._onBarcodeClick());
    }

    // ── skeleton ──────────────────────────────────────────────
    _skeletonHTML() {
        return `
            <div class="price-panel-header">
                <div style="flex:1">
                    <div class="skel skel-title"></div>
                    <div class="skel skel-meta"></div>
                </div>
                <div class="skel skel-btn"></div>
            </div>
            <div class="skel skel-label"></div>
            <div class="skel skel-card"></div>
            <div class="skel skel-label" style="margin-top:16px;"></div>
            ${[0,1,2,3].map(() => '<div class="skel skel-row"></div>').join('')}
        `;
    }

    // ── offline banner ────────────────────────────────────────
    _offlineBanner() {
        const existing = document.querySelector('.price-offline-banner');
        if (!existing) {
            const banner = document.createElement('div');
            banner.className = 'price-offline-banner';
            banner.textContent = '⚠️ אין חיבור לאינטרנט — מוצגים נתונים מקומיים בלבד';
            this.container.prepend(banner);
        }
    }

    _clearOfflineBanner() {
        document.querySelector('.price-offline-banner')?.remove();
    }

    // ── חיפוש טקסט ───────────────────────────────────────────
    _onSearchInput() {
        clearTimeout(this.debounceTimer);
        const query = document.getElementById('price-search-input').value.trim();
        const dropdown = document.getElementById('price-results-dropdown');

        if (query.length < 2) {
            dropdown.innerHTML = '';
            return;
        }
        this.debounceTimer = setTimeout(() => this._runSearch(query), 350);
    }

    async _runSearch(query) {
        const dropdown = document.getElementById('price-results-dropdown');
        dropdown.innerHTML = `<div class="price-result-loading">מחפש...</div>`;

        let results;
        if (this.supabase && navigator.onLine) {
            this._clearOfflineBanner();
            const { data, error } = await this.supabase.rpc('search_products', {
                query_text: query, result_limit: 20
            });
            if (error) {
                console.error('search_products RPC error:', error);
                dropdown.innerHTML = `<div class="price-result-empty">שגיאת חיפוש — נסו שוב</div>`;
                return;
            }
            results = data ?? [];
        } else {
            if (!navigator.onLine) this._offlineBanner();
            results = this._mockSearch(query);
        }

        if (!results.length) {
            dropdown.innerHTML = `<div class="price-result-empty">לא נמצאו מוצרים עבור "${query}"</div>`;
            return;
        }

        dropdown.innerHTML = results.map(p => `
            <div class="price-result-item" data-id="${p.id}">
                <div class="price-result-name">${p.product_name}</div>
                <div class="price-result-brand">${p.brand || ''}</div>
            </div>
        `).join('');

        dropdown.querySelectorAll('.price-result-item').forEach(el => {
            el.addEventListener('click', () => {
                const product = results.find(p => p.id === el.dataset.id);
                this._onProductSelected(product);
            });
        });
    }

    // ── בחירת מוצר → טעינת מחירים ────────────────────────────
    async _onProductSelected(product) {
        this.selectedProduct = product;
        document.getElementById('price-search-input').value = product.product_name;
        document.getElementById('price-results-dropdown').innerHTML = '';

        const panel = document.getElementById('price-panel');
        panel.innerHTML = this._skeletonHTML();

        let prices, allChains = [];
        if (this.supabase && navigator.onLine) {
            const [pricesRes, chainsRes] = await Promise.all([
                this.supabase.rpc('get_product_prices', { p_product_id: product.id }),
                this.supabase.from('supermarket_chains').select('chain_name')
            ]);
            if (pricesRes.error) console.error('get_product_prices RPC error:', pricesRes.error);
            prices = pricesRes.data ?? [];
            allChains = chainsRes.data?.map(c => c.chain_name) ?? [];
        } else {
            await new Promise(r => setTimeout(r, 350));
            prices = this._mockPrices(product.id);
        }

        this._renderPricePanel(prices, allChains);
    }

    _renderPricePanel(prices, allChains = []) {
        const panel = document.getElementById('price-panel');

        // edge case: אין מחירים
        if (!prices.length) {
            panel.innerHTML = `
                <div class="empty-state">
                    <p>אין מחירים זמינים לעת עתה</p>
                    <small>המאגר מתעדכן כל לילה בשעה 4 בבוקר</small>
                </div>`;
            return;
        }

        const cheapest = prices[0]; // ממוין ASC
        const rest = prices.slice(1);

        const formatFreshness = (iso) => {
            const h = Math.round((Date.now() - new Date(iso)) / 3600000);
            return h < 1 ? 'עודכן זה עתה' : h < 24 ? `עודכן לפני ${h} שעות` : `עודכן לפני ${Math.floor(h/24)} ימים`;
        };

        const isStale = (Date.now() - new Date(cheapest.scraped_at)) > 48 * 3600000;

        panel.innerHTML = `
            <div class="price-panel-header">
                <div>
                    <div class="price-panel-title">${this.selectedProduct.product_name}</div>
                    <div class="price-panel-meta">ברקוד: ${this.selectedProduct.barcode} &nbsp;·&nbsp; ${prices.length} רשתות</div>
                </div>
                <button class="btn btn-primary price-add-btn"
                        onclick="window.app.addItem('${this.selectedProduct.product_name.replace(/'/g, "\\'")}')">
                    + הוסף לרשימה
                </button>
            </div>

            <div class="price-cheapest-label">🏆 הכי זול</div>
            <div class="price-cheapest-card">
                <span class="price-chain-name">${cheapest.chain_name}</span>
                <div style="display:flex;align-items:center;gap:8px;">
                    ${cheapest.is_promotional ? '<span class="price-promo-badge">מבצע</span>' : ''}
                    <span class="price-amount cheapest">₪${Number(cheapest.price).toFixed(2)}</span>
                </div>
            </div>

            ${rest.length ? `
            <div class="price-rest-label">שאר הרשתות</div>
            <div class="price-rest-list">
                ${rest.map(p => `
                    <div class="price-row">
                        <span class="price-chain-name">${p.chain_name}</span>
                        <div style="display:flex;align-items:center;gap:8px;">
                            ${p.is_promotional ? '<span class="price-promo-badge">מבצע</span>' : ''}
                            <span class="price-amount">₪${Number(p.price).toFixed(2)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>` : ''}

            <div class="price-freshness">${formatFreshness(cheapest.scraped_at)}</div>
            ${isStale ? '<div class="price-stale-warning">⚠️ נתונים ישנים מעל 48 שעות — ייתכן שהמחירים השתנו</div>' : ''}

            ${(() => {
                const syncedNames = new Set(prices.map(p => p.chain_name));
                const unsynced = allChains.filter(c => !syncedNames.has(c));
                if (!unsynced.length) return '';
                return `
                <div class="price-unsynced-section">
                    <div class="price-unsynced-title">⏳ טרם בוצע סינכרון</div>
                    ${unsynced.map(c => `
                        <div class="price-row price-unsynced-row">
                            <span class="price-chain-name">${c}</span>
                            <span class="price-unsynced-label">לא זמין</span>
                        </div>
                    `).join('')}
                </div>`;
            })()}
        `;
    }

    // ── ברקוד ─────────────────────────────────────────────────
    async _onBarcodeClick() {
        if ('BarcodeDetector' in window) {
            this._scanWithNativeDetector();
        } else {
            this._scanWithFileInput();
        }
    }

    _scanWithNativeDetector() {
        // BarcodeDetector API — Chrome/Android, ללא ספריות נוספות
        const video = document.createElement('video');
        video.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:9999;';
        document.body.appendChild(video);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕ סגור';
        closeBtn.style.cssText = 'position:fixed;top:16px;left:16px;z-index:10000;background:rgba(0,0,0,0.6);color:white;border:none;padding:10px 16px;border-radius:20px;font-size:1rem;cursor:pointer;';
        document.body.appendChild(closeBtn);

        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        let stream;

        const cleanup = () => {
            cancelAnimationFrame(rafId);
            stream?.getTracks().forEach(t => t.stop());
            video.remove();
            closeBtn.remove();
        };
        closeBtn.addEventListener('click', cleanup);

        let rafId;
        const scan = async () => {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                const barcodes = await detector.detect(video).catch(() => []);
                if (barcodes.length) {
                    cleanup();
                    await this._lookupByBarcode(barcodes[0].rawValue);
                    return;
                }
            }
            rafId = requestAnimationFrame(scan);
        };

        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(s => { stream = s; video.srcObject = s; video.play(); rafId = requestAnimationFrame(scan); })
            .catch(() => { cleanup(); this._scanWithFileInput(); });
    }

    _scanWithFileInput() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            // ZXing נטען lazily רק כשצריך
            if (!window.ZXing) {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@latest/umd/index.min.js';
                document.head.appendChild(s);
                await new Promise(r => s.onload = r);
            }
            try {
                const reader = new ZXing.BrowserMultiFormatReader();
                const result = await reader.decodeFromImageUrl(URL.createObjectURL(file));
                await this._lookupByBarcode(result.getText());
            } catch {
                alert('לא הצלחנו לזהות ברקוד. נסו שוב או הקלידו ידנית.');
            }
        });
        input.click();
    }

    async _lookupByBarcode(barcode) {
        document.getElementById('price-search-input').value = barcode;
        const panel = document.getElementById('price-panel');
        panel.innerHTML = `<div class="price-loading">מחפש ברקוד ${barcode}...</div>`;

        // TODO שלב 9: החלף ב-
        // const { data } = await this.supabase.from('market_products').select('*').eq('barcode', barcode).single()
        await new Promise(r => setTimeout(r, 400));
        const product = MOCK_PRODUCTS.find(p => p.barcode === barcode);

        if (!product) {
            panel.innerHTML = `<div class="empty-state"><p>ברקוד ${barcode} לא נמצא במאגר</p><small>המאגר מתעדכן כל לילה</small></div>`;
            return;
        }
        this._onProductSelected(product);
    }

    // ── Mock Data (יוסר בשלב 9) ──────────────────────────────
    _mockSearch(query) {
        const q = query.toLowerCase();
        return MOCK_PRODUCTS
            .filter(p =>
                p.product_name.includes(query) ||
                (p.brand && p.brand.includes(query)) ||
                p.product_name.toLowerCase().includes(q)
            )
            .slice(0, 10);
    }

    _mockPrices(productId) {
        const seed = productId.charCodeAt(0);
        const chains = ['שופרסל', 'רמי לוי', 'ויקטורי', 'יינות ביתן', 'טיב טעם', 'חצי חינם', 'יוחננוף'];
        return chains
            .map((chain_name, i) => ({
                chain_name,
                price: (5 + ((seed + i * 7) % 30) / 10).toFixed(2),
                is_promotional: i === 2,
                scraped_at: new Date(Date.now() - i * 3600000).toISOString()
            }))
            .sort((a, b) => a.price - b.price);
    }
}

// Mock products — יוחלפו בנתוני Supabase בשלב 9
const MOCK_PRODUCTS = [
    { id: 'p1', barcode: '7290000066318', product_name: 'חלב תנובה 3% שומן 1 ליטר',    brand: 'תנובה' },
    { id: 'p2', barcode: '7290000066325', product_name: 'חלב עמיד תנובה 3% 1 ליטר',    brand: 'תנובה' },
    { id: 'p3', barcode: '7290002183779', product_name: 'לחם אחיד פרוס אנג\'ל 750 גרם', brand: 'אנג\'ל' },
    { id: 'p4', barcode: '7290002183786', product_name: 'לחם שיפון אנג\'ל',              brand: 'אנג\'ל' },
    { id: 'p5', barcode: '7290005760054', product_name: 'גבינה צהובה עמק 28% 200 גרם',  brand: 'תנובה' },
    { id: 'p6', barcode: '7290005760061', product_name: 'גבינה לבנה 5% 250 גרם',        brand: 'תנובה' },
    { id: 'p7', barcode: '7290000850015', product_name: 'ביצים L תריסר מוקרן',          brand: 'מוקרן' },
    { id: 'p8', barcode: '7290010322244', product_name: 'קוטג\' 5% שטראוס 250 גרם',     brand: 'שטראוס' },
    { id: 'p9', barcode: '7290010063165', product_name: 'יוגורט טבעי עלית 200 גרם',     brand: 'עלית' },
    { id: 'p10', barcode: '7290000850022', product_name: 'שמן זית כתית מעולה 750 מ"ל', brand: 'Yad Mordechai' },
    { id: 'p11', barcode: '7290000850039', product_name: 'אורז בסמטי 1 ק"ג',            brand: 'לה פרמה' },
    { id: 'p12', barcode: '7290000076522', product_name: 'חומוס מוכן שטראוס 400 גרם',   brand: 'שטראוס' },
    { id: 'p13', barcode: '7290000076539', product_name: 'קפה נמס נסקפה קלאסיק 200 גרם', brand: 'נסקפה' },
    { id: 'p14', barcode: '7290104600027', product_name: 'במבה אוסם 80 גרם',            brand: 'אוסם' },
    { id: 'p15', barcode: '7290104600034', product_name: 'ביסלי גריל אוסם 70 גרם',      brand: 'אוסם' },
];

// Initialize the app
window.app = new ShoppingApp();

// Add missing styles for the dynamic list items directly via JS for quick iteration 
// (Normally these go in styles.css)
const style = document.createElement('style');
style.textContent = `
    .list-item {
        background: white;
        margin-bottom: 12px;
        padding: 16px;
        border-radius: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        animation: slideIn 0.3s ease-out;
    }
    
    @keyframes slideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .item-main {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        cursor: pointer;
    }

    .checkbox {
        width: 22px;
        height: 22px;
        border: 2px solid #e2e8f0;
        border-radius: 6px;
        transition: all 0.2s;
        position: relative;
    }

    .list-item.completed .checkbox {
        background: var(--primary-color);
        border-color: var(--primary-color);
    }

    .list-item.completed .checkbox::after {
        content: '✓';
        color: white;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 0.8rem;
    }

    .list-item.completed .item-text {
        text-decoration: line-through;
        color: var(--text-muted);
    }

    .item-text {
        font-weight: 500;
        font-size: 1.05rem;
    }

    .delete-btn {
        background: none;
        border: none;
        padding: 8px;
        cursor: pointer;
        opacity: 0.4;
        transition: opacity 0.2s;
    }

    .delete-btn:hover {
        opacity: 1;
        background: #fee2e2;
        border-radius: 8px;
    }
`;
document.head.appendChild(style);
