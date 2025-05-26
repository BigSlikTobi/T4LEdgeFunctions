import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// Define interfaces for the story line view data
interface StoryLineView {
  id: number;
  headline: string | null;
  introduction: string | null;
  content: string | null;
}

interface StoryLineViewInt {
  story_line_view_id: number;
  language_code: string;
  headline: string | null;
  introduction: string | null;
  content: string | null;
}

interface StoryLineViewResponse {
  headline: string | null;
  introduction: string | null;
  content: string | null;
  language: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    // Create Supabase client
    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    // Parse request parameters from URL
    const url = new URL(req.url);
    const storyLineViewId = url.searchParams.get("story_line_view_id");
    const languageCode = url.searchParams.get("language_code") || "en"; // Default to English if not specified

    // Validate required parameters
    if (!storyLineViewId) {
      return new Response(
        JSON.stringify({ error: "story_line_view_id parameter is required" }), 
        { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }, status: 400 }
      );
    }

    console.log(`Fetching story line view for id: ${storyLineViewId}, language_code: ${languageCode}`);
    
    // Initialize response object
    let response: StoryLineViewResponse = {
      headline: null,
      introduction: null,
      content: null,
      language: languageCode
    };

    // Query based on language code
    if (languageCode === "en") {
      // For English, fetch directly from story_line_view table
      const { data: viewData, error: viewError } = await supabase
        .from("story_line_view")
        .select("headline, introduction, content")
        .eq("id", storyLineViewId)
        .single();

      if (viewError) {
        console.error("Error fetching English story line view:", viewError);
        return new Response(
          JSON.stringify({ error: "Story line view not found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }, status: 404 }
        );
      }

      if (viewData) {
        response = {
          headline: viewData.headline,
          introduction: viewData.introduction,
          content: viewData.content,
          language: "en"
        };
      }
    } else {
      // For other languages, fetch from story_line_view_int table
      const { data: intViewData, error: intViewError } = await supabase
        .from("story_line_view_int")
        .select("headline, introduction, content")
        .eq("story_line_view_id", storyLineViewId)
        .eq("language_code", languageCode)
        .single();

      if (intViewError) {
        console.error(`Error fetching ${languageCode} story line view:`, intViewError);
        
        // If translation not found, fall back to English
        console.log(`Translation not found for language ${languageCode}, falling back to English`);
        
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("story_line_view")
          .select("headline, introduction, content")
          .eq("id", storyLineViewId)
          .single();

        if (fallbackError) {
          console.error("Error fetching English fallback for story line view:", fallbackError);
          return new Response(
            JSON.stringify({ error: "Story line view not found" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }, status: 404 }
          );
        }

        if (fallbackData) {
          response = {
            headline: fallbackData.headline,
            introduction: fallbackData.introduction,
            content: fallbackData.content,
            language: "en" // Set language to English since we're using fallback
          };
        }
      } else if (intViewData) {
        response = {
          headline: intViewData.headline,
          introduction: intViewData.introduction,
          content: intViewData.content,
          language: languageCode
        };
      }
    }

    return new Response(
      JSON.stringify({ data: response }),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );

  } catch (error) {
    console.error("Error in story_line_view_by_id:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }, status: 500 }
    );
  }
});

