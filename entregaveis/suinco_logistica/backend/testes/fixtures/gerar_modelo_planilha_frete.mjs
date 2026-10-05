/* Gera o MODELO da planilha de Pagamento de Frete com as cargas de exemplo
   (inventadas) — o arquivo que o dono aprova antes de a exportação ir ao ar.
   Uso: node testes/fixtures/gerar_modelo_planilha_frete.mjs <saida.xlsx> */
import fs from 'node:fs';
import { montarPlanilhaDeFrete } from '../../src/dominio/planilha_frete_export.js';
import { CARGAS_DE_EXEMPLO } from './frete/exemplo_cargas.js';

const saida = process.argv[2];
if (!saida) { console.error('uso: gerar_modelo_planilha_frete.mjs <saida.xlsx>'); process.exit(2); }
const buf = montarPlanilhaDeFrete({ cargas: CARGAS_DE_EXEMPLO, geradoEm: new Date('2026-10-05T17:30:00Z'), exemplo: true });
fs.writeFileSync(saida, buf);
console.log(`ok: ${saida} (${buf.length} bytes)`);
