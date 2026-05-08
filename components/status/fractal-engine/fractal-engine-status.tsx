import {
  Activity,
  EthernetPort,
  Factory,
  MessageCircleHeart,
  SatelliteDish,
  Send,
  Wifi,
} from "lucide-react";
import { BlockStatus } from "@/components/status/fractal-engine/block-status";
import { StatusCard } from "@/components/status/status-card/status-card";
import {
  Monospace,
  StatusSection,
} from "@/components/status/status-card/status-section";
import { useAPI } from "@/hooks/useAPI";
import { Health } from "@/app/api/health/route";

export const FractalEngineStatus = ({
  data,
  isLoading,
  error,
}: {
  data: Health | undefined;
  isLoading: boolean;
  error: Error;
}) => {
  return (
    <StatusCard
      title="Fractal Engine"
      titleIcon={<Factory className="size-4 text-muted-foreground" />}
    >
      <StatusSection
        title="Connection"
        titleIcon={EthernetPort}
        items={[
          {
            id: "fe-url",
            value: (
              <>
                Fractal Engine URL <Monospace>{data?.fractal_engine_url}</Monospace>
              </>
            ),
          },
          {
            id: "fe-version",
            value: (
              <>
                Fractal Engine Version <Monospace>{data?.version}</Monospace>
              </>
            ),
          },
          {
            id: "fe-connection-status",
            value: (
              <>
                Fractal Engine Connected{" "}
                <Monospace>
                  {data?.fractal_engine_connected ? "Yes" : "No"}
                </Monospace>
              </>
            ),
          },
        ]}
      />

      <StatusSection
        title="Health"
        titleIcon={Activity}
        items={[
          {
            id: "fe-block-status",
            value: (
              <BlockStatus data={data} error={error} isLoading={isLoading} />
            ),
          },
        ]}
      />
    </StatusCard>
  );
};
