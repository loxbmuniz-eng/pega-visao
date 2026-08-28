/* Devoluções: máquina de estados, permissões e tradução banco ↔ painel.

   Mesma filosofia de dominio/fluxo.js e dominio/cargas.js: a regra mora no
   servidor, o painel é só a tela dela. O ciclo espelha as "assinaturas" do
   checklist de papel — cada etapa vira um carimbo (operador + instante).

   FASE 1 (18/08/2026): só Logística e Administração usam a aba — eles
   executam todas as etapas para alimentar e auditar o processo (decisão da
   reunião com o gestor). Os setores da fase 2 já estão nas listas de cada
   transição: quando existirem operadores desses setores, nada aqui muda. */

/* A BALANÇA É USADA DUAS VEZES (27/08/2026).

   O dono, descrevendo o caminho real: "caminhão chega com devoluções, pesa
   na balança, vai pra expedição, descarrega, depois volta pra balança pra
   pesar vazio (...) faturamento colocar o peso final depois que
   descarregou".

   Até aqui a esteira tinha UMA passagem pelo Faturamento, antes da
   Expedição, e um campo de peso só. Faltava a segunda ida à balança — que
   não é detalhe: é a diferença entre as duas pesagens que diz quanto
   voltou de VERDADE, e é essa conta que se compara com a soma do que foi
   lançado no checklist. Sem ela, divergência entre o lançado e o que
   desceu do caminhão não aparece em lugar nenhum.

   As duas passagens são do Faturamento e têm assinaturas separadas: são
   dois momentos e duas responsabilidades. */
