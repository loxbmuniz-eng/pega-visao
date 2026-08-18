/* Devoluções — o checklist digital (fase 1: Logística e Administração).

   Módulo separado de app.js de propósito: é um fluxo inteiro com dados
   próprios, e app.js já passa de 5 mil linhas. Tudo aqui é SERVIDOR-FIRST:
   a lista vem da API a cada abertura/evento, cada gravação vai direto para
   a API, e não existe cópia em localStorage — o checklist é um documento
   compartilhado entre setores, e cópia local dessincronizada foi a raiz do
   incidente das cargas (14–15/08/2026). Sem conexão a aba diz isso com
   todas as letras em vez de fingir que gravou.

   Depende dos globais do painel: DB, notify, esc, escJs, fmtDataHora,
   ROTAS, rotaLabel, TAB_ATUAL, SuincoSharePoint (adaptador),
   cabecalhoDocumento/rodapeDocumento/tituloSecaoPdf/exportarViaServidor
   (relatórios). Carregado DEPOIS de app.js no build. */

let DEVOLUCOES = [];
let DEV_CADASTROS = { supervisores: [], produtos: [], motivos: [] };
let _devCadastrosCarregados = false;
let _devExpandida = null;   // checklist aberto (sobrevive ao re-render)
/* Rotas escolhidas no formulário de NOVO checklist — um checklist junta
   várias rotas da mesma região (pedido de 18/08/2026). */
let _devRotasNovas = [];
/* Filtro da esteira (clique numa caixa de etapa) — null = todas. */
let _devFiltroEtapa = null;

function devRotulo(d) {
  return `${d.regiao ? d.regiao + ' · ' : ''}rota(s) ${(d.rotas || []).join(', ') || '—'}`;
}

/* Iniciais de quem gerou — o formato pedido pela operação (18/08/2026):
   "Belo Horizonte - Rota 502 / RP (região / rota / operador)". */
function devIniciais(nome) {
  return String(nome || '').trim().split(/\s+/)
    .map((p) => p[0] || '').join('').toUpperCase().slice(0, 3);
}

/* Etapas na ordem do processo real. `pede` são os campos que aquela etapa
   imputa — o mesmo papel que o campo tinha na folha impressa. */
/* `setores` espelha a allowlist do servidor (dominio/devolucoes.js) — a
   tela não mostra botão que a API vai recusar. Administração passa em
   tudo, como no resto do painel. */
const DEV_ETAPAS = [
  { status: 'Lançada',                  proxima: 'Recebida na Portaria',
    botao: '🚧 Receber na Portaria', pede: 'portaria',
    setores: ['Portaria', 'Logística'] },
  { status: 'Recebida na Portaria',     proxima: 'Conferida no Faturamento',
    botao: '⚖️ Conferir no Faturamento', pede: 'faturamento',
    setores: ['Faturamento', 'Logística'] },
  { status: 'Conferida no Faturamento', proxima: 'Descarga Conferida',
    botao: '📦 Descarga conferida (Expedição)', pede: null,
    setores: ['Expedição', 'Logística'] },
  { status: 'Descarga Conferida',       proxima: 'Destinada',
    botao: '🏷️ Registrar destinação (Controles Internos)', pede: 'controles',
    setores: ['Controles Internos', 'Logística'] },
  { status: 'Destinada',                proxima: 'Nota Finalizada',
    botao: '🧾 Finalizar nota (Central de Notas)', pede: null,
    setores: ['Central de Notas', 'Logística'] },
];

const DEV_ETAPA_ROTULO = {
  portaria: 'Portaria', faturamento: 'Faturamento', expedicao: 'Expedição',
  controles: 'Controles Internos', notas: 'Central de Notas',
};

/* Dia local do pátio — NUNCA toISOString().slice(0,10): às 21h+ de Patos
   de Minas o UTC já virou o dia seguinte (guardião nº 2). */
