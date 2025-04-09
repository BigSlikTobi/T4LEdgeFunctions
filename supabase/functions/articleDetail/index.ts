import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";

// Define interfaces matching FULL article structure (including content)
interface NewsArticleRow {
  id: number;
  headlineEnglish: string;
  headlineGerman: string;
  ContentEnglish: string;
  ContentGerman: string;  
  Image1: string | null;
  Image2: string | null;  
  Image3: string | null;
  status: string;
  UpdatedBy: string | null;
  isUpdate: boolean | null; // Assuming this is in NewsArticles
  team: { teamId: string } | null; // Team might be null
  SourceArticle: {
    created_at: string;
    url: string | null;
    source: { Name: string } | null; // Source might be null
  } | null; // SourceArticle relation might be null
}

interface MappedArticle {
  id: number;
  englishHeadline: string;
  germanHeadline: string;
  Image: string | null; // Use Image1/2/3 specifically in ArticleDetail, but define Image here for consistency if needed elsewhere
  createdAt: string;
  teamId?: string | null; // Allow null
  status: string;
  UpdatedBy?: string | null;
}

// Output structure for a single article (similar to MappedArticle but maybe more fields)
interface ArticleDetail extends Omit<MappedArticle, 'Image'> { // Omit generic 'Image' if using Image1/2/3
  ContentEnglish: string;
  ContentGerman: string;
  Image1: string | null;
  Image2: string | null;
  Image3: string | null;
  sourceUrl: string | null;
  SourceName: string | null;
  isUpdate: boolean | null;
  // Add any other fields needed for the detail page
}


// Environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: corsHeaders });
  }

  // --- Get Article ID from Query Parameter ---
  const url = new URL(req.url);
  const articleIdParam = url.searchParams.get("id");

  if (!articleIdParam) {
    return new Response(JSON.stringify({ error: "Missing required parameter: id" }), { status: 400, headers: corsHeaders });
  }

  const articleId = parseInt(articleIdParam, 10);
  if (isNaN(articleId)) {
    return new Response(JSON.stringify({ error: "Invalid parameter: id must be a number" }), { status: 400, headers: corsHeaders });
  }
  // --- End Parameter Handling ---

  try {
    // *** CREATE request-scoped client ***
    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
        auth: { autoRefreshToken: false, persistSession: false }
      }
    );

    // *** Fetch ONE article by ID, respecting RLS ***
    const { data, error } = await supabaseClient
      .from("NewsArticles")
      .select(`
        *, 
        team:Teams ( teamId ), 
        SourceArticle!inner ( 
          created_at,
          url,
          source:NewsSource ( Name )
        )
      `)
      .eq('id', articleId) // Filter by the specific ID
      // RLS policy (status = 'PUBLISHED') is automatically applied
      .single(); // Expect only one row or null

    if (error) {
      // Handle specific errors like not found (PGRST116) vs. others
      if (error.code === 'PGRST116') {
        // Row not found or RLS prevents access (treat as not found for client)
        return new Response(JSON.stringify({ error: "Article not found or not accessible" }), { status: 404, headers: corsHeaders });
      }
      // Re-throw other errors to be caught below
      throw error;
    }

    // If data is null here (after .single() without error), it means RLS blocked it or it doesn't exist
    if (!data) {
         return new Response(JSON.stringify({ error: "Article not found or not accessible" }), { status: 404, headers: corsHeaders });
    }

    if (typeof data !== 'object' || data === null) {
      console.error("Received unexpected data format from Supabase:", data);
      throw new Error("Invalid data received from database."); // Throw to trigger the catch block
    }

    // Type assertion (adjust NewsArticleRow if needed)
    const typedArticle = data as NewsArticleRow;

    // Map to the desired output structure (ArticleDetail)
    const mappedArticle: ArticleDetail = {
      id: typedArticle.id,
      englishHeadline: typedArticle.headlineEnglish ?? '',
      germanHeadline: typedArticle.headlineGerman ?? '',
      ContentEnglish: typedArticle.ContentEnglish ?? '',
      ContentGerman: typedArticle.ContentGerman ?? '',
      Image1: typedArticle.Image1,
      Image2: typedArticle.Image2,
      Image3: typedArticle.Image3,
      createdAt: typedArticle.SourceArticle?.created_at ?? new Date(0).toISOString(),
      sourceUrl: typedArticle.SourceArticle?.url ?? null,
      SourceName: typedArticle.SourceArticle?.source?.Name ?? null,
      teamId: typedArticle.team?.teamId,
      status: typedArticle.status ?? '',
      UpdatedBy: typedArticle.UpdatedBy,
      isUpdate: typedArticle.isUpdate
    };

    return new Response(JSON.stringify(mappedArticle), { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });

  } catch (error) {
      console.error(`Error fetching article detail for ID ${articleId}:`, error);
      // Check for specific auth errors vs. general server errors
      const isAuthError = (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'PGRST301') ||
                          (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string' && (error as { message: string }).message.includes('JWT'));

      const clientErrorMessage = isAuthError ? "Authorization error." : "Failed to fetch article detail.";
      const statusCode = isAuthError ? 401 : 500; // Use 401 for auth errors

      return new Response(JSON.stringify({ error: clientErrorMessage }), { status: statusCode, headers: corsHeaders });
  }
});