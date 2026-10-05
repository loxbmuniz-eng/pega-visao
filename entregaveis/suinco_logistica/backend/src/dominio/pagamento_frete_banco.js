/* =====================================================================
   PAGAMENTO DE FRETE — o que entra e sai do banco (05/10/2026)
   ---------------------------------------------------------------------
   As regras estão em pagamento_frete.js e a grade em planilha_frete_grade.js;
   aqui só se lê e se grava. Toda função recebe o cliente (`cx`): o `pool`
   para leitura, o cliente da transação para escrita.

   O QUE UMA CONFERÊNCIA GRAVA (gravarConferencia):
     · a carga: contagens novas, data da conferência; o que a pessoa já tinha
       preenchido (transportadora, CT-e, observação) NÃO é tocado;
     · as pendências, uma a uma:
         – continua pendente → atualiza o que o B2B diz, MANTÉM a tratativa;
         – apareceu agora    → entra, "visto em" hoje;
         – deixou de ser pendência (virou Finalizado, ou sumiu dos dois
           relatórios) → fica `resolvida_em`: sai da fila, continua no
           histórico, e a tratativa que alguém deu fica guardada;
         – voltou a ser pendência depois de resolvida → reabre.
     Reimportar o mesmo par de PDFs não muda nada além da data da conferência
     (idempotente) — o erro mais provável que existe.
   ===================================================================== */
import { rotuloDaPendencia } from './pagamento_frete.js';

const DATA = (col, alias) => `to_char(${col}, 'YYYY-MM-DD') AS ${alias}`;

/* Todas as cargas, no formato que `montarGrade` e `indicadoresDaCarga`
   esperam. `numero` restringe a uma carga; `desde` ('AAAA-MM-DD') corta pela
   data da conferência. */
export async function lerCargas(cx, { numero = null, desde = null } = {}) {
  const filtro = [];
  const par = [];
  if (numero) { par.push(numero); filtro.push(`numero_carga = $${par.length}`); }
  if (desde) { par.push(desde); filtro.push(`data_consulta >= $${par.length}`); }
  const onde = filtro.length ? `WHERE ${filtro.join(' AND ')}` : '';

  const { rows: cargas } = await cx.query(
    `SELECT numero_carga, ${DATA('data_consulta', 'data_consulta')}, qtd_sist, qtd_b2b, finalizadas, aguardando,
            nao_entregue, outros, transportadora, cte, obs
       FROM pgfrete_cargas ${onde} ORDER BY data_consulta, numero_carga`, par);
  if (!cargas.length) return [];
  const numeros = cargas.map((c) => c.numero_carga);

  const { rows: pend } = await cx.query(
    `SELECT numero_carga, nota, categoria, status_b2b, cliente, cidade, tratativa, ${DATA('tratativa_em', 'tratativa_em')},
            ${DATA('visto_em', 'visto_em')}, obs
       FROM pgfrete_pendencias WHERE resolvida_em IS NULL AND numero_carga = ANY($1::text[])
      ORDER BY numero_carga, nota::bigint`, [numeros]);
  const { rows: pag } = await cx.query(
    `SELECT numero_carga, sum(pct) AS pct, ${DATA('max(data_pagamento)', 'ultima')}
       FROM pgfrete_pagamentos WHERE anulado_em IS NULL AND numero_carga = ANY($1::text[]) GROUP BY numero_carga`, [numeros]);

  const pendDe = new Map();
  for (const p of pend) {
    if (!pendDe.has(p.numero_carga)) pendDe.set(p.numero_carga, []);
    pendDe.get(p.numero_carga).push({
      nota: p.nota, categoria: p.categoria, statusB2b: p.status_b2b, cliente: p.cliente, cidade: p.cidade,
      tratativa: p.tratativa, tratativaEm: p.tratativa_em, vistoEm: p.visto_em, obs: p.obs,
    });
  }
  const pagoDe = new Map(pag.map((p) => [p.numero_carga, p]));

  return cargas.map((c) => {
    const pg = pagoDe.get(c.numero_carga);
    return {
      numero: c.numero_carga, dataConsulta: c.data_consulta, qtdSist: c.qtd_sist, qtdB2b: c.qtd_b2b,
      finalizadas: c.finalizadas, aguardando: c.aguardando, naoEntregue: c.nao_entregue, outros: c.outros,
      transportadora: c.transportadora, cte: c.cte, obs: c.obs,
      pctPago: pg ? Math.min(100, Number(pg.pct)) : 0, dataPagamento: pg?.ultima ?? null,
      pendencias: pendDe.get(c.numero_carga) ?? [],
    };
  });
}

/* A trilha de auditoria: quem mexeu em quê. Nunca falha em silêncio — se não
   gravar, a transação inteira cai (o evento faz parte do ato). */
