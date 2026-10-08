/* POST /api/erros — o painel avisa o erro que aconteceu na tela (08/10/2026).

   Decisão 27: o painel não fala com o Sentry; fala com ESTA rota, e o
   servidor repassa (servicos/erros.js). Um ponto só de filtro, nenhum
   endereço de terceiro no navegador, nenhuma mudança na política de
   segurança do site.

   COM LOGIN, como toda rota de operação (barreira da bateria de
   segurança, SEGURANÇA 3). Erro na tela de entrada fica de fora — e não faz
   falta: se a entrada quebra, ninguém entra, e isso ninguém deixa de ver.
   Com login, ninguém de fora gasta a cota do Sentry. Freio próprio: 30
   avisos por minuto POR PESSOA (o pátio inteiro sai pelo mesmo IP), além do
   limite geral; e o que entra é cortado e limpo antes de ir a qualquer
   lugar. O SETOR vem do crachá, nunca do corpo (a regra da casa).

   Responde 202 na hora: o painel não espera o Sentry, e nada que aconteça
   aqui pode virar um segundo erro na tela. Sem SENTRY_DSN, o aviso fica só
   no journal do servidor (`[erro do painel]`). */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { exigirLogin } from '../middleware/auth.js';
import { avisarErro, avisoLigado, limparTexto } from '../servicos/erros.js';

export const rotasErros = Router();

export const AVISOS_POR_MINUTO = 30;

const freioDoPainel = rateLimit({
  windowMs: 60_000,
  limit: AVISOS_POR_MINUTO,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `op:${req.operador.id}`,
  message: { erro: 'Muitos avisos de erro no último minuto.', codigo: 'LIMITE_AVISOS_DE_ERRO' },
});

const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

rotasErros.post('/erros', exigirLogin, freioDoPainel, (req, res) => {
  const corpo = req.body && typeof req.body === 'object' ? req.body : {};
  const mensagem = texto(corpo.mensagem, 1000);
  if (!mensagem) {
    return res.status(422).json({ erro: 'Aviso de erro sem mensagem.', codigo: 'AVISO_SEM_MENSAGEM' });
  }
  const dados = {
    origem: 'painel',
    tipo: texto(corpo.tipo, 60) || 'Error',
    mensagem,
    pilha: texto(corpo.pilha, 4000),
    onde: texto(corpo.tela, 60),
    setor: req.operador.setor || '',
    versao: texto(corpo.versao, 60),
  };
  console.warn('[erro do painel]', dados.setor, '·', dados.onde || '?', '·',
    limparTexto(`${dados.tipo}: ${dados.mensagem}`));
  // Sem await: o painel não espera o Sentry. avisarErro nunca lança.
  avisarErro(dados);
  return res.status(202).json({ recebido: true, ligado: avisoLigado('painel') });
});
