// index.ts for teamArticles
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, handleCors } from '../cors.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts"; // Keep this if needed

// --- Define Interfaces (Assuming similar structures as NewsArticles) ---
// You might need slightly different interfaces if TeamNewsArticles schema differs significantly
interface TeamNewsArticleRow {
  id: number; // Assuming TeamNewsArticles has its own primary ID
  headlineEnglish: string;
  headlineGerman: string;
  contentEnglish: string;
  contentGerman: string;
  summaryGerman: string;
  summaryEnglish: string;
  image1: string;
  team: { // Assuming direct relation or join provides teamId
    teamId: string;
  };
  status: string;
  // Add created_at if you sort by it, likely from a related table or the table itself
  // Example: Assuming a direct created_at column:
  created_at: string;
  // Or if linked via teamSourceArticle -> SourceArticles:
  // teamSourceArticle: {
  //   SourceArticle: {
  //     created_at: string;
  //   }
  // };
}

interface MappedTeamArticle {
  id: number;
  englishHeadline: string;
  germanHeadline: string;
  // Add other preview fields as needed (e.g., summary, image1)
  summaryEnglish?: string;
  summaryGerman?: string;
  image1?: string;
  createdAt: string;
  teamId?: string;
  status: string;
}

interface PaginatedTeamArticleResponse {
  data: MappedTeamArticle[];
  nextCursor: number | null; // Using ID as cursor like before
}
// --- End Interfaces ---


const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // --- Pagination and Filter Logic ---
  const url = new URL(req.url);
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");
  const teamIdParam = url.searchParams.get("teamId"); // Get teamId from query params

  const limit = limitParam ? parseInt(limitParam, 10) : 25; // Default limit
  const cursor = cursorParam ? parseInt(cursorParam, 10) : null;

  // Validate teamIdParam - it's essential for this function
  if (!teamIdParam) {
    return new Response(JSON.stringify({ error: "Missing teamId parameter" }), { status: 400, headers: corsHeaders });
  }
  if (isNaN(limit) || limit <= 0) {
    return new Response(JSON.stringify({ error: "Invalid limit parameter" }), { status: 400, headers: corsHeaders });
  }
  if (cursor !== null && isNaN(cursor)) {
    return new Response(JSON.stringify({ error: "Invalid cursor parameter" }), { status: 400, headers: corsHeaders });
  }
  // --- End Pagination and Filter Logic ---


  try {
    // Create request-scoped client
    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } }, auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Build the query
    let query = supabaseClient
      .from('TeamNewsArticles')
      .select(`
          id,
          headlineEnglish,
          headlineGerman,
          summaryGerman,
          summaryEnglish,
          image1,
          team!inner ( teamId ), 
          status,
          created_at 
      `)
      .eq('team', teamIdParam); // *** Filter by Team ID ***
      // RLS policy on TeamNewsArticles handles status visibility ('PUBLISHED')

    // Apply sorting (Crucial for cursor pagination)
    // Make sure 'created_at' exists and is suitable for sorting
    query = query
       .order('created_at', { ascending: false }) // Primary sort key
       .order('id', { ascending: false });      // Secondary sort key for stability

    // Apply cursor filter if provided
    if (cursor !== null) {
        // Fetch items with ID less than the cursor (since ordering by ID descending)
        query = query.lt("id", cursor);
    }

    // Apply limit
    query = query.limit(limit);

    // Execute the query
    const { data, error } = await query;

    if (error) throw error;

    // Type assertion and Mapping
    const typedData = (data as unknown) as TeamNewsArticleRow[] | null;

    const mappedData: MappedTeamArticle[] = (typedData || []).map((article) => ({
        id: article.id,
        englishHeadline: article.headlineEnglish ?? '',
        germanHeadline: article.headlineGerman ?? '',
        summaryEnglish: article.summaryEnglish ?? '',
        summaryGerman: article.summaryGerman ?? '',
        image1: article.image1 ?? '',
        createdAt: article.created_at ?? new Date(0).toISOString(), // Adjust based on actual source of created_at
        teamId: article.team?.teamId,
        status: article.status ?? '',
    }));

    // Determine the next cursor (using ID)
    let nextCursor: number | null = null;
    if (typedData && typedData.length === limit) {
        if (typedData.length > 0) {
            nextCursor = typedData[typedData.length - 1].id;
        }
    }

    // Prepare the paginated response
    const responsePayload: PaginatedTeamArticleResponse = {
      data: mappedData,
      nextCursor: nextCursor,
    };

    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } });

  } catch (error: unknown) { // Use 'unknown' which is safer than 'any'
    console.error("Error executing teamArticles function:", error);

    let clientErrorMessage = "Failed to fetch team articles."; // Default error

    // Safely check properties on the 'error' object
    if (typeof error === 'object' && error !== null) {
        // Check for Supabase PostgREST error code (PGRSTXXX often indicates specific issues)
        if ('code' in error && typeof error.code === 'string' && error.code === 'PGRST301') {
             clientErrorMessage = "Authorization error.";
        }
        // Check for Supabase error message containing relation details (might indicate bad ID)
        else if ('message' in error && typeof error.message === 'string' && error.message.includes("relation")) {
             clientErrorMessage = "Invalid query parameter."; // More specific than generic error
        }
    }

    return new Response(
        JSON.stringify({ error: clientErrorMessage }),
        {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        }
    );
  }
});