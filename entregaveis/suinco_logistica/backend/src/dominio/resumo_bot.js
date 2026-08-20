/* O RESUMO QUE VAI PARA O GRUPO DO WHATSAPP.
   =====================================================================

   Pedido do gestor (20/08/2026): o painel passa a mandar sozinho, de 3 em
   3 horas, o andamento do carregamento no grupo "Alinhamento Carregamento".
   Quem lê está no pátio, no celular, com uma mão só — então este texto é
   feito para ser entendido em UM relance, sem abrir anexo nenhum. O PDF do
   Relatório Operacional vai junto, para quem quiser o detalhe linha a linha.

   Por que o texto nasce AQUI, no servidor, e não no n8n: o n8n é o carteiro,
   não o autor. Regra de negócio dentro de nó de automação é regra que
   ninguém revisa, ninguém testa e some quando alguém arrasta um bloco na
   tela. Aqui ela tem teste, tem histórico no git e é a mesma para qualquer
   canal que a gente ligue depois (e-mail, Telegram, o que vier).

   FUSO: tudo é comparado em America/Sao_Paulo, nunca em UTC. Às 21h de
   Brasília o UTC já virou o dia seguinte — sem isso, o resumo das 21h
   mostraria o dia de amanhã, vazio. */

import { consultar } from '../banco.js';
import { STATUS_FLOW } from './fluxo.js';

const FUSO = 'America/Sao_Paulo';

/* O dia local, como texto ISO e como rótulo para humano. */
export function diaLocal(agora = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
  const rotulo = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit',
  }).format(agora);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, hour: '2-digit', minute: '2-digit',
  }).format(agora);
  return { iso, rotulo, hora };
}

/* Ícone por etapa. Não é enfeite: no WhatsApp a lista sai sem cor nenhuma,
   e o ícone é o que permite achar a linha certa sem ler as seis. */
const ICONE_STATUS = {
  'Aguardando Veículo': '⏳',
  'Aguardando Embarque': '🚧',
  'Embarque Iniciado': '🔧',
  'Embarque Finalizado': '📦',
  'Faturado': '🧾',
  'Seguiu Viagem': '✅',
};

function num(v) { return Number(v || 0); }

