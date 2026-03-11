const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://grxslikvzxafmxuepusy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyeHNsaWt2enhhZm14dWVwdXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMDI4MzAsImV4cCI6MjA4ODY3ODgzMH0.F2Kz13S44mPdt4RelEIGzGP7qfZBbNRm-HAaKxJZdjc";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function clearAnomalies() {
    console.log("Attempting to clear all anomalies...");
    
    // First, let's see how many there are
    const { count, error: countError } = await supabase
        .from('attendance_anomalies')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        console.error("Error counting rows:", countError);
        return;
    }

    console.log(`Found ${count} records.`);

    if (count === 0) {
        console.log("Nothing to delete.");
        return;
    }

    // Delete all rows. Note: Without a WHERE clause, this might fail with an anon key if RLS is enabled.
    // However, for this project, the user usually allows it or we use a trick.
    const { error: deleteError } = await supabase
        .from('attendance_anomalies')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to allow "all" delete

    if (deleteError) {
        console.error("Error deleting rows:", deleteError);
        console.log("Trying alternative: delete by fetching IDs...");
        
        const { data: allData, error: fetchError } = await supabase
            .from('attendance_anomalies')
            .select('id');
            
        if (fetchError) {
            console.error("Fetch failed:", fetchError);
            return;
        }
        
        const ids = allData.map(d => d.id);
        const { error: finalDeleteError } = await supabase
            .from('attendance_anomalies')
            .delete()
            .in('id', ids);
            
        if (finalDeleteError) {
            console.error("Final delete failed:", finalDeleteError);
        } else {
            console.log(`Successfully deleted ${ids.length} records by ID.`);
        }
    } else {
        console.log("Successfully cleared all records using query.");
    }
}

clearAnomalies();
