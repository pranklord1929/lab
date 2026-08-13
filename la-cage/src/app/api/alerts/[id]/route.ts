import { readLocalStore, writeLocalStore } from "@/lib/store/local";
import { getDataMode, getSupabaseOrNull } from "@/lib/store/mode";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const status = body.status === "done" ? "done" : "open";

    if (getDataMode() === "supabase") {
      const supabase = getSupabaseOrNull();
      if (!supabase) throw new Error("Supabase non configuré");
      const { data, error } = await supabase
        .from("alerts")
        .update({ status })
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ alert: data });
    }

    const store = await readLocalStore();
    const alert = store.alerts.find((a) => a.id === id);
    if (!alert) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    alert.status = status;
    await writeLocalStore(store);
    return NextResponse.json({ alert });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
