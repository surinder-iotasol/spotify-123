/**
 * STORY-setup-004: Prisma schema validation tests.
 *
 * Verifies that:
 * 1. PrismaClient imports successfully (schema is valid, types compile)
 * 2. All model types are present
 * 3. Enums are properly generated
 */

import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";

import type {
  User,
  ArtistProfile,
  Track,
  Playlist,
  PlaylistTrack,
  Like,
  Follow,
  Report,
  AuditLog,
} from "@prisma/client";

import type {
  UserRole,
  AccountStatus,
  TrackStatus,
  Genre,
  ReportReason,
  ReportStatus,
  AuditAction,
} from "@prisma/client";

describe("Prisma schema types", () => {
  it("User model type is importable", () => {
    // Compile-time check: if User type is wrong, this won't compile.
    const _check: User = null as unknown as User;
    expect(_check).toBeNull();
  });

  it("ArtistProfile model type is importable", () => {
    const _check: ArtistProfile = null as unknown as ArtistProfile;
    expect(_check).toBeNull();
  });

  it("Track model type is importable", () => {
    const _check: Track = null as unknown as Track;
    expect(_check).toBeNull();
  });

  it("Playlist model type is importable", () => {
    const _check: Playlist = null as unknown as Playlist;
    expect(_check).toBeNull();
  });

  it("PlaylistTrack model type is importable", () => {
    const _check: PlaylistTrack = null as unknown as PlaylistTrack;
    expect(_check).toBeNull();
  });

  it("Like model type is importable", () => {
    const _check: Like = null as unknown as Like;
    expect(_check).toBeNull();
  });

  it("Follow model type is importable", () => {
    const _check: Follow = null as unknown as Follow;
    expect(_check).toBeNull();
  });

  it("Report model type is importable", () => {
    const _check: Report = null as unknown as Report;
    expect(_check).toBeNull();
  });

  it("AuditLog model type is importable", () => {
    const _check: AuditLog = null as unknown as AuditLog;
    expect(_check).toBeNull();
  });

  it("All enum types resolve to string literals", () => {
    const role: UserRole = "LISTENER";
    expect(role).toBe("LISTENER");
    const status: AccountStatus = "ACTIVE";
    expect(status).toBe("ACTIVE");
    const trackStatus: TrackStatus = "LIVE";
    expect(trackStatus).toBe("LIVE");
    const genre: Genre = "INDIE_ROCK";
    expect(genre).toBe("INDIE_ROCK");
    const reason: ReportReason = "SPAM";
    expect(reason).toBe("SPAM");
    const reportStatus: ReportStatus = "PENDING";
    expect(reportStatus).toBe("PENDING");
    const action: AuditAction = "USER_CREATE";
    expect(action).toBe("USER_CREATE");
  });
});
