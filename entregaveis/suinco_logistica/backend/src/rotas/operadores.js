/* Gestão de operadores pela interface.

   Existe para tirar o cadastro de usuário do SSH. Enquanto criar um
   porteiro exigia abrir terminal e rodar script, a operação dependia de
   alguém com acesso ao servidor toda vez que entrasse gente nova — o que
   não se sustenta e acaba virando senha compartilhada.

   TUDO AQUI É RESTRITO À ADMINISTRAÇÃO. É a rota mais sensível da API:
   quem cria usuário cria acesso, e quem troca setor troca permissão. */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { consultar } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { SETORES } from '../config.js';

export const rotasOperadores = Router();

const CUSTO_BCRYPT = 12;
const SENHA_MINIMA = 8;

/* Sessão válida E setor Administração em toda rota deste arquivo.

   Declarado como constante e aplicado rota a rota, e NÃO com
   `rotasOperadores.use(...)`. O `use()` sem caminho vira pega-tudo: como
   este router é montado em `/api`, qualquer endereço inexistente sob /api
   caía nele e respondia 403 "esta ação é da Administração" em vez de 404.
   Um teste pegou; o efeito prático seria mandar quem digitou errado
   procurar um problema de permissão que não existe. */
const SO_ADMIN = [exigirLogin, exigirSetor('Administração')];

function saneiarEmail(v) {
  return String(v ?? '').trim().toLowerCase().slice(0, 200);
}

// Validação simples de propósito: e-mail aqui é identificador de login, não
// endereço para enviar mensagem. Regra rígida demais barraria formato
// interno legítimo sem ganho nenhum.
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

