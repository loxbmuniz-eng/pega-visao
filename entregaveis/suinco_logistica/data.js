/* =====================================================================
   PAINEL LOGÍSTICO SUINCO — camada de dados
   =====================================================================
   IMPORTANTE — leia antes de mexer:

   Hoje este arquivo guarda tudo em localStorage (SuincoStore.load/save).
   Isso é DE PROPÓSITO só um substituto temporário para testar o painel
   fora do Teams. A arquitetura confirmada é Listas do SharePoint como
   banco (ver docs/MODELO_DADOS_SHAREPOINT.md) — quando a lista estiver
   provisionada no tenant, troque apenas os métodos de SuincoStore
   (load/save/query) por chamadas à API REST do SharePoint ou Microsoft
   Graph. Nenhuma outra parte do painel deveria precisar mudar, porque
   toda a lógica de negócio abaixo fala só com `DB`, nunca com
   localStorage diretamente.

   A permissão por setor aplicada aqui (SETOR_PERMISSOES) é só uma
   conveniência de interface (esconder abas/ações que não são do setor
   logado). NÃO é controle de acesso de verdade — isso só existe quando
   a permissão real da Lista do SharePoint estiver configurada por
   coluna/item e o SSO (Microsoft 365) estiver ligado. Até lá, qualquer
   pessoa com o arquivo pode, tecnicamente, editar o localStorage.
===================================================================== */

const STORAGE_KEY = 'suinco_painel_v1';

/* ---------- máquina de estados (6 status — modelo real do VBA, REVERTIDO
   a partir do modelo de 8 status que tinha sido sugerido antes) ----------
   CORREÇÃO OFICIAL: "Liberado para Embarque" e "Liberado para Saída" NÃO
   EXISTEM. Expedição vai direto de "Aguardando Embarque" pra "Embarque
   Iniciado". Faturamento vai direto de "Embarque Finalizado" pra
   "Faturado", sem etapa de liberação intermediária. */
const STATUS_FLOW = [
  'Aguardando Veículo',   // 1 — padrão ao criar a carga na Programação (Logística). Ninguém aciona via botão.
  'Aguardando Embarque',  // 2 — Portaria, botão "Chegou" (1→2)
  'Embarque Iniciado',    // 3 — Expedição
  'Embarque Finalizado',  // 4 — Expedição
  'Faturado',             // 5 — Faturamento
  'Seguiu Viagem'         // 6 — Portaria, botão "Saiu" (Faturado→6, todas as cargas em aberto da placa de uma vez)
];

const STATUS_META = {
  'Aguardando Veículo':   { badge:'badge-aguardando-veiculo',  setor:'Logística',  cor:'vermelha' },
  'Aguardando Embarque':  { badge:'badge-aguardando-embarque', setor:'Portaria',   cor:'laranja' },
  'Embarque Iniciado':    { badge:'badge-embarque-iniciado',   setor:'Expedição',  cor:'amarela' },
  'Embarque Finalizado':  { badge:'badge-embarque-finalizado', setor:'Expedição',  cor:'verde-clara' },
  'Faturado':             { badge:'badge-faturado',            setor:'Faturamento',cor:'verde' },
  'Seguiu Viagem':        { badge:'badge-seguiu-viagem',       setor:'Portaria',   cor:'verde-escura' }
};

/* ---------- "Pra onde?" (classificador de modal/operação) ----------
   Três opções, todas explícitas — não existe valor vazio. Vazio como
   portador de significado é armadilha: some no relatório, some no filtro
   do Power BI, e ninguém sabe se o campo não foi preenchido.

   FROTA PROPRIA saiu e DEDICADA virou ENTREGA DIRETA — pedido direto do
   gestor (Alysson, via WhatsApp, 08/08/2026): "Exclua esse frota propria.
   E altere o dedicada para entrega direta. E deixe somente esses tres:
   Cross / Entrega Direta / Ret Frigo." Caminhão da própria Suinco fazendo
   entrega direta é operacionalmente a mesma coisa que terceiro dedicado
   fazendo entrega direta — por isso as duas categorias antigas viram uma
   só. Migração dos dados já gravados: backend/migrations/003_tipo_operacao.sql.

   NOTA: até 02/08/2026 existia aqui um campo "Compartilhada?", DERIVADO deste.
   Foi substituído por "Paletizada", que é informação independente e EDITÁVEL —
   não dá para inferir do tipo de operação se a carga é paletizada. A função
   compartilhadaDaCarga() foi mantida apenas para ler registros antigos e
   converter o export; nenhuma tela nova a usa. */
const PRA_ONDE_OPCOES = ['CROSS-DOCKING', 'ENTREGA DIRETA', 'RET FRIGO'];
const PRA_ONDE_LABEL = {
  'CROSS-DOCKING':'CROSS-DOCKING',
  'ENTREGA DIRETA':'ENTREGA DIRETA',
  'RET FRIGO':'RET FRIGO'
};
const PRA_ONDE_PADRAO = 'ENTREGA DIRETA';
/* Sugestão de Tipo de Operação pra chegada sem programação (Portaria
   clica "Chegou" numa placa nova). Antes distinguia Suinco (FROTA
   PRÓPRIA) de transportadora terceirizada (DEDICADA) — achado do gestor
   em produção em 07/08/2026, "vários carros constando como frota própria
   e não são". Com FROTA PRÓPRIA removida (08/08/2026), as duas
   categorias antigas colapsaram numa só (ENTREGA DIRETA), então não há
   mais distinção a fazer a partir da transportadora — a função continua
   existindo, e retornando o padrão, para não obrigar quem chama a saber
   dessa mudança de regra. */
function praOndeSugerido(transportadora){
  return PRA_ONDE_PADRAO;
}
// Leitura de Paletizada, tolerante a registros antigos que não têm o campo.
function paletizadaDaCarga(carga){
  return (carga && carga.paletizada === 'Sim') ? 'Sim' : 'Não';
}
function compartilhadaDaCarga(carga){
  return (carga && (carga.praOnde === 'CROSS-DOCKING' || carga.praOnde === 'RET FRIGO')) ? 'Sim' : 'Não';
}

/* Migração dos registros gravados antes desta renomeação. Sem isto, uma carga
   antiga com praOnde='CROSS' deixaria de ser contada como Compartilhada, o que
   mudaria indicador e relatório em silêncio. */
const PRA_ONDE_MIGRACAO = { '': 'ENTREGA DIRETA', 'CROSS': 'CROSS-DOCKING' };
function migrarPraOnde(){
  let n = 0;
  (DB.cargas || []).forEach(c => {
    if(Object.prototype.hasOwnProperty.call(PRA_ONDE_MIGRACAO, c.praOnde)){
      c.praOnde = PRA_ONDE_MIGRACAO[c.praOnde]; n++;
    } else if(!PRA_ONDE_OPCOES.includes(c.praOnde)){
      c.praOnde = PRA_ONDE_PADRAO; n++;   // valor desconhecido: cai no padrão
    }
  });
  return n;
}

/* ---------- ROTAS (código + praça + operador logístico) ----------
   Lista oficial passada pelo gestor em 31/07/2026. O código é o que a
   operação usa no dia a dia ("carga da 510"), então ele é o valor gravado —
   o nome vem junto só para quem não decorou o número ainda.

   ATENÇÃO: esta lista está INCOMPLETA por definição. Faltam 511, 514, 515,
   526, 528, 530, 533, 535, 537 e 539, que o gestor enviará depois.
   Por isso "(rota não informada)" continua sendo uma opção válida: obrigar a
   escolher uma rota faria a Programação travar justamente nas praças que
   ainda não foram cadastradas. Para acrescentar as que faltam, basta incluir
   a linha aqui — nada mais no painel precisa mudar. */
const ROTAS = [
  // Única rota internacional da lista — fora da faixa 500 usada pelas
  // praças nacionais, de propósito: não é numeração da mesma série.
  { codigo:'171', nome:'Buenos Aires',                       detalhe:'Argentina', operador:'' },
  { codigo:'500', nome:'Patos de Minas',                     operador:'' },
  { codigo:'501', nome:'São Gotardo',                        operador:'' },
  { codigo:'502', nome:'Araxá',                              operador:'' },
  { codigo:'503', nome:'Patrocínio / Coromandel',            operador:'' },
  { codigo:'504', nome:'Alto Paranaíba',                     detalhe:'Paracatu, Unaí, João Pinheiro, Arinos e Buritis', operador:'' },
  { codigo:'505', nome:'Triângulo Mineiro',                  detalhe:'Uberlândia', operador:'' },
  { codigo:'506', nome:'Uberaba',                            operador:'' },
  { codigo:'507', nome:'Araguari',                           operador:'' },
  { codigo:'508', nome:'Iturama',                            operador:'Total Service ou FrigoCargo' },
  { codigo:'509', nome:'Centro-Oeste',                       operador:'' },
  { codigo:'510', nome:'Belo Horizonte',                     operador:'RP Logística' },
  { codigo:'512', nome:'Varginha',                           detalhe:'Sul de Minas', operador:'Brasfrios' },
  { codigo:'513', nome:'Passos',                             detalhe:'Sul de Minas', operador:'MaxFrios' },
  { codigo:'516', nome:'Norte de Minas',                     detalhe:'Montes Claros', operador:'Total Services' },
  { codigo:'517', nome:'Rio de Janeiro (Varejo)',            detalhe:'São João de Meriti', operador:'OmegaX' },
  { codigo:'518', nome:'Rio de Janeiro (Redes)',             detalhe:'Canejo', operador:'' },
  { codigo:'519', nome:'Brasília (Varejo)',                  operador:'RN Logística' },
  { codigo:'520', nome:'Goiás (Varejo)',                     operador:'AG Sestini' },
  { codigo:'521', nome:'SP Ribeirão Preto',                  operador:'CargoFrio' },
  { codigo:'522', nome:'SP Capital',                         detalhe:'Osasco', operador:'SPM LOG' },
  { codigo:'523', nome:'Vale do Aço',                        detalhe:'Governador Valadares', operador:'SSLog' },
  { codigo:'524', nome:'Zona da Mata',                       detalhe:'Juiz de Fora', operador:'BSF Logística' },
  { codigo:'525', nome:'Bahia Capital',                      operador:'LogMaster' },
  { codigo:'527', nome:'Nordeste',                            operador:'' },
  { codigo:'529', nome:'Espírito Santo',                     detalhe:'Serra-ES', operador:'Nacional Log' },
  { codigo:'531', nome:'Paraná',                              operador:'' },
  { codigo:'532', nome:'Bahia Interior',                     detalhe:'Vitória da Conquista', operador:'ConquistaLog' },
  { codigo:'534', nome:'Salvador',                           operador:'LogMaster' },
  { codigo:'536', nome:'Goiás',                              operador:'AG Sestini' },
  { codigo:'538', nome:'SP Interior',                        detalhe:'Marília', operador:'CargoFrio' },
  { codigo:'540', nome:'Salvador',                           operador:'LogMaster' },
  { codigo:'541', nome:'Brasília (Redes)',                   operador:'Versatto Logística' }
];
const ROTA_POR_CODIGO = new Map(ROTAS.map(r => [r.codigo, r]));
function rotaInfo(codigo){ return ROTA_POR_CODIGO.get(String(codigo||'').trim()) || null; }
// "510 — Belo Horizonte (RP Logística)". Usado na tela e nos relatórios, para
// que o mesmo rótulo apareça em todo lugar.
// Rótulo COMPLETO — usado no <select> e na ficha da carga, onde há espaço:
// "504 — Alto Paranaíba · Paracatu, Unaí... (Operador)"
function rotaLabel(codigo){
  const r = rotaInfo(codigo);
  if(!r) return codigo ? String(codigo) : '';
  return `${r.codigo} — ${r.nome}`
       + (r.detalhe ? ` · ${r.detalhe}` : '')
       + (r.operador ? ` (${r.operador})` : '');
}
// Rótulo CURTO — usado nas tabelas e no relatório impresso. Sem o detalhe de
// cidades: a rota 504 sozinha tem cinco municípios, e o nome completo esticava
// a linha inteira do relatório para caber numa única célula.
function rotaCurta(codigo){
  const r = rotaInfo(codigo);
  return r ? `${r.codigo} — ${r.nome}` : (codigo ? String(codigo) : '—');
}

/* Cadastra ou atualiza uma rota (Cadastros → Cadastrar Rota, só
   Administração). Espelha upsertFrota: muta ROTAS/ROTA_POR_CODIGO NA HORA
   — os seletores lêem esses dois direto, então a rota nova aparece no
   formulário sem esperar reload nem versão nova do painel — e guarda uma
   cópia em DB.rotasExtras, que É persistida (ROTAS não é: é uma constante
   de código, recriada do zero a cada carga de página). extra.origem ===
   'sharepoint' identifica "isto já veio confirmado do servidor" (carga
   inicial ou reaplicação no load()) e pula o re-envio — do contrário,
   toda leitura completa reenviaria as mesmas rotas de volta ao servidor. */
function upsertRota(codigo, nome, detalhe, operador, extra){
  extra = extra || {};
  codigo = String(codigo||'').trim();
  if(!codigo) return null;
  const rota = {
    codigo,
    nome: (nome||'').trim(),
    detalhe: (detalhe||'').trim(),
    operador: (operador||'').trim(),
  };

  const existente = ROTA_POR_CODIGO.get(codigo);
  if(existente){
    Object.assign(existente, rota);
  }else{
    ROTAS.push(rota);
    ROTAS.sort((a,b)=> a.codigo.localeCompare(b.codigo, 'pt-BR', {numeric:true}));
    ROTA_POR_CODIGO.set(codigo, rota);
  }

  if(!Array.isArray(DB.rotasExtras)) DB.rotasExtras = [];
  const idx = DB.rotasExtras.findIndex(r => r.codigo === codigo);
  if(idx >= 0) DB.rotasExtras[idx] = rota; else DB.rotasExtras.push(rota);
  SuincoStore.save();

  if(extra.origem !== 'sharepoint'
     && typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado()){
    SuincoSharePoint.upsert('rotas', 'codigo', {
      Codigo: rota.codigo, Nome: rota.nome, Detalhe: rota.detalhe, Operador: rota.operador
    }, DB.operador).then(r=>{
      if(r && r.recusado && _aoRecusarRota) _aoRecusarRota(rota, r.erro);
      /* Enfileirada = gravou aqui e AINDA não subiu. Precisa de aviso
         próprio: o estado geral da conexão pode estar "online" e mesmo
         assim esta gravação específica ter caído na fila (foi o caso do
         incidente da rota 537 em 14/08/2026). Sem isto, quem cadastra vê
         "cadastrada" e conclui que os outros setores já receberam. */
      else if(r && r.enfileirado && _aoEnfileirarRota) _aoEnfileirarRota(rota);
    }).catch(e=>console.warn('[Suinco] sync rota:', e));
  }
  return rota;
}

/* ---------- mapeamento de cor/rótulo para o PDF Operacional e para
   Dim_Status (export Power BI) ----------
   Mapeamento de "Status de Carregamento" no PDF Operacional (planilha de
   sequenciamento), agora direto para os 6 status reais — sem lacuna pra
   preencher, porque "Liberado para Embarque"/"Liberado para Saída" não
   existem mais:
     Aguardando Veículo             -> "NÃO ESTÁ NA SUINCO" (vinho)
     Aguardando Embarque            -> "PÁTIO" (amarelo)
     Embarque Iniciado              -> "CARREGANDO" (laranja)
     Embarque Finalizado (ou além)  -> "CARREGADO" (verde) */
const STATUS_CARREGAMENTO_META = {
  'Aguardando Veículo':   { texto:'NÃO ESTÁ NA SUINCO', cor:'#8f1f26', classe:'cell-fora' },
  'Aguardando Embarque':  { texto:'PÁTIO',              cor:'#e9b954', classe:'cell-patio' },
  'Embarque Iniciado':    { texto:'CARREGANDO',         cor:'#d99a2b', classe:'cell-carregando' },
  'Embarque Finalizado':  { texto:'CARREGADO',          cor:'#3fa66a', classe:'cell-carregado' },
  'Faturado':             { texto:'CARREGADO',          cor:'#3fa66a', classe:'cell-carregado' },
  'Seguiu Viagem':        { texto:'CARREGADO',          cor:'#3fa66a', classe:'cell-carregado' }
};
function statusCarregamentoInfo(status){
  return STATUS_CARREGAMENTO_META[status] || { texto: status||'—', cor:'#374a86', classe:'' };
}
// Cor de texto legível sobre um fundo colorido, escolhida pelo brilho do
// fundo (luminância relativa, fórmula do WCAG). Necessário porque as células
// coloridas do PDF Operacional usavam texto quase preto fixo: sobre o amarelo
// e o verde funcionava, mas sobre o vinho de "NÃO ESTÁ NA SUINCO" o texto
// praticamente sumia — e cor de status em relatório impresso é informação,
// então precisa ser legível em todas as faixas.
function textoSobre(corHex){
  const m = /^#?([0-9a-f]{6})$/i.exec(String(corHex||'').trim());
  if(!m) return '#06210f';
  const n = parseInt(m[1], 16);
  const canal = v => { const c = v/255; return c <= .03928 ? c/12.92 : Math.pow((c+.055)/1.055, 2.4); };
  const L = .2126*canal((n>>16)&255) + .7152*canal((n>>8)&255) + .0722*canal(n&255);
  return L > .45 ? '#06210f' : '#ffffff';
}

