import { serve } from "https://deno.land/std@0.136.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.1";
import { corsHeaders } from "../cors.ts";

// Define a type for expected Supabase errors
interface SupabaseApiError extends Error {
    code?: string;
    details?: string;
    hint?: string;
}

// Secure keys are loaded from environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("FATAL: Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY");
    throw new Error("Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY");
}

console.log("Teams function initializing...");

serve(async (req: Request) => {
    console.log(`Received request: ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
        console.log("Responding to OPTIONS preflight request.");
        return new Response("ok", { headers: corsHeaders, status: 200 });
    }

    try {
        const supabaseClient = createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );
        console.log("Supabase client created.");

        console.log("Fetching teams from 'Teams' table...");

        // --- FIX: Use correct column names (likely camelCase) ---
        const { data, error: dbError } = await supabaseClient
            .from("Teams")
            .select(`
              teamId,
              fullName,
              division,
              conference
            `); // Use exact column names from DB schema

        if (dbError) {
            console.error("Supabase query error:", dbError);
            let clientErrorMessage = "Failed to fetch teams data.";
            let statusCode = 500;

            if (dbError && typeof dbError === 'object') {
                 if ('code' in dbError && (dbError.code === 'PGRST301' || String(dbError.message || '').includes('JWT'))) {
                    clientErrorMessage = "Authorization error.";
                    statusCode = 401;
                } else if ('code' in dbError && dbError.code === '42703') { // Handle undefined column more specifically
                    clientErrorMessage = `Database query error: ${dbError.message}`;
                    statusCode = 400; // Bad request (likely incorrect column name in call)
                }
                 else {
                    statusCode = typeof dbError.code === 'string' && dbError.code.startsWith('PGRST') ? 400 : 500;
                }
            }

            return new Response(
                JSON.stringify({ error: clientErrorMessage }),
                {
                    status: statusCode,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
            );
        }
        console.log(`Fetched ${data?.length ?? 0} teams from database.`);

        // --- FIX: No transformation needed if select uses correct names ---
        // The 'data' already has fields like teamId, fullName if selected correctly
        // const transformedData = (data ?? []).map(dbTeam => ({ ... })); // REMOVE or simplify if needed

        console.log("Returning successful response.");
        return new Response(
            // Directly stringify 'data' if .select() used the correct names
            JSON.stringify({ data: data || [] }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        );

    } catch (err) {
        console.error("Unexpected error in function:", err);
        const errorMessage = err instanceof Error ? "An internal server error occurred." : "An unknown error occurred.";
        return new Response(
            JSON.stringify({ error: errorMessage }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );
    }
});