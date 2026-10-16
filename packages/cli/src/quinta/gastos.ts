import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSunatDir } from "../data/config.ts";
import { writePrivateFile } from "../data/private-storage.ts";
import { DEDUCCION_ADICIONAL_TOPE_UIT, type GastoKey, PORCENTAJES, UIT_2026 } from "./calc.ts";

/**
 * Local ledger of documented expenses for the 3 UIT additional deduction.
 *
 * It lives on this machine only (private file, no network, no clave SOL). A
 * receipt counts toward the deduction only when it carries the taxpayer's own
 * DNI or RUC: SUNAT builds its proposal from comprobantes issued to that
 * identifier, so a boleta without it is kept here but excluded from the sum.
 * Whether SUNAT actually registered it under the DNI can only be confirmed in
 * its own "Propuesta de información" screen, which this ledger cannot read.
 */

export interface Gasto {
	/** YYYY-MM-DD */
	fecha: string;
	rucEmisor: string;
	/** Serie-número as printed, e.g. B001-00012345. */
	comprobante: string;
	monto: number;
	categoria: GastoKey;
	/** The receipt carries the taxpayer's DNI or RUC. */
	llevaDni: boolean;
	nota?: string;
}

export interface GastosFile {
	version: 1;
	ejercicio: number;
	gastos: Gasto[];
}

export function gastosPath(ejercicio: number, baseDir = join(resolveSunatDir(), "quinta")): string {
	return join(baseDir, `gastos-${ejercicio}.json`);
}

export function loadGastos(ejercicio: number, path = gastosPath(ejercicio)): GastosFile {
	if (!existsSync(path)) return { version: 1, ejercicio, gastos: [] };
	const parsed = JSON.parse(readFileSync(path, "utf8")) as GastosFile;
	if (!Array.isArray(parsed.gastos)) throw new Error(`Corrupt expenses file: ${path}`);
	return parsed;
}

export function saveGastos(file: GastosFile, path = gastosPath(file.ejercicio)): void {
	writePrivateFile(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** Natural key, same idea as the CPE idempotency key: emisor + comprobante. */
export function claveGasto(g: Pick<Gasto, "rucEmisor" | "comprobante">): string {
	return `${g.rucEmisor}-${g.comprobante.toUpperCase().replace(/\s+/g, "")}`;
}

export function validarGasto(g: Gasto, ejercicio: number): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(g.fecha) || Number.isNaN(Date.parse(g.fecha))) {
		throw new Error(`fecha must be YYYY-MM-DD, got: ${g.fecha}`);
	}
	if (Number(g.fecha.slice(0, 4)) !== ejercicio) {
		throw new Error(`fecha ${g.fecha} is outside the ejercicio ${ejercicio}`);
	}
	if (!/^\d{11}$/.test(g.rucEmisor)) throw new Error(`rucEmisor must be 11 digits, got: ${g.rucEmisor}`);
	if (!/^[A-Za-z0-9]{1,4}-\d{1,8}$/.test(g.comprobante.replace(/\s+/g, ""))) {
		throw new Error(`comprobante must look like B001-12345, got: ${g.comprobante}`);
	}
	if (!Number.isFinite(g.monto) || g.monto <= 0) throw new Error("monto must be a positive number");
	if (!(g.categoria in PORCENTAJES)) throw new Error(`unknown categoria: ${g.categoria}`);
}

/** Returns false when the receipt was already recorded. */
export function agregarGasto(file: GastosFile, gasto: Gasto): boolean {
	validarGasto(gasto, file.ejercicio);
	const key = claveGasto(gasto);
	if (file.gastos.some((g) => claveGasto(g) === key)) return false;
	file.gastos.push({ ...gasto, comprobante: gasto.comprobante.toUpperCase().replace(/\s+/g, "") });
	return true;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ResumenGastos {
	ejercicio: number;
	uit: number;
	tope: number;
	conDni: { cantidad: number; monto: number; porCategoria: Record<GastoKey, { monto: number; deduccion: number }> };
	sinDni: { cantidad: number; monto: number; deduccionPerdida: number };
	deduccionTotal: number;
	disponible: number;
	/** 0-100 */
	avance: number;
}

export function resumirGastos(file: GastosFile, uit = UIT_2026): ResumenGastos {
	const tope = DEDUCCION_ADICIONAL_TOPE_UIT * uit;
	const porCategoria = {} as ResumenGastos["conDni"]["porCategoria"];
	for (const k of Object.keys(PORCENTAJES) as GastoKey[]) porCategoria[k] = { monto: 0, deduccion: 0 };
	let cantDni = 0;
	let montoDni = 0;
	let cantSin = 0;
	let montoSin = 0;
	let perdida = 0;
	let suma = 0;
	for (const g of file.gastos) {
		const ded = g.monto * PORCENTAJES[g.categoria];
		if (g.llevaDni) {
			cantDni++;
			montoDni += g.monto;
			porCategoria[g.categoria].monto += g.monto;
			porCategoria[g.categoria].deduccion += ded;
			suma += ded;
		} else {
			cantSin++;
			montoSin += g.monto;
			perdida += ded;
		}
	}
	for (const k of Object.keys(porCategoria) as GastoKey[]) {
		porCategoria[k] = { monto: r2(porCategoria[k].monto), deduccion: r2(porCategoria[k].deduccion) };
	}
	const total = Math.min(suma, tope);
	return {
		ejercicio: file.ejercicio,
		uit,
		tope: r2(tope),
		conDni: { cantidad: cantDni, monto: r2(montoDni), porCategoria },
		sinDni: { cantidad: cantSin, monto: r2(montoSin), deduccionPerdida: r2(perdida) },
		deduccionTotal: r2(total),
		disponible: r2(Math.max(0, tope - total)),
		avance: tope > 0 ? r2((total / tope) * 100) : 0,
	};
}
