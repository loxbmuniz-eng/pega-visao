import { Router } from 'express';
import { consultar } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';

export const rotasProgramacao = Router();

function novoId(prefixo) {
  return `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* Fechamento de programação — pedido do usuário (08/08/2026): "permitir
   que faça fechamento da programação e começar nova programação somente
   pela logística ou administração, resetando os painéis de todos os
   setores mantendo somente o histórico, para melhor controle de tudo".

   Decisão confirmada com o usuário antes de implementar: se existe carga
   ainda em andamento (qualquer status diferente de "Seguiu Viagem") no
   momento do pedido, a rota RECUSA — nunca esconde um caminhão que ainda
   está fisicamente no pátio das telas operacionais. Só fecha quando o
   pátio já está genuinamente limpo.

   Não apaga nem arquiva nenhuma carga: como só fecha com o pátio vazio,
   as telas "em aberto" (Torre/Portaria/Expedição/Faturamento) já ficam
   vazias sozinhas, sem precisar tocar em dado nenhum — o "reset" é
   consequência de não haver mais nada aberto, não uma ação destrutiva.
   O que esta rota faz de fato é registrar o CHECKPOINT (quem fechou e
   quando, em log_eventos — permanece no Histórico) e avisar ao vivo
   todo mundo conectado, pra não vir a pergunta "já posso programar de
   novo?" pelo WhatsApp. */
rotasProgramacao.post('/programacao/fechar', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const { rows: abertas } = await consultar(
      `SELECT carga_id, numero_carga, placa, status_atual
         FROM fact_viagens
        WHERE status_atual <> 'Seguiu Viagem'
        ORDER BY placa`
    );
    if (abertas.length > 0) {
      return res.status(409).json({
        erro: `Ainda há ${abertas.length} carga(s) em andamento. ` +
          'Feche (Seguiu Viagem) ou cancele todas antes de fechar a programação.',
        codigo: 'CARGAS_EM_ABERTO',
        cargas: abertas.map((c) => ({
          placa: c.placa, numeroCarga: c.numero_carga, status: c.status_atual,
        })),
      });
    }

    const op = req.operador;
    await consultar(
      `INSERT INTO log_eventos
         (evento_id, carga_id, placa, acao, setor, operador_id, operador_nome, operador_verificado)
       VALUES ($1, NULL, '', 'Fechamento de Programação', $2, $3, $4, TRUE)`,
      [novoId('log'), op.setor, op.id, op.nome]
    );

    const quando = new Date().toISOString();
    emitir('programacao:fechada', { operador: op.nome, setor: op.setor, quando });
    return res.json({ ok: true, quando, operador: op.nome });
  } catch (e) {
    return next(e);
  }
});
