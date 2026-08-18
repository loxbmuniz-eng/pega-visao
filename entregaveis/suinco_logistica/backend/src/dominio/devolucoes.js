/* Devoluções: máquina de estados, permissões e tradução banco ↔ painel.

   Mesma filosofia de dominio/fluxo.js e dominio/cargas.js: a regra mora no
   servidor, o painel é só a tela dela. O ciclo espelha as "assinaturas" do
   checklist de papel — cada etapa vira um carimbo (operador + instante).

   FASE 1 (18/08/2026): só Logística e Administração usam a aba — eles
   executam todas as etapas para alimentar e auditar o processo (decisão da
   reunião com o gestor). Os setores da fase 2 já estão nas listas de cada
   transição: quando existirem operadores desses setores, nada aqui muda. */

export const DEV_STATUS_FLOW = [
  'Lançada',                   // 1 — Logística cria o checklist
  'Recebida na Portaria',      // 2 — porteiro imputa lacre(s) e nº da carga
  'Conferida no Faturamento',  // 3 — balança (peso final é opcional)
  'Descarga Conferida',        // 4 — Expedição confere item a item
  'Destinada',                 // 5 — Controles Internos: Estoque/Descarte/Reprocesso
  'Nota Finalizada',           // 6 — Central de Notas encerra a NF
];

export const DEV_STATUS_INICIAL = DEV_STATUS_FLOW[0];

const SETOR_IRRESTRITO = 'Administração';

/* A Logística aparece em todas as transições pelo mesmo motivo das cargas
   (cobre qualquer posto) — e porque na fase 1 é ela quem simula o ciclo
   inteiro na auditoria do processo. O primeiro setor da lista é o DONO do
   passo na fase 2. */
const TRANSICOES_DEV = [
  { de: 'Lançada',                  para: 'Recebida na Portaria',     setores: ['Portaria', 'Logística'],         carimbo: 'portaria' },
  { de: 'Recebida na Portaria',     para: 'Conferida no Faturamento', setores: ['Faturamento', 'Logística'],      carimbo: 'faturamento' },
  { de: 'Conferida no Faturamento', para: 'Descarga Conferida',       setores: ['Expedição', 'Logística'],        carimbo: 'expedicao' },
  { de: 'Descarga Conferida',       para: 'Destinada',                setores: ['Controles Internos', 'Logística'], carimbo: 'controles' },
  { de: 'Destinada',                para: 'Nota Finalizada',          setores: ['Central de Notas', 'Logística'], carimbo: 'notas' },
];

export class ErroDeFluxoDevolucao extends Error {
  constructor(mensagem, codigo = 'TRANSICAO_INVALIDA') {
    super(mensagem);
    this.name = 'ErroDeFluxoDevolucao';
    this.codigo = codigo;
    this.status = 409;
  }
}

export class ErroDePermissaoDevolucao extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDePermissaoDevolucao';
    this.codigo = 'SETOR_SEM_PERMISSAO';
    this.status = 403;
  }
}

/* Valida a transição e devolve a regra (o chamador precisa do `carimbo`
   para saber qual coluna estampar). Sentido único, um passo por vez —
   pular etapa no checklist é exatamente o que o papel permitia e o
   digital não deve permitir. */
export function validarTransicaoDevolucao(statusAtual, statusNovo, setor) {
  if (!DEV_STATUS_FLOW.includes(statusNovo)) {
    throw new ErroDeFluxoDevolucao(`Etapa desconhecida: "${statusNovo}".`, 'STATUS_DESCONHECIDO');
  }
  if (statusAtual === statusNovo) {
    throw new ErroDeFluxoDevolucao(`A devolução já está em "${statusNovo}".`, 'SEM_MUDANCA');
  }
  const regra = TRANSICOES_DEV.find((t) => t.de === statusAtual && t.para === statusNovo);
  if (!regra) {
    throw new ErroDeFluxoDevolucao(
      `Não é possível ir de "${statusAtual}" direto para "${statusNovo}".`
    );
  }
  if (setor !== SETOR_IRRESTRITO && !regra.setores.includes(setor)) {
    throw new ErroDePermissaoDevolucao(
      `O setor ${setor} não registra "${statusNovo}". `
      + `Quem faz esse passo: ${regra.setores.join(' ou ')}.`
    );
  }
  return regra;
}

