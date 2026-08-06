/**
 * GET /api/v1/tracks/:id/stream — Presigned playback stream URL endpoint.
 *
 * Generates a short-lived presigned GET URL (15-minute TTL) for track audio
 * playback.  Returns HTTP response headers signalling byte-range support so
 * browsers and media players can perform low-latency streaming.
 *
 * This endpoint permits unauthenticated guest access for public track
 * streaming per DEC-005.  It is explicitly excluded from the Next.js Edge
 * Middleware route-guard so no session cookie is required.
 *
 * RESPONSES:
 *  200 OK          → { success: true, data: { streamUrl, storageKey } }
 *  404 Not Found   → { success: false, error: { code: "TRACK_NOT_FOUND" } }
 *  500 Internal    → { success: false, error: { code: "STORAGE_ERROR" } }
 */

import { NextRequest, NextResponse } from "next/server";

import { PrismaClient } from "@prisma/client";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Note: this endpoint permits unauthenticated guest access.
// It is NOT in the middleware's protected route prefixes,
// so the Edge Middleware returns NextResponse.next() without
// requiring a session cookie.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Presigned URL expiration in seconds — 15 minutes per DEC-008. */
const STREAM_URL_TTL_SECONDS = 900;

/** Maximum presigned URL TTL across the system (seconds). */
const MAX_PRESIGNED_URL_TTL = 3600;

/** Response headers defining streaming / caching behaviour. */
const STREAM_HEADERS: Record<string, string> = {
  "Accept-Ranges": "bytes",
  "Cache-Control": "private, max-age=900",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lazily-loaded PrismaClient singleton.
 *
 * prisma-instance — the Next.js _app.js pattern.  We use the
 * same pattern to keep the development server from exhausting file
 * descriptors across hot-reloads.
 */
function getPrisma(): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = global as any;
  if (!globalAny.prisma) {
    globalAny.prisma = new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.DATABASE_URL ??
            "mongodb://localhost:27017/indie-dev",
        },
      },
    });
  }
  return globalAny.prisma;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * Route handler for GET /api/v1/tracks/:id/stream.
 *
 * Generates and returns a presigned playback URL with streaming-ready
 * headers.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } },
): Promise<NextResponse> {
  // --- Resolve dynamic route parameter ----------------------------------
  const id = typeof params.id === "string" ? params.id : params.id;
  if (!id || id.trim() === "") {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_PARAMS", message: "Track ID is required" },
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
      { status: 400 },
    );
  }

  // --- Look up track in database ----------------------------------------
  const prisma = getPrisma();

  const track = await prisma.track.findUnique({
    where: { id },
    select: { audio_storage_key: true },
  });

  if (!track) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "TRACK_NOT_FOUND", message: `Track "${id}" not found` },
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
      { status: 404 },
    );
  }

  // --- Resolve storage configuration from environment -------------------
  const env: Env = process.env;
  const region = env.AWS_REGION ?? "us-east-1";
  const bucket = env.S3_BUCKET_NAME ?? "";
  const endpoint = env.S3_ENDPOINT;

  const storageConfig = {
    bucket,
    region,
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
    ...(endpoint && { endpoint }),
    forcePathStyle: !!endpoint,
  };

  // --- Generate presigned GET URL ----------------------------------------
  const client = new S3Client({
    region: storageConfig.region,
    credentials: {
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey: storageConfig.secretAccessKey,
    },
    ...(storageConfig.endpoint && { endpoint: storageConfig.endpoint }),
    forcePathStyle: !!storageConfig.endpoint,
  });

  const command = new GetObjectCommand({
    Bucket: storageConfig.bucket,
    Key: track.audio_storage_key,
  });

  // Enforce the 3600-second TTL cap even if STREAM_URL_TTL_SECONDS were higher.
  const ttl = Math.min(STREAM_URL_TTL_SECONDS, MAX_PRESIGNED_URL_TTL);

  let presignedUrl: string;
  try {
    presignedUrl = await getSignedUrl(client, command, { expiresIn: ttl });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: "Failed to generate presigned playback URL",
        },
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      },
      { status: 500 },
    );
  }

  // --- Return 200 response with streaming headers ------------------------
  return NextResponse.json(
    {
      success: true,
      data: {
        streamUrl: presignedUrl,
        storageKey: track.audio_storage_key,
        ttl: ttl,
      },
      timestamp: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    },
    {
      status: 200,
      headers: STREAM_HEADERS,
    },
  );
}
