/* REGISTRO DE QUEM LEVOU O DADO.
   =====================================================================

   `log_eventos` responde "quem alterou". Esta função responde a pergunta que
   ninguém conseguia responder: "quem LEVOU". Exfiltração não altera nada —
   ela lê, gera um PDF e vai embora, sem deixar rastro nenhum.

   REGRA DE OURO: registrar NUNCA derruba a operação. Se a gravação falhar
   (banco fora, tabela ausente num servidor desatualizado), o erro vai para o
   console e o relatório sai assim mesmo. Segurança que impede o pátio de
   trabalhar é segurança que alguém desliga na primeira sexta-feira cheia. */

import { consultar } from '../banco.js';

export async function registrarLeitura({
  tipo, detalhe = '', linhas = null, operador = {}, ip = '', permitido = true,
}) {
  try {
    await consultar(
      `INSERT INTO log_leitura
         (tipo, detalhe, linhas, operador_id, operador_nome, operador_setor,
          ip_origem, permitido)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        String(tipo).slice(0, 120),
        String(detalhe || '').slice(0, 500),
        Number.isFinite(linhas) ? linhas : null,
        String(operador.id || ''),
        String(operador.nome || ''),
        String(operador.setor || ''),
        String(ip || '').slice(0, 60),
        !!permitido,
      ]
    );
  } catch (e) {
    console.warn('[seguranca] não consegui registrar a leitura:', e.message);
  }
}

/* Tentativa BARRADA é o registro mais importante da tabela: uma negativa é
   acidente, três seguidas da mesma conta é padrão. Atalho próprio para que
   nenhuma rota esqueça de registrar a recusa — que é justamente o caso em
   que o programador tende a só devolver 403 e seguir. */
export async function registrarLeituraBarrada(args) {
  return registrarLeitura({ ...args, permitido: false });
}