/* ---------- CORES DOS 6 STATUS PARA OS RELATÓRIOS ----------
   STATUS_CARREGAMENTO_META acima colapsa 3 status em "CARREGADO" verde —
   correto para a planilha de sequenciamento do pátio, onde só importa se o
   caminhão está carregado ou não. Mas nos relatórios executivos precisamos
   distinguir os 6 status, então aqui vai a cor própria de cada um.
   Os valores são os MESMOS das badges da tela (ver styles.css), para que o
   PDF saia com a mesma leitura de cor que o gestor já tem no painel — cor de
   status é informação, não decoração, e precisa ser consistente entre tela e
   papel. O `print-color-adjust:exact` em html/body garante que o navegador
   não descarte esses fundos ao gerar o PDF. */
// Sufixo CSS de cada status — liga o status às variáveis --st-<slug>-bg/fg/br
// definidas em styles.css. Vem do nome da badge, pra não existir uma segunda
// lista de nomes que possa divergir da primeira.
function statusSlug(status){
  const meta = STATUS_META[status];
  return meta && meta.badge ? meta.badge.replace(/^badge-/, '') : 'neutro';
}
// Cores do status no tema ATIVO. Os valores vêm do CSS (fonte única, definida
// para os dois temas), lidos aqui via getComputedStyle porque relatórios
// montam estilo em string e canvas não entende var(). Com isso, alternar
// claro/escuro repinta relatórios e gráficos sem nenhuma tabela paralela de
// cores para manter em sincronia.
function corStatusRelatorio(status){
  const slug = statusSlug(status);
  const ler = (sufixo, alt) => {
    if(typeof getComputedStyle === 'undefined') return alt;
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(`--st-${slug}-${sufixo}`).trim();
    return v || alt;
  };
  return {
    fundo: ler('bg', '#1e2a52'),
    texto: ler('fg', '#b7c0d4'),
    borda: ler('br', '#374a86'),
    /* `destaque` é o status escrito COMO TEXTO sobre a superfície do
       painel — e é diferente de `texto`, que é a cor do texto DENTRO do
       preenchimento colorido.

       A confusão entre os dois já produziu o mesmo defeito duas vezes: o
       painel "Cargas em aberto por status" pintava o número com `texto`, e
       em "Aguardando Embarque" isso é #1a1200 (quase preto) sobre card
       azul-escuro — razão 1,14, invisível.

       Regra prática: se a cor vai junto com `background:` do mesmo status,
       use `texto`. Se vai sozinha, use `destaque`. */
    destaque: ler('txt', ler('bg', '#b7c0d4'))
  };
}
// "Faturado" ou além no fluxo (Faturado, Seguiu Viagem) -> célula verde no PDF.
function estaFaturado(carga){
  const idx = STATUS_FLOW.indexOf(carga.status);
  return idx >= STATUS_FLOW.indexOf('Faturado');
}
// Ordem do fluxo — usada pelo export Dim_Status. Só os 6 status reais (sem
// "Aguardando Carga", que não é mais um valor de status, é só o texto que
// fica no campo Número da Carga até a Logística completar os dados).
const STATUS_ORDEM_EXPORT = STATUS_FLOW.slice();

// Quais abas cada setor enxerga. 'torre' (visão geral) e 'historico' são
// leitura liberada pra todos — é o que dá a visão de torre de controle.
// Decisão confirmada: a ocultação por setor FICA. Quem precisa operar outro
// posto (cobertura de turno, por exemplo) usa "Trocar usuário" e entra com o
// setor correspondente — o modal de login explica isso, para ninguém concluir
// que a tela não existe.
// Isto é conveniência de interface, não segurança: qualquer pessoa com o
// arquivo pode contornar. Controle de acesso real só existe com SharePoint +
// SSO — ver RELATORIO_TI_HOSPEDAGEM.md. O que garante rastreabilidade é a
// trilha de auditoria: toda movimentação grava operador e setor.
/* Logística e Administração são papéis de ACESSO TOTAL à operação.

   A Logística cobre qualquer posto quando falta gente — troca de turno,
   almoço, alguém que faltou. Escondendo a aba da Portaria dela, o painel
   obrigava a "trocar usuário" para fazer algo que a pessoa já tem
   autoridade para fazer, e isso empurra para o pior desfecho possível:
   compartilhar a senha do porteiro.

   A diferença entre as duas está numa coisa só: a aba Usuários. Criar
   acesso não é operar o pátio — é decidir quem entra. Fica com a
   Administração, como definido desde o início. */
/* 'devolucoes' está aqui — e só aqui — de propósito (fase 1, 18/08/2026):
   ABAS_OPERACIONAIS alimenta exatamente Logística e Administração, que são
   quem alimenta e audita o checklist digital antes de abrir para os outros
   setores (decisão da reunião com o gestor). A fase 2 é acrescentar a aba
   às listas dos setores — nada além disso. */
const ABAS_OPERACIONAIS = ['torre','programacao','devolucoes','portaria',
                           'expedicao','faturamento','indicadores','cadastros',
                           'historico','relatorios'];

/* A Torre saiu das abas de quem opera um posto só.

   Não é perda de acesso: a visão do pátio passou para DENTRO da aba do
   setor, com linha do tempo e filtro de período. Antes era preciso trocar
   de aba para ver o pátio e voltar para agir — duas abas para uma tarefa
   só, dezenas de vezes por turno.

   Logística e Administração mantêm a Torre separada, porque para elas ela
   é a visão de comando sobre todos os postos, não um apoio ao próprio. */
const SETOR_PERMISSOES = {
  'Logística':    ABAS_OPERACIONAIS.slice(),
  /* 'devolucoes' nos setores do ciclo — fase 2 LIBERADA pelo usuário
     (18/08/2026): "preciso que haja um relacionamento entre todos os
     setores... todos na mesma página... workflow fácil como o das filas".
     Cada setor vê a fila "SUA VEZ" e edita só a própria coluna. */
  'Portaria':     ['portaria','devolucoes','historico'],
  /* Expedição é o único setor operacional com Indicadores.

     Não é exceção arbitrária: é onde o tempo do pátio efetivamente se
     forma. Portaria registra chegada e saída — dois carimbos que ela não
     controla. Faturamento emite. A Expedição é quem opera as duas etapas
     mais longas do fluxo (Embarque Iniciado e Embarque Finalizado), e é o
     único posto que pode olhar "tempo médio de carregamento" e mudar
     alguma coisa no mesmo turno: remanejar doca, cobrar um conferente,
     reordenar a fila.

     Indicador sem poder de ação vira placar; com poder de ação, vira
     ferramenta. Por isso aqui sim, e nos outros dois não. */
  'Expedição':    ['expedicao','devolucoes','indicadores','historico','relatorios'],
  /* Relatórios abriu para os dois — pedido direto, não decisão minha: os
     dois setores precisam do mesmo PDF Operacional que já circula no
     grupo, sem depender da Logística gerar e mandar. A aba é tudo ou nada
     (não existe hoje permissão por cartão dentro dela), então junto do
     Operacional/Executivo eles também passam a ver Administração de
     Fretes (valor negociado do frete) e a exportação CSV — decisão
     tomada de propósito, não efeito colateral não notado. */
  'Faturamento':  ['faturamento','devolucoes','historico','relatorios'],
  'Administração':ABAS_OPERACIONAIS.concat(['usuarios']),
  /* Comercial — só leitura, pedido do usuário (08/08/2026): "acesso a
     visualizacao de tudo que a logistica e administração ve mas sem
     alterar nada... relatorios, historico, busca de cargas no historico,
     visao de patio... torre de controle... para minimizar comunicacoes
     desnecessarias atras de informacoes". Torre já traz a Visão do Pátio
     embutida (ver comentário de ABAS_OPERACIONAIS acima) e a busca de
     cargas mora dentro de Histórico — as três abas cobrem o pedido
     inteiro sem duplicar nada. Nenhuma aba de ação (Programação, Portaria,
     Expedição, Faturamento, Cadastros, Usuários) entra aqui — e mesmo que
     entrasse na tela, o servidor recusaria qualquer escrita: Comercial não
     está em nenhuma função de permissão de dominio/fluxo.js. Indicadores
     ficou de fora por não ter sido pedido — cabe entrar depois se fizer
     falta, é mudança de uma linha.

     REDUZIDO em 11/08/2026, a pedido do usuário: "a visão do comercial,
     só visão de pátio e histórico". Relatórios saiu — o Comercial
     consulta onde a carga está, não emite documento. A Visão do Pátio
     mora dentro da Torre (ver ABAS_OPERACIONAIS acima), por isso 'torre'
     continua: é o caminho para ela, não acesso a mais poder (a Torre é
     leitura pura, e os campos editáveis dela só aparecem para quem pode
     cancelar carga — Logística/Administração). */
  'Comercial':    ['torre','historico'],
  /* Setores da devolução (18/08/2026): cada um assina um passo do
     checklist digital — Controles Internos destina os produtos, Central
     de Notas finaliza a NF. Só veem a aba Devoluções e o Histórico; o
     servidor confere de novo o que cada um pode gravar. */
  'Controles Internos': ['devolucoes','historico'],
  'Central de Notas':   ['devolucoes','historico'],
};

// Função de cada aba, exibida no topo dela. Serve para quem abre o painel pela
// primeira vez saber o que fazer ali sem depender de treinamento verbal.
const TAB_FUNCAO = {
  torre:       { setor:'Todos',        oque:'Acompanhar todas as cargas em aberto, de todos os setores, em uma tela só.',                     move:'Não altera nada — é somente leitura.' },
  programacao: { setor:'Logística',    oque:'Cadastrar a carga do dia antes do caminhão chegar e definir a ordem de carregamento.',           move:'Cria a carga em Aguardando Veículo.' },
  portaria:    { setor:'Portaria',     oque:'Registrar a entrada e a saída física do caminhão no pátio.',                                      move:'Chegou: Aguardando Veículo → Aguardando Embarque. Saiu: Faturado → Seguiu Viagem.' },
  expedicao:   { setor:'Expedição',    oque:'Controlar o carregamento do veículo, do início ao fim.',                                          move:'Aguardando Embarque → Embarque Iniciado → Embarque Finalizado.' },
  faturamento: { setor:'Faturamento',  oque:'Emitir a nota da carga já carregada, liberando o caminhão para sair.',                             move:'Embarque Finalizado → Faturado.' },
  indicadores: { setor:'Logística e Expedição', oque:'Analisar tempo médio por etapa, comparar períodos e ver o ranking de transportadoras.', move:'Não altera nada — é somente leitura.' },
  cadastros:   { setor:'Logística',    oque:'Manter a base de Frota (placa → transportadora → tipo) e as transportadoras.',                 move:'Não altera cargas — alimenta a Programação.' },
  historico:   { setor:'Todos',        oque:'Consultar a trilha de auditoria: quem moveu qual carga, de qual status para qual, e quando.',      move:'Não altera nada — registro permanente.' },
  /* Rótulo do chip precisa ficar CURTO — .funcao-chip é white-space:nowrap
     de propósito (é uma pílula, não um parágrafo) e a frase completa dos
     quatro setores estourava a página em celular de 320-390px. "Todos,
     exceto Portaria" diz a mesma coisa em menos caracteres. */
  relatorios:  { setor:'Todos, exceto Portaria', oque:'Gerar o PDF operacional (para o pátio) e o executivo (para a gestão).', move:'Não altera nada — exporta o que já existe.' },
  usuarios:    { setor:'Administração', oque:'Criar, bloquear e redefinir senha dos operadores de todos os setores.',                            move:'Não altera cargas — define quem entra e o que cada um pode registrar.' }
};

const SETORES = Object.keys(SETOR_PERMISSOES);

/* ---------- estado em memória ---------- */
let DB = {
  frota: [],             // {placa, transportadora, tipoVeiculo, origem}
  frotaSeedVersao: null,  // hash da base de frota já importada (ver carregarFrotaSeedSeVazia)
  // Rotas cadastradas pela tela (Administração), fora das 33 do seed
  // estático ROTAS. Persistidas aqui — não dentro de ROTAS — porque ROTAS é
  // uma constante de código, recriada do zero a cada carga da página; sem
  // isto, uma rota cadastrada offline sumiria no primeiro reload antes de a
  // sincronização terminar. Reaplicadas em ROTAS no load() (ver upsertRota).
  rotasExtras: [],
  transportadoras: [],  // {id, nome}
  cargas: [],            // ver criarCargaProgramada/registrarChegadaPortaria
  movimentacoes: [],      // log — nunca editado, só append
  /* Alterações de dado que NÃO são mudança de status (troca de placa, por
     exemplo). Ficam separadas de `movimentacoes` de propósito: a linha do
     tempo da carga mostra as 6 etapas do fluxo, e misturar "trocou a placa"
     ali faria a timeline mentir sobre o que aconteceu com o caminhão.

     Espelha a separação que o banco já faz entre fact_StatusFrota (etapas)
     e LOG_EVENTOS (auditoria). Append-only, como o outro. */
  alteracoes: [],
  /* Marca de "esta versão da carga já subiu", por id. Persistida de
     propósito: ver o comentário em SuincoStore._ultimoSync. */
  _sincronizado: {},
  operador: null,          // {nome, setor, turno} — placeholder até SSO
  dark: true
};

