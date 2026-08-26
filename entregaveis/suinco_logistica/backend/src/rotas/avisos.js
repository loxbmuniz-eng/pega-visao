/* AVISO NO CELULAR — rotas
   ---------------------------------------------------------------------
   Quatro rotas e nada mais: pegar a chave pública, inscrever o aparelho,
   desinscrever, e mandar um teste para si mesmo.

   O ENVIO NÃO TEM ROTA. Ninguém dispara notificação para os outros por
   aqui — os avisos saem sozinhos dos três fatos que o dono pediu (entrada,
   saída, fim da programação), lá em rotas/cargas.js. Uma rota "mandar
   aviso para o setor X" seria a porta perfeita para alguém apitar o
   celular do pátio inteiro, e não existe motivo de operação para ela. */

import { Router } from 'express';
import { exigirLogin } from '../middleware/auth.js';
import {
  ligado,
  chavePublicaDoPainel,
  inscrever,
  desinscrever,
  inscricoesDoOperador,
  enviarParaOperador,
} from '../servicos/avisos.js';

export const rotasAvisos = Router();

/* Estado + chave pública numa consulta só.

   `ligado: false` não é erro: é a resposta honesta de um servidor sem
   VAPID configurado. O painel lê isso e mostra "avisos indisponíveis" em
   vez de oferecer um botão que não faria nada. */
rotasAvisos.get('/avisos/chave', exigirLogin, async (req, res, next) => {
  try {
    const inscricoes = ligado() ? await inscricoesDoOperador(req.operador.id) : [];
    return res.json({
      ligado: ligado(),
      chavePublica: chavePublicaDoPainel(),
      aparelhos: inscricoes.length,
    });
  } catch (e) {
    return next(e);
  }
});

/* O aparelho pede para receber.

   A inscrição vem do NAVEGADOR — é ele quem fala com a Google/Apple e
   recebe o endereço. O servidor só guarda, amarrado a quem está logado
   AGORA. É o que sustenta o "caso estejam logados" do pedido: a inscrição
   pertence à conta, não ao aparelho solto. */
rotasAvisos.post('/avisos/inscrever', exigirLogin, async (req, res, next) => {
  try {
    if (!ligado()) {
      return res.status(503).json({
        erro: 'O aviso no celular ainda não foi ligado neste servidor.',
        codigo: 'AVISOS_DESLIGADOS',
      });
    }
    await inscrever(req.operador.id, req.body?.inscricao, req.body?.aparelho);
    return res.status(201).json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

/* Desliga NAQUELE aparelho, e só nele.

   Sem exigir que a inscrição seja do próprio operador de propósito: o
   endpoint é um segredo que só o dono do aparelho tem, e o caso real que
   isto precisa cobrir é o terminal compartilhado do pátio, onde quem
   está logado agora não é necessariamente quem inscreveu. Deixar de
   apagar ali significaria o celular do turno anterior apitando para
   sempre. O estrago possível no outro sentido é alguém desligar o próprio
   aviso — o que é justamente a intenção do botão. */
rotasAvisos.post('/avisos/desinscrever', exigirLogin, async (req, res, next) => {
  try {
    const removidas = await desinscrever(String(req.body?.endpoint || ''));
    return res.json({ ok: true, removidas });
  } catch (e) {
    return next(e);
  }
});

/* Mandar um teste para si mesmo.

   Não é enfeite. Sem isto, a pessoa só descobre que o aviso não chega no
   dia em que precisava dele — que é exatamente o problema do backup que
   nunca foi restaurado, na versão notificação. */
rotasAvisos.post('/avisos/testar', exigirLogin, async (req, res, next) => {
  try {
    if (!ligado()) {
      return res.status(503).json({
        erro: 'O aviso no celular ainda não foi ligado neste servidor.',
        codigo: 'AVISOS_DESLIGADOS',
      });
    }
    const r = await enviarParaOperador(req.operador.id, {
      titulo: 'Aviso de teste',
      corpo: `Funcionou, ${req.operador.nome.split(' ')[0]}. É assim que os avisos vão chegar.`,
      tag: 'teste',
    });
    if (r.alvos === 0) {
      return res.status(409).json({
        erro: 'Este aparelho ainda não está inscrito. Ligue o aviso antes de testar.',
        codigo: 'SEM_APARELHO',
      });
    }
    return res.json(r);
  } catch (e) {
    return next(e);
  }
});