export const DEV_STATUS_FLOW = [
  'Lançada',                   // 1 — Logística cria o checklist
  'Recebida na Portaria',      // 2 — porteiro imputa lacre(s) e nº da carga
  'Conferida no Faturamento',  // 3 — balança, caminhão CHEIO (peso de entrada)
  'Descarga Conferida',        // 4 — Expedição confere item a item
  'Peso Final Registrado',     // 5 — balança de novo, caminhão VAZIO (peso final)
  'Destinada',                 // 6 — Controles Internos confirmam e deixam recado
  'Nota Finalizada',           // 7 — Central de Notas encerra a NF
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
  { de: 'Descarga Conferida',       para: 'Peso Final Registrado',    setores: ['Faturamento', 'Logística'],      carimbo: 'pesofinal' },
  { de: 'Peso Final Registrado',    para: 'Destinada',                setores: ['Controles Internos', 'Logística'], carimbo: 'controles' },
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
export function validarTransicaoDevolucao(statusAtual, statusNovo, setor, tipo) {
  if (!DEV_STATUS_FLOW.includes(statusNovo)) {
    throw new ErroDeFluxoDevolucao(`Etapa desconhecida: "${statusNovo}".`, 'STATUS_DESCONHECIDO');
  }
  /* SOBRA (18/08/2026): ciclo curto — Portaria OK, Faturamento OK,
     Expedição OK, acabou. Não passa por Controles Internos nem Central
     de Notas. */
  /* A SOBRA NÃO GANHA A SEGUNDA PESAGEM: ela encerra no OK da Expedição,
     e o caminhão da sobra não volta à balança. Acrescentar a etapa aqui
     seria pedir um peso que ninguém tem para dar. */
  if (tipo === 'SOBRA'
      && ['Peso Final Registrado', 'Destinada', 'Nota Finalizada'].includes(statusNovo)) {
    throw new ErroDeFluxoDevolucao(
      'Sobra encerra no OK da Expedição — não volta à balança nem passa por '
      + 'Controles Internos e Central de Notas.',
      'ETAPA_NAO_EXISTE_PARA_SOBRA'
    );
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
    tipo: linha.tipo || 'DEVOLUCAO',
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
    // Terceiro lacre (migração 025): o caminhão pode sair — e chegar — com
    // até três. Ver o comentário da migração.
    lacre3: linha.lacre3 || '',
    /* AS DUAS PESAGENS E A CONTA (27/08/2026). `pesoEntrada` é o caminhão
       cheio na chegada; `pesoFinal`, o mesmo caminhão vazio depois da
       descarga. `pesoDevolvido` é a diferença — calculada aqui, no
       servidor, para que painel, relatório e BI leiam o MESMO número: a
       mesma conta escrita em três lugares vira três respostas na primeira
       correção feita com pressa. Falta uma das pontas, a conta não existe
       (null), e null não é zero. */
    pesoEntrada: linha.peso_entrada === null || linha.peso_entrada === undefined
      ? null : Number(linha.peso_entrada),
    pesoFinal: linha.peso_final === null ? null : Number(linha.peso_final),
    pesoDevolvido: (linha.peso_entrada === null || linha.peso_entrada === undefined
                    || linha.peso_final === null || linha.peso_final === undefined)
      ? null : Number(linha.peso_entrada) - Number(linha.peso_final),
    status: linha.status,
    criadaPor: linha.criada_por,
    criadaSetor: linha.criada_setor,
    obsControles: linha.obs_controles,
    /* O recado da Central de Notas para quem vem depois — a outra metade do
       que o dono pediu para as duas últimas etapas: "observações para que
       eles possam comunicar com a próxima etapa". */
    obsNotas: linha.obs_notas || '',
    /* RDC/Romaneio (18/08/2026): os Controles Internos informam na
       destinação se o romaneio foi gerado. Três estados — null (ainda não
       informado), true (gerou) e false (não gerou) — porque "não informado"
       e "não gerou" são respostas diferentes na auditoria. */
    gerouRdc: linha.gerou_rdc === null || linha.gerou_rdc === undefined ? null : !!linha.gerou_rdc,
    /* Chegou lacrado? (18/08/2026) — null = não informado, true = veio
       lacrado (número em lacre1/lacre2), false = veio SEM lacre, dito de
       propósito. É informação, não trava. */
    chegouLacrado: linha.chegou_lacrado === null || linha.chegou_lacrado === undefined
      ? null : !!linha.chegou_lacrado,
    observacoes: linha.observacoes,
    carimbos: {
      portaria:    linha.portaria_em    ? { por: linha.portaria_por,    em: linha.portaria_em }    : null,
      faturamento: linha.faturamento_em ? { por: linha.faturamento_por, em: linha.faturamento_em } : null,
      expedicao:   linha.expedicao_em   ? { por: linha.expedicao_por,   em: linha.expedicao_em }   : null,
      pesofinal:   linha.pesofinal_em   ? { por: linha.pesofinal_por,   em: linha.pesofinal_em }   : null,
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
    /* Qual parcial é esta linha (18/08/2026): a mesma nota pode ter duas —
       uma que retorna e outra que não, ou as duas retornando. O texto vem
       da capa, escrito por quem lança. */
    parcialDesc: i.parcial_desc || '',
    supervisor: i.supervisor,
    vendedor: i.vendedor,
    codCliente: i.cod_cliente,
    /* Nome do cliente guardado JUNTO do código (migração 028): o relatório
       vai para quem não digitou nada, e código sozinho não identifica
       ninguém. Mesma regra de produtoNome. */
    clienteNome: i.cliente_nome || '',
    cx,
    peso: i.peso === null ? null : Number(i.peso),
    codProduto: i.cod_produto,
    produtoNome: i.produto_nome,
    numDev: i.num_dev,
    /* Nº DA CARGA DE DEVOLUÇÃO (migração 025) — o número que o SIS ATAK
       gera quando a PORTARIA abre esta DEV. Não confundir com numDev, que
       é o código da devolução já escrito no checklist pela Logística: são
       dois números, de dois momentos e de dois donos diferentes. */
    cargaDev: i.carga_dev || '',
    dataItem: i.data_item,
    motivo: i.motivo,
    qtdRecebida: recebida,
    /* A falta é SEMPRE calculada — regra da reunião: checklist diz 5,
       chegou 3, o sistema aponta 2 sozinho. Null = ainda não conferido,
       que é diferente de "chegou tudo". */
    falta: recebida === null ? null : Math.max(0, cx - recebida),
    destinacao: i.destinacao || null,
    /* Destinação múltipla (migração 020): caixas por destino — 3 caixas
       podem virar 1 Estoque + 2 Descarte. */
    destEstoque: i.dest_estoque === null || i.dest_estoque === undefined ? null : Number(i.dest_estoque),
    destDescarte: i.dest_descarte === null || i.dest_descarte === undefined ? null : Number(i.dest_descarte),
    destReprocesso: i.dest_reprocesso === null || i.dest_reprocesso === undefined ? null : Number(i.dest_reprocesso),
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
  if (corpo.lacre3 !== undefined) m.lacre3 = texto(corpo.lacre3, 50);
  if (corpo.cargaNumero !== undefined) m.carga_numero = texto(corpo.cargaNumero, 50);
  // As duas pesagens, as duas do Faturamento (18/08/2026 e 27/08/2026).
  if (corpo.pesoEntrada !== undefined) {
    const n = numeroOuNull(corpo.pesoEntrada);
    m.peso_entrada = n === null ? null : Math.max(0, n);
  }
  if (corpo.pesoFinal !== undefined) {
    const n = numeroOuNull(corpo.pesoFinal);
    m.peso_final = n === null ? null : Math.max(0, n);
  }
  if (corpo.transportadora !== undefined) m.transportadora = texto(corpo.transportadora, 200);
  if (corpo.notaTransferencia !== undefined) m.nota_transferencia = texto(corpo.notaTransferencia, 50);
  if (corpo.placa !== undefined) m.placa = texto(corpo.placa, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (corpo.motorista !== undefined) m.motorista = texto(corpo.motorista, 200);
  if (corpo.observacoes !== undefined) m.observacoes = texto(corpo.observacoes, 2000);
  /* Os recados das duas últimas etapas. `obsControles` já era gravado pela
     rota da destinação; agora também é campo de cabeçalho, porque a etapa
     dos Controles Internos passou a ser só confirmar e deixar recado. */
  if (corpo.obsControles !== undefined) m.obs_controles = texto(corpo.obsControles, 2000);
  if (corpo.obsNotas !== undefined) m.obs_notas = texto(corpo.obsNotas, 2000);
  // RDC/Romaneio — campo dos Controles Internos (18/08/2026). Vazio/null
  // volta a "não informado"; qualquer outra coisa vira sim/não de verdade.
  // "Chegou lacrado?" — informado pela PORTARIA no recebimento. Vazio
  // volta a "não informado"; false é resposta de verdade ("veio sem lacre").
  if (corpo.chegouLacrado !== undefined) {
    m.chegou_lacrado = corpo.chegouLacrado === null || corpo.chegouLacrado === '' ? null
      : (corpo.chegouLacrado === false || corpo.chegouLacrado === 'false' ? false : true);
  }
  if (corpo.gerouRdc !== undefined) {
    m.gerou_rdc = corpo.gerouRdc === null || corpo.gerouRdc === '' ? null
      : (corpo.gerouRdc === false || corpo.gerouRdc === 'false' ? false : true);
  }
  return m;
}

/* Painel → colunas de um item. */
export function camposItem(corpo) {
  const m = {};
  if (corpo.nota !== undefined) m.nota = texto(corpo.nota, 50);
  if (corpo.parcial !== undefined) m.parcial = !!corpo.parcial;
  // Descrição da parcial — só faz sentido com parcial marcada, mas guardar
  // o texto mesmo em Total não estraga nada e evita perder o que a pessoa
  // digitou ao trocar de opção sem querer.
  if (corpo.parcialDesc !== undefined) m.parcial_desc = texto(corpo.parcialDesc, 300);
  if (corpo.supervisor !== undefined) m.supervisor = texto(corpo.supervisor, 100);
  if (corpo.vendedor !== undefined) m.vendedor = texto(corpo.vendedor, 100);
  if (corpo.codCliente !== undefined) m.cod_cliente = texto(corpo.codCliente, 100);
  if (corpo.clienteNome !== undefined) m.cliente_nome = texto(corpo.clienteNome, 200);
  if (corpo.cx !== undefined) m.cx = Math.max(0, numeroOuNull(corpo.cx) ?? 0);
  if (corpo.peso !== undefined) m.peso = numeroOuNull(corpo.peso);
  if (corpo.codProduto !== undefined) m.cod_produto = texto(corpo.codProduto, 50);
  if (corpo.produtoNome !== undefined) m.produto_nome = texto(corpo.produtoNome, 200);
  if (corpo.numDev !== undefined) m.num_dev = texto(corpo.numDev, 50);
  if (corpo.cargaDev !== undefined) m.carga_dev = texto(corpo.cargaDev, 50);
  if (corpo.dataItem !== undefined) m.data_item = corpo.dataItem ? texto(corpo.dataItem, 10) : null;
  if (corpo.motivo !== undefined) m.motivo = texto(corpo.motivo, 300);
  if (corpo.qtdRecebida !== undefined) {
    const n = numeroOuNull(corpo.qtdRecebida);
    m.qtd_recebida = n === null ? null : Math.max(0, n);
  }
  if (corpo.destinacao !== undefined) {
    m.destinacao = DESTINACOES.includes(corpo.destinacao) ? corpo.destinacao : null;
  }
  for (const [chave, coluna] of [['destEstoque', 'dest_estoque'],
    ['destDescarte', 'dest_descarte'], ['destReprocesso', 'dest_reprocesso']]) {
    if (corpo[chave] !== undefined) {
      const n = numeroOuNull(corpo[chave]);
      m[coluna] = n === null ? null : Math.max(0, n);
    }
  }
  if (corpo.pesoFaturamento !== undefined) {
    const n = numeroOuNull(corpo.pesoFaturamento);
    m.peso_faturamento = n === null ? null : Math.max(0, n);
  }
  if (corpo.notaFinal !== undefined) m.nota_final = !!corpo.notaFinal;
  return m;
}
