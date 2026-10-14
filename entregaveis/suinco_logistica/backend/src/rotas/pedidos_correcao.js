/* =====================================================================
   CORREÇÃO SEM TELEFONEMA (14/10/2026, aprovado pelo dono: "marcha fio")
   ---------------------------------------------------------------------
   Quem avançou a etapa por engano — o setor dono do passo (Portaria,
   Expedição, Faturamento) ou a Logística, que cobre todos os passos — PEDE
   voltar a carga para onde ela estava, com motivo. A Administração recebe
   no celular e aprova ou recusa no painel.

   APROVAR É A MESMA CORREÇÃO DE SEMPRE: `aplicarCorrecaoDeEtapa`, a função
   da rota corrigir-etapa (rotas/cargas.js). Uma função, dois chamadores — a
   trilha diz quem pediu, por quê, e quem aprovou.

   PEDIR NÃO MUDA A CARGA. A máquina de estados segue de sentido único para
   quem opera; quem decide é a Administração, dentro de uma transação que
   confere se a carga ainda está na etapa do pedido.

   SEM A MIGRAÇÃO 067 o pedido responde 503 explicado e a lista vem vazia:
   a tela não quebra, e a correção segue como antes, pela Administração.
   ===================================================================== */
import { Router } from 'express';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';
import { idSeguro } from '../dominio/cargas.js';
import { STATUS_FLOW, regraDaTransicao, listaDeSetores } from '../dominio/fluxo.js';
import { aplicarCorrecaoDeEtapa, avisarCorrecaoAplicada, gravarNota } from './cargas.js';
import { avisarPedidoDeCorrecao, avisarDecisaoDaCorrecao } from '../servicos/avisos.js';

export const rotasPedidosCorrecao = Router();

const SEM_MIGRACAO_067 = {
  erro: 'O servidor ainda não tem o pedido de correção — falta a atualização do servidor. '
    + 'Até lá, a Administração corrige a etapa pelo Histórico.',
  codigo: 'CORRECAO_SEM_MIGRACAO',
};

async function existePedidoDeCorrecao(cx) {
  const { rows } = await cx.query("SELECT to_regclass('public.pedidos_correcao') IS NOT NULL AS existe");
  return !!(rows[0] && rows[0].existe);
}

const COLUNAS_PEDIDO = `p.pedido_id, p.carga_id, p.de_status, p.para_status, p.motivo,
  p.pedido_por_id, p.pedido_por, p.pedido_setor, p.pedido_em,
  p.decisao, p.decidido_por, p.decidido_em, p.obs_decisao,
  c.numero_carga, c.placa`;

function paraPainelPedido(l) {
  return {
    id: Number(l.pedido_id),
    cargaId: l.carga_id,
    numeroCarga: l.numero_carga || '',
    placa: l.placa || '',
    deStatus: l.de_status,
    paraStatus: l.para_status,
    motivo: l.motivo,
    pedidoPor: l.pedido_por,
    pedidoSetor: l.pedido_setor,
    pedidoEm: l.pedido_em,
    decisao: l.decisao || null,
    decididoPor: l.decidido_por || null,
    decididoEm: l.decidido_em || null,
    obsDecisao: l.obs_decisao || '',
  };
}

async function pedidoPorId(cx, pedidoId, travar = false) {
  const { rows } = await cx.query(
    `SELECT ${COLUNAS_PEDIDO} FROM pedidos_correcao p
       JOIN fact_viagens c ON c.carga_id = p.carga_id
      WHERE p.pedido_id = $1 ${travar ? 'FOR UPDATE OF p' : ''}`,
    [pedidoId]
  );
  return rows[0] || null;
}

/* Para onde a carga VOLTA: a etapa em que ela estava antes de entrar na
   atual, lida da última movimentação — não a etapa anterior da lista. A
   saída só de devolução vai de "Aguardando Embarque" direto para "Seguiu
   Viagem"; voltar para "Faturado" inventaria um faturamento. Se a última
   movimentação não for um passo para a frente (foi uma correção), vale a
   anterior da lista. */
