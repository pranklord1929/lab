import { PDFParse } from "pdf-parse";

export type ParsedPdf = {
  text: string;
  pages: number;
  lines: string[];
};

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsedPdf> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = result.text ?? "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const pages =
    typeof result.total === "number"
      ? result.total
      : Math.max(1, Math.ceil(lines.length / 40));
  try {
    await parser.destroy?.();
  } catch {
    /* ignore */
  }
  return { text, pages, lines };
}

export function guessPdfKind(
  text: string,
): "fiche_paie" | "facture" | "other" {
  const t = text.toLowerCase();
  if (
    /bulletin de paie|fiche de paie|salaire net|net à payer|cotisations|urssaf/.test(
      t,
    )
  ) {
    return "fiche_paie";
  }
  if (/facture|tva|total ttc|total ht|n[°o]\s*facture|invoice/.test(t)) {
    return "facture";
  }
  return "other";
}

/** Best-effort field extraction from French pay slips / invoices */
export function extractPdfFields(
  kind: "fiche_paie" | "facture" | "other",
  text: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { raw_excerpt: text.slice(0, 2000) };

  if (kind === "fiche_paie") {
    const net = text.match(/net\s*(?:à payer|a payer)?[^\d]{0,20}([\d\s]+[.,]\d{2})/i);
    const brut = text.match(/brut[^\d]{0,20}([\d\s]+[.,]\d{2})/i);
    const hours = text.match(/([\d]+[.,]?\d*)\s*h(?:eures)?/i);
    const name =
      text.match(/(?:nom|employé|employe|salarié|salarie)\s*[:\s]+([A-Za-zÀ-ÿ\s\-']{2,40})/i) ??
      text.match(/^([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)+)/m);
    if (net) fields.net = parseMoney(net[1]);
    if (brut) fields.gross = parseMoney(brut[1]);
    if (hours) fields.hours = parseFloat(hours[1].replace(",", "."));
    if (name) fields.employee_name = name[1].trim();
  }

  if (kind === "facture") {
    const ttc = text.match(/total\s*ttc[^\d]{0,20}([\d\s]+[.,]\d{2})/i);
    const ht = text.match(/total\s*ht[^\d]{0,20}([\d\s]+[.,]\d{2})/i);
    const num = text.match(/(?:facture|invoice)\s*n[°o]?\s*[:\s]*([A-Z0-9\-\/]+)/i);
    const date = text.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
    if (ttc) fields.total_ttc = parseMoney(ttc[1]);
    if (ht) fields.total_ht = parseMoney(ht[1]);
    if (num) fields.invoice_number = num[1];
    if (date) fields.invoice_date = date[1];
  }

  return fields;
}

function parseMoney(s: string): number {
  return parseFloat(s.replace(/\s/g, "").replace(",", "."));
}
