// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.136.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Secure keys are loaded from environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Create a Supabase client instance
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

serve(async (req: Request) => {
  // Handle CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };

  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    // Fetch all teams from the Teams table
    const { data, error } = await supabase
      .from("Teams")
      .select(`
        teamId,
        fullName,
        devision,
        confernece
      `);
      
    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }), 
        { status: 400, headers }
      );
    }
    
    // Return the teams data
    return new Response(
      JSON.stringify({ data }), 
      { headers }
    );

  } catch (err) {
    const error = err as Error;
    return new Response(
      JSON.stringify({ error: error.message }), 
      { status: 500, headers }
    );
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/teams' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

*/
