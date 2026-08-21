/* Rotas de Devoluções — o checklist digital.

   Fase 1 (18/08/2026): criação, edição e TODAS as etapas ficam com
   Logística/Administração (eles alimentam e auditam o processo antes de
   abrir para os setores). A máquina de estados em dominio/devolucoes.js já
   conhece os setores da fase 2 — abrir depois é só existirem operadores
   desses setores, nenhuma rota muda.

   Toda escrita carimba operador_nome/operador_setor na linha ANTES do
   trigger de revisão disparar, para a revisão saber quem aposentou o
   estado anterior (mesmo desenho das cargas). */

import { Router } from 'express';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';
import {
  DEV_STATUS_INICIAL,
  validarTransicaoDevolucao,
  podeCriarDevolucao,
  devolucaoParaPainel,
  itemParaPainel,
  divergenciaParaPainel,
  camposCabecalho,
  camposItem,
  normalizarRotas,
} from '../dominio/devolucoes.js';

export const rotasDevolucoes = Router();

function novoId(prefixo) {
  return `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function logDevolucao(cli, { devolucaoId, acao, operador }) {
  await cli.query(
    `INSERT INTO log_eventos
       (evento_id, carga_id, placa, acao, setor, operador_id, operador_nome,
        operador_verificado)
     VALUES ($1,$2,'',$3,$4,$5,$6,TRUE)`,
    [novoId('log'), devolucaoId, acao, operador.setor, operador.id, operador.nome]
  );
}

/* Devolução completa (cabeçalho + rotas + itens + divergências) num
   objeto só — é a unidade que o painel desenha. */
async function buscarCompleta(executor, id) {
  const { rows } = await executor.query(
    'SELECT * FROM devolucoes WHERE devolucao_id = $1 AND excluida_em IS NULL', [id]
  );
  if (!rows[0]) return null;
  const rotas = await executor.query(
    'SELECT rota_codigo FROM devolucao_rotas WHERE devolucao_id = $1 ORDER BY rota_codigo', [id]
  );
  const itens = await executor.query(
    'SELECT * FROM devolucao_itens WHERE devolucao_id = $1 ORDER BY item_id', [id]
  );
  const divs = await executor.query(
    'SELECT * FROM devolucao_divergencias WHERE devolucao_id = $1 ORDER BY divergencia_id', [id]
  );
  return devolucaoParaPainel(rows[0], itens.rows, divs.rows,
    rotas.rows.map((r) => r.rota_codigo));
}

/* Confere as rotas contra o cadastro e devolve as que NÃO existem —
   mensagem com o código errado na mão, não um "422 genérico". */
async function rotasDesconhecidas(rotas) {
  if (!rotas.length) return [];
  const { rows } = await consultar(
    'SELECT codigo FROM dim_rotas WHERE codigo = ANY($1)', [rotas]
  );
  const existentes = new Set(rows.map((r) => r.codigo));
  return rotas.filter((r) => !existentes.has(r));
}

function emitirAtualizada(id) {
  emitir('devolucao:atualizada', { id });
}

/* Motivo lançado por CÓDIGO vira código + descrição (19/08/2026).

   Quem lança digita o número que está na capa ("607"), mas quem confere
   depois precisa ler o motivo. O painel já completa na tela; aqui é a
   garantia de que vale por qualquer caminho — API, importação, um painel
   antigo que ainda não atualizou. Código que não existe no catálogo fica
   como veio: inventar descrição seria pior que mostrar o número. */
async function expandirMotivo(executor, campos) {
  const bruto = String(campos.motivo ?? '').trim();
  if (!bruto || !/^\d{2,4}$/.test(bruto)) return;
  const { rows } = await executor.query(
    'SELECT motivo FROM dim_motivos_devolucao WHERE motivo LIKE $1 ORDER BY motivo LIMIT 1',
    [bruto + ' %']
  );
  if (rows[0]) campos.motivo = rows[0].motivo;
}

/* O NOME DO CLIENTE ENTRA JUNTO DO CÓDIGO (20/08/2026).

   Relato do gestor: "o código do cliente no relatório não está puxando o
   nome do cliente, está puxando só o código".

   Poderia ficar só no painel (ele já busca o cliente ao digitar), mas aí
   dependeria de a busca ter dado certo naquele instante — rede lenta,
   digitação colada, importação em lote — e o relatório sairia sem nome sem
   ninguém entender por quê. Aqui é o servidor que completa, na hora de
   gravar, sempre que o código existir no cadastro.

   O apelido tem preferência sobre a razão social porque é o que as capas de
   papel usam ("SENDAS", "AREAL") — mesma decisão da migration 019.

   Nome que o painel mandou explicitamente é respeitado: quem digitou sabe
   mais que o cadastro sobre aquele lançamento. */
async function completarNomeDoCliente(executor, campos) {
  const codigo = String(campos.cod_cliente ?? '').trim();
  if (!codigo) return;
  if (String(campos.cliente_nome ?? '').trim()) return;
  try {
    const { rows } = await executor.query(
      'SELECT nome, apelido FROM dim_clientes WHERE codigo = $1', [codigo]
    );
    const achado = rows[0];
    if (!achado) return;
    const nome = (achado.apelido || '').trim() || (achado.nome || '').trim();
    if (nome) campos.cliente_nome = nome.slice(0, 200);
  } catch (e) {
    // Completar é bônus, não pré-requisito: o item grava de qualquer forma.
    console.warn('[devolucoes] nome do cliente não completou:', e.message);
  }
}

/* Aprendizado automático do vínculo cliente → RCA → supervisor (pedido
   de 18/08/2026): todo item gravado com esses campos ensina a base, e o
   próximo lançamento do mesmo cliente preenche sozinho — a mesma lógica
   da placa que puxa a transportadora. Campo vazio não apaga o que a base
   já sabe (COALESCE/NULLIF, a lição das observações). Nunca derruba a
   gravação do item: aprender é bônus, não pré-requisito. */
async function aprenderCliente(executor, item) {
  const codigo = String(item.cod_cliente ?? '').trim().slice(0, 100);
  if (!codigo) return;
  try {
    await executor.query(
      `INSERT INTO dim_clientes (codigo, vendedor, supervisor)
       VALUES ($1, $2, $3)
       ON CONFLICT (codigo) DO UPDATE SET
         vendedor   = COALESCE(NULLIF(EXCLUDED.vendedor,  ''), dim_clientes.vendedor),
         supervisor = COALESCE(NULLIF(EXCLUDED.supervisor, ''), dim_clientes.supervisor),
         atualizado_em = now()`,
      [codigo,
       String(item.vendedor ?? '').trim().slice(0, 100),
       String(item.supervisor ?? '').trim().slice(0, 100)]
    );
  } catch (e) {
    console.warn('[devolucoes] aprendizado de cliente falhou:', e.message);
  }
}

/* Lista por período de DATA DA DEVOLUÇÃO (o dia do checklist, não o dia do
   clique — mesma lição do relatório de cargas). Sem período: últimos 30
   dias, o suficiente para a tela do dia e o histórico recente. */
rotasDevolucoes.get('/devolucoes', exigirLogin, async (req, res, next) => {
  try {
    const de = String(req.query.de || '').slice(0, 10);
    const ate = String(req.query.ate || '').slice(0, 10);
    const params = [];
    let filtro = 'excluida_em IS NULL';
    if (/^\d{4}-\d{2}-\d{2}$/.test(de)) { params.push(de); filtro += ` AND data_dev >= $${params.length}`; }
    else { filtro += " AND data_dev >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 30"; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(ate)) { params.push(ate); filtro += ` AND data_dev <= $${params.length}`; }

    const { rows } = await consultar(
      `SELECT * FROM devolucoes WHERE ${filtro} ORDER BY data_dev DESC, numero DESC`, params
    );
    const ids = rows.map((r) => r.devolucao_id);
    let itens = [], divs = [], rotas = [];
    if (ids.length) {
      itens = (await consultar(
        'SELECT * FROM devolucao_itens WHERE devolucao_id = ANY($1) ORDER BY item_id', [ids]
      )).rows;
      divs = (await consultar(
        'SELECT * FROM devolucao_divergencias WHERE devolucao_id = ANY($1) ORDER BY divergencia_id', [ids]
      )).rows;
      rotas = (await consultar(
        'SELECT devolucao_id, rota_codigo FROM devolucao_rotas WHERE devolucao_id = ANY($1) ORDER BY rota_codigo', [ids]
      )).rows;
    }
    res.json(rows.map((r) => devolucaoParaPainel(
      r,
      itens.filter((i) => i.devolucao_id === r.devolucao_id),
      divs.filter((d) => d.devolucao_id === r.devolucao_id),
      rotas.filter((x) => x.devolucao_id === r.devolucao_id).map((x) => x.rota_codigo)
    )));
  } catch (e) { next(e); }
});

rotasDevolucoes.post('/devolucoes', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    if (!podeCriarDevolucao(op.setor)) {
      return res.status(403).json({
        erro: 'Criar checklist de devolução é da Logística.',
        codigo: 'SETOR_SEM_PERMISSAO',
      });
    }
    const cab = camposCabecalho(req.body || {});
    /* SOBRA (18/08/2026): sem vínculo com carga e SEM rota — só entra.
       Devolução normal continua exigindo pelo menos uma rota cadastrada. */
    const tipo = req.body?.tipo === 'SOBRA' ? 'SOBRA' : 'DEVOLUCAO';
    const rotas = tipo === 'SOBRA' ? [] : normalizarRotas(req.body?.rotas ?? req.body?.rota);
    if (tipo !== 'SOBRA' && !rotas.length) {
      return res.status(400).json({
        erro: 'Informe pelo menos uma rota — região + rotas identificam o checklist na conferência.',
        codigo: 'ROTA_FALTANDO',
      });
    }
    if (!cab.data_dev || !/^\d{4}-\d{2}-\d{2}$/.test(cab.data_dev)) {
      return res.status(400).json({ erro: 'Informe a data da devolução (AAAA-MM-DD).', codigo: 'DATA_FALTANDO' });
    }
    const faltantes = await rotasDesconhecidas(rotas);
    if (faltantes.length) {
      return res.status(422).json({
        erro: `Rota(s) não cadastrada(s): ${faltantes.join(', ')}. Cadastre em Cadastros → Rotas antes.`,
        codigo: 'ROTA_DESCONHECIDA',
      });
    }

    const id = novoId('dev');
    const itensCorpo = Array.isArray(req.body?.itens) ? req.body.itens.slice(0, 200) : [];

    const devolucao = await emTransacao(async (cli) => {
      const colunas = ['devolucao_id', 'tipo', 'status', 'criada_por', 'criada_setor',
        'operador_nome', 'operador_setor', ...Object.keys(cab)];
      const valores = [id, tipo, DEV_STATUS_INICIAL, op.nome, op.setor,
        op.nome, op.setor, ...Object.values(cab)];
      await cli.query(
        `INSERT INTO devolucoes (${colunas.join(', ')})
         VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')})`,
        valores
      );
      for (const rotaCod of rotas) {
        await cli.query(
          'INSERT INTO devolucao_rotas (devolucao_id, rota_codigo) VALUES ($1,$2)',
          [id, rotaCod]
        );
      }
      for (const itemCorpo of itensCorpo) {
        const it = camposItem(itemCorpo);
        await expandirMotivo(cli, it);
        await completarNomeDoCliente(cli, it);
        const cols = ['devolucao_id', 'operador_nome', 'operador_setor', ...Object.keys(it)];
        const vals = [id, op.nome, op.setor, ...Object.values(it)];
        await cli.query(
          `INSERT INTO devolucao_itens (${cols.join(', ')})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          vals
        );
        await aprenderCliente(cli, it);
      }
      await logDevolucao(cli, {
        devolucaoId: id, operador: op,
        acao: tipo === 'SOBRA'
          ? `Checklist de SOBRA criado (${itensCorpo.length} item(ns))`
          : `Checklist de devolução criado (${cab.regiao ? 'região ' + cab.regiao + ', ' : ''}rota(s) ${rotas.join(', ')}, ${itensCorpo.length} item(ns))`,
      });
      return buscarCompleta(cli, id);
    });

    emitirAtualizada(id);
    res.status(201).json(devolucao);
  } catch (e) { next(e); }
});

rotasDevolucoes.get('/devolucoes/:id', exigirLogin, async (req, res, next) => {
  try {
    const d = await buscarCompleta({ query: consultar }, req.params.id);
    if (!d) return res.status(404).json({ erro: 'Devolução não encontrada.', codigo: 'NAO_ENCONTRADA' });
    res.json(d);
  } catch (e) { next(e); }
});

/* Edição do cabeçalho — controle total da Logística/Administração. A
   PORTARIA também edita, mas SÓ os campos do posto dela (teste do usuário,
   18/08/2026: "carga, lacre, nota de transferência, placa, motorista,
   transportadora" precisam estar disponíveis para a Portaria). Carimbos e
   status NÃO passam por aqui (têm rota própria com a máquina de estados). */
const CAMPOS_CABECALHO_PORTARIA = new Set([
  'placa', 'transportadora', 'motorista', 'carga_numero',
  'lacre1', 'lacre2', 'lacre3', 'nota_transferencia',
  // "Chegou lacrado?" é a resposta do porteiro no recebimento (18/08/2026).
  'chegou_lacrado',
]);

rotasDevolucoes.patch('/devolucoes/:id', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    const cab = camposCabecalho(req.body || {});
    const trocaRotas = req.body?.rotas !== undefined || req.body?.rota !== undefined;
    if (!Object.keys(cab).length && !trocaRotas) {
      return res.status(400).json({ erro: 'Nada para alterar.', codigo: 'SEM_CAMPOS' });
    }
    const ehGestor = op.setor === 'Logística' || op.setor === 'Administração';
    if (!ehGestor) {
      const chavesCab = Object.keys(cab);
      const permitido = !trocaRotas && (
        (op.setor === 'Portaria' && chavesCab.every((c) => CAMPOS_CABECALHO_PORTARIA.has(c)))
        // Peso final é o campo do Faturamento no cabeçalho (18/08/2026).
        || (op.setor === 'Faturamento' && chavesCab.every((c) => c === 'peso_final'))
        // RDC/Romaneio é o campo dos Controles Internos (18/08/2026).
        || (op.setor === 'Controles Internos' && chavesCab.every((c) => c === 'gerou_rdc'))
      );
      if (!permitido) {
        return res.status(403).json({
          erro: 'Esses campos do checklist são da Logística — a Portaria edita placa/transportadora/motorista/carga/lacres/NT; o Faturamento edita o peso final; os Controles Internos, o RDC.',
          codigo: 'SETOR_SEM_PERMISSAO',
        });
      }
    }
    if (cab.data_dev !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(cab.data_dev)) {
      return res.status(400).json({ erro: 'Data da devolução inválida (use AAAA-MM-DD).', codigo: 'DATA_INVALIDA' });
    }
    let rotas = null;
    if (trocaRotas) {
      rotas = normalizarRotas(req.body?.rotas ?? req.body?.rota);
      if (!rotas.length) {
        return res.status(400).json({
          erro: 'O checklist precisa de pelo menos uma rota.', codigo: 'ROTA_FALTANDO',
        });
      }
      const faltantes = await rotasDesconhecidas(rotas);
      if (faltantes.length) {
        return res.status(422).json({
          erro: `Rota(s) não cadastrada(s): ${faltantes.join(', ')}.`,
          codigo: 'ROTA_DESCONHECIDA',
        });
      }
    }

    const d = await emTransacao(async (cli) => {
      const sets = Object.keys(cab).map((c, i) => `${c} = $${i + 1}`);
      const vals = Object.values(cab);
      vals.push(op.nome, op.setor, req.params.id);
      /* O cabeçalho é atualizado mesmo numa troca só de rotas: o carimbo de
         operador/versão registra QUEM mexeu — as linhas de devolucao_rotas
         não passam pelo trigger de revisão, e este rastro cobre isso. */
      const upd = await cli.query(
        `UPDATE devolucoes
            SET ${sets.length ? sets.join(', ') + ',' : ''}
                operador_nome = $${vals.length - 2}, operador_setor = $${vals.length - 1},
                atualizado_em = now(), versao = versao + 1
          WHERE devolucao_id = $${vals.length} AND excluida_em IS NULL
          RETURNING devolucao_id`,
        vals
      );
      if (!upd.rows[0]) {
        const e = new Error('Devolução não encontrada.');
        e.status = 404; e.codigo = 'NAO_ENCONTRADA';
        throw e;
      }
      if (rotas) {
        await cli.query('DELETE FROM devolucao_rotas WHERE devolucao_id = $1', [req.params.id]);
        for (const rotaCod of rotas) {
          await cli.query(
            'INSERT INTO devolucao_rotas (devolucao_id, rota_codigo) VALUES ($1,$2)',
            [req.params.id, rotaCod]
          );
        }
        await logDevolucao(cli, {
          devolucaoId: req.params.id, operador: op,
          acao: `Rotas do checklist alteradas para: ${rotas.join(', ')}`,
        });
      }
      return buscarCompleta(cli, req.params.id);
    });
    emitirAtualizada(req.params.id);
    res.json(d);
  } catch (e) { next(e); }
});

/* Exclusão é soft (excluida_em) — some do painel e dos relatórios, mas o
   dado e as revisões ficam. */
rotasDevolucoes.delete('/devolucoes/:id', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const op = req.operador;
    await emTransacao(async (cli) => {
      const upd = await cli.query(
        `UPDATE devolucoes
            SET excluida_em = now(), operador_nome = $1, operador_setor = $2,
                atualizado_em = now(), versao = versao + 1
          WHERE devolucao_id = $3 AND excluida_em IS NULL
          RETURNING numero`,
        [op.nome, op.setor, req.params.id]
      );
      if (!upd.rows[0]) {
        const e = new Error('Devolução não encontrada.');
        e.status = 404; e.codigo = 'NAO_ENCONTRADA';
        throw e;
      }
      await logDevolucao(cli, {
        devolucaoId: req.params.id, operador: op,
        acao: `Checklist de devolução nº ${upd.rows[0].numero} excluído`,
      });
    });
    emitirAtualizada(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* Avanço de etapa — as "assinaturas" do papel. O corpo pode trazer os
   campos que aquela etapa imputa (Portaria: lacres e nº da carga;
   Faturamento: peso final; Controles Internos: observações). */
rotasDevolucoes.post('/devolucoes/:id/etapa', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    const para = String(req.body?.para ?? '');

    const resultado = await emTransacao(async (cli) => {
      const { rows } = await cli.query(
        'SELECT * FROM devolucoes WHERE devolucao_id = $1 AND excluida_em IS NULL FOR UPDATE',
        [req.params.id]
      );
      if (!rows[0]) {
        const e = new Error('Devolução não encontrada.');
        e.status = 404; e.codigo = 'NAO_ENCONTRADA';
        throw e;
      }
      const regra = validarTransicaoDevolucao(rows[0].status, para, op.setor, rows[0].tipo);

      const extras = [];
      const vals = [];
      const põe = (coluna, valor) => { vals.push(valor); extras.push(`${coluna} = $${vals.length}`); };

      if (regra.carimbo === 'portaria') {
        /* Alinhamento de 18/08/2026: a Portaria imputa PLACA e MOTORISTA
           no recebimento (o que ela vê no caminhão que voltou). Lacres e
           nº da carga continuam aceitos por compatibilidade — hoje são do
           cabeçalho editável da Logística. */
        if (req.body?.placa !== undefined) {
          põe('placa', String(req.body.placa).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
        }
        if (req.body?.motorista !== undefined) põe('motorista', String(req.body.motorista).slice(0, 200));
        if (req.body?.transportadora !== undefined) põe('transportadora', String(req.body.transportadora).slice(0, 200));
        if (req.body?.lacre1 !== undefined) põe('lacre1', String(req.body.lacre1).slice(0, 50));
        if (req.body?.lacre2 !== undefined) põe('lacre2', String(req.body.lacre2).slice(0, 50));
        if (req.body?.cargaNumero !== undefined) põe('carga_numero', String(req.body.cargaNumero).slice(0, 50));
        if (req.body?.chegouLacrado !== undefined) {
          /* Chegou lacrado? A Portaria responde no recebimento: veio
             lacrado (com número) ou veio SEM lacre. Nenhuma das duas
             respostas trava a devolução — as duas só precisam ficar
             registradas. */
          põe('chegou_lacrado', req.body.chegouLacrado === null || req.body.chegouLacrado === ''
            ? null : (req.body.chegouLacrado === false || req.body.chegouLacrado === 'false' ? false : true));
        }
      }
      if (regra.carimbo === 'faturamento' && req.body?.pesoFinal !== undefined) {
        const n = Number(req.body.pesoFinal);
        põe('peso_final', req.body.pesoFinal === '' || req.body.pesoFinal === null
          ? null : (Number.isFinite(n) ? n : null));
      }
      if (regra.carimbo === 'controles' && req.body?.obsControles !== undefined) {
        põe('obs_controles', String(req.body.obsControles).slice(0, 2000));
      }
      if (regra.carimbo === 'controles' && req.body?.gerouRdc !== undefined) {
        // "Gerou RDC (romaneio)?" — informado junto com a destinação.
        põe('gerou_rdc', req.body.gerouRdc === null || req.body.gerouRdc === ''
          ? null : (req.body.gerouRdc === false || req.body.gerouRdc === 'false' ? false : true));
      }

      põe('status', para);
      põe(`${regra.carimbo}_por`, op.nome);
      vals.push(op.nome, op.setor, req.params.id);
      await cli.query(
        `UPDATE devolucoes
            SET ${extras.join(', ')}, ${regra.carimbo}_em = now(),
                operador_nome = $${vals.length - 2}, operador_setor = $${vals.length - 1},
                atualizado_em = now(), versao = versao + 1
          WHERE devolucao_id = $${vals.length}`,
        vals
      );
      await logDevolucao(cli, {
        devolucaoId: req.params.id, operador: op,
        acao: `Devolução nº ${rows[0].numero}: ${rows[0].status} → ${para}`,
      });
      return buscarCompleta(cli, req.params.id);
    });

    emitirAtualizada(req.params.id);
    res.json(resultado);
  } catch (e) { next(e); }
});

/* ---------- Itens do checklist ---------- */

rotasDevolucoes.post('/devolucoes/:id/itens', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const op = req.operador;
    const dev = await consultar(
      'SELECT devolucao_id FROM devolucoes WHERE devolucao_id = $1 AND excluida_em IS NULL',
      [req.params.id]
    );
    if (!dev.rows[0]) return res.status(404).json({ erro: 'Devolução não encontrada.', codigo: 'NAO_ENCONTRADA' });
    const it = camposItem(req.body || {});
    await expandirMotivo({ query: consultar }, it);
    await completarNomeDoCliente({ query: consultar }, it);
    const cols = ['devolucao_id', 'operador_nome', 'operador_setor', ...Object.keys(it)];
    const vals = [req.params.id, op.nome, op.setor, ...Object.values(it)];
    const ins = await consultar(
      `INSERT INTO devolucao_itens (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING *`,
      vals
    );
    await aprenderCliente({ query: consultar }, ins.rows[0]);
    emitirAtualizada(req.params.id);
    res.status(201).json(itemParaPainel(ins.rows[0]));
  } catch (e) { next(e); }
});

/* Edição de item. A conferência (qtdRecebida) e a destinação também entram
   por aqui — na fase 2 os setores donos dessas colunas ganham passagem, e
   a checagem por setor abaixo já separa os dois casos. */
rotasDevolucoes.patch('/devolucoes/:id/itens/:itemId', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    const it = camposItem(req.body || {});
    if (!Object.keys(it).length) {
      return res.status(400).json({ erro: 'Nada para alterar.', codigo: 'SEM_CAMPOS' });
    }
    await expandirMotivo({ query: consultar }, it);
    await completarNomeDoCliente({ query: consultar }, it);

    /* Fase 1: Logística/Administração mexem em tudo. Cada setor da fase 2
       enxerga só a própria coluna: Expedição confere (qtd_recebida),
       Faturamento pesa (peso_faturamento — a confirmação de que passou
       pela balança), Controles Internos destina, Central de Notas dá o
       tick de nota final. */
    const SO_CONFERENCIA = new Set(['qtd_recebida']);
    const SO_PESAGEM = new Set(['peso_faturamento']);
    const SO_DESTINACAO = new Set(['destinacao', 'dest_estoque', 'dest_descarte', 'dest_reprocesso']);
    const SO_NOTA_FINAL = new Set(['nota_final']);
    /* O número da carga de devolução nasce no SIS ATAK, no momento em que a
       PORTARIA abre a DEV — então é ela quem digita, item a item. É o único
       campo de item que a Portaria escreve, e por isso tem lista própria. */
    const SO_CARGA_DEV = new Set(['carga_dev']);
    const chaves = Object.keys(it);
    const permitido =
      op.setor === 'Logística' || op.setor === 'Administração'
      || (op.setor === 'Expedição' && chaves.every((c) => SO_CONFERENCIA.has(c)))
      || (op.setor === 'Faturamento' && chaves.every((c) => SO_PESAGEM.has(c)))
      || (op.setor === 'Controles Internos' && chaves.every((c) => SO_DESTINACAO.has(c)))
      || (op.setor === 'Central de Notas' && chaves.every((c) => SO_NOTA_FINAL.has(c)))
      || (op.setor === 'Portaria' && chaves.every((c) => SO_CARGA_DEV.has(c)));
    if (!permitido) {
      return res.status(403).json({
        erro: `O setor ${op.setor} não altera esses campos do checklist.`,
        codigo: 'SETOR_SEM_PERMISSAO',
      });
    }

    const sets = chaves.map((c, i) => `${c} = $${i + 1}`);
    const vals = Object.values(it);
    vals.push(op.nome, op.setor, req.params.id, Number(req.params.itemId) || 0);
    const upd = await consultar(
      `UPDATE devolucao_itens
          SET ${sets.join(', ')},
              operador_nome = $${vals.length - 3}, operador_setor = $${vals.length - 2},
              atualizado_em = now()
        WHERE devolucao_id = $${vals.length - 1} AND item_id = $${vals.length}
        RETURNING *`,
      vals
    );
    if (!upd.rows[0]) return res.status(404).json({ erro: 'Item não encontrado.', codigo: 'NAO_ENCONTRADO' });
    await aprenderCliente({ query: consultar }, upd.rows[0]);
    emitirAtualizada(req.params.id);
    res.json(itemParaPainel(upd.rows[0]));
  } catch (e) { next(e); }
});

rotasDevolucoes.delete('/devolucoes/:id/itens/:itemId', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const del = await consultar(
      'DELETE FROM devolucao_itens WHERE devolucao_id = $1 AND item_id = $2 RETURNING item_id',
      [req.params.id, Number(req.params.itemId) || 0]
    );
    if (!del.rows[0]) return res.status(404).json({ erro: 'Item não encontrado.', codigo: 'NAO_ENCONTRADO' });
    emitirAtualizada(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- Divergências (o que chegou fora do checklist) ---------- */

/* Divergentes são escopo EXCLUSIVO dos Controles Internos (decisão do
   usuário, 18/08/2026) — nem a Logística lança por eles. Administração
   continua irrestrita, como em todo o painel. */
rotasDevolucoes.post('/devolucoes/:id/divergencias', exigirLogin, exigirSetor('Controles Internos'), async (req, res, next) => {
  try {
    const op = req.operador;
    const codProduto = String(req.body?.codProduto ?? '').trim().slice(0, 50);
    if (!codProduto) {
      return res.status(400).json({ erro: 'Informe o código do produto que chegou fora do checklist.', codigo: 'PRODUTO_FALTANDO' });
    }
    const dev = await consultar(
      'SELECT devolucao_id FROM devolucoes WHERE devolucao_id = $1 AND excluida_em IS NULL',
      [req.params.id]
    );
    if (!dev.rows[0]) return res.status(404).json({ erro: 'Devolução não encontrada.', codigo: 'NAO_ENCONTRADA' });
    const cx = Number(req.body?.cx);
    const ins = await consultar(
      `INSERT INTO devolucao_divergencias
         (devolucao_id, cod_produto, produto_nome, cx, observacao, lancada_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, codProduto,
       String(req.body?.produtoNome ?? '').slice(0, 200),
       Number.isFinite(cx) ? Math.max(0, cx) : 0,
       String(req.body?.observacao ?? '').slice(0, 500),
       op.nome]
    );
    emitirAtualizada(req.params.id);
    res.status(201).json(divergenciaParaPainel(ins.rows[0]));
  } catch (e) { next(e); }
});

