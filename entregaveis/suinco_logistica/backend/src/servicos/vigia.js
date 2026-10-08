/* OS VIGIAS — o que confere, onde anota, quando avisa
   ---------------------------------------------------------------------
   Pedido do dono (02/10/2026): "no raio-X, tudo que fala 'se quebrar', você
   vai criar uma prevenção de quebra pra cada possibilidade apontada".

   Este arquivo é o miolo que DOIS chamadores usam (regra da casa: uma
   função, dois chamadores):
     · scripts/vigia_servidor.mjs — roda no cron do servidor, confere,
       anota e avisa no celular da Administração;
     · rotas/vigia.js — a caixa "Vigias do sistema" na aba Usuários lê o
       que foi anotado e roda a conferência do dado na hora.

   QUANDO AVISA: na VIRADA. Ficou ruim → aviso. Voltou ao normal → aviso.
   Continuou ruim → silêncio (a caixa na tela continua mostrando, com o
   "desde quando"). Aviso repetido a cada minuto é o que ensina a ignorar
   todos — e aí o aviso que importa passa batido. */

/* ---------------------------------------------------------------------
   A CONFERÊNCIA DO DADO (P3 — frente F3, "o dano é silencioso")
   ---------------------------------------------------------------------
   Os 509 testes provam o CÓDIGO. Nenhum deles olha o dado que já está
   gravado. Aqui entram SÓ estados que o próprio servidor garante que não
   existem — então todo achado é inconsistência de verdade, nunca "um jeito
   diferente de trabalhar". Regra que acusa o que é legítimo vira barulho.

   Ficou DE FORA, de propósito: "status atual diferente do último registro
   do histórico". Parece uma ótima regra, e daria alarme falso: restaurar
   uma revisão da carga (rotas/cargas.js) devolve o status sem gravar
   movimentação. A mesma placa em duas cargas abertas também ficou de fora:
   é o caminhão que leva duas cargas, e isso é permitido ("1 de 2").

   Janela de 30 dias: é o que a operação enxerga e corrige. O que veio de
   antes da entrada em produção (07/08) não tem como ser consertado por
   ninguém hoje, e não pode ficar gritando para sempre.

   SÓ LEITURA. Nenhuma consulta aqui altera nada. */
import { FUSO } from '../dominio/fuso.js';
import { config } from '../config.js';

const JANELA = "now() - interval '30 days'";

