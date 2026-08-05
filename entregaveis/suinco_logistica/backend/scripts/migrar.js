#!/usr/bin/env node
/* Aplica as migrations de backend/migrations em ordem, uma vez cada.

   Registra o que já rodou numa tabela de controle. Rodar de novo é seguro —
   e precisa ser, porque o script de instalação chama isto toda vez que
   atualiza o servidor. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, emTransacao } from '../src/banco.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.join(AQUI, '..', 'migrations');

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      arquivo     TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const { rows } = await pool.query('SELECT arquivo FROM _migrations');
  const jaAplicadas = new Set(rows.map((r) => r.arquivo));

  const arquivos = fs.readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();
  let novas = 0;

  for (const arquivo of arquivos) {
    if (jaAplicadas.has(arquivo)) {
      console.log(`  ok    ${arquivo} (já aplicada)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(PASTA, arquivo), 'utf8');
    // Cada migration numa transação: se falhar no meio, não sobra metade
    // aplicada com o registro dizendo que passou.
    await emTransacao(async (cli) => {
      await cli.query(sql);
      await cli.query('INSERT INTO _migrations (arquivo) VALUES ($1)', [arquivo]);
    });
    console.log(`  APLICADA  ${arquivo}`);
    novas++;
  }

  console.log(novas === 0 ? '\nBanco já estava atualizado.' : `\n${novas} migration(s) aplicada(s).`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('\nERRO na migration:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
