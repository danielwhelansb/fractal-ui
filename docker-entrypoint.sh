#!/bin/sh
set -e

mkdir -p "$(dirname "${DATABASE_URL#file:}")"

pnpm prisma migrate deploy

if [ -n "$FRACTAL_ENGINE_URL" ] || [ -n "$INDEXER_URL" ]; then
  node - <<'NODE'
const { PrismaClient } = require("./generated/prisma");
const prisma = new PrismaClient();

(async () => {
  const seeds = [
    ["fractal_engine_url", process.env.FRACTAL_ENGINE_URL],
    ["indexer_url", process.env.INDEXER_URL],
  ].filter(([, v]) => v);

  for (const [key, value] of seeds) {
    const existing = await prisma.config.findUnique({ where: { key } });
    if (!existing) {
      await prisma.config.create({ data: { key, value } });
    }
  }

  await prisma.$disconnect();
})().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
NODE
fi

exec "$@"
