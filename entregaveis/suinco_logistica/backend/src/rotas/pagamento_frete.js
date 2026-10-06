/* =====================================================================
   PAGAMENTO DE FRETE — as rotas da aba (05/10/2026)
   ---------------------------------------------------------------------
   Fluxo, do ponto de vista de quem usa:
     1. escolhe os PDFs (o do B2B e o do Atak, de uma ou de várias cargas);
        cada arquivo é enviado e LIDO PELO SERVIDOR (POST /leituras);
     2. vê a PRÉVIA do que a conferência faria (GET /lotes/:lote/previa);
     3. confirma (POST /lotes/:lote/confirmar) — o servidor grava o que ELE
        leu; a tela não devolve dado nenhum para ser gravado;
     4. trabalha a planilha: tratativa por nota, pagamento por carga,
        transportadora/CT-e/observação, e exporta o XLSX.

   A TELA RECEBE A MESMA GRADE DO ARQUIVO (GET /pagamento-frete): as 22
   colunas da planilha, uma linha por pendência, e o resumo. Nada é calculado
   na tela — o servidor manda.

   TODA ROTA exige login E o setor Pagamento de Frete (ou Administração).
   Escrever é de quem entra; não há "só leitura" porque a aba inteira é do
   setor.

   SE O SERVIDOR AINDA NÃO TEM A MIGRAÇÃO 058 (painel novo no ar antes do
   `atualizar`), toda rota responde 503 FRETE_SEM_MIGRACAO com a explicação —
   nunca 500 genérico.
   ===================================================================== */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { SETOR_PAGAMENTO_FRETE } from '../dominio/fluxo.js';
import { hojeISO } from './modelo_semana.js';
import { lerPaginasDoPdf, ErroDeLeitura } from '../servicos/pdf_texto.js';
import { lerRelatorioDeFrete } from '../dominio/relatorios_frete_pdf.js';
import {
  conferirCarga, indicadoresDaCarga, rotuloDaPendencia, TRATATIVAS, TRATATIVAS_QUE_LIBERAM, normalizarTratativa,
  parearPeloNumeroDoSistema,
} from '../dominio/pagamento_frete.js';
import { montarGrade } from '../dominio/planilha_frete_grade.js';
import { montarPlanilhaDeFrete } from '../dominio/planilha_frete_export.js';
import {
  lerCargas, registrarEvento, gravarConferencia, compararComExistente, excluidaDe,
} from '../dominio/pagamento_frete_banco.js';

export const rotasPagamentoFrete = Router();

/* O MESMO MECANISMO DE TODOS OS SETORES: quem entra é o setor Pagamento de
   Frete — e a Administração, que `exigirSetor` deixa passar sempre. As pessoas
   são colocadas no setor na tela de Usuários que já existe. */
const ACESSO = [exigirLogin, exigirSetor(SETOR_PAGAMENTO_FRETE)];
const BASE = '/pagamento-frete';

/* Migração ausente → 503 explicado. Qualquer outro erro segue para o handler global. */
const rota = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      return res.status(503).json({
        erro: 'O servidor ainda não tem esta função. A Administração precisa rodar a atualização do servidor.',
        codigo: 'FRETE_SEM_MIGRACAO',
      });
    }
    if (e instanceof ErroDeLeitura || e.codigo === 'LEITOR_PDF_INDISPONIVEL') {
      return res.status(e.status ?? 422).json({ erro: e.message, codigo: e.codigo });
    }
    return next(e);
  }
};

/* ------------------------------------------------------------ validação */
const NUMERO = /^\d{1,12}$/;
const numeroValido = (v) => NUMERO.test(String(v ?? ''));
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
function dataValida(v) {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(a, me - 1, d));
  return a >= 2000 && a <= 2100 && x.getUTCFullYear() === a && x.getUTCMonth() === me - 1 && x.getUTCDate() === d;
}
const recusa = (res, status, codigo, erro, extra = {}) => res.status(status).json({ erro, codigo, ...extra });
/* Carga excluída não recebe edição, tratativa nem pagamento: primeiro se
   restaura (lista das excluídas) — senão o trabalho iria para uma linha que
   ninguém vê. */
const ERRO_EXCLUIDA = (ex) => [409, 'CARGA_EXCLUIDA',
  `Esta carga foi excluída do controle por ${ex.por || 'alguém'} (${ex.motivo}). Restaure-a em "Excluídas" para mexer nela.`];

/* ---------------------------------------------------------------- a grade */
rotasPagamentoFrete.get(BASE, ACESSO, rota(async (req, res) => {
  const desde = req.query.desde ? String(req.query.desde) : null;
  if (desde && !dataValida(desde)) return recusa(res, 400, 'DATA_INVALIDA', 'Use a data no formato AAAA-MM-DD.');
  const grade = montarGrade(await lerCargas({ query: consultar }, { desde }));
  res.set('Cache-Control', 'no-store');
  res.json({
    geradoEm: new Date().toISOString(),
    hoje: hojeISO(),
    /* O vocabulário das tratativas vem DAQUI: a tela monta a lista de escolha
       com ele em vez de repetir as palavras (uma regra, um lugar). */
    vocabulario: { tratativas: TRATATIVAS, liberam: TRATATIVAS_QUE_LIBERAM },
    colunas: grade.colunas.map(({ chave, t, tipo }) => ({ chave, t, tipo })),
    linhas: grade.linhas.map((l) => ({
      carga: l.carga, primeira: l.primeira, nota: l.nota, categoria: l.categoria, cliente: l.cliente, cidade: l.cidade,
      obsNota: l.obsNota, obsCarga: l.obsCarga, vistoEm: l.vistoEm, idadeDias: l.idadeDias, v: l.celulas.map((c) => c.v),
      notaTransportadora: l.notaTransportadora, notaCte: l.notaCte, notaPaga: l.notaPaga, tratativaLibera: l.tratativaLibera,
      cargaTransportadora: l.cargaTransportadora, cargaCte: l.cargaCte, cargaDataPagamento: l.cargaDataPagamento,
    })),
    resumo: grade.resumo,
  });
}));

