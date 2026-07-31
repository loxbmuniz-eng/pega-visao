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

/* ---------- máquina de estados (8 status confirmados) ---------- */
// 'Aguardando Carga' é um estado inicial alternativo, não faz parte da
// sequência linear — ele SEMPRE pula direto para 'Veículo em Pátio'
// quando a Logística completa os dados (o caminhão já está no pátio,
// não faz sentido "voltar" para Programado).
const STATUS_FLOW = [
  'Programado',
  'Veículo em Pátio',
  'Liberado para Embarque',
  'Embarque Iniciado',
  'Embarque Finalizado',
  'Faturado',
  'Liberado para Saída',
  'Seguiu Viagem'
];

const STATUS_META = {
  'Aguardando Carga':      { badge:'badge-aguardando-carga',    setor:'Portaria' },
  'Programado':            { badge:'badge-programado',         setor:'Logística' },
  'Veículo em Pátio':      { badge:'badge-patio',               setor:'Portaria' },
  'Liberado para Embarque':{ badge:'badge-liberado-embarque',  setor:'Logística / Expedição' },
  'Embarque Iniciado':     { badge:'badge-embarque-iniciado',  setor:'Expedição' },
  'Embarque Finalizado':   { badge:'badge-embarque-finalizado',setor:'Expedição' },
  'Faturado':              { badge:'badge-faturado',            setor:'Faturamento' },
  'Liberado para Saída':   { badge:'badge-liberado-saida',      setor:'Faturamento' },
  'Seguiu Viagem':         { badge:'badge-seguiu-viagem',       setor:'Portaria' }
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
   Mapeamento de "Status de Carregamento" confirmado no briefing:
     Programado                -> "NÃO ESTÁ NA SUINCO" (vinho)
     Veículo em Pátio          -> "PÁTIO" (amarelo)
     Embarque Iniciado         -> "CARREGANDO" (laranja)
     Embarque Finalizado (ou além) -> "CARREGADO" (verde)
   DECISÃO DE PREENCHIMENTO DE LACUNA (não estava 100% especificado):
   "Liberado para Embarque" foi tratado como "PÁTIO" (o veículo ainda está
   fisicamente parado, só liberado pra fila de carregamento — ainda não
   começou a carregar) e "Aguardando Carga" foi tratado como "PÁTIO" com
   texto próprio ("SEM DADOS") já que fisicamente o veículo já está na
   Suinco. Ver docs/DECISOES_CONFIRMADAS.md item 9. */
const STATUS_CARREGAMENTO_META = {
  'Aguardando Carga':       { texto:'SEM DADOS',          cor:'#d99a2b', classe:'cell-patio' },
  'Programado':              { texto:'NÃO ESTÁ NA SUINCO', cor:'#8f1f26', classe:'cell-fora' },
  'Veículo em Pátio':        { texto:'PÁTIO',              cor:'#e9b954', classe:'cell-patio' },
  'Liberado para Embarque':  { texto:'PÁTIO',              cor:'#e9b954', classe:'cell-patio' },
  'Embarque Iniciado':       { texto:'CARREGANDO',         cor:'#d99a2b', classe:'cell-carregando' },
  'Embarque Finalizado':     { texto:'CARREGADO',          cor:'#3fa66a', classe:'cell-carregado' },
  'Faturado':                { texto:'CARREGADO',          cor:'#3fa66a', classe:'cell-carregado' },
  'Liberado para Saída':     { texto:'CARREGADO',          cor:'#3fa66a', classe:'cell-carregado' },
  'Seguiu Viagem':           { texto:'CARREGADO',          cor:'#3fa66a', classe:'cell-carregado' }
};
function statusCarregamentoInfo(status){
  return STATUS_CARREGAMENTO_META[status] || { texto: status||'—', cor:'#374a86', classe:'' };
}
// "Faturado" ou além no fluxo (Faturado, Liberado para Saída, Seguiu Viagem) -> célula verde no PDF.
function estaFaturado(carga){
  const idx = STATUS_FLOW.indexOf(carga.status);
  return idx >= STATUS_FLOW.indexOf('Faturado');
}
// Ordem "estendida" (Aguardando Carga primeiro) — usada pelo export Dim_Status.
const STATUS_ORDEM_EXPORT = ['Aguardando Carga', ...STATUS_FLOW];

// Quais abas cada setor enxerga. 'Torre' (visão geral) e 'Historico' são
// leitura liberada pra todos — é o que dá a visão de torre de controle.
const SETOR_PERMISSOES = {
  'Logística':    ['torre','programacao','expedicao','indicadores','cadastros','historico','relatorios'],
  'Portaria':     ['torre','portaria','historico'],
  'Expedição':    ['torre','expedicao','historico'],
  'Faturamento':  ['torre','faturamento','historico']
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
    }catch(e){ console.error('Falha ao carregar dados locais', e); }
  },
  save(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    }catch(e){ console.error('Falha ao salvar dados locais', e); }
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

