/* =====================================================================
   PAGAMENTO DE FRETE — a planilha de controle dentro do painel (05/10/2026)
   ---------------------------------------------------------------------
   Pedido do dono: "na aba de pagamento de frete, as informações precisam
   corresponder à planilha, como se o sistema utilizasse uma planilha no mesmo
   formato, com lógica compatível com a programação."

   POR ISSO ESTA TELA NÃO CALCULA NADA. O servidor entrega a MESMA grade que
   vira o arquivo Excel (GET /api/pagamento-frete): 22 colunas na ordem da
   planilha da Daniela, uma linha por pendência, e o resumo. Aqui só se
   desenha. As contas (situação, % entregue, % liberado, a pagar) são do
   servidor; o vocabulário das tratativas também.

   AS CORES SEGUEM A PLANILHA: título azul-marinho = vem dos relatórios, azul-aço
   = calculado, dourado = preenchimento manual; situação verde/vermelho/amarelo.

   QUEM VÊ A ABA: o setor "Pagamento de Frete" e a Administração — pelo
   mesmo SETOR_PERMISSOES de todas as abas (decisão do dono: as permissões
   são definidas na aba de Usuários que já existe, pelo setor). O controle
   de verdade é o servidor, que confere o setor a cada chamada.

   FLUXO DE IMPORTAÇÃO: escolher os PDFs (B2B e Atak, de uma ou várias cargas)
   → o servidor lê cada um → prévia por carga → confirmar. A tela não manda
   dado nenhum para ser gravado: a confirmação só diz QUAIS cargas.
   ===================================================================== */
const FRETE = {
  dados: null, carregando: false, erro: null, carregadoEm: 0,
  busca: '', situacao: null, soSaldo: false, soSemTratativa: false, soSemCanhoto: false,
  /* Rodada 45 — a aba é uma FILA DE TRABALHO: filtros amplos (pedido do dono) e
     ordem por prioridade (A PAGAR → conferir → PARCIAL → sem pagamento → INTEGRAL). */
  statusPg: null, transportadora: '', pend: 'todas', pagDe: '', pagAte: '', consDe: '', consAte: '', ordem: 'prioridade',
  demonstracao: false,   // true só na vitrine/provas: a grade veio de window.FRETE_DEMONSTRACAO, nada grava
  /* CARGA FECHADA POR PADRÃO (pedido do dono, 05/10/2026): "trabalharemos carga
     por carga e há muitas delas". Uma linha por carga; as pendências só
     aparecem quando a carga é aberta (clique no número ou no ▸), como no
     Histórico. O conjunto sobrevive às recargas: tratar uma nota não fecha. */
  abertas: new Set(),
};
const FRETE_VALIDADE_MS = 30000;   // reabrir a aba depois disto relê, sem esconder a tela

/* QUEM VÊ A ABA é decidido por SETOR_PERMISSOES (data.js), como toda aba:
   o setor "Pagamento de Frete" e a Administração. Aqui não há regra de
   acesso — o servidor confere o setor em toda chamada. */
function freteServidorOk(){
  return typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado() && !!SuincoSharePoint.frete;
}

/* ---------------------------------------------------------- formatação */
function fretePct(v){
  if(typeof v !== 'number') return '';
  return (v * 100).toFixed(1).replace('.', ',') + '%';
}
const freteNum = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
const freteData = (iso) => (iso ? fmtData(iso) : '');
function freteMensagemDeErro(e){
  if(e && e.codigo === 'FRETE_SEM_MIGRACAO') return e.message;
  if(e && e.codigo === 'SETOR_SEM_PERMISSAO') return 'Esta aba é do setor Pagamento de Frete (e da Administração).';
  return (e && e.message) || 'Não consegui falar com o servidor.';
}

/* ------------------------------------------------------------- carregar */
function renderFrete(){
  const raiz = document.getElementById('tab-frete');
  if(!raiz) return;
  if(!freteServidorOk()){
    /* SEM SERVIDOR só há a DEMONSTRAÇÃO (vitrine e provas de tela): a grade de
       exemplo em vitrine/frete_demonstracao.json, gerada pela MESMA função
       que a API usa. Quem a injeta é quem testa; na operação não existe. */
    if(window.FRETE_DEMONSTRACAO && window.FRETE_DEMONSTRACAO.linhas){
      FRETE.dados = window.FRETE_DEMONSTRACAO;
      FRETE.demonstracao = true;
      FRETE.erro = null;
      FRETE.carregadoEm = Date.now();
      freteDesenhar();
      freteAviso('Demonstração com cargas de exemplo (9008xx). Com o servidor, a aba mostra as cargas importadas dos relatórios.');
      return;
    }
    freteAviso('Esta aba precisa de conexão com o servidor. Faça login para usá-la.');
    return;
  }
  if(!FRETE.dados){ freteCarregar(); return; }
  freteDesenhar();
  if(Date.now() - FRETE.carregadoEm > FRETE_VALIDADE_MS) freteCarregar();
}

async function freteCarregar(){
  if(FRETE.carregando) return;
  FRETE.carregando = true;
  freteMarcarOcupado(true);
  try{
    FRETE.dados = await SuincoSharePoint.frete.grade();
    FRETE.demonstracao = false;
    FRETE.erro = null;
    FRETE.carregadoEm = Date.now();
  }catch(e){
    FRETE.erro = freteMensagemDeErro(e);
  }finally{
    FRETE.carregando = false;
    freteMarcarOcupado(false);
  }
  freteDesenhar();
}

function freteMarcarOcupado(sim){
  const el = document.getElementById('frete-atualizado');
  if(el && sim) el.textContent = 'Atualizando…';
  const raiz = document.getElementById('tab-frete');
  if(raiz) raiz.setAttribute('aria-busy', sim ? 'true' : 'false');
}

function freteAviso(texto){
  const el = document.getElementById('frete-aviso');
  if(!el) return;
  el.hidden = !texto;
  el.textContent = texto || '';
}

/* ------------------------------------------------------------- filtros */
function freteIx(chave){ return FRETE.dados.colunas.findIndex((c) => c.chave === chave); }

/* O filtro escolhe CARGAS e traz o bloco inteiro: pendência sozinha, sem a
   linha das contagens, não diz de quem é. */
function freteLinhasVisiveis(){
  const d = FRETE.dados;
  if(!d) return { linhas: [], cargas: 0, total: 0 };
  const iSit = freteIx('situacao'), iAp = freteIx('aPagar'), iTr = freteIx('tratativa'), iTp = freteIx('transportadora'), iCan = freteIx('canhoto');
  const iSp = freteIx('statusPagamento'), iDp = freteIx('dataPagamento'), iData = freteIx('data'), iCg = freteIx('carga');
  const grupos = [];
  const porCarga = new Map();
  for(const l of d.linhas){
    if(!porCarga.has(l.carga)) porCarga.set(l.carga, []);
    porCarga.get(l.carga).push(l);
  }
  const q = FRETE.busca.trim().toLowerCase();
  const linhas = [];
  let cargas = 0;
  for(const [carga, ls] of porCarga){
    const p = ls[0];
    if(FRETE.situacao && p.v[iSit] !== FRETE.situacao) continue;
    if(FRETE.soSaldo && !(typeof p.v[iAp] === 'number' && p.v[iAp] > 0)) continue;
    if(FRETE.soSemTratativa && !ls.some((l) => l.nota && !l.v[iTr])) continue;
    if(FRETE.soSemCanhoto && p.v[iCan] === 'SIM') continue;
    if(FRETE.statusPg && (p.v[iSp] || '') !== FRETE.statusPg) continue;
    if(FRETE.transportadora && String(p.v[iTp] || '').trim() !== FRETE.transportadora) continue;
    if(FRETE.pend === 'semOlhar' && !ls.some((l) => l.nota && !l.v[iTr])) continue;
    if(FRETE.pend === 'com' && !ls.some((l) => l.nota)) continue;
    if(FRETE.pend === 'sem' && ls.some((l) => l.nota)) continue;
    const dp = p.v[iDp] || '', dc = p.v[iData] || '';
    if((FRETE.pagDe || FRETE.pagAte) && (!dp || (FRETE.pagDe && dp < FRETE.pagDe) || (FRETE.pagAte && dp > FRETE.pagAte))) continue;
    if((FRETE.consDe || FRETE.consAte) && (!dc || (FRETE.consDe && dc < FRETE.consDe) || (FRETE.consAte && dc > FRETE.consAte))) continue;
    if(q){
      const porNota = ls.some((l) => l.nota && String(l.nota).includes(q));
      const bate = String(carga).includes(q) || porNota || String(p.v[iTp] || '').toLowerCase().includes(q);
      if(!bate) continue;
      if(porNota && !String(carga).includes(q)) FRETE.abertas.add(String(carga));   // achou pela nota: mostra a nota
    }
    cargas += 1;
    grupos.push(ls);
  }
  /* Ordem por prioridade: o que pede ação primeiro; dentro do grupo, a mais antiga. */
  const PRIORIDADE = { 'A PAGAR': 0, conferir: 1, PARCIAL: 2, '': 3, INTEGRAL: 4 };
  const chave = (ls) => {
    const p = ls[0];
    if(FRETE.ordem === 'carga') return [Number(p.v[iCg]) || 0];
    if(FRETE.ordem === 'data') return [String(p.v[iData] || ''), Number(p.v[iCg]) || 0];
    return [PRIORIDADE[p.v[iSp] || ''] ?? 3, String(p.v[iData] || ''), Number(p.v[iCg]) || 0];
  };
  grupos.sort((a, b) => { const ka = chave(a), kb = chave(b); for(let i = 0; i < ka.length; i += 1){ if(ka[i] < kb[i]) return -1; if(ka[i] > kb[i]) return 1; } return 0; });
  for(const ls of grupos) linhas.push(...ls);
  return { linhas, cargas, total: porCarga.size };
}
function freteFiltrarStatusPg(st){ FRETE.statusPg = FRETE.statusPg === st ? null : st; freteDesenhar(); }
function freteDefinir(chave, valor){ FRETE[chave] = valor; freteDesenhar(); }
function freteLimparFiltros(){
  Object.assign(FRETE, { busca: '', situacao: null, soSaldo: false, soSemTratativa: false, soSemCanhoto: false, statusPg: null, transportadora: '', pend: 'todas', pagDe: '', pagAte: '', consDe: '', consAte: '' });
  freteDesenhar();
}
function freteTemFiltro(){
  return !!(FRETE.busca.trim() || FRETE.situacao || FRETE.soSaldo || FRETE.soSemTratativa || FRETE.soSemCanhoto || FRETE.statusPg || FRETE.transportadora || FRETE.pend !== 'todas' || FRETE.pagDe || FRETE.pagAte || FRETE.consDe || FRETE.consAte);
}
/* O texto do filtro, como vai no topo do .xlsx exportado. */
function freteDescreverFiltro(){
  const br = (d) => (d ? d.split('-').reverse().join('/') : '');
  const partes = [];
  if(FRETE.busca.trim()) partes.push(`busca "${FRETE.busca.trim()}"`);
  if(FRETE.situacao) partes.push(`situação ${FRETE.situacao}`);
  if(FRETE.statusPg) partes.push(`status ${FRETE.statusPg}`);
  if(FRETE.transportadora) partes.push(`transportadora ${FRETE.transportadora}`);
  if(FRETE.pend === 'semOlhar') partes.push('com pendência sem olhar');
  if(FRETE.pend === 'com') partes.push('com pendência');
  if(FRETE.pend === 'sem') partes.push('sem pendência');
  if(FRETE.soSaldo) partes.push('com saldo a pagar');
  if(FRETE.soSemTratativa) partes.push('pendência sem tratativa');
  if(FRETE.soSemCanhoto) partes.push('sem canhoto original');
  if(FRETE.pagDe || FRETE.pagAte) partes.push(`pagamento ${FRETE.pagDe ? 'de ' + br(FRETE.pagDe) : ''}${FRETE.pagAte ? ' até ' + br(FRETE.pagAte) : ''}`.replace(/\s+/g, ' ').trim());
  if(FRETE.consDe || FRETE.consAte) partes.push(`consulta ${FRETE.consDe ? 'de ' + br(FRETE.consDe) : ''}${FRETE.consAte ? ' até ' + br(FRETE.consAte) : ''}`.replace(/\s+/g, ' ').trim());
  return partes.join(' · ');
}

function freteFiltrarSituacao(sit){
  FRETE.situacao = FRETE.situacao === sit ? null : sit;
  freteDesenhar();
}
function freteBuscar(valor){
  FRETE.busca = valor || '';
  freteDesenharTabela();
}
function freteAlternar(chave){
  FRETE[chave] = !FRETE[chave];
  freteDesenhar();
}
function freteAlternarCarga(carga){
  const k = String(carga);
  if(FRETE.abertas.has(k)) FRETE.abertas.delete(k); else FRETE.abertas.add(k);
  freteDesenharTabela();
}

/* ------------------------------------------------------------- desenhar */
function freteDesenhar(){
  const d = FRETE.dados;
  const raiz = document.getElementById('tab-frete');
  if(!raiz) return;
  const vazio = document.getElementById('frete-empty');
  if(FRETE.erro){
    freteAviso(FRETE.erro);
    document.getElementById('frete-stats').innerHTML = '';
    document.getElementById('frete-tbody').innerHTML = '';
    document.getElementById('frete-thead').innerHTML = '';
    document.getElementById('frete-filtros').innerHTML = '';
    document.getElementById('frete-detalhes').hidden = true;
    vazio.hidden = true;
    return;
  }
  freteAviso('');
  if(!d) return;
  const quando = new Date(FRETE.carregadoEm);
  document.getElementById('frete-atualizado').textContent =
    `Atualizado às ${String(quando.getHours()).padStart(2, '0')}:${String(quando.getMinutes()).padStart(2, '0')}`;
  freteDesenharStats();
  freteDesenharFiltros();
  freteDesenharTabela();
  freteDesenharResumo();
}

