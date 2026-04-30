import { NextRequest, NextResponse } from "next/server";
import { PAGE_SIZE, type Invoice } from "@/lib/definitions";
import { GetMyInvoices } from "@/lib/fractal-engine-client";

export type InvoicesResponse = {
  invoices: Invoice[];
  total: number;
  page: number;
  limit: number;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const page = Number(searchParams.get("page")) || 0;

  if (!address || address === "undefined") {
    return NextResponse.json<InvoicesResponse>({
      invoices: [],
      total: 0,
      page,
      limit: PAGE_SIZE,
    });
  }

  try {
    const invoicesResponse = await GetMyInvoices(page, PAGE_SIZE, address);
    return NextResponse.json<InvoicesResponse>(invoicesResponse);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch invoices." },
      { status: 500 },
    );
  }
}