export function registrarEvento(cx, { numero = null, nota = null, acao, detalhe = {}, operador }) {
  return cx.query(
    `INSERT INTO pgfrete_eventos (numero_carga, nota, acao, detalhe, por_id, por_nome) VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
    [numero, nota, acao, JSON.stringify(detalhe), String(operador?.id ?? ''), String(operador?.nome ?? '')],
  );
}

/* O que a conferência MUDARIA numa carga que já existe — a prévia mostra isto
   antes de a pessoa confirmar. */
export async function compararComExistente(cx, numero, pendenciasNovas) {
  const { rows: c } = await cx.query(`SELECT ${DATA('data_consulta', 'data_consulta')} FROM pgfrete_cargas WHERE numero_carga = $1`, [numero]);
  if (!c[0]) return null;
  const { rows: abertas } = await cx.query(
    'SELECT nota FROM pgfrete_pendencias WHERE numero_carga = $1 AND resolvida_em IS NULL', [numero]);
  const { rows: pg } = await cx.query(
    'SELECT coalesce(sum(pct), 0) AS pct FROM pgfrete_pagamentos WHERE numero_carga = $1 AND anulado_em IS NULL', [numero]);
  const antes = new Set(abertas.map((r) => r.nota));
  const agora = new Set(pendenciasNovas.map((p) => p.nota));
  return {
    dataConsulta: c[0].data_consulta,
    novas: [...agora].filter((n) => !antes.has(n)).length,
    resolvidas: [...antes].filter((n) => !agora.has(n)).length,
    pctPago: Number(pg[0].pct),
  };
}

/* `conf` é o resultado de `conferirCarga`. Devolve o que mudou. */
export async function gravarConferencia(cx, { numero, conf, hoje, operador }) {
  const nome = String(operador?.nome ?? '');
  const { rows: ja } = await cx.query('SELECT 1 FROM pgfrete_cargas WHERE numero_carga = $1 FOR UPDATE', [numero]);
  if (ja[0]) {
    await cx.query(
      `UPDATE pgfrete_cargas SET data_consulta = $2, qtd_sist = $3, qtd_b2b = $4, finalizadas = $5, aguardando = $6,
              nao_entregue = $7, outros = $8, atualizado_em = now(), atualizado_por = $9
        WHERE numero_carga = $1`,
      [numero, hoje, conf.qtdSist, conf.qtdB2b, conf.finalizadas, conf.aguardando, conf.naoEntregue, conf.outros, nome]);
  } else {
    await cx.query(
      `INSERT INTO pgfrete_cargas (numero_carga, primeira_consulta, data_consulta, qtd_sist, qtd_b2b, finalizadas,
                                   aguardando, nao_entregue, outros, atualizado_por)
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [numero, hoje, conf.qtdSist, conf.qtdB2b, conf.finalizadas, conf.aguardando, conf.naoEntregue, conf.outros, nome]);
  }

  const { rows: existentes } = await cx.query(
    `SELECT nota, resolvida_em IS NOT NULL AS resolvida FROM pgfrete_pendencias WHERE numero_carga = $1 FOR UPDATE`, [numero]);
  const conhecidas = new Map(existentes.map((e) => [e.nota, e.resolvida]));
  const agora = new Set();
  let novas = 0; let reabertas = 0;
  for (const p of conf.pendencias) {
    agora.add(p.nota);
    if (conhecidas.has(p.nota)) {
      if (conhecidas.get(p.nota)) reabertas += 1;
      await cx.query(
        `UPDATE pgfrete_pendencias SET categoria = $3, status_b2b = $4, cliente = $5, cidade = $6, resolvida_em = NULL
          WHERE numero_carga = $1 AND nota = $2`,
        [numero, p.nota, p.categoria, p.statusB2b || '', p.cliente || '', p.cidade || '']);
    } else {
      novas += 1;
      await cx.query(
        `INSERT INTO pgfrete_pendencias (numero_carga, nota, categoria, status_b2b, cliente, cidade, visto_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [numero, p.nota, p.categoria, p.statusB2b || '', p.cliente || '', p.cidade || '', hoje]);
    }
  }
  const { rowCount: resolvidas } = await cx.query(
    `UPDATE pgfrete_pendencias SET resolvida_em = $2
      WHERE numero_carga = $1 AND resolvida_em IS NULL AND NOT (nota = ANY($3::text[]))`,
    [numero, hoje, [...agora]]);

  await registrarEvento(cx, {
    numero, acao: 'conferencia', operador,
    detalhe: {
      situacao: conf.situacao, qtdSist: conf.qtdSist, qtdB2b: conf.qtdB2b, finalizadas: conf.finalizadas,
      pendencias: conf.pendencias.length, novas, resolvidas, reabertas, nova: !ja[0],
    },
  });
  return { nova: !ja[0], novas, resolvidas, reabertas };
}

/* Para a prévia: a lista de pendências em texto da planilha ("173556 (Aguardando)"). */
export const rotuloDaLinha = (p) => `${p.nota} (${rotuloDaPendencia(p)})`;
