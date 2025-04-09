// functions/teams/index.ts

import { serve } from "https://deno.land/std@0.136.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Define a type for expected Supabase errors (can be refined if needed)
interface SupabaseApiError extends Error {
    code?: string;
    details?: string;
    hint?: string;
}

// Secure keys are loaded from environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// Basic validation for environment variables
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY");
}

serve(async (req: Request) => {
    // Define CORS headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Standard Content-Type header for JSON responses
    const jsonContentTypeHeader = {
        "Content-Type": "application/json; charset=utf-8",
    };

    // Handle OPTIONS preflight request for CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: { ...corsHeaders } });
    }

    // Check if required env vars are present before proceeding
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error("Function called without required environment variables set.");
        return new Response(
            JSON.stringify({ error: "Server configuration error." }),
            { status: 500, headers: { ...corsHeaders, ...jsonContentTypeHeader } }
        );
    }

    try {
        // Create request-scoped Supabase client
        const supabaseClient = createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                global: { headers: { Authorization: req.headers.get("Authorization")! } },
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        // Fetch all teams from the Teams table
        const { data, error: dbError } = await supabaseClient // Renamed error variable
            .from("Teams")
            .select(`
              teamId,
              fullName,
              division,
              conference
            `);

        // Handle potential database errors
        if (dbError) {
            console.error("Supabase query error:", dbError);

            // --- Type-Safe Error Handling ---
            let clientErrorMessage = "Failed to fetch teams data.";
            let statusCode = 500; // Default to internal server error

            // Check if dbError is an object and potentially has specific properties
            if (dbError && typeof dbError === 'object') {
                 // Check for specific Supabase error codes or messages
                if ('code' in dbError && (dbError.code === 'PGRST301' || String(dbError.message || '').includes('JWT'))) {
                    clientErrorMessage = "Authorization error.";
                    statusCode = 401; // Unauthorized
                } else {
                    // For other DB errors, provide a generic message but use a 4xx/5xx code
                    // Inspect dbError.code or dbError.details if needed for more specific handling
                    statusCode = typeof dbError.code === 'string' && dbError.code.startsWith('PGRST') ? 400 : 500;
                }
            }
            // --- End Type-Safe Error Handling ---

            return new Response(
                JSON.stringify({ error: clientErrorMessage }),
                { status: statusCode, headers: { ...corsHeaders, ...jsonContentTypeHeader } }
            );
        }

        // Return the teams data (ensure data is not null)
        return new Response(
            JSON.stringify({ data: data || [] }), // Return empty array if data is null
            { headers: { ...corsHeaders, ...jsonContentTypeHeader } }
        );

    } catch (err) {
        // Catch unexpected errors during execution (e.g., client creation failure)
        console.error("Unexpected error in function:", err);
        // Avoid leaking potentially sensitive details from generic Errors
        const errorMessage = err instanceof Error ? "An internal server error occurred." : "An unknown error occurred.";

        return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, ...jsonContentTypeHeader } }
        );
    }
});
