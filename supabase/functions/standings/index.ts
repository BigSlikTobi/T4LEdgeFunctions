import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, handleCors } from '../cors.ts' // Adjusted path if needed

interface Team {
  team_id: number // This is the integer ID from your "Teams" table
  team_name: string // e.g., "Kansas City Chiefs"
  team_abbreviation: string // e.g., "KC" - Assuming this is "teamId" in your "Teams" table
  conference: string // e.g., "AFC"
  division: string // e.g., "West"
}

interface StandingRecord {
  team_id: number // Integer foreign key to Teams.id
  season: number
  wins: number
  losses: number
  ties: number
  points_for: number
  points_against: number
  conference_wins: number
  conference_losses: number
  conference_ties: number
  division_wins: number
  division_losses: number
  division_ties: number
  win_percentage: number
  // Joined data from Teams table for convenience
  team_name?: string
  team_abbreviation?: string // This would be your 'teamId' (like 'KC') column from the "Teams" table
  conference?: string
  division?: string
  // Ranks (optional, for more advanced sorting)
  conference_rank?: number
  division_rank?: number
  overall_rank?: number
}

// Helper to create Supabase client
function getSupabaseClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '', // Use anon key for client-facing functions
    // It's good practice to pass the Authorization header from the original request
    // if you want to enforce user-specific RLS policies, though for public standings, anon key is fine.
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  )
}

serve(async (req: Request) => {
  // Handle CORS preflight request
  const corsResponse = handleCors(req)
  if (corsResponse) {
    return corsResponse
  }

  const url = new URL(req.url)
  const type = url.searchParams.get('type')?.toLowerCase() || 'overall' // 'overall', 'conference', 'division'
  const seasonParam = url.searchParams.get('season')
  const conferenceParam = url.searchParams.get('conference')?.toUpperCase() // 'AFC', 'NFC'
  const divisionParam = url.searchParams.get('division') // 'North', 'South', 'East', 'West' (case-insensitive handling later)

  // Determine season (e.g., default to current year or a specific one if not provided)
  // For now, let's assume the Python script populates for a known season like 2024.
  // You might want a more dynamic way to get the "current" season in the future.
  const season = seasonParam ? parseInt(seasonParam) : 2024 // Default to 2024 if not specified

  if (isNaN(season)) {
    return new Response(JSON.stringify({ error: 'Invalid season parameter' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }

  console.log(`Request Params: type=${type}, season=${season}, conference=${conferenceParam}, division=${divisionParam}`)


  try {
    const supabase = getSupabaseClient(req)
    let standingsData: StandingRecord[] = []

    // Fetch all teams first to easily join details later and for filtering if needed
    // IMPORTANT: Adjust "teamId" to your actual column name for abbreviations in the "Teams" table.
    const { data: teamsData, error: teamsError } = await supabase
      .from('Teams') // Use the exact name of your Teams table (case-sensitive if quoted during creation)
      .select('id, fullName, teamId, conference, division') // Assuming 'name', 'teamId' (for abbr), 'conference', 'division' exist

    if (teamsError) {
      console.error('Error fetching teams:', teamsError)
      throw teamsError
    }
    if (!teamsData || teamsData.length === 0) {
      return new Response(JSON.stringify({ error: 'No teams data found in "Teams" table.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }
    
    const teamsMap = new Map<number, Team>()
    teamsData.forEach((team: { id: number; fullName: string; teamId: string; conference: string; division: string }) => {
      teamsMap.set(team.id, {
        team_id: team.id,
        team_name: team.fullName,
        team_abbreviation: team.teamId, // Uses "teamId" as the abbreviation
        conference: team.conference,
        division: team.division,
      })
    })
    console.log(`Fetched ${teamsMap.size} teams from "Teams" table.`)


    // Base query for standings
    // The 'team_id' in standings table is the integer FK to Teams.id
    const query = supabase
      .from('standings')
      .select('*') // Select all columns from standings table
      .eq('season', season)
      // Primary sort: Win Percentage (desc), then Points For (desc) as a simple tie-breaker
      // More complex NFL tie-breakers would require more logic or pre-calculated fields.
      .order('win_percentage', { ascending: false })
      .order('points_for', { ascending: false })


    const { data: rawStandings, error: standingsError } = await query

    if (standingsError) {
      console.error('Error fetching standings:', standingsError)
      throw standingsError
    }

    if (!rawStandings || rawStandings.length === 0) {
      return new Response(JSON.stringify({ error: `No standings data found for season ${season}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }
    console.log(`Fetched ${rawStandings.length} raw standings records for season ${season}.`)

    // Join team details with standings records and apply filters
    let processedStandings: StandingRecord[] = rawStandings.map((s: StandingRecord) => {
      const teamDetail = teamsMap.get(s.team_id) // s.team_id is the integer ID
      return {
        ...s,
        team_name: teamDetail?.team_name || 'Unknown Team',
        team_abbreviation: teamDetail?.team_abbreviation || 'N/A', // Abbreviation from "Teams" table
        conference: teamDetail?.conference || 'N/A',
        division: teamDetail?.division || 'N/A',
      }
    })

    // Apply filters based on 'type'
    if (type === 'conference' && conferenceParam) {
      processedStandings = processedStandings.filter(
        (s) => s.conference === conferenceParam
      )
    } else if (type === 'division' && conferenceParam && divisionParam) {
      // Ensure divisionParam matches case-insensitively or how it's stored
      const divisionLower = divisionParam.toLowerCase()
      processedStandings = processedStandings.filter(
        (s) =>
          s.conference === conferenceParam &&
          s.division?.toLowerCase() === divisionLower
      )
    } else if (type !== 'overall') {
      // If type is specified but not 'overall' and params are missing for it
      if ((type === 'conference' && !conferenceParam) || (type === 'division' && (!conferenceParam || !divisionParam))) {
        return new Response(JSON.stringify({ error: `Missing parameters for standings type '${type}'` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        })
      }
    }
    
    // For 'overall', no further filtering is needed after fetching all for the season.
    standingsData = processedStandings

    console.log(`Returning ${standingsData.length} standings records after filtering for type: ${type}.`)

    return new Response(JSON.stringify(standingsData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Error in Edge Function:', error)
    let errorMessage = 'Internal server error'
    if (error instanceof Error && typeof error.message === 'string') {
      errorMessage = error.message
    }
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})