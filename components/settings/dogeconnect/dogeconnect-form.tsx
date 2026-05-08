import { zodResolver } from "@hookform/resolvers/zod";
import { useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CallToAction } from "@/components/setup/wizard/steps/call-to-action";
import { Form } from "@/components/ui/form";
import { InputFormField } from "@/components/ui/forms/input-form-field";
import { ConfigContext } from "@/context/config-context";

const DOGECONNECT_BASE_URL_KEY = "dogeconnect_base_url";

const DogeConnectFormSchema = z.object({
  baseUrl: z.union([z.literal(""), z.url()]),
});

export const DogeConnectForm = () => {
  const {
    configData,
    loading: configLoading,
    setLoading,
    refreshConfigData,
    error,
  } = useContext(ConfigContext);
  const [saved, setSaved] = useState(false);

  const stored =
    configData.find((c) => c.key === DOGECONNECT_BASE_URL_KEY)?.value ?? "";

  const form = useForm<
    z.input<typeof DogeConnectFormSchema>,
    unknown,
    z.output<typeof DogeConnectFormSchema>
  >({
    resolver: zodResolver(DogeConnectFormSchema),
    defaultValues: { baseUrl: "" },
    values: { baseUrl: stored },
  });

  const baseUrl = form.watch("baseUrl");

  const onSubmit = async (data: z.infer<typeof DogeConnectFormSchema>) => {
    try {
      setLoading(true);
      setSaved(false);
      await fetch("/api/config", {
        method: "POST",
        body: JSON.stringify([
          { key: DOGECONNECT_BASE_URL_KEY, value: data.baseUrl },
        ]),
      });
      setSaved(true);
      await refreshConfigData();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1">
      <Form {...form}>
        <form
          className="flex flex-col flex-1 justify-start gap-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <p className="text-sm text-zinc-500">
            Externally-reachable base URL of the Fractal Engine (e.g.{" "}
            <code>http://10.0.0.151:8891</code>). Embedded in invoice payment
            QR codes — the buyer's wallet fetches the signed payment envelope
            from <code>{"<this URL>"}/dc/payment/{"{hash}"}</code> and submits
            the signed transaction back to <code>/dc/relay/pay</code>. Must be
            reachable from the buyer's network.
          </p>
          <InputFormField
            control={form.control}
            name="baseUrl"
            label="Fractal Engine Public URL"
            placeholder="http://10.0.0.151:8891"
            disabled={configLoading}
          />
          <CallToAction
            handleSave={form.handleSubmit(onSubmit)}
            saved={saved}
            error={error}
            isDirty={form.formState.isDirty}
            isEmpty={!baseUrl && !stored}
            isLoading={configLoading}
          />
        </form>
      </Form>
    </div>
  );
};