/* ------------------------------------------------------------ o arquivo */
rotasPagamentoFrete.get(`${BASE}/exportar.xlsx`, ACESSO, rota(async (req, res) => {
  const todas = await lerCargas({ query: consultar });
  /* O ARQUIVO É O QUE ESTÁ NA TELA (decisão do dono, 05/10): a tela manda as
     cargas que ficaram depois do filtro e o texto do filtro; o arquivo sai só
     com elas, o RESUMO e o FECHAMENTO calculados sobre elas, e o texto no
     topo. Sem `cargas`, sai tudo. Carga pedida que não existe é ignorada —
     nunca inventada. */
  const pedidas = req.query.cargas ? new Set(String(req.query.cargas).split(',').map((s) => s.trim()).filter(numeroValido)) : null;
  const cargas = pedidas ? todas.filter((c) => pedidas.has(String(c.numero))) : todas;
  const filtros = texto(req.query.filtros, 200);
  const agora = new Date();
  const buf = montarPlanilhaDeFrete({ cargas, geradoEm: agora, filtros: pedidas ? (filtros || 'recorte da tela') : '', totalSemFiltro: todas.length });
  await registrarEvento({ query: consultar }, { acao: 'exportou', detalhe: { cargas: cargas.length, de: todas.length, filtros: pedidas ? filtros : '' }, operador: req.operador });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="Controle_Pagamento_Frete_${hojeISO()}.xlsx"`,
    'Cache-Control': 'no-store',
    'Content-Length': String(buf.length),
  });
  res.end(buf);
}));

/* ------------------------------------------------- importar: ler os PDFs */
let lendo = 0;
const MAX_LEITURAS_JUNTAS = 3; // pdfjs usa CPU: poucas por vez, para o pátio nunca sentir
const MAX_BASE64 = 8.5 * 1024 * 1024; // 6 MB de PDF em base64

rotasPagamentoFrete.post(`${BASE}/leituras`, ACESSO, rota(async (req, res) => {
  const bruto = String(req.body?.arquivo ?? '');
  const nomeArquivo = texto(req.body?.nome, 200);
  if (!bruto) return recusa(res, 400, 'SEM_ARQUIVO', 'Escolha o PDF do relatório (B2B ou Atak).');
  if (bruto.length > MAX_BASE64) return recusa(res, 413, 'ARQUIVO_GRANDE', 'O PDF passa de 6 MB — não é o relatório de uma carga.');
  if (lendo >= MAX_LEITURAS_JUNTAS) {
    return recusa(res, 429, 'LEITURA_OCUPADA', 'O servidor está lendo outros relatórios agora. Tente de novo em alguns segundos.');
  }

  let lote = String(req.body?.lote ?? '');
  if (lote && !/^[0-9a-f-]{36}$/.test(lote)) return recusa(res, 400, 'LOTE_INVALIDO', 'Lote inválido.');
  if (!lote) lote = randomUUID();
  const dono = await consultar('SELECT criado_por FROM pgfrete_leituras WHERE lote = $1 LIMIT 1', [lote]);
  if (dono.rows[0] && dono.rows[0].criado_por !== String(req.operador.id) && req.operador.setor !== 'Administração') {
    return recusa(res, 403, 'LOTE_DE_OUTRA_PESSOA', 'Este lote foi aberto por outra pessoa.');
  }

  lendo += 1;
  let relatorio;
  try {
    relatorio = lerRelatorioDeFrete(await lerPaginasDoPdf(Buffer.from(bruto, 'base64')));
  } finally {
    lendo -= 1;
  }

  await emTransacao(async (cx) => {
    await cx.query("DELETE FROM pgfrete_leituras WHERE criado_em < now() - interval '1 day'");
    for (const c of relatorio.cargas) {
      const conteudo = relatorio.tipo === 'B2B'
        ? { linhas: c.linhas, avisos: c.avisos, embarque: c.embarque, pesoTotal: c.pesoTotal, externa: c.externa ?? '', identificador: c.identificador ?? c.numero }
        : { notas: c.notas, avisos: c.avisos };
      await cx.query(
        `INSERT INTO pgfrete_leituras (lote, tipo, numero_carga, arquivo, conteudo, criado_por)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT (lote, tipo, numero_carga)
         DO UPDATE SET arquivo = EXCLUDED.arquivo, conteudo = EXCLUDED.conteudo, criado_em = now()`,
        [lote, relatorio.tipo, c.numero, nomeArquivo, JSON.stringify(conteudo), String(req.operador.id)]);
    }
  });
  res.json({
    lote, tipo: relatorio.tipo, arquivo: nomeArquivo,
    cargas: relatorio.cargas.map((c) => ({ numero: c.numero, notas: (c.linhas ?? c.notas).length, avisos: c.avisos })),
  });
}));

/* ------------------------------------------------ importar: a prévia */
async function lerLote(res, req, lote) {
  if (!/^[0-9a-f-]{36}$/.test(String(lote))) { recusa(res, 400, 'LOTE_INVALIDO', 'Lote inválido.'); return null; }
  const { rows } = await consultar(
    'SELECT tipo, numero_carga, arquivo, conteudo, criado_por FROM pgfrete_leituras WHERE lote = $1 ORDER BY numero_carga::bigint', [lote]);
  if (!rows.length) { recusa(res, 404, 'LOTE_VAZIO', 'Não há leitura guardada deste lote (já foi confirmado, ou passou de um dia).'); return null; }
  if (rows.some((r) => r.criado_por !== String(req.operador.id)) && req.operador.setor !== 'Administração') {
    recusa(res, 403, 'LOTE_DE_OUTRA_PESSOA', 'Este lote foi aberto por outra pessoa.'); return null;
  }
  const porCarga = new Map();
  for (const r of rows) {
    if (!porCarga.has(r.numero_carga)) porCarga.set(r.numero_carga, {});
    porCarga.get(r.numero_carga)[r.tipo] = r;
  }
  /* SEGUNDA REDE DE PAREAMENTO (ocorrência #112, 05/10/2026). O leitor já tira o
     número da carga do último trecho do campo do B2B ("103-001-118771" → 118771).
     Se mesmo assim um B2B sozinho não casar com nenhum Atak do lote, ele é
     pareado com o Atak sozinho cujo número é a "carga externa" dele ou o FINAL
     do número dele (5+ dígitos) — só se houver UM candidato — e a prévia diz
     isso em aviso. Nada é deduzido em silêncio. A regra é pura e testada em
     dominio/pagamento_frete.js (parearPeloNumeroDoSistema). */
  for (const { numB2b, numSist, aviso } of parearPeloNumeroDoSistema(
    [...porCarga].map(([numero, p]) => ({ numero, temB2b: !!p.B2B, temSist: !!p.SIST, externa: String(p.B2B?.conteudo?.externa ?? '') })),
  )) {
    const alvo = porCarga.get(numSist);
    alvo.B2B = porCarga.get(numB2b).B2B;
    alvo.pareamento = aviso;
    porCarga.delete(numB2b);
  }
  return porCarga;
}

const MAX_PENDENCIAS_NA_PREVIA = 300;

function conferenciaDoPar(par) {
  const conf = conferirCarga({ sist: par.SIST.conteudo.notas, b2b: par.B2B.conteudo.linhas });
  conf.avisos = [...(par.pareamento ? [par.pareamento] : []), ...(par.B2B.conteudo.avisos ?? []), ...(par.SIST.conteudo.avisos ?? []), ...conf.avisos];
  return conf;
}

rotasPagamentoFrete.get(`${BASE}/lotes/:lote/previa`, ACESSO, rota(async (req, res) => {
  const lote = await lerLote(res, req, req.params.lote);
  if (!lote) return undefined;
  const cargas = [];
  for (const [numero, par] of lote) {
    if (!par.B2B || !par.SIST) {
      cargas.push({
        numero, estado: par.B2B ? 'falta_sist' : 'falta_b2b',
        arquivoB2b: par.B2B?.arquivo ?? '', arquivoSist: par.SIST?.arquivo ?? '',
        aviso: par.B2B && numero.length > 8
          ? `O número lido no B2B (${numero}) tem mais de 8 dígitos — parece outro campo colado ao número da carga. Mande o PDF do Atak desta carga: o painel pareia pelo número do sistema.`
          : '',
      });
      continue;
    }
    const conf = conferenciaDoPar(par);
    const ind = indicadoresDaCarga({ ...conf, pendencias: conf.pendencias });
    cargas.push({
      numero, estado: 'pronta', arquivoB2b: par.B2B.arquivo, arquivoSist: par.SIST.arquivo,
      qtdSist: conf.qtdSist, qtdB2b: conf.qtdB2b, diferenca: conf.diferenca, finalizadas: conf.finalizadas,
      aguardando: conf.aguardando, naoEntregue: conf.naoEntregue, outros: conf.outros, situacao: conf.situacao,
      entregue: ind.entregue, nPendencias: conf.pendencias.length,
      pendencias: conf.pendencias.slice(0, MAX_PENDENCIAS_NA_PREVIA).map((p) => ({
        nota: p.nota, categoria: p.categoria, rotulo: rotuloDaPendencia(p), cliente: p.cliente,
      })),
      avisos: conf.avisos,
      existente: await compararComExistente({ query: consultar }, numero, conf.pendencias),
    });
  }
  res.json({ lote: req.params.lote, hoje: hojeISO(), cargas });
}));

/* -------------------------------------------- importar: confirmar */
rotasPagamentoFrete.post(`${BASE}/lotes/:lote/confirmar`, ACESSO, rota(async (req, res) => {
  const lote = await lerLote(res, req, req.params.lote);
  if (!lote) return undefined;
  const pedidas = Array.isArray(req.body?.cargas) ? req.body.cargas.map(String) : null;
  const hoje = hojeISO();

  const resultado = await emTransacao(async (cx) => {
    const gravadas = [];
    const ignoradas = [];
    for (const [numero, par] of lote) {
      if (pedidas && !pedidas.includes(numero)) { ignoradas.push({ numero, motivo: 'NAO_ESCOLHIDA' }); continue; }
      if (!par.B2B || !par.SIST) { ignoradas.push({ numero, motivo: par.B2B ? 'FALTA_ATAK' : 'FALTA_B2B' }); continue; }
      const conf = conferenciaDoPar(par);
      const r = await gravarConferencia(cx, { numero, conf, hoje, operador: req.operador });
      gravadas.push({ numero, situacao: conf.situacao, ...r });
      await cx.query('DELETE FROM pgfrete_leituras WHERE lote = $1 AND numero_carga IN ($2, $3)',
        [req.params.lote, numero, par.B2B.numero_carga]);   // o B2B pareado pelo número do sistema estava guardado com o número dele
    }
    return { gravadas, ignoradas };
  });
  res.json(resultado);
}));

/* ------------------------------------------- campos da carga */
rotasPagamentoFrete.patch(`${BASE}/cargas/:numero`, ACESSO, rota(async (req, res) => {
  const { numero } = req.params;
  if (!numeroValido(numero)) return recusa(res, 400, 'CARGA_INVALIDA', 'Número de carga inválido.');
  const campos = {};
  if (req.body?.transportadora !== undefined) campos.transportadora = texto(req.body.transportadora, 80);
  if (req.body?.cte !== undefined) campos.cte = texto(req.body.cte, 40);
  if (req.body?.obs !== undefined) campos.obs = texto(req.body.obs, 500);
  /* Canhoto original: a caixinha "o papel veio?" (migração 059). Só acompanhamento —
     não mexe em liberado, pago nem a pagar. Marcar carimba o momento e quem marcou;
     desmarcar apaga o carimbo. */
  const canhoto = req.body?.canhotoOriginal;
  if (canhoto !== undefined && typeof canhoto !== 'boolean') {
    return recusa(res, 400, 'CANHOTO_INVALIDO', 'Canhoto original: use true (veio) ou false (não veio).');
  }
  /* Data do pagamento editável (decisão do dono, 05/10/2026, rodada 2): é a data do
     ÚLTIMO pagamento válido. Sem pagamento não há o que datar — 409, e a tela abre o Pagar. */
  const mexeuData = req.body?.dataPagamento !== undefined;
  const dataPagamento = mexeuData ? (req.body.dataPagamento || null) : undefined;
  if (mexeuData && dataPagamento !== null && !dataValida(dataPagamento)) {
    return recusa(res, 400, 'DATA_INVALIDA', 'Use a data no formato AAAA-MM-DD.');
  }
  if (!Object.keys(campos).length && canhoto === undefined && !mexeuData) return recusa(res, 400, 'SEM_CAMPOS', 'Nada a alterar.');

  const cols = Object.keys(campos);
  const r = await emTransacao(async (cx) => {
    /* A coluna do canhoto só entra na consulta quando o pedido é dela: num servidor
       com a 058 e sem a 059, transportadora/CT-e/obs continuam editáveis. */
    const { rows } = await cx.query(
      `SELECT transportadora, cte, obs${canhoto === undefined ? '' : ', canhoto_original'} FROM pgfrete_cargas WHERE numero_carga = $1 FOR UPDATE`, [numero]);
    if (!rows[0]) return { erro: [404, 'CARGA_NAO_ENCONTRADA', 'Esta carga não está no controle.'] };
    const ex = await excluidaDe(cx, numero);
    if (ex) return { erro: ERRO_EXCLUIDA(ex) };
    /* Transportadora só das cadastradas (decisão do dono, 05/10/2026): o cadastro é a
       Frota (dim_veiculos.transportadora). Nome novo se cadastra em Cadastros primeiro. */
    if (campos.transportadora) {
      const { rows: tr } = await cx.query('SELECT 1 FROM dim_veiculos WHERE transportadora = $1 LIMIT 1', [campos.transportadora]);
      if (!tr[0]) {
        return { erro: [400, 'TRANSPORTADORA_DESCONHECIDA', `"${campos.transportadora}" não está no cadastro da Frota. Cadastre em Cadastros e escolha na lista.`] };
      }
    }
    if (cols.length) {
      await cx.query(
        `UPDATE pgfrete_cargas SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, atualizado_em = now(), atualizado_por = $${cols.length + 2}
          WHERE numero_carga = $1`,
        [numero, ...Object.values(campos), req.operador.nome]);
      await registrarEvento(cx, {
        numero, acao: 'editou_carga', operador: req.operador,
        detalhe: Object.fromEntries(cols.map((c) => [c, { de: rows[0][c], para: campos[c] }])),
      });
    }
    if (canhoto !== undefined) {
      await cx.query(
        `UPDATE pgfrete_cargas
            SET canhoto_original = $2, canhoto_em = CASE WHEN $2 THEN now() ELSE NULL END, canhoto_por = CASE WHEN $2 THEN $3 ELSE '' END,
                atualizado_em = now(), atualizado_por = $3
          WHERE numero_carga = $1`,
        [numero, canhoto, req.operador.nome]);
      await registrarEvento(cx, {
        numero, acao: 'canhoto', operador: req.operador,
        detalhe: { de: rows[0].canhoto_original === true, para: canhoto },
      });
    }
    if (mexeuData) {
      const { rows: ult } = await cx.query(
        `SELECT id, to_char(data_pagamento, 'YYYY-MM-DD') AS data FROM pgfrete_pagamentos
          WHERE numero_carga = $1 AND anulado_em IS NULL AND to_jsonb(pgfrete_pagamentos) ->> 'nota' IS NULL
          ORDER BY id DESC LIMIT 1 FOR UPDATE`, [numero]);
      if (!ult[0]) return { erro: [409, 'SEM_PAGAMENTO', 'Esta carga ainda não tem pagamento registrado — registre o pagamento com a data.'] };
      await cx.query('UPDATE pgfrete_pagamentos SET data_pagamento = $2 WHERE id = $1', [ult[0].id, dataPagamento]);
      await cx.query('UPDATE pgfrete_cargas SET atualizado_em = now(), atualizado_por = $2 WHERE numero_carga = $1', [numero, req.operador.nome]);
      await registrarEvento(cx, {
        numero, acao: 'editou_carga', operador: req.operador,
        detalhe: { dataPagamento: { de: ult[0].data, para: dataPagamento, pagamento: ult[0].id } },
      });
    }
    return { ok: true };
  });
  if (r.erro) return recusa(res, ...r.erro);
  return res.json({ ok: true });
}));

/* ----------------------------------------- tratativa de uma nota */
rotasPagamentoFrete.patch(`${BASE}/cargas/:numero/pendencias/:nota`, ACESSO, rota(async (req, res) => {
  const { numero, nota } = req.params;
  if (!numeroValido(numero) || !numeroValido(nota)) return recusa(res, 400, 'ID_INVALIDO', 'Carga ou nota inválida.');
  const mexeuTratativa = req.body?.tratativa !== undefined;
  const mexeuObs = req.body?.obs !== undefined;
  /* Campos DA NOTA (migração 063): transportadora e CT-E próprios (em branco
     = os da carga) e a data do pagamento dela. */
  const daNota = {};
  if (req.body?.transportadora !== undefined) daNota.transportadora = texto(req.body.transportadora, 80);
  if (req.body?.cte !== undefined) daNota.cte = texto(req.body.cte, 40);
  const mexeuDataPg = req.body?.dataPagamento !== undefined;
  if (mexeuDataPg && !dataValida(req.body.dataPagamento)) {
    return recusa(res, 400, 'DATA_INVALIDA', 'Use a data do pagamento no formato AAAA-MM-DD.');
  }
  if (!mexeuTratativa && !mexeuObs && req.body?.tratativaEm === undefined && !Object.keys(daNota).length && !mexeuDataPg) {
    return recusa(res, 400, 'SEM_CAMPOS', 'Nada a alterar.');
  }

  let tratativa = null;
  if (mexeuTratativa) {
    tratativa = normalizarTratativa(req.body.tratativa);   // as palavras antigas (DEV, OK B2B…) viram as atuais
    if (tratativa === null) {
      return recusa(res, 400, 'TRATATIVA_INVALIDA', `Tratativa inválida. Use: ${TRATATIVAS.join(', ')}.`);
    }
  }
  if (req.body?.tratativaEm !== undefined && req.body.tratativaEm !== null && !dataValida(req.body.tratativaEm)) {
    return recusa(res, 400, 'DATA_INVALIDA', 'Use a data no formato AAAA-MM-DD.');
  }

  const r = await emTransacao(async (cx) => {
    const { rows } = await cx.query(
      `SELECT tratativa, to_char(tratativa_em, 'YYYY-MM-DD') AS tratativa_em, obs, resolvida_em IS NOT NULL AS resolvida
         FROM pgfrete_pendencias WHERE numero_carga = $1 AND nota = $2 FOR UPDATE`, [numero, nota]);
    const atual = rows[0];
    if (!atual) return { erro: [404, 'PENDENCIA_NAO_ENCONTRADA', 'Esta nota não está nas pendências desta carga.'] };
    const ex = await excluidaDe(cx, numero);
    if (ex) return { erro: ERRO_EXCLUIDA(ex) };
    if (atual.resolvida) return { erro: [409, 'PENDENCIA_RESOLVIDA', 'Esta nota já foi finalizada no B2B — não há mais pendência para tratar.'] };

    if (daNota.transportadora) {
      const { rows: tr } = await cx.query('SELECT 1 FROM dim_veiculos WHERE transportadora = $1 LIMIT 1', [daNota.transportadora]);
      if (!tr[0]) {
        return { erro: [400, 'TRANSPORTADORA_DESCONHECIDA', `"${daNota.transportadora}" não está no cadastro da Frota. Cadastre em Cadastros e escolha na lista.`] };
      }
    }
    if (Object.keys(daNota).length) {
      const { rows: antes } = await cx.query(
        "SELECT coalesce(to_jsonb(p) ->> 'transportadora', '') AS transportadora, coalesce(to_jsonb(p) ->> 'cte', '') AS cte FROM pgfrete_pendencias p WHERE numero_carga = $1 AND nota = $2",
        [numero, nota]);
      const cols = Object.keys(daNota);
      await cx.query(`UPDATE pgfrete_pendencias SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE numero_carga = $1 AND nota = $2`,
        [numero, nota, ...Object.values(daNota)]);
      await registrarEvento(cx, {
        numero, nota, acao: 'editou_nota', operador: req.operador,
        detalhe: Object.fromEntries(cols.map((c) => [c, { de: antes[0][c], para: daNota[c] }])),
      });
    }
    if (mexeuDataPg) {
      const { rows: pg } = await cx.query(
        `SELECT id, to_char(data_pagamento, 'YYYY-MM-DD') AS data FROM pgfrete_pagamentos g
          WHERE numero_carga = $1 AND to_jsonb(g) ->> 'nota' = $2 AND anulado_em IS NULL FOR UPDATE`, [numero, nota]);
      if (!pg[0]) return { erro: [409, 'NOTA_SEM_PAGAMENTO', 'Esta nota ainda não foi paga — use Pagar na linha dela.'] };
      await cx.query('UPDATE pgfrete_pagamentos SET data_pagamento = $2 WHERE id = $1', [pg[0].id, req.body.dataPagamento]);
      await registrarEvento(cx, {
        numero, nota, acao: 'editou_nota', operador: req.operador,
        detalhe: { dataPagamento: { de: pg[0].data, para: req.body.dataPagamento, pagamento: pg[0].id } },
      });
    }
    if (!mexeuTratativa && !mexeuObs && req.body?.tratativaEm === undefined) return { ok: true };

    const novaTratativa = mexeuTratativa ? tratativa : atual.tratativa;
    let em = atual.tratativa_em;
    if (mexeuTratativa) em = novaTratativa === '' ? null : (req.body.tratativaEm ?? hojeISO());
    else if (req.body?.tratativaEm !== undefined) em = req.body.tratativaEm;
    const obs = mexeuObs ? texto(req.body.obs, 500) : atual.obs;
    await cx.query(
      `UPDATE pgfrete_pendencias SET tratativa = $3, tratativa_em = $4, tratativa_por = $5, obs = $6
        WHERE numero_carga = $1 AND nota = $2`,
      [numero, nota, novaTratativa, em, req.operador.nome, obs]);
    await registrarEvento(cx, {
      numero, nota, acao: 'tratativa', operador: req.operador,
      detalhe: { tratativa: { de: atual.tratativa, para: novaTratativa }, em, obs: mexeuObs },
    });
    return { ok: true };
  });
  if (r.erro) return recusa(res, ...r.erro);
  return res.json({ ok: true });
}));

/* ------------------------------------------------- pagamentos */
const arred2 = (n) => Math.round(Number(n) * 100) / 100;

rotasPagamentoFrete.post(`${BASE}/cargas/:numero/pagamentos`, ACESSO, rota(async (req, res) => {
  const { numero } = req.params;
  if (!numeroValido(numero)) return recusa(res, 400, 'CARGA_INVALIDA', 'Número de carga inválido.');
  const pct = arred2(req.body?.pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return recusa(res, 400, 'PCT_INVALIDO', 'Informe o percentual pago, de 0,01 a 100.');
  const dataPagamento = req.body?.dataPagamento ?? null;
  if (dataPagamento !== null && dataPagamento !== '' && !dataValida(dataPagamento)) {
    return recusa(res, 400, 'DATA_INVALIDA', 'Use a data no formato AAAA-MM-DD (ou deixe em branco).');
  }
  const confirmar = req.body?.confirmar === true;

  const r = await emTransacao(async (cx) => {
    const { rows } = await cx.query('SELECT 1 FROM pgfrete_cargas WHERE numero_carga = $1 FOR UPDATE', [numero]);
    if (!rows[0]) return { erro: [404, 'CARGA_NAO_ENCONTRADA', 'Esta carga não está no controle.'] };
    const ex = await excluidaDe(cx, numero);
    if (ex) return { erro: ERRO_EXCLUIDA(ex) };
    const [carga] = await lerCargas(cx, { numero });
    const ind = indicadoresDaCarga(carga);
    const pagoAtual = arred2(carga.pctPago);
    const depois = arred2(pagoAtual + pct);
    /* Clique duplo não vira dois lançamentos (governança, 05/10): o mesmo % na
       mesma carga, pela mesma pessoa, em menos de 2 minutos, PERGUNTA antes. */
    if (!confirmar) {
      const { rows: rep } = await cx.query(
        `SELECT 1 FROM pgfrete_pagamentos WHERE numero_carga = $1 AND pct = $2 AND criado_por_id = $3
            AND anulado_em IS NULL AND criado_em > now() - interval '2 minutes' LIMIT 1`,
        [numero, pct, req.operador.id]);
      if (rep[0]) {
        return { erro: [409, 'PAGAMENTO_REPETIDO',
          `Um pagamento de ${pct}% desta carga acabou de ser registrado por você. Registrar outro igual?`, { pagoAtual, podeConfirmar: true }] };
      }
    }

    /* 100% é teto duro: pagar mais que a carga inteira não tem como estar certo. */
    if (depois > 100) {
      return { erro: [409, 'PAGAMENTO_PASSA_DE_100', `A carga já tem ${pagoAtual}% pago; mais ${pct}% passaria de 100%.`, { pagoAtual }] };
    }
    /* O resto é PERGUNTA, não bloqueio (regra da casa: quem tem autoridade decide). */
    const liberadoPct = ind.liberado === null ? null : arred2(ind.liberado * 100);
    if (!confirmar) {
      if (ind.conferir) {
        return { erro: [409, 'CARGA_PARA_CONFERIR',
          'Esta carga está como VERIFICAR (a contagem entre o sistema e o B2B não bate), então nada está liberado para pagar. Quer registrar mesmo assim?',
          { pagoAtual, liberado: null, entregue: arred2((ind.entregue ?? 0) * 100), podeConfirmar: true }] };
      }
      if (depois > liberadoPct + 0.005) {
        return { erro: [409, 'ACIMA_DO_LIBERADO',
          `Só ${liberadoPct}% da carga está liberado (entregue no B2B ou consultado e marcado OK) e já há ${pagoAtual}% pago. Com mais ${pct}% ficaria ${depois}%. Quer registrar mesmo assim?`,
          { pagoAtual, liberado: liberadoPct, entregue: arred2((ind.entregue ?? 0) * 100), podeConfirmar: true }] };
      }
    }
    const { rows: novo } = await cx.query(
      `INSERT INTO pgfrete_pagamentos (numero_carga, pct, data_pagamento, entregue_pct, obs, criado_por_id, criado_por_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [numero, pct, dataPagamento || null, ind.entregue === null ? null : arred2(ind.entregue * 100), texto(req.body?.obs, 500),
        String(req.operador.id), req.operador.nome]);
    await registrarEvento(cx, {
      numero, acao: 'pagamento', operador: req.operador,
      detalhe: { id: novo[0].id, pct, dataPagamento: dataPagamento || null, pagoDepois: depois, liberado: liberadoPct, acimaDoLiberado: confirmar && (ind.conferir || depois > (liberadoPct ?? 0) + 0.005) },
    });
    return { ok: true, id: novo[0].id, pagoTotal: depois };
  });
  if (r.erro) {
    const [status, codigo, erro, extra] = r.erro;
    return recusa(res, status, codigo, erro, extra);
  }
  return res.status(201).json(r);
}));

