import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ====================================================================
// Edge Function: fetch-grocery-prices
// תפקיד הפונקציה: קבלת שם מוצר (מה-OCR), פנייה לסקיל המחירים,
// ועדכון טבלאות market_prices ו-market_products ב-Supabase.
// ====================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // טיפול בבקשות CORS לדפדפן
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { itemName, storeName } = await req.json()

    if (!itemName) {
      throw new Error("Missing itemName")
    }

    // חיבור למסד הנתונים
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // כאן בעתיד נבצע קריאה ל-API שמפעיל את 
    // ה- "israeli-grocery-price-intelligence"
    // כרגע נייצר נתוני "Mock" (דוגמה) של המידע שמוחזר מהסקיל
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    
    // מוק לתוצאות חיפוש מהסקיל (יוחלף בקריאת רשת אמיתית (fetch) לשירות AI)
    const skillIntelligenceResponse = {
        productName: itemName,
        barcode: `729000${Math.floor(Math.random() * 9999)}`,
        brand: "תנובה/שטראוס", 
        prices: [
            { chain: "Shufersal", price: (Math.random() * 10 + 5).toFixed(2), isPromo: false },
            { chain: "Rami Levy", price: (Math.random() * 10 + 4).toFixed(2), isPromo: true }
        ]
    }

    // 1. שמירה או משיכה של המוצר מ-market_products
    let { data: product, error: prodErr } = await supabaseClient
        .from('market_products')
        .select('id')
        .eq('barcode', skillIntelligenceResponse.barcode)
        .single();
        
    if (!product) {
       const { data: newProd } = await supabaseClient.from('market_products').insert({
            barcode: skillIntelligenceResponse.barcode,
            product_name: skillIntelligenceResponse.productName,
            brand: skillIntelligenceResponse.brand
       }).select('id').single();
       product = newProd;
    }

    // 2. שמירת נתוני המחירים ברשתות השונות ב-market_prices
    for (const priceData of skillIntelligenceResponse.prices) {
        // מציאת ה-ID של הרשת
        let { data: chain } = await supabaseClient
            .from('supermarket_chains')
            .select('id')
            .eq('chain_name', priceData.chain)
            .single();
            
        if (!chain) {
            const { data: newChain } = await supabaseClient.from('supermarket_chains').insert({ chain_name: priceData.chain }).select('id').single();
            chain = newChain;
        }

        // עדכון מחיר בטבלה (מיזוג - Upsert)
        await supabaseClient.from('market_prices').upsert({
            product_id: product.id,
            chain_id: chain.id,
            price: priceData.price,
            is_promotional: priceData.isPromo,
            scraped_at: new Date().toISOString()
        }, { onConflict: 'product_id,chain_id' });
    }

    // החזרת הנתונים הקיימים לאפליקציה כדי לעדכן את ממשק המשתמש (UI) בלייב
    return new Response(
      JSON.stringify({ 
          message: "Prices updated successfully",
          marketData: skillIntelligenceResponse
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
