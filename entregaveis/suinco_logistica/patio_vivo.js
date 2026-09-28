/* =====================================================================
   PÁTIO AO VIVO (28/09/2026)
   ---------------------------------------------------------------------
   A tela de demonstração "Pátio ao vivo", agora lendo a operação.

   Pedido do dono, com as palavras dele: "cadê o pátio ao vivo? você não
   fez nada do pátio ao vivo até agora". A demonstração foi aprovada em
   24/09; o que subiu depois foi só o deslizar da Torre. Esta é a tela.

   O QUE ELA É: uma coluna por etapa, um cartão por caminhão (a rota
   grande, a praça, a carga, o tempo de pátio com o anel), e o cartão VOA
   para a coluna nova quando a etapa muda. Em cima, os fatos do dia; em
   baixo, o pátio ao longo do dia, o tempo médio por rota e o rádio — cada
   carimbo na hora em que aconteceu.

   O QUE ELA NÃO É: lugar de editar. É leitura, para qualquer setor. A
   Torre com as 12 colunas editáveis continua sendo onde se mexe.

   UMA VERDADE SÓ. O tempo de pátio é `tempoDePatioDe` (data.js), a mesma
   conta da Torre, dos Indicadores e dos relatórios; os gráficos são os do
   motor dos Indicadores (graficos2027.js); a gaveta é a mesma. Esta tela
   não faz conta própria de nada que já tenha dono.

   A META DE 3 HORAS: fora dos números, como o dono pediu para os
   indicadores ("esquece esse kpi de 3 horas por enquanto"). O anel do
   cartão continua ficando vermelho acima de 3 h — é o mesmo alerta de agir
   agora que a Visão do Pátio manteve por escolha dele.
   ===================================================================== */
const PV_ETAPAS = [
  { status:'Aguardando Veículo',  quem:'Portaria' },
  { status:'Aguardando Embarque', quem:'Expedição' },
  { status:'Embarque Iniciado',   quem:'Expedição' },
  { status:'Embarque Finalizado', quem:'Faturamento' },
  { status:'Faturado',            quem:'Portaria' },
  { status:'Seguiu Viagem',       quem:'' },
];
const PV_ALERTA = 120, PV_LIMITE = 180;     // minutos: anel âmbar, anel vermelho
const PV_SAIU_MAX = 12;                      // na coluna "Seguiu Viagem": as últimas de hoje
const _pv = { montado:false, cards:new Map(), listas:[], qtds:[], cols:[], relogio:null, radioVisto:new Set() };

