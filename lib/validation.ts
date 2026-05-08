import type { Config } from "@/generated/prisma";
import { CONFIG_KEYS } from "@/lib/definitions";

export const validateConfigRows = (configData: Config[]): boolean => {
  const present = new Set(configData.map((c) => c.key));
  return CONFIG_KEYS.every((k) => present.has(k));
};