async function etapaAnterior(cli, carga) {
  const atual = STATUS_FLOW.indexOf(carga.status_atual);
  if (atual <= 0) return null;
  const { rows } = await cli.query(
    `SELECT status_anterior FROM fact_statusfrota
      WHERE carga_id = $1 AND status_novo = $2
        AND status_anterior IS NOT NULL AND status_anterior <> status_novo
      ORDER BY data_evento DESC LIMIT 1`,
    [carga.carga_id, carga.status_atual]
  );
  const veio = rows[0] && rows[0].status_anterior;
  const i = STATUS_FLOW.indexOf(veio);
  return i >= 0 && i < atual ? veio : STATUS_FLOW[atual - 1];
}

rotasPedidosCorrecao.post('/cargas/:id/pedir-correcao', exigirLogin, async (req, res, next) => {
  try {
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });
    const op = req.operador;
    if (op.setor === 'Administração') {
      return res.status(400).json({
        erro: 'A Administração não precisa pedir: corrige a etapa direto no Histórico, em Correções da Administração.',
        codigo: 'ADMINISTRACAO_CORRIGE_DIRETO',
      });
    }
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
    if (!motivo) {
      return res.status(400).json({
        erro: 'Diga o motivo — é ele que a Administração lê no celular para decidir.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }
    if (!(await existePedidoDeCorrecao({ query: consultar }))) return res.status(503).json(SEM_MIGRACAO_067);

    const r = await emTransacao(async (cli) => {
      const { rows } = await cli.query(
        `SELECT carga_id, placa, status_atual FROM fact_viagens
          WHERE carga_id = $1 AND excluida_em IS NULL FOR UPDATE`,
        [id]
      );
      const carga = rows[0];
      if (!carga) return { erro: [404, 'CARGA_NAO_ENCONTRADA', 'Carga não encontrada.'] };
      const para = await etapaAnterior(cli, carga);
      if (!para) {
        return { erro: [409, 'NADA_A_VOLTAR', `A carga está em "${carga.status_atual}", a primeira etapa — não há para onde voltar.`] };
      }
      /* Quem pede é quem pode dar o passo que está sendo desfeito. Passo que
         não está na lista (a carga chegou aqui por uma correção) fica com a
         Logística, que cobre todos os postos. */
      const regra = regraDaTransicao(para, carga.status_atual);
      const podem = regra ? regra.setores : ['Logística'];
      if (!podem.includes(op.setor)) {
        return { erro: [403, 'SETOR_SEM_PERMISSAO',
          `Quem registrou "${carga.status_atual}" foi ${listaDeSetores(podem)} — o pedido é de quem deu o passo. `
          + 'A Administração também corrige direto pelo Histórico.'] };
      }
      const { rows: novo } = await cli.query(
        `INSERT INTO pedidos_correcao
           (carga_id, de_status, para_status, motivo, pedido_por_id, pedido_por, pedido_setor)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING pedido_id`,
        [id, carga.status_atual, para, motivo, op.id, op.nome, op.setor]
      );
      await gravarNota(cli, {
        cargaId: id, placa: carga.placa, operador: op,
        acao: `Pedido de correção: ${carga.status_atual} → ${para}. Motivo: ${motivo}`,
      });
      return { pedido: await pedidoPorId(cli, novo[0].pedido_id) };
    }).catch((e) => {
      if (e.code === '23505') {
        return { erro: [409, 'PEDIDO_JA_ABERTO', 'Esta carga já tem um pedido de correção esperando a Administração.'] };
      }
      throw e;
    });

    if (r.erro) return res.status(r.erro[0]).json({ codigo: r.erro[1], erro: r.erro[2] });
    const pedido = paraPainelPedido(r.pedido);
    emitir('correcao:pedido', pedido);
    avisarPedidoDeCorrecao(pedido).catch(() => {});
    return res.status(201).json(pedido);
  } catch (e) {
    return next(e);
  }
});

/* Os pedidos ABERTOS: a Administração vê todos; cada setor vê os seus
   (quem pediu acompanha o próprio pedido na linha do tempo da carga). */
rotasPedidosCorrecao.get('/pedidos-correcao', exigirLogin, async (req, res, next) => {
  try {
    if (!(await existePedidoDeCorrecao({ query: consultar }))) return res.json([]);
    const op = req.operador;
    const todos = op.setor === 'Administração';
    const { rows } = await consultar(
      `SELECT ${COLUNAS_PEDIDO} FROM pedidos_correcao p
         JOIN fact_viagens c ON c.carga_id = p.carga_id
        WHERE p.decisao IS NULL ${todos ? '' : 'AND p.pedido_setor = $1'}
        ORDER BY p.pedido_em`,
      todos ? [] : [op.setor]
    );
    return res.json(rows.map(paraPainelPedido));
  } catch (e) {
    return next(e);
  }
});

rotasPedidosCorrecao.post('/pedidos-correcao/:id/decidir', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const pedidoId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      return res.status(400).json({ erro: 'Pedido inválido.', codigo: 'ID_INVALIDO' });
    }
    const decisao = String(req.body?.decisao ?? '');
    if (decisao !== 'aprovado' && decisao !== 'recusado') {
      return res.status(400).json({ erro: 'A decisão é "aprovado" ou "recusado".', codigo: 'DECISAO_INVALIDA' });
    }
    const obs = String(req.body?.obs ?? '').trim().slice(0, 500);
    if (!(await existePedidoDeCorrecao({ query: consultar }))) return res.status(503).json(SEM_MIGRACAO_067);
    const op = req.operador;

    const r = await emTransacao(async (cli) => {
      const p = await pedidoPorId(cli, pedidoId, true);
      if (!p) return { erro: [404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido de correção não encontrado.'] };
      if (p.decisao) {
        return { erro: [409, 'PEDIDO_JA_DECIDIDO', `Este pedido já foi ${p.decisao} por ${p.decidido_por}.`] };
      }
      let correcao = null;
      if (decisao === 'aprovado') {
        correcao = await aplicarCorrecaoDeEtapa(cli, {
          id: p.carga_id,
          statusNovo: p.para_status,
          exigirStatus: p.de_status,
          op,
          complemento: `Pedido de ${p.pedido_por} (${p.pedido_setor}): ${p.motivo}. Aprovado por ${op.nome}.`,
        });
        if (correcao.naoEncontrada) {
          return { erro: [404, 'CARGA_NAO_ENCONTRADA', 'A carga do pedido não está mais no painel (foi excluída).'] };
        }
        if (correcao.mudou) {
          return { erro: [409, 'CARGA_MUDOU_DE_ETAPA',
            `A carga andou desde o pedido: está em "${correcao.linha.status_atual}", não em "${p.de_status}". `
            + 'Recuse este pedido ou corrija a etapa direto pelo Histórico.'] };
        }
      } else {
        await gravarNota(cli, {
          cargaId: p.carga_id, placa: p.placa, operador: op,
          acao: `Pedido de correção RECUSADO pela Administração (${p.de_status} → ${p.para_status}, `
            + `pedido de ${p.pedido_por} (${p.pedido_setor})).${obs ? ` Observação: ${obs}` : ''}`,
        });
      }
      await cli.query(
        `UPDATE pedidos_correcao
            SET decisao = $1, decidido_por_id = $2, decidido_por = $3, decidido_em = now(), obs_decisao = $4
          WHERE pedido_id = $5`,
        [decisao, op.id, op.nome, obs, pedidoId]
      );
      return { pedido: await pedidoPorId(cli, pedidoId), correcao, pedidoPorId: p.pedido_por_id };
    });

    if (r.erro) return res.status(r.erro[0]).json({ codigo: r.erro[1], erro: r.erro[2] });
    if (r.correcao) avisarCorrecaoAplicada(r.correcao, op);
    const pedido = paraPainelPedido(r.pedido);
    emitir('correcao:pedido', pedido);
    avisarDecisaoDaCorrecao(pedido, r.pedidoPorId).catch(() => {});
    return res.json(pedido);
  } catch (e) {
    return next(e);
  }
});
