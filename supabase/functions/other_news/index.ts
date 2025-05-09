// index.ts (for articlePreviews Edge Function - Updated)
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";  // Your provided CORS code

// Define interface based on the actual structure from Supabase
interface NewsArticleRow {
  id: number;
  headlineEnglish: string;
  headlineGerman: string;
  Image1: string | null; // Allow null
  status: string | null; // Allow null
  UpdatedBy: string | null;
  team: {               // Can be null if !inner join, but inner forces it
    teamId: string;
  } | null; // Allow team relation to be null if not using !inner or if join fails (though inner prevents this)
  SourceArticle: {      // Can be null if !inner join
    created_at: string;
    source: number;
  } | null; // Allow SourceArticle relation to be null
}

// Output structure interface
interface MappedArticle {
  id: number;
  englishHeadline: string;
  germanHeadline: string;
  Image: string | null; // Allow null
  createdAt: string | null; // Allow null
  teamId?: string | null; // Allow null
  status: string | null; // Allow null
  UpdatedBy?: string | null;
  source?: number | null; // Add source field
}

// Response structure interface
interface PaginatedResponse {
  data: MappedArticle[];
  nextCursor: number | null;
}

// Securely fetch keys from environment variables.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // --- Pagination & Team Filter Logic ---
  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");
  const teamIdParam = url.searchParams.get("teamId"); // <<< Get teamId parameter

  const limit = limitParam ? parseInt(limitParam, 10) : 20; // Default to 20 like client
  const cursor = cursorParam ? parseInt(cursorParam, 10) : null;

  // Validate limit
  if (isNaN(limit) || limit <= 0 || limit > 100) { // Added upper bound check
    return new Response(
      JSON.stringify({ error: "Invalid limit parameter (must be 1-100)" }),
      { status: 400, headers: corsHeaders }
    );
  }
  // Validate cursor
  if (cursor !== null && (isNaN(cursor) || cursor < 0)) { // Cursor should be positive
     return new Response(
      JSON.stringify({ error: "Invalid cursor parameter" }),
      { status: 400, headers: corsHeaders }
    );
  }
  // Optional: Validate teamIdParam format if needed (e.g., 3 uppercase letters)
  // --- End Parameter Logic ---

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
      .from("NewsArticles")
      .select(`
        id,
        headlineEnglish,
        headlineGerman,
        Image1,
        status,
        UpdatedBy,
        team:Teams!inner ( teamId ),       
        SourceArticle!inner ( created_at, source ) 
      `)
      // Filter to only get articles from source = 1
      .eq('SourceArticle.source', 1)
      // RLS Policy handles visibility based on status (e.g., status = 'PUBLISHED')
      // .neq("status", "ARCHIVED") // REMOVED - Rely on RLS
      .order("created_at", { referencedTable: "SourceArticle", ascending: false })
      .order("id", { ascending: false }) // Secondary sort for stability
      .limit(limit);

    // <<< Apply teamId filter IF it was provided >>>
    if (teamIdParam) {
      // Filter on the related team's teamId column
      // Adjust 'team.teamId' if your relationship or column names differ
      query = query.eq('team.teamId', teamIdParam);
      console.log(`Applying team filter: ${teamIdParam}`);
    } else {
      console.log("No team filter applied.");
    }

    // Apply cursor filter if provided
    if (cursor !== null) {
      // We assume cursor is the ID of the last item seen
      // Since we order by created_at DESC, id DESC, the next items
      // will either have an older created_at OR the same created_at and a smaller ID.
      // Fetching based only on ID < cursor might be sufficient IF IDs are strictly decreasing
      // with time OR if the secondary sort makes it reliable.
      // A more robust cursor would involve both created_at and id.
      // Sticking with the simpler ID-based cursor for now as implemented previously:
      query = query.lt("id", cursor);
      console.log(`Applying cursor filter: id < ${cursor}`);
    }

    // Execute the query
    const { data, error, status: queryStatus } = await query;

    // Handle potential query errors (including RLS errors)
    if (error) {
      console.error("Supabase query error:", error);
      // Check for specific RLS violation (often results in empty data or specific error code)
      if (queryStatus === 401 || queryStatus === 403 || error.message.includes("security barrier")) {
         return new Response(JSON.stringify({ error: "Authorization failed." }), { status: 403, headers: corsHeaders });
      }
      // Generic error for other issues
      return new Response(
        JSON.stringify({ error: "Failed to fetch articles. Database error." }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Type assertion (handle null data explicitly)
    const typedData = (data as unknown as NewsArticleRow[] | null) ?? [];

    // Log raw data count
    console.log(`Fetched ${typedData.length} raw articles from database.`);
    // Optional: Log first article if debugging needed
    // if (typedData.length > 0) { console.log("Raw first article:", JSON.stringify(typedData[0])); }

    // Map to the desired output structure, handling potential nulls from joins/selects
    const mappedData: MappedArticle[] = (typedData || []).map((article) => ({
      id: article.id,
      englishHeadline: article.headlineEnglish ?? '', // Keep this null check
      germanHeadline: article.headlineGerman ?? '', // Keep this null check
      Image: article.Image1, // This is already string | null, so direct assignment is okay
      createdAt: article.SourceArticle?.created_at ?? null, 
      UpdatedBy: article.UpdatedBy, // Already string | null
      teamId: article.team?.teamId ?? null, 
      status: article.status, // Already string | null
      source: article.SourceArticle?.source ?? null, // Add source mapping
    }));

    // Determine the next cursor
    let nextCursor: number | null = null;
    // Only provide a nextCursor if we fetched exactly the number of items we asked for (limit)
    if (typedData.length === limit && typedData.length > 0) {
        // Use the id from the *last* item in the fetched data (typedData).
        nextCursor = typedData[typedData.length - 1].id;
        console.log(`Determined next cursor: ${nextCursor}`);
    } else {
        console.log(`No next cursor determined (fetched ${typedData.length}, limit ${limit}).`);
    }

    // Prepare the paginated response
    const responsePayload: PaginatedResponse = {
      data: mappedData,
      nextCursor: nextCursor,
    };

    // Return the successful response
    return new Response(
      JSON.stringify(responsePayload),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      }
    );

  } catch (error) {
      // Catch errors from client creation or unexpected issues
      console.error("Error executing Edge Function:", error);
      // Check error type for better client messages
      const clientErrorMessage = (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'PGRST301') ||
                            (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string' && (error as { message: string }).message.includes('JWT'))
        ? "Authorization error." // Auth error
        : error instanceof URIError || error instanceof SyntaxError // URL/Param parsing errors
        ? "Invalid request parameters."
        : "Server error processing request."; // Generic fallback

      return new Response(
          JSON.stringify({ error: clientErrorMessage }),
          { status: 500, headers: corsHeaders }
      );
  }
});