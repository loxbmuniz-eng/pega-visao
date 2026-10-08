/* =====================================================================
   SENHA ERRADA — UMA REGRA SÓ (08/10/2026)
   ---------------------------------------------------------------------
   Cinco senhas erradas em 30 minutos põem em espera por 15 minutos. A regra
   nasceu dentro do login (etapa 4, 24/08/2026) com os números escritos à
   mão. A senha da parte de gerenciar usuários veio com a decisão do dono
   "igual ao login" — e a mesma regra escrita em dois lugares diverge no
   primeiro ajuste. Agora o login e a trava da aba Usuários chamam esta.

   Janela de 30 min: cinco erros espalhados ao longo de meses não são
   ataque, são digitação. O que interessa é a rajada.
   ===================================================================== */
export const TENTATIVAS = { maximo: 5, janelaMs: 30 * 60 * 1000, esperaMinutos: 15 };

/* `falhas`, `desde` e `esperaAte` vêm das colunas da pessoa (cada trava tem
   as suas). Devolve quantas falhas CONTAM agora, se a quinta já veio
   (`suspeito`) e se a espera ainda corre. */
export function situacaoDasTentativas({ falhas, desde, esperaAte } = {}, agora = Date.now()) {
  const inicio = desde ? new Date(desde).getTime() : 0;
  const naJanela = Boolean(inicio) && (agora - inicio) < TENTATIVAS.janelaMs;
  const n = naJanela ? Number(falhas || 0) : 0;
  return {
    falhas: n,
    naJanela,
    suspeito: n >= TENTATIVAS.maximo,
    emEspera: Boolean(esperaAte) && new Date(esperaAte).getTime() > agora,
  };
}

/* Mais uma falha: a quinta põe em espera (e zera a contagem); antes dela,
   soma, guardando o começo da rajada. */
export function proximaFalha(situacao) {
  const n = situacao.falhas + 1;
  return { n, entraEmEspera: n >= TENTATIVAS.maximo };
}
