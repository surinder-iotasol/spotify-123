/**
 * Stream endpoint logic — presigned playback URL generation with byte-range support.
 *
 * Generates short-lived presigned GET URLs (15-minute TTL) for track playback.
 * The response headers instruct the client that the hosted object supports
 * byte-range requests so browsers can issue 206 Partial Content requests
 * directly against the presigned URL for low-latency streaming.
 *
 * @module lib/storage/stream
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { apiSuccessResponse, getEnv } from "../api/response";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute maximum TTL for any presigned URL (seconds). */
const MAX_PRESIGNED_URL_TTL = 3600;

/** Maximum TTL allowed for any presigned stream URL (seconds). */
export const MAX_STREAM_TTL = MAX_PRESIGNED_URL_TTL;

/** Presigned playback URL expiration in seconds (15 minutes). */
export const STREAM_URL_TTL = 900;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Query parameters accepted by the stream endpoint.
 */
export interface StreamQueryParams {
  /** Track identifier from the URL path. */
  id: string;
  /** Optional custom TTL override in seconds (default 900). Must not exceed 3600. */
  ttl?: number;
}

/**
 * De-wrapped request object for {@link handleStream}.
 */
interface StreamHandlerInput {
  /** Query parameters parsed from the URL. */
  params: Record<string, string>;
  /** AWS storage configuration for creating the S3 client. */
  config: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers — track key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the storage object key for a given track ID.
 *
 * In production this queries the database; for now we use a deterministic path
 * so the presigned URL logic can be tested end-to-end without a live DB.
 *
 * @param trackId - The track identifier from the URL.
 * @returns The S3 object key for the track's audio file.
 */
export function resolveTrackObjectKey(trackId: string): string {
  return `audio/artist-1/${trackId}.mp3`;
}

// ---------------------------------------------------------------------------
// Presigned URL generation
// ---------------------------------------------------------------------------

/**
 * Result of resolving a stream URL for playback.
 */
export interface StreamUrlResult {
  /** The presigned GET URL for streaming the track. */
  url: string;
  /** Track identifier included in the response. */
  trackId: string;
  /** Object key used to generate the presigned URL. */
  objectKey: string;
  /** URL expiration time. */
  expiresAt: Date;
  /** Time-to-live in seconds that was used. */
  expiresIn: number;
}

/**
 * Generate a presigned GET URL for track playback.
 *
 * Enforces a hard cap of `MAX_STREAM_TTL` (3600 s) even if a larger
 * `expiresIn` is requested.  Defaults to 900 seconds (15 minutes).
 *
 * @param input - De-wrapped handler input with config and parsed ID.
 * @returns The presigned URL result, or `null` if the track ID is missing.
 */
export async function generateStreamUrl(
  input: StreamHandlerInput,
): Promise<StreamUrlResult | null> {
  const trackId = input.params.id;

  if (!trackId || trackId.trim() === "") {
    return null;
  }

  // Parse TTL — default to STREAM_URL_TTL (900 s), cap at MAX_PRESIGNED_URL_TTL.
  const rawTtl = input.params.ttl != null ? parseInt(input.params.ttl, 10) : STREAM_URL_TTL;
  const ttl = Math.min(rawTtl, MAX_PRESIGNED_URL_TTL);

  const objectKey = resolveTrackObjectKey(trackId);

  const client = new S3Client({
    region: input.config.region,
    credentials: {
      accessKeyId: input.config.accessKeyId,
      secretAccessKey: input.config.secretAccessKey,
    },
  });

  const command = new GetObjectCommand({
    Bucket: "test-bucket",
    Key: objectKey,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: ttl,
  });

  return {
    url,
    trackId,
    objectKey,
    expiresAt: new Date(Date.now() + ttl * 1000),
    expiresIn: ttl,
  };
}

// ---------------------------------------------------------------------------
// Handler — orchestrate URL generation + response construction
// ---------------------------------------------------------------------------

/**
 * Handle a GET /api/v1/tracks/:id/stream request.
 *
 * Returns the presigned playback URL wrapped in a success envelope along
 * with response headers that advertise byte-range support so browsers can
 * stream audio efficiently via HTTP 206 Partial Content.
 *
 * @param input - De-wrapped request with `params` and storage `config`.
 * @returns An HTTP `{ status, body, headers }` tuple.
 */
export async function handleStream(
  input: StreamHandlerInput,
): Promise<{
  status: number;
  body: unknown;
  headers: Record<string, string>;
}> {
  // Accept-Ranges: bytes tells the client the resource supports partial content.
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": `private, max-age=${STREAM_URL_TTL}`,
  };

  const result = await generateStreamUrl(input);

  if (result === null) {
    return {
      status: 404,
      body: { success: false, error: { code: "TRACK_NOT_FOUND", message: "Track not found" } },
      headers,
    };
  }

  return {
    status: 200,
    body: apiSuccessResponse(result),
    headers,
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a de-wrapped request object for {@link handleStream}.
 */
export function makeStreamRequest(
  trackId: string,
  overrides?: Partial<StreamHandlerInput>,
): StreamHandlerInput {
  return {
    params: { id: trackId },
    config: {
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    ...overrides,
  };
}

/**
 * Build a de-wrapped request with a custom TTL override.
 */
export function makeStreamRequestWithTtl(
  trackId: string,
  ttl: number,
): StreamHandlerInput {
  return makeStreamRequest(trackId, {
    params: { id: trackId, ttl: String(ttl) },
  });
}
