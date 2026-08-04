/**
 * Vendor-agnostic storage service interface and types.
 *
 * Defines the contract for cloud object storage (AWS S3 / Cloudflare R2)
 * operations: uploading, deleting, and generating presigned URLs.
 */

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
  /** UTC timestamp when the URL expires */
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
   * @param config - Storage configuration for the target provider.
   * @param key - The storage key identifying the object.
   * @param options - URL generation options (method, TTL).
   * @returns Presigned URL result with URL and expiration timestamp.
   */
  generateSignedUrl(
    config: StorageConfig,
    key: string,
    options?: SignedUrlOptions,
  ): Promise<PresignedUrlResult>;
}