function kg(valor) {
  return num(valor).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function toneladas(valorKg) {
  return (num(valorKg) / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
}

function horasDesde(instante, agora) {
  if (!instante) return null;
  return Math.floor((agora.getTime() - new Date(instante).getTime()) / 3_600_000);
}

/* ---------------------------------------------------------------------
   Os números do dia, direto do banco.
   --------------------------------------------------------------------- */
export async function coletarResumo(agora = new Date()) {
  const dia = diaLocal(agora);

  /* A MESMA definição de "carga do dia" que o painel usa no relatório:
     pela data de PROGRAMAÇÃO, não pela data em que o caminhão entrou
     (19/08/2026 — ver o comentário em dominio/cargas.js, paraPainel).
     Entrada sem carga lançada fica de fora: ainda não é carga. */
  const { rows: cargas } = await consultar(
    `SELECT status_atual, peso_kg, numero_carga, placa, atualizado_em
       FROM fact_viagens
      WHERE excluida_em IS NULL
        AND aguardando_carga = FALSE
        AND (COALESCE(programado_em, criado_em) AT TIME ZONE $1)::date
            = (now() AT TIME ZONE $1)::date`,
    [FUSO]
  );

  /* O que ficou para trás: carga de programação anterior que ainda não
     seguiu viagem. É a caixa "Programação anterior" da Torre, no texto. */
  const { rows: [antigas] } = await consultar(
    `SELECT count(*)::int AS n
       FROM fact_viagens
      WHERE excluida_em IS NULL
        AND aguardando_carga = FALSE
        AND status_atual <> 'Seguiu Viagem'
        AND (COALESCE(programado_em, criado_em) AT TIME ZONE $1)::date
            < (now() AT TIME ZONE $1)::date`,
    [FUSO]
  );

  const { rows: [entradas] } = await consultar(
    `SELECT count(*)::int AS n
       FROM fact_viagens
      WHERE excluida_em IS NULL AND aguardando_carga = TRUE
        AND status_atual <> 'Seguiu Viagem'`
  );

  /* A carga parada há mais tempo entre TODAS as em aberto — inclusive as
     de programação anterior, que são justamente as mais esquecidas. */
  const { rows: [parada] } = await consultar(
    `SELECT numero_carga, placa, status_atual, atualizado_em
       FROM fact_viagens
      WHERE excluida_em IS NULL
        AND aguardando_carga = FALSE
        AND status_atual NOT IN ('Seguiu Viagem', 'Aguardando Veículo')
      ORDER BY atualizado_em ASC
      LIMIT 1`
  );

  const { rows: [dev] } = await consultar(
    `SELECT count(DISTINCT d.devolucao_id)::int      AS checklists,
            count(i.item_id)::int                    AS itens,
            COALESCE(sum(i.cx), 0)::numeric          AS caixas,
            COALESCE(sum(i.peso), 0)::numeric        AS peso,
            count(DISTINCT d.devolucao_id) FILTER (WHERE d.tipo = 'SOBRA')::int AS sobras
       FROM devolucoes d
       LEFT JOIN devolucao_itens i ON i.devolucao_id = d.devolucao_id
      WHERE d.excluida_em IS NULL AND d.data_dev = ($1)::date`,
    [dia.iso]
  );

  const porStatus = {};
  STATUS_FLOW.forEach((s) => { porStatus[s] = 0; });
  let pesoTotalKg = 0;
  cargas.forEach((c) => {
    if (porStatus[c.status_atual] === undefined) porStatus[c.status_atual] = 0;
    porStatus[c.status_atual] += 1;
    pesoTotalKg += num(c.peso_kg);
  });

  return {
    dia: dia.iso,
    diaRotulo: dia.rotulo,
    hora: dia.hora,
    geradoEm: agora.toISOString(),
    cargas: {
      total: cargas.length,
      porStatus,
      concluidas: porStatus['Seguiu Viagem'] || 0,
      pesoTotalKg,
    },
    pendencias: {
      programacaoAnterior: num(antigas?.n),
      entradasSemCarga: num(entradas?.n),
      paradaMaisAntiga: parada
        ? {
            numeroCarga: parada.numero_carga || '',
            placa: parada.placa || '',
            status: parada.status_atual,
            horas: horasDesde(parada.atualizado_em, agora),
          }
        : null,
    },
    devolucoes: {
      checklists: num(dev?.checklists),
      itens: num(dev?.itens),
      caixas: num(dev?.caixas),
      pesoKg: num(dev?.peso),
      sobras: num(dev?.sobras),
    },
  };
}

/* ---------------------------------------------------------------------
   Os números viram a mensagem.

   Formatação do WhatsApp: *negrito*. Nada de tabela, nada de coluna — no
   celular qualquer alinhamento por espaço quebra. Linhas curtas, uma
   informação por linha.
   --------------------------------------------------------------------- */
export function montarTexto(r) {
  const L = [];
  L.push('🚚 *SUINCO — CARREGAMENTO*');
  L.push(`${r.diaRotulo} · ${r.hora}`);
  L.push('');

  if (r.cargas.total === 0) {
    L.push('*Nenhuma carga programada para hoje ainda.*');
  } else {
    L.push(`*Programação de hoje: ${r.cargas.total} carga(s)*`);
    /* Do fim do fluxo para o começo: o que já saiu vem primeiro porque é a
       primeira pergunta de quem abre o grupo ("quanto já foi embora?"). */
    [...STATUS_FLOW].reverse().forEach((s) => {
      const n = r.cargas.porStatus[s] || 0;
      if (n > 0) L.push(`${ICONE_STATUS[s] || '•'} ${s}: *${n}*`);
    });
    if (r.cargas.pesoTotalKg > 0) {
      L.push('');
      L.push(`⚖️ Peso programado: ${toneladas(r.cargas.pesoTotalKg)} t`);
    }
  }

  const alertas = [];
  if (r.pendencias.programacaoAnterior > 0) {
    alertas.push(`${r.pendencias.programacaoAnterior} carga(s) de programação anterior ainda em aberto`);
  }
  if (r.pendencias.entradasSemCarga > 0) {
    alertas.push(`${r.pendencias.entradasSemCarga} caminhão(ões) no pátio sem carga lançada`);
  }
  /* Só vira alerta a partir de 3h parado. Abaixo disso é o tempo normal de
     um embarque e o aviso viraria ruído — aviso que aparece sempre deixa
     de ser lido. */
  const p = r.pendencias.paradaMaisAntiga;
  if (p && p.horas >= 3) {
    const nome = [p.numeroCarga, p.placa].filter(Boolean).join(' · ') || 'sem identificação';
    alertas.push(`parada há ${p.horas}h: ${nome} (${p.status})`);
  }
  if (alertas.length) {
    L.push('');
    L.push('⚠️ *Atenção*');
    alertas.forEach((a) => L.push(`• ${a}`));
  }

  if (r.devolucoes.checklists > 0) {
    L.push('');
    const partes = [`${r.devolucoes.checklists} checklist(s)`, `${r.devolucoes.itens} nota(s)`];
    if (r.devolucoes.pesoKg > 0) partes.push(`${kg(r.devolucoes.pesoKg)} kg`);
    if (r.devolucoes.sobras > 0) partes.push(`${r.devolucoes.sobras} sobra(s)`);
    L.push(`↩️ *Devoluções de hoje:* ${partes.join(' · ')}`);
  }

  L.push('');
  L.push('_Relatório Operacional completo em anexo._');
  return L.join('\n');
}

export async function resumoDoDia(agora = new Date()) {
  const r = await coletarResumo(agora);
  return { ...r, texto: montarTexto(r) };
}
