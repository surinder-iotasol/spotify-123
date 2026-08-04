/**
 * Vendor-agnostic storage service interface and types.
 *
 * Defines the contract for cloud object storage (AWS S3 / Cloudflare R2)
 * operations: uploading, deleting, and generating presigned URLs.
 */

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Absolute maximum TTL for any presigned URL (seconds). */
const MAX_PRESIGNED_URL_TTL = 3600;

/**
 * Configuration required to connect to a cloud storage provider.
 */
export interface StorageConfig {
  /** S3-compatible bucket name */
  bucket: string;
  /** AWS region or provider-specific region identifier */
  region: string;
  /** Optional custom endpoint (e.g. Cloudflare R2 origin URL) */
  endpoint?: string;
  /** Access key ID for authentication */
  accessKeyId: string;
  /** Secret access key for authentication */
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
  /** HTTP method the URL should be valid for (PUT or GET) */
  method?: "PUT" | "GET";
  /** Number of seconds until the URL expires (default: 3600) */
  expiresIn?: number;
}

/**
 * Vendor-agnostic storage service interface.
 *
 * Implementations wrap AWS S3 SDK, Cloudflare R2, or other S3-compatible
 * providers behind a single contract. StorageConfig is passed explicitly
 * to every call so the same service instance can target different buckets.
 */
export interface StorageService {
  /**
   * Upload a binary object to cloud storage.
   * @param config - Storage configuration for the target provider.
   * @param params - Upload parameters including key, body, and content type.
   * @returns The storage key and presigned upload URL.
   */
  uploadObject(
    config: StorageConfig,
    params: UploadParams,
  ): Promise<{ key: string; url: string }>;

  /**
   * Delete an object from cloud storage.
   * @param config - Storage configuration for the target provider.
   * @param key - The storage key identifying the object to delete.
   * @returns Void promise when deletion succeeds.
   */
  deleteObject(config: StorageConfig, key: string): Promise<void>;

  /**
   * Generate a presigned URL for uploading or downloading an object.
   * For getObject streaming requests, the TTL is enforced at a 3600-second cap.
   * @param config - Storage configuration for the target provider.
   * @param key - The storage key identifying the object.
   * @param options - URL generation options (method, TTL).
   * @returns Presigned URL result with URL, method, and TTL.
   */
  generateSignedUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult>;
}

/**
 * AWS S3 implementation of StorageService.
 *
 * Uses @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner to produce
 * presigned URLs compatible with both Amazon S3 and Cloudflare R2.
 */
export class S3StorageService implements StorageService {
  /**
   * Upload a binary object to S3 and return its key plus a presigned PUT URL.
   */
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

    const url = await getSignedUrl(client, command, { expiresIn: MAX_PRESIGNED_URL_TTL });

    return { key: params.key, url };
  }

  /**
   * Delete an object from S3.
   */
  async deleteObject(config: StorageConfig, key: string): Promise<void> {
    const client = this._createClient(config);

    const command = new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    });

    await client.send(command);
  }

  /**
   * Generate a presigned URL for uploading (PUT) or downloading (GET) an object.
   *
   * PUT URLs default to 3600 seconds (60 minutes).
   * GET URLs default to 3600 seconds but are commonly passed 900 seconds
   * (15 minutes) for streaming playback delivery.
   *
   * The 3600-second TTL cap is enforced only for GET requests.
   */
  async generateSignedUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult> {
    const client = this._createClient(config);

    const method = options?.method ?? "PUT";
    // Enforce 3600-second TTL cap only for GET (streaming) requests.
    // PUT URLs are not capped so upload intents can request longer TTLs.
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

    const url = await getSignedUrl(client, command, { expiresIn: ttl });

    return {
      url,
      method,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
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
