// @vitest-environment node
/**
 * Unit tests for resource ownership verification helpers.
 *
 * Covers:
 * - extractCallerClaims parses headers into CallerClaims
 * - checkTrackOwnership returns true for ADMIN or matching artistProfileId
 * - checkPlaylistOwnership returns true for ADMIN or matching userId
 * - Admin role overrides ownership for both Track and Playlist
 * - OwnershipError carries correct 403 status and structured details
 * - buildOwnershipErrorResponse returns HTTP 403 with structured envelope
 * - requireOwnership wraps handlers with ownership enforcement
 *
 * @module lib/auth/ownership.test
 */

import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  extractCallerClaims,
  checkTrackOwnership,
  checkPlaylistOwnership,
  OwnershipError,
  buildOwnershipErrorResponse,
  requireOwnership,
  ERR_RESOURCE_OWNERSHIP_DENIED,
  type CallerClaims,
} from "./ownership";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_CLAIMS: CallerClaims = {
  userId: "admin-001",
  role: "ADMIN",
};

const ARTIST_CLAIMS: CallerClaims = {
  userId: "artist-001",
  role: "ARTIST",
  artistProfileId: "ap-001",
};

const LISTENER_CLAIMS: CallerClaims = {
  userId: "listener-001",
  role: "LISTENER",
};

function makeRequest(headers: Record<string, string>): NextRequest {
  const req = new NextRequest("http://localhost/api/test");
  for (const [key, value] of Object.entries(headers)) {
    req.headers.set(key, value);
  }
  return req;
}

// ---------------------------------------------------------------------------
// extractCallerClaims
// ---------------------------------------------------------------------------

