// Cluster Infos Edge Function
// Fetches cluster information with related data across multiple tables where cherry_pick is false
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

interface ClusterArticle {
  id: string; // uuid
  headline: string | null;
  summary: string | null;
  content: string | null;
  image_url: string | null;
  source_article_ids: number[] | null;
  created_at: string;
}

interface ClusterArticleInt {
  cluster_article_id: string; // User updated this field name
  language_code: string;
  headline: string | null;
  summary: string | null;
  content: string | null;
}

// Interface for the data structure returned by the Supabase query for SourceArticles
interface SourceArticleDetail {
  id: number; // This is SourceArticles.id
  source: { Name: string | null } | null; // Represents the related NewsSource record
  created_at: string; // Added for sorting and output
}

interface FormattedArticle {
  cluster_article_id: string; // User updated this field name
  created_at: string;
  english_headline: string | null;
  english_summary: string | null;
  english_content: string | null;
  image_url: string | null;
  sources: Array<{ name: string; created_at: string }>; // Changed from source_names: string[]
  // Allow any other string keys for dynamic language fields, including the new sources type
  [key: string]: string | string[] | null | number | undefined | Array<{ name: string; created_at: string }>; 
}

serve(async (req: Request): Promise<Response> => { // Ensure Promise<Response>
  if (req.method === "OPTIONS") {
    // handleCors should return a Response
    return handleCors(req) ?? new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor"); // ISO string for created_at
    const limitParam = url.searchParams.get("limit");
    const pageSize = limitParam ? parseInt(limitParam, 10) : 20;

    if (isNaN(pageSize) || pageSize <= 0 || pageSize > 100) {
      return new Response(JSON.stringify({ error: "Invalid limit parameter. Must be between 1 and 100." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 400,
      });
    }
    
    if (cursor && isNaN(new Date(cursor).getTime())) {
      return new Response(JSON.stringify({ error: "Invalid cursor parameter. Must be a valid ISO date string." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 400,
      });
    }

    // 1. First get clusters with cherry_pick = false
    const { data: nonCherryPickedClusters, error: clusterError } = await supabase
      .from("clusters")
      .select("cluster_id")
      .eq("cherry_pick", false);

    if (clusterError) {
      console.error("Error fetching clusters:", clusterError.message);
      return new Response(JSON.stringify({ error: "Failed to fetch non-cherry-picked clusters: " + clusterError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 500,
      });
    }

    if (!nonCherryPickedClusters || nonCherryPickedClusters.length === 0) {
      return new Response(JSON.stringify({ data: [], nextCursor: null, message: "No non-cherry-picked clusters found." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 200,
      });
    }

    const clusterIds = nonCherryPickedClusters.map((cluster: { cluster_id: string }) => cluster.cluster_id);

    // 2. Fetch cluster_articles for non-cherry-picked clusters (paginated)
    let clusterArticlesQuery = supabase
      .from("cluster_articles")
      .select("id, headline, summary, content, image_url, source_article_ids, created_at")
      .in("cluster_id", clusterIds)
      .order("created_at", { ascending: false })
      .limit(pageSize);

    if (cursor) {
      clusterArticlesQuery = clusterArticlesQuery.lt("created_at", cursor);
    }

    const { data: clusterArticlesData, error: clusterArticlesError } =
      await clusterArticlesQuery.returns<ClusterArticle[]>();

    if (clusterArticlesError) {
      console.error("Error fetching cluster_articles:", clusterArticlesError.message);
      return new Response(JSON.stringify({ error: "Failed to fetch cluster articles: " + clusterArticlesError.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 500,
      });
    }

    if (!clusterArticlesData || clusterArticlesData.length === 0) {
      return new Response(JSON.stringify({ data: [], nextCursor: null, message: "No more articles found." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        status: 200,
      });
    }

    const articleIds = clusterArticlesData.map((ca: ClusterArticle) => ca.id);
    const allSourceArticleIds = [
      ...new Set(clusterArticlesData.flatMap((ca: ClusterArticle) => ca.source_article_ids || [])),
    ];

    // 2. Fetch cluster_article_int data
    const intlDataMap = new Map<string, ClusterArticleInt[]>();
    if (articleIds.length > 0) {
      const { data: intlArticles, error: intlError } = await supabase
        .from("cluster_article_int")
        .select("cluster_article_id, language_code, headline, summary, content") // Ensured cluster_article_id is used
        .in("cluster_article_id", articleIds) // Ensured cluster_article_id is used
        .returns<ClusterArticleInt[]>();

      if (intlError) {
        console.warn("Warning fetching cluster_article_int:", intlError.message);
        // Non-critical, proceed without internationalized data if it fails
      }
      if (intlArticles) {
        intlArticles.forEach((intlArt: ClusterArticleInt) => {
          if (!intlDataMap.has(intlArt.cluster_article_id)) {
            intlDataMap.set(intlArt.cluster_article_id, []);
          }
          intlDataMap.get(intlArt.cluster_article_id)!.push(intlArt);
        });
      }
    }

    // 3. Fetch NewsSource names and created_at via SourceArticles
    const sourceInfoMap = new Map<number, { name: string | null; created_at: string | null }>();
    if (allSourceArticleIds.length > 0) {
      const { data: sourceArticlesDetails, error: sourcesError } = await supabase
        .from("SourceArticles") // Table name
        .select("id, created_at, source ( Name )") // Added created_at
        .in("id", allSourceArticleIds)
        .returns<SourceArticleDetail[]>();

      if (sourcesError) {
        console.warn("Warning fetching source articles/news sources:", sourcesError.message);
        // Non-critical, proceed without source names if it fails
      }

      if (sourceArticlesDetails) {
        sourceArticlesDetails.forEach((detail: SourceArticleDetail) => {
          sourceInfoMap.set(detail.id, { name: detail.source?.Name ?? null, created_at: detail.created_at });
        });
      }
    }
    
    // 4. Combine and structure the data
    const formattedArticles: FormattedArticle[] = clusterArticlesData.map((ca: ClusterArticle) => {
      const result: FormattedArticle = {
        cluster_article_id: ca.id, // User updated this field name
        created_at: ca.created_at,
        english_headline: ca.headline,
        english_summary: ca.summary,
        english_content: ca.content,
        image_url: ca.image_url,
        sources: (ca.source_article_ids || [])
          .map((id: number) => sourceInfoMap.get(id))
          .filter((sourceInfo): sourceInfo is { name: string; created_at: string } => 
            sourceInfo !== undefined && sourceInfo.name !== null && sourceInfo.created_at !== null
          )
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), // Sort by created_at descending
      };

      const intlVersions = intlDataMap.get(ca.id);
      if (intlVersions) {
        intlVersions.forEach((intl: ClusterArticleInt) => {
          result[`${intl.language_code}_headline`] = intl.headline;
          result[`${intl.language_code}_summary`] = intl.summary;
          result[`${intl.language_code}_content`] = intl.content;
        });
      }
      return result;
    });

    const nextCursor =
      clusterArticlesData.length === pageSize
        ? clusterArticlesData[clusterArticlesData.length - 1].created_at
        : null;

    return new Response(JSON.stringify({ data: formattedArticles, nextCursor }), {
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      status: 200,
    });

  } catch (error) {
    console.error("Main error handler in cluster_articles:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      status: 500,
    });
  }
});

