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

/* =====================================================================
   PARADO ALÉM DO NORMAL, E PASSADA NA FILA (30/09/2026)
   ---------------------------------------------------------------------
   Pedido do dono: o Pátio ao vivo "mais dinâmico", "algo lógico inteligente
   logístico". Das oito ideias, a #2 e a #5, com as respostas dele
   ("pergunta 1 B, pergunta 2 A").

   #2 — O NORMAL DE CADA ETAPA vem da própria operação: quanto tempo cada
   passagem pela etapa levou (da entrada nela até o carimbo seguinte, na
   trilha de movimentações), nos últimos JANELA_LOCAL_DIAS dias. "Além do
   normal" é passar do que 9 em cada 10 caminhões levaram ali — o percentil
   90, de posto mais próximo (resposta 1-B). Com menos de PV_AMOSTRA_MIN
   passagens, o cartão diz "sem histórico suficiente" e não marca nada:
   comparar com três casos é chute, e chute não acende alerta.

   #5 — NÃO EXISTE HORA PREVISTA DE CHEGADA na carga; existe a sequência do
   dia (resposta 2-A). A carga em Aguardando Veículo "foi passada" quando
   cargas do MESMO dia — o dia da programação, a mesma regra da fila do
   servidor — com sequência MAIOR já entraram no pátio. Sem sequência, não
   se compara.

   Só leitura, como o resto da tela. O tempo de pátio do cartão continua
   sendo tempoDePatioDe; isto é o tempo NA ETAPA, outra pergunta.
   ===================================================================== */
const PV_ETAPAS_DO_PATIO = ['Aguardando Embarque', 'Embarque Iniciado', 'Embarque Finalizado', 'Faturado'];
const PV_AMOSTRA_MIN = 10;   // passagens na janela abaixo das quais não se compara (aprovado na proposta de 30/09)

/* Percentil de posto mais próximo: q = 0,9 é "9 em 10 levaram até aqui";
   q = 0,5 é a mediana, o tempo típico. */
function pvPercentil(v, q){
  const s = v.slice().sort((a, b) => a - b);
  return s[Math.ceil(q * s.length) - 1];
}

/* Quanto tempo cada etapa costuma levar: { status -> { p90, n } }. Uma
   passagem vai da primeira movimentação para a etapa até a primeira
   movimentação para OUTRA etapa — carimbo repetido não é saída. A
   passagem ainda aberta (o caminhão está lá agora) não entra. */
/* As passagens de UMA carga pelas etapas, a partir da trilha já em ordem:
   { status, ini, fim (null se ainda está nela), mov (o carimbo da entrada) }.
   Carimbo repetido não abre passagem nova. Uma função, três chamadores: o
   normal das etapas, a linha do tempo do cartão aberto e o rádio. */
function pvPassagensDaTrilha(lista){
  const out = [];
  let i = 0;
  while(i < lista.length){
    let j = i + 1;
    while(j < lista.length && lista[j].statusNovo === lista[i].statusNovo) j++;
    out.push({ status: lista[i].statusNovo, ini: lista[i].timestamp,
               fim: j < lista.length ? lista[j].timestamp : null, mov: lista[i] });
    i = j;
  }
  return out;
}
function pvMinutosDaPassagem(p, ate){
  const t0 = Date.parse(p.ini), t1 = Date.parse(p.fim || ate || '');
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0 ? (t1 - t0) / 60000 : null;
}

function pvNormalDasEtapas(){
  const desde = Date.now() - JANELA_LOCAL_DIAS * 86400000;
  const dur = new Map();
  indiceMovimentacoes().forEach(lista => {
    pvPassagensDaTrilha(lista).forEach(p => {
      if(!p.fim || !(Date.parse(p.ini) >= desde)) return;
      const m = pvMinutosDaPassagem(p);
      if(m === null) return;
      if(!dur.has(p.status)) dur.set(p.status, []);
      dur.get(p.status).push(m);
    });
  });
  const out = new Map();
  dur.forEach((v, k) => {
    const basta = v.length >= PV_AMOSTRA_MIN;
    out.set(k, { p90: basta ? pvPercentil(v, 0.9) : null, p50: basta ? pvPercentil(v, 0.5) : null, n: v.length });
  });
  return out;
}