function freteDesenharStats(){
  const r = FRETE.dados.resumo;
  const caixa = (num, rotulo, o = {}) => `<div class="stat-box${o.destaque ? ' stat-destaque' : ''}${o.clicavel ? ' stat-clicavel' : ''}${o.ativo ? ' stat-ativo' : ''}${o.alerta && num > 0 ? ' stat-alerta' : ''}"
      ${o.clicavel ? `role="button" tabindex="0" onclick="${o.clique}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${o.clique}}"` : ''}
      ${o.titulo ? `title="${esc(o.titulo)}"` : ''}>
      <div class="stat-num">${esc(num)}</div>
      <div class="stat-label">${esc(rotulo)}</div>
      ${o.nota ? `<div class="stat-note">${esc(o.nota)}</div>` : ''}
    </div>`;
  const hoje = caixa(r.aPagarAgora ?? r.comSaldo, 'A PAGAR', { clicavel: true, destaque: true, ativo: FRETE.statusPg === 'A PAGAR', clique: "freteFiltrarStatusPg('A PAGAR')", titulo: 'Cargas com liberado ainda não pago. Clique para filtrar.', nota: r.provisao ? `${esc(String(r.provisao.notas).replace('.', ','))} notas liberadas sem pagar` : 'liberado e não pago' })
    + caixa(r.semOlhar ?? 0, 'Pendências sem olhar', { clicavel: true, alerta: true, ativo: FRETE.pend === 'semOlhar', clique: "freteDefinir('pend', FRETE.pend === 'semOlhar' ? 'todas' : 'semOlhar')", titulo: 'Notas pendentes que ninguém tratou ainda. Clique para filtrar.', nota: r.idade && r.idade.maisDe7 ? `${r.idade.maisDe7} há mais de 7 dias` : 'nenhuma com mais de 7 dias' })
    + caixa(r.verificar, 'Conferir', { clicavel: true, alerta: true, ativo: FRETE.situacao === 'VERIFICAR', clique: "freteFiltrarSituacao('VERIFICAR')", titulo: 'Nota só no B2B, B2B com mais notas que o sistema, ou nada finalizado. Nada é liberado até conferir. Clique para filtrar.', nota: 'nada liberado até olhar' });
  /* O PANORAMA VIRA UMA FAIXA (06/10/2026): eram 9 caixas grandes que empurravam
     a tabela para baixo da dobra. Os mesmos números, numa linha; os que filtram
     continuam clicáveis. "O que fazer hoje" fica em caixa — é o que pede ação. */
  const item = (num, rotulo, o = {}) => o.clique
    ? `<button type="button" class="frete-pan-item${o.ativo ? ' ativo' : ''}${o.alerta && Number(num) > 0 ? ' alerta' : ''}" onclick="${o.clique}" aria-pressed="${!!o.ativo}" title="${esc(o.titulo || '')}"><b>${esc(num)}</b> ${esc(rotulo)}</button>`
    : `<span class="frete-pan-item${o.alerta && Number(num) > 0 ? ' alerta' : ''}" title="${esc(o.titulo || '')}"><b>${esc(num)}</b> ${esc(rotulo)}</span>`;
  const panorama = item(r.cargas, r.cargas === 1 ? 'carga' : 'cargas', { titulo: 'Cargas no controle (cada carga conta uma vez)' })
    + item(r.liberadas, 'liberadas', { ativo: FRETE.situacao === 'LIBERADA', clique: "freteFiltrarSituacao('LIBERADA')", titulo: 'Tudo que o sistema emitiu está Finalizado no B2B. Clique para filtrar.' })
    + item(r.pendentes, 'pendentes', { ativo: FRETE.situacao === 'PENDENTE', clique: "freteFiltrarSituacao('PENDENTE')", titulo: 'Parte está Finalizada, parte não. Clique para filtrar.' })
    + item(r.integral, 'pagas integralmente')
    + item(r.parcial, 'pagas em parte')
    + item(r.semPagamento, 'sem pagamento')
    + item(r.entregue === null ? '—' : fretePct(r.entregue), 'entregues', { titulo: 'Notas finalizadas ÷ emitidas' })
    + item(r.pendAbertas, 'pendências abertas', { alerta: true, titulo: 'Notas ainda sem entrega' })
    + item(`${r.comCanhoto ?? 0} de ${r.cargas}`, 'com canhoto original', { ativo: FRETE.soSemCanhoto, clique: "freteAlternar('soSemCanhoto')", titulo: 'Cargas cujo canhoto em papel já chegou (só acompanhamento). Clique para ver as que ainda não vieram.' });
  const el = document.getElementById('frete-stats');
  el.className = 'frete-grupos';
  el.innerHTML = `<section class="frete-grupo frete-grupo-hoje" aria-label="O que fazer hoje"><h3 class="frete-grupo-t">O que fazer hoje</h3><div class="bento bi-faixa">${hoje}</div></section>
    <section class="frete-grupo frete-panorama" aria-label="Panorama"><h3 class="frete-grupo-t">Panorama</h3><div class="frete-pan">${panorama}</div></section>`;
}

