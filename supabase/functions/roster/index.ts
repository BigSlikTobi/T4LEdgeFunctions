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

serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  try {
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
    const { data: versionData, error: versionError } = await supabaseClient
      .from("Rosters")
      .select("version")
      .not("status", "in", '("CUT","RET")')
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
        JSON.stringify({ data: [] }),
        { 
          status: 200, 
          headers: { ...corsHeaders, ...contentHeaders } 
        }
      );
    }

    // Log to validate version data
    console.log(`Highest version found: ${versionData[0].version}`);

    const highestVersion = versionData[0].version;

    // Step 2: Get all active roster entries with the highest version
    const { data: rostersData, error: rostersError } = await supabaseClient
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
      .not("status", "in", '("CUT","RET")');

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

    // Log to validate roster data
    console.log(`Found ${rostersData.length} players with version ${highestVersion}`);

    // Step 3: For each roster entry, get the team info
    const formattedData = await Promise.all(
      rostersData.map(async (player) => {
        // Get team info
        const { data: teamData, error: teamError } = await supabaseClient
          .from("Teams")
          .select("teamId")
          .eq("id", player.teamId)
          .single();

        if (teamError) {
          console.error(`Error fetching team for player ${player.id}:`, teamError);
        }

        // Format height: convert to feet and inches (e.g., 6'4")
        const heightInches = player.height ? parseInt(player.height) : 0;
        const feet = Math.floor(heightInches / 12);
        const inches = heightInches % 12;
        const formattedHeight = `${feet}'${inches}"`;

        // Format weight: add "lbs" suffix
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

    return new Response(
      JSON.stringify({ data: formattedData }),
      { 
        status: 200, 
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
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
