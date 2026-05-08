import { Balance } from "@/app/api/balance/route";
import { getIndexerURL } from "./config-helper";

export type UTXOItem = {
  tx: string;
  vout: number;
  value: string;
  type: string;
  script: string;
};

export type UTXOResponse = {
  utxo: UTXOItem[];
};

const KOINU = 100_000_000;

const koinuToDoge = (k: number): string => {
  const abs = Math.abs(k);
  const whole = Math.floor(abs / KOINU);
  const frac = (abs % KOINU).toString().padStart(8, "0");
  return `${k < 0 ? "-" : ""}${whole}.${frac}`;
};

const indexerGet = async (path: string, params: Record<string, string>) => {
  const indexerUrl = await getIndexerURL();
  const url = new URL(`${indexerUrl}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const result = await fetch(url, { headers: { Accept: "application/json" } });
  if (!result.ok) {
    throw new Error(
      `Indexer ${path} failed: ${result.status} ${result.statusText}`,
    );
  }
  return result.json();
};

export const GetIndexerBalance = async (address: string): Promise<Balance> => {
  const res = await indexerGet("/balance", { address });
  return { current: Number(res.current ?? 0) };
};

export const GetIndexerUTXOs = async (address: string): Promise<UTXOItem[]> => {
  const res = await indexerGet("/utxo", { address });
  return (res.utxo ?? []).map((u: UTXOItem & { value: number | string }) => ({
    tx: u.tx,
    vout: u.vout,
    value: typeof u.value === "number" ? koinuToDoge(u.value) : u.value,
    type: u.type,
    script: u.script,
  }));
};

export const GetIndexerHealth = async (): Promise<{
  indexer_url: string;
  indexer_connected: boolean;
}> => {
  const indexerUrl = await getIndexerURL();
  try {
    const result = await fetch(`${indexerUrl}/health`, {
      headers: { Accept: "application/json" },
    });
    if (result.ok) {
      return { indexer_url: indexerUrl, indexer_connected: true };
    }
  } catch {}
  return { indexer_url: indexerUrl, indexer_connected: false };
};
