import { NextRequest, NextResponse } from "next/server";
import { getAllListings } from "@/lib/db/listings-store";

export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type") ?? undefined;
    const maxPrice = req.nextUrl.searchParams.get("maxPrice")
      ? Number(req.nextUrl.searchParams.get("maxPrice"))
      : undefined;
    const seller = req.nextUrl.searchParams.get("seller") ?? undefined;

    const listings = getAllListings({ type, maxPrice, seller });

    return NextResponse.json({
      listings,
      count: listings.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch listings";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
