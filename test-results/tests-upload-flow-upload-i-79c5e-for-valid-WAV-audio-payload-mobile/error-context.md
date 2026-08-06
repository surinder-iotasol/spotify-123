# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/upload-flow.spec.ts >> upload-intent API >> returns 200 for valid WAV audio payload
- Location: e2e/tests/upload-flow.spec.ts:42:7

# Error details

```
TypeError: page.request is not a function
```

# Test source

```ts
  1   | /**
  2   |  * Playwright E2E spec — upload-intent API validation.
  3   |  *
  4   |  * Verifies:
  5   |  * - Valid audio payload returns 200 with presigned URL
  6   |  * - Invalid audio (oversized, wrong MIME) returns 422
  7   |  * - Image validation works correctly
  8   |  *
  9   |  * Uses Playwright's network assert capabilities directly;
  10  |  * no real storage endpoint needed.
  11  |  *
  12  |  * @module e2e/tests/upload-flow
  13  |  */
  14  | 
  15  | import { test, expect } from "@playwright/test";
  16  | 
  17  | test.describe("upload-intent API", () => {
  18  |   // ---------------------------------------------------------------------------
  19  |   // Happy path
  20  |   // ---------------------------------------------------------------------------
  21  | 
  22  |   test("returns 200 for valid MP3 audio payload", async ({ page }) => {
  23  |     const response = await page.request().post("/api/v1/storage/upload-intent", {
  24  |       data: {
  25  |         fileType: "audio",
  26  |         fileName: "demo.mp3",
  27  |         fileSizeBytes: 5_000_000,
  28  |         mimeType: "audio/mpeg",
  29  |         artistId: "artist-1",
  30  |         resourceId: "track-1",
  31  |       },
  32  |     });
  33  | 
  34  |     expect(response.status()).toBe(200);
  35  |     const body = await response.json();
  36  |     expect(body.success).toBe(true);
  37  |     expect(body.data).toHaveProperty("url");
  38  |     expect(body.data).toHaveProperty("objectKey");
  39  |     expect(body.data.objectKey).toContain("audio/artist-1/");
  40  |   });
  41  | 
  42  |   test("returns 200 for valid WAV audio payload", async ({ page }) => {
> 43  |     const response = await page.request().post("/api/v1/storage/upload-intent", {
      |                                 ^ TypeError: page.request is not a function
  44  |       data: {
  45  |         fileType: "audio",
  46  |         fileName: "track.wav",
  47  |         fileSizeBytes: 3_000_000,
  48  |         mimeType: "audio/wav",
  49  |         artistId: "a",
  50  |         resourceId: "r",
  51  |       },
  52  |     });
  53  | 
  54  |     expect(response.status()).toBe(200);
  55  |     expect((await response.json()).success).toBe(true);
  56  |   });
  57  | 
  58  |   test("returns 200 for valid JPG image below cap", async ({ page }) => {
  59  |     const response = await page.request().post("/api/v1/storage/upload-intent", {
  60  |       data: {
  61  |         fileType: "image",
  62  |         fileName: "photo.jpg",
  63  |         fileSizeBytes: 2_000_000,
  64  |         mimeType: "image/jpeg",
  65  |         artistId: "a",
  66  |         resourceId: "r",
  67  |       },
  68  |     });
  69  | 
  70  |     expect(response.status()).toBe(200);
  71  |   });
  72  | 
  73  |   test("returns 200 for exact 10 MB PNG image", async ({ page }) => {
  74  |     const response = await page.request().post("/api/v1/storage/upload-intent", {
  75  |       data: {
  76  |         fileType: "image",
  77  |         fileName: "exact.png",
  78  |         fileSizeBytes: 10 * 1024 * 1024, // exactly at cap
  79  |         mimeType: "image/png",
  80  |         artistId: "a",
  81  |         resourceId: "r",
  82  |       },
  83  |     });
  84  | 
  85  |     // 10 MB <= 10 MB cap, so should pass validation
  86  |     expect(response.status()).toBe(200);
  87  |   });
  88  | 
  89  |   // ---------------------------------------------------------------------------
  90  |   // Validation rejections
  91  |   // ---------------------------------------------------------------------------
  92  | 
  93  |   test("rejects audio exceeding 50 MB with 422", async ({ page }) => {
  94  |     const response = await page.request().post("/api/v1/storage/upload-intent", {
  95  |       data: {
  96  |         fileType: "audio",
  97  |         fileName: "huge.mp3",
  98  |         fileSizeBytes: 55 * 1024 * 1024,
  99  |         mimeType: "audio/mpeg",
  100 |         artistId: "a",
  101 |         resourceId: "r",
  102 |       },
  103 |     });
  104 | 
  105 |     expect(response.status()).toBe(422);
  106 |     const body = await response.json();
  107 |     expect(body.success).toBe(false);
  108 |     expect(body.error.code).toBe("FILE_TOO_LARGE");
  109 |   });
  110 | 
  111 |   test("rejects WebP image exceeding 10 MB", async ({ page }) => {
  112 |     const response = await page.request().post("/api/v1/storage/upload-intent", {
  113 |       data: {
  114 |         fileType: "image",
  115 |         fileName: "big.webp",
  116 |         fileSizeBytes: 12 * 1024 * 1024,
  117 |         mimeType: "image/webp",
  118 |         artistId: "a",
  119 |         resourceId: "r",
  120 |       },
  121 |     });
  122 | 
  123 |     expect(response.status()).toBe(422);
  124 |     expect((await response.json()).error.code).toBe("FILE_TOO_LARGE");
  125 |   });
  126 | 
  127 |   test("rejects unsupported audio MIME type", async ({ page }) => {
  128 |     const response = await page.request().post("/api/v1/storage/upload-intent", {
  129 |       data: {
  130 |         fileType: "audio",
  131 |         fileName: "bad.flac",
  132 |         fileSizeBytes: 5_000_000,
  133 |         mimeType: "audio/flac",
  134 |         artistId: "a",
  135 |         resourceId: "r",
  136 |       },
  137 |     });
  138 | 
  139 |     expect(response.status()).toBe(422);
  140 |     expect((await response.json()).error.code).toBe("INVALID_AUDIO_MIME_TYPE");
  141 |   });
  142 | 
  143 |   test("rejects invalid fileType", async ({ page }) => {
```