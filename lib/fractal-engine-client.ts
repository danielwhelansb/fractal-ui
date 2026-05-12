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
import { parseISO } from 'date-fns';
 
const KOINU = 100_000_000;
const KOINU_DECIMALS = 8; 

export const newClient = async ():  Promise<typeof client> => {
  const url = await getFractalEngineURL();
  const transport = createConnectTransport({
    baseUrl: url!,
  });
  const client = createClient(FractalEngineRpcService, transport);

  return client;
}

export const GetFractalEngineHealth = async (fallbackUrl?: string): Promise<Health> => {
  try {
    const client = await newClient();
    const url = await getFractalEngineURL(fallbackUrl);
    const result = await client.getHealth({});
    return {
      current_block_height: Number(result.currentBlockHeight ?? 0),
      latest_block_height: Number(result.latestBlockHeight ?? 0),
      chain: result.chain,
      wallets_enabled: result.walletsEnabled,
      version: result.version,
      fractal_engine_url: url!,
      fractal_engine_connected: true,
      indexer_url: "",
      indexer_connected: false,
    };
  } catch (e) {
    console.log("Error: ", e);
  }

  const url = await getFractalEngineURL(fallbackUrl);

  return {
    current_block_height: 0,
    latest_block_height: 0,
    chain: "",
    wallets_enabled: false,
    version: "",
    fractal_engine_url: url!,
    fractal_engine_connected: false,
    indexer_url: "",
    indexer_connected: false,
  };
};

export const GetMyTokens = async (
  page: number,
  limit: number,
  myAddress: string,
): Promise<MintWithBalanceResponse> => {
  const client = await newClient();
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
  const client = await newClient();
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
      paid_at: inv.paidAt?.valid ? inv.paidAt.time : null,
    } as Invoice
  })

  return {
    invoices: invoiceMappings,
    limit: res.limit,
    page: res.page,
    total: res.total,
  };
};

export const GetMints = async (
  page: number,
  limit: number,
): Promise<MintsResponse> => {
  const client = await newClient();
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

export type CreateInvoiceResult = {
  transaction_hash: string;
  invoice_hash: string;
};

export const CreateInvoice = async (
  invoiceData: any,
): Promise<CreateInvoiceResult> => {
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

  return { transaction_hash: trxnId, invoice_hash: invoiceResponse.hash };
};

export const GetCreateNewPaymentBody = async (
  invoiceHash: string,
): Promise<string> => {
  const client = await newClient();
  const res = await client.createNewPayment({
    invoiceHash: { value: invoiceHash },
  });
  return res.values["encoded_transaction_body"];
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
  const totalFee = dogeToKoinu("0.002");
  const invoiceValue = dogeToKoinu(`${invoiceData.total}`);
  const required = invoiceValue + totalFee;

  let totalValue = 0;
  const selectedUtxos: UTXOItem[] = [];
  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalValue += dogeToKoinu(utxo.value);
    if (totalValue >= required) break;
  }

  if (totalValue < required) {
    console.error(`[PayInvoice] Insufficient funds: totalValue=${totalValue} < required=${required}`);
    throw new Error("Insufficient funds to pay invoice");
  }

  const changeValue = totalValue - invoiceValue - totalFee;

  for (const utxo of selectedUtxos) {
    unsignedTrxn.addInput({
      outputIndex: utxo.vout,
      prevTxId: utxo.tx,
      scriptPubKeyHex: utxo.script,
      value: dogeToKoinu(utxo.value),
      sequence: 0xffffffff,
    });
  }

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
  const client = await newClient();
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

  const signablePayload = {
    payment_address: invoiceData.payment_address ?? "",
    buyer_address: invoiceData.buyer_address ?? "",
    mint_hash: invoiceData.mint_hash ?? "",
    quantity: invoiceData.quantity ?? 0,
    price: invoiceData.price ?? 0,
    seller_address: invoiceData.seller_address ?? "",
  };

  const hashedPayload = sha256Hash(jsonStringifyCanonical(signablePayload));
  const signature = kp.signMessage({ message: hashedPayload });
  const client = await newClient();  
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
  const client = await newClient();
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

  const signablePayload: Record<string, unknown> = {
    title: mintData.title ?? "",
    fraction_count: mintData.fraction_count ?? 0,
    description: mintData.description ?? "",
    owner_address: mintData.owner_address,
  };
  const isNonEmptyObj = (v: unknown) =>
    v != null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;
  if (mintData.tags?.length) signablePayload.tags = mintData.tags;
  if (isNonEmptyObj(mintData.metadata)) signablePayload.metadata = mintData.metadata;
  if (isNonEmptyObj(mintData.requirements)) signablePayload.requirements = mintData.requirements;
  if (isNonEmptyObj(mintData.lockup_options)) signablePayload.lockup_options = mintData.lockup_options;
  if (mintData.feed_url) signablePayload.feed_url = mintData.feed_url;
  if (mintData.contract_of_sale) signablePayload.contract_of_sale = mintData.contract_of_sale;
  if (mintData.signature_requirement_type) signablePayload.signature_requirement_type = mintData.signature_requirement_type;
  if (mintData.asset_managers?.length) signablePayload.asset_managers = mintData.asset_managers;
  if (mintData.min_signatures) signablePayload.min_signatures = mintData.min_signatures;

  const hashedPayload = sha256Hash(jsonStringifyCanonical(signablePayload));
  const signature = kp.signMessage({ message: hashedPayload });

  const client = await newClient();
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
