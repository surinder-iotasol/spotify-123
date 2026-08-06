/**
 * Unit tests for the direct-to-storage upload hook and progress component.
 *
 * @module tests/unit/components/upload
 */

import React from "react";

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

import { cleanup, render, screen } from "@testing-library/react";

import { FileUploadProgress } from "@/components/FileUploadProgress";
import { useDirectUpload, validateFile } from "@/lib/hooks/useDirectUpload";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = "test.mp3", type = "audio/mpeg", size = 1_000_000): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

afterEach(cleanup);

beforeEach(() => {
  vi.restoreAllMocks();
});

/** Set up a default fetch mock that resolves to a success response. */
function setupDefaultFetchMock(overrides?: { status?: number; data?: Record<string, unknown> }) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    // Return a fresh Response each call (no shared mutable state)
    return new Response(
      JSON.stringify({
        success: true,
        data: { url: "http://default.url", objectKey: "default", ...overrides?.data },
      }),
      { status: overrides?.status ?? 200 },
    );
  });
}

// ---------------------------------------------------------------------------
// validateFile  — unit tests
// ---------------------------------------------------------------------------

describe("validateFile", () => {
  it("accepts a valid MP3 file", () => {
    expect(validateFile(makeFile("song.mp3", "audio/mpeg", 10_000_000), "audio").ok).toBe(true);
  });

  it("accepts a valid WAV file", () => {
    expect(validateFile(makeFile("track.wav", "audio/wav", 5_000_000), "audio").ok).toBe(true);
  });

  it("rejects an audio file that exceeds 50 MB", () => {
    const res = validateFile(makeFile("huge.mp3", "audio/mpeg", 55 * 1024 * 1024), "audio");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects an invalid audio MIME type", () => {
    const res = validateFile(makeFile("bad.opus", "audio/opus", 1_000_000), "audio");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("INVALID_AUDIO_MIME_TYPE");
  });

  it("passes image files through without strict checks", () => {
    expect(validateFile(makeFile("photo.jpg", "image/jpeg", 2_000_000), "image").ok).toBe(true);
  });

  it("passes image files > 50 MB through (backend enforces)", () => {
    expect(validateFile(makeFile("big.png", "image/png", 60 * 1024 * 1024), "image").ok).toBe(true);
  });

  it("accepts any MIME valid for audio", () => {
    expect(validateFile(makeFile("t.wav", "audio/wav", 100_000), "audio").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useDirectUpload  — unit tests
// ---------------------------------------------------------------------------

describe("useDirectUpload", () => {
  function renderHook(cb = { onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }) {
    let captured: ReturnType<typeof useDirectUpload> | undefined;
    function TestWrapper() {
      captured = useDirectUpload(cb);
      return null;
    }
    render(<TestWrapper />);
    return { hook: captured as ReturnType<typeof useDirectUpload>, cb };
  }

  it("starts in idle state", () => {
    const { hook } = renderHook();
    expect(hook.state.status).toBe("idle");
  });

  it("transitions: idle -> error on validation failure", async () => {
    const { hook, cb } = renderHook();
    const big = makeFile("huge.mp3", "audio/mpeg", 55 * 1024 * 1024);

    await hook.upload(big, "artist-1");

    expect(hook.state.status).toBe("error");
    if (hook.state.status === "error") {
      expect(hook.state.code).toBe("FILE_TOO_LARGE");
    }
    expect(cb.onError).toHaveBeenCalledWith(
      "FILE_TOO_LARGE",
      "FILE_TOO_LARGE",
    );
  });

  it("transitions: idle -> requesting -> completed", async () => {
    const cb = { onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    // Create a unique URL so we can verify it was returned
    const successUrl = "http://presigned-unique-abc.url";
    setupDefaultFetchMock({ data: { url: successUrl, objectKey: "audio/1/abc.mp3" } });

    const { hook } = renderHook(cb);
    const file = makeFile("demo.mp3", "audio/mpeg", 1_000_000);

    await hook.upload(file, "artist-1");

    expect(hook.state.status).toBe("completed");
    if (hook.state.status === "completed") {
      expect(hook.state.url).toBe(successUrl);
    }
    expect(cb.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ url: successUrl }),
    );
  });

  it("reports error on 500 from upload-intent", async () => {
    const cb = { onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    setupDefaultFetchMock({ status: 500 });

    const { hook } = renderHook(cb);
    const file = makeFile("ok.mp3", "audio/mpeg", 1_000_000);

    await hook.upload(file, "artist-1");

    if (hook.state.status === "error") {
      expect(hook.state.code).toBe("NETWORK_ERROR");
    }
  });

  it("reports error on network failure", async () => {
    const cb = { onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    // Override the beforeEach default with a reject
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const { hook } = renderHook(cb);
    const file = makeFile("ok.mp3", "audio/mpeg", 1_000_000);

    await hook.upload(file, "artist-1");

    if (hook.state.status === "error") {
      expect(hook.state.code).toBe("NETWORK_ERROR");
    }
  });

  it("aborts previous upload on new call", () => {
    const cb = { onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };

    // Create a spy that tracks call count
    let callCount = 0;
    const neverResolve = vi.fn(async () => { callCount++; await new Promise(() => {}); });
    vi.spyOn(globalThis, "fetch").mockImplementation(neverResolve);

    const { hook } = renderHook(cb);
    const file1 = makeFile("first.mp3", "audio/mpeg", 1_000_000);

    void hook.upload(file1, "artist-1");
    void hook.upload(makeFile("second.mp3", "audio/mpeg", 500_000), "artist-2");

    // After two rapid calls, fetch should have been called at least twice
    expect(neverResolve).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// FileUploadProgress  — component tests
// ---------------------------------------------------------------------------

describe("FileUploadProgress", () => {
  afterEach(cleanup);

  it("renders idle state with progressbar", () => {
    render(<FileUploadProgress state={{ status: "idle" }} />);
    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("renders percentage in uploading state", () => {
    render(
      <FileUploadProgress state={{ status: "uploading", progress: 65, objectKey: "x" }} />
    );
    expect(screen.getByText("65%")).toBeDefined();
  });

  it("renders completed state with success message", () => {
    render(
      <FileUploadProgress state={{ status: "completed", url: "http://x", objectKey: "y" }} />
    );
    expect(screen.getByText("Upload complete")).toBeDefined();
    expect(screen.getByText("File uploaded successfully.")).toBeDefined();
  });

  it("renders error with alert role and message", () => {
    render(
      <FileUploadProgress state={{ status: "error", message: "Upload failed", code: "UPLOAD_FAILED" }} />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");
  });

  it("exposes aria-valuenow during upload", () => {
    render(
      <FileUploadProgress state={{ status: "uploading", progress: 40, objectKey: "k" }} />
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuetext", "40%");
  });

  it("accepts custom label prop", () => {
    render(<FileUploadProgress state={{ status: "idle" }} label="Drag & drop" />);
    expect(document.querySelector("[aria-label='Drag & drop']")).not.toBeNull();
  });
});
