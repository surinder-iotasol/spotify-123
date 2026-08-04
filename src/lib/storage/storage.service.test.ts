import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  StorageConfig,
  UploadParams,
  PresignedUrlResult,
  SignedUrlOptions,
} from "./storage.service";
import { S3StorageService } from "./storage.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
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
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    endpoint: "https://s3.us-east-1.amazonaws.com",
    ...overrides,
  };
}

function makeParams(overrides?: Partial<UploadParams>): UploadParams {
  return {
    key: "audio/artist-1/track-1.mp3",
    contentType: "audio/mpeg",
    body: new Uint8Array([0x49, 0x44, 0x33]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("S3StorageService", () => {
  let service: S3StorageService;
  let mockS3Client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new S3StorageService();

    mockS3Client = {
      send: vi.fn().mockResolvedValue({}),
    };
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockS3Client,
    );
  });

  // -----------------------------------------------------------------------
  // uploadObject
  // -----------------------------------------------------------------------

  describe("uploadObject", () => {
    it("creates S3Client with config credentials and endpoint", async () => {
      const config = makeConfig();
      const params = makeParams();

      await service.uploadObject(config, params);

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: config.region,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
          endpoint: config.endpoint,
        }),
      );
    });

    it("sends PutObjectCommand with key, body, and contentType", async () => {
      const config = makeConfig();
      const params = makeParams();

      await service.uploadObject(config, params);

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: config.bucket,
          Key: params.key,
          ContentType: params.contentType,
          Body: params.body,
        }),
      );
    });

    it("returns key and presigned PUT URL from getSignedUrl", async () => {
      const config = makeConfig();
      const params = makeParams();
      const mockUrl =
        "https://test-bucket.s3.us-east-1.amazonaws.com/audio%2Fartist-1%2Ftrack-1.mp3?AWSAccessKeyId=AKIA&Signature=abc&Expires=1700000000";
      (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

      const result = await service.uploadObject(config, params);

      expect(result.key).toBe(params.key);
      expect(result.url).toBe(mockUrl);

      // getSignedUrl(client, command, options)
      expect(getSignedUrl).toHaveBeenCalledTimes(1);
      const [cmd, , opts] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
        .calls[0] as [typeof mockS3Client, unknown, { expiresIn: number }];
      expect(cmd).toBe(mockS3Client);
      expect(opts.expiresIn).toBe(3600);
    });
  });

  // -----------------------------------------------------------------------
  // deleteObject
  // -----------------------------------------------------------------------

  describe("deleteObject", () => {
    it("creates S3Client and sends DeleteObjectCommand", async () => {
      const config = makeConfig();
      const key = "audio/old-track.mp3";

      await service.deleteObject(config, key);

      expect(S3Client).toHaveBeenCalled();
      expect(DeleteObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: config.bucket,
          Key: key,
        }),
      );
      expect(mockS3Client.send).toHaveBeenCalledWith(
        expect.any(DeleteObjectCommand),
      );
    });
  });

  // -----------------------------------------------------------------------
  // generateSignedUrl  —  PUT (upload)
  // -----------------------------------------------------------------------

  describe("generateSignedUrl — PUT (upload)", () => {
    it("produces a presigned PUT URL with 3600-second TTL by default", async () => {
      const config = makeConfig();
      const key = "audio/artist/track.mp3";
      const mockUrl =
        "https://test-bucket.s3.amazonaws.com/audio%2Fartist%2Ftrack.mp3?X-Amz-Signature=abc";
      (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

      const result = await service.generateSignedUrl(config, key, { method: "PUT" });

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: config.bucket,
          Key: key,
        }),
      );
      expect(result.method).toBe("PUT");
      expect(result.url).toBe(mockUrl);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("passes through the requested TTL for PUT (no cap on upload URLs)", async () => {
      const config = makeConfig();
      const key = "audio/track.mp3";
      const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
      (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

      await service.generateSignedUrl(config, key, {
        method: "PUT",
        expiresIn: 7200,
      });

      const [, , opts] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
        .calls[0] as [unknown, unknown, { expiresIn?: number }];
      expect(opts.expiresIn).toBe(7200);
    });
  });

  // -----------------------------------------------------------------------
  // generateSignedUrl  —  GET (streaming)
  // -----------------------------------------------------------------------

  describe("generateSignedUrl — GET (streaming)", () => {
    it("produces a presigned GET URL for streaming", async () => {
      const config = makeConfig();
      const key = "audio/artist/track.mp3";
      const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
      (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

      const result = await service.generateSignedUrl(config, key, {
        method: "GET",
        expiresIn: 900,
      });

      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: config.bucket,
          Key: key,
        }),
      );
      expect(result.method).toBe("GET");
      expect(result.url).toBe(mockUrl);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 900_000,
      );
    });

    it("enforces 3600-second TTL cap for getObject streaming delivery URLs", async () => {
      const config = makeConfig();
      const key = "audio/stream.mp3";
      const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
      (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

      await service.generateSignedUrl(config, key, {
        method: "GET",
        expiresIn: 7200,
      });

      const [, , opts] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
        .calls[0] as [typeof mockS3Client, GetObjectCommand, { expiresIn?: number }];
      expect(opts.expiresIn).toBe(3600);
    });

    it("defaults to PUT method when method is omitted", async () => {
      const config = makeConfig();
      const key = "audio/stream.mp3";
      const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
      (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

      const result = await service.generateSignedUrl(config, key);

      expect(result.method).toBe("PUT");
    });
  });

  // -----------------------------------------------------------------------
  // PresignedUrlResult shape
  // -----------------------------------------------------------------------

  describe("PresignedUrlResult", () => {
    it("returns url, method, and expiresAt matching the interface", async () => {
      const config = makeConfig();
      const key = "file.mp3";
      const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
      (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

      const result = await service.generateSignedUrl(config, key, { method: "PUT" });

      expect(typeof result.url).toBe("string");
      expect(result.url).toBe(mockUrl);
      expect(result.method).toBe("PUT");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });
});