/* ---------- FROTA (cadastro Placa → Transportadora / Tipo de Veículo) ---------- */
function buscarFrota(placa){
  const p = normalizarPlaca(placa);
  return DB.frota.find(f => normalizarPlaca(f.placa) === p) || null;
}
function upsertFrota(placa, transportadora, tipoVeiculo){
  const p = normalizarPlaca(placa);
  if(!p) throw new Error('Placa vazia');
  let f = DB.frota.find(x => normalizarPlaca(x.placa) === p);
  if(f){ f.transportadora = transportadora; f.tipoVeiculo = tipoVeiculo; }
  else{ DB.frota.push({placa:p, transportadora, tipoVeiculo}); }
  SuincoStore.save();
}
function removerFrota(placa){
  const p = normalizarPlaca(placa);
  DB.frota = DB.frota.filter(x => normalizarPlaca(x.placa) !== p);
  SuincoStore.save();
}
// Importação em lote: cola linhas "Placa;Transportadora;TipoVeiculo" (aceita
// ; ou TAB como separador, útil pra colar direto do Excel). Ignora linhas
// vazias ou incompletas. Retorna {ok, ignoradas}.
function importarFrotaLote(texto){
  const linhas = (texto||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let ok = 0, ignoradas = 0;
  linhas.forEach(linha=>{
    const partes = linha.split(/\t|;/).map(s=>s.trim());
    if(partes.length < 3 || !partes[0]){ ignoradas++; return; }
    upsertFrota(partes[0], partes[1]||'', partes[2]||'');
    ok++;
  });
  return {ok, ignoradas};
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

/* ---------- LOG / MOVIMENTAÇÕES (histórico — nunca editado, só append) ---------- */
function registrarMovimentacao({cargaId, placa, statusAnterior, statusNovo, operador, setor}){
  DB.movimentacoes.push({
    id: uid('mov'),
    timestamp: nowISO(),
    operador: operador || '(não identificado)',
    setor: setor || '—',
    placa: normalizarPlaca(placa),
    cargaId,
    statusAnterior: statusAnterior || null,
    statusNovo
  });
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
// veículo ainda não chegou fisicamente. transportadora/tipoVeiculo só
// precisam ser passados se a placa não estiver na Frota (ou pra sobrepor
// manualmente); do contrário são resolvidos automaticamente pela placa.
function criarCargaProgramada({placa, transportadora, tipoVeiculo, numeroCarga, cliente, destino, produto, peso, doca, sequencia, observacoes, praOnde, qtdGanchos, qtdEntregas, operador}){
  const p = normalizarPlaca(placa);
  if(!p) throw new Error('Placa é obrigatória');
  const frota = buscarFrota(p);
  const carga = {
    id: uid('carga'),
    numeroCarga: numeroCarga||'',
    placa: p,
    transportadora: transportadora || (frota ? frota.transportadora : ''),
    tipoVeiculo: tipoVeiculo || (frota ? frota.tipoVeiculo : ''),
    cliente: cliente||'', destino: destino||'', produto: produto||'', peso: Number(peso)||0,
    doca: doca||'', sequencia: sequencia!==undefined && sequencia!=='' ? Number(sequencia) : null,
    observacoes: observacoes||'',
    praOnde: PRA_ONDE_OPCOES.includes(praOnde) ? praOnde : '',
    qtdGanchos: qtdGanchos!==undefined && qtdGanchos!=='' ? Math.max(0, Number(qtdGanchos)||0) : 0,
    qtdEntregas: qtdEntregas!==undefined && qtdEntregas!=='' ? Math.max(1, Number(qtdEntregas)||1) : 1,
    status: 'Programado',
    aguardandoCarga: false,
    criadoEm: nowISO(), criadoPor: operador||'(não identificado)',
    atualizadoEm: nowISO()
  };
  DB.cargas.push(carga);
  registrarMovimentacao({cargaId:carga.id, placa:p, statusAnterior:null, statusNovo:'Programado', operador, setor:'Logística'});
  SuincoStore.save();
  return carga;
}

// Portaria: chegada física de uma placa. Regra especial — aplica a TODAS
// as cargas em aberto daquela placa de uma vez (é o mesmo caminhão chegando
// fisicamente uma única vez). Se não existir NENHUMA carga programada pra
// essa placa, cria uma entrada "Aguardando Carga" — dá visão de torre de
// controle mesmo sem programação prévia (inclusive frota própria).
function registrarChegadaPortaria(placa, operador){
  const p = normalizarPlaca(placa);
  if(!p) throw new Error('Placa é obrigatória');
  const abertas = cargasAbertasPorPlaca(p);

  if(abertas.length === 0){
    const frota = buscarFrota(p);
    const carga = {
      id: uid('carga'), numeroCarga:'', placa: p,
      transportadora: frota ? frota.transportadora : '',
      tipoVeiculo: frota ? frota.tipoVeiculo : '',
      cliente:'', destino:'', produto:'', peso:0, doca:'', sequencia:null, observacoes:'',
      praOnde:'', qtdGanchos:0, qtdEntregas:1,
      status: 'Aguardando Carga', aguardandoCarga: true,
      criadoEm: nowISO(), criadoPor: operador||'(não identificado)',
      atualizadoEm: nowISO()
    };
    DB.cargas.push(carga);
    registrarMovimentacao({cargaId:carga.id, placa:p, statusAnterior:null, statusNovo:'Aguardando Carga', operador, setor:'Portaria'});
    SuincoStore.save();
    return {criadas:[carga], atualizadas:[], jaNoPatio:[]};
  }

  const paraAtualizar = abertas.filter(c => c.status === 'Programado');
  const jaNoPatio = abertas.filter(c => c.status !== 'Programado');
  paraAtualizar.forEach(c=>{
    registrarMovimentacao({cargaId:c.id, placa:p, statusAnterior:c.status, statusNovo:'Veículo em Pátio', operador, setor:'Portaria'});
    c.status = 'Veículo em Pátio';
    c.atualizadoEm = nowISO();
  });
  if(paraAtualizar.length) SuincoStore.save();
  return {criadas:[], atualizadas:paraAtualizar, jaNoPatio};
}

// Logística completa os dados de uma carga que nasceu "Aguardando Carga".
// Vai direto pra 'Veículo em Pátio' — o caminhão já está fisicamente lá.
function completarCargaAguardando(cargaId, {numeroCarga, cliente, destino, produto, peso, doca, sequencia, observacoes, transportadora, tipoVeiculo, praOnde, qtdGanchos, qtdEntregas, operador}){
  const c = getCarga(cargaId);
  if(!c) throw new Error('Carga não encontrada');
  if(c.status !== 'Aguardando Carga') throw new Error('Esta carga não está em Aguardando Carga');
  c.numeroCarga = numeroCarga||''; c.cliente = cliente||''; c.destino = destino||''; c.produto = produto||''; c.peso = Number(peso)||0;
  c.doca = doca||''; c.sequencia = sequencia!==undefined && sequencia!=='' ? Number(sequencia) : null;
  c.observacoes = observacoes||'';
  c.praOnde = PRA_ONDE_OPCOES.includes(praOnde) ? praOnde : '';
  c.qtdGanchos = qtdGanchos!==undefined && qtdGanchos!=='' ? Math.max(0, Number(qtdGanchos)||0) : 0;
  c.qtdEntregas = qtdEntregas!==undefined && qtdEntregas!=='' ? Math.max(1, Number(qtdEntregas)||1) : 1;
  if(transportadora) c.transportadora = transportadora;
  if(tipoVeiculo) c.tipoVeiculo = tipoVeiculo;
  registrarMovimentacao({cargaId:c.id, placa:c.placa, statusAnterior:'Aguardando Carga', statusNovo:'Veículo em Pátio', operador, setor:'Logística'});
  c.status = 'Veículo em Pátio';
  c.aguardandoCarga = false;
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  return c;
}

// Transição genérica no meio do fluxo (Liberado p/ Embarque, Embarque
// Iniciado/Finalizado, Faturado, Liberado p/ Saída). Valida que a carga
// está no status imediatamente anterior da STATUS_FLOW.
function avancarStatusCarga(cargaId, statusNovo, operador, setor){
  const c = getCarga(cargaId);
  if(!c) throw new Error('Carga não encontrada');
  const idxAtual = STATUS_FLOW.indexOf(c.status);
  const idxNovo = STATUS_FLOW.indexOf(statusNovo);
  if(idxNovo === -1) throw new Error('Status desconhecido: '+statusNovo);
  if(idxAtual === -1 || idxNovo !== idxAtual+1){
    throw new Error(`Não é possível ir de "${c.status}" direto para "${statusNovo}".`);
  }
  registrarMovimentacao({cargaId:c.id, placa:c.placa, statusAnterior:c.status, statusNovo, operador, setor});
  c.status = statusNovo;
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  return c;
}

// Portaria: saída física de uma placa — aplica a todas as cargas dessa
// placa que já estiverem "Liberado para Saída" (mesmo caminhão saindo uma
// única vez). Cargas que ainda não chegaram lá ficam intactas e o retorno
// informa quais são, pra Portaria entender por que não liberou.
function registrarSaidaPortaria(placa, operador){
  const p = normalizarPlaca(placa);
  const abertas = cargasAbertasPorPlaca(p);
  const elegiveis = abertas.filter(c => c.status === 'Liberado para Saída');
  const pendentes = abertas.filter(c => c.status !== 'Liberado para Saída');
  elegiveis.forEach(c=>{
    registrarMovimentacao({cargaId:c.id, placa:p, statusAnterior:c.status, statusNovo:'Seguiu Viagem', operador, setor:'Portaria'});
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
   docs/DECISOES_CONFIRMADAS.md. Não inventamos esse critério. */
function indicadoresDaCarga(cargaId){
  const tChegada = primeiroTimestamp(cargaId,'Veículo em Pátio');
  const tLibEmbarque = primeiroTimestamp(cargaId,'Liberado para Embarque');
  const tIniciado = primeiroTimestamp(cargaId,'Embarque Iniciado');
  const tFinalizado = primeiroTimestamp(cargaId,'Embarque Finalizado');
  const tLibSaida = primeiroTimestamp(cargaId,'Liberado para Saída');
  const tSaida = primeiroTimestamp(cargaId,'Seguiu Viagem');
  return {
    tempoAguardandoEmbarque: minutosEntre(tChegada, tLibEmbarque),
    tempoCarregamento: minutosEntre(tIniciado, tFinalizado),
    tempoFaturamento: minutosEntre(tFinalizado, tLibSaida),
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
  const campos = ['tempoAguardandoEmbarque','tempoCarregamento','tempoFaturamento','tempoPatioTotal'];
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
  const header = ['CargaId','Placa','Timestamp','StatusAnterior','StatusNovo','Operador','Setor'];
  const linhas = DB.movimentacoes
    .slice()
    .sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp))
    .map(m=>[m.cargaId, m.placa, m.timestamp, m.statusAnterior||'', m.statusNovo, m.operador, m.setor]);
  return toCsv(header, linhas);
}
function gerarCsvDimCarga(){
  const header = ['Id','NumeroCarga','Placa','Transportadora','TipoVeiculo','Cliente','Destino','Produto',
    'PesoKg','Doca','Sequencia','PraOnde','Compartilhada','QtdGanchos','QtdEntregas','StatusAtual','CriadoEm','AtualizadoEm'];
  const linhas = DB.cargas.map(c=>[
    c.id, c.numeroCarga, c.placa, c.transportadora, c.tipoVeiculo, c.cliente, c.destino, c.produto,
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
  const header = ['Placa','Transportadora','TipoVeiculo'];
  const linhas = DB.frota.map(f=>[f.placa, f.transportadora, f.tipoVeiculo]);
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