export const REGRAS_DO_DADO = [
  {
    codigo: 'saida_sem_registro',
    titulo: 'Carga que seguiu viagem sem o registro da saída',
    explicacao: 'O status diz "Seguiu Viagem", mas o histórico não tem a saída. '
      + 'O tempo de pátio e os indicadores dessa carga ficam sem a hora em que ela saiu.',
    sql: `
      SELECT v.numero_carga, v.placa, ''::text AS detalhe, v.criado_em AS quando
        FROM fact_viagens v
       WHERE v.excluida_em IS NULL
         AND v.status_atual = 'Seguiu Viagem'
         AND v.criado_em > ${JANELA}
         AND NOT EXISTS (
               SELECT 1 FROM fact_statusfrota m
                WHERE m.carga_id = v.carga_id AND m.apagada_em IS NULL
                  AND m.status_novo = 'Seguiu Viagem')
       ORDER BY v.criado_em DESC`,
  },
  {
    codigo: 'saida_antes_da_chegada',
    titulo: 'Saída registrada antes da chegada',
    explicacao: 'O caminhão aparece saindo antes de ter entrado. Quase sempre é uma hora '
      + 'corrigida à mão no lugar errado — o tempo de pátio dessa carga sai negativo.',
    sql: `
      SELECT v.numero_carga, v.placa,
             'entrou ' || to_char(c.em AT TIME ZONE '${FUSO}', 'DD/MM HH24:MI')
             || ', saiu ' || to_char(s.em AT TIME ZONE '${FUSO}', 'DD/MM HH24:MI') AS detalhe,
             v.criado_em AS quando
        FROM fact_viagens v
        JOIN LATERAL (SELECT max(data_evento) AS em FROM fact_statusfrota
                       WHERE carga_id = v.carga_id AND apagada_em IS NULL
                         AND status_novo = 'Seguiu Viagem') s ON s.em IS NOT NULL
        JOIN LATERAL (SELECT max(data_evento) AS em FROM fact_statusfrota
                       WHERE carga_id = v.carga_id AND apagada_em IS NULL
                         AND status_novo = 'Aguardando Embarque') c ON c.em IS NOT NULL
       WHERE v.excluida_em IS NULL
         AND v.status_atual = 'Seguiu Viagem'
         AND v.criado_em > ${JANELA}
         AND s.em < c.em
       ORDER BY v.criado_em DESC`,
  },
  {
    codigo: 'evento_no_futuro',
    titulo: 'Movimentação com hora no futuro',
    explicacao: 'Um registro do histórico tem hora que ainda não chegou. Os indicadores '
      + 'contam esse caminhão num momento que não aconteceu.',
    sql: `
      SELECT v.numero_carga, m.placa,
             m.status_novo || ' em ' || to_char(m.data_evento AT TIME ZONE '${FUSO}', 'DD/MM HH24:MI') AS detalhe,
             v.criado_em AS quando
        FROM fact_statusfrota m
        JOIN fact_viagens v ON v.carga_id = m.carga_id
       WHERE m.apagada_em IS NULL
         AND v.excluida_em IS NULL
         AND m.data_evento > now() + interval '10 minutes'
       ORDER BY m.data_evento DESC`,
  },
  {
    /* 07/10/2026, skill auditoria-do-dado. A trava de Frota
       (PLACA_FORA_DA_FROTA, rotas/cargas.js) garante que carga PROGRAMADA
       nasce com placa da Frota; a chegada sem programação (aguardando_carga)
       pode ter qualquer placa e fica de fora. Se aparecer, alguém tirou a
       placa da Frota depois — e a carga some do indicador por
       transportadora — ou mexeu fora do painel. "Placa sem transportadora" e
       "nota de frete sem carga no painel" NÃO entram aqui: podem ser
       legítimas (frete anterior ao painel, outra filial) e virariam barulho
       no celular — vão para a caixa Pontos de atenção. */
    codigo: 'placa_fora_da_frota',
    titulo: 'Carga programada com placa que não está na Frota',
    explicacao: 'A Programação só aceita placa da Frota. Se a carga está assim, a placa saiu '
      + 'da Frota depois (ou foi mexida fora do painel) — e a carga some do indicador por transportadora.',
    sql: `
      SELECT v.numero_carga, v.placa, v.status_atual AS detalhe, v.criado_em AS quando
        FROM fact_viagens v
       WHERE v.excluida_em IS NULL
         AND NOT v.aguardando_carga
         AND v.placa <> ''
         AND v.criado_em > ${JANELA}
         AND NOT EXISTS (SELECT 1 FROM dim_veiculos f WHERE f.placa = v.placa)
       ORDER BY v.criado_em DESC`,
  },
];

const EXEMPLOS = 5;

/* INTEGRIDADE DO PAGAMENTO DE FRETE (governança, pedido do dono em 05/10/2026):
   "travas para impedir qualquer erro relacionado à qualidade dos dados". As
   regras do banco (chave única de carga e de pendência, pct ≤ 100 por
   lançamento) impedem a duplicata; estas pegam o que uma regra de linha não
   vê — a soma, a contagem que não fecha, a leitura que não foi consumida. */
