/**
 * Family Shopping App - Core Logic
 * No-Build Architecture using ES Modules
 */

class ShoppingApp {
    constructor() {
        this.items = [];
        this.categories = {
            'fruits_veg': { name: 'ירקות ופירות', emoji: '🥦', items: ['עגבניה', 'מלפפון', 'בצל', 'תפוח', 'בננה', 'חסה', 'גזר', 'פלפל', 'פטריות', 'תפו"א'] },
            'dairy': { name: 'מוצרי חלב וביצים', emoji: '🧀', items: ['חלב', 'גבינה', 'קוטג\'', 'יוגורט', 'ביצים', 'חמאה', 'שמנת'] },
            'meat': { name: 'בשר ודגים', emoji: '🥩', items: ['עוף', 'בשר', 'דג', 'נקניקיות', 'המבורגר', 'שניצל'] },
            'bakery': { name: 'מאפה ולחם', emoji: '🥖', items: ['לחם', 'פיתות', 'לחמניות', 'חלה', 'עוגה', 'עוגיות'] },
            'dry_goods': { name: 'מוצרים יבשים', emoji: '🍝', items: ['פסטה', 'אורז', 'קוסקוס', 'קמח', 'סוכר', 'שמן', 'שימורים', 'קטניות'] },
            'cleaning': { name: 'ניקיון וטיפוח', emoji: '🧼', items: ['נייר טואלט', 'סבון', 'שמפו', 'נוזל כלים', 'אבקת כביסה'] },
            'snacks': { name: 'חטיפים ושתייה', emoji: '🍿', items: ['במבה', 'ביסלי', 'צ\'יפס', 'קוקה קולה', 'מיץ', 'מים', 'קפה', 'תה'] }
        };
        this.init();
    }

    async init() {
        this.cacheDom();
        this.bindEvents();
        this.loadLocalData();
        this.render();
        console.log("🚀 Shopping App Initialized");
    }

    cacheDom() {
        this.itemInput = document.getElementById('item-input');
        this.addBtn = document.getElementById('add-item-btn');
        this.listContainer = document.getElementById('shopping-list-container');
        this.scanBtn = document.getElementById('scan-receipt-btn');
        this.fileInput = document.getElementById('receipt-upload');
    }

    bindEvents() {
        this.addBtn.addEventListener('click', () => this.addItem());
        this.itemInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addItem();
        });

        // OCR Scan Trigger
        this.scanBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleReceiptUpload(e));
        
        // Tab switching (dummy for now)
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    loadLocalData() {
        const saved = localStorage.getItem('shopping_list_items');
        if (saved) {
            this.items = JSON.parse(saved);
        }
    }

    saveLocalData() {
        localStorage.setItem('shopping_list_items', JSON.stringify(this.items));
    }

    async handleReceiptUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.setLoading(true, "סורק קבלה... רק רגע");

        try {
            // Tesseract.js OCR
            const worker = await Tesseract.createWorker('heb'); // Loading Hebrew model
            const { data: { text } } = await worker.recognize(file);
            await worker.terminate();

            // Simple parser: split by lines and filter short/junk strings
            const lines = text.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 2 && !l.match(/^[0-9.]+$/)); // Filter out price-only lines or short junk

            if (lines.length > 0) {
                lines.forEach(line => {
                    this.addItem(line, false); // Add each recognized line as a potential item
                });
                alert(`זוהו ${lines.length} פריטים מהקבלה!`);
            } else {
                alert("לא הצלחנו לזהות פריטים ברורים. נסו לצלם שוב בסיבת תאורה טובה יותר.");
            }
        } catch (error) {
            console.error("OCR Error:", error);
            alert("שגיאה בסריקת הקבלה. וודאו שיש חיבור לאינטרנט לטעינת המנוע.");
        } finally {
            this.setLoading(false);
            this.fileInput.value = ''; // Reset input
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

    addItem(manualText = null, shouldRender = true) {
        const text = manualText || this.itemInput.value.trim();
        if (!text) return;

        const categoryId = this.detectCategory(text);

        const newItem = {
            id: Date.now(),
            text: text,
            completed: false,
            categoryId: categoryId,
            createdAt: new Date().toISOString()
        };

        this.items.unshift(newItem);
        if (manualText === null) this.itemInput.value = '';
        
        this.saveLocalData();
        if (shouldRender) this.render();
    }

    detectCategory(text) {
        for (const [id, cat] of Object.entries(this.categories)) {
            if (cat.items.some(keyword => text.includes(keyword))) {
                return id;
            }
        }
        return 'other'; // Unknown category
    }

    toggleItem(id) {
        this.items = this.items.map(item => 
            item.id === id ? { ...item, completed: !item.completed } : item
        );
        this.saveLocalData();
        this.render();
    }

    deleteItem(id) {
        this.items = this.items.filter(item => item.id !== id);
        this.saveLocalData();
        this.render();
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

        // Group by categories
        const grouped = {};
        this.items.forEach(item => {
            const catId = item.categoryId || 'other';
            if (!grouped[catId]) grouped[catId] = [];
            grouped[catId].push(item);
        });

        // Sorted Category IDs (Categories with items first, then 'other')
        const catIds = Object.keys(grouped).sort((a, b) => {
            if (a === 'other') return 1;
            if (b === 'other') return -1;
            return 0;
        });

        this.listContainer.innerHTML = catIds.map(catId => {
            const catInfo = this.categories[catId] || { name: 'אחר', emoji: '📦' };
            const itemsInCat = grouped[catId];
            
            return `
                <div class="category-group">
                    <h2 class="category-title">${catInfo.emoji} ${catInfo.name}</h2>
                    ${itemsInCat.map(item => `
                        <div class="list-item ${item.completed ? 'completed' : ''}" data-id="${item.id}">
                            <div class="item-main" onclick="window.app.toggleItem(${item.id})">
                                <div class="checkbox"></div>
                                <span class="item-text">${item.text}</span>
                            </div>
                            <button class="delete-btn" onclick="window.app.deleteItem(${item.id})">
                                <span class="icon">🗑️</span>
                            </button>
                        </div>
                    `).join('')}
                </div>
            `;
        }).join('');
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
