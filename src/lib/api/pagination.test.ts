/**
 * Unit tests for the pagination helpers.
 *
 * Covers `parsePaginationParams` (default fallback, max clamping, edge
 * cases) and `apiPaginatedResponse` (totalPages math, hasNext /
 * hasPrevious booleans, request-id resolution).
 *
 * @module lib/api/pagination.test
 */

import { describe, expect, it } from "vitest";
import {
  apiPaginatedResponse,
  parsePaginationParams,
  type PaginationParams,
  type PaginationMeta,
} from "./pagination";

// ---------------------------------------------------------------------------
// parsePaginationParams — defaults
// ---------------------------------------------------------------------------

describe("parsePaginationParams — defaults", () => {
  it("returns page 1 and limit 20 when no query params are present", () => {
    const url = new URL("http://localhost/api/tracks");
    const params: PaginationParams = parsePaginationParams(url);

    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
  });

  it("returns page 1 and limit 20 when query string is empty", () => {
    const url = new URL("http://localhost/api/tracks?");
    const params = parsePaginationParams(url);

    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
  });

  it("accepts a plain string URL", () => {
    const params = parsePaginationParams("http://localhost/api/tracks");

    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// parsePaginationParams — custom values
// ---------------------------------------------------------------------------

describe("parsePaginationParams — custom values", () => {
  it("parses page query parameter", () => {
    const url = new URL("http://localhost/api/tracks?page=3");
    const params = parsePaginationParams(url);

    expect(params.page).toBe(3);
    expect(params.limit).toBe(20);
  });

  it("parses limit query parameter", () => {
    const url = new URL("http://localhost/api/tracks?limit=50");
    const params = parsePaginationParams(url);

    expect(params.page).toBe(1);
    expect(params.limit).toBe(50);
  });

  it("parses both page and limit query parameters", () => {
    const url = new URL("http://localhost/api/tracks?page=2&limit=10");
    const params = parsePaginationParams(url);

    expect(params.page).toBe(2);
    expect(params.limit).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// parsePaginationParams — max clamping
// ---------------------------------------------------------------------------

describe("parsePaginationParams — max clamping", () => {
  it("clamps limit exceeding 100 to 100", () => {
    const url = new URL("http://localhost/api/tracks?limit=200");
    const params = parsePaginationParams(url);

    expect(params.limit).toBe(100);
  });

  it("clamps limit exceeding 100 to 100 at exact boundary", () => {
    const url = new URL("http://localhost/api/tracks?limit=101");
    const params = parsePaginationParams(url);

    expect(params.limit).toBe(100);
  });

  it("accepts limit exactly at 100 without clamping", () => {
    const url = new URL("http://localhost/api/tracks?limit=100");
    const params = parsePaginationParams(url);

    expect(params.limit).toBe(100);
  });

  it("clamps very large limit values", () => {
    const url = new URL("http://localhost/api/tracks?limit=999999");
    const params = parsePaginationParams(url);

    expect(params.limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// parsePaginationParams — edge cases
// ---------------------------------------------------------------------------

describe("parsePaginationParams — edge cases", () => {
  it("defaults page to 1 when page is 0", () => {
    const url = new URL("http://localhost/api/tracks?page=0");
    const params = parsePaginationParams(url);

    expect(params.page).toBe(1);
  });

  it("defaults page to 1 when page is negative", () => {
    const url = new URL("http://localhost/api/tracks?page=-1");
    const params = parsePaginationParams(url);

    expect(params.page).toBe(1);
  });

  it("defaults page to 1 when page is non-numeric", () => {
    const url = new URL("http://localhost/api/tracks?page=abc");
    const params = parsePaginationParams(url);

    expect(params.page).toBe(1);
  });

  it("defaults limit to 20 when limit is non-numeric", () => {
    const url = new URL("http://localhost/api/tracks?limit=xyz");
    const params = parsePaginationParams(url);

    expect(params.limit).toBe(20);
  });

  it("defaults limit to 1 when limit is 0", () => {
    const url = new URL("http://localhost/api/tracks?limit=0");
    const params = parsePaginationParams(url);

    expect(params.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// apiPaginatedResponse — total page calculation
// ---------------------------------------------------------------------------

describe("apiPaginatedResponse — pagination meta", () => {
  it("computes totalPages correctly (exact division)", () => {
    const items = Array.from({ length: 40 }, (_, i) => `item-${i}`);
    const response = apiPaginatedResponse(items, 40, 1, 20);

    expect(response.pagination.totalPages).toBe(2);
    expect(response.pagination.total).toBe(40);
    expect(response.pagination.page).toBe(1);
    expect(response.pagination.limit).toBe(20);
  });

  it("computes totalPages correctly (non-exact division, rounds up)", () => {
    const items = Array.from({ length: 45 }, (_, i) => `item-${i}`);
    const response = apiPaginatedResponse(items, 45, 1, 20);

    expect(response.pagination.totalPages).toBe(3);
  });

  it("computes totalPages as 1 when total is 0", () => {
    const response = apiPaginatedResponse([], 0, 1, 20);

    expect(response.pagination.totalPages).toBe(1);
  });

  it("sets hasNextPage to true when there are more pages", () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const response = apiPaginatedResponse(items, 60, 1, 20);

    expect(response.pagination.hasNextPage).toBe(true);
    expect(response.pagination.hasPreviousPage).toBe(false);
  });

  it("sets hasNextPage to false on the last page", () => {
    const items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const response = apiPaginatedResponse(items, 60, 3, 20);

    expect(response.pagination.hasNextPage).toBe(false);
    expect(response.pagination.hasPreviousPage).toBe(true);
  });

  it("sets hasPreviousPage to false on the first page", () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const response = apiPaginatedResponse(items, 60, 1, 20);

    expect(response.pagination.hasPreviousPage).toBe(false);
  });

  it("sets hasPreviousPage to true for middle pages", () => {
    const items = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    const response = apiPaginatedResponse(items, 60, 2, 20);

    expect(response.pagination.hasPreviousPage).toBe(true);
    expect(response.pagination.hasNextPage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// apiPaginatedResponse — envelope structure
// ---------------------------------------------------------------------------

describe("apiPaginatedResponse — envelope structure", () => {
  it("returns success: true with data array", () => {
    const items = [{ id: 1 }];
    const response = apiPaginatedResponse(items, 1, 1, 20);

    expect(response.success).toBe(true);
    expect(response.data).toBe(items);
    expect(typeof response.timestamp).toBe("string");
    expect(typeof response.requestId).toBe("string");
  });

  it("uses the caller-provided requestId", () => {
    const response = apiPaginatedResponse(
      [],
      0,
      1,
      20,
      "trace-abc-123",
    );

    expect(response.requestId).toBe("trace-abc-123");
  });

  it("generates a unique requestId when none provided", () => {
    const r1 = apiPaginatedResponse([], 0, 1, 20);
    const r2 = apiPaginatedResponse([], 0, 1, 20);

    expect(r1.requestId).not.toBe(r2.requestId);
  });

  it("returns an empty array when data is empty", () => {
    const response = apiPaginatedResponse([], 0, 1, 20);

    expect(response.data).toEqual([]);
    expect(response.pagination.total).toBe(0);
    expect(response.pagination.hasNextPage).toBe(false);
  });
});