/* Quando a carga entrou na etapa em que está: a última vez que ela chegou
   nessa etapa (voltar etapa e retornar conta do retorno). */
function pvEntradaNaEtapa(c){
  const h = historicoDaCarga(c.id);
  let i = h.length - 1;
  while(i >= 0 && h[i].statusNovo !== c.status) i--;
  if(i < 0) return null;
  while(i > 0 && h[i - 1].statusNovo === c.status) i--;
  return h[i].timestamp;
}

function pvDiaDaFila(c){
  const base = c.programadoEm || c.criadoEm;
  const d = base ? new Date(base) : null;
  return d && !isNaN(d) ? isoDiaLocal(d) : null;
}

/* Quantas cargas do mesmo dia, com sequência maior, já entraram na frente
   de cada programada que ainda espera o caminhão: { id -> n }. */
function pvPassadasNaFila(){
  const entraram = new Map();   // dia -> [sequências que já entraram]
  DB.cargas.forEach(y => {
    if(y.aguardandoCarga || y.sequencia === null || y.sequencia === undefined || !entradaNoPatioDe(y)) return;
    const dia = pvDiaDaFila(y);
    if(!dia) return;
    if(!entraram.has(dia)) entraram.set(dia, []);
    entraram.get(dia).push(Number(y.sequencia));
  });
  const out = new Map();
  DB.cargas.forEach(c => {
    if(c.status !== 'Aguardando Veículo' || c.aguardandoCarga || c.sequencia === null || c.sequencia === undefined) return;
    const n = (entraram.get(pvDiaDaFila(c)) || []).filter(s => s > Number(c.sequencia)).length;
    if(n) out.set(c.id, n);
  });
  return out;
}

/* =====================================================================
   PREVISÃO DE SAÍDA E GARGALO AGORA (30/09/2026)
   ---------------------------------------------------------------------
   As ideias #1 e #3, com as respostas do dono: "pergunta 1 a pergunta 2 a".

   #1 — A PREVISÃO usa o tempo TÍPICO (resposta 1-A): a mediana de cada
   etapa nos últimos 30 dias, a mesma base do "normal da etapa". O que falta
   da etapa atual é a mediana dela menos o tempo já passado — se já passou da
   mediana, falta zero —, somado à mediana de cada etapa seguinte até a
   saída. Sai em múltiplos de PV_ARREDONDA_MIN minutos: é "por volta de", e
   um minuto exato prometeria uma precisão que a média não tem. Se alguma
   etapa que falta tem menos de PV_AMOSTRA_MIN passagens, não há previsão.

   #3 — O GARGALO é a etapa com MAIS caminhões além do normal (resposta
   2-A); empate, a que tem mais caminhões; empate de novo, a que vem primeiro
   no fluxo. Ninguém além do normal: sem gargalo.
   ===================================================================== */
const PV_ARREDONDA_MIN = 5;

function pvPrevisaoDeSaida(c, ctx){
  const i = PV_ETAPAS_DO_PATIO.indexOf(c.status);
  if(i < 0) return null;
  const ent = pvEntradaNaEtapa(c);
  const t0 = ent ? Date.parse(ent) : NaN;
  if(!Number.isFinite(t0)) return null;
  const medianas = PV_ETAPAS_DO_PATIO.slice(i).map(st => (ctx.normal.get(st) || {}).p50);
  if(medianas.some(m => m === null || m === undefined)) return null;
  let t = Math.max(t0 + medianas[0] * 60000, Date.now());
  medianas.slice(1).forEach(m => { t += m * 60000; });
  const passo = PV_ARREDONDA_MIN * 60000;
  return new Date(Math.round(t / passo) * passo);
}

