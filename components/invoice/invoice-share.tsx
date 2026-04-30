"use client";

import { Check, Copy, Loader } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import type { DCPayURIResponse } from "@/app/api/dc/pay/[hash]/uri/route";
import { Button } from "@/components/ui/button";
import { Paper } from "@/components/ui/surfaces/Paper";
import { useAPI } from "@/hooks/useAPI";

type CopyButtonProps = {
  value: string;
  label?: string;
};

const CopyButton = ({ value, label = "Copy" }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-500" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
};

type FieldProps = {
  label: string;
  value: string;
  mono?: boolean;
};

const Field = ({ label, value, mono }: FieldProps) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <CopyButton value={value} />
    </div>
    <div
      className={`px-2 py-1 rounded-sm border border-zinc-200 bg-zinc-50 break-all ${
        mono ? "font-mono text-xs" : "text-sm"
      }`}
    >
      {value}
    </div>
  </div>
);

export const InvoiceShareView = ({
  invoiceHash,
  onDone,
}: {
  invoiceHash: string;
  onDone?: () => void;
}) => {
  const { data, isLoading, error } = useAPI<DCPayURIResponse>(
    `/api/dc/pay/${invoiceHash}/uri`,
  );
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!data?.uri) {
      setQrDataURL(null);
      return;
    }
    QRCode.toDataURL(data.uri, { width: 256, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataURL(url);
      })
      .catch((e) => console.error("QR encode failed", e));
    return () => {
      cancelled = true;
    };
  }, [data?.uri]);

  const fields = useMemo(() => {
    if (!data) return null;
    return [
      { label: "Seller address", value: data.breakdown.seller_address },
      { label: "Total to pay (DOGE)", value: data.breakdown.total },
      {
        label: "OP_RETURN payload (hex)",
        value: data.breakdown.op_return_hex,
        mono: true,
      },
      { label: "Invoice hash", value: data.breakdown.invoice_hash, mono: true },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <Paper className="p-6 items-center gap-3 bg-white border-0">
        <Loader className="size-5 animate-spin text-zinc-500" />
        <span className="text-sm text-zinc-500">Building payment URI…</span>
      </Paper>
    );
  }

  if (error || !data) {
    return (
      <Paper className="min-w-xl p-6 gap-3">
        <span className="text-sm text-rose-500">
          Could not generate the payment URI. {error?.message}
        </span>
        <Button variant="outline" onClick={onDone}>
          Back
        </Button>
      </Paper>
    );
  }

  return (
    <Paper className="p-6 gap-5 bg-white border-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Invoice ready to share</h2>
        <p className="text-sm text-zinc-500">
          Scan the QR or copy the URI. The buyer's wallet will fetch the signed
          payment envelope and build the transaction (including the required
          OP_RETURN) automatically.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        {qrDataURL ? (
          <img
            src={qrDataURL}
            alt="DogeConnect payment QR code"
            className="size-64 rounded-sm border border-zinc-200 bg-white p-2"
          />
        ) : (
          <div className="size-64 rounded-sm border border-dashed border-zinc-200 flex items-center justify-center">
            <Loader className="size-5 animate-spin text-zinc-400" />
          </div>
        )}
      </div>

      <Field label="Payment URI" value={data.uri} mono />

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-zinc-700">
          Payment components
        </h3>
        {fields?.map((f) => (
          <Field key={f.label} label={f.label} value={f.value} mono={f.mono} />
        ))}
      </div>

      {onDone ? (
        <div className="flex justify-end">
          <Button variant="creative" onClick={onDone}>
            Create another
          </Button>
        </div>
      ) : null}
    </Paper>
  );
};
