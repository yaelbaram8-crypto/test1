import { createClient } from '@supabase/supabase-js';

/**
 * =======================================================
 * Grocery Price Sync Job (Node.js) 
 * מיועד להרצה יומית דרך GitHub Actions (חינמי)
 * =======================================================
 * 
 * To run locally:
 * 1. npm install @supabase/supabase-js
 * 2. node sync-prices.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SERVICE_KEY'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TARGET_CHAINS = [
    { name: 'שופרסל', platform: 'shufersal', base_url: 'http://prices.shufersal.co.il' },
    { name: 'רמי לוי', platform: 'cerberus', base_url: 'https://url.publishedprices.co.il/login' }
];

async function syncPrices() {
    console.log("🛒 Starting Daily Grocery Price Sync...");

    for (const chain of TARGET_CHAINS) {
        console.log(`\n⏳ Fetching data for chain: ${chain.name} (${chain.platform})...`);
        
        try {
            // ==========================================================
            // שלב 1: בקשת קבצי ה-XML השקופים מהסופרמרקט
            // במערכת מקושרת ל-MCP/Skill הגישה מבוצעת דרך הסקרייפר שלנו
            // פה בארכיטקטורה נמצא הלוגיקה שתמשוך לתוך הזיכרון.
            // ==========================================================
            
            // let xmlData = await fetch(chain.base_url + '/some/xml/path.gz');
            // let parsedProducts = await parseXml(xmlData);
            
            // "Mocking" the heavy parsing for demo. In production, this returns ~15,000 items.
            const parsedProducts = [
                { barcode: '7290000000010', name: 'חלב תנובה 3% בקרטון 1 ליטר', price: 6.20, is_promotional: false },
                { barcode: '7290000000020', name: 'לחם אחיד פרוס אנג\'ל', price: 7.90, is_promotional: true },
                { barcode: '7290000000030', name: 'גבינה צהובה עמק 28%', price: 15.50, is_promotional: false },
                { barcode: '7290000000040', name: 'ביצים L תריסר מוקרן', price: 13.90, is_promotional: false }
            ];

            // Add random variance for the demo to show price competition
            parsedProducts.forEach(p => p.price = parseFloat((p.price * (Math.random() * 0.2 + 0.9)).toFixed(2)));

            console.log(`✅ Parsed ${parsedProducts.length} items from ${chain.name}`);

            // ==========================================================
            // שלב 2: רישום או שליפה מ-Supabase (Upsert ל- Chains)
            // ==========================================================
            let { data: chainData, error: errChain } = await supabase
                .from('supermarket_chains')
                .select('id')
                .eq('chain_name', chain.name)
                .single();

            if (errChain || !chainData) {
                const res = await supabase.from('supermarket_chains').insert({ chain_name: chain.name }).select('id').single();
                chainData = res.data;
            }

            // ==========================================================
            // שלב 3: הזרקת המוצרים ל-Products Cache והמחירים ל-Prices
            // עבודה מול מאגר עצום דורשת שמירה קבוצתית בייצור (Batches)
            // ==========================================================
            for (const product of parsedProducts) {
                // שמירת/שליפת המוצר המשותף
                let { data: prodData } = await supabase
                    .from('market_products')
                    .select('id')
                    .eq('barcode', product.barcode)
                    .single();

                if (!prodData) {
                    const res = await supabase.from('market_products').insert({
                        barcode: product.barcode,
                        product_name: product.name,
                        category_id: 'auto-synced'
                    }).select('id').single();
                    prodData = res.data;
                }

                // עדכון המחיר הספציפי בחנות
                if (prodData && prodData.id && chainData.id) {
                    await supabase.from('market_prices').upsert({
                        product_id: prodData.id,
                        chain_id: chainData.id,
                        price: product.price,
                        is_promotional: product.is_promotional,
                        scraped_at: new Date().toISOString()
                    }, { onConflict: 'product_id,chain_id' });
                }
            }

            console.log(`✅ Completely synced prices for ${chain.name} into Supabase.`);

        } catch (error) {
            console.error(`❌ Failed to sync ${chain.name}:`, error);
        }
    }

    console.log("\n🎉 Sync Complete! Supabase Database is up to date.");
}

syncPrices();
