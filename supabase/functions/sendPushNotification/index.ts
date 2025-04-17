import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'; // Or a newer stable version
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.43.1'; // Use specific version
import { corsHeaders } from '../cors.ts'; // Assuming you have CORS setup
import { SignJWT } from "https://esm.sh/jose@5.2.3"; // Use specific version for JWT signing

// --- Environment Variables ---
// Required: Set these in your Supabase project secrets
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID");
const FCM_SERVICE_ACCOUNT_KEY_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_KEY_JSON");
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY'); // Needs SELECT on device_tokens

// --- Constants ---
const FCM_API_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

// --- Helper: Convert PEM Key to ArrayBuffer for Web Crypto API ---
function _pemToBinary(pem: string): ArrayBuffer {
    const base64 = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, "")
        .replace(/-----END PRIVATE KEY-----/, "")
        .replace(/\s/g, ""); // Remove header/footer and whitespace
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// --- Helper: Get Google OAuth2 Access Token for FCM API ---
async function getAccessToken(): Promise<string> {
    console.log("Attempting to get FCM access token...");
    if (!FCM_SERVICE_ACCOUNT_KEY_JSON) {
      console.error("FCM_SERVICE_ACCOUNT_KEY_JSON environment variable not set.");
      throw new Error("FCM_SERVICE_ACCOUNT_KEY_JSON environment variable not set.");
    }
    if (!FIREBASE_PROJECT_ID) {
        console.error("FIREBASE_PROJECT_ID environment variable not set.");
        throw new Error("FIREBASE_PROJECT_ID environment variable not set.");
    }

    try {
      const keyData = JSON.parse(FCM_SERVICE_ACCOUNT_KEY_JSON);
      const serviceAccountEmail = keyData.client_email;
      const privateKeyPem = keyData.private_key;

      if (!serviceAccountEmail || !privateKeyPem) {
        throw new Error("Invalid service account key format: missing client_email or private_key.");
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const expirySeconds = nowSeconds + 3600;
      const algorithm = 'RS256';

      const privateKey = await crypto.subtle.importKey(
          "pkcs8",
          _pemToBinary(privateKeyPem),
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          true, ["sign"] );

      const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
          .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
          .setIssuedAt(nowSeconds)
          .setIssuer(serviceAccountEmail)
          .setAudience('https://oauth2.googleapis.com/token')
          .setExpirationTime(expirySeconds)
          .setSubject(serviceAccountEmail)
          .sign(privateKey);

       console.log("JWT generated for FCM auth.");

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt, }),
      });

      if (!tokenResponse.ok) {
          const errorBody = await tokenResponse.text();
          console.error("OAuth Token Request Error Body:", errorBody);
          console.error(`OAuth Token Request Status: ${tokenResponse.status} ${tokenResponse.statusText}`);
          throw new Error(`Failed to fetch access token: ${tokenResponse.statusText}`);
      }

      const tokenData = await tokenResponse.json();
      if (!tokenData.access_token) {
          console.error("OAuth response missing access_token:", tokenData);
          throw new Error("OAuth response missing access_token");
      }

      console.log("Successfully obtained FCM access token.");
      return tokenData.access_token;

    } catch (e: unknown) { // <-- Catch error as unknown
      console.error("Error detail in getAccessToken:", e);
      // --- Safely access message ---
      const errorMessage = e instanceof Error ? e.message : "Unknown error structure";
      throw new Error(`Failed to generate/fetch access token for FCM: ${errorMessage}`);
      // --- End safe access ---
    }
}

// --- Helper: Send a Single FCM Message ---
// Define a more specific type for the successful FCM response if known
interface FcmSuccessResponse {
    name: string; // e.g., projects/my-project/messages/12345
    // Add other fields if needed
}

