# T4L Edge Functions

This repository contains a collection of [Supabase Edge Functions](https://supabase.com/docs/guides/functions) used by the **Tackle4Loss** application. Each function lives in `supabase/functions/<name>` and serves as a lightweight API endpoint for the front‑end. The code is written in TypeScript and executed using Deno in the Supabase runtime.

## Usage

Each folder inside `supabase/functions/` represents a single Edge function. Functions share a common CORS utility in `supabase/functions/cors.ts`. To deploy or run them locally, use the Supabase CLI.

Environment variables such as `SUPABASE_URL` and `SUPABASE_ANON_KEY` must be provided for the functions to access your database.

## Functions

Below is a short description of the available Edge functions:

- **NFL_news** – Returns paginated NFL news articles with optional team filtering.
- **articleDetail** – Fetches a full news article including content and metadata.
- **articlePreviews** – Provides headline and image previews for news articles.
- **articleTicker** – Delivers recent ticker entries for quick headlines.
- **articles** – Legacy endpoint combining detail and preview data (scheduled for removal).
- **clusterStories** – Retrieves stories grouped by cluster identifiers.
- **cluster_articles** – Lists articles belonging to clusters that are not cherry‑picked.
- **cluster_infos** – Provides detailed cluster information with related data.
- **cluster_summary_by_id** – Returns a summary view for a specific cluster.
- **cluster_timeline** – Supplies timeline items related to news clusters.
- **coach_view_by_id** – Fetches coach information by internal ID.
- **dynamic_view_by_id** – Delivers dynamic view data for a cluster with optional view type.
- **franchise_view_by_id** – Returns a franchise view for a given cluster.
- **injuries** – Lists player injuries, optionally filtered by team with pagination.
- **news-ticker** – Fetches ticker items from the last few days.
- **other_news** – Provides additional article previews not covered by the main feed.
- **player_view_by_id** – Retrieves player profile details by ID.
- **relatedArticles** – Given a source article ID, returns a list of related articles.
- **roster** – Lists roster information for a team.
- **schedule** – Returns game schedules for a given week.
- **schedule_by_team_id** – Fetches a team's schedule by its internal ID.
- **sendPushNotification** – Webhook that sends push notifications when articles are published.
- **standings** – Provides league standings with optional filters.
- **story_line_view_by_id** – Returns a specific story line entry by ID.
- **story_lines** – Lists all story lines for front‑end consumption.
- **story_lines_by_id** – Retrieves story line entries for a particular story ID.
- **teamArticles** – Returns news articles for a team with basic filtering.
- **team_view_by_id** – Fetches team profile information by ID.
- **teams** – Lists teams with conference and division data.
- **timeline_by_cluster_id** – Provides timeline entries for a specific cluster.

## Development

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and login.
2. Run `supabase functions serve <name>` inside the `supabase/functions` directory to test a function locally.
3. Deploy with `supabase functions deploy <name>`.

Each function exports a handler using `serve` (or `Deno.serve`) so they can run independently. Refer to the source code in each directory for specific query parameters and response formats.

