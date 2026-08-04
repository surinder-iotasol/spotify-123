/**
 * Audio upload size validation helper.
 *
 * Enforces the platform-wide 50 MB (52,428,800 bytes) cap on audio file uploads.
 */

/** Maximum allowed audio upload size in bytes (50 MB). */
export const MAX_AUDIO_FILE_SIZE = 52_428_800;

/**
 * Validates that an audio file size is at or below the 50 MB cap.
 * @param sizeBytes - File size in bytes.
 * @returns true if the file is within the allowed size range.
 */
export function validateAudioFileSize(sizeBytes: number): boolean {
  return sizeBytes <= MAX_AUDIO_FILE_SIZE;
}
