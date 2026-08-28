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
let _devDiaCarregado = null;  // dia que a lista em memória representa
/* Rotas escolhidas no formulário de NOVO checklist — um checklist junta
   várias rotas da mesma região (pedido de 18/08/2026). */
let _devRotasNovas = [];
/* Filtro da esteira (clique numa caixa de etapa) — null = todas. */
let _devFiltroEtapa = null;

function devRotulo(d) {
  if (d.tipo === 'SOBRA') return 'SOBRA';
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
    botao: '⚖️ Pesar na chegada (Faturamento)', pede: 'faturamento',
    setores: ['Faturamento', 'Logística'] },
  /* O "OKZINHO" DA EXPEDIÇÃO (28/08/2026).

     O dono, depois de ouvir a Expedição: "quando o caminhão chega à
     expedição, eles não conseguem verificar se toda a quantidade chegou
     nem fazer a destinação imediatamente. Por isso pediram para deixar
     apenas o 'OKzinho', como na Central de Notas".

     Era `pede: null` — a etapa tinha só o botão, sem nem um lugar para
     escrever. Agora é check + recado, igual às duas últimas etapas. A
     conferência de quantidade e a destinação continuam na tela e podem ser
     feitas depois, por eles ou pela Logística: elas nunca travaram o OK, e
     tirá-las apagaria a "falta", que é o que o checklist existe para
     apontar. */
  { status: 'Conferida no Faturamento', proxima: 'Descarga Conferida',
    botao: '📦 Descarga conferida (Expedição)', pede: 'expedicao',
    setores: ['Expedição', 'Logística'] },
  /* A SEGUNDA IDA À BALANÇA (27/08/2026). O dono: "depois que descarrega
     o motorista volta pra balança e pesa o peso final com o caminhão
     vazio". É do Faturamento, como a primeira, mas é outro momento e
     outra assinatura. */
  { status: 'Descarga Conferida',       proxima: 'Peso Final Registrado',
    botao: '⚖️ Registrar peso final (Faturamento)', pede: 'pesofinal',
    setores: ['Faturamento', 'Logística'] },
  { status: 'Peso Final Registrado',    proxima: 'Destinada',
    /* "Destinações" — pedido do dono (26/08/2026): "alterar nome no painel,
       destinações", valendo SÓ para a etapa dos Controles Internos. O nome
       de tela muda; o STATUS gravado ('Destinada') fica: é dado, o servidor
       valida a transição por ele, e renomear valor de banco por estética é
       como nasceu mais de um incidente por aqui. */
    botao: '🏷️ Destinações (Controles Internos)', pede: 'controles',
    setores: ['Controles Internos', 'Logística'] },
  { status: 'Destinada',                proxima: 'Nota Finalizada',
    /* `pede: 'notas'` desde 27/08/2026: a última etapa também deixa recado.
       Estava null, e o campo de observações simplesmente não aparecia para
       a Central de Notas — o teste pegou. */
    botao: '🧾 Finalizar nota (Central de Notas)', pede: 'notas',
    setores: ['Central de Notas', 'Logística'] },
];

