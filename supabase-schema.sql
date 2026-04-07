-- ===================================================
-- Supabase Schema - Family Smart Shopping App
-- ===================================================
-- הרץ את הקוד הזה ב-Supabase SQL Editor
-- (https://app.supabase.com → פרויקט שלך → SQL Editor)
-- ===================================================

-- 1. טבלת פריטים ברשימת הקניות
CREATE TABLE IF NOT EXISTS shopping_items (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    text        TEXT NOT NULL,
    completed   BOOLEAN DEFAULT FALSE,
    category_id TEXT DEFAULT 'other',
    family_code TEXT DEFAULT 'default',
    quantity    INTEGER DEFAULT 1,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. טבלת היסטוריית קניות (OCR + ידני)
CREATE TABLE IF NOT EXISTS purchase_history (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    item_name    TEXT NOT NULL,
    price        NUMERIC(8, 2),                  -- מחיר (אופציונלי)
    store_name   TEXT,                            -- שם הסופר
    family_code  TEXT DEFAULT 'default',
    purchased_at TIMESTAMPTZ DEFAULT now()
);

-- 3. אינדקסים לביצועים
CREATE INDEX IF NOT EXISTS idx_shopping_family ON shopping_items(family_code);
CREATE INDEX IF NOT EXISTS idx_history_family  ON purchase_history(family_code);

-- 4. Row Level Security (RLS) - בסיסי לכרגע
ALTER TABLE shopping_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_history ENABLE ROW LEVEL SECURITY;

-- מדיניות: כולם יכולים לקרוא ולכתוב (Public access - לשלב MVP)
DROP POLICY IF EXISTS "Public access items"   ON shopping_items;
DROP POLICY IF EXISTS "Public access history" ON purchase_history;
CREATE POLICY "Public access items"   ON shopping_items   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access history" ON purchase_history FOR ALL USING (true) WITH CHECK (true);

-- 5. פונקציה לעדכון updated_at אוטומטי
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON shopping_items;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON shopping_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. הפעלת Realtime
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'shopping_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE shopping_items;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'purchase_history'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE purchase_history;
    END IF;
END $$;

-- ===================================================
-- PHASE 2: Smart Purchase Intelligence
-- הרץ את הקוד הבא נפרד לאחר ביצוע הסכמה הראשונה
-- ===================================================

-- 7. שדרוג טבלת purchase_history למעקב חכם
ALTER TABLE purchase_history
    ADD COLUMN IF NOT EXISTS category_id  TEXT DEFAULT 'other',
    ADD COLUMN IF NOT EXISTS quantity     INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS days_since_last INTEGER; -- ימים מאז הקנייה הקודמת

-- אינדקסים נוספים
CREATE INDEX IF NOT EXISTS idx_history_item ON purchase_history(item_name);
CREATE INDEX IF NOT EXISTS idx_history_date ON purchase_history(purchased_at DESC);

-- 8. Trigger – רישום אוטומטי ל-purchase_history כשפריט מסומן כ"הושלם"
CREATE OR REPLACE FUNCTION log_purchase_on_complete()
RETURNS TRIGGER AS $$
DECLARE
    last_purchase TIMESTAMPTZ;
    days_gap INTEGER;
BEGIN
    -- מופעל רק כשהשדה completed משתנה מ-false ל-true
    IF OLD.completed = FALSE AND NEW.completed = TRUE THEN

        -- מצא את תאריך הקנייה הקודמת לאותו פריט
        SELECT purchased_at INTO last_purchase
        FROM purchase_history
        WHERE LOWER(item_name) = LOWER(NEW.text)
          AND family_code = NEW.family_code
        ORDER BY purchased_at DESC
        LIMIT 1;

        -- חשב פער בימים
        IF last_purchase IS NOT NULL THEN
            days_gap := EXTRACT(DAY FROM (now() - last_purchase));
        ELSE
            days_gap := NULL; -- קנייה ראשונה
        END IF;

        -- רשום בהיסטוריה
        INSERT INTO purchase_history (
            item_name, category_id, quantity,
            family_code, days_since_last, purchased_at
        ) VALUES (
            NEW.text, NEW.category_id, COALESCE(NEW.quantity, 1),
            NEW.family_code, days_gap, now()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- חבר את ה-Trigger לטבלה
DROP TRIGGER IF EXISTS trigger_log_purchase ON shopping_items;
CREATE TRIGGER trigger_log_purchase
AFTER UPDATE ON shopping_items
FOR EACH ROW EXECUTE FUNCTION log_purchase_on_complete();

-- 9. View: popular_items – ניקוד פופולריות חכם
-- score = (purchase_count × 0.4) + (1/days_since × 0.35) + (avg_qty × 0.25)
CREATE OR REPLACE VIEW popular_items AS
SELECT
    item_name,
    MAX(category_id)                                  AS category_id,
    COUNT(*)                                          AS purchase_count,
    ROUND(AVG(quantity), 1)                           AS avg_quantity,
    MAX(purchased_at)                                 AS last_purchased_at,
    EXTRACT(DAY FROM (now() - MAX(purchased_at)))::INT AS days_since_last,
    ROUND(
        (COUNT(*) * 0.4)
        + (CASE WHEN EXTRACT(DAY FROM (now() - MAX(purchased_at))) > 0
                THEN (1.0 / EXTRACT(DAY FROM (now() - MAX(purchased_at)))) * 0.35
                ELSE 0.35 END)
        + (AVG(quantity) * 0.25),
    3) AS popularity_score,
    family_code
FROM purchase_history
GROUP BY item_name, family_code
ORDER BY popularity_score DESC;

-- הגדר הרשאות ל-View
DROP POLICY IF EXISTS "Public access history" ON purchase_history;
CREATE POLICY "Public access history" ON purchase_history FOR ALL USING (true) WITH CHECK (true);

-- ===================================================
-- PHASE 3: Israeli Grocery Price Intelligence
-- ===================================================

-- 10. טבלת רשתות שיווק (Chains)
CREATE TABLE IF NOT EXISTS supermarket_chains (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chain_name  TEXT NOT NULL UNIQUE,
    logo_url    TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- 11. טבלת מוצרים (Products/Barcode cache)
CREATE TABLE IF NOT EXISTS market_products (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    barcode       TEXT UNIQUE,
    product_name  TEXT NOT NULL,
    brand         TEXT,
    category_id   TEXT DEFAULT 'other',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 12. טבלת מחירי שוק (Market Prices)
CREATE TABLE IF NOT EXISTS market_prices (
    id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id       UUID REFERENCES market_products(id) ON DELETE CASCADE,
    chain_id         UUID REFERENCES supermarket_chains(id) ON DELETE CASCADE,
    price            NUMERIC(8, 2) NOT NULL,
    is_promotional   BOOLEAN DEFAULT FALSE,
    scraped_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE(product_id, chain_id)
);

-- אינדקסים לחיפוש מהיר
CREATE INDEX IF NOT EXISTS idx_market_product_name ON market_products(product_name);
CREATE INDEX IF NOT EXISTS idx_market_prices_prod ON market_prices(product_id);

-- RLS: גישה ציבורית לשלב ה-MVP
ALTER TABLE supermarket_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_prices      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access chains"   ON supermarket_chains;
DROP POLICY IF EXISTS "Public access products" ON market_products;
DROP POLICY IF EXISTS "Public access prices"   ON market_prices;
CREATE POLICY "Public access chains"   ON supermarket_chains FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access products" ON market_products    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access prices"   ON market_prices      FOR ALL USING (true) WITH CHECK (true);

-- הוספת שדה לחיבור היסטוריית רכישות לרשת השיווק הספציפית
ALTER TABLE purchase_history
    ADD COLUMN IF NOT EXISTS chain_id UUID REFERENCES supermarket_chains(id) ON DELETE SET NULL;

-- ===================================================
-- PHASE 3b: Price History + Logos + Index
-- ===================================================

-- 12b. אינדקס על scraped_at — לסינון "מחיר עדכני בלבד" (< 48 שעות)
CREATE INDEX IF NOT EXISTS idx_market_prices_scraped ON market_prices(scraped_at DESC);

-- 12c. טבלת היסטוריית מחירים — כל שינוי מחיר נשמר לצמיתות
-- מאפשר: זיהוי עליות/ירידות, גרף מחיר לאורך זמן, התראות
CREATE TABLE IF NOT EXISTS price_history (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id   UUID REFERENCES market_products(id) ON DELETE CASCADE,
    chain_id     UUID REFERENCES supermarket_chains(id) ON DELETE CASCADE,
    price        NUMERIC(8, 2) NOT NULL,
    is_promotional BOOLEAN DEFAULT FALSE,
    recorded_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_history_prod    ON price_history(product_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_chain   ON price_history(chain_id, recorded_at DESC);

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access price_history" ON price_history;
CREATE POLICY "Public access price_history" ON price_history FOR ALL USING (true) WITH CHECK (true);

-- 12d. Trigger: בכל upsert ב-market_prices שמשנה מחיר — תרשום ל-price_history
CREATE OR REPLACE FUNCTION log_price_change()
RETURNS TRIGGER AS $$
BEGIN
    -- רשום רק אם המחיר שונה (או שורה חדשה)
    IF TG_OP = 'INSERT' OR OLD.price IS DISTINCT FROM NEW.price THEN
        INSERT INTO price_history (product_id, chain_id, price, is_promotional, recorded_at)
        VALUES (NEW.product_id, NEW.chain_id, NEW.price, NEW.is_promotional, now());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_price_change ON market_prices;
CREATE TRIGGER trigger_log_price_change
AFTER INSERT OR UPDATE ON market_prices
FOR EACH ROW EXECUTE FUNCTION log_price_change();

-- 12e. Seed: לוגואות לרשתות ידועות
-- (מריצים לאחר שה-sync הראשון יצר את הרשומות ב-supermarket_chains)
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/thumb/6/64/Shufersal_Logo.svg/200px-Shufersal_Logo.svg.png' WHERE chain_name = 'שופרסל';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/thumb/1/1e/Rami_Levy_logo.svg/200px-Rami_Levy_logo.svg.png'   WHERE chain_name = 'רמי לוי';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/thumb/5/5e/Victory_Supermarkets_Logo.svg/200px-Victory_Supermarkets_Logo.svg.png' WHERE chain_name = 'ויקטורי';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/thumb/0/09/TivTaam_Logo.svg/200px-TivTaam_Logo.svg.png'         WHERE chain_name = 'טיב טעם';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/1/14/Yeinot_Bitan_logo.png'                                       WHERE chain_name = 'יינות ביתן';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/thumb/6/61/Osher_Ad_Logo.svg/200px-Osher_Ad_Logo.svg.png'         WHERE chain_name = 'אושר עד';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/thumb/c/c1/Yohananof_logo.svg/200px-Yohananof_logo.svg.png'        WHERE chain_name = 'יוחננוף';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/0/0f/Hazi-Hinam_logo.png'                                               WHERE chain_name = 'חצי חינם';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/e/e9/%D7%9C%D7%95%D7%92%D7%95_%D7%9E%D7%97%D7%A1%D7%A0%D7%99_%D7%94%D7%A9%D7%95%D7%A7.png' WHERE chain_name = 'מחסני השוק';
UPDATE supermarket_chains SET logo_url = 'https://upload.wikimedia.org/wikipedia/he/d/d7/%D7%A7%D7%A9%D7%AA_%D7%98%D7%A2%D7%9E%D7%99%D7%9D.png'             WHERE chain_name = 'קשת טעמים';
UPDATE supermarket_chains SET logo_url = 'https://www.stopmarket.co.il/wp-content/uploads/2021/06/logo3.png'                                                WHERE chain_name = 'סטופ מרקט';
UPDATE supermarket_chains SET logo_url = 'https://lirp.cdn-website.com/05679a53/dms3rep/multi/opt/%D7%9C%D7%9C%D7%90+%D7%A8%D7%A7%D7%A2+%D7%9C%D7%95%D7%92%D7%95+-423w.png' WHERE chain_name = 'ח. כהן';

-- 17. RPC: מחירי כל הרשתות עבור מספר מוצרים בו-זמנית
--     משמש לאופטימיזציית עגלה — קריאה אחת במקום N+1
--     קריאה: supabase.rpc('get_prices_bulk', { p_product_ids: ['uuid1','uuid2',...] })
DROP FUNCTION IF EXISTS get_prices_bulk(UUID[]);
CREATE OR REPLACE FUNCTION get_prices_bulk(p_product_ids UUID[])
RETURNS TABLE (
    product_id     UUID,
    chain_id       UUID,
    chain_name     TEXT,
    logo_url       TEXT,
    price          NUMERIC,
    is_promotional BOOLEAN
)
LANGUAGE SQL STABLE AS $$
    SELECT
        mpr.product_id,
        sc.id AS chain_id,
        sc.chain_name,
        sc.logo_url,
        mpr.price,
        mpr.is_promotional
    FROM market_prices mpr
    JOIN supermarket_chains sc ON sc.id = mpr.chain_id
    WHERE mpr.product_id = ANY(p_product_ids)
    ORDER BY mpr.product_id, mpr.price ASC;
$$;

-- ===================================================
-- PHASE 3c: Price Watch (מעקב מחירים)
-- ===================================================

-- 18. טבלת מעקב מחירים — משתמש בוחר מוצר לקבלת התראה כשהמחיר יורד
CREATE TABLE IF NOT EXISTS watched_items (
    id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id   UUID REFERENCES market_products(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    barcode      TEXT,
    family_code  TEXT NOT NULL DEFAULT 'default',
    target_price NUMERIC(8,2),           -- NULL = התרע על כל ירידה
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(product_id, family_code)       -- מוצר אחד per family
);

CREATE INDEX IF NOT EXISTS idx_watched_family ON watched_items(family_code);

ALTER TABLE watched_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access watched" ON watched_items;
CREATE POLICY "Public access watched" ON watched_items FOR ALL USING (true) WITH CHECK (true);

-- 19. RPC: בדיקת התראות — מחזיר מוצרים שנצפו + מחירם הנוכחי
--     אם target_price מוגדר — מחזיר רק כשהמחיר הזול ≤ target_price
--     קריאה: supabase.rpc('get_watched_alerts', { p_family_code: 'ABC123' })
DROP FUNCTION IF EXISTS get_watched_alerts(TEXT);
CREATE OR REPLACE FUNCTION get_watched_alerts(p_family_code TEXT)
RETURNS TABLE (
    watch_id      UUID,
    product_id    UUID,
    product_name  TEXT,
    barcode       TEXT,
    target_price  NUMERIC,
    current_price NUMERIC,
    chain_name    TEXT,
    logo_url      TEXT,
    is_promotional BOOLEAN
)
LANGUAGE SQL STABLE AS $$
    SELECT
        wi.id          AS watch_id,
        wi.product_id,
        wi.product_name,
        wi.barcode,
        wi.target_price,
        best.price     AS current_price,
        best.chain_name,
        best.logo_url,
        best.is_promotional
    FROM watched_items wi
    CROSS JOIN LATERAL (
        SELECT mpr.price, sc.chain_name, sc.logo_url, mpr.is_promotional
        FROM market_prices mpr
        JOIN supermarket_chains sc ON sc.id = mpr.chain_id
        WHERE mpr.product_id = wi.product_id
          AND (wi.target_price IS NULL OR mpr.price <= wi.target_price)
        ORDER BY mpr.price ASC
        LIMIT 1
    ) best
    WHERE wi.family_code = p_family_code
    ORDER BY best.price ASC;
$$;

-- ===================================================
-- PHASE 4: Price Comparison Module — Full-Text Search
-- הרץ את הקוד הזה נפרד לאחר Phase 3
-- ===================================================

-- 13. הפעלת תוסף trigram לחיפוש דמיון בעברית
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 14. GIN index על שם המוצר ועל המותג (מאפשר similarity queries מהירים)
CREATE INDEX IF NOT EXISTS idx_market_products_name_trgm
    ON market_products USING GIN (product_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_market_products_brand_trgm
    ON market_products USING GIN (brand gin_trgm_ops);

-- 15. RPC: חיפוש מוצרים לפי טקסט חופשי — מדורג לפי דמיון + מחיר זול בשאילתה אחת
--     קריאה: supabase.rpc('search_products', { query_text: 'חלב', result_limit: 20 })
--     שיפור: מחזיר cheapest_price + cheapest_chain ללא N+1 queries
DROP FUNCTION IF EXISTS search_products(TEXT, INT);
CREATE OR REPLACE FUNCTION search_products(
    query_text   TEXT,
    result_limit INT DEFAULT 20
)
RETURNS TABLE (
    id             UUID,
    barcode        TEXT,
    product_name   TEXT,
    brand          TEXT,
    category_id    TEXT,
    similarity     REAL,
    cheapest_price NUMERIC,
    cheapest_chain TEXT
)
LANGUAGE SQL STABLE AS $$
    SELECT
        mp.id,
        mp.barcode,
        mp.product_name,
        mp.brand,
        mp.category_id,
        -- ניקוד משולב: שם מוצר 70%, מותג 30%
        (
            similarity(mp.product_name, query_text) * 0.7
            + COALESCE(similarity(mp.brand, query_text), 0) * 0.3
        )::REAL AS similarity,
        MIN(mpr.price)                                             AS cheapest_price,
        (array_agg(sc.chain_name ORDER BY mpr.price ASC NULLS LAST))[1] AS cheapest_chain
    FROM market_products mp
    LEFT JOIN market_prices      mpr ON mpr.product_id = mp.id
    LEFT JOIN supermarket_chains sc  ON sc.id = mpr.chain_id
    WHERE
        mp.product_name % query_text
        OR mp.brand % query_text
        OR mp.product_name ILIKE '%' || query_text || '%'
    GROUP BY mp.id, mp.barcode, mp.product_name, mp.brand, mp.category_id
    ORDER BY similarity DESC
    LIMIT result_limit;
$$;

-- 16b. RPC: היסטוריית מחיר יומית למוצר — לגרף טרנד
--      קריאה: supabase.rpc('get_price_history', { p_product_id: '...', p_days: 30 })
DROP FUNCTION IF EXISTS get_price_history(UUID, INT);
CREATE OR REPLACE FUNCTION get_price_history(
    p_product_id UUID,
    p_days INT DEFAULT 30
)
RETURNS TABLE (
    day        DATE,
    min_price  NUMERIC,
    chain_name TEXT
)
LANGUAGE SQL STABLE AS $$
    SELECT
        DATE(ph.recorded_at AT TIME ZONE 'Asia/Jerusalem') AS day,
        MIN(ph.price)                                       AS min_price,
        (array_agg(sc.chain_name ORDER BY ph.price ASC))[1] AS chain_name
    FROM price_history ph
    JOIN supermarket_chains sc ON sc.id = ph.chain_id
    WHERE ph.product_id = p_product_id
      AND ph.recorded_at >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY DATE(ph.recorded_at AT TIME ZONE 'Asia/Jerusalem')
    ORDER BY day ASC;
$$;

-- 16. RPC: שליפת מחירי כל הרשתות למוצר בודד, ממוין מהזול ליקר
--     שיפור: מחזיר גם previous_price מטבלת price_history לזיהוי טרנד (↑↓→)
--     קריאה: supabase.rpc('get_product_prices', { p_product_id: '...' })
DROP FUNCTION IF EXISTS get_product_prices(UUID);
CREATE OR REPLACE FUNCTION get_product_prices(p_product_id UUID)
RETURNS TABLE (
    chain_id       UUID,
    chain_name     TEXT,
    logo_url       TEXT,
    price          NUMERIC,
    previous_price NUMERIC,
    is_promotional BOOLEAN,
    scraped_at     TIMESTAMPTZ
)
LANGUAGE SQL STABLE AS $$
    SELECT
        sc.id AS chain_id,
        sc.chain_name,
        sc.logo_url,
        mpr.price,
        ph.previous_price,
        mpr.is_promotional,
        mpr.scraped_at
    FROM market_prices mpr
    JOIN supermarket_chains sc ON sc.id = mpr.chain_id
    -- שלוף את המחיר הקודם השונה מהנוכחי לכל רשת (LATERAL = efficient per-row subquery)
    LEFT JOIN LATERAL (
        SELECT ph2.price AS previous_price
        FROM price_history ph2
        WHERE ph2.product_id = mpr.product_id
          AND ph2.chain_id   = mpr.chain_id
          AND ph2.price IS DISTINCT FROM mpr.price
        ORDER BY ph2.recorded_at DESC
        LIMIT 1
    ) ph ON true
    WHERE mpr.product_id = p_product_id
    ORDER BY mpr.price ASC;
$$;

-- ===================================================
-- PHASE 5: Store-level prices: add branch_code to market_prices
-- Run after Phase 4
-- ===================================================
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS branch_code TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS market_prices_product_id_chain_id_key;
-- Note: also drop the unique constraint and recreate it:
-- ALTER TABLE market_prices DROP CONSTRAINT IF EXISTS market_prices_product_id_chain_id_key;
-- ALTER TABLE market_prices ADD CONSTRAINT market_prices_product_id_chain_id_branch_key UNIQUE (product_id, chain_id, branch_code);

-- ===================================================
-- PHASE 6: Real Auth + RLS
-- דורש: Anonymous Auth מופעל ב-Supabase Dashboard
-- ===================================================

-- טבלת פרופיל משתמש — מקשרת auth.uid() ל-family_code
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    family_code  TEXT NOT NULL,
    display_name TEXT,
    avatar_url   TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_family ON user_profiles(family_code);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own profile" ON user_profiles;
CREATE POLICY "Users manage own profile" ON user_profiles
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RLS אמיתי על shopping_items
DROP POLICY IF EXISTS "Public access items"  ON shopping_items;
DROP POLICY IF EXISTS "Family access items"  ON shopping_items;
CREATE POLICY "Family access items" ON shopping_items
    FOR ALL
    USING  (family_code IN (SELECT family_code FROM user_profiles WHERE user_id = auth.uid()))
    WITH CHECK (family_code IN (SELECT family_code FROM user_profiles WHERE user_id = auth.uid()));

-- RLS אמיתי על purchase_history
DROP POLICY IF EXISTS "Public access history"  ON purchase_history;
DROP POLICY IF EXISTS "Family access history"  ON purchase_history;
CREATE POLICY "Family access history" ON purchase_history
    FOR ALL
    USING  (family_code IN (SELECT family_code FROM user_profiles WHERE user_id = auth.uid()))
    WITH CHECK (family_code IN (SELECT family_code FROM user_profiles WHERE user_id = auth.uid()));

-- RLS אמיתי על watched_items
DROP POLICY IF EXISTS "Public access watched" ON watched_items;
DROP POLICY IF EXISTS "Family access watched" ON watched_items;
CREATE POLICY "Family access watched" ON watched_items
    FOR ALL
    USING  (family_code IN (SELECT family_code FROM user_profiles WHERE user_id = auth.uid()))
    WITH CHECK (family_code IN (SELECT family_code FROM user_profiles WHERE user_id = auth.uid()));
