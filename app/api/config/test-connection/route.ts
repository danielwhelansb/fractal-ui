import { GetFractalEngineHealth } from "@/lib/fractal-engine-client";
import { GetIndexerHealth } from "@/lib/indexer-client";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fractalEngineUrl = searchParams.get("fractalEngineUrl");
  const indexerUrl = searchParams.get("indexerUrl");

  if (!fractalEngineUrl || !indexerUrl) {
    return NextResponse.json(
      { message: "Missing required parameters" },
      { status: 400 },
    );
  }

  try {
    const feHealth = await GetFractalEngineHealth();
    const indexerHealth = await GetIndexerHealth();

    if (!feHealth) {
      return NextResponse.json({
        status: 500,
        message: "Failed",
      });
    }

    if (!indexerHealth) {
      return NextResponse.json({
        status: 500,
        message: "Failed",
      });
    }


    return NextResponse.json({
      status: 200,
      message: "Connected",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "Failed to test connection" },
      { status: 500 },
    );
  }
}
