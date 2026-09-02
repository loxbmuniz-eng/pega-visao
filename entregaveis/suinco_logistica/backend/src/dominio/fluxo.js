/* A máquina de estados do pátio — agora do lado do servidor.

   Isto é o coração da migração. Antes, a regra de "de qual status dá para ir
   para qual, e quem pode fazer isso" existia só no navegador (data.js). Com
   uma API pública, quem tiver um token pode chamar `PATCH /api/cargas/:id`
   direto e pular etapas — registrar "Faturado" num caminhão que nunca chegou.

   A auditoria anterior marcou isso como MÉDIA e anotou "sem solução" porque
   no SharePoint não havia onde colocar a regra. Aqui há. As definições abaixo
   são a cópia fiel de STATUS_FLOW e SETOR_PERMISSOES do painel — se um dia
   mudarem lá, precisam mudar aqui junto. */

export const STATUS_FLOW = [
  'Aguardando Veículo',   // 1 — Logística cria a carga aqui
  'Aguardando Embarque',  // 2 — Portaria, botão "Chegou"
  'Embarque Iniciado',    // 3 — Expedição
  'Embarque Finalizado',  // 4 — Expedição
  'Faturado',             // 5 — Faturamento
  'Seguiu Viagem',        // 6 — Portaria, botão "Saiu"
];

export const STATUS_INICIAL = STATUS_FLOW[0];

/* A LISTA DE SETORES DO SISTEMA — ESTE É O ÚNICO LUGAR.

   Ela existia em dois arquivos do servidor: aqui e em config.js. Em
   02/09/2026 as três filiais entraram só aqui, e a tela de Usuários —
   que valida contra a de config.js — recusou o cadastro com "Setor
   inválido" mesmo com o setor aparecendo na lista da tela. O dono
   tentou cadastrar a filial e levou a recusa três vezes.

   Somando as duas do servidor, as três da tela e a do banco, a mesma
   lista estava escrita em SEIS lugares. Criar um setor exigia lembrar
   dos seis. Agora config.js REEXPORTA daqui, os <select> da tela são
   montados por código a partir de data.js, e o banco tem a CHECK da
   migração 043. Sobraram dois lugares — o servidor e o painel — porque
   o painel não fala com este arquivo (é build de arquivo único), e o
   teste testes/test_setor_novo_aparece_nas_telas.py compara os dois.

   ORDEM: a mesma de SETOR_PERMISSOES em data.js, de propósito — é assim
   que a lista aparece no <select> de cadastro. */
export const SETORES = [
  'Logística',
  'Portaria',
  'Expedição',
  'Faturamento',
  'Administração',
  /* Comercial: só leitura — pedido do usuário (08/08/2026), pra tirar da
     Logística/Administração o trabalho de responder pergunta de cliente
     sobre onde a carga está. Não aparece em NENHUMA função de permissão
     de escrita deste arquivo (podeCriarCarga,
     podeRegistrarChegadaSemProgramacao, podeRegistrarSaida,
     camposEditaveisPor) de propósito — todas são allowlist, então "não
     estar na lista" já barra por padrão. */
  'Comercial',
  /* Setores da devolução (18/08/2026) — cada um faz UM passo do checklist
     digital (dominio/devolucoes.js): Controles Internos destina os
     produtos (Estoque/Descarte/Reprocesso) e assina "Destinada"; Central
     de Notas finaliza a nota fiscal. Nas CARGAS não aparecem em nenhuma
     allowlist — mesmo racional do Comercial acima. */
  'Controles Internos',
  'Central de Notas',
  /* AS FILIAIS (02/09/2026).

     Pedido do dono: "isso é um setor novo, so vai ter acesso a aba
     devolucoes e escopo de devolucoes, e vai poder so criar checklists e
     acompanhar historico de devolucoes somente que competem a eles, ou
     seja, quem for filial so acompanha dev filial (...) o processo de dev
     é feito aqui normalmente, porem as permissoes da filial sao restritas
     a isso" — e, à pergunta de quantas: "crie 3 setores filial 105 BSB,
     106 BAHIA, 107 ES".

     TRÊS SETORES E NÃO UM COM SUBDIVISÃO. A filial 105 não pode ver a
     devolução da 106, e setor já é a chave que separa tudo no sistema:
     `devolucoes.criada_setor` existe desde a migração 010 e guarda quem
     criou. Um campo novo de "qual filial" seria uma segunda chave para a
     mesma pergunta — e duas chaves para a mesma pergunta divergem.

     ELAS NÃO ENTRAM EM `PODE`, logo abaixo: filial não avança etapa
     nenhuma do fluxo de carga nem do de devolução. Cria o checklist e
     acompanha o que criou; o ciclo é rodado pela matriz. */
  'Filial 105 BSB',
  'Filial 106 BAHIA',
  'Filial 107 ES',
];

/* As filiais, num lugar só. Quem precisa saber "este operador é de
   filial?" pergunta aqui — a alternativa é repetir a lista em cinco
   arquivos e descobrir a sexta cópia no dia em que uma filial nova
   entrar. */
export const SETORES_FILIAL = ['Filial 105 BSB', 'Filial 106 BAHIA', 'Filial 107 ES'];
export function ehFilial(setor) { return SETORES_FILIAL.includes(setor); }