rotasPagamentoFrete.post(`${BASE}/pagamentos/:id/anular`, ACESSO, rota(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return recusa(res, 400, 'ID_INVALIDO', 'Pagamento inválido.');
  const motivo = texto(req.body?.motivo, 300);
  if (!motivo) return recusa(res, 400, 'MOTIVO_FALTANDO', 'Diga por que o pagamento está sendo anulado.');
  const r = await emTransacao(async (cx) => {
    const { rows } = await cx.query(
      'SELECT numero_carga, pct, anulado_em IS NOT NULL AS anulado FROM pgfrete_pagamentos WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return { erro: [404, 'PAGAMENTO_NAO_ENCONTRADO', 'Pagamento não encontrado.'] };
    if (rows[0].anulado) return { erro: [409, 'JA_ANULADO', 'Este pagamento já foi anulado.'] };
    await cx.query('UPDATE pgfrete_pagamentos SET anulado_em = now(), anulado_por = $2, anulado_motivo = $3 WHERE id = $1', [id, req.operador.nome, motivo]);
    await registrarEvento(cx, { numero: rows[0].numero_carga, acao: 'anulou_pagamento', operador: req.operador, detalhe: { id, pct: rows[0].pct, motivo } });
    return { ok: true };
  });
  if (r.erro) return recusa(res, ...r.erro);
  return res.json({ ok: true });
}));

