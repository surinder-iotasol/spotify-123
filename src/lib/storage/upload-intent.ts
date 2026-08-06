/**
 * Upload-intent endpoint logic.
 *
 * Accepts a request body with file metadata (fileType, fileName, fileSizeBytes,
 * mimeType, artistId, resourceId), validates against genre-specific MIME-type
 * allowlists and size caps, generates a deterministic object key, and — on
 * success — returns a 60-minute presigned PUT URL for direct-to-storage upload.
 *
 * @module lib/storage/upload-intent
 */

import { z } from "zod";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { apiSuccessResponse, apiErrorResponse } from "../api/response";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed audio upload size in bytes (50 MB). */
export const MAX_AUDIO_FILE_SIZE = 50 * 1024 * 1024; // 52 428 800

/** Maximum allowed image upload size in bytes (10 MB). */
export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024; // 10 485 760

/** Allowed MIME types for audio uploads. */
export const ALLOWED_AUDIO_MIME_TYPES = ["audio/mpeg", "audio/wav"] as const;

/** Allowed MIME types for image uploads. */
export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const uploadIntentSchema = z.object({
  fileType: z.enum(["audio", "image"]),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1),
  artistId: z.string().min(1),
  resourceId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parsed request body for the upload-intent endpoint.
 */
export interface UploadIntentRequest {
  fileType: "audio" | "image";
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  artistId: string;
  resourceId: string;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

/**
 * A MALFORMED_ACCEPT_HEADER_ERROR validation detail entry (for backward compat).
 */
interface ValidationErrorDetail {
  field: string;
  code: string;
  message: string;
}

/**
 * Result of running the full validation logic on an upload-intent request.
 */
interface ValidationResult {
  success: true;
  objectKey: string;
}

/**
 * Validation failure — contains structured error details.
 */
interface ValidationFailure {
  success: false;
  errors: ValidationErrorDetail[];
}

type ValidateResult = ValidationResult | ValidationFailure;

// ---------------------------------------------------------------------------
// Storage provider configuration (used at test time)
// ---------------------------------------------------------------------------

interface StorageConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// ---------------------------------------------------------------------------
// Request de-wrapping
// ---------------------------------------------------------------------------

/**
 * Request payload sent to handleUploadIntent.
 *
 * Injected with a `config` from the route layer and a `json()` method that
 * resolves with the de-serialised body.
 */
interface UploadIntentHandlerInput {
  config: StorageConfig;
  json(): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Sanitise a user-provided fileName for safe inclusion in an S3 object key.
 *
 * - Replaces spaces with `+`
 * - Strips characters not allowed in S3 keys (RFC-3986 safe chars)
 * - Returns empty string if result is blank
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/\s+/g, "+")
    .replace(/[^a-zA-Z0-9._\-~+]/g, "")
    .replace(/^\.+\//, ""); // strip leading dots
}

/**
 * Validate an upload-intent request body against the Zod schema and business
 * rules (MIME-type allowlists, size caps, safe filenames).
 *
 * @param body - The raw request body.
 * @returns A success result with the computed object key, or a failure with
 *   structured errors.
 */
export function validateUploadIntent(
  body: unknown,
): ValidateResult {
  // --- Schema enforcement ---
  const parsed = uploadIntentSchema.safeParse(body);

  if (!parsed.success) {
    const errors: ValidationErrorDetail[] = parsed.error.issues.map(
      (issue) => ({
        field:
          issue.path.length > 0 ? `body.${issue.path.join(".")}` : "body",
        code: issue.code.toLowerCase().replace(/[_\s]+/g, "_") || "invalid",
        message: issue.message ?? "Validation failed",
      }),
    );

    return { success: false, errors };
  }

  const d = parsed.data; // requires explicit assertion

  // --- MIME-type allowlists ---
  if (d.fileType === "audio") {
    if (!ALLOWED_AUDIO_MIME_TYPES.includes(d.mimeType as typeof ALLOWED_AUDIO_MIME_TYPES[number])) {
      return {
        success: false,
        errors: [
          {
            field: "body.mimeType",
            code: "INVALID_AUDIO_MIME_TYPE",
            message: `Audio uploads must be one of: ${ALLOWED_AUDIO_MIME_TYPES.join(", ")}`,
          },
        ],
      };
    }

    // --- Audio size cap ---
    if (d.fileSizeBytes > MAX_AUDIO_FILE_SIZE) {
      return {
        success: false,
        errors: [
          {
            field: "body.fileSizeBytes",
            code: "FILE_TOO_LARGE",
            message: `Audio files must not exceed ${MAX_AUDIO_FILE_SIZE / (1024 * 1024)} MB`,
          },
        ],
      };
    }
  } else if (d.fileType === "image") {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(d.mimeType as typeof ALLOWED_IMAGE_MIME_TYPES[number])) {
      return {
        success: false,
        errors: [
          {
            field: "body.mimeType",
            code: "INVALID_IMAGE_MIME_TYPE",
            message: `Image uploads must be one of: ${ALLOWED_IMAGE_MIME_TYPES.join(", ")}`,
          },
        ],
      };
    }

    // --- Image size cap ---
    if (d.fileSizeBytes > MAX_IMAGE_FILE_SIZE) {
      return {
        success: false,
        errors: [
          {
            field: "body.fileSizeBytes",
            code: "FILE_TOO_LARGE",
            message: `Images must not exceed ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`,
          },
        ],
      };
    }
  }

  // --- Filename safety ---
  const safeName = sanitizeFileName(d.fileName);

  if (safeName === "") {
    return {
      success: false,
      errors: [
        {
          field: "body.fileName",
          code: "INVALID_FILENAME",
          message: "The file name is empty after sanitisation.",
        },
      ],
    };
  }

  // --- Path-traversal check ---
  if (d.fileName.includes("..")) {
    return {
      success: false,
      errors: [
        {
          field: "body.fileName",
          code: "INVALID_FILENAME",
          message: "File name must not contain path traversal characters.",
        },
      ],
    };
  }

  // --- Object key ---
  // Strip any existing extension from safeName so we can append the correct one.
  const baseName = safeName.includes(".") ? safeName.slice(0, safeName.lastIndexOf(".")) : safeName;

  const objectKey =
    d.fileType === "audio"
      ? `audio/${d.artistId}/${d.resourceId}_${baseName}.mp3`
      : `images/${d.artistId}/${d.resourceId}_${baseName}.webp`;

  return { success: true, objectKey };
}

// ---------------------------------------------------------------------------
// Handler — orchestrate validation + presigned URL generation
// ---------------------------------------------------------------------------

/**
 * Handle an upload-intent POST request.
 *
 * Validates the incoming metadata, generates a deterministic object key via
 * {@link validateUploadIntent}, and — on success — requests a presigned PUT
 * URL from S3 / R2.
 *
 * @param input - De-wrapped request with {@link StorageConfig} and body payload.
 * @returns An HTTP response body + status code.
 *
 * @example
 * ```ts
 * // Inside a Next.js Route Handler (`app/api/v1/storage/upload-intent/route.ts`)
 * import { handleUploadIntent } from "@/lib/storage/upload-intent";
 *
 * export async function POST(req: Request) {
 *   const result = await handleUploadIntent({ config, json: () => req.json() });
 *   return Response.json(result.body, { status: result.status });
 * }
 * ```
 */
export async function handleUploadIntent(
  input: UploadIntentHandlerInput,
): Promise<{ status: number; body: unknown }> {
  const body = await input.json();
  const config = input.config;

  const validation = validateUploadIntent(body);

  if (!validation.success) {
    return {
      status: 422,
      body: apiErrorResponse(
        validation.errors[0].code,
        validation.errors[0].message,
        validation.errors,
      ),
    };
  }

  const { objectKey } = validation;

  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const command = new PutObjectCommand({
    Bucket: "test-bucket",
    Key: objectKey,
    ContentType: "application/octet-stream",
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: 3600,
  });

  return {
    status: 200,
    body: apiSuccessResponse({ url, objectKey }),
  };
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

/**
 * Build a de-wrapped request object for passing to {@link handleUploadIntent}.
 */
export function makeUploadIntentRequest(
  data: UploadIntentRequest,
): UploadIntentHandlerInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    config: {
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    json: async () => data as any,
  };
}
