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
  /* Carga EXCLUÍDA (migração 062) sai da aba, da planilha e do PDF; continua
     no banco e no histórico. Sem a 062 não há excluída: a leitura de reserva
     (abaixo) roda sem este filtro. */
  const onde = `WHERE ${[...filtro, 'excluida_em IS NULL'].join(' AND ')}`;
  const ondeSemExcluida = filtro.length ? `WHERE ${filtro.join(' AND ')}` : '';

  /* O canhoto original (migração 059) é lido junto; num servidor que já tem a
     058 e ainda não a 059 (ou a 062), a leitura cai para a lista sem ele — a
     aba não pode parar por uma coluna de acompanhamento. */
  let cargas;
  try {
    ({ rows: cargas } = await cx.query(
      `SELECT numero_carga, ${DATA('data_consulta', 'data_consulta')}, qtd_sist, qtd_b2b, finalizadas, aguardando,
              nao_entregue, outros, transportadora, cte, obs, canhoto_original, canhoto_em, canhoto_por
         FROM pgfrete_cargas ${onde} ORDER BY data_consulta, numero_carga`, par));
  } catch (e) {
    if (e.code !== '42703') throw e;
    ({ rows: cargas } = await cx.query(
      `SELECT numero_carga, ${DATA('data_consulta', 'data_consulta')}, qtd_sist, qtd_b2b, finalizadas, aguardando,
              nao_entregue, outros, transportadora, cte, obs, FALSE AS canhoto_original, NULL AS canhoto_em, '' AS canhoto_por
         FROM pgfrete_cargas ${ondeSemExcluida} ORDER BY data_consulta, numero_carga`, par));
  }
  if (!cargas.length) return [];
  const numeros = cargas.map((c) => c.numero_carga);

  const { rows: pend } = await cx.query(
    /* Transportadora e CT-E da NOTA (migração 063) são lidos pela linha em
       JSON: num banco sem a 063 eles só vêm vazios (= os da carga). */
    `SELECT numero_carga, nota, categoria, status_b2b, cliente, cidade, tratativa, ${DATA('tratativa_em', 'tratativa_em')},
            ${DATA('visto_em', 'visto_em')}, obs,
            coalesce(to_jsonb(p) ->> 'transportadora', '') AS transportadora, coalesce(to_jsonb(p) ->> 'cte', '') AS cte
       FROM pgfrete_pendencias p WHERE resolvida_em IS NULL AND numero_carga = ANY($1::text[])
      ORDER BY numero_carga, nota::bigint`, [numeros]);
  /* O pagamento de cada NOTA (migração 063): o válido, com a data. */
  const { rows: pagNota } = await cx.query(
    `SELECT numero_carga, to_jsonb(g) ->> 'nota' AS nota, id, ${DATA('data_pagamento', 'data')}
       FROM pgfrete_pagamentos g WHERE anulado_em IS NULL AND numero_carga = ANY($1::text[]) AND to_jsonb(g) ->> 'nota' IS NOT NULL`, [numeros]);
  const pagoDaNota = new Map(pagNota.map((r) => [`${r.numero_carga}|${r.nota}`, { id: Number(r.id), data: r.data }]));
  const { rows: pag } = await cx.query(
    `SELECT numero_carga, sum(pct) AS pct, ${DATA('max(data_pagamento)', 'ultima')},
            ${DATA("max(data_pagamento) FILTER (WHERE to_jsonb(g) ->> 'nota' IS NULL)", 'ultima_carga')}
       FROM pgfrete_pagamentos g WHERE anulado_em IS NULL AND numero_carga = ANY($1::text[]) GROUP BY numero_carga`, [numeros]);

  const pendDe = new Map();
  for (const p of pend) {
    if (!pendDe.has(p.numero_carga)) pendDe.set(p.numero_carga, []);
    pendDe.get(p.numero_carga).push({
      nota: p.nota, categoria: p.categoria, statusB2b: p.status_b2b, cliente: p.cliente, cidade: p.cidade,
      tratativa: p.tratativa, tratativaEm: p.tratativa_em, vistoEm: p.visto_em, obs: p.obs,
      transportadora: p.transportadora, cte: p.cte, pagamento: pagoDaNota.get(`${p.numero_carga}|${p.nota}`) ?? null,
    });
  }
  const pagoDe = new Map(pag.map((p) => [p.numero_carga, p]));
  /* Cada lançamento válido, para o Fechamento (por mês do pagamento). */
  const { rows: lanc } = await cx.query(
    `SELECT numero_carga, pct, ${DATA('data_pagamento', 'data')} FROM pgfrete_pagamentos
      WHERE anulado_em IS NULL AND numero_carga = ANY($1::text[]) ORDER BY id`, [numeros]);
  const lancDe = new Map();
  for (const l of lanc) {
    if (!lancDe.has(l.numero_carga)) lancDe.set(l.numero_carga, []);
    lancDe.get(l.numero_carga).push({ pct: Number(l.pct), data: l.data });
  }

  return cargas.map((c) => {
    const pg = pagoDe.get(c.numero_carga);
    return {
      numero: c.numero_carga, dataConsulta: c.data_consulta, qtdSist: c.qtd_sist, qtdB2b: c.qtd_b2b,
      finalizadas: c.finalizadas, aguardando: c.aguardando, naoEntregue: c.nao_entregue, outros: c.outros,
      transportadora: c.transportadora, cte: c.cte, obs: c.obs,
      canhotoOriginal: c.canhoto_original === true, canhotoEm: c.canhoto_em ? new Date(c.canhoto_em).toISOString() : null,
      canhotoPor: c.canhoto_por || '',
      pctPago: pg ? Math.min(100, Number(pg.pct)) : 0, dataPagamento: pg?.ultima ?? null,
      /* A data do último pagamento DA CARGA (sem os pagamentos de nota) — é a
         que o campo "Data do pagamento" da carga edita. */
      dataPagamentoCarga: pg?.ultima_carga ?? null,
      pagamentos: lancDe.get(c.numero_carga) ?? [],
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
  const excluida = await excluidaDe(cx, numero);
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
    /* A prévia avisa: confirmar traz de volta uma carga que alguém excluiu. */
    excluida,
  };
}

/* Se a carga está EXCLUÍDA: { em, por, motivo } — senão null. Lê pela linha
   inteira em JSON, e não pela coluna, de propósito: roda dentro de transação,
   e num banco sem a 062 uma coluna ausente abortaria a transação inteira
   (no Postgres, erro dentro da transação não se "pega" e segue). */
export async function excluidaDe(cx, numero) {
  const { rows } = await cx.query('SELECT to_jsonb(c) AS j FROM pgfrete_cargas c WHERE numero_carga = $1', [numero]);
  const j = rows[0]?.j;
  if (!j || !j.excluida_em) return null;
  return { em: new Date(j.excluida_em).toISOString(), por: j.excluida_por || '', motivo: j.excluida_motivo || '' };
}

/* `conf` é o resultado de `conferirCarga`. Devolve o que mudou. */
export async function gravarConferencia(cx, { numero, conf, hoje, operador }) {
  const nome = String(operador?.nome ?? '');
  /* Reimportar uma carga EXCLUÍDA a traz de volta (decisão do dono, 06/10): o
     PDF novo é a prova de que ela continua sendo assunto. A prévia já avisou;
     o histórico guarda de quem era a exclusão desfeita. */
  const excluida = await excluidaDe(cx, numero);
  if (excluida) {
    await cx.query(
      `UPDATE pgfrete_cargas SET excluida_em = NULL, excluida_por = '', excluida_motivo = '' WHERE numero_carga = $1`, [numero]);
    await registrarEvento(cx, { numero, acao: 'restaurou', operador, detalhe: { pela: 'reimportacao', exclusao: excluida } });
  }
  const { rows: ja } = await cx.query(
    'SELECT qtd_sist, qtd_b2b, finalizadas, aguardando, nao_entregue, outros FROM pgfrete_cargas WHERE numero_carga = $1 FOR UPDATE', [numero]);
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
      /* Reimportação deixa trilha do que a carga dizia ANTES (governança, 05/10). */
      antes: ja[0] ? { qtdSist: ja[0].qtd_sist, qtdB2b: ja[0].qtd_b2b, finalizadas: ja[0].finalizadas, aguardando: ja[0].aguardando, naoEntregue: ja[0].nao_entregue, outros: ja[0].outros } : null,
    },
  });
  return { nova: !ja[0], novas, resolvidas, reabertas, restaurada: !!excluida };
}

/* Para a prévia: a lista de pendências em texto da planilha ("173556 (Aguardando)"). */
export const rotuloDaLinha = (p) => `${p.nota} (${rotuloDaPendencia(p)})`;
