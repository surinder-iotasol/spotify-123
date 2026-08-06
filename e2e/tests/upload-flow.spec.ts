/**
 * Playwright E2E spec — upload-intent API validation.
 *
 * Verifies:
 * - Valid audio payload returns 200 with presigned URL
 * - Invalid audio (oversized, wrong MIME) returns 422
 * - Image validation works correctly
 *
 * Uses Playwright's network assert capabilities directly;
 * no real storage endpoint needed.
 *
 * @module e2e/tests/upload-flow
 */

import { test, expect } from "@playwright/test";

test.describe("upload-intent API", () => {
  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  test("returns 200 for valid MP3 audio payload", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "audio",
        fileName: "demo.mp3",
        fileSizeBytes: 5_000_000,
        mimeType: "audio/mpeg",
        artistId: "artist-1",
        resourceId: "track-1",
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("url");
    expect(body.data).toHaveProperty("objectKey");
    expect(body.data.objectKey).toContain("audio/artist-1/");
  });

  test("returns 200 for valid WAV audio payload", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "audio",
        fileName: "track.wav",
        fileSizeBytes: 3_000_000,
        mimeType: "audio/wav",
        artistId: "a",
        resourceId: "r",
      },
    });

    expect(response.status()).toBe(200);
    expect((await response.json()).success).toBe(true);
  });

  test("returns 200 for valid JPG image below cap", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "image",
        fileName: "photo.jpg",
        fileSizeBytes: 2_000_000,
        mimeType: "image/jpeg",
        artistId: "a",
        resourceId: "r",
      },
    });

    expect(response.status()).toBe(200);
  });

  test("returns 200 for exact 10 MB PNG image", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "image",
        fileName: "exact.png",
        fileSizeBytes: 10 * 1024 * 1024, // exactly at cap
        mimeType: "image/png",
        artistId: "a",
        resourceId: "r",
      },
    });

    // 10 MB <= 10 MB cap, so should pass validation
    expect(response.status()).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Validation rejections
  // ---------------------------------------------------------------------------

  test("rejects audio exceeding 50 MB with 422", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "audio",
        fileName: "huge.mp3",
        fileSizeBytes: 55 * 1024 * 1024,
        mimeType: "audio/mpeg",
        artistId: "a",
        resourceId: "r",
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FILE_TOO_LARGE");
  });

  test("rejects WebP image exceeding 10 MB", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "image",
        fileName: "big.webp",
        fileSizeBytes: 12 * 1024 * 1024,
        mimeType: "image/webp",
        artistId: "a",
        resourceId: "r",
      },
    });

    expect(response.status()).toBe(422);
    expect((await response.json()).error.code).toBe("FILE_TOO_LARGE");
  });

  test("rejects unsupported audio MIME type", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "audio",
        fileName: "bad.flac",
        fileSizeBytes: 5_000_000,
        mimeType: "audio/flac",
        artistId: "a",
        resourceId: "r",
      },
    });

    expect(response.status()).toBe(422);
    expect((await response.json()).error.code).toBe("INVALID_AUDIO_MIME_TYPE");
  });

  test("rejects invalid fileType", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "video",
        fileName: "bad.mp4",
        fileSizeBytes: 1_000_000,
        mimeType: "video/mp4",
        artistId: "a",
        resourceId: "r",
      },
    });

    expect(response.status()).toBe(422);
    expect((await response.json()).success).toBe(false);
  });

  test("rejects missing required fields", async ({ page }) => {
    const response = await page.request().post("/api/v1/storage/upload-intent", {
      data: {
        fileType: "audio",
        fileSizeBytes: 1_000_000,
        mimeType: "audio/mpeg",
        artistId: "a",
        resourceId: "r",
        // fileName omitted
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});