/* ---------- storage adapter (trocar aqui quando vier o SharePoint) ---------- */
const SuincoStore = {
  load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw) Object.assign(DB, JSON.parse(raw));
      invalidarIndiceFrota();
      if(!DB._sincronizado || typeof DB._sincronizado !== 'object') DB._sincronizado = {};
      // Poda: sem isto a marca cresceria para sempre, guardando id de carga
      // que já saiu do painel.
      const vivas = new Set(DB.cargas.map(c => c.id));
      Object.keys(DB._sincronizado).forEach(id => { if(!vivas.has(id)) delete DB._sincronizado[id]; });
      SuincoStore._ultimoSync = new Map(Object.entries(DB._sincronizado));
      // ROTAS é constante de código: recomeça do zero (só as 33 do seed) a
      // cada carga de página. As cadastradas pela tela ficam salvas em
      // DB.rotasExtras — reaplicar aqui é o que faz uma rota nova
      // sobreviver ao F5 mesmo antes de a sincronização com o servidor
      // terminar. origem:'sharepoint' porque isto é reidratação de dado já
      // gravado, não uma gravação nova — sincronizar de novo aqui reenviaria
      // a mesma rota ao servidor a cada abertura do painel.
      (DB.rotasExtras||[]).forEach(r => upsertRota(r.codigo, r.nome, r.detalhe, r.operador, {origem:'sharepoint'}));
      const migradas = migrarPraOnde();
      if(migradas) console.info(`[Suinco] "Pra onde?" migrado em ${migradas} carga(s).`);
    }catch(e){ console.error('Falha ao carregar dados locais', e); }
  },
  // Grava local e devolve imediatamente. A ida ao SharePoint acontece em
  // seguida, sem bloquear a tela — ver o comentário de "local-first" em
  // suinco-sharepoint.js. Mantida SÍNCRONA de propósito: é chamada em ~18
  // pontos das regras de negócio, e torná-la assíncrona obrigaria a mexer em
  // toda a máquina de estados, que a diretriz manda não alterar.
  save(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    }catch(e){ console.error('Falha ao salvar dados locais', e); }
    // Ponto único de saída para o SharePoint. Roda depois de a regra de
    // negócio ter aplicado a mudança, que é justamente o que faltava.
    this.sincronizarCargasAlteradas();
  },

  // Marca de quando cada carga foi sincronizada pela última vez. Só sobe o
  // que mudou de fato — save() é chamado com frequência e reenviar tudo a
  // cada clique geraria tráfego inútil contra o tenant.
  /* O QUE JÁ SUBIU AO SERVIDOR — precisa sobreviver ao recarregamento.

     Era só um Map em memória, e isso causou perda de dado em produção
     (14/08/2026): a cada F5 ele nascia vazio, e a primeira gravação
     reenviava TODAS as cargas do cache local com os valores daquele
     navegador. Um terminal que estava só com a tela aberta desfazia o que
     outro setor tinha acabado de gravar — observação apagada, data de
     programação voltando para a data de chegada — sem ninguém ter editado
     nada.

     Ficou visível no banco: 109 cargas com `atualizado_em` nos mesmos dois
     instantes, logo depois de o serviço reiniciar e os painéis recarregarem.
     A auto-atualização (que recarrega a aba sozinha) tornou isso frequente.

     Agora a marca vive em DB._sincronizado, que é persistido junto com o
     resto. Depois de um F5 o painel sabe o que já subiu e só envia o que
     ele mesmo mudou. */
  _ultimoSync: new Map(),

  /* Último status que o SERVIDOR confirmou para cada carga.

     Existe porque mudança de status NÃO viaja pelo mesmo caminho dos outros
     campos, e confundir os dois deixou o painel travado em produção: o
     operador clicava "Chegou", a linha voltava para "Aguardando Veículo"
     dois segundos depois e ninguém entendia por quê.

     A rota PATCH /api/cargas/:id só aceita os campos que o setor pode
     editar (fluxo.js, CAMPOS_EDITAVEIS) — e `status_atual` não está na
     lista de NENHUM setor, de propósito: status é máquina de estados, não
     campo de formulário. Quem move a carga é POST /api/cargas/:id/status,
     que valida a transição e o setor.

     Sem esta marca, o painel mandava o status dentro do PATCH, o servidor o
     descartava em silêncio, gravava só `atualizado_em`, e devolvia a carga
     com o status ANTIGO e a data NOVA. Na fusão seguinte o remoto vencia por
     ser mais recente e desfazia o clique. */
  _ultimoStatusSync: new Map(),

  /* UMA SUBIDA POR VEZ, POR CARGA (23/08/2026).

     Sem isto, duas alterações seguidas na mesma carga viravam duas
     requisições em voo ao mesmo tempo — e a mais VELHA podia ser aplicada
     por último, gravando por cima o valor que ela nem sabia que tinha
     mudado.

     Capturado no tráfego, editando sequência e ganchos na mesma ação:

       PATCH {"qtdGanchos": 0,  "sequencia": 7}   <- estado ANTES dos ganchos
       PATCH {"qtdGanchos": 33, "sequencia": 7}   <- estado depois
       banco: sequencia = 7, qtd_ganchos = 0

     Cada `save()` monta o corpo INTEIRO da carga com o estado daquele
     instante. O primeiro save (da sequência) já carregava ganchos = 0; o
     segundo carregava 33. As duas saíram juntas, e quem chegou por último
     ao banco foi a primeira. O operador vê 33 na tela dele e o servidor
     guarda 0 — sem erro nenhum, que é o pior jeito de perder dado.

     É primo do eco de sincronização (ocorrência #01): lá era uma cópia
     velha de OUTRO terminal sobrescrevendo; aqui é uma cópia velha do
     PRÓPRIO terminal, criada milissegundos antes.

     A correção não é esperar mais: é não ter duas em voo. Enquanto uma
     carga está subindo, outra alteração dela só marca "refazer" — e o
     refazer relê o estado ATUAL, que já tem as duas mudanças. Duas edições
     rápidas viram uma requisição com o valor final, em vez de duas em
     corrida. */
  _emVoo: new Map(),
  _refazer: new Set(),

  sincronizarCargasAlteradas(){
    if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.estaConfigurado()) return;
    DB.cargas.forEach(c => {
      const marca = c.atualizadoEm || c.criadoEm || '';
      if(this._ultimoSync.get(c.id) === marca) return;      // nada mudou nesta
      if(this._emVoo.has(c.id)){
        /* Já existe uma subida desta carga em voo. NÃO marca como
           sincronizada: o estado atual ainda não chegou ao servidor, e
           marcar aqui faria a mudança sumir para sempre. */
        this._refazer.add(c.id);
        return;
      }
      this._ultimoSync.set(c.id, marca);
      if(!DB._sincronizado) DB._sincronizado = {};
      DB._sincronizado[c.id] = marca;                       // sobrevive ao F5
      this._subirCarga(c.id);
    });
  },

  /* Sobe UMA carga e, ao terminar, refaz se ela mudou no meio do caminho.
     Relê de DB.cargas de propósito: o objeto pode ter sido alterado desde
     que a subida começou, e o que interessa é o estado de agora. */
  _subirCarga(id){
    const atual = DB.cargas.find(x => x.id === id);
    if(!atual){ this._emVoo.delete(id); this._refazer.delete(id); return; }
    const p = this.sincronizarCarga(atual, DB.operador)
      .catch(e=>console.warn('[Suinco] sync carga:', e))
      .finally(()=>{
        this._emVoo.delete(id);
        if(this._refazer.has(id)){
          this._refazer.delete(id);
          const depois = DB.cargas.find(x => x.id === id);
          if(depois){
            const m = depois.atualizadoEm || depois.criadoEm || '';
            this._ultimoSync.set(id, m);
            if(!DB._sincronizado) DB._sincronizado = {};
            DB._sincronizado[id] = m;
            this._subirCarga(id);
          }
        }
      });
    this._emVoo.set(id, p);
  },

  /* ---- Sincronia com o SharePoint / Power BI ----
     Cada função abaixo traduz um objeto do painel para o formato da Lista
     correspondente no modelo do BI. Se o adaptador não estiver configurado
     ou estiver offline, a escrita vai para a fila e sobe depois — quem
     chama não precisa saber disso. */
  async sincronizarCarga(carga, operador){
    if(typeof SuincoSharePoint === 'undefined') return;
    // `_pendente` protege esta carga de ser sobrescrita pela sincronia
    // enquanto a gravação não confirmar. Ver regra 3 de fundirEstadoRemoto.
    carga._pendente = true;
    const r = await SuincoSharePoint.upsert('cargas', 'Carga_ID', {
      Title: carga.numeroCarga || carga.id,
      Carga_ID: carga.id,
      Numero_Carga: carga.numeroCarga || '',
      Placa: carga.placa,
      Transportadora: carga.transportadora || '',
      Tipo_Veiculo: carga.tipoVeiculo || '',
      Motorista: carga.motorista || '',
      Cliente: carga.cliente || '',
      Destino: carga.destino || '',
      Peso_Kg: carga.peso || 0,
      Doca: carga.doca || '',
      Rota_Codigo: carga.rota || '',
      Rota_Nome: (rotaInfo(carga.rota)||{}).nome || '',
      Rota_Operador: (rotaInfo(carga.rota)||{}).operador || '',
      Sequencia: carga.sequencia ?? null,
      Pra_Onde: carga.praOnde || '',
      Paletizada: paletizadaDaCarga(carga),
      Qtd_Ganchos: carga.qtdGanchos || 0,
      Qtd_Entregas: carga.qtdEntregas ?? 1,
      /* A observação é o campo do relatório Administração de Fretes (valor
         de frete, negociação, instruções). Ela ficou de fora deste pacote
         até 14/08/2026 e o gestor relatou o efeito: "a Administração de
         Fretes não está puxando as observações, nem de ontem nem de hoje".

         O servidor sempre teve a coluna e sempre aceitou o campo
         (dominio/cargas.js, CAMPOS_EDITAVEIS em fluxo.js) — quem não
         mandava era o painel, e o adaptador lia `campos.Observacoes`, que
         chegava sempre undefined. A observação vivia só no navegador de
         quem digitou; para todos os outros o relatório saía em branco.

         Mesma família do bug do cadastro de Frota, que mandava 3 campos e
         zerava capacidade e UF: campo esquecido no pacote de ida, sem erro
         nenhum na tela. */
      Observacoes: carga.observacoes || '',
      // Lacres da saída (18/08/2026) — nos TRÊS pontos, como manda o
      // guardião nº 1: aqui (ida), daApiParaLinha (volta) e
      // cargaDeLinhaRemota (conversão).
      Lacre: carga.lacre || '',
      Lacre_2: carga.lacre2 || '',
      Lacre_3: carga.lacre3 || '',
      Lacre_Retido: carga.lacreRetido || '',
      Status_Atual: carga.status,
      Aguardando_Carga: !!carga.aguardandoCarga,
      Criado_Em: carga.criadoEm,
      /* Data em que a CARGA foi lançada (≠ chegada do caminhão). O
         relatório filtra por ela — ver filtrarPorDataProgramacao.

         NUNCA derivar de `criadoEm` (19/08/2026). Para um caminhão que
         entrou pela Portaria, `criadoEm` é a hora em que ele ENTROU no
         pátio; mandar isso aqui gravava a data da entrada como se fosse a
         da programação, e a carga lançada hoje sumia do relatório de hoje.
         Foi o que tirou duas cargas da programação de 19/08.

         Entrada ainda sem carga não tem data de programação: manda null e
         o servidor decide no lançamento. */
      Programado_Em: carga.aguardandoCarga ? null : (carga.programadoEm || null),
      // Atualizado_Em é o que decide quem vence quando dois setores mexem na
      // mesma carga. Sem ele a fusão não teria como comparar as versões.
      Atualizado_Em: carga.atualizadoEm || nowISO()
    }, operador);

    /* Recusa de criação/edição avisada — generalização do achado da
       chegada sem programação (achado #1 da auditoria "superpowers").

       `upsert()` RETORNA `{recusado:true, erro}` quando o servidor recusa
       (403/409/422) — não lança exceção. `sincronizarCargasAlteradas()`,
       que chama esta função, só tem `.catch(e=>console.warn(...))`: isso só
       pega exceção lançada, nunca inspeciona o valor resolvido. Sem este
       aviso, qualquer recusa de criação ou edição ficava só no console —
       a tela do operador continuava mostrando sucesso.

       Compare com o caminho de exclusão (excluirCargaUI, app.js), que já
       checava `r.recusado` e avisava — criação/edição não tinha o
       equivalente. */
    if(r && r.recusado){
      /* Carga NUNCA confirmada pelo servidor (_nuncaConfirmada, marcada na
         criação) pode ser removida com segurança: ao contrário de uma
         edição — onde o servidor já tinha uma versão válida da carga antes
         desta tentativa, e chutar "não existia" apagaria dado de verdade —
         aqui não existe versão anterior nenhuma para perder. Sem isto, uma
         carga recusada na criação (placa fora da frota, setor sem
         permissão) ficava como fantasma na tela de quem criou: "Aguardando
         Veículo", com aviso, mas invisível em qualquer outro terminal —
         achado em produção em 07/08/2026. */
      const eraCriacaoNuncaConfirmada = !!carga._nuncaConfirmada;
      if(eraCriacaoNuncaConfirmada){
        DB.cargas = DB.cargas.filter(c => c.id !== carga.id);
      }
      if(_aoRecusarCarga) _aoRecusarCarga(carga, r.erro, eraCriacaoNuncaConfirmada);
    } else if(r && r.enfileirado === false){
      delete carga._nuncaConfirmada;
    }

    /* MUDANÇA DE STATUS VAI POR ROTA PRÓPRIA, e este bloco é a correção de
       um defeito que fazia o clique "voltar sozinho".

       O upsert acima grava CAMPOS DE NEGÓCIO por PATCH, e o servidor filtra
       o PATCH pelo setor: a Portaria só pode editar `motorista` e
       `observacoes` (CAMPOS_EDITAVEIS em dominio/fluxo.js). O `status_atual`
       era descartado no caminho — sempre, em silêncio.

       O estrago vinha do gatilho `tg_viagem_update`: o PATCH regravava
       motorista/observações com os MESMOS valores, o gatilho carimbava
       `atualizado_em = now()`, e a linha do servidor ficava mais NOVA que a
       local — com o status ANTIGO. Quinze segundos depois a sincronia
       comparava os carimbos, o remoto vencia pela regra 2 de
       fundirEstadoRemoto, e o status voltava para onde estava.

       Da Portaria se via exatamente isto: aperta "Chegou", a linha muda, e
       pouco depois ela volta para "Aguardando Veículo".

       `mudarStatus` usa POST /api/cargas/:id/status, que valida a transição
       e o setor no servidor. A função existia desde o começo e NUNCA tinha
       sido chamada por ninguém — foi escrita e não ligada.

       Vai DEPOIS do upsert de propósito: garante que a carga já exista no
       servidor antes de tentar movê-la. */
    /* FILA POR CARGA, e NÃO uma marca só. Duas razões, ambas descobertas
       medindo:

       ORDEM. O servidor valida transição a transição: não dá para pular de
       "Aguardando Veículo" direto para "Embarque Iniciado". Se a Expedição
       avança duas etapas em poucos segundos, as duas precisam subir na
       sequência em que aconteceram.

       CONCORRÊNCIA. `sincronizarCarga` é disparada a cada save() e não
       espera a anterior terminar. Com uma marca única, duas execuções liam
       o mesmo valor e mandavam o MESMO status duas vezes — a segunda o
       servidor recusaria por transição inválida, e a recusa desfaria na
       tela um avanço que estava correto. O defeito original voltaria pela
       porta dos fundos.

       `_enviandoStatus` garante um drenador por carga; o `while` garante a
       ordem. */
    let statusSubiu = true;
    const pendentes = carga._statusPendentes;
    if(pendentes && pendentes.length && !carga._enviandoStatus){
      carga._enviandoStatus = true;
      try{
        while(carga._statusPendentes.length){
          const alvo = carga._statusPendentes[0];
          const rs = await SuincoSharePoint.mudarStatus(carga.id, alvo);
          if(rs && rs.recusado){
            /* O servidor recusou. Manter a tela mostrando um status que o
               banco não aceitou é pior do que desfazer: o operador seguiria
               trabalhando em cima de uma carga que, para todos os outros
               terminais, nunca saiu do lugar. Descarta a fila inteira — o
               que vinha depois dependia desta etapa. */
            carga._statusPendentes = [];
            statusSubiu = false;
            if(_aoRecusarStatus) _aoRecusarStatus(carga, alvo, rs.erro);
            break;
          }
          if(!rs || rs.enfileirado !== false){
            // Sem rede: já está na fila offline, que sobe em ordem depois.
            statusSubiu = false;
            break;
          }
          carga._statusPendentes.shift();
        }
      } finally {
        delete carga._enviandoStatus;
      }
    } else if(pendentes && pendentes.length){
      // Outro drenador está em voo para esta carga: não libera a proteção.
      statusSubiu = false;
    }

    // Só libera quando a gravação foi de fato aceita. Se ficou na fila, a
    // carga segue protegida até drenar — senão a próxima leitura apagaria da
    // tela a alteração que o operador acabou de fazer.
    if(r && r.enfileirado === false && statusSubiu) delete carga._pendente;
    return r;
  },
  async sincronizarMovimentacao(mov, operador){
    if(typeof SuincoSharePoint === 'undefined') return;
    // A mesma movimentação alimenta duas Listas com finalidades distintas:
    // fact_StatusFrota é a tabela fato que o Power BI cruza com as dimensões;
    // LOG_EVENTOS é a trilha de auditoria, imutável, que responde perguntas
    // do tipo "quem autorizou a saída da placa X às 14h?".
    await SuincoSharePoint.push('movimentacoes', {
      Title: mov.id,
      Movimentacao_ID: mov.id,
      Carga_ID: mov.cargaId,
      Placa: mov.placa,
      Status_Anterior: mov.statusAnterior || '',
      Status_Novo: mov.statusNovo,
      Setor: mov.setor,
      Data_Evento: mov.timestamp
    }, operador);
    await SuincoSharePoint.push('logs', {
      Title: `${mov.placa} — ${mov.statusNovo}`,
      Evento_ID: mov.id,
      Carga_ID: mov.cargaId,
      Placa: mov.placa,
      Acao: mov.statusAnterior ? `${mov.statusAnterior} -> ${mov.statusNovo}` : `Criada em ${mov.statusNovo}`,
      Setor: mov.setor,
      Data_Evento: mov.timestamp
    }, operador);
  },
  async sincronizarVeiculo(frota, operador){
    if(typeof SuincoSharePoint === 'undefined') return;
    return SuincoSharePoint.upsert('frota', 'Placa', {
      Title: frota.placa,
      Placa: frota.placa,
      Transportadora: frota.transportadora || '',
      Tipo_Veiculo: frota.tipoVeiculo || '',
      Capacidade_Kg: frota.capacidadeKg || null,
      UF: frota.uf || '',
      Motorista: frota.motorista || '',
      Precisa_Revisao: !!frota.precisaRevisao
    }, operador);
  }
};

// Chamado quando a fila sobe por completo: nenhuma carga segue protegida.
// A fila de status sai junto — se a fila offline drenou, os POST de status
// subiram nela, em ordem.
function liberarPendencias(){
  DB.cargas.forEach(c => {
    if(c._pendente) delete c._pendente;
    if(c._statusPendentes) delete c._statusPendentes;
  });
}

/* Aviso de status recusado pelo servidor.

   Mora aqui, e não em app.js, porque quem descobre a recusa é a camada de
   sincronia. A tela registra a função e decide como mostrar — data.js não
   conhece notify() nem deve conhecer. */
let _aoRecusarStatus = null;
function aoRecusarStatus(fn){ _aoRecusarStatus = fn; }

/* Aviso de criação/edição de carga recusada pelo servidor. Mesmo motivo do
   par acima: quem descobre é sincronizarCarga(), quem decide como mostrar
   é a tela. */
let _aoRecusarCarga = null;
function aoRecusarCarga(fn){ _aoRecusarCarga = fn; }

/* Aviso de placa recusada pelo servidor ao cadastrar/atualizar Frota. Mesmo
   motivo dos dois pares acima. */
let _aoRecusarFrota = null;
function aoRecusarFrota(fn){ _aoRecusarFrota = fn; }

/* Mesmo par, para o cadastro de Rota (Cadastros → só Administração). */
let _aoRecusarRota = null;
function aoRecusarRota(fn){ _aoRecusarRota = fn; }
let _aoEnfileirarRota = null;
function aoEnfileirarRota(fn){ _aoEnfileirarRota = fn; }

/* ---------- FUSÃO DO ESTADO REMOTO (operação compartilhada) ----------
   Recebe o que veio das Listas e mescla no DB local. É o ponto mais delicado
   do multiusuário: mesclar errado significa apagar o trabalho de outro setor.

   Regras, em ordem:

   1. CARGA QUE SÓ EXISTE NO SERVIDOR entra como está. É o caso normal: a
      Logística criou e a Portaria está vendo pela primeira vez.

   2. CARGA QUE EXISTE NOS DOIS LADOS: vence a mais recente por
      `atualizadoEm`. Empate mantém a local (não faz diferença prática e evita
      redesenho desnecessário da tela).

   3. CARGA COM ALTERAÇÃO LOCAL AINDA NÃO SINCRONIZADA nunca é sobrescrita.
      A marca é `_pendente`, posta ao gravar e retirada quando a fila drena.
      Sem isto, o ciclo de 15 s apagaria da tela uma mudança que o operador
      acabou de fazer e que ainda não subiu — o pior erro possível aqui.

   4. MOVIMENTAÇÕES são só acrescentadas, nunca alteradas: é log. A
      deduplicação é por `id`.

   O retorno diz o que mudou, para a interface avisar o operador em vez de a
   tela se alterar sozinha sem explicação. */