function pvTextoDaPrevisao(d){
  if(!d) return '';
  const hoje = pvHoje(), amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
  const hm = String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');
  return 'sai por volta de ' + (d >= amanha ? 'amanhã, ' : '') + hm;
}

function pvGargalo(porEtapa){
  let melhor = null;
  PV_ETAPAS_DO_PATIO.forEach(st => {
    const i = PV_ETAPAS.findIndex(e => e.status === st);
    const lista = porEtapa[i] || [];
    const parados = lista.filter(c => { const el = _pv.cards.get(c.id); return el && el.dataset.parado; }).length;
    if(!parados) return;
    if(!melhor || parados > melhor.parados || (parados === melhor.parados && lista.length > melhor.total)){
      melhor = { status: st, indice: i, parados, total: lista.length };
    }
  });
  return melhor;
}

function pvMostrarGargalo(g){
  const el = document.getElementById('pv-gargalo');
  _pv.cols.forEach((col, i) => col.classList.toggle('gargalo', !!g && g.indice === i));
  if(!el) return;
  const texto = g
    ? `Gargalo agora: ${g.status} — ${g.total} ${g.total === 1 ? 'caminhão' : 'caminhões'}, ${g.parados} além do normal`
    : 'Sem gargalo agora — nenhuma etapa com caminhão além do normal';
  if(el.textContent !== texto){ el.textContent = texto; el.dataset.tom = g ? 'atencao' : 'ok'; }
}

/* =====================================================================
   PRÓXIMO A CARREGAR E SAÍDAS PREVISTAS (01/10/2026)
   ---------------------------------------------------------------------
   As ideias #4 e #6, com as respostas do dono: "pergunta 1 a pergunta b a".

   #4 — PRÓXIMO A CARREGAR pela SEQUÊNCIA DO DIA (resposta 1-A): entre os
   caminhões em Aguardando Embarque — os que já chegaram; quem não chegou
   está em Aguardando Veículo e não entra —, o do dia de programação mais
   antigo (pvDiaDaFila, a regra de dia da fila do servidor) e, dentro dele,
   o de menor sequência. Sem sequência não se compara; ninguém com
   sequência, ninguém marcado. Uma marca só.

   #6 — SAÍDAS PREVISTAS (resposta 2-A): não existe hora prevista de
   CHEGADA, então a conta é só de quem já está no pátio, pela MESMA
   pvPrevisaoDeSaida do cartão. Janelas de PV_JANELA_SAIDA_MIN a partir de
   agora; quem não tem previsão é contado à parte, nunca como zero.
   ===================================================================== */
const PV_JANELA_SAIDA_MIN = 60;
const PV_JANELAS_SAIDA = ['próxima hora', 'de 1 a 2 h', 'de 2 a 3 h'];

function pvProximoACarregar(porEtapa){
  const i = PV_ETAPAS.findIndex(e => e.status === 'Aguardando Embarque');
  let melhor = null, diaMelhor = null;
  (porEtapa[i] || []).forEach(c => {
    if(c.sequencia === null || c.sequencia === undefined || c.sequencia === '' || !Number.isFinite(Number(c.sequencia))) return;
    const dia = pvDiaDaFila(c) || '';
    if(!melhor || dia < diaMelhor || (dia === diaMelhor && ordenarPorSequenciaEAtualizacao(c, melhor) < 0)){
      melhor = c; diaMelhor = dia;
    }
  });
  return melhor ? melhor.id : null;
}

function pvSaidasPrevistas(porEtapa, ctx){
  const janelas = PV_JANELAS_SAIDA.map(() => 0);
  let depois = 0, semPrevisao = 0, total = 0;
  const agora = Date.now();
  PV_ETAPAS_DO_PATIO.forEach(st => {
    const i = PV_ETAPAS.findIndex(e => e.status === st);
    (porEtapa[i] || []).forEach(c => {
      total++;
      const d = pvPrevisaoDeSaida(c, ctx);
      if(!d){ semPrevisao++; return; }
      const k = Math.floor(Math.max(0, d.getTime() - agora) / (PV_JANELA_SAIDA_MIN * 60000));
      if(k < janelas.length) janelas[k]++; else depois++;
    });
  });
  return { janelas, depois, semPrevisao, total };
}

