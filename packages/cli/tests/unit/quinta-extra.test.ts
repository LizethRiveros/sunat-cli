import { describe, expect, test } from "bun:test";
import { simularQuinta } from "../../src/quinta/calc.ts";
import { compararConSunat, parseCsvSunat } from "../../src/quinta/comparar.ts";
import { parseCpeQr, qrLlevaDni } from "../../src/quinta/qr.ts";

describe("4ta + 5ta", () => {
	test("without 4ta nothing changes", () => {
		expect(simularQuinta({ remuneracion: 6000 }).deduccion4ta).toBe(0);
	});
	test("4ta takes 20% off and shares one 7 UIT deduction", () => {
		const r = simularQuinta({ remuneracion: 6000, ingresos4ta: 10000 });
		expect(r.deduccion4ta).toBe(2000);
		expect(r.rentaBruta).toBe(6000 * 14 + 10000);
		expect(r.rentaNeta).toBe(r.rentaBruta - 2000 - 7 * 5500);
		// employer withholding ignores the 4ta income
		expect(r.retencionMensualAprox).toBe(simularQuinta({ remuneracion: 6000 }).retencionMensualAprox);
	});
	test("4ta deduction is capped at 24 UIT", () => {
		expect(simularQuinta({ remuneracion: 0, gratificaciones: 0, ingresos4ta: 1_000_000 }).deduccion4ta).toBe(24 * 5500);
	});
	test("balance adds both withholdings", () => {
		const r = simularQuinta({ remuneracion: 6000, ingresos4ta: 10000, retenido: 1000, retenido4ta: 200 });
		expect(r.saldo?.retenido).toBe(1200);
	});
});

describe("QR de boleta", () => {
	const raw = "20123456789|03|B001|00012345|15.25|100.00|2026-10-15|1|23200174|";
	test("parses fields", () => {
		const q = parseCpeQr(raw);
		expect(q.comprobante).toBe("B001-12345");
		expect(q.total).toBe(100);
		expect(qrLlevaDni(q, "23200174")).toBe(true);
		expect(qrLlevaDni(q, "11111111")).toBe(false);
	});
	test("rejects garbage", () => {
		expect(() => parseCpeQr("hola")).toThrow();
	});
});

describe("comparar con SUNAT", () => {
	const g = (n: number, monto: number) => ({
		fecha: "2026-03-01",
		rucEmisor: "20123456789",
		comprobante: `B001-${n}`,
		monto,
		categoria: "restaurantes" as const,
		llevaDni: true,
	});
	const file = { version: 1 as const, ejercicio: 2026, gastos: [g(1, 50), g(2, 60), g(3, 70)] };
	test("splits matched, missing and different", () => {
		const rows = parseCsvSunat(
			"RUC;Serie;Número;Importe\n20123456789;B001;00000001;50.00\n20123456789;B001;2;65.00\n20999999999;F001;9;10.00",
		);
		const c = compararConSunat(file, rows);
		expect(c.coinciden.length).toBe(1);
		expect(c.difierenMonto[0]?.montoSunat).toBe(65);
		expect(c.soloCuaderno.map((x) => x.comprobante)).toEqual(["B001-3"]);
		expect(c.soloSunat.length).toBe(1);
	});
});
