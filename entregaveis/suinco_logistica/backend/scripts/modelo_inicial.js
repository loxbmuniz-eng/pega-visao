/* O MODELO DA SEMANA NUM SERVIDOR NOVO (28/09/2026).

   O DEFEITO, reproduzido num banco descartável na ordem do instalar.sh:
   migrar.js e depois seed.js → programacao_modelo com 0 linhas (a produção
   tem 80). As migrações 041 e 042 gravam o modelo do dono só para as rotas
   que JÁ existem (`WHERE EXISTS (SELECT 1 FROM dim_rotas ...)`), e as 33
   rotas oficiais só entram no seed, que roda depois das migrações. Num
   servidor instalado do zero, a Montagem do Dia nasceria sem modelo nenhum.

   A CORREÇÃO: depois do seed, se o modelo estiver VAZIO, aplica de novo o
   SQL da 041 e da 042, nessa ordem, numa transação só.

   SÓ QUANDO ESTÁ VAZIO, e isso não é detalhe: a 041 começa com
   `DELETE FROM programacao_modelo`. Rodá-la num banco que já tem modelo
   apagaria o que a Logística editou. O `atualizar.sh` chama o instalador em
   produção — então este passo PRECISA não fazer nada quando há linha. Com
   tabela vazia não há o que perder.

   Idempotente: roda em toda instalação e em toda atualização; na segunda
   vez em diante encontra o modelo e sai.

   Guarda: testes/test_instalacao_nova_tem_modelo.py */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/banco.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MIGRACOES = ['041_modelo_da_semana_do_dono.sql', '042_quarta_linha_7_e_belo_horizonte.sql'];

async function principal() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM programacao_modelo');
  if (rows[0].n > 0) {
    console.log(`Modelo da semana: ${rows[0].n} linha(s) — nada a fazer.`);
    return;
  }
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    for (const arq of MIGRACOES) {
      await cli.query(await fs.readFile(path.join(AQUI, '..', 'migrations', arq), 'utf8'));
    }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  } finally {
    cli.release();
  }
  const depois = await pool.query('SELECT count(*)::int AS n FROM programacao_modelo');
  console.log(`Modelo da semana estava vazio: aplicado o do dono (${depois.rows[0].n} linhas).`);
}

principal()
  .catch((e) => { console.error('modelo_inicial:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
