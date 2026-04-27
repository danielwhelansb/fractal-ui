import { Health } from "@/app/api/health/route";
import { getFractalEngineURL } from "./config-helper";
import prisma from "@/lib/prisma";
import { decrypt, sha256Hash, jsonStringifyCanonical } from "./crypto";
import km2, {
  Crypto,
  Net,
  Wallet,
  UnsignedTransaction,
  SighashType,
  TransactionInputOptions,
  TransactionOutputOptions,
} from "@houseofdoge/km2";
import { GetIndexerUTXOs, UTXOItem } from "./indexer-client";
import { Mint, MintsResponse } from "@/app/api/mints/route";
import { Invoice, MintWithBalance, MintWithBalanceResponse } from "./definitions";
import { InvoicesResponse } from "@/app/api/invoice/my/route";
import { removeNullKeys } from "./utils";
import { createClient, Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { FractalEngineRpcService } from "fractal-engine-client-js";
import { create } from "@bufbuild/protobuf";
import { parseISO } from 'date-fns';
 
const KOINU = 100_000_000;
const KOINU_DECIMALS = 8;

const url = await getFractalEngineURL();
const transport = createConnectTransport({
  baseUrl: url!,
});
const client = createClient(FractalEngineRpcService, transport);

export const GetFractalEngineHealth = async (): Promise<Health> => { 
  try {
    const result = await client.getHealth({})
    const resultObj = JSON.parse(JSON.stringify(result))
 
    return {
      ...resultObj,
      fractal_engine_url: url,
      fractal_engine_connected: true,
    } as Health;
  } catch (e) {}

  return {
    fractal_engine_url: url,
    fractal_engine_connected: false,
  } as Health;
};

export const GetMyTokens = async (
  page: number,
  limit: number,
  myAddress: string,
): Promise<MintWithBalanceResponse> => {
  const res = await client.getTokenBalances({
    address: {
      value: myAddress
    },
    includeMintDetails: true,
    page: page,
    limit: limit
  })
  
  const tokenBalances = res.mints.map((v) => {
    const mint = v.mint!;

    const mintWithBalance = {
        id: mint.id,
        hash: mint.hash!.value,
        title: mint.title,
        fraction_count: mint.fractionCount,
        metadata: mint.metadata,
        description: mint.description,
        transaction_hash: mint.transactionHash!.value,
        block_height: mint.blockHeight,
        created_at: parseISO(mint.createdAt),
        feed_url: mint.feedUrl,
        owner_address: mint.ownerAddress!.value,
        address: v.address!.value,
        quantity: v.quantity,
    } as MintWithBalance; 

    return mintWithBalance;
  })

  return {
    mints: tokenBalances,
    page: res.page,
    total: res.total,
  }
};

export const GetMyInvoices = async (
  page: number,
  limit: number,
  myAddress: string,
): Promise<InvoicesResponse> => {
  
  const res = await client.getInvoices({
    address: {
      value: myAddress,
    },
    page: page,
    limit: limit
  })

  const invoiceMappings = res.invoices.map((inv) => {
    return {
      id: inv.id,
      hash: inv.hash?.value,
      mint_hash: inv.mintHash?.value,
      quantity: inv.quantity,
      price: inv.price,
      buyer_address: inv.buyerAddress?.value,
      created_at: inv.createdAt,
      seller_address: inv.sellerAddress?.value,
      public_key: inv.publicKey,
    } as Invoice
  })

  return {
    invoices: invoiceMappings,
    limit: res.limit,
    page: res.page,
    total: res.total,
  };
};

export const GetMyMints = async (
  page: number,
  limit: number,
  myAddress: string | null,
): Promise<MintsResponse> => {
  const res = await client.getMints({
    page: page,
    limit: limit,
  });

  const mintMappings = res.mints.map((mint) => {
    return {
      id: mint.id,
      hash: mint.hash!.value,
      title: mint.title,
      fraction_count: mint.fractionCount,
      metadata: mint.metadata,
      description: mint.description,
      transaction_hash: mint.transactionHash!.value,
      block_height: mint.blockHeight,
      created_at: parseISO(mint.createdAt),
      feed_url: mint.feedUrl,
      owner_address: mint.ownerAddress!.value,
    } as Mint;
  });

  return {
    mints: mintMappings,
    page: res.page,
    total: res.total,
    limit: res.limit,
  };
};

export const CreateInvoice = async (invoiceData: any): Promise<string> => {
  const walletRecord = await prisma.wallet.findFirstOrThrow({
    where: { active: true },
  });
  const { wallet, network } = await getWallet(
    walletRecord.privateKey,
    invoiceData.password,
  );
  delete invoiceData.password;

  const utxos = await GetIndexerUTXOs(walletRecord.address);

  if (utxos.length === 0) {
    throw new Error("No UTXOs found");
  }

  using kp = wallet.deriveKeypair({ account: 1, change: 0, index: 0 });

  invoiceData.payment_address = walletRecord.address;
  invoiceData.seller_address = walletRecord.address;

  const invoiceResponse = await invoiceHttp(
    invoiceData,
    wallet,
    walletRecord.address,
  );

  const unsignedTrxn = new UnsignedTransaction(Crypto.Dogecoin, network);

  // NOTE: This is a pretty crude way of figuring out UTXOs and Fees.
  const totalValue = dogeToKoinu(utxos[0].value);
  const totalFee = dogeToKoinu("0.002");

  unsignedTrxn.addInput({
    outputIndex: utxos[0].vout,
    prevTxId: utxos[0].tx,
    scriptPubKeyHex: utxos[0].script,
    value: totalValue,
    sequence: 0xffffffff,
  });

  unsignedTrxn.addOutput({
    kind: "payment",
    address: walletRecord.address,
    value: totalValue - totalFee,
  });

  unsignedTrxn.addOutput({
    kind: "opReturn",
    data: invoiceResponse.encoded_transaction_body,
    value: 0,
  });

  const signedTrxn = unsignedTrxn.sign({
    keypairs: [kp],
  });

  const trxnId = await sendSignedTransaction(signedTrxn.rawHex);

  return trxnId;
};

export const PayInvoice = async (invoiceData: any): Promise<string> => {
  const walletRecord = await prisma.wallet.findFirstOrThrow({
    where: { active: true },
  });
  const { wallet, network } = await getWallet(
    walletRecord.privateKey,
    invoiceData.password,
  );
  delete invoiceData.password;

  const utxos = await GetIndexerUTXOs(walletRecord.address);

  if (utxos.length === 0) {
    throw new Error("No UTXOs found");
  }

  using kp = wallet.deriveKeypair({ account: 1, change: 0, index: 0 });

  const invoiceResponse = await payInvoiceHttp(invoiceData.invoice_hash);

  const unsignedTrxn = new UnsignedTransaction(Crypto.Dogecoin, network);

  // NOTE: This is a pretty crude way of figuring out UTXOs and Fees.
  const totalValue = dogeToKoinu(utxos[0].value);
  const totalFee = dogeToKoinu("0.002");
  const invoiceValue = dogeToKoinu(`${invoiceData.total}`);

  const changeValue = totalValue - invoiceValue - totalFee;

  unsignedTrxn.addInput({
    outputIndex: utxos[0].vout,
    prevTxId: utxos[0].tx,
    scriptPubKeyHex: utxos[0].script,
    value: totalValue,
    sequence: 0xffffffff,
  });

  unsignedTrxn.addOutput({
    kind: "payment",
    address: walletRecord.address,
    value: changeValue,
  });

  unsignedTrxn.addOutput({
    kind: "payment",
    address: invoiceData.seller_address,
    value: invoiceValue,
  });

  unsignedTrxn.addOutput({
    kind: "opReturn",
    data: invoiceResponse.encoded_transaction_body,
    value: 0,
  });

  const signedTrxn = unsignedTrxn.sign({
    keypairs: [kp],
  });

  const trxnId = await sendSignedTransaction(signedTrxn.rawHex);

  return trxnId;
};

export const MintToken = async (mintData: any): Promise<string> => {
  const walletRecord = await prisma.wallet.findFirstOrThrow({
    where: { active: true },
  });
  const { wallet, network } = await getWallet(
    walletRecord.privateKey,
    mintData.password,
  );
  delete mintData.password;

  const utxos = await GetIndexerUTXOs(walletRecord.address);

  if (utxos.length === 0) {
    throw new Error("No UTXOs found");
  }

  using kp = wallet.deriveKeypair({ account: 1, change: 0, index: 0 });

  const mintResponse = await mintTokenHttp(
    mintData,
    wallet,
    walletRecord.address,
  );

  const unsignedTrxn = new UnsignedTransaction(Crypto.Dogecoin, network);

  // NOTE: This is a pretty crude way of figuring out UTXOs and Fees.
  const totalValue = dogeToKoinu(utxos[0].value);
  const totalFee = dogeToKoinu("0.002");

  unsignedTrxn.addInput({
    outputIndex: utxos[0].vout,
    prevTxId: utxos[0].tx,
    scriptPubKeyHex: utxos[0].script,
    value: totalValue,
    sequence: 0xffffffff,
  });

  unsignedTrxn.addOutput({
    kind: "payment",
    address: walletRecord.address,
    value: totalValue - totalFee,
  });

  unsignedTrxn.addOutput({
    kind: "opReturn",
    data: mintResponse.encoded_transaction_body,
    value: 0,
  });

  const signedTrxn = unsignedTrxn.sign({
    keypairs: [kp],
  });

  const trxnId = await sendSignedTransaction(signedTrxn.rawHex);

  return trxnId;
};

const sendSignedTransaction = async (
  encodedTrxnHex: string,
): Promise<string> => {
  const res = await client.dogeSend({
    encodedTransactionHex: encodedTrxnHex,
  });
  return res.transactionId;
};

const invoiceHttp = async (
  invoiceData: any,
  wallet: Wallet,
  address: string,
): Promise<{ encoded_transaction_body: string; hash: string }> => {
  using kp = wallet.deriveKeypair({ account: 1, change: 0, index: 0 });

  invoiceData = removeNullKeys(invoiceData);

  const payload = {
    paymentAddress: { value: invoiceData.payment_address },
    sellerAddress: { value: invoiceData.seller_address },
    ...(invoiceData.buyer_address && { buyerAddress: { value: invoiceData.buyer_address } }),
    ...(invoiceData.mint_hash && { mintHash: { value: invoiceData.mint_hash } }),
    quantity: invoiceData.quantity ?? 0,
    price: invoiceData.price ?? 0,
  };

  const hashedPayload = sha256Hash(jsonStringifyCanonical(payload));
  const signature = kp.signMessage({ message: hashedPayload });

  const res = await client.createInvoice({
    payload,
    publicKey: kp.publicKey,
    signature: signature.toBase64(),
  });

  return {
    encoded_transaction_body: res.encodedTransactionBody,
    hash: res.hash!.value,
  };
};

const payInvoiceHttp = async (
  invoiceHash: string,
): Promise<{ encoded_transaction_body: string }> => {
  const res = await client.createNewPayment({
    invoiceHash: { value: invoiceHash },
  });

  return {
    encoded_transaction_body: res.values["encoded_transaction_body"],
  };
};

const mintTokenHttp = async (
  mintData: any,
  wallet: Wallet,
  address: string,
): Promise<{ encoded_transaction_body: string; hash: string }> => {
  using kp = wallet.deriveKeypair({ account: 1, change: 0, index: 0 });

  mintData.owner_address = address;
  mintData = removeNullKeys(mintData);

  const payload = {
    ownerAddress: { value: mintData.owner_address },
    title: mintData.title ?? "",
    fractionCount: mintData.fraction_count ?? 0,
    description: mintData.description ?? "",
    feedUrl: mintData.feed_url ?? "",
    contractOfSale: mintData.contract_of_sale ?? "",
    minSignatures: mintData.min_signatures ?? 0,
    signatureRequirementType: mintData.signature_requirement_type ?? 0,
    tags: mintData.tags ?? [],
    assetManagers: mintData.asset_managers ?? [],
    ...(mintData.metadata && { metadata: { value: mintData.metadata } }),
    ...(mintData.lockup_options && { lockupOptions: { value: mintData.lockup_options } }),
    ...(mintData.requirements && { requirements: { value: mintData.requirements } }),
  };

  const hashedPayload = sha256Hash(jsonStringifyCanonical(payload));
  const signature = kp.signMessage({ message: hashedPayload });

  const res = await client.createMint({
    payload,
    publicKey: kp.publicKey,
    signature: signature.toBase64(),
  });

  return {
    encoded_transaction_body: res.encodedTransactionBody,
    hash: res.hash!.value,
  };
};

const getWallet = async (
  privateKey: string,
  password: string,
): Promise<{ wallet: Wallet; network: Net }> => {
  const health = await GetFractalEngineHealth();

  let network;
  if (health.chain === "regtest") {
    network = Net.Regtest;
  } else if (health.chain === "testnet") {
    network = Net.Testnet;
  } else {
    network = Net.Mainnet;
  }

  const privateKeyHex = decrypt(privateKey, password);

  const wallet = Wallet.fromXPriv(privateKeyHex, {
    cryptocurrency: Crypto.Dogecoin,
    network: network,
  });

  return {
    wallet,
    network,
  };
};

export const dogeToKoinu = (s: string): number => {
  const m = s.trim().match(/^([+-])?(\d+)(?:\.(\d{0,8}))?$/);
  if (!m) throw new Error(`invalid amount: ${s}`);
  const sign = m[1] === "-" ? -1 : 1;
  const w = m[2].replace(/^0+/, "") || "0";
  const f = (m[3] || "").padEnd(8, "0");

  // Max safe: whole <= 90,071,992 (because (whole*1e8 + frac) must fit 2^53-1)
  if (w.length > 8 || (w.length === 8 && Number(w) > 90071992)) {
    throw new Error("amount too large for a JS number; use the string version");
  }

  return sign * (Number(w) * KOINU + Number(f));
};
export const koinuToDoge = (k: number): string =>
  `${k / KOINU}.${(k % KOINU).toString().padStart(8, "0")}`;
