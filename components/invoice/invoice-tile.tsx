import { format } from "date-fns/format";
import { CalendarDays, Clock, QrCode } from "lucide-react";
import { InvoiceItem } from "@/components/invoice/invoice-item";
import { InvoiceShareView } from "@/components/invoice/invoice-share";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Invoice } from "@/lib/definitions";
import { cn } from "@/lib/utils";

const InvoiceType = ({ selling }: { selling: boolean }) => {
  return (
    <div
      className={cn(
        "px-1 py-0.5 text-xs border-1 rounded-sm self-start select-none font-bold text-shadow-xs",
        selling
          ? "border-emerald-700 bg-emerald-500 text-white text-shadow-emerald-800/40"
          : "border-blue-700 bg-blue-500 text-white text-shadow-blue-800/40",
      )}
    >
      {selling ? "Selling" : "Buying"}
    </div>
  );
};

export const InvoiceTile = ({
  invoice,
  selling,
}: {
  invoice: Invoice;
  selling: boolean;
}) => {
  return (
    <div className="flex flex-row gap-2 justify-between border-1 border-zinc-300 rounded-sm bg-white">
      <div className="flex flex-col flex-1 text-xs">
        <div className="flex flex-row flex-1 justify-between items-center gap-2 text-zinc-600 border-b-1 border-b-zinc-200 p-1.5">
          <div className="flex flex-row gap-4 font-semibold">
            <div className="flex flex-row items-center gap-1">
              <CalendarDays className="size-3.5 shrink-0 text-zinc-400" />
              <p>{`${format(new Date(invoice.created_at), "MMMM dd, yyyy")}`}</p>
            </div>

            <div className="flex flex-row items-center gap-1">
              <Clock className="size-3.5 shrink-0 text-zinc-400" />
              <p>{`${format(new Date(invoice.created_at), "h:mm a")}`}</p>
            </div>
          </div>
          <div className="flex flex-row items-center gap-2">
            {invoice.paid_at ? (
              <span
                title={`Paid ${format(new Date(invoice.paid_at), "PPpp")}`}
                className="px-1 py-0.5 text-xs border-1 rounded-sm self-start select-none font-bold text-shadow-xs border-emerald-700 bg-emerald-100 text-emerald-700"
              >
                Paid
              </span>
            ) : null}
            {selling && !invoice.paid_at ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <QrCode className="size-3.5" />
                    Payment details
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogTitle className="sr-only">Payment details</DialogTitle>
                  <DialogDescription className="sr-only">
                    DogeConnect payment URI and breakdown for this invoice.
                  </DialogDescription>
                  <InvoiceShareView invoiceHash={invoice.hash} />
                </DialogContent>
              </Dialog>
            ) : null}
            <InvoiceType selling={selling} />
          </div>
        </div>
        <div className="flex flex-col gap-2 p-2">
          <div className="flex flex-row gap-2 justify-between">
            <InvoiceItem
              label="Quantity"
              value={invoice.quantity.toLocaleString()}
              variant="green"
            />
            <InvoiceItem
              label="Price (koinu)"
              value={invoice.price.toLocaleString()}
              variant="green"
            />
          </div>

          <div className="flex flex-col xl:flex-row gap-2 justify-between">
            <InvoiceItem
              label="Invoice Hash"
              value={invoice.hash}
              variant="blue"
            />
            <InvoiceItem
              label="Mint Hash"
              value={invoice.mint_hash}
              variant="blue"
            />
          </div>
          <InvoiceItem
            label="Seller Address"
            value={invoice.seller_address}
            variant="amber"
          />
          <InvoiceItem
            label="Buyer Address"
            value={invoice.buyer_address}
            variant="amber"
          />
        </div>
      </div>
    </div>
  );
};
