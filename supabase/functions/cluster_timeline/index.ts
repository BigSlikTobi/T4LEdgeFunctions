// Cluster Timeline Edge Function
// Fetches timeline data for a specific cluster and enriches with source article details
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";

// Define interfaces for the database tables and response
interface TimelineEntry {
  date: string;
  headline: string;
  article_id: string[];
}

interface TimelineData {
  timeline: TimelineEntry[];
  ClusterId: string;
}

interface Timeline {
  id: string;
  timeline_name: string;
  timeline_data: TimelineData;
  created_at: string;
}

interface DatabaseTimeline {
  id: string;
  timeline_name: string;
  timeline_data: TimelineData | string; // Could be string if stored as JSONB
  created_at: string;
}

interface ArticleSource {
  id: string;
  Name: string; // Capital 'N' to match the database schema
}

interface SourceArticle {
  id: string;
  headline: string;
  source?: ArticleSource | ArticleSource[]; // Direct relation to source
}

interface EnrichedArticle {
  id: string;
  headline: string;
  source_name: string;
}

interface EnrichedTimelineEntry {
  date: string;
  headline: string;
  articles: EnrichedArticle[];
}

interface EnrichedTimeline {
  timeline_name: string;
  timeline_data: EnrichedTimelineEntry[];
}

