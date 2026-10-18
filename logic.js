/* Mi Piso — lógica pura (sin DOM). Se usa desde app.js (window.MiPiso) y desde los tests (Node). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MiPiso = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = n => String(n).padStart(2, '0');
  const r2 = n => Math.round(n * 100) / 100;

  // ---------- Parseo ----------
  function parseFecha(v) {
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    if (typeof v !== 'string') return null;
    const s = v.trim();
    const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }

  function parseImporte(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    let s = v.replace(/[€\s ]/g, '').replace(/EUR$/i, '');
    if (!s) return null;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  const normalizarConcepto = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Export "Listado de movimientos" del BBVA (tarjeta o cuenta): localiza la fila de cabecera.
  function parseBbva(rows) {
    const low = c => String(c == null ? '' : c).trim().toLowerCase();
    let hdr = -1, ci = {};
    for (let i = 0; i < rows.length && hdr < 0; i++) {
      const r = rows[i] || [];
      const f = r.findIndex(c => low(c) === 'fecha');
      const co = r.findIndex(c => low(c) === 'concepto');
      const im = r.findIndex(c => low(c) === 'importe');
      if (f >= 0 && co >= 0 && im >= 0) { hdr = i; ci = { f, co, im }; }
    }
    if (hdr < 0) throw new Error('no-cabecera');
    const movimientos = []; let saltadas = 0;
    for (let i = hdr + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (r.every(c => c == null || c === '')) continue;
      const fecha = parseFecha(r[ci.f]), importe = parseImporte(r[ci.im]);
      const concepto = String(r[ci.co] == null ? '' : r[ci.co]).replace(/\s+/g, ' ').trim();
      if (!fecha || importe == null || !concepto) { saltadas++; continue; }
      movimientos.push({ fecha, concepto, importe });
    }
    return { movimientos, saltadas };
  }

  // Export "Posición Global" del BBVA: saldos de las cuentas (sección "Cuentas").
  function parsePosicionGlobal(rows) {
    const low = c => String(c == null ? '' : c).trim().toLowerCase();
    const cuentas = []; let seccion = '';
    for (const r of rows) {
      const celdas = (r || []).filter(c => c != null && c !== '');
      if (!celdas.length) continue;
      const first = low(celdas[0]);
      if (celdas.length === 1 && /^(cuentas|tarjetas|fondos|valores|planes|dep[oó]sitos|pr[eé]stamos|seguros)/.test(first)) { seccion = first; continue; }
      if (first === 'producto') continue;
      if (seccion.startsWith('cuentas') && celdas.length >= 3) {
        const importe = parseImporte(String(celdas[celdas.length - 1]));
        if (importe != null) cuentas.push({ producto: String(celdas[0]).trim(), importe });
      }
    }
    if (!cuentas.length) throw new Error('no-posicion');
    return { cuentas, total: r2(cuentas.reduce((a, c) => a + c.importe, 0)) };
  }

  // Extracto de cuenta de Trade Republic (texto extraído del PDF). El signo de cada movimiento
  // se deduce del saldo acumulado (columna BALANCE) y, si no cuadra, del tipo de operación.
  const MESES_ES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
  const IMP = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})';
  // El símbolo del euro puede salir como "€", "EUR" o como glifos sin mapear al extraer el texto del PDF.
  const EUR = '(?:\\s?(?:€|EUR|[^\\w\\s,.]{1,3}))?';
  function parseTradeRepublic(texto) {
    const t = String(texto || '').replace(/ /g, ' ').replace(/\s+/g, ' ');
    const ini = t.match(new RegExp('Cuenta corriente\\s*' + IMP + EUR));
    const balanceInicial = ini ? parseImporte(ini[1]) : null;
    let prev = balanceInicial;
    const re = new RegExp('(\\d{2}) (ene|feb|mar|abr|may|jun|jul|ago|sept|sep|oct|nov|dic)\\.? (\\d{4}) ((?:[A-ZÁÉÍÓÚ][a-záéíóúñ]+)(?: con tarjeta)?) (.*?) ' + IMP + EUR + ' ' + IMP + EUR, 'g');
    const movimientos = []; let saltadas = 0, invertidoNeto = 0, m;
    while ((m = re.exec(t))) {
      const fecha = `${m[3]}-${pad(MESES_ES[m[2]])}-${m[1]}`;
      const tipo = m[4].toLowerCase(), abs = parseImporte(m[6]), balance = parseImporte(m[7]);
      if (abs == null || balance == null) { saltadas++; continue; }
      const desc = m[5].replace(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g, '').replace(/quantity:\s*[\d.,]+/i, '').replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '');
      let signo = 0;
      if (prev != null) {
        const d = r2(balance - prev);
        if (Math.abs(d - abs) < 0.011) signo = 1; else if (Math.abs(d + abs) < 0.011) signo = -1;
      }
      if (!signo) signo = /inter|rentab|reembolso|ingreso|recompensa|bonific/.test(tipo) || /incoming|sell trade|venta/i.test(desc) ? 1 : -1;
      prev = balance;
      const importe = r2(signo * abs);
      let categoria;
      if (/^operar/.test(tipo) || /savings plan|buy trade|sell trade/i.test(desc)) { categoria = 'Inversión'; invertidoNeto += -importe; }
      else if (/^transferencia/.test(tipo)) categoria = 'Traspaso';
      else if (/inter|rentab|recompensa|bonific/.test(tipo)) categoria = 'Ingresos';
      else categoria = importe > 0 ? 'Ingresos' : categorizar(desc, importe, {});
      movimientos.push({ fecha, concepto: desc || m[4], importe, categoria, origen: 'tr' });
    }
    if (!movimientos.length) throw new Error('no-extracto');
    return { movimientos, saltadas, balanceInicial, balanceFinal: prev, invertidoNeto: r2(invertidoNeto) };
  }

  // ---------- Categorías ----------
  const CATEGORIAS = ['Bares y restaurantes', 'Ocio', 'Suscripciones', 'Supermercado', 'Transporte', 'Tabaco',
    'Cuidado personal', 'Salud', 'Compras', 'Vivienda', 'Otros', 'Inversión', 'Traspaso', 'Ingresos'];
  const NO_GASTO = ['Inversión', 'Traspaso', 'Ingresos'];   // no cuentan como gasto
  const NEUTRAS = ['Traspaso'];                             // ni gasto ni ingreso

  const RE_TRASPASO = /trade republic|traspaso|incoming transfer|outgoing transfer|transferencia interna|entre (mis )?cuentas|a mi cuenta|mi otra cuenta/;
  const RE_INVERSION = /savings plan|buy trade|sell trade|\betf\b|fondo de inversi|plan de pensiones|indexa|aportaci[oó]n|cuenta remunerada|dep[oó]sito a plazo/;
  // Orden importante: las reglas más específicas van antes. "barbera" (Barberà del Vallès) aparece como
  // sufijo de muchos conceptos, por eso Cuidado personal usa barber(?!a).
  const REGLAS = [
    ['Salud', /farmac|clinic|dentist|optic|hospital/],
    ['Vivienda', /alquiler|hipoteca|endesa|iberdrola|naturgy|holaluz|\bagua\b|vodafone|movistar|orange|\bdigi\b|comunidad|seguro/],
    ['Supermercado', /mercadona|lidl|aldi|carrefour|\bdia\b|consum|caprabo|bonpreu|eroski|alcampo|condis|supermerc/],
    ['Suscripciones', /spotify|apple\.com|netflix|hbo|disney|prime video|amazon prime|google|icloud|youtube|dazn|chatgpt|openai|etsy\*monthly/],
    ['Transporte', /parking|aparc|movilidad|renfe|\btmb\b|\bfgc\b|metro|\bbus\b|gasolin|repsol|cepsa|\bbp\b|galp|uber|cabify|bolt|bicing|peaje|autopista|taxi/],
    ['Tabaco', /estanc|tabac/],
    ['Cuidado personal', /nails|peluq|barber(?!a)|estetic|belleza|spa\b/],
    ['Ocio', /cinesa|\bcine\b|horrorland|espectac|casfid|evento|\bsala\b|teatro|concierto|festival|disco|bowling|escape|parque|karting|padel|gym|fitness/],
    ['Compras', /amazon|zara|primark|decathlon|ikea|mediamarkt|fnac|aliexpress|shein|el corte ingles|bershka|pull ?& ?bear|stradivarius|mango|etsy/],
    ['Bares y restaurantes', /\bbar\b|\brest|vermut|barbera|cafe|cafet|pizz|burger|kebab|tapas|taberna|bodega|cerve|sushi|wok|mcdonald|kfc|telepizza|dominos|glovo|just eat|uber eats|braser|marisq|pastel|forn|panad|ca[ñn]as?\b|copas|birra|cocktail|coctel|terraza|brunch|heladeri|gastro|bistro|vinoteca|chiring/],
  ];

  function categorizar(concepto, importe, reglasComercio) {
    const n = normalizarConcepto(concepto);
    if (reglasComercio && reglasComercio[n]) return reglasComercio[n];
    if (RE_TRASPASO.test(n)) return 'Traspaso';
    if (RE_INVERSION.test(n)) return 'Inversión';
    if (importe > 0) return 'Ingresos';
    for (const [cat, re] of REGLAS) if (re.test(n)) return cat;
    return 'Otros';
  }

  // ---------- Duplicados ----------
  const clave = m => `${m.fecha}|${normalizarConcepto(m.concepto)}|${Math.round(m.importe * 100)}`;
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function fusionar(existentes, nuevos, reglasComercio) {
    const cuenta = {};
    for (const m of existentes) cuenta[clave(m)] = (cuenta[clave(m)] || 0) + 1;
    const lista = existentes.slice(), anadidosLista = []; let anadidos = 0, duplicados = 0;
    for (const n of nuevos) {
      const k = clave(n);
      if (cuenta[k] > 0) { cuenta[k]--; duplicados++; continue; }
      const regla = reglasComercio && reglasComercio[normalizarConcepto(n.concepto)];
      const mov = { id: nuevoId(), fecha: n.fecha, concepto: n.concepto, importe: n.importe,
        categoria: regla || n.categoria || categorizar(n.concepto, n.importe, reglasComercio), origen: n.origen || 'bbva' };
      lista.push(mov); anadidosLista.push(mov);
      anadidos++;
    }
    lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return { lista, anadidos, duplicados, nuevos: anadidosLista };
  }

  // ---------- Resúmenes ----------
  const mesDe = f => f.slice(0, 7);

  function resumenMensual(movs, mes) {
    const r = { gastos: 0, ingresos: 0, invertido: 0, porCategoria: {} };
    for (const m of movs) {
      if (mesDe(m.fecha) !== mes) continue;
      if (NEUTRAS.includes(m.categoria)) continue;
      if (m.categoria === 'Inversión') { r.invertido += -m.importe; continue; }
      if (m.importe > 0) { r.ingresos += m.importe; continue; }
      r.gastos += -m.importe;
      r.porCategoria[m.categoria] = (r.porCategoria[m.categoria] || 0) + -m.importe;
    }
    r.gastos = r2(r.gastos); r.ingresos = r2(r.ingresos); r.invertido = r2(r.invertido);
    for (const c in r.porCategoria) r.porCategoria[c] = r2(r.porCategoria[c]);
    return r;
  }

  function diasDelMes(mes) { const [y, m] = mes.split('-').map(Number); return new Date(y, m, 0).getDate(); }

  // Un mes pasado solo cuenta como "completo" si tiene al menos MIN_GASTOS_MES gastos: así un extracto
  // secundario (p. ej. la tarjeta de Trade Republic con un solo cargo) no hunde la media.
  const MIN_GASTOS_MES = 5;
  function gastoMedioMensual(movs, hoy) {
    const actual = mesDe(hoy);
    const porMes = {};
    for (const m of movs) if (m.importe < 0 && !NO_GASTO.includes(m.categoria)) porMes[mesDe(m.fecha)] = (porMes[mesDe(m.fecha)] || 0) + 1;
    const meses = Object.keys(porMes).filter(mes => mes !== actual && porMes[mes] >= MIN_GASTOS_MES).sort();
    const porCategoria = {}; let media = 0, extrapolado = false;
    if (meses.length) {
      for (const mes of meses) {
        const r = resumenMensual(movs, mes); media += r.gastos;
        for (const c in r.porCategoria) porCategoria[c] = (porCategoria[c] || 0) + r.porCategoria[c];
      }
      media /= meses.length;
      for (const c in porCategoria) porCategoria[c] /= meses.length;
    } else {
      const r = resumenMensual(movs, actual);
      const dia = Number(hoy.slice(8, 10)), factor = r.gastos ? diasDelMes(actual) / dia : 0;
      media = r.gastos * factor; extrapolado = r.gastos > 0;
      for (const c in r.porCategoria) porCategoria[c] = r.porCategoria[c] * factor;
    }
    return { media, porCategoria, mesesCompletos: meses.length, extrapolado };
  }

  function mesesEntre(desde, hasta) {
    const [y1, m1] = desde.split('-').map(Number), [y2, m2] = hasta.split('-').map(Number);
    return (y2 - y1) * 12 + (m2 - m1);
  }
  function sumarMeses(mes, n) {
    const [y, m] = mes.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  // Patrimonio: lo ahorrado para la entrada es la suma de las partidas.
  const PARTIDAS = [['bbva', 'Efectivo BBVA'], ['trEfectivo', 'Efectivo Trade Republic'], ['inversiones', 'Inversiones (a coste)'], ['otros', 'Otros ahorros']];
  const ahorradoTotal = p => r2(PARTIDAS.reduce((a, [k]) => a + (Number((p || {})[k]) || 0), 0));

  function meta(ajustes, movs, hoy, recortes) {
    const o = (ajustes && ajustes.objetivo) || {};
    const ahorrado = ajustes && ajustes.patrimonio ? ahorradoTotal(ajustes.patrimonio) : (o.ahorrado || 0);
    const faltan = Math.max(0, (o.importe || 0) - ahorrado);
    const mesesHastaFecha = o.fechaLimite ? Math.max(0, mesesEntre(hoy, o.fechaLimite)) : null;
    const necesarioMes = mesesHastaFecha ? faltan / mesesHastaFecha : (mesesHastaFecha === 0 ? faltan : null);
    const g = gastoMedioMensual(movs, hoy);
    let ahorroExtraMes = 0;
    for (const c in (recortes || {})) ahorroExtraMes += (g.porCategoria[c] || 0) * (recortes[c] / 100);
    const ingresos = ajustes && ajustes.ingresosMensuales > 0 ? ajustes.ingresosMensuales : null;
    const ahorroRealMes = ingresos == null ? null : r2(ingresos - g.media + ahorroExtraMes);
    const mesesConRitmoActual = ahorroRealMes && ahorroRealMes > 0 ? Math.ceil(faltan / ahorroRealMes) : null;
    const fechaEstimada = mesesConRitmoActual == null ? null : sumarMeses(mesDe(hoy), mesesConRitmoActual);
    return { ahorrado, faltan, mesesHastaFecha, necesarioMes, ahorroRealMes, ahorroExtraMes: r2(ahorroExtraMes),
      gastoMedioMes: g.media, gastoMedioPorCategoria: g.porCategoria, extrapolado: g.extrapolado,
      mesesCompletos: g.mesesCompletos, mesesConRitmoActual, fechaEstimada };
  }

  return { CATEGORIAS, NO_GASTO, NEUTRAS, PARTIDAS, parseFecha, parseImporte, normalizarConcepto, parseBbva, parsePosicionGlobal,
    parseTradeRepublic, categorizar, clave, fusionar, resumenMensual, gastoMedioMensual, meta, mesesEntre, sumarMeses, diasDelMes, ahorradoTotal };
});
