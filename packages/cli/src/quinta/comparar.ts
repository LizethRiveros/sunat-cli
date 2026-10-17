import { claveGasto, type Gasto, type GastosFile } from "./gastos.ts";

/**
 * Compares the local ledger with the expenses SUNAT shows in "Propuesta de
 * información" (renta anual). SUNAT has no API for that screen, so the user
 * exports or copies the table into a CSV and this checks it offline.
 */

export interface FilaSunat {
	rucEmisor: string;
	comprobante: string;
	monto?: number;
	fecha?: string;
}

const norm = (h: string) =>
	h
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]/g, "");

function splitLine(line: string, sep: string): string[] {
	const out: string[] = [];
	let cur = "";
	let q = false;
	for (const ch of line) {
		if (ch === '"') q = !q;
		else if (ch === sep && !q) {
			out.push(cur);
			cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out.map((x) => x.trim());
}

/** Accepts , ; or tab separators and flexible headers (ruc, serie, numero, comprobante, monto/importe, fecha). */
export function parseCsvSunat(text: string): FilaSunat[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
	if (lines.length < 2) throw new Error("CSV needs a header row and at least one data row");
	const head = lines[0] as string;
	const sep = [";", "\t", ","].sort((a, b) => head.split(b).length - head.split(a).length)[0] as string;
	const cols = splitLine(head, sep).map(norm);
	const find = (...names: string[]) => cols.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
	const iRuc = find("ruc", "rucemisor", "numeroderuc");
	const iComp = find("comprobante", "documento", "nrocomprobante");
	const iSerie = find("serie");
	const iNum = find("numero", "nro", "correlativo");
	const iMonto = find("monto", "importe", "total");
	const iFecha = find("fecha");
	if (iRuc < 0 || (iComp < 0 && (iSerie < 0 || iNum < 0))) {
		throw new Error("CSV needs columns: ruc, and either comprobante or serie+numero (optional: monto, fecha)");
	}
	const rows: FilaSunat[] = [];
	for (const line of lines.slice(1)) {
		const c = splitLine(line, sep);
		const comprobante = iComp >= 0 ? (c[iComp] ?? "") : `${c[iSerie] ?? ""}-${c[iNum] ?? ""}`;
		const m = /^([A-Za-z0-9]{1,4})-0*(\d{1,8})$/.exec(comprobante.replace(/\s+/g, ""));
		if (!m) throw new Error(`Row with unreadable comprobante: ${line}`);
		const monto = iMonto >= 0 && c[iMonto] ? Number((c[iMonto] as string).replace(/[^0-9.-]/g, "")) : undefined;
		const fRaw = iFecha >= 0 ? (c[iFecha] ?? "") : "";
		const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fRaw);
		rows.push({
			rucEmisor: (c[iRuc] ?? "").replace(/\D/g, ""),
			comprobante: `${(m[1] as string).toUpperCase()}-${Number(m[2])}`,
			monto: Number.isFinite(monto) ? monto : undefined,
			fecha: dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : fRaw || undefined,
		});
	}
	return rows;
}

const key = (g: Pick<Gasto, "rucEmisor" | "comprobante">) =>
	claveGasto({ rucEmisor: g.rucEmisor, comprobante: g.comprobante.replace(/-0+(\d)/, "-$1") });

export interface Comparacion {
	/** In both lists (amount equal or not stated). */
	coinciden: Gasto[];
	/** Same receipt, different amount. */
	difierenMonto: Array<{ gasto: Gasto; montoSunat: number }>;
	/** In the notebook but NOT in SUNAT: the issuer may not have reported it under the DNI. */
	soloCuaderno: Gasto[];
	/** In SUNAT but missing from the notebook. */
	soloSunat: FilaSunat[];
}

export function compararConSunat(file: GastosFile, sunat: FilaSunat[]): Comparacion {
	const bySunat = new Map(sunat.map((r) => [key(r), r]));
	const seen = new Set<string>();
	const out: Comparacion = { coinciden: [], difierenMonto: [], soloCuaderno: [], soloSunat: [] };
	for (const g of file.gastos) {
		const k = key(g);
		const s = bySunat.get(k);
		if (!s) {
			out.soloCuaderno.push(g);
			continue;
		}
		seen.add(k);
		if (s.monto !== undefined && Math.abs(s.monto - g.monto) > 0.01) out.difierenMonto.push({ gasto: g, montoSunat: s.monto });
		else out.coinciden.push(g);
	}
	for (const [k, r] of bySunat) if (!seen.has(k)) out.soloSunat.push(r);
	return out;
}
