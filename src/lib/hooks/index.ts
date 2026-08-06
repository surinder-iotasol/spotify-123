/**
 * Barrel re-exports for the upload hook module.
 *
 * Provides clean module resolution — consumers import from
 * `@/lib/hooks` instead of the internal `useDirectUpload.ts` path.
 *
 * @module lib/hooks
 */

export { useDirectUpload } from "./useDirectUpload";
export type { ValidateResult, UploadState, UseDirectUploadOptions } from "./useDirectUpload";
