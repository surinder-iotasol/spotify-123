# Indie — Music Platform

Indie is a full-stack music platform for independent artists and listeners, built with Next.js 14 and TypeScript.

## Repository Layout

```
├── app/                  # Next.js App Router pages and layouts
├── src/
│   ├── app/              # Next.js app directory (pages, layouts)
│   ├── components/       # Reusable React components
│   ├── lib/              # Shared utilities and services
│   ├── services/         # Domain service logic
│   └── middleware.ts     # Next.js edge middleware
├── e2e/                  # Playwright end-to-end tests
│   ├── fixtures/
│   ├── pages/
│   └── tests/
├── prisma/               # Prisma schema and migrations
├── .github/workflows/    # CI pipeline definitions
└── public/               # Static assets
```

## Prerequisites

- **Node.js** 18.x or later
- **MongoDB** 6.x (local or Atlas)
- **AWS S3** or **Cloudflare R2** (for object storage)

## Development Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js development server on `localhost:3000` |
| `npm run build` | Production build with optimization |
| `npm start` | Run the production server |
| `npm run lint` | Run ESLint across the codebase |
| `npm run test` | Run Vitest unit and integration tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run Playwright end-to-end tests |

## Environment Setup

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env.local
```

Required variables are listed in `.env.example`.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 5.x (strict mode)
- **Database**: MongoDB via Prisma ORM
- **Storage**: AWS S3 / Cloudflare R2
- **Styling**: Tailwind CSS 3.x + shadcn/ui
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Auth**: JWT (HMAC-SHA256) with HTTP-only cookies
