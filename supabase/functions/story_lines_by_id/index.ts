import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req: Request): Promise<Response> => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const url = new URL(req.url);
    const clusterId = url.searchParams.get("cluster_id");
    const languageCode = url.searchParams.get("language_code");

    // Validate required parameters
    if (!clusterId) {
      return new Response(
        JSON.stringify({ error: "cluster_id parameter is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (!languageCode) {
      return new Response(
        JSON.stringify({ error: "language_code parameter is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`Fetching story detail for cluster_id: ${clusterId}, language_code: ${languageCode}`);

    // 1. Get cluster article
    const { data: article, error: articleError } = await supabase
      .from("cluster_articles")
      .select("id, headline, summary, content, image_url")
      .eq("cluster_id", clusterId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (articleError || !article) {
      return new Response(
        JSON.stringify({ error: "Article not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // 2. Get translation if not English
    let headline = article.headline;
    let summary = article.summary;
    let content = article.content;

    if (languageCode !== "en") {
      const { data: translation } = await supabase
        .from("cluster_article_int")
        .select("headline, summary, content")
        .eq("cluster_article_id", article.id)
        .eq("language_code", languageCode)
        .limit(1)
        .single();

      if (translation) {
        headline = translation.headline || headline;
        summary = translation.summary || summary;
        content = translation.content || content;
      }
    }

    // 3. Get story line views
    const { data: views } = await supabase
      .from("story_line_view")
      .select("id, view")
      .eq("cluster_id", clusterId);

    // Change from string array to array of objects with view and id
    const storyViews: { view: string; id: number }[] = [];

    if (views) {
      for (const view of views) {
        let viewContent = view.view;

        // Get translation for view if not English
        if (languageCode !== "en") {
          const { data: viewTranslation } = await supabase
            .from("story_line_view_int")
            .select("view")
            .eq("story_line_view_id", view.id)
            .eq("language_code", languageCode)
            .limit(1)
            .single();

          if (viewTranslation?.view) {
            viewContent = viewTranslation.view;
          }
        }

        // Push object with both view content and id
        storyViews.push({
          view: viewContent,
          id: view.id
        });
      }
    }

    // 4. Return response
    const response = {
      headline,
      summary,
      content,
      image_url: article.image_url,
      views: storyViews,
    };

    return new Response(
      JSON.stringify({ data: response }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in story_detail:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
