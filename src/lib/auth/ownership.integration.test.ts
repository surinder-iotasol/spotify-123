// @vitest-environment node
/**
 * Integration tests for resource ownership verification helpers.
 *
 * Verifies the full request-to-response lifecycle for Track and Playlist
 * ownership enforcement: an authenticated non-admin caller attempting to
 * access another user's resources receives HTTP 403 with the structured
 * `ERR_RESOURCE_OWNERSHIP_DENIED` envelope.
 *
 * Simulates route handlers that use `checkTrackOwnership` /
 * `checkPlaylistOwnership` and translate ownership failures into API
 * response envelopes, mirroring what happens in production Next.js API
 * route handlers.
 *
 * @module ownership-integration
 */

import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  checkTrackOwnership,
  checkPlaylistOwnership,
  buildOwnershipErrorResponse,
  ERR_RESOURCE_OWNERSHIP_DENIED,
  type CallerIdentity,
  type TrackRecord,
  type PlaylistRecord,
} from "./ownership";
import { apiSuccessResponse } from "@/lib/api/response";

// ---------------------------------------------------------------------------
// Helpers — simulate a route handler
// ---------------------------------------------------------------------------

/**
 * Simulate a route handler that wraps ownership checking and returns a
 * NextResponse, mimicking a real API route.
 */
function simulateTrackHandler(
  track: TrackRecord,
  caller: CallerIdentity,
) {
  if (checkTrackOwnership(track.artistProfileId, caller)) {
    return NextResponse.json(
      apiSuccessResponse({ id: track.id, title: "test-track" }),
      { status: 200 },
    );
  }
  return buildOwnershipErrorResponse(
    "Track",
    track.id,
    caller.userId,
    track.artistProfileId,
  );
}

function simulatePlaylistHandler(
  playlist: PlaylistRecord,
  caller: CallerIdentity,
) {
  if (checkPlaylistOwnership(playlist.userId, caller)) {
    return NextResponse.json(
      apiSuccessResponse({ id: playlist.id, title: "test-playlist" }),
      { status: 200 },
    );
  }
  return buildOwnershipErrorResponse(
    "Playlist",
    playlist.id,
    caller.userId,
    playlist.userId,
  );
}

// ---------------------------------------------------------------------------
// Track ownership — HTTP 403 integration
// ---------------------------------------------------------------------------

describe("Track ownership — 403 Forbidden on unauthorized access", () => {
  const OWNER_TRACK: TrackRecord = { id: "track-001", artistProfileId: "ap-001" };
  const OTHER_TRACK: TrackRecord = { id: "track-002", artistProfileId: "ap-099" };

  it("returns 200 when caller owns the track", () => {
    const response = simulateTrackHandler(OWNER_TRACK, {
      userId: "artist-001",
      role: "ARTIST",
      artistProfileId: "ap-001",
    });

    expect(response.status).toBe(200);
    const body = response.json() as Promise<{ success: boolean; data: { id: string } }>;
    return body.then((b) => {
      expect(b.success).toBe(true);
      expect(b.data.id).toBe("track-001");
    });
  });

  it("returns 403 when caller has mismatched profile", () => {
    const response = simulateTrackHandler(OTHER_TRACK, {
      userId: "artist-001",
      role: "ARTIST",
      artistProfileId: "ap-001",
    });

    expect(response.status).toBe(403);
    const body = response.json() as Promise<{
      success: boolean;
      error: { code: string };
    }>;
    return body.then((b) => {
      expect(b.success).toBe(false);
      expect(b.error.code).toBe(ERR_RESOURCE_OWNERSHIP_DENIED);
    });
  });

  it("returns 200 for ADMIN accessing another user's track (admin override)", () => {
    const response = simulateTrackHandler(OTHER_TRACK, {
      userId: "admin-001",
      role: "ADMIN",
    });

    expect(response.status).toBe(200);
    const body = response.json() as Promise<{ success: boolean }>;
    return body.then((b) => {
      expect(b.success).toBe(true);
    });
  });

  it("returns 403 for LISTENER attempting to access any track", () => {
    const response = simulateTrackHandler(OWNER_TRACK, {
      userId: "listener-001",
      role: "LISTENER",
    });

    expect(response.status).toBe(403);
    const body = response.json() as Promise<{
      success: boolean;
      error: { code: string };
    }>;
    return body.then((b) => {
      expect(b.success).toBe(false);
      expect(b.error.code).toBe(ERR_RESOURCE_OWNERSHIP_DENIED);
    });
  });
});

