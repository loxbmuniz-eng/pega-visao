#!/usr/bin/env node
/* Semeia o banco do MEDIDOR: N operadores e volume igual ao de produção.
   O volume importa: medir contra banco vazio responde uma pergunta que
   ninguém fez. Números reais do VPS em 12/09/2026 (pg_stat_user_tables):
   dim_clientes 77.102 · log_leitura 11.283 · carga_revisoes 4.193 ·
   log_eventos 3.569 · fact_statusfrota 3.062 · dim_veiculos 785 ·
   fact_viagens 761. */
import bcrypt from 'bcryptjs';
import { pool } from '../backend/src/banco.js';

const N = Number(process.argv[2] || 150);
const SENHA = process.argv[3] || 'medidor-2026-suinco';
const SETORES = ['Logística', 'Portaria', 'Expedição', 'Faturamento', 'Administração'];

const hash = await bcrypt.hash(SENHA, 10);
let criados = 0;
for (let i = 0; i < N; i++) {
  const r = await pool.query(
    `INSERT INTO operadores (email, nome, setor, senha_hash, ativo)
     VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (email) DO UPDATE
       SET senha_hash = EXCLUDED.senha_hash, ativo = TRUE
     RETURNING id`,
    [`medidor${i}@teste.local`, `Medidor ${i}`, SETORES[i % SETORES.length], hash]);
  if (r.rowCount) criados++;
}
console.log(`operadores prontos: ${criados}`);

const conta = async (t) => (await pool.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;

// Clientes: é a tabela grande, e o /api/estado não a manda — mas o Power BI
// manda. Entra para o teto refletir a máquina real, não uma reduzida.
if (await conta('dim_clientes') < 70000) {
  await pool.query(`INSERT INTO dim_clientes (codigo, nome)
    SELECT 'MED'||g, 'Cliente de medição '||g FROM generate_series(1,77000) g
    ON CONFLICT DO NOTHING`);
}
console.log(`dim_clientes: ${await conta('dim_clientes')}`);

for (const [t, alvo] of [['fact_viagens', 761], ['fact_statusfrota', 3062]]) {
  console.log(`${t}: ${await conta(t)} (alvo de produção ${alvo})`);
}
await pool.end();
