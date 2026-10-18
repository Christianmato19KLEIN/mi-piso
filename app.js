/* Mi Piso — interfaz. Toda la lógica de cálculo está en logic.js (window.MiPiso). */
(() => {
  'use strict';
  const M = window.MiPiso;
  const CLAVE = 'mipiso.v1';
  const $ = s => document.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const fmt0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur = n => fmt.format(n || 0);
  const eur0 = n => fmt0.format(n || 0);
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const mesActual = () => hoy().slice(0, 7);
  const fechaLocal = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const nombreMes = ym => { const s = fechaLocal(ym + '-01').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const nombreMesCorto = ym => fechaLocal(ym + '-01').toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
  const fechaLarga = iso => { const s = fechaLocal(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const redondea5 = n => Math.max(5, Math.round(n / 5) * 5);
  const titulos = { inicio: 'Inicio', movimientos: 'Movimientos', presupuestos: 'Límites', simulador: 'Simular recortes', ajustes: 'Ajustes' };
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ---------- Estado ----------
  const porDefecto = () => ({
    movimientos: [],
    ajustes: { ingresosMensuales: 0, objetivo: { importe: 0, ahorrado: 0, fechaLimite: '' }, presupuestos: {}, reglasComercio: {},
      patrimonio: { bbva: 0, trEfectivo: 0, inversiones: 0, otros: 0 } },
  });
  let estado = cargar();
  let avisoGuardado = false;
  const ui = { tab: 'inicio', mes: 'todos', cat: 'todas', busqueda: '', recortes: {} };

  function cargar() {
    const base = porDefecto();
    try {
      const raw = localStorage.getItem(CLAVE);
      if (!raw) return base;
      const d = JSON.parse(raw), a = d.ajustes || {};
      // Versiones anteriores guardaban "ahorrado" como un único número: pasa a "otros ahorros".
      const patrimonio = a.patrimonio ? { ...base.ajustes.patrimonio, ...a.patrimonio }
        : { ...base.ajustes.patrimonio, otros: Number((a.objetivo || {}).ahorrado) || 0 };
      return {
        movimientos: Array.isArray(d.movimientos) ? d.movimientos : [],
        ajustes: { ...base.ajustes, ...a, objetivo: { ...base.ajustes.objetivo, ...(a.objetivo || {}) },
          presupuestos: a.presupuestos || {}, reglasComercio: a.reglasComercio || {}, patrimonio },
      };
    } catch { return base; }
  }
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); }
    catch { if (!avisoGuardado) { avisoGuardado = true; toast('No se puede guardar en este navegador (¿modo privado?). Los datos se perderán al cerrar.'); } }
  }

  // ---------- Utilidades de UI ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function abrirHoja(html) {
    $('#hoja-contenido').innerHTML = html;
    $('#hoja').hidden = false; $('#velo').hidden = false;
  }
  function cerrarHoja() { $('#hoja').hidden = true; $('#velo').hidden = true; $('#hoja-contenido').innerHTML = ''; }
  function irA(tab) { ui.tab = tab; render(); window.scrollTo({ top: 0 }); }
  function barra(pct, clase = '') { return `<div class="barra ${clase}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`; }
  function estadoPresu(gasto, limite) {
    if (!limite) return '';
    const r = gasto / limite;
    return r >= 1 ? 'pasado' : r >= .8 ? 'aviso' : 'ok';
  }
  const esGasto = m => m.importe < 0 && !M.NO_GASTO.includes(m.categoria);
  const ingresosMovs = () => estado.movimientos.filter(m => m.importe > 0 && m.categoria === 'Ingresos');
  const etiquetaPartida = { bbva: 'BBVA', trEfectivo: 'Trade Republic', inversiones: 'Inversiones', otros: 'Otros' };
  function desglosePatrimonio() {
    const p = estado.ajustes.patrimonio;
    const partes = M.PARTIDAS.filter(([k]) => Number(p[k]) > 0).map(([k]) => `${etiquetaPartida[k]} ${eur0(p[k])}`);
    return partes.length ? partes.join(' · ') : 'Pon tus saldos en Ajustes o importa la Posición Global del BBVA y el extracto de Trade Republic.';
  }
  const mesesDisponibles = () => { const s = new Set(estado.movimientos.map(m => m.fecha.slice(0, 7))); s.add(mesActual()); return [...s].sort().reverse(); };
  const esStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // ---------- Render principal ----------
  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('activo', b.dataset.tab === ui.tab));
    $('#titulo').textContent = titulos[ui.tab];
    $('#btn-mas').hidden = ui.tab !== 'movimientos';
    const v = $('#vista');
    v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
    ({ inicio: renderInicio, movimientos: renderMovimientos, presupuestos: renderPresupuestos, simulador: renderSimulador, ajustes: renderAjustes })[ui.tab]();
  }

  // ---------- Inicio ----------
  function renderInicio() {
    const aj = estado.ajustes, movs = estado.movimientos, h = hoy();
    const r = M.meta(aj, movs, h, {});
    const mes = mesActual(), res = M.resumenMensual(movs, mes);
    const limites = aj.presupuestos, totalLimite = Object.values(limites).reduce((a, b) => a + (Number(b) || 0), 0);
    let html = '';

    // Meta
    if (aj.objetivo.importe > 0) {
      const pct = Math.min(100, (r.ahorrado / aj.objetivo.importe) * 100);
      html += `<section class="tarjeta acento">
        <div class="mini">Entrada del piso</div>
        <div class="cifra" style="margin-top:6px">${esc(eur0(r.ahorrado))} <small>de ${esc(eur0(aj.objetivo.importe))}</small></div>
        ${barra(pct, 'meta')}
        <div class="fila"><span class="sub">${pct.toFixed(0)} % conseguido</span><span class="sub">Faltan ${esc(eur0(r.faltan))}</span></div>
        <p class="sub" style="margin-top:8px;font-size:.82rem">${esc(desglosePatrimonio())}</p>
        ${r.mesesHastaFecha != null ? `<hr style="border-color:rgba(255,255,255,.15)"><div class="fila"><span class="sub">Fecha límite ${esc(nombreMesCorto(aj.objetivo.fechaLimite.slice(0, 7)))} · ${r.mesesHastaFecha} meses</span><span class="cifra-m">${r.necesarioMes != null ? esc(eur0(r.necesarioMes)) + '<span class="sub">/mes</span>' : ''}</span></div>` : ''}
      </section>`;
    } else {
      html += `<section class="tarjeta vacio"><div class="emoji">🏠</div><h2>Ponle número a tu piso</h2><p>Di cuánto necesitas para la entrada y para cuándo. A partir de ahí la app te dice cuánto tienes que ahorrar al mes.</p><button class="btn primario" data-ir="ajustes">Definir objetivo</button></section>`;
    }

    // Ritmo
    if (movs.length) {
      if (aj.ingresosMensuales > 0) {
        let cuerpo, sello = '';
        if (r.ahorroRealMes > 0) {
          const vs = r.mesesHastaFecha != null && r.mesesConRitmoActual != null ? r.mesesConRitmoActual - r.mesesHastaFecha : null;
          const mesesTxt = n => `${n} ${n === 1 ? 'mes' : 'meses'}`;
          if (vs != null) sello = vs === 0 ? '<span class="sello verde">Justo a tiempo</span>' : vs < 0 ? `<span class="sello verde">Vas bien · ${mesesTxt(-vs)} antes</span>` : `<span class="sello rojo">Vas tarde · ${mesesTxt(vs)} después</span>`;
          cuerpo = `<div class="cifra verde">${esc(eur0(r.ahorroRealMes))}<small>/mes</small></div>
            <p class="sub" style="margin-top:8px">Ingresas ${esc(eur0(aj.ingresosMensuales))} y gastas de media ${esc(eur0(r.gastoMedioMes))}. ${r.faltan > 0 && r.fechaEstimada ? `A este ritmo llegas a la entrada en <b>${esc(nombreMesCorto(r.fechaEstimada))}</b>.` : ''}</p>`;
        } else {
          cuerpo = `<div class="cifra rojo">${esc(eur0(r.ahorroRealMes))}<small>/mes</small></div><p class="sub" style="margin-top:8px">Gastas más de lo que ingresas: así no se ahorra nada. Mira en <b>Simular</b> qué recortes te lo arreglan.</p>`;
          sello = '<span class="sello rojo">En números rojos</span>';
        }
        html += `<section class="tarjeta"><div class="fila"><span class="mini">Tu ritmo de ahorro</span>${sello}</div><div style="margin-top:8px">${cuerpo}</div>
          ${r.extrapolado ? `<p class="nota" style="margin-top:10px">Estimado con los ${Number(h.slice(8, 10))} días que llevas de este mes. Importa meses completos para afinar.</p>` : ''}
          ${r.mesesCompletos ? `<p class="sub" style="margin-top:8px">Media de ${r.mesesCompletos} ${r.mesesCompletos === 1 ? 'mes completo' : 'meses completos'}.</p>` : ''}</section>`;
      } else {
        html += `<section class="tarjeta"><div class="mini">Tu ritmo de ahorro</div><p class="sub" style="margin:8px 0 12px">Para calcular cuánto ahorras al mes necesito saber cuánto ingresas.</p><button class="btn" data-ir="ajustes">Poner mis ingresos</button></section>`;
      }
    }

    // Mes en curso
    if (movs.length) {
      const dia = Number(h.slice(8, 10)), dias = M.diasDelMes(mes);
      const previsto = res.gastos / dia * dias;
      const est = estadoPresu(res.gastos, totalLimite);
      html += `<section class="tarjeta"><div class="fila"><span class="mini">${esc(nombreMes(mes))}</span><span class="sub">Día ${dia} de ${dias}</span></div>
        <div class="cifra acentoc" style="margin-top:8px">${esc(eur(res.gastos))}</div>
        ${totalLimite ? `${barra(res.gastos / totalLimite * 100, est)}<div class="fila"><span class="sub">Límite total ${esc(eur0(totalLimite))}</span><span class="sub ${est === 'pasado' ? 'rojo' : ''}">${res.gastos <= totalLimite ? 'Te quedan ' + esc(eur0(totalLimite - res.gastos)) : 'Te has pasado ' + esc(eur0(res.gastos - totalLimite))}</span></div>`
          : `<p class="sub" style="margin-top:8px">Unos ${esc(eur0(res.gastos / dia))} al día. Si sigues así, acabarás el mes en <b>${esc(eur0(previsto))}</b>. <a href="#" data-ir="presupuestos" style="color:var(--acento)">Ponte límites</a>.</p>`}
        ${res.ingresos ? `<p class="sub" style="margin-top:8px">Ingresos registrados este mes: <span class="verde">${esc(eur(res.ingresos))}</span></p>` : ''}
        ${res.invertido ? `<p class="sub" style="margin-top:8px">Invertido este mes: <span class="verde">${esc(eur(res.invertido))}</span> (no cuenta como gasto)</p>` : ''}
      </section>`;

      // Desglose
      const cats = Object.entries(res.porCategoria).sort((a, b) => b[1] - a[1]);
      const max = cats.length ? cats[0][1] : 1;
      html += `<section class="tarjeta"><div class="mini">En qué se va</div><div class="desglose" style="margin-top:12px">
        ${cats.map(([c, v]) => { const lim = Number(limites[c]) || 0, e = estadoPresu(v, lim); return `<div class="cat"><span class="nombre">${esc(c)}</span><span class="valor">${esc(eur(v))}</span>${barra(v / max * 100, e)}<span class="estado">${lim ? (v > lim ? `Te has pasado ${esc(eur0(v - lim))} del límite de ${esc(eur0(lim))}` : `${esc(eur0(lim - v))} libres de ${esc(eur0(lim))}`) : `${(v / res.gastos * 100).toFixed(0)} % del mes`}</span></div>`; }).join('')}
        ${cats.length === 0 ? '<p class="sub">Sin gastos este mes todavía.</p>' : ''}
      </div></section>`;
    } else {
      html += `<section class="tarjeta vacio"><div class="emoji">📥</div><h2>Trae tus movimientos</h2><p>Importa el Excel que exporta la app del BBVA y la app categoriza cada gasto sola.</p><button class="btn primario" data-ir="ajustes">Importar Excel</button></section>`;
    }

    $('#vista').innerHTML = html;
    $('#vista').querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); irA(b.dataset.ir); }));
  }

  // ---------- Movimientos ----------
  function renderMovimientos() {
    const meses = mesesDisponibles();
    if (ui.mes !== 'todos' && !meses.includes(ui.mes)) ui.mes = 'todos';
    const q = ui.busqueda.trim().toLowerCase();
    const lista = estado.movimientos.filter(m => (ui.mes === 'todos' || m.fecha.startsWith(ui.mes)) && (ui.cat === 'todas' || m.categoria === ui.cat) && (!q || m.concepto.toLowerCase().includes(q)));
    const totalG = lista.filter(esGasto).reduce((a, m) => a - m.importe, 0);
    const totalI = lista.filter(m => m.importe > 0 && m.categoria === 'Ingresos').reduce((a, m) => a + m.importe, 0);
    const catsPresentes = M.CATEGORIAS.filter(c => estado.movimientos.some(m => m.categoria === c));
    let html = `<div class="filtros">
      <select id="f-mes">${['todos', ...meses].map(m => `<option value="${m}" ${ui.mes === m ? 'selected' : ''}>${m === 'todos' ? 'Todos los meses' : esc(nombreMes(m))}</option>`).join('')}</select>
      <input id="f-q" class="buscar" type="search" placeholder="Buscar comercio…" value="${esc(ui.busqueda)}">
      <div class="chips"><button class="chip ${ui.cat === 'todas' ? 'activo' : ''}" data-cat="todas">Todas</button>${catsPresentes.map(c => `<button class="chip ${ui.cat === c ? 'activo' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    </div>
    <div class="fila"><span class="sub">${lista.length} movimientos</span><span class="sub"><span class="acentoc" style="font-weight:600">${esc(eur(totalG))}</span>${totalI ? ` · <span class="verde" style="font-weight:600">+${esc(eur(totalI))}</span>` : ''}</span></div>`;

    if (!estado.movimientos.length) {
      html += `<section class="tarjeta vacio"><div class="emoji">📥</div><h2>Todavía no hay nada</h2><p>Importa el Excel del BBVA desde Ajustes o añade un gasto con el botón +.</p><button class="btn primario" data-ir="ajustes">Ir a Ajustes</button></section>`;
    } else if (!lista.length) {
      html += `<section class="tarjeta vacio"><p>Nada que coincida con ese filtro.</p></section>`;
    } else {
      const porDia = {};
      for (const m of lista) (porDia[m.fecha] = porDia[m.fecha] || []).push(m);
      for (const f of Object.keys(porDia).sort().reverse()) {
        const dia = porDia[f], tot = dia.reduce((a, m) => a + (esGasto(m) ? -m.importe : 0), 0);
        html += `<div class="dia"><div class="dia-cab"><span>${esc(fechaLarga(f))}</span><span>${esc(eur(tot))}</span></div><div class="lista">
          ${dia.map(m => `<button class="mov" data-id="${m.id}"><span class="concepto">${esc(m.concepto)}</span><span class="cat ${esc(m.origen || '')}">${esc(m.categoria)}</span><span class="importe ${m.categoria === 'Ingresos' ? 'ingreso' : (M.NO_GASTO.includes(m.categoria) ? 'neutro' : '')}">${m.importe > 0 ? '+' : ''}${esc(eur(m.importe))}</span></button>`).join('')}
        </div></div>`;
      }
    }
    const v = $('#vista'); v.innerHTML = html;
    $('#f-mes').addEventListener('change', e => { ui.mes = e.target.value; render(); });
    $('#f-q').addEventListener('input', e => { ui.busqueda = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#f-q'); i.focus(); i.setSelectionRange(pos, pos); });
    v.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { ui.cat = b.dataset.cat; render(); }));
    v.querySelectorAll('.mov').forEach(b => b.addEventListener('click', () => hojaEditar(b.dataset.id)));
    v.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => irA(b.dataset.ir)));
  }

  function hojaEditar(id) {
    const m = estado.movimientos.find(x => x.id === id); if (!m) return;
    abrirHoja(`<h2>${esc(m.concepto)}</h2><p class="sub">${esc(fechaLarga(m.fecha))} · <b>${esc(eur(m.importe))}</b>${m.origen === 'manual' ? ' · añadido a mano' : ''}</p>
      <div class="campo" style="margin-top:16px"><label for="e-cat">Categoría</label><select id="e-cat">${M.CATEGORIAS.map(c => `<option ${c === m.categoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><span class="ayuda">La app recordará esta categoría para este comercio.</span></div>
      <button class="btn peligro" id="e-borrar">Borrar movimiento</button><button class="btn" id="e-cerrar">Cerrar</button>`);
    $('#e-cat').addEventListener('change', e => {
      const cat = e.target.value, clave = M.normalizarConcepto(m.concepto);
      m.categoria = cat; estado.ajustes.reglasComercio[clave] = cat;
      const otros = estado.movimientos.filter(x => x.id !== m.id && M.normalizarConcepto(x.concepto) === clave && x.categoria !== cat);
      if (otros.length && confirm(`Hay ${otros.length} movimiento${otros.length > 1 ? 's' : ''} más de "${m.concepto}". ¿Los paso también a ${cat}?`)) otros.forEach(x => x.categoria = cat);
      guardar(); cerrarHoja(); render(); toast(`Guardado como ${cat}`);
    });
    $('#e-borrar').addEventListener('click', () => { if (!confirm('¿Borrar este movimiento?')) return; estado.movimientos = estado.movimientos.filter(x => x.id !== id); guardar(); cerrarHoja(); render(); toast('Movimiento borrado'); });
    $('#e-cerrar').addEventListener('click', cerrarHoja);
  }

  function hojaNuevo() {
    abrirHoja(`<h2>Añadir a mano</h2><p class="sub">Para lo que pagas en efectivo o con otra tarjeta.</p>
      <div class="campo" style="margin-top:16px"><label for="n-con">Concepto</label><input id="n-con" type="text" placeholder="Cañas con Marta" autocomplete="off"></div>
      <div class="dos" style="margin-top:14px"><div class="campo"><label for="n-imp">Importe</label><div class="con-unidad"><input id="n-imp" type="text" inputmode="decimal" placeholder="0,00"></div></div><div class="campo"><label for="n-fec">Fecha</label><input id="n-fec" type="date" value="${hoy()}" max="${hoy()}"></div></div>
      <div class="campo" style="margin-top:14px"><label for="n-cat">Categoría</label><select id="n-cat">${M.CATEGORIAS.map(c => `<option ${c === 'Otros' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <button class="btn primario" id="n-ok">Guardar</button><button class="btn" id="n-cerrar">Cancelar</button>`);
    let tocado = false;
    $('#n-cat').addEventListener('change', () => { tocado = true; });
    $('#n-con').addEventListener('input', e => { if (!tocado) $('#n-cat').value = M.categorizar(e.target.value, -1, estado.ajustes.reglasComercio); });
    $('#n-ok').addEventListener('click', () => {
      const con = $('#n-con').value.trim(), imp = M.parseImporte($('#n-imp').value), fec = $('#n-fec').value, cat = $('#n-cat').value;
      if (!con) return toast('Pon un concepto');
      if (imp == null || imp === 0) return toast('Pon un importe');
      if (!fec) return toast('Pon una fecha');
      const importe = cat === 'Ingresos' ? Math.abs(imp) : -Math.abs(imp);
      estado.movimientos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), fecha: fec, concepto: con, importe, categoria: cat, origen: 'manual' });
      estado.movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha));
      guardar(); cerrarHoja(); render(); toast('Gasto añadido');
    });
    $('#n-cerrar').addEventListener('click', cerrarHoja);
    setTimeout(() => $('#n-con').focus(), 50);
  }

  // ---------- Presupuestos ----------
  function renderPresupuestos() {
    const mes = mesActual(), res = M.resumenMensual(estado.movimientos, mes), lim = estado.ajustes.presupuestos;
    const g = M.gastoMedioMensual(estado.movimientos, hoy());
    const cats = M.CATEGORIAS.filter(c => !M.NO_GASTO.includes(c)).sort((a, b) => (res.porCategoria[b] || 0) - (res.porCategoria[a] || 0) || (g.porCategoria[b] || 0) - (g.porCategoria[a] || 0));
    const total = Object.values(lim).reduce((a, b) => a + (Number(b) || 0), 0);
    const sinLimite = cats.filter(c => !lim[c] && (g.porCategoria[c] || 0) > 0);
    const est = estadoPresu(res.gastos, total);
    let html = `<section class="tarjeta"><div class="fila"><span class="mini">${esc(nombreMes(mes))}</span><span class="sub">${total ? 'Límite total ' + esc(eur0(total)) : 'Sin límites todavía'}</span></div>
      <div class="cifra-m" style="margin-top:8px">${esc(eur(res.gastos))}${total ? ` <span class="sub">de ${esc(eur0(total))}</span>` : ''}</div>
      ${total ? barra(res.gastos / total * 100, est) : ''}
      ${sinLimite.length ? `<p class="sub" style="margin-top:10px">Un buen punto de partida: gastar un 20 % menos de lo que gastas de media en cada categoría.</p><button class="btn" id="p-sugerir" style="margin-top:10px">Sugerir límites</button>` : ''}
    </section>
    <div class="presu">${cats.map(c => {
      const gasto = res.porCategoria[c] || 0, l = Number(lim[c]) || 0, e = estadoPresu(gasto, l);
      const txt = !l ? (g.porCategoria[c] ? `Media ${esc(eur0(g.porCategoria[c]))}/mes` : 'Sin límite') : gasto > l ? `Te has pasado ${esc(eur0(gasto - l))}` : `Te quedan ${esc(eur0(l - gasto))}`;
      return `<div class="linea"><span class="nombre">${esc(c)}</span><div class="limite"><input type="text" inputmode="decimal" data-cat="${esc(c)}" value="${l ? l : ''}" placeholder="límite" aria-label="Límite para ${esc(c)}"></div><span class="gasto">Gastado ${esc(eur(gasto))}</span>${l ? barra(gasto / l * 100, e) : ''}<span class="estado ${e}">${txt}</span></div>`;
    }).join('')}</div>`;
    const v = $('#vista'); v.innerHTML = html;
    v.querySelectorAll('.limite input').forEach(i => i.addEventListener('change', e => {
      const n = M.parseImporte(e.target.value); const c = e.target.dataset.cat;
      if (n == null || n <= 0) delete estado.ajustes.presupuestos[c]; else estado.ajustes.presupuestos[c] = Math.round(n);
      guardar(); render();
    }));
    const s = $('#p-sugerir'); if (s) s.addEventListener('click', () => {
      for (const c of sinLimite) estado.ajustes.presupuestos[c] = redondea5(g.porCategoria[c] * 0.8);
      guardar(); render(); toast('Límites sugeridos: 20 % por debajo de tu media');
    });
  }

  // ---------- Simulador ----------
  function renderSimulador() {
    const aj = estado.ajustes, h = hoy();
    const base = M.meta(aj, estado.movimientos, h, {});
    const cats = Object.entries(base.gastoMedioPorCategoria || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!cats.length) {
      $('#vista').innerHTML = `<section class="tarjeta vacio"><div class="emoji">✂️</div><h2>Nada que recortar aún</h2><p>Importa tus movimientos y aquí podrás probar cuánto ganarías recortando cada categoría.</p><button class="btn primario" data-ir="ajustes">Importar Excel</button></section>`;
      $('#vista').querySelector('[data-ir]').addEventListener('click', () => irA('ajustes'));
      return;
    }
    for (const k in ui.recortes) if (!base.gastoMedioPorCategoria[k]) delete ui.recortes[k];
    let html = `<section class="tarjeta acento" id="s-cab"></section>
      <section class="tarjeta">${cats.map(([c, v]) => { const p = ui.recortes[c] || 0; return `<div class="simu-fila"><div class="fila"><span class="nombre">${esc(c)}</span><span class="media">${esc(eur0(v))}/mes de media</span></div>
        <input type="range" min="0" max="100" step="5" value="${p}" data-cat="${esc(c)}" aria-label="Recorte en ${esc(c)}">
        <div class="res"><span>Recortar <b data-pct>${p}</b> %</span><span>ahorras <b data-ahorro>${esc(eur0(v * p / 100))}</b>/mes</span></div></div>`; }).join('')}
      <button class="btn primario" id="s-aplicar" style="margin-top:14px">Convertir en límites</button>
      <p class="ayuda sub" style="margin-top:8px;text-align:center">Fija como límite mensual lo que quedaría tras el recorte en cada categoría que hayas tocado.</p></section>`;
    const v = $('#vista'); v.innerHTML = html;
    const cab = () => {
      const r = M.meta(aj, estado.movimientos, h, ui.recortes);
      const sinIng = !(aj.ingresosMensuales > 0);
      $('#s-cab').innerHTML = `<div class="mini">Con estos recortes</div>
        <div class="cifra" style="margin-top:6px">+${esc(eur0(r.ahorroExtraMes))}<small>/mes</small></div>
        <p class="sub" style="margin-top:6px">${r.ahorroExtraMes ? `Son ${esc(eur0(r.ahorroExtraMes * 12))} más al año.` : 'Mueve los controles de abajo.'}</p>
        ${sinIng ? `<p class="nota" style="margin-top:10px;background:rgba(255,255,255,.1);color:inherit">Pon tus ingresos en Ajustes para ver cuándo llegarías a la entrada.</p>`
        : aj.objetivo.importe > 0 && r.faltan > 0 ? `<div class="antes-despues"><div><div class="mini">Ahora</div><div class="cifra-m">${base.fechaEstimada ? esc(nombreMesCorto(base.fechaEstimada)) : 'nunca'}</div><div class="sub">${esc(eur0(base.ahorroRealMes || 0))}/mes</div></div><div class="flecha">→</div><div><div class="mini">Con recortes</div><div class="cifra-m">${r.fechaEstimada ? esc(nombreMesCorto(r.fechaEstimada)) : 'nunca'}</div><div class="sub">${esc(eur0(r.ahorroRealMes || 0))}/mes</div></div></div>
          ${aj.objetivo.fechaLimite ? `<p class="sub" style="margin-top:10px;text-align:center">Tu fecha límite es ${esc(nombreMesCorto(aj.objetivo.fechaLimite.slice(0, 7)))}${r.mesesConRitmoActual != null && r.mesesHastaFecha != null ? (r.mesesConRitmoActual <= r.mesesHastaFecha ? ' · <b>llegas</b>' : ` · te faltarían ${r.mesesConRitmoActual - r.mesesHastaFecha} meses`) : ''}</p>` : ''}`
        : `<p class="sub">Ahorro mensual: ${esc(eur0(base.ahorroRealMes || 0))} → <b>${esc(eur0(r.ahorroRealMes || 0))}</b>. Define el objetivo del piso en Ajustes para ver la fecha.</p>`}`;
    };
    cab();
    v.querySelectorAll('input[type=range]').forEach(i => i.addEventListener('input', e => {
      const c = e.target.dataset.cat, p = Number(e.target.value); ui.recortes[c] = p;
      const fila = e.target.closest('.simu-fila'); fila.querySelector('[data-pct]').textContent = p;
      fila.querySelector('[data-ahorro]').textContent = eur0(base.gastoMedioPorCategoria[c] * p / 100);
      cab();
    }));
    $('#s-aplicar').addEventListener('click', () => {
      const tocadas = Object.entries(ui.recortes).filter(([, p]) => p > 0);
      if (!tocadas.length) return toast('Primero mueve algún control');
      for (const [c, p] of tocadas) estado.ajustes.presupuestos[c] = redondea5(base.gastoMedioPorCategoria[c] * (1 - p / 100));
      guardar(); toast(`${tocadas.length} límite${tocadas.length > 1 ? 's' : ''} fijado${tocadas.length > 1 ? 's' : ''}`); irA('presupuestos');
    });
  }

  // ---------- Ajustes ----------
  function renderAjustes() {
    const aj = estado.ajustes, n = estado.movimientos.length;
    const fechas = estado.movimientos.map(m => m.fecha).sort();
    const ingDetectados = (() => { const im = ingresosMovs(); if (!im.length) return 0; const meses = new Set(im.map(m => m.fecha.slice(0, 7))); return im.reduce((a, m) => a + m.importe, 0) / meses.size; })();
    let html = `<section class="tarjeta"><h2>Tus números</h2>
      <div class="campo" style="margin-top:12px"><label for="a-ing">Ingresos netos al mes</label><div class="con-unidad"><input id="a-ing" type="text" inputmode="decimal" value="${aj.ingresosMensuales || ''}" placeholder="1.800"></div>${ingDetectados && !aj.ingresosMensuales ? `<span class="ayuda">En tus movimientos veo ingresos de unos ${esc(eur0(ingDetectados))}/mes. <a href="#" id="a-usar-ing" style="color:var(--acento)">Usar esa cifra</a>.</span>` : '<span class="ayuda">Lo que te llega limpio: nómina y otros ingresos fijos.</span>'}</div>
      <hr>
      <h2>El piso</h2>
      <div class="campo" style="margin-top:12px"><label for="a-obj">Entrada que necesitas</label><div class="con-unidad"><input id="a-obj" type="text" inputmode="decimal" value="${aj.objetivo.importe || ''}" placeholder="30.000"></div><span class="ayuda">Normalmente el 20 % del precio más un 10 % de gastos e impuestos.</span></div>
      <div class="campo"><label for="a-fec">Para cuándo</label><input id="a-fec" type="date" value="${esc(aj.objetivo.fechaLimite)}" min="${hoy()}"></div>
    </section>
    <section class="tarjeta"><div class="fila"><h2>Lo que ya tienes</h2><span class="cifra-m verde">${esc(eur0(M.ahorradoTotal(aj.patrimonio)))}</span></div>
      <p class="sub" style="margin:6px 0 4px">Es lo que cuenta para la entrada. Se actualiza solo al importar la Posición Global del BBVA y el extracto de Trade Republic, pero puedes corregirlo a mano.</p>
      ${M.PARTIDAS.map(([k, nombre]) => `<div class="campo"><label for="a-p-${k}">${esc(nombre)}</label><div class="con-unidad"><input id="a-p-${k}" data-partida="${k}" type="text" inputmode="decimal" value="${aj.patrimonio[k] || ''}" placeholder="0"></div></div>`).join('')}
    </section>
    <section class="tarjeta"><h2>Datos</h2>
      <p class="sub" style="margin:6px 0 12px">${n ? `${n} movimientos, del ${esc(fechaLocal(fechas[0]).toLocaleDateString('es-ES'))} al ${esc(fechaLocal(fechas[n - 1]).toLocaleDateString('es-ES'))}.` : 'Todavía no hay movimientos.'}</p>
      <input id="a-xlsx" type="file" accept=".xlsx,.xls,.csv" hidden>
      <button class="btn primario" id="a-importar">Importar Excel del BBVA</button>
      <p class="ayuda sub" style="margin-top:8px">En la app del BBVA: Cuentas o Tarjetas → Movimientos → Exportar → Excel. Vale también el Excel de <b>Posición Global</b>: actualiza tu efectivo BBVA. Guárdalos en Archivos y elígelos aquí. Puedes repetirlo cada semana: no se duplica nada.</p>
      <input id="a-pdf" type="file" accept=".pdf,application/pdf" hidden>
      <button class="btn primario" id="a-importar-tr" style="margin-top:12px">Importar extracto de Trade Republic</button>
      <p class="ayuda sub" style="margin-top:8px">En Trade Republic: icono de perfil → Actividad → Documentos → <b>Extracto de cuenta</b> (PDF). Los pagos con su tarjeta entran como gastos; las compras de ETFs, como inversión; las transferencias desde tu BBVA, como traspaso.</p>
      <hr>
      <input id="a-json" type="file" accept=".json,application/json" hidden>
      <div class="btn-fila"><button class="btn" id="a-exportar">Guardar copia</button><button class="btn" id="a-restaurar">Restaurar copia</button></div>
      <button class="btn peligro" id="a-borrar">Borrar todos los datos</button>
    </section>
    ${esStandalone() ? '' : `<section class="tarjeta"><h2>Instalar en el iPhone</h2><p class="sub" style="margin-top:6px">Abre esta página en <b>Safari</b>, toca el botón <b>Compartir</b> (el cuadrado con la flecha) y elige <b>Añadir a pantalla de inicio</b>. Tendrás Mi Piso como una app más, con icono y a pantalla completa.</p></section>`}
    <p class="sub" style="text-align:center">Tus datos solo están en este dispositivo. Nada se envía a ningún servidor.</p>`;
    const v = $('#vista'); v.innerHTML = html;
    const num = id => { const x = M.parseImporte($(id).value); return x == null || x < 0 ? 0 : x; };
    const guardarNums = () => { aj.ingresosMensuales = num('#a-ing'); aj.objetivo.importe = num('#a-obj'); aj.objetivo.fechaLimite = $('#a-fec').value || ''; guardar(); };
    ['#a-ing', '#a-obj', '#a-fec'].forEach(id => $(id).addEventListener('change', () => { guardarNums(); toast('Guardado'); }));
    v.querySelectorAll('input[data-partida]').forEach(i => i.addEventListener('change', e => {
      const x = M.parseImporte(e.target.value); aj.patrimonio[e.target.dataset.partida] = x == null || x < 0 ? 0 : x; guardar(); render(); toast('Guardado');
    }));
    $('#a-importar-tr').addEventListener('click', () => $('#a-pdf').click());
    $('#a-pdf').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importarPdfTR(f); });
    const u = $('#a-usar-ing'); if (u) u.addEventListener('click', e => { e.preventDefault(); $('#a-ing').value = Math.round(ingDetectados); guardarNums(); render(); toast('Ingresos guardados'); });
    $('#a-importar').addEventListener('click', () => $('#a-xlsx').click());
    $('#a-xlsx').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importarExcel(f); });
    $('#a-exportar').addEventListener('click', exportarCopia);
    $('#a-restaurar').addEventListener('click', () => $('#a-json').click());
    $('#a-json').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await restaurarCopia(f); });
    $('#a-borrar').addEventListener('click', () => { if (!confirm('¿Borrar todos los movimientos, límites y ajustes? No se puede deshacer.')) return; estado = porDefecto(); guardar(); render(); toast('Todo borrado'); });
  }

  async function importarExcel(file) {
    if (!window.XLSX) return toast('El lector de Excel aún se está cargando. Prueba otra vez en unos segundos.');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      let mejor = null;
      for (const nombre of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
        try { const r = M.parseBbva(rows); if (!mejor || r.movimientos.length > mejor.movimientos.length) mejor = r; } catch { /* hoja sin cabecera */ }
      }
      if (!mejor) {
        for (const nombre of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
          try {
            const p = M.parsePosicionGlobal(rows);
            estado.ajustes.patrimonio.bbva = p.total; guardar(); render();
            return toast(`Efectivo BBVA actualizado: ${eur(p.total)} (${p.cuentas.length} cuenta${p.cuentas.length > 1 ? 's' : ''})`);
          } catch { /* no es una Posición Global */ }
        }
        return toast('Este archivo no parece un export del BBVA.');
      }
      const r = M.fusionar(estado.movimientos, mejor.movimientos, estado.ajustes.reglasComercio);
      estado.movimientos = r.lista; guardar(); render();
      toast(`${r.anadidos} añadidos · ${r.duplicados} ya estaban${mejor.saltadas ? ` · ${mejor.saltadas} filas saltadas` : ''}`);
    } catch (err) { console.error(err); toast('No he podido leer ese archivo.'); }
  }

  // ---------- Trade Republic (PDF) ----------
  let pdfjsPromesa = null;
  function cargarPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromesa) pdfjsPromesa = new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = PDFJS_URL;
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(window.pdfjsLib); };
      s.onerror = () => { pdfjsPromesa = null; ko(new Error('pdfjs')); };
      document.head.appendChild(s);
    });
    return pdfjsPromesa;
  }
  async function textoDePdf(file) {
    const pdfjs = await cargarPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let texto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      texto += c.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
    }
    return texto;
  }
  async function importarPdfTR(file) {
    toast('Leyendo el extracto…');
    try {
      const p = M.parseTradeRepublic(await textoDePdf(file));
      const r = M.fusionar(estado.movimientos, p.movimientos, estado.ajustes.reglasComercio);
      estado.movimientos = r.lista;
      const pat = estado.ajustes.patrimonio;
      if (p.balanceFinal != null) pat.trEfectivo = p.balanceFinal;
      const invertidoNuevo = r.nuevos.filter(m => m.categoria === 'Inversión').reduce((a, m) => a - m.importe, 0);
      pat.inversiones = Math.max(0, Math.round(((Number(pat.inversiones) || 0) + invertidoNuevo) * 100) / 100);
      guardar(); render();
      toast(`${r.anadidos} añadidos · ${r.duplicados} ya estaban · efectivo TR ${eur(pat.trEfectivo)}`);
    } catch (err) {
      console.error(err);
      toast(err.message === 'no-extracto' ? 'Este PDF no parece un extracto de cuenta de Trade Republic.'
        : err.message === 'pdfjs' ? 'No he podido cargar el lector de PDF. ¿Tienes conexión?' : 'No he podido leer ese PDF.');
    }
  }

  function exportarCopia() {
    const blob = new Blob([JSON.stringify(estado, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mi-piso-${hoy()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function restaurarCopia(file) {
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.movimientos)) throw new Error('formato');
      if (!confirm(`La copia tiene ${d.movimientos.length} movimientos y sustituirá lo que hay ahora. ¿Continuar?`)) return;
      localStorage.setItem(CLAVE, JSON.stringify(d)); estado = cargar(); render(); toast('Copia restaurada');
    } catch { toast('Esa copia no es válida.'); }
  }

  // ---------- Arranque ----------
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => irA(b.dataset.tab)));
  $('#btn-mas').addEventListener('click', hojaNuevo);
  $('#velo').addEventListener('click', cerrarHoja);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHoja(); });
  render();
})();
