import { NextResponse } from "next/server";
import { PRODUCT_NAME } from "@/lib/branding";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    product: PRODUCT_NAME,
    time: new Date().toISOString(),
  });
}
