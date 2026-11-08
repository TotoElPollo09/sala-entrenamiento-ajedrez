/**
 * Script de la hoja Habit_Entrenamiento para la página Hábitos de la Sala de Entrenamiento.
 *
 * Deja que la web:
 *   - vea la lista de meses guardados (una pestaña por jugador y mes, p. ej. «JOHAN - NOVIEMBRE»),
 *   - lea y marque las casillas de un mes,
 *   - cree la pestaña del mes nuevo copiando los hábitos del último mes (los meses viejos se quedan guardados).
 *
 * Instalación (una sola vez):
 *   1. En la hoja: Extensiones → Apps Script. Borra lo que haya y pega este archivo entero. Guarda.
 *   2. Implementar → Nueva implementación → tipo «Aplicación web».
 *      Ejecutar como: Yo.  Quién tiene acceso: Cualquier usuario.  → Implementar y autoriza.
 *   3. Copia la «URL de la aplicación web» (acaba en /exec) y pégala en la web, en Ajustes → Hábitos.
 * Si cambias este código, vuelve a Implementar → Gestionar implementaciones → editar → Versión nueva.
 */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const FILA0 = 20      // primera fila de hábitos
const FILAS = 20      // filas 20 a 39
const COL0 = 4        // columna D
const COLS = 36       // D a AM: 6 semanas × 6 días (lunes a sábado)
const AUX = 47        // columna AU: cálculos propios de cada pestaña

// ---------- Web ----------

function doGet(e) { return responder(() => accion(e.parameter || {})) }
function doPost(e) { return responder(() => accion(JSON.parse((e.postData && e.postData.contents) || '{}'))) }

function responder(fn) {
  let out
  try { out = Object.assign({ ok: true }, fn()) } catch (err) { out = { ok: false, error: String((err && err.message) || err) } }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON)
}

function accion(p) {
  switch (p.accion) {
    case 'lista': return { meses: lista() }
    case 'leer': return leer(p.pestana)
    case 'marcar': return conCerrojo(() => marcar(p))
    case 'nuevoMes': return conCerrojo(() => nuevoMes(p))
    default: throw new Error('Acción desconocida: ' + p.accion)
  }
}

function conCerrojo(fn) {
  const lock = LockService.getDocumentLock()
  lock.waitLock(20000)
  try { return fn() } finally { lock.releaseLock() }
}

// ---------- Lectura ----------

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
const esTracker = (sh) => norm(sh.getRange('C15').getValue()) === 'HABITOS'

function infoPestana(sh) {
  const nombre = sh.getName()
  const anio = Number(sh.getRange('O4').getValue())
  const mes = MESES.map(norm).indexOf(norm(sh.getRange('W4').getValue())) + 1
  const jugador = nombre.split(' - ')[0].trim()
  return { pestana: nombre, jugador, anio, mes }
}

function lista() {
  return SpreadsheetApp.getActive().getSheets().filter(esTracker).map(infoPestana)
}

function hoja(nombre) {
  const sh = SpreadsheetApp.getActive().getSheetByName(String(nombre || ''))
  if (!sh || !esTracker(sh)) throw new Error('No existe la pestaña «' + nombre + '».')
  return sh
}

function leer(nombre) {
  const sh = hoja(nombre)
  const nombres = sh.getRange(FILA0, 3, FILAS, 1).getValues()
  const casillas = sh.getRange(FILA0, COL0, FILAS, COLS).getValues()
  const habitos = []
  nombres.forEach((r, i) => {
    const n = String(r[0]).trim()
    if (!n || /^INGRESA UN HABITO/.test(norm(n))) return
    habitos.push({ fila: FILA0 + i, nombre: n, hechos: casillas[i].map((v) => v === true) })
  })
  return Object.assign(infoPestana(sh), { habitos })
}

// ---------- Escritura ----------

function marcar(p) {
  const sh = hoja(p.pestana)
  const fila = Number(p.fila), col = Number(p.col)
  if (!(fila >= FILA0 && fila < FILA0 + FILAS && col >= 0 && col < COLS)) throw new Error('Casilla fuera del tracker.')
  sh.getRange(fila, COL0 + col).setValue(p.valor === true || p.valor === 'true')
  return { pestana: sh.getName(), fila, col, valor: sh.getRange(fila, COL0 + col).getValue() === true }
}

