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
   Confirmado no briefing: vazio = Direto Suinco, CROSS = cross-docking,
   DEDICADA = frota própria, RET FRIGO = retirada no frigorífico.
   "Compartilhada?" é SEMPRE calculada a partir disto — nunca editável
   manualmente, pra não desalinhar do valor real de Pra onde?. */
const PRA_ONDE_OPCOES = ['', 'CROSS', 'DEDICADA', 'RET FRIGO'];
const PRA_ONDE_LABEL = { '': '(Direto Suinco)', 'CROSS':'CROSS', 'DEDICADA':'DEDICADA', 'RET FRIGO':'RET FRIGO' };
function compartilhadaDaCarga(carga){
  return (carga && (carga.praOnde === 'CROSS' || carga.praOnde === 'RET FRIGO')) ? 'Sim' : 'Não';
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
    borda: ler('br', '#374a86')
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
const SETOR_PERMISSOES = {
  'Logística':    ['torre','programacao','expedicao','indicadores','cadastros','historico','relatorios'],
  'Portaria':     ['torre','portaria','historico'],
  'Expedição':    ['torre','expedicao','historico'],
  'Faturamento':  ['torre','faturamento','historico']
};

// Função de cada aba, exibida no topo dela. Serve para quem abre o painel pela
// primeira vez saber o que fazer ali sem depender de treinamento verbal.
const TAB_FUNCAO = {
  torre:       { setor:'Todos',        oque:'Acompanhar todas as cargas em aberto, de todos os setores, em uma tela só.',                     move:'Não altera nada — é somente leitura.' },
  programacao: { setor:'Logística',    oque:'Cadastrar a carga do dia antes do caminhão chegar e definir a ordem de carregamento.',           move:'Cria a carga em Aguardando Veículo.' },
  portaria:    { setor:'Portaria',     oque:'Registrar a entrada e a saída física do caminhão no pátio.',                                      move:'Chegou: Aguardando Veículo → Aguardando Embarque. Saiu: Faturado → Seguiu Viagem.' },
  expedicao:   { setor:'Expedição',    oque:'Controlar o carregamento do veículo, do início ao fim.',                                          move:'Aguardando Embarque → Embarque Iniciado → Embarque Finalizado.' },
  faturamento: { setor:'Faturamento',  oque:'Emitir a nota da carga já carregada, liberando o caminhão para sair.',                             move:'Embarque Finalizado → Faturado.' },
  indicadores: { setor:'Logística',    oque:'Analisar tempo médio por etapa, comparar períodos e ver o ranking de transportadoras.',            move:'Não altera nada — é somente leitura.' },
  cadastros:   { setor:'Logística',    oque:'Manter a base de Frota (placa → transportadora → tipo), transportadoras e docas.',                 move:'Não altera cargas — alimenta a Programação.' },
  historico:   { setor:'Todos',        oque:'Consultar a trilha de auditoria: quem moveu qual carga, de qual status para qual, e quando.',      move:'Não altera nada — registro permanente.' },
  relatorios:  { setor:'Logística',    oque:'Gerar o PDF operacional (para o pátio) e o executivo (para a gestão).',                            move:'Não altera nada — exporta o que já existe.' }
};

const SETORES = Object.keys(SETOR_PERMISSOES);

/* ---------- estado em memória ---------- */
let DB = {
  frota: [],           // {placa, transportadora, tipoVeiculo}
  transportadoras: [],  // {id, nome}
  docas: [],            // {id, nome}
  cargas: [],            // ver criarCargaProgramada/registrarChegadaPortaria
  movimentacoes: [],      // log — nunca editado, só append
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
  },

  /* ---- Sincronia com o SharePoint / Power BI ----
     Cada função abaixo traduz um objeto do painel para o formato da Lista
     correspondente no modelo do BI. Se o adaptador não estiver configurado
     ou estiver offline, a escrita vai para a fila e sobe depois — quem
     chama não precisa saber disso. */
  async sincronizarCarga(carga, operador){
    if(typeof SuincoSharePoint === 'undefined') return;
    return SuincoSharePoint.push('cargas', {
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
      Sequencia: carga.sequencia ?? null,
      Pra_Onde: carga.praOnde || '',
      Compartilhada: compartilhadaDaCarga(carga),
      Qtd_Ganchos: carga.qtdGanchos || 0,
      Qtd_Entregas: carga.qtdEntregas ?? 1,
      Status_Atual: carga.status,
      Criado_Em: carga.criadoEm
    }, operador);
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
    return SuincoSharePoint.push('frota', {
      Title: frota.placa,
      Placa: frota.placa,
      Transportadora: frota.transportadora || '',
      Tipo_Veiculo: frota.tipoVeiculo || '',
      Capacidade_Kg: frota.capacidadeKg || null,
      UF: frota.uf || '',
      Precisa_Revisao: !!frota.precisaRevisao
    }, operador);
  }
};

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
  let f = indiceFrota().get(p);
  if(f){
    f.transportadora = transportadora; f.tipoVeiculo = tipoVeiculo;
    f.capacidadeKg = capacidadeKg; f.uf = uf; f.dataUltimaMovimentacao = dataUltimaMovimentacao; f.precisaRevisao = precisaRevisao;
  } else {
    const novo = { placa:p, transportadora, tipoVeiculo, capacidadeKg, uf, dataUltimaMovimentacao, precisaRevisao };
    DB.frota.push(novo);
    if(_frotaIndice) _frotaIndice.set(p, novo); // mantém o índice quente na importação em lote
  }
  SuincoStore.save();
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

