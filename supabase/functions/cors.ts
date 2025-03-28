// This file handles CORS for the Supabase function.
// It allows cross-origin requests from your Flutter app.‚
export const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // Change this to your Flutter app's URL if needed.
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  
  export function handleCors(req: Request): Response | null {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    return null;
  }
  