function pvTextoDasSaidas(s){
  if(!s.total) return 'Saídas previstas — nenhum caminhão no pátio agora';
  if(s.semPrevisao === s.total){
    return 'Saídas previstas — sem histórico suficiente para prever ' + (s.total === 1 ? 'o 1 no pátio' : 'os ' + s.total + ' no pátio');
  }
  const partes = PV_JANELAS_SAIDA.map((rot, k) => rot + ': ' + s.janelas[k]);
  if(s.depois) partes.push('depois de 3 h: ' + s.depois);
  if(s.semPrevisao) partes.push('sem previsão: ' + s.semPrevisao);
  return 'Saídas previstas — ' + partes.join(' · ');
}

function pvMostrarSaidas(s){
  const el = document.getElementById('pv-saidas');
  if(!el) return;
  const texto = pvTextoDasSaidas(s);
  if(el.textContent !== texto) el.textContent = texto;
}

/* A linha de baixo do cartão: o tempo na etapa, ou a fila que passou. */
function pvNotaDoCartao(c, ctx){
  if(PV_ETAPAS_DO_PATIO.includes(c.status)){
    const ent = pvEntradaNaEtapa(c);
    if(!ent) return { texto:'' };
    const m = minutosEntre(ent, new Date().toISOString());
    if(m === null || m < 0) return { texto:'' };
    const norm = ctx.normal.get(c.status);
    if(!norm || norm.p90 === null) return { texto: pvDur(m) + ' nesta etapa · sem histórico suficiente' };
    if(m > norm.p90) return { texto: pvDur(m) + ' nesta etapa · 9 em 10 saem em até ' + pvDur(norm.p90), parado:true };
    return { texto: pvDur(m) + ' nesta etapa' };
  }
  if(c.status === 'Aguardando Veículo'){
    const n = ctx.passadas.get(c.id) || 0;
    if(n) return { texto: n === 1 ? '1 da fila já entrou na frente' : n + ' da fila já entraram na frente', passada:n };
  }
  return { texto:'' };
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
  el.innerHTML = `<span class="pv-proximo"></span><span class="pv-rota"></span>`
    + `<svg class="pv-anel" viewBox="0 0 36 36" aria-hidden="true"><circle class="a-fundo" cx="18" cy="18" r="15" pathLength="100"/>`
    + `<circle class="a-prog" cx="18" cy="18" r="15" pathLength="100"/></svg>`
    + `<span class="pv-praca"></span>`
    + `<span class="pv-rod"><span class="pv-carga"></span><span class="pv-selo">3h+</span><span class="pv-tempo"></span></span>`
    + `<span class="pv-nota"></span>`
    + `<span class="pv-previsao"></span>`;
  el.addEventListener('click', () => pvAbrirCarga(c.id, el));
  return el;
}

