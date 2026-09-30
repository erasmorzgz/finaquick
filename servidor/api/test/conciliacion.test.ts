// La comparación del cierre de caja contra el reporte de Getnet es lógica
// pura: se prueba sin base de datos ni servidor.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { conciliar, type MovimientoGetnet, type MovimientoSistema } from "../src/conciliacion.js";

const sis = (folio: string, total: number, hora = "10:00"): MovimientoSistema => ({ id: folio, folio, nombre: `Cliente ${folio}`, total, hora });
const venta = (monto: number, autorizacion?: string): MovimientoGetnet => ({ monto, tipo: "venta", autorizacion });
const cancelacion = (monto: number): MovimientoGetnet => ({ monto, tipo: "cancelacion" });

describe("Conciliación contra el reporte de Getnet", () => {
  test("todo coincide: cuadra, sin importar el orden", () => {
    const r = conciliar([sis("F1", 150), sis("F2", 320.5)], [venta(320.5, "A2"), venta(150, "A1")]);
    assert.equal(r.cuadra, true);
    assert.equal(r.diferencia, 0);
    assert.equal(r.totalSistema, 470.5);
    assert.equal(r.totalGetnet, 470.5);
    assert.equal(r.coinciden.length, 2);
    assert.deepEqual(r.coinciden.map((p) => [p.folio, p.autorizacion]).sort(), [["F1", "A1"], ["F2", "A2"]]);
  });

  test("Getnet trae una venta de más: no cuadra y la señala", () => {
    const r = conciliar([sis("F1", 150)], [venta(150), venta(90, "X9")]);
    assert.equal(r.cuadra, false);
    assert.equal(r.diferencia, 90);
    assert.deepEqual(r.soloGetnet, [{ monto: 90, autorizacion: "X9", hora: undefined }]);
    assert.equal(r.soloSistema.length, 0);
  });

  test("el sistema tiene un cobro que Getnet no reporta: no cuadra y lo señala", () => {
    const r = conciliar([sis("F1", 150), sis("F2", 75.25)], [venta(150)]);
    assert.equal(r.cuadra, false);
    assert.equal(r.diferencia, -75.25);
    assert.deepEqual(r.soloSistema.map((m) => [m.folio, m.monto]), [["F2", 75.25]]);
  });

  test("varios cobros del mismo monto se emparejan uno a uno", () => {
    const r = conciliar([sis("F1", 100), sis("F2", 100), sis("F3", 100)], [venta(100), venta(100)]);
    assert.equal(r.coinciden.length, 2);
    assert.equal(r.soloSistema.length, 1);
    assert.equal(r.cuadra, false);
  });

  test("una cancelación anula una venta del mismo monto", () => {
    const r = conciliar([sis("F1", 150)], [venta(150), venta(75), cancelacion(75)]);
    assert.equal(r.cuadra, true);
    assert.equal(r.totalGetnet, 150);
    assert.equal(r.cancelaciones.length, 1);
  });

  test("una cancelación sin venta del mismo monto cuenta como diferencia negativa", () => {
    const r = conciliar([sis("F1", 150)], [venta(150), cancelacion(40)]);
    assert.equal(r.cuadra, false);
    assert.equal(r.diferencia, -40);
    assert.deepEqual(r.soloGetnet.map((m) => m.monto), [-40]);
  });

  test("los centavos no acumulan errores de punto flotante (0.10 + 0.20 = 0.30)", () => {
    const r = conciliar([sis("F1", 0.1), sis("F2", 0.2)], [venta(0.1), venta(0.2)]);
    assert.equal(r.cuadra, true);
    assert.equal(r.totalSistema, 0.3);
    assert.equal(r.diferencia, 0);
  });

  test("mismo total pero distintos montos NO cuadra (una venta de 0.30 no es dos de 0.10 y 0.20)", () => {
    const r = conciliar([sis("F1", 0.1), sis("F2", 0.2)], [venta(0.3)]);
    assert.equal(r.diferencia, 0);
    assert.equal(r.cuadra, false);
    assert.equal(r.soloSistema.length, 2);
    assert.equal(r.soloGetnet.length, 1);
  });

  test("un día sin movimientos de ningún lado cuadra", () => {
    const r = conciliar([], []);
    assert.equal(r.cuadra, true);
    assert.equal(r.totalGetnet, 0);
  });

  test("solo Getnet con ventas y el sistema vacío no cuadra", () => {
    const r = conciliar([], [venta(500)]);
    assert.equal(r.cuadra, false);
    assert.equal(r.diferencia, 500);
  });

  test("no modifica sus entradas", () => {
    const sistema = [sis("F1", 10)];
    const getnet = [venta(10)];
    const copia = JSON.stringify([sistema, getnet]);
    conciliar(sistema, getnet);
    assert.equal(JSON.stringify([sistema, getnet]), copia);
  });
});
