// index.ts
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";  // Your provided CORS code

// Define interface based on the actual structure from Supabase
interface NewsArticleRow {
  id: number;  // Adding id field
  headlineEnglish: string;
  headlineGerman: string;
  Image1: string;
  status: string;
  UpdatedBy: string | null;
  team: {
    teamId: string;
  };
  SourceArticle: {
    created_at: string;
  };
}

// Output structure interface
interface MappedArticle {
  id: number;  // Adding id field
  englishHeadline: string;
  germanHeadline: string;
  Image: string;
  createdAt: string;
  teamId?: string;
  status: string;
  UpdatedBy?: string | null;
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

  // --- Pagination Logic ---
  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");

  const limit = limitParam ? parseInt(limitParam, 10) : 25;
  const cursor = cursorParam ? parseInt(cursorParam, 10) : null;

  if (isNaN(limit) || limit <= 0) {
    return new Response(
      JSON.stringify({ error: "Invalid limit parameter" }),
      { status: 400, headers: corsHeaders }
    );
  }
  if (cursor !== null && isNaN(cursor)) {
     return new Response(
      JSON.stringify({ error: "Invalid cursor parameter" }),
      { status: 400, headers: corsHeaders }
    );
  }
  // --- End Pagination Logic ---

    try { // Added try block for client creation
      // *** CREATE request-scoped client using Anon Key + Auth Header ***
      const supabaseClient = createClient(
          SUPABASE_URL,
          SUPABASE_ANON_KEY, // Use Anon Key for initialization
          {
            global: { headers: { Authorization: req.headers.get("Authorization")! } },
            auth: { // Recommended settings for functions
                autoRefreshToken: false,
                persistSession: false
            }
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
      team:Teams!inner (
        teamId
      ),
      SourceArticle!inner (
        created_at 
      )
    `)
    .neq("status", "ARCHIVED")
    // Order by created_at descending, then id descending for stable pagination
    .order("created_at", { referencedTable: "SourceArticle", ascending: false })
    .order("id", { ascending: false }) // Secondary sort for stability
    .limit(limit); // Apply the limit

  // Apply cursor filter if provided
  if (cursor !== null) {
    // Fetch items with ID less than the cursor because we are ordering descending
    query = query.lt("id", cursor);
  }

  // Execute the query
  const { data, error } = await query;

  if (error) {
    console.error("Error fetching articles:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please try again later." }),
      { status: 500, headers: corsHeaders }
    );
  }

  // Type assertion with an intermediate step to unknown
  const typedData = (data as unknown) as NewsArticleRow[] | null;

  // More detailed logging of the first article's raw data
  if (typedData && typedData.length > 0) {
    console.log("Raw first article data:", JSON.stringify(typedData[0], null, 2));
  }

  // Map to the desired output structure using typedData directly
  const mappedData: MappedArticle[] = (typedData || []).map((article) => ({
    id: article.id,
    englishHeadline: article.headlineEnglish ?? '',
    germanHeadline: article.headlineGerman ?? '',
    Image: article.Image1 ?? '',
    createdAt: article.SourceArticle.created_at ?? new Date(0).toISOString(),
    UpdatedBy: article.UpdatedBy,
    teamId: article.team?.teamId,
    status: article.status ?? '',
  }));

  // Determine the next cursor
  let nextCursor: number | null = null;
  // Check if the number of results fetched equals the limit requested
  if (typedData && typedData.length === limit) {
      // If we fetched the full limit, the last item's ID is the next cursor
      // Use the id from the last item in the fetched data (typedData).
      if (typedData.length > 0) {
          nextCursor = typedData[typedData.length - 1].id;
      }
  }

  // Prepare the paginated response
  const responsePayload: PaginatedResponse = {
    data: mappedData,
    nextCursor: nextCursor,
  };

  return new Response(
    JSON.stringify(responsePayload), // Send the paginated response object
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
  } catch (error) { // Catch errors from client creation or query
      console.error("Error executing function:", error);
      // Avoid leaking detailed Supabase errors to the client if possible
      const clientErrorMessage = (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'PGRST301') ||
                            (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string' && (error as { message: string }).message.includes('JWT'))
        ? "Authorization error."
        : "Failed to fetch articles.";

      return new Response(
          JSON.stringify({ error: clientErrorMessage }),
          { status: 500, headers: corsHeaders }
      );
  }
});
