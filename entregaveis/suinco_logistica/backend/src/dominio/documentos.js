/* QUEM PODE LEVAR QUAL DOCUMENTO PARA FORA.
   =====================================================================

   Etapa 1 do protocolo de segurança (22/08/2026). A brecha era simples de
   descrever: qualquer setor logado gerava qualquer relatório. A Portaria
   podia exportar a operação inteira em PDF, e ninguém ficava sabendo.

   POR QUE AQUI E NÃO NA LEITURA DO PÁTIO. `GET /estado` devolve o pátio
   inteiro a todo mundo, e isso é FEATURE: cinco setores enxergando o mesmo
   pátio ao vivo foi o que substituiu a coordenação por WhatsApp. Fechar a
   leitura quebraria o valor do produto para resolver o problema errado.

   O que atravessa a fronteira da empresa é o DOCUMENTO — o PDF que vai para
   o grupo, o CSV que vai para o pen drive. É nele que entra dono, e é a
   geração dele que fica registrada. */

/* Administração NÃO aparece nas listas: `podeGerar` a inclui sempre, do
   mesmo jeito que o middleware `exigirSetor` faz. Repetir em nove linhas
   seria nove lugares para esquecer no dia em que a regra mudar. */
export const DONOS_DO_DOCUMENTO = {
  'relatorio-operacional': ['Logística'],
  'relatorio-executivo': ['Logística'],
  'administracao-fretes': [],
  'ficha-de-carga': ['Logística', 'Expedição', 'Faturamento'],
  'programacao-do-dia': ['Logística'],
  'devolucoes-do-dia': ['Logística', 'Controles Internos', 'Central de Notas'],
  'devolucao-operador': ['Logística', 'Controles Internos', 'Central de Notas'],
  'comprovante-portaria': ['Portaria', 'Logística'],
  'exportacao-csv': [],
};

export const SETOR_IRRESTRITO_DOC = 'Administração';

export function documentoConhecido(tipo) {
  return Object.prototype.hasOwnProperty.call(DONOS_DO_DOCUMENTO, String(tipo));
}

export function podeGerar(setor, tipo) {
  if (!documentoConhecido(tipo)) return false;
  if (setor === SETOR_IRRESTRITO_DOC) return true;
  return DONOS_DO_DOCUMENTO[tipo].includes(setor);
}

/* A lista que o PAINEL usa para decidir quais botões mostrar. Esconder o
   botão não é o controle — o controle é `podeGerar` no servidor. Mas botão
   visível que sempre dá erro ensina o operador a ignorar mensagem de
   permissão, e operador que ignora aviso é problema de segurança. */
export function documentosDoSetor(setor) {
  return Object.keys(DONOS_DO_DOCUMENTO).filter((t) => podeGerar(setor, t));
}
