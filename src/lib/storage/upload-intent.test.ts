/**
 * Unit tests for the upload-intent endpoint logic.
 *
 * Covers:
 * - Valid payloads for audio (MP3/WAV) and images (JPEG/PNG/WebP)
 * - Genre-specific MIME-type allowlists
 * - Size limits (50 MB audio / 10 MB images)
 * - Object key format (audio/… vs images/…)
 * - Invalid type / MIME / size → 422 with ValidationErrorDetail array
 * - Path traversal rejection in fileName
 * - Full handler flow: schema + rules + presigned URL generation
 *
 * @module lib/storage/upload-intent
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { UploadIntentRequest } from "./upload-intent";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_AUDIO_FILE_SIZE,
  MAX_IMAGE_FILE_SIZE,
  validateUploadIntent,
} from "./upload-intent";
import {
  handleUploadIntent,
  makeUploadIntentRequest,
} from "./upload-intent";
import {
  apiErrorResponse,
  type ApiErrorResponse,
} from "../api/response";

// ---------------------------------------------------------------------------
// AWS SDK mocks
// ---------------------------------------------------------------------------

const mockClientSend = vi.fn();
const mockGetSignedUrl = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: mockClientSend,
  })),
  PutObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a valid upload-intent request body with optional overrides.
 */