rotasOperadores.get('/operadores', SO_ADMIN, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT id, email, nome, setor, ativo, criado_em, ultimo_acesso
         FROM operadores ORDER BY ativo DESC, setor, nome`
    );
    // senha_hash NUNCA sai daqui. Mesmo sendo hash, exportá-lo permitiria
    // ataque de dicionário offline com todo o tempo do mundo.
    res.json(rows.map((o) => ({
      id: String(o.id),
      email: o.email,
      nome: o.nome,
      setor: o.setor,
      ativo: o.ativo,
      criadoEm: o.criado_em,
      ultimoAcesso: o.ultimo_acesso,
    })));
  } catch (e) { next(e); }
});

rotasOperadores.post('/operadores', SO_ADMIN, async (req, res, next) => {
  try {
    const email = saneiarEmail(req.body?.email);
    const nome = String(req.body?.nome ?? '').trim().slice(0, 200);
    const setor = String(req.body?.setor ?? '');
    const senha = String(req.body?.senha ?? '');

    if (!EMAIL_OK.test(email)) {
      return res.status(400).json({ erro: 'E-mail inválido.', codigo: 'EMAIL_INVALIDO' });
    }
    if (!nome) {
      return res.status(400).json({ erro: 'Informe o nome.', codigo: 'NOME_FALTANDO' });
    }
    if (!SETORES.includes(setor)) {
      return res.status(400).json({
        erro: `Setor inválido. Válidos: ${SETORES.join(', ')}.`, codigo: 'SETOR_INVALIDO',
      });
    }
    if (senha.length < SENHA_MINIMA) {
      return res.status(400).json({
        erro: `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`, codigo: 'SENHA_CURTA',
      });
    }

    const jaExiste = await consultar('SELECT 1 FROM operadores WHERE email = $1', [email]);
    if (jaExiste.rows[0]) {
      return res.status(409).json({
        erro: `Já existe um operador com o e-mail ${email}.`, codigo: 'EMAIL_DUPLICADO',
      });
    }

    const hash = await bcrypt.hash(senha, CUSTO_BCRYPT);
    const { rows } = await consultar(
      `INSERT INTO operadores (email, nome, setor, senha_hash) VALUES ($1,$2,$3,$4)
       RETURNING id, email, nome, setor, ativo, criado_em`,
      [email, nome, setor, hash]
    );
    console.log(`[operadores] ${req.operador.nome} criou ${email} (${setor})`);
    res.status(201).json({ ...rows[0], id: String(rows[0].id) });
  } catch (e) { next(e); }
});

rotasOperadores.patch('/operadores/:id', SO_ADMIN, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });
    }

    const { rows: atual } = await consultar(
      'SELECT id, email, nome, setor, ativo FROM operadores WHERE id = $1', [id]
    );
    if (!atual[0]) {
      return res.status(404).json({ erro: 'Operador não encontrado.', codigo: 'NAO_ENCONTRADO' });
    }

    const campos = {};
    if (req.body?.nome !== undefined) {
      const nome = String(req.body.nome).trim().slice(0, 200);
      if (!nome) return res.status(400).json({ erro: 'Nome não pode ficar vazio.', codigo: 'NOME_FALTANDO' });
      campos.nome = nome;
    }
    if (req.body?.setor !== undefined) {
      if (!SETORES.includes(req.body.setor)) {
        return res.status(400).json({ erro: 'Setor inválido.', codigo: 'SETOR_INVALIDO' });
      }
      campos.setor = req.body.setor;
    }
    if (req.body?.ativo !== undefined) campos.ativo = req.body.ativo === true;
    if (req.body?.senha !== undefined) {
      const senha = String(req.body.senha);
      if (senha.length < SENHA_MINIMA) {
        return res.status(400).json({
          erro: `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`, codigo: 'SENHA_CURTA',
        });
      }
      campos.senha_hash = await bcrypt.hash(senha, CUSTO_BCRYPT);
    }

    if (!Object.keys(campos).length) {
      return res.status(400).json({ erro: 'Nada a alterar.', codigo: 'SEM_CAMPOS' });
    }

    /* TRAVA CONTRA SE TRANCAR DO LADO DE FORA.

       Um administrador que se desative, ou que mude o próprio setor,
       perde o acesso à tela que usaria para desfazer isso — e aí só volta
       por SSH, que é justamente o que esta tela existe para evitar.

       A regra não é paternalismo: é que o erro é irreversível pela
       própria interface. Para outro administrador não há trava. */
    const ehVoceMesmo = String(id) === String(req.operador.id);
    if (ehVoceMesmo && campos.ativo === false) {
      return res.status(409).json({
        erro: 'Você não pode desativar a si mesmo. Peça a outro administrador.',
        codigo: 'AUTO_DESATIVACAO',
      });
    }
    if (ehVoceMesmo && campos.setor && campos.setor !== 'Administração') {
      return res.status(409).json({
        erro: 'Você não pode tirar a si mesmo da Administração — perderia o acesso a esta tela.',
        codigo: 'AUTO_REBAIXAMENTO',
      });
    }

    /* E não pode sobrar zero administrador ativo. Sem isso, desativar o
       último administrador deixaria o sistema sem ninguém capaz de criar
       usuário — recuperável só por SSH. */
    const perdeAdmin = (campos.ativo === false && atual[0].setor === 'Administração')
      || (campos.setor && campos.setor !== 'Administração' && atual[0].setor === 'Administração');
    if (perdeAdmin) {
      const { rows: c } = await consultar(
        "SELECT count(*)::int AS n FROM operadores WHERE setor = 'Administração' AND ativo = TRUE AND id <> $1",
        [id]
      );
      if (c[0].n === 0) {
        return res.status(409).json({
          erro: 'Este é o último administrador ativo. Promova outro antes de alterá-lo.',
          codigo: 'ULTIMO_ADMIN',
        });
      }
    }

    const cols = Object.keys(campos);
    const { rows } = await consultar(
      `UPDATE operadores SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}
        WHERE id = $${cols.length + 1}
        RETURNING id, email, nome, setor, ativo, criado_em, ultimo_acesso`,
      [...Object.values(campos), id]
    );

    const oque = cols.filter((c) => c !== 'senha_hash');
    if (cols.includes('senha_hash')) oque.push('senha');
    console.log(`[operadores] ${req.operador.nome} alterou ${atual[0].email}: ${oque.join(', ')}`);

    res.json({ ...rows[0], id: String(rows[0].id) });
  } catch (e) { next(e); }
});

/* Não existe DELETE de propósito.

   O log de auditoria referencia o operador. Apagar quem registrou a saída
   de um caminhão destrói a rastreabilidade justamente do caso em que ela
   seria consultada. Desativar bloqueia o acesso e preserva o histórico —
   é o que a auditoria precisa e o que a LGPD tolera muito melhor. */
