import { createClient } from '@supabase/supabase-js';
import { gunzipSync } from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { PassThrough } from 'stream';
import * as ftp from 'basic-ftp';

/**
 * =======================================================
 * Grocery Price Sync Job (Node.js)
 * מושך מחירים אמיתיים מכל הרשתות הגדולות בישראל
 * (חובת פרסום XML לפי חוק שקיפות מחירים תש"ע-2010)
 * =======================================================
 *
 * פלטפורמות:
 *   shufersal    - פורטל ייעודי של שופרסל
 *   cerberus     - url.publishedprices.co.il  (כניסה עם משתמש/סיסמה לכל רשת)
 *   generic_html - HTML listing page עם קישורים לקבצי GZ
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: true, trimValues: true });

// =========================================================
// רישום כל הרשתות
// כל רשת מסמנת את הפלטפורמה שלה ואת פרטי הגישה
// =========================================================
const CHAINS = [
    // --- פלטפורמה ייעודית ---
    {
        name: 'שופרסל',
        platform: 'shufersal',
        listUrl: 'http://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=0&page=1',
        fileBaseUrl: 'http://prices.shufersal.co.il'
    },

    // --- פלטפורמת Cerberus (כל רשת עם credentials נפרדים) ---
    {
        name: 'רמי לוי',
        platform: 'cerberus',
        user: process.env.RAMI_LEVY_USER,
        pass: process.env.RAMI_LEVY_PASS
    },
    {
        name: 'ויקטורי',
        platform: 'cerberus',
        user: process.env.VICTORY_USER,
        pass: process.env.VICTORY_PASS
    },
    {
        name: 'קשת טעמים',
        platform: 'cerberus',
        user: process.env.KESHET_TAAMIM_USER,
        pass: process.env.KESHET_TAAMIM_PASS
    },
    {
        name: 'יינות ביתן',
        platform: 'cerberus',
        user: process.env.YEINOT_BITAN_USER,
        pass: process.env.YEINOT_BITAN_PASS
    },
    {
        name: 'סטופ מרקט',
        platform: 'cerberus',
        user: process.env.STOP_MARKET_USER,
        pass: process.env.STOP_MARKET_PASS
    },

    // --- Cerberus FTP (url.retail.publishedprices.co.il) — FTP ללא סיסמה ---
    {
        name: 'טיב טעם',
        platform: 'cerberus_ftp',
        ftpHost: 'url.retail.publishedprices.co.il',
        user: 'TivTaam',
        pass: ''
    },
    {
        name: 'אושר עד',
        platform: 'cerberus_ftp',
        ftpHost: 'url.retail.publishedprices.co.il',
        user: 'osherad',
        pass: ''
    },
    {
        name: 'יוחננוף',
        platform: 'cerberus_ftp',
        ftpHost: 'url.retail.publishedprices.co.il',
        user: 'yohananof',
        pass: process.env.YOCHANANOF_PASS || ''
    },
    // חצי חינם / נתיב החסד / מחסני השוק — דומיינים לא פעילים, הוסר
];

// =========================================================
// Fetchers לפי פלטפורמה
// =========================================================

/** שופרסל - HTML עם links לקבצי GZ */
async function fetchShufersal(chain) {
    const res = await fetch(chain.listUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)' },
        signal: AbortSignal.timeout(30000)
    });
    let html = await res.text();
    console.log(`  📄 HTTP ${res.status}, ${html.length} chars`);

    // decode HTML entities (&amp; → &) לפני חיפוש
    html = html.replace(/&amp;/g, '&');

    // רגקס גמיש — מאפשר פרמטרים אחרי .gz (למשל &relaPath=None)
    let matches = [...html.matchAll(/href="([^"]*PriceFull[^"]*\.gz[^"]*)"/gi)];

    if (!matches.length) {
        // diagnostic — הדפס 2000 תווים ראשונים לדיבאג
        console.log(`  🔍 HTML snippet:\n${html.substring(0, 2000)}`);
        throw new Error('לא נמצאו קבצי PriceFull ב-Shufersal');
    }

    const href = matches[0][1];
    const fileUrl = href.startsWith('http') ? href : new URL(href, chain.listUrl).toString();
    console.log(`  ⬇️  ${fileUrl}`);
    return fetchAndParseXml(fileUrl);
}

