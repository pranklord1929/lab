import { syncAgentHeartbeats } from "@/lib/import/pipeline";
import { getDataMode } from "@/lib/store/mode";
import { NextResponse } from "next/server";

export async function GET() {
  const agents = await syncAgentHeartbeats();
  return NextResponse.json({
    mode: getDataMode(),
    agents,
    updatedAt: new Date().toISOString(),
  });
}
