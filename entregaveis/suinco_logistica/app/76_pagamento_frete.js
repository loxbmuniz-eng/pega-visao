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
    if(q){
      const bate = String(carga).includes(q)
        || ls.some((l) => l.nota && String(l.nota).includes(q))
        || String(p.v[iTp] || '').toLowerCase().includes(q);
      if(!bate) continue;
    }
    cargas += 1;
    linhas.push(...ls);
  }
  return { linhas, cargas, total: porCarga.size };
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
  document.getElementById('frete-stats').innerHTML =
    caixa(r.cargas, 'Cargas no controle', { destaque: true, nota: 'cada carga conta uma vez' })
    + caixa(r.liberadas, 'Liberadas', { clicavel: true, ativo: FRETE.situacao === 'LIBERADA', clique: "freteFiltrarSituacao('LIBERADA')", titulo: 'Tudo que o sistema emitiu está Finalizado no B2B. Clique para filtrar.' })
    + caixa(r.pendentes, 'Pendentes', { clicavel: true, ativo: FRETE.situacao === 'PENDENTE', clique: "freteFiltrarSituacao('PENDENTE')", titulo: 'A contagem bate; parte está Finalizada, parte não. Clique para filtrar.' })
    + caixa(r.verificar, 'Verificar', { clicavel: true, alerta: true, ativo: FRETE.situacao === 'VERIFICAR', clique: "freteFiltrarSituacao('VERIFICAR')", titulo: 'A contagem não bate, há nota de um lado só, ou nada foi finalizado. Nada é liberado até conferir. Clique para filtrar.' })
    + caixa(r.comSaldo, 'Com saldo a pagar', { clicavel: true, ativo: FRETE.soSaldo, clique: "freteAlternar('soSaldo')", titulo: 'Liberado e ainda não pago. Clique para filtrar.', nota: 'liberado e não pago' })
    + caixa(r.integral, 'Pagas integralmente')
    + caixa(r.parcial, 'Pagas em parte')
    + caixa(r.semPagamento, 'Sem pagamento')
    + caixa(r.entregue === null ? '—' : fretePct(r.entregue), 'Entregues', { nota: 'finalizadas ÷ emitidas' })
    + caixa(r.pendAbertas, 'Pendências abertas', { alerta: true, nota: 'notas ainda sem entrega' })
    + caixa(`${r.comCanhoto ?? 0} de ${r.cargas}`, 'Canhoto original', { clicavel: true, ativo: FRETE.soSemCanhoto, clique: "freteAlternar('soSemCanhoto')", titulo: 'Cargas cujo canhoto em papel já chegou. Só acompanhamento: não mexe no pagamento. Clique para ver as que ainda não vieram.', nota: 'papel que já chegou' });
}