export const REGRAS_DO_FRETE = [
  {
    codigo: 'frete_pago_acima_de_100',
    titulo: 'Carga de frete com mais de 100% pago',
    explicacao: 'A soma dos pagamentos válidos de uma carga passa de 100% — a rota recusa isso; se aconteceu, alguém mexeu fora do painel.',
    sql: `
      SELECT numero_carga, '' AS placa, 'pago ' || sum(pct) || '%' AS detalhe, min(criado_em) AS quando
        FROM pgfrete_pagamentos WHERE anulado_em IS NULL
       GROUP BY numero_carga HAVING sum(pct) > 100.005 ORDER BY numero_carga`,
  },
  {
    codigo: 'frete_contagens_nao_fecham',
    titulo: 'Carga de frete com contagens que não fecham',
    explicacao: 'Finalizadas + aguardando + não entregue + outros é diferente da quantidade do B2B — o relatório mudou de forma ou a leitura perdeu linha.',
    sql: `
      SELECT numero_carga, '' AS placa,
             finalizadas || '+' || aguardando || '+' || nao_entregue || '+' || outros || ' ≠ ' || qtd_b2b AS detalhe,
             criado_em AS quando
        FROM pgfrete_cargas WHERE finalizadas + aguardando + nao_entregue + outros <> qtd_b2b ORDER BY numero_carga`,
  },
  {
    codigo: 'frete_pendencia_em_carga_fechada',
    titulo: 'Carga de frete toda finalizada com pendência aberta',
    explicacao: 'Todas as notas do sistema estão finalizadas no B2B, mas ainda há pendência aberta: a reimportação não resolveu o que devia.',
    sql: `
      SELECT c.numero_carga, '' AS placa, count(p.nota) || ' pendência(s) aberta(s)' AS detalhe, min(c.criado_em) AS quando
        FROM pgfrete_cargas c JOIN pgfrete_pendencias p ON p.numero_carga = c.numero_carga AND p.resolvida_em IS NULL
       WHERE c.finalizadas >= c.qtd_sist AND c.qtd_b2b = c.qtd_sist
       GROUP BY c.numero_carga ORDER BY c.numero_carga`,
  },
  {
    codigo: 'frete_leitura_esquecida',
    titulo: 'Leitura de PDF de frete com mais de 1 dia sem confirmar',
    explicacao: 'Alguém importou e não confirmou; a leitura deveria ter sido apagada no dia seguinte.',
    sql: `
      SELECT numero_carga, '' AS placa, tipo || ' · ' || arquivo || ' · ' || to_char(criado_em AT TIME ZONE '${FUSO}', 'DD/MM HH24:MI') AS detalhe,
             criado_em AS quando
        FROM pgfrete_leituras WHERE criado_em < now() - interval '1 day' ORDER BY criado_em`,
  },
];

/* ---------------------------------------------------------------------
   OS PONTOS DE ATENÇÃO (07/10/2026) — a caixa única, só da Administração
   ---------------------------------------------------------------------
   Pedido do dono: "gostei dessa análise e dados inteligentes (...) isso gera
   um ecossistema de dados que gera indicadores e pontos de atenção" — e, ao
   aprovar, "a caixa de atenção deixa só pra administração".

   Estas duas regras NÃO entram na auditoria noturna: podem ser legítimas
   (frete de antes do painel, placa de terceiro ainda sem cadastro) e
   virariam alarme falso no celular. Na caixa elas aparecem como LEVES — para
   quem quer arrumar o cadastro, sem ninguém ser acordado por elas. */
export const REGRAS_DE_ATENCAO = [
  {
    codigo: 'placa_sem_transportadora',
    titulo: 'Carga com placa sem transportadora',
    explicacao: 'A placa é da Frota, mas nem a carga nem a Frota dizem de qual transportadora ela é. '
      + 'A carga fica fora do indicador por transportadora e do relatório de fretes por empresa.',
    sql: `
      SELECT v.numero_carga, v.placa, v.status_atual AS detalhe, v.criado_em AS quando
        FROM fact_viagens v
        JOIN dim_veiculos f ON f.placa = v.placa
       WHERE v.excluida_em IS NULL
         AND NOT v.aguardando_carga
         AND v.placa <> ''
         AND v.criado_em > ${JANELA}
         AND COALESCE(NULLIF(trim(v.transportadora), ''), NULLIF(trim(f.transportadora), '')) IS NULL
       ORDER BY v.criado_em DESC`,
  },
  {
    codigo: 'frete_sem_carga_no_painel',
    titulo: 'Carga do Pagamento de Frete que não existe no painel',
    explicacao: 'O número veio dos PDFs do B2B e do Atak, mas nenhuma carga do painel tem esse número. '
      + 'Pode ser frete de antes do painel ou de outra filial — ou o número foi digitado diferente na Programação.',
    sql: `
      SELECT p.numero_carga, '' AS placa, p.transportadora AS detalhe, p.criado_em AS quando
        FROM pgfrete_cargas p
       WHERE p.excluida_em IS NULL
         AND p.criado_em > ${JANELA}
         AND NOT EXISTS (SELECT 1 FROM fact_viagens v
                          WHERE v.numero_carga = p.numero_carga AND v.excluida_em IS NULL)
       ORDER BY p.criado_em DESC`,
  },
];