// Crea la pestaña de un mes copiando la del último mes guardado de ese jugador, con las casillas vacías.
function nuevoMes(p) {
  const ss = SpreadsheetApp.getActive()
  const anio = Number(p.anio), mes = Number(p.mes)
  const jugador = String(p.jugador || '').trim()
  if (!jugador || !(anio > 2000) || !(mes >= 1 && mes <= 12)) throw new Error('Faltan jugador, año o mes.')
  const todas = lista()
  const ya = todas.find((t) => norm(t.jugador) === norm(jugador) && t.anio === anio && t.mes === mes)
  if (ya) return leer(ya.pestana)

  const mias = todas.filter((t) => norm(t.jugador) === norm(jugador)).sort((a, b) => (b.anio * 12 + b.mes) - (a.anio * 12 + a.mes))
  const base = mias[0] || todas[0]
  if (!base) throw new Error('No hay ninguna pestaña de hábitos para copiar.')

  let nombre = jugador.toUpperCase() + ' - ' + MESES[mes - 1].toUpperCase()
  if (ss.getSheetByName(nombre)) nombre += ' ' + anio
  if (ss.getSheetByName(nombre)) throw new Error('Ya existe una pestaña «' + nombre + '».')

  const origen = ss.getSheetByName(base.pestana)
  const sh = origen.copyTo(ss).setName(nombre)
  ss.setActiveSheet(sh)
  ss.moveActiveSheet(origen.getIndex())
  sh.getRange('O4').setValue(anio)
  sh.getRange('W4').setValue(MESES[mes - 1])
  sh.getRange(FILA0, COL0, FILAS, COLS).setValue(false)
  independizar(sh)
  return leer(nombre)
}

// Cada pestaña calcula sus fechas y totales con su propio año y mes (antes dependían de la pestaña Datos,
// así que al copiar una pestaña sus fechas seguían las de otro mes). Los cálculos van en AT:AU, ocultas.
function independizar(sh) {
  if (sh.getMaxColumns() < AUX) sh.insertColumnsAfter(sh.getMaxColumns(), AUX - sh.getMaxColumns())
  const lista = '{' + MESES.map((m) => '"' + m + '"').join(';') + '}'
  const habitos = '(COUNTIF($C$20:$C$29,"?*")-COUNTIF($C$20:$C$29,"INGRESA UN HÁBITO"))'
  const filas = [
    ['Cálculos de esta pestaña', ''],
    ['N° de mes', '=MATCH($W$4,' + lista + ',0)'],
    ['Lunes de inicio', '=DATE($O$4,AU2,1)-WEEKDAY(DATE($O$4,AU2,1),3)+IF(WEEKDAY(DATE($O$4,AU2,1),3)=6,7,0)'],
    ['Días lun–sáb del mes', '=SUM($D$19:$AM$19)'],
    ['Total posible', '=' + habitos + '*AU4'],
    ['Completados', '=SUM($AR$20:$AR$29)'],
    ['Incompletos', '=MAX(0,AU5-AU6)'],
    ['% de avance', '=IF(AU5=0,0,AU6/AU5)'],
    ['Hábitos activos', '=' + habitos],
  ]
  sh.getRange(1, AUX - 1, filas.length, 2).setValues(filas)
  sh.getRange('AU3').setNumberFormat('dd/mm/yyyy')
  // Referencias a las pestañas de cálculos («Datos», «Datos Mari»…) → a la columna AU de esta pestaña.
  SpreadsheetApp.getActive().getSheets().map((s) => s.getName()).filter((n) => /^Datos/i.test(n)).forEach((n) => {
    ["'" + n + "'!$E$", n + '!$E$'].forEach((ref) => sh.createTextFinder(ref).matchFormulaText(true).replaceAllWith('$AU$'))
  })
  sh.hideColumns(AUX - 1, 2)
}

// ---------- Menú en la hoja ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Sala de Entrenamiento')
    .addItem('Hacer independiente esta pestaña de hábitos', 'menuIndependizar')
    .addToUi()
}

function menuIndependizar() {
  const sh = SpreadsheetApp.getActiveSheet()
  if (!esTracker(sh)) return SpreadsheetApp.getUi().alert('Esta pestaña no es un habit tracker.')
  independizar(sh)
  SpreadsheetApp.getUi().alert('Listo: «' + sh.getName() + '» ya calcula sus fechas con su propio mes y año.')
}
