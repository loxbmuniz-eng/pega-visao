/* QUEM ENTRA NA ABA PAGAMENTO DE FRETE (05/10/2026).
   ---------------------------------------------------------------------
   Pedido do dono: "Daniela, Ana Paula, Karen e Andressa" — pessoas, de
   setores diferentes. Por isso o acesso é uma marca POR PESSOA
   (operadores.acesso_frete, que a Administração liga na tela de Usuários), e
   não por setor. A Administração entra sempre.

   LIDO DO BANCO EM TODA REQUISIÇÃO, não do token: a marca muda sem a pessoa
   sair e entrar, e quem perde o acesso o perde na hora. O custo é uma
   consulta por chave primária.

   SE A COLUNA AINDA NÃO EXISTE (painel novo no ar antes do `atualizar` do
   servidor) a resposta é "sem acesso" — nunca erro 500, e nunca "liberado". */
import { consultar } from '../banco.js';

const COLUNA_AUSENTE = '42703'; // undefined_column do PostgreSQL

export async function acessoFreteDe(operador) {
  if (!operador) return false;
  if (operador.setor === 'Administração') return true;
  try {
    const { rows } = await consultar('SELECT acesso_frete FROM operadores WHERE id = $1 AND ativo = TRUE', [operador.id]);
    return rows[0]?.acesso_frete === true;
  } catch (e) {
    if (e.code === COLUNA_AUSENTE) return false;
    throw e;
  }
}

export async function exigirAcessoFrete(req, res, next) {
  try {
    if (!req.operador) {
      return res.status(401).json({ erro: 'Faça login para continuar.', codigo: 'SEM_TOKEN' });
    }
    if (await acessoFreteDe(req.operador)) return next();
    return res.status(403).json({
      erro: 'A aba Pagamento de Frete é só de quem a Administração liberou.',
      codigo: 'SEM_ACESSO_FRETE',
    });
  } catch (e) { return next(e); }
}
