// Fetches timeline data for a specific cluster_id from timelines or timelines_int table based on language_code
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";

// Define interfaces for the timeline data structure
interface TimelineEntry {
  summary: string;
  headline: string;
  created_at: string;
  source_name: string;
}

// Add interface for nested date structure
interface DateGroupedEntry {
  date: string;
  articles: TimelineEntry[];
}

interface TimelineData {
  timeline: (TimelineEntry | DateGroupedEntry)[];
  cluster_id?: string;
  ClusterId?: string;
  clusterId?: string;
}

interface DatabaseTimeline {
  id: string;
  timeline_data: TimelineData | string;
  created_at: string;
  language_code?: string;
  cluster_id?: string; // Added based on user's previous change
}

interface CleanedTimelineEntry {
  headline: string;
  instruction: string;
  content: string;
  created_at?: string; // Added for UI
  source_name?: string; // Added for UI
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Helper function to fetch a timeline record from a specific table
async function fetchTimelineRecord(
  supabaseClient: SupabaseClient,
  tableName: string,
  cluster_id: string,
  language_code?: string
): Promise<{ record: DatabaseTimeline | null, error: Error | null }> {

  let query = supabaseClient.from(tableName).select("*");

  // Add direct filter for the new cluster_id column
  query = query.eq("cluster_id", cluster_id);

  // Add language_code filter if querying timelines_int
  if (language_code && tableName === "timelines_int") {
    query = query.eq("language_code", language_code);
  }

  const { data, error } = await query.limit(1).returns<DatabaseTimeline[]>();

  if (error) {
    console.warn(`Debug: Error querying ${tableName} for cluster_id ${cluster_id} (lang: ${language_code || 'N/A'}): ${error.message}`);
    return { record: null, error: error as Error | null };
  }

  if (data && data.length > 0) {
    return { record: data[0], error: null };
  }

  return { record: null, error: null }; // No record found, no error
}


serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { 
        status: 405, 
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } 
      }
    );
  }

  try {
    // Parse parameters from URL
    const url = new URL(req.url);
    const cluster_id = url.searchParams.get("cluster_id");
    const language_code = url.searchParams.get("language_code") || "en";

    console.log(`Debug: Processing request - cluster_id: ${cluster_id}, language_code: ${language_code}`);

    if (!cluster_id) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: cluster_id" }),
        { 
          status: 400, 
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } 
        }
      );
    }

    // Create Supabase client
    const supabaseClient: SupabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
        auth: { autoRefreshToken: false, persistSession: false }
      }
    );

    let timelineToProcess: DatabaseTimeline | null = null;
    let processingError: Error | null = null; // Use Error type for error
    let tableSource = "";

    // If language_code is not "en", first try to fetch from 'timelines_int'
    if (language_code !== "en") {
      console.log(`Debug: Attempting to fetch from 'timelines_int' for lang: ${language_code}, cluster_id: ${cluster_id}`);
      const { record, error } = await fetchTimelineRecord(supabaseClient, "timelines_int", cluster_id, language_code);
      if (record) {
        timelineToProcess = record;
        tableSource = "timelines_int";
        console.log(`Debug: Found timeline in 'timelines_int' with id: ${record.id}`);
      } else {
        processingError = error; // Capture error if any
        console.log(`Debug: Timeline not found or error in 'timelines_int' for lang ${language_code}. Error: ${error?.message}. Will attempt fallback to 'timelines'.`);
      }
    }

    // If timeline not found yet (either because lang was 'en' or 'timelines_int' fetch failed/returned no data)
    if (!timelineToProcess) {
      const fallbackTable = "timelines";
      if (language_code === "en") {
        console.log(`Debug: Language is 'en'. Attempting to fetch from '${fallbackTable}' for cluster_id: ${cluster_id}`);
      } else {
        console.log(`Debug: Fallback. Attempting to fetch from '${fallbackTable}' for cluster_id: ${cluster_id}`);
      }
      
      const { record, error } = await fetchTimelineRecord(supabaseClient, fallbackTable, cluster_id);
      if (record) {
        timelineToProcess = record;
        tableSource = fallbackTable;
        processingError = null; // Clear previous error if data found here
        console.log(`Debug: Found timeline in '${fallbackTable}' with id: ${record.id}`);
      } else {
        // If timelineToProcess is still null, processingError should be from this attempt,
        // or the previous one if this also had no data but no new error.
        if (error) processingError = error; 
        console.log(`Debug: Timeline not found or error in '${fallbackTable}'. Error: ${error?.message}`);
      }
    }

    // Handle case where no timeline was found after all attempts or a persistent error occurred
    if (!timelineToProcess) {
      if (processingError) {
        console.error(`Debug: Failed to fetch timeline for cluster_id ${cluster_id} after all attempts. Final error:`, processingError.message);
        return new Response(JSON.stringify({ error: "Failed to fetch timeline data: " + processingError.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
            status: 500,
        });
      }
      console.log(`Debug: No timeline found for cluster_id: ${cluster_id} (lang: ${language_code}) after all attempts.`);
      return new Response(
        JSON.stringify({ 
          error: "Timeline not found",
          cluster_id: cluster_id,
          language_code: language_code,
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } 
        }
      );
    }

    // Successfully found a timeline
    const timeline = timelineToProcess;
    const sourceTableForResponse = tableSource;
    console.log(`Debug: Processing timeline record with id: ${timeline.id} from table: ${sourceTableForResponse}`);

    // Parse timeline_data if it's a string
    let timelineData: TimelineData;
    if (typeof timeline.timeline_data === "string") {
      try {
        timelineData = JSON.parse(timeline.timeline_data);
      } catch (parseError) {
        console.error("Debug: Failed to parse timeline_data JSON:", parseError);
        return new Response(
          JSON.stringify({ error: "Invalid timeline data format" }),
          { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } 
          }
        );
      }
    } else {
      timelineData = timeline.timeline_data;
    }

    console.log(`Debug: Timeline data contains ${timelineData.timeline?.length || 0} entries`);

    // Check if cluster_id matches (handle different field name variations)
    const dataClusterId = timelineData.cluster_id || timelineData.ClusterId || timelineData.clusterId;
    console.log(`Debug: Timeline data cluster_id: ${dataClusterId}, requested: ${cluster_id}`);

    // Clean and transform the timeline data - handle both flat and nested structures
    const cleanedTimeline: CleanedTimelineEntry[] = [];
    
    if (timelineData.timeline) {
      console.log(`Debug: Processing ${timelineData.timeline.length} timeline entries`);
      
      for (const entry of timelineData.timeline) {
        // Check if entry has 'articles' property (nested structure)
        if ('articles' in entry && Array.isArray(entry.articles)) {
          console.log(`Debug: Found date-grouped entry with ${entry.articles.length} articles for date: ${entry.date}`);
          
          // Process nested articles
          for (const article of entry.articles) {
            if (article.headline || article.summary) { // Only add non-empty entries
              cleanedTimeline.push({
                headline: article.headline || "",
                instruction: article.summary || "",
                content: article.summary || "",
                created_at: article.created_at,
                source_name: article.source_name,
              });
            }
          }
        } else {
          // Process flat entry (direct timeline entry)
          const flatEntry = entry as TimelineEntry;
          if (flatEntry.headline || flatEntry.summary) { // Only add non-empty entries
            console.log(`Debug: Processing flat timeline entry: ${flatEntry.headline}`);
            cleanedTimeline.push({
              headline: flatEntry.headline || "",
              instruction: flatEntry.summary || "",
              content: flatEntry.summary || "",
              created_at: flatEntry.created_at,
              source_name: flatEntry.source_name,
            });
          }
        }
      }
    }

    console.log(`Debug: Extracted ${cleanedTimeline.length} total articles from timeline structure`);

    // Prepare response
    const response = {
      cluster_id: cluster_id,
      language_code: language_code,
      table_source: sourceTableForResponse, // Use the determined source table
      timeline_entries: cleanedTimeline,
      total_entries: cleanedTimeline.length,
      retrieved_at: new Date().toISOString()
    };

    console.log(`Debug: Returning ${cleanedTimeline.length} cleaned timeline entries from ${sourceTableForResponse}`);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } 
      }
    );

  } catch (error) {
    console.error("Debug: Unhandled error in timeline function:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } 
      }
    );
  }
});

