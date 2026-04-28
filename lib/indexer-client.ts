import { getIndexerURL } from "./config-helper";
import { Balance } from "@/app/api/balance/route";

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

const rpcPost = async (indexerUrl: string, procedure: string, body: object) => {
  const result = await fetch(`${indexerUrl}/such.indexer.v1.IndexerAPI/${procedure}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return result.json();
};

const koinuToDoge = (koinu: number): string => {
  const abs = Math.abs(koinu);
  const whole = Math.floor(abs / 100_000_000);
  const frac = (abs % 100_000_000).toString().padStart(8, "0");
  return `${koinu < 0 ? "-" : ""}${whole}.${frac}`;
};

export const GetIndexerBalance = async (address: string): Promise<Balance> => {
  const indexerUrl = await getIndexerURL();
  const res = await rpcPost(indexerUrl, "GetBalance", { account: address });
  return { current: res.balance?.available ?? 0 };
};

export const GetIndexerUTXOs = async (address: string): Promise<UTXOItem[]> => {
  const indexerUrl = await getIndexerURL();
  const res = await rpcPost(indexerUrl, "ListAccountUTXOs", { account: address });
  return (res.utxos ?? []).map((utxo: any) => ({
    tx: Buffer.from(utxo.tx, "base64").toString("hex"),
    vout: utxo.vout,
    value: koinuToDoge(utxo.value),
    type: utxo.type,
    script: Buffer.from(utxo.script, "base64").toString("hex"),
  }));
};

export const GetIndexerHealth = async (): Promise<any> => {
  const indexerUrl = await getIndexerURL();
  try {
    const result = await fetch(`${indexerUrl}/such.indexer.v1.IndexerAPI/Health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (result.ok) {
      return {
        indexer_url: indexerUrl,
        indexer_connected: true,
      };
    }
  } catch (e) {}
  return {
    indexer_url: indexerUrl,
    indexer_connected: false,
  };
};
