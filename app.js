/**
 * Family Shopping App - Core Logic
 * No-Build Architecture using ES Modules
 */

// Supabase Configuration - REPLACE WITH YOUR PROJECT DETAILS
const SUPABASE_URL = 'https://your-project-id.supabase.co';
const SUPABASE_KEY = 'your-anon-key-here';

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

        // Initialize Supabase if keys provided
        if (SUPABASE_URL !== 'https://your-project-id.supabase.co') {
            this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }

        this.init();
    }


    async init() {
        this.cacheDom();
        this.bindEvents();
        await this.fetchItems();
        this.setupRealtime();
        this.render();
        console.log("🚀 Shopping App Initialized with Supabase");
    }


    cacheDom() {
        this.itemInput    = document.getElementById('item-input');
        this.qtyInput     = document.getElementById('qty-input');
        this.addBtn       = document.getElementById('add-item-btn');
        this.listContainer= document.getElementById('shopping-list-container');
        this.statsContainer= document.getElementById('stats-container');
        this.historyContainer= document.getElementById('history-container');
        this.suggestionsContainer= document.getElementById('smart-suggestions-container');
        this.scanBtn      = document.getElementById('scan-receipt-btn');
        this.fileInput    = document.getElementById('receipt-upload');
        this.clearBtn     = document.getElementById('clear-list-btn');
        this.viewToggleBtn= document.getElementById('view-toggle-btn');
    }

    bindEvents() {
        this.addBtn.addEventListener('click', () => this.addItem());
        this.itemInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addItem();
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
            if(this.suggestionsContainer.innerHTML.trim() !== '') {
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
            this.items = data || [];
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
        const qty  = manualText ? manualQty : parseInt(this.qtyInput.value || 1);
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

        if (this.supabase) {
            const { error } = await this.supabase.from('shopping_items').insert([newItem]);
            if (error) console.error('Error adding item:', error);
        } else {
            this.items.unshift({ ...newItem, id: Date.now(), created_at: new Date().toISOString() });
            this.saveLocalData();
        }

        if (manualText === null) { this.itemInput.value = ''; this.qtyInput.value = 1; }
        if (shouldRender && !this.supabase) this.render();
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

        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .update({ completed: !item.completed })
                .eq('id', id);
            if (error) console.error('Error toggling item:', error);
        } else {
            this.items = this.items.map(i =>
                i.id === id ? { ...i, completed: !i.completed } : i
            );
            this.saveLocalData();
            this.render();
        }
    }

    async deleteItem(id) {
        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .delete()
                .eq('id', id);
            if (error) console.error('Error deleting item:', error);
        } else {
            this.items = this.items.filter(item => item.id !== id);
            this.saveLocalData();
            this.render();
        }
    }

    async updateQuantity(id, newQty) {
        if (newQty < 1) { await this.deleteItem(id); return; }
        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .update({ quantity: newQty })
                .eq('id', id);
            if (error) console.error('Error updating quantity:', error);
        } else {
            this.items = this.items.map(i => i.id === id ? { ...i, quantity: newQty } : i);
            this.saveLocalData();
            this.render();
        }
    }

    async clearList() {
        if (!confirm('למחוק את כל הפריטים ברשימה?')) return;
        if (this.supabase) {
            const { error } = await this.supabase
                .from('shopping_items')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
            if (error) console.error('Error clearing list:', error);
        } else {
            this.items = [];
            this.saveLocalData();
            this.render();
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
                    <span class="item-text">${item.text}</span>
                </div>
                <div class="item-controls">
                    <div class="qty-inline">
                        <button class="qty-btn-sm" onclick="window.app.updateQuantity('${item.id}', ${(item.quantity||1)-1})">\u2212</button>
                        <span class="qty-badge">${item.quantity || 1}</span>
                        <button class="qty-btn-sm" onclick="window.app.updateQuantity('${item.id}', ${(item.quantity||1)+1})">+</button>
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

        this.bindSwipeGestures();
        this.renderSmartSuggestions();
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
            return `${d.getDate()}/${d.getMonth()+1} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
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