// Refine return type to avoid 'any'
async function sendFcmMessage(
    accessToken: string,
    token: string,
    title: string,
    body: string,
    articleId: number
): Promise<{
    success: boolean;
    token: string;
    status?: number;
    error?: string | Record<string, unknown>; // Use string or generic object for error body
    response?: FcmSuccessResponse | Record<string, unknown>; // Use specific or generic object
}>
{
   const fcmPayload = { /* ... (payload remains the same) ... */
     message: {
        token: token,
        notification: { title: title, body: body, },
        data: { click_action: 'FLUTTER_NOTIFICATION_CLICK', articleId: String(articleId), },
        apns: { payload: { aps: { sound: 'default' } } },
        android: { notification: { sound: "default" } }
      }
   };

   try {
       console.log(`Attempting to send FCM message to token: ...${token.slice(-10)}`);
       const response = await fetch(FCM_API_ENDPOINT, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', },
          body: JSON.stringify(fcmPayload),
        });

       if (!response.ok) {
          const errorBody = await response.text(); // Read error body as text first
          console.error(`FCM API request failed for token ...${token.slice(-10)}: ${response.status} ${response.statusText}`);
          console.error("FCM Error Body:", errorBody);
          if (response.status === 400 || response.status === 404) { /* ... */ }
          // --- Store errorBody as string ---
          return { success: false, token: token, status: response.status, error: errorBody };
          // --- End store errorBody ---
       }

       const responseData = await response.json();
       console.log(`FCM Send Success for token ...${token.slice(-10)}:`, responseData);
       // --- Cast responseData if needed, or return as Record<string, unknown> ---
       return { success: true, token: token, response: responseData as FcmSuccessResponse };
       // --- End cast ---

   } catch (fetchError: unknown) { // <-- Catch error as unknown
        console.error(`Network or fetch error sending to token ...${token.slice(-10)}:`, fetchError);
        // --- Safely access message ---
        const errorMessage = fetchError instanceof Error ? fetchError.message : "Unknown fetch error";
        return { success: false, token: token, error: errorMessage };
        // --- End safe access ---
   }
}


// --- Main Server Logic ---
console.log("sendPushNotification function (Webhook version) initializing...");

serve(async (req) => {
  if (req.method === 'OPTIONS') { /* ... */ return new Response('ok', { headers: corsHeaders }); }
  if (req.method !== 'POST') { /* ... */ return new Response('Method Not Allowed', { status: 405, headers: corsHeaders }); }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { throw new Error("Supabase URL or Anon Key environment variable not set."); }

    // --- Use SupabaseClient type annotation ---
    const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // --- End type annotation ---

    const payload = await req.json();
    console.log("Webhook payload received:", JSON.stringify(payload));

    if (payload.type !== 'INSERT' || payload.table !== 'NewsArticles' || !payload.record) { /* ... ignore ... */ }

    const newRecord = payload.record;
    const releaseStatus = newRecord.release;
    const teamNumericId = newRecord.team;
    const articleId = newRecord.id;
    const headlineEn = newRecord.headlineEnglish;
    const headlineDe = newRecord.headlineGerman;

    console.log(`Processing inserted article: ID=${articleId}, Release=${releaseStatus}, TeamID=${teamNumericId}`);

    if (releaseStatus !== 'PUBLISHED' || !teamNumericId) { /* ... criteria not met ... */ }

    console.log(`Fetching device tokens subscribed to team ID: ${teamNumericId}`);
    const { data: tokensData, error: tokenError } = await supabaseClient
        .from('device_tokens')
        .select('token')
        .eq('subscribed_team_id', teamNumericId);

    if (tokenError) {
        console.error("Database error fetching device tokens:", tokenError);
        return new Response(JSON.stringify({ error: `Failed to fetch device tokens: ${tokenError.message}` }), {
             status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const targetTokens: string[] = tokensData?.map(t => t.token).filter(t => t) ?? [];

    if (targetTokens.length === 0) { /* ... no tokens found ... */ }
    console.log(`Found ${targetTokens.length} tokens subscribed to team ${teamNumericId}.`);

    const title = "Tackle4Loss News Update";
    const body = headlineEn?.trim() || headlineDe?.trim() || "New article available.";
    const accessToken = await getAccessToken();

    console.log(`Starting FCM send process for ${targetTokens.length} tokens...`);
    const sendPromises = targetTokens.map(token =>
        sendFcmMessage(accessToken, token, title, body, articleId)
    );
    const results = await Promise.allSettled(sendPromises);

    let successfulSends = 0;
    let failedSends = 0;
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            successfulSends++;
        } else if (result.status === 'rejected') {
            failedSends++;
        }
    });
    console.log(`Notification sending complete. Success: ${successfulSends}, Failed: ${failedSends}`);

    return new Response(JSON.stringify({
        success: true,
        message: `Attempted ${targetTokens.length} notifications. Success: ${successfulSends}, Failed: ${failedSends}.`
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200, });

  } catch (error: unknown) { // <-- Catch error as unknown
    console.error('Critical error processing webhook:', error);
    // --- Safely access message ---
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: errorMessage }), {
    // --- End safe access ---
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

console.log(`sendPushNotification function (Webhook version) is ready.`);