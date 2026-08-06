/**
 * Vendor-agnostic storage provider interface and types.
 *
 * Defines the contract for cloud object storage (AWS S3 / Cloudflare R2)
 * operations: uploading, deleting, presigned URL generation, and metadata read.
 */

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Absolute maximum TTL for any presigned URL (seconds). */
const MAX_PRESIGNED_URL_TTL = 3600;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration required to connect to a cloud storage provider.
 */
export interface StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Parameters for uploading an object to storage.
 */
export interface UploadParams {
  /** Unique key identifying the object within the bucket */
  key: string;
  /** MIME content type of the object (e.g. "audio/mpeg") */
  contentType: string;
  /** Binary data to upload */
  body: Uint8Array;
}

/**
 * Result returned after generating a presigned URL.
 */
export interface PresignedUrlResult {
  /** The signed URL string for accessing the object */
  url: string;
  /** HTTP method the URL is valid for (PUT for uploads, GET for streaming) */
  method: "PUT" | "GET";
  /** Absolute time when the URL expires */
  expiresAt: Date;
}

/**
 * Options for generating a presigned URL.
 */
export interface SignedUrlOptions {
  /** Number of seconds until the URL expires (default: 3600) */
  expiresIn?: number;
  /** HTTP method: "PUT" for upload, "GET" for download. */
  method?: "PUT" | "GET";
}

/**
 * Metadata returned for an object stored in cloud storage.
 */
export interface ObjectMetadata {
  /** Content length in bytes */
  contentLength: number;
  /** Content MIME type */
  contentType: string;
  /** Object ETag */
  eTag: string;
}

// ---------------------------------------------------------------------------
// StorageError — descriptive error for AWS API failures
// ---------------------------------------------------------------------------

/**
 * Error thrown when an AWS S3/R2 API call fails inside the storage provider.
 *
 * Wraps the underlying SDK error with a human-readable message that includes
 * the operation name, and preserves the original AWS error code for callers
 * that need to inspect specific failure reasons (NoSuchKey, AccessDenied, etc.).
 */
export class StorageError extends Error {
  /** Machine-readable AWS error code (e.g. "NoSuchKey", "AccessDenied"). */
  readonly awsCode: string;

  constructor(message: string, awsCode: string, cause?: Error) {
    super(message);
    this.name = "StorageError";
    this.awsCode = awsCode;
    if (cause) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// StorageProviderInterface — new unified contract
// ---------------------------------------------------------------------------

/**
 * Unified storage provider interface.
 *
 * Exposes individual methods for presigned upload, presigned download,
 * object deletion, and metadata retrieval. Both S3 and R2 backends
 * implement this contract.
 */
export interface StorageProviderInterface {
  generatePresignedUploadUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult>;

  generatePresignedDownloadUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult>;

  deleteObject(config: StorageConfig, key: string): Promise<void>;

  getObjectMetadata(
    config: StorageConfig,
    key: string,
  ): Promise<ObjectMetadata>;
}

// ---------------------------------------------------------------------------
// Legacy interface (preserved for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Vendor-agnostic storage service interface (legacy — use StorageProviderInterface).
 *
 * Implementations wrap AWS S3 SDK, Cloudflare R2, or other S3-compatible
 * providers behind a single contract. StorageConfig is passed explicitly
 * to every call so the same service instance can target different buckets.
 */
export interface StorageService {
  uploadObject(
    config: StorageConfig,
    params: UploadParams,
  ): Promise<{ key: string; url: string }>;

  deleteObject(config: StorageConfig, key: string): Promise<void>;

  generateSignedUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult>;
}

// ---------------------------------------------------------------------------
// S3StorageProvider — unified implementation
// ---------------------------------------------------------------------------

/**
 * AWS S3 / Cloudflare R2 implementation of StorageProviderInterface.
 *
 * Uses @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner to produce
 * presigned URLs compatible with both Amazon S3 and Cloudflare R2.
 */
export class S3StorageProvider implements StorageProviderInterface {
  /**
   * Generate a presigned PUT URL for uploading an object.
   * Default TTL is 3600 seconds (60 minutes).
   */
  async generatePresignedUploadUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult> {
    const client = this._createClient(config);

    const ttl = options?.expiresIn ?? MAX_PRESIGNED_URL_TTL;

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: "application/octet-stream",
    });

    const url = await getSignedUrl(client, command, {
      expiresIn: ttl,
    });

    return {
      url,
      method: "PUT",
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /**
   * Generate a presigned GET URL for downloading an object.
   *
   * Enforces a TTL cap of 3600 seconds even if a longer expiresIn is requested.
   */
  async generatePresignedDownloadUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult> {
    const client = this._createClient(config);

    // Enforce 3600-second TTL cap for GET (streaming) requests.
    const ttl =
      options?.expiresIn != null
        ? Math.min(options.expiresIn, MAX_PRESIGNED_URL_TTL)
        : MAX_PRESIGNED_URL_TTL;

    const command = new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    });

    const url = await getSignedUrl(client, command, {
      expiresIn: ttl,
    });

    return {
      url,
      method: "GET",
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /**
   * Delete an object from cloud storage.
   *
   * Wraps AWS SDK errors with a descriptive message on failure.
   */
  async deleteObject(config: StorageConfig, key: string): Promise<void> {
    const client = this._createClient(config);

    const command = new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    });

    try {
      await client.send(command);
    } catch (err) {
      const awsCode =
        (err as Record<string, unknown>).Code ?? (err as Error).message;
      throw new StorageError(
        `Failed to delete object "${key}"`,
        String(awsCode),
        err as Error,
      );
    }
  }