function freteDesenharFiltros(){
  const chip = (rotulo, ativo, clique) => `<button type="button" class="frete-chip${ativo ? ' ativo' : ''}" aria-pressed="${ativo}" onclick="${clique}">${esc(rotulo)}</button>`;
  document.getElementById('frete-filtros').innerHTML = `
    <label class="frete-busca"><span class="sr-only">Buscar carga, nota ou transportadora</span>
      <input type="search" id="frete-busca" placeholder="Buscar carga, nota ou transportadora" value="${esc(FRETE.busca)}"
             oninput="freteBuscar(this.value)" autocomplete="off"></label>
    <div class="frete-chips" role="group" aria-label="Filtros da planilha">
      ${chip('Todas', !FRETE.situacao, "freteFiltrarSituacao(FRETE.situacao)")}
      ${chip('Liberadas', FRETE.situacao === 'LIBERADA', "freteFiltrarSituacao('LIBERADA')")}
      ${chip('Pendentes', FRETE.situacao === 'PENDENTE', "freteFiltrarSituacao('PENDENTE')")}
      ${chip('Verificar', FRETE.situacao === 'VERIFICAR', "freteFiltrarSituacao('VERIFICAR')")}
      ${chip('Com saldo a pagar', FRETE.soSaldo, "freteAlternar('soSaldo')")}
      ${chip('Pendência sem tratativa', FRETE.soSemTratativa, "freteAlternar('soSemTratativa')")}
      ${chip('Sem canhoto original', FRETE.soSemCanhoto, "freteAlternar('soSemCanhoto')")}
    </div>
    <div class="frete-contagem" id="frete-contagem" aria-live="polite"></div>`;
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
    case 'data': case 'dataPagamento': case 'dataTratativa': case 'canhotoEm':
      return `<td${k} class="${primeira || chave !== 'data' ? '' : 'frete-mudo'}">${esc(freteData(v))}</td>`;
    case 'canhoto': {
      /* A caixinha do papel: só acompanhamento, nunca entra no pagamento. */
      if(!primeira) return `<td${k}></td>`;
      const veio = v === 'SIM';
      return `<td${k} class="frete-canhoto frete-canhoto-${veio ? 'sim' : 'nao'}"><label class="frete-check">
          <input type="checkbox"${veio ? ' checked' : ''} aria-label="Canhoto original da carga ${esc(l.carga)} veio"
                 onchange="freteCanhoto('${escJs(l.carga)}', this.checked, this)"><span>${veio ? 'SIM' : 'NÃO'}</span></label></td>`;
    }
    case 'carga':
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
      const cls = v === 'SEM PENDÊNCIA' ? 'ok' : (l.categoria || 'outro');
      const dica = l.cliente ? ` title="${esc(l.cliente + (l.cidade ? ' — ' + l.cidade : ''))}"` : '';
      return `<td${k} class="frete-r frete-r-${cls}"${dica}>${esc(v)}</td>`;
    }
    case 'tratativa': {
      if(!l.nota) return `<td${k}></td>`;
      const vocab = freteTratativas();
      const lib = (FRETE.dados.vocabulario.liberam || []).includes(v);
      const cls = !v ? 'falta' : lib ? 'ok' : v === 'SUMIU DO B2B' ? 'sumiu' : v === 'SEM TRATATIVA' ? 'sem' : 'dev';
      return `<td${k} class="frete-t frete-t-${cls}"><select class="frete-sel" aria-label="Status da pendência da nota ${esc(l.nota)}"
          onchange="freteTratar('${escJs(l.carga)}','${escJs(l.nota)}',this.value)">
          <option value="">${v ? '— limpar —' : '— falta olhar —'}</option>
          ${vocab.map((t) => `<option value="${esc(t)}"${t === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select></td>`;
    }
    case 'statusPagamento':
      return `<td${k} class="frete-forte">${esc(v || '')}</td>`;
    case 'transportadora': case 'cte': {
      if(!primeira) return `<td${k} class="frete-mudo">${chave === 'transportadora' ? esc(v || '') : ''}</td>`;
      const rotulo = chave === 'transportadora' ? 'Transportadora' : 'CT-E';
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
      const rotulo = v ? esc(v) : '<span class="frete-vazio">anotar</span>';
      return `<td${k} class="frete-obs"><button type="button" class="frete-edit" onclick="freteEditarObs('${escJs(l.carga)}','${escJs(l.nota || '')}')"
          aria-label="Observação da ${l.nota ? 'nota ' + esc(l.nota) : 'carga ' + esc(l.carga)}. Editar">${rotulo}</button></td>`;
    }
    default:
      return `<td${k}>${esc(freteNum(v))}</td>`;
  }
}

function freteDesenharTabela(){
  const d = FRETE.dados;
  if(!d) return;
  const { linhas, cargas, total } = freteLinhasVisiveis();
  const cabecalho = d.colunas.map((c) => `<th scope="col" class="frete-h frete-h-${c.tipo}" data-col="${c.chave}">${esc(c.t)}</th>`).join('')
    + '<th scope="col" class="frete-h frete-h-acao no-print">Ações</th>';
  document.getElementById('frete-thead').innerHTML = cabecalho;
  document.getElementById('frete-tbody').innerHTML = linhas.map((l) => `<tr class="${l.primeira ? 'frete-primeira' : 'frete-seg'}" data-carga="${esc(l.carga)}">
      ${d.colunas.map((c, j) => freteCelula(l, c, j)).join('')}
      <td class="frete-acoes no-print">${l.primeira ? `
        <button type="button" class="btn btn-sec btn-sm" onclick="fretePagarUI('${escJs(l.carga)}')" title="Registrar um pagamento desta carga"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-faturamento"/></svg>Pagar</button>
        <button type="button" class="btn btn-sec btn-sm" onclick="freteHistoricoUI('${escJs(l.carga)}')" title="Pagamentos, tratativas e quem mexeu"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-historico"/></svg>Histórico</button>` : ''}</td>
    </tr>`).join('');
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
async function freteTratar(carga, nota, valor){
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

function freteEditarCarga(carga, campo){
  const l = freteLinhaDaCarga(carga);
  if(!l) return;
  const atual = l.v[freteIx(campo)] || '';
  const rotulo = campo === 'transportadora' ? 'Transportadora' : 'CT-E';
  freteModal(`${rotulo} da carga ${carga}`,
    `<label class="frete-campo">${rotulo}
       <input type="text" id="frete-campo-valor" data-foco maxlength="${campo === 'cte' ? 40 : 80}" value="${esc(atual)}"
         onkeydown="if(event.key==='Enter'){freteSalvarCarga('${escJs(carga)}','${campo}')}"></label>
     <div class="card-sub">${campo === 'cte' ? 'Mais de um CT-E? Separe por vírgula.' : 'Escreva como a Logística conhece (ex.: o nome curto).'}</div>`,
    [{ rotulo: 'Cancelar', clique: 'freteFecharModal()' },
     { rotulo: 'Salvar', classe: 'btn-primary', icone: 'i-ok', clique: `freteSalvarCarga('${escJs(carga)}','${campo}')` }]);
}
/* Marca/desmarca o canhoto original. O servidor decide e carimba a hora;
   a tela só adianta o visual e volta atrás se ele recusar. */
async function freteCanhoto(carga, marcado, input){
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

function freteEditarObs(carga, nota){
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
  const ROTULO = { conferencia: 'Conferência dos relatórios', editou_carga: 'Editou a carga', tratativa: 'Tratativa', pagamento: 'Pagamento', anulou_pagamento: 'Anulou pagamento', exportou: 'Exportou a planilha', canhoto: 'Canhoto original' };
  const detalhe = (e) => (e.acao === 'canhoto' && e.detalhe ? (e.detalhe.para ? ' · marcou: veio' : ' · desmarcou') : '');
  const eventos = h.eventos.length ? `<ul class="frete-eventos">${h.eventos.map((e) => `<li><strong>${esc(ROTULO[e.acao] || e.acao)}</strong>${esc(detalhe(e))}${e.nota ? ` · nota ${esc(e.nota)}` : ''}
      <span>${esc(e.por)} · ${esc(dt(e.em))}</span></li>`).join('')}</ul>` : '<div class="card-sub">Sem eventos.</div>';
  document.getElementById('frete-modal-corpo').innerHTML =
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

/* ------------------------------------------------------------- exportar */
async function freteExportar(){
  try{
    const { blob, nome } = await SuincoSharePoint.frete.baixarPlanilha();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    notify('Planilha exportada. É a mesma que está na tela.', 'success');
  }catch(e){ notify(freteMensagemDeErro(e), 'danger', 8000); }
}

/* ------------------------------------------------------------- importar */
let _freteImp = null;   // { lote, itens:[{ nome, estado, msg }], previa, fila }
const FRETE_MAX_PDF = 6 * 1024 * 1024;

function freteAbrirImportacao(){
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
        Mande o PDF que falta (a leitura fica guardada por um dia).</td></tr>`;
    }
    const ex = c.existente;
    const mudanca = ex ? `Já estava no controle (${esc(freteData(ex.dataConsulta))}): <strong>${ex.novas}</strong> nova(s), <strong>${ex.resolvidas}</strong> resolvida(s)${ex.pctPago ? `, ${esc(String(ex.pctPago).replace('.', ','))}% já pago` : ''}` : 'Carga nova';
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
