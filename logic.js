/* Mi Piso — lógica pura (sin DOM). Se usa desde app.js (window.MiPiso) y desde los tests (Node). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MiPiso = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = n => String(n).padStart(2, '0');

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
    let s = v.replace(/[€\s]/g, '');
    if (!s) return null;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  const normalizarConcepto = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

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

  // ---------- Categorías ----------
  const CATEGORIAS = ['Bares y restaurantes', 'Ocio', 'Suscripciones', 'Supermercado', 'Transporte', 'Tabaco',
    'Cuidado personal', 'Salud', 'Compras', 'Vivienda', 'Otros', 'Ingresos'];

  // Orden importante: las reglas más específicas van antes. "barbera" (Barberà del Vallès) aparece como
  // sufijo de muchos conceptos, por eso Cuidado personal usa barber(?!a).
  const REGLAS = [
    ['Salud', /farmac|clinic|dentist|optic|hospital/],
    ['Vivienda', /alquiler|hipoteca|endesa|iberdrola|naturgy|holaluz|\bagua\b|vodafone|movistar|orange|\bdigi\b|comunidad|seguro/],
    ['Supermercado', /mercadona|lidl|aldi|carrefour|\bdia\b|consum|caprabo|bonpreu|eroski|alcampo|condis|supermerc/],
    ['Suscripciones', /spotify|apple\.com|netflix|hbo|disney|prime video|amazon prime|google|icloud|youtube|dazn|chatgpt|openai/],
    ['Transporte', /parking|aparc|movilidad|renfe|\btmb\b|\bfgc\b|metro|\bbus\b|gasolin|repsol|cepsa|\bbp\b|galp|uber|cabify|bolt|bicing|peaje|autopista|taxi/],
    ['Tabaco', /estanc|tabac/],
    ['Cuidado personal', /nails|peluq|barber(?!a)|estetic|belleza|spa\b/],
    ['Ocio', /cinesa|\bcine\b|horrorland|espectac|casfid|evento|\bsala\b|teatro|concierto|festival|disco|bowling|escape|parque|karting|padel|gym|fitness/],
    ['Compras', /amazon|zara|primark|decathlon|ikea|mediamarkt|fnac|aliexpress|shein|el corte ingles|bershka|pull ?& ?bear|stradivarius|mango/],
    ['Bares y restaurantes', /\bbar\b|\brest|vermut|barbera|cafe|cafet|pizz|burger|kebab|tapas|taberna|bodega|cerve|sushi|wok|mcdonald|kfc|telepizza|dominos|glovo|just eat|uber eats|braser|marisq|pastel|forn|panad|ca[ñn]as?\b|copas|birra|cocktail|coctel|terraza|brunch|heladeri|gastro|bistro|vinoteca|chiring/],
  ];

  function categorizar(concepto, importe, reglasComercio) {
    if (importe > 0) return 'Ingresos';
    const n = normalizarConcepto(concepto);
    if (reglasComercio && reglasComercio[n]) return reglasComercio[n];
    for (const [cat, re] of REGLAS) if (re.test(n)) return cat;
    return 'Otros';
  }

  // ---------- Duplicados ----------
  const clave = m => `${m.fecha}|${normalizarConcepto(m.concepto)}|${Math.round(m.importe * 100)}`;
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function fusionar(existentes, nuevos, reglasComercio) {
    const cuenta = {};
    for (const m of existentes) cuenta[clave(m)] = (cuenta[clave(m)] || 0) + 1;
    const lista = existentes.slice(); let anadidos = 0, duplicados = 0;
    for (const n of nuevos) {
      const k = clave(n);
      if (cuenta[k] > 0) { cuenta[k]--; duplicados++; continue; }
      lista.push({ id: nuevoId(), fecha: n.fecha, concepto: n.concepto, importe: n.importe,
        categoria: categorizar(n.concepto, n.importe, reglasComercio), origen: 'bbva' });
      anadidos++;
    }
    lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return { lista, anadidos, duplicados };
  }

  // ---------- Resúmenes ----------
  const mesDe = f => f.slice(0, 7);
  const r2 = n => Math.round(n * 100) / 100;

  function resumenMensual(movs, mes) {
    const r = { gastos: 0, ingresos: 0, porCategoria: {} };
    for (const m of movs) {
      if (mesDe(m.fecha) !== mes) continue;
      if (m.importe > 0) { r.ingresos += m.importe; continue; }
      r.gastos += -m.importe;
      r.porCategoria[m.categoria] = (r.porCategoria[m.categoria] || 0) + -m.importe;
    }
    r.gastos = r2(r.gastos); r.ingresos = r2(r.ingresos);
    for (const c in r.porCategoria) r.porCategoria[c] = r2(r.porCategoria[c]);
    return r;
  }

  function diasDelMes(mes) { const [y, m] = mes.split('-').map(Number); return new Date(y, m, 0).getDate(); }

  function gastoMedioMensual(movs, hoy) {
    const actual = mesDe(hoy);
    const meses = [...new Set(movs.filter(m => m.importe < 0).map(m => mesDe(m.fecha)))].filter(m => m !== actual);
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

  function meta(ajustes, movs, hoy, recortes) {
    const o = (ajustes && ajustes.objetivo) || {};
    const faltan = Math.max(0, (o.importe || 0) - (o.ahorrado || 0));
    const mesesHastaFecha = o.fechaLimite ? Math.max(0, mesesEntre(hoy, o.fechaLimite)) : null;
    const necesarioMes = mesesHastaFecha ? faltan / mesesHastaFecha : (mesesHastaFecha === 0 ? faltan : null);
    const g = gastoMedioMensual(movs, hoy);
    let ahorroExtraMes = 0;
    for (const c in (recortes || {})) ahorroExtraMes += (g.porCategoria[c] || 0) * (recortes[c] / 100);
    const ingresos = ajustes && ajustes.ingresosMensuales > 0 ? ajustes.ingresosMensuales : null;
    const ahorroRealMes = ingresos == null ? null : r2(ingresos - g.media + ahorroExtraMes);
    const mesesConRitmoActual = ahorroRealMes && ahorroRealMes > 0 ? Math.ceil(faltan / ahorroRealMes) : null;
    const fechaEstimada = mesesConRitmoActual == null ? null : sumarMeses(mesDe(hoy), mesesConRitmoActual);
    return { faltan, mesesHastaFecha, necesarioMes, ahorroRealMes, ahorroExtraMes: r2(ahorroExtraMes),
      gastoMedioMes: g.media, gastoMedioPorCategoria: g.porCategoria, extrapolado: g.extrapolado,
      mesesCompletos: g.mesesCompletos, mesesConRitmoActual, fechaEstimada };
  }

  return { CATEGORIAS, parseFecha, parseImporte, normalizarConcepto, parseBbva, categorizar, clave, fusionar,
    resumenMensual, gastoMedioMensual, meta, mesesEntre, sumarMeses, diasDelMes };
});
