// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders, handleCors } from "../cors.ts"

// Define response types
interface ClusterSummaryResponse {
  headline: string;
  content: string;
  headline_de?: string;
  content_de?: string;
  image_url?: string;
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

    // Get cluster summary
    const { data: summaryData, error: summaryError } = await supabaseClient
      .from("cluster_summary")
      .select("id, headline, content")
      .eq("cluster_id", cluster_id)
      .single();

    if (summaryError) {
      console.error("Error fetching cluster summary:", summaryError);
      return new Response(
        JSON.stringify({ error: "Error fetching cluster summary" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    if (!summaryData) {
      return new Response(
        JSON.stringify({ error: "Cluster summary not found" }),
        { 
          status: 404, 
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    // Get image URL
    console.log('Fetching image for cluster_id:', cluster_id);
    const { data: imageData, error: imageError } = await supabaseClient
      .from("cluster_images")
      .select("image_url")
      .eq("cluster_id", cluster_id)
      .limit(1)
      .single(); // Use single() since we're limiting to 1 row

    if (imageError) {
      console.error("Error fetching image:", imageError);
      // Continue without image - non-critical error
    } else {
      console.log('Image query result:', imageData);
    }

    // Get German translation (assuming 'de' is the code for German)
    const { data: translationData, error: translationError } = await supabaseClient
      .from("cluster_summary_int")
      .select("headline, content, language_code")
      .eq("cluster_summary_id", summaryData.id)
      .eq("language_code", "de")
      .maybeSingle(); // Use maybeSingle as there might not be a translation

    if (translationError) {
      console.error("Error fetching translation:", translationError);
      // Continue without translation - non-critical error
    }

    // Prepare response data
    const responseData: ClusterSummaryResponse = {
      headline: summaryData.headline,
      content: summaryData.content,
      image_url: imageData?.image_url || null,
    };

    // Add translation data if available
    if (translationData) {
      responseData.headline_de = translationData.headline;
      responseData.content_de = translationData.content;
    }

    // Return the formatted response
    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
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
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  # Using GET:
  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/cluster_summary_by_id?cluster_id=your-cluster-uuid-here' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

  # Using POST:
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/cluster_summary_by_id' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"cluster_id":"your-cluster-uuid-here"}'

*/
