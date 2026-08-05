/* Acesso ao PostgreSQL via pool do `pg`, com SQL escrito à mão.

   Por que não Prisma (decisão registrada em GO_LIVE_MASTER §1.9): o schema
   tem views que reproduzem os cabeçalhos do Power BI ao pé da letra e um
   gatilho que incrementa `versao`. Isso é território onde um ORM atrapalha
   mais do que ajuda — e o time que vai manter isso lê SQL. */

import pg from 'pg';
import { config } from './config.js';

// O `pg` devolve BIGINT e NUMERIC como string para não perder precisão.
// Nas nossas colunas (peso em kg, contagens) o valor cabe folgado em Number,
// e string aqui viraria "1000" + 1 = "10001" no JSON do painel.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // int8
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

export const pool = new pg.Pool(config.banco);

pool.on('error', (err) => {
  // Erro em conexão ociosa do pool. Não derruba o processo: o pool abre
  // outra. Mas precisa aparecer no log, senão uma queda do banco fica
  // invisível até alguém reclamar que o painel parou.
  console.error('[banco] erro em conexão ociosa:', err.message);
});

export function consultar(sql, params) {
  return pool.query(sql, params);
}

/* Executa uma função inteira dentro de uma transação.

   Usado onde criar/atualizar carga e gravar a movimentação precisam ser
   atômicos: se a movimentação falhar, a carga não pode ficar com o status
   novo. Sem isso, o histórico do Power BI ganha buracos silenciosos. */
export async function emTransacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

export async function verificarConexao() {
  const { rows } = await pool.query('SELECT now() AS agora');
  return rows[0].agora;
}

export async function encerrar() {
  await pool.end();
}
