import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ObjectMetadata,
  StorageConfig,
  StorageProviderInterface,
  UploadParams,
} from "./storage.service";
import {
  S3StorageProvider,
  createStorageProvider,
} from "./storage.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
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
// S3StorageProvider — interface contract
// ---------------------------------------------------------------------------

describe("S3StorageProvider implements StorageProviderInterface", () => {
  it("exposes all StorageProviderInterface methods", () => {
    const provider: StorageProviderInterface = new S3StorageProvider();

    // Verify all required methods exist
    expect(typeof provider.generatePresignedUploadUrl).toBe("function");
    expect(typeof provider.generatePresignedDownloadUrl).toBe("function");
    expect(typeof provider.deleteObject).toBe("function");
    expect(typeof provider.getObjectMetadata).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// generatePresignedUploadUrl
// ---------------------------------------------------------------------------

describe("generatePresignedUploadUrl", () => {
  let provider: S3StorageProvider;
  let mockS3Client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3StorageProvider();
    mockS3Client = { send: vi.fn().mockResolvedValue({}) };
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockS3Client,
    );
  });

  it("produces a presigned PUT URL with default 3600-second TTL", async () => {
    const config = makeConfig();
    const key = "audio/artist/track.mp3";
    const mockUrl =
      "https://test-bucket.s3.amazonaws.com/audio%2Ftrack.mp3?X-Amz-Signature=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    const result = await provider.generatePresignedUploadUrl(config, key);

    expect(result.url).toBe(mockUrl);
    expect(result.method).toBe("PUT");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verify getSignedUrl was called with 3600-second TTL
    const [, , opts] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, unknown, { expiresIn?: number }];
    expect(opts.expiresIn).toBe(3600);
  });

  it("respects a custom TTL", async () => {
    const config = makeConfig();
    const key = "audio/track.mp3";
    const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    await provider.generatePresignedUploadUrl(config, key, { expiresIn: 7200 });

    const [, , opts] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, unknown, { expiresIn?: number }];
    expect(opts.expiresIn).toBe(7200);
  });

  it("uses PutObjectCommand for upload", async () => {
    const config = makeConfig();
    const key = "audio/track.mp3";
    const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    await provider.generatePresignedUploadUrl(config, key);

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: config.bucket,
        Key: key,
        ContentType: "application/octet-stream",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// generatePresignedDownloadUrl
// ---------------------------------------------------------------------------

describe("generatePresignedDownloadUrl", () => {
  let provider: S3StorageProvider;
  let mockS3Client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3StorageProvider();
    mockS3Client = { send: vi.fn().mockResolvedValue({}) };
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockS3Client,
    );
  });

  it("produces a presigned GET URL for download", async () => {
    const config = makeConfig();
    const key = "audio/artist/track.mp3";
    const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    const result = await provider.generatePresignedDownloadUrl(config, key);

    expect(result.url).toBe(mockUrl);
    expect(result.method).toBe("GET");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("enforces 3600-second TTL cap for download URLs", async () => {
    const config = makeConfig();
    const key = "audio/stream.mp3";
    const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    await provider.generatePresignedDownloadUrl(config, key, {
      expiresIn: 7200,
    });

    const [, , opts] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, unknown, { expiresIn?: number }];
    expect(opts.expiresIn).toBe(3600);
  });

  it("passes through a valid TTL below the cap", async () => {
    const config = makeConfig();
    const key = "audio/stream.mp3";
    const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    await provider.generatePresignedDownloadUrl(config, key, {
      expiresIn: 900,
    });

    const [, , opts] = (getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, unknown, { expiresIn?: number }];
    expect(opts.expiresIn).toBe(900);
  });

  it("uses GetObjectCommand for download", async () => {
    const config = makeConfig();
    const key = "audio/track.mp3";
    const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    await provider.generatePresignedDownloadUrl(config, key);

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: config.bucket,
        Key: key,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getObjectMetadata
// ---------------------------------------------------------------------------

describe("getObjectMetadata", () => {
  let provider: S3StorageProvider;
  let mockS3Client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3StorageProvider();
    mockS3Client = { send: vi.fn() };
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockS3Client,
    );
  });

  it("returns ContentLength, ContentType, and ETag from HeadObject", async () => {
    const config = makeConfig();
    const key = "audio/artist/track.mp3";
    const contentLength = 5_242_880;
    const contentType = "audio/mpeg";
    const eTag = "d41d8cd98f00b204e9800998ecf8427e";

    mockS3Client.send.mockResolvedValue({
      ContentLength: contentLength,
      ContentType: contentType,
      ETag: eTag,
    });

    const result = await provider.getObjectMetadata(config, key);

    expect(result).toEqual({
      contentLength,
      contentType,
      eTag,
    });
    expect(HeadObjectCommand).toHaveBeenCalledOnce();
    expect(HeadObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: config.bucket, Key: key }),
    );
  });

  it("defaults missing values to safe fallbacks", async () => {
    const config = makeConfig();
    const key = "audio/track.mp3";

    mockS3Client.send.mockResolvedValue({});

    const result = await provider.getObjectMetadata(config, key);

    expect(result.contentLength).toBe(0);
    expect(result.contentType).toBe("");
    expect(result.eTag).toBe("");
  });
});

