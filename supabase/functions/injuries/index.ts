import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts"; // Ensure this path is correct

// Define a more specific type for the player data fetched in the separate lookup
interface PlayerData {
    id: number | string | null;
    name: string | null;
    img_url: string | null; // Corresponds to img_url column in Player table
}

// Status mapping for injuries
const status_mapping: { [key: string]: string } = {
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

// Output structure interface for the final response
interface MappedInjury {
  id: number;
  created_at: string;
  teamId?: string;         // String abbreviation (e.g., "NYJ")
  playerName?: string | null;
  playerImgUrl?: string | null;
  date: string;             // Date of injury/update
  status: string;           // Mapped status (e.g., "Questionable")
  description: string;
}

// Environment variables fetched at startup
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || ""; // Use ANON key

// Validate essential environment variables on load
if (!supabaseUrl || !supabaseKey) {
    console.error("FATAL: Missing required environment variables at startup: SUPABASE_URL or SUPABASE_ANON_KEY");
    throw new Error("Server configuration error: Missing Supabase credentials.");
}

console.log("Injuries function (Alternative Fetch) initializing...");

// --- Main Request Handler ---
serve(async (req: Request) => {
  console.log(`Received request: ${req.method} ${req.url}`);

  // 1. Handle CORS preflight (OPTIONS) request
  const corsResp = handleCors(req);
  if (corsResp) {
    console.log("Responding to OPTIONS request.");
    return corsResp; // Return CORS headers and OK status
  }

  // 2. Check HTTP Method - Allow only GET
  if (req.method !== "GET") {
      console.warn(`Method Not Allowed: ${req.method}`);
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
  }

  try {
    // 3. Parse and Validate Query Parameters
    const url = new URL(req.url);
    const teamAbbreviationFilter = url.searchParams.get("team"); // Expecting string like "NYJ"
    const cursorParam = url.searchParams.get("cursor");         // Expecting integer ID as string
    const limitParam = url.searchParams.get("limit") || "20";     // Default limit

    const cursor = cursorParam ? parseInt(cursorParam, 10) : null;
    const limit = parseInt(limitParam, 10);

    // Validate limit parameter
    if (isNaN(limit) || limit < 1) {
        console.warn("Invalid limit parameter received:", limitParam);
        return new Response(JSON.stringify({ error: "Invalid limit parameter" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }
    // Validate cursor parameter if present
    if (cursor !== null && isNaN(cursor)) {
        console.warn("Invalid cursor parameter received:", cursorParam);
        return new Response(JSON.stringify({ error: "Invalid cursor parameter" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }
    // Validate required team parameter
    if (!teamAbbreviationFilter || teamAbbreviationFilter.trim() === "") {
       console.warn("Missing required 'team' parameter.");
       return new Response(JSON.stringify({ error: "Missing required team parameter (abbreviation)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }

    console.log(`Parsed params: team='${teamAbbreviationFilter}', cursor=${cursor}, limit=${limit}`);

    // 4. Create Supabase Client (using ANON key)
    const supabase = createClient(supabaseUrl, supabaseKey, {
       auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log("Supabase client created.");

    // 5. Convert team abbreviation (e.g., "NYJ") to integer ID (e.g., 27)
    console.log(`Looking up integer ID for team abbreviation: ${teamAbbreviationFilter}`);
    // IMPORTANT: Adjust table/column names if different in your DB schema:
    const { data: teamIdData, error: teamIdError } = await supabase
        .from("Teams")                  // Your Teams table name
        .select("id")                   // The integer Primary Key column
        .eq("teamId", teamAbbreviationFilter) // The string abbreviation column (e.g., 'NYJ')
        .single();                      // Expect exactly one result

    // Handle errors during team ID lookup
    if (teamIdError) {
        console.error(`Error finding integer ID for team ${teamAbbreviationFilter}:`, teamIdError);
        if (teamIdError.code === 'PGRST116') { // Specific code for "Not Found"
             console.warn(`Team abbreviation not found: ${teamAbbreviationFilter}`);
             return new Response(JSON.stringify({ error: `Invalid team abbreviation provided: ${teamAbbreviationFilter}` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
        }
        // Throw other database errors
        throw teamIdError;
    }
    // Handle case where query succeeded but no data was returned
    if (!teamIdData?.id) {
         console.warn(`Integer ID not found for team abbreviation (RLS issue?): ${teamAbbreviationFilter}`);
         return new Response(JSON.stringify({ error: `Team abbreviation not found or inaccessible: ${teamAbbreviationFilter}` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }
    // Store the successfully found integer ID
    const teamIntegerIdFilter = teamIdData.id;
    console.log(`Found integer ID ${teamIntegerIdFilter} for team ${teamAbbreviationFilter}`);

    // 6. Build and execute query for Injuries data - Selecting FK
    console.log(`Querying Injuries for teamId (int): ${teamIntegerIdFilter}, cursor: ${cursor}, limit: ${limit}`);
    // IMPORTANT: Ensure 'Injuries' table name and 'player' FK column name are correct
    let query = supabase
      .from("Injuries")
      .select(`
         id, created_at, team, date, status, description, version,
         player_fk: player
       `) // Select the FK column, aliasing it
      .eq("team", teamIntegerIdFilter)   // Filter by the integer team ID
      .order("id", { ascending: true }) // Order by ID for cursor pagination
      .limit(limit);

    if (cursor) {
      query = query.gt("id", cursor); // Apply cursor based on ID
    }

    const { data: injuriesData, error: injuriesError } = await query;

    if (injuriesError) {
       console.error("Error fetching injuries data:", injuriesError);
       throw new Error(`Database error fetching injuries: ${injuriesError.message}`);
    }
     console.log(`Fetched ${injuriesData?.length ?? 0} injury records initially.`);

    // 7. Map injuries to output structure - Perform separate player lookup for each injury
    console.log(`Mapping ${injuriesData?.length ?? 0} injury records...`);
    const mapped: MappedInjury[] = await Promise.all((Array.isArray(injuriesData) ? injuriesData : []).map(async (injury) => {

        // --- Separate lookup for player data with enhanced logging ---
        let playerObject: PlayerData | null = null;
        const playerId = injury.player_fk; // Get the Player ID from the alias used in select

        // Check if the FK exists before attempting lookup
        if (playerId !== null && playerId !== undefined) {
             console.log(`Injury ID ${injury.id}: Looking up player data for Player FK ID: ${playerId}`);
             // IMPORTANT: Ensure 'Player' is correct table name and 'id', 'name', 'img_url' are correct column names
             const { data: playerData, error: playerError } = await supabase
                .from("Player") // Use your actual Player table name
                .select("id, name, img_url") // Select the required fields
                .eq("id", playerId)         // Filter by 'id' (ensure this is PK in Player)
                .maybeSingle();             // Use maybeSingle for safety

             if (playerError) {
                 // Log the specific error but continue processing other injuries
                 console.error(`---> Error fetching player ${playerId} for injury ${injury.id}: Code: ${playerError.code}, Msg: ${playerError.message}, Details: ${playerError.details}, Hint: ${playerError.hint}`);
             } else if (playerData) {
                  // Player data found successfully
                  console.log(`---> Found player data for ${playerId}: Name=${playerData.name}`);
                  playerObject = playerData as PlayerData | null; // Assign the result
             } else {
                  // Query succeeded but returned no data (player ID doesn't exist or RLS blocks)
                  console.warn(`---> No player data returned for Player ID ${playerId} (Injury ID ${injury.id}). Might be RLS or non-existent player.`);
             }
        } else {
            // Log if the foreign key column itself was null in the Injuries table
            console.log(`---> No player ID (FK was null) for injury ${injury.id}`);
        }
        // --- End separate lookup ---

        // Use the original string abbreviation for the response's teamId field
        const responseTeamId = teamAbbreviationFilter;

        // Construct the final mapped object for the response
        return {
            id: injury.id,
            created_at: injury.created_at,
            teamId: responseTeamId,
            // Safely access properties from the potentially null playerObject
            playerName: playerObject?.name ?? null,
            playerImgUrl: playerObject?.img_url ?? null,
            date: injury.date, // Keep original date string from DB
            // Use status mapping, provide fallbacks
            status: status_mapping[injury.status as keyof typeof status_mapping] || injury.status || 'Unknown',
            description: injury.description
        };
    }));
    // console.log("Mapped output:", JSON.stringify(mapped)); // Can be verbose

    // 8. Determine the next cursor for pagination
    // Use the 'id' of the last item fetched in this batch
    const nextCursor = mapped.length > 0 ? mapped[mapped.length - 1].id : null;
    console.log(`Finished mapping. Next cursor: ${nextCursor}`);

    // 9. Return the successful response including injuries and next cursor
    console.log("Returning successful response.");
    return new Response(JSON.stringify({
      injuries: mapped,
      nextCursor: nextCursor // Client uses this for the next request's 'cursor' param
    }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" }
    });

  } catch (error) {
     // 10. Handle any unexpected errors during execution
     console.error("Error executing injuries function:", error);
     let clientErrorMessage = "An internal server error occurred.";
     let statusCode = 500;

     // Attempt to extract more specific error info
     if (typeof error === 'object' && error !== null) {
         const e = error as { code?: string; message?: string }; // Type assertion
         // Check for common errors like auth issues
         if (e.code === 'PGRST301' || e.message?.includes('JWT')) {
             clientErrorMessage = "Authorization error.";
             statusCode = 401;
         } else if (e.message) {
             // Include the error message if available
             clientErrorMessage = `Error: ${e.message}`;
         }
         // Add more specific checks based on error codes if needed
     }

     console.error(`Responding with error - Status: ${statusCode}, Message: ${clientErrorMessage}`);
     // Return a standardized error response
     return new Response(
       JSON.stringify({ error: clientErrorMessage }),
       { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
     );
  }
});