/* Criar e editar o checklist é da Logística (Administração irrestrita) —
   "controle total das meninas", requisito nº 1 do pedido. */
export function podeCriarDevolucao(setor) {
  return setor === 'Logística' || setor === SETOR_IRRESTRITO;
}

export const DESTINACOES = ['Estoque', 'Descarte', 'Reprocesso'];

/* Lista de rotas vinda do corpo: aceita array ou string "519, 542".
   Normaliza, corta e deduplica — a validação contra dim_rotas é do
   chamador (precisa do banco). */
export function normalizarRotas(v) {
  const lista = Array.isArray(v) ? v : String(v ?? '').split(/[,;]/);
  const vistos = new Set();
  const rotas = [];
  for (const r of lista) {
    const cod = String(r ?? '').trim().slice(0, 20);
    if (cod && !vistos.has(cod)) { vistos.add(cod); rotas.push(cod); }
  }
  return rotas.slice(0, 20);
}

function texto(v, max = 500) {
  return String(v ?? '').slice(0, max);
}

function numeroOuNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Banco → painel (cabeçalho). Os carimbos vão agrupados: a tela e o
   relatório desenham a "linha de assinaturas" a partir disto. */
export function devolucaoParaPainel(linha, itens = [], divergencias = [], rotas = []) {
  if (!linha) return null;
  return {
    id: linha.devolucao_id,
    numero: Number(linha.numero),
    dataDev: linha.data_dev,
    /* Um checklist junta rotas da mesma região (decisão de 18/08/2026) —
       sempre array. `linha.rota_codigo` só existe em revisões gravadas
       antes da migração 012; vira array de um item para o painel não
       precisar conhecer as duas eras. */
    rotas: rotas.length ? rotas : (linha.rota_codigo ? [linha.rota_codigo] : []),
    regiao: linha.regiao,
    // Código do operador, informado pelo MONITORAMENTO (18/08/2026) — é
    // sob ele que as devoluções são lançadas.
    operadorCodigo: linha.operador_codigo || '',
    transportadora: linha.transportadora,
    notaTransferencia: linha.nota_transferencia,
    placa: linha.placa,
    motorista: linha.motorista,
    cargaNumero: linha.carga_numero,
    lacre1: linha.lacre1,
    lacre2: linha.lacre2,
    pesoFinal: linha.peso_final === null ? null : Number(linha.peso_final),
    status: linha.status,
    criadaPor: linha.criada_por,
    criadaSetor: linha.criada_setor,
    obsControles: linha.obs_controles,
    observacoes: linha.observacoes,
    carimbos: {
      portaria:    linha.portaria_em    ? { por: linha.portaria_por,    em: linha.portaria_em }    : null,
      faturamento: linha.faturamento_em ? { por: linha.faturamento_por, em: linha.faturamento_em } : null,
      expedicao:   linha.expedicao_em   ? { por: linha.expedicao_por,   em: linha.expedicao_em }   : null,
      controles:   linha.controles_em   ? { por: linha.controles_por,   em: linha.controles_em }   : null,
      notas:       linha.notas_em       ? { por: linha.notas_por,       em: linha.notas_em }       : null,
    },
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
    itens: itens.map(itemParaPainel),
    divergencias: divergencias.map(divergenciaParaPainel),
  };
}

export function itemParaPainel(i) {
  const cx = Number(i.cx) || 0;
  const recebida = i.qtd_recebida === null || i.qtd_recebida === undefined
    ? null : Number(i.qtd_recebida);
  return {
    itemId: Number(i.item_id),
    nota: i.nota,
    parcial: !!i.parcial,
    supervisor: i.supervisor,
    vendedor: i.vendedor,
    codCliente: i.cod_cliente,
    cx,
    peso: i.peso === null ? null : Number(i.peso),
    codProduto: i.cod_produto,
    produtoNome: i.produto_nome,
    numDev: i.num_dev,
    dataItem: i.data_item,
    motivo: i.motivo,
    qtdRecebida: recebida,
    /* A falta é SEMPRE calculada — regra da reunião: checklist diz 5,
       chegou 3, o sistema aponta 2 sozinho. Null = ainda não conferido,
       que é diferente de "chegou tudo". */
    falta: recebida === null ? null : Math.max(0, cx - recebida),
    destinacao: i.destinacao || null,
    // Pesagem do Faturamento — a confirmação de que passou pela balança.
    pesoFaturamento: i.peso_faturamento === null || i.peso_faturamento === undefined
      ? null : Number(i.peso_faturamento),
    // Tick da Central de Notas: item com a nota finalizada.
    notaFinal: !!i.nota_final,
  };
}

