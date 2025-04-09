// TODO: deprecate this method and migrate to articleDetail and articlePreviews to enhance performance
// index.ts
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";  // Your provided CORS code

// Define interface based on the actual structure from Supabase
interface NewsArticleRow {
  id: number;  // Adding id field
  headlineEnglish: string;
  headlineGerman: string;
  ContentEnglish: string;
  ContentGerman: string;
  Image1: string;
  status: string;
  UpdatedBy: string | null;
  team: {
    teamId: string;
  };
  SourceArticle: {
    created_at: string;
    url: string;
    source: {
      Name: string;
    };
  };
}

// Output structure interface
interface MappedArticle {
  id: number;  // Adding id field
  englishHeadline: string;
  germanHeadline: string;
  ContentEnglish: string;
  ContentGerman: string;
  Image1: string;
  createdAt: string;
  SourceName?: string;
  sourceUrl?: string;
  teamId?: string;
  status: string;
}

// Securely fetch keys from environment variables.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Initialize the Supabase client with the service role key.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: {
    headers: { "Content-Type": "application/json" },
  },
});

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }
  
  // Query NewsArticles along with related Teams and SourceArticle/NewsSource
  const { data, error } = await supabase
    .from("NewsArticles")
    .select(`
      *,
      team:Teams!inner (
        teamId
      ),
      SourceArticle!inner (
        created_at,
        url,
        source:NewsSource!inner (
          Name
        )
      )
    `)
    .neq("status", "ARCHIVED");

  if (error) {
    console.error("Error fetching articles:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    );
  }
  
  // Type assertion with an intermediate step to unknown
  const typedData = (data as unknown) as NewsArticleRow[] | null;
  
  // More detailed logging of the first article's raw data
  if (typedData && typedData.length > 0) {
    console.log("Raw first article data:", JSON.stringify(typedData[0], null, 2));
  }
  
  // Filter out any articles that have a non-null or non-empty UpdatedBy value.
  const filteredData = (typedData || []).filter((article) => {
    return article.UpdatedBy === null || article.UpdatedBy === "";
  });
  
  // Map to the desired output structure
  const mappedData: MappedArticle[] = filteredData.map((article) => ({
    id: article.id,
    englishHeadline: article.headlineEnglish,
    germanHeadline: article.headlineGerman,
    ContentEnglish: article.ContentEnglish,
    ContentGerman: article.ContentGerman,
    Image1: article.Image1,
    createdAt: article.SourceArticle.created_at,
    SourceName: article.SourceArticle?.source?.Name,
    sourceUrl: article.SourceArticle?.url,
    teamId: article.team?.teamId,
    status: article.status,
  }));
  
  return new Response(
    JSON.stringify(mappedData),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
});
