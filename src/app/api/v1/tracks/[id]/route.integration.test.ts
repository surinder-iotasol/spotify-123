/**
 * Integration test: GET /api/v1/tracks/:id/stream endpoint.
 *
 * STORY-storage-003 — Presigned playback stream URL endpoint.
 *
 * Exercises the full route handler (parameter extraction → Prisma lookup →
 * presigned URL generation → response headers) using mocked Prisma and
 * AWS SDK dependencies.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest } from "next/server";

import type {
  PrismaClient,
  Track,
} from "@prisma/client";
import { S3StorageProvider, StorageError } from "@/lib/storage/storage.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTrack: Track = {
  id: "track-abc-123",
  title: "Test Song",
  description: "A test track",
  audio_url: "https://example.com/original.mp3",
  audio_storage_key: "audio/artist-1/track-abc-123.mp3",
  cover_image_url: "https://example.com/cover.jpg",
  duration: 245.5,
  genre: "INDIE_ROCK",
  status: "LIVE",
  playCount: 42,
  likeCount: 7,
  artist_profile_id: "artist-1",
  user_id: "user-1",
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
} as Track;

const mockPrisma = {
  track: {
    findUnique: vi.fn(),
  },
} as unknown as PrismaClient;

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

const mockGetSignedUrl = vi.fn();
const mockS3Send = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

// ---------------------------------------------------------------------------
// Import the route handler (after mocks have been set up)
// ---------------------------------------------------------------------------

const route = await import("./route");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/tracks/:id/stream", () => {
  const PRE_SIGNED_URL =
    "https://test-bucket.s3.amazonaws.com/audio%2Ftrack.mp3?X-Amz-Signature=xyz";

  beforeEach(() => {
    vi.clearAllMocks();
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ send: mockS3Send }),
    );
    mockPrisma.track.findUnique.mockReset();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("returns presigned stream URL with required headers on success", async () => {
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    try {
      mockGetSignedUrl.mockResolvedValue(PRE_SIGNED_URL);
      mockPrisma.track.findUnique.mockResolvedValue(mockTrack);

      const req = new NextRequest(
        "http://localhost:3000/api/v1/tracks/track-abc-123/stream",
      );
      const response = await route.GET(req, {
        params: { id: "track-abc-123" },
      });

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.streamUrl).toBe(PRE_SIGNED_URL);
      expect(body.data.storageKey).toBe(mockTrack.audio_storage_key);

      // Required response headers per the acceptance criteria:
      // Accept-Ranges: bytes and Cache-Control: private, max-age=900
      const headers = response.headers;
      expect(headers.get("Accept-Ranges")).toBe("bytes");
      expect(headers.get("Cache-Control")).toBe("private, max-age=900");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns HTTP 404 when track is not found", async () => {
    mockPrisma.track.findUnique.mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost:3000/api/v1/tracks/nonexistent/stream",
    );
    const response = await route.GET(req, {
      params: { id: "nonexistent" },
    });

    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("TRACK_NOT_FOUND");
  });

  it("creates GetObjectCommand with the track's storage key", async () => {
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    try {
      mockGetSignedUrl.mockResolvedValue(PRE_SIGNED_URL);
      mockPrisma.track.findUnique.mockResolvedValue(mockTrack);

      const req = new NextRequest(
        "http://localhost:3000/api/v1/tracks/track-abc-123/stream",
      );
      await route.GET(req, { params: { id: "track-abc-123" } });

      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: "test-bucket",
          Key: mockTrack.audio_storage_key,
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("passes 900-second TTL to presigned URL generation", async () => {
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    try {
      mockGetSignedUrl.mockResolvedValue(PRE_SIGNED_URL);
      mockPrisma.track.findUnique.mockResolvedValue(mockTrack);

      const req = new NextRequest(
        "http://localhost:3000/api/v1/tracks/track-abc-123/stream",
      );
      await route.GET(req, { params: { id: "track-abc-123" } });

      const [
        ,
        ,
        opts,
      ] = mockGetSignedUrl.mock.calls[0] as [
        unknown,
        unknown,
        { expiresIn?: number },
      ];
      expect(opts.expiresIn).toBe(900);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns 500 on presigned URL generation failure", async () => {
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    try {
      mockGetSignedUrl.mockRejectedValue(
        new StorageError("S3 signing failed", "InternalError"),
      );
      mockPrisma.track.findUnique.mockResolvedValue(mockTrack);

      const req = new NextRequest(
        "http://localhost:3000/api/v1/tracks/track-abc-123/stream",
      );
      const response = await route.GET(req, {
        params: { id: "track-abc-123" },
      });

      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("STORAGE_ERROR");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