// Carrega a base real de Frota (frota_seed_2026.csv, 2.038 placas — ver
// docs/NOTAS_BASE_FROTA.md) automaticamente na primeira execução do painel.
// Duas origens possíveis, nesta ordem:
//   1. window.FROTA_SEED_CSV — o CSV embutido direto no HTML. É o que a
//      versão de arquivo único (painel_suinco_completo.html) usa, porque
//      em file:// o navegador bloqueia fetch de arquivo local por CORS e
//      o painel abriria sem nenhuma placa.
//   2. fetch('frota_seed_2026.csv') — quando servido por HTTP (Teams/
//      SharePoint ou `python3 -m http.server`), com os arquivos separados.
// Se as duas falharem, o painel segue vazio normalmente, caindo de volta no
// cadastro/import em lote manual que já existia antes desta base chegar.
// SÓ roda quando DB.frota ainda está vazio, pra nunca sobrescrever remoções/
// edições feitas depois pelo Responsável pela Base de Frota — é seed
// inicial, não sync.
async function carregarFrotaSeedSeVazia(){
  if(DB.frota.length > 0) return { carregado:false, motivo:'Frota já tem dados' };
  try{
    let texto;
    if(typeof window !== 'undefined' && window.FROTA_SEED_CSV){
      texto = window.FROTA_SEED_CSV;
    }else{
      const resp = await fetch('frota_seed_2026.csv');
      if(!resp.ok) return { carregado:false, motivo:'HTTP '+resp.status };
      texto = await resp.text();
    }
    let linhas = parseCsvRfc4180(texto);
    if(linhas.length && linhas[0][0] === 'Placa') linhas = linhas.slice(1); // remove cabeçalho
    linhas.forEach(l=>{
      const [placa, transportadora, tipoVeiculo, precisaRevisao] = l;
      if(!placa) return;
      upsertFrota(placa, transportadora||'', tipoVeiculo||'', {
        precisaRevisao: /^sim$/i.test(precisaRevisao||'')
      });
    });
    // Primeira carga da base: espelha dim_Veiculos no SharePoint. Vai pela
    // fila (local-first), então não trava a abertura do painel nem se perde
    // se a rede estiver fora — sobe quando a conexão voltar.
    if(typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado()){
      DB.frota.forEach(f=>{
        SuincoStore.sincronizarVeiculo(f, DB.operador).catch(e=>console.warn('[Suinco] sync frota:', e));
      });
    }
    return { carregado:true, total: linhas.length };
  }catch(e){
    console.warn('Não foi possível carregar automaticamente a base real de Frota (frota_seed_2026.csv). Siga com cadastro manual ou import em lote em Cadastros → Frota.', e);
    return { carregado:false, motivo:String(e) };
  }
}

