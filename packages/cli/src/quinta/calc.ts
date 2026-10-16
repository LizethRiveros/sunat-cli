/**
 * Renta de quinta categoría (trabajadores en planilla), cálculo anual.
 *
 * Pure and offline: no session, no network. Rules follow the Ley del
 * Impuesto a la Renta arts. 46 and 53 as summarized by SUNAT for rentas de
 * trabajo: a fixed deduction of 7 UIT, an additional deduction of up to 3 UIT
 * for documented expenses, and progressive brackets over the UIT.
 *
 * UIT changes every year (2026: S/ 5,500, DS 301-2025-EF), so it is an input.
 * Deduction percentages and eligible categories can change by law; verify
 * against renta.sunat.gob.pe before relying on a number for a filing.
 */

export const UIT_2026 = 5500;

/** Fixed annual deduction, in UIT. */
export const DEDUCCION_FIJA_UIT = 7;
/** Cap of the additional deduction for expenses, in UIT. */
export const DEDUCCION_ADICIONAL_TOPE_UIT = 3;

/** Cumulative brackets: [upper bound in UIT, marginal rate]. */
const TRAMOS: ReadonlyArray<readonly [number, number]> = [
	[5, 0.08],
	[20, 0.14],
	[35, 0.17],
	[45, 0.2],
	[Number.POSITIVE_INFINITY, 0.3],
];

/** Share of each documented expense that counts toward the 3 UIT deduction. */
export const PORCENTAJES = {
	alquiler: 0.3,
	restaurantes: 0.15,
	honorariosMedicos: 0.3,
	honorariosProfesionales: 0.3,
	essaludHogar: 1,
} as const;

export type GastoKey = keyof typeof PORCENTAJES;

export interface QuintaInput {
	/** Monthly remuneration. */
	remuneracion: number;
	/** Months worked in the year (1-12). Default 12. */
	meses?: number;
	/** Gratificaciones (julio + diciembre). Default: 2 × remuneración when meses is 12. */
	gratificaciones?: number;
	/** Any other annual quinta income (bonuses, utilidades...). */
	otrosIngresos?: number;
	uit?: number;
	/** Documented expenses paid in the year, by category. */
	gastos?: Partial<Record<GastoKey, number>>;
	/** Amount already withheld by the employer, if known. */
	retenido?: number;
}

export interface QuintaResultado {
	uit: number;
	rentaBruta: number;
	deduccionFija: number;
	rentaNeta: number;
	impuestoSinGastos: number;
	deduccionAdicional: {
		porCategoria: Record<GastoKey, number>;
		total: number;
		tope: number;
		/** How much of the 3 UIT cap is still unused. */
		disponible: number;
	};
	rentaNetaConGastos: number;
	impuestoConGastos: number;
	ahorro: number;
	retencionMensualAprox: number;
	saldo: { retenido: number; resultado: number; tipo: "a_favor" | "a_pagar" | "sin_saldo" } | null;
	/** Spend needed per category to fill the remaining cap. */
	gastoNecesarioParaTope: Record<GastoKey, number>;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Progressive tax over a net income, brackets scaled by the UIT. */
export function impuestoProgresivo(rentaNeta: number, uit: number): number {
	let resto = Math.max(0, rentaNeta);
	let prev = 0;
	let total = 0;
	for (const [hasta, tasa] of TRAMOS) {
		const ancho = (hasta - prev) * uit;
		const tramo = Math.min(resto, ancho);
		total += tramo * tasa;
		resto -= tramo;
		prev = hasta;
		if (resto <= 0) break;
	}
	return total;
}

export function simularQuinta(input: QuintaInput): QuintaResultado {
	const uit = input.uit ?? UIT_2026;
	const meses = input.meses ?? 12;
	for (const [name, v] of Object.entries({ remuneracion: input.remuneracion, uit })) {
		if (!Number.isFinite(v) || v < 0) throw new Error(`${name} must be a non-negative number`);
	}
	if (!Number.isInteger(meses) || meses < 1 || meses > 12) throw new Error("meses must be an integer from 1 to 12");

	const grat = input.gratificaciones ?? (meses === 12 ? input.remuneracion * 2 : 0);
	const rentaBruta = input.remuneracion * meses + grat + (input.otrosIngresos ?? 0);
	const deduccionFija = Math.min(rentaBruta, DEDUCCION_FIJA_UIT * uit);
	const rentaNeta = rentaBruta - deduccionFija;
	const impuestoSinGastos = impuestoProgresivo(rentaNeta, uit);

	const tope = DEDUCCION_ADICIONAL_TOPE_UIT * uit;
	const porCategoria = {} as Record<GastoKey, number>;
	let sumaGastos = 0;
	for (const k of Object.keys(PORCENTAJES) as GastoKey[]) {
		const monto = Math.max(0, input.gastos?.[k] ?? 0);
		porCategoria[k] = r2(monto * PORCENTAJES[k]);
		sumaGastos += monto * PORCENTAJES[k];
	}
	// The cap applies to the sum, and the deduction can never exceed what is
	// left of the net income.
	const total = Math.min(sumaGastos, tope, rentaNeta);
	const disponible = Math.max(0, tope - total);
	const rentaNetaConGastos = rentaNeta - total;
	const impuestoConGastos = impuestoProgresivo(rentaNetaConGastos, uit);

	const gastoNecesarioParaTope = {} as Record<GastoKey, number>;
	for (const k of Object.keys(PORCENTAJES) as GastoKey[]) {
		gastoNecesarioParaTope[k] = r2(disponible / PORCENTAJES[k]);
	}

	let saldo: QuintaResultado["saldo"] = null;
	if (input.retenido !== undefined) {
		const diff = r2(impuestoConGastos - input.retenido);
		saldo = {
			retenido: r2(input.retenido),
			resultado: Math.abs(diff),
			tipo: diff > 0 ? "a_pagar" : diff < 0 ? "a_favor" : "sin_saldo",
		};
	}

	return {
		uit,
		rentaBruta: r2(rentaBruta),
		deduccionFija: r2(deduccionFija),
		rentaNeta: r2(rentaNeta),
		impuestoSinGastos: r2(impuestoSinGastos),
		deduccionAdicional: { porCategoria, total: r2(total), tope: r2(tope), disponible: r2(disponible) },
		rentaNetaConGastos: r2(rentaNetaConGastos),
		impuestoConGastos: r2(impuestoConGastos),
		ahorro: r2(impuestoSinGastos - impuestoConGastos),
		// The employer withholds without the 3 UIT deduction, so the monthly
		// figure is the tax without expenses spread over the year.
		retencionMensualAprox: r2(impuestoSinGastos / 12),
		saldo,
		gastoNecesarioParaTope,
	};
}
