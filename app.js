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
        this.cartOptimization = null; // תוצאות אחרונות של אופטימיזציית עגלה

        // Family code — URL param → localStorage → uuid חדש
        this.familyCode = new URLSearchParams(window.location.search).get('family')
            || localStorage.getItem('family_code')
            || (() => {
                const code = Math.random().toString(36).slice(2, 8).toUpperCase();
                localStorage.setItem('family_code', code);
                return code;
            })();
        // שמור תמיד ב-localStorage כדי שקישור ייצא עם הקוד הנכון
        localStorage.setItem('family_code', this.familyCode);

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
        if (this.supabase) await this._initAuth(); // Auth לפני fetchItems — RLS דורש session
        await this.fetchItems();
        this.setupRealtime();
        this.render();
        this._loadPricesBackground();
        this.priceModule.init(this.supabase);
        this.priceModule.checkPriceAlerts(this.familyCode);
        console.log("🚀 חבי - סוכן החיסכון בסופר | מאותחל עם Supabase");
    }

    async _initAuth() {
        this.supabase.auth.onAuthStateChange(async (event, session) => {
            if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
                await this._syncUserProfile(session);
                await this.fetchItems();
                this.render();
            }
        });

        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
            await this._syncUserProfile(session);
        } else {
            const { error } = await this.supabase.auth.signInAnonymously();
            if (error) console.warn('Anonymous auth failed:', error.message);
        }
    }

    async _syncUserProfile(session) {
        if (!session?.user) return;

        const { data: profile } = await this.supabase
            .from('user_profiles')
            .select('family_code, display_name, avatar_url')
            .eq('user_id', session.user.id)
            .maybeSingle();

        const urlFamily = new URLSearchParams(window.location.search).get('family');

        if (profile) {
            // אם URL מכיל קוד משפחה אחר — הצטרף אליו
            if (urlFamily && urlFamily !== profile.family_code) {
                await this.supabase.from('user_profiles')
                    .update({ family_code: urlFamily })
                    .eq('user_id', session.user.id);
                this.familyCode = urlFamily;
            } else {
                this.familyCode = profile.family_code;
            }
        } else {
            // משתמש חדש — צור פרופיל
            await this.supabase.from('user_profiles').insert({
                user_id:      session.user.id,
                family_code:  this.familyCode,
                display_name: session.user.user_metadata?.full_name ?? null,
                avatar_url:   session.user.user_metadata?.avatar_url ?? null
            });
        }
        localStorage.setItem('family_code', this.familyCode);
        this._renderAuthBtn(session);
    }

    _renderAuthBtn(session) {
        const btn = document.getElementById('auth-btn');
        if (!btn) return;
        const avatar = session?.user?.user_metadata?.avatar_url;
        const name   = session?.user?.user_metadata?.full_name;
        const isAnon = session?.user?.is_anonymous !== false || !name;
        if (avatar) {
            btn.innerHTML = `<img src="${avatar}" class="auth-avatar" alt="${name}">`;
        } else if (!isAnon && name) {
            btn.innerHTML = `<span class="auth-initial">${name[0].toUpperCase()}</span>`;
        } else {
            btn.innerHTML = `<span class="icon">👤</span>`;
        }
        btn.title = name ? `מחובר כ: ${name}` : 'התחבר עם Google';
    }

    _confirm(message, subtext = '') {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = `
                <div style="background:white;border-radius:16px;padding:24px;width:100%;max-width:340px;direction:rtl;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
                    <div style="font-size:1rem;font-weight:600;color:#1e293b;margin-bottom:${subtext ? '6px' : '20px'}">${message}</div>
                    ${subtext ? `<div style="font-size:0.85rem;color:#64748b;margin-bottom:20px">${subtext}</div>` : ''}
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button id="_confirm-cancel" style="padding:9px 20px;border-radius:10px;border:1px solid #e2e8f0;background:white;cursor:pointer;font-size:0.9rem;">ביטול</button>
                        <button id="_confirm-ok" style="padding:9px 20px;border-radius:10px;border:none;background:#ef4444;color:white;cursor:pointer;font-size:0.9rem;font-weight:600;">אישור</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const cleanup = (val) => { document.body.removeChild(overlay); resolve(val); };
            overlay.querySelector('#_confirm-ok').onclick = () => cleanup(true);
            overlay.querySelector('#_confirm-cancel').onclick = () => cleanup(false);
            overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
        });
    }

    async _showAuthModal() {
        if (!this.supabase) return;
        const { data: { session } } = await this.supabase.auth.getSession();
        const name = session?.user?.user_metadata?.full_name;
        if (name) {
            if (await this._confirm('התנתקות', `מחובר כ: ${name}`)) {
                await this.supabase.auth.signOut();
                location.reload();
            }
            return;
        }
        document.getElementById('auth-modal').style.display = 'flex';
    }

    async _signInWithGoogle() {
        await this.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.href }
        });
    }

    async _loadPricesBackground() {
        if (!this.supabase) return;
        const activeItems = this.items.filter(i => !i.completed && !i.priceData);
        if (!activeItems.length) return;

        // חיפוש ראשון — טקסט מלא
        const results = await Promise.all(
            activeItems.map(item =>
                this.supabase.rpc('search_products', { query_text: item.text, result_limit: 1 })
            )
        );

        const stillMissing = [];
        results.forEach((res, i) => {
            const p = res.data?.[0];
            if (p?.cheapest_price != null) {
                activeItems[i].priceData = { chain: p.cheapest_chain, price: parseFloat(p.cheapest_price) };
            } else {
                stillMissing.push(i);
            }
        });

        // חיפוש שני — רק המילה הראשונה (לפריטים שלא נמצאו)
        if (stillMissing.length) {
            const retries = await Promise.all(
                stillMissing.map(i => {
                    const firstWord = activeItems[i].text.split(/[\s,\-–]/)[0].trim();
                    if (firstWord.length < 2) return Promise.resolve({ data: [] });
                    return this.supabase.rpc('search_products', { query_text: firstWord, result_limit: 1 });
                })
            );
            retries.forEach((res, j) => {
                const p = res.data?.[0];
                const i = stillMissing[j];
                if (p?.cheapest_price != null) {
                    activeItems[i].priceData = { chain: p.cheapest_chain, price: parseFloat(p.cheapest_price) };
                } else {
                    activeItems[i].priceData = null; // מסמן כ"נוסה ונכשל"
                    activeItems[i].priceNotFound = true;
                }
            });
        }

        this.render();
    }

    searchItemPrice(itemId) {
        // מעבר לטאב מחירים + חיפוש אוטומטי
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelector('.nav-item[data-view="prices"]')?.classList.add('active');
        this.switchView('prices');
        const input = document.getElementById('price-search-input');
        if (input) {
            input.value = item.text;
            input.dispatchEvent(new Event('input'));
        }
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

        // Family sharing
        const shareBtn = document.getElementById('share-family-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                const url = `${location.origin}${location.pathname}?family=${this.familyCode}`;
                if (navigator.share) {
                    navigator.share({ title: 'הרשימה שלנו 🛒', url });
                } else {
                    navigator.clipboard?.writeText(url).then(() =>
                        alert(`קישור הועתק:\n${url}\nשתפו עם בני המשפחה כדי לעבוד על אותה רשימה.`)
                    );
                }
            });
        }

        // Auth
        document.getElementById('auth-btn')?.addEventListener('click', () => this._showAuthModal());
        document.getElementById('google-signin-btn')?.addEventListener('click', () => this._signInWithGoogle());
        document.getElementById('auth-modal-close')?.addEventListener('click', () => {
            document.getElementById('auth-modal').style.display = 'none';
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
            .eq('family_code', this.familyCode)
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
            const worker = await Tesseract.createWorker('heb');
            const { data: { text } } = await worker.recognize(file);
            await worker.terminate();

            const junkKeywords = ['סהכ', 'סה"כ', 'מעמ', 'מע"מ', 'תשלום', 'שינוי', 'עודף', 'קופה', 'קבלה', 'חשבונית', 'ניקוד', 'נקודות', 'מיסים', 'תודה', 'מזומן', 'אשראי', 'ביטול', 'זיכוי'];
            const hebrewChar = /[\u05D0-\u05EA]/;

            const foundItems = [];
            const lines = text.split('\n').map(l => l.trim());
            for (const line of lines) {
                if (line.length < 3) continue;
                if (!hebrewChar.test(line)) continue;
                if (/\d{2}[\/\.]\d{2}/.test(line)) continue;
                if (/\d{2}:\d{2}/.test(line)) continue;
                if (/\d{6,}/.test(line)) continue;
                if (junkKeywords.some(kw => line.includes(kw))) continue;

                let name = line
                    .replace(/\d+\.\d{2}/g, '')
                    .replace(/×\d+/g, '')
                    .replace(/₪/g, '')
                    .trim();

                if (name.length >= 3 && hebrewChar.test(name)) {
                    foundItems.push(name);
                }
            }

            if (foundItems.length === 0) {
                alert("לא הצלחנו לזהות פריטים ברורים. נסו לצלם שוב בתאורה טובה יותר.");
                return;
            }

            // Show confirmation modal
            const overlay = document.createElement('div');
            overlay.className = 'ocr-modal-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:white;border-radius:16px;padding:20px;width:100%;max-width:420px;max-height:80vh;display:flex;flex-direction:column;gap:12px;direction:rtl;';

            const title = document.createElement('h3');
            title.style.cssText = 'margin:0;font-size:1.1rem;color:var(--text-main);';
            title.textContent = 'פריטים שזוהו בקבלה';

            const subtitle = document.createElement('p');
            subtitle.style.cssText = 'margin:0;font-size:0.85rem;color:var(--text-muted);';
            subtitle.textContent = 'סמנו מה להוסיף לרשימה';

            const list = document.createElement('div');
            list.style.cssText = 'overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px;';

            foundItems.forEach((name, i) => {
                const label = document.createElement('label');
                label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:0.95rem;';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = true;
                cb.dataset.idx = i;
                cb.style.cssText = 'width:18px;height:18px;cursor:pointer;';
                label.appendChild(cb);
                label.appendChild(document.createTextNode(name));
                list.appendChild(label);
            });

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:8px;';

            const confirmBtn = document.createElement('button');
            confirmBtn.style.cssText = 'flex:1;padding:12px;background:var(--primary-color);color:white;border:none;border-radius:10px;font-size:1rem;font-family:inherit;cursor:pointer;font-weight:700;';
            confirmBtn.textContent = 'הוסף לרשימה';

            const cancelBtn = document.createElement('button');
            cancelBtn.style.cssText = 'flex:1;padding:12px;background:#f1f5f9;color:var(--text-main);border:none;border-radius:10px;font-size:1rem;font-family:inherit;cursor:pointer;';
            cancelBtn.textContent = 'ביטול';

            const cleanup = () => { overlay.remove(); this.fileInput.value = ''; };

            cancelBtn.addEventListener('click', cleanup);

            confirmBtn.addEventListener('click', async () => {
                const checked = [...list.querySelectorAll('input[type=checkbox]:checked')];
                const toAdd = checked.map(cb => foundItems[parseInt(cb.dataset.idx)]);
                cleanup();
                this.setLoading(true, 'מוסיף פריטים...');
                for (const name of toAdd) {
                    await this.addItem(name, false);
                }
                if (this.supabase) await this.fetchItems();
                this.render();
                this.setLoading(false);
            });

            btnRow.appendChild(confirmBtn);
            btnRow.appendChild(cancelBtn);
            modal.appendChild(title);
            modal.appendChild(subtitle);
            modal.appendChild(list);
            modal.appendChild(btnRow);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

        } catch (error) {
            console.error("OCR Error:", error);
            alert("שגיאה בסריקת הקבלה. וודאו שיש חיבור לאינטרנט לטעינת המנוע.");
        } finally {
            this.setLoading(false);
        }
    }


    async optimizeCartPrices() {
        const activeItems = this.items.filter(i => !i.completed);
        if (!activeItems.length) {
            alert('הוסיפו פריטים לרשימה כדי להשוות מחירים.');
            return;
        }
        if (this.optimizeBtn) this.optimizeBtn.innerHTML = '<span style="font-size:18px">⏳</span>';

        if (!this.supabase || !navigator.onLine) {
            // Fallback mock
            const chains = ['שופרסל', 'רמי לוי', 'יוחננוף', 'ויקטורי'];
            this.items = this.items.map(item => {
                if (!item.completed) item.priceData = {
                    chain: chains[Math.floor(Math.random() * chains.length)],
                    price: parseFloat((Math.random() * 10 + 3).toFixed(2))
                };
                return item;
            });
            this.render();
            if (this.optimizeBtn) this.optimizeBtn.innerHTML = '<span class="icon">💰</span>';
            return;
        }

        try {
            // שלב 1: חפש כל פריטי העגלה במקביל (Promise.all, לא loop סדרתי)
            const searches = await Promise.all(
                activeItems.map(item =>
                    this.supabase.rpc('search_products', { query_text: item.text, result_limit: 1 })
                )
            );

            const matched = [];
            searches.forEach((res, i) => {
                if (res.data?.[0]) matched.push({ item: activeItems[i], product: res.data[0] });
            });

            if (!matched.length) {
                alert('לא נמצאו מוצרים מתאימים במאגר — ייתכן שהמאגר עדיין מתמלא.');
                return;
            }

            // שלב 2: שלוף מחירים לכל המוצרים בקריאה אחת (get_prices_bulk)
            const productIds = matched.map(m => m.product.id);
            const { data: _pricesData } = await this.supabase.rpc('get_prices_bulk', {
                p_product_ids: productIds
            });
            const allPrices = _pricesData ?? [];

            // שלב 3: בנה מפת עגלה per-chain
            const chainMap = {};
            for (const { item, product } of matched) {
                const productPrices = allPrices.filter(p => p.product_id === product.id); // ממוין ASC
                const cheapest = productPrices[0];

                // עדכן תצוגה ב-item row
                if (cheapest) {
                    item.priceData = { chain: cheapest.chain_name, price: parseFloat(cheapest.price) };
                }

                // הוסף לכל רשת את מחיר הפריט הזה (ממוין כבר = הזול ביותר)
                for (const p of productPrices) {
                    if (!chainMap[p.chain_name]) {
                        chainMap[p.chain_name] = {
                            chain_name: p.chain_name, logo_url: p.logo_url,
                            total: 0, found: 0, items: []
                        };
                    }
                    // רק המחיר הזול של הפריט הזה ברשת הזו (first entry per product per chain)
                    const alreadyAdded = chainMap[p.chain_name].items.some(it => it.name === item.text);
                    if (!alreadyAdded) {
                        const qty = item.quantity || 1;
                        chainMap[p.chain_name].total += parseFloat(p.price) * qty;
                        chainMap[p.chain_name].found++;
                        chainMap[p.chain_name].items.push({
                            name: item.text, qty,
                            price: parseFloat(p.price),
                            isPromo: p.is_promotional
                        });
                    }
                }
            }

            this.cartOptimization = {
                matched: matched.length,
                total: activeItems.length,
                chains: Object.values(chainMap).sort((a, b) => a.total - b.total)
            };

            this.items = [...this.items];
            this.render();
            this._showOptimizationPanel();
        } catch (err) {
            console.error('Optimization error:', err);
            alert('שגיאה בהשוואת מחירים. נסו שוב.');
        } finally {
            if (this.optimizeBtn) this.optimizeBtn.innerHTML = '<span class="icon">💰</span>';
        }
    }

    _showOptimizationPanel() {
        const opt = this.cartOptimization;
        if (!opt?.chains?.length) return;

        document.getElementById('opt-panel')?.remove();
        const panel = document.createElement('div');
        panel.id = 'opt-panel';
        panel.className = 'opt-panel';

        const best = opt.chains[0];
        const savings = opt.chains.length > 1
            ? (opt.chains[opt.chains.length - 1].total - best.total).toFixed(2)
            : null;

        panel.innerHTML = `
            <div class="opt-panel-header">
                <div>
                    <div class="opt-panel-title">השוואת עגלה (${opt.matched}/${opt.total} פריטים)</div>
                    ${savings ? `<div class="opt-savings">חיסכון של עד ₪${savings} ביחס לרשת היקרה ביותר</div>` : ''}
                </div>
                <button class="opt-close-btn" onclick="document.getElementById('opt-panel').remove()">✕</button>
            </div>
            <div class="opt-chains">
                ${opt.chains.map((ch, idx) => `
                    <div class="opt-chain-card ${idx === 0 ? 'opt-chain-best' : ''}">
                        <div class="opt-chain-header">
                            ${ch.logo_url ? `<img class="price-chain-logo" src="${ch.logo_url}" alt="${ch.chain_name}" onerror="this.style.display='none'">` : ''}
                            <div>
                                <div class="opt-chain-name">${ch.chain_name}${idx === 0 ? ' 🏆' : ''}</div>
                                <div class="opt-chain-sub">${ch.found} מתוך ${opt.total} פריטים</div>
                            </div>
                            <div class="opt-chain-total">₪${ch.total.toFixed(2)}</div>
                        </div>
                        <div class="opt-items-list">
                            ${ch.items.map(it => `
                                <div class="opt-item-row">
                                    <span>${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}${it.isPromo ? ' <span class="price-promo-badge">מבצע</span>' : ''}</span>
                                    <span>₪${(it.price * it.qty).toFixed(2)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        document.querySelector('.content-area').prepend(panel);
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        const newItem = { text, completed: false, category_id: categoryId, quantity: qty, family_code: this.familyCode };

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

        // search_products מחזיר cheapest_price + cheapest_chain ישירות — ללא N+1
        let products;
        try {
            const timeout = new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000));
            const { data } = await Promise.race([
                this.supabase.rpc('search_products', { query_text: query, result_limit: 8 }),
                timeout
            ]);
            products = data;
        } catch { dropdown.innerHTML = ''; return; }
        if (!products?.length) { dropdown.innerHTML = ''; return; }

        dropdown.innerHTML = products.map(p => `
            <div class="catalog-option" data-id="${p.id}">
                <div class="catalog-option-top">
                    <span class="catalog-option-name">${p.product_name}</span>
                    ${p.brand ? `<span class="catalog-option-brand">${p.brand}</span>` : ''}
                </div>
                ${p.cheapest_price != null
                    ? `<span class="catalog-option-price">₪${Number(p.cheapest_price).toFixed(2)} ב${p.cheapest_chain}</span>`
                    : `<span class="catalog-option-free">ללא מחיר</span>`}
            </div>
        `).join('');

        dropdown.querySelectorAll('.catalog-option').forEach(el => {
            el.addEventListener('click', () => {
                const product = products.find(p => p.id === el.dataset.id);
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
        if (!await this._confirm('למחוק את כל הפריטים ברשימה?')) return;
        
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
                        ${item.priceData?.price && item.priceData?.chain && !item.completed
                            ? `<span style="font-size:0.75rem;color:#10b981;font-weight:600;">₪${item.priceData.price.toFixed(2)} · ${item.priceData.chain}</span>`
                            : item.priceNotFound && !item.completed
                                ? `<button class="no-price-btn" onclick="event.stopPropagation();window.app.searchItemPrice('${item.id}')">🔍 מצא מחיר</button>`
                                : ''}
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
        document.getElementById('cart-total-row')?.remove();

        // אם יש תוצאת אופטימיזציה — הצג את הרשת הזולה ביותר
        const best = this.cartOptimization?.chains?.[0];
        if (best) {
            const row = document.createElement('div');
            row.id = 'cart-total-row';
            row.className = 'cart-total';
            row.innerHTML = `
                <div>
                    <div class="cart-total-label">הכי זול — ${best.chain_name}</div>
                    <div class="cart-total-partial">(${best.found} מתוך ${activeItems.length} פריטים)</div>
                </div>
                <span class="cart-total-amount">₪${best.total.toFixed(2)}</span>
            `;
            this.listContainer.appendChild(row);
            return;
        }

        // אחרת — סכום מחירים זמינים (לפני אופטימיזציה)
        const withPrice = activeItems.filter(i => i.priceData?.price && i.priceData?.chain);
        if (!withPrice.length) return;
        const total = withPrice.reduce((sum, i) => sum + i.priceData.price * (i.quantity || 1), 0);
        const isPartial = withPrice.length < activeItems.length;

        const row = document.createElement('div');
        row.id = 'cart-total-row';
        row.className = 'cart-total';
        row.innerHTML = `
            <div>
                <div class="cart-total-label">סה"כ משוער</div>
                ${isPartial ? `<div class="cart-total-partial">(${withPrice.length} מתוך ${activeItems.length} פריטים)</div>` : ''}
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

    async fetchAllHistory() {
        if (!this.supabase) return [];
        const { data, error } = await this.supabase
            .from('purchase_history')
            .select('*')
            .eq('family_code', this.familyCode)
            .order('purchased_at', { ascending: false })
            .limit(500);
        if (error) { console.error('Error fetching all history:', error); return []; }
        return data || [];
    }

    async renderStats() {
        const timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms));
        let popular = [], history = [], chainsRes = { data: [] };
        try {
            [popular, history, chainsRes] = await Promise.race([
                Promise.all([
                    this.fetchPopularItems(),
                    this.fetchAllHistory(),
                    this.supabase ? this.supabase.from('supermarket_chains').select('id,chain_name') : Promise.resolve({ data: [] })
                ]),
                timeout(8000).then(() => { throw new Error('timeout'); })
            ]);
        } catch {
            this.statsContainer.innerHTML = `<div class="empty-state"><p>אין מספיק נתונים לסטטיסטיקה. התחילו לקנות!</p></div>`;
            return;
        }

        if (popular.length === 0 && history.length === 0) {
            this.statsContainer.innerHTML = `<div class="empty-state"><p>אין מספיק נתונים לסטטיסטיקה. התחילו לקנות!</p></div>`;
            return;
        }

        const chains = chainsRes.data || [];

        // KPIs
        const totalPurchases = history.length;
        const uniqueItems = new Set(history.map(h => h.item_name?.toLowerCase())).size;

        const chainCounts = {};
        history.forEach(h => {
            if (h.chain_id) chainCounts[h.chain_id] = (chainCounts[h.chain_id] || 0) + 1;
        });
        let favoriteChainName = '—';
        if (Object.keys(chainCounts).length) {
            const topChainId = Object.entries(chainCounts).sort((a, b) => b[1] - a[1])[0][0];
            const found = chains.find(c => c.id === topChainId);
            if (found) favoriteChainName = found.chain_name;
        }

        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        const dayCounts = [0, 0, 0, 0, 0, 0, 0];
        history.forEach(h => {
            if (h.purchased_at) {
                const d = new Date(h.purchased_at).getDay();
                dayCounts[d]++;
            }
        });
        const maxDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
        const mostActiveDay = dayCounts[maxDayIdx] > 0 ? dayNames[maxDayIdx] : '—';

        // Category bars (top 6)
        const catCounts = {};
        history.forEach(h => {
            const cid = h.category_id || 'other';
            catCounts[cid] = (catCounts[cid] || 0) + 1;
        });
        const topCats = Object.entries(catCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6);
        const maxCatCount = topCats[0]?.[1] || 1;

        const catBarsHtml = topCats.map(([cid, cnt]) => {
            const cat = this.categories[cid];
            const label = cat ? `${cat.emoji} ${cat.name}` : cid;
            const pct = Math.round((cnt / maxCatCount) * 100);
            return `
                <div class="stats-bar-row">
                    <div class="stats-bar-label">${label}</div>
                    <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%"></div></div>
                    <div class="stats-bar-count">${cnt}</div>
                </div>`;
        }).join('');

        // Day-of-week chart
        const maxDayCount = Math.max(...dayCounts, 1);
        const dayChartHtml = dayCounts.map((cnt, i) => {
            const pct = Math.round((cnt / maxDayCount) * 100);
            const isMax = i === maxDayIdx && cnt > 0;
            return `
                <div class="stats-day-col">
                    <div class="stats-day-bar-wrap">
                        <div class="stats-day-bar${isMax ? ' stats-day-bar-max' : ''}" style="height:${pct}%"></div>
                    </div>
                    <div class="stats-day-label${isMax ? ' stats-day-label-max' : ''}">${dayNames[i].slice(0, 3)}</div>
                </div>`;
        }).join('');

        // Popular items list
        const popularHtml = popular.map((item, idx) => `
            <div class="stat-card">
                <div class="stat-rank">#${idx + 1}</div>
                <div class="stat-info">
                    <strong>${item.item_name}</strong>
                    <span class="stat-meta">נקנה ${item.purchase_count} פעמים | לפני ${item.days_since_last} ימים</span>
                </div>
                <div class="stat-score" title="Popularity Score">${item.popularity_score} ⭐</div>
            </div>`).join('');

        this.statsContainer.innerHTML = `
            <div class="stats-dashboard">
                <div class="stats-summary-row">
                    <div class="stats-kpi">
                        <div class="stats-kpi-value">${totalPurchases}</div>
                        <div class="stats-kpi-label">סה"כ קניות</div>
                    </div>
                    <div class="stats-kpi">
                        <div class="stats-kpi-value">${uniqueItems}</div>
                        <div class="stats-kpi-label">פריטים שונים</div>
                    </div>
                    <div class="stats-kpi">
                        <div class="stats-kpi-value stats-kpi-sm">${favoriteChainName}</div>
                        <div class="stats-kpi-label">רשת מועדפת</div>
                    </div>
                    <div class="stats-kpi">
                        <div class="stats-kpi-value stats-kpi-sm">${mostActiveDay}</div>
                        <div class="stats-kpi-label">יום פעיל</div>
                    </div>
                </div>
                ${topCats.length ? `
                <div class="stats-section">
                    <div class="stats-section-title">📦 קניות לפי קטגוריה</div>
                    <div class="stats-bars">${catBarsHtml}</div>
                </div>` : ''}
                <div class="stats-section">
                    <div class="stats-section-title">📅 קניות לפי יום בשבוע</div>
                    <div class="stats-day-chart">${dayChartHtml}</div>
                </div>
                ${popular.length ? `
                <div class="stats-section">
                    <div class="stats-section-title">📊 המוצרים הנקנים ביותר</div>
                    <div class="stats-list">${popularHtml}</div>
                </div>` : ''}
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
        // בדוק התראות מחיר כל שעה כשהאפליקציה פתוחה
        setInterval(() => this.checkPriceAlerts(window.app?.familyCode ?? 'default'), 3600000);
    }

    show() {
        this._renderSearchView();
    }

    // ── תצוגת חיפוש ──────────────────────────────────────────
    _renderSearchView() {
        if (!this.container) this.container = document.getElementById('prices-container');
        if (!this.container) return;
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
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 8000)
            );
            let data, error;
            try {
                ({ data, error } = await Promise.race([
                    this.supabase.rpc('search_products', { query_text: query, result_limit: 20 }),
                    timeout
                ]));
            } catch (e) {
                dropdown.innerHTML = `<div class="price-result-empty">החיפוש לקח יותר מדי זמן — נסו שוב</div>`;
                return;
            }
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

        let prices, allChains = [], history = [];
        if (this.supabase && navigator.onLine) {
            const [pricesRes, chainsRes, historyRes] = await Promise.all([
                this.supabase.rpc('get_product_prices', { p_product_id: product.id }),
                this.supabase.from('supermarket_chains').select('chain_name'),
                this.supabase.rpc('get_price_history', { p_product_id: product.id, p_days: 30 })
            ]);
            if (pricesRes.error) console.error('get_product_prices RPC error:', pricesRes.error);
            prices = pricesRes.data ?? [];
            allChains = chainsRes.data?.map(c => c.chain_name) ?? [];
            history = historyRes.data ?? [];
        } else {
            await new Promise(r => setTimeout(r, 350));
            prices = this._mockPrices(product.id);
        }

        this._renderPricePanel(prices, allChains, history);
    }

    _renderPricePanel(prices, allChains = [], history = []) {
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

        const priceTrend = (current, previous) => {
            if (previous == null) return '';
            if (current < previous) return `<span class="price-trend up">↓ ירד מ-₪${Number(previous).toFixed(2)}</span>`;
            if (current > previous) return `<span class="price-trend down">↑ עלה מ-₪${Number(previous).toFixed(2)}</span>`;
            return '';
        };

        panel.innerHTML = `
            <div class="price-panel-header">
                <div>
                    <div class="price-panel-title">${this.selectedProduct.product_name}</div>
                    <div class="price-panel-meta">ברקוד: ${this.selectedProduct.barcode} &nbsp;·&nbsp; ${prices.length} רשתות</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-secondary price-watch-btn" title="עקוב אחרי המחיר"
                            onclick="window.app.priceModule.watchPrice()">⭐ עקוב</button>
                    <button class="btn btn-primary price-add-btn"
                            onclick="window.app.addItem('${this.selectedProduct.product_name.replace(/'/g, "\\'")}')">
                        + הוסף
                    </button>
                </div>
            </div>

            ${this._renderPriceChart(history)}
            <div class="price-cheapest-label">🏆 הכי זול</div>
            <div class="price-cheapest-card${isStale ? ' price-row-stale' : ''}">
                <div class="price-chain-info">
                    ${cheapest.logo_url ? `<img class="price-chain-logo" src="${cheapest.logo_url}" alt="${cheapest.chain_name}" onerror="this.style.display='none'">` : ''}
                    <div>
                        <span class="price-chain-name">${cheapest.chain_name}</span>
                        <div class="price-row-freshness">${formatFreshness(cheapest.scraped_at)}</div>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${cheapest.is_promotional ? '<span class="price-promo-badge">מבצע</span>' : ''}
                        <span class="price-amount cheapest">₪${Number(cheapest.price).toFixed(2)}</span>
                    </div>
                    ${priceTrend(cheapest.price, cheapest.previous_price)}
                </div>
            </div>

            ${rest.length ? `
            <div class="price-rest-label">שאר הרשתות</div>
            <div class="price-rest-list">
                ${rest.map(p => {
                    const rowStale = (Date.now() - new Date(p.scraped_at)) > 48 * 3600000;
                    return `
                    <div class="price-row${rowStale ? ' price-row-stale' : ''}">
                        <div class="price-chain-info">
                            ${p.logo_url ? `<img class="price-chain-logo" src="${p.logo_url}" alt="${p.chain_name}" onerror="this.style.display='none'">` : ''}
                            <div>
                                <span class="price-chain-name">${p.chain_name}</span>
                                <div class="price-row-freshness">${formatFreshness(p.scraped_at)}</div>
                            </div>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                ${p.is_promotional ? '<span class="price-promo-badge">מבצע</span>' : ''}
                                <span class="price-amount">₪${Number(p.price).toFixed(2)}</span>
                            </div>
                            ${priceTrend(p.price, p.previous_price)}
                        </div>
                    </div>`;
                }).join('')}
            </div>` : ''}

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

    _renderPriceChart(history) {
        if (!history?.length) return '';
        const W = 300, H = 60, PAD = 6;
        const prices = history.map(d => parseFloat(d.min_price));
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        const range = maxP - minP || 0.01;
        const n = history.length;

        const pts = prices.map((p, i) => {
            const x = (PAD + (i / Math.max(n - 1, 1)) * (W - PAD * 2)).toFixed(1);
            const y = (PAD + ((maxP - p) / range) * (H - PAD * 2)).toFixed(1);
            return [x, y];
        });

        const polyline = pts.map(p => p.join(',')).join(' ');
        const area = `${pts[0][0]},${H} ${polyline} ${pts[pts.length - 1][0]},${H}`;

        const fmt = iso => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };

        return `
            <div class="price-chart-section">
                <div class="price-chart-title">מגמת מחיר — 30 ימים אחרונים</div>
                <div class="price-chart-wrap">
                    <div class="price-chart-y">
                        <span>₪${maxP.toFixed(2)}</span>
                        <span>₪${minP.toFixed(2)}</span>
                    </div>
                    <svg viewBox="0 0 ${W} ${H}" class="price-chart-svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
                                <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
                            </linearGradient>
                        </defs>
                        <polygon points="${area}" fill="url(#chartGrad)"/>
                        <polyline points="${polyline}" fill="none" stroke="#10b981" stroke-width="2"
                                  stroke-linejoin="round" stroke-linecap="round"/>
                        <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="#10b981"/>
                    </svg>
                </div>
                <div class="price-chart-dates">
                    <span>${fmt(history[0].day)}</span>
                    <span>${fmt(history[history.length - 1].day)}</span>
                </div>
            </div>`;
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

        if (!this.supabase || !navigator.onLine) {
            const product = MOCK_PRODUCTS.find(p => p.barcode === barcode);
            if (!product) {
                panel.innerHTML = `<div class="empty-state"><p>ברקוד ${barcode} לא נמצא במאגר</p><small>המאגר מתעדכן כל לילה</small></div>`;
                return;
            }
            this._onProductSelected(product);
            return;
        }

        const { data: product, error } = await this.supabase
            .from('market_products')
            .select('*')
            .eq('barcode', barcode)
            .maybeSingle();

        if (error) {
            panel.innerHTML = `<div class="empty-state"><p>שגיאה בחיפוש ברקוד</p><small>${error.message}</small></div>`;
            return;
        }

        if (!product) {
            // Fallback: cheapersal API (100 req/day free)
            panel.innerHTML = `<div class="price-loading">מחפש ב-Cheapersal...</div>`;
            try {
                const ext = await fetch(`https://cheapersal.co.il/api/v1/products/${barcode}`, {
                    signal: AbortSignal.timeout(8000)
                });
                if (ext.ok) {
                    const extData = await ext.json();
                    if (extData?.barcode) {
                        this._onProductSelected({
                            id: extData.barcode,
                            barcode: extData.barcode,
                            product_name: extData.name ?? extData.product_name ?? barcode,
                            brand: extData.brand ?? ''
                        });
                        return;
                    }
                }
            } catch { /* fallback נכשל — הצג "לא נמצא" */ }

            panel.innerHTML = `<div class="empty-state"><p>ברקוד ${barcode} לא נמצא</p><small>המאגר מתעדכן כל לילה בשעה 4</small></div>`;
            return;
        }
        this._onProductSelected(product);
    }

    // ── Price Watch ──────────────────────────────────────────
    async watchPrice() {
        if (!this.selectedProduct || !this.supabase) return;
        const p = this.selectedProduct;
        const targetStr = prompt(`עקוב אחרי: ${p.product_name}\n\nהזן מחיר מטרה (₪) — השאר ריק לכל ירידה:`, '');
        if (targetStr === null) return; // ביטול

        const target = targetStr.trim() ? parseFloat(targetStr) : null;
        if (target !== null && isNaN(target)) { alert('מחיר לא תקין'); return; }

        const { error } = await this.supabase.from('watched_items').upsert({
            product_id:   p.id,
            product_name: p.product_name,
            barcode:      p.barcode,
            family_code:  window.app?.familyCode ?? 'default',
            target_price: target
        }, { onConflict: 'product_id,family_code' });

        if (error) { alert('שגיאה בשמירת מעקב'); return; }

        // בקש הרשאת notifications בעת הוספת מעקב
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        alert(`✅ עוקבים אחרי ${p.product_name}${target ? ` — תתרענן כשמחיר ≤ ₪${target}` : ''}`);
    }

    async checkPriceAlerts(familyCode) {
        if (!this.supabase) return;
        const { data: alerts } = await this.supabase.rpc('get_watched_alerts', {
            p_family_code: familyCode
        });
        if (!alerts?.length) return;

        const container = document.getElementById('price-alerts-banner');
        if (!container) return;

        container.innerHTML = `
            <div class="price-alerts">
                <div class="price-alerts-title">🔔 עדכוני מחיר על פריטים שעוקבים</div>
                ${alerts.map(a => `
                    <div class="price-alert-row">
                        ${a.logo_url ? `<img class="price-chain-logo" src="${a.logo_url}" onerror="this.style.display='none'">` : ''}
                        <div class="price-alert-info">
                            <strong>${a.product_name}</strong>
                            <span>₪${Number(a.current_price).toFixed(2)} ב${a.chain_name}${a.is_promotional ? ' 🏷️' : ''}</span>
                        </div>
                        ${a.target_price ? `<span class="price-alert-target">מטרה: ₪${Number(a.target_price).toFixed(2)}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
        container.style.display = 'block';

        // Browser notification (רק אם ניתנה הרשאה)
        if ('Notification' in window && Notification.permission === 'granted') {
            alerts.forEach(a => {
                new Notification('חבי — עדכון מחיר 🛒', {
                    body: `${a.product_name}: ₪${Number(a.current_price).toFixed(2)} ב${a.chain_name}${a.is_promotional ? ' (מבצע!)' : ''}`,
                    icon: './icon-192.png',
                    tag: `price-alert-${a.product_id}`
                });
            });
        }
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
