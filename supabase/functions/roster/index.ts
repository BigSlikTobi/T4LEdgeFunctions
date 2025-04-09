// functions/roster/index.ts
import { serve } from "https://deno.land/std@0.178.0/http/server.ts"; // Ensure version matches others
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleCors } from "../cors.ts"; // Assuming cors.ts is one level up

// --- Interfaces ---
// Interface for raw data fetched from the Rosters table
interface RosterRow {
  id: number;
  name: string | null;
  number: number | null;
  headshotURL: string | null;
  position: string | null;
  age: number | null;
  height: string | null; // Assuming height is stored as string like "73" (inches)
  weight: number | null;
  college: string | null;
  years_exp: number | null;
  teamId: number; // Foreign key to Teams table (assuming it's the integer ID)
  version: number;
  status: string | null;
  // Add other fields if needed by formatting logic
}

// Interface for the formatted player data returned in the response
interface FormattedRosterPlayer {
  teamId: string | null; // The actual team abbreviation (e.g., "DAL")
  name: string | null;
  number: number | null;
  headshotURL: string | null;
  position: string | null;
  age: number | null;
  height: string; // Formatted height (e.g., "6'1\"")
  weight: string; // Formatted weight (e.g., "220 lbs")
  college: string | null;
  years_exp: number | null;
}

// Interface for the pagination metadata
interface PaginationInfo {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Interface for the final response structure
interface PaginatedRosterResponse {
  data: FormattedRosterPlayer[];
  pagination: PaginationInfo;
}

// --- Environment Variables & Constants ---
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""; // Use Anon Key for client init

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// --- Main Handler ---
serve(async (req: Request) => {
  // 1. Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) {
    return corsResponse;
  }

  // 2. Check HTTP Method
  if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
  }

