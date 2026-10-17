/**
 * Parses the text inside the QR printed on an electronic boleta or factura.
 *
 * SUNAT's QR payload is pipe-separated:
 *   RUC | tipo (01 factura, 03 boleta) | serie | número | IGV | total | fecha | tipo doc cliente | nro doc cliente |
 * where tipo doc cliente is 1 for DNI and 6 for RUC. Photographing the QR and
 * decoding it gives every field the ledger needs without retyping.
 */

export interface CpeQr {
	rucEmisor: string;
	tipo: string;
	/** Serie-número, e.g. B001-12345 (leading zeros of the number are dropped). */
	comprobante: string;
	igv: number;
	total: number;
	/** YYYY-MM-DD */
	fecha: string;
	tipoDocCliente: string;
	docCliente: string;
}

export function parseCpeQr(raw: string): CpeQr {
	const f = raw.trim().split("|").map((x) => x.trim());
	if (f.length < 7) throw new Error("QR text must have at least 7 fields separated by |");
	const [ruc, tipo, serie, numero, igv, total, fechaRaw] = f;
	if (!/^\d{11}$/.test(ruc ?? "")) throw new Error(`QR: RUC must be 11 digits, got: ${ruc}`);
	if (!/^[A-Za-z0-9]{1,4}$/.test(serie ?? "") || !/^\d{1,8}$/.test(numero ?? "")) {
		throw new Error(`QR: bad serie/número: ${serie}-${numero}`);
	}
	const totalN = Number(total);
	const igvN = Number(igv);
	if (!Number.isFinite(totalN) || totalN <= 0) throw new Error(`QR: bad total: ${total}`);
	// Some issuers print DD/MM/YYYY instead of ISO.
	const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fechaRaw ?? "");
	const fecha = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : (fechaRaw ?? "");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`QR: bad date: ${fechaRaw}`);
	return {
		rucEmisor: ruc as string,
		tipo: tipo ?? "",
		comprobante: `${(serie as string).toUpperCase()}-${Number(numero)}`,
		igv: Number.isFinite(igvN) ? igvN : 0,
		total: totalN,
		fecha,
		tipoDocCliente: f[7] ?? "",
		docCliente: f[8] ?? "",
	};
}

/**
 * True only when the receipt names the taxpayer. Without `dni` we cannot tell
 * whose document it is, so the caller must pass it for a trustworthy answer.
 */
export function qrLlevaDni(qr: CpeQr, dni: string): boolean {
	return (qr.tipoDocCliente === "1" || qr.tipoDocCliente === "6") && qr.docCliente === dni;
}
