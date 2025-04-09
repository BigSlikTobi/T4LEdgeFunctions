import { serve } from "https://deno.land/std@0.136.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, corsHeaders } from "../cors.ts";

// Secure keys are loaded from environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;


serve(async (req: Request) => {
  // Handle preflight CORS requests using reusable logic
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try { // Added try block
    // *** CREATE request-scoped client ***
    const supabaseClient = createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: req.headers.get("Authorization")! } }, auth: { autoRefreshToken: false, persistSession: false } }
    );

  // Calculate the timestamp for 168 hours (7 days) ago
  const sevenDaysAgo = new Date(Date.now() - 168 * 60 * 60 * 1000).toISOString();

  // Update the query to match the new table structure
  const { data, error } = await supabaseClient
    .from("NewsTicker")
    .select(`
      id,
      created_at,
      SourceArticle,
      EnglishInformation,
      GermanInformation,
      Image,
      HeadlineEnglish,
      HeadlineGerman,
      Team (
        teamId
      ),
      SourceArticle (
        created_at,
        source (
          Name
        )
      )
    `)
    .gte('created_at', sevenDaysAgo);
    
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
  
  // Return the data
  return new Response(JSON.stringify({ data }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
  
} catch(error) { // Added catch block
    console.error("Error executing newsTicker function:", error);
    interface PostgrestError {
        code?: string;
        message: string;
    }
    const clientErrorMessage = (error as PostgrestError).code === 'PGRST301' ? "Authorization error." : "Failed to fetch news ticker.";
    return new Response(JSON.stringify({ error: clientErrorMessage }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}
});
