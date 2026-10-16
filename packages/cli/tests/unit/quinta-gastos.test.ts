import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	agregarGasto,
	claveGasto,
	type Gasto,
	gastosPath,
	loadGastos,
	resumirGastos,
	saveGastos,
} from "../../src/quinta/gastos.ts";

const base: Gasto = {
	fecha: "2026-03-10",
	rucEmisor: "20123456789",
	comprobante: "B001-100",
	monto: 100,
	categoria: "restaurantes",
	llevaDni: true,
};

describe("ledger de gastos", () => {
	test("rejects invalid receipts", () => {
		const f = loadGastos(2026, "/nonexistent/none.json");
		expect(() => agregarGasto(f, { ...base, fecha: "10/03/2026" })).toThrow();
		expect(() => agregarGasto(f, { ...base, fecha: "2025-03-10" })).toThrow(/ejercicio/);
		expect(() => agregarGasto(f, { ...base, rucEmisor: "123" })).toThrow();
		expect(() => agregarGasto(f, { ...base, monto: 0 })).toThrow();
		expect(() => agregarGasto(f, { ...base, comprobante: "sin numero" })).toThrow();
	});

	test("is idempotent on emisor + comprobante", () => {
		const f = loadGastos(2026, "/nonexistent/none.json");
		expect(agregarGasto(f, base)).toBe(true);
		expect(agregarGasto(f, { ...base, comprobante: "b001-100" })).toBe(false);
		expect(f.gastos.length).toBe(1);
		expect(claveGasto(base)).toBe("20123456789-B001-100");
	});

	test("receipts without DNI are kept but do not count", () => {
		const f = loadGastos(2026, "/nonexistent/none.json");
		agregarGasto(f, { ...base, comprobante: "B001-1", monto: 200 });
		agregarGasto(f, { ...base, comprobante: "B001-2", monto: 1000, llevaDni: false });
		const r = resumirGastos(f);
		expect(r.deduccionTotal).toBe(30);
		expect(r.sinDni.cantidad).toBe(1);
		expect(r.sinDni.deduccionPerdida).toBe(150);
	});

	test("caps at 3 UIT and reports progress", () => {
		const f = loadGastos(2026, "/nonexistent/none.json");
		agregarGasto(f, { ...base, categoria: "alquiler", monto: 100000 });
		const r = resumirGastos(f, 5500);
		expect(r.deduccionTotal).toBe(16500);
		expect(r.disponible).toBe(0);
		expect(r.avance).toBe(100);
	});

	test("round-trips through disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "quinta-"));
		try {
			const path = gastosPath(2026, dir);
			const f = loadGastos(2026, path);
			agregarGasto(f, base);
			saveGastos(f, path);
			expect(loadGastos(2026, path).gastos).toEqual(f.gastos);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