/* --------------------------------------- pagar UMA nota (migração 063) */
/* Decisão do dono (06/10/2026): pagar uma nota pendente SOMA UMA NOTA no %
   Pago da carga (100 ÷ notas do sistema). É um pagamento como os outros —
   entra no Fechamento do mês da data e se anula no Histórico — ligado à nota.
   Nota sem tratativa que libera: PERGUNTA (quem tem autoridade decide).
   Nota já paga, nota que só existe no B2B e passar de 100%: recusa. */
rotasPagamentoFrete.post(`${BASE}/cargas/:numero/pendencias/:nota/pagar`, ACESSO, rota(async (req, res) => {
  const { numero, nota } = req.params;
  if (!numeroValido(numero) || !numeroValido(nota)) return recusa(res, 400, 'ID_INVALIDO', 'Carga ou nota inválida.');
  const dataPagamento = req.body?.dataPagamento;
  if (!dataValida(dataPagamento)) return recusa(res, 400, 'DATA_INVALIDA', 'Informe a data do pagamento da nota (AAAA-MM-DD).');
  const confirmar = req.body?.confirmar === true;
  const r = await emTransacao(async (cx) => {
    const { rows: c } = await cx.query('SELECT qtd_sist FROM pgfrete_cargas WHERE numero_carga = $1 FOR UPDATE', [numero]);
    if (!c[0]) return { erro: [404, 'CARGA_NAO_ENCONTRADA', 'Esta carga não está no controle.'] };
    const ex = await excluidaDe(cx, numero);
    if (ex) return { erro: ERRO_EXCLUIDA(ex) };
    const { rows: p } = await cx.query(
      'SELECT categoria, tratativa, resolvida_em IS NOT NULL AS resolvida FROM pgfrete_pendencias WHERE numero_carga = $1 AND nota = $2', [numero, nota]);
    if (!p[0]) return { erro: [404, 'PENDENCIA_NAO_ENCONTRADA', 'Esta nota não está nas pendências desta carga.'] };
    if (p[0].categoria === 'so_b2b') {
      return { erro: [409, 'NOTA_SO_NO_B2B', 'Esta nota só aparece no B2B, não no sistema — ela não é uma das notas da carga, então não entra no % pago.'] };
    }
    const { rows: ja } = await cx.query(
      `SELECT id, to_char(data_pagamento, 'YYYY-MM-DD') AS data FROM pgfrete_pagamentos g
        WHERE numero_carga = $1 AND to_jsonb(g) ->> 'nota' = $2 AND anulado_em IS NULL`, [numero, nota]);
    if (ja[0]) return { erro: [409, 'NOTA_JA_PAGA', `A nota ${nota} já foi paga (${ja[0].data ? ja[0].data.split('-').reverse().join('/') : 'sem data'}). Para corrigir a data, edite-a; para desfazer, anule no Histórico.`] };
    const qtd = Number(c[0].qtd_sist) || 0;
    if (qtd <= 0) return { erro: [409, 'SEM_QTD_SIST', 'A carga está sem a quantidade de notas do sistema — importe o relatório do Atak dela.'] };
    const pct = arred2(100 / qtd);
    const { rows: soma } = await cx.query(
      'SELECT coalesce(sum(pct), 0) AS pct FROM pgfrete_pagamentos WHERE numero_carga = $1 AND anulado_em IS NULL', [numero]);
    const pagoAtual = arred2(soma[0].pct);
    const depois = arred2(pagoAtual + pct);
    if (depois > 100.005) {
      return { erro: [409, 'PAGAMENTO_PASSA_DE_100', `A carga já tem ${pagoAtual}% pago; mais esta nota (${pct}%) passaria de 100%.`, { pagoAtual }] };
    }
    const libera = TRATATIVAS_QUE_LIBERAM.includes(p[0].tratativa);
    if (!libera && !confirmar) {
      return { erro: [409, 'NOTA_NAO_LIBERADA',
        `A nota ${nota} está ${p[0].tratativa ? `como ${p[0].tratativa}` : 'sem tratativa'} — ainda não está liberada para pagar. Pagar mesmo assim?`,
        { podeConfirmar: true, pagoAtual }] };
    }
    const { rows: novo } = await cx.query(
      `INSERT INTO pgfrete_pagamentos (numero_carga, nota, pct, data_pagamento, obs, criado_por_id, criado_por_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [numero, nota, pct, dataPagamento, `nota ${nota}`, String(req.operador.id), req.operador.nome]);
    await registrarEvento(cx, {
      numero, nota, acao: 'pagamento', operador: req.operador,
      detalhe: { id: novo[0].id, pct, nota, dataPagamento, pagoDepois: depois, semLiberar: !libera },
    });
    return { ok: true, id: novo[0].id, pct, pagoTotal: depois };
  });
  if (r.erro) {
    const [status, codigo, erro, extra] = r.erro;
    return recusa(res, status, codigo, erro, extra);
  }
  return res.status(201).json(r);
}));

/* ------------------------------------- excluir / restaurar (migração 062) */
/* Decisão do dono (06/10/2026): a carga SAI DA LISTA E FICA NO HISTÓRICO.
   Motivo obrigatório. Com pagamento registrado, PERGUNTA antes (409 com
   podeConfirmar) — não bloqueia quem tem autoridade. Nada é apagado:
   pagamentos, tratativas e eventos continuam no banco. */
rotasPagamentoFrete.post(`${BASE}/cargas/:numero/excluir`, ACESSO, rota(async (req, res) => {
  const { numero } = req.params;
  if (!numeroValido(numero)) return recusa(res, 400, 'CARGA_INVALIDA', 'Número de carga inválido.');
  const motivo = texto(req.body?.motivo, 300);
  if (!motivo) return recusa(res, 400, 'MOTIVO_FALTANDO', 'Diga por que a carga está sendo excluída do controle.');
  const confirmar = req.body?.confirmar === true;
  const r = await emTransacao(async (cx) => {
    const { rows } = await cx.query('SELECT excluida_em FROM pgfrete_cargas WHERE numero_carga = $1 FOR UPDATE', [numero]);
    if (!rows[0]) return { erro: [404, 'CARGA_NAO_ENCONTRADA', 'Esta carga não está no controle.'] };
    if (rows[0].excluida_em) return { erro: [409, 'JA_EXCLUIDA', 'Esta carga já foi excluída do controle.'] };
    const { rows: pg } = await cx.query(
      'SELECT coalesce(sum(pct), 0) AS pct FROM pgfrete_pagamentos WHERE numero_carga = $1 AND anulado_em IS NULL', [numero]);
    const pctPago = arred2(pg[0].pct);
    if (pctPago > 0 && !confirmar) {
      return { erro: [409, 'TEM_PAGAMENTO',
        `Esta carga tem ${String(pctPago).replace('.', ',')}% pago registrado. Excluída, ela sai da lista, da planilha e do PDF (os pagamentos continuam no histórico). Excluir mesmo assim?`,
        { pctPago, podeConfirmar: true }] };
    }
    await cx.query(
      'UPDATE pgfrete_cargas SET excluida_em = now(), excluida_por = $2, excluida_motivo = $3, atualizado_em = now(), atualizado_por = $2 WHERE numero_carga = $1',
      [numero, req.operador.nome, motivo]);
    await registrarEvento(cx, { numero, acao: 'excluiu', operador: req.operador, detalhe: { motivo, pctPago } });
    return { ok: true };
  });
  if (r.erro) {
    const [status, codigo, erro, extra] = r.erro;
    return recusa(res, status, codigo, erro, extra);
  }
  return res.json({ ok: true });
}));

rotasPagamentoFrete.post(`${BASE}/cargas/:numero/restaurar`, ACESSO, rota(async (req, res) => {
  const { numero } = req.params;
  if (!numeroValido(numero)) return recusa(res, 400, 'CARGA_INVALIDA', 'Número de carga inválido.');
  const r = await emTransacao(async (cx) => {
    const { rows } = await cx.query(
      'SELECT excluida_em, excluida_por, excluida_motivo FROM pgfrete_cargas WHERE numero_carga = $1 FOR UPDATE', [numero]);
    if (!rows[0]) return { erro: [404, 'CARGA_NAO_ENCONTRADA', 'Esta carga não está no controle.'] };
    if (!rows[0].excluida_em) return { erro: [409, 'NAO_EXCLUIDA', 'Esta carga não está excluída.'] };
    await cx.query(
      `UPDATE pgfrete_cargas SET excluida_em = NULL, excluida_por = '', excluida_motivo = '', atualizado_em = now(), atualizado_por = $2
        WHERE numero_carga = $1`, [numero, req.operador.nome]);
    await registrarEvento(cx, {
      numero, acao: 'restaurou', operador: req.operador,
      detalhe: { pela: 'botao', exclusao: { em: rows[0].excluida_em, por: rows[0].excluida_por, motivo: rows[0].excluida_motivo } },
    });
    return { ok: true };
  });
  if (r.erro) return recusa(res, ...r.erro);
  return res.json({ ok: true });
}));

/* A lista das excluídas: o "fica no histórico" que se consegue achar. */
rotasPagamentoFrete.get(`${BASE}/excluidas`, ACESSO, rota(async (req, res) => {
  const { rows } = await consultar(
    `SELECT c.numero_carga, to_char(c.data_consulta, 'YYYY-MM-DD') AS data_consulta, c.transportadora, c.excluida_em, c.excluida_por,
            c.excluida_motivo,
            (SELECT coalesce(sum(p.pct), 0) FROM pgfrete_pagamentos p WHERE p.numero_carga = c.numero_carga AND p.anulado_em IS NULL) AS pct_pago
       FROM pgfrete_cargas c WHERE c.excluida_em IS NOT NULL ORDER BY c.excluida_em DESC LIMIT 500`);
  res.set('Cache-Control', 'no-store');
  res.json({
    cargas: rows.map((r) => ({
      carga: r.numero_carga, dataConsulta: r.data_consulta, transportadora: r.transportadora,
      excluidaEm: new Date(r.excluida_em).toISOString(), excluidaPor: r.excluida_por, motivo: r.excluida_motivo,
      pctPago: arred2(r.pct_pago),
    })),
  });
}));

/* -------------------------------------------- histórico de uma carga */
rotasPagamentoFrete.get(`${BASE}/cargas/:numero/historico`, ACESSO, rota(async (req, res) => {
  const { numero } = req.params;
  if (!numeroValido(numero)) return recusa(res, 400, 'CARGA_INVALIDA', 'Número de carga inválido.');
  const { rows: c } = await consultar('SELECT 1 FROM pgfrete_cargas WHERE numero_carga = $1', [numero]);
  if (!c[0]) return recusa(res, 404, 'CARGA_NAO_ENCONTRADA', 'Esta carga não está no controle.');
  const [pagamentos, eventos, pendencias] = await Promise.all([
    consultar(
      `SELECT id, pct, to_char(data_pagamento, 'YYYY-MM-DD') AS data_pagamento, entregue_pct, obs, criado_em, criado_por_nome,
              anulado_em, anulado_por, anulado_motivo, to_jsonb(g) ->> 'nota' AS nota
         FROM pgfrete_pagamentos g WHERE numero_carga = $1 ORDER BY id`, [numero]),
    consultar(
      `SELECT acao, nota, detalhe, por_nome, em FROM pgfrete_eventos WHERE numero_carga = $1 ORDER BY id DESC LIMIT 100`, [numero]),
    consultar(
      `SELECT nota, categoria, status_b2b, cliente, cidade, tratativa, to_char(tratativa_em, 'YYYY-MM-DD') AS tratativa_em,
              to_char(visto_em, 'YYYY-MM-DD') AS visto_em, to_char(resolvida_em, 'YYYY-MM-DD') AS resolvida_em, obs
         FROM pgfrete_pendencias WHERE numero_carga = $1 ORDER BY nota::bigint`, [numero]),
  ]);
  res.json({
    numero,
    excluida: await excluidaDe({ query: consultar }, numero),
    pagamentos: pagamentos.rows.map((p) => ({
      id: p.id, pct: p.pct, dataPagamento: p.data_pagamento, entreguePct: p.entregue_pct, obs: p.obs, criadoEm: p.criado_em,
      por: p.criado_por_nome, anuladoEm: p.anulado_em, anuladoPor: p.anulado_por, anuladoMotivo: p.anulado_motivo, nota: p.nota || null,
    })),
    pendencias: pendencias.rows.map((p) => ({
      nota: p.nota, categoria: p.categoria, statusB2b: p.status_b2b, cliente: p.cliente, cidade: p.cidade,
      tratativa: p.tratativa, tratativaEm: p.tratativa_em, vistoEm: p.visto_em, resolvidaEm: p.resolvida_em, obs: p.obs,
    })),
    eventos: eventos.rows.map((e) => ({ acao: e.acao, nota: e.nota, detalhe: e.detalhe, por: e.por_nome, em: e.em })),
  });
}));