function freteDesenharFiltros(){
  const chip = (rotulo, ativo, clique) => `<button type="button" class="frete-chip${ativo ? ' ativo' : ''}" aria-pressed="${ativo}" onclick="${clique}">${esc(rotulo)}</button>`;
  const iTp = freteIx('transportadora');
  const transps = [...new Set((FRETE.dados.linhas || []).filter((l) => l.primeira).map((l) => String(l.v[iTp] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
  const aPagarVisiveis = freteCargasAPagar().length;
  /* FILTROS NUMA LINHA (06/10/2026): busca e os filtros de todo dia à vista; o
     resto em "Mais filtros", que abre sozinho quando um deles está ligado (o
     filtro em uso nunca fica escondido). */
  const maisLigado = !!(FRETE.soSaldo || FRETE.soSemTratativa || FRETE.soSemCanhoto || FRETE.transportadora || FRETE.pend !== 'todas'
    || FRETE.pagDe || FRETE.pagAte || FRETE.consDe || FRETE.consAte || FRETE.ordem !== 'prioridade');
  const nMais = [FRETE.soSaldo, FRETE.soSemTratativa, FRETE.soSemCanhoto, FRETE.transportadora, FRETE.pend !== 'todas',
    FRETE.pagDe || FRETE.pagAte, FRETE.consDe || FRETE.consAte].filter(Boolean).length;
  document.getElementById('frete-filtros').innerHTML = `
    <div class="frete-filtros-linha">
      <label class="frete-busca"><span class="sr-only">Buscar carga, nota ou transportadora</span>
        <input type="search" id="frete-busca" placeholder="Buscar carga, nota ou transportadora" value="${esc(FRETE.busca)}"
               oninput="freteBuscar(this.value)" autocomplete="off"></label>
      <div class="frete-chips" role="group" aria-label="Situação e o que fazer">
        ${chip('Todas', !FRETE.situacao && !FRETE.statusPg, "freteLimparSituacaoEStatus()")}
        ${chip('A PAGAR', FRETE.statusPg === 'A PAGAR', "freteFiltrarStatusPg('A PAGAR')")}
        ${chip('Pendentes', FRETE.situacao === 'PENDENTE', "freteFiltrarSituacao('PENDENTE')")}
        ${chip('Verificar', FRETE.situacao === 'VERIFICAR', "freteFiltrarSituacao('VERIFICAR')")}
        ${chip('Liberadas', FRETE.situacao === 'LIBERADA', "freteFiltrarSituacao('LIBERADA')")}
        ${chip('PARCIAL', FRETE.statusPg === 'PARCIAL', "freteFiltrarStatusPg('PARCIAL')")}
        ${chip('INTEGRAL', FRETE.statusPg === 'INTEGRAL', "freteFiltrarStatusPg('INTEGRAL')")}
      </div>
      <button type="button" class="btn btn-primary btn-sm no-print" id="frete-btn-lote" onclick="fretePagarLoteUI()" ${aPagarVisiveis ? '' : 'disabled'}
              title="Registra o pagamento do que está liberado em cada carga A PAGAR da lista, com uma data só"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-faturamento"/></svg>Pagar as liberadas (${aPagarVisiveis})</button>
    </div>
    <details class="frete-mais" id="frete-mais"${maisLigado || FRETE.maisAberto ? ' open' : ''} ontoggle="FRETE.maisAberto = this.open">
      <summary>Mais filtros${nMais ? ` <span class="frete-mais-n">${nMais} ligado${nMais === 1 ? '' : 's'}</span>` : ''}</summary>
      <div class="frete-filtros-linha frete-filtros-campos">
        <div class="frete-chips" role="group" aria-label="Recortes">
          ${chip('Com saldo a pagar', FRETE.soSaldo, "freteAlternar('soSaldo')")}
          ${chip('Pendência sem tratativa', FRETE.soSemTratativa, "freteAlternar('soSemTratativa')")}
          ${chip('Sem canhoto original', FRETE.soSemCanhoto, "freteAlternar('soSemCanhoto')")}
        </div>
        <label class="frete-f">Transportadora
          <select id="frete-f-transp" onchange="freteDefinir('transportadora', this.value)">${opt('', 'todas', !FRETE.transportadora)}${transps.map((t) => opt(t, t, FRETE.transportadora === t)).join('')}</select></label>
        <label class="frete-f">Pendências
          <select id="frete-f-pend" onchange="freteDefinir('pend', this.value)">${opt('todas', 'todas as cargas', FRETE.pend === 'todas')}${opt('semOlhar', 'com pendência sem olhar', FRETE.pend === 'semOlhar')}${opt('com', 'com pendência', FRETE.pend === 'com')}${opt('sem', 'sem pendência', FRETE.pend === 'sem')}</select></label>
        <label class="frete-f">Pagamento de <input type="date" id="frete-f-pag-de" value="${esc(FRETE.pagDe)}" onchange="freteDefinir('pagDe', this.value)"></label>
        <label class="frete-f">até <input type="date" id="frete-f-pag-ate" value="${esc(FRETE.pagAte)}" onchange="freteDefinir('pagAte', this.value)"></label>
        <label class="frete-f">Consulta de <input type="date" id="frete-f-cons-de" value="${esc(FRETE.consDe)}" onchange="freteDefinir('consDe', this.value)"></label>
        <label class="frete-f">até <input type="date" id="frete-f-cons-ate" value="${esc(FRETE.consAte)}" onchange="freteDefinir('consAte', this.value)"></label>
        <label class="frete-f">Ordenar por
          <select id="frete-f-ordem" onchange="freteDefinir('ordem', this.value)">${opt('prioridade', 'prioridade (A PAGAR primeiro)', FRETE.ordem === 'prioridade')}${opt('data', 'data da consulta', FRETE.ordem === 'data')}${opt('carga', 'número da carga', FRETE.ordem === 'carga')}</select></label>
      </div>
    </details>
    <div class="frete-filtros-linha frete-filtros-rodape">
      <div class="frete-contagem" id="frete-contagem" aria-live="polite"></div>
      ${freteTemFiltro() ? '<button type="button" class="btn btn-sec btn-sm" id="frete-btn-limpar" onclick="freteLimparFiltros()">Limpar filtros</button>' : ''}
    </div>`;
}
function freteLimparSituacaoEStatus(){ FRETE.situacao = null; FRETE.statusPg = null; freteDesenhar(); }

/* As cargas A PAGAR que estão na tela (depois do filtro), com o % a pagar de cada uma. */
function freteCargasAPagar(){
  if(!FRETE.dados) return [];
  const iSp = freteIx('statusPagamento'), iAp = freteIx('aPagar'), iCg = freteIx('carga'), iLib = freteIx('liberado'), iPago = freteIx('pago'), iTp = freteIx('transportadora');
  return freteLinhasVisiveis().linhas.filter((l) => l.primeira && l.v[iSp] === 'A PAGAR' && typeof l.v[iAp] === 'number' && l.v[iAp] > 0)
    .map((l) => ({ carga: String(l.v[iCg]), pct: Math.round(l.v[iAp] * 10000) / 100, liberado: l.v[iLib], pago: l.v[iPago], transportadora: l.v[iTp] || '' }));
}

/* PAGAMENTO EM LOTE (rodada 45): a rotina da semana num passo — cada carga
   continua um lançamento próprio, com quem e quando; o servidor confere cada um. */
function fretePagarLoteUI(){
  if(freteSoDemonstracao('as cargas liberadas são pagas de uma vez, um lançamento por carga')) return;
  const lista = freteCargasAPagar();
  if(!lista.length){ notify('Nenhuma carga A PAGAR na lista.', 'warn'); return; }
  freteModal(`Pagar as liberadas — ${lista.length} carga(s)`, `
    <div class="card-sub">Registra, em cada carga abaixo, o pagamento do que está <strong>liberado e ainda não pago</strong>. Um lançamento por carga, com a mesma data; tudo fica no histórico com quem e quando.</div>
    <div class="table-wrap"><table class="frete-mini" id="frete-lote-tab"><thead><tr><th scope="col">Carga</th><th scope="col">Transportadora</th><th scope="col">Liberado</th><th scope="col">Já pago</th><th scope="col">Pagar agora</th></tr></thead>
      <tbody>${lista.map((c) => `<tr data-carga="${esc(c.carga)}"><td><strong>${esc(c.carga)}</strong></td><td>${esc(c.transportadora || '—')}</td><td>${esc(fretePct(c.liberado))}</td><td>${esc(fretePct(c.pago) || '0,0%')}</td><td><strong>${esc(String(c.pct).replace('.', ','))}%</strong></td></tr>`).join('')}</tbody></table></div>
    <label class="frete-campo">Data do pagamento <small>(uma para todas; pode ficar em branco)</small>
      <input type="date" id="frete-lote-data" data-foco></label>
    <div id="frete-lote-resultado" class="card-sub" hidden></div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: `Registrar ${lista.length} pagamento(s)`, classe: 'btn-primary', id: 'frete-btn-lote-ok', icone: 'i-ok', clique: 'fretePagarLote()' }], true);
}
async function fretePagarLote(){
  const lista = freteCargasAPagar();
  const data = (document.getElementById('frete-lote-data') || {}).value || null;
  const botao = document.getElementById('frete-btn-lote-ok');
  if(botao) botao.disabled = true;
  const res = document.getElementById('frete-lote-resultado');
  const feitos = []; const falhas = [];
  for(const c of lista){
    try{
      await SuincoSharePoint.frete.pagar(c.carga, { pct: c.pct, dataPagamento: data, obs: 'pagamento em lote', confirmar: false });
      feitos.push(c.carga);
      const tr = document.querySelector(`#frete-lote-tab tr[data-carga="${CSS.escape(c.carga)}"]`); if(tr) tr.classList.add('frete-lote-ok');
    }catch(e){
      falhas.push(`${c.carga}: ${freteMensagemDeErro(e)}`);
    }
  }
  if(res){ res.hidden = false; res.innerHTML = `<strong>${feitos.length}</strong> pagamento(s) registrado(s).${falhas.length ? `<br>Não registrados: ${falhas.map(esc).join('; ')}` : ''}`; }
  notify(falhas.length ? `${feitos.length} registrado(s); ${falhas.length} com problema — veja a lista.` : `${feitos.length} pagamento(s) registrado(s).`, falhas.length ? 'warn' : 'success', 7000);
  await freteRecarregarSemPiscar();
  if(!falhas.length) setTimeout(freteFecharModal, 900);
  else if(botao) botao.disabled = false;
}

/* Em colunas "manuais" a célula é editável; as outras são só leitura. */
function freteTratativas(){
  return (FRETE.dados.vocabulario && FRETE.dados.vocabulario.tratativas) || [];
}

function freteCelula(l, col, j){
  const v = l.v[j];
  const primeira = l.primeira;
  const chave = col.chave;
  const k = ` data-col="${chave}"`;
  switch(chave){
    case 'data': case 'canhotoEm':
      return `<td${k} class="${primeira || chave !== 'data' ? '' : 'frete-mudo'}">${esc(freteData(v))}</td>`;
    case 'dataPagamento': {
      /* CADA NOTA COM A SUA DATA (06/10/2026): "pode ser que a primeira eu pague
         hoje, a outra no próximo pagamento". Na linha de uma nota a célula é
         DA NOTA — Pagar, ou a data em que ela foi paga. A da carga (o último
         pagamento da carga) fica na linha fechada, na carga sem pendência e
         no botão Editar. */
      if(freteLinhaDeNota(l)){
        /* Na 1ª linha a carga continua dizendo a data do pagamento DELA, embaixo
           do botão da nota — senão o "paguei 50% em 09/10" sumia da grade. */
        const daCarga = primeira && l.cargaDataPagamento
          ? `<button type="button" class="frete-edit frete-data-carga" onclick="freteEditarDataPagamento('${escJs(l.carga)}')"
              aria-label="Último pagamento da carga ${esc(l.carga)}: ${esc(freteData(l.cargaDataPagamento))}. Editar">carga: ${esc(freteData(l.cargaDataPagamento))}</button>` : '';
        if(l.categoria === 'so_b2b') return `<td${k} class="frete-nota-campo"><span class="frete-vazio" title="Nota só no B2B: não é nota da carga no sistema, não entra no % pago.">—</span>${daCarga}</td>`;
        if(l.notaPaga){
          return `<td${k} class="frete-nota-campo"><button type="button" class="frete-edit frete-edit-data frete-nota-paga" onclick="freteEditarDataNota('${escJs(l.carga)}','${escJs(l.nota)}')"
              aria-label="Nota ${esc(l.nota)} paga em ${esc(freteData(l.notaPaga.data) || 'sem data')}. Editar">
              <span class="frete-selo-pago" aria-hidden="true">paga</span>${esc(freteData(l.notaPaga.data) || 'sem data')}</button>${daCarga}</td>`;
        }
        return `<td${k} class="frete-nota-campo"><button type="button" class="btn btn-sm frete-btn-pagar-nota${l.tratativaLibera ? ' frete-pagar-pronta' : ''}"
            onclick="fretePagarNotaUI('${escJs(l.carga)}','${escJs(l.nota)}')"
            title="${l.tratativaLibera ? 'Nota liberada: registrar o pagamento dela, com a data' : 'Registrar o pagamento desta nota (ela ainda não está liberada — o painel pergunta)'}">Pagar nota</button>${daCarga}</td>`;
      }
      if(!primeira) return `<td${k}></td>`;
      const pagoV = l.v[freteIx('pago')];
      const temPago = typeof pagoV === 'number' && pagoV > 0;
      return `<td${k}><button type="button" class="frete-edit frete-edit-data" onclick="freteEditarDataPagamento('${escJs(l.carga)}')"
          aria-label="Data do pagamento da carga ${esc(l.carga)}: ${esc(freteData(v) || 'em branco')}. Editar">${v ? esc(freteData(v)) : `<span class="frete-vazio">${temPago ? 'sem data' : '—'}</span>`}</button></td>`;
    }
    case 'dataTratativa': {
      if(!l.nota || (primeira && l._dobravel && !l._aberta)) return `<td${k}></td>`;
      return `<td${k}><button type="button" class="frete-edit frete-edit-data" onclick="freteEditarDataTratativa('${escJs(l.carga)}','${escJs(l.nota)}')"
          aria-label="Data da tratativa da nota ${esc(l.nota)}: ${esc(freteData(v) || 'em branco')}. Editar">${v ? esc(freteData(v)) : '<span class="frete-vazio">—</span>'}</button></td>`;
    }
    case 'canhoto': {
      /* A caixinha do papel: só acompanhamento, nunca entra no pagamento. */
      if(!primeira) return `<td${k}></td>`;
      const veio = v === 'SIM';
      return `<td${k} class="frete-canhoto frete-canhoto-${veio ? 'sim' : 'nao'}"><label class="frete-check">
          <input type="checkbox"${veio ? ' checked' : ''} aria-label="Canhoto original da carga ${esc(l.carga)} veio"
                 onchange="freteCanhoto('${escJs(l.carga)}', this.checked, this)"><span>${veio ? 'SIM' : 'NÃO'}</span></label></td>`;
    }
    case 'carga':
      if(primeira && l._dobravel){
        return `<td${k} class="frete-carga"><button type="button" class="frete-toggle" aria-expanded="${l._aberta ? 'true' : 'false'}"
            onclick="freteAlternarCarga('${escJs(l.carga)}')" title="${l._aberta ? 'Fechar as pendências desta carga' : 'Abrir as pendências desta carga'}">
            <span class="frete-seta" aria-hidden="true">${l._aberta ? '▾' : '▸'}</span>${esc(v)}</button></td>`;
      }
      return `<td${k} class="frete-carga${primeira ? '' : ' frete-mudo'}">${esc(v)}</td>`;
    case 'diferenca':
      if(!primeira) return `<td${k}></td>`;
      return `<td${k} class="${v === 0 ? 'frete-dif-ok' : 'frete-dif-ruim'}">${esc(v)}</td>`;
    case 'qtdSist': case 'qtdB2b': case 'finalizadas': case 'aguardando': case 'naoEntregue': case 'outros':
      return `<td${k}>${esc(freteNum(v))}</td>`;
    case 'situacao': {
      const cls = v === 'LIBERADA' ? 'lib' : v === 'PENDENTE' ? 'pend' : 'verif';
      return primeira
        ? `<td${k}><span class="frete-sit frete-sit-${cls}">${esc(v)}</span></td>`
        : `<td${k} class="frete-mudo">${esc(v)}</td>`;
    }
    case 'resumo': {
      if(primeira && l._dobravel && !l._aberta){
        const semOlhar = l._semOlhar ? ` · ${l._semOlhar} sem olhar` : '';
        const idade = l._semOlhar && l._maisAntiga != null ? ` · a mais antiga há ${l._maisAntiga} dia${l._maisAntiga === 1 ? '' : 's'}` : '';
        return `<td${k} class="frete-r frete-r-fechada"><button type="button" class="frete-pill-pend${l._maisAntiga > 7 ? ' frete-pill-velha' : ''}" onclick="freteAlternarCarga('${escJs(l.carga)}')"
            aria-label="Abrir as ${l._pend} pendências da carga ${esc(l.carga)}">▸ ${l._pend} pendências${esc(semOlhar)}${esc(idade)}</button></td>`;
      }
      const cls = v === 'SEM PENDÊNCIA' ? 'ok' : (l.categoria || 'outro');
      const dica = l.cliente ? ` title="${esc(l.cliente + (l.cidade ? ' — ' + l.cidade : ''))}"` : '';
      const idade = l.idadeDias != null ? `<small class="frete-idade${l.idadeDias > 7 ? ' frete-idade-velha' : ''}">sem olhar há ${l.idadeDias} dia${l.idadeDias === 1 ? '' : 's'}</small>` : '';
      return `<td${k} class="frete-r frete-r-${cls}"${dica}>${esc(v)}${idade}</td>`;
    }
    case 'tratativa': {
      if(!l.nota || (primeira && l._dobravel && !l._aberta)) return `<td${k}></td>`;   // fechada: a linha é da CARGA, não da 1ª nota
      const vocab = freteTratativas();
      const lib = (FRETE.dados.vocabulario.liberam || []).includes(v);
      const cls = !v ? 'falta' : lib ? 'ok' : v === 'SUMIU DO B2B' ? 'sumiu' : v === 'SEM TRATATIVA' ? 'sem' : 'dev';
      const selo = `<span class="frete-selo-t frete-selo-t-${cls}" aria-hidden="true">${v ? esc(v) : 'falta olhar'}</span>`;
      return `<td${k} class="frete-t frete-t-${cls}">${selo}<select class="frete-sel" aria-label="Status da pendência da nota ${esc(l.nota)}"
          onchange="freteTratar('${escJs(l.carga)}','${escJs(l.nota)}',this.value)">
          <option value="">${v ? '— limpar —' : '— falta olhar —'}</option>
          ${vocab.map((t) => `<option value="${esc(t)}"${t === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select></td>`;
    }
    case 'statusPagamento': {
      /* O QUE FAZER com a carga (statusParaPagamento, no servidor): A PAGAR chama a atenção. */
      const cls = v === 'A PAGAR' ? 'apagar' : v === 'INTEGRAL' ? 'integral' : v === 'PARCIAL' ? 'parcial' : v === 'conferir' ? 'conferir' : 'vazio';
      /* Selo com texto e cor, como a situação — "todo estado é um selo" (dono, 05/10). */
      return `<td${k} class="frete-sp frete-sp-${cls}">${v ? `<span class="frete-sit frete-selo-${cls}">${esc(v)}</span>` : ''}</td>`;
    }
    case 'transportadora': case 'cte': {
      const rotulo = chave === 'transportadora' ? 'Transportadora' : 'CT-E';
      /* POR NOTA (06/10/2026): toda pendência tem os seus — em branco, valem
         os da carga (em cinza, "da carga"); preenchido, é a exceção daquela
         nota e aparece em destaque. */
      if(freteLinhaDeNota(l)){
        const propria = chave === 'transportadora' ? l.notaTransportadora : l.notaCte;
        return `<td${k} class="frete-nota-campo"><button type="button" class="frete-edit${propria ? ' frete-proprio' : ' frete-herdado'}"
            onclick="freteEditarNota('${escJs(l.carga)}','${escJs(l.nota)}','${chave}')"
            title="${propria ? `${rotulo} desta nota` : `${rotulo} da carga — clique para dar outro a esta nota`}"
            aria-label="${rotulo} da nota ${esc(l.nota)}: ${esc(v || 'em branco')}${propria ? '' : ' (da carga)'}. Editar">${v ? esc(v) : '<span class="frete-vazio">preencher</span>'}</button></td>`;
      }
      if(!primeira) return `<td${k} class="frete-mudo">${chave === 'transportadora' ? esc(v || '') : ''}</td>`;
      return `<td${k}><button type="button" class="frete-edit" onclick="freteEditarCarga('${escJs(l.carga)}','${chave}')"
          aria-label="${rotulo} da carga ${esc(l.carga)}: ${esc(v || 'em branco')}. Editar">${v ? esc(v) : '<span class="frete-vazio">preencher</span>'}</button></td>`;
    }
    case 'entregue': case 'pago': {
      if(!primeira || typeof v !== 'number') return `<td${k}></td>`;
      return `<td${k} class="frete-barra frete-barra-${chave}" style="--p:${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%">${esc(fretePct(v))}</td>`;
    }
    case 'liberado': case 'aPagar': {
      if(!primeira) return `<td${k}></td>`;
      if(v === 'conferir') return `<td${k} class="frete-conferir" title="Carga VERIFICAR: nada é liberado até alguém conferir o B2B.">conferir</td>`;
      if(typeof v !== 'number') return `<td${k}></td>`;
      return `<td${k} class="${chave === 'aPagar' ? 'frete-forte' + (v > 0 ? ' frete-apagar' : '') : ''}">${esc(fretePct(v))}</td>`;
    }
    case 'observacao': {
      const fechada = primeira && l._dobravel && !l._aberta;   // fechada: só a observação da CARGA
      const texto = fechada ? (l.obsCarga || '') : v;
      const rotulo = texto ? esc(texto) : '<span class="frete-vazio">anotar</span>';
      return `<td${k} class="frete-obs"><button type="button" class="frete-edit" onclick="freteEditarObs('${escJs(l.carga)}','${escJs(fechada ? '' : (l.nota || ''))}')"
          aria-label="Observação da ${!fechada && l.nota ? 'nota ' + esc(l.nota) : 'carga ' + esc(l.carga)}. Editar">${rotulo}</button></td>`;
    }
    default:
      return `<td${k}>${esc(freteNum(v))}</td>`;
  }
}

/* A linha é de UMA NOTA (e não a linha-resumo da carga fechada)? */
function freteLinhaDeNota(l){
  return !!l.nota && !(l.primeira && l._dobravel && !l._aberta);
}

/* A TELA EM DOIS NÍVEIS (06/10/2026, auditoria visual aprovada "tudo").
   Antes: a planilha de 24 colunas na tela — o que se decide (status, data,
   transportadora, CT-E, Pagar, Excluir) ficava fora da tela, atrás de 9
   colunas de contagem, e no celular apareciam 3 colunas. Agora:
     · a CARGA é uma linha só com o que se decide, sem rolar para o lado;
       as 7 contagens viram uma frase ("8 notas · 4 finalizadas · …");
     · ABRIR a carga mostra as NOTAS numa lista própria, com as colunas da
       nota (status, datas, Pagar nota, transportadora, CT-E, observação);
     · no celular, cada carga é um cartão.
   A planilha Excel (24 colunas, a da Daniela) e o PDF NÃO mudam: os dois saem
   da grade do servidor, como sempre. */
const FRETE_CAB = [
  ['carga', 'Carga'], ['situacao', 'Situação'], ['statusPagamento', 'Para pagamento'], ['andamento', 'Entregue · Liberado · Pago'],
  ['transporte', 'Transportadora · CT-E'], ['canhoto', 'Canhoto'], ['acoes', 'Ações'],
];
function freteFrase(v){
  const n = (k) => Number(v[freteIx(k)]) || 0;
  const partes = [`${n('qtdSist')} nota${n('qtdSist') === 1 ? '' : 's'}`, `${n('finalizadas')} finalizada${n('finalizadas') === 1 ? '' : 's'}`];
  if(n('aguardando')) partes.push(`${n('aguardando')} aguardando`);
  if(n('naoEntregue')) partes.push(`${n('naoEntregue')} não entregue${n('naoEntregue') === 1 ? '' : 's'}`);
  if(n('outros')) partes.push(`${n('outros')} outro${n('outros') === 1 ? '' : 's'}`);
  const dif = Number(v[freteIx('diferenca')]) || 0;
  return esc(partes.join(' · ')) + (dif ? ` · <b class="frete-dif-ruim-t" title="Qtde no sistema (${n('qtdSist')}) menos Qtde no B2B (${n('qtdB2b')})">dif. ${dif}</b>` : '');
}
function freteBarra(rot, chave, v){
  const conferir = v === 'conferir';
  const p = typeof v === 'number' ? Math.max(0, Math.min(100, v * 100)) : 0;
  return `<div class="frete-and frete-and-${chave}" data-col="${chave}" title="${esc(rot)}: ${esc(conferir ? 'conferir' : (fretePct(v) || '—'))}">
      <span class="frete-and-rot">${esc(rot)}</span><span class="frete-and-trilho"><span style="width:${p.toFixed(1)}%"></span></span>
      <span class="frete-and-num">${esc(conferir ? 'conferir' : (fretePct(v) || '—'))}</span></div>`;
}
function freteLinhaCargaHtml(l, notas, aberta){
  const v = (k) => l.v[freteIx(k)];
  const k = escJs(l.carga);
  const sit = v('situacao');
  const cls = sit === 'LIBERADA' ? 'lib' : sit === 'PENDENTE' ? 'pend' : 'verif';
  const sp = v('statusPagamento');
  const spc = sp === 'A PAGAR' ? 'apagar' : sp === 'INTEGRAL' ? 'integral' : sp === 'PARCIAL' ? 'parcial' : sp === 'conferir' ? 'conferir' : 'vazio';
  const aPagar = v('aPagar');
  const pago = v('pago');
  const temPago = typeof pago === 'number' && pago > 0;
  const iTr = freteIx('tratativa');
  const semOlhar = notas.filter((x) => !x.v[iTr]).length;
  const maisAntiga = notas.reduce((m, x) => (x.idadeDias != null ? Math.max(m, x.idadeDias) : m), -1);
  const toggle = notas.length
    ? `<button type="button" class="frete-toggle" aria-expanded="${aberta}" onclick="freteAlternarCarga('${k}')"
          title="${aberta ? 'Fechar as notas pendentes' : 'Abrir as notas pendentes'}"><span class="frete-seta" aria-hidden="true">${aberta ? '▾' : '▸'}</span>${esc(l.carga)}</button>
       <button type="button" class="frete-pill-pend${maisAntiga > 7 ? ' frete-pill-velha' : ''}" onclick="freteAlternarCarga('${k}')"
          aria-label="${aberta ? 'Fechar' : 'Abrir'} as ${notas.length} pendências da carga ${esc(l.carga)}">${notas.length} pendência${notas.length === 1 ? '' : 's'}${semOlhar ? ` · ${semOlhar} sem olhar` : ''}${semOlhar && maisAntiga > 0 ? ` · há ${maisAntiga} dia${maisAntiga === 1 ? '' : 's'}` : ''}</button>`
    : `<span class="frete-num">${esc(l.carga)}</span><span class="frete-sem-pend">sem pendência</span>`;
  const obs = l.obsCarga || '';
  const dc = freteDadosDaCarga(l.carga);
  return `<tr class="frete-primeira frete-carga-linha${aberta ? ' frete-aberta' : ''}" data-carga="${esc(l.carga)}">
    <td data-col="carga" data-rotulo="Carga"><div class="frete-carga-topo">${toggle}</div>
      <div class="frete-frase">consulta ${esc(freteData(v('data')))} · ${freteFrase(l.v)}</div>
      <button type="button" class="frete-edit frete-obs-carga" onclick="freteEditarObs('${k}','')" aria-label="Observação da carga ${esc(l.carga)}. Editar"
        >${obs ? `<span class="frete-obs-txt">${esc(obs)}</span>` : '<span class="frete-vazio">+ observação</span>'}</button></td>
    <td data-col="situacao" data-rotulo="Situação"><span class="frete-sit frete-sit-${cls}">${esc(sit)}</span></td>
    <td data-col="statusPagamento" data-rotulo="Para pagamento" class="frete-sp frete-sp-${spc}">${sp ? `<span class="frete-sit frete-selo-${spc}">${esc(sp)}</span>` : '<span class="frete-vazio">—</span>'}
      ${typeof aPagar === 'number' && aPagar > 0 ? `<div class="frete-apagar-t" data-col="aPagar">a pagar ${esc(fretePct(aPagar))}</div>` : ''}
      ${temPago ? `<button type="button" class="frete-edit frete-data-carga" onclick="freteEditarDataPagamento('${k}')"
          aria-label="Último pagamento da carga ${esc(l.carga)}: ${esc(freteData(dc.dataPagamento) || 'sem data')}. Editar">pago em ${esc(freteData(dc.dataPagamento) || 'sem data')}</button>` : ''}</td>
    <td data-col="andamento" data-rotulo="Andamento">${freteBarra('Entregue', 'entregue', v('entregue'))}${freteBarra('Liberado', 'liberado', v('liberado'))}${freteBarra('Pago', 'pago', typeof pago === 'number' ? pago : 0)}</td>
    <td data-col="transporte" data-rotulo="Transportadora · CT-E">
      <button type="button" class="frete-edit frete-transp" data-col="transportadora" onclick="freteEditarCarga('${k}','transportadora')"
        aria-label="Transportadora da carga ${esc(l.carga)}: ${esc(dc.transportadora || 'em branco')}. Editar">${dc.transportadora ? esc(dc.transportadora) : '<span class="frete-vazio">transportadora</span>'}</button>
      <button type="button" class="frete-edit frete-cte" data-col="cte" onclick="freteEditarCarga('${k}','cte')"
        aria-label="CT-E da carga ${esc(l.carga)}: ${esc(dc.cte || 'em branco')}. Editar">${dc.cte ? 'CT-E ' + esc(dc.cte) : '<span class="frete-vazio">CT-E</span>'}</button></td>
    ${freteCelula(l, { chave: 'canhoto' }, freteIx('canhoto')).replace('<td data-col="canhoto"', '<td data-col="canhoto" data-rotulo="Canhoto"')
        .replace(/<\/td>$/, `${v('canhotoEm') ? `<small class="frete-canhoto-em" data-col="canhotoEm">${esc(freteData(v('canhotoEm')))}</small>` : ''}</td>`)}
    <td class="frete-acoes no-print" data-rotulo="Ações">
      <button type="button" class="btn btn-sec btn-sm" onclick="fretePagarUI('${k}')" title="Registrar um pagamento da carga inteira (% das notas)"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-faturamento"/></svg>Pagar carga</button>
      <button type="button" class="btn btn-sec btn-sm frete-btn-editar" onclick="freteEditarUI('${k}')" aria-label="Editar a carga ${esc(l.carga)}" title="Editar transportadora, CT-E, data do pagamento, observação e canhoto"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-lapis"/></svg><span class="frete-btn-rot">Editar</span></button>
      <button type="button" class="btn btn-sec btn-sm frete-btn-hist" onclick="freteHistoricoUI('${k}')" aria-label="Histórico da carga ${esc(l.carga)}" title="Pagamentos, tratativas e quem mexeu"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-historico"/></svg><span class="frete-btn-rot">Histórico</span></button>
      <button type="button" class="btn btn-danger btn-sm frete-btn-excluir" onclick="freteExcluirUI('${k}')" aria-label="Excluir a carga ${esc(l.carga)} do controle" title="Tirar esta carga do controle (fica em Excluídas, com o motivo)"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-lixeira"/></svg><span class="frete-btn-rot">Excluir</span></button></td>
  </tr>`;
}
const FRETE_CAB_NOTA = ['Nota', 'Situação no B2B', 'Cliente', 'Status', 'Data do status', 'Pagamento', 'Transportadora', 'CT-E', 'Observação'];
function freteLinhaNotaHtml(l){
  const n = { ...l, primeira: false, _dobravel: false, _aberta: true };   // a célula é DA NOTA
  const cel = (chave, rot) => freteCelula(n, { chave }, freteIx(chave)).replace(/^<td/, `<td data-rotulo="${esc(rot)}"`);
  const rotulo = String(l.v[freteIx('resumo')] || '').replace(/^\S+\s*\(/, '').replace(/\)$/, '');
  const idade = l.idadeDias != null ? `<small class="frete-idade${l.idadeDias > 7 ? ' frete-idade-velha' : ''}">sem olhar há ${l.idadeDias} dia${l.idadeDias === 1 ? '' : 's'}</small>` : '';
  return `<tr class="frete-nota" data-carga="${esc(l.carga)}" data-nota="${esc(l.nota)}">
    <td data-col="resumo" data-rotulo="Nota" class="frete-nota-num">${esc(l.nota)}</td>
    <td data-col="b2b" data-rotulo="Situação no B2B" class="frete-r frete-r-${esc(l.categoria || 'outro')}">${esc(rotulo)}${idade}</td>
    <td data-col="cliente" data-rotulo="Cliente" class="frete-cliente">${esc(l.cliente || '—')}${l.cidade ? `<small>${esc(l.cidade)}</small>` : ''}</td>
    ${cel('tratativa', 'Status')}${cel('dataTratativa', 'Data do status')}${cel('dataPagamento', 'Pagamento')}
    ${cel('transportadora', 'Transportadora')}${cel('cte', 'CT-E')}
    <td data-col="observacao" data-rotulo="Observação" class="frete-obs"><button type="button" class="frete-edit" onclick="freteEditarObs('${escJs(l.carga)}','${escJs(l.nota)}')"
      aria-label="Observação da nota ${esc(l.nota)}. Editar">${l.obsNota ? esc(l.obsNota) : '<span class="frete-vazio">anotar</span>'}</button></td>
  </tr>`;
}

function freteDesenharTabela(){
  const d = FRETE.dados;
  if(!d) return;
  const { linhas, cargas, total } = freteLinhasVisiveis();
  document.getElementById('frete-thead').innerHTML = FRETE_CAB.map(([c, t]) =>
    `<th scope="col" class="frete-h frete-h-${c}${c === 'acoes' ? ' no-print' : ''}" data-col="${c}">${esc(t)}</th>`).join('');
  const grupos = [];
  for(const l of linhas){
    if(l.primeira) grupos.push({ cab: l, notas: [] });
    if(l.nota && grupos.length) grupos[grupos.length - 1].notas.push(l);
  }
  document.getElementById('frete-tbody').innerHTML = grupos.map(({ cab, notas }) => {
    const aberta = notas.length > 0 && (notas.length === 1 || FRETE.abertas.has(String(cab.carga)));
    return freteLinhaCargaHtml(cab, notas, aberta) + (aberta ? `<tr class="frete-notas-tr" data-carga="${esc(cab.carga)}"><td colspan="${FRETE_CAB.length}">
        <table class="frete-notas" aria-label="Notas pendentes da carga ${esc(cab.carga)}"><thead><tr>${FRETE_CAB_NOTA.map((t) => `<th scope="col">${esc(t)}</th>`).join('')}</tr></thead>
        <tbody>${notas.map(freteLinhaNotaHtml).join('')}</tbody></table></td></tr>` : '');
  }).join('');
  const el = document.getElementById('frete-contagem');
  if(el) el.textContent = cargas === total ? `${total} carga(s)` : `Mostrando ${cargas} de ${total} carga(s)`;
  const vazio = document.getElementById('frete-empty');
  vazio.hidden = linhas.length > 0;
  vazio.textContent = total === 0
    ? 'Nenhuma carga no controle ainda. Use "Importar relatórios (PDF)" com o relatório do B2B e o do Atak de cada carga.'
    : 'Nenhuma carga com este filtro.';
}

function freteDesenharResumo(){
  const r = FRETE.dados.resumo;
  const box = document.getElementById('frete-detalhes');
  box.hidden = false;
  const liga = new Set(FRETE.dados.vocabulario.liberam || []);
  document.getElementById('frete-res-tratativas').innerHTML = `
    <thead><tr><th scope="col">Tratativa</th><th scope="col">Pendências</th><th scope="col">% do total</th></tr></thead>
    <tbody>${r.tratativas.map((t) => `<tr><td>${liga.has(t.chave) ? `<strong>${esc(t.nome)}</strong> <small>(libera o pagamento)</small>` : esc(t.nome)}</td>
      <td>${t.qtd}</td><td>${esc(fretePct(t.pct))}</td></tr>`).join('')}
      <tr class="frete-total"><td>Total</td><td>${r.pendAbertas}</td><td>${r.pendAbertas ? '100,0%' : '0,0%'}</td></tr></tbody>`;
  document.getElementById('frete-res-transportadoras').innerHTML = `
    <thead><tr><th scope="col">Transportadora</th><th scope="col">Cargas</th><th scope="col">Liberadas</th><th scope="col">Pendentes</th>
      <th scope="col">Verificar</th><th scope="col">Pendências</th><th scope="col">% entregue</th></tr></thead>
    <tbody>${r.transportadoras.map((t) => `<tr><td>${esc(t.nome || '(sem transportadora)')}</td><td>${t.cargas}</td><td>${t.liberadas}</td>
      <td>${t.pendentes}</td><td>${t.verificar}</td><td>${t.pendAbertas}</td><td>${esc(t.entregue === null ? '—' : fretePct(t.entregue))}</td></tr>`).join('')}</tbody>`;
  /* FECHAMENTO (rodada 45): por mês do pagamento, provisão e idade — contagem de notas. */
  const fe = document.getElementById('frete-res-fechamento');
  if(fe && r.porMes){
    const mesBr = (m) => (m === 'sem data' ? 'Sem data de pagamento' : `${m.slice(5, 7)}/${m.slice(0, 4)}`);
    const n1 = (x) => esc(String(x).replace('.', ','));
    fe.innerHTML = `
      <thead><tr><th scope="col">Mês do pagamento</th><th scope="col">Lançamentos</th><th scope="col">Cargas</th><th scope="col">Notas pagas</th></tr></thead>
      <tbody>${r.porMes.length ? r.porMes.map((m) => `<tr><td>${esc(mesBr(m.mes))}</td><td>${m.pagamentos}</td><td>${m.cargas}</td><td>${n1(m.notas)}</td></tr>`).join('') : '<tr><td colspan="4">Nenhum pagamento registrado.</td></tr>'}
        <tr class="frete-fech-prov"><td><strong>Provisão</strong> <small>liberado e não pago</small></td><td></td><td>${r.provisao.cargas}</td><td><strong>${n1(r.provisao.notas)}</strong></td></tr>
        <tr><td colspan="4" class="frete-fech-idade"><strong>Pendências sem tratativa por idade:</strong> 0–7 dias <b>${r.idade.ate7}</b> · 8–14 <b>${r.idade.de8a14}</b> · 15+ <b>${r.idade.mais15}</b>${r.idade.maisAntiga != null ? ` · a mais antiga há <b>${r.idade.maisAntiga}</b> dias` : ''}</td></tr>
      </tbody>`;
  }
}

/* ------------------------------------------------------------- modal */
function freteModal(titulo, corpo, botoes, larga){
  let m = document.getElementById('modal-frete');
  if(!m){
    m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'modal-frete';
    m.addEventListener('keydown', (ev) => { if(ev.key === 'Escape') freteFecharModal(); });
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="modal-box modal-box-frete${larga ? ' larga' : ''}" role="dialog" aria-modal="true" aria-labelledby="frete-modal-titulo">
      <h2 id="frete-modal-titulo">${esc(titulo)}</h2>
      <div id="frete-modal-corpo">${corpo}</div>
      <div class="flex-end gap8 frete-modal-botoes" id="frete-modal-botoes">${(botoes || []).map((b) =>
        `<button type="button" class="btn ${b.classe || 'btn-sec'}" id="${b.id || ''}" onclick="${b.clique}">${b.icone ? `<svg class="ico ico-btn" aria-hidden="true"><use href="#${b.icone}"/></svg>` : ''}${esc(b.rotulo)}</button>`).join('')}</div>
    </div>`;
  m.classList.add('open');
  const foco = m.querySelector('[data-foco]') || m.querySelector('input,select,textarea,button');
  if(foco) setTimeout(() => foco.focus(), 30);
}
function freteFecharModal(){
  const m = document.getElementById('modal-frete');
  if(m) m.classList.remove('open');
  _freteImp = null;
}

/* ----------------------------------------------- editar: tratativa/campos */
/* NA VITRINE NADA GRAVA (05/10/2026): o dono mexeu na demonstração achando que
   era o painel e viu "não acontece nada". Toda ação diz isso, e diz o que
   faria no painel de verdade. */
function freteSoDemonstracao(oQueFaria){
  if(!FRETE.demonstracao) return false;
  notify(`Vitrine: aqui nada grava. No painel, ${oQueFaria}.`, 'warn', 7000);
  return true;
}

async function freteTratar(carga, nota, valor){
  if(freteSoDemonstracao('a tratativa é gravada e o % Liberado e o Status p/ pagamento mudam na hora')){ freteDesenhar(); return; }
  try{
    await SuincoSharePoint.frete.tratar(carga, nota, { tratativa: valor });
    await freteRecarregarSemPiscar();
  }catch(e){
    notify(freteMensagemDeErro(e), 'danger', 8000);
    freteDesenhar();   // volta a lista para o valor que o servidor tem
  }
}

/* Relê e redesenha mantendo onde a pessoa estava na tabela. */
async function freteRecarregarSemPiscar(){
  const wrap = document.querySelector('#tab-frete .frete-wrap');
  const pos = wrap ? { x: wrap.scrollLeft, y: wrap.scrollTop } : null;
  FRETE.carregando = false;
  await freteCarregar();
  if(pos){ const w = document.querySelector('#tab-frete .frete-wrap'); if(w){ w.scrollLeft = pos.x; w.scrollTop = pos.y; } }
}

function freteLinhaDaCarga(carga){
  return FRETE.dados.linhas.find((l) => String(l.carga) === String(carga) && l.primeira);
}

/* As transportadoras CADASTRADAS: as da Frota (Cadastros), mais a lista legada.
   Decisão do dono (05/10/2026): "deixar a seleção apenas para as cadastradas;
   se surgir uma nova, basta cadastrá-la e selecioná-la". O servidor confere
   o mesmo (dim_veiculos). */
function freteTransportadorasConhecidas(){
  const nomes = new Set();
  const frota = (typeof DB !== 'undefined' && Array.isArray(DB.frota)) ? DB.frota : [];
  frota.forEach((f) => { const n = String(f.transportadora || '').trim(); if(n) nomes.add(n); });
  const legado = (typeof DB !== 'undefined' && Array.isArray(DB.transportadoras)) ? DB.transportadoras : [];
  legado.forEach((t) => { const n = String(t.nome || '').trim(); if(n) nomes.add(n); });
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function freteEditarCarga(carga, campo){
  if(freteSoDemonstracao(campo === 'transportadora' ? 'a transportadora é escolhida entre as cadastradas' : 'o CT-E é gravado')) return;
  const l = freteLinhaDaCarga(carga);
  if(!l) return;
  const atual = freteDadosDaCarga(carga)[campo] || '';
  const rotulo = campo === 'transportadora' ? 'Transportadora' : 'CT-E';
  const lista = campo === 'transportadora' ? freteTransportadorasConhecidas() : null;
  const campoHtml = lista
    ? `<select id="frete-campo-valor" data-foco class="frete-sel-transp">
         <option value="">— em branco —</option>
         ${atual && !lista.includes(atual) ? `<option value="${esc(atual)}" selected>${esc(atual)} (não está no cadastro)</option>` : ''}
         ${lista.map((n) => `<option value="${esc(n)}"${n === atual ? ' selected' : ''}>${esc(n)}</option>`).join('')}
       </select>`
    : `<input type="text" id="frete-campo-valor" data-foco maxlength="40" value="${esc(atual)}"
         onkeydown="if(event.key==='Enter'){freteSalvarCarga('${escJs(carga)}','${campo}')}">`;
  const ajuda = lista
    ? (lista.length ? 'Só transportadoras cadastradas (Cadastros → Frota). Nova transportadora? Cadastre lá primeiro e escolha aqui.' : 'Nenhuma transportadora cadastrada na Frota ainda — cadastre em Cadastros → Frota e volte aqui.')
    : 'Mais de um CT-E? Separe por vírgula.';
  freteModal(`${rotulo} da carga ${carga}`,
    `<label class="frete-campo">${rotulo}
       ${campoHtml}</label>
     <div class="card-sub">${ajuda}</div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Salvar', classe: 'btn-primary', icone: 'i-ok', clique: `freteSalvarCarga('${escJs(carga)}','${campo}')` }]);
}
/* Marca/desmarca o canhoto original. O servidor decide e carimba a hora;
   a tela só adianta o visual e volta atrás se ele recusar. */
async function freteCanhoto(carga, marcado, input){
  if(freteSoDemonstracao('o canhoto é marcado com o dia e quem marcou')){ if(input) input.checked = !marcado; return; }
  if(input) input.disabled = true;
  try{
    await SuincoSharePoint.frete.editarCarga(carga, { canhotoOriginal: !!marcado });
    await freteRecarregarSemPiscar();
  }catch(e){
    if(input){ input.checked = !marcado; input.disabled = false; }
    notify(freteMensagemDeErro(e), 'danger', 8000);
  }
}
async function freteSalvarCarga(carga, campo){
  const valor = (document.getElementById('frete-campo-valor') || {}).value || '';
  try{
    await SuincoSharePoint.frete.editarCarga(carga, { [campo]: valor });
    freteFecharModal();
    await freteRecarregarSemPiscar();
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

/* Data do pagamento e data da tratativa, editáveis (decisão do dono, 05/10/2026). */
function freteEditarDataPagamento(carga){
  if(freteSoDemonstracao('a data do último pagamento é editada')) return;
  const l = freteLinhaDaCarga(carga);
  if(!l) return;
  const pago = l.v[freteIx('pago')];
  if(!(typeof pago === 'number' && pago > 0)){ fretePagarUI(carga); return; }   // sem pagamento, a data nasce no Pagar
  const atual = freteDadosDaCarga(carga).dataPagamento || '';
  freteModal(`Data do pagamento — carga ${carga}`,
    `<label class="frete-campo">Data do último pagamento
       <input type="date" id="frete-campo-data" data-foco value="${esc(atual)}"></label>
     <div class="card-sub">Muda a data do último pagamento registrado (${esc(fretePct(pago))} pago). Em branco = sem data.</div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Salvar', classe: 'btn-primary', icone: 'i-ok', clique: `freteSalvarDataPagamento('${escJs(carga)}')` }]);
}
async function freteSalvarDataPagamento(carga){
  const valor = (document.getElementById('frete-campo-data') || {}).value || null;
  try{
    await SuincoSharePoint.frete.editarCarga(carga, { dataPagamento: valor });
    freteFecharModal();
    await freteRecarregarSemPiscar();
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}
function freteEditarDataTratativa(carga, nota){
  if(freteSoDemonstracao('a data da tratativa é editada')) return;
  const l = FRETE.dados.linhas.find((x) => String(x.carga) === String(carga) && x.nota === nota);
  if(!l) return;
  const atual = l.v[freteIx('dataTratativa')] || '';
  const trat = l.v[freteIx('tratativa')] || '';
  freteModal(`Data da tratativa — nota ${nota}`,
    `<label class="frete-campo">Data da tratativa${trat ? ` (${esc(trat)})` : ''}
       <input type="date" id="frete-campo-data" data-foco value="${esc(atual)}"></label>
     <div class="card-sub">${trat ? 'O dia em que a nota foi consultada ou tratada.' : 'Esta nota ainda não tem tratativa: ao escolher uma na lista a data fica a do dia — ou informe a data aqui.'}</div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Salvar', classe: 'btn-primary', icone: 'i-ok', clique: `freteSalvarDataTratativa('${escJs(carga)}','${escJs(nota)}')` }]);
}
async function freteSalvarDataTratativa(carga, nota){
  const valor = (document.getElementById('frete-campo-data') || {}).value || null;
  try{
    await SuincoSharePoint.frete.tratar(carga, nota, { tratativaEm: valor });
    freteFecharModal();
    await freteRecarregarSemPiscar();
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

function freteEditarObs(carga, nota){
  if(freteSoDemonstracao('a observação é gravada')) return;
  const l = nota ? FRETE.dados.linhas.find((x) => String(x.carga) === String(carga) && x.nota === nota) : freteLinhaDaCarga(carga);
  if(!l) return;
  const daCarga = l.primeira ? `<label class="frete-campo">Observação da carga ${esc(carga)}
      <textarea id="frete-obs-carga" rows="2" maxlength="500">${esc(l.obsCarga || '')}</textarea></label>` : '';
  const daNota = nota ? `<label class="frete-campo">Observação da nota ${esc(nota)}
      <textarea id="frete-obs-nota" rows="2" maxlength="500" ${l.primeira ? '' : 'data-foco'}>${esc(l.obsNota || '')}</textarea></label>` : '';
  freteModal(nota ? `Observação — nota ${nota}` : `Observação — carga ${carga}`, daCarga + daNota,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Salvar', classe: 'btn-primary', icone: 'i-ok', clique: `freteSalvarObs('${escJs(carga)}','${escJs(nota)}')` }]);
}
async function freteSalvarObs(carga, nota){
  const doc = (id) => document.getElementById(id);
  try{
    if(doc('frete-obs-carga')) await SuincoSharePoint.frete.editarCarga(carga, { obs: doc('frete-obs-carga').value });
    if(doc('frete-obs-nota') && nota) await SuincoSharePoint.frete.tratar(carga, nota, { obs: doc('frete-obs-nota').value });
    freteFecharModal();
    await freteRecarregarSemPiscar();
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

/* ------------------------------------------------------------ pagamento */
function fretePagarUI(carga){
  if(freteSoDemonstracao('o pagamento é registrado e o Status p/ pagamento muda')) return;
  const l = freteLinhaDaCarga(carga);
  if(!l) return;
  const v = (k) => l.v[freteIx(k)];
  const aPagar = typeof v('aPagar') === 'number' ? v('aPagar') : null;
  const sugestao = aPagar && aPagar > 0 ? (Math.round(aPagar * 10000) / 100) : '';
  const conferir = v('aPagar') === 'conferir';
  freteModal(`Registrar pagamento — carga ${carga}`, `
    <div class="frete-resumo-carga">
      <span class="frete-sit frete-sit-${v('situacao') === 'LIBERADA' ? 'lib' : v('situacao') === 'PENDENTE' ? 'pend' : 'verif'}">${esc(v('situacao'))}</span>
      <span>Entregue <strong>${esc(fretePct(v('entregue')) || '—')}</strong></span>
      <span>Liberado <strong>${esc(conferir ? 'conferir' : (fretePct(v('liberado')) || '—'))}</strong></span>
      <span>Já pago <strong>${esc(fretePct(v('pago')) || '0,0%')}</strong></span>
      <span>A pagar <strong>${esc(conferir ? 'conferir' : (fretePct(v('aPagar')) || '—'))}</strong></span>
    </div>
    ${conferir ? '<div class="frete-alerta">Esta carga está para <strong>conferir</strong> (a contagem entre o sistema e o B2B não bate): nada está liberado. Se registrar, o painel pergunta antes.</div>' : ''}
    <div class="frete-form">
      <label class="frete-campo">Quanto da carga foi pago (%)
        <input type="number" id="frete-pg-pct" data-foco min="0.01" max="100" step="0.01" value="${sugestao}" inputmode="decimal"></label>
      <label class="frete-campo">Data do pagamento <small>(pode ficar em branco)</small>
        <input type="date" id="frete-pg-data"></label>
    </div>
    <label class="frete-campo">Observação <small>(opcional)</small>
      <input type="text" id="frete-pg-obs" maxlength="500"></label>
    <div class="card-sub">O percentual é pela <strong>quantidade de notas</strong> (80 de 100 canhotos = 80%). Sem valor em R$.</div>
    <div id="frete-pergunta" class="frete-alerta" hidden></div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Registrar pagamento', classe: 'btn-primary', id: 'frete-btn-registrar', icone: 'i-ok', clique: `freteRegistrarPagamento('${escJs(carga)}', false)` }]);
}

async function freteRegistrarPagamento(carga, confirmar){
  const doc = (id) => document.getElementById(id);
  const pct = Number(String(doc('frete-pg-pct').value).replace(',', '.'));
  if(!(pct > 0 && pct <= 100)){ notify('Informe o percentual pago, de 0,01 a 100.', 'warn'); return; }
  const corpo = { pct, dataPagamento: doc('frete-pg-data').value || null, obs: doc('frete-pg-obs').value, confirmar: !!confirmar };
  const botao = doc('frete-btn-registrar');
  if(botao) botao.disabled = true;
  try{
    const r = await SuincoSharePoint.frete.pagar(carga, corpo);
    freteFecharModal();
    notify(`Pagamento registrado. Carga ${carga} com ${String(r.pagoTotal).replace('.', ',')}% pago.`, 'success');
    await freteRecarregarSemPiscar();
  }catch(e){
    if(botao) botao.disabled = false;
    if(e && e.status === 409 && e.dados && e.dados.podeConfirmar){
      /* Pergunta, não bloqueio: quem tem autoridade decide, depois de ver o número. */
      const p = doc('frete-pergunta');
      p.hidden = false;
      p.innerHTML = `${esc(e.message)}
        <div class="flex-end gap8" style="margin-top:8px">
          <button type="button" class="btn btn-sec btn-sm" onclick="document.getElementById('frete-pergunta').hidden=true">Voltar</button>
          <button type="button" class="btn btn-serio btn-sm" onclick="freteRegistrarPagamento('${escJs(carga)}', true)">Registrar mesmo assim</button>
        </div>`;
      return;
    }
    notify(freteMensagemDeErro(e), 'danger', 9000);
  }
}

/* ------------------------------------------------------------ histórico */
async function freteHistoricoUI(carga){
  if(freteSoDemonstracao('o histórico mostra pagamentos, notas e quem mexeu')) return;
  freteModal(`Histórico — carga ${carga}`, '<div class="card-sub">Carregando…</div>', [{ rotulo: 'Fechar', clique: 'freteFecharModal()' }], true);
  let h;
  try{ h = await SuincoSharePoint.frete.historico(carga); }
  catch(e){ document.getElementById('frete-modal-corpo').innerHTML = `<div class="frete-alerta">${esc(freteMensagemDeErro(e))}</div>`; return; }
  const dt = (iso) => (iso ? fmtDataHora(iso) : '');
  const pagamentos = h.pagamentos.length ? `<div class="table-wrap"><table class="frete-mini"><thead><tr>
      <th scope="col">Registrado</th><th scope="col">%</th><th scope="col">Data do pagamento</th><th scope="col">Por</th><th scope="col">Situação</th><th scope="col"></th></tr></thead><tbody>
      ${h.pagamentos.map((p) => `<tr class="${p.anuladoEm ? 'frete-anulado' : ''}"><td>${esc(dt(p.criadoEm))}</td><td>${esc(String(p.pct).replace('.', ','))}%</td>
        <td>${esc(p.dataPagamento ? freteData(p.dataPagamento) : 'sem data')}</td><td>${esc(p.por)}</td>
        <td>${p.anuladoEm ? `Anulado por ${esc(p.anuladoPor)} em ${esc(dt(p.anuladoEm))}: ${esc(p.anuladoMotivo)}` : 'Valendo'}</td>
        <td>${p.anuladoEm ? '' : `<button type="button" class="btn btn-danger btn-sm" onclick="freteAnularUI('${escJs(carga)}', ${Number(p.id)})">Anular</button>`}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card-sub">Nenhum pagamento registrado.</div>';
  const pend = h.pendencias.length ? `<div class="table-wrap"><table class="frete-mini"><thead><tr>
      <th scope="col">Nota</th><th scope="col">Situação no B2B</th><th scope="col">Cliente</th><th scope="col">Visto em</th><th scope="col">Tratativa</th><th scope="col">Resolvida em</th></tr></thead><tbody>
      ${h.pendencias.map((p) => `<tr class="${p.resolvidaEm ? 'frete-resolvida' : ''}"><td>${esc(p.nota)}</td>
        <td>${esc(p.statusB2b || ({ aguardando: 'Aguardando', nao_entregue: 'Não entregue', nao_localizada: 'Não localizada no B2B', so_b2b: 'Só no B2B' }[p.categoria] || ''))}</td>
        <td>${esc(p.cliente)}</td><td>${esc(freteData(p.vistoEm))}</td>
        <td>${esc(p.tratativa || '—')}${p.tratativaEm ? ` · ${esc(freteData(p.tratativaEm))}` : ''}</td>
        <td>${esc(p.resolvidaEm ? freteData(p.resolvidaEm) : '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card-sub">Nenhuma pendência.</div>';
  const ROTULO = { conferencia: 'Conferência dos relatórios', editou_carga: 'Editou a carga', tratativa: 'Tratativa', pagamento: 'Pagamento', anulou_pagamento: 'Anulou pagamento', exportou: 'Exportou a planilha', canhoto: 'Canhoto original', excluiu: 'Excluiu do controle', restaurou: 'Restaurou' };
  const detalhe = (e) => (e.acao === 'canhoto' && e.detalhe ? (e.detalhe.para ? ' · marcou: veio' : ' · desmarcou')
    : e.acao === 'excluiu' && e.detalhe ? ` · ${e.detalhe.motivo || ''}`
    : e.acao === 'restaurou' && e.detalhe ? (e.detalhe.pela === 'reimportacao' ? ' · pela reimportação do PDF' : ' · pelo botão Restaurar') : '');
  const eventos = h.eventos.length ? `<ul class="frete-eventos">${h.eventos.map((e) => `<li><strong>${esc(ROTULO[e.acao] || e.acao)}</strong>${esc(detalhe(e))}${e.nota ? ` · nota ${esc(e.nota)}` : ''}
      <span>${esc(e.por)} · ${esc(dt(e.em))}</span></li>`).join('')}</ul>` : '<div class="card-sub">Sem eventos.</div>';
  const excl = h.excluida ? `<div class="frete-alerta">Excluída do controle por <strong>${esc(h.excluida.por)}</strong> em ${esc(dt(h.excluida.em))}: ${esc(h.excluida.motivo)}</div>` : '';
  document.getElementById('frete-modal-corpo').innerHTML = excl +
    `<h3 class="frete-h3">Pagamentos</h3>${pagamentos}<h3 class="frete-h3">Notas (pendências desta carga)</h3>${pend}<h3 class="frete-h3">Quem mexeu</h3>${eventos}`;
}

function freteAnularUI(carga, id){
  freteModal('Anular pagamento',
    `<label class="frete-campo">Por que este pagamento está sendo anulado?
       <input type="text" id="frete-anular-motivo" data-foco maxlength="300" placeholder="Ex.: lançado na carga errada"></label>
     <div class="card-sub">O pagamento não é apagado: continua no histórico, marcado como anulado.</div>`,
    [{ rotulo: 'Voltar', clique: `freteHistoricoUI('${escJs(carga)}')` },
     { rotulo: 'Anular pagamento', classe: 'btn-danger', clique: `freteConfirmarAnular('${escJs(carga)}', ${Number(id)})` }]);
}
async function freteConfirmarAnular(carga, id){
  const motivo = (document.getElementById('frete-anular-motivo') || {}).value || '';
  if(!motivo.trim()){ notify('Diga o motivo da anulação.', 'warn'); return; }
  try{
    await SuincoSharePoint.frete.anular(id, motivo);
    notify('Pagamento anulado.', 'success');
    await freteRecarregarSemPiscar();
    freteHistoricoUI(carga);
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

/* --------------------------------------------- editar a carga (06/10/2026) */
/* Pedido do dono: "excluir e editar" no fim da linha. Decisão dele: um
   formulário só, com o que a pessoa preenche — transportadora, CT-E, data do
   pagamento, observação e canhoto. Os números de notas vêm dos PDFs e NÃO se
   editam à mão (o painel deixaria de bater com o relatório). Grava só o que
   mudou, num pedido só; o servidor decide e registra no histórico. */
function freteEditarUI(carga){
  if(freteSoDemonstracao('o formulário grava transportadora, CT-E, data do pagamento, observação e canhoto')) return;
  const l = freteLinhaDaCarga(carga);
  if(!l) return;
  const v = (k) => l.v[freteIx(k)];
  const dc = freteDadosDaCarga(carga);
  const transp = dc.transportadora || '';
  const lista = freteTransportadorasConhecidas();
  const pago = v('pago');
  const temPago = typeof pago === 'number' && pago > 0;
  const canhoto = v('canhoto') === 'SIM';
  freteModal(`Editar carga ${carga}`, `
    <div class="frete-form">
      <label class="frete-campo">Transportadora
        <select id="frete-ed-transp" data-foco class="frete-sel-transp">
          <option value="">— em branco —</option>
          ${transp && !lista.includes(transp) ? `<option value="${esc(transp)}" selected>${esc(transp)} (não está no cadastro)</option>` : ''}
          ${lista.map((n) => `<option value="${esc(n)}"${n === transp ? ' selected' : ''}>${esc(n)}</option>`).join('')}
        </select></label>
      <label class="frete-campo">CT-E <small>(mais de um: separe por vírgula)</small>
        <input type="text" id="frete-ed-cte" maxlength="40" value="${esc(dc.cte || '')}"></label>
    </div>
    <div class="frete-form">
      <label class="frete-campo">Data do último pagamento da carga
        ${temPago
          ? `<input type="date" id="frete-ed-data" value="${esc(dc.dataPagamento || '')}">`
          : '<span class="card-sub" id="frete-ed-data-nao">Sem pagamento registrado — a data nasce no botão Pagar.</span>'}</label>
      <label class="frete-campo frete-check-campo"><span>Canhoto original</span>
        <span class="frete-check"><input type="checkbox" id="frete-ed-canhoto"${canhoto ? ' checked' : ''}> veio</span></label>
    </div>
    <label class="frete-campo">Observação da carga
      <textarea id="frete-ed-obs" rows="2" maxlength="500">${esc(l.obsCarga || '')}</textarea></label>
    <div class="card-sub">Os números de notas (Sist., B2B, finalizadas…) vêm dos relatórios importados e não se editam aqui.</div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Salvar', classe: 'btn-primary', id: 'frete-ed-salvar', icone: 'i-ok', clique: `freteSalvarEdicao('${escJs(carga)}')` }]);
}
async function freteSalvarEdicao(carga){
  const l = freteLinhaDaCarga(carga);
  if(!l) return;
  const doc = (id) => document.getElementById(id);
  const v = (k) => l.v[freteIx(k)];
  const dc = freteDadosDaCarga(carga);
  const corpo = {};
  if(doc('frete-ed-transp').value !== (dc.transportadora || '')) corpo.transportadora = doc('frete-ed-transp').value;
  if(doc('frete-ed-cte').value.trim() !== (dc.cte || '')) corpo.cte = doc('frete-ed-cte').value;
  if(doc('frete-ed-obs').value.trim() !== (l.obsCarga || '')) corpo.obs = doc('frete-ed-obs').value;
  if(doc('frete-ed-canhoto').checked !== (v('canhoto') === 'SIM')) corpo.canhotoOriginal = doc('frete-ed-canhoto').checked;
  if(doc('frete-ed-data') && (doc('frete-ed-data').value || '') !== (dc.dataPagamento || '')) corpo.dataPagamento = doc('frete-ed-data').value || null;
  if(!Object.keys(corpo).length){ freteFecharModal(); notify('Nada mudou.', 'info'); return; }
  const botao = doc('frete-ed-salvar');
  if(botao) botao.disabled = true;
  try{
    await SuincoSharePoint.frete.editarCarga(carga, corpo);
    freteFecharModal();
    notify(`Carga ${carga} atualizada.`, 'success');
    await freteRecarregarSemPiscar();
  }catch(e){
    if(botao) botao.disabled = false;
    notify(freteMensagemDeErro(e), 'danger', 9000);
  }
}

/* ---------------------------------- campos e pagamento DA NOTA (06/10/2026) */
function freteLinhaDaNota(carga, nota){
  return FRETE.dados.linhas.find((x) => String(x.carga) === String(carga) && x.nota === nota);
}
function freteEditarNota(carga, nota, campo){
  if(freteSoDemonstracao(`${campo === 'transportadora' ? 'a transportadora' : 'o CT-E'} desta nota é gravado`)) return;
  const l = freteLinhaDaNota(carga, nota);
  if(!l) return;
  const propria = campo === 'transportadora' ? l.notaTransportadora : l.notaCte;
  const daCargaReal = campo === 'transportadora' ? (freteDadosDaCarga(carga).transportadora || '') : (freteDadosDaCarga(carga).cte || '');
  const rotulo = campo === 'transportadora' ? 'Transportadora' : 'CT-E';
  const lista = campo === 'transportadora' ? freteTransportadorasConhecidas() : null;
  const campoHtml = lista
    ? `<select id="frete-campo-valor" data-foco class="frete-sel-transp">
         <option value="">— a da carga${daCargaReal ? ` (${esc(daCargaReal)})` : ''} —</option>
         ${propria && !lista.includes(propria) ? `<option value="${esc(propria)}" selected>${esc(propria)} (não está no cadastro)</option>` : ''}
         ${lista.map((n) => `<option value="${esc(n)}"${n === propria ? ' selected' : ''}>${esc(n)}</option>`).join('')}
       </select>`
    : `<input type="text" id="frete-campo-valor" data-foco maxlength="40" value="${esc(propria || '')}" placeholder="${esc(daCargaReal ? `o da carga: ${daCargaReal}` : 'em branco')}"
         onkeydown="if(event.key==='Enter'){freteSalvarNota('${escJs(carga)}','${escJs(nota)}','${campo}')}">`;
  freteModal(`${rotulo} — nota ${nota} (carga ${carga})`,
    `<label class="frete-campo">${rotulo} desta nota
       ${campoHtml}</label>
     <div class="card-sub">Em branco, vale ${campo === 'transportadora' ? 'a transportadora' : 'o CT-E'} da carga. Preencha só quando esta nota tiver outro (reentrega, CT-E complementar).</div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Salvar', classe: 'btn-primary', icone: 'i-ok', clique: `freteSalvarNota('${escJs(carga)}','${escJs(nota)}','${campo}')` }]);
}
/* O que a CARGA tem (não o que a linha mostra, que pode ser o da nota). */
function freteDadosDaCarga(carga){
  const l = freteLinhaDaCarga(carga);
  return l ? { transportadora: l.cargaTransportadora ?? '', cte: l.cargaCte ?? '', dataPagamento: l.cargaDataPagamento ?? null } : {};
}
async function freteSalvarNota(carga, nota, campo){
  const valor = (document.getElementById('frete-campo-valor') || {}).value || '';
  try{
    await SuincoSharePoint.frete.tratar(carga, nota, { [campo]: valor });
    freteFecharModal();
    await freteRecarregarSemPiscar();
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

function fretePagarNotaUI(carga, nota){
  if(freteSoDemonstracao('o pagamento desta nota é registrado com a data e soma uma nota no % pago')) return;
  const l = freteLinhaDaNota(carga, nota);
  if(!l) return;
  const qtd = Number((freteLinhaDaCarga(carga) || l).v[freteIx('qtdSist')]) || 0;
  const pct = qtd ? Math.round(10000 / qtd) / 100 : null;
  const trat = l.v[freteIx('tratativa')] || '';
  freteModal(`Pagar a nota ${nota} — carga ${carga}`, `
    <div class="frete-resumo-carga">
      <span>Nota <strong>${esc(nota)}</strong></span>
      <span>Status <strong>${esc(trat || 'falta olhar')}</strong></span>
      ${pct !== null ? `<span>Soma <strong>1 nota</strong> de ${qtd} (${esc(String(pct).replace('.', ','))}%) no % pago</span>` : ''}
    </div>
    ${l.tratativaLibera ? '' : '<div class="frete-alerta">Esta nota ainda não está liberada (o status dela não é OK nem DEVOLUÇÃO). Se registrar, o painel pergunta antes.</div>'}
    <label class="frete-campo">Data do pagamento
      <input type="date" id="frete-pn-data" data-foco value="${esc(diaLocalISO(new Date()))}"></label>
    <div id="frete-pergunta" class="frete-alerta" hidden></div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Registrar pagamento da nota', classe: 'btn-primary', id: 'frete-btn-pagar-nota', icone: 'i-ok', clique: `fretePagarNota('${escJs(carga)}','${escJs(nota)}', false)` }]);
}
async function fretePagarNota(carga, nota, confirmar){
  const data = (document.getElementById('frete-pn-data') || {}).value || '';
  if(!data){ notify('Informe a data do pagamento da nota.', 'warn'); return; }
  const botao = document.getElementById('frete-btn-pagar-nota');
  if(botao) botao.disabled = true;
  try{
    const r = await SuincoSharePoint.frete.pagarNota(carga, nota, { dataPagamento: data, confirmar: !!confirmar });
    freteFecharModal();
    notify(`Nota ${nota} paga em ${freteData(data)}. Carga ${carga} com ${String(r.pagoTotal).replace('.', ',')}% pago.`, 'success');
    await freteRecarregarSemPiscar();
  }catch(e){
    if(botao) botao.disabled = false;
    if(e && e.status === 409 && e.dados && e.dados.podeConfirmar){
      const p = document.getElementById('frete-pergunta');
      p.hidden = false;
      p.innerHTML = `${esc(e.message)}
        <div class="flex-end gap8" style="margin-top:8px">
          <button type="button" class="btn btn-sec btn-sm" onclick="document.getElementById('frete-pergunta').hidden=true">Voltar</button>
          <button type="button" class="btn btn-serio btn-sm" onclick="fretePagarNota('${escJs(carga)}','${escJs(nota)}', true)">Pagar mesmo assim</button>
        </div>`;
      return;
    }
    notify(freteMensagemDeErro(e), 'danger', 9000);
  }
}
function freteEditarDataNota(carga, nota){
  if(freteSoDemonstracao('a data do pagamento desta nota é editada')) return;
  const l = freteLinhaDaNota(carga, nota);
  if(!l || !l.notaPaga) return;
  freteModal(`Pagamento da nota ${nota} — carga ${carga}`,
    `<label class="frete-campo">Data do pagamento desta nota
       <input type="date" id="frete-campo-data" data-foco value="${esc(l.notaPaga.data || '')}"></label>
     <div class="card-sub">Para desfazer o pagamento da nota, use <strong>Anular</strong>: ele continua no histórico, marcado como anulado, e a carga volta a ter a nota em aberto.</div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Anular pagamento', classe: 'btn-danger', clique: `freteAnularUI('${escJs(carga)}', ${Number(l.notaPaga.id)})` },
     { rotulo: 'Salvar data', classe: 'btn-primary', icone: 'i-ok', clique: `freteSalvarDataNota('${escJs(carga)}','${escJs(nota)}')` }]);
}
async function freteSalvarDataNota(carga, nota){
  const valor = (document.getElementById('frete-campo-data') || {}).value || '';
  if(!valor){ notify('Informe a data. Para desfazer o pagamento, use Anular.', 'warn'); return; }
  try{
    await SuincoSharePoint.frete.tratar(carga, nota, { dataPagamento: valor });
    freteFecharModal();
    await freteRecarregarSemPiscar();
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

/* --------------------------------------------- excluir a carga (06/10/2026) */
/* Decisão do dono: SAI DA LISTA E FICA NO HISTÓRICO. Motivo obrigatório; com
   pagamento registrado, a janela já avisa e o servidor pergunta de novo se a
   tela estiver desatualizada. Volta pela lista "Excluídas" ou reimportando. */
function freteExcluirUI(carga){
  if(freteSoDemonstracao('a carga sai da lista e fica em Excluídas, com o motivo')) return;
  const l = freteLinhaDaCarga(carga);
  if(!l) return;
  const pago = l.v[freteIx('pago')];
  const temPago = typeof pago === 'number' && pago > 0;
  freteModal(`Excluir carga ${carga} do controle`, `
    ${temPago ? `<div class="frete-alerta">Esta carga tem <strong>${esc(fretePct(pago))}</strong> pago registrado. Os pagamentos não são apagados: continuam no histórico dela.</div>` : ''}
    <label class="frete-campo">Por que esta carga sai do controle?
      <input type="text" id="frete-excluir-motivo" data-foco maxlength="300" placeholder="Ex.: importada por engano; carga cancelada"
             onkeydown="if(event.key==='Enter'){freteConfirmarExclusao('${escJs(carga)}', ${temPago})}"></label>
    <div class="card-sub">Ela sai da lista, da planilha e do PDF. Fica em <strong>Excluídas</strong> com quem excluiu, quando e o motivo — e pode ser restaurada. Importar o PDF dela de novo também a traz de volta.</div>
    <div id="frete-excluir-pergunta" class="frete-alerta" hidden></div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Excluir do controle', classe: 'btn-danger', id: 'frete-excluir-confirmar', icone: 'i-lixeira', clique: `freteConfirmarExclusao('${escJs(carga)}', ${temPago})` }]);
}
async function freteConfirmarExclusao(carga, confirmar){
  const motivo = ((document.getElementById('frete-excluir-motivo') || {}).value || '').trim();
  if(!motivo){
    notify('Diga o motivo da exclusão.', 'warn');
    const m = document.getElementById('frete-excluir-motivo'); if(m) m.focus();
    return;
  }
  const botao = document.getElementById('frete-excluir-confirmar');
  if(botao) botao.disabled = true;
  try{
    await SuincoSharePoint.frete.excluir(carga, motivo, confirmar);
    freteFecharModal();
    notify(`Carga ${carga} excluída do controle. Ela está em "Excluídas", com o motivo.`, 'success', 7000);
    await freteRecarregarSemPiscar();
  }catch(e){
    if(botao) botao.disabled = false;
    if(e && e.status === 409 && e.dados && e.dados.podeConfirmar){
      const p = document.getElementById('frete-excluir-pergunta');
      p.hidden = false;
      p.innerHTML = `${esc(e.message)}
        <div class="flex-end gap8" style="margin-top:8px">
          <button type="button" class="btn btn-sec btn-sm" onclick="document.getElementById('frete-excluir-pergunta').hidden=true">Voltar</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="freteConfirmarExclusao('${escJs(carga)}', true)">Excluir mesmo assim</button>
        </div>`;
      return;
    }
    notify(freteMensagemDeErro(e), 'danger', 9000);
  }
}

async function freteExcluidasUI(){
  if(freteSoDemonstracao('a lista mostra as cargas excluídas, com o motivo, e permite restaurar')) return;
  freteModal('Cargas excluídas do controle', '<div class="card-sub">Carregando…</div>', [{ rotulo: 'Fechar', clique: 'freteFecharModal()' }], true);
  let r;
  try{ r = await SuincoSharePoint.frete.excluidas(); }
  catch(e){ document.getElementById('frete-modal-corpo').innerHTML = `<div class="frete-alerta">${esc(freteMensagemDeErro(e))}</div>`; return; }
  const corpo = document.getElementById('frete-modal-corpo');
  if(!corpo) return;
  corpo.innerHTML = r.cargas.length ? `<div class="table-wrap"><table class="frete-mini" id="frete-excluidas"><thead><tr>
      <th scope="col">Carga</th><th scope="col">Transportadora</th><th scope="col">Excluída em</th><th scope="col">Por</th><th scope="col">Motivo</th><th scope="col">Pago</th><th scope="col"></th></tr></thead><tbody>
      ${r.cargas.map((c) => `<tr data-carga="${esc(c.carga)}"><td>${esc(c.carga)}</td><td>${esc(c.transportadora || '—')}</td>
        <td>${esc(fmtDataHora(c.excluidaEm))}</td><td>${esc(c.excluidaPor)}</td><td>${esc(c.motivo)}</td>
        <td>${c.pctPago ? esc(String(c.pctPago).replace('.', ',')) + '%' : '—'}</td>
        <td class="frete-acoes"><button type="button" class="btn btn-sec btn-sm" onclick="freteHistoricoUI('${escJs(c.carga)}')">Histórico</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="freteRestaurar('${escJs(c.carga)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-desfazer"/></svg>Restaurar</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card-sub">Nenhuma carga excluída.</div>';
}
async function freteRestaurar(carga){
  try{
    await SuincoSharePoint.frete.restaurar(carga);
    notify(`Carga ${carga} restaurada: voltou para a lista.`, 'success');
    await freteRecarregarSemPiscar();
    freteExcluidasUI();
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

/* ------------------------------------------------------------- exportar */
async function freteExportar(){
  if(freteSoDemonstracao('o .xlsx idêntico à tela é baixado')) return;
  try{
    /* O arquivo é o que está na tela: com filtro, vão as cargas que ficaram e o texto do filtro. */
    const params = freteTemFiltro()
      ? { cargas: freteLinhasVisiveis().linhas.filter((l) => l.primeira).map((l) => String(l.carga)).join(','), filtros: freteDescreverFiltro() }
      : null;
    const { blob, nome } = await SuincoSharePoint.frete.baixarPlanilha(params);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    notify('Planilha exportada. É a mesma que está na tela.', 'success');
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

/* --------------------------------------------------------- exportar PDF */
/* O PDF DETALHADO (06/10/2026). Pedido do dono: os relatórios do pagamento de
   frete ficam NESTA aba, saem com o filtro aplicado, e "preciso que seja
   detalhado". Então o PDF é a tela em papel: as mesmas cargas que o filtro
   deixou, na mesma ordem, cada uma com as notas pendentes embaixo — o status
   da nota no B2B, a tratativa, quando e por quê.

   NADA É CALCULADO AQUI. Situação, percentuais e status vêm prontos do
   servidor (a mesma grade do .xlsx); o PDF só conta quantas cargas e quantas
   notas estão na folha. Quem gera é o servidor, como todo PDF do painel, e
   quem pode gerar é o setor Pagamento de Frete e a Administração
   (`pagamento-frete` em backend/src/dominio/documentos.js). */
async function freteExportarPdf(){
  if(freteSoDemonstracao('o PDF detalhado, com o filtro e as notas de cada carga, é gerado pelo servidor')) return;
  const el = document.getElementById('print-pagamento-frete');
  if(!el) return;
  /* Relê antes de imprimir: papel é o que vai para a reunião, e precisa ser o
     estado de agora — não o de quando a aba foi aberta. */
  await freteCarregar();
  if(FRETE.erro || !FRETE.dados){ notify(FRETE.erro || 'Não consegui ler o controle no servidor.', 'danger', 8000); return; }
  const doc = freteMontarPdf();
  el.innerHTML = doc.html;
  await exportarViaServidor(el, 'Pagamento de Frete', 'pagamento-frete', {
    orientacao: 'paisagem', carimbo: isoDiaLocal(new Date()), recorte: doc.recorte,
  });
}

/* As cargas da tela (filtro e ordem), cada uma com as suas linhas. */
function freteGruposVisiveis(){
  const { linhas, cargas, total } = freteLinhasVisiveis();
  const grupos = [];
  for(const l of linhas){
    const ultimo = grupos[grupos.length - 1];
    if(ultimo && String(ultimo.carga) === String(l.carga)) ultimo.linhas.push(l);
    else grupos.push({ carga: l.carga, linhas: [l] });
  }
  return { grupos, cargas, total };
}

function freteMontarPdf(){
  const I = {};
  for(const k of ['data', 'carga', 'qtdSist', 'qtdB2b', 'finalizadas', 'situacao', 'resumo', 'tratativa', 'statusPagamento', 'dataPagamento',
                  'transportadora', 'cte', 'entregue', 'liberado', 'pago', 'aPagar', 'dataTratativa', 'observacao', 'canhoto', 'canhotoEm']) I[k] = freteIx(k);
  const { grupos, cargas, total } = freteGruposVisiveis();
  const filtro = freteTemFiltro() ? freteDescreverFiltro() : '';
  const recorte = `${filtro || 'sem filtro — todas as cargas do controle'} · ${cargas} de ${total} carga(s)`;
  const traco = '<span class="text-dim">—</span>';
  const pctOuTexto = (v) => (typeof v === 'number' ? esc(fretePct(v)) : (v ? esc(String(v)) : traco));
  const cls = (v) => String(v || 'vazio').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');

  let pendencias = 0, semTratativa = 0;
  const conta = { LIBERADA: 0, PENDENTE: 0, VERIFICAR: 0 };
  const corpo = grupos.map((g) => {
    const p = g.linhas[0].v;
    const notas = g.linhas.filter((l) => l.nota);
    pendencias += notas.length;
    if(conta[p[I.situacao]] !== undefined) conta[p[I.situacao]] += 1;
    const canhoto = p[I.canhoto] === 'SIM'
      ? `SIM${p[I.canhotoEm] ? `<span class="fpdf-sub">${esc(freteData(p[I.canhotoEm]))}</span>` : ''}`
      : (p[I.canhoto] ? esc(p[I.canhoto]) : traco);
    const linhaCarga = `<tr class="fpdf-carga">
        <td>${esc(freteData(p[I.data])) || traco}</td>
        <td class="fpdf-num-carga">${esc(String(g.carga))}</td>
        <td class="fpdf-transp">${p[I.transportadora] ? esc(p[I.transportadora]) : traco}</td>
        <td>${p[I.cte] ? esc(String(p[I.cte])) : traco}</td>
        <td class="fpdf-n">${esc(freteNum(p[I.qtdSist])) || traco}</td>
        <td class="fpdf-n">${esc(freteNum(p[I.qtdB2b])) || traco}</td>
        <td class="fpdf-n">${esc(freteNum(p[I.finalizadas])) || traco}</td>
        <td><span class="fpdf-selo fpdf-sit-${cls(p[I.situacao])}">${esc(p[I.situacao] || '—')}</span></td>
        <td>${p[I.statusPagamento] ? `<span class="fpdf-selo fpdf-sp-${cls(p[I.statusPagamento])}">${esc(p[I.statusPagamento])}</span>` : traco}</td>
        <td class="fpdf-n">${pctOuTexto(p[I.entregue])}</td>
        <td class="fpdf-n">${pctOuTexto(p[I.liberado])}</td>
        <td class="fpdf-n">${pctOuTexto(p[I.pago])}</td>
        <td class="fpdf-n fpdf-apagar">${pctOuTexto(p[I.aPagar])}</td>
        <td>${esc(freteData(p[I.dataPagamento])) || traco}</td>
        <td>${canhoto}</td>
      </tr>`;
    const linhasNotas = notas.map((l) => {
      const resumo = String(l.v[I.resumo] || '');
      const m = resumo.match(/^\S+\s*\((.*)\)\s*$/);
      const statusNota = m ? m[1] : (resumo || '—');
      const tr = l.v[I.tratativa];
      if(!tr) semTratativa += 1;
      const obs = l.v[I.observacao] || l.obsNota || '';
      const quem = [l.cliente, l.cidade].filter(Boolean).join(' — ');
      const idade = !tr && l.idadeDias != null ? (l.idadeDias === 0 ? 'hoje' : `${l.idadeDias} dia${l.idadeDias === 1 ? '' : 's'}`) : '';
      return `<tr>
          <td class="fpdf-nota">${esc(String(l.nota))}</td>
          <td>${esc(statusNota)}</td>
          <td>${quem ? esc(quem) : traco}</td>
          <td class="fpdf-trat fpdf-trat-${cls(tr)}">${tr ? esc(tr) : '<em>sem tratativa</em>'}</td>
          <td>${esc(freteData(l.v[I.dataTratativa])) || traco}</td>
          <td class="fpdf-obs">${obs ? esc(obs) : traco}</td>
          <td class="fpdf-n">${idade ? `<strong>${esc(idade)}</strong>` : traco}</td>
        </tr>`;
    }).join('');
    const detalhe = notas.length
      ? `<tr class="fpdf-det"><td colspan="15">
          <div class="fpdf-det-tit">${notas.length} nota(s) pendente(s) da carga ${esc(String(g.carga))}</div>
          <table class="fpdf-notas"><thead><tr>
            <th>Nota</th><th>Status no B2B</th><th>Cliente — cidade</th><th>Tratativa</th><th>Data da tratativa</th><th>Observação</th><th>Sem olhar há</th>
          </tr></thead><tbody>${linhasNotas}</tbody></table></td></tr>`
      : `<tr class="fpdf-det fpdf-det-vazio"><td colspan="15">Nenhuma nota pendente: todas as notas do sistema estão finalizadas no B2B.</td></tr>`;
    return `<tbody class="fpdf-grupo">${linhaCarga}${detalhe}</tbody>`;
  }).join('');

  const geradoEm = FRETE.dados.geradoEm ? fmtDataHora(FRETE.dados.geradoEm) : '';
  const html = `
    <div class="print-page doc-paisagem frete-pdf">
      ${cabecalhoDocumento({ titulo: 'Pagamento de Frete', subtitulo: 'Controle por carga — conferência das entregas e liberação do pagamento' })}
      <div class="fpdf-recorte"><span><strong>Filtro aplicado:</strong> ${esc(filtro || 'nenhum — todas as cargas do controle')}</span>
        <span class="fpdf-recorte-n"><strong>${cargas} de ${total} carga(s)</strong></span></div>
      <div class="fpdf-resumo">
        <span><strong>${conta.LIBERADA}</strong> liberada(s)</span>
        <span><strong>${conta.PENDENTE}</strong> pendente(s)</span>
        <span><strong>${conta.VERIFICAR}</strong> a verificar</span>
        <span><strong>${pendencias}</strong> nota(s) pendente(s)</span>
        <span><strong>${semTratativa}</strong> sem tratativa</span>
      </div>
      <table class="fpdf-tab">
        <thead><tr>
          <th>Consulta</th><th>Carga</th><th>Transportadora</th><th>CT-e</th><th>Notas SIST</th><th>Notas B2B</th><th>Finali&shy;zadas</th>
          <th>Situação</th><th>Status p/ pagamento</th><th>% Entregue</th><th>% Liberado</th><th>% Pago</th><th>A pagar agora</th><th>Data pagamento</th><th>Canhoto original</th>
        </tr></thead>
        ${corpo || '<tbody><tr><td colspan="15" class="text-center text-dim">Nenhuma carga com este filtro.</td></tr></tbody>'}
      </table>
      ${rodapeDocumento(
        '<strong>Situação</strong>, percentuais e <strong>status para pagamento</strong> são os mesmos da aba e da planilha Excel: '
        + 'liberado é o que está entregue no B2B ou tratado como OK ou DEVOLUÇÃO; <strong>a pagar agora</strong> é o liberado menos o já pago. '
        + 'Cada carga traz embaixo as notas que ainda não estão finalizadas no B2B, com a tratativa registrada.',
        `Uma linha por carga do filtro, na ordem da tela, com os dados dos relatórios B2B e Atak importados${geradoEm ? ` (controle lido em ${esc(geradoEm)})` : ''}. `
        + 'Campo com traço significa não preenchido, e não zero.',
        fichaDocumento({ titulo: 'Pagamento de Frete', contagem: cargas, recorte: filtro || 'todas as cargas' }))}
    </div>`;
  return { html, recorte };
}

/* ------------------------------------------------------------- importar */
let _freteImp = null;   // { lote, itens:[{ nome, estado, msg }], previa, fila }
const FRETE_MAX_PDF = 6 * 1024 * 1024;

function freteAbrirImportacao(){
  if(freteSoDemonstracao('os PDFs do B2B e do Atak são lidos e a planilha é montada')) return;
  _freteImp = { lote: null, itens: [], previa: null, lendo: false };
  freteDesenharImportacao();
}

function freteDesenharImportacao(){
  const imp = _freteImp;
  if(!imp) return;
  const lista = imp.itens.length ? `<ul class="frete-arqs">${imp.itens.map((i) => `<li class="frete-arq frete-arq-${i.estado}">
      <span class="frete-arq-nome">${esc(i.nome)}</span><span class="frete-arq-msg">${esc(i.msg || (i.estado === 'fila' ? 'na fila' : i.estado === 'lendo' ? 'lendo…' : ''))}</span></li>`).join('')}</ul>` : '';
  const previa = imp.previa ? freteHtmlPrevia(imp.previa) : '';
  const prontas = imp.previa ? imp.previa.cargas.filter((c) => c.estado === 'pronta').length : 0;
  freteModal('Importar relatórios (PDF)', `
    <div class="card-sub">Escolha os PDFs do <strong>B2B</strong> (Relatório de Status das Entregas) e do <strong>Atak</strong> (WRVDA501 — Notas por Carga).
      Pode ser de uma carga ou de várias, de uma vez. O servidor lê, mostra o que mudaria e <strong>só grava depois que você confirmar</strong>.</div>
    <div class="frete-drop" id="frete-drop" tabindex="0" role="button" aria-label="Escolher os PDFs dos relatórios"
         onclick="document.getElementById('frete-arquivos').click()"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('frete-arquivos').click()}"
         ondragover="event.preventDefault();this.classList.add('sobre')" ondragleave="this.classList.remove('sobre')"
         ondrop="event.preventDefault();this.classList.remove('sobre');freteEscolherPdfs(event.dataTransfer.files)">
      <svg class="ico" aria-hidden="true"><use href="#i-enviar"/></svg>
      <strong>Arraste os PDFs aqui</strong> ou clique para escolher
    </div>
    <input type="file" id="frete-arquivos" accept="application/pdf,.pdf" multiple hidden onchange="freteEscolherPdfs(this.files);this.value=''">
    ${lista}${previa}`,
    [{ rotulo: 'Fechar', clique: 'freteFecharModal()' },
     ...(prontas ? [{ rotulo: `Gravar ${prontas} carga(s)`, classe: 'btn-primary', id: 'frete-btn-gravar', icone: 'i-ok', clique: 'freteConfirmarImportacao()' }] : [])], true);
}

function freteLerArquivo(arq){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '');
    r.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(arq);
  });
}

async function freteEscolherPdfs(arquivos){
  const imp = _freteImp;
  if(!imp || !arquivos || !arquivos.length) return;
  for(const f of Array.from(arquivos)) imp.itens.push({ arq: f, nome: f.name, estado: 'fila', msg: '' });
  freteDesenharImportacao();
  if(imp.lendo) return;
  imp.lendo = true;
  for(const it of imp.itens){
    if(it.estado !== 'fila') continue;
    it.estado = 'lendo';
    freteAtualizarLista();
    try{
      if(!/\.pdf$/i.test(it.nome) && it.arq.type !== 'application/pdf') throw new Error('Não é um PDF.');
      if(it.arq.size > FRETE_MAX_PDF) throw new Error('Passa de 6 MB — não é o relatório de uma carga.');
      const b64 = await freteLerArquivo(it.arq);
      let r;
      for(let tentativa = 0; ; tentativa += 1){
        try{ r = await SuincoSharePoint.frete.enviarPdf(b64, it.nome, imp.lote); break; }
        catch(e){
          if(e && e.codigo === 'LEITURA_OCUPADA' && tentativa < 4){ await new Promise((ok) => setTimeout(ok, 1500)); continue; }
          throw e;
        }
      }
      imp.lote = r.lote;
      it.estado = 'ok';
      it.msg = `${r.tipo === 'B2B' ? 'B2B' : 'Atak'} · ${r.cargas.map((c) => `carga ${c.numero} (${c.notas} notas)`).join(', ')}`;
    }catch(e){
      it.estado = 'erro';
      it.msg = freteMensagemDeErro(e);
    }
    freteAtualizarLista();
  }
  imp.lendo = false;
  if(imp.lote && imp.itens.some((i) => i.estado === 'ok')){
    try{ imp.previa = await SuincoSharePoint.frete.previa(imp.lote); }
    catch(e){ notify(freteMensagemDeErro(e), 'danger', 9000); }
  }
  freteDesenharImportacao();
}

function freteAtualizarLista(){
  const imp = _freteImp;
  if(!imp) return;
  const ul = document.querySelector('#modal-frete .frete-arqs');
  if(!ul){ freteDesenharImportacao(); return; }
  ul.innerHTML = imp.itens.map((i) => `<li class="frete-arq frete-arq-${i.estado}">
      <span class="frete-arq-nome">${esc(i.nome)}</span><span class="frete-arq-msg">${esc(i.msg || (i.estado === 'fila' ? 'na fila' : i.estado === 'lendo' ? 'lendo…' : ''))}</span></li>`).join('');
}

function freteHtmlPrevia(previa){
  const lin = (c) => {
    if(c.estado !== 'pronta'){
      return `<tr class="frete-prev-falta"><td></td><td><strong>${esc(c.numero)}</strong></td>
        <td colspan="10">Falta o relatório do <strong>${c.estado === 'falta_sist' ? 'Atak' : 'B2B'}</strong> desta carga — não dá para conferir ainda.
        Mande o PDF que falta (a leitura fica guardada por um dia).${c.aviso ? `<div class="frete-prev-avisos">⚠ ${esc(c.aviso)}</div>` : ''}</td></tr>`;
    }
    const ex = c.existente;
    /* Carga EXCLUÍDA: confirmar a traz de volta — a prévia diz antes (06/10/2026). */
    const voltou = ex && ex.excluida ? `<div class="frete-prev-avisos frete-prev-excluida">⚠ Esta carga foi <strong>excluída</strong> do controle por ${esc(ex.excluida.por)} (${esc(ex.excluida.motivo)}). Gravar a traz de volta para a lista.</div>` : '';
    const mudanca = voltou + (ex ? `Já estava no controle (${esc(freteData(ex.dataConsulta))}): <strong>${ex.novas}</strong> nova(s), <strong>${ex.resolvidas}</strong> resolvida(s)${ex.pctPago ? `, ${esc(String(ex.pctPago).replace('.', ','))}% já pago` : ''}` : 'Carga nova');
    const cls = c.situacao === 'LIBERADA' ? 'lib' : c.situacao === 'PENDENTE' ? 'pend' : 'verif';
    return `<tr class="frete-prev"><td><input type="checkbox" class="frete-prev-ok" data-carga="${esc(c.numero)}" checked aria-label="Gravar a carga ${esc(c.numero)}"></td>
      <td><strong>${esc(c.numero)}</strong></td><td>${c.qtdSist}</td><td>${c.qtdB2b}</td>
      <td class="${c.diferenca === 0 ? 'frete-dif-ok' : 'frete-dif-ruim'}">${c.diferenca}</td>
      <td>${c.finalizadas}</td><td>${c.aguardando}</td><td>${c.naoEntregue}</td><td>${c.outros}</td>
      <td><span class="frete-sit frete-sit-${cls}">${esc(c.situacao)}</span></td>
      <td>${mudanca}${c.avisos.length ? `<div class="frete-prev-avisos">${c.avisos.map((a) => `⚠ ${esc(a)}`).join('<br>')}</div>` : ''}
        ${c.nPendencias ? `<details class="frete-prev-det"><summary>${c.nPendencias} pendência(s)</summary><ul>${c.pendencias.map((p) => `<li>${esc(p.rotulo.startsWith(p.nota) ? p.rotulo : `${p.nota} (${p.rotulo})`)}${p.cliente ? ` — ${esc(p.cliente)}` : ''}</li>`).join('')}</ul></details>` : ''}</td></tr>`;
  };
  return `<h3 class="frete-h3">O que a conferência faria</h3>
    <div class="table-wrap"><table class="frete-mini frete-prev-tab"><thead><tr><th scope="col"><span class="sr-only">Gravar</span></th>
      <th scope="col">Carga</th><th scope="col">Qtde SIST</th><th scope="col">Qtde B2B</th><th scope="col">Dif.</th><th scope="col">Final.</th>
      <th scope="col">Aguard.</th><th scope="col">Não entr.</th><th scope="col">Outros</th><th scope="col">Situação</th><th scope="col">O que muda</th></tr></thead>
      <tbody>${previa.cargas.map(lin).join('')}</tbody></table></div>
    <div class="card-sub">Desmarque a carga que não quiser gravar agora. Nada foi gravado ainda.</div>`;
}

async function freteConfirmarImportacao(){
  const imp = _freteImp;
  if(!imp || !imp.lote) return;
  const marcadas = Array.from(document.querySelectorAll('#modal-frete .frete-prev-ok:checked')).map((el) => el.dataset.carga);
  if(!marcadas.length){ notify('Nenhuma carga marcada.', 'warn'); return; }
  const botao = document.getElementById('frete-btn-gravar');
  if(botao) botao.disabled = true;
  try{
    const r = await SuincoSharePoint.frete.confirmar(imp.lote, marcadas);
    const novas = r.gravadas.reduce((s, g) => s + g.novas, 0);
    const resolvidas = r.gravadas.reduce((s, g) => s + g.resolvidas, 0);
    freteFecharModal();
    notify(`Gravei ${r.gravadas.length} carga(s): ${novas} pendência(s) nova(s), ${resolvidas} resolvida(s).`, 'success', 8000);
    await freteRecarregarSemPiscar();
  }catch(e){
    if(botao) botao.disabled = false;
    notify(freteMensagemDeErro(e), 'danger', 9000);
  }
}
