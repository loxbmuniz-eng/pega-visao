/* Operadores de DEMONSTRAÇÃO para os guias em PDF.

   Os prints dos guias mostram o nome de quem está logado no cabeçalho —
   então cada setor ganha uma identidade limpa ("Operador Portaria"), em vez
   de aparecerem os usuários de teste. Roda só contra o banco LOCAL
   descartável: nunca aponte para produção.

   uso:  cd backend && node scripts/preparar_demo_guias.js                                  */

import bcrypt from 'bcryptjs';
import { pool } from '../src/banco.js';

const SENHA = process.env.SUINCO_DEMO_SENHA || 'guia-demo-123';

const DEMO = [
  ['guia.logistica@suinco.demo',  'Operador Logística',         'Logística'],
  ['guia.portaria@suinco.demo',   'Operador Portaria',          'Portaria'],
  ['guia.expedicao@suinco.demo',  'Operador Expedição',         'Expedição'],
  ['guia.faturamento@suinco.demo', 'Operador Faturamento',      'Faturamento'],
  ['guia.controles@suinco.demo',  'Operador Controles Internos', 'Controles Internos'],
  ['guia.notas@suinco.demo',      'Operador Central de Notas',  'Central de Notas'],
  ['guia.adm@suinco.demo',        'Gestor Administração',       'Administração'],
  /* Comercial entrou depois (08/08/2026) e ficou de fora desta lista, então
     o setor nunca teve guia. É o único posto que só LÊ — e justamente por
     isso precisa do guia: quem não aperta botão não descobre a tela
     sozinho, descobre perguntando para os outros. */
  ['guia.comercial@suinco.demo',  'Operador Comercial',         'Comercial'],
];

const hash = await bcrypt.hash(SENHA, 8);
for (const [email, nome, setor] of DEMO) {
  await pool.query(
    `INSERT INTO operadores (email, nome, setor, senha_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome,
       setor = EXCLUDED.setor, senha_hash = EXCLUDED.senha_hash`,
    [email, nome, setor, hash]
  );
  console.log('  ok', setor.padEnd(20), email);
}
await pool.end();
console.log('\nOperadores de demonstração prontos.');