/* O conteúdo do cartão, só onde mudou — texto igual não é regravado. */
function pvPreencher(el, c, ctx){
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
  const nota = ctx ? pvNotaDoCartao(c, ctx) : { texto:'' };
  const nNota = el.querySelector('.pv-nota');
  if(nNota.textContent !== nota.texto) nNota.textContent = nota.texto;
  if(nota.parado) el.dataset.parado = '1'; else delete el.dataset.parado;
  if(nota.passada) el.dataset.passada = String(nota.passada); else delete el.dataset.passada;
  const proximo = !!ctx && ctx.proximo === c.id;
  const nProx = el.querySelector('.pv-proximo');
  const tProx = proximo ? 'próximo a carregar' : '';
  if(nProx.textContent !== tProx) nProx.textContent = tProx;
  if(proximo) el.dataset.proximo = '1'; else delete el.dataset.proximo;
  const previsao = ctx ? pvTextoDaPrevisao(pvPrevisaoDeSaida(c, ctx)) : '';
  const nPrev = el.querySelector('.pv-previsao');
  if(nPrev.textContent !== previsao) nPrev.textContent = previsao;
  el.setAttribute('aria-label', (proximo ? 'Próximo a carregar: ' : '') + `Carga ${c.numeroCarga || ''}, rota ${rota} ${praca}, ${c.status}, `
    + (e.min === null ? 'caminhão ainda não chegou' : pvDur(e.min) + ' de pátio')
    + (nota.texto ? ', ' + nota.texto : '')
    + (previsao ? ', ' + previsao : ''));
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
  const ctx = { normal: pvNormalDasEtapas(), passadas: pvPassadasNaFila() };
  ctx.proximo = pvProximoACarregar(porEtapa);
  let parados = 0;
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
      pvPreencher(el, c, ctx);
      if(el.dataset.parado) parados++;
      while(ref && ref.classList.contains('saindo')) ref = ref.nextElementSibling;
      if(ref === el) ref = ref.nextElementSibling;
      else cont.insertBefore(el, ref);
    }
    const n = String(lista.length);
    if(_pv.qtds[i].textContent !== n) _pv.qtds[i].textContent = n;
    _pv.cols[i].classList.toggle('vazia', !lista.length);
  });
  pvMostrarGargalo(pvGargalo(porEtapa));
  pvMostrarSaidas(pvSaidasPrevistas(porEtapa, ctx));
  pvFatoSub('pv-k-parado-sub', parados === 0 ? 'nenhum além do normal da etapa'
    : parados + ' além do normal da etapa', parados ? 'atencao' : 'ok');
  const passadas = ctx.passadas.size;
  pvFatoSub('pv-k-prog-sub', passadas === 0 ? 'nenhuma passada na fila'
    : passadas === 1 ? '1 passada na fila' : passadas + ' passadas na fila', passadas ? 'atencao' : 'ok');
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

function pvFatoSub(id, texto, tom){
  const el = document.getElementById(id);
  if(el && el.textContent !== texto){ el.textContent = texto; el.dataset.tom = tom; }
}

/* Os fatos do topo. Números que mudam rolam (Graf.rolar, o odômetro dos
   Indicadores); null não é zero — sem saída hoje, a média é traço. */
