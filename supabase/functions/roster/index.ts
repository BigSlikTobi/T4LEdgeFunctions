import { serve } from "https://deno.land/std@0.178.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts"; // Corrected path

// --- Interfaces ---
// Interface for raw data fetched from the Rosters table (remains same)
interface RosterRow {
  id: number; name: string | null; number: number | null; headshotURL: string | null; position: string | null; age: number | null; height: string | null; weight: number | null; college: string | null; years_exp: number | null; teamId: number; version: number; status: string | null;
}
// Interface for the formatted player data (remains same)
interface FormattedRosterPlayer {
  teamId: string | null; name: string | null; number: number | null; headshotURL: string | null; position: string | null; age: number | null; height: string; weight: string; college: string | null; years_exp: number | null;
}
// --- REMOVED Pagination Interfaces ---
// interface PaginationInfo { /* ... */ }
// interface PaginatedRosterResponse { /* ... */ }

// --- Environment Variables (keep as before) ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("FATAL: Missing required environment variables at startup: SUPABASE_URL or SUPABASE_ANON_KEY");
    throw new Error("Server configuration error: Missing Supabase credentials.");
}
// --- REMOVED PAGE_SIZE Constants ---

console.log("Roster function (fetch all) initializing...");

// --- Main Handler ---
serve(async (req: Request) => {
  console.log(`Received request: ${req.method} ${req.url}`);

  // 1. Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) {
    console.log("Responding to OPTIONS request.");
    return corsResponse;
  }

  // 2. Check HTTP Method
  if (req.method !== "GET") {
      console.warn(`Method Not Allowed: ${req.method}`);
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
  }

  try {
    // 3. Parse and Validate Parameters (Only teamId)
    const url = new URL(req.url);
    const teamAbbreviationFilter = url.searchParams.get('teamId'); // Gets "MIA", "DAL", or null

    // --- REMOVED Page/PageSize parsing and validation ---

    // 4. Create Supabase Client
    const supabaseClient = createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );
    console.log("Supabase client created.");

    // 5. Convert team abbreviation to integer ID (required for filtering Rosters)
    let teamIntegerIdFilter: number | null = null;
    if (teamAbbreviationFilter) {
        console.log(`Looking up integer ID for team abbreviation: ${teamAbbreviationFilter}`);
        const { data: teamIdData, error: teamIdError } = await supabaseClient
            .from("Teams").select("id").eq("teamId", teamAbbreviationFilter).single();

        if (teamIdError) { /* ... error handling as before ... */
            console.error(`Error finding integer ID for team ${teamAbbreviationFilter}:`, teamIdError);
            if (teamIdError.code === 'PGRST116') { return new Response(JSON.stringify({ error: `Invalid team abbreviation provided: ${teamAbbreviationFilter}` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }); }
            throw teamIdError;
        }
        if (!teamIdData?.id) { return new Response(JSON.stringify({ error: `Team abbreviation not found: ${teamAbbreviationFilter}` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }); }
        teamIntegerIdFilter = teamIdData.id;
        console.log(`Found integer ID ${teamIntegerIdFilter} for team ${teamAbbreviationFilter}`);
    } else {
        // Handle case where no teamId is provided - return error or all rosters?
        // For now, let's return an error if no teamId is given for the roster.
        console.warn("No teamId parameter provided in the request.");
        return new Response(JSON.stringify({ error: "Missing required teamId parameter" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }

    // 6. Find Highest Roster Version (for the specific team)
    console.log(`Finding highest roster version for teamId: ${teamIntegerIdFilter}`);
    // We MUST filter by teamIntegerIdFilter here, otherwise we get the global highest version
    const { data: versionData, error: versionError } = await supabaseClient
      .from("Rosters")
      .select("version")
      .eq("teamId", teamIntegerIdFilter) // Filter by INTEGER team ID FK
      .order("version", { ascending: false }).limit(1);

    if (versionError) { /* ... error handling ... */ throw versionError; }

    if (!versionData || versionData.length === 0) {
      console.log(`No roster versions found for teamId: ${teamIntegerIdFilter}. Returning empty.`);
      // --- Return empty data array directly ---
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }
    const highestVersion = versionData[0].version;
    console.log(`Highest roster version found: ${highestVersion}`);

    // --- REMOVED Count Query ---

    // 7. Fetch ALL Roster Data for the team and version
    console.log(`Fetching ALL roster data for version ${highestVersion}, teamId: ${teamIntegerIdFilter}`);
    const { data: rostersData, error: rostersError } = await supabaseClient
      .from("Rosters")
      .select(`id, name, number, headshotURL, position, age, height, weight, college, years_exp, teamId, version, status`)
      .eq("version", highestVersion)
      .eq("teamId", teamIntegerIdFilter) // Filter by INTEGER team ID FK
      .order('name'); // Keep sorting if desired
      // --- REMOVED .range() ---

    if (rostersError) { /* ... error handling ... */ throw rostersError; }
    const validRostersData: RosterRow[] = rostersData || [];
    console.log(`Fetched ${validRostersData.length} players total.`);

    // 8. Format Data (remains mostly the same)
    console.log("Formatting player data...");
    const formattedData: FormattedRosterPlayer[] = await Promise.all(
        validRostersData.map(async (player: RosterRow) => {
            // Fetching abbreviation logic remains correct
            let teamAbbreviationResponse: string | null = teamAbbreviationFilter; // Can assume it matches filter
            // Optional: Could skip the lookup below if abbreviation is passed and trusted
            // ... (lookup logic can stay or be removed for minor optimization) ...
             if (!teamAbbreviationResponse && player.teamId) { // Fallback lookup if needed
                 const { data: teamData, error: teamError } = await supabaseClient.from("Teams").select("teamId").eq("id", player.teamId).maybeSingle();
                 if (!teamError && teamData) { teamAbbreviationResponse = teamData.teamId; }
             }

            // ... height/weight formatting ...
            let formattedHeight = ""; /* ... as before ... */
            if (player.height) { try { const h = parseInt(player.height, 10); if (!isNaN(h) && h > 0) { const f = Math.floor(h / 12); const i = h % 12; formattedHeight = `${f}'${i}"`; } else { formattedHeight = player.height; } } catch (_e) { formattedHeight = player.height; } }
            const formattedWeight = (player.weight && player.weight > 0) ? `${player.weight} lbs` : "";

            return {
              teamId: teamAbbreviationResponse,
              name: player.name, number: player.number, headshotURL: player.headshotURL, position: player.position, age: player.age, height: formattedHeight, weight: formattedWeight, college: player.college, years_exp: player.years_exp
            };
        })
    );
    console.log("Finished formatting player data.");

    // --- REMOVED Pagination Calculation ---

    // 9. Construct Final Response (Simpler structure)
    // --- Return only the data array ---
    const responsePayload = { data: formattedData };

    console.log("Returning successful response with all players.");
    return new Response(
      JSON.stringify(responsePayload), // Send { data: [...] }
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );

  } catch (error) {
    // 10. Handle Errors (remains same)
    console.error("Error executing roster function:", error);
    let clientErrorMessage = "An internal server error occurred."; /* ... error handling ... */
    let statusCode = 500; /* ... error handling ... */
     if (typeof error === 'object' && error !== null) { const e = error as { code?: string; message?: string }; if (e.code === 'PGRST301' || e.message?.includes('JWT')) { clientErrorMessage = "Authorization error."; statusCode = 401; } else if (e.message) { clientErrorMessage = `Database Error: ${e.message}`; } }
    console.error(`Responding with error - Status: ${statusCode}, Message: ${clientErrorMessage}`);
    return new Response(
      JSON.stringify({ error: clientErrorMessage }),
      { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );
  }
});