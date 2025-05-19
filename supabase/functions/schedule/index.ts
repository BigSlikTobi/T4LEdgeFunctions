import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts"; // Corrected path

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCors(req);
  }

  // Log: Start request
  console.log("Received request for schedule");

  // Parse week from query params
  const url = new URL(req.url);
  const week = url.searchParams.get("week");
  console.log("Requested week:", week);

  if (!week) {
    return new Response(JSON.stringify({ error: "Missing 'week' parameter" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }

  // Supabase client setup
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  // Query Games with joined Teams for home and away
  const { data, error } = await supabase
    .from("Games")
    .select(`
      week,
      date,
      time,
      stadium,
      home_team:home_team ( id, teamId ),
      away_team:away_team ( id, teamId )
    `)
    .eq("week", week);

  // Log: Query result
  console.log("Query error:", error);
  console.log("Query data:", data);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  // Map to desired output
  const schedule = (data || []).map((game: any) => ({
    week: game.week,
    home_team_name: game.home_team?.teamId,
    home_team_id: game.home_team?.id,
    away_team_name: game.away_team?.teamId,
    away_team_id: game.away_team?.id,
    date: game.date,
    time: game.time,
    stadium: game.stadium,
  }));

  return new Response(JSON.stringify(schedule), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});

