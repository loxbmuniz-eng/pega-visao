import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { consultar } from '../banco.js';
import { config } from '../config.js';
import { assinarToken, exigirLogin } from '../middleware/auth.js';

export const rotasAuth = Router();

const limiteLogin = rateLimit({
  windowMs: config.limites.janelaMs,
  limit: config.limites.loginPorJanela,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Espere um minuto.', codigo: 'LIMITE_LOGIN' },
});

rotasAuth.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const senha = String(req.body?.senha ?? '');
    if (!email || !senha) {
      return res.status(400).json({ erro: 'Informe e-mail e senha.', codigo: 'CAMPOS_FALTANDO' });
    }

    const { rows } = await consultar(
      'SELECT id, email, nome, setor, senha_hash, ativo, sessao_versao FROM operadores WHERE email = $1',
      [email]
    );
    const op = rows[0];

    /* Resposta idêntica para "e-mail não existe" e "senha errada". Mensagens
       diferentes entregam quais e-mails são válidos, e aí a força bruta já
       começa sabendo metade. O bcrypt roda mesmo sem usuário encontrado para
       o tempo de resposta não denunciar a diferença. */
    const hash = op?.senha_hash || '$2a$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalido';
    const confere = await bcrypt.compare(senha, hash);

    if (!op || !confere || !op.ativo) {
      if (op && !op.ativo) console.warn('[auth] login de operador inativo:', email);
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.', codigo: 'CREDENCIAL_INVALIDA' });
    }

    await consultar('UPDATE operadores SET ultimo_acesso = now() WHERE id = $1', [op.id]);

    return res.json({
      token: assinarToken(op),
      operador: { id: String(op.id), nome: op.nome, email: op.email, setor: op.setor },
    });
  } catch (e) {
    return next(e);
  }
});

/* Devolve quem o token diz que você é. O painel usa isto na abertura para
   restaurar a sessão sem pedir senha de novo, e para descobrir o setor —
   que ele deixa de guardar no localStorage. */
rotasAuth.get('/eu', exigirLogin, (req, res) => {
  res.json({ operador: req.operador });
});

/* Renova a sessão de quem está trabalhando.

   O token vale 12 horas. Isso protege o terminal compartilhado do pátio —
   sessão eterna faria o turno da noite operar com a identidade de quem
   sentou ali de manhã, e a auditoria passaria a mentir sobre quem fez o
   quê. Mas 12 horas fixas derrubam o terminal no meio do expediente, e
   painel que pede senha com o caminhão na doca é painel que atrapalha.

   A saída é renovar enquanto HOUVER trabalho acontecendo. O painel só
   chama esta rota quando alguém mexeu na tela nas últimas horas; parado,
   ele deixa vencer. Terminal em uso segue vivo, terminal esquecido aberto
   morre sozinho.

   A renovação relê o operador no BANCO, não no token. Isso é de propósito
   e vale mais que a conveniência: quem foi desativado perde o acesso na
   renovação seguinte, e quem mudou de setor passa a valer no setor novo
   sem precisar sair e entrar. Sem esta releitura, desativar alguém só teria
   efeito 12 horas depois. */
rotasAuth.post('/renovar', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      'SELECT id, email, nome, setor, ativo, sessao_versao FROM operadores WHERE id = $1',
      [req.operador.id]
    );
    const op = rows[0];
    if (!op || !op.ativo) {
      return res.status(401).json({
        erro: 'Seu acesso foi desativado. Fale com a Administração.',
        codigo: 'OPERADOR_INATIVO',
      });
    }
    return res.json({
      token: assinarToken(op),
      operador: { id: String(op.id), nome: op.nome, email: op.email, setor: op.setor },
    });
  } catch (e) {
    return next(e);
  }
});
