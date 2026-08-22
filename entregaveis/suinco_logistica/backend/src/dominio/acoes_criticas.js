/* AÇÃO QUE REESCREVE O PASSADO PRECISA DE DUAS PESSOAS.
   =====================================================================

   Etapa 3 do protocolo de segurança (22/08/2026).

   Restaurar uma versão, desfazer uma exclusão e corrigir uma etapa não mudam
   o pátio: mudam a HISTÓRIA do pátio. São exatamente as ferramentas de quem
   quer esconder um erro — e estavam a um clique de um único administrador.

   A partir daqui são PEDIDO e APROVAÇÃO, por administradores DIFERENTES.
   Quem pede não aprova: duas contas na mão da mesma pessoa derrotariam o
   controle, e esse é justamente o cenário contra o qual ele existe.

   POR QUE NÃO VALE PARA A OPERAÇÃO NORMAL. Mudar status, lançar carga,
   registrar lacre — nada disso passa por aqui. Atrito na operação é o que
   faz um controle ser contornado em três semanas; atrito no que reescreve o
   passado é o controle funcionando. */

export const TIPOS_CRITICOS = ['restaurar', 'desfazer-exclusao', 'corrigir-etapa'];

/* Pedido vale por 24 horas.

   Não é burocracia: uma aprovação de ontem executaria a ação contra um
   estado que já mudou hoje — restaurar uma versão que deixou de fazer
   sentido, ou reabrir uma carga que já seguiu viagem de novo. Expirado,
   pede-se outra vez, e a nova análise vê o estado atual. */
export const VALIDADE_PEDIDO_MS = 24 * 60 * 60 * 1000;

export function tipoCriticoValido(tipo) {
  return TIPOS_CRITICOS.includes(String(tipo));
}

export function pedidoExpirado(pedidaEm, agora = new Date()) {
  return (agora.getTime() - new Date(pedidaEm).getTime()) > VALIDADE_PEDIDO_MS;
}

/* A regra central, isolada aqui para ter teste próprio: um pedido só é
   aprovável por OUTRA pessoa, e só enquanto estiver aberto e no prazo. */
export function podeAprovar(pedido, aprovadorId, agora = new Date()) {
  if (!pedido) return { pode: false, motivo: 'PEDIDO_NAO_ENCONTRADO' };
  if (pedido.recusada_em) return { pode: false, motivo: 'PEDIDO_RECUSADO' };
  if (pedido.aprovada_em) return { pode: false, motivo: 'PEDIDO_JA_APROVADO' };
  if (String(pedido.pedida_por_id) === String(aprovadorId)) {
    return { pode: false, motivo: 'APROVADOR_E_O_MESMO' };
  }
  if (pedidoExpirado(pedido.pedida_em, agora)) {
    return { pode: false, motivo: 'PEDIDO_EXPIRADO' };
  }
  return { pode: true };
}

export const MENSAGEM = {
  PEDIDO_NAO_ENCONTRADO: 'Este pedido não existe.',
  PEDIDO_RECUSADO: 'Este pedido já foi recusado.',
  PEDIDO_JA_APROVADO: 'Este pedido já foi aprovado.',
  APROVADOR_E_O_MESMO: 'Quem pede não aprova. Peça a outro administrador.',
  PEDIDO_EXPIRADO: 'O pedido passou de 24 horas. Peça de novo — a carga pode ter mudado.',
};
