/* Autenticação por JWT.

   O ponto central: o **setor vem do token, nunca do corpo da requisição**.
   Na versão anterior o setor ficava no localStorage e qualquer um trocava
   pelo console do navegador — a auditoria classificou isso como MÉDIA e
   registrou que não havia como corrigir sem servidor. Agora o setor é lido
   da tabela `operadores` no login, assinado no token, e o cliente não tem
   como alterá-lo sem a chave. */

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { consultar } from '../banco.js';

export function assinarToken(operador) {
  return jwt.sign(
    {
      sub: String(operador.id),
      nome: operador.nome,
      email: operador.email,
      setor: operador.setor,
      /* VERSÃO DE SESSÃO (etapa 2 do protocolo de segurança, 22/08/2026).

         JWT é auto-suficiente por natureza: uma vez assinado, vale até
         expirar, e o servidor não tem como voltar atrás. Isso significava
         que desligar um operador deixava a sessão dele viva por até 12
         horas, em todos os aparelhos onde estivesse aberta.

         O contador resolve sem abandonar JWT: ele viaja no token e é
         conferido contra o banco. Incrementar o contador do operador
         invalida, no mesmo instante, tudo o que ele tem aberto. */
      sv: Number(operador.sessao_versao ?? 1),
    },
    config.jwtSegredo,
    { expiresIn: config.jwtValidade }
  );
}

/* Confere a versão de sessão contra o banco.

   CUSTO: uma consulta indexada por requisição autenticada. Com ~30
   operadores e o volume desta operação, é irrelevante — e a alternativa
   (conferir só na renovação) deixaria de pé exatamente a janela de 12 horas
   que este controle existe para fechar.

   FALHA FECHADA, com uma exceção deliberada: se a consulta falhar por a
   COLUNA não existir (servidor ainda não atualizado), a requisição segue —
   caso contrário publicar o painel novo antes de rodar a migração derrubaria
   os cinco setores de uma vez. Qualquer outra falha barra. */
async function sessaoAindaVale(id, versaoDoToken) {
  try {
    const { rows } = await consultar(
      'SELECT sessao_versao, ativo FROM operadores WHERE id = $1', [id]
    );
    const op = rows[0];
    if (!op) return { vale: false, motivo: 'OPERADOR_INEXISTENTE' };
    if (!op.ativo) return { vale: false, motivo: 'OPERADOR_INATIVO' };
    if (Number(op.sessao_versao) !== Number(versaoDoToken ?? 1)) {
      return { vale: false, motivo: 'SESSAO_REVOGADA' };
    }
    return { vale: true };
  } catch (e) {
    if (/sessao_versao/.test(e.message || '')) {
      console.warn('[auth] coluna sessao_versao ausente — rode a migração 029');
      return { vale: true };
    }
    console.error('[auth] falha ao conferir a sessão:', e.message);
    return { vale: false, motivo: 'SESSAO_NAO_VERIFICAVEL' };
  }
}

function extrairToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

export async function exigirLogin(req, res, next) {
  const token = extrairToken(req);
  if (!token) {
    return res.status(401).json({ erro: 'Faça login para continuar.', codigo: 'SEM_TOKEN' });
  }
  try {
    const p = jwt.verify(token, config.jwtSegredo);

    const sessao = await sessaoAindaVale(p.sub, p.sv);
    if (!sessao.vale) {
      const revogada = sessao.motivo === 'SESSAO_REVOGADA' || sessao.motivo === 'OPERADOR_INATIVO';
      console.warn(`[auth] sessão recusada (${sessao.motivo}) de`, req.ip, p.email || p.sub);
      return res.status(401).json({
        erro: revogada
          ? 'Seu acesso foi encerrado por um administrador. Entre de novo.'
          : 'Não consegui validar sua sessão. Entre de novo.',
        codigo: sessao.motivo,
      });
    }

    req.operador = {
      id: p.sub,
      nome: p.nome,
      email: p.email,
      setor: p.setor,
      verificado: true,
    };
    return next();
  } catch (e) {
    // Distinguir expirado de inválido importa para a experiência: expirado
    // é "faça login de novo", inválido pode ser ataque. O cliente trata os
    // dois igual, mas o log separa.
    const expirou = e.name === 'TokenExpiredError';
    if (!expirou) {
      console.warn('[auth] token inválido de', req.ip);
    }
    return res.status(401).json({
      erro: expirou ? 'Sua sessão expirou. Faça login de novo.' : 'Sessão inválida.',
      codigo: expirou ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
    });
  }
}

/* Restringe uma rota a setores específicos. Complementa (não substitui) a
   validação de transição em dominio/fluxo.js: esta barra a porta, aquela
   confere se o passo faz sentido para a carga naquele momento. */
export function exigirSetor(...setoresPermitidos) {
  const permitidos = new Set([...setoresPermitidos, 'Administração']);
  return (req, res, next) => {
    if (!req.operador) {
      return res.status(401).json({ erro: 'Faça login para continuar.', codigo: 'SEM_TOKEN' });
    }
    if (!permitidos.has(req.operador.setor)) {
      return res.status(403).json({
        erro: `Esta ação é do setor ${setoresPermitidos.join(' ou ')}.`,
        codigo: 'SETOR_SEM_PERMISSAO',
      });
    }
    return next();
  };
}

/* O Power BI não é um operador: é leitura de views, com token próprio e sem
   nenhuma permissão de escrita. Mantê-lo fora do fluxo de JWT evita ter que
   criar um "usuário robô" com senha que ninguém troca nunca. */
export function exigirTokenBI(req, res, next) {
  if (!config.biToken) {
    return res.status(503).json({
      erro: 'Export para BI não está habilitado neste servidor.',
      codigo: 'BI_DESABILITADO',
    });
  }
  const enviado = extrairToken(req) || req.query.token;
  if (!enviado || !comparacaoSegura(enviado, config.biToken)) {
    return res.status(401).json({ erro: 'Token do BI inválido.', codigo: 'BI_TOKEN_INVALIDO' });
  }
  return next();
}

/* Token do robô de WhatsApp — ver config.botToken. Separado do BI de
   propósito: são dois consumidores diferentes, e revogar um não pode
   derrubar o outro. */
export function exigirTokenBot(req, res, next) {
  if (!config.botToken) {
    return res.status(503).json({
      erro: 'O robô de relatórios não está habilitado neste servidor.',
      codigo: 'BOT_DESABILITADO',
    });
  }
  const enviado = extrairToken(req) || req.query.token;
  if (!enviado || !comparacaoSegura(enviado, config.botToken)) {
    return res.status(401).json({ erro: 'Token do robô inválido.', codigo: 'BOT_TOKEN_INVALIDO' });
  }
  return next();
}

/* Comparação em tempo constante. Com `===`, o tempo de resposta vaza quantos
   caracteres iniciais estão certos e o token pode ser descoberto byte a byte.
   É um ataque real contra token comparado ingenuamente. */
function comparacaoSegura(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