  /**
   * Retrieve metadata for an object without downloading it.
   *
   * Uses HeadObject to fetch ContentLength, ContentType, and ETag.
   * Wraps AWS SDK errors with a descriptive message on failure.
   */
  async getObjectMetadata(
    config: StorageConfig,
    key: string,
  ): Promise<ObjectMetadata> {
    const client = this._createClient(config);

    const command = new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    });

    try {
      const response = await client.send(command);

      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? "",
        eTag: response.ETag ?? "",
      };
    } catch (err) {
      const awsCode =
        (err as Record<string, unknown>).Code ?? (err as Error).message;
      throw new StorageError(
        `Failed to retrieve metadata for "${key}"`,
        String(awsCode),
        err as Error,
      );
    }
  }

  /**
   * Build an S3Client from the provided configuration.
   */
  private _createClient(config: StorageConfig): S3Client {
    return new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
      forcePathStyle: !!config.endpoint,
    });
  }
}

// ---------------------------------------------------------------------------
// Legacy S3StorageService (preserved for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * AWS S3 implementation of StorageService (legacy — use S3StorageProvider).
 *
 * @deprecated Use {S3StorageProvider} instead. This class is kept for
 * backward compatibility and will be removed in a future major version.
 */
export class S3StorageService implements StorageService {
  async uploadObject(
    config: StorageConfig,
    params: UploadParams,
  ): Promise<{ key: string; url: string }> {
    const client = this._createClient(config);

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    });

    await client.send(command);

    const url = await getSignedUrl(client, command, {
      expiresIn: MAX_PRESIGNED_URL_TTL,
    });

    return { key: params.key, url };
  }

  async deleteObject(config: StorageConfig, key: string): Promise<void> {
    const client = this._createClient(config);

    const command = new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    });

    await client.send(command);
  }

  async generateSignedUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult> {
    const client = this._createClient(config);

    const method = options?.method ?? "PUT";
    const ttl =
      method === "GET"
        ? Math.min(options?.expiresIn ?? MAX_PRESIGNED_URL_TTL, MAX_PRESIGNED_URL_TTL)
        : options?.expiresIn ?? MAX_PRESIGNED_URL_TTL;

    const command =
      method === "PUT"
        ? new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ContentType: "application/octet-stream",
          })
        : new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
          });

    const url = await getSignedUrl(client, command, {
      expiresIn: ttl,
    });

    return {
      url,
      method,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  private _createClient(config: StorageConfig): S3Client {
    return new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
      forcePathStyle: !!config.endpoint,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory — dynamically select provider based on STORAGE_PROVIDER env var
// ---------------------------------------------------------------------------

/**
 * Valid values for the STORAGE_PROVIDER environment variable.
 */
const SUPPORTED_PROVIDERS = ["s3", "r2"] as const;

/**
 * Create a StorageProvider instance based on the STORAGE_PROVIDER environment
 * variable.  Defaults to "s3" when the variable is absent or unrecognized.
 *
 * Supported providers:
 *  - "s3"  : Amazon S3 (region + AWS endpoint)
 *  - "r2"  : Cloudflare R2 (uses S3-compatible API via custom endpoint)
 *
 * Both backends share the same {@link S3StorageProvider} under the hood;
 * the `endpoint` field in {@link StorageConfig} determines which service
 * endpoint is contacted.
 *
 * @param config  Storage configuration passed through to each provider call.
 * @returns A {@link StorageProviderInterface} instance.
 */
export function createStorageProvider(
  config: StorageConfig,
): StorageProviderInterface {
  // Determine the requested provider; fall back to "s3" for missing or invalid values.
  const provider = (process.env.STORAGE_PROVIDER ?? "s3") as string;

  if (!SUPPORTED_PROVIDERS.includes(provider as (typeof SUPPORTED_PROVIDERS)[number])) {
    // Silently degrade to S3 for any unknown provider value.
  }

  // S3StorageProvider works for both S3 and R2 — the endpoint in StorageConfig
  // tells the AWS SDK v3 which endpoint to hit.
  return new S3StorageProvider();
}