rotasDevolucoes.delete('/devolucoes/:id/divergencias/:divId', exigirLogin, exigirSetor('Controles Internos'), async (req, res, next) => {
  try {
    const del = await consultar(
      'DELETE FROM devolucao_divergencias WHERE devolucao_id = $1 AND divergencia_id = $2 RETURNING divergencia_id',
      [req.params.id, Number(req.params.divId) || 0]
    );
    if (!del.rows[0]) return res.status(404).json({ erro: 'Divergência não encontrada.', codigo: 'NAO_ENCONTRADA' });
    emitirAtualizada(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- Revisões (mesmo padrão das cargas: Administração) ---------- */

rotasDevolucoes.get('/devolucoes/:id/revisoes', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT revisao_id, tabela, dados, gravada_em, mudada_por, mudada_setor
         FROM devolucao_revisoes
        WHERE devolucao_id = $1 AND tabela = 'devolucoes'
        ORDER BY revisao_id DESC LIMIT 100`,
      [req.params.id]
    );
    res.json(rows.map((r) => ({
      revisaoId: Number(r.revisao_id),
      gravadaEm: r.gravada_em,
      mudadaPor: r.mudada_por,
      mudadaSetor: r.mudada_setor,
      devolucao: devolucaoParaPainel(r.dados),
    })));
  } catch (e) { next(e); }
});

rotasDevolucoes.post('/devolucoes/:id/restaurar', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const op = req.operador;
    const revisaoId = Number(req.body?.revisaoId) || 0;
    const resultado = await emTransacao(async (cli) => {
      const rev = await cli.query(
        `SELECT dados FROM devolucao_revisoes
          WHERE devolucao_id = $1 AND revisao_id = $2 AND tabela = 'devolucoes'`,
        [req.params.id, revisaoId]
      );
      if (!rev.rows[0]) {
        const e = new Error('Revisão não encontrada.');
        e.status = 404; e.codigo = 'NAO_ENCONTRADA';
        throw e;
      }
      const d = rev.rows[0].dados;
      /* Os carimbos voltam JUNTO com o status — restaurar "Lançada"
         deixando o carimbo da Portaria na linha criaria um documento que
         diz duas coisas ao mesmo tempo. As ROTAS ficam como estão: vivem
         em devolucao_rotas (migração 012) e não fazem parte do retrato do
         cabeçalho; revisões antigas ainda trazem rota_codigo no JSONB,
         mas é registro histórico, não alvo de restauração. */
      const upd = await cli.query(
        `UPDATE devolucoes SET
            data_dev = $1, regiao = $2, transportadora = $3,
            nota_transferencia = $4, placa = $5, motorista = $6, carga_numero = $7,
            lacre1 = $8, lacre2 = $9, peso_final = $10, status = $11,
            obs_controles = $12, observacoes = $13,
            operador_codigo = COALESCE($27, operador_codigo),
            gerou_rdc = $28, chegou_lacrado = $29,
            portaria_por = $14, portaria_em = $15,
            faturamento_por = $16, faturamento_em = $17,
            expedicao_por = $18, expedicao_em = $19,
            controles_por = $20, controles_em = $21,
            notas_por = $22, notas_em = $23,
            operador_nome = $24, operador_setor = $25,
            atualizado_em = now(), versao = versao + 1
          WHERE devolucao_id = $26 AND excluida_em IS NULL
          RETURNING devolucao_id`,
        [d.data_dev, d.regiao, d.transportadora,
         d.nota_transferencia, d.placa, d.motorista, d.carga_numero,
         d.lacre1, d.lacre2, d.peso_final, d.status,
         d.obs_controles, d.observacoes,
         d.portaria_por, d.portaria_em,
         d.faturamento_por, d.faturamento_em,
         d.expedicao_por, d.expedicao_em,
         d.controles_por, d.controles_em,
         d.notas_por, d.notas_em,
         op.nome, op.setor, req.params.id,
         // Revisões antigas (pré-018) não têm operador_codigo: o COALESCE
         // mantém o valor atual em vez de apagar com null.
         d.operador_codigo ?? null,
         // gerou_rdc restaura direto (pré-022 volta a "não informado", que
         // é o retrato fiel daquela época). Mesma coisa para chegou_lacrado.
         d.gerou_rdc ?? null,
         d.chegou_lacrado ?? null]
      );
      if (!upd.rows[0]) {
        const e = new Error('Devolução não encontrada.');
        e.status = 404; e.codigo = 'NAO_ENCONTRADA';
        throw e;
      }
      await logDevolucao(cli, {
        devolucaoId: req.params.id, operador: op,
        acao: `Devolução restaurada para o estado de ${new Date(d.atualizado_em || d.criado_em).toISOString()} (revisão ${revisaoId})`,
      });
      return buscarCompleta(cli, req.params.id);
    });
    emitirAtualizada(req.params.id);
    res.json(resultado);
  } catch (e) { next(e); }
});

/* ---------- Cadastros de apoio (supervisores, produtos, motivos) ---------- */

rotasDevolucoes.get('/devolucoes-cadastros', exigirLogin, async (req, res, next) => {
  try {
    const [sup, prod, mot, rca, cli] = await Promise.all([
      consultar('SELECT nome FROM dim_supervisores ORDER BY nome'),
      consultar(`SELECT codigo, nome, categoria, temperatura, validade, ean,
                        peso_liquido_txt, peso_caixa_kg, ativo
                   FROM dim_produtos ORDER BY codigo`),
      consultar('SELECT motivo FROM dim_motivos_devolucao ORDER BY motivo'),
      consultar('SELECT nome FROM dim_representantes ORDER BY nome'),
      /* 76 mil clientes NÃO viajam inteiros para o painel — só a contagem.
         A busca é por /devolucoes-cadastros/clientes?q= conforme se
         digita (a lição do datalist: 76k <option> travam o navegador). */
      consultar('SELECT count(*)::int AS total FROM dim_clientes'),
    ]);
    res.json({
      supervisores: sup.rows.map((r) => r.nome),
      representantes: rca.rows.map((r) => r.nome),
      clientesTotal: cli.rows[0].total,
      produtos: prod.rows.map((r) => ({
        codigo: r.codigo,
        nome: r.nome,
        categoria: r.categoria,
        temperatura: r.temperatura,
        validade: r.validade,
        ean: r.ean,
        pesoLiquidoTxt: r.peso_liquido_txt,
        pesoCaixaKg: r.peso_caixa_kg === null ? null : Number(r.peso_caixa_kg),
        ativo: r.ativo,
      })),
      motivos: mot.rows.map((r) => r.motivo),
    });
  } catch (e) { next(e); }
});

rotasDevolucoes.post('/devolucoes-cadastros/supervisores', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const nome = String(req.body?.nome ?? '').trim().slice(0, 100);
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do supervisor.', codigo: 'NOME_FALTANDO' });
    await consultar('INSERT INTO dim_supervisores (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [nome]);
    res.status(201).json({ nome });
  } catch (e) { next(e); }
});

rotasDevolucoes.post('/devolucoes-cadastros/produtos', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const codigo = String(req.body?.codigo ?? '').trim().slice(0, 50);
    if (!codigo) return res.status(400).json({ erro: 'Informe o código do produto.', codigo: 'CODIGO_FALTANDO' });
    const nome = String(req.body?.nome ?? '').trim().slice(0, 200);
    /* Quilo por caixa — mesma lição do capacidadeKg: só a AUSÊNCIA vira
       null; um número válido é preservado como veio. */
    const kgBruto = req.body?.pesoCaixaKg;
    const pesoCaixaKg = kgBruto === '' || kgBruto === null || kgBruto === undefined
      || !Number.isFinite(Number(kgBruto))
      ? null : Math.max(0, Number(kgBruto));
    const { rows } = await consultar(
      `INSERT INTO dim_produtos (codigo, nome, peso_caixa_kg) VALUES ($1,$2,$3)
       ON CONFLICT (codigo) DO UPDATE
         SET nome = EXCLUDED.nome, peso_caixa_kg = EXCLUDED.peso_caixa_kg,
             atualizado_em = now()
       RETURNING codigo, nome, peso_caixa_kg`,
      [codigo, nome, pesoCaixaKg]
    );
    res.status(201).json({
      codigo: rows[0].codigo,
      nome: rows[0].nome,
      pesoCaixaKg: rows[0].peso_caixa_kg === null ? null : Number(rows[0].peso_caixa_kg),
    });
  } catch (e) { next(e); }
});

/* Busca de clientes conforme se digita: código por prefixo, apelido e
   nome por trecho. 30 é o teto — sugestão é para escolher, não para rolar. */
rotasDevolucoes.get('/devolucoes-cadastros/clientes', exigirLogin, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    if (!q) return res.json([]);
    const { rows } = await consultar(
      `SELECT codigo, nome, apelido, vendedor, supervisor
         FROM dim_clientes
        WHERE codigo ILIKE $1 OR apelido ILIKE $2 OR nome ILIKE $2
        ORDER BY (codigo = $3 OR lower(apelido) = lower($3)) DESC, codigo
        LIMIT 30`,
      [q + '%', '%' + q + '%', q]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

/* Exportação completa dos clientes em CSV — gerada no servidor: 76 mil
   linhas não passam pelo JSON do painel. Mesmo formato dos CSVs da tela
   (BOM + ponto-e-vírgula, abre direto no Excel pt-BR). */
rotasDevolucoes.get('/devolucoes-cadastros/clientes-csv', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      'SELECT codigo, nome, apelido, vendedor, supervisor FROM dim_clientes ORDER BY codigo'
    );
    const escapa = (v) => {
      const s = String(v ?? '');
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const corpo = [['Cód. cliente', 'Nome', 'Apelido', 'RCA', 'Supervisor']]
      .concat(rows.map((r) => [r.codigo, r.nome, r.apelido, r.vendedor, r.supervisor]))
      .map((l) => l.map(escapa).join(';')).join('\r\n');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="Suinco_Cadastro_Clientes.csv"');
    res.send('﻿' + corpo);
  } catch (e) { next(e); }
});

rotasDevolucoes.post('/devolucoes-cadastros/clientes', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const codigo = String(req.body?.codigo ?? '').trim().slice(0, 100);
    if (!codigo) return res.status(400).json({ erro: 'Informe o código do cliente.', codigo: 'CODIGO_FALTANDO' });
    const { rows } = await consultar(
      `INSERT INTO dim_clientes (codigo, nome, vendedor, supervisor)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (codigo) DO UPDATE SET
         nome       = COALESCE(NULLIF(EXCLUDED.nome, ''), dim_clientes.nome),
         vendedor   = COALESCE(NULLIF(EXCLUDED.vendedor, ''), dim_clientes.vendedor),
         supervisor = COALESCE(NULLIF(EXCLUDED.supervisor, ''), dim_clientes.supervisor),
         atualizado_em = now()
       RETURNING codigo, nome, vendedor, supervisor`,
      [codigo,
       String(req.body?.nome ?? '').trim().slice(0, 200),
       String(req.body?.vendedor ?? '').trim().slice(0, 100),
       String(req.body?.supervisor ?? '').trim().slice(0, 100)]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

rotasDevolucoes.post('/devolucoes-cadastros/motivos', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 300);
    if (!motivo) return res.status(400).json({ erro: 'Informe o motivo.', codigo: 'MOTIVO_FALTANDO' });
    await consultar('INSERT INTO dim_motivos_devolucao (motivo) VALUES ($1) ON CONFLICT (motivo) DO NOTHING', [motivo]);
    res.status(201).json({ motivo });
  } catch (e) { next(e); }
});
