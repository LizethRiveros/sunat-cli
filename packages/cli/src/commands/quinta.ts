import { readFileSync } from "node:fs";
import { Command } from "commander";
import { type GastoKey, type QuintaInput, simularQuinta, UIT_2026 } from "../quinta/calc.ts";
import { compararConSunat, parseCsvSunat } from "../quinta/comparar.ts";
import { parseCpeQr, qrLlevaDni } from "../quinta/qr.ts";
import { agregarGasto, gastosPath, loadGastos, resumirGastos, saveGastos } from "../quinta/gastos.ts";
import { isHumanFormat, output, outputError } from "../utils/output.ts";
import { bold, dim, muted } from "../utils/style.ts";

type Format = "json" | "table" | "auto";

function getFormat(cmd: Command): Format {
	let parent: Command | null = cmd;
	while (parent) {
		const opts = parent.opts();
		if (opts.output) return opts.output as Format;
		parent = parent.parent;
	}
	return "auto";
}

function num(raw: unknown, flag: string): number | undefined {
	if (raw === undefined) return undefined;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative number, got: ${String(raw)}`);
	return n;
}

const s = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CATEGORIAS: Record<GastoKey, string> = {
	alquiler: "alquiler",
	restaurantes: "restaurantes/hoteles",
	honorariosMedicos: "honorarios médicos",
	honorariosProfesionales: "honorarios profesionales",
	essaludHogar: "EsSalud hogar",
};

export function createQuintaCommand(): Command {
	const quinta = new Command("quinta").description(
		"Renta de 5ta categoría (planilla): simulador anual con deducción de 7 UIT + 3 UIT por gastos. Offline, sin clave SOL. T0.",
	);

	quinta
		.command("simular")
		.description("Estimate annual tax, the 3 UIT expense deduction and the balance against withholdings. T0.")
		.requiredOption("--remuneracion <monto>", "Monthly gross remuneration (S/)")
		.option("--meses <n>", "Months worked in the year (1-12)", "12")
		.option("--gratificaciones <monto>", "Gratificaciones for the year (default: 2 x remuneración)")
		.option("--otros-ingresos <monto>", "Other annual quinta income (bonos, utilidades)")
		.option("--ingresos-4ta <monto>", "Gross annual cuarta categoría income (recibos por honorarios), taxed together with quinta")
		.option("--retenido-4ta <monto>", "Retenciones and pagos a cuenta already paid on cuarta")
		.option("--uit <monto>", `UIT of the year (default ${UIT_2026})`)
		.option("--alquiler <monto>", "Annual rent paid, with receipts (30% counts)")
		.option("--restaurantes <monto>", "Restaurants and hotels, with receipts (15% counts)")
		.option("--honorarios-medicos <monto>", "Doctors and dentists, with receipts (30% counts)")
		.option("--honorarios-profesionales <monto>", "Other professionals and trades, with receipts (30% counts)")
		.option("--essalud-hogar <monto>", "EsSalud paid for domestic workers (100% counts)")
		.option("--retenido <monto>", "Amount already withheld by the employer, to compute the balance")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const input: QuintaInput = {
					remuneracion: num(opts.remuneracion, "--remuneracion") as number,
					meses: Number(opts.meses),
					gratificaciones: num(opts.gratificaciones, "--gratificaciones"),
					otrosIngresos: num(opts.otrosIngresos, "--otros-ingresos"),
					uit: num(opts.uit, "--uit"),
					ingresos4ta: num(opts.ingresos4ta, "--ingresos-4ta"),
					retenido4ta: num(opts.retenido4ta, "--retenido-4ta"),
					retenido: num(opts.retenido, "--retenido"),
					gastos: {
						alquiler: num(opts.alquiler, "--alquiler"),
						restaurantes: num(opts.restaurantes, "--restaurantes"),
						honorariosMedicos: num(opts.honorariosMedicos, "--honorarios-medicos"),
						honorariosProfesionales: num(opts.honorariosProfesionales, "--honorarios-profesionales"),
						essaludHogar: num(opts.essaludHogar, "--essalud-hogar"),
					},
				};
				const r = simularQuinta(input);
				if (!isHumanFormat(format)) {
					output(format, { json: { command: "quinta simular", ...r } });
					return;
				}
				console.log(`${bold("Impuesto anual estimado")}  ${bold(s(r.impuestoConGastos))}`);
				console.log(dim(`  sin gastos: ${s(r.impuestoSinGastos)} · ahorro por gastos: ${s(r.ahorro)}`));
				console.log();
				console.log(`Renta bruta anual        ${s(r.rentaBruta)}`);
				if (r.deduccion4ta > 0) console.log(`(-) 20% de 4ta          ${s(r.deduccion4ta)}`);
				console.log(`(-) 7 UIT                ${s(r.deduccionFija)}`);
				console.log(`(-) gastos (3 UIT)       ${s(r.deduccionAdicional.total)} de ${s(r.deduccionAdicional.tope)}`);
				console.log(`Renta neta               ${s(r.rentaNetaConGastos)}`);
				console.log(`Retención mensual aprox. ${s(r.retencionMensualAprox)}`);
				if (r.saldo) {
					const label =
						r.saldo.tipo === "a_favor" ? "Saldo a favor" : r.saldo.tipo === "a_pagar" ? "Saldo a pagar" : "Sin saldo";
					console.log(`${label.padEnd(24)} ${s(r.saldo.resultado)}`);
				}
				if (r.deduccionAdicional.disponible > 0) {
					console.log();
					console.log(
						muted(
							`Aún pueden deducir ${s(r.deduccionAdicional.disponible)}. Para llenarlo en una sola categoría harían falta:`,
						),
					);
					for (const k of Object.keys(CATEGORIAS) as GastoKey[]) {
						console.log(dim(`  ${CATEGORIAS[k].padEnd(26)} ${s(r.gastoNecesarioParaTope[k])} con comprobante`));
					}
				}
				console.log();
				console.log(dim("Estimación informativa. Verifica en renta.sunat.gob.pe antes de declarar."));
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	const gastos = quinta
		.command("gastos")
		.description(
			"Ledger local de boletas para las 3 UIT: registra cada comprobante y calcula cuánto llevas. Sin red, sin clave SOL. T1.",
		);

	const CATEGORIA_FLAG: Record<string, GastoKey> = {
		alquiler: "alquiler",
		restaurantes: "restaurantes",
		medicos: "honorariosMedicos",
		profesionales: "honorariosProfesionales",
		"essalud-hogar": "essaludHogar",
		// aliases: the 15% category covers hotels, restaurants and bars
		hoteles: "restaurantes",
		bares: "restaurantes",
	};

	/** Document SUNAT accepts per category: a plain boleta only works for the 15% one. */
	const SUSTENTO: Record<GastoKey, string | null> = {
		restaurantes: null,
		alquiler: "El alquiler se sustenta con Recibo por Arrendamiento (Form. 1683) o factura, no con boleta.",
		honorariosMedicos: "Médicos y odontólogos se sustentan con recibo por honorarios electrónico, no con boleta.",
		honorariosProfesionales: "Profesionales y oficios (4ta) se sustentan con recibo por honorarios electrónico, no con boleta.",
		essaludHogar: "El EsSalud del hogar se sustenta con el Formulario Virtual 1676, no con boleta.",
	};

	const ejercicioOf = (raw: unknown): number => {
		const n = raw === undefined ? new Date().getFullYear() : Number(raw);
		if (!Number.isInteger(n) || n < 2000 || n > 2100) {
			throw new Error(`--ejercicio must be a year, got: ${String(raw)}`);
		}
		return n;
	};

	gastos
		.command("add")
		.description("Record one receipt in the local ledger. T1.")
		.option("--qr <texto>", "Text decoded from the QR of the boleta (fills ruc, comprobante, monto and fecha)")
		.option("--dni <dni>", "Your DNI, to check the QR names you (recommended with --qr)")
		.option("--fecha <YYYY-MM-DD>", "Date on the receipt")
		.option("--ruc <ruc>", "RUC of the issuer (11 digits)")
		.option("--comprobante <serie-numero>", "Serie and number, e.g. B001-12345")
		.option("--monto <monto>", "Total amount (S/)")
		.requiredOption("--categoria <cat>", `One of: ${Object.keys(CATEGORIA_FLAG).join(", ")}`)
		.option("--sin-dni", "The receipt does NOT carry your DNI/RUC (kept, but not counted)")
		.option("--nota <texto>", "Free note")
		.option("--ejercicio <año>", "Tax year (default: current year)")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const categoria = CATEGORIA_FLAG[String(opts.categoria)];
				if (!categoria) throw new Error(`--categoria must be one of: ${Object.keys(CATEGORIA_FLAG).join(", ")}`);
				let fecha = opts.fecha as string | undefined;
				let ruc = opts.ruc as string | undefined;
				let comprobante = opts.comprobante as string | undefined;
				let monto = num(opts.monto, "--monto");
				let llevaDni = !opts.sinDni;
				const avisos: string[] = [];
				if (opts.qr) {
					const qr = parseCpeQr(String(opts.qr));
					fecha = qr.fecha;
					ruc = qr.rucEmisor;
					comprobante = qr.comprobante;
					monto = qr.total;
					if (opts.dni) {
						llevaDni = qrLlevaDni(qr, String(opts.dni));
						if (!llevaDni) avisos.push("El QR no muestra tu DNI: se guarda como «sin DNI» y no suma.");
					} else {
						avisos.push("Sin --dni no puedo comprobar que la boleta esté a tu nombre; la cuento como con DNI.");
					}
				}
				if (!fecha || !ruc || !comprobante || monto === undefined) {
					throw new Error("Falta fecha, ruc, comprobante o monto (o pasa --qr).");
				}
				const sustento = SUSTENTO[categoria];
				if (sustento) avisos.push(sustento);
				const file = loadGastos(ejercicioOf(opts.ejercicio ?? fecha.slice(0, 4)));
				const added = agregarGasto(file, {
					fecha,
					rucEmisor: ruc,
					comprobante,
					monto,
					categoria,
					llevaDni,
					nota: opts.nota,
				});
				if (added) saveGastos(file);
				const resumen = resumirGastos(file);
				if (!isHumanFormat(format)) {
					output(format, { json: { command: "quinta gastos add", added, duplicate: !added, avisos, resumen } });
					return;
				}
				console.log(
					added
						? `Registrado. ${bold(s(resumen.deduccionTotal))} de ${s(resumen.tope)} (${resumen.avance}%)`
						: muted("Ya estaba registrado; no se duplicó."),
				);
				if (!llevaDni) console.log(dim("  Sin DNI: se guarda, pero no suma a la deducción."));
				for (const a of avisos) console.log(dim(`  ! ${a}`));
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	gastos
		.command("list")
		.description("List recorded receipts. T0.")
		.option("--ejercicio <año>", "Tax year (default: current year)")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const file = loadGastos(ejercicioOf(opts.ejercicio));
				if (!isHumanFormat(format)) {
					output(format, { json: { command: "quinta gastos list", path: gastosPath(file.ejercicio), ...file } });
					return;
				}
				if (file.gastos.length === 0) {
					console.log(muted(`Sin comprobantes registrados para ${file.ejercicio}.`));
					return;
				}
				for (const g of [...file.gastos].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
					const flag = g.llevaDni ? "DNI" : "sin DNI";
					console.log(
						`${g.fecha}  ${g.comprobante.padEnd(16)} ${s(g.monto).padStart(14)}  ${CATEGORIAS[g.categoria].padEnd(24)} ${flag}`,
					);
				}
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	gastos
		.command("resumen")
		.description("How much of the 3 UIT cap the recorded receipts cover. T0.")
		.option("--ejercicio <año>", "Tax year (default: current year)")
		.option("--uit <monto>", `UIT of the year (default ${UIT_2026})`)
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const file = loadGastos(ejercicioOf(opts.ejercicio));
				const r = resumirGastos(file, num(opts.uit, "--uit"));
				if (!isHumanFormat(format)) {
					output(format, { json: { command: "quinta gastos resumen", ...r } });
					return;
				}
				console.log(
					`${bold(`Deducción ${r.ejercicio}`)}  ${bold(s(r.deduccionTotal))} de ${s(r.tope)}  (${r.avance}%)`,
				);
				console.log(dim(`  te faltan ${s(r.disponible)} · ${r.conDni.cantidad} boletas con DNI`));
				for (const k of Object.keys(CATEGORIAS) as GastoKey[]) {
					const c = r.conDni.porCategoria[k];
					if (c.monto > 0) {
						console.log(`  ${CATEGORIAS[k].padEnd(26)} gastado ${s(c.monto)} -> deduce ${s(c.deduccion)}`);
					}
				}
				if (r.sinDni.cantidad > 0) {
					console.log();
					console.log(
						`! ${r.sinDni.cantidad} boleta(s) sin DNI por ${s(r.sinDni.monto)}: dejarían de deducirte ${s(r.sinDni.deduccionPerdida)}. Pide que consignen tu DNI.`,
					);
				}
				console.log();
				console.log(dim("Que SUNAT las tenga a tu nombre se confirma solo en SOL > Propuesta de información."));
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	gastos
		.command("comparar")
		.description(
			"Compare the ledger with the table of Propuesta de información (CSV with ruc, serie/numero or comprobante, monto). Offline. T0.",
		)
		.requiredOption("--archivo <ruta>", "CSV copied from SOL > Renta anual > Propuesta de información")
		.option("--ejercicio <año>", "Tax year (default: current year)")
		.action((opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const file = loadGastos(ejercicioOf(opts.ejercicio));
				const filas = parseCsvSunat(readFileSync(String(opts.archivo), "utf8"));
				const c = compararConSunat(file, filas);
				if (!isHumanFormat(format)) {
					output(format, { json: { command: "quinta gastos comparar", ejercicio: file.ejercicio, ...c } });
					return;
				}
				console.log(`${bold(`Cuaderno vs SUNAT ${file.ejercicio}`)}  ${c.coinciden.length} coinciden`);
				if (c.soloCuaderno.length > 0) {
					console.log();
					console.log(`! ${c.soloCuaderno.length} en tu cuaderno que SUNAT NO muestra (el emisor quizá no las declaró con el DNI):`);
					for (const g of c.soloCuaderno) console.log(`  ${g.fecha} ${g.comprobante.padEnd(16)} ${s(g.monto)}  RUC ${g.rucEmisor}`);
				}
				if (c.difierenMonto.length > 0) {
					console.log();
					console.log(`! ${c.difierenMonto.length} con monto distinto:`);
					for (const d of c.difierenMonto) console.log(`  ${d.gasto.comprobante}: cuaderno ${s(d.gasto.monto)} vs SUNAT ${s(d.montoSunat)}`);
				}
				if (c.soloSunat.length > 0) {
					console.log();
					console.log(`${c.soloSunat.length} que SUNAT tiene y tu cuaderno no (agrégalas si son tuyas):`);
					for (const r of c.soloSunat) console.log(`  ${r.comprobante.padEnd(16)} ${r.monto !== undefined ? s(r.monto) : ""}  RUC ${r.rucEmisor}`);
				}
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return quinta;
}
