import * as XLSX from "xlsx";

export type ParsedSheet = {
  sheet: string;
  headers: string[];
  rows: Record<string, unknown>[];
};

export function parseExcelBuffer(buffer: Buffer): ParsedSheet[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
    });
    const headers =
      json.length > 0
        ? Object.keys(json[0])
        : ((XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[]) ??
          []);
    return { sheet: name, headers, rows: json };
  });
}

/** Heuristic: inventaire if columns look like stock */
export function guessExcelKind(
  sheets: ParsedSheet[],
): "inventaire" | "fiche_paie" | "facture" | "excel" {
  const headers = sheets
    .flatMap((s) => s.headers)
    .map((h) => String(h).toLowerCase())
    .join(" ");
  if (
    /stock|par|on.?hand|quantit|inventaire|unit|unité/.test(headers)
  ) {
    return "inventaire";
  }
  if (/salaire|brut|net|heures|employé|employe|paie|payroll/.test(headers)) {
    return "fiche_paie";
  }
  if (/facture|ht|ttc|tva|invoice|fournisseur/.test(headers)) {
    return "facture";
  }
  return "excel";
}