function fundirEstadoRemoto(dados){
  // `detalhes` alimenta a notificação de "atualizado por outro setor" com
  // o que mudou de verdade, em vez de só uma contagem — pedido do usuário
  // (08/08/2026): "que diga exatamente o que foi feito, ou indique o
  // setor e ação". Capado (não é a lista completa) porque essa mesma
  // sincronia pode trazer dezenas de cargas de uma vez (reconexão depois
  // de um tempo offline) — listar cada uma tornaria a notificação maior
  // que o problema que ela resolve.
  const DETALHES_MAX = 4;
  const res = { cargasNovas:0, cargasAtualizadas:0, movimentacoesNovas:0, ignoradasPorPendencia:0, detalhes:[] };
  if(!dados) return res;

  const registrarDetalhe = (carga, acao) => {
    if(res.detalhes.length >= DETALHES_MAX) return;
    const setor = (STATUS_META[carga.status] || {}).setor || null;
    res.detalhes.push({ placa: carga.placa, numeroCarga: carga.numeroCarga, status: carga.status, setor, acao });
  };

  // ---- cargas ----
  const locais = new Map(DB.cargas.map(c => [c.id, c]));
  (dados.cargas || []).forEach(r => {
    const carga = cargaDeLinhaRemota(r);
    if(!carga || !carga.id) return;
    const local = locais.get(carga.id);

    /* Carga excluída no servidor sai daqui, e das movimentações junto.

       Ela chega pela leitura incremental justamente para isso: é o único
       jeito de um terminal que estava aberto (ou sem rede) descobrir que a
       carga saiu. Sem este trecho, a linha ficaria na tela do colega até
       alguém recarregar a página inteira. */
    if(carga.excluida){
      if(local){
        DB.cargas = DB.cargas.filter(x => x.id !== carga.id);
        DB.movimentacoes = DB.movimentacoes.filter(m => m.cargaId !== carga.id);
        locais.delete(carga.id);
        res.cargasAtualizadas++;
        registrarDetalhe(carga, 'excluída');
      }
      return;
    }

    if(!local){
      DB.cargas.push(carga); locais.set(carga.id, carga); res.cargasNovas++;
      registrarDetalhe(carga, 'programada');
      return;
    }
    if(local._pendente){ res.ignoradasPorPendencia++; return; }          // regra 3
    const tLocal  = Date.parse(local.atualizadoEm || 0) || 0;
    const tRemoto = Date.parse(carga.atualizadoEm || 0) || 0;
    if(tRemoto > tLocal){
      const statusMudou = local.status !== carga.status;
      Object.assign(local, carga); res.cargasAtualizadas++;
      registrarDetalhe(local, statusMudou ? 'mudou de status' : 'foi editada');
    }
  });

  /* ---- movimentações (log: só acrescenta) ----

     O SERVIDOR É A FONTE DE VERDADE DO HORÁRIO (25/08/2026).

     Quando a movimentação do servidor chega, a provisória local do MESMO
     evento sai. Não é otimização: é o que impede o mesmo caminhão de ter
     duas horas de entrada no mesmo aparelho — uma do relógio do celular
     de quem clicou, outra do relógio do servidor.

     O casamento é por (carga, de → para), que é o que identifica o evento
     independentemente do id. Sai UMA provisória por movimentação que
     chega: se a mesma transição aconteceu duas vezes de verdade (correção
     de etapa), a segunda continua lá esperando a sua. */
  const vistas = new Set(DB.movimentacoes.map(m => m.id));
  (dados.movimentacoes || []).forEach(r => {
    const mov = movimentacaoDeLinhaRemota(r);
    if(!mov || !mov.id || vistas.has(mov.id)) return;
    const i = DB.movimentacoes.findIndex(x => x._local
      && x.cargaId === mov.cargaId
      && x.statusNovo === mov.statusNovo
      && (x.statusAnterior || null) === (mov.statusAnterior || null));
    if(i >= 0){
      vistas.delete(DB.movimentacoes[i].id);
      DB.movimentacoes.splice(i, 1);
    }
    DB.movimentacoes.push(mov); vistas.add(mov.id); res.movimentacoesNovas++;
  });

  // ---- frota (só na carga inicial; dimensão de leitura) ----
  if(Array.isArray(dados.frota) && dados.frota.length){
    dados.frota.forEach(r => {
      const placa = normalizarPlaca(r.Placa || '');
      if(!placa) return;
      upsertFrota(placa, r.Transportadora || '', r.Tipo_Veiculo || '', {
        precisaRevisao: r.Precisa_Revisao === true || r.Precisa_Revisao === 'Sim',
        origem: 'sharepoint'
      });
    });
  }

  // ---- rotas — traz pro terminal as rotas que OUTRO operador cadastrou
  // pela tela, sem esperar uma versão nova do painel.
  // origem:'sharepoint' porque isto já é confirmado pelo servidor. ----
  if(Array.isArray(dados.rotas) && dados.rotas.length){
    dados.rotas.forEach(r => {
      const codigo = String(r.Codigo||'').trim();
      if(!codigo) return;
      upsertRota(codigo, r.Nome || '', r.Detalhe || '', r.Operador || '', { origem:'sharepoint' });
    });
  }

  /* ROTA QUE CHEGA E O PAINEL NÃO CONHECE (20/08/2026).

     Relato do gestor, duas vezes no mesmo dia, em máquinas diferentes: "não
     entendo por que a rota 011 está aparecendo sem nada escrito, para mim só
     o número". A rota tinha sido cadastrada NAQUELE DIA. Quem cadastrou via
     o nome; os painéis abertos desde antes só viam o código, porque a lista
     de rotas era buscada uma vez, na carga da página — e painel de pátio
     fica aberto o dia inteiro.

     Carga com rota desconhecida É a evidência de que a lista está velha, e
     chega no exato instante em que alguém está olhando a linha sem nome.
     Rebusca na hora (com trava de 1 min do lado da API, para código digitado
     errado não virar uma chamada por ciclo). */
  const semNome = (DB.cargas || []).some(c => c.rota && !rotaInfo(c.rota));
  if(semNome && typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.recarregarRotas){
    SuincoSharePoint.recarregarRotas('carga com rota fora do catálogo')
      .then(n => { if(n) renderAll(); })
      .catch(()=>{});
  }

  if(res.cargasNovas || res.cargasAtualizadas || res.movimentacoesNovas){
    // Marca como já sincronizado o que acabou de VIR do servidor, senão o
    // save() abaixo devolveria tudo de volta — um eco infinito entre os
    // terminais, cada leitura gerando uma escrita.
    if(!DB._sincronizado) DB._sincronizado = {};
    DB.cargas.forEach(c => {
      const marca = c.atualizadoEm || c.criadoEm || '';
      SuincoStore._ultimoSync.set(c.id, marca);
      DB._sincronizado[c.id] = marca;
    });
    SuincoStore.save();
  }
  return res;
}

/* Identificadores são gerados por uid() e têm forma conhecida:
   prefixo_uuid, só letras, dígitos, hífen e sublinhado. Qualquer coisa fora
   disso vindo do repositório é rejeitada.

   Por quê: com a operação compartilhada, o id deixou de ser gerado só aqui —
   passa a vir de uma fonte que outras pessoas escrevem. E ele é interpolado
   dentro de atributos onclick nas tabelas. Um id contendo aspas quebraria o
   atributo e injetaria código no navegador de TODOS os setores. Auditoria de
   segurança confirmou o vetor com um payload real antes desta correção.

   Validar na fronteira protege todo uso do id de uma vez, em vez de depender
   de lembrar de escapar em cada ponto de renderização. */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;
function idSeguro(v){
  const s = String(v ?? '');
  return ID_SEGURO.test(s) ? s : null;
}

// Tradução das colunas da Lista de volta para o formato interno. Espelha o
// mapeamento de SuincoStore.sincronizarCarga — se um lado mudar, o outro
// precisa mudar junto.
function cargaDeLinhaRemota(r){
  if(!r || !r.Carga_ID) return null;
  const id = idSeguro(r.Carga_ID);
  if(!id){ console.warn('[Suinco] registro descartado: Carga_ID fora do formato', r.Carga_ID); return null; }
  return {
    id,
    numeroCarga: normalizarNumeroCarga(r.Numero_Carga),
    placa: normalizarPlaca(r.Placa || ''),
    transportadora: r.Transportadora || '',
    tipoVeiculo: r.Tipo_Veiculo || '',
    motorista: r.Motorista || '',
    cliente: r.Cliente || '',
    destino: r.Destino || '',
    peso: Number(r.Peso_Kg) || 0,
    doca: r.Doca || '',
    rota: r.Rota_Codigo || '',
    sequencia: (r.Sequencia === '' || r.Sequencia === null || r.Sequencia === undefined) ? null : Number(r.Sequencia),
    praOnde: PRA_ONDE_OPCOES.includes(r.Pra_Onde) ? r.Pra_Onde : PRA_ONDE_PADRAO,
    paletizada: r.Paletizada === 'Sim' ? 'Sim' : 'Não',
    qtdGanchos: Number(r.Qtd_Ganchos) || 0,
    qtdEntregas: r.Qtd_Entregas === undefined ? 1 : (Number(r.Qtd_Entregas) || 1),
    /* Terceiro e último ponto onde a observação se perdia (14/08/2026).
       Ela precisava ser adicionada nos TRÊS: no pacote de ida
       (SuincoStore.sincronizarCarga), na tradução de volta do adaptador
       (daApiParaLinha) e aqui, que é onde a carga do servidor vira carga
       do painel. Faltando em qualquer um dos três, o campo some sem erro
       nenhum — foi o que deixou o relatório Administração de Fretes em
       branco para todo mundo. */
    observacoes: r.Observacoes || '',
    lacre: r.Lacre || '',
    lacre2: r.Lacre_2 || '',
    lacre3: r.Lacre_3 || '',
    lacreRetido: r.Lacre_Retido || '',
    lacreRetidoMotivo: r.Lacre_Retido_Motivo || '',
    lacreRetidoPor: r.Lacre_Retido_Por || '',
    lacreRetidoEm: r.Lacre_Retido_Em || null,
    status: STATUS_FLOW.includes(r.Status_Atual) ? r.Status_Atual : STATUS_FLOW[0],
    aguardandoCarga: r.Aguardando_Carga === true || r.Aguardando_Carga === 'Sim',
    criadoEm: r.Criado_Em || nowISO(),
    /* Sem inventar com `criadoEm`: o modelo guarda o que o servidor tem, e
       quem exibe usa `programadoEm || criadoEm` como leitura. Preencher aqui
       fazia o painel devolver a data da chegada na sincronização seguinte —
       o erro voltava sozinho depois de corrigido. */
    programadoEm: r.Programado_Em || null,
    atualizadoEm: r.Atualizado_Em || r.Timestamp_Sincronia || nowISO(),
    /* Quando uma PESSOA mexeu, e quem foi. Nunca inventar com
       `atualizadoEm`: é exatamente essa confusão que fazia a Torre inteira
       exibir o mesmo horário depois de um eco de sincronização. */
    acaoEm: r.Acao_Em || null,
    acaoPor: r.Acao_Por || '',
    acaoSetor: r.Acao_Setor || '',
    excluida: r.Excluida === true
  };
}
function movimentacaoDeLinhaRemota(r){
  if(!r || !r.Movimentacao_ID) return null;
  const id = idSeguro(r.Movimentacao_ID);
  if(!id){ console.warn('[Suinco] evento descartado: Movimentacao_ID fora do formato', r.Movimentacao_ID); return null; }
  return {
    id,
    cargaId: idSeguro(r.Carga_ID) || '',
    placa: normalizarPlaca(r.Placa || ''),
    timestamp: r.Data_Evento || r.Timestamp_Sincronia || nowISO(),
    operador: r.Operador_Nome || r.Operador_ID || '(não identificado)',
    setor: r.Setor || r.Operador_Setor || '—',
    statusAnterior: r.Status_Anterior || null,
    statusNovo: r.Status_Novo || '',
    cliente: '', motorista: '', tipoVeiculo: '', qtdEntregas: null
  };
}