function pvFatos(){
  const hoje = pvHoje();
  // a mesma conta do gráfico, no instante de agora
  const agoraFato = new Date();
  const noPatio = DB.cargas.filter(c => pvNoPatioEm(c, agoraFato));
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

/* NO PÁTIO NUM INSTANTE — UMA CONTA SÓ (30/09/2026).
   Relato do dono: "às 14h tem 27 caminhões no pátio... só estão no pátio os
   Aguardando Embarque até o Faturado; o resto, Aguardando Veículo e Seguiu
   Viagem, não conta como NO PÁTIO".

   O gráfico contava quem TOCOU o pátio em qualquer momento da hora, pelo
   período "entrada → saída" do tempo de pátio: quem chegou às 14h30 e saiu
   às 14h50 contava "às 14h"; Seguiu Viagem sem o carimbo da saída e quem
   voltou para Aguardando Veículo ficavam "no pátio" até agora. E o último
   ponto não batia com "caminhões no pátio agora", do topo.

   Agora: a etapa da carga NAQUELE instante, pela trilha de movimentações —
   no pátio é Aguardando Embarque até Faturado (PV_ETAPAS_DO_PATIO). Depois
   da última movimentação vale a etapa atual da carga, que é a que o topo
   conta. A chegada sem programação (aguardandoCarga) nasce no pátio, no
   instante em que foi registrada. */
function pvNoPatioEm(c, instante){
  const t = instante.getTime();
  const h = historicoDaCarga(c.id);
  let ultima = null;
  for(const m of h){ const tm = Date.parse(m.timestamp); if(Number.isFinite(tm) && tm <= t) ultima = m; else break; }
  // no instante do último carimbo vale a etapa dele; só DEPOIS vale a etapa atual
  const depoisDaUltima = !h.length || (ultima && ultima === h[h.length - 1] && Date.parse(ultima.timestamp) < t);
  if(depoisDaUltima){
    if(!h.length){
      const nasceu = Date.parse(c.criadoEm || '');
      if(!(c.aguardandoCarga && Number.isFinite(nasceu) && nasceu <= t)) return false;
    }
    return PV_ETAPAS_DO_PATIO.includes(c.status);
  }
  if(ultima) return PV_ETAPAS_DO_PATIO.includes(ultima.statusNovo);
  // antes da primeira movimentação: só a chegada sem programação já estava lá
  const nasceu = Date.parse(c.criadoEm || '');
  return !!c.aguardandoCarga && Number.isFinite(nasceu) && nasceu <= t;
}

/* O pátio ao longo do dia: quantos caminhões estavam no pátio em cada hora
   cheia de hoje, e o último ponto é AGORA — o mesmo número do topo. */
function pvGrafico(){
  const alvo = document.getElementById('pv-grafico');
  if(!alvo) return;
  const hoje = pvHoje(), agora = new Date();
  const conta = (instante) => DB.cargas.filter(c => pvNoPatioEm(c, instante)).length;
  const pontos = [];
  for(let h = 5; h <= agora.getHours(); h++){
    const t = new Date(hoje); t.setHours(h, 0, 0, 0);
    if(t >= agora) break;
    pontos.push({ rotulo: String(h).padStart(2, '0') + 'h', valor: conta(t) });
  }
  pontos.push({ rotulo: 'agora', valor: conta(agora) });
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

/* =====================================================================
   O CARTÃO ABERTO E O RÁDIO CONTAM A HISTÓRIA (30/09/2026)
   ---------------------------------------------------------------------
   Pedido do dono: "melhore a qualidade das informações que aparecem quando
   eu clico em cada cartão e ... no rádio do pátio", com as respostas dele:
   nome e setor de quem carimbou (1-A) e o rádio com as 15 últimas de hoje
   (2-A). Tudo sai da trilha de movimentações que já existe — nada novo é
   gravado —, e o "normal" é o mesmo das etapas (pvNormalDasEtapas).
   ===================================================================== */
const PV_RADIO_MAX = 15;
/* O que o caminhão fazia na etapa que acabou — para "levou X embarcando". */
const PV_FAZENDO = { 'Aguardando Embarque':'esperando o embarque', 'Embarque Iniciado':'embarcando',
  'Embarque Finalizado':'esperando o faturamento', 'Faturado':'esperando a saída' };

function pvQuem(m){
  const nome = String(m.operador || '').trim();
  const setor = m.setor && m.setor !== '—' ? m.setor : '';
  if(nome && !/não identificado/i.test(nome)) return setor ? `${nome} (${setor})` : nome;
  return setor ? 'A ' + setor : 'Alguém';
}
function pvPraca(c){ return destinoDaCarga(c) || ((rotaInfo(c.rota) || {}).nome) || ''; }

/* O rádio: os carimbos de hoje, o mais novo em cima. */
function pvRadio(){
  const ol = document.getElementById('pv-radio');
  if(!ol) return;
  if(!ol._ouvindo){
    ol._ouvindo = true;
    ol.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-carga]');
      if(b) pvAbrirCarga(b.dataset.carga, b);
    });
  }
  const hoje = pvHoje();
  const verbo = { 'Aguardando Veículo':'programou a', 'Aguardando Embarque':'liberou a entrada da',
    'Embarque Iniciado':'iniciou o embarque da', 'Embarque Finalizado':'finalizou o embarque da',
    'Faturado':'faturou a', 'Seguiu Viagem':'liberou a saída da' };
  const normal = pvNormalDasEtapas();
  const itens = (DB.movimentacoes || []).filter(m => m.timestamp && new Date(m.timestamp) >= hoje)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, PV_RADIO_MAX);
  const vazio = document.getElementById('pv-radio-vazio');
  if(vazio) vazio.hidden = itens.length > 0;
  const html = itens.map(m => {
    const c = DB.cargas.find(x => x.id === m.cargaId) || {};
    const novo = !_pv.radioVisto.has(m.id) && _pv.radioVisto.size ? ' class="novo"' : '';
    // a etapa que acabou com este carimbo
    const antes = c.id ? pvPassagensDaTrilha(historicoDaCarga(c.id))
      .find(p => p.fim === m.timestamp && p.status !== m.statusNovo) : null;
    const d = antes ? pvMinutosDaPassagem(antes) : null;
    const norm = antes ? normal.get(antes.status) : null;
    const alem = d !== null && norm && norm.p90 !== null && d > norm.p90;
    let extra = '';
    if(d !== null && PV_FAZENDO[antes.status]) extra += ` · levou ${pvDur(d)} ${PV_FAZENDO[antes.status]}`;
    if(m.statusNovo === 'Seguiu Viagem'){
      const t = tempoDePatioDe(c);
      if(t.minutos !== null) extra += ` · ${pvDur(t.minutos)} de pátio`;
    }
    const tipo = m.statusNovo === 'Aguardando Embarque' ? 'chegada' : m.statusNovo === 'Seguiu Viagem' ? 'saida' : '';
    const onde = [c.rota ? c.rota + (pvPraca(c) ? ' ' + pvPraca(c) : '') : '', (c.placa || m.placa) ? 'placa ' + (c.placa || m.placa) : '']
      .filter(Boolean).join(', ');
    return `<li${novo} data-id="${esc(m.id)}"${tipo ? ` data-tipo="${tipo}"` : ''}${alem ? ' data-alem="1"' : ''}>`
      + `<button type="button" class="pv-radio-item"${c.id ? ` data-carga="${esc(c.id)}"` : ' disabled'}>`
      + `<time>${esc(horaCurta(m.timestamp))}</time><span>${esc(pvQuem(m))} `
      + `${esc(verbo[m.statusNovo] || 'moveu a')} carga <b>${esc(c.numeroCarga || m.placa || '—')}</b>`
      + `${onde ? ' — ' + esc(onde) : ''}<em>${esc(extra)}</em></span></button></li>`;
  }).join('');
  if(ol._html !== html){ ol._html = html; ol.innerHTML = html; }
  itens.forEach(m => _pv.radioVisto.add(m.id));
}

