/* Monitor de Sinal TV Digital – aplicação web (sem dependências além do d3) */
(() => {
  'use strict';
  // ------------------------------------------------------------ formatação
  const L = d3.formatLocale({decimal: ',', thousands: '.', grouping: [3], currency: ['R$', '']});
  const f1 = L.format(',.1f'), fi = L.format(',d'), fp = L.format('.1%'), f4 = L.format('.4f');
  const fc = new Intl.NumberFormat('pt-BR', {notation: 'compact', maximumFractionDigits: 1});
  const db = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + f1(Math.abs(v)) + ' dB';
  const dbm = (v) => (v < 0 ? '−' : '') + f1(Math.abs(v));
  const $ = (s) => document.querySelector(s);
  const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt != null) e.textContent = txt; if (cls) e.className = cls; return e; };
  const gmaps = (lat, lon) => `https://www.google.com/maps?q=${lat},${lon}`;

  const CAP = [[-46.83, -23.79], [-46.36, -23.36]];   // enquadramento inicial: capital
  const CLS = ['Bom', 'Médio', 'Limítrofe', 'Sem sinal'];
  const CLR = {'Bom': '#2a78d6', 'Médio': '#86b6ef', 'Limítrofe': '#eda100', 'Sem sinal': '#e34948'};
  const ESCALA = 10;
  const div = d3.scaleDiverging([-ESCALA, 0, ESCALA], d3.interpolateRgbBasis(['#d7301f', '#e8e6e1', '#1f63c6'])).clamp(true);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const D = {};       // dados
  const S = {canal: 'Todos', sit: '', fundo: 'osm', sel: null, q: '', oc: '', sort: {k: 'variacao_db', dir: -1}};
  let LIM = 3, G = 0.005, R0 = 'ref', R1 = 'novo';
  const cls = (v) => (v >= LIM ? 'up' : v <= -LIM ? 'down' : '');

  // ------------------------------------------------------------ carga
  const arquivos = ['resumo', 'canais', 'classes', 'regioes', 'areas', 'referencias', 'trilhas'];
  Promise.all(arquivos.map((n) => fetch(`dados/${n}.json`, {cache: 'no-cache'}).then((r) => { if (!r.ok) throw new Error(`dados/${n}.json (${r.status})`); return r.json(); })))
    .then((res) => { arquivos.forEach((n, i) => { D[n] = res[i]; }); iniciar(); })
    .catch((e) => { const x = $('#erro'); x.hidden = false; x.textContent = 'Não foi possível carregar os dados: ' + e.message + '. Rode "python3 processar.py" e abra o sistema pelo servidor (não direto do arquivo).'; });

  // ------------------------------------------------------------ navegação
  const PAGES = ['painel', 'mapa', 'regioes', 'ocorrencias', 'sobre'];
  const show = () => {
    const tab = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'painel';
    document.querySelectorAll('.sx-page').forEach((p) => { p.hidden = p.id !== tab; });
    document.querySelectorAll('.sx-nav a').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (tab === 'mapa' && D.areas) MAPA.resize();
    if (tab === 'painel' && D.canais) { grafCanais(); grafClasses(); }
  };
  window.addEventListener('hashchange', show);
  const goMap = (lat, lon, k, id) => { if (location.hash !== '#mapa') location.hash = 'mapa'; setTimeout(() => { if (id) select(id); MAPA.zoomTo(lon, lat, k); }, 80); };

  // ------------------------------------------------------------ início
  function iniciar() {
    const r = D.resumo; LIM = r.parametros.limite_estavel_db; G = r.parametros.grade_area; R0 = r.campanha_ref; R1 = r.campanha_novo;
    D.byId = new Map(D.areas.map((a) => [a.id, a]));
    D.cells = {};
    for (const a of D.areas) { (D.cells[a.canal] ||= new Map()).set(key(a.lat, a.lon), a); }
    const n = D.trilhas.lat.length; D.tk = new Array(n);
    for (let i = 0; i < n; i++) D.tk[i] = key(D.trilhas.lat[i], D.trilhas.lon[i]);

    const canais = r.canais_comparados.join(', ');
    $('#subtitulo').textContent = `São Paulo · ${R0} × ${R1} · canais ${canais}`;
    document.querySelectorAll('.lbl-ref').forEach((e) => { e.textContent = `${R0} (dBm)`; });
    document.querySelectorAll('.lbl-novo').forEach((e) => { e.textContent = `${R1} (dBm)`; });
    $('#d-l-ref').textContent = `Nível ${R0}`; $('#d-l-novo').textContent = `Nível ${R1}`; $('#d-th-ref').textContent = R0; $('#d-th-novo').textContent = R1;
    for (const c of r.canais_comparados) { $('#f-canal').add(new Option(c, c)); $('#f-oc').add(new Option(c, c)); }
    $('#leg-escala').textContent = `escala de ${db(-ESCALA)} a ${db(ESCALA)}`;
    $('#oc-nota').textContent = `Áreas de ~550 m onde o nível caiu ${LIM} dB ou mais, da maior queda para a menor. Clique numa linha para abrir no mapa.`;

    const c24 = D.canais.reduce((a, b) => (b.variacao_db > a.variacao_db ? b : a));
    const cmin = D.canais.reduce((a, b) => (b.variacao_db < a.variacao_db ? b : a));
    $('#resumo-texto').replaceChildren('O sinal melhorou em ', el('b', r.regioes_melhoraram), ' das ', el('b', r.regioes_comparadas),
      ' regiões comparadas (ganho mediano de ', el('b', db(r.variacao_mediana_db)), `). O canal que mais ganhou foi o ${c24.canal} (`, el('b', db(c24.variacao_db)),
      `); o pior resultado foi do ${cmin.canal} (`, el('b', db(cmin.variacao_db)), `). Período novo: ${r.periodo_novo.join(' a ')}.`);
    $('#k-melh').textContent = r.regioes_melhoraram; $('#k-melh-s').textContent = `${fp(r.pct_regioes_melhoraram)} das comparadas`;
    $('#k-est').textContent = r.regioes_estaveis; $('#k-est-s').textContent = `variação dentro de ±${LIM} dB`;
    $('#k-pior').textContent = r.regioes_pioraram; $('#k-pior-s').textContent = `queda de ${LIM} dB ou mais`;
    $('#k-areas').textContent = r.areas_pioraram; $('#k-areas-s').textContent = `de ${r.areas_comparadas} áreas, média dos canais`;
    $('#k-med').textContent = fc.format(r.amostras_novo); $('#k-med-s').textContent = `em ${R1}, contra ${fi(r.amostras_ref)} em ${R0}`;

    const P = r.parametros, F = P.faixas;
    const met = [
      ['Dados', `Referência: campanha ${R0}. Nova: ${r.arquivos_novo} arquivos de ${r.periodo_novo.join(' a ')}. Entram na comparação os canais medidos nas duas campanhas: ${canais}.` + (r.canais_so_novo.length ? ` Só na campanha nova (fora da comparação): ${r.canais_so_novo.join(', ')}.` : '')],
      ['Nível', 'Coluna NIVEL, em dBm. Em cada área vale a mediana das medições de cada campanha; a variação é nova menos referência (positivo = sinal mais forte). Leituras com nível 0 são descartadas.'],
      ['Situação', `Melhorou: ganho de ${LIM} dB ou mais. Piorou: queda de ${LIM} dB ou mais. Estável: entre os dois. A margem cobre diferenças de equipamento e calibração.`],
      ['Faixas', `Bom a partir de ${dbm(F['Bom'])} dBm; Médio a partir de ${dbm(F['Médio'])}; Limítrofe a partir de ${dbm(F['Limítrofe'])}; abaixo disso, Sem sinal.`],
      ['Áreas', `Quadrículas de ${L.format('.3f')(P.grade_area)}° (~550 m), com ao menos ${P.min_area[0]} medições na referência e ${P.min_area[1]} na nova por canal. Regiões de ${L.format('.2f')(P.grade_regiao)}° (~2 km), com ${P.min_regiao[0]} e ${P.min_regiao[1]}.`],
      ['Mapa', 'Fundo OpenStreetMap (precisa de internet no navegador) ou, offline, as ruas desenhadas com os trajetos GPS das medições. Nomes de bairro vêm do ponto de referência mais próximo e são aproximados.'],
    ];
    $('#metodo').replaceChildren(...met.flatMap(([t, d]) => [el('dt', t), el('dd', d)]));
    $('#gerado').textContent = `Dados processados em ${new Date(r.gerado_em).toLocaleString('pt-BR')}.`;
    $('#bairros').replaceChildren(...D.referencias.map((x) => x.local).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((n) => new Option(n)));

    shortReg($('#t-melhor'), true); shortReg($('#t-pior'), false);
    tabRegioes(); tabOc();
    MAPA.init($('#mapa-sp'));
    show();
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!$('#mapa').hidden) MAPA.resize(); if (!$('#painel').hidden) { grafCanais(); grafClasses(); } }, 150); });
  }
  const key = (lat, lon) => Math.floor(lat / G) + '_' + Math.floor(lon / G);

  // ------------------------------------------------------------ tooltip
  const tip = (box) => { let t = box.querySelector('.tip'); if (!t) { t = el('div', null, 'tip'); t.hidden = true; box.appendChild(t); } return t; };
  const place = (box, t, x, y) => {
    const w = box.clientWidth; let left = x + 14; if (left + t.offsetWidth > w) left = x - t.offsetWidth - 14; if (left < 0) left = 0;
    let top = y - t.offsetHeight - 10; if (top < 0) top = y + 14; t.style.left = left + 'px'; t.style.top = top + 'px';
  };
  const tipLines = (t, title, lines) => { t.replaceChildren(el('div', title, 't'), ...lines.map((l) => el('div', l))); };

  // ------------------------------------------------------------ mapa
  const MAPA = (() => {
    const TILE = 256, MAXZ = 19, tiles = new Map();
    const proj = (lon, lat) => { const s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * TILE, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE]; };
    const inv = (x, y) => [x / TILE * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / TILE))) * 180 / Math.PI];
    let box, canvas, ctx, zoom, t = d3.zoomIdentity, W = 0, H = 0, k0 = 1, tipEl, raf = 0;
    const scr = (lon, lat) => { const p = proj(lon, lat); return [t.x + p[0] * t.k, t.y + p[1] * t.k]; };
    const fitT = () => {
      const a = proj(CAP[0][0], CAP[1][1]), b = proj(CAP[1][0], CAP[0][1]);
      k0 = Math.min((W - 16) / (b[0] - a[0]), (H - 16) / (b[1] - a[1]));
      return d3.zoomIdentity.translate(W / 2 - (a[0] + b[0]) / 2 * k0, H / 2 - (a[1] + b[1]) / 2 * k0).scale(k0);
    };
    const req = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    const tile = (z, x, y) => {
      const id = `${z}/${x}/${y}`; let im = tiles.get(id);
      if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.onload = req; im.src = `https://tile.openstreetmap.org/${id}.png`; tiles.set(id, im); }
      return im.complete && im.naturalWidth ? im : null;
    };
    function cellAt(ev) {
      const [mx, my] = d3.pointer(ev, canvas);
      const ll = inv((mx - t.x) / t.k, (my - t.y) / t.k);
      const r = D.cells[S.canal] && D.cells[S.canal].get(key(ll[1], ll[0]));
      return r && (!S.sit || r.situacao === S.sit) ? {r, mx, my} : null;
    }
    function draw() {
      if (!ctx || !W) return;
      const fg = css('--fg'), bg = css('--bg'), gray = css('--gray');
      ctx.clearRect(0, 0, W, H);
      const rel = t.k / k0;
      if (S.fundo === 'osm') {
        const z = Math.max(0, Math.min(MAXZ, Math.round(Math.log2(t.k)))), n = 2 ** z, size = TILE * t.k / n;
        const x0 = Math.max(0, Math.floor(-t.x / size)), x1 = Math.min(n - 1, Math.floor((W - t.x) / size));
        const y0 = Math.max(0, Math.floor(-t.y / size)), y1 = Math.min(n - 1, Math.floor((H - t.y) / size));
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const im = tile(z, x, y); if (im) ctx.drawImage(im, t.x + x * size, t.y + y * size, size + 0.5, size + 0.5);
        }
        ctx.fillStyle = bg; ctx.globalAlpha = 0.35; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
        // células coloridas
        const cm = D.cells[S.canal] || new Map(), list = [];
        for (const r of cm.values()) if (!S.sit || r.situacao === S.sit) list.push(r);
        list.sort((a, b) => Math.abs(a.variacao_db) - Math.abs(b.variacao_db));
        ctx.globalAlpha = 0.78;
        for (const r of list) {
          const gy = Math.floor(r.lat / G), gx = Math.floor(r.lon / G);
          const p0 = scr(gx * G, (gy + 1) * G), p1 = scr((gx + 1) * G, gy * G);
          if (p1[0] < 0 || p0[0] > W || p1[1] < 0 || p0[1] > H) continue;
          ctx.fillStyle = div(r.variacao_db); ctx.fillRect(p0[0] + .5, p0[1] + .5, p1[0] - p0[0] - 1, p1[1] - p0[1] - 1);
        }
        ctx.globalAlpha = 1;
      } else {
        const T = D.trilhas, n = T.lat.length, rg = Math.max(1, Math.min(4, 1.1 * Math.sqrt(rel))), rc = Math.max(2, Math.min(7, 2.2 * Math.sqrt(rel)));
        const cm = D.cells[S.canal] || new Map(), col = [];
        ctx.fillStyle = gray;
        for (let i = 0; i < n; i++) {
          const [x, y] = scr(T.lon[i], T.lat[i]); if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
          ctx.fillRect(x - rg / 2, y - rg / 2, rg, rg);
          const r = cm.get(D.tk[i]); if (r && (!S.sit || r.situacao === S.sit)) col.push([x, y, r.variacao_db]);
        }
        col.sort((a, b) => Math.abs(a[2]) - Math.abs(b[2]));
        for (const [x, y, d] of col) { ctx.fillStyle = div(d); ctx.fillRect(x - rc / 2, y - rc / 2, rc, rc); }
      }
      const sel = S.sel && D.byId.get(S.sel);
      if (sel) {
        const gy = Math.floor(sel.lat / G), gx = Math.floor(sel.lon / G), p0 = scr(gx * G, (gy + 1) * G), p1 = scr((gx + 1) * G, gy * G);
        ctx.strokeStyle = fg; ctx.lineWidth = 2.5; ctx.strokeRect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]);
      }
      // rótulos
      ctx.font = `${rel > 3 ? 13 : 12}px ${css('--sans')}`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const boxes = [];
      for (const r of D.referencias) {
        if (!+r.rotulo && rel < 2.2) continue;
        const [x, y] = scr(r.lon, r.lat); if (x < 0 || y < 0 || x > W || y > H) continue;
        const w = ctx.measureText(r.local).width, right = x > W * 0.75, bx = right ? x - 6 - w : x + 6, b = [bx - 2, y - 9, bx + w + 2, y + 9];
        if (b[0] < 2 || b[2] > W - 2 || b[1] < 2 || b[3] > H - 20 || boxes.some((o) => !(b[0] > o[2] || b[2] < o[0] || b[1] > o[3] || b[3] < o[1]))) continue;
        boxes.push(b);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = fg; ctx.stroke();
        ctx.lineWidth = 3.5; ctx.strokeStyle = bg; ctx.strokeText(r.local, bx, y); ctx.fillStyle = fg; ctx.fillText(r.local, bx, y);
      }
      // escala
      const ll = inv((20 - t.x) / t.k, (H - 20 - t.y) / t.k), mpp = 40075016 * Math.cos(ll[1] * Math.PI / 180) / (TILE * t.k);
      let m = 100; const cand = [100, 200, 500, 1000, 2000, 5000, 10000, 20000]; for (const c of cand) if (c / mpp <= 150) m = c;
      const px = m / mpp; ctx.fillStyle = fg; ctx.fillRect(20, H - 20, px, 3);
      const lbl = m >= 1000 ? m / 1000 + ' km' : m + ' m'; ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(lbl, 20, H - 31); ctx.fillText(lbl, 20, H - 31);
      if (S.fundo === 'osm') {
        const a = '© colaboradores do OpenStreetMap'; ctx.font = `11px ${css('--sans')}`; const w = ctx.measureText(a).width;
        ctx.fillStyle = bg; ctx.globalAlpha = .85; ctx.fillRect(W - w - 10, H - 18, w + 10, 18); ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.fillText(a, W - w - 5, H - 9);
      }
    }
    return {
      init(b) {
        box = b; canvas = el('canvas'); box.appendChild(canvas); ctx = canvas.getContext('2d'); tipEl = tip(box);
        zoom = d3.zoom().on('zoom', (e) => { t = e.transform; req(); });
        d3.select(canvas).call(zoom).on('dblclick.zoom', null);
        canvas.addEventListener('pointermove', (ev) => {
          const c = cellAt(ev); if (!c) { tipEl.hidden = true; return; }
          const r = c.r;
          tipLines(tipEl, `${r.regiao} · ${r.canal === 'Todos' ? 'média ' + r.canais : r.canal}`, [`Variação: ${db(r.variacao_db)} (${r.situacao})`, `${R0}: ${dbm(r.nivel_ref)} dBm · ${R1}: ${dbm(r.nivel_novo)} dBm`, 'Clique para detalhes']);
          tipEl.hidden = false; place(box, tipEl, c.mx, c.my);
        });
        canvas.addEventListener('pointerleave', () => { tipEl.hidden = true; });
        canvas.addEventListener('click', (ev) => { const c = cellAt(ev); select(c ? c.r.id : null); });
      },
      resize() {
        if (!box) return;
        const first = !W;
        W = box.clientWidth || 800; H = Math.round(Math.max(480, Math.min(800, W * 0.8)));
        const dpr = window.devicePixelRatio || 1;
        canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const f = fitT(); zoom.scaleExtent([k0 * 0.7, k0 * 400]).extent([[0, 0], [W, H]]);
        if (first) d3.select(canvas).call(zoom.transform, f); else draw();
      },
      zoomTo(lon, lat, rel) {
        if (!W) this.resize();
        const p = proj(lon, lat), k = k0 * rel;
        d3.select(canvas).transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - p[0] * k, H / 2 - p[1] * k).scale(k));
      },
      zoomBy(f) { d3.select(canvas).transition().duration(250).call(zoom.scaleBy, f); },
      reset() { d3.select(canvas).transition().duration(500).call(zoom.transform, fitT()); },
      draw: req,
    };
  })();

  // ------------------------------------------------------------ detalhes
  function select(id) {
    S.sel = id; const r = id && D.byId.get(id);
    $('#det').hidden = !r; $('#det-vazio').hidden = !!r;
    MAPA.draw();
    if (!r) return;
    const v = r.variacao_db;
    $('#d-regiao').textContent = r.regiao;
    $('#d-var').textContent = db(v); $('#d-var').className = 'hero ' + cls(v);
    $('#d-sit').textContent = r.situacao; $('#d-sit').className = cls(v);
    $('#d-canal').textContent = r.canal === 'Todos' ? 'Média de ' + r.canais : r.canal;
    $('#d-ref').textContent = dbm(r.nivel_ref) + ' dBm'; $('#d-novo').textContent = dbm(r.nivel_novo) + ' dBm';
    $('#d-faixa').textContent = `${r.classe_ref} → ${r.classe_novo}`;
    $('#d-amostras').textContent = `${fi(r.amostras_ref)} em ${R0} · ${fi(r.amostras_novo)} em ${R1}`;
    $('#d-coord').textContent = `${f4(r.lat)}, ${f4(r.lon)}`;
    $('#d-link').href = gmaps(r.lat, r.lon);
    const cell = r.id.slice(r.id.indexOf('_'));
    $('#d-canais').replaceChildren(...['Todos', ...D.resumo.canais_comparados].map((c) => D.byId.get(c + cell)).filter(Boolean).map((q) => {
      const tr = el('tr'); tr.append(el('td', q.canal === 'Todos' ? 'Média' : q.canal), el('td', db(q.variacao_db), 'n ' + cls(q.variacao_db)), el('td', dbm(q.nivel_ref), 'n'), el('td', dbm(q.nivel_novo), 'n')); return tr;
    }));
  }

  // ------------------------------------------------------------ gráficos
  function axisStyle(g) { g.attr('font-size', null).attr('font-family', null); }
  function grafCanais() {
    const box = $('#g-canais'); box.replaceChildren();
    const rows = D.canais.map((r) => ({c: r.canal, a: r.mediana_ref, b: r.mediana_novo, d: r.variacao_db, p0: r.pct_bom_ref, p1: r.pct_bom_novo}));
    const W = box.clientWidth || 400, m = {t: 8, r: 70, b: 28, l: 44}, H = m.t + m.b + 46 * rows.length;
    const x = d3.scaleLinear([d3.min(rows, (r) => Math.min(r.a, r.b)) - 2, d3.max(rows, (r) => Math.max(r.a, r.b)) + 2], [m.l, W - m.r]).nice();
    const y = d3.scaleBand(rows.map((r) => r.c), [m.t, H - m.b]).padding(0.3);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const nt = Math.max(3, Math.floor(W / 90));
    svg.append('g').selectAll('line').data(x.ticks(nt)).join('line').attr('x1', x).attr('x2', x).attr('y1', m.t).attr('y2', H - m.b).attr('stroke', 'var(--grid)');
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(nt).tickFormat(dbm).tickSizeOuter(0)).call(axisStyle);
    const g = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', (r) => `translate(0,${y(r.c) + y.bandwidth() / 2})`);
    const col = (r) => (r.d >= LIM ? '#2a78d6' : r.d <= -LIM ? '#e34948' : 'var(--gray)');
    g.append('text').attr('x', m.l - 8).attr('dy', '0.35em').attr('text-anchor', 'end').text((r) => r.c);
    g.append('line').attr('x1', (r) => x(r.a)).attr('x2', (r) => x(r.b)).attr('stroke', 'var(--gray)').attr('stroke-width', 2).attr('stroke-linecap', 'round');
    g.append('circle').attr('cx', (r) => x(r.a)).attr('r', 5).attr('fill', 'var(--gray)').attr('stroke', 'var(--panel)').attr('stroke-width', 2);
    g.append('circle').attr('cx', (r) => x(r.b)).attr('r', 6).attr('fill', col).attr('stroke', 'var(--panel)').attr('stroke-width', 2);
    g.append('text').attr('x', (r) => x(Math.max(r.a, r.b)) + 10).attr('dy', '0.35em').text((r) => db(r.d));
    const t = tip(box);
    g.append('rect').attr('x', m.l).attr('width', W - m.l - m.r).attr('y', -y.bandwidth() / 2 - 4).attr('height', y.bandwidth() + 8).attr('fill', 'transparent')
      .on('pointermove', (ev, r) => { tipLines(t, `Canal ${r.c}`, [`${R0}: ${dbm(r.a)} dBm · ${fp(r.p0)} bom`, `${R1}: ${dbm(r.b)} dBm · ${fp(r.p1)} bom`, `Variação: ${db(r.d)}`]); t.hidden = false; const [px, py] = d3.pointer(ev, box); place(box, t, px, py); })
      .on('pointerleave', () => { t.hidden = true; });
  }
  function grafClasses() {
    const box = $('#g-classes'); box.replaceChildren();
    const keyOf = (r) => `${r.canal} ${r.campanha}`;
    const keys = Array.from(new Set(D.classes.map(keyOf))).sort();
    const by = d3.group(D.classes, keyOf);
    const W = box.clientWidth || 400, m = {t: 4, r: 24, b: 26, l: 76}, H = m.t + m.b + 34 * keys.length;
    const x = d3.scaleLinear([0, 1], [m.l, W - m.r]), y = d3.scaleBand(keys, [m.t, H - m.b]).padding(0.28);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4).tickFormat(L.format('.0%')).tickSizeOuter(0)).call(axisStyle);
    const t = tip(box);
    for (const k of keys) {
      const rows = by.get(k); let acc = 0; const gy = y(k);
      svg.append('text').attr('x', m.l - 8).attr('y', gy + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(k);
      for (const c of CLS) {
        const r = rows.find((q) => q.classe === c), v = r ? r.pct : 0, x0 = x(acc), x1 = x(acc + v); acc += v;
        svg.append('rect').attr('x', x0 + (x0 > m.l ? 1 : 0)).attr('y', gy).attr('width', Math.max(0, x1 - x0 - (x0 > m.l ? 1 : 0))).attr('height', y.bandwidth()).attr('fill', CLR[c])
          .on('pointermove', (ev) => { tipLines(t, k, CLS.map((q) => { const z = rows.find((w) => w.classe === q); return `${q}: ${fp(z ? z.pct : 0)}`; })); t.hidden = false; const [px, py] = d3.pointer(ev, box); place(box, t, px, py); })
          .on('pointerleave', () => { t.hidden = true; });
        if (x1 - x0 > 34) svg.append('text').attr('x', (x0 + x1) / 2).attr('y', gy + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'middle').attr('pointer-events', 'none').style('fill', c === 'Bom' || c === 'Sem sinal' ? '#fff' : '#1a1a19').text(L.format('.0%')(v));
      }
    }
  }

  // ------------------------------------------------------------ tabelas
  const mkRow = (cells, onClick) => { const tr = el('tr', null, 'go'); for (const [txt, c] of cells) tr.appendChild(el('td', txt, c)); tr.addEventListener('click', onClick); return tr; };
  function shortReg(tb, desc) {
    const rows = D.regioes.slice().sort((a, b) => (desc ? -1 : 1) * (a.variacao_db - b.variacao_db)).slice(0, 6);
    tb.replaceChildren(...rows.map((r) => mkRow([[r.regiao_unica], [db(r.variacao_db), 'n ' + cls(r.variacao_db)], [dbm(r.nivel_novo), 'n']], () => goMap(r.lat, r.lon, 5))));
  }
  function regRows() {
    const q = S.q.trim().toLowerCase(), {k, dir} = S.sort, num = typeof (D.regioes[0] || {})[k] === 'number';
    return D.regioes.filter((r) => !q || r.regiao_unica.toLowerCase().includes(q)).sort((a, b) => dir * (num ? a[k] - b[k] : String(a[k]).localeCompare(String(b[k]), 'pt-BR')));
  }
  function tabRegioes() {
    $('#t-reg tbody').replaceChildren(...regRows().map((r) => mkRow([[r.regiao_unica], [r.situacao, cls(r.variacao_db)], [db(r.variacao_db), 'n ' + cls(r.variacao_db)], [dbm(r.nivel_ref), 'n'], [dbm(r.nivel_novo), 'n'], [`${r.classe_ref} → ${r.classe_novo}`, 'hide-narrow'], [r.canais, 'hide-narrow']], () => goMap(r.lat, r.lon, 5))));
    document.querySelectorAll('#t-reg th').forEach((th) => { const b = th.querySelector('button'); th.setAttribute('aria-sort', b && b.dataset.sort === S.sort.k ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none'); });
  }
  const ocRows = () => D.areas.filter((r) => r.situacao === 'Piorou' && (!S.oc || r.canal === S.oc)).sort((a, b) => a.variacao_db - b.variacao_db);
  function tabOc() {
    $('#t-oc tbody').replaceChildren(...ocRows().map((r) => mkRow([[r.regiao], [r.canal === 'Todos' ? 'Média' : r.canal], [db(r.variacao_db), 'n down'], [dbm(r.nivel_ref), 'n'], [dbm(r.nivel_novo), 'n'], [`${r.classe_ref} → ${r.classe_novo}`, 'hide-narrow']], () => {
      S.canal = r.canal; $('#f-canal').value = r.canal; goMap(r.lat, r.lon, 9, r.id);
    })));
  }
  function baixarCSV(nome, rows, cols) {
    const esc = (v) => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const txt = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
    const a = el('a'); a.href = URL.createObjectURL(new Blob([txt], {type: 'text/csv;charset=utf-8'})); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------ controles
  $('#f-canal').addEventListener('change', (e) => {
    S.canal = e.target.value; const cur = S.sel && D.byId.get(S.sel);
    if (cur) { const nid = S.canal + cur.id.slice(cur.id.indexOf('_')); select(D.byId.has(nid) ? nid : null); } else MAPA.draw();
  });
  $('#f-sit').addEventListener('change', (e) => { S.sit = e.target.value; MAPA.draw(); });
  $('#f-fundo').addEventListener('change', (e) => { S.fundo = e.target.value; MAPA.draw(); });
  $('#busca').addEventListener('change', (e) => {
    const v = e.target.value.trim().toLowerCase(); const r = D.referencias.find((x) => x.local.toLowerCase() === v) || D.referencias.find((x) => x.local.toLowerCase().startsWith(v));
    if (r) MAPA.zoomTo(r.lon, r.lat, 6);
  });
  $('#z-in').addEventListener('click', () => MAPA.zoomBy(1.8));
  $('#z-out').addEventListener('click', () => MAPA.zoomBy(1 / 1.8));
  $('#z-reset').addEventListener('click', () => MAPA.reset());
  $('#q').addEventListener('input', (e) => { S.q = e.target.value; tabRegioes(); });
  $('#f-oc').addEventListener('change', (e) => { S.oc = e.target.value; tabOc(); });
  document.querySelectorAll('#t-reg th button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sort; S.sort = {k, dir: S.sort.k === k ? -S.sort.dir : (k === 'regiao_unica' || k === 'situacao' ? 1 : -1)}; tabRegioes();
  }));
  const COLS = ['id', 'canal', 'regiao', 'situacao', 'variacao_db', 'nivel_ref', 'nivel_novo', 'classe_ref', 'classe_novo', 'canais', 'amostras_ref', 'amostras_novo', 'lat', 'lon'];
  $('#csv-reg').addEventListener('click', () => baixarCSV('regioes.csv', regRows(), ['regiao_unica', ...COLS.slice(2)]));
  $('#csv-oc').addEventListener('click', () => baixarCSV('ocorrencias_piora.csv', ocRows(), COLS));
})();
