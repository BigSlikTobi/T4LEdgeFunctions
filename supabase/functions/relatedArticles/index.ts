// Import the Supabase client and your CORS helper functions
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from '../cors.ts';

// Define interfaces for stronger typing
interface ArticleResponse {
  SourceArticle: string;
  headlineGerman: string;
  headlineEnglish: string;
}

// Cache for storing recent results to avoid redundant queries
const CACHE_DURATION = 60 * 5 * 1000; // 5 minutes in milliseconds
interface CacheEntry {
  timestamp: number;
  data: ArticleResponse[];
}
const cache: Record<string, CacheEntry> = {};

// The main Edge Function handler
export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight requests
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  // Allow only POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    // Parse the JSON body to get the SourceArticles id
    const { sourceArticleId } = await req.json();
    if (!sourceArticleId) {
      return new Response(
        JSON.stringify({ error: 'sourceArticleId is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Check cache first
    const cacheKey = `relatedArticles-${sourceArticleId}`;
    if (cache[cacheKey] && (Date.now() - cache[cacheKey].timestamp) < CACHE_DURATION) {
      return new Response(JSON.stringify(cache[cacheKey].data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Securely load the Supabase URL and Service Role Key from environment variables
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: 'Supabase credentials not set' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Create an optimized Supabase client instance
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
      },
      db: {
        schema: 'public',
      },
      global: {
        fetch: fetch,
        headers: { 'Content-Type': 'application/json' },
      },
    });

    // Optimize by only querying the 'related' field and not the embedding data
    const { data: vectorData, error: vectorError } = await supabase
      .from('ArticleVector')
      .select('related')
      .eq('SourceArticle', sourceArticleId)
      .single();

    if (vectorError || !vectorData) {
      return new Response(
        JSON.stringify({ error: 'Error fetching related articles' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Extract the array of related SourceArticles ids
    const relatedIds: string[] = vectorData.related;

    // If there are no related ids, return an empty array
    if (!relatedIds || relatedIds.length === 0) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Limit the number of related articles to improve performance
    const limitedRelatedIds = relatedIds.slice(0, 5);

    // Query the NewsArticles table with optimized selection
    const { data: articles, error: articlesError } = await supabase
      .from('NewsArticles')
      .select('SourceArticle, headlineGerman, headlineEnglish')
      .in('SourceArticle', limitedRelatedIds);

    if (articlesError) {
      return new Response(
        JSON.stringify({ error: 'Error fetching news articles' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Type assertion for stronger typing
    const typedArticles = articles as ArticleResponse[];

    // Store in cache
    cache[cacheKey] = {
      timestamp: Date.now(),
      data: typedArticles
    };

    // Return the resulting articles as JSON with the necessary CORS headers
    return new Response(JSON.stringify(typedArticles), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (_error) {
    return new Response(
      JSON.stringify({ error: 'Invalid request format' }),
      { status: 400, headers: corsHeaders }
    );
  }
}
