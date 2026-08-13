import { ingestDocument, listDocuments } from "@/lib/import/pipeline";
import type { DocKind, DocSource } from "@/lib/types";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const documents = await listDocuments();
    return NextResponse.json({ documents });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file required" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const kind = (form.get("kind") as DocKind | null) ?? undefined;
      const source = (form.get("source") as DocSource | null) ?? "upload";
      const doc = await ingestDocument({
        filename: file.name,
        buffer,
        mime_type: file.type || null,
        source,
        kind,
      });
      return NextResponse.json({ document: doc });
    }

    const body = await req.json();
    if (!body?.filename || !body?.content_base64) {
      return NextResponse.json(
        { error: "filename + content_base64 required" },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(body.content_base64, "base64");
    const doc = await ingestDocument({
      filename: body.filename,
      buffer,
      mime_type: body.mime_type ?? null,
      source: body.source ?? "upload",
      kind: body.kind,
      external_id: body.external_id ?? null,
    });
    return NextResponse.json({ document: doc });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
