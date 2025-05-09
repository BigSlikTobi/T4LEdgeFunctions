// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders, handleCors } from "../cors.ts"

// Define response types
interface ViewContent {
  headline: string;
  content: string;
  view: string;
  headline_de?: string;
  content_de?: string;
}

interface DynamicViewResponse {
  views: ViewContent[];
  language: string;
  error?: string;
  available_views?: string[]; // Array of all available view types for this cluster
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    let cluster_id: string | null = null;
    let view_type: string | null = null;

    // Handle both GET and POST requests
    if (req.method === 'GET') {
      // Parse query parameters for GET requests
      const url = new URL(req.url);
      cluster_id = url.searchParams.get('cluster_id');
      view_type = url.searchParams.get('view_type');
    } else if (req.method === 'POST') {
      // Parse JSON body for POST requests
      const body = await req.json();
      cluster_id = body.cluster_id;
      view_type = body.view_type;
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
    
    // view_type is optional

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Get dynamic view data
    console.log(`Fetching dynamic view for cluster_id: ${cluster_id}${view_type ? ', view_type: ' + view_type : ''}`);
    
    const query = supabaseClient
      .from("cluster_dynamic_view")
      .select("id, headline, content, view")
      .eq("cluster_id", cluster_id);
    
    // We now want to retrieve ALL view types, even if a specific type is requested
    // This is because we're returning all views in our response
    const { data: dynamicViewDataArray, error: dynamicViewError } = await query;

    if (dynamicViewError) {
      console.error("Error fetching dynamic view:", dynamicViewError);
      return new Response(
        JSON.stringify({ error: "Error fetching dynamic view" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    if (!dynamicViewDataArray || dynamicViewDataArray.length === 0) {
      return new Response(
        JSON.stringify({ error: view_type 
          ? `Dynamic view with type '${view_type}' not found for cluster_id '${cluster_id}'` 
          : `Dynamic view not found for cluster_id '${cluster_id}'`
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }
    
    // If a specific view type is requested, filter the results after fetching
    let filteredViewData = dynamicViewDataArray;
    if (view_type) {
      console.log(`Filtering results to only include view_type: ${view_type}`);
      filteredViewData = dynamicViewDataArray.filter(view => view.view === view_type);
      
      if (filteredViewData.length === 0) {
        console.log(`No views found with type ${view_type}, returning all views instead`);
        // If no matching view type found, return all views
        filteredViewData = dynamicViewDataArray;
      }
    }

    console.log(`Found ${dynamicViewDataArray.length} dynamic view entries for cluster_id: ${cluster_id}`);
    
    // Collect all available view types for this cluster
    const availableViews = dynamicViewDataArray.map(view => view.view);
    console.log(`Available views for cluster_id ${cluster_id}:`, availableViews);
    
    // Create view data array for filtered views
    const viewsContent: ViewContent[] = filteredViewData.map(view => ({
      headline: view.headline,
      content: view.content,
      view: view.view
    }));
    
    // Initialize response with base data
    const response: DynamicViewResponse = {
      views: viewsContent,
      language: 'en',  // Default language initially
      available_views: availableViews
    };

    // Get translations from cluster_dynamic_view_int table for all views
    // Create a query that will get translations for all view IDs
    const viewIds = dynamicViewDataArray.map(view => view.id);
    console.log('Fetching translations for dynamic view IDs:', viewIds);
    
    const { data: translationData, error: translationError } = await supabaseClient
      .from("cluster_dynamic_view_int")
      .select("cluster_dynamic_view_id, language_code, headline, content")
      .in("cluster_dynamic_view_id", viewIds);

    if (translationError) {
      console.error("Error fetching translations:", translationError);
      // Continue with the default English data if translations fail
    } else if (translationData && translationData.length > 0) {
      console.log(`Found ${translationData.length} translations for dynamic view IDs`);
      
      let hasGermanTranslation = false;
      
      // Process translations for each view
      translationData.forEach(translation => {
        const langCode = translation.language_code;
        const viewId = translation.cluster_dynamic_view_id;
        
        // Find the corresponding view in our views array
        const viewToUpdate = response.views.find(v => {
          const matchingViewData = dynamicViewDataArray.find(dvd => dvd.id === viewId);
          return matchingViewData && v.view === matchingViewData.view;
        });
        
        if (viewToUpdate) {
          // Handle German translation specifically for backward compatibility
          if (langCode === 'de') {
            viewToUpdate.headline_de = translation.headline;
            viewToUpdate.content_de = translation.content;
            hasGermanTranslation = true;
          }
          
          // In the future, you can handle other language codes here
        }
      });
      
      // Update the language field if German is available for any view
      if (hasGermanTranslation) {
        response.language = 'de';
      }
    }

    // Log the generated response (without sensitive data)
    console.log(`Response ready for cluster_id ${cluster_id}:`, {
      views_count: response.views.length,
      language: response.language,
      available_views: response.available_views,
      has_translations: response.views.some(view => !!view.headline_de)
    });
    
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

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/dynamic_view_by_id' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"cluster_id":"your-cluster-uuid-here"}'

  Or with a specific view type:
  
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/dynamic_view_by_id' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"cluster_id":"your-cluster-uuid-here", "view_type":"specific-view-type"}'

  Or using GET request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/dynamic_view_by_id?cluster_id=your-cluster-uuid-here' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

  Or with a specific view type:
  
  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/dynamic_view_by_id?cluster_id=your-cluster-uuid-here&view_type=specific-view-type' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
*/
