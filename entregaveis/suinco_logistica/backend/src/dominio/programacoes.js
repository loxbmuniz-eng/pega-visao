import { consultar } from '../banco.js';

/* Qual é o ciclo de programação ABERTO agora.

   Um ciclo por vez, sempre: é assim que a operação pensa ("a programação
   de hoje"). O ciclo só troca quando alguém fecha explicitamente — nunca
   por virada de data, porque embarque atravessa a meia-noite com
   frequência e trocar sozinho partiria a programação em duas no meio do
   turno.

   Se não existir nenhum aberto (base nova, ou o último foi fechado), abre
   um na hora. Assim nenhuma carga fica órfã de programação, nem no caso
   em que o primeiro POST de carga chega antes de qualquer fechamento. */
export async function programacaoAtual() {
  const { rows } = await consultar(
    `SELECT programacao_id FROM programacoes
      WHERE fechada_em IS NULL
      ORDER BY aberta_em DESC LIMIT 1`
  );
  if (rows[0]) return rows[0].programacao_id;
  return abrirProgramacao();
}

export async function abrirProgramacao() {
  const id = `prog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await consultar(
    'INSERT INTO programacoes (programacao_id, aberta_em) VALUES ($1, now())',
    [id]
  );
  return id;
}