describe("extractCallerClaims", () => {
  it("extracts claims from valid headers", () => {
    const req = makeRequest({
      "x-user-id": "artist-001",
      "x-user-role": "ARTIST",
      "x-artist-profile-id": "ap-001",
    });
    const claims = extractCallerClaims(req);
    expect(claims).toEqual({
      userId: "artist-001",
      role: "ARTIST",
      artistProfileId: "ap-001",
    });
  });

  it("extracts claims without artistProfileId", () => {
    const req = makeRequest({
      "x-user-id": "listener-001",
      "x-user-role": "LISTENER",
    });
    const claims = extractCallerClaims(req);
    expect(claims).toEqual({
      userId: "listener-001",
      role: "LISTENER",
      artistProfileId: undefined,
    });
  });

  it("returns null when x-user-id is missing", () => {
    const req = makeRequest({ "x-user-role": "ADMIN" });
    expect(extractCallerClaims(req)).toBeNull();
  });

  it("returns null when x-user-role is missing", () => {
    const req = makeRequest({ "x-user-id": "admin-001" });
    expect(extractCallerClaims(req)).toBeNull();
  });

  it("returns null when both headers are missing", () => {
    expect(extractCallerClaims(new NextRequest("http://localhost"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OwnershipError class
// ---------------------------------------------------------------------------

describe("OwnershipError", () => {
  it("carries HTTP 403 status", () => {
    const err = new OwnershipError({
      reason: "Test ownership mismatch",
      resourceType: "Track",
      callerId: "caller-001",
    });
    expect(err.statusCode).toBe(403);
  });

  it("includes resourceType, reason, and callerId fields", () => {
    const err = new OwnershipError({
      reason: "Track belongs to ap-001; caller is artist-002",
      resourceType: "Track",
      callerId: "artist-002",
    });
    expect(err.details.resourceType).toBe("Track");
    expect(err.details.reason).toContain("ap-001");
    expect(err.details.callerId).toBe("artist-002");
  });

  it("is catchable via instanceof checks", () => {
    const err = new OwnershipError({
      reason: "Test",
      resourceType: "Playlist",
      callerId: "u-1",
    });
    expect(err instanceof OwnershipError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("OwnershipError");
  });

  it("is catchable via name property in route handlers", () => {
    try {
      throw new OwnershipError({
        reason: "Test",
        resourceType: "Track",
        callerId: "u-1",
      });
    } catch (err) {
      expect((err as OwnershipError).name).toBe("OwnershipError");
    }
  });

  it("defaults statusCode to 403", () => {
    const err = new OwnershipError({
      reason: "Test",
      resourceType: "Playlist",
      callerId: "u-1",
    });
    expect(err.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// checkTrackOwnership — returns boolean
// ---------------------------------------------------------------------------

describe("checkTrackOwnership", () => {
  it("returns true when caller is ADMIN", () => {
    expect(checkTrackOwnership("ap-other", ADMIN_CLAIMS)).toBe(true);
  });

  it("returns true when artistProfileId matches caller's profile", () => {
    expect(checkTrackOwnership("ap-001", ARTIST_CLAIMS)).toBe(true);
  });

  it("returns false when artistProfileId does not match", () => {
    expect(checkTrackOwnership("ap-other", ARTIST_CLAIMS)).toBe(false);
  });

  it("returns false for LISTENER regardless of profile match", () => {
    expect(checkTrackOwnership("ap-001", LISTENER_CLAIMS)).toBe(false);
  });

  it("returns false for LISTENER with mismatched profile", () => {
    expect(checkTrackOwnership("ap-other", LISTENER_CLAIMS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkPlaylistOwnership — returns boolean
// ---------------------------------------------------------------------------

describe("checkPlaylistOwnership", () => {
  it("returns true when caller is ADMIN", () => {
    expect(checkPlaylistOwnership("user-other", ADMIN_CLAIMS)).toBe(true);
  });

  it("returns true when userId matches caller's userId", () => {
    expect(checkPlaylistOwnership("listener-001", LISTENER_CLAIMS)).toBe(true);
  });

  it("returns false when userId does not match", () => {
    expect(checkPlaylistOwnership("user-other", LISTENER_CLAIMS)).toBe(false);
  });

  it("returns true for ARTIST matching their userId", () => {
    expect(checkPlaylistOwnership("artist-001", ARTIST_CLAIMS)).toBe(true);
  });

  it("returns false for ARTIST with mismatched userId", () => {
    expect(checkPlaylistOwnership("user-other", ARTIST_CLAIMS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildOwnershipErrorResponse
// ---------------------------------------------------------------------------

describe("buildOwnershipErrorResponse", () => {
  it("returns HTTP 403 status", () => {
    const res = buildOwnershipErrorResponse("Track", "trk-001", "caller-001", "ap-001");
    expect(res.status).toBe(403);
  });

  it("returns JSON content type", () => {
    const res = buildOwnershipErrorResponse("Track", "trk-001", "caller-001");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("includes ERR_RESOURCE_OWNERSHIP_DENIED code", async () => {
    const res = buildOwnershipErrorResponse("Track", "trk-001", "caller-001", "ap-001");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ERR_RESOURCE_OWNERSHIP_DENIED);
  });

  it("includes success false", async () => {
    const res = buildOwnershipErrorResponse("Playlist", "pl-001", "caller-001");
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it("includes timestamp and requestId", async () => {
    const res = buildOwnershipErrorResponse("Track", "trk-001", "caller-001");
    const body = (await res.json()) as { timestamp: string; requestId: string };
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  it("includes details array with ownership failure entry", async () => {
    const res = buildOwnershipErrorResponse("Track", "trk-001", "caller-001", "ap-001");
    const body = (await res.json()) as { error: { details: unknown[] } };
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBe(2);
    expect((body.error.details[0] as { field: string }).field).toBe(
      "resource.track.id",
    );
    expect((body.error.details[1] as { field: string }).field).toBe(
      "resource.track.owner",
    );
  });

  it("omits owner detail when ownerHint is not provided", async () => {
    const res = buildOwnershipErrorResponse("Playlist", "pl-001", "caller-001");
    const body = (await res.json()) as { error: { details: unknown[] } };
    expect(body.error.details.length).toBe(1);
    expect((body.error.details[0] as { field: string }).field).toBe(
      "resource.playlist.id",
    );
  });

  it("includes owner detail with caller and owner info", async () => {
    const res = buildOwnershipErrorResponse(
      "Track",
      "trk-001",
      "caller-001",
      "ap-owner",
    );
    const body = (await res.json()) as { error: { details: unknown[] } };
    const ownerDetail = body.error.details[1] as { message: string };
    expect(ownerDetail.message).toContain("ap-owner");
    expect(ownerDetail.message).toContain("caller-001");
  });
});

// ---------------------------------------------------------------------------
// requireOwnership — higher-order handler wrapper
// ---------------------------------------------------------------------------

describe("requireOwnership", () => {
  it("returns 401 when caller claims are missing", async () => {
    const req = makeRequest({});
    const handler = vi.fn().mockResolvedValue(
      new NextResponse("ok", { status: 200 }),
    );
    const res = await requireOwnership(
      req,
      handler,
      "trk-001",
      "Track",
      () => true,
    );
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when track ownership check fails", async () => {
    const req = makeRequest({
      "x-user-id": "artist-001",
      "x-user-role": "ARTIST",
      "x-artist-profile-id": "ap-other",
    });
    const handler = vi.fn().mockResolvedValue(
      new NextResponse("ok", { status: 200 }),
    );
    const res = await requireOwnership(
      req,
      handler,
      "trk-001",
      "Track",
      () => false,
    );
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when playlist ownership check fails", async () => {
    const req = makeRequest({
      "x-user-id": "listener-001",
      "x-user-role": "LISTENER",
    });
    const handler = vi.fn().mockResolvedValue(
      new NextResponse("ok", { status: 200 }),
    );
    const res = await requireOwnership(
      req,
      handler,
      "pl-001",
      "Playlist",
      () => false,
    );
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes ownership check when track artistProfileId matches", async () => {
    const req = makeRequest({
      "x-user-id": "artist-001",
      "x-user-role": "ARTIST",
      "x-artist-profile-id": "ap-001",
    });
    const handler = vi.fn().mockResolvedValue(
      new NextResponse("deleted", { status: 200 }),
    );
    const res = await requireOwnership(
      req,
      handler,
      "trk-001",
      "Track",
      () => true,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("deleted");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("passes ownership check when playlist userId matches", async () => {
    const req = makeRequest({
      "x-user-id": "listener-001",
      "x-user-role": "LISTENER",
    });
    const handler = vi.fn().mockResolvedValue(
      new NextResponse("updated", { status: 200 }),
    );
    const res = await requireOwnership(
      req,
      handler,
      "pl-001",
      "Playlist",
      () => true,
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows ADMIN to bypass ownership check for tracks", async () => {
    const req = makeRequest({
      "x-user-id": "admin-001",
      "x-user-role": "ADMIN",
    });
    const handler = vi.fn().mockResolvedValue(
      new NextResponse("ok", { status: 200 }),
    );
    const res = await requireOwnership(
      req,
      handler,
      "trk-001",
      "Track",
      () => true,
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows ADMIN to bypass ownership check for playlists", async () => {
    const req = makeRequest({
      "x-user-id": "admin-001",
      "x-user-role": "ADMIN",
    });
    const handler = vi.fn().mockResolvedValue(
      new NextResponse("ok", { status: 200 }),
    );
    const res = await requireOwnership(
      req,
      handler,
      "pl-001",
      "Playlist",
      () => true,
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
