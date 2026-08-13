import { getDashboard } from "@/lib/data/dashboard";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const data = await getDashboard();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
