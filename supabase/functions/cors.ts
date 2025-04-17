// This file handles CORS for the Supabase function.
// It allows cross-origin requests from your Flutter app.‚
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // TODO: Change to your specific frontend domain for production
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS", // Ensure GET, POST, OPTIONS are present
  // --- UPDATE THIS LINE ---
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // --- END UPDATE ---
};

export function handleCors(req: Request): Response | null {
  // This function is correct - it returns the headers for OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // For non-OPTIONS, the main function handler needs to add these headers
  return null;
}
  