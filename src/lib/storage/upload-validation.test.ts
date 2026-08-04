import { describe, expect, it } from "vitest";
import { validateAudioFileSize } from "./upload-validation";

// 50 MB in bytes
const MAX_AUDIO_SIZE = 52_428_800;

describe("validateAudioFileSize", () => {
  it("returns true when file size is exactly 50MB", () => {
    expect(validateAudioFileSize(MAX_AUDIO_SIZE)).toBe(true);
  });

  it("returns true when file size is below 50MB", () => {
    expect(validateAudioFileSize(50_000_000)).toBe(true);
    expect(validateAudioFileSize(1)).toBe(true);
    expect(validateAudioFileSize(0)).toBe(true);
  });

  it("returns false when file size exceeds 50MB", () => {
    expect(validateAudioFileSize(MAX_AUDIO_SIZE + 1)).toBe(false);
    expect(validateAudioFileSize(100_000_000)).toBe(false);
  });
});
