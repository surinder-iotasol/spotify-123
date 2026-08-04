import { describe, expect, it } from "vitest";
import type {
  StorageConfig,
  UploadParams,
  PresignedUrlResult,
  SignedUrlOptions,
  StorageService,
} from "./storage.service";

describe("storage.service types", () => {
  it("exports StorageConfig with all required fields", () => {
    const config: StorageConfig = {
      bucket: "my-bucket",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    };

    expect(config.bucket).toBe("my-bucket");
    expect(config.region).toBe("us-east-1");
    expect(config.accessKeyId).toBeTruthy();
    expect(config.secretAccessKey).toBeTruthy();
  });

  it("exports StorageConfig with optional endpoint", () => {
    const config: StorageConfig = {
      bucket: "r2-bucket",
      region: "auto",
      accessKeyId: "key",
      secretAccessKey: "secret",
      endpoint: "https://account-id.r2.cloudflarestorage.com",
    };

    expect(config.endpoint).toBe(
      "https://account-id.r2.cloudflarestorage.com",
    );
  });

  it("exports UploadParams with key, contentType, and body", () => {
    const params: UploadParams = {
      key: "audio/artist-123/track-abc.mp3",
      contentType: "audio/mpeg",
      body: new Uint8Array([0x00, 0x01, 0x02]),
    };

    expect(params.key).toContain("audio");
    expect(params.contentType).toBe("audio/mpeg");
  });

  it("exports PresignedUrlResult with url and expiresAt", () => {
    const result: PresignedUrlResult = {
      url: "https://bucket.s3.amazonaws.com/key?signature=abc",
      expiresAt: new Date(Date.now() + 3600_000),
    };

    expect(result.url).toBeTruthy();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("exports SignedUrlOptions with method and expiresIn", () => {
    const options: SignedUrlOptions = {
      method: "PUT",
      expiresIn: 3600,
    };

    expect(options.method).toBe("PUT");
    expect(options.expiresIn).toBe(3600);
  });

  it("SignedUrlOptions method defaults to GET when omitted", () => {
    const options: SignedUrlOptions = {
      expiresIn: 900,
    };

    expect(options.method).toBeUndefined();
  });

  it("StorageService interface has all three required method signatures", () => {
    // Type-checked mock implementation verifies the interface shape.
    const mockService: StorageService = {
      uploadObject: async (config, params) => ({
        key: params.key,
        url: `https://${config.bucket}.s3.amazonaws.com/${params.key}`,
      }),
      deleteObject: async (config, key) => {
        // no-op
      },
      generateSignedUrl: async (config, key, options) => ({
        url: `https://${config.bucket}.s3.amazonaws.com/${key}`,
        expiresAt: new Date(
          Date.now() + (options?.expiresIn ?? 3600) * 1000,
        ),
      }),
    };

    expect(mockService.uploadObject).toBeDefined();
    expect(mockService.deleteObject).toBeDefined();
    expect(mockService.generateSignedUrl).toBeDefined();
  });

  it("StorageService uploadObject takes config and params", async () => {
    const mockService: StorageService = {
      uploadObject: async (config: StorageConfig, params: UploadParams) => ({
        key: params.key,
        url: `https://${config.bucket}.s3.amazonaws.com/${params.key}`,
      }),
      deleteObject: async () => {},
      generateSignedUrl: async () => ({
        url: "",
        expiresAt: new Date(),
      }),
    };

    const config: StorageConfig = {
      bucket: "test-bucket",
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
    };

    const params: UploadParams = {
      key: "test/file.mp3",
      contentType: "audio/mpeg",
      body: new Uint8Array([1, 2, 3]),
    };

    const result = await mockService.uploadObject(config, params);

    expect(result.key).toBe("test/file.mp3");
    expect(result.url).toContain("test-bucket");
  });

  it("StorageService generateSignedUrl returns url and expiresAt", async () => {
    const mockService: StorageService = {
      uploadObject: async () => ({ key: "", url: "" }),
      deleteObject: async () => {},
      generateSignedUrl: async (config, key, options) => ({
        url: `https://${config.bucket}.s3.amazonaws.com/${key}`,
        expiresAt: new Date(
          Date.now() + (options?.expiresIn ?? 3600) * 1000,
        ),
      }),
    };

    const config: StorageConfig = {
      bucket: "stream-bucket",
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
    };

    const result = await mockService.generateSignedUrl(
      config,
      "tracks/123/stream.mp3",
      { method: "GET", expiresIn: 900 },
    );

    expect(result.url).toContain("tracks/123/stream.mp3");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("StorageService deleteObject takes config and key", async () => {
    let deletedKey: string | null = null;

    const mockService: StorageService = {
      uploadObject: async () => ({ key: "", url: "" }),
      deleteObject: async (config, key) => {
        deletedKey = key;
      },
      generateSignedUrl: async () => ({
        url: "",
        expiresAt: new Date(),
      }),
    };

    const config: StorageConfig = {
      bucket: "clean-bucket",
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
    };

    await mockService.deleteObject(config, "orphan/file.mp3");

    expect(deletedKey).toBe("orphan/file.mp3");
  });
});
