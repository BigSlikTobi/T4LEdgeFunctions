import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts";  // Your provided CORS code

// Status mapping for injuries
const status_mapping = {
  "I.L.": "Injury Reserve",
  "PUP": "Physically Unable to Perform",
  "NFI": "Non-Football Injury",
  "IR": "Injured Reserve",
  "Questionable": "Questionable",
  "Doubtful": "Doubtful",
  "Out": "Out",
  "Probable": "Probable",
  "Sidelined": "Sideline"
};

// Define Player type
interface Player {
  playerId: string;
  name: string;
  img_url: string;
}

// Interface for the injury table
interface InjuryRow {
  id: number;
  created_at: string;
  team: string;
  player: Player | null;
  date: string;
  status: keyof typeof status_mapping | string;
  description: string;
  version: number;
}

// Output structure interface
interface MappedInjury {
  id: number;
  created_at: string;
  teamId?: string;
  playerId?: string;
  date: string;
  status: string;
  description: string;
}

// Securely fetch keys from environment variables.
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    const corsResp = handleCors(req);
    return corsResp ?? new Response("", { status: 204, headers: corsHeaders });
  }

  // Parse query params
  const url = new URL(req.url);
  const team = url.searchParams.get("team");
  const cursor = url.searchParams.get("cursor"); // id of last item from previous page
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  // Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Build query with correct join syntax (use relationship name 'player' and correct foreign key)
  let query = supabase
    .from("Injuries")
    .select("id,created_at,team,player,date,status,description,version,player(name,img_url)")
    .order("id", { ascending: true })
    .limit(limit);

  if (team) {
    query = query.eq("team", team);
  }
  if (cursor) {
    query = query.gt("id", cursor);
  }

  // Fetch data
  const { data, error } = await query;
  console.log("Supabase query error:", error);
  console.log("Supabase data shape:", JSON.stringify(data));

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "content-type": "application/json; charset=utf-8"
      }
    });
  }

  // Map injuries to output structure
  const mapped = (Array.isArray(data) ? data : []).map((injury) => {
    const playerObj = injury.player;
    return {
      id: injury.id,
      created_at: injury.created_at,
      teamId: injury.team,
      playerId: playerObj?.id,
      playerName: playerObj?.name,
      playerImgUrl: playerObj?.img_url,
      date: injury.date,
      status: status_mapping[injury.status as keyof typeof status_mapping] || injury.status,
      description: injury.description
    };
  });
  console.log("Mapped output:", JSON.stringify(mapped));

  // Find next cursor
  const nextCursor = mapped.length > 0 ? mapped[mapped.length - 1].id : null;

  return new Response(JSON.stringify({
    injuries: mapped,
    nextCursor
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8"
    }
  });
});