/* Tocar no cartão (ou numa linha do rádio) abre a carga na gaveta dos
   Indicadores: a ficha, o "agora" e a linha do tempo com quem carimbou cada
   etapa e quanto tempo ela ficou em cada uma. */
function pvAbrirCarga(id, origem){
  const c = DB.cargas.find(x => x.id === id);
  if(!c) return;
  const e = pvEstado(c);
  const ctx = { normal: pvNormalDasEtapas(), passadas: pvPassadasNaFila() };
  const agoraIso = new Date().toISOString();
  const passagens = pvPassagensDaTrilha(historicoDaCarga(c.id));
  const alemTexto = (st, min) => {
    const n = ctx.normal.get(st);
    return n && n.p90 !== null && min > n.p90 ? 'além do normal: 9 em 10 em até ' + pvDur(n.p90) : '';
  };

  // A FICHA — só o que estiver preenchido
  const peso = Number(c.peso) > 0 ? Number(c.peso).toLocaleString('pt-BR') + ' kg' : '';
  const ficha = [['Placa', c.placa], ['Veículo', c.tipoVeiculo], ['Transportadora', c.transportadora],
    ['Motorista', c.motorista], ['Peso', peso],
    ['Sequência', c.sequencia !== null && c.sequencia !== undefined && c.sequencia !== '' ? String(c.sequencia) : ''],
    ['Doca', c.doca ? String(c.doca) : '']]
    .filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt> <dd>${esc(v)}</dd></div>`).join('');

  // AGORA
  let agora = '';
  if(PV_ETAPAS_DO_PATIO.includes(c.status)){
    const ent = pvEntradaNaEtapa(c);
    const m = ent ? minutosEntre(ent, agoraIso) : null;
    const alem = m !== null ? alemTexto(c.status, m) : '';
    const prev = pvTextoDaPrevisao(pvPrevisaoDeSaida(c, ctx));
    agora = `<p><b>${esc(c.status)}</b>${m !== null ? ' há ' + esc(pvDur(m)) : ''}</p>`
      + (alem ? `<p class="pv-gv-alem">${esc(alem)}</p>` : '')
      + (prev ? `<p>${esc(prev)}</p>` : '');   // o tempo de pátio já está no subtítulo
  } else if(c.status === 'Aguardando Veículo'){
    const n = ctx.passadas.get(c.id) || 0;
    agora = '<p><b>Aguardando Veículo</b> — o caminhão ainda não chegou</p>'
      + (n ? `<p class="pv-gv-alem">${n === 1 ? '1 da fila já entrou na frente' : n + ' da fila já entraram na frente'}</p>` : '');
  } else if(c.status === 'Seguiu Viagem'){
    const s = primeiroTimestamp(c.id, 'Seguiu Viagem');
    agora = `<p><b>Seguiu viagem</b>${s ? ' às ' + esc(horaCurta(s)) : ''}</p>`
      + (e.min !== null ? `<p>${esc(pvDur(e.min))} de pátio</p>` : '');
  }

  // A LINHA DO TEMPO — cada passagem, na ordem em que aconteceu
  const ordem = st => PV_ETAPAS.findIndex(x => x.status === st);
  const itens = passagens.map((p, k) => {
    const voltou = k > 0 && ordem(p.status) < ordem(passagens[k - 1].status);
    const aindaNela = !p.fim && p.status === c.status && p.status !== 'Seguiu Viagem';
    const min = pvMinutosDaPassagem(p, aindaNela ? agoraIso : null);
    const dur = p.status === 'Seguiu Viagem' ? '' : aindaNela ? (min !== null ? 'em andamento há ' + pvDur(min) : '')
      : (min !== null ? 'ficou ' + pvDur(min) : '');
    const alem = min !== null && p.status !== 'Seguiu Viagem' ? alemTexto(p.status, min) : '';
    return `<li class="gv-carga"${alem ? ' data-alem="1"' : ''}><div class="gv-carga-topo">`
      + `<b>${voltou ? '↩ voltou para ' : ''}${esc(p.status)}</b> <span class="gv-carga-tempo">${esc(horaCurta(p.ini))}</span></div>`
      + `<div class="gv-carga-sub"><span>${esc(pvQuem(p.mov))}</span>${dur ? `<span>${esc(dur)}</span>` : ''}`
      + `${alem ? `<span class="pv-gv-alem">${esc(alem)}</span>` : ''}</div></li>`;
  });
  // as etapas que ainda faltam, apagadas
  if(c.status !== 'Seguiu Viagem'){
    const atual = ordem(c.status);
    PV_ETAPAS.forEach((et, k) => {
      if(k > atual) itens.push(`<li class="gv-carga futura"><div class="gv-carga-topo"><b>${esc(et.status)}</b> `
        + `<span class="gv-carga-tempo">—</span></div></li>`);
    });
  }

  Graf.abrirGaveta({ chave:'patio|' + id, olho:'Carga ' + (c.numeroCarga || '—'),
    titulo: (c.rota || '—') + ' ' + pvPraca(c),
    sub: e.min === null ? (c.status === 'Aguardando Veículo' ? 'programada' : '') : pvDur(e.min) + ' de pátio',
    html: (ficha ? `<dl class="pv-gv-ficha">${ficha}</dl>` : '')
      + (agora ? `<div class="pv-gv-agora">${agora}</div>` : '')
      + `<ol class="gv-lista">${itens.join('')}</ol>`, origem });
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
