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

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON shopping_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. הפעלת Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE shopping_items;
ALTER PUBLICATION supabase_realtime ADD TABLE purchase_history;

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

CREATE POLICY "Public access chains"   ON supermarket_chains FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access products" ON market_products    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access prices"   ON market_prices      FOR ALL USING (true) WITH CHECK (true);

-- הוספת שדה לחיבור היסטוריית רכישות לרשת השיווק הספציפית
ALTER TABLE purchase_history
    ADD COLUMN IF NOT EXISTS chain_id UUID REFERENCES supermarket_chains(id) ON DELETE SET NULL;

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

-- 15. RPC: חיפוש מוצרים לפי טקסט חופשי — מדורג לפי דמיון
--     קריאה: supabase.rpc('search_products', { query_text: 'חלב', result_limit: 20 })
CREATE OR REPLACE FUNCTION search_products(
    query_text   TEXT,
    result_limit INT DEFAULT 20
)
RETURNS TABLE (
    id           UUID,
    barcode      TEXT,
    product_name TEXT,
    brand        TEXT,
    category_id  TEXT,
    similarity   REAL
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
        )::REAL AS similarity
    FROM market_products mp
    WHERE
        mp.product_name % query_text
        OR mp.brand % query_text
        OR mp.product_name ILIKE '%' || query_text || '%'
    ORDER BY similarity DESC
    LIMIT result_limit;
$$;

-- 16. RPC: שליפת מחירי כל הרשתות למוצר בודד, ממוין מהזול ליקר
--     קריאה: supabase.rpc('get_product_prices', { p_product_id: '...' })
CREATE OR REPLACE FUNCTION get_product_prices(p_product_id UUID)
RETURNS TABLE (
    chain_id       UUID,
    chain_name     TEXT,
    logo_url       TEXT,
    price          NUMERIC,
    is_promotional BOOLEAN,
    scraped_at     TIMESTAMPTZ
)
LANGUAGE SQL STABLE AS $$
    SELECT
        sc.id          AS chain_id,
        sc.chain_name,
        sc.logo_url,
        mpr.price,
        mpr.is_promotional,
        mpr.scraped_at
    FROM market_prices mpr
    JOIN supermarket_chains sc ON sc.id = mpr.chain_id
    WHERE mpr.product_id = p_product_id
    ORDER BY mpr.price ASC;
$$;