function pvDur(min){
  if(min === null || min === undefined || isNaN(min)) return '—';
  if(min < 60) return Math.round(min) + ' min';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h + 'h' + String(m).padStart(2, '0');
}
function pvHoje(){ const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/* As cargas do quadro: tudo em aberto, e as que seguiram viagem HOJE. */
function pvCargasDoQuadro(){
  const hoje = pvHoje();
  const abertas = DB.cargas.filter(c => c.status !== 'Seguiu Viagem' && !c.aguardandoCarga);
  const saiu = DB.cargas.filter(c => {
    if(c.status !== 'Seguiu Viagem') return false;
    const s = primeiroTimestamp(c.id, 'Seguiu Viagem');
    return s && new Date(s) >= hoje;
  }).sort((a, b) => String(primeiroTimestamp(b.id, 'Seguiu Viagem')).localeCompare(String(primeiroTimestamp(a.id, 'Seguiu Viagem'))))
    .slice(0, PV_SAIU_MAX);
  return abertas.concat(saiu);
}

function pvEstado(c){
  const t = tempoDePatioDe(c);
  if(!t.entrada) return { sla:'previsto', min:null, pct:0 };
  const m = t.minutos;
  return { sla: m > PV_LIMITE ? 'critico' : m >= PV_ALERTA ? 'atencao' : 'ok', min:m,
           pct: Math.min(100, (m || 0) / PV_LIMITE * 100), fim: !t.emAndamento };
}

function pvMontar(){
  const pista = document.getElementById('pv-pista');
  if(!pista) return false;
  if(_pv.montado && pista.childElementCount) return true;
  pista.innerHTML = '';
  _pv.listas = []; _pv.qtds = []; _pv.cols = []; _pv.cards.clear();
  PV_ETAPAS.forEach((e, i) => {
    const col = document.createElement('section');
    col.className = 'pv-col vazia'; col.setAttribute('aria-label', e.status);
    col.innerHTML = `<header class="pv-col-cab"><span class="pv-col-num" aria-hidden="true">${i + 1}</span>`
      + `<h3>${esc(e.status)}</h3><span class="pv-col-qtd">0</span>`
      + `<p class="pv-col-quem">${e.quem ? 'Próximo passo: ' + esc(e.quem) : 'Saíram do pátio hoje'}</p></header>`
      + `<div class="pv-col-lista"></div>`
      + `<p class="pv-col-vazio">${i === 5 ? 'Ninguém seguiu viagem ainda hoje.' : 'Nenhum caminhão nesta etapa.'}</p>`;
    pista.appendChild(col);
    _pv.cols.push(col); _pv.listas.push(col.querySelector('.pv-col-lista')); _pv.qtds.push(col.querySelector('.pv-col-qtd'));
  });
  _pv.montado = true;
  return true;
}

function pvCriarCard(c){
  const el = document.createElement('button');
  el.type = 'button'; el.className = 'pv-card'; el.dataset.id = c.id;
  el.innerHTML = `<span class="pv-rota"></span>`
    + `<svg class="pv-anel" viewBox="0 0 36 36" aria-hidden="true"><circle class="a-fundo" cx="18" cy="18" r="15" pathLength="100"/>`
    + `<circle class="a-prog" cx="18" cy="18" r="15" pathLength="100"/></svg>`
    + `<span class="pv-praca"></span>`
    + `<span class="pv-rod"><span class="pv-carga"></span><span class="pv-selo">3h+</span><span class="pv-tempo"></span></span>`;
  el.addEventListener('click', () => pvAbrirCarga(c.id, el));
  return el;
}

/* O conteúdo do cartão, só onde mudou — texto igual não é regravado. */
function pvPreencher(el, c){
  const rota = String(c.rota || '—');
  const praca = destinoDaCarga(c) || ((rotaInfo(c.rota) || {}).nome) || '';
  const carga = 'Carga ' + (c.numeroCarga || '—');
  const e = pvEstado(c);
  const tempo = e.min === null ? 'programada' : pvDur(e.min);
  const campos = [['.pv-rota', rota], ['.pv-praca', praca], ['.pv-carga', carga], ['.pv-tempo', tempo]];
  campos.forEach(([s, v]) => { const n = el.querySelector(s); if(n.textContent !== v) n.textContent = v; });
  const p = String(100 - Math.round(e.pct * 10) / 10);
  const anel = el.querySelector('.a-prog');
  if(anel.style.strokeDashoffset !== p) anel.style.strokeDashoffset = p;
  const antes = el.dataset.sla;
  if(antes !== e.sla){
    el.dataset.sla = e.sla;
    if(antes && e.sla === 'critico' && !movReduzida()){
      el.classList.remove('alarme'); void el.offsetWidth; el.classList.add('alarme');
      el.addEventListener('animationend', () => el.classList.remove('alarme'), { once:true });
    }
  }
  el.dataset.fim = c.status === 'Seguiu Viagem' ? '1' : '';
  el.setAttribute('aria-label', `Carga ${c.numeroCarga || ''}, rota ${rota} ${praca}, ${c.status}, `
    + (e.min === null ? 'caminhão ainda não chegou' : pvDur(e.min) + ' de pátio'));
}

/* O VOO (FLIP), a mesma peça da demonstração: mede onde o cartão está NA
   TELA — inclusive no meio de um voo — e anima dali até o lugar novo. */
function pvVoar(el, dx, dy){
  if(el._voo) el._voo.cancel();
  if(movReduzida()){ el._voo = el.animate([{ opacity:.35 }, { opacity:1 }], { duration:180, easing:'ease-out' }); return; }
  if(Math.abs(dx) > 24){
    el.classList.add('voando');
    el._voo = el.animate([
      { transform:`translate(${dx}px, ${dy}px) scale(1)` },
      { transform:`translate(${dx * .65}px, ${dy * .65}px) scale(1.045)`, offset:.35 },
      { transform:'translate(0, 0) scale(1)' }
    ], { duration:620, easing:'cubic-bezier(.77,0,.175,1)' });
    const pousou = () => el.classList.remove('voando');
    el._voo.onfinish = pousou; el._voo.oncancel = pousou;
  } else {
    el._voo = el.animate([{ transform:`translate(${dx}px, ${dy}px)` }, { transform:'none' }],
      { duration:320, easing:'cubic-bezier(.23,1,.32,1)' });
  }
}

function pvSincronizarPista(){
  if(!pvMontar()) return;
  const pista = document.getElementById('pv-pista');
  const visivel = pista.getClientRects().length > 0;
  const antes = new Map();
  if(visivel) _pv.cards.forEach((el, id) => antes.set(id, el.getBoundingClientRect()));
  const porEtapa = PV_ETAPAS.map(() => []);
  pvCargasDoQuadro().forEach(c => {
    const i = PV_ETAPAS.findIndex(e => e.status === c.status);
    if(i >= 0) porEtapa[i].push(c);
  });
  const vivos = new Set(), novos = [];
  porEtapa.forEach((lista, i) => {
    /* Dentro da etapa, quem chegou primeiro fica em cima: é quem está
       esperando há mais tempo. Sem chegada, pela sequência do dia. */
    lista.sort((a, b) => {
      const ea = entradaNoPatioDe(a) || '', eb = entradaNoPatioDe(b) || '';
      if(ea !== eb) return ea && eb ? ea.localeCompare(eb) : (ea ? -1 : 1);
      return ordenarPorSequenciaEAtualizacao(a, b);
    });
    const cont = _pv.listas[i];
    let ref = cont.firstElementChild;
    for(const c of lista){
      vivos.add(c.id);
      let el = _pv.cards.get(c.id);
      if(!el){ el = pvCriarCard(c); _pv.cards.set(c.id, el); novos.push(el); }
      pvPreencher(el, c);
      while(ref && ref.classList.contains('saindo')) ref = ref.nextElementSibling;
      if(ref === el) ref = ref.nextElementSibling;
      else cont.insertBefore(el, ref);
    }
    const n = String(lista.length);
    if(_pv.qtds[i].textContent !== n) _pv.qtds[i].textContent = n;
    _pv.cols[i].classList.toggle('vazia', !lista.length);
  });
  // Quem não está mais no quadro sai (excluída, ou saída de outro dia).
  _pv.cards.forEach((el, id) => {
    if(vivos.has(id)) return;
    _pv.cards.delete(id);
    if(!visivel || movReduzida()){ el.remove(); return; }
    el.classList.add('saindo');
    const a = el.animate([{ opacity:1, transform:'none' }, { opacity:0, transform:'translateX(28px)' }],
      { duration:260, easing:'cubic-bezier(.23,1,.32,1)', fill:'forwards' });
    a.onfinish = () => el.remove();
  });
  if(!visivel) return;
  _pv.cards.forEach((el, id) => {
    const r0 = antes.get(id); if(!r0) return;
    const r1 = el.getBoundingClientRect();
    const dx = r0.left - r1.left, dy = r0.top - r1.top;
    if(Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
    pvVoar(el, dx, dy);
  });
  if(antes.size && !movReduzida()){
    novos.forEach(el => el.animate([
      { opacity:0, transform:'translateY(-10px) scale(.97)', filter:'blur(4px)' },
      { opacity:1, transform:'none', filter:'blur(0)' }
    ], { duration:320, easing:'cubic-bezier(.23,1,.32,1)' }));
  }
}

/* Os fatos do topo. Números que mudam rolam (Graf.rolar, o odômetro dos
   Indicadores); null não é zero — sem saída hoje, a média é traço. */
function pvFatos(){
  const hoje = pvHoje();
  const noPatio = DB.cargas.filter(c => ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado'].includes(c.status));
  const acima = noPatio.filter(c => { const m = tempoDePatioDe(c).minutos; return m !== null && m > PV_LIMITE; }).length;
  const saidas = DB.cargas.filter(c => { const s = primeiroTimestamp(c.id, 'Seguiu Viagem'); return s && new Date(s) >= hoje; });
  const tempos = saidas.map(c => tempoDePatioDe(c)).filter(t => t.minutos !== null && !t.suspeito).map(t => t.minutos);
  const media = tempos.length ? tempos.reduce((s, v) => s + v, 0) / tempos.length : null;
  const programadas = DB.cargas.filter(c => c.status === 'Aguardando Veículo' && !c.aguardandoCarga).length;
  const pon = (id, v) => { const el = document.getElementById(id); if(el) Graf.rolar(el, v); };
  pon('pv-k-patio', String(noPatio.length));
  pon('pv-k-media', media === null ? '—' : pvDur(media));
  pon('pv-k-saiu', String(saidas.length));
  pon('pv-k-prog', String(programadas));
  const sub = document.getElementById('pv-k-patio-sub');
  if(sub){
    const t = acima ? (acima === 1 ? '1 parado há mais de 3 horas' : acima + ' parados há mais de 3 horas') : 'nenhum parado há mais de 3 horas';
    if(sub.textContent !== t){ sub.textContent = t; sub.dataset.tom = acima ? 'critico' : 'ok'; }
  }
}

/* O pátio ao longo do dia: quantos caminhões estavam dentro em cada hora,
   da primeira chegada de hoje até agora. */
function pvGrafico(){
  const alvo = document.getElementById('pv-grafico');
  if(!alvo) return;
  const hoje = pvHoje(), agora = new Date();
  const periodos = DB.cargas.map(c => {
    const t = tempoDePatioDe(c);
    if(!t.entrada || !t.entradaPlausivel) return null;
    return { ini:new Date(t.entrada), fim: t.saida ? new Date(t.saida) : agora };
  }).filter(p => p && p.fim >= hoje);
  const pontos = [];
  for(let h = 5; h <= agora.getHours(); h++){
    const t = new Date(hoje); t.setHours(h, 0, 0, 0);
    if(t > agora) break;
    const fimDaHora = new Date(t); fimDaHora.setHours(h + 1);
    const n = periodos.filter(p => p.ini < fimDaHora && p.fim >= t).length;
    pontos.push({ rotulo: String(h).padStart(2, '0') + 'h', valor:n });
  }
  Graf.area(alvo, { pontos, rotulo:'caminhões no pátio por hora, hoje',
    formato: v => Math.round(v) + (Math.round(v) === 1 ? ' caminhão' : ' caminhões') });
}

/* Tempo médio de pátio por rota — só as cargas que já saíram hoje. */
function pvRanking(){
  const alvo = document.getElementById('pv-rank');
  if(!alvo) return;
  const hoje = pvHoje(), m = new Map();
  DB.cargas.forEach(c => {
    const t = tempoDePatioDe(c);
    if(!t.saida || new Date(t.saida) < hoje || t.minutos === null || t.suspeito) return;
    const k = String(c.rota || '—') + (rotaInfo(c.rota) ? ' ' + rotaInfo(c.rota).nome : '');
    const a = m.get(k) || { rotulo:k, soma:0, n:0 };
    a.soma += t.minutos; a.n++; m.set(k, a);
  });
  const itens = [...m.values()].map(a => ({ rotulo:a.rotulo, valor:a.soma / a.n, n:a.n }))
    .sort((a, b) => b.valor - a.valor);
  Graf.ranking(alvo, { itens, formato: pvDur, rotulo:'tempo médio de pátio por rota, hoje' });
}

/* O rádio: cada carimbo de hoje, o mais novo em cima. */
function pvRadio(){
  const ol = document.getElementById('pv-radio');
  if(!ol) return;
  const hoje = pvHoje();
  const verbo = { 'Aguardando Veículo':'programou', 'Aguardando Embarque':'liberou a entrada da',
    'Embarque Iniciado':'iniciou o embarque da', 'Embarque Finalizado':'finalizou o embarque da',
    'Faturado':'faturou a', 'Seguiu Viagem':'liberou a saída da' };
  const itens = (DB.movimentacoes || []).filter(m => m.timestamp && new Date(m.timestamp) >= hoje)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 8);
  const vazio = document.getElementById('pv-radio-vazio');
  if(vazio) vazio.hidden = itens.length > 0;
  const html = itens.map(m => {
    const c = DB.cargas.find(x => x.id === m.cargaId) || {};
    const novo = !_pv.radioVisto.has(m.id) && _pv.radioVisto.size ? ' class="novo"' : '';
    return `<li${novo} data-id="${esc(m.id)}"><time>${esc(horaCurta(m.timestamp))}</time><span>A ${esc(m.setor || '—')} `
      + `${esc(verbo[m.statusNovo] || 'moveu a')} carga <b>${esc(c.numeroCarga || m.placa || '—')}</b>`
      + `${c.rota ? ', rota ' + esc(c.rota) : ''}.</span></li>`;
  }).join('');
  if(ol._html !== html){ ol._html = html; ol.innerHTML = html; }
  itens.forEach(m => _pv.radioVisto.add(m.id));
}

/* Tocar no cartão abre a carga na gaveta dos Indicadores: a linha do tempo
   das seis etapas, com hora de cada carimbo. */
function pvAbrirCarga(id, origem){
  const c = DB.cargas.find(x => x.id === id);
  if(!c) return;
  const e = pvEstado(c);
  const passos = PV_ETAPAS.map(et => {
    const ts = primeiroTimestamp(c.id, et.status);
    return `<li class="gv-carga"><div class="gv-carga-topo"><b>${esc(et.status)}</b>`
      + `<span class="gv-carga-tempo">${ts ? esc(horaCurta(ts)) : '—'}</span></div></li>`;
  }).join('');
  Graf.abrirGaveta({ chave:'patio|' + id, olho:'Carga ' + (c.numeroCarga || '—'),
    titulo: (c.rota || '—') + ' ' + (destinoDaCarga(c) || ((rotaInfo(c.rota) || {}).nome) || ''),
    sub: [c.placa, c.transportadora, c.motorista].filter(Boolean).join(' · ')
      + (e.min === null ? '' : ' · ' + pvDur(e.min) + ' de pátio'),
    html: `<ol class="gv-lista">${passos}</ol>`, origem });
}

function renderPatioVivo(){
  if(!document.getElementById('tab-patio')) return;
  pvSincronizarPista();
  pvFatos();
  pvGrafico();
  pvRanking();
  pvRadio();
  const rel = document.getElementById('pv-relogio');
  if(rel) rel.textContent = 'agora · ' + horaCurta();
  /* O tempo anda sozinho enquanto a aba está aberta: o anel e o "há
     quanto tempo" não podem esperar a próxima sincronia para mudar. */
  if(!_pv.relogio){
    _pv.relogio = setInterval(() => {
      if(typeof TAB_ATUAL !== 'undefined' && TAB_ATUAL === 'patio' && !document.hidden) renderPatioVivo();
    }, 30000);
  }
}
