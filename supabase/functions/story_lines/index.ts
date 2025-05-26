// Story Lines Edge Function
// Fetches paginated story line data for a specific language_code from clusters where cherry_pick is true
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

interface Cluster {
  cluster_id: string;
  cherry_pick: boolean;
}

interface ClusterArticle {
  id: string;
  headline: string | null;
  image_url: string | null;
  cluster_id: string;
}

interface ClusterArticleInt {
  cluster_article_id: string;
  language_code: string;
  headline: string | null;
}

interface StoryLineResponse {
  headline: string | null;
  image_url: string | null;
  cluster_id: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return handleCors(req) ?? new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const url = new URL(req.url);
    const languageCode = url.searchParams.get("language_code");
    const pageParam = url.searchParams.get("page");
    
    // Parse page parameter (default to 1)
    const page = pageParam ? Math.max(1, parseInt(pageParam)) : 1;
    const limit = 25;
    const offset = (page - 1) * limit;

    // Validate required parameters
    if (!languageCode) {
      return new Response(JSON.stringify({ error: "language_code parameter is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 400,
      });
    }

    console.log(`Fetching story lines for language_code: ${languageCode}, page: ${page}, limit: ${limit}, offset: ${offset}`);

    // Debug: Let's first check what international content exists for this language
    const { data: debugIntlData, error: debugIntlError } = await supabase
      .from("cluster_article_int")
      .select("cluster_article_id, language_code, headline")
      .eq("language_code", languageCode)
      .limit(5);
    
    console.log(`Debug - International content check for ${languageCode}:`, {
      hasError: !!debugIntlError,
      errorMessage: debugIntlError?.message,
      sampleData: debugIntlData
    });

    // 1. First get clusters with cherry_pick = true
    const { data: cherryPickedClusters, error: clusterError } = await supabase
      .from("clusters")
      .select("cluster_id")
      .eq("cherry_pick", true);

    if (clusterError) {
      console.error("Error fetching clusters:", clusterError.message);
      return new Response(JSON.stringify({ error: "Failed to fetch cherry-picked clusters: " + clusterError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 500,
      });
    }

    if (!cherryPickedClusters || cherryPickedClusters.length === 0) {
      return new Response(JSON.stringify({ 
        data: [], 
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: page > 1
        },
        message: "No cherry-picked clusters found" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 200,
      });
    }

    const clusterIds = cherryPickedClusters.map((cluster) => cluster.cluster_id);
    
    // 2. Fetch cluster_articles for cherry-picked clusters with pagination
    const { data: clusterArticlesData, error: clusterArticlesError, count } = await supabase
      .from("cluster_articles")
      .select("id, headline, image_url, cluster_id", { count: 'exact' })
      .in("cluster_id", clusterIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
      .returns<ClusterArticle[]>();

    if (clusterArticlesError) {
      console.error("Error fetching cluster_articles:", clusterArticlesError.message);
      return new Response(JSON.stringify({ error: "Failed to fetch cluster articles: " + clusterArticlesError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 500,
      });
    }

    if (!clusterArticlesData || clusterArticlesData.length === 0) {
      return new Response(JSON.stringify({ 
        data: [], 
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit),
          hasNext: false,
          hasPrev: page > 1
        },
        message: "No articles found" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 200,
      });
    }

    const results: StoryLineResponse[] = [];

    if (languageCode === "en") {
      // For English, use data directly from cluster_articles
      console.log(`Using English content for all ${clusterArticlesData.length} articles`);
      for (const article of clusterArticlesData) {
        results.push({
          headline: article.headline,
          image_url: article.image_url,
          cluster_id: article.cluster_id,
        });
      }
    } else {
      // For other languages, batch fetch all translations
      console.log(`Fetching international content for ${clusterArticlesData.length} articles, language ${languageCode}`);
      console.log(`Article IDs to look up:`, clusterArticlesData.map((article: ClusterArticle) => article.id));
      
      const articleIds = clusterArticlesData.map((article: ClusterArticle) => article.id);
      
      const { data: intlDataArray, error: intlError } = await supabase
        .from("cluster_article_int")
        .select("cluster_article_id, headline")
        .in("cluster_article_id", articleIds)
        .eq("language_code", languageCode)
        .returns<ClusterArticleInt[]>();

      console.log(`Translation query result:`, { 
        hasError: !!intlError, 
        errorMessage: intlError?.message,
        hasData: !!intlDataArray,
        dataCount: intlDataArray?.length || 0,
        rawData: intlDataArray
      });

      if (intlError) {
        console.error(`Error fetching batch international data for language ${languageCode}:`, intlError.message);
        // If there's a database error, fall back to English for all articles
        for (const article of clusterArticlesData) {
          console.log(`Database error fallback for article ${article.id}`);
          results.push({
            headline: article.headline,
            image_url: article.image_url,
            cluster_id: article.cluster_id,
          });
        }
      } else {
        // Create a map of article_id -> translation for quick lookup
        const translationMap = new Map<string, ClusterArticleInt>();
        if (intlDataArray) {
          intlDataArray.forEach((translation: ClusterArticleInt) => {
            console.log(`Adding translation for article ${translation.cluster_article_id}:`, {
              headline: translation.headline
            });
            translationMap.set(translation.cluster_article_id, translation);
          });
        }

        console.log(`Found ${translationMap.size} translations out of ${clusterArticlesData.length} articles`);

        // Process each article with its translation if available
        for (const article of clusterArticlesData) {
          const translation = translationMap.get(article.id);
          
          console.log(`Processing article ${article.id}:`, {
            hasTranslation: !!translation,
            translationHeadline: translation?.headline,
            originalHeadline: article.headline
          });
          
          if (translation && translation.headline) {
            // Use international data if headline exists
            console.log(`Using international headline for article ${article.id}`);
            results.push({
              headline: translation.headline,
              image_url: article.image_url, // Image URL comes from main table
              cluster_id: article.cluster_id,
            });
          } else {
            // No translation found or translation is completely empty, use English data as fallback
            console.log(`No international content found for article ${article.id}, using English fallback`);
            results.push({
              headline: article.headline,
              image_url: article.image_url,
              cluster_id: article.cluster_id,
            });
          }
        }
      }
    }

    console.log(`Successfully processed ${results.length} articles for language ${languageCode}, page ${page}`);

    const totalPages = Math.ceil((count || 0) / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    return new Response(JSON.stringify({ 
      data: results,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext,
        hasPrev
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      status: 200,
    });

  } catch (error) {
    console.error("Main error handler in story_lines:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      status: 500,
    });
  }
});
