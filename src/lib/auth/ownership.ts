/**
 * Resource ownership verification helpers for Insecure Direct Object Reference
 * (IDOR) protection in REST API route handlers.
 *
 * Provides reusable functions that confirm a caller owns a Track or Playlist
 * record — or holds the ADMIN role that bypasses ownership checks — before
 * allowing modifications or deletions.
 *
 * @module lib/auth/ownership
 */

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Machine-readable error code returned on ownership failure. */
export const ERR_RESOURCE_OWNERSHIP_DENIED = "ERR_RESOURCE_OWNERSHIP_DENIED";

/** Human-readable message for ownership failures. */
export const OWNERSHIP_DENIED_MESSAGE =
  "You do not have permission to modify or delete this resource";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Caller identity claims injected by the edge middleware. */
export interface CallerIdentity {
  /** Prisma User ID extracted from the `x-user-id` header. */
  userId: string;
  /** User role: LISTENER, ARTIST, or ADMIN. */
  role: "LISTENER" | "ARTIST" | "ADMIN";
  /** Optional artist profile ID — set for ARTIST role tokens. */
  artistProfileId?: string;
}

/** Caller identity claims — backward-compatible alias for CallerIdentity. */
export type CallerClaims = CallerIdentity;

/** A Track resource identified by its database id and owning artist profile. */
export interface TrackRecord {
  /** Database-assigned track identifier. */
  id: string;
  /** Artist profile that owns this track. */
  artistProfileId: string;
}

/** A Playlist resource identified by its database id and owning user. */
export interface PlaylistRecord {
  /** Database-assigned playlist identifier. */
  id: string;
  /** User that owns this playlist. */
  userId: string;
}

/** Structured error details returned on ownership denial. */
export interface OwnershipErrorDetails {
  /** Human-readable reason for the denial. */
  reason: string;
  /** Type of resource ("Track" or "Playlist"). */
  resourceType: "Track" | "Playlist";
  /** ID of the user who was denied access. */
  callerId: string;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Error thrown when ownership verification fails.
 *
 * Carries the HTTP 403 status code, a machine-readable error code,
 * structured details, and is catchable via `instanceof` checks.
 */
export class OwnershipError extends Error {
  readonly name = "OwnershipError" as const;
  readonly statusCode = 403;
  readonly code = ERR_RESOURCE_OWNERSHIP_DENIED;
  readonly details: OwnershipErrorDetails;

  constructor(details: OwnershipErrorDetails) {
    super(OWNERSHIP_DENIED_MESSAGE);
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract caller identity claims from a NextRequest whose headers were
 * populated by the edge middleware.
 *
 * @param request - The incoming NextRequest object.
 * @returns The decoded caller claims, or `null` if required headers are missing.
 */
export function extractCallerClaims(
  request: NextRequest,
): CallerClaims | null {
  const userId = request.headers.get("x-user-id");
  const role = request.headers.get("x-user-role") as
    | "LISTENER"
    | "ARTIST"
    | "ADMIN"
    | null;
  const artistProfileId =
    request.headers.get("x-artist-profile-id") || undefined;

  if (!userId || !role) {
    return null;
  }

  return { userId, role, artistProfileId };
}

// ---------------------------------------------------------------------------
// Ownership check functions
// ---------------------------------------------------------------------------

/**
 * Verify that a Track belongs to the caller (by artist profile) or the caller
 * holds the ADMIN role.
 *
 * Returns `true` when ownership is confirmed, `false` otherwise.
 * LISTENER role is never granted track ownership.
 *
 * @param artistProfileId - The artist profile that owns this track.
 * @param caller - The identity claims of the authenticated caller.
 */
export function checkTrackOwnership(
  artistProfileId: string,
  caller: CallerIdentity,
): boolean {
  if (caller.role === "ADMIN") {
    return true;
  }

  // LISTENER role cannot own tracks regardless of profile match
  if (caller.role === "LISTENER") {
    return false;
  }

  return artistProfileId === caller.artistProfileId;
}

/**
 * Verify that a Playlist belongs to the caller or the caller holds the ADMIN
 * role.
 *
 * Returns `true` when ownership is confirmed, `false` otherwise.
 *
 * @param userId - The user that owns this playlist.
 * @param caller - The identity claims of the authenticated caller.
 */
export function checkPlaylistOwnership(
  userId: string,
  caller: CallerIdentity,
): boolean {
  if (caller.role === "ADMIN") {
    return true;
  }

  return userId === caller.userId;
}

// ---------------------------------------------------------------------------
// 403 error response builder
// ---------------------------------------------------------------------------

/**
 * Build a structured 403 Forbidden error response for ownership denial.
 *
 * @param resourceType - The type of resource ("Track" or "Playlist").
 * @param resourceId - The database ID of the denied resource.
 * @param callerId - The ID of the caller who was denied access.
 * @param ownerHint - Optional owner identifier to include in error details.
 * @returns A NextResponse with HTTP 403 and the structured error envelope.
 */
export function buildOwnershipErrorResponse(
  resourceType: "Track" | "Playlist",
  resourceId: string,
  callerId: string,
  ownerHint?: string,
): NextResponse {
  const details: { field: string; code: string; message: string }[] = [];

  details.push({
    field: `resource.${resourceType.toLowerCase()}.id`,
    code: ERR_RESOURCE_OWNERSHIP_DENIED,
    message: `${resourceType} ownership verification failed`,
  });

  if (ownerHint) {
    details.push({
      field: `resource.${resourceType.toLowerCase()}.owner`,
      code: "OWNERSHIP_MISMATCH",
      message: `Resource belongs to ${ownerHint}; caller is ${callerId}`,
    });
  }

  return new NextResponse(
    JSON.stringify({
      success: false,
      error: {
        code: ERR_RESOURCE_OWNERSHIP_DENIED,
        message: OWNERSHIP_DENIED_MESSAGE,
        details,
      },
      timestamp: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    }),
    {
      status: 403,
      headers: { "content-type": "application/json" },
    },
  );
}

// ---------------------------------------------------------------------------
// Higher-order handler wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a Next.js API route handler with ownership verification.
 *
 * Extracts caller identity from request headers (injected by the edge
 * middleware), runs the provided ownership check, and returns HTTP 403 if
 * the caller lacks ownership and is not ADMIN.
 *
 * @param request - The incoming NextRequest object.
 * @param nextHandler - The API route handler to invoke on successful check.
 * @param resource - The resource identifier for ownership verification.
 * @param resourceType - "Track" or "Playlist".
 * @param checkFn - Ownership check function (checkTrackOwnership or checkPlaylistOwnership).
 * @param ownerHint - Owner identifier included in error details.
 * @returns A NextResponse (403 on failure, handler result on success).
 */
export async function requireOwnership(
  request: NextRequest,
  nextHandler: () => Promise<NextResponse> | NextResponse,
  resource: string,
  resourceType: "Track" | "Playlist",
  checkFn: (resource: string, caller: CallerClaims) => boolean,
  ownerHint?: string,
): Promise<NextResponse> {
  const caller = extractCallerClaims(request);

  if (!caller) {
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required to access this resource",
        },
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      },
    );
  }

  if (!checkFn(resource, caller)) {
    return buildOwnershipErrorResponse(
      resourceType,
      resource,
      caller.userId,
      ownerHint,
    );
  }

  return nextHandler();
}
