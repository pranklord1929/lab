import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "samples");
mkdirSync(dir, { recursive: true });

const inventaire = [
  { name: "Saumon ASC", on_hand: 2.1, par: 6, unit: "kg" },
  { name: "Beurre AOP", on_hand: 4.5, par: 3, unit: "kg" },
  { name: "Huile olive EV", on_hand: 1, par: 2, unit: "bidon" },
  { name: "Crème 35 %", on_hand: 3, par: 4, unit: "L" },
];

const paie = [
  { nom: "Alex", role: "Cuisine", heures: 72, brut: 1440, net: 1120 },
  { nom: "Sam", role: "Salle 50 %", heures: 46, brut: 782, net: 610 },
];

const factures = [
  {
    fournisseur: "Metro",
    numero: "F-4821",
    date: "2026-03-10",
    ht: 420,
    ttc: 504,
  },
  {
    fournisseur: "Rungis — Poissonnerie L.",
    numero: "BL-991",
    date: "2026-03-11",
    ht: 180,
    ttc: 180,
  },
];

function write(name, rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const path = join(dir, name);
  XLSX.writeFile(wb, path);
  console.log("wrote", path);
}

write("inventaire.xlsx", inventaire);
write("paie.xlsx", paie);
write("factures.xlsx", factures);
