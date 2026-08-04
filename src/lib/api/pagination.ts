/**
 * Limit-offset pagination contracts and response helpers.
 *
 * Provides utilities for REST collection endpoints to parse pagination
 * query parameters and format paginated JSON responses:
 * - `parsePaginationParams(url)` — extracts `page` and `limit` from a
 *   URL, enforcing 1-indexed pages, a default limit of 20, and a hard
 *   cap of 100 items per page.
 * - `apiPaginatedResponse(data, total, page, limit)` — wraps an array
 *   of items into the standard paginated envelope with `totalPages`,
 *   `hasNextPage`, and `hasPreviousPage` computed from the pagination
 *   metadata.
 *
 * @module lib/api/pagination
 */

import { randomUUID } from "node:crypto";
import type { ApiSuccessResponse } from "./response";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default page number (1-indexed). */
const DEFAULT_PAGE = 1;

/** Default items per page. */
const DEFAULT_LIMIT = 20;

/** Maximum items per page — any larger value is clamped to this cap. */
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parsed pagination parameters extracted from query strings.
 */
export interface PaginationParams {
  /** 1-indexed page number (default 1). */
  page: number;
  /** Items per page, clamped to [1, MAX_LIMIT] (default 20). */
  limit: number;
}

/**
 * Pagination metadata attached to a paginated response envelope.
 */
export interface PaginationMeta {
  /** Total number of items across all pages. */
  total: number;
  /** Current page number (1-indexed). */
  page: number;
  /** Items per page. */
  limit: number;
  /** Total number of pages. */
  totalPages: number;
  /** Whether a next page exists. */
  hasNextPage: boolean;
  /** Whether a previous page exists. */
  hasPreviousPage: boolean;
}

/**
 * The standard JSON outer envelope for a paginated API response.
 */
export interface ApiPaginatedResponse<T = unknown>
  extends ApiSuccessResponse<T[]> {
  pagination: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a value to the range `[min, max]`.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse pagination parameters from a URL's query string.
 *
 * Extracts `page` (default 1) and `limit` (default 20) query parameters,
 * clamping `limit` to a maximum of 100. Non-numeric or negative values
 * for `page` fall back to the default.
 *
 * @param url - A `URL` object or string whose `searchParams` provide
 *   `page` and `limit`.
 * @returns A `PaginationParams` object with validated values.
 *
 * @example
 * ```ts
 * const params = parsePaginationParams(req.url);
 * // params => { page: 2, limit: 50 }
 * ```
 */
export function parsePaginationParams(
  url: URL | string,
): PaginationParams {
  const searchParams =
    typeof url === "string" ? new URL(url).searchParams : url.searchParams;

  const rawPage = Number.parseInt(searchParams.get("page") ?? "", 10);
  const page = isNaN(rawPage)
    ? DEFAULT_PAGE
    : clamp(rawPage, 1, Number.MAX_SAFE_INTEGER);

  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = isNaN(rawLimit)
    ? DEFAULT_LIMIT
    : clamp(rawLimit, 1, MAX_LIMIT);

  return { page, limit };
}

/**
 * Build a paginated API response envelope.
 *
 * Wraps `data` into the standard `ApiSuccessResponse` shape and appends
 * a `pagination` object computed from `total`, `page`, and `limit`.
 *
 * @param data - The array of items for the current page.
 * @param total - Total number of items across all pages.
 * @param page - Current page number (1-indexed).
 * @param limit - Items per page (already clamped to MAX_LIMIT).
 * @param requestId - Optional caller-provided request ID from headers.
 * @returns A fully-formed `ApiPaginatedResponse` object.
 *
 * @example
 * ```ts
 * const res = apiPaginatedResponse(tracks, 150, 1, 20);
 * // res.pagination => { total: 150, page: 1, limit: 20, totalPages: 8, hasNextPage: true, hasPreviousPage: false }
 * ```
 */
export function apiPaginatedResponse<T = unknown>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  requestId?: string,
): ApiPaginatedResponse<T> {
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const resolved =
    requestId && requestId.trim().length > 0
      ? requestId.trim()
      : randomUUID();

  return {
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    timestamp: new Date().toISOString(),
    requestId: resolved,
  };
}
