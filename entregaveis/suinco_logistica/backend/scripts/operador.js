#!/usr/bin/env node
/* Cria ou atualiza um operador.

   Uso:
     node scripts/operador.js criar  ana@suinco.com.br "Ana Silva" Logística
     node scripts/operador.js senha  ana@suinco.com.br
     node scripts/operador.js listar
     node scripts/operador.js desativar ana@suinco.com.br

   A senha NUNCA vem por argumento de linha de comando: argumento fica no
   histórico do shell (~/.bash_history) e aparece para qualquer um que rode
   `ps` enquanto o comando executa. Ela é digitada, com eco desligado.

   Se o terminal não for interativo (script automatizado), o script gera uma
   senha aleatória forte e a imprime uma vez. */

import readline from 'node:readline';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../src/banco.js';
import { SETORES } from '../src/config.js';

const CUSTO_BCRYPT = 12; // ~250 ms por hash: caro para ataque, imperceptível no login.

function perguntarSenha(rotulo) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const gerada = crypto.randomBytes(12).toString('base64url');
      console.log(`\n  Terminal não interativo — senha gerada: ${gerada}`);
      console.log('  Anote agora. Ela não será mostrada de novo.\n');
      return resolve(gerada);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(rotulo);
    // Eco desligado: a senha não aparece na tela nem fica no scrollback.
    rl.input.on('data', () => readline.moveCursor(process.stdout, -100, 0));
    rl.question('', (v) => { rl.close(); process.stdout.write('\n'); resolve(v); });
  });
}

async function criar(email, nome, setor) {
  if (!email || !nome || !setor) {
    console.error('Uso: node scripts/operador.js criar <email> "<nome>" <setor>');
    process.exit(1);
  }
  if (!SETORES.includes(setor)) {
    console.error(`Setor inválido: "${setor}". Válidos: ${SETORES.join(', ')}`);
    process.exit(1);
  }
  const senha = await perguntarSenha(`Senha para ${email}: `);
  if (senha.length < 8) {
    console.error('Senha curta demais (mínimo 8 caracteres).');
    process.exit(1);
  }
  const hash = await bcrypt.hash(senha, CUSTO_BCRYPT);
  await pool.query(
    `INSERT INTO operadores (email, nome, setor, senha_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome, setor = EXCLUDED.setor,
           senha_hash = EXCLUDED.senha_hash, ativo = TRUE`,
    [email.toLowerCase(), nome, setor, hash]
  );
  console.log(`OK: ${nome} <${email}> — setor ${setor}.`);
}

async function trocarSenha(email) {
  const { rows } = await pool.query('SELECT nome FROM operadores WHERE email = $1', [email.toLowerCase()]);
  if (!rows[0]) { console.error(`Operador não encontrado: ${email}`); process.exit(1); }
  const senha = await perguntarSenha(`Nova senha para ${email}: `);
  if (senha.length < 8) { console.error('Senha curta demais (mínimo 8 caracteres).'); process.exit(1); }
  await pool.query('UPDATE operadores SET senha_hash = $1 WHERE email = $2',
    [await bcrypt.hash(senha, CUSTO_BCRYPT), email.toLowerCase()]);
  console.log(`OK: senha de ${rows[0].nome} trocada.`);
}

async function listar() {
  const { rows } = await pool.query(
    'SELECT email, nome, setor, ativo, ultimo_acesso FROM operadores ORDER BY setor, nome'
  );
  if (!rows.length) { console.log('Nenhum operador cadastrado.'); return; }
  console.log('\n  SETOR          NOME                     E-MAIL                        ÚLTIMO ACESSO');
  for (const r of rows) {
    const quando = r.ultimo_acesso ? new Date(r.ultimo_acesso).toLocaleString('pt-BR') : 'nunca';
    const marca = r.ativo ? ' ' : '✗';
    console.log(`${marca} ${r.setor.padEnd(14)} ${r.nome.padEnd(24)} ${r.email.padEnd(29)} ${quando}`);
  }
  console.log(`\n  ${rows.length} operador(es). ✗ = desativado.\n`);
}

async function desativar(email) {
  const { rowCount } = await pool.query(
    'UPDATE operadores SET ativo = FALSE WHERE email = $1', [email.toLowerCase()]
  );
  // Desativa em vez de apagar: o log de auditoria referencia o operador, e
  // apagar quem registrou a saída de um caminhão destrói a rastreabilidade.
  console.log(rowCount ? `OK: ${email} desativado (histórico preservado).` : `Não encontrado: ${email}`);
}

const [acao, ...args] = process.argv.slice(2);
const acoes = { criar, senha: trocarSenha, listar, desativar };

if (!acoes[acao]) {
  console.log(`
Uso:
  node scripts/operador.js criar <email> "<nome>" <setor>
  node scripts/operador.js senha <email>
  node scripts/operador.js listar
  node scripts/operador.js desativar <email>

Setores: ${SETORES.join(', ')}
`);
  process.exit(1);
}

acoes[acao](...args)
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('ERRO:', e.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