function diaLocalDev(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function devServidorOk() {
  return typeof SuincoSharePoint !== 'undefined'
    && SuincoSharePoint.estaConfigurado && SuincoSharePoint.estaConfigurado()
    && SuincoSharePoint.devolucoes;
}

function podeEditarDevolucao() {
  const setor = (DB.operador || {}).setor;
  return setor === 'Logística' || setor === 'Administração';
}

/* Papéis da fase 2, já valendo para os setores criados em 18/08/2026:
   Expedição confere o que chegou; Controles Internos destina. Cada um
   enxerga editável SÓ a própria coluna — o servidor confere de novo. */
function podeConferirQtdDev() {
  const setor = (DB.operador || {}).setor;
  return podeEditarDevolucao() || setor === 'Expedição';
}
function podeDestinarDev() {
  const setor = (DB.operador || {}).setor;
  return podeEditarDevolucao() || setor === 'Controles Internos';
}
/* Alinhamento de 18/08/2026: a pesagem por item é do Faturamento (é a
   confirmação de que passou pela balança) e o tick de NOTA FINAL é da
   Central de Notas. */
function podePesarItemDev() {
  const setor = (DB.operador || {}).setor;
  return podeEditarDevolucao() || setor === 'Faturamento';
}
function podeNotaFinalDev() {
  const setor = (DB.operador || {}).setor;
  return podeEditarDevolucao() || setor === 'Central de Notas';
}
/* Divergentes: escopo EXCLUSIVO dos Controles Internos (decisão de
   18/08/2026) — nem a Logística lança por eles; Administração é
   irrestrita como no resto do painel. */
function podeDivergenciaDev() {
  const setor = (DB.operador || {}).setor;
  return setor === 'Controles Internos' || setor === 'Administração';
}

/* A etapa cujo DONO é o meu setor — é ela que define a minha fila "SUA
   VEZ". Logística/Administração não têm uma só (cobrem todas): null. */
function minhaEtapaDev() {
  const setor = (DB.operador || {}).setor;
  if (!setor || setor === 'Logística' || setor === 'Administração') return null;
  return DEV_ETAPAS.find((e) => e.setores[0] === setor) || null;
}

function ehMinhaVezDev(d) {
  const etapa = minhaEtapaDev();
  return !!(etapa && d.status === etapa.status);
}

function getDevolucao(id) {
  return DEVOLUCOES.find((d) => d.id === id) || null;
}

/* ---------- render principal (chamado por renderTabAtual) ---------- */

function renderDevolucoes() {
  if (!DB.operador) return;
  const offline = document.getElementById('dev-offline');
  const conteudo = document.getElementById('dev-conteudo');
  if (!offline || !conteudo) return;

  const ok = devServidorOk();
  offline.hidden = ok;
  conteudo.hidden = !ok;
  if (!ok) return;

  const data = document.getElementById('dev-data');
  if (data && !data.value) data.value = diaLocalDev();
  const filtro = document.getElementById('dev-filtro-dia');
  if (filtro && !filtro.value) filtro.value = diaLocalDev();

  // Criar checklist é da Logística/Administração; os demais setores veem
  // a esteira e a própria fila, sem um formulário que a API recusaria.
  const cardNovo = document.getElementById('dev-card-novo');
  if (cardNovo) cardNovo.hidden = !podeEditarDevolucao();

  preencherSelectRotaDev();
  if (!_devCadastrosCarregados) carregarCadastrosDev();
  carregarDevolucoes();
}

function preencherSelectRotaDev() {
  const sel = document.getElementById('dev-rota');
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">(escolha a rota)</option>'
    + ROTAS.map((r) => `<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
  if (atual) sel.value = atual;
}

async function carregarCadastrosDev() {
  try {
    DEV_CADASTROS = await SuincoSharePoint.devolucoes.cadastros();
    _devCadastrosCarregados = true;
    const põe = (id, valores) => {
      const dl = document.getElementById(id);
      if (dl) dl.innerHTML = valores.map((v) => `<option value="${esc(v)}">`).join('');
    };
    põe('dl-dev-supervisores', DEV_CADASTROS.supervisores || []);
    põe('dl-dev-rcas', DEV_CADASTROS.representantes || []);
    // Clientes NÃO são pré-carregados (76 mil) — as sugestões chegam do
    // servidor conforme se digita (sugerirClientesDevUI).
    põe('dl-dev-motivos', DEV_CADASTROS.motivos || []);
    const dlProd = document.getElementById('dl-dev-produtos');
    if (dlProd) {
      // Só produto ATIVO vira sugestão de lançamento; os inativos ficam na
      // tabela de Cadastros, marcados, para consulta de histórico.
      dlProd.innerHTML = (DEV_CADASTROS.produtos || [])
        .filter((p) => p.ativo !== false)
        .map((p) => `<option value="${esc(p.codigo)}">${esc(p.nome)}${p.pesoCaixaKg ? ' · ' + p.pesoCaixaKg + ' kg/cx' : ''}</option>`).join('');
    }
    if (typeof renderProdutosDevUI === 'function') renderProdutosDevUI();
    if (typeof atualizarResumoCadDev === 'function') atualizarResumoCadDev();
  } catch (e) {
    console.warn('[Devoluções] cadastros:', e);
  }
}

async function carregarDevolucoes() {
  if (!devServidorOk()) return;
  const dia = (document.getElementById('dev-filtro-dia') || {}).value || diaLocalDev();
  try {
    DEVOLUCOES = await SuincoSharePoint.devolucoes.listar(dia, dia);
    renderListaDevolucoes();
  } catch (e) {
    notify('Não consegui buscar as devoluções: ' + (e.message || 'erro desconhecido'), 'danger', 6000);
  }
}

function filtroDevolucoesHoje() {
  const f = document.getElementById('dev-filtro-dia');
  if (f) f.value = diaLocalDev();
  carregarDevolucoes();
}

/* ---------- a lista de checklists ---------- */

function devStatusChip(status) {
  const pos = DEV_ETAPAS.findIndex((e) => e.status === status);
  const cls = status === 'Nota Finalizada' ? 'dev-chip-final'
    : pos <= 0 ? 'dev-chip-inicio' : 'dev-chip-meio';
  return `<span class="dev-chip ${cls}">${esc(status)}</span>`;
}

/* Resumo da destinação múltipla: "Estoque 1 · Descarte 2". A destinação
   antiga (escolha única) entra no resumo se for o que existe. */
function devDestinoResumo(i) {
  const partes = [];
  if (i.destEstoque) partes.push(`Estoque ${i.destEstoque.toLocaleString('pt-BR')}`);
  if (i.destDescarte) partes.push(`Descarte ${i.destDescarte.toLocaleString('pt-BR')}`);
  if (i.destReprocesso) partes.push(`Reprocesso ${i.destReprocesso.toLocaleString('pt-BR')}`);
  if (!partes.length && i.destinacao) partes.push(i.destinacao);
  return partes.join(' · ');
}

function devProdutoNomePorCodigo(codigo) {
  const p = (DEV_CADASTROS.produtos || []).find((x) => x.codigo === String(codigo).trim());
  return p ? p.nome : '';
}

/* Peso sugerido = caixas × quilo/caixa do cadastro do produto. Só SUGERE
   quando a operadora não digitou peso — número digitado nunca é
   sobrescrito por conta. */
function devPesoSugerido(codigo, cx) {
  const p = (DEV_CADASTROS.produtos || []).find((x) => x.codigo === String(codigo).trim());
  const n = Number(cx);
  if (!p || !p.pesoCaixaKg || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * p.pesoCaixaKg * 100) / 100;
}

/* A esteira: uma caixa por etapa com a contagem do dia. Clique filtra a
   lista (clicar de novo limpa) — mesma pegada das caixas da Torre. A
   caixa da MINHA etapa ganha destaque: é a minha fila. */
function renderPipelineDev() {
  const el = document.getElementById('dev-pipeline');
  if (!el) return;
  const porStatus = {};
  DEVOLUCOES.forEach((d) => { porStatus[d.status] = (porStatus[d.status] || 0) + 1; });
  const minha = minhaEtapaDev();
  const TODAS = [...DEV_ETAPAS.map((e) => e.status), 'Nota Finalizada'];
  el.innerHTML = TODAS.map((status) => {
    const n = porStatus[status] || 0;
    const ehMinha = minha && minha.status === status;
    const ativo = _devFiltroEtapa === status;
    const dono = status === 'Nota Finalizada' ? 'concluído'
      : (DEV_ETAPAS.find((e) => e.status === status) || {}).setores?.[0] || '';
    return `<div class="stat-box stat-clicavel${ehMinha ? ' stat-destaque' : ''}${ativo ? ' stat-ativo' : ''}${ehMinha && n > 0 ? ' stat-alerta' : ''}"
        onclick="filtrarEtapaDevUI('${escJs(status)}')"
        title="${esc(dono ? (ehMinha ? 'A SUA fila — clique para ver só ela.' : 'Etapa de: ' + dono) : '')}">
        <div class="stat-num">${n}</div>
        <div class="stat-label">${esc(status)}${ehMinha ? ' · SUA VEZ' : ''}</div>
      </div>`;
  }).join('');

  const aviso = document.getElementById('dev-sua-vez-aviso');
  if (aviso) {
    const pendentes = minha ? (porStatus[minha.status] || 0) : 0;
    aviso.hidden = !minha || pendentes === 0;
    if (minha && pendentes > 0) {
      aviso.innerHTML = `<strong>É a sua vez:</strong> ${pendentes} checklist(s) aguardando `
        + `a ação do seu setor (${esc((DB.operador || {}).setor || '')}). `
        + `Termine e ele segue sozinho para a fila do próximo setor.`;
    }
  }
}

function filtrarEtapaDevUI(status) {
  _devFiltroEtapa = _devFiltroEtapa === status ? null : status;
  renderListaDevolucoes();
}

function renderListaDevolucoes() {
  const box = document.getElementById('dev-lista');
  const vazio = document.getElementById('dev-empty');
  if (!box) return;
  renderPipelineDev();
  const editavel = podeEditarDevolucao();

  /* Ordem da lista: primeiro a MINHA fila (o que espera a ação do meu
     setor), depois o resto na ordem do ciclo. Com o filtro da esteira
     ativo, só a etapa clicada. */
  const posicao = (s) => {
    const i = DEV_ETAPAS.findIndex((e) => e.status === s);
    return i === -1 ? DEV_ETAPAS.length : i;
  };
  let lista = DEVOLUCOES.slice();
  if (_devFiltroEtapa) lista = lista.filter((d) => d.status === _devFiltroEtapa);
  lista.sort((a, b) => (ehMinhaVezDev(b) - ehMinhaVezDev(a))
    || (posicao(a.status) - posicao(b.status)) || (b.numero - a.numero));
  vazio.hidden = lista.length > 0;

  // Uma única pendência na minha fila: já abre — menos um clique no pátio.
  if (_devExpandida === null) {
    const minhas = lista.filter(ehMinhaVezDev);
    if (minhas.length === 1) _devExpandida = minhas[0].id;
  }

  box.innerHTML = lista.map((d) => {
    const aberta = _devExpandida === d.id;
    const totalCx = d.itens.reduce((s, i) => s + (i.cx || 0), 0);
    const faltas = d.itens.filter((i) => i.falta !== null && i.falta > 0);
    const totalFalta = faltas.reduce((s, i) => s + i.falta, 0);
    const resumo = [
      `${d.itens.length} item(ns) · ${totalCx.toLocaleString('pt-BR')} cx`,
      totalFalta > 0 ? `<span class="dev-falta-chip">falta ${totalFalta.toLocaleString('pt-BR')} cx</span>` : '',
      d.divergencias.length ? `<span class="dev-diverg-chip">${d.divergencias.length} divergente(s)</span>` : '',
    ].filter(Boolean).join(' ');

    return `<div class="dev-card${aberta ? ' dev-aberta' : ''}">
      <div class="dev-card-topo" onclick="alternarDevolucaoUI('${escJs(d.id)}')">
        <div class="dev-card-id">
          ${ehMinhaVezDev(d) ? '<span class="dev-chip dev-chip-suavez">SUA VEZ</span>' : ''}
          <strong>Checklist Nº ${d.numero}</strong>
          <span class="dev-card-rota">${d.regiao ? esc(d.regiao) + ' — ' : ''}${(d.rotas || []).map((r) => 'Rota ' + esc(r)).join(' · ') || 'sem rota'}${d.criadaPor ? ' / ' + esc(devIniciais(d.criadaPor)) : ''}</span>
          ${devStatusChip(d.status)}
        </div>
        <div class="dev-card-meta">
          <span>${esc(d.criadaPor)}</span>
          <span>${resumo}</span>
          <span class="dev-card-seta">${aberta ? '▾' : '▸'}</span>
        </div>
      </div>
      ${aberta ? renderDevolucaoAberta(d, editavel) : ''}
    </div>`;
  }).join('');
}

function alternarDevolucaoUI(id) {
  _devExpandida = _devExpandida === id ? null : id;
  renderListaDevolucoes();
}

function cabecalhoEditavelDev(d, editavel) {
  const campo = (rotulo, nome, valor, extra = '') => `
    <div><label>${rotulo}</label>
      ${editavel
        ? `<input type="text" value="${esc(valor || '')}" ${extra}
             onchange="editarDevolucaoCampoUI('${escJs(d.id)}','${nome}',this.value)">`
        : `<div class="dev-ro">${esc(valor) || '—'}</div>`}
    </div>`;
  const rotasChips = `<div class="dev-rotas-chips">
      ${(d.rotas || []).map((r) => `<span class="dev-rota-chip">Rota ${esc(r)}
        ${editavel ? `<button type="button" title="Tirar esta rota do checklist"
          onclick="tirarRotaDevolucaoUI('${escJs(d.id)}','${escJs(r)}')">✕</button>` : ''}</span>`).join('')}
      ${editavel ? `<span class="gap8">
        <select id="dev-addrota-${esc(d.id)}">
          <option value="">(incluir rota…)</option>
          ${ROTAS.filter((r) => !(d.rotas || []).includes(r.codigo))
            .map((r) => `<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('')}
        </select>
        <button class="btn btn-sec btn-sm" onclick="incluirRotaDevolucaoUI('${escJs(d.id)}')">➕</button>
      </span>` : ''}
    </div>`;
  /* Data da devolução editável (18/08/2026): as meninas lançam devoluções
     de OUTRAS datas — a data escolhida decide em qual dia o checklist
     aparece na lista e no relatório. */
  const dataDev = String(d.dataDev || '').slice(0, 10);
  const campoData = `<div><label>Data da devolução</label>
      ${editavel
        ? `<input type="date" value="${esc(dataDev)}"
             onchange="editarDevolucaoCampoUI('${escJs(d.id)}','dataDev',this.value)">`
        : `<div class="dev-ro">${esc(dataDev) || '—'}</div>`}
    </div>`;
  return `${rotasChips}<div class="form-grid dev-cab-grid">
      ${campoData}
      ${campo('Região', 'regiao', d.regiao)}
      ${campo('Transportadora', 'transportadora', d.transportadora)}
      ${campo('Nota de transferência', 'notaTransferencia', d.notaTransferencia)}
      ${campo('Placa', 'placa', d.placa)}
      ${campo('Motorista', 'motorista', d.motorista)}
      ${campo('Cód. operador (monitoramento)', 'operadorCodigo', d.operadorCodigo,
        'title="Número informado pelo monitoramento — é sob ele que as devoluções são lançadas."')}
      ${campo('Nº carga', 'cargaNumero', d.cargaNumero)}
      ${campo('Lacre 1', 'lacre1', d.lacre1)}
      ${campo('Lacre 2', 'lacre2', d.lacre2)}
      <div><label>Peso final (Faturamento)</label><div class="dev-ro">${d.pesoFinal !== null ? d.pesoFinal.toLocaleString('pt-BR') + ' kg' : '—'}</div></div>
    </div>`;
}

function carimbosDev(d) {
  return `<div class="dev-carimbos">
    ${Object.entries(DEV_ETAPA_ROTULO).map(([chave, rotulo]) => {
      const c = d.carimbos[chave];
      return `<div class="dev-carimbo${c ? ' dev-carimbo-ok' : ''}">
          <span class="dev-carimbo-rot">${rotulo}</span>
          ${c ? `<span class="dev-carimbo-quem">${esc(c.por)}</span>
                 <span class="dev-carimbo-quando">${esc(fmtDataHora(c.em))}</span>`
              : '<span class="dev-carimbo-vazio">— pendente —</span>'}
        </div>`;
    }).join('')}
  </div>`;
}

function acaoEtapaDev(d) {
  const etapa = DEV_ETAPAS.find((e) => e.status === d.status);
  if (!etapa) return '<div class="card-sub">✅ Ciclo encerrado — nota fiscal finalizada.</div>';
  /* Espelho da allowlist do servidor: quem não assina este passo vê QUEM
     assina, em vez de um botão que a API recusaria. */
  const setor = (DB.operador || {}).setor;
  if (setor !== 'Administração' && !etapa.setores.includes(setor)) {
    return `<div class="card-sub">Próximo passo: <strong>${esc(etapa.proxima)}</strong> — feito por ${esc(etapa.setores.join(' ou '))}.</div>`;
  }
  const id = escJs(d.id);
  let extras = '';
  if (etapa.pede === 'portaria') {
    /* Decisão de 18/08/2026: a PORTARIA imputa placa, transportadora,
       motorista e lacre(s) no recebimento. A placa puxa a Frota — digitou
       e saiu do campo, transportadora e motorista preenchem sozinhos
       (mesma lógica da Programação; continuam editáveis). */
    extras = `
      <input type="text" id="dev-et-${esc(d.id)}-placa" placeholder="Placa que voltou" value="${esc(d.placa)}"
        onchange="frotaNaEtapaDevUI('${escJs(d.id)}')">
      <input type="text" id="dev-et-${esc(d.id)}-transportadora" placeholder="Transportadora" value="${esc(d.transportadora)}">
      <input type="text" id="dev-et-${esc(d.id)}-motorista" placeholder="Nome do motorista" value="${esc(d.motorista)}">
      <input type="text" id="dev-et-${esc(d.id)}-lacre1" placeholder="Lacre 1" value="${esc(d.lacre1)}">
      <input type="text" id="dev-et-${esc(d.id)}-lacre2" placeholder="Lacre 2 (se houver)" value="${esc(d.lacre2)}">`;
  } else if (etapa.pede === 'faturamento') {
    extras = `<input type="number" min="0" step="1" id="dev-et-${esc(d.id)}-peso"
      placeholder="Peso final em kg (opcional)" value="${d.pesoFinal ?? ''}">`;
  } else if (etapa.pede === 'controles') {
    extras = `<input type="text" id="dev-et-${esc(d.id)}-obs"
      placeholder="Observações dos Controles Internos (saem no relatório)" value="${esc(d.obsControles)}">`;
  }
  return `<div class="dev-etapa-acao">
      ${extras}
      <button class="btn btn-sm" onclick="avancarEtapaDevolucaoUI('${id}')">${etapa.botao}</button>
    </div>`;
}

function renderDevolucaoAberta(d, editavel) {
  const linhaItem = (i) => {
    const faltaHtml = i.falta === null
      ? '<span class="text-dim" title="Ainda não conferido">—</span>'
      : i.falta > 0
        ? `<span class="dev-falta-chip">falta ${i.falta.toLocaleString('pt-BR')}</span>`
        : '<span class="dev-ok-chip">✔</span>';
    const cel = (nome, valor, tipo = 'text', extra = '') => editavel
      ? `<input type="${tipo}" value="${esc(valor ?? '')}" ${extra}
           onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'${nome}',this.value)">`
      : (esc(valor) || '—');
    return `<tr>
      <td>${cel('nota', i.nota)}</td>
      <td>${editavel
        ? `<select onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'parcial',this.value)">
             <option value="1" ${i.parcial ? 'selected' : ''}>Parcial</option>
             <option value="" ${i.parcial ? '' : 'selected'}>Total</option></select>`
        : (i.parcial ? 'Parcial' : 'Total')}</td>
      <td>${cel('supervisor', i.supervisor, 'text', 'list="dl-dev-supervisores"')}</td>
      <td>${cel('vendedor', i.vendedor, 'text', 'list="dl-dev-rcas"')}</td>
      <td>${cel('codCliente', i.codCliente, 'text', 'list="dl-dev-clientes" oninput="sugerirClientesDevUI(this.value)"')}</td>
      <td class="c-peso">${cel('cx', i.cx, 'number', 'min="0" step="1"')}</td>
      <td class="c-peso">${cel('peso', i.peso, 'number', 'min="0" step="0.01"')}</td>
      <td>${cel('codProduto', i.codProduto, 'text', 'list="dl-dev-produtos"')}
          ${i.produtoNome ? `<small class="text-dim">${esc(i.produtoNome)}</small>` : ''}</td>
      <td>${cel('numDev', i.numDev)}</td>
      <td>${cel('dataItem', String(i.dataItem || '').slice(0, 10), 'date',
        'title="Data desta devolução (coluna DATA-DEV da capa)."')}</td>
      <td>${cel('motivo', i.motivo, 'text', 'list="dl-dev-motivos"')}</td>
      <td class="c-peso">${podePesarItemDev()
        ? `<input type="number" min="0" step="0.01" value="${i.pesoFaturamento ?? ''}" placeholder="—"
             title="Pesagem do Faturamento — é a confirmação de que a devolução passou pela balança."
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'pesoFaturamento',this.value)">`
        : (i.pesoFaturamento ?? '—')}</td>
      <td class="c-peso">${podeConferirQtdDev()
        ? `<input type="number" min="0" step="1" value="${i.qtdRecebida ?? ''}" placeholder="—"
             title="Conferência da Expedição: quantidade que CHEGOU na descarga. A falta é apontada sozinha."
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'qtdRecebida',this.value)">`
        : (i.qtdRecebida ?? '—')}</td>
      <td>${faltaHtml}</td>
      <td class="dev-cel-dest">${podeDestinarDev()
        /* Destinação MÚLTIPLA (18/08/2026): caixas por destino — 3 caixas
           podem virar 1 Estoque + 2 Descarte. */
        ? `<span class="dev-dest-grupo">
             <input type="number" min="0" step="1" value="${i.destEstoque ?? ''}" placeholder="E"
               title="Caixas para ESTOQUE"
               onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'destEstoque',this.value)">
             <input type="number" min="0" step="1" value="${i.destDescarte ?? ''}" placeholder="D"
               title="Caixas para DESCARTE"
               onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'destDescarte',this.value)">
             <input type="number" min="0" step="1" value="${i.destReprocesso ?? ''}" placeholder="R"
               title="Caixas para REPROCESSO"
               onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'destReprocesso',this.value)">
           </span>`
        : esc(devDestinoResumo(i)) || '—'}</td>
      <td class="dev-cel-notafinal">${podeNotaFinalDev()
        ? `<input type="checkbox" ${i.notaFinal ? 'checked' : ''}
             title="NOTA FINAL — marque quando a nota deste item estiver finalizada (Central de Notas)."
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'notaFinal',this.checked)">`
        : (i.notaFinal ? '✔' : '—')}</td>
      ${editavel ? `<td class="no-print"><button class="btn btn-danger btn-sm"
        onclick="excluirItemDevolucaoUI('${escJs(d.id)}',${i.itemId})">✕</button></td>` : ''}
    </tr>`;
  };

  const novaLinha = !editavel ? '' : `<tr class="dev-linha-nova">
      <td><input type="text" id="dev-ni-${esc(d.id)}-nota" placeholder="Nota"></td>
      <td><select id="dev-ni-${esc(d.id)}-parcial"><option value="1">Parcial</option><option value="">Total</option></select></td>
      <td><input type="text" id="dev-ni-${esc(d.id)}-supervisor" list="dl-dev-supervisores" placeholder="Supervisor"></td>
      <td><input type="text" id="dev-ni-${esc(d.id)}-vendedor" list="dl-dev-rcas" placeholder="RCA" title="RCA / vendedor — como na capa real"></td>
      <td><input type="text" id="dev-ni-${esc(d.id)}-cliente" list="dl-dev-clientes" placeholder="Cód. cliente ou apelido"
            oninput="sugerirClientesDevUI(this.value)"
            onchange="autofillClienteDevUI('${escJs(d.id)}')"></td>
      <td class="c-peso"><input type="number" min="0" step="1" id="dev-ni-${esc(d.id)}-cx" placeholder="CX"></td>
      <td class="c-peso"><input type="number" min="0" step="0.01" id="dev-ni-${esc(d.id)}-peso" placeholder="Peso"></td>
      <td><input type="text" id="dev-ni-${esc(d.id)}-produto" list="dl-dev-produtos" placeholder="Cód. produto"></td>
      <td><input type="text" id="dev-ni-${esc(d.id)}-numdev" placeholder="Nº DEV"></td>
      <td><input type="date" id="dev-ni-${esc(d.id)}-dataitem" value="${esc(String(d.dataDev || '').slice(0, 10))}"
            title="Data desta devolução — vem com o dia do checklist, mude se for de outra data."></td>
      <td><input type="text" id="dev-ni-${esc(d.id)}-motivo" list="dl-dev-motivos" placeholder="Motivo"></td>
      <td colspan="5"></td>
      <td class="no-print"><button class="btn btn-sm" onclick="adicionarItemDevolucaoUI('${escJs(d.id)}')"
        title="Acrescentar esta linha ao checklist">➕</button></td>
    </tr>`;

  const divergencias = `
    <div class="dev-divergencias">
      <div class="dev-divergencias-tit">Produtos divergentes (chegaram FORA do checklist)</div>
      ${d.divergencias.length ? `<ul>${d.divergencias.map((v) => `
        <li>${v.cx.toLocaleString('pt-BR')} cx · <strong>${esc(v.codProduto)}</strong>
          ${v.produtoNome ? esc(v.produtoNome) : ''}
          ${v.observacao ? `<span class="text-dim">— ${esc(v.observacao)}</span>` : ''}
          <span class="text-dim">(${esc(v.lancadaPor)})</span>
          ${podeDivergenciaDev() ? `<button class="btn btn-danger btn-sm"
            onclick="excluirDivergenciaDevolucaoUI('${escJs(d.id)}',${v.divergenciaId})">✕</button>` : ''}
        </li>`).join('')}</ul>`
      : '<div class="card-sub">Nenhum — o que chegou fora da lista entra aqui (lançado pelos CONTROLES INTERNOS) e NÃO cancela a falta do item substituído.</div>'}
      ${podeDivergenciaDev() ? `<div class="dev-diverg-form">
          <input type="text" id="dev-dv-${esc(d.id)}-produto" list="dl-dev-produtos" placeholder="Cód. produto">
          <input type="number" min="0" step="1" id="dev-dv-${esc(d.id)}-cx" placeholder="CX">
          <input type="text" id="dev-dv-${esc(d.id)}-obs" placeholder="Observação (ex: veio no lugar do 30110)">
          <button class="btn btn-sec btn-sm" onclick="adicionarDivergenciaDevolucaoUI('${escJs(d.id)}')">➕ Lançar divergente</button>
        </div>` : ''}
    </div>`;

  const admin = (DB.operador || {}).setor === 'Administração';
  return `<div class="dev-card-corpo">
      ${cabecalhoEditavelDev(d, editavel)}
      ${carimbosDev(d)}
      ${acaoEtapaDev(d)}
      <div class="table-wrap">
        <table class="dev-tabela">
          <thead><tr>
            <th>Nota</th><th>P/T</th><th>Supervisor</th><th title="Vendedor">RCA</th>
            <th>Cód. Cliente</th><th>CX</th><th>Peso</th><th>Cód. Produto</th>
            <th>Nº DEV</th><th title="Coluna DATA-DEV da capa">Data DEV</th><th>Motivo</th>
            <th title="Pesagem do Faturamento — confirma que passou pela balança">Pesagem</th>
            <th title="Conferência da descarga: quantidade recebida">Expedição</th><th>Falta</th>
            <th>Destinação</th>
            <th title="Tick da Central de Notas: nota finalizada">Nota final</th>
            ${editavel ? '<th class="no-print"></th>' : ''}
          </tr></thead>
          <tbody>${d.itens.map(linhaItem).join('')}${novaLinha}</tbody>
        </table>
      </div>
      ${d.obsControles ? `<div class="card-sub"><strong>Obs. Controles Internos:</strong> ${esc(d.obsControles)}</div>` : ''}
      ${divergencias}
      <div class="flex-end gap8 no-print" style="margin-top:10px">
        ${d.carimbos.portaria ? `<button class="btn btn-sec btn-sm" onclick="comprovantePortariaUI('${escJs(d.id)}')"
          title="PDF pequeno com carga, placa e lacres — o motorista entrega na balança e o Faturamento sabe QUAL devolução é. Substitui o papel escrito à mão pelo porteiro.">🖨 Comprovante do motorista</button>` : ''}
        ${admin ? `<button class="btn btn-sec btn-sm" onclick="abrirRevisoesDevolucaoUI('${escJs(d.id)}')"
          title="Ver alterações deste checklist e restaurar uma versão">↩ Alterações</button>` : ''}
        ${editavel ? `<button class="btn btn-danger btn-sm" onclick="excluirDevolucaoUI('${escJs(d.id)}')">🗑 Excluir checklist</button>` : ''}
      </div>
    </div>`;
}

/* ---------- ações (todas servidor-first, com aviso honesto) ---------- */

async function acaoDev(promessa, aviso) {
  try {
    await promessa;
    if (aviso) notify(aviso, 'success');
    await carregarDevolucoes();
    return true;
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou a gravação.', 'danger', 7000);
    await carregarDevolucoes();   // mostra o estado REAL, não o otimista
    return false;
  }
}

/* Chips de rota do formulário de novo checklist. */
function renderRotasNovasDev() {
  const box = document.getElementById('dev-rotas-escolhidas');
  if (!box) return;
  box.innerHTML = _devRotasNovas.map((r) => `<span class="dev-rota-chip">Rota ${esc(r)}
      <button type="button" title="Tirar esta rota"
        onclick="removerRotaNovaDevUI('${escJs(r)}')">✕</button></span>`).join('');
}

function adicionarRotaNovaDevUI() {
  const sel = document.getElementById('dev-rota');
  const cod = sel && sel.value;
  if (!cod) { notify('Escolha uma rota no seletor primeiro.', 'warn'); return; }
  if (!_devRotasNovas.includes(cod)) _devRotasNovas.push(cod);
  sel.value = '';
  renderRotasNovasDev();
}

function removerRotaNovaDevUI(cod) {
  _devRotasNovas = _devRotasNovas.filter((r) => r !== cod);
  renderRotasNovasDev();
}

async function criarDevolucaoUI() {
  const v = (id) => (document.getElementById(id) || {}).value || '';
  /* Rota escolhida no seletor mas sem clique no "➕ Rota" conta mesmo
     assim — esquecer o clique não pode custar um checklist sem a rota. */
  const noSeletor = v('dev-rota');
  const rotas = _devRotasNovas.slice();
  if (noSeletor && !rotas.includes(noSeletor)) rotas.push(noSeletor);
  if (!rotas.length) { notify('Escolha pelo menos uma rota — região + rotas identificam o checklist.', 'warn'); return; }
  /* Placa/transportadora/motorista ficaram com a PORTARIA (decisão de
     18/08/2026) — as meninas lançam região, rotas, NT e o código do
     operador do monitoramento. */
  const corpo = {
    dataDev: v('dev-data') || diaLocalDev(),
    rotas,
    regiao: v('dev-regiao'),
    notaTransferencia: v('dev-nota-transf'),
    operadorCodigo: v('dev-operador-cod'),
    itens: [],
  };
  try {
    const d = await SuincoSharePoint.devolucoes.criar(corpo);
    notify(`Checklist Nº ${d.numero} criado (${devRotulo(d)}). Agora lance os itens na linha do próprio checklist.`, 'success', 6000);
    ['dev-regiao', 'dev-nota-transf', 'dev-operador-cod']
      .forEach((id) => { const e = document.getElementById(id); if (e) e.value = ''; });
    _devRotasNovas = [];
    renderRotasNovasDev();
    const filtro = document.getElementById('dev-filtro-dia');
    if (filtro) filtro.value = corpo.dataDev;
    _devExpandida = d.id;
    await carregarDevolucoes();
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou a criação.', 'danger', 7000);
  }
}

/* Troca de rotas num checklist já criado (chips na própria linha). */
function tirarRotaDevolucaoUI(id, cod) {
  const d = getDevolucao(id);
  if (!d) return;
  const rotas = (d.rotas || []).filter((r) => r !== cod);
  if (!rotas.length) { notify('O checklist precisa de pelo menos uma rota.', 'warn'); return; }
  acaoDev(SuincoSharePoint.devolucoes.editar(id, { rotas }));
}

function incluirRotaDevolucaoUI(id) {
  const sel = document.getElementById(`dev-addrota-${id}`);
  const cod = sel && sel.value;
  if (!cod) { notify('Escolha a rota a incluir.', 'warn'); return; }
  const d = getDevolucao(id);
  if (!d) return;
  const rotas = (d.rotas || []).slice();
  if (!rotas.includes(cod)) rotas.push(cod);
  acaoDev(SuincoSharePoint.devolucoes.editar(id, { rotas }));
}

function editarDevolucaoCampoUI(id, campo, valor) {
  /* Mudou a DATA do checklist: a lista filtra por dia, então ele "muda de
     página". Avisar evita o susto de "sumiu" — e o filtro acompanha. */
  if (campo === 'dataDev' && /^\d{4}-\d{2}-\d{2}$/.test(String(valor))) {
    const filtro = document.getElementById('dev-filtro-dia');
    if (filtro && filtro.value !== valor) {
      filtro.value = valor;
      notify(`Checklist movido para o dia ${valor.split('-').reverse().join('/')} — o filtro da lista acompanhou.`, 'info', 6000);
    }
  }
  let corpo = { [campo]: valor };
  /* Trocar a PLACA num checklist já criado também puxa a Frota — mesma
     regra do formulário: transportadora e motorista vêm do cadastro, não
     da memória de quem digita (e continuam editáveis depois). */
  if (campo === 'placa' && typeof buscarFrota === 'function') {
    const f = buscarFrota(valor);
    if (f) {
      if (f.transportadora) corpo.transportadora = f.transportadora;
      if (f.motorista) corpo.motorista = f.motorista;
      notify(`Placa ${normalizarPlaca(valor)} reconhecida na Frota — transportadora e motorista preenchidos do cadastro.`, 'info');
    } else if (normalizarPlaca(valor)) {
      notify(`⚠ ${normalizarPlaca(valor)} não está no cadastro de Frota — confira a placa.`, 'warn', 6000);
    }
  }
  acaoDev(SuincoSharePoint.devolucoes.editar(id, corpo));
}

function excluirDevolucaoUI(id) {
  const d = getDevolucao(id);
  if (!d) return;
  if (!confirm(`Excluir o checklist Nº ${d.numero} (${devRotulo(d)})? Ele some do painel e dos relatórios; o registro fica no histórico.`)) return;
  acaoDev(SuincoSharePoint.devolucoes.excluir(id), 'Checklist excluído.');
}

function avancarEtapaDevolucaoUI(id) {
  const d = getDevolucao(id);
  if (!d) return;
  const etapa = DEV_ETAPAS.find((e) => e.status === d.status);
  if (!etapa) return;
  const v = (sufixo) => (document.getElementById(`dev-et-${id}-${sufixo}`) || {}).value;
  const corpo = { para: etapa.proxima };
  if (etapa.pede === 'portaria') {
    /* Só manda o que foi PREENCHIDO: campo vazio do porteiro não pode
       apagar um valor que a Logística já tenha posto no cabeçalho. */
    const põeSe = (chave, valor) => { if (String(valor || '').trim()) corpo[chave] = valor; };
    põeSe('placa', v('placa'));
    põeSe('transportadora', v('transportadora'));
    põeSe('motorista', v('motorista'));
    põeSe('lacre1', v('lacre1'));
    põeSe('lacre2', v('lacre2'));
  } else if (etapa.pede === 'faturamento') {
    corpo.pesoFinal = v('peso') || '';
  } else if (etapa.pede === 'controles') {
    corpo.obsControles = v('obs') || '';
  }
  acaoDev(SuincoSharePoint.devolucoes.etapa(id, corpo), `Etapa registrada: ${etapa.proxima}.`);
}

function editarItemDevolucaoUI(id, itemId, campo, valor) {
  let corpo;
  if (campo === 'parcial') corpo = { parcial: !!valor };
  else if (campo === 'codProduto') {
    corpo = { codProduto: valor, produtoNome: devProdutoNomePorCodigo(valor) };
  } else if (campo === 'codCliente') {
    // O cliente puxa o vínculo RCA/supervisor também na linha já gravada
    // (mesma lógica da placa→Frota). A busca é no servidor; o que a base
    // não sabe, não mexe.
    (async () => {
      const corpoCli = { codCliente: valor };
      const cli = await buscarClienteExatoDev(valor);
      if (cli) {
        if (cli.vendedor) corpoCli.vendedor = cli.vendedor;
        if (cli.supervisor) corpoCli.supervisor = cli.supervisor;
        notify(`Cliente ${cli.codigo}${cli.apelido ? ' (' + cli.apelido + ')' : ''} reconhecido — RCA e supervisor preenchidos do cadastro.`, 'info');
      }
      acaoDev(SuincoSharePoint.devolucoes.editarItem(id, itemId, corpoCli));
    })();
    return;
  } else corpo = { [campo]: valor };
  acaoDev(SuincoSharePoint.devolucoes.editarItem(id, itemId, corpo));
}

function adicionarItemDevolucaoUI(id) {
  const v = (sufixo) => (document.getElementById(`dev-ni-${id}-${sufixo}`) || {}).value || '';
  const codProduto = v('produto');
  const pesoDigitado = v('peso');
  const pesoFinalLinha = pesoDigitado !== '' ? pesoDigitado
    : (devPesoSugerido(codProduto, v('cx')) ?? '');
  const corpo = {
    nota: v('nota'),
    parcial: !!v('parcial'),
    supervisor: v('supervisor'),
    vendedor: v('vendedor'),
    codCliente: v('cliente'),
    cx: v('cx'),
    peso: pesoFinalLinha,
    codProduto,
    produtoNome: devProdutoNomePorCodigo(codProduto),
    numDev: v('numdev'),
    motivo: v('motivo'),
    // A data da linha vem do campo Data DEV (a coluna da capa); sem ele,
    // cai no dia do filtro.
    dataItem: v('dataitem') || (document.getElementById('dev-filtro-dia') || {}).value || diaLocalDev(),
  };
  if (!corpo.nota && !codProduto) {
    notify('Preencha ao menos a nota fiscal ou o código do produto.', 'warn');
    return;
  }
  acaoDev(SuincoSharePoint.devolucoes.criarItem(id, corpo));
}

function excluirItemDevolucaoUI(id, itemId) {
  if (!confirm('Remover esta linha do checklist?')) return;
  acaoDev(SuincoSharePoint.devolucoes.excluirItem(id, itemId));
}

function adicionarDivergenciaDevolucaoUI(id) {
  const v = (sufixo) => (document.getElementById(`dev-dv-${id}-${sufixo}`) || {}).value || '';
  const codProduto = v('produto');
  if (!codProduto) { notify('Informe o código do produto que chegou fora do checklist.', 'warn'); return; }
  acaoDev(SuincoSharePoint.devolucoes.criarDivergencia(id, {
    codProduto,
    produtoNome: devProdutoNomePorCodigo(codProduto),
    cx: v('cx'),
    observacao: v('obs'),
  }), 'Divergência lançada — a falta do item original continua contando.');
}

function excluirDivergenciaDevolucaoUI(id, divId) {
  acaoDev(SuincoSharePoint.devolucoes.excluirDivergencia(id, divId));
}

/* ---------- revisões (Administração; reusa o modal das cargas) ---------- */

async function abrirRevisoesDevolucaoUI(id) {
  const d = getDevolucao(id);
  if (!d) return;
  const modal = document.getElementById('modal-revisoes');
  document.getElementById('revisoes-titulo').textContent =
    `Alterações — checklist de devolução Nº ${d.numero} · ${devRotulo(d)}`;
  const lista = document.getElementById('revisoes-lista');
  lista.innerHTML = '<div class="card-sub">Buscando no servidor…</div>';
  modal.classList.add('open');
  try {
    const revs = await SuincoSharePoint.devolucoes.listarRevisoes(id);
    if (!revs.length) {
      lista.innerHTML = '<div class="card-sub">Nenhuma alteração de cabeçalho registrada ainda.</div>';
      return;
    }
    lista.innerHTML = revs.map((r) => {
      const s = r.devolucao || {};
      return `<div class="revisao-item">
          <div class="revisao-meta">
            <strong>${esc(fmtDataHora(r.gravadaEm))}</strong>
            — mudança feita por ${esc(r.mudadaPor || '—')}${r.mudadaSetor ? ' · ' + esc(r.mudadaSetor) : ''}
          </div>
          <div class="revisao-dados">
            Estado anterior: rota(s) ${esc((s.rotas || []).join(', ') || '—')} · transp. ${esc(s.transportadora || '—')}
            · NT ${esc(s.notaTransferencia || '—')} · status ${esc(s.status || '—')}
            ${s.pesoFinal !== null && s.pesoFinal !== undefined ? ` · peso final ${Number(s.pesoFinal).toLocaleString('pt-BR')} kg` : ''}
          </div>
          <div class="flex-end"><button class="btn btn-sec btn-sm"
            onclick="restaurarRevisaoDevolucaoUI('${escJs(id)}',${r.revisaoId})">Restaurar este estado</button></div>
        </div>`;
    }).join('');
  } catch (e) {
    lista.innerHTML = `<div class="card-sub">Não consegui listar: ${esc(e.message || 'erro')}</div>`;
  }
}

async function restaurarRevisaoDevolucaoUI(id, revisaoId) {
  if (!confirm('Restaurar o checklist para este estado anterior? A mudança vale para todos e fica no log.')) return;
  try {
    await SuincoSharePoint.devolucoes.restaurar(id, revisaoId);
    notify('Checklist restaurado.', 'success');
    fecharRevisoesUI();
    await carregarDevolucoes();
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou a restauração.', 'danger', 7000);
  }
}

/* ---------- comprovante da Portaria (o papel do porteiro, sem caneta) ----------

   Observação da Bruna (18/08/2026): o porteiro escrevia num papel a carga
   e a placa para o motorista entregar ao faturista — era assim que a
   balança sabia QUAL devolução estava chegando. O papel continua (o
   motorista precisa levar algo na mão), mas agora sai impresso do
   sistema, com os dados que a Portaria acabou de carimbar. */
async function comprovantePortariaUI(id) {
  const d = getDevolucao(id);
  if (!d) return;
  const el = document.getElementById('print-devolucoes');
  if (!el) return;
  const c = d.carimbos.portaria;
  const linha = (rot, val) => `<div class="dev-comp-linha">
      <span class="dev-comp-rot">${rot}</span>
      <span class="dev-comp-val">${esc(String(val || '—'))}</span></div>`;
  el.innerHTML = `
    <div class="print-page doc-normal">
      ${cabecalhoDocumento({
        titulo: 'Comprovante de Devolução — Portaria',
        subtitulo: `Checklist Nº ${d.numero} · ${esc(devRotulo(d))} / ${esc(devIniciais(d.criadaPor))}`,
      })}
      <div class="dev-comprovante">
        ${linha('Nº DA CARGA', d.cargaNumero)}
        ${linha('PLACA', d.placa)}
        ${linha('MOTORISTA', d.motorista)}
        ${linha('TRANSPORTADORA', d.transportadora)}
        ${linha('REGIÃO / ROTAS', `${d.regiao ? d.regiao + ' — ' : ''}${(d.rotas || []).join(' · ')}`)}
        ${linha('LACRE(S)', [d.lacre1, d.lacre2].filter(Boolean).join(' · '))}
        ${linha('RECEBIDO POR', c ? `${c.por} · ${fmtDataHora(c.em)}` : '—')}
      </div>
      ${rodapeDocumento(
        'Entregar este comprovante ao motorista, que o apresenta na balança do '
        + 'Faturamento — é assim que o faturista identifica QUAL devolução chegou. '
        + 'Substitui a anotação à mão do porteiro.',
        '', '')}
    </div>`;
  await exportarViaServidor(el, `Comprovante-Devolucao-${d.numero}`);
}

/* ---------- relatório do dia (mesmo padrão dos demais) ---------- */

async function relatorioDevolucoesUI() {
  if (!devServidorOk()) {
    notify('O relatório de devoluções vem do servidor — entre com login de servidor.', 'warn', 6000);
    return;
  }
  await carregarDevolucoes();
  const dia = (document.getElementById('dev-filtro-dia') || {}).value || diaLocalDev();
  const el = document.getElementById('print-devolucoes');
  if (!el) return;

  const [ano, mes, diaN] = dia.split('-');
  const diaBR = `${diaN}/${mes}/${ano}`;
  const totalCx = DEVOLUCOES.reduce((s, d) => s + d.itens.reduce((x, i) => x + (i.cx || 0), 0), 0);
  const totalFalta = DEVOLUCOES.reduce((s, d) => s
    + d.itens.reduce((x, i) => x + (i.falta || 0), 0), 0);
  const totalDiverg = DEVOLUCOES.reduce((s, d) => s + d.divergencias.length, 0);

  const bloco = (d) => `
    <div class="dev-doc-checklist">
      ${tituloSecaoPdf(
        `Checklist Nº ${d.numero} — ${d.regiao ? esc(d.regiao) + ' · ' : ''}Rota(s) ${esc((d.rotas || []).join(', ') || '—')} · ${esc(d.status)}`,
        `Gerado por <strong>${esc(d.criadaPor)}</strong>`
        + `${d.regiao ? ' · Região ' + esc(d.regiao) : ''}`
        + `${d.transportadora ? ' · Transportadora ' + esc(d.transportadora) : ''}`
        + `${d.notaTransferencia ? ' · NT ' + esc(d.notaTransferencia) : ''}`
        + `${d.placa ? ' · Placa ' + esc(d.placa) : ''}`
        + `${d.cargaNumero ? ' · Carga ' + esc(d.cargaNumero) : ''}`
        + `${d.operadorCodigo ? ' · Cód. operador ' + esc(d.operadorCodigo) : ''}`
        + `${d.lacre1 ? ' · Lacre ' + esc([d.lacre1, d.lacre2].filter(Boolean).join('/')) : ''}`
        + `${d.pesoFinal !== null ? ' · Peso final ' + d.pesoFinal.toLocaleString('pt-BR') + ' kg' : ''}`)}
      <table class="dev-doc-tabela">
        <thead><tr>
          <th>Nota</th><th>P/T</th><th>Supervisor</th><th title="Vendedor">RCA</th><th>Cód. Cliente</th>
          <th>CX</th><th>Peso</th><th>Produto</th><th>Nº DEV</th><th>Data DEV</th><th>Motivo</th>
          <th>Pesagem</th><th>Expedição</th><th>Falta</th><th>Destinação</th><th>Nota final</th>
        </tr></thead>
        <tbody>${d.itens.map((i) => `<tr${i.falta > 0 ? ' class="dev-doc-falta"' : ''}>
            <td>${esc(i.nota)}</td><td>${i.parcial ? 'P' : 'T'}</td>
            <td>${esc(i.supervisor)}</td><td>${esc(i.vendedor)}</td><td>${esc(i.codCliente)}</td>
            <td class="c-peso">${i.cx.toLocaleString('pt-BR')}</td>
            <td class="c-peso">${i.peso !== null ? i.peso.toLocaleString('pt-BR') : '—'}</td>
            <td>${esc(i.codProduto)}${i.produtoNome ? '-' + esc(i.produtoNome) : ''}</td>
            <td>${esc(i.numDev)}</td>
            <td>${i.dataItem ? esc(String(i.dataItem).slice(0, 10).split('-').reverse().join('/')) : '—'}</td>
            <td>${esc(i.motivo)}</td>
            <td class="c-peso">${i.pesoFaturamento !== null ? i.pesoFaturamento.toLocaleString('pt-BR') : '—'}</td>
            <td class="c-peso">${i.qtdRecebida ?? '—'}</td>
            <td class="c-peso">${i.falta === null ? '—' : (i.falta > 0 ? 'FALTA ' + i.falta.toLocaleString('pt-BR') : 'OK')}</td>
            <td>${esc(devDestinoResumo(i)) || '—'}</td>
            <td>${i.notaFinal ? '✔' : '—'}</td>
          </tr>`).join('')}</tbody>
      </table>
      ${d.divergencias.length ? `<div class="dev-doc-diverg">
          <strong>Divergentes (fora do checklist):</strong>
          ${d.divergencias.map((v) => `${v.cx.toLocaleString('pt-BR')} cx ${esc(v.codProduto)}${v.produtoNome ? '-' + esc(v.produtoNome) : ''}${v.observacao ? ' (' + esc(v.observacao) + ')' : ''}`).join(' · ')}
        </div>` : ''}
      ${d.obsControles ? `<div class="dev-doc-diverg"><strong>Obs. Controles Internos:</strong> ${esc(d.obsControles)}</div>` : ''}
      <div class="dev-doc-carimbos">
        ${Object.entries(DEV_ETAPA_ROTULO).map(([chave, rotulo]) => {
          const c = d.carimbos[chave];
          return `<span class="dev-doc-carimbo">${rotulo}: ${c ? esc(c.por) + ' ' + esc(fmtDataHora(c.em)) : '—'}</span>`;
        }).join('')}
      </div>
    </div>`;

  el.innerHTML = `
    <div class="print-page doc-normal">
      ${cabecalhoDocumento({
        titulo: 'Relatório de Devoluções',
        subtitulo: `Checklists do dia ${diaBR} · ${DEVOLUCOES.length} checklist(s) · `
          + `${totalCx.toLocaleString('pt-BR')} cx`
          + `${totalFalta > 0 ? ' · FALTAS: ' + totalFalta.toLocaleString('pt-BR') + ' cx' : ''}`
          + `${totalDiverg > 0 ? ' · ' + totalDiverg + ' divergente(s)' : ''}`,
      })}
      ${DEVOLUCOES.length ? DEVOLUCOES.map(bloco).join('')
        : '<div class="card-sub">Nenhum checklist de devolução neste dia.</div>'}
      ${rodapeDocumento(
        'Cada checklist identifica quem o gerou. A coluna FALTA é calculada '
        + 'pelo sistema (caixas do checklist menos caixas recebidas na descarga); '
        + 'produtos divergentes não abatem falta.',
        `Checklists de devolução do dia ${diaBR}, gravados no servidor pelo painel.`,
        '')}
    </div>`;

  await exportarViaServidor(el, `Devolucoes-${dia}`);
}

/* ---------- tempo real ---------- */

/* O evento chega para QUALQUER devolução alterada em qualquer terminal.
   Recarrega só se a aba estiver aberta — fora dela não há o que redesenhar,
   e a próxima abertura já busca tudo de novo. */
if (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.aoAtualizarDevolucao) {
  SuincoSharePoint.aoAtualizarDevolucao(() => {
    if (typeof TAB_ATUAL !== 'undefined' && TAB_ATUAL === 'devolucoes') {
      carregarDevolucoes();
    }
  });
}

/* ---------- cadastros de apoio (card na aba Cadastros) ---------- */

function atualizarResumoCadDev() {
  const el = document.getElementById('cad-dev-resumo');
  if (!el) return;
  el.textContent = `Cadastrados: ${(DEV_CADASTROS.supervisores || []).length} supervisor(es) · `
    + `${(DEV_CADASTROS.produtos || []).length} produto(s) · `
    + `${(DEV_CADASTROS.motivos || []).length} motivo(s) · `
    + `${(DEV_CADASTROS.representantes || []).length} RCA(s) · `
    + `${DEV_CADASTROS.clientesTotal ?? 0} cliente(s).`;
}

async function cadastrarSupervisorDevUI() {
  const el = document.getElementById('cad-dev-supervisor');
  const nome = (el && el.value || '').trim();
  if (!nome) { notify('Informe o nome do supervisor.', 'warn'); return; }
  try {
    await SuincoSharePoint.devolucoes.cadastrarSupervisor(nome);
    notify(`Supervisor ${nome} cadastrado.`, 'success');
    el.value = '';
    _devCadastrosCarregados = false;
    await carregarCadastrosDev();
    atualizarResumoCadDev();
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou o cadastro.', 'danger', 6000);
  }
}

async function cadastrarProdutoDevUI() {
  const cod = (document.getElementById('cad-dev-prod-codigo') || {}).value || '';
  const nome = (document.getElementById('cad-dev-prod-nome') || {}).value || '';
  const kg = (document.getElementById('cad-dev-prod-kg') || {}).value || '';
  if (!cod.trim()) { notify('Informe o código do produto.', 'warn'); return; }
  try {
    await SuincoSharePoint.devolucoes.cadastrarProduto(cod.trim(), nome.trim(), kg);
    notify(`Produto ${cod.trim()}${nome.trim() ? '-' + nome.trim() : ''}`
      + `${kg ? ` (${kg} kg/cx)` : ''} cadastrado.`, 'success');
    ['cad-dev-prod-codigo', 'cad-dev-prod-nome', 'cad-dev-prod-kg'].forEach((id) => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    _devCadastrosCarregados = false;
    await carregarCadastrosDev();
    atualizarResumoCadDev();
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou o cadastro.', 'danger', 6000);
  }
}

async function cadastrarMotivoDevUI() {
  const el = document.getElementById('cad-dev-motivo');
  const motivo = (el && el.value || '').trim();
  if (!motivo) { notify('Informe o motivo.', 'warn'); return; }
  try {
    await SuincoSharePoint.devolucoes.cadastrarMotivo(motivo);
    notify(`Motivo "${motivo}" cadastrado.`, 'success');
    el.value = '';
    _devCadastrosCarregados = false;
    await carregarCadastrosDev();
    atualizarResumoCadDev();
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou o cadastro.', 'danger', 6000);
  }
}

/* ---------- tabela de produtos na aba Cadastros ----------
   A base oficial (INFORMAÇÕES DE PRODUTOS, 18/08/2026) inteira, com
   busca — mesma pegada da tabela de Frota. Produto INATIVO aparece
   marcado, mas não entra nas sugestões de lançamento. */
function renderProdutosDevUI() {
  const tbody = document.getElementById('cad-dev-prod-tbody');
  if (!tbody) return;
  const termo = ((document.getElementById('cad-dev-prod-busca') || {}).value || '')
    .trim().toLowerCase();
  const todos = DEV_CADASTROS.produtos || [];
  const lista = (termo
    ? todos.filter((p) => `${p.codigo} ${p.nome} ${p.categoria || ''}`.toLowerCase().includes(termo))
    : todos).slice(0, 200);
  tbody.innerHTML = lista.map((p) => `<tr${p.ativo === false ? ' class="text-dim"' : ''}>
      <td>${esc(p.codigo)}</td>
      <td>${esc(p.nome)}</td>
      <td>${esc(p.categoria || '—')}</td>
      <td>${esc(p.temperatura || '—')}</td>
      <td>${esc(p.validade || '—')}</td>
      <td class="c-peso">${p.pesoCaixaKg ?? (p.pesoLiquidoTxt || '—')}</td>
      <td>${p.ativo === false ? 'Inativo' : 'Sim'}</td>
    </tr>`).join('');
  const cont = document.getElementById('cad-dev-prod-contagem');
  if (cont) {
    cont.textContent = `${todos.length} produto(s) na base`
      + (termo ? ` · ${lista.length} na busca` : '')
      + (lista.length === 200 ? ' · mostrando os 200 primeiros — refine a busca' : '');
  }
}

/* ---------- exportação CSV dos cadastros de devoluções ----------
   Servidor-first: garante a lista ATUALIZADA antes de gerar (pedido de
   18/08/2026: "todo o registro de cadastro, atualizado"). */
async function exportarCadastroDevCsv(qual) {
  if (!devServidorOk()) {
    notify('Exportar cadastros exige conexão com o servidor.', 'warn');
    return;
  }
  try {
    DEV_CADASTROS = await SuincoSharePoint.devolucoes.cadastros();
    _devCadastrosCarregados = true;
  } catch (e) {
    notify('Não consegui atualizar o cadastro antes de exportar: ' + (e.message || 'erro'), 'danger', 6000);
    return;
  }
  if (qual === 'produtos') {
    baixarCsvCadastro('Produtos',
      ['Código', 'Produto', 'Categoria', 'Temperatura', 'Validade', 'EAN',
       'Peso líquido (planilha)', 'kg por caixa', 'Ativo'],
      (DEV_CADASTROS.produtos || []).map((p) => [p.codigo, p.nome, p.categoria || '',
        p.temperatura || '', p.validade || '', p.ean || '',
        p.pesoLiquidoTxt || '', p.pesoCaixaKg ?? '', p.ativo === false ? 'Não' : 'Sim']));
  } else if (qual === 'supervisores') {
    baixarCsvCadastro('Supervisores', ['Supervisor'],
      (DEV_CADASTROS.supervisores || []).map((s) => [s]));
  } else if (qual === 'representantes') {
    baixarCsvCadastro('Representantes', ['Representante (RCA)'],
      (DEV_CADASTROS.representantes || []).map((s) => [s]));
  } else if (qual === 'motivos') {
    baixarCsvCadastro('Motivos', ['Motivo de devolução'],
      (DEV_CADASTROS.motivos || []).map((s) => [s]));
  } else if (qual === 'clientes') {
    // 76 mil linhas: o CSV vem pronto do servidor, não do JSON do painel.
    try {
      const blob = await SuincoSharePoint.devolucoes.clientesCsv();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Suinco_Cadastro_Clientes.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      notifyGravacao('Cadastro de Clientes exportado (arquivo completo do servidor).');
    } catch (e) {
      notify((e && e.message) || 'Não consegui exportar os clientes.', 'danger', 6000);
    }
  }
}

/* ---------- placa puxa a Frota no recebimento da PORTARIA ----------
   Decisão de 18/08/2026: placa/transportadora/motorista são inputs da
   Portaria (saíram do lançamento das meninas). Quem sabe a transportadora
   e o motorista da placa é o cadastro de Frota, não a digitação: o
   porteiro digita a placa e os dois campos preenchem sozinhos — e
   continuam editáveis (motorista substituto existe). Placa fora da Frota
   só AVISA: devolução não pode travar por cadastro faltando. */
function frotaNaEtapaDevUI(devId) {
  const v = (sufixo) => document.getElementById(`dev-et-${devId}-${sufixo}`);
  const campoPlaca = v('placa');
  if (!campoPlaca) return;
  const p = normalizarPlaca(campoPlaca.value);
  if (!p) return;
  const f = (typeof buscarFrota === 'function') ? buscarFrota(p) : null;
  if (!f) {
    if (p.length >= 7) {
      notify(`⚠ ${p} não está no cadastro de Frota — confira a placa (dá para receber mesmo assim).`, 'warn', 6000);
    }
    return;
  }
  const vT = v('transportadora');
  const vM = v('motorista');
  if (vT && f.transportadora) vT.value = f.transportadora;
  if (vM && f.motorista) vM.value = f.motorista;
  notify(`✔ ${p} reconhecida na Frota — ${[f.transportadora, f.motorista].filter(Boolean).join(' · ')}.`, 'info');
}

/* ---------- cliente puxa RCA e supervisor (pedido de 18/08/2026) ----------
   Mesma lógica da placa→Frota: o código do cliente traz o RCA (com
   código) e o supervisor (com código) do cadastro de Clientes — que a
   Logística alimenta na aba Cadastros E que aprende sozinho de cada item
   de checklist gravado. Campos continuam editáveis. */
/* Cache das últimas sugestões buscadas — é nele que o "match exato" é
   resolvido sem uma segunda viagem quando a pessoa escolhe da lista. */
let _devClientesSugestoes = [];
let _devSugestaoTimer = null;

function sugerirClientesDevUI(valor) {
  const q = String(valor || '').trim();
  clearTimeout(_devSugestaoTimer);
  if (q.length < 2 || !devServidorOk()) return;
  _devSugestaoTimer = setTimeout(async () => {
    try {
      _devClientesSugestoes = await SuincoSharePoint.devolucoes.buscarClientes(q);
      const dl = document.getElementById('dl-dev-clientes');
      if (dl) {
        dl.innerHTML = _devClientesSugestoes
          .map((c) => `<option value="${esc(c.codigo)}">${esc([c.apelido, c.nome, c.vendedor].filter(Boolean).join(' · ').slice(0, 120))}</option>`)
          .join('');
      }
    } catch (e) { /* sugestão é bônus — sem alarde se falhar */ }
  }, 250);
}

/* Match exato por CÓDIGO ou APELIDO (as capas usam "SENDAS", "AREAL").
   Tenta o cache das sugestões; sem ele, uma busca direta no servidor. */
async function buscarClienteExatoDev(valor) {
  const alvo = String(valor || '').trim().toLowerCase();
  if (!alvo) return null;
  const acha = (lista) => (lista || []).find((c) =>
    String(c.codigo).trim().toLowerCase() === alvo
    || String(c.apelido || '').trim().toLowerCase() === alvo) || null;
  const doCache = acha(_devClientesSugestoes);
  if (doCache) return doCache;
  if (!devServidorOk()) return null;
  try {
    return acha(await SuincoSharePoint.devolucoes.buscarClientes(alvo));
  } catch (e) { return null; }
}

async function autofillClienteDevUI(devId) {
  const v = (sufixo) => document.getElementById(`dev-ni-${devId}-${sufixo}`);
  const campoCliente = v('cliente');
  if (!campoCliente) return;
  const cli = await buscarClienteExatoDev(campoCliente.value);
  if (!cli) return;
  const campoRca = v('vendedor');
  const campoSup = v('supervisor');
  if (campoRca && cli.vendedor) campoRca.value = cli.vendedor;
  if (campoSup && cli.supervisor) campoSup.value = cli.supervisor;
  if (cli.vendedor || cli.supervisor) {
    notify(`Cliente ${cli.codigo}${cli.apelido ? ' (' + cli.apelido + ')' : ''} reconhecido — ${[cli.vendedor, cli.supervisor].filter(Boolean).join(' · ')}.`, 'info');
  }
}

async function cadastrarClienteDevUI() {
  const v = (id) => ((document.getElementById(id) || {}).value || '').trim();
  const codigo = v('cad-dev-cli-codigo');
  if (!codigo) { notify('Informe o código do cliente.', 'warn'); return; }
  try {
    await SuincoSharePoint.devolucoes.cadastrarCliente({
      codigo, nome: v('cad-dev-cli-nome'),
      vendedor: v('cad-dev-cli-rca'), supervisor: v('cad-dev-cli-supervisor'),
    });
    notify(`Cliente ${codigo} cadastrado com o vínculo RCA/supervisor.`, 'success');
    ['cad-dev-cli-codigo', 'cad-dev-cli-nome', 'cad-dev-cli-rca', 'cad-dev-cli-supervisor']
      .forEach((id) => { const e = document.getElementById(id); if (e) e.value = ''; });
    _devCadastrosCarregados = false;
    await carregarCadastrosDev();
    atualizarResumoCadDev();
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou o cadastro.', 'danger', 6000);
  }
}