// ---------------------------------------------------------------------------
// Playlist ownership — HTTP 403 integration
// ---------------------------------------------------------------------------

describe("Playlist ownership — 403 Forbidden on unauthorized access", () => {
  const OWNER_PLAYLIST: PlaylistRecord = { id: "pl-001", userId: "user-001" };
  const OTHER_PLAYLIST: PlaylistRecord = { id: "pl-002", userId: "user-099" };

  it("returns 200 when caller owns the playlist", () => {
    const response = simulatePlaylistHandler(OWNER_PLAYLIST, {
      userId: "user-001",
      role: "LISTENER",
    });

    expect(response.status).toBe(200);
    const body = response.json() as Promise<{ success: boolean; data: { id: string } }>;
    return body.then((b) => {
      expect(b.success).toBe(true);
      expect(b.data.id).toBe("pl-001");
    });
  });

  it("returns 403 when caller does not own the playlist", () => {
    const response = simulatePlaylistHandler(OTHER_PLAYLIST, {
      userId: "user-001",
      role: "LISTENER",
    });

    expect(response.status).toBe(403);
    const body = response.json() as Promise<{
      success: boolean;
      error: { code: string };
    }>;
    return body.then((b) => {
      expect(b.success).toBe(false);
      expect(b.error.code).toBe(ERR_RESOURCE_OWNERSHIP_DENIED);
    });
  });

  it("returns 200 for ADMIN accessing another user's playlist (admin override)", () => {
    const response = simulatePlaylistHandler(OTHER_PLAYLIST, {
      userId: "admin-001",
      role: "ADMIN",
    });

    expect(response.status).toBe(200);
    const body = response.json() as Promise<{ success: boolean }>;
    return body.then((b) => {
      expect(b.success).toBe(true);
    });
  });

  it("returns 403 when ARTIST attempts to edit another user's playlist", () => {
    const response = simulatePlaylistHandler(OWNER_PLAYLIST, {
      userId: "artist-001",
      role: "ARTIST",
      artistProfileId: "ap-001",
    });

    expect(response.status).toBe(403);
    const body = response.json() as Promise<{
      success: boolean;
      error: { code: string };
    }>;
    return body.then((b) => {
      expect(b.success).toBe(false);
      expect(b.error.code).toBe(ERR_RESOURCE_OWNERSHIP_DENIED);
    });
  });
});

// ---------------------------------------------------------------------------
// 403 response structure — consistent envelope shape
// ---------------------------------------------------------------------------

describe("403 response structure — structured error envelope", () => {
  it("contains success false with error code and message", () => {
    const response = simulateTrackHandler(
      { id: "t-x", artistProfileId: "ap-x" },
      { userId: "u-y", role: "ARTIST", artistProfileId: "ap-y" },
    );

    expect(response.status).toBe(403);
    const body = response.json() as Promise<{
      success: boolean;
      error: { code: string; message: string };
      timestamp: string;
      requestId: string;
    }>;
    return body.then((b) => {
      expect(b.success).toBe(false);
      expect(b.error.code).toBe(ERR_RESOURCE_OWNERSHIP_DENIED);
      expect(typeof b.error.message).toBe("string");
      expect(new Date(b.timestamp).toISOString()).toBeDefined();
      expect(b.requestId.length).toBeGreaterThan(0);
    });
  });

  it("includes details in the error response", () => {
    const response = simulatePlaylistHandler(
      { id: "pl-x", userId: "u-x" },
      { userId: "u-y", role: "LISTENER" },
    );

    expect(response.status).toBe(403);
    const body = response.json() as Promise<{
      error: { details: Array<{ field: string; code: string; message: string }> };
    }>;
    return body.then((b) => {
      expect(b.error.details).toBeDefined();
      expect(b.error.details!.length).toBeGreaterThanOrEqual(1);
      expect(b.error.details![0].code).toBe(ERR_RESOURCE_OWNERSHIP_DENIED);
    });
  });
});
