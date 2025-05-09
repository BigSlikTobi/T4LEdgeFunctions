import { serve } from "https://deno.land/std@0.136.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, corsHeaders } from "../cors.ts";

// Define interfaces based on the actual structure from Supabase
interface ClusterStory {
  id: string;
  cluster_id: string;
  source_article_ids: string[];
  headline_english: string;
  headline_german: string;
  summary_english: string;
  summary_german: string;
  body_english: string;
  body_german: string;
  image1_url: string;
  image2_url: string;
  image3_url: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface SourceArticleWithSource {
  id: string;
  Content: string;
  url: string;
  source: {
    Name?: string;
  } | Array<{ Name?: string }> | null;
}

// Output structure interface
interface MappedClusterStory {
  id: string;
  cluster_id: string;
  headline_english: string;
  headline_german: string;
  summary_english: string;
  summary_german: string;
  image1_url: string;
  image2_url: string;
  image3_url: string;
  updated_at: string;
  sourceArticles: { id: string; newsSourceId: string }[];
}

// Type for SourceArticles minimal fields
interface SourceArticleMinimal {
  id: string;
  source: string;
}

// Response structure interface
interface PaginatedResponse {
  data: MappedClusterStory[];
  nextCursor: string | null;
}

// Securely fetch keys from environment variables.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

console.log("ClusterStories Edge Function initialized!")

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only allow GET requests
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // --- Pagination Logic ---
  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");

  console.log("Request URL:", req.url);
  console.log("Query Params - cursor:", cursorParam, "limit:", limitParam);

  const limit = limitParam ? parseInt(limitParam, 10) : 10; // Default to 10
  const cursor = cursorParam || null;

  // Validate limit
  if (isNaN(limit) || limit <= 0 || limit > 50) {
    return new Response(
      JSON.stringify({ error: "Invalid limit parameter (must be 1-50)" }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // Create request-scoped client using Anon Key + Auth Header
    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
        auth: { autoRefreshToken: false, persistSession: false }
      }
    );

    // Build the query
    let query = supabaseClient
      .from("ClusterStories")
      .select(`
        id,
        cluster_id,
        headline_english,
        headline_german,
        summary_english,
        summary_german,
        image1_url,
        image2_url,
        image3_url,
        status,
        updated_at,
        source_article_ids
      `)
      .order("updated_at", { ascending: false })
      .limit(limit);

    // Apply cursor filter if provided
    if (cursor !== null) {
      // Get the timestamp and ID from the cursor
      const parts = cursor.split("_");
      
      if (parts.length !== 2) {
        console.error("Invalid cursor format:", cursor);
        return new Response(
          JSON.stringify({ error: "Invalid cursor format" }),
          { status: 400, headers: corsHeaders }
        );
      }
      
      const cursorTimestamp = parts[0];
      const cursorId = parts[1];
      
      console.log("Parsed cursor - timestamp:", cursorTimestamp, "id:", cursorId);
      
      // Fix: Use the string filter format that Supabase's .or() method accepts
      // Format: column.operator.value,other_condition
      query = query.or(`updated_at.lt.${cursorTimestamp},and(updated_at.eq.${cursorTimestamp},id.lt.${cursorId})`);
      
      console.log("Using correct string filter format for or() method");
    }

    // Execute the query
    const { data: clusterStories, error: clusterError } = await query;

    // Log raw response for debugging
    console.log("Query response:", {
      data: clusterStories ? clusterStories.length : 0,
      error: clusterError ? clusterError.message : null
    });

    if (clusterError) {
      console.error("Error fetching cluster stories:", clusterError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch cluster stories", details: clusterError }),
        { status: 500, headers: corsHeaders }
      );
    }

    if (!clusterStories || clusterStories.length === 0) {
      // Check if we're getting here with a cursor that might be invalid
      if (cursor) {
        console.log("No results found with cursor:", cursor);
      }
      
      return new Response(
        JSON.stringify({ data: [], nextCursor: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch source articles for each cluster story
    const mappedClusterStories: MappedClusterStory[] = [];

    for (const story of clusterStories) {
      if (!story.source_article_ids || story.source_article_ids.length === 0) {
        mappedClusterStories.push({
          id: story.id,
          cluster_id: story.cluster_id,
          headline_english: story.headline_english,
          headline_german: story.headline_german,
          summary_english: story.summary_english,
          summary_german: story.summary_german,
          image1_url: story.image1_url,
          image2_url: story.image2_url,
          image3_url: story.image3_url,
          updated_at: story.updated_at,
          sourceArticles: []
        });
        continue;
      }
      // Fetch source articles
      console.log(`Fetching source articles for story ${story.id} with article IDs:`, story.source_article_ids);
      const { data: sourceArticlesData, error: sourceArticlesError } = await supabaseClient
        .from("SourceArticles")
        .select(`id, source`)
        .in("id", story.source_article_ids);
      if (sourceArticlesError) {
        console.error("Error fetching source articles:", sourceArticlesError);
        continue;
      }
      // Map to array of objects { id, newsSourceId }
      const sourceArticles = (sourceArticlesData || []).map((article: SourceArticleMinimal) => ({
        id: article.id,
        newsSourceId: article.source
      }));
      mappedClusterStories.push({
        id: story.id,
        cluster_id: story.cluster_id,
        headline_english: story.headline_english,
        headline_german: story.headline_german,
        summary_english: story.summary_english,
        summary_german: story.summary_german,
        image1_url: story.image1_url,
        image2_url: story.image2_url,
        image3_url: story.image3_url,
        updated_at: story.updated_at,
        sourceArticles
      });
    }

    // Determine the next cursor
    let nextCursor: string | null = null;
    if (clusterStories.length === limit) {
      const lastItem = clusterStories[clusterStories.length - 1];
      // Create a composite cursor from updated_at and id
      nextCursor = `${lastItem.updated_at}_${lastItem.id}`;
    }

    // Prepare the paginated response
    const responsePayload: PaginatedResponse = {
      data: mappedClusterStories,
      nextCursor: nextCursor,
    };

    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error executing Edge Function:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      JSON.stringify({ error: "Server error processing request", details: errorMessage }),
      { status: 500, headers: corsHeaders }
    );
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/clusterStories?limit=10' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

*/