/* ---------- helpers ---------- */
function uid(prefix){
  const rnd = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now()+'-'+Math.random().toString(16).slice(2));
  return (prefix?prefix+'_':'') + rnd;
}
function nowISO(){ return new Date().toISOString(); }
function fmtDataHora(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
// Só a hora (HH:MM), sem a data — usado na matriz de linha do tempo do
// relatório executivo, onde a data já está no cabeçalho e repetir em toda
// célula só tiraria espaço da informação que importa.
function fmtHora(iso){
  if(!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function normalizarPlaca(p){
  return (p||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function minutosEntre(isoA, isoB){
  if(!isoA || !isoB) return null;
  return Math.round((new Date(isoB) - new Date(isoA)) / 60000);
}
function fmtDuracao(min){
  if(min===null || min===undefined || isNaN(min)) return '—';
  if(min<60) return min+' min';
  const h = Math.floor(min/60), m = min%60;
  return h+'h'+String(m).padStart(2,'0')+'min';
}

/* ---------- FROTA (cadastro Placa → Transportadora / Tipo de Veículo) ----------
   Campos novos (schema pronto pro dia em que o dado real vier de um
   ERP/Sisatak com histórico dessas placas — hoje ficam opcionais/vazios):
   capacidadeKg, uf, dataUltimaMovimentacao, precisaRevisao. */
/* Índice Placa -> objeto da frota, para busca em tempo constante.
   Motivo: buscarFrota é chamada a cada tecla digitada na Programação e a
   cada validação da trava de frota, e upsertFrota roda uma vez por linha na
   importação da base inteira — com busca linear isso vira O(n²) na carga
   inicial. O índice é reconstruído sozinho sempre que DB.frota muda de
   tamanho ou de identidade, então nunca fica desatualizado em silêncio. */
let _frotaIndice = null;
let _frotaIndiceRef = null;
function indiceFrota(){
  if(_frotaIndice && _frotaIndiceRef === DB.frota && _frotaIndice.size === DB.frota.length){
    return _frotaIndice;
  }
  _frotaIndice = new Map();
  DB.frota.forEach(f => _frotaIndice.set(normalizarPlaca(f.placa), f));
  _frotaIndiceRef = DB.frota;
  return _frotaIndice;
}
function invalidarIndiceFrota(){ _frotaIndice = null; _frotaIndiceRef = null; }

function buscarFrota(placa){
  const p = normalizarPlaca(placa);
  if(!p) return null;
  return indiceFrota().get(p) || null;
}
function upsertFrota(placa, transportadora, tipoVeiculo, extra){
  const p = normalizarPlaca(placa);
  if(!p) throw new Error('Placa vazia');
  extra = extra || {};
  const capacidadeKg = extra.capacidadeKg!==undefined && extra.capacidadeKg!=='' ? Number(extra.capacidadeKg)||0 : null;
  const uf = extra.uf ? String(extra.uf).toUpperCase().slice(0,2) : '';
  const dataUltimaMovimentacao = extra.dataUltimaMovimentacao || null;
  const precisaRevisao = !!extra.precisaRevisao;
  // Motorista habitual da placa (só sugestão ao programar). `undefined`
  // preserva o que já estava cadastrado — importante porque a sincronia
  // remota e a importação em lote chamam esta função sem o campo, e
  // sobrescrever com '' apagaria o motorista de toda a frota.
  const motorista = extra.motorista !== undefined ? String(extra.motorista).trim() : undefined;
  const origem = extra.origem || 'manual';
  let f = indiceFrota().get(p);
  let entrada;
  if(f){
    f.transportadora = transportadora; f.tipoVeiculo = tipoVeiculo;
    f.capacidadeKg = capacidadeKg; f.uf = uf; f.dataUltimaMovimentacao = dataUltimaMovimentacao; f.precisaRevisao = precisaRevisao;
    if(motorista !== undefined) f.motorista = motorista;
    f.origem = origem;
    entrada = f;
  } else {
    const novo = { placa:p, transportadora, tipoVeiculo, capacidadeKg, uf, motorista: motorista || '', dataUltimaMovimentacao, precisaRevisao, origem };
    DB.frota.push(novo);
    if(_frotaIndice) _frotaIndice.set(p, novo); // mantém o índice quente na importação em lote
    entrada = novo;
  }
  SuincoStore.save();

  /* Sobe ao servidor. Achado em produção (07/08/2026): esta chamada nunca
     existia aqui — só a carga ÚNICA da base semente (carregarFrotaReal())
     chamava sincronizarVeiculo(), num laço explícito depois de importar
     tudo. Cadastro manual pela tela (este caminho, o do dia a dia) e
     importação em lote gravavam só localStorage e devolviam "sucesso" sem
     UMA chamada de rede sequer. A placa existia só no navegador de quem
     cadastrou; a Programação usa a cópia local (buscarFrota) pra liberar o
     formulário, então a carga nascia lá, e só o servidor — que nunca tinha
     a placa — recusava, tarde demais, sem ninguém mais no pátio nunca ter
     visto nada.

     EXCETO quando `origem === 'sharepoint'`: aí a placa não é dado novo,
     é o que ACABOU de vir do servidor em fundirEstadoRemoto() — "frota é
     dimensão só de LEITURA", como o comentário de lá já dizia. Sem esta
     exceção, todo pull cheio (login, reconexão) reenviava as 749 placas
     de volta pro servidor que tinha acabado de mandá-las — eco a cada
     sincronia completa, e rate limit estourado em segundos. Achado
     rodando a bateria de teste antes de publicar esta correção. */
  if(origem !== 'sharepoint'
     && typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado()){
    SuincoStore.sincronizarVeiculo(entrada, DB.operador).then(r=>{
      if(r && r.recusado && _aoRecusarFrota) _aoRecusarFrota(entrada, r.erro);
    }).catch(e=>console.warn('[Suinco] sync frota:', e));
  }
}
function removerFrota(placa){
  const p = normalizarPlaca(placa);
  DB.frota = DB.frota.filter(x => normalizarPlaca(x.placa) !== p);
  invalidarIndiceFrota();
  SuincoStore.save();
}
// Importação em lote: cola linhas "Placa;Transportadora;TipoVeiculo" (aceita
// ; ou TAB como separador, útil pra colar direto do Excel). Colunas extras
// opcionais na mesma ordem dos campos novos (CapacidadeKg;UF;DataUltimaMov;
// PrecisaRevisao) — se não vierem, ficam vazias/nulas, sem problema. Ignora
// linhas vazias ou incompletas. Retorna {ok, ignoradas}.
function importarFrotaLote(texto){
  const linhas = (texto||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let ok = 0, ignoradas = 0;
  linhas.forEach(linha=>{
    const partes = linha.split(/\t|;/).map(s=>s.trim());
    if(partes.length < 3 || !partes[0]){ ignoradas++; return; }
    upsertFrota(partes[0], partes[1]||'', partes[2]||'', {
      capacidadeKg: partes[3]||'', uf: partes[4]||'', dataUltimaMovimentacao: partes[5]||'',
      precisaRevisao: /^(sim|true|1)$/i.test(partes[6]||'')
    });
    ok++;
  });
  return {ok, ignoradas};
}

// Parser CSV padrão (RFC4180-lite): trata vírgula dentro de campo entre
// aspas (ex: razão social com vírgula) e aspas duplas escapadas (""). Usado
// só pela carga da base real de Frota abaixo — a colagem manual do Excel
// (importarFrotaLote) continua usando o parser simples de ;/TAB de sempre.
function parseCsvRfc4180(texto){
  const linhas = [];
  let campo = '', linha = [], dentroAspas = false;
  const txt = texto || '';
  for(let i=0; i<txt.length; i++){
    const ch = txt[i];
    if(dentroAspas){
      if(ch === '"'){
        if(txt[i+1] === '"'){ campo += '"'; i++; }
        else dentroAspas = false;
      } else campo += ch;
    } else {
      if(ch === '"') dentroAspas = true;
      else if(ch === ','){ linha.push(campo); campo = ''; }
      else if(ch === '\n'){ linha.push(campo); linhas.push(linha); campo=''; linha=[]; }
      else if(ch === '\r'){ /* ignora — \n cuida da quebra de linha */ }
      else campo += ch;
    }
  }
  if(campo !== '' || linha.length){ linha.push(campo); linhas.push(linha); }
  return linhas.filter(l => l.length && l.some(c => c !== ''));
}

// Carrega a base real de Frota (frota_seed_2026.csv — ver
// docs/NOTAS_BASE_FROTA.md) na primeira execução E sempre que a base mudar.
// Duas origens possíveis, nesta ordem:
//   1. window.FROTA_SEED_CSV — o CSV embutido direto no HTML. É o que a
//      versão de arquivo único (index.html) usa, porque
//      em file:// o navegador bloqueia fetch de arquivo local por CORS e
//      o painel abriria sem nenhuma placa.
//   2. fetch('frota_seed_2026.csv') — quando servido por HTTP (Teams/
//      SharePoint ou `python3 -m http.server`), com os arquivos separados.
// Se as duas falharem, o painel segue vazio normalmente, caindo de volta no
// cadastro/import em lote manual que já existia antes desta base chegar.
//
// POR QUE ISTO É VERSIONADO (defeito corrigido em 31/07/2026):
// antes, esta função só rodava com DB.frota vazio — "seed inicial, não sync".
// O efeito prático foi grave: quando a base oficial substituiu a anterior, os
// navegadores que já tinham a base velha NUNCA receberam a nova. Ficaram com
// 1.289 placas fora de operação e 327 com a transportadora errada, sem
// nenhum sinal na tela. O caso que revelou isso: a placa RMW1A91 aparecia
// como "Bem Frios" (que é a operadora) em vez de "Coopertral".
// Agora a versão da base é o hash do próprio CSV: trocar o arquivo muda o
// hash e dispara a reimportação sozinho, sem depender de alguém lembrar de
// incrementar um número.
function hashSeed(texto){
  let h = 5381;
  for(let i=0;i<texto.length;i++){ h = ((h<<5)+h+texto.charCodeAt(i))|0; }
  return 'v'+(h>>>0).toString(36)+'-'+texto.length;
}

async function carregarFrotaSeedSeVazia(){
  try{
    let texto;
    if(typeof window !== 'undefined' && window.FROTA_SEED_CSV){
      texto = window.FROTA_SEED_CSV;
    }else{
      const resp = await fetch('frota_seed_2026.csv');
      if(!resp.ok) return { carregado:false, motivo:'HTTP '+resp.status };
      texto = await resp.text();
    }

    const versao = hashSeed(texto);
    if(DB.frotaSeedVersao === versao){
      return { carregado:false, motivo:'Base de frota já está na versão atual' };
    }
    const primeiraCarga = !DB.frotaSeedVersao && DB.frota.length === 0;

    let linhas = parseCsvRfc4180(texto);
    if(linhas.length && linhas[0][0] === 'Placa') linhas = linhas.slice(1); // remove cabeçalho

    // Placas cadastradas à mão pelo Responsável pela Base de Frota são
    // preservadas; as que vieram de um seed anterior são substituídas pela
    // base nova. Registros antigos, gravados antes de existir o campo
    // `origem`, contam como seed — vieram todos da base anterior, que é
    // justamente a que precisa sair.
    const manuais = DB.frota.filter(f => f.origem && f.origem !== 'seed');
    const antes = new Map(DB.frota.map(f => [normalizarPlaca(f.placa), f]));

    DB.frota = manuais.slice();
    invalidarIndiceFrota();

    linhas.forEach(l=>{
      const [placa, transportadora, tipoVeiculo, precisaRevisao] = l;
      if(!placa) return;
      upsertFrota(placa, transportadora||'', tipoVeiculo||'', {
        precisaRevisao: /^sim$/i.test(precisaRevisao||''),
        origem: 'seed'
      });
    });

    // Resumo do que mudou — a operação precisa saber que a base trocou
    // debaixo dela, ainda mais quando uma placa muda de transportadora.
    const depois = new Map(DB.frota.map(f => [normalizarPlaca(f.placa), f]));
    let removidas = 0, alteradas = 0;
    antes.forEach((f, placa)=>{
      const nova = depois.get(placa);
      if(!nova) removidas++;
      else if((nova.transportadora||'') !== (f.transportadora||'')) alteradas++;
    });
    DB.frotaSeedVersao = versao;
    // A sincronia de cada placa com o servidor já aconteceu dentro do laço
    // acima — upsertFrota() sincroniza por linha desde a correção do
    // achado de 07/08/2026 (ver comentário lá). Repetir aqui duplicaria
    // 749 chamadas de rede na primeira carga da base.
    SuincoStore.save();
    return { carregado:true, total: linhas.length, primeiraCarga, removidas, alteradas,
             manuaisPreservadas: manuais.length };
  }catch(e){
    console.warn('Não foi possível carregar automaticamente a base real de Frota (frota_seed_2026.csv). Siga com cadastro manual ou import em lote em Cadastros → Frota.', e);
    return { carregado:false, motivo:String(e) };
  }
}

/* ---------- TRANSPORTADORAS (cadastro simples) ----------
   O cadastro de Docas foi removido junto com o campo Doca: ele existia
   apenas para alimentar o datalist daquele campo. O campo `doca` continua
   no modelo de dados e no export do Power BI para não invalidar registros
   já gravados. */
function listarTransportadoras(){ return DB.transportadoras.slice().sort((a,b)=>a.nome.localeCompare(b.nome)); }
function addTransportadora(nome){
  if(!nome || !nome.trim()) throw new Error('Nome vazio');
  DB.transportadoras.push({id:uid('transp'), nome:nome.trim()});
  SuincoStore.save();
}
function removerTransportadora(id){
  DB.transportadoras = DB.transportadoras.filter(t=>t.id!==id);
  SuincoStore.save();
}

/* ---------- LOG / MOVIMENTAÇÕES (histórico — nunca editado, só append) ----------
   Só é gravado quando o STATUS muda de verdade — nunca ao só editar/criar
   dados de uma carga sem mudar o status (ex: completar dados de uma
   "Aguardando Carga" não gera linha aqui, porque o status já nasceu certo).
   Cada linha carrega um SNAPSHOT de cliente/motorista/tipoVeiculo/
   qtdEntregas no momento da mudança — útil pro Fact_Movimentacoes do Power
   BI mesmo que esses campos mudem depois na carga. */
/* Registra uma alteração de dado na trilha de auditoria. Responde perguntas
   do tipo "quem trocou a placa dessa carga, e quando?" — que o histórico de
   status sozinho não responde. */
function registrarAlteracao({cargaId, placa, campo, de, para, operador, setor}){
  if(!Array.isArray(DB.alteracoes)) DB.alteracoes = [];   // base antiga
  DB.alteracoes.push({
    id: uid('alt'),
    timestamp: nowISO(),
    cargaId, placa: normalizarPlaca(placa),
    campo,
    de: de ?? '',
    para: para ?? '',
    operador: operador || '(não identificado)',
    setor: setor || '—'
  });
  // Sem save() aqui: quem chama grava junto com o resto da alteração, numa
  // gravação só. Salvar duas vezes dispararia dois ciclos de sincronia.
}

function registrarMovimentacao({cargaId, placa, statusAnterior, statusNovo, operador, setor, cliente, motorista, tipoVeiculo, qtdEntregas, timestamp}){
  DB.movimentacoes.push({
    id: uid('mov'),
    /* `timestamp` opcional, e existe por um caso só: a entrada HERDADA.

       Quando a carga muda para uma placa que já estava no pátio, o evento de
       "Aguardando Embarque" tem que carregar a hora em que o caminhão de fato
       entrou — não a hora da edição. O relógio de 3 horas começa na entrada;
       carimbar agora faria o SLA mentir a favor da operação, que é o pior
       tipo de erro num indicador. Fora desse caso, é sempre agora. */
    timestamp: timestamp || nowISO(),
    /* PROVISÓRIA ATÉ O SERVIDOR RESPONDER (25/08/2026).

       Este registro existe para a tela responder na hora — inclusive
       offline — e carrega o relógio DESTE aparelho. O servidor grava o
       dele, com `data_evento` no relógio DELE, e é esse que vale.

       Sem esta marca, os dois conviviam para sempre: a fusão do estado
       remoto deduplica por id, e o id local (uuid) nunca bate com o do
       servidor. O aparelho de quem registrou ficava com DUAS entradas
       para o mesmo caminhão, e a tela mostrava a mais antiga das duas —
       enquanto o aparelho do colega, que só recebeu a do servidor,
       mostrava outra hora. Foi o relato de 25/08: três telas, três
       horários para a mesma placa. */
    _local: true,
    operador: operador || '(não identificado)',
    setor: setor || '—',
    placa: normalizarPlaca(placa),
    cargaId,
    statusAnterior: statusAnterior || null,
    statusNovo,
    cliente: cliente || '',
    motorista: motorista || '',
    tipoVeiculo: tipoVeiculo || '',
    qtdEntregas: qtdEntregas ?? null
  });
  // Sobe a MOVIMENTAÇÃO (log append-only) sem bloquear quem chamou.
  //
  // A CARGA deliberadamente NÃO é sincronizada aqui. Motivo: as regras de
  // negócio chamam registrarMovimentacao ANTES de aplicar a mudança no objeto
  // (ver registrarChegadaPortaria, que registra e só então faz
  // `c.status = 'Aguardando Embarque'`). Sincronizar deste ponto subia o
  // estado ANTERIOR da carga — o servidor recebia PATCH com o status velho e a
  // mudança nunca chegava aos outros setores.
  // A carga sobe a partir de SuincoStore.save(), que por construção roda
  // depois de a mutação estar aplicada. Assim nenhuma regra de negócio
  // precisou ser reordenada.
  const mov = DB.movimentacoes[DB.movimentacoes.length - 1];
  if(typeof SuincoStore.sincronizarMovimentacao === 'function'){
    SuincoStore.sincronizarMovimentacao(mov, DB.operador).catch(e=>console.warn('[Suinco] sync movimentação:', e));
  }
}
// Monta o snapshot padrão a partir do objeto de carga corrente — evita
// repetir os mesmos 4 campos em toda chamada de registrarMovimentacao.
function snapshotCarga(c){
  return { cliente: c.cliente, motorista: c.motorista, tipoVeiculo: c.tipoVeiculo, qtdEntregas: c.qtdEntregas };
}
function historicoDaCarga(cargaId){
  return DB.movimentacoes.filter(m=>m.cargaId===cargaId).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
}
/* A ÚLTIMA MUDANÇA DE ETAPA — a MESMA linha que o Histórico mostra.

   Pedido do gestor (20/08/2026): "quero que na torre de controle apareça o
   horário fiel ao horário do histórico da última atualização de status de
   cada carga".

   Fiel não por coincidência: é literalmente o mesmo registro. A Torre passa
   a ler `DB.movimentacoes` — a trilha que alimenta o Histórico e a linha do
   tempo —, então não existe como as duas telas discordarem. Qualquer cópia
   desse horário em outro lugar poderia divergir; esta não é cópia.

   Devolve também QUEM fez e de qual setor, que é a outra metade da
   pergunta ("quem tocou nisso por último?"). */
function ultimaMovimentacaoDaCarga(cargaId){
  const h = historicoDaCarga(cargaId);
  return h.length ? h[h.length - 1] : null;
}
// Primeiro instante em que a carga atingiu determinado status (usado pelos indicadores).
function primeiroTimestamp(cargaId, status){
  const m = historicoDaCarga(cargaId).find(x=>x.statusNovo===status);
  return m ? m.timestamp : null;
}

/* ---------- CARGAS ---------- */
function cargasAbertas(){
  return DB.cargas.filter(c => c.status !== 'Seguiu Viagem');
}
function cargasAbertasPorPlaca(placa){
  const p = normalizarPlaca(placa);
  return cargasAbertas().filter(c => normalizarPlaca(c.placa) === p);
}
function getCarga(id){ return DB.cargas.find(c=>c.id===id) || null; }

// Criada pela Logística na tela Programação — já com dados completos,
// veículo ainda não chegou fisicamente (nasce em "Aguardando Veículo").
// TRAVA DE FROTA (correção oficial — antes era só aviso, agora BLOQUEIA):
// se a placa não estiver cadastrada em Frota, a criação é recusada. A
// Portaria continua podendo registrar a chegada de QUALQUER placa (mesmo
// não cadastrada) via "Aguardando Carga" — a trava é só na Programação.
function criarCargaProgramada({placa, transportadora, tipoVeiculo, numeroCarga, cliente, destino, produto, peso, doca, rota, sequencia, observacoes, motorista, praOnde, paletizada, qtdGanchos, qtdEntregas, operador}){
  const p = normalizarPlaca(placa);
  if(!p) throw new Error('Placa é obrigatória');
  const frota = buscarFrota(p);
  if(!frota){
    throw new Error(`Placa ${p} não está cadastrada na Frota. Cadastre em Cadastros → Frota antes de programar esta carga.`);
  }
  const carga = {
    id: uid('carga'),
    numeroCarga: normalizarNumeroCarga(numeroCarga),
    placa: p,
    transportadora: transportadora || frota.transportadora,
    tipoVeiculo: tipoVeiculo || frota.tipoVeiculo,
    motorista: motorista||'',
    cliente: cliente||'', destino: destino||'', produto: produto||'', peso: Number(peso)||0,
    doca: doca||'', sequencia: sequencia!==undefined && sequencia!=='' ? Number(sequencia) : null,
    observacoes: observacoes||'',
    praOnde: PRA_ONDE_OPCOES.includes(praOnde) ? praOnde : PRA_ONDE_PADRAO,
    // Só aceita código de rota conhecido. Vazio é válido de propósito: a
    // lista oficial ainda está incompleta (ver comentário em ROTAS).
    rota: rotaInfo(rota) ? String(rota).trim() : '',
    // Paletizada é declarada pelo operador, não calculada. Padrão 'Não'.
    paletizada: paletizada === 'Sim' || paletizada === true ? 'Sim' : 'Não',
    qtdGanchos: qtdGanchos!==undefined && qtdGanchos!=='' ? Math.max(0, Number(qtdGanchos)||0) : 0,
    qtdEntregas: qtdEntregas!==undefined && qtdEntregas!=='' ? Math.max(1, Number(qtdEntregas)||1) : 1,
    status: 'Aguardando Veículo',
    aguardandoCarga: false,
    criadoEm: nowISO(), criadoPor: operador||'(não identificado)',
    // Programada agora: aqui as duas datas coincidem. Elas só se separam
    // quando o caminhão chegou ANTES de a carga existir — ver
    // completarCargaAguardando.
    programadoEm: nowISO(),
    atualizadoEm: nowISO(),
    // Marca a carga como "ainda não existe no servidor" — permite que uma
    // recusa na primeira sincronia remova a carga localmente em vez de só
    // avisar (ver sincronizarCarga). Some assim que o servidor confirmar.
    _nuncaConfirmada: true
  };
  DB.cargas.push(carga);
  registrarMovimentacao({cargaId:carga.id, placa:p, statusAnterior:null, statusNovo:'Aguardando Veículo', operador, setor:'Logística', ...snapshotCarga(carga)});
  SuincoStore.save();
  return carga;
}

// Portaria — botão "Chegou": chegada física de uma placa. Regra especial —
// aplica a TODAS as cargas em aberto daquela placa de uma vez (é o mesmo
// caminhão chegando fisicamente uma única vez). Se não existir NENHUMA
// carga programada pra essa placa, cria uma linha que nasce DIRETO em
// "Aguardando Embarque" (o veículo já está fisicamente aqui — não faz
// sentido "esperar o veículo"), com o texto "Aguardando Carga" no campo do
// Número da Carga até a Logística completar os dados reais. `aguardandoCarga`
// (booleano) continua marcando essa linha pra aparecer na fila de
// pendências da Programação — não é mais um valor de status.
function registrarChegadaPortaria(placa, operador){
  const p = normalizarPlaca(placa);
  if(!p) throw new Error('Placa é obrigatória');

  /* TRAVA DE FROTA NA PORTARIA — decisão do gestor em 14/08/2026:
     "só vamos aceitar placas que estejam cadastradas, vinculadas a uma
     transportadora no cadastro".

     Até aqui a chegada sem programação era EXCEÇÃO à trava, de propósito:
     a ideia era deixar o porteiro registrar a presença do caminhão mesmo
     sem cadastro, e a Logística acertar depois. O gestor decidiu o
     contrário — a placa é o vínculo com a transportadora, e caminhão sem
     cadastro não deve gerar movimento nenhum no sistema.

     A checagem fica ANTES dos dois caminhos (criar e atualizar) porque o
     pedido foi justamente que nenhum movimento aconteça com placa fora da
     base. E a mensagem precisa ensinar a saída: travar sem dizer o que
     fazer só transfere o problema para o portão. */
  if(!buscarFrota(p)){
    throw new Error(`Placa ${p} não está cadastrada na Frota. `
      + `Cadastre em Cadastros → Frota (com a transportadora) antes de registrar a chegada.`);
  }

  const abertas = cargasAbertasPorPlaca(p);

  if(abertas.length === 0){
    const frota = buscarFrota(p);
    const carga = {
      id: uid('carga'), numeroCarga:'Aguardando Carga', placa: p,
      transportadora: frota ? frota.transportadora : '',
      tipoVeiculo: frota ? frota.tipoVeiculo : '',
      motorista:'',
      cliente:'', destino:'', produto:'', peso:0, doca:'', sequencia:null, observacoes:'',
      praOnde: praOndeSugerido(frota ? frota.transportadora : ''), rota:'', paletizada:'Não', qtdGanchos:0, qtdEntregas:1,
      status: 'Aguardando Embarque', aguardandoCarga: true,
      criadoEm: nowISO(), criadoPor: operador||'(não identificado)',
      atualizadoEm: nowISO(),
      _nuncaConfirmada: true
    };
    DB.cargas.push(carga);
    registrarMovimentacao({cargaId:carga.id, placa:p, statusAnterior:null, statusNovo:'Aguardando Embarque', operador, setor:'Portaria', ...snapshotCarga(carga)});
    SuincoStore.save();
    return {criadas:[carga], atualizadas:[], jaNoPatio:[]};
  }

  const paraAtualizar = abertas.filter(c => c.status === 'Aguardando Veículo');
  /* Só conta como "já está no pátio sem ter saído" a carga de uma
     programação ANTERIOR (20/08/2026). Duas cargas do MESMO dia na mesma
     placa são a rotina do pátio — carrega, pesa, carrega de novo, pesa —, e
     tratá-las como pendência travava a segunda entrada: "o veículo está no
     pátio... aí você dá a entrada nele e não dá". Mesma regra do servidor. */
  const diaDe = (c)=>{
    const base = c.programadoEm || c.criadoEm;
    if(!base) return null;
    const d = new Date(base); if(isNaN(d)) return null;
    d.setHours(0,0,0,0); return d.getTime();
  };
  const hojeDia = (()=>{ const h = new Date(); h.setHours(0,0,0,0); return h.getTime(); })();
  const jaNoPatio = abertas.filter(c => {
    if(c.status === 'Aguardando Veículo') return false;
    const d = diaDe(c);
    return d !== null && d < hojeDia;
  });

  /* CAMINHÃO QUE NÃO SAIU NÃO CHEGA DE NOVO (19/08/2026).

     O caso real tinha DUAS cargas na mesma placa: uma faturada do dia
     anterior, sem saída registrada, e uma programada para o dia. O "Chegou"
     promovia a de hoje e seguia como se nada houvesse, deixando a de ontem
     pendurada — "ele aceitou e agora ele sumiu".

     Enquanto houver carga da placa em Aguardando Embarque ou depois, o
     sistema entende que o caminhão ESTÁ no pátio. Se ele foi embora sem
     baixa, o que falta é a SAÍDA, não a chegada. Nada é alterado aqui: o
     servidor recusa igual (PLACA_COM_CARGA_ABERTA), e esta checagem é para
     o porteiro saber na hora, sem esperar a rede. */
  if(jaNoPatio.length){
    return {criadas:[], atualizadas:[], jaNoPatio, bloqueadaPorPendencia:true};
  }
  paraAtualizar.forEach(c=>{
    registrarMovimentacao({cargaId:c.id, placa:p, statusAnterior:c.status, statusNovo:'Aguardando Embarque', operador, setor:'Portaria', ...snapshotCarga(c)});
    c.status = 'Aguardando Embarque';
    // Enfileira para a sincronia mandar o status pela rota que o valida.
    // Sem isto o PATCH descarta o status e o clique "volta sozinho" — ver o
    // comentário longo em SuincoStore.sincronizarCarga.
    c._statusPendentes = (c._statusPendentes || []).concat('Aguardando Embarque');
    c.atualizadoEm = nowISO();
  });
  if(paraAtualizar.length) SuincoStore.save();
  return {criadas:[], atualizadas:paraAtualizar, jaNoPatio};
}

// Logística completa os dados de uma carga que nasceu "Aguardando Carga"
// (identificada pela flag `aguardandoCarga`, não mais por um status
// específico). O status NÃO muda aqui — ela já nasceu em "Aguardando
// Embarque" (o caminhão já está fisicamente no pátio) — então isto é só
// edição de dados, e por isso NÃO gera linha no log de movimentações
// (log só registra mudança de STATUS).
function completarCargaAguardando(cargaId, {numeroCarga, cliente, destino, produto, peso, doca, rota, sequencia, observacoes, transportadora, tipoVeiculo, motorista, praOnde, paletizada, qtdGanchos, qtdEntregas, operador}){
  const c = getCarga(cargaId);
  if(!c) throw new Error('Carga não encontrada');
  if(!c.aguardandoCarga) throw new Error('Esta carga não está aguardando dados (Aguardando Carga).');
  c.numeroCarga = normalizarNumeroCarga(numeroCarga); c.cliente = cliente||''; c.destino = destino||''; c.produto = produto||''; c.peso = Number(peso)||0;
  c.doca = doca||''; c.sequencia = sequencia!==undefined && sequencia!=='' ? Number(sequencia) : null;
  c.observacoes = observacoes||'';
  c.motorista = motorista||'';
  c.praOnde = PRA_ONDE_OPCOES.includes(praOnde) ? praOnde : PRA_ONDE_PADRAO;
  c.rota = rotaInfo(rota) ? String(rota).trim() : '';
  c.paletizada = paletizada === 'Sim' || paletizada === true ? 'Sim' : 'Não';
  c.qtdGanchos = qtdGanchos!==undefined && qtdGanchos!=='' ? Math.max(0, Number(qtdGanchos)||0) : 0;
  c.qtdEntregas = qtdEntregas!==undefined && qtdEntregas!=='' ? Math.max(1, Number(qtdEntregas)||1) : 1;
  if(transportadora) c.transportadora = transportadora;
  if(tipoVeiculo) c.tipoVeiculo = tipoVeiculo;
  c.aguardandoCarga = false;
  /* A CARGA FOI PROGRAMADA AGORA — e é esta a data que o relatório usa.

     Pedido do gestor (14/08/2026): "se a portaria dá entrada no veículo
     ontem e a gente lança a carga dela hoje, o relatório considera a data
     de entrada e não a data que ela foi programada. O relatório tem que
     considerar sempre a data de programação".

     Antes só existia `criadoEm`, que para um caminhão que chegou sem
     programação é a hora em que ele ENTROU no pátio. Filtrando o relatório
     por hoje, a carga lançada hoje num caminhão de ontem ficava de fora.

     `criadoEm` continua intocado de propósito: é o histórico de quando o
     carro chegou de verdade, e o gestor foi explícito em não perdê-lo
     ("a gente não perde o histórico da hora e do dia que o carro realmente
     chegou"). São duas datas diferentes porque são dois fatos diferentes. */
  c.programadoEm = nowISO();
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  return c;
}

// Transição genérica no meio do fluxo (Embarque Iniciado/Finalizado,
// Faturado). Valida que a carga está no status imediatamente anterior da
// STATUS_FLOW.
function avancarStatusCarga(cargaId, statusNovo, operador, setor){
  const c = getCarga(cargaId);
  if(!c) throw new Error('Carga não encontrada');
  const idxAtual = STATUS_FLOW.indexOf(c.status);
  const idxNovo = STATUS_FLOW.indexOf(statusNovo);
  if(idxNovo === -1) throw new Error('Status desconhecido: '+statusNovo);
  if(idxAtual === -1 || idxNovo !== idxAtual+1){
    throw new Error(`Não é possível ir de "${c.status}" direto para "${statusNovo}".`);
  }
  registrarMovimentacao({cargaId:c.id, placa:c.placa, statusAnterior:c.status, statusNovo, operador, setor, ...snapshotCarga(c)});
  c.status = statusNovo;
  c._statusPendentes = (c._statusPendentes || []).concat(statusNovo);  // ver sincronizarCarga
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  return c;
}

// Portaria — botão "Saiu": saída física de uma placa — aplica a TODAS as
// cargas dessa placa que já estiverem "Faturado" (mesmo caminhão saindo
// uma única vez, sem perguntar qual carga — igual já era antes). Cargas
// que ainda não chegaram lá ficam intactas e o retorno informa quais são,
// pra Portaria entender por que não liberou.
/* `lacres` aceita string (um lacre, como era até 20/08/2026) ou lista de
   até três. Manter as duas formas é o que permite um painel antigo em cache
   continuar registrando saída sem erro enquanto o novo já grava os três. */
function registrarSaidaPortaria(placa, operador, lacres){
  const p = normalizarPlaca(placa);
  const abertas = cargasAbertasPorPlaca(p);
  const elegiveis = abertas.filter(c => c.status === 'Faturado');
  const pendentes = abertas.filter(c => c.status !== 'Faturado');
  const lista = (Array.isArray(lacres) ? lacres : [lacres])
    .map(x => String(x || '').trim().slice(0, 50))
    .filter(Boolean)
    .slice(0, 3);
  const lacreLimpo = lista[0] || '';
  elegiveis.forEach(c=>{
    registrarMovimentacao({cargaId:c.id, placa:p, statusAnterior:c.status, statusNovo:'Seguiu Viagem', operador, setor:'Portaria', ...snapshotCarga(c)});
    c.status = 'Seguiu Viagem';
    /* Lacre da saída (18/08/2026): o caminhão sai para inspeção com lacre
       numerado — fica em TODAS as cargas da placa que saíram, pois o lacre é
       do caminhão, não de uma carga só.

       ATÉ TRÊS (20/08/2026), a pedido do gestor: "pode haver mais de um (ou
       dois, no máximo três) lacres na saída do caminhão". Cada um no seu
       campo — empilhar os três num campo só faria o número deixar de ser
       pesquisável, que é justamente para o que ele serve na inspeção. */
    if(lista.length){
      c.lacre = lacreLimpo;
      c.lacre2 = lista[1] || '';
      c.lacre3 = lista[2] || '';
    }
    c._statusPendentes = (c._statusPendentes || []).concat('Seguiu Viagem');  // ver sincronizarCarga
    c.atualizadoEm = nowISO();
  });
  if(elegiveis.length) SuincoStore.save();
  return {liberadas:elegiveis, pendentes};
}

/* Lacre RETIDO na inspeção da saída — MORA NO SERVIDOR (20/08/2026).

   Esta função existia aqui e gravava só localmente: o número ia para a
   carga e o motivo virava um pedaço de texto dentro de `observacoes`. Saiu
   do painel quando a retenção ganhou rota própria e campos próprios
   (migração 027) — motivo, autor e hora agora são dado, não frase.

   Não sobrou versão local de propósito: duas maneiras de registrar a mesma
   ocorrência é como se produz relatório que não bate com a tela. Ver
   `SuincoSharePoint.reterLacre` e `registrarLacreRetidoUI`. */

/* ---------- INDICADORES ----------
   Tudo aqui vem só do histórico (movimentacoes). OTIF fica de fora de
   propósito: calcular "no prazo" exige uma data/hora prometida que ainda
   não foi confirmada como campo do modelo de dados — ver
   docs/DECISOES_CONFIRMADAS.md. Não inventamos esse critério.
   AJUSTE PARA O MODELO DE 6 STATUS: com "Liberado para Embarque" e
   "Liberado para Saída" removidos, as etapas mudam de encaixe:
     - tempoAguardandoEmbarque: chegada (Aguardando Embarque) até início
       do carregamento (Embarque Iniciado) — antes ia só até a liberação.
     - tempoCarregamento: igual antes (Iniciado → Finalizado).
     - tempoFaturamento: Finalizado → Faturado (antes ia até a liberação
       de saída, que não existe mais).
     - tempoAguardandoSaida (NOVO): Faturado → Seguiu Viagem — preenche o
       intervalo que antes era coberto por "Liberado para Saída → Saída",
       mesma granularidade de antes, só reencaixada nos checkpoints reais. */
function indicadoresDaCarga(cargaId){
  const tChegada = primeiroTimestamp(cargaId,'Aguardando Embarque');
  const tIniciado = primeiroTimestamp(cargaId,'Embarque Iniciado');
  const tFinalizado = primeiroTimestamp(cargaId,'Embarque Finalizado');
  const tFaturado = primeiroTimestamp(cargaId,'Faturado');
  const tSaida = primeiroTimestamp(cargaId,'Seguiu Viagem');
  return {
    tempoAguardandoEmbarque: minutosEntre(tChegada, tIniciado),
    tempoCarregamento: minutosEntre(tIniciado, tFinalizado),
    tempoFaturamento: minutosEntre(tFinalizado, tFaturado),
    tempoAguardandoSaida: minutosEntre(tFaturado, tSaida),
    tempoPatioTotal: minutosEntre(tChegada, tSaida),
    leadTimeTotal: minutosEntre(getCarga(cargaId)?.criadoEm, tSaida)
  };
}
// cargas: lista opcional de cargas já concluídas a considerar (usada pela
// quebra por período abaixo). Sem argumento, mantém o comportamento
// histórico original: todas as cargas "Seguiu Viagem" de sempre.
/* MÉTRICAS POR ENTIDADE — o coração do Raio-X da Operação (21/08/2026).

   Pedido do gestor: "quero poder enxergar as métricas de cada linha
   selecionável, cada informação, cada placa, cada rota".

   Uma agregação só para os três recortes (rota, transportadora, placa),
   porque os três respondem a mesma pergunta com chaves diferentes: "onde a
   operação gasta tempo, e com quem?". Escrever três funções quase iguais é
   como os três recortes começariam a divergir no primeiro ajuste.

   Só cargas CONCLUÍDAS entram na média: carga em aberto tem etapas sem
   fim, e média com etapa pela metade puxa o número para baixo — o gestor
   leria uma melhora que não existe. */
function metricasPorEntidade(tipo, cargas){
  const base = cargas || DB.cargas.filter(c=>c.status==='Seguiu Viagem');
  const chaveDe = (c)=>{
    if(tipo==='rota') return c.rota ? String(c.rota).trim() : '';
    if(tipo==='transportadora') return c.transportadora || '';
    return normalizarPlaca(c.placa) || '';
  };
  const ETAPAS = ['tempoAguardandoEmbarque','tempoCarregamento','tempoFaturamento','tempoAguardandoSaida'];
  const grupos = {};
  base.forEach(c=>{
    const k = chaveDe(c);
    if(!k) return;
    if(!grupos[k]){
      grupos[k] = { chave:k, cargas:0, pesoTotal:0, ids:[],
        somas:{}, ns:{}, somaPatio:0, nPatio:0, somaLead:0, nLead:0 };
      ETAPAS.forEach(e=>{ grupos[k].somas[e]=0; grupos[k].ns[e]=0; });
    }
    const g = grupos[k];
    g.cargas++;
    g.pesoTotal += Number(c.peso)||0;
    g.ids.push(c.id);
    // Última atividade do grupo — é o que ordena o Raio-X por padrão:
    // "as últimas placas da operação, da sequência mais recente" (pedido
    // do gestor, 21/08/2026), com o histórico inteiro acessível abaixo.
    const t = Date.parse(c.atualizadoEm) || 0;
    if(!g.ultimaEm || t > g.ultimaEm) g.ultimaEm = t;
    const ind = indicadoresDaCarga(c.id);
    ETAPAS.forEach(e=>{ if(ind[e]!==null){ g.somas[e]+=ind[e]; g.ns[e]++; } });
    if(ind.tempoPatioTotal!==null){ g.somaPatio+=ind.tempoPatioTotal; g.nPatio++; }
    if(ind.leadTimeTotal!==null){ g.somaLead+=ind.leadTimeTotal; g.nLead++; }
  });
  return Object.values(grupos).map(g=>({
    chave: g.chave,
    cargas: g.cargas,
    pesoTotal: g.pesoTotal,
    ids: g.ids,
    ultimaEm: g.ultimaEm || 0,
    mediaPatio: g.nPatio ? Math.round(g.somaPatio/g.nPatio) : null,
    mediaLead: g.nLead ? Math.round(g.somaLead/g.nLead) : null,
    mediasEtapas: Object.fromEntries(ETAPAS.map(e=>[e, g.ns[e] ? Math.round(g.somas[e]/g.ns[e]) : null])),
  })).sort((a,b)=> b.cargas - a.cargas);
}

function rankingTransportadoras(cargas){
  const base = cargas || DB.cargas.filter(c=>c.status==='Seguiu Viagem');
  const porTransp = {};
  base.filter(c=>c.transportadora).forEach(c=>{
    const t = c.transportadora;
    if(!porTransp[t]) porTransp[t] = {transportadora:t, cargas:0, somaLead:0, nLead:0, somaPatio:0, nPatio:0};
    const ind = indicadoresDaCarga(c.id);
    porTransp[t].cargas++;
    if(ind.leadTimeTotal!==null){ porTransp[t].somaLead+=ind.leadTimeTotal; porTransp[t].nLead++; }
    if(ind.tempoPatioTotal!==null){ porTransp[t].somaPatio+=ind.tempoPatioTotal; porTransp[t].nPatio++; }
  });
  return Object.values(porTransp).map(t=>({
    transportadora: t.transportadora,
    cargas: t.cargas,
    leadTimeMedio: t.nLead ? Math.round(t.somaLead/t.nLead) : null,
    tempoPatioMedio: t.nPatio ? Math.round(t.somaPatio/t.nPatio) : null
  })).sort((a,b)=>{
    if(a.leadTimeMedio===null) return 1;
    if(b.leadTimeMedio===null) return -1;
    return a.leadTimeMedio - b.leadTimeMedio;
  });
}

/* ---------- ANÁLISES DOS RELATÓRIOS EXECUTIVOS ----------
   Pedido do usuário: o executivo precisa detalhar por status de carga,
   ranking do dia, menor tempo e maior tempo. As funções abaixo são a camada
   de dados disso — a formatação (tela e PDF) fica em app.js. */

// Quantas cargas em cada um dos 6 status, na ordem do fluxo, já com a cor de
// relatório. Recebe a lista de cargas para o chamador decidir o recorte (em
// aberto, do dia, do período...). Retorna sempre os 6 status, inclusive os
// zerados: num relatório executivo, "zero em Embarque Iniciado" é
// informação — omitir a linha esconderia que a etapa está parada.
function distribuicaoPorStatus(cargas){
  const total = cargas.length;
  const cont = {};
  cargas.forEach(c=>{ cont[c.status] = (cont[c.status]||0) + 1; });
  return STATUS_FLOW.map(s=>({
    status: s,
    qtd: cont[s] || 0,
    pct: total ? Math.round(((cont[s]||0) / total) * 100) : 0,
    cor: corStatusRelatorio(s),
    setor: (STATUS_META[s] || {}).setor || '—'
  }));
}

// Ranking de transportadoras considerando SÓ as cargas concluídas hoje (dia
// calendário) — é o "ranking do dia" pedido, diferente do ranking histórico
// que rankingTransportadoras() devolve quando chamado sem argumento.
function rankingDoDia(){
  return rankingTransportadoras(cargasConcluidasNoPeriodo('hoje'));
}

/* ---------- PAINEL DO GESTOR — quebra de indicadores por período ----------
   Pedido explícito: não basta uma média geral, o gestor quer comparar
   6h vs 12h vs Hoje vs Semana vs Mês lado a lado, "pente fino".
   Definições de janela (documentado — não há ambiguidade escondida):
     - Últimas 6h / Últimas 12h: janela ROLANTE a partir de agora.
     - Hoje: dia CALENDÁRIO (00:00 local até agora).
     - Semana: últimos 7 DIAS CORRIDOS (janela rolante), não semana
       calendário — escolhido por consistência com as janelas de 6h/12h e
       porque não reseta abruptamente toda segunda-feira. Fica documentado
       aqui e em docs/DECISOES_CONFIRMADAS.md.
     - Mês: mês CALENDÁRIO atual (dia 1 00:00 local até agora).
   Tudo em horário local do navegador (sem tratamento extra de fuso). */
const PERIODOS_INDICADOR = [
  { key:'6h',     label:'Últimas 6h' },
  { key:'12h',    label:'Últimas 12h' },
  { key:'hoje',   label:'Hoje' },
  { key:'semana', label:'Semana (7d)' },
  { key:'mes',    label:'Mês' }
];
function janelaPeriodo(periodoKey){
  const agora = new Date();
  let inicio;
  switch(periodoKey){
    case '6h':     inicio = new Date(agora.getTime() - 6*3600*1000); break;
    case '12h':    inicio = new Date(agora.getTime() - 12*3600*1000); break;
    case 'hoje':   inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0,0,0,0); break;
    case 'semana': inicio = new Date(agora.getTime() - 7*24*3600*1000); break;
    case 'mes':    inicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0,0,0,0); break;
    default:       inicio = new Date(0); // 'todos' / histórico completo
  }
  return { inicio, fim: agora };
}
// Cargas concluídas (Seguiu Viagem) cujo instante de saída caiu dentro da janela do período.
function cargasConcluidasNoPeriodo(periodoKey){
  const { inicio, fim } = janelaPeriodo(periodoKey);
  return DB.cargas.filter(c=>{
    if(c.status !== 'Seguiu Viagem') return false;
    const tSaida = primeiroTimestamp(c.id, 'Seguiu Viagem');
    if(!tSaida) return false;
    const t = new Date(tSaida);
    return t >= inicio && t <= fim;
  });
}
// Médias dos indicadores de tempo dentro de um período, mais a contagem de
// cargas concluídas nele — a UI usa totalCargas===0 pra distinguir "sem
// dados suficientes" de "0 minutos" (que seria enganoso).
function indicadoresPorPeriodo(periodoKey){
  const concluidas = cargasConcluidasNoPeriodo(periodoKey);
  const campos = ['tempoAguardandoEmbarque','tempoCarregamento','tempoFaturamento','tempoAguardandoSaida','tempoPatioTotal'];
  const somas = {}, contagens = {};
  campos.forEach(f=>{ somas[f]=0; contagens[f]=0; });
  let somaLead=0, nLead=0;
  concluidas.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    campos.forEach(f=>{ if(ind[f]!==null){ somas[f]+=ind[f]; contagens[f]++; } });
    if(ind.leadTimeTotal!==null){ somaLead+=ind.leadTimeTotal; nLead++; }
  });
  const medias = {};
  campos.forEach(f=>{ medias[f] = contagens[f] ? Math.round(somas[f]/contagens[f]) : null; });
  medias.leadTimeTotal = nLead ? Math.round(somaLead/nLead) : null;
  return { periodo: periodoKey, totalCargas: concluidas.length, medias };
}

/* ---------- GRÁFICOS (Painel do Gestor) — filtros combináveis -----------
   Placa (contém), Transportadora (igual) e Período (mesmas 5 janelas
   acima) filtram o conjunto de cargas usado por TODOS os gráficos. Setor
   só faz sentido pra alguns deles — cada gráfico documenta na própria UI
   se e como aplica o filtro de Setor, em vez de fingir uma granularidade
   que os dados não têm. Tudo recalculado do zero a cada render, sem
   cache — sempre reflete o estado atual do DB (mesma sessão/navegador). */
function aplicarFiltrosCargas(lista, filtros){
  filtros = filtros || {};
  let r = lista;
  if(filtros.placa){
    const p = normalizarPlaca(filtros.placa);
    r = r.filter(c => normalizarPlaca(c.placa).includes(p));
  }
  if(filtros.transportadora){
    r = r.filter(c => c.transportadora === filtros.transportadora);
  }
  return r;
}
function cargasConcluidasNoPeriodoFiltrado(periodoKey, filtros){
  return aplicarFiltrosCargas(cargasConcluidasNoPeriodo(periodoKey), filtros);
}
// Distribuição de cargas EM ABERTO por status atual (snapshot de agora,
// não depende de período) — filtra por placa/transportadora e, se setor
// for informado, só mostra os status cujo setor responsável
// (STATUS_META[status].setor) é aquele setor escolhido.
function distribuicaoStatusAtual(filtros){
  filtros = filtros || {};
  const abertas = aplicarFiltrosCargas(cargasAbertas(), filtros);
  return STATUS_FLOW.filter(s => s !== 'Seguiu Viagem')
    .filter(s => !filtros.setor || STATUS_META[s].setor === filtros.setor)
    .map(s => ({
      status: s,
      quantidade: abertas.filter(c=>c.status===s).length,
      cor: statusCarregamentoInfo(s).cor
    }));
}
// Cargas concluídas por dia dentro da janela do período — usado no
// gráfico de tendência. Preenche dias sem movimento com zero, pra não
// sumir datas e deixar a tendência legível.
function cargasConcluidasPorDia(periodoKey, filtros){
  const { inicio, fim } = janelaPeriodo(periodoKey);
  const concluidas = cargasConcluidasNoPeriodoFiltrado(periodoKey, filtros);
  const porDia = {};
  concluidas.forEach(c=>{
    const t = new Date(primeiroTimestamp(c.id,'Seguiu Viagem'));
    const chave = t.toLocaleDateString('pt-BR');
    porDia[chave] = (porDia[chave]||0) + 1;
  });
  const dias = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const limite = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  while(cursor <= limite){
    const chave = cursor.toLocaleDateString('pt-BR');
    dias.push({ dia: chave, quantidade: porDia[chave]||0 });
    cursor.setDate(cursor.getDate()+1);
  }
  return dias;
}
// Cada etapa (tempo médio) tem um setor "dono" fixo — usado pra decidir
// quais barras aparecem quando o filtro de Setor está ativo no gráfico de
// tempo médio por etapa (não filtra CARGAS aqui, filtra BARRAS).
const ETAPA_SETOR = {
  tempoAguardandoEmbarque: 'Expedição',
  tempoCarregamento: 'Expedição',
  tempoFaturamento: 'Faturamento',
  tempoAguardandoSaida: 'Portaria'
};
const ETAPA_LABEL = {
  tempoAguardandoEmbarque: 'Aguardando Embarque',
  tempoCarregamento: 'Carregamento',
  tempoFaturamento: 'Faturamento',
  tempoAguardandoSaida: 'Aguardando Saída'
};
function temposMediosPorEtapaFiltrado(periodoKey, filtros){
  const concluidas = cargasConcluidasNoPeriodoFiltrado(periodoKey, filtros);
  const campos = Object.keys(ETAPA_SETOR);
  const somas = {}, contagens = {};
  campos.forEach(f=>{ somas[f]=0; contagens[f]=0; });
  concluidas.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    campos.forEach(f=>{ if(ind[f]!==null){ somas[f]+=ind[f]; contagens[f]++; } });
  });
  return campos
    .filter(f => !(filtros && filtros.setor) || ETAPA_SETOR[f] === filtros.setor)
    .map(f=>({
      campo:f, label:ETAPA_LABEL[f], setor:ETAPA_SETOR[f],
      media: contagens[f] ? Math.round(somas[f]/contagens[f]) : null,
      n: contagens[f]
    }));
}