/* Quem pode executar cada passo.

   A Logística aparece em TODOS os passos por decisão do gestor: ela cobre
   qualquer posto quando falta gente — troca de turno, almoço, alguém que
   faltou. Não é permissão inventada aqui; é a autoridade que a pessoa já
   tem na operação.

   Deixá-la de fora produziria o pior desfecho possível: o painel recusaria
   uma ação que a Logística tem autoridade para fazer, e a saída prática
   seria pedir a senha do porteiro emprestada. Permissão que a operação
   contorna não é permissão, é fricção — e destrói a trilha de auditoria,
   porque o log passaria a dizer "Portaria" quando foi a Logística.

   Cada passo continua tendo um DONO, e é ele que aparece na mensagem de
   erro quando outro setor tenta. O dono é o primeiro da lista. */
const TRANSICOES = [
  { de: 'Aguardando Veículo',  para: 'Aguardando Embarque', setores: ['Portaria', 'Logística'] },
  { de: 'Aguardando Embarque', para: 'Embarque Iniciado',   setores: ['Expedição', 'Logística'] },
  { de: 'Embarque Iniciado',   para: 'Embarque Finalizado', setores: ['Expedição', 'Logística'] },
  { de: 'Embarque Finalizado', para: 'Faturado',            setores: ['Faturamento', 'Logística'] },
  { de: 'Faturado',            para: 'Seguiu Viagem',       setores: ['Portaria', 'Logística'] },
];

// Administração existe para destravar operação parada às 2h da manhã sem
// depender de alguém com acesso ao banco. Toda ação dela fica no log com
// operador_verificado = true, então o poder vem com rastro.
const SETOR_IRRESTRITO = 'Administração';

export class ErroDeFluxo extends Error {
  constructor(mensagem, codigo = 'TRANSICAO_INVALIDA') {
    super(mensagem);
    this.name = 'ErroDeFluxo';
    this.codigo = codigo;
    this.status = 409;
  }
}

export class ErroDePermissao extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDePermissao';
    this.codigo = 'SETOR_SEM_PERMISSAO';
    this.status = 403;
  }
}

export function statusValido(s) {
  return STATUS_FLOW.includes(s);
}

/* Valida a transição e quem a está fazendo. Lança em vez de devolver false
   porque cada motivo de recusa merece mensagem própria — "não existe esse
   status" e "não é a sua vez" são problemas diferentes para quem está no
   pátio com o caminhão esperando. */
export function validarTransicao(statusAtual, statusNovo, setor) {
  if (!statusValido(statusNovo)) {
    throw new ErroDeFluxo(`Status desconhecido: "${statusNovo}".`, 'STATUS_DESCONHECIDO');
  }
  if (statusAtual === statusNovo) {
    throw new ErroDeFluxo(`A carga já está em "${statusNovo}".`, 'SEM_MUDANCA');
  }

  const regra = TRANSICOES.find((t) => t.de === statusAtual && t.para === statusNovo);
  if (!regra) {
    throw new ErroDeFluxo(
      `Não é possível ir de "${statusAtual}" direto para "${statusNovo}".`
    );
  }

  if (setor !== SETOR_IRRESTRITO && !regra.setores.includes(setor)) {
    throw new ErroDePermissao(
      `O setor ${setor} não registra "${statusNovo}". ` +
      `Quem faz esse passo: ${regra.setores.join(' ou ')}.`
    );
  }
  return true;
}

/* Só quem programa cria carga. Portaria também cria, mas por outro caminho:
   o veículo que chega sem programação entra como "Aguardando Carga" e a
   Logística completa depois. Esse caso tem rota própria. */
export function podeCriarCarga(setor) {
  return setor === 'Logística' || setor === SETOR_IRRESTRITO;
}

export function podeRegistrarChegadaSemProgramacao(setor) {
  return setor === 'Portaria' || setor === 'Logística' || setor === SETOR_IRRESTRITO;
}

/* Saída física do pátio. Mesma lógica das transições: a Logística cobre a
   Portaria, e recusar aqui empurraria para a senha emprestada. */
export function podeRegistrarSaida(setor) {
  return setor === 'Portaria' || setor === 'Logística' || setor === SETOR_IRRESTRITO;
}

/* Campos de negócio que cada setor pode alterar numa carga já existente,
   fora a mudança de status. A Portaria não mexe em peso nem em rota; a
   Logística não deveria reescrever o histórico de outro setor. */
const CAMPOS_EDITAVEIS = {
  'Logística': [
    'numero_carga', 'placa', 'transportadora', 'tipo_veiculo', 'motorista',
    'cliente', 'destino', 'peso_kg', 'rota_codigo', 'sequencia', 'pra_onde',
    'paletizada', 'qtd_ganchos', 'qtd_entregas', 'observacoes', 'aguardando_carga',
    // A data de programação nasce quando a Logística lança a carga de um
    // caminhão que já estava no pátio — por isso precisa ser editável.
    'programado_em',
    'lacre', 'lacre_2', 'lacre_3', 'lacre_retido',
  ],
  // Lacres (18/08/2026): é a Portaria quem coloca o lacre na saída e quem
  // o retém quando a carga está incorreta — os dois números são dela.
  'Portaria': ['motorista', 'observacoes', 'lacre', 'lacre_2', 'lacre_3', 'lacre_retido'],
  'Expedição': ['qtd_ganchos', 'observacoes'],
  'Faturamento': ['observacoes'],
};

export function camposEditaveisPor(setor) {
  if (setor === SETOR_IRRESTRITO) return CAMPOS_EDITAVEIS['Logística'];
  return CAMPOS_EDITAVEIS[setor] || [];
}
