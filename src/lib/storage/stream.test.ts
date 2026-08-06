/**
 * Unit + integration tests for the stream endpoint logic.
 *
 * Covers:
 * - Presigned GET URL generation with 900-second (15-minute) TTL
 * - TTL cap enforcement at 3600 seconds
 * - Missing / empty track ID → 404
 * - Response headers: Accept-Ranges: bytes, Cache-Control
 * - Track key resolution
 * - Integration: full handler flow with mock AWS SDK
 *
 * @module lib/storage/stream
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StreamQueryParams } from "./stream";
import {
  generateStreamUrl,
  handleStream,
  makeStreamRequest,
  makeStreamRequestWithTtl,
  resolveTrackObjectKey,
  STREAM_URL_TTL,
} from "./stream";

// ---------------------------------------------------------------------------
// AWS SDK mocks
// ---------------------------------------------------------------------------

const mockClientSend = vi.fn();
const mockGetSignedUrl = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: mockClientSend,
  })),
  GetObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("defines STREAM_URL_TTL as 900 seconds (15 minutes)", () => {
    expect(STREAM_URL_TTL).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// resolveTrackObjectKey
// ---------------------------------------------------------------------------

describe("resolveTrackObjectKey", () => {
  it("returns a deterministic key for a given track ID", () => {
    expect(resolveTrackObjectKey("track-42")).toBe("audio/artist-1/track-42.mp3");
  });

  it("handles track IDs with hyphens", () => {
    expect(resolveTrackObjectKey("abc-def-123")).toBe("audio/artist-1/abc-def-123.mp3");
  });
});

// ---------------------------------------------------------------------------
// generateStreamUrl — presigned URL generation
// ---------------------------------------------------------------------------

describe("generateStreamUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue(
      "https://test-bucket.s3.amazonaws.com/audio%2Ftrack.mp3?X-Amz-Signature=abc123",
    );
  });

  it("generates a presigned GET URL with 900-second TTL by default", async () => {
    const input = makeStreamRequest("track-1");
    const result = await generateStreamUrl(input);

    expect(result).not.toBeNull();
    expect(result!.url).toContain("X-Amz-Signature");
    expect(result!.trackId).toBe("track-1");
    expect(result!.objectKey).toBe("audio/artist-1/track-1.mp3");
    expect(result!.expiresIn).toBe(900);
    expect(result!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("uses the S3 Client with correct config", async () => {
    const input = makeStreamRequest("track-1");
    await generateStreamUrl(input);

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "us-east-1",
        credentials: {
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        },
      }),
    );
  });

  it("issues a GetObjectCommand for the track key", async () => {
    const input = makeStreamRequest("track-1");
    await generateStreamUrl(input);

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "test-bucket",
        Key: "audio/artist-1/track-1.mp3",
      }),
    );
  });

  it("respects a custom TTL below the cap", async () => {
    const input = makeStreamRequestWithTtl("track-1", 600);
    const result = await generateStreamUrl(input);

    const resultFirstCall = mockGetSignedUrl.mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn?: number },
    ];
    const opts = resultFirstCall[2];
    expect(opts.expiresIn).toBe(600);
  });

  it("caps an oversized TTL at 3600 seconds", async () => {
    const input = makeStreamRequestWithTtl("track-1", 7200);
    const result = await generateStreamUrl(input);

    expect(result!.expiresIn).toBe(3600);
    const [, , opts] = mockGetSignedUrl.mock.calls[0] as
      [unknown, unknown, { expiresIn?: number }];
    expect(opts.expiresIn).toBe(3600);
  });

  it("returns null when track ID is missing", async () => {
    const input = {
      params: {} as Record<string, string>,
      config: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    };
    const result = await generateStreamUrl(input);
    expect(result).toBeNull();
  });

  it("returns null when track ID is empty string", async () => {
    const input = makeStreamRequest("");
    const result = await generateStreamUrl(input);
    expect(result).toBeNull();
  });

  it("returns null when track ID is whitespace only", async () => {
    const input = {
      params: { id: "   " },
      config: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    };
    const result = await generateStreamUrl(input);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleStream — full response handling
// ---------------------------------------------------------------------------

describe("handleStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue(
      "https://test-bucket.s3.amazonaws.com/key?sig=xyz",
    );
  });

  it("returns 200 with presigned URL and streaming headers on success", async () => {
    const input = makeStreamRequest("track-1");
    const result = await handleStream(input);

    expect(result.status).toBe(200);
    expect(result.headers["Accept-Ranges"]).toBe("bytes");
    expect(result.headers["Cache-Control"]).toBe("private, max-age=900");

    // Verify response body structure.
    const body = result.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(typeof data.url).toBe("string");
    expect(data.trackId).toBe("track-1");
    expect(data.objectKey).toBe("audio/artist-1/track-1.mp3");
  });

  it("errors with 404 when track ID is missing", async () => {
    const input = {
      params: {} as Record<string, string>,
      config: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    };
    const result = await handleStream(input);

    expect(result.status).toBe(404);
    const body = result.body as Record<string, unknown>;
    expect(body.success).toBe(false);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("TRACK_NOT_FOUND");
  });

  it("always sets Accept-Ranges and Cache-Control headers even on error", async () => {
    const input = {
      params: {} as Record<string, string>,
      config: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    };
    const result = await handleStream(input);

    expect(result.headers["Accept-Ranges"]).toBe("bytes");
    expect(result.headers["Cache-Control"]).toBe("private, max-age=900");
  });

  it("respects custom TTL query parameter with correct Cache-Control", async () => {
    const input = makeStreamRequestWithTtl("track-1", 300);
    const result = await handleStream(input);

    expect(result.status).toBe(200);
    const data = (result.body as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.expiresIn).toBe(300);
    // Cache-Control always uses STREAM_URL_TTL (900) regardless of custom TTL.
    expect(result.headers["Cache-Control"]).toBe("private, max-age=900");
  });
});

// ---------------------------------------------------------------------------
// Integration test — simulate Next.js route handler behaviour
// ---------------------------------------------------------------------------

describe("Integration — simulate Next.js route layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue(
      "https://test-bucket.s3.amazonaws.com/audio%2Ftrack.mp3?X-Amz-Signature=ok",
    );
  });

  it("returns correct status, headers, and presigned URL payload for a valid track", async () => {
    const input = makeStreamRequest("audio-42");
    const result = await handleStream(input);

    // Simulate what the Next.js route handler does with the result.
    const responseHeaders = new Headers({
      "Content-Type": "application/json",
      ...result.headers,
    });

    expect(result.status).toBe(200);
    expect(responseHeaders.get("Accept-Ranges")).toBe("bytes");
    expect(responseHeaders.get("Cache-Control")).toBe("private, max-age=900");

    const body = JSON.parse(JSON.stringify(result.body));
    expect(body.success).toBe(true);
    expect(body.data.url).toContain("X-Amz-Signature");
    expect(body.data.trackId).toBe("audio-42");
  });

  it("sends 404 when the track ID parameter is absent", async () => {
    const input = {
      params: {} as Record<string, string>,
      config: {
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    };
    const result = await handleStream(input);
    expect(result.status).toBe(404);
  });

  it("S3Client is created without endpoint for test-bucket", async () => {
    const input = makeStreamRequest("track-99");
    await handleStream(input);

    expect(S3Client).toHaveBeenCalledWith(
      expect.not.objectContaining({ endpoint: expect.any(String) }),
    );
  });
});