/** Cerberus - login + רשימת קבצי JSON + הורדת PriceFull אחרון */
async function fetchCerberus(chain) {
    if (!chain.user) {
        throw new Error(`חסר env var: ${chain.name.toUpperCase().replace(/ /g, '_')}_USER`);
    }
    // pass יכולה להיות ריקה (רשתות ללא סיסמה); רק user שאינו מוגדר בכלל = שגיאה
    if (chain.pass === undefined) {
        throw new Error(`חסר env var: ${chain.name.toUpperCase().replace(/ /g, '_')}_PASS`);
    }

    const host = chain.cerberusHost ?? 'url.publishedprices.co.il';

    // Login
    const loginRes = await fetch(`https://${host}/login/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(chain.user)}&password=${encodeURIComponent(chain.pass)}`,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000)
    });
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error(`Login נכשל עבור ${chain.name} (HTTP ${loginRes.status})`);

    // רשימת קבצים
    const dirRes = await fetch(`https://${host}/file/json/dir`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(30000)
    });
    const files = await dirRes.json();
    const priceFiles = files
        .filter(f => f.name?.startsWith('PriceFull'))
        .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''));

    if (!priceFiles.length) throw new Error(`לא נמצאו קבצי PriceFull עבור ${chain.name}`);

    const fileUrl = `https://${host}/file/d/${priceFiles[0].name}`;
    console.log(`  ⬇️  ${fileUrl}`);
    return fetchAndParseXml(fileUrl, { Cookie: cookie });
}

/** Generic HTML - מחפש קישורי GZ בדף רשימת קבצים */
async function fetchGenericHtml(chain) {
    const res = await fetch(chain.listUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)' },
        signal: AbortSignal.timeout(30000)
    });
    let html = await res.text();
    console.log(`  📄 HTTP ${res.status}, ${html.length} chars`);

    html = html.replace(/&amp;/g, '&');

    // רגקס גמיש — מאפשר פרמטרים אחרי .gz
    const matches = [...html.matchAll(/href="([^"]*PriceFull[^"]*\.gz[^"]*)"/gi)];

    if (!matches.length) {
        console.log(`  🔍 HTML snippet:\n${html.substring(0, 1500)}`);
        throw new Error(`לא נמצאו קבצי PriceFull ב-${chain.name} (${chain.listUrl})`);
    }

    const href = matches[0][1];
    const fileUrl = href.startsWith('http') ? href : new URL(href, chain.listUrl).toString();
    console.log(`  ⬇️  ${fileUrl}`);
    return fetchAndParseXml(fileUrl);
}

/** Cerberus FTP - מוריד PriceFull אחרון דרך FTP (ללא TLS) */
async function fetchCerberusFtp(chain) {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
        await client.access({
            host: chain.ftpHost,
            user: chain.user,
            password: chain.pass ?? '',
            secure: false
        });

        const list = await client.list('/');
        const priceFiles = list
            .filter(f => f.name.startsWith('PriceFull'))
            .sort((a, b) => b.size - a.size); // הגדול ביותר = קטלוג המלא

        if (!priceFiles.length) throw new Error(`לא נמצאו קבצי PriceFull עבור ${chain.name}`);

        const fileName = priceFiles[0].name;
        console.log(`  ⬇️  ftp://${chain.ftpHost}/${fileName}`);

        const pass = new PassThrough();
        const chunks = [];
        pass.on('data', chunk => chunks.push(chunk));
        await client.downloadTo(pass, fileName);

        const buf = Buffer.concat(chunks);
        const xmlBuf = fileName.includes('.gz') ? gunzipSync(buf) : buf;
        return xmlParser.parse(xmlBuf.toString('utf8'));
    } finally {
        client.close();
    }
}

// =========================================================
// פרסור XML - פורמט ישראלי סטנדרטי (כולל וריאציות)
// =========================================================
async function fetchAndParseXml(url, headers = {}) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} בהורדת ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const xmlBuf = url.includes('.gz') ? gunzipSync(buf) : buf;
    return xmlParser.parse(xmlBuf.toString('utf8'));
}

function extractProducts(parsed) {
    const root = parsed.root ?? parsed.Root ?? parsed.Prices ?? parsed.Catalog ?? Object.values(parsed)[0];
    const itemsNode = root?.Items ?? root?.Products ?? root?.Catalog;
    const rawItems = itemsNode?.Item ?? itemsNode?.Product ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const products = [];
    for (const item of items) {
        const barcode = String(item.ItemCode ?? item.Barcode ?? item.ManufacturerItemCode ?? '').trim();
        const price = parseFloat(item.ItemPrice ?? item.Price ?? item.UnitPrice ?? 0);
        if (!barcode || price <= 0) continue;
        products.push({
            barcode,
            name: String(item.ItemName ?? item.ProductName ?? item.ManufacturerItemDescription ?? '').trim(),
            brand: String(item.ManufacturerName ?? item.Brand ?? '').trim(),
            price,
            unit: String(item.UnitOfMeasure ?? '').trim(),
            is_promotional: false
        });
    }
    return products;
}

