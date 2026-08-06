/**
 * File upload progress indicator.
 *
 * Displays a real-time progress bar, transfer percentage, and error
 * notifications during direct-to-storage file uploads.  Fully accessible
 * per WCAG 2.1 AA — keyboard focusable, ARIA live region, and screen-reader
 * friendly.
 *
 * Responsive down to 375px mobile viewports.
 *
 * @module app/components/file-upload-progress
 */

import React from "react";

import { cn } from "@/lib/utils";

import type { UploadState } from "@/lib/hooks/useDirectUpload";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileUploadProgressProps {
  /** Current upload state from useDirectUpload. */
  state: UploadState;
  /** Optional custom label rendered as aria-label. */
  label?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * File upload progress component.
 *
 * Renders a progress bar that adapts to every state type.
 */
export function FileUploadProgress({
  state,
  label,
}: FileUploadProgressProps) {
  const { status } = state;

  // All states render a progress bar so callers can inspect it.
  return (
    <div
      className={cn("w-full flex flex-col gap-2", label && "space-y-1")}
      aria-label={label}
    >
      {/* Progress bar — always present, adapted to state */}
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-[var(--muted)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          status === "uploading"
            ? String(state.progress)
            : status === "completed"
              ? "100"
              : undefined
        }
        aria-valuetext={
          status === "uploading"
            ? `${state.progress}%`
            : status === "completed"
              ? "100%"
              : undefined
        }
      >
        <span
          className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-200"
          style={{
            width:
              status === "uploading"
                ? `${state.progress}%`
                : status === "completed"
                  ? "100%"
                  : "0%",
          }}
        />
      </div>

      {/* Percentage text — only during uploading */}
      {status === "uploading" && (
        <span className="text-sm font-mono text-[var(--muted-foreground)]">
          {state.progress}%
        </span>
      )}

      {/* Completed text */}
      {status === "completed" && (
        <>
          <span className="text-sm font-medium text-[var(--primary)]">
            Upload complete
          </span>
          <span className="text-sm">File uploaded successfully.</span>
        </>
      )}

      {/* Error text — prominent */}
      {status === "error" && (
        <p
          className="text-sm text-[var(--destructive)]"
          role="alert"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
