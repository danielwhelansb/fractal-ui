"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderPinwheel } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { MintsResponse } from "@/app/api/mints/route";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FilterableCombobox } from "@/components/ui/forms/filterable-combobox";
import { InputFormField } from "@/components/ui/forms/input-form-field";
import { FormPaper } from "@/components/ui/surfaces/FormPaper";
import { GridPaper } from "@/components/ui/surfaces/GridPaper";
import { WalletNotConfiguredAlert } from "@/components/wallet/wallet-not-configured-alert";
import { AuthContext } from "@/context/auth-context";
import { WalletContext } from "@/context/wallet-context";
import { useAPI } from "@/hooks/useAPI";

const NewInvoiceSchema = z.object({
  buyerAddress: z.string().nonempty({ error: "Please enter a buyer address." }),
  mintHash: z.string().nonempty({ error: "Please enter a mint hash." }),
  quantity: z.coerce.number().min(1),
  pricePer: z.coerce.number().min(1),
});

export default function CreateNewInvoice() {
  const { wallet } = useContext(WalletContext);
  const [loading, setLoading] = useState(false);
  const { password } = useContext(AuthContext);
  const { data: mintsData, isLoading: mintsLoading } =
    useAPI<MintsResponse>("/api/mints?page=0&limit=100");
  const mintOptions = useMemo(
    () =>
      (mintsData?.mints ?? []).map((m) => ({
        label: m.title,
        value: m.hash,
      })),
    [mintsData],
  );

  const form = useForm<
    z.input<typeof NewInvoiceSchema>,
    unknown,
    z.output<typeof NewInvoiceSchema>
  >({
    resolver: zodResolver(NewInvoiceSchema),
    defaultValues: {
      buyerAddress: "",
      mintHash: "",
      quantity: 0,
      pricePer: 0,
    },
    mode: "all",
    reValidateMode: "onChange",
  });

  const onSubmit = async (data: z.infer<typeof NewInvoiceSchema>) => {
    try {
      setLoading(true);
      const res = await fetch("/api/invoice/create", {
        method: "POST",
        body: JSON.stringify({
          buyer_address: data.buyerAddress,
          mint_hash: data.mintHash,
          quantity: data.quantity,
          price: data.pricePer,
          password: password,
        }),
      });
      if (!res.ok) {
        throw new Error("invoice creation failed");
      }
      form.reset();
    } catch (error) {
      console.error("Error creating invoice:", error);
    } finally {
      setLoading(false);
    }
  };

  const [quantity, pricePer] = form.watch(["quantity", "pricePer"]);
  const total = Number(quantity) * Number(pricePer);

  return (
    <GridPaper>
      {!wallet ? (
        <WalletNotConfiguredAlert />
      ) : (
        <Form {...form}>
          <FormPaper
            className="min-w-xl"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <InputFormField
              control={form.control}
              name="buyerAddress"
              label="Buyer Address"
              required
              disabled={loading}
            />
            <FormField
              control={form.control}
              name="mintHash"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="mintHash">
                    <span className="flex gap-1">
                      Mint
                      <span className="text-rose-400">*</span>
                    </span>
                    <FormMessage />
                  </FormLabel>
                  <FilterableCombobox
                    options={mintOptions}
                    value={field.value}
                    setValue={field.onChange}
                    loading={loading || mintsLoading}
                    type="mint"
                    label="Click to select a mint."
                  />
                </FormItem>
              )}
            />
            <InputFormField
              control={form.control}
              name="quantity"
              label="Quantity"
              inputType="number"
              required
              disabled={loading}
            />
            <InputFormField
              control={form.control}
              name="pricePer"
              label="Price per fraction (DOGE)"
              inputType="number"
              required
              disabled={loading}
            />
            <Button type="submit" variant="creative" disabled={loading}>
              {loading ? (
                <LoaderPinwheel className="size-4 animate-spin" />
              ) : null}
              {loading ? "Creating..." : "Create Invoice"}
            </Button>
          </FormPaper>
        </Form>
      )}
    </GridPaper>
  );
}
