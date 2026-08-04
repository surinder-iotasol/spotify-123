/**
 * Unit test: PrismaClient instantiation and model type validation.
 * STORY-setup-004 — MongoDB database schema and Prisma ORM models.
 *
 * This test does NOT connect to a database. It only verifies that
 * the generated PrismaClient and all model typings compile without
 * TypeScript errors.
 */

import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Suppress "connected" warnings — we intentionally do not connect.
process.on("unhandledRejection", () => {
  // noop — Prisma may log connection failures when instantiating
});

describe("PrismaClient", () => {
  it("instantiates without error and exposes all model types", () => {
    const prisma = new PrismaClient({
      // Point to a dummy URL; we never call $connect or any query.
      datasources: { db: { url: "mongodb://localhost:27017/ralph-test" } },
    });

    // Verify the client exposes the expected model accessors.
    // These are compile-time checks — if any model is missing the
    // test will not compile.
    expect(prisma.user).toBeDefined();
    expect(prisma.artistProfile).toBeDefined();
    expect(prisma.track).toBeDefined();
    expect(prisma.playlist).toBeDefined();
    expect(prisma.playlistTrack).toBeDefined();
    expect(prisma.like).toBeDefined();
    expect(prisma.follow).toBeDefined();
    expect(prisma.report).toBeDefined();
    expect(prisma.auditLog).toBeDefined();

    // Sanity: client has standard methods.
    expect(typeof prisma.$connect).toBe("function");
    expect(typeof prisma.$disconnect).toBe("function");

    // Clean up — avoid leaving dangling connection promises.
    void prisma.$disconnect();
  });
});