// ---------------------------------------------------------------------------
// deleteObject  —  required on StorageProvider
// ---------------------------------------------------------------------------

describe("deleteObject", () => {
  let provider: S3StorageProvider;
  let mockS3Client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3StorageProvider();
    mockS3Client = { send: vi.fn().mockResolvedValue({}) };
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockS3Client,
    );
  });

  it("sends DeleteObjectCommand with bucket and key", async () => {
    const config = makeConfig();
    const key = "audio/old-track.mp3";

    await provider.deleteObject(config, key);

    expect(DeleteObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: config.bucket, Key: key }),
    );
    expect(mockS3Client.send).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PresignedUrlResult shape
// ---------------------------------------------------------------------------

describe("PresignedUrlResult", () => {
  let provider: S3StorageProvider;
  let mockS3Client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new S3StorageProvider();
    mockS3Client = { send: vi.fn().mockResolvedValue({}) };
    (S3Client as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockS3Client,
    );
  });

  it("returns url, method, and expiresAt matching the interface", async () => {
    const config = makeConfig();
    const key = "file.mp3";
    const mockUrl = "https://bucket.s3.amazonaws.com/key?sig=abc";
    (getSignedUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUrl);

    const result = await provider.generatePresignedUploadUrl(config, key);

    expect(typeof result.url).toBe("string");
    expect(result.method).toBe("PUT");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// createStorageProvider factory
// ---------------------------------------------------------------------------

describe("createStorageProvider", () => {
  it("returns an instance implementing StorageProviderInterface", () => {
    const config = makeConfig();
    const provider = createStorageProvider(config);
    expect(provider).toBeInstanceOf(S3StorageProvider);

    // Verify the returned instance implements the full interface
    const p: StorageProviderInterface = provider;
    expect(typeof p.generatePresignedUploadUrl).toBe("function");
    expect(typeof p.generatePresignedDownloadUrl).toBe("function");
    expect(typeof p.deleteObject).toBe("function");
    expect(typeof p.getObjectMetadata).toBe("function");
  });

  it("works with STORAGE_PROVIDER set to 's3'", () => {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    try {
      const config = makeConfig();
      const provider = createStorageProvider(config);
      expect(provider).toBeInstanceOf(S3StorageProvider);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("works with STORAGE_PROVIDER set to 'r2'", () => {
    vi.stubEnv("STORAGE_PROVIDER", "r2");
    try {
      const config = makeConfig();
      const provider = createStorageProvider(config);
      expect(provider).toBeInstanceOf(S3StorageProvider);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("defaults gracefully when STORAGE_PROVIDER is unset", () => {
    const config = makeConfig();
    const provider = createStorageProvider(config);
    expect(provider).toBeInstanceOf(S3StorageProvider);
  });
});