function validRequest(overrides?: Partial<UploadIntentRequest>): UploadIntentRequest {
  return {
    fileType: "audio",
    fileName: "track-name.mp3",
    fileSizeBytes: 5_242_880,
    mimeType: "audio/mpeg",
    artistId: "artist-1",
    resourceId: "track-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("upload-intent constants", () => {
  it("defines MAX_AUDIO_FILE_SIZE as 50 MB", () => {
    expect(MAX_AUDIO_FILE_SIZE).toBe(50 * 1024 * 1024); // 52 428 800
  });

  it("defines MAX_IMAGE_FILE_SIZE as 10 MB", () => {
    expect(MAX_IMAGE_FILE_SIZE).toBe(10 * 1024 * 1024); // 10 485 760
  });

  it("allows only MP3 and WAV for audio", () => {
    expect(ALLOWED_AUDIO_MIME_TYPES).toEqual(["audio/mpeg", "audio/wav"]);
  });

  it("allows JPEG, PNG, and WebP for images", () => {
    expect(ALLOWED_IMAGE_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});

// ---------------------------------------------------------------------------
// validateUploadIntent — schema validation
// ---------------------------------------------------------------------------

describe("validateUploadIntent — schema validation", () => {
  it("rejects request missing fileName", () => {
    const result = validateUploadIntent({ fileType: "audio", fileSizeBytes: 123, mimeType: "audio/mpeg", artistId: "a", resourceId: "r" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "body.fileName")).toBe(true);
    }
  });

  it("rejects request with invalid fileType", () => {
    const result = validateUploadIntent(validRequest({ fileType: "video" as unknown as "audio" }));
    expect(result.success).toBe(false);
  });

  it("accepts valid audio request", () => {
    const result = validateUploadIntent(validRequest());
    expect(result.success).toBe(true);
  });

  it("accepts valid image request", () => {
    const result = validateUploadIntent(
      validRequest({ fileType: "image", mimeType: "image/jpeg", fileName: "cover.jpg", fileSizeBytes: 1024 }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateUploadIntent — business rules
// ---------------------------------------------------------------------------

describe("validateUploadIntent — business rules", () => {
  // Audio MIME-type checks
  it("rejects FLAC audio (not in allowlist)", () => {
    const result = validateUploadIntent(
      validRequest({ mimeType: "audio/flac" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "body.mimeType" && e.code === "INVALID_AUDIO_MIME_TYPE")).toBe(true);
    }
  });

  it("rejects OGG audio (not in allowlist)", () => {
    const result = validateUploadIntent(
      validRequest({ mimeType: "audio/ogg" }),
    );
    expect(result.success).toBe(false);
  });

  // Image MIME-type checks
  it("rejects GIF image (not in allowlist)", () => {
    const result = validateUploadIntent(
      validRequest({ fileType: "image", mimeType: "image/gif" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "body.mimeType" && e.code === "INVALID_IMAGE_MIME_TYPE")).toBe(true);
    }
  });

  it("rejects unsupported file type", () => {
    const result = validateUploadIntent({
      fileType: "video" as unknown as "audio",
      fileName: "clip.mp4",
      fileSizeBytes: 1000,
      mimeType: "video/mp4",
      artistId: "a",
      resourceId: "r",
    });
    expect(result.success).toBe(false);
  });

  // Size checks
  it("rejects audio over 50 MB", () => {
    const result = validateUploadIntent(
      validRequest({ fileSizeBytes: MAX_AUDIO_FILE_SIZE + 1 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "body.fileSizeBytes" && e.code === "FILE_TOO_LARGE")).toBe(true);
    }
  });

  it("rejects image over 10 MB", () => {
    const result = validateUploadIntent(
      validRequest({ fileType: "image", mimeType: "image/jpeg", fileSizeBytes: MAX_IMAGE_FILE_SIZE + 1 }),
    );
    expect(result.success).toBe(false);
  });

  // Valid size edge case
  it("accepts audio at exactly 50 MB", () => {
    const result = validateUploadIntent(
      validRequest({ fileSizeBytes: MAX_AUDIO_FILE_SIZE }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts image at exactly 10 MB", () => {
    const result = validateUploadIntent(
      validRequest({ fileType: "image", mimeType: "image/jpeg", fileSizeBytes: MAX_IMAGE_FILE_SIZE }),
    );
    expect(result.success).toBe(true);
  });

  // Object key format
  it("generates audio key pattern audio/{artistId}/{resourceId}_{safeName}.mp3", () => {
    const result = validateUploadIntent({
      ...validRequest({ fileName: "My Track.mp3", fileType: "audio" }),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.objectKey).toBe("audio/artist-1/track-1_My+Track.mp3");
    }
  });

  it("generates image key pattern images/{artistId}/{resourceId}_{safeName}.webp", () => {
    const result = validateUploadIntent({
      ...validRequest({
        fileType: "image",
        mimeType: "image/jpeg",
        fileName: "cover.jpg",
        artistId: "artist-2",
        resourceId: "img-42",
      }),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.objectKey).toBe("images/artist-2/img-42_cover.webp");
    }
  });

  // Path traversal prevention
  it("rejects fileName containing ../ for path traversal", () => {
    const result = validateUploadIntent(
      validRequest({ fileName: "../../etc/passwd.mp3" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.field === "body.fileName" && e.code === "INVALID_FILENAME")).toBe(true);
    }
  });

  it("rejects fileName containing ..\\ for path traversal", () => {
    const result = validateUploadIntent(
      validRequest({ fileName: "..\\sneaky.mp3" }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleUploadIntent — full handler flow
// ---------------------------------------------------------------------------

describe("handleUploadIntent", () => {
  beforeEach(() => {
    mockClientSend.mockReset();
    mockGetSignedUrl.mockReset();
    mockGetSignedUrl.mockResolvedValue("https://test-bucket.s3.amazonaws.com/key?X-Amz-Signature=abc");
  });

  it("returns 200 with presigned URL for a valid audio upload", async () => {
    const req = makeUploadIntentRequest({
      fileType: "audio",
      fileName: "track.mp3",
      fileSizeBytes: 1_000_000,
      mimeType: "audio/mpeg",
      artistId: "artist-1",
      resourceId: "track-1",
    });

    const res = await handleUploadIntent(req);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(typeof (body as Record<string, unknown>).data!.url).toBe("string");
    expect(typeof (body as Record<string, unknown>).data!.objectKey).toBe("string");
  });

  it("calls S3Client with correct credentials on valid upload", async () => {
    const req = makeUploadIntentRequest({
      fileType: "audio",
      fileName: "x.mp3",
      fileSizeBytes: 1000,
      mimeType: "audio/wav",
      artistId: "a",
      resourceId: "r",
    });

    await handleUploadIntent(req);

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

  it("rejects upload with invalid MIME type", async () => {
    const req = makeUploadIntentRequest({
      fileType: "audio",
      fileName: "x.flac",
      fileSizeBytes: 1000,
      mimeType: "audio/flac", // not allowed
      artistId: "a",
      resourceId: "r",
    });

    const res = await handleUploadIntent(req);

    expect(res.status).toBe(422);
    const body = res.body as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_AUDIO_MIME_TYPE");
    expect(body.error.details).toBeDefined();
    expect(body.error.details!.length).toBeGreaterThan(0);
  });

  it("rejects upload exceeding the audio size limit", async () => {
    const req = makeUploadIntentRequest({
      fileType: "audio",
      fileName: "x.mp3",
      fileSizeBytes: MAX_AUDIO_FILE_SIZE + 1,
      mimeType: "audio/mpeg",
      artistId: "a",
      resourceId: "r",
    });

    const res = await handleUploadIntent(req);

    expect(res.status).toBe(422);
    const body = res.body as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FILE_TOO_LARGE");
    expect(body.error.message).toContain("50 MB");
  });

  it("rejects upload with invalid fileName containing path traversal", async () => {
    const req = makeUploadIntentRequest({
      fileType: "audio",
      fileName: "../../../etc/passwd.mp3",
      fileSizeBytes: 1000,
      mimeType: "audio/mpeg",
      artistId: "a",
      resourceId: "r",
    });

    const res = await handleUploadIntent(req);

    expect(res.status).toBe(422);
    const body = res.body as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INVALID_FILENAME");
  });
});