const DEV_ETAPA_ROTULO = {
  portaria: 'Portaria', faturamento: 'Balança (entrada)', expedicao: 'Expedição',
  pesofinal: 'Balança (peso final)',
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
/* O Nº DA CARGA DE DEVOLUÇÃO é da PORTARIA (20/08/2026).

   Ele não existe quando o checklist é lançado: nasce depois, quando o
   porteiro abre a "Montagem de Cargas" do SIS ATAK, escolhe a rota, joga as
   DEVs daquela rota para dentro e salva — o "Número Documento" que aparece
   ali é este número. Por isso é a Portaria quem digita, e por isso ele é
   diferente do Nº DEV, que já vem escrito no checklist. */
/* O número da carga vale para o checklist inteiro quando o porteiro montou
   tudo de uma vez — e é assim na maioria das chegadas. A coluna do item só
   se preenche quando as DEVs do mesmo checklist foram para montagens
   DIFERENTES (checklist com mais de uma rota: no SIS ATAK a montagem é por
   rota). Vazio no item, portanto, não é falta de informação: é "vale o do
   cabeçalho". */
/* OS LACRES DA CHEGADA, NO RELATÓRIO (20/08/2026).

   Pedido do gestor: as informações de lacre "tanto na saída quanto
   devoluções" precisam sair fiéis nos relatórios. Na saída isso vive no
   Relatório Operacional (blocoLacresPdf, em app.js); aqui é a outra ponta —
   o que o porteiro encontrou quando o caminhão VOLTOU.

   "Chegou sem lacre" sai escrito, não em branco: campo vazio é ambíguo
   (ninguém anotou? ou não tinha lacre?), e foi para desfazer essa
   ambiguidade que `chegouLacrado` existe com três estados. */
function lacresChegadaDev(d) {
  const nums = [d.lacre1, d.lacre2, d.lacre3].filter(Boolean);
  if (d.chegouLacrado === false) {
    return ' · <strong>Chegou SEM lacre</strong>'
      + (nums.length ? ` (número anotado: ${esc(nums.join('/'))})` : '');
  }
  if (nums.length) {
    return ` · Lacre${nums.length > 1 ? 's' : ''} na chegada ${esc(nums.join(' / '))}`;
  }
  if (d.chegouLacrado === true) return ' · Chegou lacrado (número não anotado)';
  return ' · Lacre na chegada: não informado';
}

/* PARCIAL/TOTAL POR EXTENSO NOS RELATÓRIOS (20/08/2026).

   Saía "P" e "T". Pedido do gestor: escrever inteiro. E ele tem razão — o
   relatório sai do painel e vai para a mão de quem não abriu o painel: o
   operador do monitoramento, a Portaria, quem confere a carga na doca.
   Para essa pessoa, "P" e "T" são duas letras que ela precisa lembrar o que
   significam, e a diferença entre parcial e total é justamente o que decide
   se a nota volta inteira ou não.

   Na TELA a caixa de seleção continua escrita por extenso desde sempre —
   quem estava abreviado era só o papel. */
/* O CLIENTE NO PAPEL: CÓDIGO E NOME (20/08/2026).

   "O código do cliente no relatório não está puxando o nome do cliente,
   está puxando só o código." Mesma apresentação que o produto já usa —
   código, traço, nome — para as duas colunas se lerem igual. */
function clienteTextoDev(item) {
  const cod = esc(item && item.codCliente ? item.codCliente : '');
  const nome = esc(item && item.clienteNome ? item.clienteNome : '');
  if (cod && nome) return `${cod} - ${nome}`;
  return cod || nome || '—';
}

/* A CARGA DA DEV SÓ EXISTE DEPOIS QUE O CAMINHÃO CHEGA NA PORTARIA.

   Pedido do gestor (20/08/2026): "número da carga da dev não precisa no
   relatório antes da Portaria gerar o número que o SIS ATAK gera — só a
   Portaria pode fazer isso, quando a devolução chega lá".

   A relação para o operador é impressa ANTES disso, quando o caminhão nem
   saiu. Uma coluna que ninguém pode preencher ainda não é informação
   faltando: é informação que não existe, e no papel ela vira uma fileira de
   traços que faz o leitor procurar o que deveria estar ali. Então a coluna
   só entra no documento quando ALGUÉM já preencheu — no cabeçalho ou em
   alguma linha. */
function temCargaDev(d) {
  if (!d) return false;
  if (String(d.cargaNumero || '').trim()) return true;
  return (d.itens || []).some((i) => String(i.cargaDev || '').trim());
}

function parcialTotalTexto(item) {
  return item && item.parcial ? 'PARCIAL' : 'TOTAL';
}

function cargaDevDoItem(item, dev) {
  return (item && item.cargaDev) || (dev && dev.cargaNumero) || '';
}
function podeInformarCargaDev() {
  const setor = (DB.operador || {}).setor;
  return podeEditarDevolucao() || setor === 'Portaria';
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

/* AS etapas cujo DONO é o meu setor — são elas que definem a minha fila
   "SUA VEZ". Logística/Administração não têm uma só (cobrem todas): lista
   vazia.

   PLURAL desde 27/08/2026: o Faturamento passou a ter DUAS etapas (a
   balança da chegada e a do peso final). Enquanto isto era `find`, a
   segunda simplesmente não existia para ele — o checklist parava em
   "Descarga Conferida" e ninguém era chamado. */
function minhasEtapasDev() {
  const setor = (DB.operador || {}).setor;
  if (!setor || setor === 'Logística' || setor === 'Administração') return [];
  return DEV_ETAPAS.filter((e) => e.setores[0] === setor);
}

/* A etapa da minha fila que está ACONTECENDO agora, se houver. */
function minhaEtapaDev(status) {
  const minhas = minhasEtapasDev();
  if (!minhas.length) return null;
  if (status !== undefined) return minhas.find((e) => e.status === status) || null;
  return minhas[0];
}

function ehMinhaVezDev(d) {
  return minhasEtapasDev().some((e) => e.status === d.status);
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
  const cardSobra = document.getElementById('dev-card-sobra');
  if (cardSobra) cardSobra.hidden = !podeEditarDevolucao();
  const sobraData = document.getElementById('sobra-data');
  if (sobraData && !sobraData.value) sobraData.value = diaLocalDev();

  preencherSelectRotaDev();
  if (!_devCadastrosCarregados) carregarCadastrosDev();

  /* NÃO REBUSCAR A LISTA A CADA REDESENHO (27/08/2026).

     Relato do dono: "qualquer coisa que aparece atualizado apaga o
     checklist de devoluções".

     `renderAll()` roda toda vez que uma carga é criada, alterada ou
     movimentada em QUALQUER setor — e também na consulta periódica, sempre
     que algo mudou no dia. Ele chama esta função, que chamava
     `carregarDevolucoes()` sem perguntar: a lista era buscada de novo e
     `#dev-lista` reescrito inteiro. Quem estava lançando uma nota via os
     campos esvaziarem na frente dela.

     Carga não tem nada a ver com checklist. A lista recarrega quando há
     motivo: a primeira vez, uma troca de dia, uma ação de quem está aqui,
     ou o aviso `devolucao:atualizada` — que tem caminho próprio. */
  const diaPedido = (document.getElementById('dev-filtro-dia') || {}).value || diaLocalDev();
  if (_devDiaCarregado !== diaPedido) carregarDevolucoes();
  else renderListaDevolucoes();
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
    _devDiaCarregado = dia;
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
  const minhas = minhasEtapasDev();
  const ehMinhaEtapa = (status) => minhas.some((e) => e.status === status);
  const TODAS = [...DEV_ETAPAS.map((e) => e.status), 'Nota Finalizada'];
  el.innerHTML = TODAS.map((status) => {
    const n = porStatus[status] || 0;
    const ehMinha = ehMinhaEtapa(status);
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
    // Soma as DUAS pontas: o Faturamento pode ter caminhão esperando na
    // balança de entrada E na de saída ao mesmo tempo.
    const pendentes = minhas.reduce((soma, e) => soma + (porStatus[e.status] || 0), 0);
    aviso.hidden = !minhas.length || pendentes === 0;
    if (minhas.length && pendentes > 0) {
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

  const digitado = _devCapturarDigitacao();
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
          ${d.tipo === 'SOBRA' ? '<span class="dev-chip dev-chip-sobra">SOBRA</span>' : ''}
          <strong>Checklist Nº ${d.numero}</strong>
          <span class="dev-card-rota">${d.tipo === 'SOBRA'
            ? 'Sobras' + (d.criadaPor ? ' / ' + esc(devIniciais(d.criadaPor)) : '')
            : `${d.regiao ? esc(d.regiao) + ' — ' : ''}${(d.rotas || []).map((r) => 'Rota ' + esc(r)).join(' · ') || 'sem rota'}${d.criadaPor ? ' / ' + esc(devIniciais(d.criadaPor)) : ''}`}</span>
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
  _devRestaurarDigitacao(digitado);
}

/* NADA DIGITADO SE PERDE NUM REDESENHO (27/08/2026).

   A primeira metade do conserto (acima) tira os redesenhos que não tinham
   motivo. Sobram os que TÊM: alguém do outro lado mexeu no mesmo checklist,
   ou a própria pessoa gravou um campo. Nesses o quadro precisa ser refeito
   — e é aqui que o que está sendo digitado tem que atravessar.

   O critério é o que separa "digitado" de "veio do servidor": um campo cujo
   valor atual é diferente do valor com que ele NASCEU no HTML tem coisa
   digitada e ainda não gravada. Só esses voltam. Assim uma alteração que
   outro setor gravou aparece normalmente, e o que a pessoa está escrevendo
   nunca é sobrescrito — se os dois mexeram no mesmo campo, quem está com o
   dedo no teclado ganha, e vê o conflito quando gravar.

   Vale para todo campo com id dentro da lista: cabeçalho, linha do item,
   linha nova e divergência. É por isso que TODOS ganharam id. */
function _devValorDeNascimento(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.defaultChecked;
  if (el.tagName === 'SELECT') {
    const marcada = el.querySelector('option[selected]');
    return marcada ? marcada.value : (el.options[0] ? el.options[0].value : '');
  }
  return el.defaultValue;
}

function _devValorAtual(el) {
  return (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
}

function _devCapturarDigitacao() {
  const box = document.getElementById('dev-lista');
  if (!box) return null;
  const valores = {};
  box.querySelectorAll('input[id], select[id], textarea[id]').forEach((el) => {
    if (_devValorAtual(el) !== _devValorDeNascimento(el)) valores[el.id] = _devValorAtual(el);
  });
  const foco = document.activeElement;
  const dentro = foco && foco.id && box.contains(foco);
  return {
    valores,
    focoId: dentro ? foco.id : null,
    // Sem isto o cursor volta para o fim do campo e quem estava corrigindo
    // o meio de um número digita o resto no lugar errado.
    ini: dentro && typeof foco.selectionStart === 'number' ? foco.selectionStart : null,
    fim: dentro && typeof foco.selectionEnd === 'number' ? foco.selectionEnd : null,
  };
}

function _devRestaurarDigitacao(estado) {
  if (!estado) return;
  Object.keys(estado.valores).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;   // o campo saiu da tela (item excluído por outro setor)
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = estado.valores[id];
    else el.value = estado.valores[id];
  });
  if (!estado.focoId) return;
  const el = document.getElementById(estado.focoId);
  if (!el) return;
  el.focus();
  if (estado.ini !== null) {
    try { el.setSelectionRange(estado.ini, estado.fim); } catch (e) { /* number/date não aceitam */ }
  }
}

function alternarDevolucaoUI(id) {
  _devExpandida = _devExpandida === id ? null : id;
  renderListaDevolucoes();
}

function cabecalhoEditavelDev(d, editavel) {
  /* CADA POSTO VÊ O QUE É DELE (19/08/2026, reunião com a Logística).

     A tela delas estava com o cabeçalho inteiro — transportadora, nota de
     transferência, placa, motorista, carga, lacres — e nada disso é delas:
     "deixar o nosso só a data de devolução, a região e o código do
     operador, porque essa parte aqui, carga, lacre e tudo mais é a
     portaria".

     Faz sentido no fluxo real: a devolução é lançada ANTES do caminhão
     chegar. Na hora do lançamento esses campos não existem — o operador do
     monitoramento leva o relatório, e é com ele na mão que a Portaria
     identifica o checklist e preenche o que é dela.

     Então: cada setor edita o próprio bloco, e o que os outros já
     preencheram aparece como um resumo de leitura, curto, embaixo. */
  const setor = (DB.operador || {}).setor;
  const portariaEdita = setor === 'Portaria';
  const admin = setor === 'Administração';
  const campo = (rotulo, nome, valor, extra = '', podeEditar = false) => `
    <div><label>${rotulo}</label>
      ${podeEditar
        ? `<input type="text" id="dev-cab-${esc(d.id)}-${nome}" value="${esc(valor || '')}" ${extra}
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

  /* Data da devolução editável: as meninas lançam devoluções de OUTRAS
     datas — a data escolhida decide em que dia o checklist aparece. */
  const dataDev = String(d.dataDev || '').slice(0, 10);
  const campoData = `<div><label>Data da devolução</label>
      ${editavel
        ? `<input type="date" id="dev-cab-${esc(d.id)}-dataDev" value="${esc(dataDev)}"
             onchange="editarDevolucaoCampoUI('${escJs(d.id)}','dataDev',this.value)">`
        : `<div class="dev-ro">${esc(dataDev) || '—'}</div>`}
    </div>`;

  // ---- bloco da LOGÍSTICA: o que elas lançam, e só isso ----
  const blocoLogistica = `<div class="form-grid dev-cab-grid">
      ${campoData}
      ${campo('Região', 'regiao', d.regiao, '', editavel)}
      ${campo('Cód. operador (monitoramento)', 'operadorCodigo', d.operadorCodigo,
        'title="Número informado pelo monitoramento — é sob ele que as devoluções são lançadas."', editavel)}
    </div>`;

  // ---- bloco da PORTARIA: aparece inteiro só para ela e para a Administração ----
  const blocoPortaria = (portariaEdita || admin) ? `
    <div class="dev-cab-posto">
      <div class="dev-cab-posto-tit">🚧 Portaria — o que é preenchido na chegada</div>
      <div class="form-grid dev-cab-grid">
        ${campo('Transportadora', 'transportadora', d.transportadora, '', true)}
        ${campo('Nota de transferência', 'notaTransferencia', d.notaTransferencia, '', true)}
        ${campo('Placa', 'placa', d.placa, '', true)}
        ${campo('Motorista', 'motorista', d.motorista, '', true)}
        ${campo('Nº carga de devolução (SIS ATAK)', 'cargaNumero', d.cargaNumero,
          'title="O Número Documento da Montagem de Cargas do SIS ATAK — o número que o porteiro gera ao abrir as DEVs. Não é o Nº DEV do checklist: são dois números diferentes."', true)}
        <div><label>Chegou lacrado?</label>
          <select id="dev-cab-${esc(d.id)}-chegouLacrado"
            title="Resposta da Portaria no recebimento — informação, não trava nada."
            onchange="editarDevolucaoCampoUI('${escJs(d.id)}','chegouLacrado',this.value)">
            <option value=""${d.chegouLacrado === null || d.chegouLacrado === undefined ? ' selected' : ''}>(não informado)</option>
            <option value="true"${d.chegouLacrado === true ? ' selected' : ''}>Sim — chegou lacrado</option>
            <option value="false"${d.chegouLacrado === false ? ' selected' : ''}>Não — chegou sem lacre</option>
          </select>
        </div>
        ${campo('Lacre 1', 'lacre1', d.lacre1, '', true)}
        ${campo('Lacre 2', 'lacre2', d.lacre2, '', true)}
        ${campo('Lacre 3', 'lacre3', d.lacre3, '', true)}
      </div>
    </div>` : '';

  // ---- campos de outros postos, cada um para o seu dono ----
  /* AS DUAS PESAGENS, LADO A LADO (27/08/2026). Elas não são dois campos
     parecidos: são as duas pontas da mesma medição, e é a diferença entre
     elas que vira o peso devolvido. Separá-las em lugares diferentes da
     tela faria a conta ficar invisível para quem digita. */
  const blocoFaturamento = (setor === 'Faturamento' || admin) ? `
    <div class="dev-cab-posto">
      <div class="dev-cab-posto-tit">⚖️ Faturamento — as duas balanças</div>
      <div class="form-grid dev-cab-grid">
        <div><label>Peso na chegada (kg) <span class="hint">caminhão cheio</span></label>
          <input type="number" min="0" step="1" id="dev-cab-${esc(d.id)}-pesoEntrada"
            value="${d.pesoEntrada ?? ''}" placeholder="kg"
            title="Primeira pesagem: o caminhão chega com a devolução dentro."
            onchange="editarDevolucaoCampoUI('${escJs(d.id)}','pesoEntrada',this.value)">
        </div>
        <div><label>Peso final (kg) <span class="hint">caminhão vazio</span></label>
          <input type="number" min="0" step="1" id="dev-cab-${esc(d.id)}-pesoFinal"
            value="${d.pesoFinal ?? ''}" placeholder="kg"
            title="Segunda pesagem: depois de descarregar, o motorista volta à balança."
            onchange="editarDevolucaoCampoUI('${escJs(d.id)}','pesoFinal',this.value)">
        </div>
      </div>
      <div class="dev-peso-conta">${contaPesoDevHtml(d)}</div>
    </div>` : '';

  /* CONTROLES INTERNOS E CENTRAL DE NOTAS: CHECK + RECADO, e só (27/08/2026).

     Pedido do dono, com estas palavras: "controles internos e central de
     notas, que precisa só de um campo pro CHECK do checklist pra confirmar
     a etapa, e observações para que eles possam comunicar com a próxima
     etapa". O check é o próprio botão da etapa; aqui fica o recado.

     O "Gerou RDC?" saiu da tela por decisão dele. A coluna continua no
     banco e nos relatórios já emitidos — o que saiu foi a pergunta. */
  const blocoControles = (setor === 'Controles Internos' || admin) ? `
    <div class="dev-cab-posto">
      <div class="dev-cab-posto-tit">🧭 Controles Internos</div>
      <div class="form-grid dev-cab-grid">
        <div style="grid-column:1/-1"><label>Observações para a próxima etapa</label>
          <input type="text" id="dev-cab-${esc(d.id)}-obsControles"
            value="${esc(d.obsControles || '')}" placeholder="O que a Central de Notas precisa saber"
            title="Sai no relatório e é o recado desta etapa para a seguinte."
            onchange="editarDevolucaoCampoUI('${escJs(d.id)}','obsControles',this.value)">
        </div>
      </div>
    </div>` : '';

  /* O posto da Expedição no cabeçalho. Ela já tinha a coluna de
     conferência dentro da tabela de itens; o que faltava era o lugar de
     escrever o recado — o mesmo que os dois postos seguintes têm. */
  const blocoExpedicao = (setor === 'Expedição' || admin) ? `
    <div class="dev-cab-posto">
      <div class="dev-cab-posto-tit">📦 Expedição</div>
      <div class="form-grid dev-cab-grid">
        <div style="grid-column:1/-1"><label>Observações para a próxima etapa</label>
          <input type="text" id="dev-cab-${esc(d.id)}-obsExpedicao"
            value="${esc(d.obsExpedicao || '')}" placeholder="O que a próxima etapa precisa saber da descarga"
            title="Sai no relatório e é o recado da descarga para quem vem depois."
            onchange="editarDevolucaoCampoUI('${escJs(d.id)}','obsExpedicao',this.value)">
        </div>
      </div>
    </div>` : '';

  const blocoNotas = (setor === 'Central de Notas' || admin) ? `
    <div class="dev-cab-posto">
      <div class="dev-cab-posto-tit">🧾 Central de Notas</div>
      <div class="form-grid dev-cab-grid">
        <div style="grid-column:1/-1"><label>Observações para a próxima etapa</label>
          <input type="text" id="dev-cab-${esc(d.id)}-obsNotas"
            value="${esc(d.obsNotas || '')}" placeholder="O que fica registrado ao encerrar a nota"
            title="Sai no relatório. É o último recado do ciclo."
            onchange="editarDevolucaoCampoUI('${escJs(d.id)}','obsNotas',this.value)">
        </div>
      </div>
    </div>` : '';

  /* Resumo do que os OUTROS postos já preencheram. Some quando não há nada
     — checklist recém-lançado não precisa de uma fileira de traços. */
  const resumo = [];
  if (!portariaEdita && !admin) {
    if (d.placa) resumo.push(`Placa ${esc(d.placa)}`);
    if (d.motorista) resumo.push(`Motorista ${esc(d.motorista)}`);
    if (d.transportadora) resumo.push(`Transp. ${esc(d.transportadora)}`);
    if (d.cargaNumero) resumo.push(`Carga ${esc(d.cargaNumero)}`);
    if (d.notaTransferencia) resumo.push(`NT ${esc(d.notaTransferencia)}`);
    if (d.chegouLacrado === true) resumo.push(`Lacrado${d.lacre1 ? ' nº ' + esc(d.lacre1) : ''}`);
    if (d.chegouLacrado === false) resumo.push('Chegou SEM lacre');
  }
  if (setor !== 'Faturamento' && !admin) {
    /* As duas balanças aparecem para quem não é do Faturamento, e o
       DEVOLVIDO junto: para a Expedição e para os Controles Internos, o
       número que importa é quanto desceu do caminhão. */
    if (d.pesoEntrada !== null && d.pesoEntrada !== undefined) {
      resumo.push(`Chegada ${Number(d.pesoEntrada).toLocaleString('pt-BR')} kg`);
    }
    if (d.pesoFinal !== null && d.pesoFinal !== undefined) {
      resumo.push(`Vazio ${Number(d.pesoFinal).toLocaleString('pt-BR')} kg`);
    }
    if (d.pesoDevolvido !== null && d.pesoDevolvido !== undefined) {
      resumo.push(`<strong>Devolvido ${Number(d.pesoDevolvido).toLocaleString('pt-BR')} kg</strong>`);
    }
  }
  /* O RDC saiu da TELA (27/08/2026) mas o dado antigo não sumiu: checklist
     que já tem a resposta continua mostrando, para o histórico não virar
     um buraco. O que não existe mais é a pergunta. */
  if (setor !== 'Controles Internos' && !admin && d.gerouRdc !== null && d.gerouRdc !== undefined) {
    resumo.push(`RDC: ${d.gerouRdc ? 'gerado' : 'não gerado'}`);
  }
  /* Os recados de cada etapa para a seguinte — é para isso que eles existem:
     quem está na etapa de agora precisa LER o que a anterior escreveu. */
  if (setor !== 'Expedição' && !admin && d.obsExpedicao) {
    resumo.push(`Expedição: “${esc(d.obsExpedicao)}”`);
  }
  if (setor !== 'Controles Internos' && !admin && d.obsControles) {
    resumo.push(`Controles Internos: “${esc(d.obsControles)}”`);
  }
  if (setor !== 'Central de Notas' && !admin && d.obsNotas) {
    resumo.push(`Central de Notas: “${esc(d.obsNotas)}”`);
  }
  const blocoResumo = resumo.length
    ? `<div class="dev-cab-resumo"><strong>Já preenchido pelos outros setores:</strong> ${resumo.join(' · ')}</div>`
    : '';

  return `${rotasChips}${blocoLogistica}${blocoPortaria}${blocoFaturamento}`
    + `${blocoExpedicao}${blocoControles}${blocoNotas}${blocoResumo}`;
}

/* A CONTA DAS DUAS BALANÇAS (27/08/2026).

   O dono pediu os dois pesos "e o painel calcula o devolvido". O número
   sozinho não serve para nada: o que ele responde é se o que DESCEU do
   caminhão bate com o que foi LANÇADO no checklist. É essa diferença que
   denuncia devolução a mais, a menos, ou lançamento errado — e é por isso
   que a comparação aparece do lado da conta, não num relatório de fim de mês.

   Quem manda no número é o SERVIDOR: `pesoDevolvido` vem calculado de lá
   (dominio/devolucoes.js). Aqui só se desenha — e o `preview`, enquanto a
   pessoa digita, usa a mesma subtração para não existir uma segunda conta
   com direito a discordar da primeira.

   Falta uma das pontas, não há conta. Null não é zero: dizer "0 kg
   devolvidos" quando ninguém pesou é inventar um número. */
function pesoLancadoDev(d) {
  return (d.itens || []).reduce((soma, i) => soma + (Number(i.peso) || 0), 0);
}

function contaPesoDevHtml(d, finalDigitado) {
  /* `Number(null)` é 0, e 0 é finito: sem esta guarda o painel mostrava
     "Devolvido: 21.500 kg (21.500 − 0)" para um caminhão que ainda nem
     tinha voltado à balança. Número inventado é pior que campo vazio —
     este apareceu no primeiro teste de tela e é a mesma armadilha que a
     regra "null não é zero" existe para evitar. */
  const vazio = (v) => v === null || v === undefined || v === '';
  const entrada = vazio(d.pesoEntrada) ? NaN : Number(d.pesoEntrada);
  const finalBruto = finalDigitado === undefined ? d.pesoFinal : finalDigitado;
  const final = vazio(finalBruto) ? NaN : Number(finalBruto);
  if (!Number.isFinite(entrada)) {
    return '<span class="text-dim">Sem o peso da chegada não dá para calcular o devolvido.</span>';
  }
  if (!Number.isFinite(final)) {
    return `<span class="text-dim">Chegada: ${entrada.toLocaleString('pt-BR')} kg. `
         + 'Falta o peso do caminhão vazio.</span>';
  }
  const devolvido = entrada - final;
  const lancado = pesoLancadoDev(d);
  const dif = lancado > 0 ? devolvido - lancado : null;
  /* 2% de tolerância: balança de pátio não é balança de laboratório, e
     apontar divergência a cada 3 kg faria o aviso virar paisagem. */
  const fora = dif !== null && Math.abs(dif) > Math.max(20, lancado * 0.02);
  return `<strong>Devolvido: ${devolvido.toLocaleString('pt-BR')} kg</strong>`
    + `<span class="text-dim"> (${entrada.toLocaleString('pt-BR')} − ${final.toLocaleString('pt-BR')})</span>`
    + (lancado > 0
        ? (fora
            ? ` <span class="dev-falta-chip" title="A balança e o checklist não batem. Confira antes de seguir.">`
              + `não bate com o lançado: ${lancado.toLocaleString('pt-BR')} kg `
              + `(${dif > 0 ? '+' : ''}${dif.toLocaleString('pt-BR')} kg)</span>`
            : ` <span class="dev-ok-chip" title="A balança bate com o que foi lançado no checklist.">`
              + `bate com o lançado (${lancado.toLocaleString('pt-BR')} kg)</span>`)
        : ' <span class="text-dim">— nenhum peso lançado no checklist para comparar.</span>');
}

/* A conta na hora, enquanto se digita. Sem isto o operador só descobre que
   errou um dígito depois de assinar a etapa. */
function previewPesoDevolvidoUI(id) {
  const d = getDevolucao(id);
  const campo = document.getElementById(`dev-et-${id}-pesofinal`);
  const alvo = document.getElementById(`dev-et-${id}-conta`);
  if (!d || !campo || !alvo) return;
  alvo.innerHTML = contaPesoDevHtml(d, campo.value);
}

function carimbosDev(d) {
  // Sobra encerra na Expedição — mostrar Controles/Notas como "pendente"
  // para sempre só confundiria.
  const etapasVisiveis = d.tipo === 'SOBRA'
    ? ['portaria', 'faturamento', 'expedicao'] : Object.keys(DEV_ETAPA_ROTULO);
  return `<div class="dev-carimbos">
    ${etapasVisiveis.map((chave) => [chave, DEV_ETAPA_ROTULO[chave]]).map(([chave, rotulo]) => {
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
  /* SOBRA: três OKs e acabou — Portaria, Faturamento, Expedição. */
  if (d.tipo === 'SOBRA' && d.status === 'Descarga Conferida') {
    return '<div class="card-sub">✅ Sobra concluída — entrou, conferida e descarregada.</div>';
  }
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
      <select id="dev-et-${esc(d.id)}-lacrado" title="O caminhão chegou lacrado?"
        onchange="mostrarLacreDevUI('${escJs(d.id)}')">
        <option value=""${d.chegouLacrado === null || d.chegouLacrado === undefined ? ' selected' : ''}>Chegou lacrado? (informar)</option>
        <option value="true"${d.chegouLacrado === true ? ' selected' : ''}>Sim — chegou LACRADO</option>
        <option value="false"${d.chegouLacrado === false ? ' selected' : ''}>Não — chegou SEM lacre</option>
      </select>
      <input type="text" id="dev-et-${esc(d.id)}-placa" placeholder="Placa que voltou" value="${esc(d.placa)}"
        onchange="frotaNaEtapaDevUI('${escJs(d.id)}')">
      <input type="text" id="dev-et-${esc(d.id)}-transportadora" placeholder="Transportadora" value="${esc(d.transportadora)}">
      <input type="text" id="dev-et-${esc(d.id)}-motorista" placeholder="Nome do motorista" value="${esc(d.motorista)}">
      <input type="text" id="dev-et-${esc(d.id)}-lacre1" placeholder="Lacre 1" value="${esc(d.lacre1)}">
      <input type="text" id="dev-et-${esc(d.id)}-lacre2" placeholder="Lacre 2 (se houver)" value="${esc(d.lacre2)}">`;
  } else if (etapa.pede === 'faturamento') {
    /* PRIMEIRA BALANÇA: o caminhão CHEIO, na chegada. Era aqui que o painel
       pedia "peso final" — o número certo no campo errado, porque o final
       é o do caminhão vazio, que ainda nem descarregou. */
    extras = `<input type="number" min="0" step="1" id="dev-et-${esc(d.id)}-pesoentrada"
      placeholder="Peso do caminhão CHEIO, em kg (opcional)" value="${d.pesoEntrada ?? ''}"
      title="Pesagem da chegada, com a mercadoria dentro. O peso do caminhão vazio é registrado depois da descarga.">`;
  } else if (etapa.pede === 'pesofinal') {
    /* SEGUNDA BALANÇA: o caminhão VAZIO, depois da descarga. O painel
       mostra a conta na hora — quem digita vê o devolvido aparecer e
       percebe na mesma tela se o número saiu torto. */
    extras = `<input type="number" min="0" step="1" id="dev-et-${esc(d.id)}-pesofinal"
        placeholder="Peso do caminhão VAZIO, em kg" value="${d.pesoFinal ?? ''}"
        oninput="previewPesoDevolvidoUI('${escJs(d.id)}')"
        title="Pesagem depois da descarga, caminhão vazio.">
      <span class="dev-peso-conta" id="dev-et-${esc(d.id)}-conta">${contaPesoDevHtml(d)}</span>`;
  } else if (etapa.pede === 'expedicao' || etapa.pede === 'controles' || etapa.pede === 'notas') {
    /* AS DUAS ÚLTIMAS ETAPAS SÃO CHECK + RECADO (27/08/2026).

       O dono: "controles internos e central de notas, que precisa só de um
       campo pro CHECK do checklist pra confirmar a etapa, e observações
       para que eles possam comunicar com a próxima etapa".

       O "Gerou RDC?" saiu daqui a pedido dele. O dado continua no banco e
       nos relatórios antigos — o que saiu foi a pergunta na tela. */
    const jaEscrito = { expedicao: d.obsExpedicao, controles: d.obsControles, notas: d.obsNotas };
    extras = `<input type="text" id="dev-et-${esc(d.id)}-obs"
      placeholder="Observações para a próxima etapa (saem no relatório)"
      value="${esc(jaEscrito[etapa.pede] || '')}"
      title="O recado de quem faz esta etapa para quem vem depois.">`;
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
    /* Todo campo do item ganha id (27/08/2026): sem id não há como
       devolver o que estava sendo digitado depois de um redesenho — ver
       _devCapturarDigitacao. O item_id é BIGSERIAL, então é único no
       painel inteiro. */
    const cel = (nome, valor, tipo = 'text', extra = '') => editavel
      ? `<input type="${tipo}" id="dev-it-${i.itemId}-${nome}" value="${esc(valor ?? '')}" ${extra}
           onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'${nome}',this.value)">`
      : (esc(valor) || '—');
    return `<tr>
      <td>${cel('nota', i.nota)}</td>
      <td>${editavel
        ? `<select id="dev-it-${i.itemId}-parcial"
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'parcial',this.value)">
             <option value="1" ${i.parcial ? 'selected' : ''}>Parcial</option>
             <option value="" ${i.parcial ? '' : 'selected'}>Total</option></select>`
        : (i.parcial ? 'Parcial' : 'Total')}</td>
      ${/* Nº DA NOTA PARCIAL — coluna própria (19/08/2026), ao lado da nota
           de venda. A mesma nota fiscal pode voltar em duas parciais do
           MESMO produto (uma caixa fora de temperatura, outra avariada), e é
           este número que diz a QUAL caixa cada Nº DEV se refere. Nota
           TOTAL não tem parcial: o campo fica travado e vazio de propósito,
           para ninguém preencher o que não existe. */''}
      <td>${editavel
        ? `<input type="text" class="dev-parcial-desc" id="dev-it-${i.itemId}-parcialDesc"
             value="${esc(i.parcialDesc || '')}"
             ${i.parcial ? '' : 'disabled'} placeholder="${i.parcial ? 'Nº parcial' : '—'}"
             title="${i.parcial ? 'Número da nota parcial (obrigatório quando a devolução é parcial).' : 'Nota total não tem número de parcial.'}"
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'parcialDesc',this.value)">`
        : (i.parcial ? (esc(i.parcialDesc) || '<span class="dev-falta-chip">falta o nº</span>') : '—')}</td>
      <td>${cel('supervisor', i.supervisor, 'text', 'list="dl-dev-supervisores"')}</td>
      <td>${cel('vendedor', i.vendedor, 'text', 'list="dl-dev-rcas"')}</td>
      <td>${cel('codCliente', i.codCliente, 'text', 'list="dl-dev-clientes" oninput="sugerirClientesDevUI(this.value)"')}
          ${i.clienteNome ? `<small class="text-dim">${esc(i.clienteNome)}</small>` : ''}</td>
      <td class="c-peso">${cel('cx', i.cx, 'number', 'min="0" step="1"')}</td>
      <td class="c-peso">${cel('peso', i.peso, 'number', 'min="0" step="0.01"')}</td>
      <td>${cel('codProduto', i.codProduto, 'text', 'list="dl-dev-produtos"')}
          ${i.produtoNome ? `<small class="text-dim">${esc(i.produtoNome)}</small>` : ''}</td>
      <td>${cel('numDev', i.numDev)}</td>
      ${/* Nº DA CARGA DE DEVOLUÇÃO — quem digita é a Portaria, depois de
            montar a carga no SIS ATAK. Fica ao lado do Nº DEV justamente
            para os dois nunca mais serem confundidos um com o outro. */''}
      <td>${podeInformarCargaDev()
        ? `<input type="text" id="dev-it-${i.itemId}-cargaDev" value="${esc(i.cargaDev || '')}"
             placeholder="${esc(d.cargaNumero || '—')}"
             title="Número da carga de devolução gerado no SIS ATAK. Em branco, vale o número do cabeçalho."
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'cargaDev',this.value)">`
        : (esc(cargaDevDoItem(i, d)) || '—')}</td>
      <td>${cel('dataItem', String(i.dataItem || '').slice(0, 10), 'date',
        'title="Data desta devolução (coluna DATA-DEV da capa)."')}</td>
      ${/* O motivo escolhido aparece POR EXTENSO embaixo da caixa de
            seleção (pedido de 18/08/2026): a coluna é estreita e o código
            sozinho não diz nada para quem confere. */''}
      <td>${cel('motivo', i.motivo, 'text', 'list="dl-dev-motivos"')}
          ${i.motivo ? `<small class="text-dim dev-motivo-desc">${esc(i.motivo)}</small>` : ''}</td>
      <td class="c-peso">${podePesarItemDev()
        ? `<input type="number" min="0" step="0.01" id="dev-it-${i.itemId}-pesoFaturamento"
             value="${i.pesoFaturamento ?? ''}" placeholder="—"
             title="Pesagem do Faturamento — é a confirmação de que a devolução passou pela balança."
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'pesoFaturamento',this.value)">`
        : (i.pesoFaturamento ?? '—')}</td>
      <td class="c-peso">${podeConferirQtdDev()
        ? `<input type="number" min="0" step="1" id="dev-it-${i.itemId}-qtdRecebida"
             value="${i.qtdRecebida ?? ''}" placeholder="—"
             title="Conferência da Expedição: quantidade que CHEGOU na descarga. A falta é apontada sozinha."
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'qtdRecebida',this.value)">`
        : (i.qtdRecebida ?? '—')}</td>
      <td>${faltaHtml}</td>
      <td class="dev-cel-dest">${podeDestinarDev()
        /* Destinação MÚLTIPLA (18/08/2026): caixas por destino — 3 caixas
           podem virar 1 Estoque + 2 Descarte. */
        ? `<span class="dev-dest-grupo">
             <input type="number" min="0" step="1" id="dev-it-${i.itemId}-destEstoque"
               value="${i.destEstoque ?? ''}" placeholder="E"
               title="Caixas para ESTOQUE"
               onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'destEstoque',this.value)">
             <input type="number" min="0" step="1" id="dev-it-${i.itemId}-destDescarte"
               value="${i.destDescarte ?? ''}" placeholder="D"
               title="Caixas para DESCARTE"
               onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'destDescarte',this.value)">
             <input type="number" min="0" step="1" id="dev-it-${i.itemId}-destReprocesso"
               value="${i.destReprocesso ?? ''}" placeholder="R"
               title="Caixas para REPROCESSO"
               onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'destReprocesso',this.value)">
           </span>`
        : esc(devDestinoResumo(i)) || '—'}</td>
      <td class="dev-cel-notafinal">${podeNotaFinalDev()
        ? `<input type="checkbox" id="dev-it-${i.itemId}-notaFinal" ${i.notaFinal ? 'checked' : ''}
             title="NOTA FINAL — marque quando a nota deste item estiver finalizada (Central de Notas)."
             onchange="editarItemDevolucaoUI('${escJs(d.id)}',${i.itemId},'notaFinal',this.checked)">`
        : (i.notaFinal ? '✔' : '—')}</td>
      ${editavel ? `<td class="no-print dev-cel-acoes">
        <button class="btn btn-sec btn-sm"
          title="Outra parcial DESTA nota — repete nota, cliente, RCA, supervisor e produto; o Nº DEV, o motivo, as caixas e o nº da parcial você preenche."
          onclick="repetirNotaDevolucaoUI('${escJs(d.id)}',${i.itemId})">➕ mesma nota</button>
        <button class="btn btn-danger btn-sm"
          onclick="excluirItemDevolucaoUI('${escJs(d.id)}',${i.itemId})">✕</button></td>` : ''}
    </tr>`;
  };

  const novaLinha = !editavel ? '' : `<tr class="dev-linha-nova">
      <td><input type="text" id="dev-ni-${esc(d.id)}-nota" placeholder="Nota"></td>
      <td><select id="dev-ni-${esc(d.id)}-parcial"
            onchange="mostrarParcialDevUI('${escJs(d.id)}')"><option value="1">Parcial</option><option value="">Total</option></select></td>
      <td><input type="text" class="dev-parcial-desc" id="dev-ni-${esc(d.id)}-parcialdesc"
            placeholder="Nº parcial" title="Número da nota parcial — obrigatório quando é parcial; em nota total, deixe vazio."></td>
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
      <td><input type="text" id="dev-ni-${esc(d.id)}-motivo" list="dl-dev-motivos" placeholder="Motivo"
            oninput="descreverMotivoDevUI('${escJs(d.id)}')"
            onchange="completarMotivoDevUI('${escJs(d.id)}')"
            value="${d.tipo === 'SOBRA' ? '652 — Sobras' : ''}">
          <small class="text-dim dev-motivo-desc" id="dev-ni-${esc(d.id)}-motivodesc">${d.tipo === 'SOBRA' ? '652 — Sobras' : ''}</small></td>
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
            <th title="Nota fiscal de venda">Nota</th>
            <th title="Parcial ou Total — na tela fica abreviado porque a caixa de seleção logo abaixo já diz a palavra inteira; nos relatórios sai por extenso.">P/T</th>
            <th title="Número da nota parcial — só quando a devolução é parcial">Nº parcial</th>
            <th>Supervisor</th><th title="Vendedor">RCA</th>
            <th>Cód. Cliente</th><th>CX</th><th title="Peso em QUILOS (kg)">Peso (kg)</th><th>Cód. Produto</th>
            <th>Nº DEV</th>
            <th title="Número da carga de devolução gerado pelo porteiro no SIS ATAK — não é o Nº DEV">Nº carga dev</th>
            <th title="Coluna DATA-DEV da capa">Data DEV</th><th>Motivo</th>
            <th title="Pesagem do Faturamento — confirma que passou pela balança">Pesagem</th>
            <th title="Conferência da descarga: quantidade recebida">Expedição</th><th>Falta</th>
            <th>Destinações</th>
            <th title="Tick da Central de Notas: nota finalizada">Nota final</th>
            ${editavel ? '<th class="no-print"></th>' : ''}
          </tr></thead>
          <tbody>${d.itens.map(linhaItem).join('')}${novaLinha}</tbody>
        </table>
      </div>
      ${d.pesoEntrada !== null && d.pesoEntrada !== undefined
        ? `<div class="card-sub dev-peso-conta">${contaPesoDevHtml(d)}</div>` : ''}
      ${d.obsExpedicao ? `<div class="card-sub"><strong>Obs. Expedição:</strong> ${esc(d.obsExpedicao)}</div>` : ''}
      ${d.obsControles ? `<div class="card-sub"><strong>Obs. Controles Internos:</strong> ${esc(d.obsControles)}</div>` : ''}
      ${d.obsNotas ? `<div class="card-sub"><strong>Obs. Central de Notas:</strong> ${esc(d.obsNotas)}</div>` : ''}
      ${d.gerouRdc !== null && d.gerouRdc !== undefined
        ? `<div class="card-sub"><strong>RDC (romaneio):</strong> ${d.gerouRdc ? 'Sim — gerado' : 'Não gerado'}</div>` : ''}
      ${d.chegouLacrado === false
        ? '<div class="card-sub"><strong>Lacre:</strong> chegou SEM lacre (informado pela Portaria).</div>'
        : (d.chegouLacrado === true
          ? `<div class="card-sub"><strong>Lacre:</strong> chegou lacrado${d.lacre1 ? ' — nº ' + esc(d.lacre1) : ''}${d.lacre2 ? ' e ' + esc(d.lacre2) : ''}.</div>`
          : '')}
      ${divergencias}
      <div class="flex-end gap8 no-print" style="margin-top:10px">
        <button class="btn btn-sec btn-sm" onclick="relatorioOperadorDevolucoesUI('${escJs(d.id)}')"
          title="PDF deste checklist para o operador do monitoramento: nota, parcial, supervisor, RCA, cliente, caixa, peso, produto, Nº DEV, data e motivo. É o papel que acompanha a devolução até a Portaria.">📤 Relação para o operador</button>
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
  /* O lançamento é só do que existe ANTES do caminhão chegar (19/08/2026):
     data, região, rotas e o código do operador do monitoramento. Placa,
     transportadora, motorista, nota de transferência, carga e lacres são da
     PORTARIA, no recebimento. */
  const corpo = {
    dataDev: v('dev-data') || diaLocalDev(),
    rotas,
    /* A região vem do CADASTRO da rota (500 = Patos de Minas). Antes era
       digitada ao lado da rota — duas fontes para a mesma informação, e a
       divergência de escrita ("BH", "Belo Horizonte", "B.HORIZONTE")
       aparecia no rótulo do checklist e no relatório. */
    regiao: regiaoDaRotaDev(rotas[0]),
    operadorCodigo: v('dev-operador-cod'),
    itens: [],
  };
  try {
    const d = await SuincoSharePoint.devolucoes.criar(corpo);
    notify(`Checklist Nº ${d.numero} criado (${devRotulo(d)}). Agora lance os itens na linha do próprio checklist.`, 'success', 6000);
    ['dev-operador-cod']
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

/* SOBRA: o checklist enxuto do que só entra — sem carga e sem rota. */
async function criarSobraUI() {
  const data = (document.getElementById('sobra-data') || {}).value || diaLocalDev();
  try {
    const d = await SuincoSharePoint.devolucoes.criar({
      tipo: 'SOBRA', dataDev: data, itens: [],
    });
    notify(`Checklist de SOBRA Nº ${d.numero} criado. Lance os itens (caixa, peso, produto, motivo) na linha dele.`, 'success', 6000);
    const filtro = document.getElementById('dev-filtro-dia');
    if (filtro) filtro.value = data;
    _devExpandida = d.id;
    await carregarDevolucoes();
  } catch (e) {
    notify((e && e.message) || 'O servidor recusou a criação da sobra.', 'danger', 7000);
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
  /* RDC vem de um select sim/não — vazio significa "ainda não informado",
     não "não gerou". */
  if (campo === 'gerouRdc') corpo = { gerouRdc: valor === '' ? null : valor === 'true' };
  if (campo === 'chegouLacrado') corpo = { chegouLacrado: valor === '' ? null : valor === 'true' };
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
    /* "Chegou lacrado?" vai mesmo quando a resposta é NÃO — é o ponto do
       campo: "sem lacre" precisa ser dito, não deduzido de campo vazio.
       Nada disso trava a devolução; é informação. */
    const lacrado = v('lacrado');
    if (lacrado !== '' && lacrado !== undefined) corpo.chegouLacrado = lacrado === 'true';
  } else {
    /* A MESMA PROTEÇÃO DA PORTARIA, PARA AS OUTRAS CINCO ETAPAS
       (28/08/2026).

       Relato do dono: "quando alguém de outro setor atualiza a carga ou
       alguma informação, isso apaga o que estava sendo feito na
       devolução".

       O caminho, rastreado: estas cinco etapas mandavam `v('campo') || ''`
       — a string vazia ia junto e o servidor gravava por cima. Basta o
       campo estar vazio NESTA tela para o valor sumir do banco. E ele
       fica vazio em duas situações comuns:

         · a tela foi desenhada ANTES de alguém preencher aquele campo pelo
           cabeçalho, e carrega um retrato velho (é a ocorrência #16 —
           "duas escritas em voo, a velha ganha", aqui nas devoluções);
         · quem avança a etapa não é quem preenche o campo (a Logística
           cobre todos os postos e avança etapas dos outros).

       A Portaria já tinha a regra escrita, com estas palavras: "campo
       vazio do porteiro não pode apagar um valor que a Logística já tenha
       posto no cabeçalho". Faltava valer para as demais — a mesma regra em
       um lugar só, agora, para as seis.

       Para APAGAR de propósito existe o campo do cabeçalho, que grava o
       vazio explicitamente. O botão de avançar etapa serve para carimbar a
       etapa, não para limpar o trabalho de outro setor. */
    const CAMPO_DA_ETAPA = {
      faturamento: ['pesoentrada', 'pesoEntrada'],
      pesofinal:   ['pesofinal',   'pesoFinal'],
      expedicao:   ['obs',         'obsExpedicao'],
      controles:   ['obs',         'obsControles'],
      notas:       ['obs',         'obsNotas'],
    }[etapa.pede];
    if (CAMPO_DA_ETAPA) {
      const [sufixo, chave] = CAMPO_DA_ETAPA;
      const valor = v(sufixo);
      if (String(valor ?? '').trim()) corpo[chave] = valor;
    }
  }
  acaoDev(SuincoSharePoint.devolucoes.etapa(id, corpo), `Etapa registrada: ${etapa.proxima}.`);
}

function editarItemDevolucaoUI(id, itemId, campo, valor) {
  let corpo;
  /* Virou TOTAL: o número da parcial sai junto. Deixar o número velho numa
     linha total é pior que não ter número nenhum — parece que existe uma
     parcial que ninguém encontra. */
  if (campo === 'parcial') corpo = valor ? { parcial: true } : { parcial: false, parcialDesc: '' };
  // Digitou "607" numa linha já lançada: grava a linha inteira do catálogo.
  else if (campo === 'motivo') corpo = { motivo: motivoOficialDev(valor) };
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
    parcialDesc: v('parcial') ? v('parcialdesc') : '',
    supervisor: v('supervisor'),
    vendedor: v('vendedor'),
    codCliente: v('cliente'),
    cx: v('cx'),
    peso: pesoFinalLinha,
    codProduto,
    produtoNome: devProdutoNomePorCodigo(codProduto),
    numDev: v('numdev'),
    motivo: motivoOficialDev(v('motivo')),
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

/* Outra parcial da MESMA nota (18/08/2026). O caso real: o cliente devolve
   duas caixas do mesmo produto por motivos diferentes (uma fora de
   temperatura, outra avariada) e emite DUAS parciais na mesma nota fiscal,
   cada uma com seu Nº DEV. Repetir o cabeçalho da nota à mão é onde o erro
   entra — este botão copia o que é igual e deixa em branco o que muda:
   Nº DEV, motivo, caixas, peso e o número da parcial. */
function repetirNotaDevolucaoUI(id, itemId) {
  const d = getDevolucao(id);
  const base = d && (d.itens || []).find((x) => x.itemId === itemId);
  if (!base) return;
  acaoDev(
    SuincoSharePoint.devolucoes.criarItem(id, {
      nota: base.nota,
      // Outra parcial da mesma nota é, por definição, parcial.
      parcial: true,
      parcialDesc: '',
      supervisor: base.supervisor,
      vendedor: base.vendedor,
      codCliente: base.codCliente,
      codProduto: base.codProduto,
      produtoNome: base.produtoNome,
      dataItem: base.dataItem ? String(base.dataItem).slice(0, 10) : '',
      cx: 0,
    }),
    `Outra parcial da nota ${base.nota || '—'} criada — preencha o Nº DEV, o motivo, as caixas e o nº da parcial.`
  );
}

/* Chegou lacrado? Sim mostra os números; Não esconde (e o que estiver
   digitado não é enviado — a resposta já diz tudo). */
function mostrarLacreDevUI(id) {
  const sel = document.getElementById(`dev-et-${id}-lacrado`);
  if (!sel) return;
  const semLacre = sel.value === 'false';
  for (const suf of ['lacre1', 'lacre2']) {
    const campo = document.getElementById(`dev-et-${id}-${suf}`);
    if (!campo) continue;
    campo.style.display = semLacre ? 'none' : '';
    if (semLacre) campo.value = '';
  }
}

/* Motivo digitado por CÓDIGO vira código + descrição (19/08/2026).

   O catálogo oficial guarda a linha inteira ("607 — Transporte/Avaria.
   Mercadoria chegou no cliente avariada..."), mas quem lança digita só o
   número, que é o que está na capa. Pedido da reunião: "o código do motivo
   tem que puxar na descrição, abaixo do campo, a nomenclatura referente ao
   código" — porque quem confere depois precisa saber o motivo, não decorar
   uma tabela de números. */
/* A região de um checklist é o nome da rota no cadastro (500 = Patos de
   Minas). Rota sem nome devolve o próprio código — melhor que vazio, e
   aparece na tela para alguém completar o cadastro. */
function regiaoDaRotaDev(codigo) {
  if (!codigo) return '';
  const r = (typeof ROTAS !== 'undefined' ? ROTAS : []).find((x) => x.codigo === codigo);
  return (r && (r.nome || '').trim()) || String(codigo);
}

function motivoOficialDev(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  const lista = (DEV_CADASTROS.motivos || []);
  if (lista.includes(texto)) return texto;
  const cod = texto.match(/^(\d{2,4})\b/);
  if (cod) {
    const achado = lista.find((m) => String(m).trim().startsWith(cod[1] + ' '));
    if (achado) return achado;
  }
  const parcial = lista.find((m) => String(m).toUpperCase().startsWith(texto.toUpperCase()));
  return parcial || texto;
}

/* O motivo escolhido na linha nova aparece por extenso embaixo da caixa. */
function descreverMotivoDevUI(id) {
  const campo = document.getElementById(`dev-ni-${id}-motivo`);
  const desc = document.getElementById(`dev-ni-${id}-motivodesc`);
  if (!campo || !desc) return;
  desc.textContent = motivoOficialDev(campo.value);
}

/* Ao sair do campo, o código vira a linha completa do catálogo. */
function completarMotivoDevUI(id) {
  const campo = document.getElementById(`dev-ni-${id}-motivo`);
  if (!campo) return;
  campo.value = motivoOficialDev(campo.value);
  descreverMotivoDevUI(id);
}

/* O campo do nº da parcial só faz sentido com Parcial escolhida. */
function mostrarParcialDevUI(id) {
  const sel = document.getElementById(`dev-ni-${id}-parcial`);
  const campo = document.getElementById(`dev-ni-${id}-parcialdesc`);
  if (!sel || !campo) return;
  /* Nota TOTAL não tem número de parcial: o campo trava e esvazia, em vez
     de sumir — a coluna continua no lugar e a tabela não "pula". */
  const ehParcial = !!sel.value;
  campo.disabled = !ehParcial;
  campo.placeholder = ehParcial ? 'Nº parcial' : '—';
  if (!ehParcial) campo.value = '';
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
            ${s.pesoEntrada !== null && s.pesoEntrada !== undefined ? ` · chegada ${Number(s.pesoEntrada).toLocaleString('pt-BR')} kg` : ''}
            ${s.pesoFinal !== null && s.pesoFinal !== undefined ? ` · vazio ${Number(s.pesoFinal).toLocaleString('pt-BR')} kg` : ''}
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
        ${linha('Nº(S) DEV', (d.itens || []).map((i) => i.numDev).filter(Boolean)
          .filter((v, ix, arr) => arr.indexOf(v) === ix).join(' · '))}
        ${linha('PLACA', d.placa)}
        ${linha('MOTORISTA', d.motorista)}
        ${linha('TRANSPORTADORA', d.transportadora)}
        ${linha('REGIÃO / ROTAS', `${d.regiao ? d.regiao + ' — ' : ''}${(d.rotas || []).join(' · ')}`)}
        ${linha('LACRE(S)', d.chegouLacrado === false
          ? 'CHEGOU SEM LACRE'
          : [d.lacre1, d.lacre2].filter(Boolean).join(' · '))}
        ${linha('RECEBIDO POR', c ? `${c.por} · ${fmtDataHora(c.em)}` : '—')}
      </div>
      ${rodapeDocumento(
        'Entregar este comprovante ao motorista, que o apresenta na balança do '
        + 'Faturamento — é assim que o faturista identifica QUAL devolução chegou. '
        + 'Substitui a anotação à mão do porteiro.',
        '', '')}
    </div>`;
  await exportarViaServidor(el, `Comprovante-Devolucao-${d.numero}`, 'comprovante-portaria');
}

/* ---------- relatório do dia (mesmo padrão dos demais) ---------- */

async function relatorioDevolucoesUI(diaParam) {
  if (!devServidorOk()) {
    notify('O relatório de devoluções vem do servidor — entre com login de servidor.', 'warn', 6000);
    return;
  }
  /* Aceita a data vinda do card da aba Relatórios; sem ela, usa o dia do
     filtro da aba Devoluções. A lista é SEMPRE re-buscada do servidor no
     clique — o PDF sai com o status atual de cada checklist, não com o
     retrato de quando a tela abriu. */
  const dia = (typeof diaParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(diaParam))
    ? diaParam
    : ((document.getElementById('dev-filtro-dia') || {}).value || diaLocalDev());
  let lista;
  try {
    lista = await SuincoSharePoint.devolucoes.listar(dia, dia);
  } catch (e) {
    notify('Não consegui buscar as devoluções para o relatório: ' + (e.message || 'erro'), 'danger', 6000);
    return;
  }
  const el = document.getElementById('print-devolucoes');
  if (!el) return;

  const [ano, mes, diaN] = dia.split('-');
  const diaBR = `${diaN}/${mes}/${ano}`;
  const totalCx = lista.reduce((s, d) => s + d.itens.reduce((x, i) => x + (i.cx || 0), 0), 0);
  const totalPesoDia = lista.reduce(
    (s, d) => s + d.itens.reduce((x, i) => x + (Number(i.peso) || 0), 0), 0);
  const totalFalta = lista.reduce((s, d) => s
    + d.itens.reduce((x, i) => x + (i.falta || 0), 0), 0);
  const totalDiverg = lista.reduce((s, d) => s + d.divergencias.length, 0);

  const bloco = (d) => `
    <div class="dev-doc-checklist">
      ${tituloSecaoPdf(
        d.tipo === 'SOBRA'
          ? `Checklist Nº ${d.numero} — SOBRA · ${esc(d.status)}`
          : `Checklist Nº ${d.numero} — ${d.regiao ? esc(d.regiao) + ' · ' : ''}Rota(s) ${esc((d.rotas || []).join(', ') || '—')} · ${esc(d.status)}`,
        `Gerado por <strong>${esc(d.criadaPor)}</strong>`
        + `${d.regiao ? ' · Região ' + esc(d.regiao) : ''}`
        + `${d.transportadora ? ' · Transportadora ' + esc(d.transportadora) : ''}`
        + `${d.notaTransferencia ? ' · NT ' + esc(d.notaTransferencia) : ''}`
        + `${d.placa ? ' · Placa ' + esc(d.placa) : ''}`
        + `${d.cargaNumero ? ' · Carga ' + esc(d.cargaNumero) : ''}`
        + `${d.operadorCodigo ? ' · Cód. operador ' + esc(d.operadorCodigo) : ''}`
        + `${lacresChegadaDev(d)}`
        /* AS DUAS BALANÇAS NO PAPEL (27/08/2026). O documento que acompanha
           a devolução precisa dizer o que a balança disse nas DUAS pontas —
           "peso final" sozinho não responde quanto voltou. */
        + `${d.pesoEntrada !== null && d.pesoEntrada !== undefined
             ? ' · Chegada ' + Number(d.pesoEntrada).toLocaleString('pt-BR') + ' kg' : ''}`
        + `${d.pesoFinal !== null && d.pesoFinal !== undefined
             ? ' · Vazio ' + Number(d.pesoFinal).toLocaleString('pt-BR') + ' kg' : ''}`
        + `${d.pesoDevolvido !== null && d.pesoDevolvido !== undefined
             ? ' · Devolvido ' + Number(d.pesoDevolvido).toLocaleString('pt-BR') + ' kg' : ''}`)}
      <table class="dev-doc-tabela">
        <thead><tr>
          <th>Nota</th><th title="A devolução é parcial ou total">Parcial / Total</th><th title="Número da nota parcial">Nº parcial</th>
          <th>Supervisor</th><th title="Vendedor">RCA</th><th>Cliente</th>
          <th>CX</th><th title="Peso em QUILOS (kg)">Peso (kg)</th><th>Produto</th><th>Nº DEV</th>
          ${temCargaDev(d) ? '<th title="Carga de devolução do SIS ATAK">Nº carga dev</th>' : ''}<th>Data DEV</th><th>Motivo</th>
          <th title="Pesagem do Faturamento, em QUILOS (kg)">Pesagem (kg)</th><th>Expedição</th><th>Falta</th><th>Destinações</th><th>Nota final</th>
        </tr></thead>
        <tbody>${d.itens.map((i) => `<tr${i.falta > 0 ? ' class="dev-doc-falta"' : ''}>
            <td>${esc(i.nota)}</td>
            <td class="c-pt">${parcialTotalTexto(i)}</td>
            <td>${i.parcial ? (esc(i.parcialDesc) || '—') : '—'}</td>
            <td>${esc(i.supervisor)}</td><td>${esc(i.vendedor)}</td><td>${clienteTextoDev(i)}</td>
            <td class="c-peso">${i.cx.toLocaleString('pt-BR')}</td>
            <td class="c-peso">${i.peso !== null ? i.peso.toLocaleString('pt-BR') : '—'}</td>
            <td>${esc(i.codProduto)}${i.produtoNome ? '-' + esc(i.produtoNome) : ''}</td>
            <td>${esc(i.numDev)}</td>
            ${temCargaDev(d) ? `<td>${esc(cargaDevDoItem(i, d)) || '—'}</td>` : ''}
            <td>${i.dataItem ? esc(String(i.dataItem).slice(0, 10).split('-').reverse().join('/')) : '—'}</td>
            <td>${esc(i.motivo)}</td>
            <td class="c-peso">${i.pesoFaturamento !== null ? i.pesoFaturamento.toLocaleString('pt-BR') : '—'}</td>
            <td class="c-peso">${i.qtdRecebida ?? '—'}</td>
            <td class="c-peso">${i.falta === null ? '—' : (i.falta > 0 ? 'FALTA ' + i.falta.toLocaleString('pt-BR') : 'OK')}</td>
            <td>${esc(devDestinoResumo(i)) || '—'}</td>
            <td>${i.notaFinal ? '✔' : '—'}</td>
          </tr>`).join('')}</tbody>
        ${/* Somatório no pé da tabela, no padrão do Relatório Operacional
              (pedido de 18/08/2026): as colunas CX e PESO fecham a conta do
              checklist, e a pesagem do Faturamento fecha a dela ao lado —
              é o número que a conferência procura primeiro. */''}
        <tfoot>${somatorioItensDev(d.itens, 6, temCargaDev(d))}</tfoot>
      </table>
      ${d.divergencias.length ? `<div class="dev-doc-diverg">
          <strong>Divergentes (fora do checklist):</strong>
          ${d.divergencias.map((v) => `${v.cx.toLocaleString('pt-BR')} cx ${esc(v.codProduto)}${v.produtoNome ? '-' + esc(v.produtoNome) : ''}${v.observacao ? ' (' + esc(v.observacao) + ')' : ''}`).join(' · ')}
        </div>` : ''}
      ${d.obsExpedicao ? `<div class="dev-doc-diverg"><strong>Obs. Expedição:</strong> ${esc(d.obsExpedicao)}</div>` : ''}
      ${d.obsControles ? `<div class="dev-doc-diverg"><strong>Obs. Controles Internos:</strong> ${esc(d.obsControles)}</div>` : ''}
      ${d.gerouRdc !== null && d.gerouRdc !== undefined
        ? `<div class="dev-doc-diverg"><strong>RDC (romaneio):</strong> ${d.gerouRdc ? 'Sim — gerado' : 'Não gerado'}</div>` : ''}
      ${d.chegouLacrado === false
        ? '<div class="dev-doc-diverg"><strong>Lacre:</strong> chegou SEM lacre (informado pela Portaria).</div>'
        : (d.chegouLacrado === true
          ? `<div class="dev-doc-diverg"><strong>Lacre:</strong> chegou lacrado${d.lacre1 ? ' — nº ' + esc(d.lacre1) : ''}${d.lacre2 ? ' e ' + esc(d.lacre2) : ''}.</div>`
          : '')}
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
        subtitulo: `Checklists do dia ${diaBR} · ${lista.length} checklist(s) · `
          + `${totalCx.toLocaleString('pt-BR')} cx · `
          /* Peso das devoluções é sempre em QUILOS — o Relatório Operacional
             das cargas usa tonelada, e a troca de unidade entre um documento
             e outro já confundiu quem confere. Aqui vai escrito. */
          + `${totalPesoDia.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg (quilos)`
          + `${totalFalta > 0 ? ' · FALTAS: ' + totalFalta.toLocaleString('pt-BR') + ' cx' : ''}`
          + `${totalDiverg > 0 ? ' · ' + totalDiverg + ' divergente(s)' : ''}`,
      })}
      ${lista.length ? lista.map(bloco).join('')
        : '<div class="card-sub">Nenhum checklist de devolução neste dia.</div>'}
      ${rodapeDocumento(
        'Todos os pesos deste relatório estão em QUILOS (kg) — não em toneladas. '
        + 'Cada checklist identifica quem o gerou. A coluna FALTA é calculada '
        + 'pelo sistema (caixas do checklist menos caixas recebidas na descarga); '
        + 'produtos divergentes não abatem falta.',
        `Checklists de devolução do dia ${diaBR}, gravados no servidor pelo painel.`,
        '')}
    </div>`;

  await exportarViaServidor(el, `Devolucoes-${dia}`, 'devolucoes-do-dia');
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

/* Rodapé de somatórios das tabelas de devolução — mesmo desenho do
   Relatório Operacional (linha-total, rótulo à esquerda, números à
   direita). Some o que é somável e deixe o resto em branco: coluna que
   não é quantidade não ganha total só para preencher espaço. */
/* `comCargaDev` diz se a coluna "Nº carga dev" está no documento — ela só
   entra depois que a Portaria gera o número no SIS ATAK. Cada coluna que
   aparece ou some no meio da tabela precisa entrar nesta conta, senão o
   total escorrega uma casa para o lado. */
function somatorioItensDev(itens, colspanAntes, comCargaDev) {
  const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
  const cx = itens.reduce((s, i) => s + num(i.cx), 0);
  const peso = itens.reduce((s, i) => s + num(i.peso), 0);
  const pesagem = itens.reduce((s, i) => s + num(i.pesoFaturamento), 0);
  const recebidas = itens.reduce((s, i) => s + num(i.qtdRecebida), 0);
  const falta = itens.reduce((s, i) => s + num(i.falta), 0);
  const fmt = (n, casas) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
  return `<tr class="linha-total">
      <td colspan="${colspanAntes}" class="tot-rotulo">TOTAL — ${itens.length} linha(s)</td>
      <td class="tot-num">${fmt(cx, 0)}</td>
      <td class="tot-num">${fmt(peso, 2)} kg</td>
      ${/* Produto, Nº DEV, [Nº carga dev], Data DEV e Motivo não somam. */''}
      <td colspan="${comCargaDev ? 5 : 4}"></td>
      <td class="tot-num">${pesagem ? fmt(pesagem, 2) + ' kg' : ''}</td>
      <td class="tot-num">${recebidas ? fmt(recebidas, 0) : ''}</td>
      <td class="tot-num">${falta ? 'FALTA ' + fmt(falta, 0) : ''}</td>
      <td colspan="2"></td>
    </tr>`;
}

function somatorioLinhasOperadorDev(linhas, comCargaDev) {
  const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
  const cx = linhas.reduce((s, { i }) => s + num(i.cx), 0);
  const peso = linhas.reduce((s, { i }) => s + num(i.peso), 0);
  const fmt = (n, casas) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
  return `<tr class="linha-total">
      <td colspan="6" class="tot-rotulo">TOTAL — ${linhas.length} linha(s)</td>
      <td class="tot-num">${fmt(cx, 0)}</td>
      <td class="tot-num">${fmt(peso, 2)} kg</td>
      ${/* Produto, Nº DEV, [Nº carga dev], Data DEV e Motivo. */''}
      <td colspan="${comCargaDev ? 5 : 4}"></td>
    </tr>`;
}

/* ------------------------------------------------------------------
   RELATÓRIO PARA O OPERADOR (pedido da Bruna, 18/08/2026)

   Diferente do relatório de conferência: aqui é a LISTA CORRIDA das
   linhas devolvidas no dia, com as colunas que o operador do
   monitoramento precisa para lançar do lado dele — nota, parcial/total,
   supervisor, RCA, cliente, caixa, peso, produto, Nº DEV, data DEV e
   motivo. Sem pesagem, sem falta, sem destinação, sem carimbo: nada do
   controle interno vai junto.

   Sai no mesmo formato do Relatório Operacional (cabeçalho institucional,
   A4 pelo servidor) e é gerado pelas próprias meninas para mandar. */
async function relatorioOperadorDevolucoesUI(idChecklist) {
  if (!devServidorOk()) {
    notify('O relatório vem do servidor — entre com login de servidor.', 'warn', 6000);
    return;
  }
  /* UM CHECKLIST POR PAPEL (19/08/2026, pedido do gestor): "o relatório do
     operador que puxe o relatório individual de cada checklist".

     Faz sentido no uso: é este papel que o operador leva junto com a
     devolução, e é por ele que a Portaria reconhece qual checklist chegou.
     Um documento com o dia inteiro serve para conferência (esse é o
     Relatório do dia), não para acompanhar UMA carga.

     A lista do dia ainda é buscada para pegar o estado ATUAL do checklist —
     o PDF sai com o que está no servidor agora, não com o retrato da tela. */
  const alvo = getDevolucao(idChecklist);
  if (!alvo) {
    notify('Abra o checklist e gere a relação por ele — este PDF é individual.', 'warn', 7000);
    return;
  }
  const dia = String(alvo.dataDev || '').slice(0, 10) || diaLocalDev();
  let lista;
  try {
    const doDia = await SuincoSharePoint.devolucoes.listar(dia, dia);
    const atual = doDia.find((d) => d.id === idChecklist);
    lista = atual ? [atual] : [alvo];
  } catch (e) {
    notify('Não consegui buscar a devolução: ' + (e.message || 'erro'), 'danger', 6000);
    return;
  }
  const el = document.getElementById('print-devolucoes-operador');
  if (!el) return;

  /* Uma linha por ITEM, na ordem em que a devolução foi lançada — é como
     a capa de papel chega na mão do operador. A identificação do
     checklist (região/rotas e Nº) viaja em cada linha, senão o operador
     não sabe de qual capa veio. */
  const linhas = [];
  for (const d of lista) {
    for (const i of d.itens) {
      linhas.push({ d, i });
    }
  }
  const diaBR = String(dia).split('-').reverse().join('/');
  const totalCx = linhas.reduce((s, { i }) => s + (Number(i.cx) || 0), 0);
  const totalPeso = linhas.reduce((s, { i }) => s + (Number(i.peso) || 0), 0);
  const operadores = Array.from(new Set(lista.map((d) => d.operadorCodigo).filter(Boolean)));

  el.innerHTML = `
    <div class="print-page doc-normal">
      ${cabecalhoDocumento({
        titulo: `Relação para o Operador — Checklist Nº ${lista[0].numero}`,
        subtitulo: `${esc(devRotulo(lista[0]))}${lista[0].tipo === 'SOBRA' ? ' · SOBRA' : ''} · `
          + `Dia ${diaBR} · ${linhas.length} linha(s) · ${totalCx.toLocaleString('pt-BR')} cx · `
          + `${totalPeso.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`
          + `${operadores.length ? ' · Operador ' + operadores.join(', ') : ''}`,
      })}
      ${lista.length ? lista.filter((d) => d.itens.length).map((d) => `
      <div class="dev-doc-bloco">
        ${/* A identificação saiu da coluna e virou cabeçalho do bloco: é ela
              que faz a Portaria reconhecer, na chegada do caminhão, a qual
              checklist aquele papel se refere. */''}
        <div class="dev-doc-bloco-tit">Checklist Nº ${d.numero} · ${esc(devRotulo(d))}${d.tipo === 'SOBRA' ? ' · SOBRA' : ''}
          ${d.operadorCodigo ? ' · Cód. operador ' + esc(d.operadorCodigo) : ''}
          ${d.dataDev ? ' · ' + esc(String(d.dataDev).slice(0, 10).split('-').reverse().join('/')) : ''}</div>
        <table class="doc-tabela dev-doc-tabela">
          <thead><tr>
            <th>Nota</th><th title="A devolução é parcial ou total">Parcial / Total</th><th title="Número da nota parcial">Nº parcial</th>
            <th>Supervisor</th><th title="Vendedor">RCA</th>
            <th>Cliente</th><th>CX</th><th title="Peso em QUILOS (kg)">Peso (kg)</th><th>Produto</th>
            <th>Nº DEV</th>
            ${temCargaDev(d) ? '<th title="Carga de devolução do SIS ATAK">Nº carga dev</th>' : ''}
            <th>Data DEV</th><th>Motivo</th>
          </tr></thead>
          <tbody>${d.itens.map((i) => `
            <tr>
              <td>${esc(i.nota)}</td>
              <td class="c-pt">${parcialTotalTexto(i)}</td>
              <td>${i.parcial ? (esc(i.parcialDesc) || '—') : '—'}</td>
              <td>${esc(i.supervisor)}</td>
              <td>${esc(i.vendedor)}</td>
              <td>${clienteTextoDev(i)}</td>
              <td class="c-peso">${(Number(i.cx) || 0).toLocaleString('pt-BR')}</td>
              <td class="c-peso">${i.peso !== null ? Number(i.peso).toLocaleString('pt-BR') : '—'}</td>
              <td>${esc(i.codProduto)}${i.produtoNome ? '-' + esc(i.produtoNome) : ''}</td>
              <td>${esc(i.numDev)}</td>
              ${temCargaDev(d) ? `<td>${esc(cargaDevDoItem(i, d)) || '—'}</td>` : ''}
              <td>${i.dataItem ? esc(String(i.dataItem).slice(0, 10).split('-').reverse().join('/')) : '—'}</td>
              <td>${esc(i.motivo)}</td>
            </tr>`).join('')}</tbody>
          <tfoot>${somatorioLinhasOperadorDev(d.itens.map((i) => ({ i })), temCargaDev(d))}</tfoot>
        </table>
      </div>`).join('') : '<div class="card-sub">Nenhuma devolução lançada neste dia.</div>'}
      ${rodapeDocumento(
        'Todos os pesos desta relação estão em QUILOS (kg) — não em toneladas. '
        + 'Relação das linhas DESTE checklist, para lançamento pelo operador do '
        + 'monitoramento e para a Portaria reconhecer a devolução na chegada. '
        + 'Conferência de descarga, pesagem e destinação não entram aqui — elas '
        + 'ficam no Relatório de Devoluções, que é do dia inteiro.',
        `Checklist Nº ${lista[0].numero} do dia ${diaBR}, gravado no servidor pelo painel.`,
        '')}
    </div>`;

  await exportarViaServidor(el, `Devolucao-Operador-${lista[0].numero}-${dia}`, 'devolucao-operador');
}