/* ONDE SE RESOLVE cada ponto — a aba do painel e o nome que a pessoa lê. */
export const ONDE_RESOLVER = {
  saida_sem_registro: { aba: 'historico', rotulo: 'Histórico — linha do tempo da carga' },
  saida_antes_da_chegada: { aba: 'historico', rotulo: 'Histórico — corrigir a hora da etapa' },
  evento_no_futuro: { aba: 'historico', rotulo: 'Histórico — corrigir a hora da etapa' },
  placa_fora_da_frota: { aba: 'cadastros', rotulo: 'Cadastros — Frota' },
  frete_pago_acima_de_100: { aba: 'frete', rotulo: 'Pagamento de Frete — histórico da carga' },
  frete_contagens_nao_fecham: { aba: 'frete', rotulo: 'Pagamento de Frete — reimportar os PDFs da carga' },
  frete_pendencia_em_carga_fechada: { aba: 'frete', rotulo: 'Pagamento de Frete — reimportar os PDFs da carga' },
  frete_leitura_esquecida: { aba: 'frete', rotulo: 'Pagamento de Frete — importar e confirmar' },
  placa_sem_transportadora: { aba: 'cadastros', rotulo: 'Cadastros — Frota (transportadora da placa)' },
  frete_sem_carga_no_painel: { aba: 'frete', rotulo: 'Pagamento de Frete — conferir o número da carga' },
};
const ONDE_SERVIDOR = { aba: 'usuarios', rotulo: 'Usuários — Vigias do sistema (o servidor)' };
const ORDEM_GRAVIDADE = { grave: 0, media: 1, leve: 2 };

/* Junta tudo numa lista só, por gravidade. GRAVE: vigia do servidor com
   problema e as regras do dado; MÉDIA: integridade do frete; LEVE: as de
   cima. Só leitura. Tabela que o servidor ainda não tem (migração faltando)
   pula a regra em vez de derrubar a caixa. */
export async function pontosDeAtencao(runner) {
  const pontos = [];
  let anotacoes = [];
  try {
    anotacoes = await lerAnotacoes(runner);
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }
  /* A senha da parte de gerenciar usuários (08/10/2026): enquanto não
     estiver gravada (ou estiver corrompida), a Administração vê aqui —
     o controle não depende de alguém lembrar de rodar o script. */
  if (config.senhaUsuarios.estado !== 'ligada') {
    const invalida = config.senhaUsuarios.estado === 'invalida';
    pontos.push({
      gravidade: 'media', codigo: 'senha_usuarios',
      titulo: invalida ? 'A senha da aba Usuários gravada no servidor não é válida'
        : 'A parte de gerenciar usuários está sem senha',
      explicacao: invalida
        ? 'Ninguém consegue abrir a parte de gerenciar usuários. Grave de novo no servidor: scripts/gravar_senha_usuarios.sh.'
        : 'Qualquer pessoa da Administração abre a lista de usuários sem senha. Grave no servidor: scripts/gravar_senha_usuarios.sh.',
      quantidade: 1, desde: null, onde: { aba: 'usuarios', rotulo: 'Servidor — scripts/gravar_senha_usuarios.sh' }, exemplos: [],
    });
  }
  for (const a of anotacoes) {
    if (a.ok) continue;
    pontos.push({
      gravidade: 'grave', codigo: `vigia_${a.verificacao}`, titulo: NOMES[a.verificacao] || a.verificacao,
      explicacao: a.detalhe || '', quantidade: 1, desde: a.problema_desde, onde: ONDE_SERVIDOR, exemplos: [],
    });
  }
  for (const [regras, gravidade] of [[REGRAS_DO_DADO, 'grave'], [REGRAS_DO_FRETE, 'media'], [REGRAS_DE_ATENCAO, 'leve']]) {
    for (const r of regras) {
      let rows;
      try {
        ({ rows } = await runner.query(r.sql));
      } catch (e) {
        if (e.code === '42P01' || e.code === '42703') continue; // tabela/coluna de migração que ainda não rodou
        throw e;
      }
      if (!rows.length) continue;
      const tempos = rows.map((x) => Date.parse(x.quando)).filter((t) => Number.isFinite(t));
      pontos.push({
        gravidade, codigo: r.codigo, titulo: r.titulo, explicacao: r.explicacao, quantidade: rows.length,
        desde: tempos.length ? new Date(Math.min(...tempos)).toISOString() : null,
        onde: ONDE_RESOLVER[r.codigo] || { aba: '', rotulo: '' },
        exemplos: rows.slice(0, EXEMPLOS).map((x) => ({ carga: x.numero_carga, placa: x.placa, detalhe: x.detalhe || '' })),
      });
    }
  }
  pontos.sort((a, b) => ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade] || b.quantidade - a.quantidade);
  return pontos;
}

