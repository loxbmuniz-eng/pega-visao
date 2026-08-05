/* Tradução entre a carga como o painel a conhece e como o banco a guarda,
   mais o SQL de leitura e gravação.

   O painel usa camelCase (`numeroCarga`, `qtdGanchos`) e "Sim"/"Não" para
   paletizada; o banco usa snake_case e boolean. A conversão fica concentrada
   aqui — em um lugar só — para o resto do servidor não precisar saber das
   duas convenções. */

import { STATUS_FLOW, STATUS_INICIAL } from './fluxo.js';

const PRA_ONDE_OPCOES = ['FROTA PROPRIA', 'CROSS-DOCKING', 'DEDICADA', 'RET FRIGO'];
const PRA_ONDE_PADRAO = 'FROTA PROPRIA';

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
    status: linha.status_atual,
    aguardandoCarga: linha.aguardando_carga,
    criadoEm: linha.criado_em,
    criadoPor: linha.operador_nome,
    atualizadoEm: linha.atualizado_em,
    versao: linha.versao,
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
    status_atual: STATUS_FLOW.includes(corpo.status) ? corpo.status : STATUS_INICIAL,
    aguardando_carga: corpo.aguardandoCarga === true,
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
    aguardando_carga: () => corpo.aguardandoCarga === true,
  };
  const chaveDoPainel = {
    numero_carga: 'numeroCarga', placa: 'placa', transportadora: 'transportadora',
    tipo_veiculo: 'tipoVeiculo', motorista: 'motorista', cliente: 'cliente',
    destino: 'destino', peso_kg: 'peso', doca: 'doca', rota_codigo: 'rota',
    sequencia: 'sequencia', pra_onde: 'praOnde', paletizada: 'paletizada',
    qtd_ganchos: 'qtdGanchos', qtd_entregas: 'qtdEntregas',
    observacoes: 'observacoes', aguardando_carga: 'aguardandoCarga',
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

export const COLUNAS_CARGA = `
  carga_id, numero_carga, placa, transportadora, tipo_veiculo, motorista,
  cliente, destino, peso_kg, doca, rota_codigo, sequencia, pra_onde,
  paletizada, qtd_ganchos, qtd_entregas, observacoes, status_atual,
  aguardando_carga, criado_em, atualizado_em, operador_id, operador_nome,
  operador_setor, versao`;
