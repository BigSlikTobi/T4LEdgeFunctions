// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders, handleCors } from "../cors.ts"

// Define response types
interface TeamViewResponse {
  headline: string;
  content: string;
  team: string;
  language: string;
  headline_de?: string;
  content_de?: string;
  error?: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    let cluster_id: string | null = null;

    // Handle both GET and POST requests
    if (req.method === 'GET') {
      // Parse query parameters for GET requests
      const url = new URL(req.url);
      cluster_id = url.searchParams.get('cluster_id');
    } else if (req.method === 'POST') {
      // Parse JSON body for POST requests
      const body = await req.json();
      cluster_id = body.cluster_id;
    } else {
      return new Response(
        JSON.stringify({ error: "Method not allowed. Use GET or POST." }),
        { 
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }
    
    if (!cluster_id) {
      return new Response(
        JSON.stringify({ error: "cluster_id is required" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Get team view data
    console.log('Fetching team view for cluster_id:', cluster_id);
    const { data: teamViewData, error: teamViewError } = await supabaseClient
      .from("cluster_team_view")
      .select("id, headline, content, team")
      .eq("cluster_id", cluster_id)
      .single();

    if (teamViewError) {
      console.error("Error fetching team view:", teamViewError);
      return new Response(
        JSON.stringify({ error: "Error fetching team view" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    if (!teamViewData) {
      return new Response(
        JSON.stringify({ error: "Team view not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    // Initialize response with base data
    const response: TeamViewResponse = {
      headline: teamViewData.headline,
      content: teamViewData.content,
      team: teamViewData.team,
      language: 'en'  // Default language initially
    };

    // Get translations from cluster_team_view_int table
    console.log('Fetching translations for team view ID:', teamViewData.id);
    const { data: translationData, error: translationError } = await supabaseClient
      .from("cluster_team_view_int")
      .select("language_code, headline, content")
      .eq("cluster_team_view_id", teamViewData.id);

    if (translationError) {
      console.error("Error fetching translations:", translationError);
      // Continue with the default English data if translations fail
    } else if (translationData && translationData.length > 0) {
      // Loop through all available translations
      translationData.forEach(translation => {
        const langCode = translation.language_code;
        
        // Handle German translation specifically for backward compatibility
        if (langCode === 'de') {
          response.headline_de = translation.headline;
          response.content_de = translation.content;
          // Also update the language field if German is available
          response.language = langCode;
        }
        
        // In the future, you can extend this to handle other language codes
        // by adding more language-specific fields to the CoachViewResponse interface
        // or by restructuring the response to include a translations array
      });
    }

    // Return the response
    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
      }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/team_view_by_id' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"cluster_id":"your-cluster-uuid-here"}'

  Or using GET request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/team_view_by_id?cluster_id=your-cluster-uuid-here' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
*/
