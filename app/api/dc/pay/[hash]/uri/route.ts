import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { GetCreateNewPaymentBody } from "@/lib/fractal-engine-client";
import prisma from "@/lib/prisma";

export type DCPayURIResponse = {
  uri: string;
  envelope_url: string;
  breakdown: {
    invoice_hash: string;
    seller_address: string;
    total: string;
    op_return_hex: string;
  };
};

const DOGECONNECT_BASE_URL_KEY = "dogeconnect_base_url";

const stripScheme = (url: string): string =>
  url.replace(/^https?:\/\//, "").replace(/\/+$/, "");

const pubKeyHashUrlSafeB64 = (pubHex: string): string => {
  const pub = Buffer.from(pubHex, "hex");
  return createHash("sha256").update(pub).digest().subarray(0, 15).toString("base64url");
};

type EngineEnvelopeSummary = {
  pubkey: string;
  total: string;
  sellerAddress: string;
};

const fetchEngineEnvelope = async (
  engineInternalURL: string,
  hash: string,
): Promise<EngineEnvelopeSummary> => {
  const res = await fetch(`${engineInternalURL}/dc/payment/${hash}`);
  if (!res.ok) {
    throw Object.assign(new Error(`engine /dc/payment/${hash}: ${res.status}`), {
      engineStatus: res.status,
    });
  }
  const env = await res.json();
  if (typeof env.pubkey !== "string") throw new Error("engine envelope missing pubkey");
  if (typeof env.payload !== "string") throw new Error("engine envelope missing payload");
  const payload = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8"));
  if (typeof payload.total !== "string") throw new Error("envelope payload missing total");
  const p2pkh = (payload.outputs ?? []).find(
    (o: { type?: string; address?: string }) =>
      (o.type ?? "p2pkh") === "p2pkh" && typeof o.address === "string",
  );
  return {
    pubkey: env.pubkey,
    total: payload.total,
    sellerAddress: p2pkh?.address ?? "",
  };
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  try {
    const { hash } = await params;

    const engineInternalURL = process.env.FRACTAL_ENGINE_URL;
    if (!engineInternalURL) {
      return NextResponse.json(
        { error: "config", message: "FRACTAL_ENGINE_URL env var is required" },
        { status: 500 },
      );
    }

    const baseRow = await prisma.config.findUnique({
      where: { key: DOGECONNECT_BASE_URL_KEY },
    });
    const engineExternalURL = baseRow?.value?.trim();
    if (!engineExternalURL) {
      return NextResponse.json(
        {
          error: "config",
          message:
            "Set 'Fractal Engine Public URL' in Settings → DogeConnect (the externally reachable base URL of fractal-engine, e.g. http://10.0.0.151:8891).",
        },
        { status: 400 },
      );
    }

    let envelope: EngineEnvelopeSummary;
    try {
      envelope = await fetchEngineEnvelope(engineInternalURL, hash);
    } catch (err) {
      const status = (err as { engineStatus?: number }).engineStatus;
      if (status === 404) {
        return NextResponse.json(
          { error: "not_found", message: "invoice not found in fractal-engine" },
          { status: 404 },
        );
      }
      throw err;
    }

    const opReturnHex = await GetCreateNewPaymentBody(hash);
    const pubKeyHash = pubKeyHashUrlSafeB64(envelope.pubkey);

    const envelopePath = `/dc/payment/${hash}`;
    const envelopeURL = `${engineExternalURL.replace(/\/+$/, "")}${envelopePath}`;
    const uri = `dogeconnect:${stripScheme(envelopeURL)}?h=${pubKeyHash}`;

    return NextResponse.json<DCPayURIResponse>({
      uri,
      envelope_url: envelopeURL,
      breakdown: {
        invoice_hash: hash,
        seller_address: envelope.sellerAddress,
        total: envelope.total,
        op_return_hex: opReturnHex,
      },
    });
  } catch (error) {
    console.error("dc/pay uri error:", error);
    return NextResponse.json(
      { error: "internal", message: "Failed to build payment URI" },
      { status: 500 },
    );
  }
}