// =========================================================
// Supabase - batch upsert
// =========================================================
async function getOrCreateChain(name) {
    let { data, error } = await supabase
        .from('supermarket_chains')
        .select('id')
        .eq('chain_name', name)
        .single();

    if (!data) {
        // PGRST116 = "no rows found" — expected when chain doesn't exist yet
        if (error && error.code !== 'PGRST116') {
            throw new Error(`DB select chain failed: ${error.message}`);
        }
        const res = await supabase
            .from('supermarket_chains')
            .insert({ chain_name: name })
            .select('id')
            .single();
        if (res.error) throw new Error(`DB insert chain failed: ${res.error.message}`);
        data = res.data;
    }

    if (!data?.id) throw new Error(`No id returned for chain "${name}"`);
    return data.id;
}

async function upsertProducts(products, chainId) {
    const BATCH = 500;
    let updated = 0;

    // upsert מוצרים
    for (let i = 0; i < products.length; i += BATCH) {
        const { error } = await supabase
            .from('market_products')
            .upsert(
                products.slice(i, i + BATCH).map(p => ({
                    barcode: p.barcode,
                    product_name: p.name,
                    brand: p.brand || null,
                    category_id: 'auto-synced'
                })),
                { onConflict: 'barcode', ignoreDuplicates: false }
            );
        if (error) console.warn(`  ⚠️  upsert products:`, error.message);
    }

    // שולף IDs
    const barcodes = products.map(p => p.barcode);
    const productIdMap = new Map();
    for (let i = 0; i < barcodes.length; i += BATCH) {
        const { data } = await supabase
            .from('market_products')
            .select('id, barcode')
            .in('barcode', barcodes.slice(i, i + BATCH));
        (data ?? []).forEach(r => productIdMap.set(r.barcode, r.id));
    }

    // upsert מחירים
    const priceRows = products
        .filter(p => productIdMap.has(p.barcode))
        .map(p => ({
            product_id: productIdMap.get(p.barcode),
            chain_id: chainId,
            price: p.price,
            is_promotional: p.is_promotional,
            scraped_at: new Date().toISOString()
        }));

    for (let i = 0; i < priceRows.length; i += BATCH) {
        const { error } = await supabase
            .from('market_prices')
            .upsert(priceRows.slice(i, i + BATCH), { onConflict: 'product_id,chain_id' });
        if (error) console.warn(`  ⚠️  upsert prices:`, error.message);
        else updated += Math.min(BATCH, priceRows.length - i);
    }

    return updated;
}

// =========================================================
// Main
// =========================================================
async function syncChain(chain) {
    let parsed;
    switch (chain.platform) {
        case 'shufersal':    parsed = await fetchShufersal(chain);    break;
        case 'cerberus':     parsed = await fetchCerberus(chain);     break;
        case 'cerberus_ftp': parsed = await fetchCerberusFtp(chain);  break;
        case 'generic_html': parsed = await fetchGenericHtml(chain);  break;
        default: throw new Error(`פלטפורמה לא מוכרת: ${chain.platform}`);
    }

    const products = extractProducts(parsed);
    if (!products.length) throw new Error('פורסרו 0 מוצרים - בדוק פורמט XML');
    console.log(`  ✅ פורסרו ${products.length.toLocaleString()} מוצרים`);

    const chainId = await getOrCreateChain(chain.name);
    const count = await upsertProducts(products, chainId);
    console.log(`  ✅ עודכנו ${count.toLocaleString()} מחירים ב-Supabase`);
}

async function syncPrices() {
    console.log('🛒 Starting Daily Grocery Price Sync...\n');
    const results = { ok: [], failed: [] };

    for (const chain of CHAINS) {
        console.log(`⏳ ${chain.name} (${chain.platform})...`);
        try {
            await syncChain(chain);
            results.ok.push(chain.name);
        } catch (err) {
            console.error(`❌ ${chain.name} נכשל: ${err.message}`);
            results.failed.push(chain.name);
        }
        console.log('');
    }

    console.log('─'.repeat(50));
    console.log(`✅ הצליחו (${results.ok.length}): ${results.ok.join(', ')}`);
    if (results.failed.length) {
        console.log(`❌ נכשלו (${results.failed.length}): ${results.failed.join(', ')}`);
    }

    // ספירת סך הכל בדאטה בייס
    const [{ count: totalProducts }, { count: totalPrices }] = await Promise.all([
        supabase.from('market_products').select('*', { count: 'exact', head: true }),
        supabase.from('market_prices').select('*', { count: 'exact', head: true })
    ]);
    console.log('\n📊 סטטוס דאטה בייס:');
    console.log(`   מוצרים ייחודיים:  ${(totalProducts ?? 0).toLocaleString()}`);
    console.log(`   רשומות מחיר:      ${(totalPrices ?? 0).toLocaleString()}`);
    console.log('🎉 Sync Complete!');
}

syncPrices();
