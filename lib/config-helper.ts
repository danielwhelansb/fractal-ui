import prisma from "@/lib/prisma";

export const getFractalEngineURL = async (fallbackUrl?: string) => {
  const rows = await prisma.config.findFirst({
    where: { key: { equals: "fractal_engine_url" } },
  });

  return rows?.value || fallbackUrl;
};

export const getIndexerURL = async (fallbackUrl?: string) => {
  const rows = await prisma.config.findFirst({
    where: { key: { equals: "indexer_url" } },
  });

  return rows?.value || fallbackUrl;
};
