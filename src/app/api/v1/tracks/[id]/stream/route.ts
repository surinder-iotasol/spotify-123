/**
 * GET /api/v1/tracks/:id/stream — Presigned playback URL endpoint.
 *
 * Issues a short-lived presigned GET URL for track playback with byte-range
 * support headers so browsers can stream audio efficiently.
 *
 * @module app/api/v1/tracks/[id]/stream/route
 */

import { NextRequest } from "next/server";

import { handleStream } from "@/lib/storage/stream";
import { getEnv } from "@/lib/env";

/**
 * Proxy a GET request to generate a presigned playback URL.
 *
 * This endpoint is intentionally public — any unauthenticated visitor can
 * request a playback URL per DEC-005.  The presigned URL itself is the only
 * access control mechanism.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await params;

  // Parse any query parameters (e.g. ?ttl=600).
  const searchParams = _req.nextUrl.searchParams;
  const ttl = searchParams.has("ttl") ? Number(searchParams.get("ttl")) : undefined;

  const input = {
    params: {
      id: resolved.id,
      ...(ttl != null && { ttl: String(ttl) }),
    },
    config: {
      region: getEnv().AWS_REGION,
      accessKeyId: getEnv().AWS_ACCESS_KEY_ID,
      secretAccessKey: getEnv().AWS_SECRET_ACCESS_KEY,
    },
  };

  const result = await handleStream(input);

  // Build the response with streaming-specific headers.
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      "Content-Type": "application/json",
      ...result.headers,
    },
  });
}