  try {
    // 3. Parse and Validate Parameters
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    let pageSize = parseInt(url.searchParams.get('page_size') || String(DEFAULT_PAGE_SIZE), 10);
    const teamFilterIdParam = url.searchParams.get('teamId'); // Can be null
    const teamFilterId = teamFilterIdParam ? parseInt(teamFilterIdParam, 10) : null;

    if (isNaN(page) || page < 1) {
      return new Response(JSON.stringify({ error: "Invalid page parameter" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }
    if (teamFilterId !== null && isNaN(teamFilterId)) {
       return new Response(JSON.stringify({ error: "Invalid teamId parameter (must be integer)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }

    pageSize = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    // 4. Create Request-Scoped Supabase Client (Respects RLS)
    const supabaseClient = createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
            global: { headers: { Authorization: req.headers.get("Authorization")! } },
            auth: { autoRefreshToken: false, persistSession: false }
        }
    );

    // 5. Find Highest Roster Version (respecting RLS and team filter)
    let versionQuery = supabaseClient
      .from("Rosters")
      .select("version")
      // RLS Policy handles status filtering: NOT (status = ANY (ARRAY['CUT'::text, 'RET'::text]))
      ;

    if (teamFilterId !== null) {
      versionQuery = versionQuery.eq("teamId", teamFilterId); // Filter by integer team ID
    }

    const { data: versionData, error: versionError } = await versionQuery
      .order("version", { ascending: false })
      .limit(1);

    if (versionError) throw versionError;

    if (!versionData || versionData.length === 0) {
      // No matching roster data found (could be due to RLS or filters)
      const emptyPagination: PaginationInfo = { total: 0, page, pageSize, totalPages: 0 };
      const emptyResponse: PaginatedRosterResponse = { data: [], pagination: emptyPagination };
      return new Response(JSON.stringify(emptyResponse), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
    }

    const highestVersion = versionData[0].version;

    // 6. Get Total Count for Pagination (respecting RLS, version, and team filter)
    let countQuery = supabaseClient
      .from("Rosters")
      .select("*", { count: 'exact', head: true })
      .eq("version", highestVersion)
      // RLS Policy handles status filtering
      ;

    if (teamFilterId !== null) {
      countQuery = countQuery.eq("teamId", teamFilterId);
    }

    const { count: totalCountNullable, error: countError } = await countQuery;
    if (countError) throw countError;
    const totalCount = totalCountNullable ?? 0; // Handle null count

    // 7. Fetch Paginated Roster Data (respecting RLS, version, and team filter)
    let rostersQuery = supabaseClient
      .from("Rosters")
      .select(`
        id, name, number, headshotURL, position, age, height, weight, college, years_exp,
        teamId, version, status
      `) // Select fields needed, including teamId (FK)
      .eq("version", highestVersion)
      // RLS Policy handles status filtering
      .order('name') // Or by number, position etc.
      .range(offset, offset + pageSize - 1);

    if (teamFilterId !== null) {
      rostersQuery = rostersQuery.eq("teamId", teamFilterId);
    }

    const { data: rostersData, error: rostersError } = await rostersQuery;
    if (rostersError) throw rostersError;

    // Ensure rostersData is an array
    const validRostersData: RosterRow[] = rostersData || []; // Add type assertion

    // 8. Format Data (including fetching string teamId)
    const formattedData: FormattedRosterPlayer[] = await Promise.all(
      validRostersData.map(async (player: RosterRow) => { // Added type for player
        let teamAbbreviation: string | null = null;
        if (player.teamId) {
            // Fetch the string teamId (e.g., 'DAL') from the Teams table using the FK
            // This query also respects RLS policy on Teams table (public read allowed)
            const { data: teamData, error: teamError } = await supabaseClient
                .from("Teams")
                .select("teamId") // Select the string abbreviation column
                .eq("id", player.teamId) // Filter by the integer ID from Rosters
                .single(); // Expect only one team

            if (teamError) {
                console.error(`Error fetching team abbreviation for player ${player.id} (team FK: ${player.teamId}):`, teamError.message);
            } else if (teamData) {
                teamAbbreviation = teamData.teamId; // Assign the string abbreviation
            }
        }

        // Format height (e.g., "73" -> "6'1\"")
        let formattedHeight = "";
        if (player.height) {
          try {
            const heightInches = parseInt(player.height, 10);
            if (!isNaN(heightInches)) {
                const feet = Math.floor(heightInches / 12);
                const inches = heightInches % 12;
                formattedHeight = `${feet}'${inches}"`;
            }
          } catch (_e) { /* LINT FIX: ignore parsing error, indicated by _e */ }
        }

        // Format weight (e.g., 220 -> "220 lbs")
        const formattedWeight = player.weight ? `${player.weight} lbs` : "";

        return {
          teamId: teamAbbreviation, // Use the fetched string abbreviation
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

    // 9. Calculate Pagination Metadata
    const totalPages = Math.ceil(totalCount / pageSize);
    const paginationInfo: PaginationInfo = {
      total: totalCount,
      page,
      pageSize,
      totalPages
    };

    // 10. Construct Final Response
    const responsePayload: PaginatedRosterResponse = {
      data: formattedData,
      pagination: paginationInfo
    };

    return new Response(
      JSON.stringify(responsePayload),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );

  } catch (error) {
    // 11. Handle Errors
    console.error("Error executing roster function:", error);
    const _errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";

    // --- LINT FIX: Safer error property access ---
    let clientErrorMessage = "Failed to fetch roster data."; // Default message
    if (typeof error === 'object' && error !== null) {
        // Assert potentially expected properties, making them optional
        const potentialSupabaseError = error as { code?: string; message?: string };
        if (potentialSupabaseError.code === 'PGRST301' || potentialSupabaseError.message?.includes('JWT')) {
            clientErrorMessage = "Authorization error.";
        }
        // Add more specific checks based on potential errors if needed
    }
    // --- LINT FIX END ---

    return new Response(
      JSON.stringify({ error: clientErrorMessage }), // Use the determined message
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    );
  }
});