export function divergenciaParaPainel(d) {
  return {
    divergenciaId: Number(d.divergencia_id),
    codProduto: d.cod_produto,
    produtoNome: d.produto_nome,
    cx: Number(d.cx) || 0,
    observacao: d.observacao,
    lancadaPor: d.lancada_por,
    criadoEm: d.criado_em,
  };
}

/* Painel → colunas do cabeçalho (criação e edição). Só o que a Logística
   pode escrever — carimbos e status nunca passam por aqui. */
export function camposCabecalho(corpo) {
  const m = {};
  if (corpo.dataDev !== undefined) m.data_dev = texto(corpo.dataDev, 10);
  if (corpo.regiao !== undefined) m.regiao = texto(corpo.regiao, 100);
  if (corpo.operadorCodigo !== undefined) m.operador_codigo = texto(corpo.operadorCodigo, 50);
  /* Lacres e nº da carga viraram campos do cabeçalho editável (a Portaria
     passou a imputar só placa e motorista no recebimento — alinhamento de
     18/08/2026; os lacres seguem existindo na capa e alguém precisa poder
     escrevê-los). */
  if (corpo.lacre1 !== undefined) m.lacre1 = texto(corpo.lacre1, 50);
  if (corpo.lacre2 !== undefined) m.lacre2 = texto(corpo.lacre2, 50);
  if (corpo.cargaNumero !== undefined) m.carga_numero = texto(corpo.cargaNumero, 50);
  if (corpo.transportadora !== undefined) m.transportadora = texto(corpo.transportadora, 200);
  if (corpo.notaTransferencia !== undefined) m.nota_transferencia = texto(corpo.notaTransferencia, 50);
  if (corpo.placa !== undefined) m.placa = texto(corpo.placa, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (corpo.motorista !== undefined) m.motorista = texto(corpo.motorista, 200);
  if (corpo.observacoes !== undefined) m.observacoes = texto(corpo.observacoes, 2000);
  return m;
}

/* Painel → colunas de um item. */
export function camposItem(corpo) {
  const m = {};
  if (corpo.nota !== undefined) m.nota = texto(corpo.nota, 50);
  if (corpo.parcial !== undefined) m.parcial = !!corpo.parcial;
  if (corpo.supervisor !== undefined) m.supervisor = texto(corpo.supervisor, 100);
  if (corpo.vendedor !== undefined) m.vendedor = texto(corpo.vendedor, 100);
  if (corpo.codCliente !== undefined) m.cod_cliente = texto(corpo.codCliente, 100);
  if (corpo.cx !== undefined) m.cx = Math.max(0, numeroOuNull(corpo.cx) ?? 0);
  if (corpo.peso !== undefined) m.peso = numeroOuNull(corpo.peso);
  if (corpo.codProduto !== undefined) m.cod_produto = texto(corpo.codProduto, 50);
  if (corpo.produtoNome !== undefined) m.produto_nome = texto(corpo.produtoNome, 200);
  if (corpo.numDev !== undefined) m.num_dev = texto(corpo.numDev, 50);
  if (corpo.dataItem !== undefined) m.data_item = corpo.dataItem ? texto(corpo.dataItem, 10) : null;
  if (corpo.motivo !== undefined) m.motivo = texto(corpo.motivo, 300);
  if (corpo.qtdRecebida !== undefined) {
    const n = numeroOuNull(corpo.qtdRecebida);
    m.qtd_recebida = n === null ? null : Math.max(0, n);
  }
  if (corpo.destinacao !== undefined) {
    m.destinacao = DESTINACOES.includes(corpo.destinacao) ? corpo.destinacao : null;
  }
  if (corpo.pesoFaturamento !== undefined) {
    const n = numeroOuNull(corpo.pesoFaturamento);
    m.peso_faturamento = n === null ? null : Math.max(0, n);
  }
  if (corpo.notaFinal !== undefined) m.nota_final = !!corpo.notaFinal;
  return m;
}
