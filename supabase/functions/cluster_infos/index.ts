// Cluster Infos Edge Function
// Fetches cluster information with related data across multiple tables
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";

// Define interfaces for the database tables and response
interface Cluster {
  clusterId: string; // uuid
  updated_at: string; // timestamptz
  status: string; // text
  cluster_images: ClusterImage[] | null;
  cluster_summary: ClusterSummary[] | null;
}

interface ClusterImage {
  image_url: string; // text
}

interface ClusterSummary {
  id: number; // int8
  headline: string; // text
  content: string; // text
  cluster_summary_int: ClusterSummaryInt[] | null;
}

interface ClusterSummaryInt {
  language_code: string; // text
  headline: string; // text
  content: string; // text
}

// Output structure for the response
interface MappedCluster {
  clusterId: string;
  updated_at: string;
  status: string;
  image_url: string | null;
  headline: string | null;
  content: string | null;
  headline_de: string | null;
  content_de: string | null;
}

// Response structure with pagination
interface PaginatedResponse {
  data: MappedCluster[];
  nextCursor: string | null;
}

// Securely fetch keys from environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // --- Pagination Logic ---
  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");
  
  const limit = limitParam ? parseInt(limitParam, 10) : 20; // Default to 20
  const cursor = cursorParam ?? null;

  // Validate limit
  if (isNaN(limit) || limit <= 0 || limit > 100) {
    return new Response(
      JSON.stringify({ error: "Invalid limit parameter (must be 1-100)" }),
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

    // Build the query with relationships
    let query = supabaseClient
      .from("clusters")
      .select(`
        clusterId,
        updated_at,
        status,
        cluster_images (
          image_url
        ),
        cluster_summary (
          id,
          headline,
          content,
          cluster_summary_int!inner (
            language_code,
            headline,
            content
          )
        )
      `)
      // Only include clusters with German translations
      .eq("cluster_summary.cluster_summary_int.language_code", "de")
      .order("updated_at", { ascending: false })
      .limit(limit);
    
    // Apply cursor filter if provided
    if (cursor) {
      // We're using clusterId as our cursor
      query = query.lt("clusterId", cursor);
      console.log(`Applying cursor filter: clusterId < ${cursor}`);
    }

    // Execute the query
    const { data, error, status: queryStatus } = await query;

    // Handle potential query errors
    if (error) {
      console.error("Supabase query error:", error);
      // Check for specific authentication errors
      if (queryStatus === 401 || queryStatus === 403 || error.message.includes("security barrier")) {
        return new Response(JSON.stringify({ error: "Authorization failed." }), { status: 403, headers: corsHeaders });
      }
      // Generic error for other issues
      return new Response(
        JSON.stringify({ error: "Failed to fetch cluster data. Database error." }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Type assertion (handle null data explicitly)
    const typedData = (data as unknown as Cluster[] | null) ?? [];

    // Log raw data count
    console.log(`Fetched ${typedData.length} clusters from database.`);

    // Map to the desired output structure
    const mappedData: MappedCluster[] = typedData.map((cluster) => {
      // Find the first German translation if available
      const germanTranslations = cluster.cluster_summary?.[0]?.cluster_summary_int?.filter(
        (translation) => translation.language_code === "de"
      ) ?? [];
      
      const germanTranslation = germanTranslations.length > 0 ? germanTranslations[0] : null;
      
      return {
        clusterId: cluster.clusterId,
        updated_at: cluster.updated_at,
        status: cluster.status,
        image_url: cluster.cluster_images?.[0]?.image_url ?? null,
        headline: cluster.cluster_summary?.[0]?.headline ?? null,
        content: cluster.cluster_summary?.[0]?.content ?? null,
        headline_de: germanTranslation?.headline ?? null,
        content_de: germanTranslation?.content ?? null,
      };
    });

    // Determine the next cursor
    let nextCursor: string | null = null;
    // Only provide a nextCursor if we fetched exactly the number of items we asked for (limit)
    if (typedData.length === limit && typedData.length > 0) {
      // Use the clusterId from the *last* item in the fetched data as the next cursor
      nextCursor = typedData[typedData.length - 1].clusterId;
      console.log(`Determined next cursor: ${nextCursor}`);
    } else {
      console.log(`No next cursor determined (fetched ${typedData.length}, limit ${limit}).`);
    }

    // Return the response with the mapped data and next cursor
    return new Response(
      JSON.stringify({ data: mappedData, nextCursor }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/cluster_infos' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
