# Family Smart Shopping App 🛒

אפליקציית PWA לניהול רשימת קניות משפחתית עם השוואת מחירים בין רשתות שיווק בישראל.

---

## מה קיים באפליקציה

### טאב רשימה

- הוספת פריטים ידנית עם כמות
- קיצורי מקלדת (Enter)
- זיהוי קטגוריה אוטומטי (ירקות, חלב, בשר וכו')
- סימון פריטים כ"הושלם" (מתועד אוטומטית בהיסטוריה)
- מחיקת פריטים עם swipe שמאלה
- תצוגת קטגוריות / תצוגת כל הפריטים (toggle)
- ניקוי רשימה מלא
- הצעות חכמות מבוססות היסטוריה קניות (ניקוד פופולריות)
- סריקת קבלה עם OCR (Tesseract.js) להוספה מהירה
- ייעול סל — מציג את הרשת הזולה לכל פריט ברשימה

### טאב היסטוריה

- רשימת כל הקניות הקודמות
- תאריך, כמות, קטגוריה

### טאב סטטיסטיקה

- מוצרים הנרכשים הכי הרבה
- ניקוד פופולריות: `(ספירה × 0.4) + (1/ימים × 0.35) + (ממוצע_כמות × 0.25)`

### טאב מחירים

- חיפוש מוצר בעברית (fuzzy search עם trigram similarity)
- השוואת מחירים בין רשתות — ממוין מהזול ליקר
- הצגת הכי זול בבולט, שאר הרשתות ברשימה
- תג "מבצע" לפריטים פרומואליים
- אזהרה לנתונים ישנים מעל 48 שעות
- חיווי "טרם בוצע סינכרון" לרשתות שטרם נטענו
- skeleton loading בזמן שליפה
- סריקת ברקוד (BarcodeDetector API + ZXing fallback)

---

## ארכיטקטורה

```text
index.html            — מסגרת האפליקציה, ניווט תחתון, 4 views
app.js                — לוגיקה ראשית (ShoppingApp + PriceCompareModule)
styles.css            — עיצוב מלא כולל RTL ומודול מחירים
rtl-styles.css        — תמיכת RTL גלובלית
rtl-helper.js         — עזר RTL בזמן ריצה
sw.js                 — Service Worker (PWA, cache-first)
manifest.json         — PWA manifest
app-config.js         — הגדרות Supabase מקומיות (מוסתר מ-git)
app-config.example.js — תבנית להגדרות מקומיות
sync-prices.mjs       — סקריפט Node.js לסינכרון מחירים לילי
supabase-schema.sql   — סכמת DB מלאה (Phases 1–4)
```

---

## סכמת מסד הנתונים

| טבלה | תיאור |
| --- | --- |
| `shopping_items` | פריטי רשימת הקניות הנוכחית |
| `purchase_history` | היסטוריית קניות (trigger אוטומטי בסימון הושלם) |
| `supermarket_chains` | רשתות שיווק |
| `market_products` | מוצרים לפי ברקוד |
| `market_prices` | מחיר לכל מוצר לכל רשת |

### Views & Functions

- **`popular_items`** — ניקוד פופולריות לכל מוצר לפי משפחה
- **`search_products(query_text, result_limit)`** — חיפוש טקסט חופשי עם trigram similarity
- **`get_product_prices(p_product_id)`** — מחירי כל הרשתות למוצר, ממוין מהזול

---

## סינכרון מחירים (`sync-prices.mjs`)

### רשתות מחוברות

| רשת | פלטפורמה | סטטוס |
| --- | --- | --- |
| שופרסל | Shufersal Portal (Azure Blob) | ✅ פעיל |
| טיב טעם | Cerberus FTP (`url.retail.publishedprices.co.il`) | ✅ פעיל |
| אושר עד | Cerberus FTP | ✅ פעיל |
| יוחננוף | Cerberus FTP | ✅ פעיל |
| רמי לוי | Cerberus HTTP | ⏳ ממתין ל-credentials |
| ויקטורי | Cerberus HTTP | ⏳ ממתין ל-credentials |
| קשת טעמים | Cerberus HTTP | ⏳ ממתין ל-credentials |
| יינות ביתן | Cerberus HTTP | ⏳ ממתין ל-credentials |
| סטופ מרקט | Cerberus HTTP | ⏳ ממתין ל-credentials |

### הרצה ידנית

```powershell
$env:SUPABASE_URL="https://kdrneiomhsntgrhqcobc.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
node sync-prices.mjs
```

### הרצה אוטומטית

GitHub Actions רץ כל לילה בשעה 4:00 (ישראל) — `.github/workflows/daily-price-sync.yml`

להפעלה ידנית: `Actions → Daily Israeli Grocery Price Sync → Run workflow`

---

## הגדרת סביבה מקומית

1. העתק `app-config.example.js` → `app-config.js`
2. הכנס `SUPABASE_URL` ו-`SUPABASE_KEY` (publishable key)
3. פתח `index.html` בדפדפן

### GitHub Secrets נדרשים

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RAMI_LEVY_USER / RAMI_LEVY_PASS
VICTORY_USER / VICTORY_PASS
KESHET_TAAMIM_USER / KESHET_TAAMIM_PASS
YEINOT_BITAN_USER / YEINOT_BITAN_PASS
STOP_MARKET_USER / STOP_MARKET_PASS
```

---

## טכנולוגיות

| שכבה | טכנולוגיה |
| --- | --- |
| Frontend | Vanilla JS (ES Modules), ללא build |
| Styling | CSS Variables, RTL |
| DB | Supabase (PostgreSQL + Realtime) |
| Search | `pg_trgm` — trigram similarity |
| OCR | Tesseract.js |
| Barcode | BarcodeDetector API + ZXing WASM |
| Sync | Node.js ESM + basic-ftp + fast-xml-parser |
| CI/CD | GitHub Actions (cron daily) |
| PWA | Service Worker, Web App Manifest |
