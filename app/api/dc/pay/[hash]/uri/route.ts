import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { GetCreateNewPaymentBody, GetMyInvoices } from "@/lib/fractal-engine-client";
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

type EngineEnvelopeSummary = { pubkey: string; total: string };

const fetchEngineEnvelope = async (
  engineInternalURL: string,
  hash: string,
): Promise<EngineEnvelopeSummary> => {
  const res = await fetch(`${engineInternalURL}/dc/payment/${hash}`);
  if (!res.ok) throw new Error(`engine /dc/payment/${hash}: ${res.status}`);
  const env = await res.json();
  if (typeof env.pubkey !== "string") throw new Error("engine envelope missing pubkey");
  if (typeof env.payload !== "string") throw new Error("engine envelope missing payload");
  const payload = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8"));
  if (typeof payload.total !== "string") throw new Error("envelope payload missing total");
  return { pubkey: env.pubkey, total: payload.total };
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

    const wallet = await prisma.wallet.findFirst({ where: { active: true } });
    if (!wallet) {
      return NextResponse.json(
        { error: "no_wallet", message: "no active wallet" },
        { status: 404 },
      );
    }

    const all = await GetMyInvoices(0, 100, wallet.address);
    const invoice = all.invoices.find((inv) => inv.hash === hash);
    if (!invoice) {
      return NextResponse.json(
        { error: "not_found", message: "invoice not found" },
        { status: 404 },
      );
    }

    const opReturnHex = await GetCreateNewPaymentBody(hash);
    const { pubkey: pubHex, total } = await fetchEngineEnvelope(engineInternalURL, hash);
    const pubKeyHash = pubKeyHashUrlSafeB64(pubHex);

    const envelopePath = `/dc/payment/${hash}`;
    const envelopeURL = `${engineExternalURL.replace(/\/+$/, "")}${envelopePath}`;
    const uri = `dogeconnect:${stripScheme(envelopeURL)}?h=${pubKeyHash}`;

    return NextResponse.json<DCPayURIResponse>({
      uri,
      envelope_url: envelopeURL,
      breakdown: {
        invoice_hash: hash,
        seller_address: invoice.seller_address,
        total,
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
