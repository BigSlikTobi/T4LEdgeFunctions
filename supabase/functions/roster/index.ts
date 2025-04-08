// index.ts
import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts"; 

console.log("Roster Edge Function Initialized");

// Add comprehensive UTF-8 headers
const contentHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Accept-Charset": "utf-8"
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
    // Parse pagination parameters and teamId from URL
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    let pageSize = parseInt(url.searchParams.get('page_size') || String(DEFAULT_PAGE_SIZE), 10);
    const teamId = url.searchParams.get('teamId'); // New parameter for team filtering
    
    // Validate pagination parameters
    if (isNaN(page) || page < 1) {
      return new Response(
        JSON.stringify({ error: "Invalid page parameter" }),
        { status: 400, headers: { ...corsHeaders, ...contentHeaders } }
      );
    }

    // Ensure page_size doesn't exceed maximum
    pageSize = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);

    // Calculate offset
    const offset = (page - 1) * pageSize;

    // Create a Supabase client with the Auth context
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Step 1: Find the highest version number from Rosters
    const versionQuery = supabaseClient
      .from("Rosters")
      .select("version")
      .not("status", "in", '("CUT","RET")');
    
    // Add team filter if provided
    if (teamId) {
      versionQuery.eq("teamId", teamId);
    }

    const { data: versionData, error: versionError } = await versionQuery
      .order("version", { ascending: false })
      .limit(1);

    if (versionError) {
      console.error("Error fetching version:", versionError);
      return new Response(
        JSON.stringify({ error: "Error fetching version data" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, ...contentHeaders } 
        }
      );
    }

    if (!versionData || versionData.length === 0) {
      return new Response(
        JSON.stringify({ data: [], pagination: { total: 0, page, pageSize, totalPages: 0 } }),
        { 
          status: 200, 
          headers: { ...corsHeaders, ...contentHeaders } 
        }
      );
    }

    const highestVersion = versionData[0].version;

    // Get total count with team filter if provided
    const countQuery = supabaseClient
      .from("Rosters")
      .select("*", { count: 'exact', head: true })
      .eq("version", highestVersion)
      .not("status", "in", '("CUT","RET")');

    if (teamId) {
      countQuery.eq("teamId", teamId);
    }

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error("Error getting total count:", countError);
      return new Response(
        JSON.stringify({ error: "Error calculating pagination" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, ...contentHeaders } 
        }
      );
    }

    // Step 2: Get paginated roster entries with the highest version and team filter
    const rostersQuery = supabaseClient
      .from("Rosters")
      .select(`
        id,
        name,
        number,
        headshotURL,
        position,
        age,
        height,
        weight,
        college,
        years_exp,
        teamId
      `)
      .eq("version", highestVersion)
      .not("status", "in", '("CUT","RET")')
      .order('name')
      .range(offset, offset + pageSize - 1);
    if (teamId) {
      rostersQuery.eq("teamId", teamId);
    }

    const { data: rostersData, error: rostersError } = await rostersQuery;

    if (rostersError) {
      console.error("Error fetching roster data:", rostersError);
      return new Response(
        JSON.stringify({ error: "Error fetching roster data" }),
        { 
          status: 500, 
          headers: { ...corsHeaders, ...contentHeaders } 
        }
      );
    }

    // Step 3: Process roster entries as before
    const formattedData = await Promise.all(
      rostersData.map(async (player) => {
        const { data: teamData, error: teamError } = await supabaseClient
          .from("Teams")
          .select("teamId")
          .eq("id", player.teamId)
          .single();

        if (teamError) {
          console.error(`Error fetching team for player ${player.id}:`, teamError);
        }

        const heightInches = player.height ? parseInt(player.height) : 0;
        const feet = Math.floor(heightInches / 12);
        const inches = heightInches % 12;
        const formattedHeight = `${feet}'${inches}"`;

        const formattedWeight = player.weight ? `${player.weight} lbs` : "";

        return {
          teamId: teamData?.teamId || null,
          name: player.name,
          number: player.number,
          headshotURL: player.headshotURL,
          position: player.position,
          age: player.age,
          height: formattedHeight,
          weight: formattedWeight,
          college: player.college,
          years_exp: player.years_exp
        };
      })
    );

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount! / pageSize);

    return new Response(
      JSON.stringify({
        data: formattedData,
        pagination: {
          total: totalCount,
          page,
          pageSize,
          totalPages
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, ...contentHeaders }
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { 
        status: 500, 
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }
});

/* To invoke locally:
  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:
  curl -i --location --request GET 'http://127.0.0.1:54321/functions/v1/roster' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
*/
