/**
 * Unit tests: Presigned stream URL generation helpers.
 *
 * STORY-storage-003 — Presigned playback stream URL endpoint.
 *
 * Verifies the S3 client construction, GetObjectCommand parameterisation,
 * and TTL enforcement behaviour of the AWS SDK helpers at the service
 * layer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageConfig } from "@/lib/storage/storage.service";
import { S3StorageProvider } from "@/lib/storage/storage.service";

// ---------------------------------------------------------------------------
// Mocks — AWS SDK
// ---------------------------------------------------------------------------

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<StorageConfig>): StorageConfig {
  return {
    bucket: "test-bucket",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey:
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    endpoint: "https://s3.us-east-1.amazonaws.com",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateStreamUrl — presigned GET URL generation
// ---------------------------------------------------------------------------

describe("generateStreamUrl", () => {
  let provider: S3StorageProvider;
  const MOCK_URL: string = `https://testbucket.s3.amazonaws.com/file.mp3?sig=xyz`;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3StorageProvider();
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ send: vi.fn().mockResolvedValue({}) }),
    );
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_URL);
  });

  it("uses GetObjectCommand for stream URLs", async () => {
    const config = makeConfig();
    const key = "audio/artist/track.mp3";

    await provider.generatePresignedDownloadUrl(config, key, {
      method: "GET",
    });

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: config.bucket,
        Key: key,
      }),
    );
  });

  it("enforces the 3600-second system TTL cap on presigned URLs", async () => {
    const config = makeConfig();
    const key = "audio/stream.mp3";

    await provider.generatePresignedDownloadUrl(config, key);

    const [
      ,
      ,
      opts,
    ] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, unknown, { expiresIn?: number }];

    // The provider caps all presigned URLs at 3600 seconds
    expect(opts.expiresIn).toBe(3600);
  });

  it("passes a valid sub-cap TTL through unchanged", async () => {
    const config = makeConfig();
    const key = "audio/stream.mp3";

    await provider.generatePresignedDownloadUrl(config, key, {
      expiresIn: 900,
    });

    const [
      ,
      ,
      opts,
    ] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, unknown, { expiresIn?: number }];

    expect(opts.expiresIn).toBe(900);
  });

  it("caps requesting more than 3600 seconds down to the system cap", async () => {
    const config = makeConfig();
    const key = "audio/stream.mp3";

    await provider.generatePresignedDownloadUrl(config, key, {
      expiresIn: 7200,
    });

    const [
      ,
      ,
      opts,
    ] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, unknown, { expiresIn?: number }];

    expect(opts.expiresIn).toBe(3600);
  });

  it("returns url, method=GET, and expiresAt matching PresignedUrlResult", async () => {
    const config = makeConfig();
    const key = "file.mp3";

    const result = await provider.generatePresignedDownloadUrl(config, key, {
      method: "GET",
    });

    expect(typeof result.url).toBe("string");
    expect(result.url).toBe(MOCK_URL);
    expect(result.method).toBe("GET");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// ErrorResponse — presigned URL generation failure
// ---------------------------------------------------------------------------

describe("ErrorResponse on presigned URL generation failure", () => {
  let provider: S3StorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3StorageProvider();
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({ send: vi.fn().mockResolvedValue({}) }),
    );
  });

  it("throws StorageError when getSignedUrl fails", async () => {
    const config = makeConfig();
    const key = "audio/missing/track.mp3";

    (getSignedUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("S3 signing failed"),
    );

    await expect(
      provider.generatePresignedDownloadUrl(config, key),
    ).rejects.toThrow("S3 signing failed");
  });
});