export async function auditarDado(runner, regras = REGRAS_DO_DADO) {
  const achados = [];
  for (const r of regras) {
    const { rows } = await runner.query(r.sql);
    achados.push({
      codigo: r.codigo,
      titulo: r.titulo,
      explicacao: r.explicacao,
      quantidade: rows.length,
      exemplos: rows.slice(0, EXEMPLOS).map((x) => ({
        carga: x.numero_carga, placa: x.placa, detalhe: x.detalhe || '',
      })),
    });
  }
  return achados;
}

export function resumoDoDado(achados) {
  const com = achados.filter((a) => a.quantidade > 0);
  if (!com.length) return 'nenhuma inconsistência nos últimos 30 dias';
  return com.map((a) => `${a.quantidade} × ${a.titulo.toLowerCase()}`).join('; ');
}

/* ---------------------------------------------------------------------
   ANOTAR — e dizer se houve VIRADA
   ---------------------------------------------------------------------
   Devolve 'piorou', 'melhorou' ou null (continua igual). O primeiro
   registro de uma verificação que já nasce ruim conta como 'piorou'; o que
   já nasce bem não avisa nada (não há o que comemorar). */
export async function anotar(runner, verificacao, ok, detalhe) {
  const { rows } = await runner.query(
    'SELECT ok FROM vigia_registros WHERE verificacao = $1', [verificacao]);
  const antes = rows[0] ? rows[0].ok : null;
  await runner.query(
    `INSERT INTO vigia_registros (verificacao, ok, detalhe, conferido_em, problema_desde)
          VALUES ($1, $2, $3, now(), CASE WHEN $2 THEN NULL ELSE now() END)
     ON CONFLICT (verificacao) DO UPDATE
        SET ok = EXCLUDED.ok,
            detalhe = EXCLUDED.detalhe,
            conferido_em = now(),
            problema_desde = CASE
              WHEN EXCLUDED.ok THEN NULL
              ELSE COALESCE(vigia_registros.problema_desde, now()) END`,
    [verificacao, ok, String(detalhe || '').slice(0, 500)]
  );
  if (!ok && antes !== false) return 'piorou';
  if (ok && antes === false) return 'melhorou';
  return null;
}

export async function lerAnotacoes(runner) {
  const { rows } = await runner.query(
    `SELECT verificacao, ok, detalhe, conferido_em, problema_desde
       FROM vigia_registros ORDER BY verificacao`);
  return rows;
}

/* Os nomes que aparecem na tela e no aviso — num lugar só. */
export const NOMES = {
  travamento: 'Servidor respondendo',
  backup_de_hoje: 'Backup de hoje feito',
  backup_restaura: 'Backup restaura de verdade',
  disco: 'Espaço em disco',
  certificado: 'Certificado de segurança',
  bibliotecas: 'Falhas conhecidas nas bibliotecas',
  dado: 'Conferência do dado',
  frete: 'Pagamento de Frete: integridade',
};
