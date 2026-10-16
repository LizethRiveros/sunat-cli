import { describe, expect, test } from "bun:test";
import { impuestoProgresivo, simularQuinta } from "../../src/quinta/calc.ts";

describe("impuestoProgresivo", () => {
	test("first bracket is 8%", () => {
		expect(impuestoProgresivo(5000, 5500)).toBe(400);
	});
	test("accumulates across brackets", () => {
		// 5 UIT at 8% + 5 UIT at 14%
		expect(impuestoProgresivo(10 * 5500, 5500)).toBeCloseTo(5 * 5500 * 0.08 + 5 * 5500 * 0.14, 6);
	});
	test("zero or negative income pays nothing", () => {
		expect(impuestoProgresivo(-10, 5500)).toBe(0);
	});
});

describe("simularQuinta", () => {
	test("income below 7 UIT pays no tax", () => {
		// 2000 x 12 + 4000 gratificaciones = 28000 < 38500
		const r = simularQuinta({ remuneracion: 2000 });
		expect(r.rentaBruta).toBe(28000);
		expect(r.impuestoSinGastos).toBe(0);
	});
	test("deducts 7 UIT then applies 8%", () => {
		// 5000 x 14 = 70000; neta 31500 = 27500 at 8% + 4000 at 14%
		const r = simularQuinta({ remuneracion: 5000 });
		expect(r.rentaNeta).toBe(31500);
		expect(r.impuestoSinGastos).toBe(2760);
		expect(r.retencionMensualAprox).toBe(230);
	});
	test("expense deduction is weighted by category and capped at 3 UIT", () => {
		const r = simularQuinta({ remuneracion: 5000, gastos: { alquiler: 10000, restaurantes: 2000 } });
		// 3000 + 300
		expect(r.deduccionAdicional.total).toBe(3300);
		expect(r.impuestoConGastos).toBe(2200 + (31500 - 3300 - 27500) * 0.14);
		const capped = simularQuinta({ remuneracion: 5000, gastos: { alquiler: 100000 } });
		expect(capped.deduccionAdicional.total).toBe(16500);
		expect(capped.deduccionAdicional.disponible).toBe(0);
	});
	test("balance against withholdings", () => {
		const r = simularQuinta({ remuneracion: 5000, retenido: 3000 });
		expect(r.saldo).toEqual({ retenido: 3000, resultado: 240, tipo: "a_favor" });
	});
	test("rejects invalid months", () => {
		expect(() => simularQuinta({ remuneracion: 1000, meses: 13 })).toThrow();
	});
});
