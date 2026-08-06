/**
 * POST /api/v1/storage/upload-intent — Presigned upload URL API route.
 *
 * Accepts file metadata, validates against audio/image rules, and returns a
 * 60-minute presigned PUT URL for direct-to-storage binary transfer.
 *
 * RESPONSES:
 *   200 OK  → { success: true, data: { url, objectKey }, … }
 *   422     → { success: false, error: { code, message, details } }
 *   500     → { success: false, error: { code: "STORAGE_ERROR" } }
 */

import { NextRequest, NextResponse } from "next/server";
import { handleUploadIntent } from "@/lib/storage/upload-intent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal StorageConfig from environment variables.
 * Returns null when required secrets are missing.
 */
function buildConfig(): {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
} | null {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) return null;

  return { region, accessKeyId, secretAccessKey };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST handler for the upload-intent endpoint.
 *
 * Delegates validation and presigned URL generation to the shared
 * {@link handleUploadIntent} service function.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = buildConfig();

  if (!config) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "STORAGE_CONFIG_MISSING",
          message: "Cloud storage credentials are not configured.",
        },
      },
      { status: 500 },
    );
  }

  try {
    const { status, body } = await handleUploadIntent({
      config,
      json: () => request.json(),
    });

    return NextResponse.json(body, { status });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "STORAGE_ERROR",
          message: "Failed to generate presigned upload URL.",
        },
      },
      { status: 500 },
    );
  }
}