// Securely fetch keys from environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return new Response(
      new TextEncoder().encode(JSON.stringify({ error: "Method not allowed" })),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  try {
    // Parse the cluster_id from the URL query parameters
    const url = new URL(req.url);
    const cluster_id = url.searchParams.get("cluster_id");

    if (!cluster_id) {
      return new Response(
        new TextEncoder().encode(JSON.stringify({ error: "Missing required parameter: cluster_id" })),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // Create request-scoped client
    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
        auth: { autoRefreshToken: false, persistSession: false }
      }
    );

    console.log(`Debug: Looking for timeline with cluster_id: ${cluster_id}`);

    // First check if the table even exists and log its structure
    try {
      const { data: tableInfo } = await supabaseClient
        .from("timelines")
        .select("*")
        .limit(1);
        
      if (tableInfo && tableInfo.length > 0) {
        console.log("Debug: First record in timelines table:", JSON.stringify(tableInfo[0], null, 2));
      } else {
        console.log("Debug: Timelines table exists but has no data");
      }
    } catch (tableErr) {
      console.error("Debug: Error checking timelines table:", tableErr);
    }

    // Try multiple approaches to find the timeline
    
    // Check if this is a valid UUID
    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cluster_id);
    console.log(`Debug: Cluster ID format valid UUID? ${isValidUUID}`);
    
    // Approach 1: Using text search operator
    console.log("Debug: Trying approach 1 - text search with ->> operator");
    let timelineData = null;
    try {
      // Try two different query approaches
      let data = null;
      let error = null;
      
      // First try the direct path
      const result1 = await supabaseClient
        .from("timelines")
        .select("*")
        .filter("timeline_data->>ClusterId", "eq", cluster_id)
        .limit(1);
      
      if (!result1.error && result1.data && result1.data.length > 0) {
        console.log("Debug: Approach 1a succeeded");
        data = result1.data;
      } else {
        // Try with contains operator
        const result2 = await supabaseClient
          .from("timelines")
          .select("*")
          .contains("timeline_data", { ClusterId: cluster_id })
          .limit(1);
          
        if (!result2.error && result2.data && result2.data.length > 0) {
          console.log("Debug: Approach 1b succeeded");
          data = result2.data;
        } else {
          console.log("Debug: Approach 1 alternatives failed");
          error = result1.error || result2.error;
        }
      }
      
      if (error) {
        console.error("Debug: Approach 1 error:", error);
      } else if (data && data.length > 0) {
        timelineData = data[0];
      } else {
        console.log("Debug: Approach 1 returned no results");
      }
    } catch (err) {
      console.error("Debug: Approach 1 exception:", err);
    }      // Approach 2: Try raw filter method with different JSON path formats
      if (!timelineData) {
        console.log("Debug: Trying approach 2 - with different JSON paths");
        try {
          // Try different JSON path formats
          const paths = [
            { query: "timeline_data->>'ClusterId'", value: cluster_id },
            { query: "timeline_data->>'clusterId'", value: cluster_id },
            { query: "timeline_data->>'cluster_id'", value: cluster_id }
          ];
          
          for (const path of paths) {
            const { data, error } = await supabaseClient
              .from("timelines")
              .select("*")
              .filter(path.query, "eq", path.value)
              .limit(1);
              
            if (error) {
              console.error(`Debug: Approach 2 error with path ${path.query}:`, error);
            } else if (data && data.length > 0) {
              console.log(`Debug: Approach 2 succeeded with path ${path.query}`);
              timelineData = data[0];
              break;
            }
          }
          
          if (!timelineData) {
            console.log("Debug: Approach 2 returned no results with any path");
          }
        } catch (err) {
          console.error("Debug: Approach 2 exception:", err);
        }
      }
    
    // Approach 3: Get all timelines and filter manually
    if (!timelineData) {
      console.log("Debug: Trying approach 3 - manual filtering");
      try {
        const { data, error } = await supabaseClient
          .from("timelines")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);  // Get a reasonable number of records
          
        if (error) {
          console.error("Debug: Approach 3 error:", error);
        } else if (data && data.length > 0) {
          console.log(`Debug: Retrieved ${data.length} timelines for manual filtering`);
          
          for (const timeline of data) {
            if (timeline.timeline_data) {
              console.log(`Debug: Examining timeline ${timeline.id}`);
              
              try {
                // Handle different possible JSON structures
                if (typeof timeline.timeline_data === 'string') {
                  const parsed = JSON.parse(timeline.timeline_data);
                  if (parsed.ClusterId === cluster_id || 
                      parsed.clusterId === cluster_id || 
                      parsed.cluster_id === cluster_id) {
                    console.log("Debug: Found match in parsed string JSON");
                    timelineData = timeline;
                    break;
                  }
                } else if (typeof timeline.timeline_data === 'object') {
                  if (timeline.timeline_data.ClusterId === cluster_id || 
                      timeline.timeline_data.clusterId === cluster_id || 
                      timeline.timeline_data.cluster_id === cluster_id) {
                    console.log("Debug: Found match in object JSON");
                    timelineData = timeline;
                    break;
                  }
                }
              } catch (parseErr) {
                console.error("Debug: Error parsing timeline JSON:", parseErr);
              }
            }
          }
        } else {
          console.log("Debug: Approach 3 returned no results");
        }
      } catch (err) {
        console.error("Debug: Approach 3 exception:", err);
      }
    }

    // If we still don't have timeline data, return a 404
    if (!timelineData) {
      console.error("Debug: No timeline found for cluster_id:", cluster_id);
      return new Response(
        new TextEncoder().encode(JSON.stringify({ 
          error: "No timeline found for this cluster",
          details: "Tried multiple approaches but couldn't find a matching timeline"
        })),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // Process the timeline we found
    console.log("Debug: Found timeline:", JSON.stringify(timelineData, null, 2));
    
    // Parse timeline data if it's a string
    let parsedTimelineData = timelineData.timeline_data;
    if (typeof timelineData.timeline_data === 'string') {
      try {
        parsedTimelineData = JSON.parse(timelineData.timeline_data);
        console.log("Debug: Successfully parsed timeline_data from string");
      } catch (parseError) {
        console.error("Debug: Error parsing timeline_data string:", parseError);
        return new Response(
          new TextEncoder().encode(JSON.stringify({ 
            error: "Invalid timeline data format",
            details: "Could not parse timeline data JSON"
          })),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
        );
      }
    }
    
    // Update the timeline object with the parsed data
    timelineData.timeline_data = parsedTimelineData;
    
    // Make sure we have the expected structure
    if (!timelineData.timeline_name || !timelineData.timeline_data || !timelineData.timeline_data.timeline) {
      return new Response(
        new TextEncoder().encode(JSON.stringify({ 
          error: "Invalid timeline data structure",
          details: "Timeline data doesn't have the expected structure",
          received: typeof timelineData.timeline_data,
          timelineDataKeys: Object.keys(timelineData.timeline_data || {})
        })),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // Collect all article IDs from the timeline
    const articleIds: string[] = [];
    for (const entry of timelineData.timeline_data.timeline) {
      if (Array.isArray(entry.article_id)) {
        articleIds.push(...entry.article_id);
      }
    }

    console.log(`Debug: Need to fetch ${articleIds.length} articles`);
    
    // Skip if no articles
    if (articleIds.length === 0) {
      const timelineEntries = Array.isArray(timelineData.timeline_data.timeline) ? 
        timelineData.timeline_data.timeline : [];
        
      const emptyTimeline: EnrichedTimeline = {
        timeline_name: String(timelineData.timeline_name || ''),
        timeline_data: timelineEntries.map((entry: TimelineEntry) => ({
          date: String(entry.date || ''),
          headline: String(entry.headline || ''),
          articles: [],
        }))
      };
      
      return new Response(
        new TextEncoder().encode(JSON.stringify(emptyTimeline)),
        { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // Fetch all the source articles with their sources
    const { data: sourceArticlesData, error: articlesError } = await supabaseClient
      .from("SourceArticles")
      .select(`
        id,
        headline,
        source:source (
          id,
          Name
        )
      `)
      .in("id", articleIds);

    if (articlesError) {
      console.error("Debug: Error fetching source articles:", articlesError);
      return new Response(
        new TextEncoder().encode(JSON.stringify({ 
          error: "Failed to fetch source article data",
          details: articlesError.message
        })),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // Create a lookup map for the articles
    const articlesMap: Record<string, {headline: string, source_name: string}> = {};
    
    console.log(`Debug: Processing ${sourceArticlesData?.length || 0} source articles data`);
    if (sourceArticlesData && sourceArticlesData.length > 0) {
      // Log the first article to see its structure
      console.log("Debug: First source article structure:", JSON.stringify(sourceArticlesData[0], null, 2));
    }
    
    if (sourceArticlesData) {
      for (const article of sourceArticlesData) {
        const id = String(article.id || '');
        let sourceName = "Unknown Source";
        
        // Handle the source depending on its structure
        if (article.source) {
          if (Array.isArray(article.source) && article.source.length > 0) {
            const firstSource = article.source[0];
            if (firstSource && typeof firstSource === 'object' && 'Name' in firstSource) {
              sourceName = String(firstSource.Name || "Unknown Source");
            }
          } else if (typeof article.source === 'object' && 'Name' in article.source) {
            sourceName = String(article.source.Name || "Unknown Source");
          }
        }
        
        articlesMap[id] = {
          headline: String(article.headline || "No headline"),
          source_name: sourceName
        };
      }
    }
    
    console.log(`Debug: Processed ${Object.keys(articlesMap).length} source articles`);

    // Build the enriched timeline
    const timeline = timelineData.timeline_data;
    const timelineEntries = Array.isArray(timeline.timeline) ? timeline.timeline : [];
    
    const enrichedTimelineData: EnrichedTimelineEntry[] = timelineEntries.map((entry: TimelineEntry) => {
      const enrichedArticles: EnrichedArticle[] = [];
      
      if (Array.isArray(entry.article_id)) {
        for (const articleId of entry.article_id) {
          const articleIdStr = String(articleId);
          if (articlesMap[articleIdStr]) {
            enrichedArticles.push({
              id: articleIdStr,
              headline: articlesMap[articleIdStr].headline,
              source_name: articlesMap[articleIdStr].source_name
            });
          }
        }
      }
      
      return {
        date: String(entry.date || ''),
        headline: String(entry.headline || ''),
        articles: enrichedArticles
      };
    });

    // Create the final response
    const enrichedTimeline: EnrichedTimeline = {
      timeline_name: timelineData.timeline_name,
      timeline_data: enrichedTimelineData
    };

    return new Response(
      new TextEncoder().encode(JSON.stringify(enrichedTimeline)),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );
    
  } catch (error) {
    console.error("Debug: Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return new Response(
      new TextEncoder().encode(JSON.stringify({ 
        error: "Failed to process timeline request", 
        details: errorMessage 
      })),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/cluster_timeline?cluster_id=01b0bae7-6fc6-4547-aeef-22abcdb061a0' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

  # Debug curl command with more verbose output:
  curl -v --location --request GET 'http://127.0.0.1:54321/functions/v1/cluster_timeline?cluster_id=01b0bae7-6fc6-4547-aeef-22abcdb061a0' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

*/
