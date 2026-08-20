/* Tradução entre a carga como o painel a conhece e como o banco a guarda,
   mais o SQL de leitura e gravação.

   O painel usa camelCase (`numeroCarga`, `qtdGanchos`) e "Sim"/"Não" para
   paletizada; o banco usa snake_case e boolean. A conversão fica concentrada
   aqui — em um lugar só — para o resto do servidor não precisar saber das
   duas convenções. */

import { STATUS_FLOW, STATUS_INICIAL } from './fluxo.js';

/* 3 categorias, não 4. Pedido do gestor (08/08/2026, migração
   003_tipo_operacao.sql): FROTA PROPRIA saiu (caminhão próprio fazendo
   entrega direta é a mesma coisa que terceiro dedicado fazendo entrega
   direta) e DEDICADA virou ENTREGA DIRETA. */
const PRA_ONDE_OPCOES = ['CROSS-DOCKING', 'ENTREGA DIRETA', 'RET FRIGO'];
const PRA_ONDE_PADRAO = 'ENTREGA DIRETA';

/* Placa: maiúscula, só letra e número. A mesma normalização do painel — se
   divergirem, a mesma placa vira dois cadastros e a trava de frota fura. */
export function normalizarPlaca(v) {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* Identificadores vêm do cliente (para a fila offline funcionar), então
   precisam ser tratados como entrada hostil. Mesmo formato do idSeguro()
   que corrigiu o XSS no painel. */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;
export function idSeguro(v) {
  const s = String(v ?? '');
  return ID_SEGURO.test(s) ? s : null;
}

function texto(v, max = 500) {
  return String(v ?? '').slice(0, max);
}

function inteiro(v, padrao = 0, minimo = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(minimo, Math.trunc(n)) : padrao;
}

/* Data vinda do painel, com o agora como reserva.

   Aceitar a data do cliente aqui é deliberado: a gravação pode ter ficado
   na fila offline por horas, e carimbar `now` no servidor registraria a
   hora em que a rede voltou, não a hora em que a carga foi lançada — que é
   exatamente o que o relatório precisa acertar. Data inválida ou ausente
   cai no agora, para nunca gravar nulo por engano do cliente. */
function dataOuAgora(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : new Date();
}

/* Banco → painel. */
export function paraPainel(linha) {
  if (!linha) return null;
  return {
    id: linha.carga_id,
    numeroCarga: linha.numero_carga,
    placa: linha.placa,
    transportadora: linha.transportadora,
    tipoVeiculo: linha.tipo_veiculo,
    motorista: linha.motorista,
    cliente: linha.cliente,
    destino: linha.destino,
    produto: '',
    peso: linha.peso_kg,
    doca: linha.doca,
    rota: linha.rota_codigo || '',
    sequencia: linha.sequencia,
    praOnde: linha.pra_onde,
    paletizada: linha.paletizada ? 'Sim' : 'Não',
    qtdGanchos: linha.qtd_ganchos,
    qtdEntregas: linha.qtd_entregas,
    observacoes: linha.observacoes,
    lacre: linha.lacre || '',
    /* Até TRÊS lacres na saída (migração 025). `lacre` continua sendo o
       primeiro — nenhum relatório antigo precisou mudar por causa disto. */
    lacre2: linha.lacre_2 || '',
    lacre3: linha.lacre_3 || '',
    lacreRetido: linha.lacre_retido || '',
    status: linha.status_atual,
    aguardandoCarga: linha.aguardando_carga,
    criadoEm: linha.criado_em,
    /* Data em que a CARGA foi lançada — diferente de criado_em quando o
       caminhão chegou sem programação e a carga só foi lançada depois.
       O relatório do gestor filtra por esta. Ver migration 007.

       NULL É RESPOSTA (19/08/2026). Até hoje isto era
       `programado_em || criado_em`, e esse "||" era o último elo da cadeia
       que fazia a programação puxar dia errado: o caminhão que entrou
       ONTEM e teve a carga lançada HOJE recebia de volta a data da
       ENTRADA, o painel regravava esse valor no próximo save() e a carga
       nascia velha. Relato do gestor no mesmo dia: "programação hoje foi
       liberada com 11 cargas, só aparecem 9 — faltam dois que deram
       entrada ontem".

       Entrada sem carga NÃO TEM data de programação, e dizer isso em voz
       alta (null) é o que permite ao painel mostrar a data da entrada como
       entrada e trocar por now() no lançamento. Quem quiser um fallback
       para exibição que o faça na tela, não aqui. */
    programadoEm: linha.programado_em || null,
    criadoPor: linha.operador_nome,
    /* DUAS VERDADES, DUAS DATAS (migração 026).

       `atualizadoEm` é quando a LINHA foi gravada — sobe também com eco de
       sincronização, e é o que a sincronia incremental usa. `acaoEm` é
       quando uma PESSOA mudou alguma coisa. Confundir as duas foi o que
       fez a Torre mostrar a programação inteira com o mesmo horário. */
    atualizadoEm: linha.atualizado_em,
    acaoEm: linha.acao_em || null,
    acaoPor: linha.acao_por || '',
    acaoSetor: linha.acao_setor || '',
    versao: linha.versao,
    // Carga excluída continua sendo devolvida na leitura incremental: é
    // assim que os outros terminais descobrem que ela saiu. Sem esta
    // marca, uma linha apagada simplesmente não apareceria em consulta
    // nenhuma e a carga ficaria na tela dos colegas até alguém recarregar.
    excluida: !!linha.excluida_em,
  };
}

/* Painel → banco, para criação. Toda entrada passa por aqui saneada; nada
   do corpo da requisição chega ao SQL sem ter sido convertido ao tipo certo
   e limitado em tamanho. */
export function saneiarCriacao(corpo, frota) {
  const placa = normalizarPlaca(corpo.placa);
  const praOnde = PRA_ONDE_OPCOES.includes(corpo.praOnde) ? corpo.praOnde : PRA_ONDE_PADRAO;
  return {
    carga_id: idSeguro(corpo.id) || `carga_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    numero_carga: texto(corpo.numeroCarga, 60),
    placa,
    // A transportadora e o tipo vêm da base de Frota quando o cliente não
    // manda — é ela que manda, não o que foi digitado na tela.
    transportadora: texto(corpo.transportadora || frota?.transportadora, 200),
    tipo_veiculo: texto(corpo.tipoVeiculo || frota?.tipo_veiculo, 100),
    motorista: texto(corpo.motorista, 200),
    cliente: texto(corpo.cliente, 200),
    destino: texto(corpo.destino, 200),
    peso_kg: inteiro(corpo.peso, 0),
    doca: texto(corpo.doca, 60),
    rota_codigo: texto(corpo.rota, 20) || null,
    sequencia: corpo.sequencia === '' || corpo.sequencia == null ? null : inteiro(corpo.sequencia, null),
    pra_onde: praOnde,
    paletizada: corpo.paletizada === 'Sim' || corpo.paletizada === true,
    qtd_ganchos: inteiro(corpo.qtdGanchos, 0),
    qtd_entregas: Math.max(1, inteiro(corpo.qtdEntregas, 1, 1)),
    observacoes: texto(corpo.observacoes, 2000),
    // Lacres (migração 015): normalmente vazios na criação — nascem na
    // saída — mas a fila offline pode subir uma carga que já saiu com
    // lacre, e ignorá-los aqui perderia o número em silêncio.
    lacre: texto(corpo.lacre, 50),
    lacre_2: texto(corpo.lacre2, 50),
    lacre_3: texto(corpo.lacre3, 50),
    lacre_retido: texto(corpo.lacreRetido, 50),
    /* Data em que a CARGA foi lançada. Vem do painel porque ele pode estar
       subindo algo que ficou na fila offline — usar `now` aqui carimbaria a
       hora da sincronização, não a do lançamento. Ver migration 007. */
    programado_em: dataOuAgora(corpo.programadoEm),
    status_atual: STATUS_FLOW.includes(corpo.status) ? corpo.status : STATUS_INICIAL,
    aguardando_carga: corpo.aguardandoCarga === true,
  };
}

/* Painel → banco, para CHEGADA SEM PROGRAMAÇÃO — a Portaria registrando um
   caminhão que apareceu sem carga cadastrada.

   Ignora TODO campo de negócio do corpo, exceto `id` e `placa`. Não é
   descuido: `aguardandoCarga:true` destrava esta rota para a Portaria (ver
   podeRegistrarChegadaSemProgramacao em dominio/fluxo.js), e se essa mesma
   flag também liberasse peso/motorista/número arbitrários do corpo, viraria
   um jeito de contornar a permissão normal de criação de carga — a Portaria
   poderia programar uma carga completa só marcando essa flag. O servidor
   decide a forma inteira; o cliente só escolhe a placa.

   Isso também é o que explica não reusar a trava de frota aqui: um caminhão
   pode chegar fisicamente sem nunca ter sido cadastrado, e a Portaria
   precisa registrar a presença dele mesmo assim — a Logística corrige o
   cadastro depois. A trava continua valendo para saneiarCriacao(). */
export function saneiarCriacaoChegadaSemProgramacao(corpo, frota) {
  return {
    carga_id: idSeguro(corpo.id) || `carga_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    numero_carga: 'Aguardando Carga',
    placa: normalizarPlaca(corpo.placa),
    transportadora: texto(frota?.transportadora, 200),
    tipo_veiculo: texto(frota?.tipo_veiculo, 100),
    motorista: '',
    cliente: '', destino: '',
    peso_kg: 0,
    doca: '',
    rota_codigo: null,
    sequencia: null,
    pra_onde: PRA_ONDE_PADRAO,
    paletizada: false,
    qtd_ganchos: 0,
    qtd_entregas: 1,
    observacoes: '',
    status_atual: 'Aguardando Embarque',
    aguardando_carga: true,
  };
}

/* Painel → banco, para atualização parcial. Só devolve as chaves realmente
   enviadas E permitidas ao setor: mandar `undefined` para o SQL apagaria o
   valor que já está lá. */
export function saneiarEdicao(corpo, camposPermitidos) {
  const mapa = {
    numero_carga: () => texto(corpo.numeroCarga, 60),
    placa: () => normalizarPlaca(corpo.placa),
    transportadora: () => texto(corpo.transportadora, 200),
    tipo_veiculo: () => texto(corpo.tipoVeiculo, 100),
    motorista: () => texto(corpo.motorista, 200),
    cliente: () => texto(corpo.cliente, 200),
    destino: () => texto(corpo.destino, 200),
    peso_kg: () => inteiro(corpo.peso, 0),
    doca: () => texto(corpo.doca, 60),
    rota_codigo: () => texto(corpo.rota, 20) || null,
    sequencia: () => (corpo.sequencia === '' || corpo.sequencia == null ? null : inteiro(corpo.sequencia, null)),
    pra_onde: () => (PRA_ONDE_OPCOES.includes(corpo.praOnde) ? corpo.praOnde : PRA_ONDE_PADRAO),
    paletizada: () => corpo.paletizada === 'Sim' || corpo.paletizada === true,
    qtd_ganchos: () => inteiro(corpo.qtdGanchos, 0),
    qtd_entregas: () => Math.max(1, inteiro(corpo.qtdEntregas, 1, 1)),
    observacoes: () => texto(corpo.observacoes, 2000),
    lacre: () => texto(corpo.lacre, 50),
    lacre_2: () => texto(corpo.lacre2, 50),
    lacre_3: () => texto(corpo.lacre3, 50),
    lacre_retido: () => texto(corpo.lacreRetido, 50),
    programado_em: () => dataOuAgora(corpo.programadoEm),
    aguardando_carga: () => corpo.aguardandoCarga === true,
  };
  const chaveDoPainel = {
    numero_carga: 'numeroCarga', placa: 'placa', transportadora: 'transportadora',
    tipo_veiculo: 'tipoVeiculo', motorista: 'motorista', cliente: 'cliente',
    destino: 'destino', peso_kg: 'peso', doca: 'doca', rota_codigo: 'rota',
    sequencia: 'sequencia', pra_onde: 'praOnde', paletizada: 'paletizada',
    qtd_ganchos: 'qtdGanchos', qtd_entregas: 'qtdEntregas',
    observacoes: 'observacoes', aguardando_carga: 'aguardandoCarga',
    programado_em: 'programadoEm',
    lacre: 'lacre', lacre_2: 'lacre2', lacre_3: 'lacre3', lacre_retido: 'lacreRetido',
  };

  const saida = {};
  for (const coluna of camposPermitidos) {
    const chave = chaveDoPainel[coluna];
    if (chave && Object.prototype.hasOwnProperty.call(corpo, chave)) {
      saida[coluna] = mapa[coluna]();
    }
  }
  return saida;
}

/* O que, ao mudar numa carga já programada, o pátio inteiro precisa saber.

   A lista é curta de propósito. Observação e doca ficam de fora: mudam com
   frequência, raramente alteram a decisão de quem está carregando, e um
   aviso que aparece o tempo todo deixa de ser lido — inclusive no dia em
   que a placa mudar de verdade.

   O rótulo é o nome que o operador vê na tela, não o da coluna. */
const CAMPOS_AVISADOS = [
  ['placa', 'Placa'],
  ['numero_carga', 'Número da carga'],
  ['rota_codigo', 'Rota'],
  ['sequencia', 'Sequência'],
  ['cliente', 'Cliente'],
  ['destino', 'Destino'],
  ['motorista', 'Motorista'],
  ['peso_kg', 'Peso (kg)'],
  ['pra_onde', 'Pra onde'],
  ['qtd_ganchos', 'Ganchos'],
  ['qtd_entregas', 'Entregas'],
  ['paletizada', 'Paletizada'],
  ['transportadora', 'Transportadora'],
  ['tipo_veiculo', 'Tipo de veículo'],
];

function paraTexto(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  return String(v);
}

/* Diferença entre o antes e o depois, já em linguagem de operador.

   Compara como texto porque é assim que a diferença vai ser exibida: o
   banco devolve `peso_kg` ora como número, ora como string, dependendo do
   driver, e comparar tipos crus acusaria mudança onde não houve. */
export function camposDeAviso(antes, depois) {
  if (!antes || !depois) return [];
  const saida = [];
  for (const [coluna, rotulo] of CAMPOS_AVISADOS) {
    const de = paraTexto(antes[coluna]);
    const para = paraTexto(depois[coluna]);
    if (de !== para) saida.push({ campo: rotulo, de, para });
  }
  return saida;
}

export const COLUNAS_CARGA = `
  carga_id, numero_carga, placa, transportadora, tipo_veiculo, motorista,
  cliente, destino, peso_kg, doca, rota_codigo, sequencia, pra_onde,
  paletizada, qtd_ganchos, qtd_entregas, observacoes, lacre, lacre_2, lacre_3, lacre_retido,
  status_atual,
  aguardando_carga, criado_em, programado_em, atualizado_em,
  acao_em, acao_por, acao_setor, operador_id, operador_nome,
  operador_setor, versao, excluida_em, excluida_por`;