/* ---------- TRANSPORTADORAS / DOCAS (cadastros simples) ---------- */
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
function listarDocas(){ return DB.docas.slice().sort((a,b)=>a.nome.localeCompare(b.nome)); }
function addDoca(nome){
  if(!nome || !nome.trim()) throw new Error('Nome vazio');
  DB.docas.push({id:uid('doca'), nome:nome.trim()});
  SuincoStore.save();
}
function removerDoca(id){
  DB.docas = DB.docas.filter(d=>d.id!==id);
  SuincoStore.save();
}

/* ---------- LOG / MOVIMENTAÇÕES (histórico — nunca editado, só append) ----------
   Só é gravado quando o STATUS muda de verdade — nunca ao só editar/criar
   dados de uma carga sem mudar o status (ex: completar dados de uma
   "Aguardando Carga" não gera linha aqui, porque o status já nasceu certo).
   Cada linha carrega um SNAPSHOT de cliente/motorista/tipoVeiculo/
   qtdEntregas no momento da mudança — útil pro Fact_Movimentacoes do Power
   BI mesmo que esses campos mudem depois na carga. */
function registrarMovimentacao({cargaId, placa, statusAnterior, statusNovo, operador, setor, cliente, motorista, tipoVeiculo, qtdEntregas}){
  DB.movimentacoes.push({
    id: uid('mov'),
    timestamp: nowISO(),
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
  // Sobe para fact_StatusFrota + LOG_EVENTOS sem bloquear quem chamou: a
  // regra de negócio já terminou seu trabalho aqui.
  const mov = DB.movimentacoes[DB.movimentacoes.length - 1];
  const carga = getCarga(cargaId);
  if(typeof SuincoStore.sincronizarMovimentacao === 'function'){
    SuincoStore.sincronizarMovimentacao(mov, DB.operador).catch(e=>console.warn('[Suinco] sync movimentação:', e));
    if(carga) SuincoStore.sincronizarCarga(carga, DB.operador).catch(e=>console.warn('[Suinco] sync carga:', e));
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
function criarCargaProgramada({placa, transportadora, tipoVeiculo, numeroCarga, cliente, destino, produto, peso, doca, sequencia, observacoes, motorista, praOnde, qtdGanchos, qtdEntregas, operador}){
  const p = normalizarPlaca(placa);
  if(!p) throw new Error('Placa é obrigatória');
  const frota = buscarFrota(p);
  if(!frota){
    throw new Error(`Placa ${p} não está cadastrada na Frota. Cadastre em Cadastros → Frota antes de programar esta carga.`);
  }
  const carga = {
    id: uid('carga'),
    numeroCarga: numeroCarga||'',
    placa: p,
    transportadora: transportadora || frota.transportadora,
    tipoVeiculo: tipoVeiculo || frota.tipoVeiculo,
    motorista: motorista||'',
    cliente: cliente||'', destino: destino||'', produto: produto||'', peso: Number(peso)||0,
    doca: doca||'', sequencia: sequencia!==undefined && sequencia!=='' ? Number(sequencia) : null,
    observacoes: observacoes||'',
    praOnde: PRA_ONDE_OPCOES.includes(praOnde) ? praOnde : '',
    qtdGanchos: qtdGanchos!==undefined && qtdGanchos!=='' ? Math.max(0, Number(qtdGanchos)||0) : 0,
    qtdEntregas: qtdEntregas!==undefined && qtdEntregas!=='' ? Math.max(1, Number(qtdEntregas)||1) : 1,
    status: 'Aguardando Veículo',
    aguardandoCarga: false,
    criadoEm: nowISO(), criadoPor: operador||'(não identificado)',
    atualizadoEm: nowISO()
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
  const abertas = cargasAbertasPorPlaca(p);

  if(abertas.length === 0){
    const frota = buscarFrota(p);
    const carga = {
      id: uid('carga'), numeroCarga:'Aguardando Carga', placa: p,
      transportadora: frota ? frota.transportadora : '',
      tipoVeiculo: frota ? frota.tipoVeiculo : '',
      motorista:'',
      cliente:'', destino:'', produto:'', peso:0, doca:'', sequencia:null, observacoes:'',
      praOnde:'', qtdGanchos:0, qtdEntregas:1,
      status: 'Aguardando Embarque', aguardandoCarga: true,
      criadoEm: nowISO(), criadoPor: operador||'(não identificado)',
      atualizadoEm: nowISO()
    };
    DB.cargas.push(carga);
    registrarMovimentacao({cargaId:carga.id, placa:p, statusAnterior:null, statusNovo:'Aguardando Embarque', operador, setor:'Portaria', ...snapshotCarga(carga)});
    SuincoStore.save();
    return {criadas:[carga], atualizadas:[], jaNoPatio:[]};
  }

  const paraAtualizar = abertas.filter(c => c.status === 'Aguardando Veículo');
  const jaNoPatio = abertas.filter(c => c.status !== 'Aguardando Veículo');
  paraAtualizar.forEach(c=>{
    registrarMovimentacao({cargaId:c.id, placa:p, statusAnterior:c.status, statusNovo:'Aguardando Embarque', operador, setor:'Portaria', ...snapshotCarga(c)});
    c.status = 'Aguardando Embarque';
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
function completarCargaAguardando(cargaId, {numeroCarga, cliente, destino, produto, peso, doca, sequencia, observacoes, transportadora, tipoVeiculo, motorista, praOnde, qtdGanchos, qtdEntregas, operador}){
  const c = getCarga(cargaId);
  if(!c) throw new Error('Carga não encontrada');
  if(!c.aguardandoCarga) throw new Error('Esta carga não está aguardando dados (Aguardando Carga).');
  c.numeroCarga = numeroCarga||''; c.cliente = cliente||''; c.destino = destino||''; c.produto = produto||''; c.peso = Number(peso)||0;
  c.doca = doca||''; c.sequencia = sequencia!==undefined && sequencia!=='' ? Number(sequencia) : null;
  c.observacoes = observacoes||'';
  c.motorista = motorista||'';
  c.praOnde = PRA_ONDE_OPCOES.includes(praOnde) ? praOnde : '';
  c.qtdGanchos = qtdGanchos!==undefined && qtdGanchos!=='' ? Math.max(0, Number(qtdGanchos)||0) : 0;
  c.qtdEntregas = qtdEntregas!==undefined && qtdEntregas!=='' ? Math.max(1, Number(qtdEntregas)||1) : 1;
  if(transportadora) c.transportadora = transportadora;
  if(tipoVeiculo) c.tipoVeiculo = tipoVeiculo;
  c.aguardandoCarga = false;
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
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  return c;
}

// Portaria — botão "Saiu": saída física de uma placa — aplica a TODAS as
// cargas dessa placa que já estiverem "Faturado" (mesmo caminhão saindo
// uma única vez, sem perguntar qual carga — igual já era antes). Cargas
// que ainda não chegaram lá ficam intactas e o retorno informa quais são,
// pra Portaria entender por que não liberou.
function registrarSaidaPortaria(placa, operador){
  const p = normalizarPlaca(placa);
  const abertas = cargasAbertasPorPlaca(p);
  const elegiveis = abertas.filter(c => c.status === 'Faturado');
  const pendentes = abertas.filter(c => c.status !== 'Faturado');
  elegiveis.forEach(c=>{
    registrarMovimentacao({cargaId:c.id, placa:p, statusAnterior:c.status, statusNovo:'Seguiu Viagem', operador, setor:'Portaria', ...snapshotCarga(c)});
    c.status = 'Seguiu Viagem';
    c.atualizadoEm = nowISO();
  });
  if(elegiveis.length) SuincoStore.save();
  return {liberadas:elegiveis, pendentes};
}

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

// Menor e maior tempo entre as cargas concluídas informadas.
// `metrica` escolhe o que medir: 'leadTimeTotal' (da criação da carga até a
// saída — visão de planejamento) ou 'tempoPatioTotal' (da chegada física até
// a saída — visão de pátio, que é a que a operação sente). Retorna menor e
// maior nulos quando nenhuma carga tem a métrica calculável, para a UI dizer
// "sem dados" em vez de exibir 0 min, que seria enganoso.
function extremosTempo(cargas, metrica){
  const m = metrica || 'leadTimeTotal';
  const comTempo = cargas
    .map(c=>({ carga:c, ind: indicadoresDaCarga(c.id) }))
    .filter(x=>x.ind[m] !== null && x.ind[m] !== undefined);
  if(!comTempo.length) return { menor:null, maior:null, amostra:0 };
  const ordenado = comTempo.slice().sort((a,b)=>a.ind[m] - b.ind[m]);
  const monta = x => ({
    numeroCarga: x.carga.numeroCarga,
    placa: x.carga.placa,
    transportadora: x.carga.transportadora,
    destino: x.carga.destino,
    minutos: x.ind[m]
  });
  return {
    menor: monta(ordenado[0]),
    maior: monta(ordenado[ordenado.length - 1]),
    amostra: comTempo.length
  };
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
function toCsv(header, linhas){
  const rows = [header, ...linhas];
  return rows.map(r => r.map(csvEscape).join(';')).join('\r\n');
}
function gerarCsvFactMovimentacoes(){
  const header = ['CargaId','Placa','Timestamp','StatusAnterior','StatusNovo','Operador','Setor','Cliente','Motorista','TipoVeiculo','QtdEntregas'];
  const linhas = DB.movimentacoes
    .slice()
    .sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp))
    .map(m=>[m.cargaId, m.placa, m.timestamp, m.statusAnterior||'', m.statusNovo, m.operador, m.setor,
      m.cliente||'', m.motorista||'', m.tipoVeiculo||'', m.qtdEntregas ?? '']);
  return toCsv(header, linhas);
}
function gerarCsvDimCarga(){
  const header = ['Id','NumeroCarga','Placa','Transportadora','TipoVeiculo','Motorista','Cliente','Destino','Produto',
    'PesoKg','Doca','Sequencia','PraOnde','Compartilhada','QtdGanchos','QtdEntregas','StatusAtual','CriadoEm','AtualizadoEm'];
  const linhas = DB.cargas.map(c=>[
    c.id, c.numeroCarga, c.placa, c.transportadora, c.tipoVeiculo, c.motorista||'', c.cliente, c.destino, c.produto,
    c.peso, c.doca, c.sequencia ?? '', c.praOnde || '', compartilhadaDaCarga(c), c.qtdGanchos ?? 0, c.qtdEntregas ?? 1,
    c.status, c.criadoEm, c.atualizadoEm
  ]);
  return toCsv(header, linhas);
}
function gerarCsvDimTransportadora(){
  const header = ['Id','Nome'];
  const linhas = listarTransportadoras().map(t=>[t.id, t.nome]);
  return toCsv(header, linhas);
}
function gerarCsvDimFrota(){
  const header = ['Placa','Transportadora','TipoVeiculo','CapacidadeKg','UF','DataUltimaMovimentacao','PrecisaRevisao'];
  const linhas = DB.frota.map(f=>[f.placa, f.transportadora, f.tipoVeiculo, f.capacidadeKg ?? '', f.uf||'', f.dataUltimaMovimentacao||'', f.precisaRevisao ? 'Sim':'Não']);
  return toCsv(header, linhas);
}
function gerarCsvDimStatus(){
  const header = ['Nome','OrdemNoFluxo','Cor'];
  const linhas = STATUS_ORDEM_EXPORT.map((s,i)=>[s, i, statusCarregamentoInfo(s).cor]);
  return toCsv(header, linhas);
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