/* ---------- EXPORT POWER BI (CSV fato/dimensão) -----------------------
   Ponte TEMPORÁRIA. Quando as Listas do SharePoint estiverem provisionadas
   (ver docs/MODELO_DADOS_SHAREPOINT.md), o certo é o Power BI conectar
   DIRETO nas Listas via "Obter Dados → Lista do SharePoint" — atualização
   automática, sem depender de alguém lembrar de exportar e importar este
   CSV manualmente. Ver docs/POWERBI_EXPORT.md. */
function csvEscape(v){
  const s = (v===null||v===undefined) ? '' : String(v);
  if(/[;"\n\r]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}

/* Valores que o Excel converte em data sozinho ao abrir o CSV.
   O caso real: TipoVeiculo "3/4" vira 04/03 (ou 03/04) e chega corrompido no
   Power BI. Também cobre "1/2", "3-4" e afins, além de números com zero à
   esquerda, que o Excel come ("007" -> 7).
   A forma ="valor" é a maneira reconhecida de dizer ao Excel "isto é texto,
   não interprete". Aplicada SÓ nos valores ambíguos: "Carreta" e "Truck" saem
   limpos como sempre. */
function ehAmbiguoParaExcel(s){
  return /^\d{1,2}\s*[\/\-]\s*\d{1,4}$/.test(s)   // 3/4, 1/2, 3-4
      || /^0\d+$/.test(s);                          // 007
}
function csvTexto(v){
  const s = (v===null||v===undefined) ? '' : String(v);
  if(!s) return '';
  if(ehAmbiguoParaExcel(s)) return '="'+s.replace(/"/g,'""')+'"';
  return csvEscape(s);
}
// `colunasTexto`: nomes de coluna cujo conteúdo deve ir como texto puro,
// para o Excel não reinterpretar (ver csvTexto acima).
function toCsv(header, linhas, colunasTexto){
  const forcar = new Set(colunasTexto || []);
  const idx = header.map((h,i)=> forcar.has(h) ? i : -1).filter(i=>i>=0);
  const escaparLinha = r => r.map((v,i)=> idx.includes(i) ? csvTexto(v) : csvEscape(v)).join(';');
  return [header.map(csvEscape).join(';'), ...linhas.map(escaparLinha)].join('\r\n');
}
// SOMENTE TipoVeiculo. É a única coluna com problema real — o "3/4", que o
// Excel converte em data. Todas as demais saem exatamente como sempre saíram.
// Uma versão anterior desta lista incluía Placa, NumeroCarga e RotaCodigo, o
// que alterava o formato de colunas que estavam corretas (o número de carga
// "007", por exemplo, passava a sair como ="007"). Não ampliar esta lista sem
// um caso concreto de corrupção.
const CSV_COLUNAS_TEXTO = ['TipoVeiculo'];
function gerarCsvFactMovimentacoes(){
  const header = ['CargaId','Placa','Timestamp','StatusAnterior','StatusNovo','Operador','Setor','Cliente','Motorista','TipoVeiculo','QtdEntregas'];
  const linhas = DB.movimentacoes
    .slice()
    .sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp))
    .map(m=>[m.cargaId, m.placa, m.timestamp, m.statusAnterior||'', m.statusNovo, m.operador, m.setor,
      m.cliente||'', m.motorista||'', m.tipoVeiculo||'', m.qtdEntregas ?? '']);
  return toCsv(header, linhas, CSV_COLUNAS_TEXTO);
}
function gerarCsvDimCarga(){
  const header = ['Id','NumeroCarga','Placa','Transportadora','TipoVeiculo','Motorista','Cliente','Destino','Produto',
    'PesoKg','Doca','RotaCodigo','RotaNome','RotaOperador','Sequencia','PraOnde','Paletizada','QtdGanchos','QtdEntregas','StatusAtual','CriadoEm','AtualizadoEm'];
  const linhas = DB.cargas.map(c=>[
    c.id, c.numeroCarga, c.placa, c.transportadora, c.tipoVeiculo, c.motorista||'', c.cliente, c.destino, c.produto,
    c.peso, c.doca,
    c.rota || '', (rotaInfo(c.rota)||{}).nome || '', (rotaInfo(c.rota)||{}).operador || '',
    c.sequencia ?? '', c.praOnde || '', paletizadaDaCarga(c), c.qtdGanchos ?? 0, c.qtdEntregas ?? 1,
    c.status, c.criadoEm, c.atualizadoEm
  ]);
  return toCsv(header, linhas, CSV_COLUNAS_TEXTO);
}
function gerarCsvDimTransportadora(){
  // Derivada da FROTA (fonte viva), como o CSV de Cadastros já faz:
  // DB.transportadoras é a lista legada de cadastro manual e nasce vazia,
  // então a dimensão saía sem nenhuma linha enquanto Dim_Frota estava
  // cheia de transportadoras — o cruzamento no Power BI não fechava.
  // O Id é o próprio nome: é a chave que Dim_Frota carrega.
  const header = ['Id','Nome'];
  const nomes = [...new Set(DB.frota.map(f=>(f.transportadora||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b));
  return toCsv(header, nomes.map(n=>[n, n]), CSV_COLUNAS_TEXTO);
}
function gerarCsvDimFrota(){
  const header = ['Placa','Transportadora','TipoVeiculo','CapacidadeKg','UF','DataUltimaMovimentacao','PrecisaRevisao'];
  const linhas = DB.frota.map(f=>[f.placa, f.transportadora, f.tipoVeiculo, f.capacidadeKg ?? '', f.uf||'', f.dataUltimaMovimentacao||'', f.precisaRevisao ? 'Sim':'Não']);
  return toCsv(header, linhas, CSV_COLUNAS_TEXTO);
}
function gerarCsvDimStatus(){
  const header = ['Nome','OrdemNoFluxo','Cor'];
  const linhas = STATUS_ORDEM_EXPORT.map((s,i)=>[s, i, statusCarregamentoInfo(s).cor]);
  return toCsv(header, linhas, CSV_COLUNAS_TEXTO);
}
// Retorna os 5 arquivos prontos para download: [{nome, conteudo}, ...]
function gerarArquivosCsvPowerBI(){
  return [
    { nome:'Fact_Movimentacoes.csv', conteudo:gerarCsvFactMovimentacoes() },
    { nome:'Dim_Carga.csv',          conteudo:gerarCsvDimCarga() },
    { nome:'Dim_Transportadora.csv', conteudo:gerarCsvDimTransportadora() },
    { nome:'Dim_Frota.csv',          conteudo:gerarCsvDimFrota() },
    { nome:'Dim_Status.csv',         conteudo:gerarCsvDimStatus() }
  ];
}

/* ---------- INIT ---------- */
SuincoStore.load();

/* =====================================================================
   ANÁLISE OPERACIONAL — metas, atrasos e gargalos
   =====================================================================

   Bloco novo (05/08/2026). Substitui o Ranking de Transportadoras e os
   extremos "maior/menor tempo de pátio" por indicadores acionáveis: quem
   está atrasando, quanto, e onde está o gargalo.

   O QUE É "ATRASO" — decisão que precisou ser tomada
   --------------------------------------------------
   O sistema não tinha nenhuma noção de prazo: não havia hora prometida,
   nem SLA por rota, nem janela de carregamento. Sem definir isso, "veículo
   com maior atraso" não tem como ser calculado.

   Definição adotada: uma carga está ATRASADA quando o tempo total em pátio
   (chegada → saída) passa da META. A meta padrão é 3 horas — o número que
   o gestor citou como objetivo. O atraso é o quanto passou disso.

   É uma definição honesta e verificável com os dados que já existem, e é
   configurável. Quando houver hora prometida por rota, esta é a única
   função que muda. */

const META_TEMPO_PATIO_MIN = 180;   // 3 h

function metaTempoPatio(){
  const salvo = Number(DB.config && DB.config.metaTempoPatioMin);
  return Number.isFinite(salvo) && salvo > 0 ? salvo : META_TEMPO_PATIO_MIN;
}

/* Minutos acima da meta. Devolve null quando o tempo não é calculável
   (carga ainda em andamento, ou sem registro de chegada) — null é
   diferente de zero, e tratá-los igual inflaria a amostra com cargas que
   simplesmente ainda não terminaram. */
function atrasoDaCarga(carga){
  const ind = indicadoresDaCarga(carga.id);
  if(ind.tempoPatioTotal === null) return null;
  const excesso = ind.tempoPatioTotal - metaTempoPatio();
  return excesso > 0 ? excesso : 0;
}


/* ---------- NÚMERO DA CARGA: LIMPEZA E CONFERÊNCIA ----------
   Motivo (15/08/2026): o gestor cobrou que "o relatório precisa ser muito
   fiel aos números das cargas, não pode existir erro". Olhando a base de
   produção, três defeitos apareceram juntos:

     - `118176'` — sobrou uma aspa da digitação. `trim()` não tira aspa, só
       espaço, então o número entrou torto e não casava com nada.
     - `118713` no lugar de `118173` — dígitos trocados. Não dá para o
       sistema adivinhar, mas dá para ele PARAR DE ESCONDER.
     - `118042`, `118105`, `118063`, `118011`, `118035`, `118111` repetidos
       em cargas diferentes — e `118105` em DUAS PLACAS. Número repetido faz
       o total do relatório somar a mesma carga duas vezes, que é
       exatamente a conferência de tonelagem que não fechava.

   A regra aqui é deliberadamente NÃO bloquear: o número é livre por decisão
   registrada (docs/DECISOES_CONFIRMADAS.md item 2), e travar a digitação no
   meio do turno é pior que aceitar e avisar. O sistema limpa o que é
   claramente lixo de digitação, e o relatório passa a mostrar o que está
   duvidoso em vez de imprimir um total errado com cara de certo. */
function normalizarNumeroCarga(v){
  return String(v ?? '')
    .replace(/[\u2018\u2019\u201C\u201D'"`]/g, '')  // aspas de todo tipo
    .replace(/\s+/g, ' ')
    .trim();
}

/* Cargas cujo número não dá para confiar, dentro do conjunto que o
   relatório vai imprimir. Devolve listas, não booleano: o relatório mostra
   QUAIS são, senão o aviso não ajuda ninguém a corrigir. */
function problemasDeNumeracao(cargas){
  const porNumero = new Map();
  const semNumero = [];
  const foraDoPadrao = [];

  (cargas || []).forEach(c => {
    const n = normalizarNumeroCarga(c.numeroCarga);
    if(!n || n === 'Aguardando Carga'){ semNumero.push(c); return; }
    // O padrão da operação é numérico. Qualquer outra coisa é digitação.
    if(!/^[0-9]+$/.test(n)) foraDoPadrao.push({carga: c, numero: n});
    if(!porNumero.has(n)) porNumero.set(n, []);
    porNumero.get(n).push(c);
  });

  const duplicados = [...porNumero.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([numero, lista]) => ({
      numero,
      quantidade: lista.length,
      placas: [...new Set(lista.map(c => c.placa))],
      pesoSomado: lista.reduce((s, c) => s + (Number(c.peso) || 0), 0),
    }));

  return {
    duplicados, semNumero, foraDoPadrao,
    total: duplicados.length + semNumero.length + foraDoPadrao.length,
  };
}

/* ---------- FILTRO POR DATA DA PROGRAMAÇÃO ----------
   "Data da programação" é quando a CARGA foi lançada — não quando o
   caminhão entrou no pátio. É o que o gestor usa para fechar o relatório
   de um dia.

   As duas datas são iguais na maioria dos casos e se separam num caso que
   acontece todo dia: o caminhão chega sem programação (a Portaria registra
   a entrada, nasce `criadoEm`), fica no pátio, e a carga dele só é lançada
   no dia seguinte. Até 14/08/2026 o filtro usava `criadoEm` e essa carga
   sumia do relatório do dia em que foi realmente programada — relatado pelo
   gestor: "puxa somente as cargas que chegaram hoje... tem que considerar
   sempre a data de programação".

   `programadoEm` é a data certa; `criadoEm` fica de reserva para as cargas
   anteriores a esta mudança, que não têm o campo. */
function filtrarPorDataProgramacao(cargas, de, ate){
  if(!de && !ate) return cargas.slice();
  // A data final vira o fim do dia: quem digita 05/08 quer o dia 05
  // inteiro, não até 00:00 dele.
  const ini = de ? new Date(de + 'T00:00:00').getTime() : -Infinity;
  const fim = ate ? new Date(ate + 'T23:59:59.999').getTime() : Infinity;
  return cargas.filter(c=>{
    const t = Date.parse(c.programadoEm || c.criadoEm || 0) || 0;
    return t >= ini && t <= fim;
  });
}

/* ---------- SOMATÓRIOS DE RODAPÉ (estilo Excel) ---------- */
function somatoriosDaLista(cargas){
  return cargas.reduce((acc,c)=>({
    cargas: acc.cargas + 1,
    pesoKg: acc.pesoKg + (Number(c.peso)||0),
    entregas: acc.entregas + (c.qtdEntregas ?? 1),
    ganchos: acc.ganchos + (Number(c.qtdGanchos)||0)
  }), {cargas:0, pesoKg:0, entregas:0, ganchos:0});
}

/* ---------- RANKING DE VEÍCULOS COM MAIOR ATRASO ----------
   Ordenado do maior para o menor tempo médio de atraso. Veículo sem
   nenhum atraso não entra: a lista existe para mostrar onde agir, e
   encher de linhas zeradas esconde justamente o que importa. */
function rankingVeiculosAtraso(cargas){
  const base = (cargas || DB.cargas).filter(c => c.placa);
  const porPlaca = {};
  base.forEach(c=>{
    const atraso = atrasoDaCarga(c);
    if(atraso === null) return;
    const p = c.placa;
    if(!porPlaca[p]) porPlaca[p] = {
      placa:p, transportadora:c.transportadora || '—',
      atrasos:0, somaAtraso:0, ultimoAtraso:null, totalCargas:0
    };
    const r = porPlaca[p];
    r.totalCargas++;
    if(atraso > 0){
      r.atrasos++;
      r.somaAtraso += atraso;
      // "Seguiu Viagem" acontece uma vez por carga, então o primeiro
      // registro é o único — não existe "último" diferente aqui.
      const quando = primeiroTimestamp(c.id,'Seguiu Viagem') || c.atualizadoEm;
      if(!r.ultimoAtraso || Date.parse(quando) > Date.parse(r.ultimoAtraso)) r.ultimoAtraso = quando;
    }
  });
  return Object.values(porPlaca)
    .filter(r => r.atrasos > 0)
    .map(r => ({
      placa: r.placa,
      transportadora: r.transportadora,
      atrasos: r.atrasos,
      totalCargas: r.totalCargas,
      tempoMedioAtraso: Math.round(r.somaAtraso / r.atrasos),
      ultimoAtraso: r.ultimoAtraso
    }))
    .sort((a,b)=> b.tempoMedioAtraso - a.tempoMedioAtraso);
}

/* ---------- TEMPO MÉDIO DE PÁTIO ----------
   Substitui os indicadores de maior/menor tempo. O extremo é anedota; a
   média move decisão. Devolve também a amostra, porque média de duas
   cargas não é média — e quem lê precisa saber disso. */
function tempoMedioPatio(cargas){
  const base = cargas || DB.cargas;
  let soma = 0, n = 0, acimaDaMeta = 0;
  base.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    if(ind.tempoPatioTotal === null) return;
    soma += ind.tempoPatioTotal;
    n++;
    if(ind.tempoPatioTotal > metaTempoPatio()) acimaDaMeta++;
  });
  return {
    media: n ? Math.round(soma/n) : null,
    amostra: n,
    acimaDaMeta,
    meta: metaTempoPatio(),
    percentualAcima: n ? Math.round((acimaDaMeta/n)*100) : null
  };
}

/* ---------- GARGALOS E PONTOS CRÍTICOS ----------
   Uma função só, devolvendo tudo que a seção precisa. Cada item responde
   uma pergunta que o gestor faz de manhã, e nada entra aqui sem responder
   alguma — indicador que não muda decisão é ruído. */
function analiseGargalos(cargas){
  const base = cargas || DB.cargas;

  // 1. Veículos com recorrência de atraso (2+ ocorrências).
  //    Um atraso é acaso; dois viram padrão.
  const veiculosRecorrentes = rankingVeiculosAtraso(base)
    .filter(v => v.atrasos >= 2)
    .slice(0, 10);

  // 2. Tipo de operação com maior permanência média em pátio.
  const porOperacao = {};
  base.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    if(ind.tempoPatioTotal === null) return;
    const k = c.praOnde || '—';
    if(!porOperacao[k]) porOperacao[k] = {operacao:k, soma:0, n:0};
    porOperacao[k].soma += ind.tempoPatioTotal;
    porOperacao[k].n++;
  });
  const operacoesMaiorPermanencia = Object.values(porOperacao)
    .map(o => ({operacao:o.operacao, media: Math.round(o.soma/o.n), amostra:o.n}))
    .sort((a,b)=> b.media - a.media);

  // 3. Transportadoras com concentração de atraso. Informativo, sem
  //    ranking principal — foi pedido explicitamente assim, e faz sentido:
  //    culpar transportadora por atraso que é do pátio seria injusto.
  const porTransp = {};
  base.forEach(c=>{
    const atraso = atrasoDaCarga(c);
    if(atraso === null || !c.transportadora) return;
    const k = c.transportadora;
    if(!porTransp[k]) porTransp[k] = {transportadora:k, atrasadas:0, total:0};
    porTransp[k].total++;
    if(atraso > 0) porTransp[k].atrasadas++;
  });
  const transportadorasAtraso = Object.values(porTransp)
    .filter(t => t.atrasadas > 0)
    .map(t => ({...t, percentual: Math.round((t.atrasadas/t.total)*100)}))
    .sort((a,b)=> b.atrasadas - a.atrasadas)
    .slice(0, 8);

  // 4. Horários de maior congestionamento — pela HORA DA CHEGADA, não da
  //    programação. O congestionamento é físico: acontece quando os
  //    caminhões entram no pátio, não quando alguém digitou a carga.
  const porHora = {};
  base.forEach(c=>{
    const chegada = primeiroTimestamp(c.id,'Aguardando Embarque');
    if(!chegada) return;
    const h = new Date(chegada).getHours();
    if(!porHora[h]) porHora[h] = {hora:h, chegadas:0, somaPatio:0, nPatio:0};
    porHora[h].chegadas++;
    const ind = indicadoresDaCarga(c.id);
    if(ind.tempoPatioTotal !== null){ porHora[h].somaPatio += ind.tempoPatioTotal; porHora[h].nPatio++; }
  });
  const horariosCongestionamento = Object.values(porHora)
    .map(h => ({
      hora: h.hora,
      chegadas: h.chegadas,
      tempoMedioPatio: h.nPatio ? Math.round(h.somaPatio/h.nPatio) : null
    }))
    .sort((a,b)=> b.chegadas - a.chegadas)
    .slice(0, 5);

  // 5. Rotas com maior incidência de atraso.
  const porRota = {};
  base.forEach(c=>{
    const atraso = atrasoDaCarga(c);
    if(atraso === null || !c.rota) return;
    if(!porRota[c.rota]) porRota[c.rota] = {rota:c.rota, atrasadas:0, total:0, soma:0};
    porRota[c.rota].total++;
    if(atraso > 0){ porRota[c.rota].atrasadas++; porRota[c.rota].soma += atraso; }
  });
  const rotasAtraso = Object.values(porRota)
    .filter(r => r.atrasadas > 0)
    .map(r => ({
      rota: r.rota,
      rotulo: rotaCurta(r.rota),
      atrasadas: r.atrasadas,
      total: r.total,
      atrasoMedio: Math.round(r.soma/r.atrasadas)
    }))
    .sort((a,b)=> b.atrasadas - a.atrasadas)
    .slice(0, 8);

  // 6. Cargas paradas há mais tempo, ainda em aberto. É o item mais
  //    acionável da seção: cada linha é um caminhão que alguém precisa
  //    destravar agora.
  const agora = Date.now();
  const pendentesAntigas = base
    .filter(c => c.status !== 'Seguiu Viagem')
    .map(c => ({
      id: c.id,
      numeroCarga: c.numeroCarga || '—',
      placa: c.placa,
      transportadora: c.transportadora || '—',
      status: c.status,
      paradaHaMin: Math.round((agora - (Date.parse(c.atualizadoEm || c.criadoEm) || agora))/60000)
    }))
    .sort((a,b)=> b.paradaHaMin - a.paradaHaMin)
    .slice(0, 10);

  return {
    meta: metaTempoPatio(),
    veiculosRecorrentes,
    operacoesMaiorPermanencia,
    transportadorasAtraso,
    horariosCongestionamento,
    rotasAtraso,
    pendentesAntigas
  };
}

/* ---------- RELATÓRIO ADMINISTRAÇÃO DE FRETES ----------
   Independente dos demais, com três colunas só. As observações são onde a
   administração registra valor de frete, negociação e instruções — por
   isso a carga entra na lista mesmo sem observação nenhuma: é justamente
   a linha em branco que precisa ser preenchida. */
function dadosAdministracaoFretes(cargas){
  return (cargas || DB.cargas)
    .filter(c => !c.aguardandoCarga)
    .slice()
    .sort((a,b)=>{
      const na = String(a.numeroCarga||''), nb = String(b.numeroCarga||'');
      return na.localeCompare(nb, 'pt-BR', {numeric:true});
    })
    .map(c => ({
      numeroCarga: c.numeroCarga || '—',
      /* PLACA — pedido do dono (25/08/2026): "o relatório de administração
         de fretes precisa aparecer a placa também, está faltando".

         Ele tem razão e o motivo é o assunto do relatório: quem confere
         frete negocia com a TRANSPORTADORA, e a placa é o que liga a linha
         ao veículo que rodou. Número da carga é o índice do sistema; a
         placa é como a conversa acontece no telefone. */
      placa: c.placa || '—',
      rota: rotaCurta(c.rota) || '—',
      observacoes: c.observacoes || ''
    }));
}
