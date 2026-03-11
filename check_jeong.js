const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://grxslikvzxafmxuepusy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyeHNsaWt2enhhZm14dWVwdXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDI4MzAsImV4cCI6MjA4ODY3ODgzMH0.F2Kz13S44mPdt4RelEIGzGP7qfZBbNRm-HAaKxJZdjc";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkAndClearJeong() {
    console.log("Searching for '정상민' records in 'attendance_anomalies'...");
    
    // Search for name variations (정상민, normalizeName might have been used)
    const { data, error } = await supabase
        .from('attendance_anomalies')
        .select('*')
        .or('name.eq.정상민,explanation.ilike.%퇴근 지문%');

    if (error) {
        console.error("Error searching:", error);
        return;
    }

    console.log(`Found ${data.length} records matching '정상민' or '퇴근 지문'.`);
    data.forEach(row => {
        console.log(`[ID: ${row.id}] Date: ${row.date}, Name: ${row.name}, Reason: ${row.explanation}`);
    });

    if (data.length > 0) {
        const ids = data.map(d => d.id);
        const { error: delError } = await supabase
            .from('attendance_anomalies')
            .delete()
            .in('id', ids);
            
        if (delError) {
            console.error("Delete failed:", delError);
        } else {
            console.log("Successfully deleted persistent records.");
        }
    } else {
        console.log("No matching records found in Supabase.");
    }
}

checkAndClearJeong();
