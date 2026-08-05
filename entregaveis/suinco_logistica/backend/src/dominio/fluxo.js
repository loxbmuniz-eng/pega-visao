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

export const SETORES = [
  'Logística',
  'Portaria',
  'Expedição',
  'Faturamento',
  'Administração',
];

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

/* Qual é o próximo passo natural a partir de um status — usado pelo painel
   para desenhar o botão certo em cada linha. Devolve null no fim do fluxo. */
export function proximoStatus(statusAtual) {
  const i = STATUS_FLOW.indexOf(statusAtual);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
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

export function podeEditarCadastros(setor) {
  return setor === 'Logística' || setor === SETOR_IRRESTRITO;
}

/* Campos de negócio que cada setor pode alterar numa carga já existente,
   fora a mudança de status. A Portaria não mexe em peso nem em rota; a
   Logística não deveria reescrever o histórico de outro setor. */
const CAMPOS_EDITAVEIS = {
  'Logística': [
    'numero_carga', 'placa', 'transportadora', 'tipo_veiculo', 'motorista',
    'cliente', 'destino', 'peso_kg', 'rota_codigo', 'sequencia', 'pra_onde',
    'paletizada', 'qtd_ganchos', 'qtd_entregas', 'observacoes', 'aguardando_carga',
  ],
  'Portaria': ['motorista', 'observacoes'],
  'Expedição': ['qtd_ganchos', 'observacoes'],
  'Faturamento': ['observacoes'],
};

export function camposEditaveisPor(setor) {
  if (setor === SETOR_IRRESTRITO) return CAMPOS_EDITAVEIS['Logística'];
  return CAMPOS_EDITAVEIS[setor] || [];
}
