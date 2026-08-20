/* AS ROTAS DO ROBÔ DE RELATÓRIOS (n8n → WhatsApp).
   =====================================================================

   Pedido do gestor (20/08/2026): "gerar relatórios e enviar automaticamente
   a cada 3 horas pelo WhatsApp no grupo do alinhamento carregamento".

   Quem chama isto é o n8n, rodando no mesmo VPS. Duas rotas, as duas de
   LEITURA e as duas atrás do BOT_TOKEN:

     GET /bot/resumo     → JSON com os números do dia + o texto pronto
     GET /bot/relatorio  → o PDF do Relatório Operacional do dia

   Por que token próprio e não login de operador: automação não deve
   carregar senha de gente. O token só lê; com ele na mão o estrago
   possível é alguém saber o andamento do pátio. E revogar o do robô (trocar
   uma linha do .env) não derruba o Power BI nem o login de ninguém.

   O LIMITE é apertado de propósito: o robô legítimo chama 8 vezes por dia.
   Qualquer coisa acima de um punhado por minuto é engano de configuração
   (um cron errado, um "retry" infinito) — e gerar PDF sobe um Chromium, que
   é a operação mais cara do servidor. */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { exigirTokenBot } from '../middleware/auth.js';
import { resumoDoDia } from '../dominio/resumo_bot.js';
import { pdfOperacionalDoDia } from '../servicos/relatorio_headless.js';
import { nomeArquivoSeguro } from '../servicos/pdf.js';

export const rotasBot = Router();

const limitadorBot = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas chamadas do robô em pouco tempo.', codigo: 'LIMITE_EXCEDIDO' },
});

rotasBot.get('/resumo', limitadorBot, exigirTokenBot, async (req, res, next) => {
  try {
    return res.json(await resumoDoDia());
  } catch (e) {
    return next(e);
  }
});

rotasBot.get('/relatorio', limitadorBot, exigirTokenBot, async (req, res, next) => {
  try {
    /* `?dia=AAAA-MM-DD` existe para reenviar o relatório de um dia que já
       passou (o gestor pedindo "manda o de ontem"). Sem parâmetro, é o dia
       corrente — que é o caso das 8 chamadas automáticas. */
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dia || '')) ? String(req.query.dia) : null;
    const bytes = await pdfOperacionalDoDia({ dia });
    const nome = nomeArquivoSeguro(`Suinco-Relatorio-Operacional-${dia || 'hoje'}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`);
    return res.send(bytes);
  } catch (e) {
    return next(e);
  }
});
