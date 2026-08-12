/* =====================================================================
   PAINEL LOGÍSTICO SUINCO — interface (renderização + eventos)
   Toda a regra de negócio mora em data.js; este arquivo só lê/escreve em
   DB através das funções de lá e desenha a tela.
===================================================================== */

let TAB_ATUAL = 'torre';
let currentPickerCallback = null;
// Ids (string) dos operadores conectados agora, mantido pelo evento de
// presença do socket. Só usado pela aba Usuários — o resto do painel não
// depende de saber quem mais está online.
let _operadoresOnline = new Set();

// Fila de notificações — pedido direto do usuário (08/08/2026): "essa
// notificacao de atualizacoes... quase tampa a tela inteira se tiver 5
// atualizacoes". Nenhum aviso é descartado (o de troca de placa é
// segurança, não decoração) — só um número limitado fica visível ao
// mesmo tempo; o resto espera a vez, e um contador avisa que tem mais.
const NOTIF_MAX_VISIVEL = 3;
let _notifFila = [];

// Próxima ação disponível a partir de cada status (usada nos botões de
// linha das tabelas de Expedição/Faturamento — cada linha já é uma carga
// específica, então não há ambiguidade de "qual carga" aqui).
// Modelo de 6 status: sem "Liberado para Embarque"/"Liberado para Saída".
const NEXT_ACAO = {
  'Aguardando Embarque':  { label:'Iniciar Embarque',   destino:'Embarque Iniciado' },
  'Embarque Iniciado':    { label:'Finalizar Embarque', destino:'Embarque Finalizado' },
  // O rótulo é o STATUS que o clique produz, não o verbo da ação. Assim o
  // botão, a coluna Status e o relatório falam a mesma língua — quem está
  // aprendendo o painel não precisa traduzir "faturar" para "Faturado".
  'Embarque Finalizado':  { label:'FATURADO',           destino:'Faturado' }
};

/* ---------- CONEXÃO COM O SERVIDOR (estado real, sem fingir) ----------
   O rodapé e o badge do cabeçalho mostram o estado VERDADEIRO da conexão.
   O texto "Conectado | Compartilhado entre os setores" só
   aparece quando existe conexão de fato; enquanto o TI não provisionar o
   ambiente, o rodapé diz que está aguardando configuração. Exibir conexão
   inexistente seria exatamente o que o TI checa primeiro numa auditoria. */
let _syncPendentes = 0;

function mostrarSyncOverlay(sub){
  const ov = document.getElementById('sync-overlay');
  if(!ov) return;
  const s = document.getElementById('sync-sub');
  if(s) s.textContent = sub || '';
  ov.hidden = false;
}
function esconderSyncOverlay(){
  const ov = document.getElementById('sync-overlay');
  if(ov) ov.hidden = true;
}

/* Envolve uma operação de sincronia mostrando o overlay enquanto ela roda.
   Usa contador para o overlay não sumir no meio quando há duas em paralelo. */
async function comOverlaySync(sub, tarefa){
  _syncPendentes++;
  mostrarSyncOverlay(sub);
  try{ return await tarefa(); }
  finally{
    _syncPendentes--;
    if(_syncPendentes <= 0){ _syncPendentes = 0; esconderSyncOverlay(); }
  }
}

/* Carimbo do build, mostrado no rodapé. O build_arquivo_unico.py injeta
   window.SUINCO_BUILD com data e commit ao gerar o arquivo único.

   Existe por um motivo prático: depois de publicar, a pergunta é sempre "o
   navegador pegou a versão nova ou está com a antiga em cache?". Sem carimbo
   visível, a única resposta é caçar um campo que mudou. Com ele, é um olhar
   no rodapé. Quando se abre a fonte direto (sem build), fica 'fonte'. */
const BUILD_ID = (typeof window !== 'undefined' && window.SUINCO_BUILD) || 'fonte';

function atualizarRodapeConexao(estado, detalhe){
  const rod = document.getElementById('rodape-conexao');
  const badge = document.getElementById('badge-conexao');
  if(!rod) return;
  const fila = (typeof SuincoSharePoint !== 'undefined') ? SuincoSharePoint.pendentes() : 0;
  const sufixoFila = fila ? ` · ${fila} registro(s) na fila` : '';
  const carimbo = ` · versão ${BUILD_ID}`;

  if(estado === 'online'){
    const u = (typeof SuincoSharePoint !== 'undefined') ? SuincoSharePoint.ultimaSincronia() : null;
    const seg = u ? Math.round((Date.now() - Date.parse(u))/1000) : null;
    const quando = seg === null ? '' : (seg < 5 ? ' · sincronizado agora' : ` · sincronizado há ${seg}s`);
    rod.className = 'rodape-conexao online';
    rod.innerHTML = `✅ Conectado | Compartilhado entre os setores${esc(quando)}${esc(sufixoFila)}${esc(carimbo)}`;
    if(badge){ badge.hidden = true; }
  } else if(estado === 'offline'){
    rod.className = 'rodape-conexao offline';
    rod.innerHTML = `⚠️ Modo Offline — gravando no aparelho e sincronizando assim que a rede voltar${esc(sufixoFila)}${esc(carimbo)}`;
    if(badge){ badge.hidden = false; badge.className = 'badge-conexao offline'; badge.textContent = '⚠️ Modo Offline'; }
  } else {
    /* 'local' cobre TRÊS situações diferentes, e mostrá-las com o mesmo
       texto engana. "Sem conexão com o servidor" antes de alguém fazer
       login faz o operador achar que a API caiu, quando ela só não foi
       chamada ainda. */
    rod.className = 'rodape-conexao local';
    if(!DB.operador){
      rod.innerHTML = '🔒 Faça login para conectar aos outros setores.' + esc(carimbo);
    } else if(DB.operador.email){
      // Tem e-mail: entrou pelo servidor, mas a sessão caiu ou a rede foi
      // embora. Aqui "sem conexão" é a descrição correta.
      rod.innerHTML = '⚠️ Sem conexão com o servidor — entre de novo para voltar a compartilhar.' + esc(carimbo);
    } else {
      // Sem e-mail: escolheu o modo local de propósito.
      rod.innerHTML = '⚠️ Modo Local — os dados ficam SÓ neste navegador e não são vistos pelos outros setores.' + esc(carimbo);
    }
    if(badge){ badge.hidden = false; badge.className = 'badge-conexao local'; badge.textContent = '⚙️ Local'; }
  }
}

/* O ENCERRAR E ARQUIVAR CICLO foi removido em 05/08/2026.

   Ele disparava um fluxo do Power Automate que criava pastas /Ano/Mês/Dia/
   no SharePoint. Com o PostgreSQL o histórico é permanente e consultável
   por período a qualquer momento — não há mais o que arquivar, e um botão
   irreversível que não faz nada é a pior combinação possível.

   Se um dia a operação precisar de um fechamento formal de dia (travar
   edição retroativa, por exemplo), isso é regra de servidor, não de tela. */
/* ---------- TEMA CLARO / ESCURO ----------------------------------------
   O tema vive num atributo data-tema no <html>; todas as cores saem de
   variáveis CSS (ver :root e :root[data-tema="claro"] em styles.css), então
   trocar o atributo repinta o painel inteiro, incluindo badges, relatórios e
   gráficos.

   Onde é guardado: numa chave PRÓPRIA do localStorage, separada do DB. É
   preferência do dispositivo (o monitor da Portaria pode querer claro e o do
   escritório escuro), não dado operacional — se fosse pro DB, iria junto pro
   servidor um dia e passaria a forçar o mesmo tema pra todo mundo.

   Primeira abertura: segue a preferência do sistema operacional
   (prefers-color-scheme). A partir da primeira troca manual, a escolha do
   usuário manda e é lembrada.

   Impressão: o PDF sai no tema ATIVO. A diretriz antiga era "fundo escuro
   sempre, inclusive em PDF"; com o modo claro disponível isso passa a ser
   escolha de quem imprime — e imprimir no claro economiza toner. */
const TEMA_STORAGE_KEY = 'suinco_tema';

function temaAtual(){
  return document.documentElement.getAttribute('data-tema') === 'claro' ? 'claro' : 'escuro';
}
function aplicarTema(tema){
  const claro = tema === 'claro';
  document.documentElement.setAttribute('data-tema', claro ? 'claro' : 'escuro');
  const btn = document.getElementById('btn-tema');
  // O botão mostra o tema ATUAL, não o que vai acontecer ao clicar — foi o
  // que se mostrou menos ambíguo em uso.
  //
  // O rótulo vai em <span class="rot-btn"> e não solto: no celular estreito
  // o CSS esconde só o rótulo e mantém o ícone, e para isso o texto precisa
  // ser um elemento próprio. Escrito como textContent, não havia como
  // separar um do outro sem apagar o botão inteiro.
  if(btn) btn.innerHTML = claro
    ? '☀️<span class="rot-btn">Claro</span>'
    : '🌙<span class="rot-btn">Escuro</span>';
  // Gráficos são desenhados em canvas: pixels já pintados não reagem a CSS,
  // então precisam ser redesenhados na cor nova.
  if(typeof TAB_ATUAL !== 'undefined' && TAB_ATUAL === 'indicadores'){
    try{ renderIndicadores(); }catch(e){ /* aba ainda não montada */ }
  }
}
function alternarTema(){
  const novo = temaAtual() === 'claro' ? 'escuro' : 'claro';
  try{ localStorage.setItem(TEMA_STORAGE_KEY, novo); }catch(e){ /* modo privado */ }
  aplicarTema(novo);
}
function iniciarTema(){
  let salvo = null;
  try{ salvo = localStorage.getItem(TEMA_STORAGE_KEY); }catch(e){ /* modo privado */ }
  if(salvo === 'claro' || salvo === 'escuro'){ aplicarTema(salvo); return; }
  const sistemaClaro = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  aplicarTema(sistemaClaro ? 'claro' : 'escuro');
}

/* Lê uma variável CSS do tema atual. Serve para o que NÃO consegue usar
   var(--x) diretamente: o canvas dos gráficos e as cores montadas em string
   nos relatórios. Mantém o CSS como fonte única das cores nos dois temas. */
function corTema(nome, alternativa){
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v || alternativa || '#888';
}

/* ---------- utilitários de UI ---------- */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* Escape para valor que vai virar STRING JAVASCRIPT DENTRO DE ATRIBUTO HTML,
   como em onclick="f('AQUI')".

   esc() sozinho NÃO serve neste caso: ele transforma ' em &#39;, e o
   analisador de HTML decodifica a entidade de volta para ' ANTES de o
   JavaScript ser lido — a aspa reaparece e o atributo quebra do mesmo jeito.
   Aqui a aspa é neutralizada com barra invertida, no nível do JavaScript, e só
   então o resultado é escapado para o nível do HTML. */
function escJs(s){
  return esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}
function nomeOperadorAtual(){ return DB.operador ? DB.operador.nome : '(não identificado)'; }
function setorOperadorAtual(){ return DB.operador ? DB.operador.setor : '—'; }
function badgeHtml(status){
  const meta = STATUS_META[status] || {badge:''};
  return `<span class="badge ${meta.badge}">${esc(status)}</span>`;
}

/* Botão de avanço com a cor do status que ele PRODUZ.

   Os botões de Expedição e Faturamento eram todos btn-primary — dourados.
   "Finalizar Embarque" saía amarelo e produzia um status verde-claro; o
   operador apertava uma cor e recebia outra.

   A escala de seis cores é a linguagem do painel: o gestor a definiu, ela
   está na badge, na linha do tempo e no relatório impresso. Um botão que
   ignora essa escala obriga o operador a decorar uma segunda convenção
   ("dourado = avançar") em vez de simplesmente ler a cor de destino.

   Agora a cor sai das MESMAS variáveis --st-* da badge. Trocar de tema ou
   ajustar uma cor de status repinta o botão junto, sem lista paralela. */
function botaoAvancoHtml(carga){
  const acao = NEXT_ACAO[carga.status];
  if(!acao) return '—';
  const slug = statusSlug(acao.destino);
  return `<button class="btn btn-sm btn-avanco btn-avanco-${slug}"
      onclick="avancarStatusUI('${escJs(carga.id)}')"
      title="Registrar ${esc(acao.destino)}">${esc(acao.label)}</button>`;
}
/* Mostra um aviso já pronto (elemento DOM), respeitando o limite de
   NOTIF_MAX_VISIVEL na tela ao mesmo tempo. Além do limite, entra numa
   fila — nada é descartado, só espera a vez. Quando um aviso sai (por
   tempo ou por clique no X), o próximo da fila entra sozinho.

   Pedido do usuário (08/08/2026): "essa notificacao de atualizacoes tao
   saindo muito grandes... quase tampa a tela inteira se tiver 5
   atualizacoes". O aviso de troca de placa é segurança (o caminhão errado
   entra na doca por causa dele) — não é candidato a "descartar os mais
   antigos", só a esperar um pouco. */
function _exibirNotif(el, ms){
  const container = document.getElementById('notif');
  if(container.querySelectorAll('.notif-item').length >= NOTIF_MAX_VISIVEL){
    _notifFila.push({el, ms});
    _atualizarContadorFila();
    return;
  }
  _mostrarNotifAgora(el, ms);
}
// Separado de _exibirNotif de propósito: um item que passa pela fila só
// pode ganhar o botão de fechar e o temporizador UMA vez, na hora em que
// realmente aparece — não na hora em que só foi posto na fila (achado
// escrevendo o teste desta função: um item que esperou a vez ganhava
// DOIS botões de fechar, um deles com temporizador que nunca chegava a
// existir de verdade). */
function _mostrarNotifAgora(el, ms){
  const container = document.getElementById('notif');
  const botaoFechar = document.createElement('button');
  botaoFechar.className = 'notif-fechar';
  botaoFechar.setAttribute('aria-label', 'Fechar aviso');
  botaoFechar.textContent = '×';
  el.prepend(botaoFechar);

  const remover = () => {
    clearTimeout(temporizador);
    el.remove();
    const proximo = _notifFila.shift();   // tira da fila ANTES de contar — o contador reflete o que sobra
    _atualizarContadorFila();
    if(proximo) _mostrarNotifAgora(proximo.el, proximo.ms);
  };
  botaoFechar.onclick = remover;

  container.appendChild(el);
  const temporizador = setTimeout(remover, ms || 5000);
}
// Pílula "+N aguardando" no topo da pilha — só existe quando a fila não
// está vazia, e sempre é o ÚLTIMO elemento (o rodapé visual da pilha,
// já que a pilha cresce de baixo pra cima — column-reverse).
function _atualizarContadorFila(){
  const container = document.getElementById('notif');
  let pill = document.getElementById('notif-fila-contador');
  if(!_notifFila.length){ if(pill) pill.remove(); return; }
  if(!pill){
    pill = document.createElement('div');
    pill.id = 'notif-fila-contador';
    container.appendChild(pill);
  }
  pill.textContent = `+ ${_notifFila.length} aviso(s) aguardando`;
}
// `ms` opcional: avisos longos (ex: troca da base de frota) precisam de mais
// tempo em tela do que a confirmação curta de uma ação.
function notify(msg, type, ms){
  const el = document.createElement('div');
  el.className = 'notif-item' + (type ? ' ' + type : '');
  const texto = document.createElement('span');
  texto.textContent = msg;
  el.appendChild(texto);
  _exibirNotif(el, ms);
}

/* Monta a mensagem de "outro setor mexeu em alguma coisa" a partir do que
   REALMENTE mudou (r.detalhes, preenchido por fundirEstadoRemoto em
   data.js) — não mais só uma contagem. Pedido do usuário (08/08/2026):
   "que diga exatamente o que foi feito, ou indique o setor e ação".

   `detalhes` vem capado (não é a lista inteira quando a sincronia traz
   dezenas de cargas de uma vez); por isso o total continua vindo das
   contagens (r.cargasNovas/cargasAtualizadas), não do tamanho da lista. */
function mensagemAtualizacaoRemota(r){
  const total = (r.cargasNovas||0) + (r.cargasAtualizadas||0);
  if(!r.detalhes || !r.detalhes.length){
    // Sem detalhe (não deveria acontecer, mas o painel não pode travar
    // numa notificação por causa disso) — volta pro resumo por contagem.
    const partes = [];
    if(r.cargasNovas)       partes.push(`${r.cargasNovas} carga(s) nova(s)`);
    if(r.cargasAtualizadas) partes.push(`${r.cargasAtualizadas} atualizada(s)`);
    return 'Atualizado por outro setor: ' + partes.join(' · ') + '.';
  }
  const AVISO_ACAO = { programada:'entrou', 'mudou de status':'mudou pra', 'foi editada':'foi editada', excluída:'saiu' };
  const linhas = r.detalhes.map(d=>{
    const identificacao = d.numeroCarga && d.numeroCarga !== 'Aguardando Carga'
      ? `Carga ${d.numeroCarga}` : `Placa ${d.placa || '—'}`;
    const setor = d.setor ? ` (${d.setor})` : '';
    if(d.acao === 'mudou de status') return `${identificacao} mudou pra "${d.status}"${setor}`;
    if(d.acao === 'programada')      return `${identificacao} entrou na programação`;
    if(d.acao === 'excluída')        return `${identificacao} saiu da programação`;
    return `${identificacao} foi editada${setor}`;
  });
  const mostrar = linhas.slice(0, 2);
  const resto = total - mostrar.length;
  return 'Atualizado por outro setor: ' + mostrar.join(' · ')
    + (resto > 0 ? ` · e mais ${resto}` : '') + '.';
}

/* ---------- SOM DE CONFIRMAÇÃO ----------
   Replica o padrão do HTML original do usuário: 3 tons de 880Hz espaçados
   por 200ms, via Web Audio API. Toca em toda ação que MUDA STATUS de carga
   com sucesso (chegada, saída, avanço de status, completar Aguardando
   Carga) — nunca em digitação, só em confirmações de ação. Falha em
   silêncio se o navegador bloquear áudio sem interação do usuário (não
   deve nunca quebrar o fluxo operacional por causa do som). */
let _audioCtx = null;
function tocarBeepConfirmacao(){
  try{
    if(!_audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return;
      _audioCtx = new Ctx();
    }
    if(_audioCtx.state === 'suspended') _audioCtx.resume();
    const atrasos = [0, 200, 400]; // ms — 3 tons espaçados por 200ms
    atrasos.forEach(atrasoMs=>{
      setTimeout(()=>{
        try{
          const osc = _audioCtx.createOscillator();
          const gain = _audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.value = 880; // Hz — mesmo tom do padrão original
          gain.gain.setValueAtTime(0.0001, _audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.22, _audioCtx.currentTime + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.12);
          osc.connect(gain);
          gain.connect(_audioCtx.destination);
          osc.start();
          osc.stop(_audioCtx.currentTime + 0.13);
        }catch(e){ /* silencioso — som nunca deve travar o fluxo operacional */ }
      }, atrasoMs);
    });
  }catch(e){ console.warn('Som de confirmação indisponível:', e); }
}

/* ---------- SOM DE ALERTA (edição em carga já programada) ----------
   Diferente do beep de confirmação de propósito. Confirmação é aguda e
   curta, para quem apertou o botão. Isto é um alerta para quem NÃO fez
   nada e precisa levantar a cabeça: dois tons descendentes, mais graves e
   mais longos, que atravessam o barulho do pátio sem virar susto.

   Se os dois sons fossem iguais, o operador não saberia se o que ouviu foi
   a própria ação ou um aviso de que a carga dele mudou. */
function tocarAlertaAlteracao(){
  try{
    if(!_audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return;
      _audioCtx = new Ctx();
    }
    if(_audioCtx.state === 'suspended') _audioCtx.resume();
    [[0, 660], [260, 495]].forEach(([atrasoMs, hz])=>{
      setTimeout(()=>{
        try{
          const osc = _audioCtx.createOscillator();
          const gain = _audioCtx.createGain();
          osc.type = 'triangle';   // menos estridente que a senoide pura
          osc.frequency.value = hz;
          gain.gain.setValueAtTime(0.0001, _audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.3, _audioCtx.currentTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.26);
          osc.connect(gain);
          gain.connect(_audioCtx.destination);
          osc.start();
          osc.stop(_audioCtx.currentTime + 0.27);
        }catch(e){ /* som nunca trava o fluxo */ }
      }, atrasoMs);
    });
  }catch(e){ console.warn('Alerta sonoro indisponível:', e); }
}

/* ---------- AVISO DE ALTERAÇÃO EM CARGA JÁ PROGRAMADA ----------
   Chega pelo servidor, por socket, para TODO MUNDO que estiver logado.

   Por que o servidor e não o navegador de quem editou: só o servidor sabe
   o estado anterior com certeza e alcança os outros terminais. E o aviso
   sai depois da gravação confirmada — avisar antes seria anunciar uma
   mudança que ainda pode ser recusada.

   Quem editou NÃO é avisado: ele acabou de ver a confirmação da própria
   ação, e repetir a informação treina a operação a ignorar o aviso. */
function souEu(operador){
  if(!operador || !DB.operador) return false;
  if(operador.id && DB.operador.id) return operador.id === DB.operador.id;
  return operador.nome === DB.operador.nome && operador.setor === DB.operador.setor;
}

function avisoDeEdicaoHtml(aviso){
  const carga = aviso.numeroCarga ? `Carga ${aviso.numeroCarga}` : `Placa ${aviso.placa}`;
  const quem = aviso.operador ? `${aviso.operador.nome} (${aviso.operador.setor})` : 'outro operador';
  const linhas = aviso.alteracoes
    .map(a=>`<div class="aviso-linha"><b>${esc(a.campo)}:</b> <s>${esc(a.de)}</s> → <b>${esc(a.para)}</b></div>`)
    .join('');
  return `<div class="aviso-titulo">${esc(carga)} alterada</div>${linhas}`
       + `<div class="aviso-quem">por ${esc(quem)} · ${horaCurta(aviso.em)}</div>`;
}

function horaCurta(iso){
  const d = iso ? new Date(iso) : new Date();
  return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
}

function receberEdicaoRemota(aviso){
  if(!aviso || !Array.isArray(aviso.alteracoes) || !aviso.alteracoes.length) return;
  if(souEu(aviso.operador)) return;

  const el = document.createElement('div');
  el.className = 'notif-item aviso-alteracao' + (aviso.sonoro ? ' forte' : '');
  el.innerHTML = avisoDeEdicaoHtml(aviso);
  /* Troca de placa fica 20 s; o resto, 9 s.

     Não é exagero: é o tempo de alguém que está com as mãos ocupadas
     terminar o que faz e olhar para a tela. O aviso some sozinho porque
     um que exige clique acumularia na tela do terminal compartilhado —
     mas quem já leu pode fechar na hora pelo X, e libera a vez pro
     próximo da fila sem esperar o tempo passar. */
  _exibirNotif(el, aviso.sonoro ? 20000 : 9000);

  if(aviso.sonoro) tocarAlertaAlteracao();
}

/* O servidor recusou a mudança de status.

   Acontece quando a transição não é válida a partir do status REAL do
   servidor (outro terminal já moveu a carga) ou quando o setor não tem
   permissão para aquela etapa.

   Aqui a tela DESFAZ a mudança local. Manter na tela um status que o banco
   não aceitou é o pior desfecho: o operador seguiria trabalhando em cima de
   uma carga que, para todos os outros terminais, não saiu do lugar — e a
   divergência só apareceria na doca.

   Com som, porque o operador já virou as costas para a tela achando que
   registrou. */
function receberRecusaDeStatus(carga, alvo, motivo){
  const anterior = statusAnteriorDe(carga.id, alvo);
  if(anterior){
    carga.status = anterior;
    carga.atualizadoEm = nowISO();
  }
  // A movimentação otimista sai do log: ela não aconteceu.
  DB.movimentacoes = DB.movimentacoes.filter(
    m => !(m.cargaId === carga.id && m.statusNovo === alvo && m.timestamp >= (carga.atualizadoEm || '')));
  SuincoStore.save();
  notify(
    `${carga.placa}: o servidor NÃO aceitou "${alvo}". ${motivo || ''} `
    + `A carga voltou para "${carga.status}". Confira antes de liberar o caminhão.`,
    'danger', 20000);
  tocarAlertaAlteracao();
  renderAll();
}

/* Criação ou edição de carga recusada pelo servidor.

   Generalização do que corrigiu a chegada sem programação da Portaria:
   qualquer recusa de POST/PATCH em /api/cargas (placa fora da frota, setor
   sem permissão, conflito de versão) chega aqui em vez de morrer no
   console. Não tenta desfazer nada sozinho — ao contrário da recusa de
   status, aqui não dá para saber com segurança se a carga já existia no
   servidor antes (edição) ou nunca chegou a existir (criação), e chutar
   errado apagaria dado de verdade. O aviso é alto e diz pra conferir. */
function receberRecusaDeCarga(carga, motivo, removida){
  const rotulo = carga.numeroCarga && carga.numeroCarga !== 'Aguardando Carga'
    ? carga.numeroCarga : (carga.placa || carga.id);
  notify(
    removida
      ? `${rotulo}: o servidor recusou a criação desta carga. ${motivo || ''} `
        + 'Ela foi removida da tela — nunca existiu no banco. Corrija o motivo '
        + '(placa cadastrada na Frota? setor com permissão?) e refaça.'
      : `${rotulo}: o servidor recusou a gravação. ${motivo || ''} `
        + 'A informação pode não estar salva — confira e refaça se precisar.',
    'danger', 20000);
  tocarAlertaAlteracao();
  if(removida) renderAll();
}

/* Cadastro de placa na Frota recusado pelo servidor.

   Achado em produção (07/08/2026): cadastro manual de placa nunca subia ao
   servidor — "Placa cadastrada na Frota." aparecia sem nenhuma chamada de
   rede (ver upsertFrota em data.js). Corrigido para sincronizar de
   verdade; este é o aviso para quando a sincronia sobe e o servidor
   recusa (setor sem permissão, placa mal formada). A placa CONTINUA na
   Frota local — avisar loud em vez de desfazer, porque o operador pode
   estar sem rede e a fila reenviar sozinha depois; apagar aqui apagaria
   um cadastro que ainda vai vingar. */
function receberRecusaDeFrota(frota, motivo){
  notify(
    `Placa ${frota.placa}: o servidor recusou o cadastro na Frota. ${motivo || ''} `
    + 'Ficou salva só neste aparelho — carga programada com ela será recusada '
    + 'em outros terminais até isto ser corrigido.',
    'danger', 20000);
  tocarAlertaAlteracao();
}

/* Mesmo aviso, para o cadastro de Rota. A rota continua no seletor deste
   aparelho — só não chegou ao servidor, então outros terminais ainda não
   vão vê-la. */
function receberRecusaDeRota(rota, motivo){
  notify(
    `Rota ${rota.codigo}: o servidor recusou o cadastro. ${motivo || ''} `
    + 'Ficou salva só neste aparelho — outros terminais ainda não vão ver esta rota.',
    'danger', 20000);
  tocarAlertaAlteracao();
}

/* Status imediatamente anterior a `alvo` no log desta carga.
   Usa o log em vez de STATUS_FLOW.indexOf(alvo)-1 porque a carga pode ter
   nascido no meio do fluxo (entrada "Aguardando Carga" da Portaria). */
function statusAnteriorDe(cargaId, alvo){
  const doLog = DB.movimentacoes
    .filter(m => m.cargaId === cargaId && m.statusNovo === alvo)
    .sort((a,b)=> String(b.timestamp).localeCompare(String(a.timestamp)))[0];
  if(doLog && doLog.statusAnterior) return doLog.statusAnterior;
  const i = STATUS_FLOW.indexOf(alvo);
  return i > 0 ? STATUS_FLOW[i-1] : null;
}

/* Carga excluída por outro operador.

   Toca junto com a troca de placa, e pelo mesmo motivo: quem está com a
   lista impressa na mão ou com o caminhão na doca precisa saber que aquela
   carga deixou de existir. Descobrir isso quando o motorista já encostou é
   tarde demais. */
function receberExclusaoRemota(aviso){
  if(!aviso || !aviso.cargaId) return;
  if(souEu(aviso.operador)) return;

  const carga = aviso.numeroCarga ? `Carga ${aviso.numeroCarga}` : `Placa ${aviso.placa}`;
  const quem = aviso.operador ? `${aviso.operador.nome} (${aviso.operador.setor})` : 'outro operador';

  const el = document.createElement('div');
  el.className = 'notif-item aviso-alteracao forte';
  el.innerHTML = `<div class="aviso-titulo">${esc(carga)} EXCLUÍDA</div>`
    + `<div class="aviso-linha">Placa <b>${esc(aviso.placa || '—')}</b> saiu da programação.</div>`
    + `<div class="aviso-quem">por ${esc(quem)} · ${horaCurta(aviso.em)}</div>`;
  _exibirNotif(el, 20000);
  tocarAlertaAlteracao();
}

/* ---------- login / operador (placeholder até SSO) ---------- */
function detectarTurnoPorHora(){
  const h = new Date().getHours();
  if(h>=6 && h<14) return 'Manhã (06h–14h)';
  if(h>=14 && h<22) return 'Tarde (14h–22h)';
  return 'Noite (22h–06h)';
}
function abrirLogin(){
  document.getElementById('modal-operador').classList.add('open');
  // Qual formulário aparece não é escolha do usuário: se o servidor está
  // configurado, é e-mail e senha. O modo local fica atrás de um link, para
  // ninguém cair nele por acidente e achar que está compartilhando dados
  // quando não está.
  mostrarLoginServidor();
  const email = document.getElementById('login-email');
  if(email) setTimeout(()=>email.focus(), 60);
}

function mostrarLoginServidor(){
  const srv = document.getElementById('login-servidor');
  const loc = document.getElementById('login-local');
  if(srv) srv.hidden = false;
  if(loc) loc.hidden = true;
  esconderErroLogin();
}

function mostrarLoginLocal(){
  const srv = document.getElementById('login-servidor');
  const loc = document.getElementById('login-local');
  if(srv) srv.hidden = true;
  if(loc) loc.hidden = false;
}

function mostrarErroLogin(msg){
  const el = document.getElementById('login-erro');
  if(!el) { notify(msg, 'warn'); return; }
  el.textContent = msg;
  el.hidden = false;
}

function esconderErroLogin(){
  const el = document.getElementById('login-erro');
  if(el) el.hidden = true;
}

/* Traduz a falha de login para uma frase que diz o que fazer.

   "Servidor não respondeu" era a resposta para quatro problemas diferentes:
   senha certa mas serviço fora, muitas tentativas no mesmo minuto, aparelho
   sem caminho até a API e erro interno do servidor. Quem está no pátio não
   tem como distinguir, e o relato que chega no WhatsApp é sempre o mesmo —
   o que torna o diagnóstico remoto impossível.

   Cada retorno carrega um código curto entre colchetes. Não é decoração: é
   o que o operador fotografa e manda, e o que permite responder sem pedir
   para abrir o console do navegador. */
async function explicarFalhaDeLogin(e){
  if(e && e.status === 429){
    return 'Muitas tentativas de entrada deste local no último minuto. '
         + 'Espere 1 minuto e tente de novo. [LIMITE]';
  }
  if(e && e.status >= 500){
    return `O servidor recebeu o pedido mas falhou (erro ${e.status}). `
         + 'Isso é do servidor, não da sua senha. Avise a Logística. [HTTP'+e.status+']';
  }
  if(e && e.codigo === 'ORIGEM_NAO_AUTORIZADA'){
    // O servidor sabe qual endereço foi barrado e qual é o certo. Repassar a
    // frase dele é melhor do que reescrever aqui uma versão mais vaga.
    return (e.message || 'Endereço não autorizado.') + ' [ENDEREÇO]';
  }
  if(e && e.status === 401){
    return 'E-mail ou senha incorretos. Confira maiúsculas e espaços. [SENHA]';
  }
  if(e && e.status){
    return (e.message || `Erro ${e.status}.`) + ` [HTTP${e.status}]`;
  }

  // Sem status: o pedido não chegou a virar resposta. A sonda separa
  // "seu aparelho não alcança o servidor" de "alcança, mas foi barrado".
  let alcance = 'inalcancavel';
  try{
    if(typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.diagnosticarConexao){
      alcance = await SuincoSharePoint.diagnosticarConexao();
    }
  }catch(err){ /* a sonda nunca deve derrubar a mensagem de erro */ }

  if(alcance === 'filtrado'){
    // A sonda com CORS passou: o servidor aceita este endereço e respondeu.
    // O que caiu foi o envio do login — algo no meio do caminho está
    // barrando. Mandar avisar a Logística aqui seria conselho errado: o
    // problema está na rede ou no computador de quem tenta entrar.
    return 'Este computador alcança o servidor, mas algo está bloqueando o '
         + 'envio do login — normalmente firewall da empresa, antivírus ou '
         + 'extensão do navegador. Teste numa janela anônima ou usando os '
         + 'dados do celular. [FILTRADO]';
  }
  if(alcance === 'alcancavel'){
    return 'O servidor está no ar, mas recusou a entrada vinda deste aparelho. '
         + 'Avise a Logística — não adianta tentar de novo. [BLOQUEIO]';
  }
  if(e && e.motivo === 'timeout'){
    return 'O servidor demorou demais para responder. Verifique a internet '
         + 'deste aparelho e tente de novo. [TEMPO]';
  }
  return 'Este aparelho não está alcançando o servidor. Verifique o Wi-Fi ou '
       + 'os dados móveis; se a internet estiver boa, avise a Logística. [REDE]';
}

/* ---------- TESTE DE CONEXÃO ----------
   Roda no navegador de quem não consegue entrar e mostra em qual etapa a
   requisição morre. Existe porque duas máquinas Windows da mesma empresa
   falharam igual enquanto celulares no 4G entravam normalmente — e a essa
   altura o diagnóstico à distância já tinha virado adivinhação.

   As quatro sondas não são arbitrárias: cada uma remove uma camada.

   1. Alcance bruto (no-cors) — o pacote sai deste aparelho e chega em
      algum lugar? Falhou aqui, é rede, DNS ou o servidor fora.
   2. Leitura permitida (CORS) — o navegador conseguiu LER a resposta?
      Falhou só aqui, o endereço não está autorizado no servidor.
   3. Pedido de permissão (preflight) — o POST com content-type JSON exige
      um OPTIONS antes. Proxy corporativo costuma descartar OPTIONS em
      silêncio. Falhou só aqui, é a rede da empresa filtrando.
   4. Envio simples — o mesmo POST em text/plain não exige OPTIONS. Se esta
      passa e a 3 falha, está provado que o problema é o preflight, e existe
      contorno sem depender da TI.

   Nenhuma sonda envia senha: a 3 e a 4 mandam corpo vazio de propósito, e
   a resposta esperada é justamente a recusa por falta de campos. */
async function sondarConexao(nome, executar){
  const inicio = Date.now();
  try{
    const detalhe = await executar();
    return { nome, ok:true, detalhe, ms: Date.now()-inicio };
  }catch(e){
    return { nome, ok:false, detalhe: (e && e.name ? e.name+': ' : '') + (e && e.message || 'falhou'),
             ms: Date.now()-inicio };
  }
}

async function rodarTesteDeConexao(){
  const caixa = document.getElementById('teste-conexao');
  if(!caixa) return;
  const api = (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.SP_CONFIG.api) || '';
  caixa.hidden = false;
  caixa.innerHTML = '<div class="teste-titulo">Testando…</div>';

  const resultados = [];

  resultados.push(await sondarConexao('1. Alcance até o servidor', async ()=>{
    await fetch(api + '/health', { mode:'no-cors' });
    return 'o pacote chegou';
  }));

  resultados.push(await sondarConexao('2. Leitura permitida (endereço autorizado)', async ()=>{
    const r = await fetch(api + '/health');
    const j = await r.json();
    return 'servidor respondeu · banco ' + (j.banco || '?');
  }));

  resultados.push(await sondarConexao('3. Pedido de permissão (OPTIONS)', async ()=>{
    const r = await fetch(api + '/auth/login', {
      method:'POST', headers:{'content-type':'application/json'}, body:'{}'
    });
    return 'passou · servidor respondeu ' + r.status;
  }));

  resultados.push(await sondarConexao('4. Envio simples (sem OPTIONS)', async ()=>{
    const r = await fetch(api + '/auth/login', {
      method:'POST', headers:{'content-type':'text/plain'}, body:'{}'
    });
    return 'passou · servidor respondeu ' + r.status;
  }));

  const ok = resultados.map(r=>r.ok);
  let conclusao;
  if(!ok[0]){
    conclusao = 'Este aparelho não alcança o servidor. É a internet daqui, '
              + 'o DNS da rede, ou o servidor está fora.';
  } else if(!ok[1] && !ok[2] && !ok[3]){
    /* O pacote chega e NENHUMA resposta pode ser lida.

       Duas causas produzem exatamente isto, e a diferença não está visível
       daqui: ou o endereço deste painel não está autorizado no servidor, ou
       algo entre este aparelho e o servidor está removendo as respostas —
       proxy da empresa, antivírus que inspeciona HTTPS, filtro de rede.

       O desempate é de graça e não precisa de ninguém técnico: se o MESMO
       endereço abre e entra num celular pelo 4G, o servidor está correto e
       o problema é a rede daqui. Foi assim que este caso se resolveu. */
    conclusao = 'O servidor recebe, mas nenhuma resposta consegue chegar '
              + 'inteira neste navegador. Teste o mesmo endereço num celular '
              + 'usando 4G (sem o Wi-Fi da empresa): se lá funcionar, quem '
              + 'está bloqueando é a rede daqui, e a TI precisa liberar '
              + (api || 'o endereço da API') + ' na porta 443 sem inspeção de '
              + 'HTTPS. Se falhar também no 4G, o problema é meu — me mande '
              + 'esta tela.';
  } else if(!ok[1]){
    conclusao = 'O servidor responde mas recusa este endereço. É configuração '
              + 'do servidor — me mande esta tela.';
  } else if(!ok[2] && ok[3]){
    conclusao = 'A rede desta empresa está descartando o pedido de permissão '
              + '(OPTIONS). O envio simples passou — dá para contornar sem '
              + 'depender da TI. Me mande esta tela.';
  } else if(!ok[2] && !ok[3]){
    conclusao = 'A rede alcança o servidor mas bloqueia o envio do login. '
              + 'Firewall ou antivírus da empresa. Precisa liberar '
              + (api || 'o endereço da API') + ' na porta 443.';
  } else {
    conclusao = 'Todas as etapas passaram. Se ainda não entra, o problema é '
              + 'o e-mail ou a senha — não a conexão.';
  }

  const linhas = resultados.map(r=>
    `<div class="teste-linha ${r.ok?'passou':'falhou'}">`
    + `<span class="teste-marca">${r.ok?'✓':'✕'}</span>`
    + `<span class="teste-nome">${esc(r.nome)}</span>`
    + `<span class="teste-detalhe">${esc(r.detalhe)} · ${r.ms}ms</span></div>`).join('');

  caixa.innerHTML = `<div class="teste-titulo">Teste de conexão</div>${linhas}`
    + `<div class="teste-conclusao">${esc(conclusao)}</div>`
    + `<div class="teste-rodape">${esc(api)} · ${esc(location.origin)} · `
    + `${new Date().toLocaleString('pt-BR')}</div>`;
}

/* Login contra o servidor.

   O setor NÃO é enviado nem escolhido: vem no token que o servidor assina, a
   partir do cadastro do operador. É o que fecha o furo de a permissão de
   setor ser decidida pelo cliente. */
async function entrarNoServidor(){
  const email = (document.getElementById('login-email').value || '').trim();
  const senha = document.getElementById('login-senha').value || '';
  const botao = document.getElementById('btn-entrar');

  if(!email || !senha){ mostrarErroLogin('Informe e-mail e senha.'); return; }
  if(typeof SuincoSharePoint === 'undefined'){
    mostrarErroLogin('Painel sem conexão configurada. Use "Entrar só neste aparelho".');
    return;
  }

  esconderErroLogin();
  botao.disabled = true;
  botao.textContent = 'Entrando…';

  try{
    const op = await SuincoSharePoint.login(email, senha);
    // O id vem junto para o painel saber distinguir "eu editei" de "outro
    // editou" — dois operadores podem ter o mesmo primeiro nome.
    DB.operador = { id: op.id, nome: op.nome, setor: op.setor, email: op.email, turno: detectarTurnoPorHora() };
    SuincoStore.save();

    // Limpa a senha do DOM assim que ela deixa de ser necessária. Terminal de
    // pátio é compartilhado, e campo preenchido é o tipo de coisa que o
    // próximo turno encontra.
    document.getElementById('login-senha').value = '';

    document.getElementById('modal-operador').classList.remove('open');
    atualizarHeaderOperador();
    aplicarPermissoesSetor();
    renderAll();
    notify(`Bem-vindo, ${op.nome}! Setor: ${op.setor}`, 'success');
  }catch(e){
    mostrarErroLogin(await explicarFalhaDeLogin(e));
  }finally{
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}
function confirmarOperador(){
  const nome = document.getElementById('login-nome').value.trim();
  if(!nome){ notify('Informe seu nome.','warn'); return; }
  DB.operador = {
    nome,
    setor: document.getElementById('login-setor').value,
    // Turno deixou de ser perguntado no login (pedido do gestor: menos
    // campos). Continua sendo gravado, agora derivado da hora — o histórico
    // precisa saber em que turno o registro aconteceu, e perguntar isso ao
    // operador nunca acrescentou informação que o relógio já não tivesse.
    turno: detectarTurnoPorHora()
  };
  SuincoStore.save();
  document.getElementById('modal-operador').classList.remove('open');
  atualizarHeaderOperador();
  aplicarPermissoesSetor();
  renderAll();
  notify(`Bem-vindo, ${nome}! Setor: ${DB.operador.setor}`, 'success');
}
function trocarUsuario(){
  DB.operador = null;
  SuincoStore.save();
  // Encerra a sessão no adaptador também. Sem isto o token continuaria
  // válido no aparelho e o próximo operador herdaria a sessão de quem saiu
  // — justamente o problema que terminal compartilhado cria.
  if(typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.sair){
    try{ SuincoSharePoint.sair(); }catch(e){ console.warn('[Suinco] sair:', e); }
  }
  atualizarHeaderOperador();
  abrirLogin();
}
function atualizarHeaderOperador(){
  const el = document.getElementById('operator-name');
  el.textContent = DB.operador ? `${DB.operador.nome} · ${DB.operador.setor}` : '—';
}
// Cada setor vê apenas as próprias abas (SETOR_PERMISSOES em data.js).
// Decisão confirmada pelo usuário: manter a ocultação, não liberar tudo.
// Para operar outro posto — cobertura de turno, por exemplo — usa-se
// "Trocar usuário" no cabeçalho e entra-se com o setor correspondente; o
// modal de login explica isso, para ninguém concluir que a tela não existe.
function aplicarPermissoesSetor(){
  if(!DB.operador) return;
  const doSetor = SETOR_PERMISSOES[DB.operador.setor] || [];
  document.querySelectorAll('.nav-tab').forEach(el=>{
    el.hidden = !doSetor.includes(el.dataset.tab);
  });
  if(!doSetor.includes(TAB_ATUAL)) irParaTab(doSetor[0] || 'torre');
  atualizarAvisoSetorAba();
}

// Abas onde o box "o que se faz aqui" aparece — pedido do usuário
// (08/08/2026): "que essas explicacoes... se apliquem somente aos
// setores portaria expedicao e faturamento relatorio, historico pois
// isso toma um puta espaco". Torre, Programação, Indicadores, Cadastros
// e Usuários perdem o box: são telas que já se explicam pelo próprio
// conteúdo (uma tabela, um formulário, um painel de números), diferente
// de Portaria/Expedição/Faturamento, onde a ação de status não é óbvia
// só olhando a tela.
const ABAS_COM_FUNCAO = new Set(['portaria', 'expedicao', 'faturamento', 'relatorios', 'historico']);

// Preenche, no topo de cada aba permitida, o box que explica a função dela.
function atualizarAvisoSetorAba(){
  document.querySelectorAll('.funcao-aba').forEach(box=>{
    const tab = box.dataset.tab;
    const info = TAB_FUNCAO[tab];
    if(!info || !ABAS_COM_FUNCAO.has(tab)){ box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML =
      `<div class="funcao-linha">` +
        `<span class="funcao-chip">${info.setor}</span>` +
        `<span class="funcao-oque"><strong>O que se faz aqui:</strong> ${info.oque}</span>` +
      `</div>` +
      `<div class="funcao-move"><strong>Efeito no status:</strong> ${info.move}</div>`;
  });
}

/* ---------- A senha de aba foi REMOVIDA ------------------------------
   Programação e Indicadores pediam uma senha fixa, escrita em texto puro
   no próprio arquivo e visível com Ctrl+U. Ela nasceu quando o painel não
   tinha login nenhum e era a única barreira existente.

   Hoje ela só atrapalha. Quem abre essas abas já entrou com e-mail e senha
   individuais, e o setor vem do token assinado pelo servidor: a Programação
   só aparece para quem tem direito a ela, e a API recusa a gravação de quem
   não tem — independentemente do que a tela mostre.

   Manter uma senha compartilhada ao lado disso tinha dois custos e nenhum
   ganho: atrasava quem tem direito de entrar, e ensinava a operação a
   digitar uma senha coletiva que qualquer um lê no código-fonte.

   As funções foram apagadas em vez de esvaziadas para que ninguém volte a
   chamá-las achando que protegem alguma coisa. */

/* ---------- navegação ---------- */
/* Gaveta de navegação do celular — pedido direto do usuário (08/08/2026):
   "ao inves de ser uma barra de rolagem pro lado... um atalho na
   esquerda que abre um menu". No desktop #nav continua barra horizontal
   sempre visível (ver @media em styles.css); estas duas funções só têm
   efeito visual abaixo do ponto de corte onde #nav vira gaveta. */
function alternarMenuMobile(){
  const nav = document.getElementById('nav');
  const aberto = nav.classList.toggle('nav-aberto');
  document.getElementById('menu-overlay').classList.toggle('visivel', aberto);
  document.getElementById('btn-menu').setAttribute('aria-expanded', aberto ? 'true' : 'false');
}
function fecharMenuMobile(){
  document.getElementById('nav').classList.remove('nav-aberto');
  document.getElementById('menu-overlay').classList.remove('visivel');
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
}
function abrirTab(tab){
  irParaTab(tab);
}
function irParaTab(tab){
  fecharMenuMobile();   // tocar num item da gaveta navega E fecha — não some sozinha
  document.querySelectorAll('.tab-page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el=>el.classList.remove('active'));
  const page = document.getElementById('tab-'+tab);
  const navBtn = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
  if(page) page.classList.add('active');
  if(navBtn) navBtn.classList.add('active');
  TAB_ATUAL = tab;
  atualizarAvisoSetorAba();
  renderTabAtual();
}
function renderTabAtual(){
  atualizarDatalists();
  switch(TAB_ATUAL){
    case 'torre': renderTorre(); renderVisaoPatio('torre'); break;
    case 'programacao': renderProgFila(); renderProgAguardando(); break;
    case 'portaria':
      renderPortariaProgramadas();
      renderPortariaPatio();
      renderVisaoPatio('portaria');
      { const el = document.getElementById('portaria-placa'); if(el) setTimeout(()=>el.focus(), 30); }
      break;
    case 'expedicao': renderExpedicao(); renderVisaoPatio('expedicao'); break;
    case 'faturamento': renderFaturamento(); renderVisaoPatio('faturamento'); break;
    case 'indicadores': renderIndicadores(); break;
    case 'cadastros': renderCadastros(); break;
    case 'historico':
      renderHistorico(); renderBuscaTimeline();
      // Se a carga aberta na timeline acabou de ser cancelada por aqui
      // mesmo, isto garante que a tela reflita o sumiço dela mesmo se a
      // busca ainda estiver vazia (sem isso o painel podia deixar a
      // timeline de uma carga já excluída na tela até o próximo F5).
      if(_timelineCargaAtual) renderTimelineCarga(_timelineCargaAtual);
      break;
    // A aba Relatórios é só de botões, mas o resumo do filtro tem que
    // refletir o estado atual do pátio — senão mostra a contagem de quando
    // a página abriu, que já mudou.
    case 'relatorios': atualizarResumoFiltroRelatorio(); break;
    case 'usuarios': renderUsuarios(); break;
  }
  // Depois de pintar, e não antes: os rótulos são derivados das células
  // que acabaram de ser criadas.
  prepararTabelasMobile();
}
function renderAll(){ renderTabAtual(); }

/* ---------- TORRE DE CONTROLE ---------- */
/* ====================================================================
   VISÃO DO PÁTIO — linha do tempo dentro da aba de cada setor
   ====================================================================

   Por que existe: quem opera um posto só (Portaria, Expedição,
   Faturamento) precisava trocar de aba para ver o pátio e voltar para
   agir. Duas abas para uma tarefa só, dezenas de vezes por turno.

   Por que em linha do tempo: a tabela de status dizia onde a carga está,
   mas não o que já aconteceu com ela. Numa fila de pátio, "está em
   Embarque Iniciado" vale menos do que "chegou 07:12, começou 09:40, e
   ainda não terminou" — a segunda leitura mostra onde o tempo foi embora.

   Uma função só alimenta as três abas. Duas cópias divergiriam na
   primeira correção feita com pressa, que foi exatamente o que aconteceu
   com o formulário de completar carga.
   ==================================================================== */

/* Marca de cada etapa para uma carga: quando passou, se é a etapa atual,
   ou se ainda não chegou lá. */
function etapasDaCarga(carga){
  const eventos = historicoDaCarga(carga.id);
  const atual = STATUS_FLOW.indexOf(carga.status);
  return STATUS_FLOW.map((status, i)=>{
    const ev = eventos.find(m=>m.statusNovo===status);
    // A primeira etapa não gera movimentação: a carga NASCE nela. Sem este
    // caso, "Aguardando Veículo" apareceria como pendente numa carga que
    // já andou metade do fluxo.
    const quando = ev ? ev.timestamp : (i===0 ? carga.criadoEm : null);
    return {
      status,
      quando,
      cumprida: i < atual,
      atual: i === atual,
      pendente: i > atual,
      operador: ev ? ev.operador : (i===0 ? (carga.criadoPor||'') : ''),
    };
  });
}

function celulaEtapa(e){
  if(e.atual)    return `<td class="et et-atual" title="${esc(e.status)} — agora">
                           <span class="et-marca">●</span>
                           <span class="et-hora">${e.quando ? fmtHora(e.quando) : 'agora'}</span></td>`;
  if(e.cumprida) return `<td class="et et-ok" title="${esc(e.status)}${e.operador?' — '+esc(e.operador):''}">
                           <span class="et-marca">✓</span>
                           <span class="et-hora">${e.quando ? fmtHora(e.quando) : '—'}</span></td>`;
  return `<td class="et et-pendente" title="${esc(e.status)} — ainda não"><span class="et-marca">·</span></td>`;
}

/* Linha do tempo COMPACTA — uma célula só, não seis.
   Pedido do usuário (08/08/2026, depois de reportar que a Visão do Pátio
   "não aparece mais" no celular): as seis colunas de etapa (uma por
   status) empilhavam em seis blocos rótulo+valor no cartão mobile —
   ~250-300px só para a sequência de status de UMA carga, empurrando o
   resto da lista tela abaixo. As seis etapas SÃO uma sequência por
   natureza (é literalmente "a carga passou por aqui, está aqui agora,
   ainda não chegou aqui"); o pedido foi "de forma mais compacta... usando
   sequência e organização" — junta as seis num só selo horizontal, na
   ordem em que acontecem, em vez de seis campos empilhados.
   Mesma marca (●/✓/·) e o mesmo `title` com o nome completo do status de
   antes — nada de informação depende só da cor (acessibilidade já
   estabelecida no restante do painel). */
function linhaDoTempoCompacta(etapas){
  const passos = etapas.map(e=>{
    const classe = e.atual ? 'et-mini-atual' : e.cumprida ? 'et-mini-ok' : 'et-mini-pendente';
    const marca = e.atual ? '●' : e.cumprida ? '✓' : '·';
    const titulo = e.atual ? `${e.status} — agora`
      : e.cumprida ? `${e.status}${e.operador ? ' — '+e.operador : ''}`
      : `${e.status} — ainda não`;
    const hora = e.atual ? (e.quando ? fmtHora(e.quando) : '') : (e.cumprida && e.quando ? fmtHora(e.quando) : '');
    return `<span class="et-mini ${classe}" title="${esc(titulo)}"><b>${marca}</b>${hora ? `<i>${esc(hora)}</i>` : ''}</span>`;
  }).join('');
  return `<td class="et-linha" data-rotulo="Linha do tempo">${passos}</td>`;
}

/* Quem pode tirar uma carga do pátio.

   O mesmo setor que programa é o que cancela — e é ele que responde por
   isso. Portaria, Expedição e Faturamento veem a coluna? Não: para eles a
   carga travada é problema a relatar, não a resolver sozinho. */
function podeCancelarCarga(){
  const setor = (DB.operador||{}).setor;
  return setor === 'Logística' || setor === 'Administração';
}

/* Fechamento de Programação — pedido do usuário (08/08/2026): "permitir
   que faça fechamento da programação e começar nova programação somente
   pela logística ou administração, resetando os painéis de todos os
   setores mantendo somente o histórico". A mesma regra de quem pode
   cancelar carga (Logística/Administração) vale aqui — o servidor confere
   de novo (POST /api/programacao/fechar), isto é só a tela. */
function podeFecharProgramacao(){ return podeCancelarCarga(); }

async function fecharProgramacaoUI(senhaJaInformada){
  if(!SuincoSharePoint || !SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()){
    notify('Fechar a programação exige conexão com o servidor.', 'warn');
    return;
  }
  if(senhaJaInformada === undefined
     && !confirm('Fechar a programação atual e começar uma nova?\n\nNada é apagado: as cargas ficam arquivadas na programação atual e continuam no Histórico.')) return;
  try{
    const r = await SuincoSharePoint.fecharPrograma(senhaJaInformada);
    notify(r.forcado
      ? `Programação fechada às ${fmtHora(r.quando)} com ${r.emAberto} carga(s) ainda em aberto — elas seguem visíveis na Torre.`
      : `Programação fechada às ${fmtHora(r.quando)}. Pronto para uma nova.`,
      r.forcado ? 'warn' : 'success', 7000);
    renderAll();
  }catch(e){
    const cod = e && e.codigo;

    /* Carga em aberto não bloqueia mais — pede a senha de fechamento
       (mudança pedida pelo usuário em 11/08/2026). Antes de pedir a senha,
       mostra QUAIS cargas ficarão em aberto: quem vai digitar a senha
       precisa saber o que está assumindo, senão a senha vira carimbo. */
    if(cod === 'SENHA_NECESSARIA'){
      const cargas = (e.dados && e.dados.cargas) || [];
      const lista = cargas.map(c => `• ${c.placa} — ${c.numeroCarga || 'sem nº'} (${c.status})`).join('\n');
      const senha = prompt(
        `${cargas.length} carga(s) ainda em andamento:\n\n${lista}\n\n`
        + 'Elas NÃO serão apagadas: continuam aparecendo na Torre de Controle, '
        + 'com a data em que foram programadas, e ficam arquivadas nesta programação.\n\n'
        + 'Digite a senha de fechamento para encerrar mesmo assim:');
      if(senha === null) return;                   // desistiu
      if(!senha.trim()){ notify('Fechamento cancelado — senha não informada.', 'warn'); return; }
      return fecharProgramacaoUI(senha);
    }
    if(cod === 'SENHA_INCORRETA'){
      notify('Senha de fechamento incorreta. A programação NÃO foi fechada.', 'danger', 7000);
      return;
    }
    if(cod === 'SENHA_NAO_CONFIGURADA'){
      alert('Há carga em andamento e a senha de fechamento ainda não foi configurada no servidor.\n\n'
            + 'Peça à TI para preencher SENHA_FECHAMENTO no .env do servidor.');
      return;
    }
    if(e && e.status === 403){
      notify('Só Logística ou Administração fecham a programação.', 'danger');
      return;
    }
    notify('Não consegui fechar a programação: ' + (e && e.message || 'erro desconhecido'), 'danger');
  }
}

/* O botão muda de nome conforme a etapa, porque as duas ações são
   diferentes de verdade: excluir some com algo que nunca aconteceu;
   cancelar encerra algo que começou, e por isso pede motivo. */
function botaoCancelarHtml(c){
  /* Carga em "Seguiu Viagem" tem proteção a mais (pede confirmação
     digitando a placa, ver excluirCargaSeguiuViagemUI) — mas não é mais
     intocável. Pedido direto do usuário (08/08/2026): dado de teste que
     passou pelo fluxo inteiro (ex.: DJF8527) ficava preso na Torre pra
     sempre, sem nenhuma ação disponível pra tirar de lá. */
  if(c.status === 'Seguiu Viagem'){
    return `<button class="btn btn-danger btn-sm" onclick="excluirCargaSeguiuViagemUI('${escJs(c.id)}')"
              title="Excluir mesmo já tendo seguido viagem — pede confirmação, some do histórico/relatórios.">Excluir</button>`;
  }
  const cancelar = c.status !== 'Aguardando Veículo';
  return `<button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${escJs(c.id)}')"
            title="${cancelar ? 'Cancelar esta carga (pede motivo e fica no log)'
                              : 'Excluir esta carga programada'}">`
       + (cancelar ? 'Cancelar' : 'Excluir') + '</button>';
}

function limparPeriodoVisaoPatio(prefixo){
  ['de','ate','busca'].forEach(campo=>{
    const el = document.getElementById(`${prefixo}-vp-${campo}`);
    if(el) el.value = '';
  });
  renderVisaoPatio(prefixo);
}

function renderVisaoPatio(prefixo){
  const tbody = document.getElementById(`${prefixo}-vp-tbody`);
  if(!tbody) return;                       // aba sem a visão (Logística usa a Torre)

  const de     = (document.getElementById(`${prefixo}-vp-de`)   || {}).value || '';
  const ate    = (document.getElementById(`${prefixo}-vp-ate`)  || {}).value || '';
  const buscaEl= document.getElementById(`${prefixo}-vp-busca`);
  const busca  = normalizarPlaca(buscaEl ? buscaEl.value : '');
  const textoBusca = (buscaEl ? buscaEl.value : '').trim().toLowerCase();

  /* Sem período escolhido, mostra o pátio de agora — as cargas em aberto.
     Com período, mostra tudo daquele intervalo, inclusive o que já seguiu
     viagem: é justamente para revisitar carga encerrada que o filtro
     existe. */
  const houvePeriodo = !!(de || ate);
  let lista = houvePeriodo
    ? filtrarPorDataProgramacao(DB.cargas, de, ate)
    : DB.cargas.filter(c=>c.status !== 'Seguiu Viagem');

  if(textoBusca){
    lista = lista.filter(c =>
      normalizarPlaca(c.placa).includes(busca) ||
      String(c.numeroCarga||'').toLowerCase().includes(textoBusca));
  }

  lista = lista.slice().sort(ordenarPorSequenciaEAtualizacao);

  /* Sem período, `lista` já é só o pátio aberto agora — naturalmente
     pequeno. COM período (pedido para "revisitar carga encerrada", ver
     comentário acima), não tinha limite NENHUM — a mesma classe de bug
     achada e corrigida na Frota e no Histórico (auditoria "refinamento em
     TODAS AS ABAS", 08/08/2026): um período de meses reais de operação
     vira centenas de linhas, e no celular (cartão de 2 colunas) isso é
     rolagem de dezenas de milhares de pixels — medido: 400 cargas =
     188.217px de altura de página. Esta função alimenta Torre, Portaria,
     Expedição e Faturamento — a correção vale pras quatro de uma vez. */
  const mobile = window.matchMedia && window.matchMedia('(max-width:560px)').matches;
  const LIMITE = mobile ? 40 : 300;
  const listaCompleta = lista;
  lista = lista.slice(0, LIMITE);

  const thead = document.getElementById(`${prefixo}-vp-thead`);
  if(thead){
    thead.innerHTML =
      '<th class="vp-carga">Nº Carga</th><th class="vp-placa">Placa</th>'
      + '<th class="vp-transp">Transportadora</th><th class="vp-rota">Rota</th>'
      + '<th class="et-cab-linha">Linha do tempo</th>'
      + '<th class="vp-tempo">No pátio</th>';
    /* SEM coluna de Ação aqui, e é decisão de operação, não de espaço.

       A Visão do Pátio aparece nas abas de Portaria, Expedição e
       Faturamento. Excluir e cancelar carga é da Programação — só ela sabe
       se aquela carga foi desmarcada pelo cliente ou se está só atrasada, e
       o servidor recusa a exclusão vinda de qualquer outro setor
       (podeCriarCarga, em rotas/cargas.js).

       Enquanto o botão aparecia para quem tem permissão de Logística, ele
       aparecia TAMBÉM quando essa pessoa estava olhando a aba da Expedição
       — a ação certa no lugar errado. Aqui a visão é de leitura: o setor
       acompanha o pátio e age pelo botão da própria etapa. */
  }

  tbody.innerHTML = lista.map(c=>{
    const etapas = etapasDaCarga(c);
    return `<tr class="linha-status-${esc((STATUS_META[c.status]||{}).cor || '')}">
      <td class="vp-carga">${esc(c.numeroCarga)||'—'}</td>
      <td class="vp-placa">${esc(c.placa)}${marcaCargaDaPlaca(c, lista)}</td>
      <td class="vp-transp">${esc(c.transportadora)||'—'}</td>
      <td class="vp-rota">${esc(rotaCurta(c.rota))}</td>
      ${linhaDoTempoCompacta(etapas)}
      <td class="vp-tempo">${tempoNoPatioTexto(c)}</td>
    </tr>`;
  }).join('');

  /* Estado vazio que oferece a saída.

     Filtro que não encontrou nada e só diz "nenhuma carga" deixa o operador
     preso: ele não sabe se o pátio está vazio ou se o filtro é que está
     estreito. Aqui a mensagem diz qual é o caso e, quando há filtro, traz o
     botão que o limpa. */
  const vazio = document.getElementById(`${prefixo}-vp-empty`);
  vazio.hidden = listaCompleta.length > 0;
  if(!vazio.hidden){
    const filtrando = houvePeriodo || !!textoBusca;
    vazio.innerHTML = filtrando
      ? 'Nenhuma carga encontrada com esse filtro.'
        + `<span class="empty-acao"><button class="btn btn-sec btn-sm" onclick="limparPeriodoVisaoPatio('${prefixo}')">Ver o pátio de agora</button></span>`
      : 'Nenhuma carga em aberto no pátio neste momento.';
  }

  const resumo = document.getElementById(`${prefixo}-vp-resumo`);
  if(resumo){
    // Contagem e distribuição por status usam a lista COMPLETA (antes do
    // corte de exibição) — o resumo tem que responder pela busca inteira,
    // mesmo quando a tabela abaixo mostra só as primeiras LIMITE linhas.
    const porStatus = STATUS_FLOW.map(st=>({
      status: st, n: listaCompleta.filter(c=>c.status===st).length
    })).filter(x=>x.n > 0);
    resumo.innerHTML =
      `<span class="vp-total">${listaCompleta.length} carga(s)</span>`
      + (houvePeriodo ? '<span class="vp-periodo">no período escolhido</span>'
                      : '<span class="vp-periodo">em aberto agora</span>')
      + porStatus.map(x=>`<span class="vp-chip badge ${esc((STATUS_META[x.status]||{}).badge||'')}">${esc(x.status)}: <b>${x.n}</b></span>`).join('')
      + (listaCompleta.length > LIMITE
          ? `<span class="vp-periodo">— mostrando as ${LIMITE} mais recentes; refine o período ou a busca pra ver outras</span>`
          : '');
  }
}

/* Rótulo curto para o cabeçalho das seis colunas de etapa. O nome inteiro
   não cabe, e cortar no meio ("Aguardando Emb…") é pior que abreviar com
   critério — o título completo continua no `title` de cada coluna. */
function abreviarEtapa(status){
  return ({
    'Aguardando Veículo':  'Programada',
    'Aguardando Embarque': 'Chegou',
    'Embarque Iniciado':   'Iniciou',
    'Embarque Finalizado': 'Finalizou',
    'Faturado':            'Faturou',
    'Seguiu Viagem':       'Saiu',
  })[status] || status;
}

/* Há quanto tempo a carga está no pátio. Conta da CHEGADA, não da
   programação: carga programada na véspera não passou a noite no pátio, e
   contar assim inflaria o número que o gestor usa para cobrar. */
function tempoNoPatioTexto(carga){
  const chegada = primeiroTimestamp(carga.id, 'Aguardando Embarque');
  if(!chegada) return '<span class="text-dim">—</span>';
  const saida = primeiroTimestamp(carga.id, 'Seguiu Viagem');
  const fim = saida ? new Date(saida) : new Date();
  const min = Math.max(0, Math.round((fim - new Date(chegada)) / 60000));
  const h = Math.floor(min/60), m = min%60;
  const texto = h ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`;
  // Acima da meta, destaca. É o número que faz alguém levantar da cadeira.
  const acima = !saida && min > META_TEMPO_PATIO_MIN;
  return acima ? `<b class="vp-atrasado">${texto}</b>` : texto;
}

function fmtHora(iso){
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}

/* Contagem crescente nos números da Torre de Controle — só quando o valor
   MUDA de um render pro outro, nunca na primeira pintura da tela nem em
   re-render sem mudança real (a Torre redesenha a cada sincronia, a cada
   ~15s; animar todo redesenho seria decoração, não informação — a mesma
   distinção que a esteira de UX chama de "motion precisa comunicar algo").

   Guardado por RÓTULO (não pelo nó do DOM, que é recriado a cada render
   via innerHTML) — funciona porque os rótulos das caixas da Torre são
   fixos ("Cargas em aberto", os 5 nomes de status etc.). */
let _ultimoValorTorre = {};
/* Filtro por clique nas caixas da Torre — pedido do usuário (08/08/2026):
   "clique nos quadrados... aguardando embarque, aguardando veiculo... e
   faça um filtro instantâneo apontando pra aquelas cargas de cada
   status". null = sem filtro (mostra as cargas em aberto, comportamento
   de sempre). Duas chaves especiais além dos 6 nomes de status reais:
   '__SEGUIU_HOJE__' (a caixa "Seguiu Viagem hoje" não é um status
   presente em cargasAbertas()) e '__AGUARDANDO_CARGA__' (a flag
   aguardandoCarga, não um valor de status). */
let _torreFiltroStatus = null;
function filtrarTorrePorStatus(chave){
  _torreFiltroStatus = (chave === '__TODAS__' || _torreFiltroStatus === chave) ? null : chave;
  renderTorre();
}
function animarContadoresTorre(){
  const reduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('#torre-stats [data-contador]').forEach(el=>{
    const chave = el.dataset.contador;
    const alvo = Number(el.textContent);
    if(!Number.isFinite(alvo)) return; // nunca deveria acontecer aqui, mas não trava se acontecer
    const anterior = _ultimoValorTorre[chave];
    _ultimoValorTorre[chave] = alvo;
    if(reduzido || anterior === undefined || anterior === alvo){
      el.textContent = alvo; // primeira pintura ou sem mudança: direto, sem show
      return;
    }
    const inicio = anterior, duracao = 500, t0 = performance.now();
    const passo = (agora)=>{
      const p = Math.min(1, (agora - t0) / duracao);
      // ease-out: rápido no começo, assenta no fim — número que "acelera"
      // no meio do pátio parece erro de leitura, não destaque.
      const suavizado = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(inicio + (alvo - inicio) * suavizado);
      if(p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}

function renderTorre(){
  const btnFechar = document.getElementById('btn-fechar-programacao-wrap');
  if(btnFechar) btnFechar.hidden = !podeFecharProgramacao();

  const abertas = cargasAbertas();
  const porStatus = {};
  abertas.forEach(c=>{ porStatus[c.status] = (porStatus[c.status]||0) + 1; });
  // "Aguardando Carga" não é mais um valor de status — é a flag
  // `aguardandoCarga` (o texto fica no campo Número da Carga). Mostrado
  // como uma caixa extra informativa, não como um dos 6 status oficiais.
  const statusVisiveis = STATUS_FLOW.slice(0,-1); // sem "Seguiu Viagem" (não fica em aberto)
  const aguardandoCargaCount = abertas.filter(c=>c.aguardandoCarga).length;
  /* "Quantos já seguiram viagem" — pedido direto do usuário (08/08/2026):
     "na torre de controle nao aparece quantos seguiram viagem". Fica de
     fora de `abertas` de propósito (Seguiu Viagem não é mais pátio em
     aberto), então precisa de conta própria. Contado por HOJE, não
     total histórico — DB.cargas guarda tudo desde sempre, e "quantos
     saíram" só responde a pergunta de acompanhamento do dia se for do
     dia. Usa o instante real da saída (primeiroTimestamp), não a data de
     criação da carga: um caminhão programado ontem que só saiu hoje
     conta em hoje. */
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const seguiuViagemHojeCount = DB.cargas.filter(c=>{
    if(c.status !== 'Seguiu Viagem') return false;
    const saida = primeiroTimestamp(c.id, 'Seguiu Viagem');
    return saida && new Date(saida) >= hoje;
  }).length;
  /* Hierarquia visual, não grade uniforme.

     Antes as seis caixas tinham exatamente o mesmo peso, e isso não é
     verdade no pátio: carga parada além da meta é o que faz alguém
     levantar da cadeira; "Faturado" é informação de acompanhamento. Grade
     igual obriga o olho a ler as seis para achar a que importa.

     A conta é a mesma de sempre — só o tamanho da caixa muda. */

  const caixa = (num, rotulo, {destaque=false, alerta=false, nota='', filtro=null} = {}) => {
    const ehLimpar = filtro === '__TODAS__';
    const ativo = filtro !== null && (ehLimpar ? _torreFiltroStatus === null : _torreFiltroStatus === filtro);
    const clicavel = filtro !== null;
    // No celular a nota some da grade compacta (.stat-note{display:none} —
    // ver styles.css) pra caber em três colunas; o title garante que a
    // informação continua acessível, só muda de "sempre visível" pra
    // "sob demanda", como o próprio aviso de clique já era.
    const dicaClique = 'Clique para filtrar a tabela por esta caixa — clique de novo para limpar.';
    const titulo = [nota, clicavel ? dicaClique : ''].filter(Boolean).join(' — ');
    return `<div class="stat-box${destaque?' stat-destaque':''}${alerta && num>0?' stat-alerta':''}${clicavel?' stat-clicavel':''}${ativo?' stat-ativo':''}"
       ${clicavel ? `onclick="filtrarTorrePorStatus('${escJs(filtro)}')"` : ''}
       ${titulo ? `title="${esc(titulo)}"` : ''}>
       <div class="stat-num" data-contador="${esc(rotulo)}">${num}</div>
       <div class="stat-label">${esc(rotulo)}</div>
       ${nota ? `<div class="stat-note">${esc(nota)}</div>` : ''}
     </div>`;
  };

  document.getElementById('torre-stats').innerHTML =
    // "Paradas há mais de Xh" foi removida a pedido do usuário
    // (08/08/2026): ícone considerado inútil na Torre.
    caixa(abertas.length, 'Cargas em aberto', {destaque:true, filtro:'__TODAS__'})
    + statusVisiveis.map(s=>caixa(porStatus[s]||0, s, {filtro:s})).join('')
    + caixa(seguiuViagemHojeCount, 'Seguiu Viagem hoje', {destaque:true, filtro:'__SEGUIU_HOJE__'})
    + caixa(aguardandoCargaCount, 'Aguardando Carga',
            {nota:'dados incompletos', filtro:'__AGUARDANDO_CARGA__'});
  animarContadoresTorre();

  // A tabela mostra as cargas do filtro clicado — ou as em aberto de
  // sempre, sem filtro nenhum. Os NÚMEROS das caixas acima nunca mudam
  // com o clique (continuam contando o total real de cada status); só a
  // lista abaixo é que aponta pras cargas daquele status específico.
  let lista;
  if(_torreFiltroStatus === '__SEGUIU_HOJE__'){
    lista = DB.cargas.filter(c=>{
      if(c.status !== 'Seguiu Viagem') return false;
      const saida = primeiroTimestamp(c.id, 'Seguiu Viagem');
      return saida && new Date(saida) >= hoje;
    });
  } else if(_torreFiltroStatus === '__AGUARDANDO_CARGA__'){
    lista = abertas.filter(c=>c.aguardandoCarga);
  } else if(_torreFiltroStatus){
    lista = abertas.filter(c=>c.status === _torreFiltroStatus);
  } else {
    lista = abertas;
  }
  lista = lista.slice().sort(ordenarPorSequenciaEAtualizacao);

  const thead = document.getElementById('torre-thead');
  if(thead){
    thead.innerHTML =
      '<th>Seq.</th><th>Nº Carga</th><th>Placa</th><th>Transportadora</th>'
      + '<th>Tipo Veículo</th><th>Motorista</th><th>Rota</th><th>Peso (kg)</th>'
      + '<th>Palet.</th><th>Tipo de Operação</th><th>Ganchos</th><th>Status</th>'
      + '<th>Programada em</th><th>Atualizado em</th>'
      + (podeCancelarCarga() ? '<th class="no-print">Ação</th>' : '');
  }

  const tbody = document.getElementById('torre-tbody');
  // Torre editável (pedido direto do usuário, 08/08/2026): "eu quero
  // conseguir excluir ou alterar qualquer coisa direto da torre de
  // controle como administrador ou logistica". Reaproveita EXATAMENTE as
  // mesmas funções já testadas da Fila de Programados (atualizarXUI) —
  // não é lógica nova, é o mesmo campo editável aparecendo num segundo
  // lugar. Só quem já podia cancelar/excluir (Logística/Administração)
  // ganha os campos editáveis; os demais setores continuam com texto.
  const editavel = podeCancelarCarga();
  tbody.innerHTML = lista.map(c=>`
    <tr>
      <td>${editavel
        ? `<input type="number" class="seq-input" value="${c.sequencia ?? ''}" onchange="atualizarSequenciaUI('${escJs(c.id)}',this.value)" title="Sequência livre.">`
        : (c.sequencia ?? '—')}</td>
      <td class="col-identificacao">${editavel
        ? `<input type="text" class="numero-carga-input" value="${esc(c.numeroCarga)}" onchange="atualizarNumeroCargaUI('${escJs(c.id)}',this.value)" title="Alterar o número desta carga.">`
        : (esc(c.numeroCarga)||'—')}</td>
      <td class="col-identificacao">${editavel
        ? `<input type="text" class="placa-input" value="${esc(c.placa)}" onchange="atualizarPlacaUI('${escJs(c.id)}',this.value)" title="Trocar a placa.">`
        : esc(c.placa)}</td>
      <td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${editavel
        ? `<input type="text" class="motorista-input" value="${esc(c.motorista||'')}" onchange="atualizarMotoristaUI('${escJs(c.id)}',this.value)" title="Trocar o motorista desta carga.">`
        : (esc(c.motorista)||'—')}</td>
      <td>${editavel ? rotaSelectHtml(c) : esc(rotaCurta(c.rota))}</td>
      <td class="c-peso">${editavel
        ? `<input type="number" class="peso-input" min="0" step="1" value="${c.peso ?? ''}" onchange="atualizarPesoUI('${escJs(c.id)}',this.value)" title="Peso em kg.">`
        : (c.peso ? c.peso.toLocaleString('pt-BR') : '—')}</td>
      <td>${editavel ? paletizadaSelectHtml(c) : paletizadaDaCarga(c)}</td>
      <td>${editavel ? praOndeSelectHtml(c)
        : (c.praOnde ? `<span class="chip-praonde">${esc(PRA_ONDE_LABEL[c.praOnde]||c.praOnde)}</span>` : '<span class="text-dim">—</span>')}</td>
      <td>${editavel
        ? `<input type="number" class="ganchos-input" min="0" step="1" value="${c.qtdGanchos ?? 0}" onchange="atualizarGanchosUI('${escJs(c.id)}',this.value)" title="0 = Liso">`
        : (c.qtdGanchos ? c.qtdGanchos : '<span class="text-dim">Liso</span>')}</td>
      <td>${badgeHtml(c.status)}</td>
      <td>${dataProgramacaoHtml(c)}</td>
      <td>${fmtDataHora(c.atualizadoEm)}</td>
      ${editavel ? `<td class="no-print">${botaoCancelarHtml(c)}</td>` : ''}
    </tr>`).join('');
  const vazio = document.getElementById('torre-empty');
  vazio.hidden = lista.length>0;
  if(!vazio.hidden){
    vazio.innerHTML = _torreFiltroStatus
      ? 'Nenhuma carga com esse status agora.'
        + '<span class="empty-acao"><button class="btn btn-sec btn-sm" onclick="filtrarTorrePorStatus(\'__TODAS__\')">Ver todas em aberto</button></span>'
      : 'Nenhuma carga em aberto no momento.';
  }
}
function ordenarPorSequenciaEAtualizacao(a,b){
  const sa = (a.sequencia===null||a.sequencia===undefined) ? Infinity : a.sequencia;
  const sb = (b.sequencia===null||b.sequencia===undefined) ? Infinity : b.sequencia;
  if(sa!==sb) return sa-sb;
  return new Date(a.atualizadoEm) - new Date(b.atualizadoEm);
}

/* Ordenação do RELATÓRIO OPERACIONAL: primeiro pela etapa da carga na linha
   do tempo dos 6 status, depois pela sequência de carregamento.

   Antes ordenava só por sequência, e o resultado embaralhava as etapas — uma
   carga que já "Seguiu Viagem" aparecia acima de outra ainda "Faturado" ou
   "Carregado" só por ter sequência menor. Como este relatório é acompanhado
   ao longo do dia inteiro, o que importa na leitura de relance é onde cada
   carga está no processo.

   A ordem segue a própria linha do tempo: o que ainda não chegou fica no
   topo, o que já saiu fica no fim. Assim a parte que ainda exige ação está
   sempre na parte de cima da folha. */
function ordenarPorEtapaDaTimeline(a,b){
  const ia = STATUS_FLOW.indexOf(a.status);
  const ib = STATUS_FLOW.indexOf(b.status);
  // Status desconhecido (dado antigo) vai para o fim, em vez de virar -1 e
  // subir para o topo por engano.
  const pa = ia === -1 ? STATUS_FLOW.length : ia;
  const pb = ib === -1 ? STATUS_FLOW.length : ib;
  if(pa !== pb) return pa - pb;
  return ordenarPorSequenciaEAtualizacao(a,b);
}

/* ---------- PROGRAMAÇÃO ---------- */
function atualizarPreviewFrotaPrograma(){
  const placa = document.getElementById('prog-placa').value;
  const f = buscarFrota(placa);
  const hint = document.getElementById('prog-frota-hint');
  if(f){
    document.getElementById('prog-transportadora').value = f.transportadora;
    document.getElementById('prog-tipoveiculo').value = f.tipoVeiculo;
    /* Motorista habitual da placa — pedido do usuário (11/08/2026): "DA
       MESMA FORMA QUE QUANDO O INPUT DA PLACA É FEITO, E ALTERA
       AUTOMATICAMENTE A TRANSPORTADORA, ALTERAR O NOME DO MOTORISTA CASO
       JA TENHA NOME CADASTRADO NA PLACA".

       Só preenche se o campo estiver VAZIO: se o operador já digitou um
       nome (motorista de folga, substituto, freteiro do dia), sobrescrever
       apagaria o que ele acabou de informar — e o motorista real daquela
       viagem importa mais que o habitual do cadastro. */
    const elMot = document.getElementById('prog-motorista');
    if(elMot && !elMot.value.trim() && f.motorista) elMot.value = f.motorista;
    const oQue = f.motorista
      ? 'Transportadora, Tipo de Veículo e Motorista preenchidos'
      : 'Transportadora e Tipo de Veículo preenchidos';
    hint.innerHTML = `<span class="text-dim">✅ Placa encontrada na Frota — ${oQue} automaticamente.</span>`
                   + avisoPlacaJaProgramada(placa);
  } else if(normalizarPlaca(placa)){
    // Cadastrar sem sair da tela: antes disso, o único caminho era ir em
    // Cadastros → Frota, perder o que já estava digitado aqui, cadastrar,
    // voltar e preencher tudo de novo — no pátio, com o caminhão esperando,
    // isso é tempo que ninguém tem. Reaproveita Transportadora/Tipo de
    // Veículo que o operador já digitou nesta mesma tela.
    hint.innerHTML = '<span style="color:var(--wine-light)">⛔ Placa não cadastrada na Frota — a criação da carga será BLOQUEADA.</span>'
      + '<div class="gap8" style="margin-top:6px">'
      + '<button type="button" class="btn btn-sec btn-sm" onclick="cadastrarPlacaInlineUI()">➕ Cadastrar esta placa na Frota agora</button>'
      + '</div>';
  } else {
    hint.innerHTML = '';
  }
}

/* Cadastra a placa na Frota sem sair da tela de Programação, usando o que
   o operador já digitou em Transportadora/Tipo de Veículo — e sem esperar
   confirmação do servidor pra liberar o próximo passo, porque
   upsertFrota() já dispara a sincronia real em segundo plano (corrigido em
   07/08/2026: antes o cadastro pela tela nunca chegava ao servidor —
   ver comentário em upsertFrota, data.js). Se o servidor recusar, o aviso
   de aoRecusarFrota chega do mesmo jeito, sozinho, poucos segundos depois. */
function cadastrarPlacaInlineUI(){
  const placa = document.getElementById('prog-placa').value;
  const transportadora = document.getElementById('prog-transportadora').value.trim();
  const tipoVeiculo = document.getElementById('prog-tipoveiculo').value.trim();
  if(!normalizarPlaca(placa)){ notify('Informe a placa antes de cadastrar.', 'warn'); return; }
  if(!transportadora || !tipoVeiculo){
    notify('Preencha Transportadora e Tipo de Veículo para cadastrar a placa.', 'warn');
    return;
  }
  upsertFrota(placa, transportadora, tipoVeiculo, {});
  notify(`Placa ${normalizarPlaca(placa)} cadastrada na Frota. Pode criar a carga agora.`, 'success');
  atualizarPreviewFrotaPrograma();
}

/* Aviso de placa que já tem carga em aberto.

   Um caminhão levar duas cargas é raro, mas acontece — e o sistema sempre
   permitiu, porque a Portaria já trata a chegada da placa aplicando o
   "Chegou" a todas as cargas dela de uma vez.

   O problema nunca foi permitir: foi não DIZER. Digitar a mesma placa duas
   vezes parece igual nos dois casos — o dia em que são de fato duas cargas
   e o dia em que alguém programou em duplicidade sem perceber. Sem aviso,
   o segundo caso só aparece na doca.

   Por isso avisa e NÃO bloqueia. Bloquear resolveria o engano e quebraria
   o caso legítimo; avisar resolve o engano e deixa o caso legítimo passar
   com um clique. Quem sabe o que está fazendo lê e segue. */
function avisoPlacaJaProgramada(placa){
  const p = normalizarPlaca(placa);
  if(!p) return '';
  const abertas = cargasAbertasPorPlaca(p);
  if(!abertas.length) return '';

  const numeros = abertas
    .map(c => c.aguardandoCarga ? 'sem número ainda' : (c.numeroCarga || 'sem número'))
    .join(' · ');

  return `<div class="aviso-placa-repetida">
      <strong>${p} já tem ${abertas.length} carga${abertas.length>1?'s':''} em aberto</strong>
      (${esc(numeros)}).
      Criar mais uma é permitido — é o mesmo caminhão levando duas cargas.
      Se não for isso, confira antes: pode ser programação em duplicidade.
    </div>`;
}
/* Placa liberada para receber uma SEGUNDA carga nesta programação, por
   escolha explícita do operador (botão "➕ Outra carga"). Vale para uma
   criação só: some assim que a carga é criada, para não deixar a porta
   aberta sem querer. */
let _placaMultiCargaAutorizada = null;

function criarCargaProgramadaUI(){
  const placa = document.getElementById('prog-placa').value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }

  /* Duplicidade de placa na mesma programação — pedido do usuário
     (11/08/2026): "IMPEDIR DUPLICIDADE DE PLACAS DENTRO DA MESMA
     PROGRAMACAO DE EMBARQUE SOMENTE APÓS O VEICULO SAIR E RETORNAR PARA
     NOVO INPUT".

     A trava é sobre o ACIDENTE, não sobre o caso real de um caminhão
     levar duas cargas: quem quiser a segunda carga usa "➕ Outra carga"
     na linha da placa, que é uma decisão consciente e já herda os dados
     do veículo. Depois que o caminhão sai (Seguiu Viagem), a placa fica
     livre de novo sem precisar de nada. */
  const pNorm = normalizarPlaca(placa);
  const abertas = cargasAbertasPorPlaca(pNorm);
  if(abertas.length && _placaMultiCargaAutorizada !== pNorm){
    const numeros = abertas
      .map(c => c.aguardandoCarga ? 'sem número ainda' : (c.numeroCarga || 'sem número'))
      .join(', ');
    notify(
      `${pNorm} já está nesta programação (${numeros}) e ainda não seguiu viagem. `
      + 'Para lançar outra carga no mesmo caminhão, use "➕ Outra carga" na linha dela.',
      'warn', 9000);
    return;
  }

  try{
    criarCargaProgramada({
      placa,
      transportadora: document.getElementById('prog-transportadora').value,
      tipoVeiculo: document.getElementById('prog-tipoveiculo').value,
      motorista: document.getElementById('prog-motorista').value,
      numeroCarga: document.getElementById('prog-numero-carga').value,
      cliente: document.getElementById('prog-cliente').value,
      destino: document.getElementById('prog-destino').value,
      peso: document.getElementById('prog-peso').value,
      sequencia: document.getElementById('prog-sequencia').value,
      observacoes: document.getElementById('prog-obs').value,
      praOnde: document.getElementById('prog-praonde').value,
      rota: document.getElementById('prog-rota').value,
      paletizada: document.getElementById('prog-paletizada').value,
      qtdGanchos: document.getElementById('prog-ganchos').value,
      qtdEntregas: document.getElementById('prog-entregas').value,
      operador: nomeOperadorAtual()
    });
    _placaMultiCargaAutorizada = null;   // vale uma vez só
    notify(`Carga criada para a placa ${normalizarPlaca(placa)} — status Aguardando Veículo.`, 'success');
    ['prog-placa','prog-transportadora','prog-tipoveiculo','prog-motorista','prog-numero-carga','prog-cliente','prog-destino','prog-peso','prog-sequencia','prog-obs']
      .forEach(id=>document.getElementById(id).value='');
    document.getElementById('prog-praonde').value = PRA_ONDE_PADRAO;
  document.getElementById('prog-rota').value = '';
  document.getElementById('prog-paletizada').value = 'Não';
    document.getElementById('prog-ganchos').value = '0';
    document.getElementById('prog-entregas').value = '1';
    document.getElementById('prog-frota-hint').innerHTML = '';
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
function renderProgFila(){
  /* Só os programados DE HOJE — pedido do usuário (11/08/2026): "no campo
     fila de programados na programacao manter somente os programados NO
     DIA".

     A fila é a lista de trabalho do dia: carga programada ontem que
     ninguém encostou não é tarefa de hoje, é pendência a resolver na
     Torre (onde ela continua visível, com a data da programação à
     mostra). Misturar as duas coisas fazia a fila crescer sem parar e
     perder a função de "o que embarca hoje".

     A carga NÃO é escondida do sistema: continua na Torre de Controle, no
     Histórico e nos relatórios. Só sai desta fila específica. */
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const doDia = (c)=>{
    const base = c.criadoEm || c.atualizadoEm;
    if(!base) return true;   // sem data conhecida, melhor mostrar que sumir
    const d = new Date(base); d.setHours(0,0,0,0);
    return d.getTime() === hoje.getTime();
  };
  const todosAguardando = DB.cargas.filter(c=>c.status==='Aguardando Veículo');
  const lista = todosAguardando.filter(doDia).sort(ordenarPorSequenciaEAtualizacao);
  const deOutrosDias = todosAguardando.length - lista.length;

  document.getElementById('prog-fila-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td><input type="number" class="seq-input" value="${c.sequencia ?? ''}" onchange="atualizarSequenciaUI('${c.id}',this.value)" title="Sequência livre — digite o número que quiser, a qualquer momento."></td>
      <td class="col-identificacao">
        <input type="text" class="numero-carga-input" value="${esc(c.numeroCarga)}" onchange="atualizarNumeroCargaUI('${escJs(c.id)}',this.value)" title="Alterar o número desta carga.">
      </td>
      <td>
        <input type="text" class="placa-input" value="${esc(c.placa)}" onchange="atualizarPlacaUI('${escJs(c.id)}',this.value)" title="Trocar a placa — a transportadora e o tipo de veículo são buscados na Frota automaticamente.">
        ${marcaCargaDaPlaca(c, lista)}
      </td>
      <td id="transp-${esc(c.id)}">${esc(c.transportadora)||'—'}</td>
      <td>${rotaSelectHtml(c)}</td>
      <td>${praOndeSelectHtml(c)}</td>
      <td class="c-peso"><input type="number" class="peso-input" min="0" step="1" value="${c.peso ?? ''}" onchange="atualizarPesoUI('${escJs(c.id)}',this.value)" title="Peso em kg."></td>
      <td>${paletizadaSelectHtml(c)}</td>
      <td><input type="number" class="ganchos-input" min="0" step="1" value="${c.qtdGanchos ?? 0}" onchange="atualizarGanchosUI('${c.id}',this.value)" title="0 = Liso"></td>
      <td><input type="number" class="entregas-input" min="0" step="1" value="${c.qtdEntregas ?? 1}" onchange="atualizarEntregasUI('${escJs(c.id)}',this.value)" title="Quantidade de entregas."></td>
      <td class="no-print gap8">
        <button class="btn btn-sec btn-sm" onclick="adicionarOutraCargaNaPlacaUI('${escJs(c.id)}')"
                title="Programar OUTRA carga para este mesmo caminhão — o formulário já vem com placa, transportadora, motorista e rota preenchidos.">➕ Outra carga</button>
        <button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${escJs(c.id)}')">Excluir</button>
      </td>
    </tr>`).join('');
  document.getElementById('prog-fila-empty').hidden = lista.length>0;

  // Some sem explicação é pior que não sumir: quem programou ontem
  // precisa saber PARA ONDE a carga foi, não descobrir que "sumiu".
  const aviso = document.getElementById('prog-fila-outros-dias');
  if(aviso){
    aviso.hidden = deOutrosDias === 0;
    aviso.textContent = deOutrosDias === 1
      ? '1 carga programada em outro dia continua aguardando veículo — veja na Torre de Controle.'
      : `${deOutrosDias} cargas programadas em outros dias continuam aguardando veículo — veja na Torre de Controle.`;
  }
}

/* Rota e Paletizada viram campo editável na fila — pedido do usuário
   (11/08/2026): "DEIXAR TODOS OS CAMPOS DE PLACA PROGRAMADA EDITAVEIS,
   PESO, ROTA, PALETIZADA, ENTREGAS". Mesmo padrão já usado em
   praOndeSelectHtml. */
function rotaSelectHtml(c){
  return `<select class="rota-inline" onchange="atualizarRotaUI('${escJs(c.id)}',this.value)">
    <option value="">—</option>
    ${ROTAS.map(r=>`<option value="${esc(r.codigo)}" ${c.rota===r.codigo?'selected':''}>${esc(rotaCurta(r.codigo))}</option>`).join('')}
  </select>`;
}
function paletizadaSelectHtml(c){
  const atual = paletizadaDaCarga(c);
  return `<select class="palet-inline" onchange="atualizarPaletizadaUI('${escJs(c.id)}',this.value)">
    ${['Não','Sim'].map(op=>`<option value="${op}" ${atual===op?'selected':''}>${op}</option>`).join('')}
  </select>`;
}
function atualizarRotaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.rota = val || '';
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarPaletizadaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.paletizada = val === 'Sim' ? 'Sim' : 'Não';
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarPesoUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.peso = val === '' ? null : Math.max(0, Number(val)||0);
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarEntregasUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.qtdEntregas = val === '' ? 1 : Math.max(0, Number(val)||0);
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarMotoristaUI(id, val){
  const c = getCarga(id); if(!c) return;
  /* Só a carga muda — o cadastro da placa na Frota fica como está. São
     coisas diferentes: aqui é quem dirige ESTA viagem (substituto, folga,
     freteiro), lá é o habitual do veículo. */
  c.motorista = String(val || '').trim();
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}

/* Data em que a carga foi PROGRAMADA — pedido do usuário (11/08/2026):
   "NA TORRE DE CONTROLE MOSTRAR A DATA DA PROGRAMACAO DAS CARGAS QUE NAO
   TIVEREM FINALIZADO E SAIDO AINDA".

   Serve pra enxergar carga encalhada: uma linha programada há três dias
   ainda em "Aguardando Veículo" é um problema que a coluna "Atualizado
   em" não denuncia (ela mexe a cada toque, mesmo sem a carga andar).
   Carga de HOJE aparece só como hora, pra não poluir a coluna com a data
   repetida em toda linha no dia normal. */
function dataProgramacaoHtml(c){
  const base = c.criadoEm || c.atualizadoEm;
  if(!base) return '<span class="text-dim">—</span>';
  const d = new Date(base);
  if(isNaN(d)) return '<span class="text-dim">—</span>';
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dia = new Date(d); dia.setHours(0,0,0,0);
  const diasAtras = Math.round((hoje - dia) / 86400000);
  if(diasAtras <= 0){
    return `<span class="text-dim">hoje ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>`;
  }
  // Destaque cresce com o atraso: 1 dia é normal (virada de turno),
  // 2+ dias é carga esquecida.
  const classe = diasAtras >= 2 ? 'prog-atrasada' : '';
  const rotulo = diasAtras === 1 ? 'ontem' : `há ${diasAtras} dias`;
  return `<span class="${classe}" title="Programada em ${fmtDataHora(base)}">`
       + `${d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} `
       + `<small>(${rotulo})</small></span>`;
}

/* Contagem de cargas por placa na fila, para a marca "1 de 2".

   Duas linhas com a mesma placa e sem marca nenhuma são indistinguíveis de
   um erro de digitação. Quem olha a fila precisa saber, sem contar linha,
   que aquilo é o mesmo caminhão com duas cargas — senão alguém "corrige" a
   duplicidade que não existe e apaga uma carga de verdade. */
function marcaCargaDaPlaca(carga, lista){
  const p = normalizarPlaca(carga.placa);
  const irmas = lista.filter(c => normalizarPlaca(c.placa) === p);
  if(irmas.length < 2) return '';
  const posicao = irmas.findIndex(c => c.id === carga.id) + 1;
  return `<span class="marca-multi" title="Este caminhão leva ${irmas.length} cargas nesta programação.">${posicao} de ${irmas.length}</span>`;
}

/* Programar outra carga para o mesmo caminhão.

   Sem isto, o caminho é redigitar placa, transportadora, tipo de veículo,
   motorista, rota e tipo de operação — seis campos que já estão na tela,
   logo acima, na linha da primeira carga. Redigitar dá errado: troca-se um
   dígito da placa e nascem duas cargas em caminhões diferentes.

   O que se REPETE é o veículo e o roteiro. O que MUDA é a carga: número,
   peso, sequência, ganchos, entregas, observações. O formulário vem
   preenchido com o primeiro grupo e limpo no segundo — é exatamente a
   diferença entre as duas cargas, e é só isso que sobra para digitar. */
function adicionarOutraCargaNaPlacaUI(id){
  const c = getCarga(id);
  if(!c){ notify('Carga não encontrada.', 'warn'); return; }

  const v = (campo, valor) => { const e = document.getElementById(campo); if(e) e.value = valor; };

  // Repete: o caminhão e para onde ele vai.
  v('prog-placa', c.placa);
  v('prog-transportadora', c.transportadora || '');
  v('prog-tipoveiculo', c.tipoVeiculo || '');
  v('prog-motorista', c.motorista || '');
  v('prog-rota', c.rota || '');
  v('prog-praonde', c.praOnde || PRA_ONDE_PADRAO);

  // Zera: tudo que é da CARGA, não do veículo. Herdar o número da carga
  // anterior seria a forma mais rápida de gravar duas cargas com o mesmo
  // número — o erro que este botão existe para evitar.
  v('prog-numero-carga', '');
  v('prog-peso', '');
  v('prog-sequencia', '');
  v('prog-obs', '');
  v('prog-paletizada', 'Não');
  v('prog-ganchos', '0');
  v('prog-entregas', '1');

  /* Marca que ESTA próxima criação é multi-carga deliberada, e não um
     lançamento repetido por engano. É o que diferencia os dois pedidos do
     usuário (11/08/2026), que só parecem se contradizer: "não duplicar
     placas na mesma programação" (acidente) versus "podendo somente
     duplicar cargas na mesma placa, e poder ter rotas diferentes se
     necessário" (intenção). O caminho deliberado é este botão. */
  _placaMultiCargaAutorizada = c.placa;

  atualizarPreviewFrotaPrograma();

  const campoNumero = document.getElementById('prog-numero-carga');
  if(campoNumero){
    campoNumero.scrollIntoView({ behavior: 'smooth', block: 'center' });
    campoNumero.focus();
  }
  notify(`Formulário preparado para outra carga da placa ${c.placa}. Informe o número da nova carga.`, 'info');
}
// Sequência continua 100% livre: número manual do Programador de Embarque,
// sem geração automática nem trava de duplicidade — regra confirmada,
// não mexer nisso (docs/DECISOES_CONFIRMADAS.md item 2).
function atualizarSequenciaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.sequencia = val==='' ? null : Number(val);
  SuincoStore.save();
  renderAll();   // campo aparece na Fila de Programados E na Torre editável
}
// Popula os selects de Rota. Uma função só, alimentada por ROTAS em data.js —
// acrescentar uma rota lá aparece nos dois formulários sem tocar aqui.
function preencherSelectsRota(){
  const opcoes = '<option value="">(rota não informada)</option>' +
    ROTAS.map(r=>`<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
  // Sempre reconstrói (não só na primeira vez): uma rota cadastrada em
  // Cadastros → Cadastrar Rota precisa aparecer aqui na hora, sem esperar
  // reload. Preserva o valor selecionado — chamar isto não pode limpar uma
  // rota que o Programador já tinha escolhido no formulário.
  ['prog-rota','completar-rota'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const valorAtual = el.value;
    el.innerHTML = opcoes;
    if(valorAtual) el.value = valorAtual;
  });
}

function praOndeSelectHtml(c){
  return `<select class="praonde-inline" onchange="atualizarPraOndeUI('${c.id}',this.value)">
    ${PRA_ONDE_OPCOES.map(op=>`<option value="${op}" ${c.praOnde===op?'selected':''}>${esc(PRA_ONDE_LABEL[op])}</option>`).join('')}
  </select>`;
}
function atualizarPraOndeUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.praOnde = PRA_ONDE_OPCOES.includes(val) ? val : PRA_ONDE_PADRAO;
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
/* Troca de placa numa carga já criada.

   Segue EXATAMENTE a mesma regra do lançamento novo, e isso é intencional:
   se a placa nova não estiver na Frota, a troca é recusada e o campo volta
   ao valor anterior. Aceitar aqui o que o formulário de criação recusa
   abriria uma porta lateral para furar a trava de frota — bastaria criar a
   carga com uma placa válida e trocar depois.

   A transportadora e o tipo de veículo vêm da base, não do que estava na
   carga: trocar a placa e manter a transportadora antiga produziria um
   registro que não bate com a realidade, e ninguém perceberia. */
function atualizarPlacaUI(id, val){
  const c = getCarga(id);
  if(!c) return;
  const nova = normalizarPlaca(val);

  if(!nova){
    notify('Placa não pode ficar em branco.', 'warn');
    renderAll();
    return;
  }
  if(nova === c.placa){ renderAll(); return; }

  const frota = buscarFrota(nova);
  if(!frota){
    notify(`Placa ${nova} não está cadastrada na Frota. Cadastre em Cadastros → Frota antes de usá-la.`, 'warn');
    renderAll();   // devolve o campo ao valor anterior
    return;
  }

  const anterior = c.placa;
  c.placa = nova;
  c.transportadora = frota.transportadora || '';
  c.tipoVeiculo = frota.tipoVeiculo || '';
  c.atualizadoEm = nowISO();

  // Troca de placa é alteração de dado operacional, não mudança de status:
  // entra no log de auditoria sem gerar movimentação na linha do tempo, que
  // ficaria poluída com evento que não é etapa do fluxo.
  registrarAlteracao({
    cargaId: c.id, placa: nova,
    campo: 'Placa',
    de: anterior,
    para: `${nova} (transportadora: ${c.transportadora || '—'})`,
    setor: (DB.operador && DB.operador.setor) || 'Logística',
    operador: (DB.operador && DB.operador.nome) || '(não identificado)'
  });

  SuincoStore.save();
  notify(`Placa alterada para ${nova} — transportadora ${c.transportadora || 'não informada'}.`, 'success');
  renderAll();
}

function atualizarNumeroCargaUI(id, val){
  const c = getCarga(id);
  if(!c) return;
  const novo = (val||'').trim();

  if(!novo){
    notify('Número da carga não pode ficar em branco.', 'warn');
    renderAll();   // devolve o campo ao valor anterior
    return;
  }
  if(novo === c.numeroCarga){ renderAll(); return; }

  const anterior = c.numeroCarga;
  c.numeroCarga = novo;
  c.atualizadoEm = nowISO();

  registrarAlteracao({
    cargaId: c.id, placa: c.placa,
    campo: 'Número da Carga',
    de: anterior || '—',
    para: novo,
    setor: (DB.operador && DB.operador.setor) || 'Logística',
    operador: (DB.operador && DB.operador.nome) || '(não identificado)'
  });

  SuincoStore.save();
  notify(`Número da carga alterado para ${novo}.`, 'success');
  renderAll();
}
function atualizarGanchosUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.qtdGanchos = val==='' ? 0 : Math.max(0, Number(val)||0);
  SuincoStore.save();
  renderAll();   // campo aparece na Fila de Programados E na Torre editável
}
function reordenarPorSequenciaUI(){
  renderProgFila();
  notify('Fila reordenada por Sequência.', 'success');
}
/* Excluir carga programada.

   A ordem aqui é deliberada: apaga da tela primeiro, avisa o servidor
   depois. É a mesma regra que vale para o resto do painel — quem clicou
   está com o caminhão na frente e não pode esperar a rede. Se o servidor
   recusar (carga já em operação, setor sem permissão), a carga volta na
   sincronia seguinte, com aviso do motivo.

   Sem rede, a exclusão entra na fila e sobe depois. */
async function excluirCargaUI(id){
  const c = getCarga(id); if(!c) return;

  /* Carga que já seguiu viagem não sai: o caminhão passou pela portaria, a
     nota existe. Apagar isso é apagar o que aconteceu, e o mês deixa de
     fechar. */
  if(c.status === 'Seguiu Viagem'){
    notify('Esta carga já seguiu viagem e não pode ser removida. O histórico do pátio não se apaga.', 'warn', 9000);
    return;
  }

  /* Carga que JÁ ANDOU é cancelamento, não exclusão — e cancelamento pede
     motivo. Antes, sair de "Aguardando Veículo" tornava a carga impossível
     de remover: ela sumia da tela de Programação e não havia mais como agir
     sobre ela em lugar nenhum. Um caminhão que encostou e foi embora sem
     carregar travava a fila do pátio até alguém mexer no banco.

     O motivo não é burocracia: é a diferença entre "a carga sumiu" e "o
     cliente desmarcou". Daqui a três meses, só ele responde. */
  const jaAndou = c.status !== 'Aguardando Veículo';
  let motivo = '';
  if(jaAndou){
    motivo = (prompt(
      `A carga da placa ${c.placa} está em "${c.status}" e já tem histórico.\n\n`
      + 'Descreva o motivo do cancelamento (fica registrado no log):') || '').trim();
    if(!motivo) return;                       // desistiu
    if(motivo.length < 3){
      notify('Escreva um motivo com pelo menos 3 letras.', 'warn');
      return;
    }
  } else if(!confirm(`Excluir a carga programada da placa ${c.placa}? Essa ação não pode ser desfeita.`)){
    return;
  }

  await _efetivarExclusaoCarga(id, c, motivo, jaAndou);
}

/* Miolo comum de "excluir/cancelar", compartilhado por excluirCargaUI e
   excluirCargaSeguiuViagemUI — a diferença entre os dois está inteira na
   confirmação exigida antes de chegar aqui, não no efeito. */
async function _efetivarExclusaoCarga(id, c, motivo, jaAndou, forcarSeguiuViagem){
  const numero = c.numeroCarga || '';
  const placa = c.placa;

  DB.cargas = DB.cargas.filter(x=>x.id!==id);
  DB.movimentacoes = DB.movimentacoes.filter(m=>m.cargaId!==id);
  registrarAlteracao({
    cargaId: id, placa,
    campo: jaAndou ? 'Carga cancelada' : 'Carga excluída',
    de: numero ? `Carga ${numero}` : `Placa ${placa}`,
    para: jaAndou ? `(cancelada em ${c.status}) — ${motivo}` : '(excluída)',
    setor: (DB.operador && DB.operador.setor) || 'Logística',
    operador: (DB.operador && DB.operador.nome) || '(não identificado)'
  });
  SuincoStore.save();
  renderAll();

  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.excluir){
    notify('Carga excluída.', 'success');
    return;
  }
  try{
    const r = await SuincoSharePoint.excluir(id, motivo, forcarSeguiuViagem ? { forcarSeguiuViagem: true } : undefined);
    if(r && r.recusado){
      notify(`O servidor recusou a exclusão: ${r.erro} A carga volta na próxima sincronia.`, 'danger', 12000);
      return;
    }
    notify(r && r.enfileirado
      ? 'Carga excluída aqui. Sem rede no momento — sobe assim que voltar.'
      : 'Carga excluída. Os outros setores já foram avisados.', 'success');
  }catch(e){
    notify('Carga excluída aqui, mas o servidor não confirmou. Ela pode voltar na próxima sincronia.', 'warn', 12000);
  }
}

/* Excluir uma carga que JÁ seguiu viagem — caminho deliberadamente mais
   pesado que excluirCargaUI. A proteção original (carga com nota fiscal
   emitida não deveria sumir, ou o mês não fecha) continua valendo por
   padrão; isto aqui é a válvula de escape para quando a carga não é uma
   viagem real — dado de teste que passou pelo fluxo inteiro (ex.:
   DJF8527), placa cadastrada errada, etc. Por isso pede a placa digitada
   de próprio punho: clique errado num botão "Excluir" não é o bastante
   pra apagar histórico de verdade. */
async function excluirCargaSeguiuViagemUI(id){
  const c = getCarga(id); if(!c) return;
  const digitado = (prompt(
    `Esta carga (placa ${c.placa}, nº ${c.numeroCarga || '—'}) já SEGUIU VIAGEM. `
    + 'Excluir agora apaga o histórico dela dos relatórios e do faturamento — '
    + 'só faça isso se for dado de teste ou cadastro errado, não uma viagem real.\n\n'
    + `Para confirmar, digite a placa exatamente: ${c.placa}`) || '').trim();
  if(!digitado) return;
  if(normalizarPlaca(digitado) !== c.placa){
    notify('Placa digitada não confere. Nada foi excluído.', 'warn');
    return;
  }
  const motivo = `Exclusão de carga já finalizada (Seguiu Viagem), confirmada digitando a placa — ${(DB.operador && DB.operador.nome) || '(não identificado)'}`;
  await _efetivarExclusaoCarga(id, c, motivo, true, true);
}
function renderProgAguardando(){
  const lista = DB.cargas.filter(c=>c.aguardandoCarga);
  const pill = document.getElementById('prog-aguardando-count');
  pill.hidden = lista.length===0; pill.textContent = lista.length;
  document.getElementById('prog-aguardando-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${fmtDataHora(c.criadoEm)}</td>
      <td class="no-print gap8">
        <button class="btn btn-primary btn-sm" onclick="abrirCompletar('${escJs(c.id)}')">Completar dados</button>
        <!-- Excluir aqui — pedido do usuário (11/08/2026): "ADICIONAR UM
             BOTAO DE EXCLUIR NO AGUARDANDO CARGA". Caminhão que a Portaria
             registrou por engano (placa errada, veículo que só passou)
             ficava preso nesta lista para sempre: sem número de carga não
             dá pra completar, e não havia como tirar. Usa a MESMA função
             de exclusão do resto do painel, com as mesmas travas de
             permissão e o mesmo registro no Histórico. -->
        <button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${escJs(c.id)}')"
                title="Remover este registro — use quando a chegada foi lançada por engano.">Excluir</button>
      </td>
    </tr>`).join('');
  document.getElementById('prog-aguardando-empty').hidden = lista.length>0;
}
function abrirCompletar(id){
  const c = getCarga(id); if(!c) return;
  document.getElementById('completar-id').value = id;
  document.getElementById('completar-placa-info').textContent = `Placa ${c.placa} — no pátio desde ${fmtDataHora(c.criadoEm)}`;
  document.getElementById('completar-numero-carga').value = '';
  document.getElementById('completar-cliente').value = '';
  document.getElementById('completar-destino').value = '';
  document.getElementById('completar-peso').value = '';
  document.getElementById('completar-sequencia').value = '';
  document.getElementById('completar-transportadora').value = c.transportadora || '';
  document.getElementById('completar-tipoveiculo').value = c.tipoVeiculo || '';
  document.getElementById('completar-motorista').value = '';
  document.getElementById('completar-obs').value = '';
  document.getElementById('completar-praonde').value = praOndeSugerido(c.transportadora);
  document.getElementById('completar-rota').value = '';
  document.getElementById('completar-paletizada').value = 'Não';
  document.getElementById('completar-ganchos').value = '0';
  document.getElementById('completar-entregas').value = '1';
  document.getElementById('modal-completar').classList.add('open');
}
function fecharModalCompletar(){ document.getElementById('modal-completar').classList.remove('open'); }
function salvarCompletarCarga(){
  const id = document.getElementById('completar-id').value;
  try{
    completarCargaAguardando(id, {
      numeroCarga: document.getElementById('completar-numero-carga').value,
      cliente: document.getElementById('completar-cliente').value,
      destino: document.getElementById('completar-destino').value,
      peso: document.getElementById('completar-peso').value,
      sequencia: document.getElementById('completar-sequencia').value,
      transportadora: document.getElementById('completar-transportadora').value,
      tipoVeiculo: document.getElementById('completar-tipoveiculo').value,
      motorista: document.getElementById('completar-motorista').value,
      observacoes: document.getElementById('completar-obs').value,
      praOnde: document.getElementById('completar-praonde').value,
      rota: document.getElementById('completar-rota').value,
      paletizada: document.getElementById('completar-paletizada').value,
      qtdGanchos: document.getElementById('completar-ganchos').value,
      qtdEntregas: document.getElementById('completar-entregas').value,
      operador: nomeOperadorAtual()
    });
    fecharModalCompletar();
    // Sem beep aqui de propósito: o status NÃO muda nesta ação (a carga já
    // nasceu em "Aguardando Embarque" quando a Portaria registrou a
    // chegada) — o som é só pra mudanças de status, não pra edição de dados.
    notify('Dados completados com sucesso.', 'success');
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}

/* ---------- PORTARIA ---------- */
function acaoChegadaUI(){
  const input = document.getElementById('portaria-placa');
  const placa = input.value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  const r = registrarChegadaPortaria(placa, nomeOperadorAtual());
  if(r.criadas.length){
    notify(`${normalizarPlaca(placa)}: nenhuma programação encontrada — criada entrada "Aguardando Carga" (status Aguardando Embarque). Avise a Logística para completar os dados.`, 'warn');
    tocarBeepConfirmacao();
  } else if(r.atualizadas.length){
    notify(`${normalizarPlaca(placa)}: ${r.atualizadas.length} carga(s) agora em "Aguardando Embarque".`, 'success');
    tocarBeepConfirmacao();
  } else if(r.jaNoPatio.length){
    notify(`${normalizarPlaca(placa)} já está no pátio (${r.jaNoPatio.map(c=>c.status).join(', ')}).`, '');
  }
  input.value = '';
  input.focus();
  renderAll();
}
function acaoSaidaUI(){
  const input = document.getElementById('portaria-placa');
  const placa = input.value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  const r = registrarSaidaPortaria(placa, nomeOperadorAtual());
  if(r.liberadas.length){ notify(`${normalizarPlaca(placa)}: saída registrada para ${r.liberadas.length} carga(s) — Seguiu Viagem.`, 'success'); tocarBeepConfirmacao(); }
  if(r.pendentes.length) notify(`${normalizarPlaca(placa)}: ${r.pendentes.length} carga(s) ainda não liberada(s) para saída (status atual: ${r.pendentes.map(c=>c.status).join(', ')}).`, 'warn');
  if(!r.liberadas.length && !r.pendentes.length) notify(`Nenhuma carga em aberto encontrada para a placa ${normalizarPlaca(placa)}.`, 'warn');
  input.value = '';
  input.focus();
  renderAll();
}
/* Fila da Portaria com ação direta por linha.

   Motivo: o registro por digitação de placa continua existindo (é mais rápido
   para quem já decorou a placa e está com o caminhão na frente), mas obriga a
   digitar certo. O botão por linha elimina o erro de digitação, que era a
   principal fonte de retrabalho na portaria.

   O botão só aparece quando a ação é VÁLIDA para o status atual — a máquina de
   estados não é contornada aqui, apenas exposta. Carga em "Aguardando Veículo"
   mostra Chegou; em "Faturado" mostra Saiu; nas etapas intermediárias não
   mostra nada, porque a ação é de outro setor. */
function renderPortariaProgramadas(){
  const lista = cargasAbertas().slice().sort(ordenarPorSequenciaEAtualizacao);
  const tb = document.getElementById('portaria-prog-tbody');
  if(!tb) return;
  tb.innerHTML = lista.map(c=>{
    let acao = '<span class="text-dim">—</span>';
    if(c.status === 'Aguardando Veículo'){
      acao = `<button class="btn btn-success btn-sm" onclick="portariaChegouCarga('${escJs(c.placa)}')">🚚 Chegou</button>`;
    } else if(c.status === 'Faturado'){
      acao = `<button class="btn btn-warn btn-sm" onclick="portariaSaiuCarga('${escJs(c.placa)}')">🏁 Saiu</button>`;
    }
    return `<tr>
      <td class="col-identificacao">${esc(c.placa)}${marcaCargaDaPlaca(c, lista)}</td>
      <td class="col-identificacao">${esc(c.numeroCarga)||'—'}</td>
      <td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(rotaCurta(c.rota))}</td>
      <td>${badgeHtml(c.status)}</td>
      <td class="no-print">${acao}</td>
    </tr>`;
  }).join('');
  document.getElementById('portaria-prog-empty').hidden = lista.length>0;
}
// Reaproveitam exatamente o mesmo caminho da digitação por placa — inclusive o
// tratamento em lote da saída, já que o caminhão sai uma vez só.
function portariaChegouCarga(placa){
  document.getElementById('portaria-placa').value = placa;
  acaoChegadaUI();
}
function portariaSaiuCarga(placa){
  document.getElementById('portaria-placa').value = placa;
  acaoSaidaUI();
}

function renderPortariaPatio(){
  const noPatio = cargasAbertas().filter(c=>c.status!=='Aguardando Veículo');
  const porPlaca = {};
  noPatio.forEach(c=>{ (porPlaca[c.placa] = porPlaca[c.placa]||[]).push(c); });
  const placas = Object.keys(porPlaca);
  document.getElementById('portaria-patio-tbody').innerHTML = placas.map(p=>{
    const cargas = porPlaca[p];
    const transp = cargas[0].transportadora || '—';
    const chegada = cargas.map(c=>primeiroTimestamp(c.id,'Aguardando Embarque')||c.criadoEm).sort()[0];
    return `<tr>
      <td>${esc(p)}</td><td>${esc(transp)}</td><td>${cargas.length}</td>
      <td>${cargas.map(c=>badgeHtml(c.status)).join(' ')}</td><td>${fmtDataHora(chegada)}</td>
    </tr>`;
  }).join('');
  document.getElementById('portaria-patio-empty').hidden = placas.length>0;
}

/* ---------- AÇÃO POR PLACA COM SELETOR DE CARGA (Expedição/Faturamento) ----------
   Regra: se a placa tiver mais de uma carga elegível pra mesma transição,
   pergunta qual carga está sendo processada — EXCETO na Portaria (chegada/
   saída), que já tem sua própria lógica em lote acima. */
function acaoRapidaPlaca(inputId, statusOrigem, statusDestino){
  const input = document.getElementById(inputId);
  const placa = input.value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  const elegiveis = cargasAbertasPorPlaca(placa).filter(c=>c.status===statusOrigem);
  if(elegiveis.length===0){
    notify(`Nenhuma carga da placa ${normalizarPlaca(placa)} está em "${statusOrigem}".`, 'warn');
    return;
  }
  if(elegiveis.length===1){
    executarAvanco(elegiveis[0].id, statusDestino);
    input.value = '';
    return;
  }
  abrirModalPicker(elegiveis, statusDestino, ()=>{ input.value=''; });
}
function executarAvanco(cargaId, statusDestino){
  try{
    const c = getCarga(cargaId);
    avancarStatusCarga(cargaId, statusDestino, nomeOperadorAtual(), setorOperadorAtual());
    notify(`${c.placa}: agora em "${statusDestino}".`, 'success');
    tocarBeepConfirmacao();
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
function avancarStatusUI(cargaId){
  const c = getCarga(cargaId); if(!c) return;
  const acao = NEXT_ACAO[c.status];
  if(!acao){ notify('Esta carga não tem uma próxima ação automática.', 'warn'); return; }
  executarAvanco(cargaId, acao.destino);
}
function abrirModalPicker(cargas, statusDestino, aoConfirmar){
  currentPickerCallback = (cargaId)=>{ executarAvanco(cargaId, statusDestino); if(aoConfirmar) aoConfirmar(); };
  document.getElementById('picker-titulo').textContent = `Esta placa tem ${cargas.length} cargas em aberto`;
  document.getElementById('picker-sub').textContent = 'Selecione qual carga está sendo processada:';
  document.getElementById('picker-lista').innerHTML = cargas.map(c=>`
    <div class="modal-list-item">
      <div><strong>Nº ${esc(c.numeroCarga)||'(sem número)'} — Destino: ${esc(c.destino)||'—'}</strong><br>
        <span class="text-dim">${esc(c.cliente)||'sem cliente'} · ${c.peso||0}kg · ${badgeHtml(c.status)}</span></div>
      <button class="btn btn-primary btn-sm" onclick="confirmarPicker('${escJs(c.id)}')">Selecionar</button>
    </div>`).join('');
  document.getElementById('modal-picker').classList.add('open');
}
function confirmarPicker(cargaId){
  const callback = currentPickerCallback;
  fecharModalPicker();
  if(callback) callback(cargaId);
}
function fecharModalPicker(){
  document.getElementById('modal-picker').classList.remove('open');
  currentPickerCallback = null;
}

/* ---------- EXPEDIÇÃO ---------- */
function renderExpedicao(){
  const alvo = ['Aguardando Embarque','Embarque Iniciado'];
  const lista = cargasAbertas().filter(c=>alvo.includes(c.status)).sort(ordenarPorSequenciaEAtualizacao);
  document.getElementById('exp-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td>${c.sequencia ?? '—'}</td><td class="col-identificacao">${esc(c.numeroCarga)||'—'}</td><td class="col-identificacao">${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(c.destino)||'—'}</td><td>${badgeHtml(c.status)}</td>
      <td class="no-print">${botaoAvancoHtml(c)}</td>
    </tr>`).join('');
  document.getElementById('exp-empty').hidden = lista.length>0;
}

/* ---------- FATURAMENTO ---------- */
function renderFaturamento(){
  const alvo = ['Embarque Finalizado','Faturado'];
  const lista = cargasAbertas().filter(c=>alvo.includes(c.status));
  document.getElementById('fat-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td class="col-identificacao">${esc(c.numeroCarga)||'—'}</td><td class="col-identificacao">${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.destino)||'—'}</td>
      <td>${c.peso||0}</td><td>${badgeHtml(c.status)}</td>
      <td class="no-print">${botaoAvancoHtml(c)}</td>
    </tr>`).join('');
  document.getElementById('fat-empty').hidden = lista.length>0;
}

/* ---------- INDICADORES / PAINEL DO GESTOR ---------- */
let indRankingPeriodoAtivo = 'hoje';
/* Distribuição das cargas em aberto por status, na tela — mesma leitura e as
   MESMAS cores do relatório executivo em PDF, para o gestor não precisar
   reaprender o código de cores ao trocar de mídia. */
function renderDistribuicaoStatus(){
  const tbody = document.getElementById('ind-status-tbody');
  if(!tbody) return;

  /* Leitura HORIZONTAL: uma coluna por etapa, o número embaixo.

     A versão vertical obrigava a percorrer seis linhas para montar o quadro
     do pátio na cabeça. Na horizontal o quadro inteiro cabe num olhar, e é
     a mesma forma já usada no relatório executivo — quem lê o PDF e quem
     lê a tela não precisam reaprender nada.

     A distribuição vem de distribuicaoPorStatus(), como antes. Só a
     apresentação mudou. */
  const abertas = filtrarPorFiltroIndicadores(cargasAbertas());
  const dist = distribuicaoPorStatus(abertas);

  const thead = document.getElementById('ind-status-thead');
  if(thead){
    thead.innerHTML = dist.map(d=>
      `<th class="st-col" style="border-bottom-color:${d.cor.destaque}" title="${esc(d.setor)}">
         ${esc(d.status)}<span class="st-setor">${esc(d.setor)}</span>
       </th>`).join('');
  }

  tbody.innerHTML = '<tr>' + dist.map(d=>
    `<td class="st-col st-valor${d.qtd ? '' : ' st-zero'}" style="color:${d.cor.destaque}">
       <span class="st-num">${d.qtd}</span>
       <span class="st-pct">${abertas.length ? d.pct + '%' : '—'}</span>
     </td>`).join('') + '</tr>';

  const total = document.getElementById('ind-status-total-linha');
  if(total){
    total.innerHTML = `<strong>${abertas.length}</strong> carga(s) em aberto`
      + (filtroIndicadoresAtivo() ? ' <span class="text-dim">— com o filtro aplicado</span>' : '');
  }
}

/* ====================================================================
   FILTROS DOS INDICADORES — um estado, todos os blocos
   ====================================================================
   Emprestado do painel de despesas de frete: o recorte vive num lugar só e
   TUDO recalcula junto. Sem isso, o gestor filtra num bloco, compara com
   número de outro recorte e tira conclusão errada sem perceber que os dois
   não falavam do mesmo conjunto.

   Nada aqui calcula indicador: só decide QUAIS cargas entram. Os cálculos
   continuam todos em data.js, intocados. */
const FILTRO_IND = { transportadora:'', rota:'', operacao:'', busca:'' };

function filtroIndicadoresAtivo(){
  return !!(FILTRO_IND.transportadora || FILTRO_IND.rota || FILTRO_IND.operacao || FILTRO_IND.busca);
}

function filtrarPorFiltroIndicadores(cargas){
  if(!filtroIndicadoresAtivo()) return cargas;
  const busca = FILTRO_IND.busca.trim().toLowerCase();
  const placa = normalizarPlaca(FILTRO_IND.busca);
  return cargas.filter(c=>{
    if(FILTRO_IND.transportadora && c.transportadora !== FILTRO_IND.transportadora) return false;
    if(FILTRO_IND.rota && (c.rota||'') !== FILTRO_IND.rota) return false;
    if(FILTRO_IND.operacao && (c.praOnde||'') !== FILTRO_IND.operacao) return false;
    if(busca){
      const bate = normalizarPlaca(c.placa).includes(placa)
                || String(c.numeroCarga||'').toLowerCase().includes(busca);
      if(!bate) return false;
    }
    return true;
  });
}

/* Preenche os seletores com o que EXISTE nos dados, não com uma lista
   fixa: opção que não filtra nada é convite a clicar e achar que quebrou. */
function preencherFiltrosIndicadores(){
  const alvo = (id, valores, rotulo) => {
    const el = document.getElementById(id);
    if(!el) return;
    const atual = el.value;
    el.innerHTML = `<option value="">${rotulo}</option>`
      + valores.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    el.value = atual;                       // não perde a escolha ao redesenhar
  };
  const uniq = f => [...new Set(DB.cargas.map(f).filter(Boolean))].sort();
  alvo('ind-f-transp', uniq(c=>c.transportadora), 'Todas');
  alvo('ind-f-rota', uniq(c=>c.rota).map(String), 'Todas');
  alvo('ind-f-operacao', uniq(c=>c.praOnde), 'Todos');
}

function aplicarFiltroIndicadores(){
  const ler = id => (document.getElementById(id)||{}).value || '';
  FILTRO_IND.transportadora = ler('ind-f-transp');
  FILTRO_IND.rota           = ler('ind-f-rota');
  FILTRO_IND.operacao       = ler('ind-f-operacao');
  FILTRO_IND.busca          = ler('ind-f-busca');

  /* A nota diz, em texto, o que está sendo mostrado. Número filtrado sem
     aviso é a forma mais silenciosa de tirar conclusão errada — ainda mais
     num painel que alguém abre no meio do dia e fotografa. */
  const nota = document.getElementById('ind-filtro-nota');
  if(nota){
    const partes = [];
    if(FILTRO_IND.transportadora) partes.push(FILTRO_IND.transportadora);
    if(FILTRO_IND.rota)           partes.push('Rota ' + FILTRO_IND.rota);
    if(FILTRO_IND.operacao)       partes.push(FILTRO_IND.operacao);
    if(FILTRO_IND.busca)          partes.push('"' + FILTRO_IND.busca + '"');
    nota.hidden = partes.length === 0;
    nota.innerHTML = partes.length
      ? `<strong>Filtro ativo:</strong> ${esc(partes.join(' · '))}`
        + ' — os números abaixo consideram só este recorte.'
      : '';
  }
  renderIndicadores();
}

function limparFiltroIndicadores(){
  ['ind-f-transp','ind-f-rota','ind-f-operacao','ind-f-busca'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value = '';
  });
  aplicarFiltroIndicadores();
}

function renderIndicadores(){
  preencherFiltrosIndicadores();
  renderDistribuicaoStatus();
  renderTempoMedioPatio();
  renderGargalos();
  // ---- Bloco 1: histórico completo (mantém o comportamento original) ----
  const concluidas = filtrarPorFiltroIndicadores(DB.cargas.filter(c=>c.status==='Seguiu Viagem'));
  const campos = ['tempoAguardandoEmbarque','tempoCarregamento','tempoFaturamento','tempoAguardandoSaida','tempoPatioTotal'];
  const labels = {
    tempoAguardandoEmbarque:'Tempo Aguardando Embarque',
    tempoCarregamento:'Tempo de Carregamento',
    tempoFaturamento:'Tempo de Faturamento',
    tempoAguardandoSaida:'Tempo Aguardando Saída',
    tempoPatioTotal:'Tempo em Pátio (total)'
  };
  const somas = {}, contagens = {};
  campos.forEach(f=>{ somas[f]=0; contagens[f]=0; });
  let somaLead=0, nLead=0;
  concluidas.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    campos.forEach(f=>{ if(ind[f]!==null){ somas[f]+=ind[f]; contagens[f]++; } });
    if(ind.leadTimeTotal!==null){ somaLead+=ind.leadTimeTotal; nLead++; }
  });
  let html = campos.map(f=>{
    const media = contagens[f] ? Math.round(somas[f]/contagens[f]) : null;
    return `<div class="stat-box"><div class="stat-num">${fmtDuracao(media)}</div><div class="stat-label">${labels[f]}</div></div>`;
  }).join('');
  html += `<div class="stat-box"><div class="stat-num">${fmtDuracao(nLead?Math.round(somaLead/nLead):null)}</div><div class="stat-label">Lead Time Total</div><div class="stat-note">criação da carga → Seguiu Viagem</div></div>`;
  document.getElementById('ind-stats').innerHTML = html;

  // ---- Bloco 2: Painel do Gestor — comparação por período (novo) ----
  renderComparacaoPeriodos();
  renderRankingPeriodos();
  renderGraficosIndicadores();
}
// Tabela indicador × período, todos visíveis ao mesmo tempo — sem clique
// pra comparar 6h vs 12h vs Hoje vs Semana vs Mês.
function renderComparacaoPeriodos(){
  const linhasDef = [
    { key:'cargas',                   label:'Cargas Concluídas' },
    { key:'tempoAguardandoEmbarque',  label:'Tempo Aguardando Embarque' },
    { key:'tempoCarregamento',        label:'Tempo de Carregamento' },
    { key:'tempoFaturamento',         label:'Tempo de Faturamento' },
    { key:'tempoAguardandoSaida',     label:'Tempo Aguardando Saída' },
    { key:'tempoPatioTotal',          label:'Tempo em Pátio (total)' },
    { key:'leadTimeTotal',            label:'Lead Time Total' }
  ];
  const porPeriodo = PERIODOS_INDICADOR.map(p => ({ periodo:p, dados: indicadoresPorPeriodo(p.key) }));
  const tbody = document.getElementById('ind-periodos-tbody');
  tbody.innerHTML = linhasDef.map(linha=>{
    const celulas = porPeriodo.map(({dados})=>{
      if(linha.key==='cargas'){
        if(dados.totalCargas===0) return `<td class="cel-sem-dados">Sem dados suficientes</td>`;
        return `<td class="cel-num">${dados.totalCargas}</td>`;
      }
      if(dados.totalCargas===0) return `<td class="cel-sem-dados">Sem dados suficientes</td>`;
      const v = dados.medias[linha.key];
      return v===null ? `<td class="cel-sem-dados">Sem dados suficientes</td>` : `<td class="cel-num">${fmtDuracao(v)}</td>`;
    }).join('');
    /* Sparkline da própria linha.

       A tabela já É uma série temporal: as cinco colunas são janelas de
       tempo do mesmo indicador, da mais recente para a mais antiga. Lida
       célula a célula, a tendência exige comparar cinco números de cabeça.
       Desenhada, aparece de relance.

       Nenhum cálculo novo: os valores são exatamente os que já estão
       impressos nas células ao lado. */
    const serie = porPeriodo.map(({dados})=>{
      if(dados.totalCargas === 0) return null;
      if(linha.key === 'cargas') return dados.totalCargas;
      return dados.medias[linha.key];
    }).reverse();          // esquerda = mais antigo, como todo gráfico de tempo

    return `<tr><th class="row-label">${esc(linha.label)}</th>${celulas}`
         + `<td class="cel-spark"><canvas class="spark" width="120" height="26"`
         + ` data-serie="${esc(JSON.stringify(serie))}"`
         + ` data-menor-melhor="${linha.key !== 'cargas'}"></canvas></td></tr>`;
  }).join('');

  desenharSparklines(tbody);
}

/* Sparkline em canvas, no mesmo padrão dos outros gráficos do painel.

   Sem biblioteca: o painel roda offline, com CSP restrita, e trazer uma
   dependência só para desenhar cinco pontos seria caro pelo motivo errado.

   Buracos na série (período sem dados) NÃO viram zero. Zero diria "o tempo
   caiu para nada", que é o oposto de "não houve carga para medir" — e é
   assim que um gráfico mente sem ninguém perceber. A linha simplesmente se
   interrompe ali. */
function desenharSparklines(raiz){
  raiz.querySelectorAll('canvas.spark').forEach(canvas=>{
    let serie;
    try { serie = JSON.parse(canvas.dataset.serie || '[]'); } catch(e){ return; }
    const validos = serie.filter(v=>typeof v === 'number' && isFinite(v));
    // prepararCanvas devolve { ctx, w, h } já com a escala de tela retina
    // aplicada — usar o contrato existente evita sparkline borrada no
    // celular, que é onde ela mais precisa ser nítida.
    const { ctx, w: L, h: A } = prepararCanvas(canvas);
    ctx.clearRect(0,0,L,A);

    if(validos.length < 2){
      ctx.fillStyle = corTema('--text-dim');
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('sem série', L/2, A/2 + 3);
      return;
    }

    const min = Math.min(...validos), max = Math.max(...validos);
    const faixa = (max - min) || 1;
    const pad = 3;
    const x = i => pad + (i * (L - pad*2)) / (serie.length - 1);
    const y = v => A - pad - ((v - min) / faixa) * (A - pad*2);

    // Cor pela direção do último trecho, e o que é "bom" depende do
    // indicador: menos minutos de pátio é melhora; menos cargas, não.
    const primeiro = validos[0], ultimo = validos[validos.length - 1];
    const menorMelhor = canvas.dataset.menorMelhor === 'true';
    const melhorou = menorMelhor ? ultimo < primeiro : ultimo > primeiro;
    const cor = ultimo === primeiro ? corTema('--text-dim')
              : corTema(melhorou ? '--st-faturado-fg' : '--st-aguardando-veiculo-fg');

    ctx.strokeStyle = cor; ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    let caneta = false;
    serie.forEach((v,i)=>{
      if(typeof v !== 'number' || !isFinite(v)){ caneta = false; return; }
      if(caneta) ctx.lineTo(x(i), y(v)); else ctx.moveTo(x(i), y(v));
      caneta = true;
    });
    ctx.stroke();

    // Ponto no valor mais recente: é o que a pessoa procura primeiro.
    const iUltimo = serie.length - 1 - [...serie].reverse()
      .findIndex(v=>typeof v === 'number' && isFinite(v));
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(x(iUltimo), y(serie[iUltimo]), 2.6, 0, Math.PI*2);
    ctx.fill();
  });
}
// Ranking de transportadoras com seletor de período (pílulas). Mantido
// separado da tabela de comparação acima de propósito: o número de
// transportadoras é variável, então uma matriz gigante indicador×período
// ficaria densa demais — aqui um clique troca o período, mas a tabela em
// si já mostra todas as transportadoras daquele período de uma vez.
function renderRankingPeriodos(){
  const tabs = [...PERIODOS_INDICADOR, { key:'todos', label:'Histórico completo' }];
  document.getElementById('ind-ranking-periodos').innerHTML = tabs.map(p=>`
    <button class="btn btn-sm ${p.key===indRankingPeriodoAtivo ? 'btn-primary' : 'btn-sec'}" onclick="selecionarRankingPeriodo('${escJs(p.key)}')">${esc(p.label)}</button>
  `).join('');
  const cargasPeriodo = indRankingPeriodoAtivo==='todos' ? undefined : cargasConcluidasNoPeriodo(indRankingPeriodoAtivo);
  const rk = rankingVeiculosAtraso(filtrarPorFiltroIndicadores(cargasPeriodo || DB.cargas));
  document.getElementById('ind-ranking-tbody').innerHTML = rk.map((r,i)=>`
    <tr>
      <td>${i+1}º</td>
      <td><strong>${esc(r.placa)}</strong></td>
      <td>${esc(r.transportadora)}</td>
      <td class="cel-num">${r.atrasos} de ${r.totalCargas}</td>
      <td class="cel-num">${fmtDuracao(r.tempoMedioAtraso)}</td>
      <td>${r.ultimoAtraso ? esc(fmtDataHora(r.ultimoAtraso)) : '—'}</td>
    </tr>
  `).join('');
  document.getElementById('ind-ranking-empty').hidden = rk.length>0;
}
function selecionarRankingPeriodo(key){
  indRankingPeriodoAtivo = key;
  renderRankingPeriodos();
}

/* ---------- GRÁFICOS (Painel do Gestor) ----------
   Canvas 2D puro, sem biblioteca externa. Cada gráfico sempre desenha o
   valor como TEXTO junto (nunca só cor/posição) — requisito de
   acessibilidade do painel (usuário monocular, zoom, alto contraste): uma
   pizza sozinha seria ilegível pra esse público, por isso ela sempre vem
   acompanhada de uma legenda em lista com números explícitos ao lado. */
function corTextoSobre(corFundo){
  // Preto ou branco conforme o brilho do fundo, pra garantir contraste de
  // texto em qualquer cor de barra/fatia (mesmo requisito de acessibilidade).
  const c = corFundo.replace('#','');
  const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
  const luminancia = (0.299*r + 0.587*g + 0.114*b);
  return luminancia > 150 ? '#101625' : '#f2f4f8';
}
function prepararCanvas(canvas){
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 400;
  /* BUG DE PRODUÇÃO (achado pelo usuário em iPhone real, 08/08/2026,
     screenshot com barras saindo do celular — "1h42min" de barra pra um
     gráfico de 160px): esta função lia a altura pretendida em
     `canvas.height`, mas TAMBÉM escreve `canvas.height` embaixo (a
     imagem de fundo em pixels de dispositivo). Na segunda chamada
     (redimensionar a janela, mudar filtro, atualização ao vivo de
     qualquer setor — todas chamam renderGraficosIndicadores() de novo),
     `canvas.height` já não é mais 160: é `160 * dpr` da chamada anterior.
     Ler esse valor de volta multiplica por dpr outra vez — e nem toda
     chamada seguinte. Num desktop com dpr=1 isso nunca aparece (1×1×1…
     continua 1); num iPhone com dpr≈3 vira 160 → 480 → 1440px em duas ou
     três chamadas, exatamente a explosão das fotos. Não reproduzia no
     Chromium headless usado nos testes desta sessão porque o dpr padrão
     ali é 1.

     `canvas.style.height`, ao contrário, é estável: esta função a
     ESCREVE com o mesmo valor pretendido toda vez (idempotente), nunca
     com o valor em pixels de dispositivo — por isso é a fonte confiável
     da altura pretendida a partir da segunda chamada em diante. */
  const cssH = parseFloat(canvas.style.height) || canvas.height || 220;
  canvas.style.width = '100%';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return { ctx, w: cssW, h: cssH };
}
function limparCanvasMsg(canvas, msg){
  const { ctx, w, h } = prepararCanvas(canvas);
  ctx.fillStyle = corTema('--text-dim');
  ctx.font = '14px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(msg, w/2, h/2);
}
function drawBarChart(canvas, itens){
  // itens: [{label, valor, cor}], valor em minutos (ou null = sem dado)
  if(!itens.length){ limparCanvasMsg(canvas, 'Nenhuma barra pra mostrar com este filtro.'); return; }
  const { ctx, w, h } = prepararCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  const comDado = itens.filter(i=>i.valor!==null);
  const max = Math.max(1, ...comDado.map(i=>i.valor));
  const padBottom = 46, padTop = 14;
  const areaH = h - padBottom - padTop;
  const larguraBarra = Math.min(90, (w / itens.length) * 0.55);
  const espaco = w / itens.length;
  ctx.font = '13px Segoe UI, sans-serif';
  itens.forEach((it,i)=>{
    const cx = espaco*i + espaco/2;
    const valor = it.valor ?? 0;
    const altura = it.valor===null ? 0 : Math.max(3, (valor/max) * areaH);
    const y = padTop + areaH - altura;
    ctx.fillStyle = it.valor===null ? corTema('--navy-lighter') : it.cor;
    ctx.fillRect(cx - larguraBarra/2, y, larguraBarra, altura || 2);
    // valor em texto, sempre acima da barra — nunca só a cor/altura carrega a informação
    ctx.fillStyle = corTema('--text');
    ctx.textAlign = 'center';
    ctx.fillText(it.valor===null ? 'sem dado' : fmtDuracao(it.valor), cx, y - 6 < 12 ? 12 : y - 6);
    // rótulo da etapa, embaixo
    ctx.fillStyle = corTema('--text-dim');
    wrapTextCanvas(ctx, it.label, cx, padTop + areaH + 16, espaco - 6, 13);
  });
}
function wrapTextCanvas(ctx, texto, cx, y, maxWidth, lineHeight){
  const palavras = texto.split(' ');
  let linha = '';
  const linhas = [];
  palavras.forEach(p=>{
    const teste = linha ? linha+' '+p : p;
    if(ctx.measureText(teste).width > maxWidth && linha){ linhas.push(linha); linha = p; }
    else linha = teste;
  });
  if(linha) linhas.push(linha);
  linhas.slice(0,2).forEach((l,i)=> ctx.fillText(l, cx, y + i*lineHeight));
}
function drawLineChart(canvas, pontos){
  // pontos: [{dia, quantidade}]
  if(!pontos.length){ limparCanvasMsg(canvas, 'Sem dados para este período.'); return; }
  const { ctx, w, h } = prepararCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  const padL = 30, padR = 14, padTop = 16, padBottom = 34;
  const areaW = w - padL - padR, areaH = h - padTop - padBottom;
  const max = Math.max(1, ...pontos.map(p=>p.quantidade));
  const passoX = pontos.length>1 ? areaW/(pontos.length-1) : 0;
  const coordY = q => padTop + areaH - (q/max)*areaH;
  // eixo
  ctx.strokeStyle = corTema('--border');
  ctx.beginPath(); ctx.moveTo(padL, padTop); ctx.lineTo(padL, padTop+areaH); ctx.lineTo(padL+areaW, padTop+areaH); ctx.stroke();
  // linha
  ctx.strokeStyle = corTema('--gold-dim'); ctx.lineWidth = 2.5; ctx.beginPath();
  pontos.forEach((p,i)=>{
    const x = padL + passoX*i, y = coordY(p.quantidade);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
  // pontos + valor em texto (nunca só a posição do ponto carrega a info)
  ctx.font = '12px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  pontos.forEach((p,i)=>{
    const x = padL + passoX*i, y = coordY(p.quantidade);
    ctx.fillStyle = corTema('--gold-dim');
    ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = corTema('--text');
    ctx.fillText(String(p.quantidade), x, y-10 < 10 ? 10 : y-10);
    if(pontos.length <= 14 || i%Math.ceil(pontos.length/14)===0){
      ctx.fillStyle = corTema('--text-dim');
      ctx.fillText(p.dia.slice(0,5), x, padTop+areaH+16);
    }
  });
}
function drawPieChart(canvas, fatias){
  // fatias: [{status, quantidade, cor}]
  const total = fatias.reduce((s,f)=>s+f.quantidade,0);
  if(!fatias.length || total===0){ limparCanvasMsg(canvas, 'Nenhuma carga em aberto com este filtro.'); return; }
  const { ctx, w, h } = prepararCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  const cx = w*0.32, cy = h/2, raio = Math.min(cx, h/2) - 10;
  let anguloAtual = -Math.PI/2;
  fatias.filter(f=>f.quantidade>0).forEach(f=>{
    const fatiaAngulo = (f.quantidade/total) * Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,raio, anguloAtual, anguloAtual+fatiaAngulo);
    ctx.closePath();
    ctx.fillStyle = f.cor;
    ctx.fill();
    anguloAtual += fatiaAngulo;
  });
  // Legenda em lista textual ao lado — ver comentário no topo da seção:
  // pizza sozinha não é acessível o bastante pra este público.
  document.getElementById('grafico-pizza-legenda').innerHTML = fatias.filter(f=>f.quantidade>0).map(f=>{
    const pct = Math.round((f.quantidade/total)*100);
    return `<div class="legenda-item"><span class="legenda-chip" style="background:${f.cor}"></span>${esc(f.status)}: <strong>${f.quantidade}</strong> (${pct}%)</div>`;
  }).join('') || '<div class="text-dim">Nenhuma carga em aberto.</div>';
}
function popularSelectTransportadoraGraficos(){
  const sel = document.getElementById('graf-filtro-transportadora');
  if(!sel) return;
  const atual = sel.value;
  const nomes = listarTransportadoras().map(t=>t.nome);
  sel.innerHTML = '<option value="">Todas</option>' + nomes.map(n=>`<option value="${esc(n)}" ${n===atual?'selected':''}>${esc(n)}</option>`).join('');
}
function limparFiltrosGraficos(){
  document.getElementById('graf-filtro-placa').value = '';
  document.getElementById('graf-filtro-transportadora').value = '';
  document.getElementById('graf-filtro-setor').value = '';
  document.getElementById('graf-filtro-periodo').value = 'hoje';
  renderGraficosIndicadores();
}
function renderGraficosIndicadores(){
  const canvasBarras = document.getElementById('grafico-barras');
  if(!canvasBarras) return; // aba ainda não renderizada
  popularSelectTransportadoraGraficos();
  const filtros = {
    placa: document.getElementById('graf-filtro-placa').value,
    transportadora: document.getElementById('graf-filtro-transportadora').value,
    setor: document.getElementById('graf-filtro-setor').value
  };
  const periodo = document.getElementById('graf-filtro-periodo').value;

  // 1) Barras — tempo médio por etapa (cor única/dourada: aqui a cor NÃO
  // representa status, representa "duração" — evita usar a mesma cor com
  // dois significados diferentes na mesma tela)
  const etapas = temposMediosPorEtapaFiltrado(periodo, filtros);
  drawBarChart(canvasBarras, etapas.map(e=>({ label:e.label, valor:e.media, cor:'#e9b954' })));

  // 2) Linha — cargas concluídas por dia
  const dias = cargasConcluidasPorDia(periodo, filtros);
  drawLineChart(document.getElementById('grafico-linha'), dias);

  // 3) Pizza — distribuição por status atual
  const distrib = distribuicaoStatusAtual(filtros);
  drawPieChart(document.getElementById('grafico-pizza'), distrib);
}
window.addEventListener('resize', ()=>{ if(TAB_ATUAL==='indicadores') renderGraficosIndicadores(); });

/* ---------- CADASTROS ---------- */
function renderCadastros(){
  renderFrotaTabela();
  renderTranspLista();
  const cardRota = document.getElementById('card-cadastrar-rota');
  if(cardRota){
    cardRota.hidden = !(DB.operador && DB.operador.setor === 'Administração');
    if(!cardRota.hidden) renderRotasCadastro();
  }
}
function renderRotasCadastro(){
  const tbody = document.getElementById('rotas-tbody');
  if(!tbody) return;
  tbody.innerHTML = ROTAS.slice()
    .sort((a,b)=> a.codigo.localeCompare(b.codigo, 'pt-BR', {numeric:true}))
    .map(r=>`<tr><td>${esc(r.codigo)}</td><td>${esc(r.nome)||'—'}</td><td>${esc(r.detalhe)||'—'}</td><td>${esc(r.operador)||'—'}</td></tr>`)
    .join('');
}
function addRotaUI(){
  const codigo = document.getElementById('rota-codigo').value.trim();
  const nome = document.getElementById('rota-nome').value.trim();
  if(!codigo){ notify('Informe o código da rota.', 'warn'); return; }
  if(!nome){ notify('Informe o nome da rota.', 'warn'); return; }
  const jaExistia = !!rotaInfo(codigo);
  upsertRota(codigo, nome, document.getElementById('rota-detalhe').value,
             document.getElementById('rota-operador').value);
  ['rota-codigo','rota-nome','rota-detalhe','rota-operador'].forEach(id=>document.getElementById(id).value='');
  preencherSelectsRota();   // dropdowns de Rota atualizados na hora
  notify(jaExistia ? `Rota ${codigo} atualizada.` : `Rota ${codigo} — ${nome} cadastrada. Já aparece no seletor de Rota.`, 'success');
  renderAll();
}
// Filtro de texto (placa ou transportadora) + "só precisa revisão" — a base
// real tem 2.038 placas (ver docs/NOTAS_BASE_FROTA.md), então navegar a
// tabela inteira sem busca não é viável na prática. A busca não mexe em
// DB.frota, só no que é exibido.
function renderFrotaTabela(){
  const buscaEl = document.getElementById('frota-busca');
  const soRevisaoEl = document.getElementById('frota-so-revisao');
  const buscaPlaca = buscaEl ? normalizarPlaca(buscaEl.value) : '';
  const buscaTexto = buscaEl ? buscaEl.value.trim().toLowerCase() : '';
  const soRevisao = soRevisaoEl ? soRevisaoEl.checked : false;
  const todos = DB.frota.slice().sort((a,b)=>a.placa.localeCompare(b.placa));
  const lista = todos.filter(f=>{
    if(soRevisao && !f.precisaRevisao) return false;
    if(!buscaTexto) return true;
    return normalizarPlaca(f.placa).includes(buscaPlaca) || (f.transportadora||'').toLowerCase().includes(buscaTexto);
  });
  /* 300 já era alto demais pra navegar sem busca (ver comentário acima) —
     mas no CELULAR virou rolagem quase infinita depois que a tabela passou
     a sair em cartão de 2 colunas (08/08/2026): cada linha, que numa tabela
     comum ocupa ~40px, vira um cartão de ~250-300px. 300 cartões = a
     mesma altura de ~300 telas de celular empilhadas — medido: 98.676px de
     scroll numa Frota de 749 placas. Auditoria pedida pelo usuário
     ("refinamento em TODAS AS ABAS") depois de eu ter corrigido só a
     Torre/Indicadores. Mesmo breakpoint que ativa o cartão (560px). */
  const mobile = window.matchMedia && window.matchMedia('(max-width:560px)').matches;
  const LIMITE = mobile ? 30 : 300;
  const exibidos = lista.slice(0, LIMITE);
  document.getElementById('frota-tbody').innerHTML = exibidos.map(f=>`
    <tr>
      <td>${esc(f.placa)}</td><td>${esc(f.transportadora)||'—'}</td><td>${esc(f.tipoVeiculo)||'—'}</td>
      <td>${f.capacidadeKg ? f.capacidadeKg.toLocaleString('pt-BR') : '—'}</td>
      <td>${esc(f.uf)||'—'}</td>
      <td>${f.dataUltimaMovimentacao ? new Date(f.dataUltimaMovimentacao+'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
      <td>${f.precisaRevisao ? '<span class="badge badge-aguardando-veiculo">SIM</span>' : '<span class="text-dim">Não</span>'}</td>
      <td class="no-print"><button class="btn btn-danger btn-sm" onclick="removerFrotaUI('${escJs(f.placa)}')">Remover</button></td>
    </tr>`).join('');
  document.getElementById('frota-empty').hidden = todos.length>0;
  const contagemEl = document.getElementById('frota-contagem');
  if(contagemEl){
    contagemEl.textContent = lista.length > LIMITE
      ? `Mostrando ${LIMITE} de ${lista.length} (de ${todos.length} no total) — refine a busca pra ver outras.`
      : `${lista.length} de ${todos.length} placa(s) cadastrada(s).`;
  }
}
function addFrotaUI(){
  const placa = document.getElementById('frota-placa').value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  upsertFrota(placa, document.getElementById('frota-transportadora').value, document.getElementById('frota-tipoveiculo').value, {
    capacidadeKg: document.getElementById('frota-capacidade').value,
    uf: document.getElementById('frota-uf').value,
    motorista: document.getElementById('frota-motorista').value,
    dataUltimaMovimentacao: document.getElementById('frota-ultima-mov').value,
    precisaRevisao: document.getElementById('frota-revisao').checked
  });
  ['frota-placa','frota-transportadora','frota-tipoveiculo','frota-motorista','frota-capacidade','frota-uf','frota-ultima-mov'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('frota-revisao').checked = false;
  notify('Placa cadastrada na Frota.', 'success');
  renderAll();
}
function removerFrotaUI(placa){
  if(!confirm(`Remover a placa ${placa} da Frota?`)) return;
  removerFrota(placa);
  notify('Placa removida.', 'success');
  renderAll();
}
function importarFrotaLoteUI(){
  const texto = document.getElementById('frota-lote').value;
  if(!texto.trim()){ notify('Cole os dados antes de importar.','warn'); return; }
  const r = importarFrotaLote(texto);
  notify(`Importação concluída: ${r.ok} placa(s) importada(s), ${r.ignoradas} linha(s) ignorada(s).`, r.ok ? 'success' : 'warn');
  document.getElementById('frota-lote').value = '';
  renderAll();
}
function renderTranspLista(){
  const lista = listarTransportadoras();
  document.getElementById('cad-transp-lista').innerHTML = lista.length ? lista.map(t=>`
    <div class="modal-list-item"><span>${esc(t.nome)}</span>
      <button class="btn btn-danger btn-sm no-print" onclick="removerTransportadoraUI('${escJs(t.id)}')">Remover</button></div>
  `).join('') : '<div class="empty-state">Nenhuma transportadora cadastrada.</div>';
}
function addTransportadoraUI(){
  try{
    addTransportadora(document.getElementById('cad-transp-nome').value);
    document.getElementById('cad-transp-nome').value = '';
    notify('Transportadora adicionada.', 'success');
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
function removerTransportadoraUI(id){ removerTransportadora(id); renderAll(); }
function atualizarDatalists(){
  document.getElementById('lista-transportadoras').innerHTML = DB.transportadoras.map(t=>`<option value="${esc(t.nome)}">`).join('');
}

/* ---------- HISTÓRICO — LINHA DO TEMPO POR CARGA (item 7 do briefing) ----
   Carro-chefe de usabilidade: em vez de vasculhar uma tabela crua, quem
   quiser saber "cadê essa carga / o que já aconteceu com ela" digita a
   placa ou o número de carga e vê uma linha do tempo visual, com hora,
   quem fez e o setor em cada etapa — textos grandes, feito pra ler rápido
   com zoom/alto contraste. */
let _timelineCargaAtual = null;
function renderBuscaTimeline(){
  const termoBruto = (document.getElementById('hist-busca-carga').value || '').trim();
  const resultadosEl = document.getElementById('hist-busca-resultados');
  const wrap = document.getElementById('hist-timeline-wrap');

  if(!termoBruto){
    // Sem busca: mostra atalho pras cargas mais recentemente atualizadas.
    const recentes = DB.cargas.slice().sort((a,b)=>new Date(b.atualizadoEm)-new Date(a.atualizadoEm)).slice(0,5);
    resultadosEl.innerHTML = recentes.length ? `
      <div class="text-dim" style="font-size:12px;margin-bottom:8px">Ou escolha uma das mais recentes:</div>
      <div class="gap8">${recentes.map(c=>cardResultadoBusca(c)).join('')}</div>
    ` : '';
    if(!_timelineCargaAtual) wrap.innerHTML = '';
    return;
  }

  const termo = normalizarPlaca(termoBruto);
  const termoNum = termoBruto.toLowerCase();
  const achadas = DB.cargas.filter(c=>
    (termo && normalizarPlaca(c.placa).includes(termo)) ||
    (c.numeroCarga && c.numeroCarga.toLowerCase().includes(termoNum))
  ).sort((a,b)=>new Date(b.atualizadoEm)-new Date(a.atualizadoEm));

  if(achadas.length === 0){
    resultadosEl.innerHTML = `<div class="empty-state">Nenhuma carga encontrada para "${esc(termoBruto)}".</div>`;
    wrap.innerHTML = '';
    return;
  }
  if(achadas.length === 1){
    // Só uma opção — pula direto pra timeline, sem exigir clique extra.
    resultadosEl.innerHTML = '';
    selecionarCargaTimeline(achadas[0].id);
    return;
  }
  resultadosEl.innerHTML = `<div class="gap8">${achadas.slice(0,12).map(c=>cardResultadoBusca(c)).join('')}</div>`;
}
function cardResultadoBusca(c){
  return `<button class="btn btn-sec btn-sm" onclick="selecionarCargaTimeline('${escJs(c.id)}')">
    ${esc(c.placa)} ${c.numeroCarga?('· Nº '+esc(c.numeroCarga)):''} ${c.destino?('· '+esc(c.destino)):''}
  </button>`;
}
function selecionarCargaTimeline(id){
  _timelineCargaAtual = id;
  renderTimelineCarga(id);
}
function sequenciaDeStatusDaCarga(historico){
  // Fluxo normal sempre passa por "Aguardando Veículo" primeiro. Uma carga
  // que nasceu como "Aguardando Carga" (Portaria registrou chegada sem
  // programação prévia) pula direto pra "Aguardando Embarque" — nunca teve
  // essa etapa, então ela nem aparece na linha do tempo (não fingimos uma
  // etapa que não existiu).
  const teveAguardandoVeiculo = historico.some(m=>m.statusNovo==='Aguardando Veículo');
  return teveAguardandoVeiculo ? STATUS_FLOW : STATUS_FLOW.slice(1);
}
function renderTimelineCarga(id){
  const c = getCarga(id);
  const wrap = document.getElementById('hist-timeline-wrap');
  if(!c){ wrap.innerHTML = ''; return; }
  const historico = historicoDaCarga(id);
  const sequencia = sequenciaDeStatusDaCarga(historico);

  const passos = sequencia.map(status=>{
    const mov = historico.find(m=>m.statusNovo===status);
    return { status, feito: !!mov, mov };
  });
  // Último passo concluído = etapa atual (destaque especial).
  let idxAtual = -1;
  passos.forEach((p,i)=>{ if(p.feito) idxAtual = i; });

  const infoLinhas = [
    ['Nº Carga', c.numeroCarga || '—'],
    ['Cliente', c.cliente || '—'],
    ['Destino', c.destino || '—'],
    ['Transportadora', c.transportadora || '—'],
    ['Tipo de Veículo', c.tipoVeiculo || '—'],
    ['Motorista', c.motorista || '—'],
    ['Rota', rotaLabel(c.rota) || '(não informada)'],
    ['Tipo de Operação', PRA_ONDE_LABEL[c.praOnde] || c.praOnde || '—'],
    ['Paletizada', paletizadaDaCarga(c)],
    ['Qtd. Ganchos', (c.qtdGanchos ? c.qtdGanchos : 'Liso')],
    ['Qtd. Entregas', c.qtdEntregas ?? 1]
  ];

  wrap.innerHTML = `
    <div class="timeline-card">
      <div class="timeline-head">
        <div class="timeline-placa">🚚 ${esc(c.placa)} <span class="text-dim" style="font-size:14px;font-weight:600">status atual:</span> ${badgeHtml(c.status)}</div>
        <div class="no-print">
          ${!podeCancelarCarga() ? ''
            : c.status === 'Seguiu Viagem'
              ? '<span class="text-dim" style="font-size:12px" title="Carga já concluída: o histórico do pátio não se apaga por aqui — precisa de correção direta no banco.">Não é possível cancelar (já concluída)</span>'
              : botaoCancelarHtml(c)}
        </div>
      </div>
      <div class="timeline-info-grid">
        ${infoLinhas.map(([k,v])=>`<div class="timeline-info-item"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
      </div>
      <div class="timeline">
        ${passos.map((p,i)=>{
          const meta = STATUS_META[p.status] || {};
          const cls = p.feito ? (i===idxAtual ? 'done current' : 'done') : 'pending';
          const detalhe = p.feito
            ? `<div class="timeline-quando">${fmtDataHora(p.mov.timestamp)}</div>
               <div class="timeline-quem">${esc(p.mov.operador)} · ${esc(p.mov.setor)}</div>`
            : `<div class="timeline-quem text-dim">Ainda não ocorreu</div>`;
          return `<div class="timeline-step ${cls}">
            <div class="timeline-dot">${p.feito ? '✓' : ''}</div>
            <div class="timeline-content">
              <div class="timeline-status">${esc(p.status)}</div>
              ${detalhe}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

/* ---------- HISTÓRICO ---------- */
/* Log SEM tamanho máximo: cada mudança de status de cada carga, pra sempre.
   Diferente da Frota (importação parada em 749 placas), este array só
   cresce — todo dia de operação soma mais linhas. Não tinha limite nenhum
   (nem no desktop): a mesma classe de bug do estouro achado na Frota
   (auditoria "refinamento em TODAS AS ABAS", 08/08/2026), só que sem teto —
   ia piorar sozinho com o tempo, mesmo sem nenhuma mudança de código.
   Ordenado do mais recente pro mais antigo, então cortar em N mantém
   exatamente o que a auditoria (a busca de verdade) serve: o mais relevante
   primeiro; procurar mais fundo é o que o filtro por placa/setor é para. */
function renderHistorico(){
  const filtroPlaca = normalizarPlaca(document.getElementById('hist-filtro-placa')?.value || '');
  const filtroSetor = document.getElementById('hist-filtro-setor')?.value || '';
  let lista = DB.movimentacoes.slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  if(filtroPlaca) lista = lista.filter(m=>m.placa.includes(filtroPlaca));
  if(filtroSetor) lista = lista.filter(m=>m.setor===filtroSetor);
  const mobile = window.matchMedia && window.matchMedia('(max-width:560px)').matches;
  const LIMITE = mobile ? 40 : 500;
  const exibidos = lista.slice(0, LIMITE);
  document.getElementById('hist-tbody').innerHTML = exibidos.map(m=>`
    <tr>
      <td>${fmtDataHora(m.timestamp)}</td><td>${esc(m.placa)}</td>
      <td>${m.statusAnterior ? badgeHtml(m.statusAnterior) : '—'}</td><td>${badgeHtml(m.statusNovo)}</td>
      <td>${esc(m.operador)}</td><td>${esc(m.setor)}</td>
    </tr>`).join('');
  document.getElementById('hist-empty').hidden = lista.length>0;
  const contagemEl = document.getElementById('hist-contagem');
  if(contagemEl){
    contagemEl.textContent = lista.length > LIMITE
      ? `Mostrando as ${LIMITE} mais recentes de ${lista.length} — use os filtros pra ver outras.`
      : (lista.length ? `${lista.length} movimentação(ões).` : '');
  }
}

/* Calendário: clicar em QUALQUER ponto do campo abre a janelinha.

   Pedido do usuário (11/08/2026): "quero que apareca um calendariozinho
   nas abas de filtragem por data... como uma janelinha de calendario
   onde a pessoa pode navegar por dia mes ano".

   A janelinha sempre existiu — é o seletor nativo do <input type="date">,
   com navegação por dia, mês e ano. O que faltava era chegar até ela:
   o ícone era desenhado em preto sobre o painel escuro (invisível, ver
   styles.css) e só ele abria o calendário. Quem não sabia digitava a
   data à mão, campo a campo.

   `showPicker()` é a API que abre o seletor nativo por código. Onde ela
   não existe (Safari mais antigo), o clique no ícone continua
   funcionando como sempre — por isso o try/catch silencioso: nada
   quebra, só não ganha o atalho.

   Usa captura no documento, e não um listener por campo, porque a
   maioria dos campos de data nasce e morre com o re-render das abas —
   um listener por elemento teria que ser reinstalado a cada render. */
function ligarCalendarioNosCamposDeData(){
  document.addEventListener('click', (ev)=>{
    const campo = ev.target.closest && ev.target.closest('input[type="date"]');
    if(!campo || campo.disabled || campo.readOnly) return;
    if(typeof campo.showPicker !== 'function') return;
    try{ campo.showPicker(); }
    catch(e){ /* alguns navegadores exigem gesto direto no ícone; segue o nativo */ }
  });
}

/* ---------- RELATÓRIOS (PDF gerado pelo servidor) ---------- */
/* Até 09/08/2026 o PDF saía via `window.print()` — cada aparelho decidia
   sozinho o tamanho final da página. Provado nesta mesma investigação (com
   PDFs reais, medidos byte a byte) que isso quebra: sem o motor de
   impressão do usuário respeitar `@page{size:A4 landscape}`, o relatório
   sai em Carta americana e quebra em páginas a mais — e cada aparelho
   (Chrome desktop, Safari/AirPrint no iPhone, apps de PDF no Android) pode
   decidir diferente. Pedido do usuário: "eu quero que saia no modo
   paisagem, e saiam iguais os relatorios que forem exportados tanto no ios
   ou android ou desktop".

   A correção: o SERVIDOR renderiza o PDF (backend/src/rotas/relatorios.js)
   com um Chromium que ele mesmo controla, pedindo A4 paisagem como
   PARÂMETRO da chamada — não mais uma sugestão de CSS que o aparelho do
   operador pode ignorar. O HTML/CSS enviado é exatamente o que este
   arquivo já construía para `window.print()`; só o "vira arquivo" que
   mudou de lugar. Isso também elimina de vez a necessidade de detectar
   "celular ignorou a orientação pedida" (a antiga variável `emPe`): a
   orientação agora é decidida por nós, sempre, não pelo aparelho. */
/* Encolhe o relatório pra caber numa página só, em vez de estourar pra
   uma segunda página quase vazia. Pedido direto do usuário (08/08/2026):
   "quero que os relatorios sejam one pagers... coloca tudo dentro de uma
   pagina só". */
function ajustarParaCaberEmUmaPagina(el){
  const pagina = el.querySelector('.print-page');
  if(!pagina) return;
  pagina.style.transform = '';
  pagina.style.transformOrigin = '';
  el.style.height = '';
  el.style.overflow = '';

  const PX_POR_MM = 96 / 25.4;
  const MARGEM_MM = 5; // @page{margin:5mm} em styles.css
  // A4 SEMPRE paisagem (297×210mm) — o servidor é quem gera o PDF agora e
  // sempre pede paisagem explicitamente (ver relatorios.js), então não há
  // mais "celular que imprime em pé" a compensar aqui.
  const larguraFolhaMm = 297 - MARGEM_MM*2;
  const alturaFolhaMm  = 210 - MARGEM_MM*2;

  // A largura do relatório é sempre calibrada pra folha deitada (287mm =
  // 297mm - 2×5mm de margem) — trava isso explicitamente, pra não
  // depender de o navegador ter resolvido a folha deitada ou em pé antes
  // desta medição.
  pagina.style.width = '287mm';

  const escalaLargura = Math.min(1, (larguraFolhaMm*PX_POR_MM) / pagina.scrollWidth);
  const escalaAltura  = Math.min(1, (alturaFolhaMm*PX_POR_MM) / pagina.scrollHeight);
  const escala = Math.max(0.5, Math.min(escalaLargura, escalaAltura));

  // Abaixo de 0,5% de diferença é arredondamento de sub-pixel, não
  // conteúdo estourando de verdade — sem este piso, uma carga que cabe
  // por pouco ganhava um scale(0.9997...) tecnicamente correto mas sem
  // efeito visível nenhum, só ruído no teste e no DOM.
  if(escala < 0.995){
    pagina.style.transform = `scale(${escala})`;
    pagina.style.transformOrigin = 'top left';

    /* PÁGINAS EM BRANCO SOBRANDO (achado pelo usuário, 08/08/2026, PDF
       real de celular): "transform:scale()" só encolhe o DESENHO — o
       motor de impressão pagina com base na altura de LAYOUT da caixa,
       que o transform NÃO muda. Uma .print-page com 500mm de altura
       original, escalada pra caber visualmente em 1 página de 287mm,
       continua "ocupando" 500mm no fluxo do documento pra fins de
       paginação — o motor fatia esse excedente em páginas extras.

       A CORREÇÃO (travar a altura do container pai na altura já escalada,
       com overflow:hidden) só é SEGURA quando o conteúdo escalado cabe
       INTEIRO numa página. Testado à parte, fora deste arquivo, antes de
       decidir isso: quando o container precisa mesmo de 2+ páginas (o
       piso de 50% de legibilidade não bastou pra caber tudo numa só), a
       MESMA técnica — container com altura fixa + overflow:hidden sendo
       fatiado pelo motor de impressão em mais de uma página — perde
       conteúdo de verdade (não só sobra branco: o motor de impressão
       não repagina corretamente um container com overflow:hidden cortado
       ao meio; testei com marcadores de texto em posições conhecidas e o
       do meio simplesmente sumiu, em nenhuma das páginas geradas).

       Por isso o travamento só entra quando cabe tudo numa página só
       (com pequena folga de arredondamento). Quando não cabe, o relatório
       volta ao comportamento anterior — algumas páginas podem sobrar
       quase em branco no fim, mas ISSO é preferível a perder uma linha
       real do relatório. Sem dado perdido é inegociável; página sobrando
       num caso raro e denso é o mal menor, e já era o comportamento
       aceito antes desta sessão (ver o comentário do piso de 50% acima:
       "a prioridade muda de 'cabe numa página' pra 'dá pra ler alguma
       coisa'" — nunca foi "a qualquer custo, mesmo perdendo dado"). */
    const alturaEscaladaPx = pagina.scrollHeight * escala;
    const folgaPx = 1; // arredondamento de sub-pixel, não estouro de verdade
    if(alturaEscaladaPx <= alturaFolhaMm*PX_POR_MM + folgaPx){
      el.style.height = alturaEscaladaPx + 'px';
      el.style.overflow = 'hidden';
    }
  }
}
/* Já não existe window.print() neste fluxo (ver exportarViaServidor logo
   abaixo) — ajustarParaCaberEmUmaPagina() agora é chamada direto, sem
   depender do evento 'beforeprint'. */

/* Substitui window.print(): monta o mesmo HTML que sempre foi montado,
   manda pro servidor gerar o PDF de verdade (A4 paisagem garantido) e
   baixa o arquivo pronto. */
async function exportarViaServidor(el, nomeDoRelatorio){
  if(!SuincoSharePoint || !SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()){
    notify('Exportar relatório exige conexão com o servidor — é o que garante que o PDF sai sempre igual, em qualquer aparelho.', 'warn', 6000);
    return;
  }

  document.querySelectorAll('.print-only').forEach(x=>x.style.display='none');
  el.style.display = 'block';
  /* NÃO encolhe mais (11/08/2026). `ajustarParaCaberEmUmaPagina` existia
     para o tempo em que o navegador do operador imprimia: ela aplicava
     transform:scale() para tentar caber na folha.

     Com o servidor gerando o PDF, isso passou a ESTRAGAR o resultado, e o
     usuário mandou o PDF provando: transform só encolhe o DESENHO — a
     altura de LAYOUT continua a original. O conteúdo saía miniaturizado
     no canto superior esquerdo (ancorado em transform-origin:top left) e
     o motor de impressão AINDA quebrava nas páginas da altura não
     escalada. Daí "1/4 da página e 3 folhas em branco".

     Agora o conteúdo é montado na largura real da folha e o servidor
     pagina naturalmente: enche a página, quebra quando precisa, sem
     miniatura e sem folha vazia. */

  const d = new Date();
  const carimbo = [
    d.getFullYear(),
    String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0')
  ].join('-') + '_' + String(d.getHours()).padStart(2,'0') + 'h' + String(d.getMinutes()).padStart(2,'0');
  // Sem acento, espaço ou barra: o nome vira arquivo, e cada sistema
  // operacional estraga esses caracteres de um jeito diferente.
  const limpo = (nomeDoRelatorio || 'Relatorio')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const nomeArquivo = `Suinco_${limpo}_${carimbo}`;

  const limpar = ()=>{
    el.style.display='none';
    // Desfaz o encolhimento de ajustarParaCaberEmUmaPagina — o container é
    // reaproveitado na próxima exportação, e a pré-visualização em tela
    // (se alguém abrir de novo) não deve ficar menor por causa disso.
    const pagina = el.querySelector('.print-page');
    if(pagina){ pagina.style.transform=''; pagina.style.transformOrigin=''; pagina.style.width=''; }
    el.style.height=''; el.style.overflow='';
  };

  notify('Gerando relatório em PDF…', 'info', 4000);
  try{
    // A folha de estilo é o único <style> do arquivo (build_arquivo_unico.py
    // embute tudo — CSS do painel inteiro + a fonte dos relatórios em
    // base64). Mandar o texto inteiro garante que o servidor desenha com
    // EXATAMENTE o mesmo CSS que o operador está vendo na pré-visualização,
    // sem risco de as duas cópias ficarem desalinhadas com o tempo.
    const css = (document.querySelector('style') || {}).textContent || '';
    const html = el.outerHTML;
    const blob = await SuincoSharePoint.gerarRelatorioPdf({ html, css, orientacao: 'retrato', nomeArquivo });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${nomeArquivo}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('Relatório baixado.', 'success');
  }catch(e){
    notify('Não consegui gerar o relatório: ' + (e && e.message || 'erro desconhecido'), 'danger', 7000);
  }finally{
    limpar();
  }
}
// PDF Operacional — sequenciamento de carregamento do dia, redesenhado pra
// bater visualmente com a planilha real que a operação usa hoje.
// DECISÃO: cargas ainda com a flag "Aguardando Carga" (dados incompletos,
// sem Rota/Nº de Carga — texto "Aguardando Carga" no campo Número da
// Carga) ficam de fora desta lista — elas aparecem na Torre de Controle e
// na fila de pendências da Programação, mas não fazem sentido numa
// planilha de sequenciamento de carregamento ainda sem dados.
const CORES_PRA_ONDE = { 'CROSS-DOCKING':'#374a86', 'ENTREGA DIRETA':'#8f1f26', 'RET FRIGO':'#b9903f' };

/* Busca o estado mais recente do servidor ANTES de montar qualquer
   relatório — pedido direto: "os relatórios são nossa fonte de verdade
   absoluta", e até aqui eles montavam a folha com o que já estava na
   MEMÓRIA do navegador no instante do clique, sem forçar nada novo. Isso
   é normalmente o dado certo (o painel sincroniza sozinho o tempo todo),
   mas "normalmente" não é "sempre": aba de celular em segundo plano,
   rede instável por alguns minutos, terminal que ficou aberto sem uso —
   qualquer um desses atrasa a sincronia, e o relatório saía com o
   resíduo de antes de uma exclusão/edição/criação que já tinha
   acontecido em outro lugar.

   pullTudo() é leitura completa (não incremental) — não é o ciclo de 15s
   de sempre, é forçado, aqui, agora, antes de montar a folha. Falha de
   rede não trava o relatório: o operador com o caminhão esperando não
   pode ficar sem o documento por causa de uma rede ruim por dois
   segundos — ele recebe o aviso e o relatório sai com o melhor dado que
   o terminal já tinha. */
async function atualizarDadosAntesDoRelatorio(){
  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.estaConfigurado()) return;
  try{
    notify('Buscando os dados mais recentes do servidor…', 'info', 2500);
    await SuincoSharePoint.pullTudo();
  }catch(e){
    console.warn('[Suinco] não foi possível atualizar antes do relatório:', e);
    notify('Não consegui confirmar com o servidor agora — o relatório sai com os dados '
         + 'mais recentes que este aparelho já tinha. Confira a conexão e gere de novo se puder.',
           'warn', 9000);
  }
}
// ORDEM DAS COLUNAS: os três campos de estado da carga vêm PRIMEIRO, na
// ordem em que a linha do tempo acontece — Status (a etapa dos 6), depois
// Status de Carregamento (a leitura do pátio) e por fim Faturado. Antes o
// Status ficava no meio da tabela, entre "Tipo de Operação" e "Placa", e quem
// lia a folha precisava caçar a informação mais importante no meio das
// colunas de cadastro. Identificação e cadastro (Seq., Carga, Destino, Rota,
// Placa, Transportadora...) vêm depois, porque respondem "qual carga é",
// não "em que pé ela está".
async function exportarPdfOperacional(){
  await atualizarDadosAntesDoRelatorio();
  const el = document.getElementById('print-operacional');
  // TODAS as cargas da programação do dia, INCLUSIVE as já concluídas
  // ("Seguiu Viagem"). Antes usava cargasAbertas(), que exclui as concluídas,
  // e a carga sumia do relatório justamente quando o processo terminava.
  // Esse relatório é atualizado num grupo de WhatsApp ao longo do dia inteiro,
  // acompanhando o fluxo de carregamento: a linha precisa continuar visível,
  // mudando de cor conforme avança, até o fim do dia. Some só quando a carga
  // deixa de existir.
  // Segue de fora apenas o que a Portaria registrou sem programação prévia
  // (aguardandoCarga), que ainda não tem dados para sequenciar.
  // Respeita o filtro de Data da Programação da aba Relatórios.
  const lista = cargasDoRelatorio().slice().sort(ordenarPorEtapaDaTimeline);
  const linhas = lista.map((c)=>{
    const pesoTon = ((c.peso||0)/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const praOndeStyle = c.praOnde ? `style="background:${CORES_PRA_ONDE[c.praOnde]||'#e9b954'};color:#fff;font-weight:800"` : '';
    // Status real da carga (os 6), com o preenchimento sólido da escala do
    // gestor — é o que permite ler o andamento do dia de relance na foto
    // mandada no grupo.
    const cs = corStatusRelatorio(c.status);
    /* Classe por coluna, não posição.

       As larguras eram definidas por nth-child, calibradas quando a tabela
       tinha 16 colunas. Ao remover três, toda largura passou a cair na
       coluna errada — o Status ficou com os 5% que eram do "Faturado" e
       espremia "Aguardando Embarque" em duas linhas. Com classe, mover ou
       remover coluna não desalinha mais nada. */
    return `<tr>
      <td class="c-seq">${c.sequencia ?? '—'}</td>
      <td class="c-carga">${esc(c.numeroCarga).toUpperCase()||'—'}</td>
      <td class="c-status" style="background:${cs.fundo};color:${cs.texto}">${esc(c.status)}</td>
      <td class="c-rota">${esc(rotaCurta(c.rota))}</td>
      <td class="c-operacao" ${praOndeStyle}>${c.praOnde ? esc(PRA_ONDE_LABEL[c.praOnde]) : '—'}</td>
      <td class="c-placa">${esc(c.placa).toUpperCase()}</td>
      <td class="c-transp">${esc(c.transportadora)||'—'}</td>
      <td class="c-veiculo">${esc(c.tipoVeiculo)||'—'}</td>
      <td class="c-peso">${pesoTon}</td>
      <td class="c-palet">${paletizadaDaCarga(c)}</td>
      <td class="c-entregas">${c.qtdEntregas ?? 1}</td>
      <td class="c-ganchos">${c.qtdGanchos ? c.qtdGanchos : '<span class="liso">Liso</span>'}</td>
    </tr>`;
  }).join('');
  const agora = new Date();
  const concluidas = lista.filter(c=>c.status==='Seguiu Viagem').length;
  el.innerHTML = `
    <div class="print-page doc-denso">
      ${cabecalhoDocumento({
        titulo: 'Relatório Operacional',
        subtitulo: 'Logística — ordem de montagem e acompanhamento no pátio',
      })}
      <!-- A legenda de cores saiu daqui também (05/08/2026).

           Eu tinha defendido mantê-la, porque a foto vai para o grupo do
           WhatsApp e quem recebe não teria como saber o que cada cor
           significa. O gestor decidiu pela remoção, e o argumento dele é
           melhor: a coluna Status traz o nome da etapa POR EXTENSO em cada
           linha. A cor é reforço, não a informação — a legenda explicava
           algo que já estava escrito. -->
      <table>
        <thead><tr>
          <th class="c-seq">Seq.</th>
          <th class="c-carga">Nº Carga</th>
          <th class="c-status">Status</th>
          <th class="c-rota">Rota</th>
          <th class="c-operacao">Tipo de Operação</th>
          <th class="c-placa">Placa</th>
          <th class="c-transp">Transportadora</th>
          <th class="c-veiculo">Tipo de Veículo</th>
          <th class="c-peso">Peso (ton)</th>
          <!-- Rótulos abreviados, e não por economia de espaço: nesta
               largura o navegador quebrava a palavra ao meio e saía
               "Paletizad a" e "Entrega s" na folha. Rótulo partido parece
               erro de digitação num documento que vai para reunião.
               O significado vai no rodapé. -->
          <th class="c-palet">Palet.</th>
          <th class="c-entregas">Entr.</th>
          <th class="c-ganchos">Ganchos</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="13" class="text-center text-dim">Nenhuma carga no período selecionado.</td></tr>'}</tbody>
        ${lista.length ? `<tfoot>${rodapeSomatorios(lista, 8, ['peso','', 'entregas','ganchos'])}</tfoot>` : ''}
      </table>
      <!-- Nota de rodapé enxugada.

           A anterior tinha cinco linhas explicando decisões de projeto —
           por que tal coluna saiu, o que a cor significa. Isso interessa a
           quem mantém o sistema, não a quem lê a folha no pátio. O que
           sobra é a única coisa que o leitor precisa saber e não consegue
           deduzir olhando a tabela. -->
      ${rodapeDocumento(
        'Todas as cargas da programação aparecem, em qualquer status — as concluídas ' +
        'continuam na lista para o acompanhamento do dia inteiro.<br>' +
        '<strong>Palet.</strong> = carga paletizada · <strong>Entr.</strong> = quantidade de ' +
        'entregas · <strong>Liso</strong> = sem gancheira.',
        'Todas as cargas do período selecionado, ordenadas pela etapa em que '
        + 'se encontram e, dentro de cada etapa, pela sequência de carregamento '
        + 'definida pela Logística. Cargas excluídas ou canceladas não entram.',
        fichaDocumento({
          titulo: 'Relatório Operacional',
          contagem: lista.length,
          extra: `<strong>Concluídas:</strong> ${concluidas} de ${lista.length}`,
        }))}
    </div>`;
  await exportarViaServidor(el, 'Relatorio-Operacional');
}

/* ---------- EXPORT POWER BI (CSV) ----------
   Dispara o download dos 5 CSVs (fato/dimensão) gerados em data.js.
   Ponte temporária — ver docs/POWERBI_EXPORT.md. */
function baixarArquivoTexto(nome, conteudo){
  const BOM = '﻿'; // BOM UTF-8 — Excel PT-BR abre acentuação corretamente
  const blob = new Blob([BOM + conteudo], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
function exportarCsvPowerBI(){
  const arquivos = gerarArquivosCsvPowerBI();
  arquivos.forEach((f,i)=>{
    setTimeout(()=>baixarArquivoTexto(f.nome, f.conteudo), i*250);
  });
  notify(`Exportando ${arquivos.length} arquivos CSV (fato/dimensão) para Power BI…`, 'success');
}

/* =====================================================================
   PADRÃO DE DOCUMENTO DOS RELATÓRIOS
   =====================================================================

   Os três relatórios passam a ter o mesmo cabeçalho e o mesmo rodapé. Isso
   não é estética: documento logístico circula fora do sistema — vai para o
   grupo, para o e-mail da transportadora, para a pasta do faturamento — e
   precisa se identificar sozinho. Quem recebe uma folha solta tem que
   saber o que é, de quando, de que recorte e quem gerou, sem perguntar.

   DENSIDADE POR RELATÓRIO. O Operacional tem 13 colunas e só cabe em A4
   deitado com letra pequena; o de Fretes tem 3 e sobra papel. Usar a mesma
   densidade nos dois — que era o caso — deixa o de Fretes ilegível para
   economizar espaço que ninguém estava usando.

     doc-denso   → Operacional: A4 deitado, 13 colunas
     doc-normal  → Executivo: A4 deitado, blocos e tabelas médias
     doc-amplo   → Fretes: A4 em pé, 3 colunas, leitura confortável
*/
/* ====================================================================
   PADRÃO DE DOCUMENTO — estrutura de relatório de auditoria
   ====================================================================
   Os três relatórios circulam fora do pátio: vão para a diretoria, para
   reunião com transportadora e para grupo de WhatsApp. Documento sem
   procedência é documento que alguém contesta na primeira divergência.

   A estrutura segue o que firmas de auditoria usam, e cada peça responde
   a uma pergunta que sempre aparece:

     Referência        "de qual emissão estamos falando?"
     Base de preparação "o que exatamente foi contado?"
     Fonte              "de onde veio esse número?"
     Emitido por        "quem gerou?"
     Classificação      "posso encaminhar isto?"
     Página X de Y      "está faltando folha?"

   Nada aqui muda cálculo. É procedência. */

/* Referência do documento: SUI-OPE-20260806-1432.

   Serve para citar uma emissão específica em e-mail ou ata. Dois relatórios
   do mesmo dia, com números diferentes, deixam de ser "aquele relatório" e
   passam a ter nome — que é a diferença entre resolver a divergência e
   discutir sobre ela. */
function referenciaDocumento(titulo){
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  const sigla = {
    'Relatório Operacional': 'OPE',
    'Relatório Executivo':   'EXE',
    'Administração de Fretes':'ADM',
  }[titulo] || 'DOC';
  return `SUI-${sigla}-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`
       + `-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* Identificação do documento em UMA LINHA, logo abaixo do cabeçalho.

   PERCURSO ATÉ AQUI, porque a peça foi de tabela a nada em três passos:

   1. Tabela de duas colunas por seis linhas, abaixo do cabeçalho. Correta
      e custando um quinto da primeira folha antes de qualquer dado.
   2. Uma linha corrida no mesmo lugar. Melhor, mas ainda entre o título e
      o primeiro número.
   3. Fora do cabeçalho. Referência, período, registros e observação são
      dados de CONFERÊNCIA — quem confere lê uma vez, quem decide não lê
      nunca. Ficam no rodapé, com o resto da procedência.

   O que sobra no alto é o que identifica o documento numa foto: marca,
   título, subtítulo e classificação. Nada mais. */
/* Quando e por quem — em destaque no cabeçalho, não só no rodapé.

   A ficha do rodapé (fichaDocumento) já tinha essa informação, mas em
   corpo pequeno, embaixo de tudo — quem abre o PDF pra conferir "isso é de
   agora ou é o de ontem?" precisa rolar a folha inteira pra achar. Pedido
   direto: precisa estar claro no nível do relatório, não escondido no
   rodapé. Repete o mesmo dado (não substitui a ficha, que também tem
   Referência/Período/Registros), no canto onde o olho já procura em
   qualquer memorando — ao lado do título, junto do selo "Uso interno". */
function cabecalhoDocumento({ titulo, subtitulo }) {
  const operador = (DB.operador && DB.operador.nome) || '—';
  const setor = (DB.operador && DB.operador.setor) || '';
  return `
    <div class="doc-cabecalho">
      <img src="assets/logo_suinco.png" alt="Suinco" class="doc-logo">
      <div class="doc-identidade">
        <div class="doc-empresa">SUINCO — Cooperativa Agroindustrial</div>
        <h1 class="doc-titulo">${esc(titulo)}</h1>
        ${subtitulo ? `<div class="doc-subtitulo">${esc(subtitulo)}</div>` : ''}
      </div>
      <div class="doc-cabecalho-meta">
        <div class="doc-classificacao">Uso interno</div>
        <div class="doc-gerado-em">
          <span class="doc-gerado-quando">${esc(fmtDataHora(new Date().toISOString()))}</span>
          <span class="doc-gerado-quem">${esc(operador)}${setor ? ' · ' + esc(setor) : ''}</span>
        </div>
      </div>
    </div>`;
}

/* Ficha de identificação, no pé do documento.

   "Emitido em" e "Emitido por" perderam os rótulos: uma data com hora e um
   nome de pessoa não precisam de etiqueta para serem reconhecidos. O que
   os rótulos faziam era ocupar duas larguras de coluna para dizer o óbvio.

   Os que ficaram — Entidade, Referência, Período, Registros — nomeiam
   coisas que NÃO se identificam sozinhas: "SUI-EXE-20260806-1744" sem a
   palavra "Referência" é ruído, e um número solto não diz se são cargas,
   dias ou quilos. */
function fichaDocumento({ titulo, contagem, extra }) {
  const agora = new Date();
  const operador = (DB.operador && DB.operador.nome) || '—';
  const setor = (DB.operador && DB.operador.setor) || '';

  const campos = [
    ['Entidade',   'Suinco — Cooperativa Agroindustrial'],
    ['Referência',  referenciaDocumento(titulo)],
    ['Período',     rotuloPeriodoRelatorio()],
    contagem !== undefined ? ['Registros', String(contagem)] : null,
  ].filter(Boolean);

  return `
    <div class="doc-ficha">
      <div class="doc-ficha-campos">
        ${campos.map(([r,v])=>`
          <div class="doc-ficha-campo">
            <span class="doc-ficha-rot">${esc(r)}</span>
            <span class="doc-ficha-val">${esc(v)}</span>
          </div>`).join('')}
      </div>
      <div class="doc-ficha-emissao">
        <span class="doc-ficha-quando">${esc(fmtDataHora(agora.toISOString()))}</span>
        <span class="doc-ficha-quem">${esc(operador)}${setor ? ' · ' + esc(setor) : ''}</span>
      </div>
      ${extra ? `<div class="doc-ficha-obs">${extra}</div>` : ''}
    </div>`;
}

/* Nota de fonte, no pé de cada tabela.

   "De onde veio esse número?" é a primeira pergunta em qualquer reunião
   onde o número desagrada. Respondida no próprio documento, a discussão
   passa direto para o que fazer a respeito. */
function fonteDocumento(texto){
  return `<div class="doc-fonte">Fonte: ${texto}</div>`;
}

/* A "Base de preparação" desceu para cá (06/08/2026).

   É um parágrafo de três linhas explicando O QUE FOI CONTADO. Informação
   necessária — é a diferença entre "o número está errado" e "o número
   responde outra pergunta" — mas ninguém a lê ANTES do número; lê depois,
   quando o número desagrada.

   Estava entre o cabeçalho e o primeiro dado, empurrando o conteúdo folha
   abaixo em todos os três relatórios. No rodapé cumpre a mesma função, ao
   lado da nota de alcance e limitações, que é a seção do mesmo assunto. */
function rodapeDocumento(nota, base, ficha){
  return `<div class="doc-rodape">
      ${nota ? `<div class="doc-nota">${nota}</div>` : ''}
      ${ficha || ''}
      ${base ? `<div class="doc-base"><strong>Base de preparação.</strong> ${base}</div>` : ''}
      <div class="doc-limitacoes">
        <strong>Alcance e limitações.</strong> Documento gerado automaticamente a
        partir dos registros operacionais do pátio, na data e hora de emissão
        indicadas acima. Reflete o que foi registrado pelos setores até aquele
        instante; registros feitos sem conexão sobem quando a rede retorna e podem
        alterar números de emissões anteriores. Não constitui documento fiscal
        nem contábil.
      </div>
      <div class="doc-assinatura">
        Programação de Embarque Suinco · embarquesuinco.com.br
        <span class="doc-pagina"></span>
      </div>
    </div>`;
}

/* Título de seção do PDF — mesma marcação repetida várias vezes no executivo. */
function tituloSecaoPdf(texto, sub){
  return `<div class="print-secao">
      <div class="print-secao-tit">${texto}</div>
      ${sub ? `<div class="print-secao-sub">${sub}</div>` : ''}
    </div>`;
}

/* Tabela de distribuição por status, com a cor de cada status.
   A cor é a MESMA da badge da tela (STATUS_COR_RELATORIO em data.js) — o
   gestor lê o PDF com o mesmo código de cores do painel. */
/* `ocultarZerados` existe para o bloco de concluídas.

   Nas cargas EM ABERTO, etapa vazia é informação: "nenhuma carga parada em
   Faturamento" diz algo ao gestor. Nas CONCLUÍDAS não: por definição elas
   estão todas em "Seguiu Viagem", então os outros cinco status saem sempre
   zerados e enchem meia página com linhas que não dizem nada. */
function blocoDistribuicaoStatus(dist, total, titulo, explicacao, ocultarZerados){
  if(ocultarZerados) dist = dist.filter(d => d.qtd > 0);
  if(ocultarZerados && !dist.length){
    return tituloSecaoPdf(titulo, explicacao) +
      `<div class="print-vazio">Nenhuma carga concluída no período.</div>`;
  }
  return tituloSecaoPdf(titulo, explicacao) +
    `<table>
      <thead><tr><th>Status</th><th>Setor responsável</th><th>Cargas</th><th>% do total</th><th>Distribuição</th></tr></thead>
      <tbody>
        ${dist.map(d=>`
          <tr>
            <td><span class="status-pill" style="background:${d.cor.fundo};color:${d.cor.texto};border-color:${d.cor.borda}">${esc(d.status)}</span></td>
            <td class="text-dim">${esc(d.setor)}</td>
            <td class="num-forte">${d.qtd}</td>
            <td>${total ? d.pct + '%' : '—'}</td>
            <td class="barra-cel">
              <span class="barra-trilho"><span class="barra-preenche" style="width:${d.pct}%;background:${d.cor.destaque}"></span></span>
            </td>
          </tr>`).join('')}
      </tbody>
      <tfoot><tr><th>Total</th><th></th><th class="num-forte">${total}</th><th>${total ? '100%' : '—'}</th><th></th></tr></tfoot>
    </table>`;
}

/* Linha do tempo das cargas no relatório executivo.
   Formato de matriz — uma linha por carga, uma coluna por etapa do fluxo —
   em vez de repetir a timeline vertical da tela para cada carga: assim o
   gestor compara as cargas entre si e enxerga de imediato onde uma delas
   travou. Cada célula traz a HORA e o OPERADOR que registrou aquele passo
   (pedido explícito: "qual operador fez o input"), com a cor do status.
   Etapa não ocorrida fica visivelmente vazia — é o que denuncia o gargalo. */
function blocoTimelineCargas(cargas, titulo, explicacao){
  if(!cargas.length){
    return tituloSecaoPdf(titulo, explicacao) +
      `<div class="print-vazio">Nenhuma carga no recorte deste relatório.</div>`;
  }
  const linhas = cargas.map(c=>{
    const historico = historicoDaCarga(c.id);
    const sequencia = sequenciaDeStatusDaCarga(historico);
    const ind = indicadoresDaCarga(c.id);
    const celulas = STATUS_FLOW.map(status=>{
      // Carga que nasceu em "Aguardando Carga" nunca teve "Aguardando
      // Veículo" — marcamos como não aplicável em vez de fingir atraso.
      if(!sequencia.includes(status)){
        return `<td class="tl-cel tl-na" title="Etapa não aplicável a esta carga">n/a</td>`;
      }
      const mov = historico.find(m=>m.statusNovo===status);
      if(!mov) return `<td class="tl-cel tl-pendente">—</td>`;
      const cor = corStatusRelatorio(status);
      /* A cor do texto vai na CÉLULA, não só na hora.

         O operador e o setor usavam cor fixa do tema e sumiam sobre as
         células escuras — "Seguiu Viagem" é verde-escuro, e nome do
         operador em cor de texto claro do tema desaparecia na folha. Com a
         cor no `td`, as três linhas herdam o par certo de fundo e texto. */
      return `<td class="tl-cel" style="background:${cor.fundo};color:${cor.texto};border-left:3px solid ${cor.borda}">
          <span class="tl-hora">${fmtHora(mov.timestamp)}</span>
          <span class="tl-quem">${esc(mov.operador)}</span>
          <span class="tl-setor">${esc(mov.setor)}</span>
        </td>`;
    }).join('');
    return `<tr>
        <td class="tl-carga">
          <span class="tl-placa">${esc(c.placa)}</span>
          <span class="tl-num">${esc(c.numeroCarga || '—')}</span>
          <span class="tl-transp">${esc(c.transportadora || '—')}</span>
        </td>
        ${celulas}
        <td class="tl-total">${fmtDuracao(ind.tempoPatioTotal)}</td>
      </tr>`;
  }).join('');

  return tituloSecaoPdf(titulo, explicacao) +
    `<table class="tabela-timeline">
      <thead>
        <tr>
          <th>Carga</th>
          ${STATUS_FLOW.map(s=>{
            const cor = corStatusRelatorio(s);
            /* A cor do status vira SUBLINHADO, não cor do texto.

               No papel o cabeçalho tem fundo claro, e `cor.texto` é a cor
               feita para ir SOBRE o fundo colorido do status — clara. Clara
               sobre claro é texto invisível, e foi exatamente o que saiu na
               folha: "Aguardando Veículo" e "Seguiu Viagem" sumiram.

               Com o sublinhado, a coluna continua codificada por cor e o
               texto fica legível nos dois fundos. */
            return `<th style="border-bottom:3px solid ${cor.fundo}">`
                 + `<span class="tl-th">${esc(s)}</span></th>`;
          }).join('')}
          <th>Pátio</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
    <div class="print-legenda">
      Cada célula mostra a <strong>hora</strong> e o <strong>operador</strong> que registrou a etapa, com o setor abaixo.
      <strong>—</strong> = etapa ainda não ocorrida · <strong>n/a</strong> = etapa não aplicável (carga registrada direto no pátio, sem programação prévia).
      <strong>Pátio</strong> = tempo entre a chegada física e a saída.
    </div>`;
}

async function exportarPdfExecutivo(){
  await atualizarDadosAntesDoRelatorio();
  const el = document.getElementById('print-executivo');
  const agora = new Date();

  /* Respeita o mesmo filtro de Data da Programação dos outros relatórios.
     Antes o executivo ignorava o filtro e saía sempre com tudo — o gestor
     recortava o período, gerava, e recebia um relatório de outro recorte
     sem nenhum aviso. */
  const doPeriodo = cargasDoRelatorio();
  const abertas = doPeriodo.filter(c=>c.status!=='Seguiu Viagem');

  /* Caminhões que a Portaria registrou SEM programação prévia
     (aguardandoCarga) precisam de conta própria, e o motivo é um bug real
     achado na auditoria de 11/08/2026: o indicador "Aguardando Dados da
     Carga" era calculado sobre `abertas`, que vem de cargasDoRelatorio()
     — e essa função exclui aguardandoCarga de propósito. O número era,
     por construção, SEMPRE ZERO.

     Pior que um número errado: um número que parece tranquilizador. O
     gestor lia "0 aguardando dados" com dois caminhões parados no pátio
     sem nota, ocupando doca, esperando alguém completar o cadastro.

     Ficam fora da LISTA do relatório (não há o que sequenciar sem número
     de carga, peso nem rota — esse critério continua certo), mas entram
     na CONTAGEM, que é o que responde "o que está me travando agora". */
  const { de: _relDe, ate: _relAte } = periodoRelatorio();
  const aguardandoDados = filtrarPorDataProgramacao(
    DB.cargas.filter(c=>c.aguardandoCarga), _relDe, _relAte);
  const concluidasTodas = doPeriodo.filter(c=>c.status==='Seguiu Viagem');
  const concluidasHoje = concluidasTodas;

  // Lead time médio do histórico completo (mesma conta da versão anterior).
  let somaLead=0, nLead=0;
  concluidasTodas.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    if(ind.leadTimeTotal!==null){ somaLead+=ind.leadTimeTotal; nLead++; }
  });
  // Lead time médio só do dia — é o número que o gestor cobra na reunião.
  let somaHoje=0, nHoje=0;
  concluidasHoje.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    if(ind.leadTimeTotal!==null){ somaHoje+=ind.leadTimeTotal; nHoje++; }
  });

  const distAbertas = distribuicaoPorStatus(abertas);
  const distHoje = distribuicaoPorStatus(concluidasHoje);

  /* Quantas cargas AINDA ABERTAS já passaram da meta de pátio.
     É o número que decide a manhã do gestor, e por isso ocupa a primeira
     casa do painel. Conta sobre a mesma meta usada no resto do relatório
     (metaTempoPatio), para que dois números do mesmo documento não
     discordem entre si.

     Conta sobre TODAS as abertas, e não sobre analiseGargalos().pendentesAntigas
     — essa lista é cortada em dez para caber na folha, e um indicador que
     empaca em "10" quando há quinze cargas travadas engana justamente no
     dia em que o gestor mais precisa dele. */
  const metaPatio = metaTempoPatio();
  const agoraMs = Date.now();
  const paradasAlemDaMeta = abertas.filter(c =>
    (agoraMs - (Date.parse(c.atualizadoEm || c.criadoEm) || agoraMs)) / 60000 > metaPatio
  ).length;

  el.innerHTML = `
    <div class="print-page doc-normal">
      ${cabecalhoDocumento({
        titulo: 'Relatório Executivo',
        subtitulo: 'Logística — indicadores, gargalos e pontos críticos do pátio',
      })}

      <!-- A legenda de cores saiu daqui (05/08/2026).

           Ela faz sentido no relatório OPERACIONAL, que vira foto no grupo
           do WhatsApp para quem está no pátio sem o painel aberto e precisa
           saber o que cada cor significa.

           No executivo é ruído: o leitor é a diretoria, que olha número, e
           os chips coloridos logo abaixo do cabeçalho pareciam botões de
           filtro. A distribuição por status vem logo abaixo, com o nome do
           status escrito por extenso em cada linha. -->

      <!-- ORDEM DO DOCUMENTO: por decisão, não por tema.

           A versão anterior seguia a ordem natural de quem escreve um
           relatório: volume, depois médias, depois análise, e o que exige
           ação hoje aparecia na página três, no meio dos gargalos.

           Gestor de logística lê de cima para baixo e decide nos primeiros
           trinta segundos. A pergunta dele é "o que falta terminar?", não
           "como foi ontem?". A ordem agora responde nessa sequência:

             1. O QUE EXIGE AÇÃO AGORA — o que está travado e há quanto tempo
             2. ONDE ESTÁ A FILA      — em que etapa o pátio acumulou
             3. ONDE O TEMPO SE PERDE — média de pátio e gargalos do período
             4. HISTÓRICO             — o que já saiu, para conferência

           Concluída não some do relatório: desce. Ela serve para conferir e
           para fechar o dia, não para decidir. -->

      <div class="print-bloco-tit">1 · O que exige ação agora</div>

      <div class="grid4" style="margin-bottom:18px">
        <div class="stat-box"><div class="stat-num">${paradasAlemDaMeta}</div><div class="stat-label">Paradas Além da Meta</div></div>
        <div class="stat-box"><div class="stat-num">${aguardandoDados.length}</div><div class="stat-label">Aguardando Dados da Carga</div></div>
        <div class="stat-box"><div class="stat-num">${abertas.length}</div><div class="stat-label">Cargas em Aberto</div></div>
        <div class="stat-box"><div class="stat-num">${fmtDuracao(nHoje?Math.round(somaHoje/nHoje):null)}</div><div class="stat-label">Lead Time Médio (período)</div></div>
      </div>

      ${blocoPendentesAntigasPdf(doPeriodo)}

      <div class="print-bloco-tit">2 · Onde está a fila</div>

      ${painelStatusHorizontal(distAbertas, abertas.length,
        'Cargas em aberto por status',
        'Onde está parada, agora, cada carga que ainda não saiu. Leia da esquerda para a direita: é o caminho do caminhão pelo pátio, e um acúmulo mostra onde a fila está se formando.')}

      ${blocoTimelineCargas(abertas,
        'Linha do tempo — cargas ainda em aberto',
        'Carga a carga: as colunas vazias à direita mostram em qual etapa cada uma está parada agora, e quem registrou a última.')}

      <div class="print-bloco-tit">3 · Onde o tempo se perde</div>

      ${blocoTempoMedioPatioPdf(concluidasTodas)}

      ${blocoRankingAtrasoPdf(doPeriodo)}

      ${blocoGargalosPdf(doPeriodo)}

      <!-- A linha do tempo carga-a-carga das CONCLUÍDAS saiu daqui (08/08/2026).

           Pedido do usuário: "tem muita informação ali" — ele chegou a sugerir
           fundir esta tabela com a das cargas em aberto (seção 2), depois
           recuou e pediu pra eu achar a melhor solução usando a queixa real,
           não a sugestão literal.

           A tabela em matriz (uma linha por carga, uma coluna por etapa, com
           hora+operador em cada célula) é o formato certo pra decidir sobre
           cargas ABERTAS — é o que aparece na seção 2. Repeti-la aqui pras
           concluídas duplicava esse mesmo nível de detalhe operacional pra
           cargas que, pela própria lógica do documento (comentário "ORDEM DO
           DOCUMENTO" acima), servem só pra "conferir e fechar o dia, não pra
           decidir". Era a seção mais pesada do relatório (uma tabela inteira
           de 8 colunas) resolvendo a pergunta de menor prioridade.

           Ficou só blocoDistribuicaoStatus: quantas cargas saíram e quando —
           a pergunta que "conferência" realmente faz. Quem precisa do
           carga-a-carga de uma concluída específica busca ela no Histórico
           (que já tem timeline vertical por carga, sob demanda). -->

      ${blocoDistribuicaoStatus(distHoje, concluidasHoje.length,
        'Cargas concluídas',
        'Cargas que chegaram a "Seguiu Viagem" — o caminhão saiu do pátio. Só esse status conta como concluída.',
        true)}

      ${rodapeDocumento(
        '<strong>Lead Time</strong> = da criação da carga até a saída do caminhão. ' +
        '<strong>Tempo de Pátio</strong> = da chegada física até a saída. ' +
        `Lead time médio no período: ${fmtDuracao(nLead?Math.round(somaLead/nLead):null)}.`,
        'Indicadores calculados sobre as cargas CONCLUÍDAS no período — as que '
        + 'percorreram as seis etapas até "Seguiu Viagem". Carga ainda em '
        + 'andamento não entra em média de tempo: etapa sem fim não tem duração, '
        + 'e contá-la como zero puxaria a média para baixo.',
        fichaDocumento({
          titulo: 'Relatório Executivo',
          contagem: doPeriodo.length,
          extra: `<strong>Em aberto:</strong> ${abertas.length} · <strong>Concluídas:</strong> ${concluidasTodas.length}`,
        }))}
    </div>`;
  await exportarViaServidor(el, 'Relatorio-Executivo');
}

/* ---------- RELÓGIO ---------- */
function iniciarRelogio(){
  function tick(){
    const n = new Date();
    document.getElementById('clock').textContent = n.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    document.getElementById('date-display').textContent = n.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  }
  tick();
  setInterval(tick, 1000);
}

/* ---------- INIT ---------- */
async function init(){
  // Carrega a base real de Frota antes de desenhar a tela — ver
  // carregarFrotaSeedSeVazia em data.js. Nunca trava o painel se falhar
  // (ex: aberto via file://): segue com Frota vazia, exigindo cadastro/import
  // manual como já era antes desta base.
  const seed = await carregarFrotaSeedSeVazia();
  if(seed.carregado){
    if(seed.primeiraCarga){
      notify(`Base de Frota carregada: ${seed.total} placa(s).`, 'success');
    } else {
      // Atualização de base numa máquina que já tinha a anterior. Isso NÃO
      // pode passar batido: se uma placa mudou de transportadora, quem
      // programa carga precisa saber que o dado na tela mudou hoje.
      const partes = [`Base de Frota atualizada: ${seed.total} placa(s)`];
      if(seed.alteradas) partes.push(`${seed.alteradas} com transportadora corrigida`);
      if(seed.removidas) partes.push(`${seed.removidas} fora de operação removida(s)`);
      if(seed.manuaisPreservadas) partes.push(`${seed.manuaisPreservadas} cadastrada(s) à mão preservada(s)`);
      notify(partes.join(' · ') + '.', 'warn', 9000);
    }
  }
  preencherSelectsRota();   // alimenta os selects de Rota a partir de ROTAS
  iniciarTema();            // antes de desenhar: evita piscar no tema errado
  ligarCalendarioNosCamposDeData();   // clique no campo abre a janelinha do calendário
  // Conecta ao servidor se houver sessão; caso contrário fica em modo
  // local e o rodapé diz isso. Nunca bloqueia a abertura do painel.
  if(typeof SuincoSharePoint !== 'undefined'){
    SuincoSharePoint.aoMudarEstado(atualizarRodapeConexao);
    // Toda leitura das Listas cai aqui: funde no DB e redesenha se algo mudou.
    // É o que faz a Portaria enxergar a carga que a Logística acabou de criar.
    SuincoSharePoint.aoReceberDados(dados => {
      const r = fundirEstadoRemoto(dados);

      /* liberarPendencias() estava escrita desde sempre e NUNCA era chamada
         de lugar nenhum — achado da auditoria "superpowers". O comentário
         dela já dizia quando deveria rodar: "quando a fila sobe por
         completo". Este callback dispara toda vez que sincronizarAgora()
         faz uma leitura — e sincronizarAgora() SEMPRE drena a fila de
         escrita antes de ler (drenarFila() → pull()). "Fila vazia agora" é
         exatamente o sinal de "subiu por completo".

         Sem isto, uma carga que passou pela fila offline (rede caiu no meio
         do registro) ficava com `_pendente`/`_statusPendentes` travados PARA
         SEMPRE, mesmo depois de a gravação ter subido com sucesso — e como
         essas marcas vão para o localStorage inteiro, o bloqueio sobrevivia
         a fechar a aba. A regra 3 de fundirEstadoRemoto (mais abaixo)
         recusa qualquer atualização remota de uma carga marcada assim: o
         terminal ficava permanentemente cego para o que os outros setores
         faziam naquela carga específica.

         `SuincoSharePoint.pendentes` é checado antes de chamar porque
         painéis muito antigos em cache podem não ter a versão do adaptador
         que exporta essa função — mesma cautela já usada para
         aoEditarCarga/aoExcluirCarga logo abaixo. */
      if(typeof SuincoSharePoint.pendentes === 'function' && SuincoSharePoint.pendentes() === 0){
        liberarPendencias();
      }

      if(r.cargasNovas || r.cargasAtualizadas || r.movimentacoesNovas){
        renderAll();
        // Aviso discreto: a tela mudou por ação de outro setor, e o operador
        // precisa saber disso — tela que se altera sozinha sem explicação
        // destrói a confiança no painel.
        if(!dados.incremental) return;   // carga inicial não é "novidade"
        if(r.cargasNovas || r.cargasAtualizadas) notify(mensagemAtualizacaoRemota(r), 'success');
      }
      atualizarRodapeConexao(SuincoSharePoint.estado());
    });
    // Alteração em carga já programada: aviso detalhado, com som quando é a
    // placa. Chega por fora da sincronia porque é notícia, não dado.
    if(SuincoSharePoint.aoEditarCarga) SuincoSharePoint.aoEditarCarga(receberEdicaoRemota);
    if(SuincoSharePoint.aoExcluirCarga) SuincoSharePoint.aoExcluirCarga(receberExclusaoRemota);
    // Quem está online, pra aba Usuários. Só redesenha se a aba estiver
    // aberta agora — nas outras telas a lista fica guardada e some vale na
    // próxima vez que a Administração abrir Usuários.
    if(SuincoSharePoint.aoAtualizarPresenca) SuincoSharePoint.aoAtualizarPresenca(online => {
      _operadoresOnline = new Set((online || []).map(String));
      if(TAB_ATUAL === 'usuarios') renderUsuarios();
    });
    // Alguém (Logística/Administração) fechou a programação atual — todo
    // mundo conectado precisa saber, não só quem clicou. Pedido do usuário
    // (08/08/2026): "resetando os paineis de todos os setores".
    if(SuincoSharePoint.aoFecharPrograma) SuincoSharePoint.aoFecharPrograma(dados => {
      notify(`Programação fechada por ${dados.operador} (${dados.setor}) — pronto para uma nova.`, 'info', 6000);
      renderAll();
    });
    if(typeof aoRecusarStatus === 'function') aoRecusarStatus(receberRecusaDeStatus);
    if(typeof aoRecusarCarga === 'function') aoRecusarCarga(receberRecusaDeCarga);
    if(typeof aoRecusarFrota === 'function') aoRecusarFrota(receberRecusaDeFrota);
    if(typeof aoRecusarRota === 'function') aoRecusarRota(receberRecusaDeRota);
    SuincoSharePoint.iniciar()
      .then(()=>{ atualizarRodapeConexao(SuincoSharePoint.estado()); renderAll(); })
      .catch(e=>{ console.warn('[Suinco] init:', e); atualizarRodapeConexao('local'); });
  }
  atualizarDatalists();
  atualizarResumoFiltroRelatorio();  // resumo do filtro já na 1ª pintura
  // Mudar a data tem que refletir no resumo na hora: filtro cujo efeito só
  // aparece depois de gerar o PDF faz o gestor mandar o relatório errado.
  ['rel-data-de','rel-data-ate'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', atualizarResumoFiltroRelatorio);
  });
  atualizarAvisoSetorAba(); // preenche o box "função da aba" já na 1ª pintura
  if(DB.operador){
    atualizarHeaderOperador();
    aplicarPermissoesSetor();
  } else {
    abrirLogin();
  }
  iniciarRelogio();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);

/* =====================================================================
   TEMPO MÉDIO DE PÁTIO, GARGALOS E RELATÓRIOS FILTRADOS
   =====================================================================
   Bloco novo (05/08/2026). Substitui os extremos maior/menor por média
   contra meta, e acrescenta a leitura automática de gargalos. */

function renderTempoMedioPatio(){
  const wrap = document.getElementById('ind-patio-medio');
  if(!wrap) return;
  const t = tempoMedioPatio(cargasConcluidasNoPeriodo('hoje'));
  const geral = tempoMedioPatio(DB.cargas.filter(c=>c.status==='Seguiu Viagem'));

  if(!t.amostra && !geral.amostra){
    wrap.innerHTML = `<div class="empty-state">Nenhuma carga concluída com tempo de pátio calculável ainda.</div>`;
    return;
  }

  // Dentro ou fora da meta muda a cor. É o dado que o gestor lê primeiro,
  // e número sem referência não diz se está bom ou ruim.
  const caixa = (dados, rotulo, nota) => {
    if(!dados.amostra){
      return `<div class="stat-box"><div class="stat-num">—</div>
        <div class="stat-label">${rotulo}</div>
        <div class="stat-note">Sem dados suficientes</div></div>`;
    }
    const dentro = dados.media <= dados.meta;
    // -txt, e não -fg: este número fica solto no card, não dentro de um
    // preenchimento colorido. Com -fg saía #06210f (quase preto) sobre o
    // card escuro — razão 1,16.
    const cor = dentro ? 'var(--st-faturado-txt, #4cc281)' : 'var(--st-aguardando-veiculo-txt, #ff8a80)';
    return `<div class="stat-box">
        <div class="stat-num" style="color:${cor}">${fmtDuracao(dados.media)}</div>
        <div class="stat-label">${rotulo}</div>
        <div class="stat-note">${nota} · base: ${dados.amostra} carga(s)<br>
          ${dados.acimaDaMeta} acima da meta de ${fmtDuracao(dados.meta)} (${dados.percentualAcima}%)</div>
      </div>`;
  };

  wrap.innerHTML = `<div class="grid4">
      ${caixa(t, 'Tempo Médio de Pátio — hoje', 'Chegada até a saída')}
      ${caixa(geral, 'Tempo Médio de Pátio — histórico', 'Todas as cargas concluídas')}
    </div>`;
}

/* Leitura automática de gargalos. Cada bloco só aparece se tiver conteúdo:
   seção cheia de "sem dados" treina o gestor a ignorar a seção inteira. */
function renderGargalos(){
  const wrap = document.getElementById('ind-gargalos');
  if(!wrap) return;
  const g = analiseGargalos(DB.cargas);
  const blocos = [];

  const tabela = (titulo, explicacao, cabecalhos, linhas) => {
    if(!linhas.length) return '';
    return `<div class="gargalo-bloco">
        <div class="gargalo-titulo">${esc(titulo)}</div>
        <div class="gargalo-sub">${explicacao}</div>
        <div class="table-wrap"><table>
          <thead><tr>${cabecalhos.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${linhas.join('')}</tbody>
        </table></div>
      </div>`;
  };

  blocos.push(tabela(
    '🔁 Veículos com atraso recorrente',
    'Dois ou mais atrasos. Um atraso é acaso; dois viram padrão.',
    ['Placa','Transportadora','Atrasos','Atraso Médio'],
    g.veiculosRecorrentes.map(v=>`<tr>
      <td><strong>${esc(v.placa)}</strong></td><td>${esc(v.transportadora)}</td>
      <td class="cel-num">${v.atrasos} de ${v.totalCargas}</td>
      <td class="cel-num">${fmtDuracao(v.tempoMedioAtraso)}</td></tr>`)
  ));

  blocos.push(tabela(
    '⏳ Operações com maior permanência no pátio',
    'Tempo médio da chegada até a saída, por tipo de operação.',
    ['Tipo de Operação','Tempo Médio','Cargas'],
    g.operacoesMaiorPermanencia.map(o=>`<tr>
      <td>${esc(PRA_ONDE_LABEL[o.operacao] || o.operacao)}</td>
      <td class="cel-num">${fmtDuracao(o.media)}</td>
      <td class="cel-num">${o.amostra}</td></tr>`)
  ));

  blocos.push(tabela(
    '🚚 Transportadoras com concentração de atraso',
    'Informativo, sem ranking principal — parte do atraso é do pátio, não da transportadora.',
    ['Transportadora','Cargas Atrasadas','% do Total'],
    g.transportadorasAtraso.map(t=>`<tr>
      <td>${esc(t.transportadora)}</td>
      <td class="cel-num">${t.atrasadas} de ${t.total}</td>
      <td class="cel-num">${t.percentual}%</td></tr>`)
  ));

  blocos.push(tabela(
    '🕐 Horários de maior congestionamento',
    'Pela hora de CHEGADA do caminhão — o congestionamento é físico, não da digitação.',
    ['Hora','Chegadas','Tempo Médio de Pátio'],
    g.horariosCongestionamento.map(h=>`<tr>
      <td>${String(h.hora).padStart(2,'0')}:00 — ${String(h.hora).padStart(2,'0')}:59</td>
      <td class="cel-num">${h.chegadas}</td>
      <td class="cel-num">${fmtDuracao(h.tempoMedioPatio)}</td></tr>`)
  ));

  blocos.push(tabela(
    '🛣️ Rotas com maior incidência de atraso',
    'Rota que atrasa sempre costuma ser problema de janela ou de sequenciamento.',
    ['Rota','Cargas Atrasadas','Atraso Médio'],
    g.rotasAtraso.map(r=>`<tr>
      <td>${esc(r.rotulo || r.rota)}</td>
      <td class="cel-num">${r.atrasadas} de ${r.total}</td>
      <td class="cel-num">${fmtDuracao(r.atrasoMedio)}</td></tr>`)
  ));

  blocos.push(tabela(
    '⚠️ Cargas paradas há mais tempo',
    'O bloco mais acionável: cada linha é um caminhão esperando alguém destravar.',
    ['Nº Carga','Placa','Transportadora','Status','Parada há'],
    g.pendentesAntigas.map(c=>`<tr>
      <td>${esc(c.numeroCarga)}</td><td><strong>${esc(c.placa)}</strong></td>
      <td>${esc(c.transportadora)}</td>
      <td>${badgeHtml(c.status)}</td>
      <td class="cel-num">${fmtDuracao(c.paradaHaMin)}</td></tr>`)
  ));

  const conteudo = blocos.filter(Boolean).join('');
  wrap.innerHTML = conteudo || `<div class="empty-state">
      Nenhum gargalo detectado — nenhuma carga passou da meta de ${fmtDuracao(g.meta)} em pátio.
    </div>`;
}

/* ---------- FILTRO DE PERÍODO DOS RELATÓRIOS ----------
   Um filtro só, compartilhado pelos três relatórios. Ler os campos na hora
   de gerar (em vez de guardar em variável) evita o clássico "mudei o filtro
   e o PDF saiu com o período antigo". */
function periodoRelatorio(){
  const de = (document.getElementById('rel-data-de') || {}).value || '';
  const ate = (document.getElementById('rel-data-ate') || {}).value || '';
  return { de, ate };
}

function cargasDoRelatorio(){
  const { de, ate } = periodoRelatorio();
  return filtrarPorDataProgramacao(DB.cargas.filter(c=>!c.aguardandoCarga), de, ate);
}

function rotuloPeriodoRelatorio(){
  const { de, ate } = periodoRelatorio();
  if(!de && !ate) return 'Todas as cargas';
  if(de && ate) return `Programadas de ${fmtData(de)} a ${fmtData(ate)}`;
  if(de) return `Programadas a partir de ${fmtData(de)}`;
  return `Programadas até ${fmtData(ate)}`;
}

function fmtData(iso){
  if(!iso) return '—';
  const [a,m,d] = String(iso).slice(0,10).split('-');
  return `${d}/${m}/${a}`;
}

function filtroRelatorioAtalho(qual){
  const de = document.getElementById('rel-data-de');
  const ate = document.getElementById('rel-data-ate');
  if(!de || !ate) return;
  const hoje = new Date();
  const iso = d => d.toISOString().slice(0,10);
  if(qual === 'limpar'){ de.value = ''; ate.value = ''; }
  else if(qual === 'hoje'){ de.value = iso(hoje); ate.value = iso(hoje); }
  else {
    const dias = qual === 'semana' ? 6 : 29;
    const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - dias);
    de.value = iso(inicio); ate.value = iso(hoje);
  }
  atualizarResumoFiltroRelatorio();
}

function atualizarResumoFiltroRelatorio(){
  const el = document.getElementById('rel-resumo-filtro');
  if(!el) return;
  const lista = cargasDoRelatorio();
  const s = somatoriosDaLista(lista);
  el.innerHTML = `<strong>${rotuloPeriodoRelatorio()}</strong> — ${s.cargas} carga(s) · ` +
    `${(s.pesoKg/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} ton · ` +
    `${s.entregas} entrega(s)`;
}

/* Linha de rodapé com os somatórios, no estilo do Excel. Respeita o filtro
   porque é montada a partir da mesma lista que gerou as linhas acima. */
function rodapeSomatorios(lista, colspanAntes, colunas){
  const s = somatoriosDaLista(lista);
  const pesoTon = (s.pesoKg/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const celulas = colunas.map(c=>{
    if(c === 'peso') return `<td class="tot-num">${pesoTon}</td>`;
    if(c === 'entregas') return `<td class="tot-num">${s.entregas}</td>`;
    if(c === 'ganchos') return `<td class="tot-num">${s.ganchos}</td>`;
    return '<td></td>';
  }).join('');
  return `<tr class="linha-total">
      <td colspan="${colspanAntes}" class="tot-rotulo">TOTAL — ${s.cargas} carga(s)</td>
      ${celulas}
    </tr>`;
}

/* ---------- RELATÓRIO ADMINISTRAÇÃO DE FRETES ----------
   Independente dos demais de propósito: quem usa é a administração, e
   misturar controle de frete com acompanhamento de pátio produziria um
   relatório que não serve bem para nenhum dos dois. */
async function exportarPdfFretes(){
  await atualizarDadosAntesDoRelatorio();
  /* Container PRÓPRIO, não o do Operacional.

     Enquanto os dois dividiam o mesmo `#print-operacional`, este relatório
     herdava a regra de impressão calibrada para 13 colunas em A4 deitado:
     fonte de 7,6px. Com três colunas isso vira letra de bula, para
     economizar um espaço que ninguém estava usando. */
  const el = document.getElementById('print-fretes');
  const lista = cargasDoRelatorio();
  const dados = dadosAdministracaoFretes(lista);

  const semObs = dados.filter(d=>!d.observacoes).length;

  const linhas = dados.map(d=>`<tr>
      <td class="col-carga">${esc(d.numeroCarga)}</td>
      <td class="col-rota">${esc(d.rota)}</td>
      <td class="col-obs">${d.observacoes
        ? esc(d.observacoes)
        : '<span class="obs-pendente">a preencher</span>'}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="print-page doc-amplo">
      ${cabecalhoDocumento({
        titulo: 'Administração de Fretes',
        subtitulo: 'Logística — valor, negociação e instruções por carga',
      })}
      <table class="tab-fretes">
        <thead><tr>
          <th class="col-carga">Número da Carga</th>
          <th class="col-rota">Rota</th>
          <th class="col-obs">Observações</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="3" class="text-center text-dim">Nenhuma carga no período selecionado.</td></tr>'}</tbody>
      </table>
      ${rodapeDocumento(
        'O campo <strong>Observações</strong> é onde a administração registra valor do frete, ' +
        'negociação e instruções. As linhas marcadas como <strong>a preencher</strong> são as ' +
        'cargas ainda sem registro administrativo.',
        'Uma linha por carga do período, com os campos administrativos '
        + 'registrados até o momento da emissão. Campos em branco significam '
        + 'não preenchido, e não zero.',
        fichaDocumento({
          titulo: 'Administração de Fretes',
          contagem: dados.length,
          extra: semObs ? `<strong>Sem registro:</strong> ${semObs} de ${dados.length}` : null,
        }))}
    </div>`;
  await exportarViaServidor(el, 'Administracao-de-Fretes');
}

/* =====================================================================
   MOBILE — tabela vira cartão
   =====================================================================

   No celular, tabela de 14 colunas com rolagem lateral é inutilizável: o
   usuário perde a referência da linha no primeiro deslize. O CSS resolve
   isso transformando cada linha num cartão, mas para isso precisa saber o
   rótulo de cada célula — que só existe no <thead>.

   Esta função deriva o rótulo do próprio cabeçalho, em vez de exigir que
   cada `<td>` no código carregue um data-rotulo escrito à mão. É a
   diferença entre a marcação continuar certa sozinha quando alguém
   acrescentar uma coluna, e ela silenciosamente sair do ar.

   Roda depois de cada render. Custo: um passe pelas células visíveis da
   aba atual, uma vez por pintura. */
function prepararTabelasMobile(raiz){
  const escopo = raiz || document.querySelector('.tab-page.active') || document;
  escopo.querySelectorAll('table').forEach(tab=>{
    // Tabela de relatório impresso fica de fora: no PDF ela precisa
    // continuar tabela, e o cartão quebraria o layout de página.
    if(tab.closest('.print-page')) return;

    const cabecalhos = [...tab.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    if(!cabecalhos.length) return;
    tab.classList.add('mobile-cartao');

    tab.querySelectorAll('tbody tr').forEach(tr=>{
      [...tr.children].forEach((td, i)=>{
        const rotulo = cabecalhos[i];
        // Coluna de ação não recebe rótulo: no cartão ela vira um botão de
        // largura inteira, e "AÇÃO: [Chegou]" só ocuparia espaço.
        if(!rotulo || /^(ação|acao|ações|acoes)$/i.test(rotulo)){
          td.removeAttribute('data-rotulo');
        } else {
          td.setAttribute('data-rotulo', rotulo);
        }
      });
    });
  });
}

/* =====================================================================
   USUÁRIOS — administração pela interface
   =====================================================================

   Existe para tirar o cadastro de operador do SSH. Enquanto criar um
   porteiro exigia abrir terminal, a operação dependia de alguém com acesso
   ao servidor toda vez que entrasse gente nova — e essa fricção é o que
   faz nascer senha compartilhada.

   Toda a validação de verdade está no servidor (rotas/operadores.js). Aqui
   é conveniência: a tela não decide nada que o servidor não confirme. */

let _usuarios = [];

async function renderUsuarios(){
  const tbody = document.getElementById('usr-tbody');
  const vazio = document.getElementById('usr-empty');
  if(!tbody) return;

  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.estaConfigurado()){
    tbody.innerHTML = '';
    vazio.hidden = false;
    vazio.textContent = 'Esta tela precisa de conexão com o servidor. Faça login para usá-la.';
    return;
  }

  try{
    _usuarios = await SuincoSharePoint.listarOperadores();
  }catch(e){
    tbody.innerHTML = '';
    vazio.hidden = false;
    vazio.textContent = e.status === 403
      ? 'Só a Administração acessa esta tela.'
      : 'Não consegui carregar os usuários: ' + e.message;
    return;
  }

  vazio.hidden = _usuarios.length > 0;
  vazio.textContent = 'Nenhum usuário cadastrado.';

  const euMesmo = (DB.operador && DB.operador.email) || '';

  tbody.innerHTML = _usuarios.map(u=>{
    const sou = u.email === euMesmo;
    const online = _operadoresOnline.has(String(u.id));
    const acesso = u.ultimoAcesso ? fmtDataHora(u.ultimoAcesso)
      : '<span class="text-dim">nunca acessou</span>';
    return `<tr${u.ativo ? '' : ' class="linha-inativa"'}>
      <td><span class="presenca-dot${online ? ' online' : ''}" title="${online ? 'Online agora' : 'Offline'}" aria-label="${online ? 'Online agora' : 'Offline'}"></span> <strong>${esc(u.nome)}</strong>${sou ? ' <span class="chip-voce">você</span>' : ''}</td>
      <td>${esc(u.email)}</td>
      <td>
        <select class="setor-inline" onchange="alterarSetorUsuarioUI('${escJs(u.id)}', this.value)"
                ${sou ? 'title="Você não pode mudar o próprio setor — perderia o acesso a esta tela"' : ''}>
          ${SETORES.map(st=>`<option value="${esc(st)}" ${u.setor===st?'selected':''}>${esc(st)}</option>`).join('')}
        </select>
      </td>
      <td>${u.ativo ? '<span class="sit-ativo">Ativo</span>' : '<span class="sit-inativo">Bloqueado</span>'}</td>
      <td>${acesso}</td>
      <td class="no-print">
        <div class="gap8">
          <button class="btn btn-sec btn-sm" onclick="redefinirSenhaUsuarioUI('${escJs(u.id)}')">🔑 Senha</button>
          ${u.ativo
            ? `<button class="btn btn-danger btn-sm" onclick="bloquearUsuarioUI('${escJs(u.id)}', false)" ${sou?'disabled title="Você não pode bloquear a si mesmo"':''}>🚫 Bloquear</button>`
            : `<button class="btn btn-success btn-sm" onclick="bloquearUsuarioUI('${escJs(u.id)}', true)">✅ Reativar</button>`}
        </div>
      </td>
    </tr>`;
  }).join('');

  prepararTabelasMobile(document.getElementById('tab-usuarios'));
}

function _usuarioPorId(id){
  return _usuarios.find(u => String(u.id) === String(id));
}

async function criarUsuarioUI(){
  const email = (document.getElementById('usr-email').value || '').trim();
  const nome = (document.getElementById('usr-nome').value || '').trim();
  const setor = document.getElementById('usr-setor').value;
  const senhaEl = document.getElementById('usr-senha');
  const senha = senhaEl.value || '';

  if(!email || !nome){ notify('Informe e-mail e nome.', 'warn'); return; }
  if(senha.length < 8){ notify('A senha precisa de pelo menos 8 caracteres.', 'warn'); return; }

  try{
    await SuincoSharePoint.criarOperador({ email, nome, setor, senha });
    // Limpa a senha do DOM imediatamente. Esta tela é usada num terminal
    // que pode ficar aberto, e campo de senha preenchido é o que o
    // próximo a sentar ali encontra.
    senhaEl.value = '';
    document.getElementById('usr-email').value = '';
    document.getElementById('usr-nome').value = '';
    notify(`Usuário ${nome} criado no setor ${setor}.`, 'success');
    renderUsuarios();
  }catch(e){
    notify('Não criou: ' + e.message, 'danger');
  }
}

async function alterarSetorUsuarioUI(id, setor){
  const u = _usuarioPorId(id);
  if(!u) return;
  if(!confirm(`Mudar ${u.nome} para o setor ${setor}?\n\nIsso muda o que essa pessoa vê e o que consegue registrar.`)){
    renderUsuarios();   // devolve o select ao valor anterior
    return;
  }
  try{
    await SuincoSharePoint.atualizarOperador(id, { setor });
    notify(`${u.nome} agora é ${setor}.`, 'success');
  }catch(e){
    notify('Não alterou: ' + e.message, 'danger');
  }
  renderUsuarios();
}

async function bloquearUsuarioUI(id, ativar){
  const u = _usuarioPorId(id);
  if(!u) return;
  const acao = ativar ? 'Reativar' : 'Bloquear';
  const aviso = ativar
    ? `Reativar ${u.nome}? A pessoa volta a conseguir entrar.`
    : `Bloquear ${u.nome}?\n\nEla perde o acesso na hora. O histórico do que ela registrou é preservado.`;
  if(!confirm(aviso)) return;
  try{
    await SuincoSharePoint.atualizarOperador(id, { ativo: ativar });
    notify(`${u.nome} ${ativar ? 'reativado' : 'bloqueado'}.`, 'success');
  }catch(e){
    notify(`Não conseguiu ${acao.toLowerCase()}: ` + e.message, 'danger');
  }
  renderUsuarios();
}

async function redefinirSenhaUsuarioUI(id){
  const u = _usuarioPorId(id);
  if(!u) return;
  // prompt() em vez de campo na tabela: a senha não fica escrita no DOM
  // depois, e o navegador não a guarda no autofill de formulário.
  const senha = prompt(`Nova senha para ${u.nome} (${u.email}).\n\nMínimo 8 caracteres. Anote e entregue pessoalmente — ela não aparece de novo.`);
  if(senha === null) return;
  if(senha.length < 8){ notify('A senha precisa de pelo menos 8 caracteres.', 'warn'); return; }
  try{
    await SuincoSharePoint.atualizarOperador(id, { senha });
    notify(`Senha de ${u.nome} redefinida.`, 'success');
  }catch(e){
    notify('Não redefiniu: ' + e.message, 'danger');
  }
}

/* =====================================================================
   BLOCOS NOVOS DO RELATÓRIO EXECUTIVO
   =====================================================================
   Mesmos indicadores da aba Indicadores, no formato do papel. Existem
   separados porque o PDF não tem interação: nada de select de período nem
   de linha que expande — o que está impresso é o que o leitor tem. */

function blocoTempoMedioPatioPdf(cargas){
  const t = tempoMedioPatio(cargas);
  if(!t.amostra){
    return tituloSecaoPdf('Tempo Médio de Pátio',
      'Da chegada física do caminhão até a saída.') +
      `<div class="print-vazio">Nenhuma carga concluída com tempo calculável no período.</div>`;
  }
  const dentro = t.media <= t.meta;
  // No papel a cor sozinha não basta: impressão em preto e branco existe,
  // e daltonismo também. O texto diz o mesmo que a cor.
  const veredito = dentro
    ? `Dentro da meta de ${fmtDuracao(t.meta)}.`
    : `ACIMA da meta de ${fmtDuracao(t.meta)}.`;
  return tituloSecaoPdf('Tempo Médio de Pátio',
      'Da chegada física do caminhão até a saída — o tempo que a operação e o motorista sentem.') +
    `<table>
      <thead><tr><th>Tempo Médio</th><th>Meta</th><th>Situação</th><th>Acima da Meta</th><th>Base</th></tr></thead>
      <tbody><tr>
        <td class="num-forte" style="color:${dentro ? '#2f7d4f' : '#a3271f'}">${fmtDuracao(t.media)}</td>
        <td>${fmtDuracao(t.meta)}</td>
        <td>${esc(veredito)}</td>
        <td>${t.acimaDaMeta} carga(s) — ${t.percentualAcima}%</td>
        <td>${t.amostra} carga(s)</td>
      </tr></tbody>
    </table>`;
}

function blocoRankingAtrasoPdf(cargas){
  const rk = rankingVeiculosAtraso(cargas).slice(0, 10);
  const cabecalho = tituloSecaoPdf('Veículos com Maior Atraso',
    'Do maior para o menor atraso médio. Atraso = tempo em pátio acima da meta de 3 h. ' +
    'Veículo sem atraso não aparece — a lista existe para mostrar onde agir.');
  if(!rk.length){
    return cabecalho + `<div class="print-vazio">Nenhum veículo passou da meta no período. É o resultado que se quer.</div>`;
  }
  return cabecalho + `<table>
      <thead><tr><th>#</th><th>Placa</th><th>Transportadora</th><th>Atrasos</th><th>Atraso Médio</th><th>Último Atraso</th></tr></thead>
      <tbody>${rk.map((r,i)=>`<tr>
        <td class="num-forte">${i+1}º</td>
        <td class="id-cel">${esc(r.placa)}</td>
        <td>${esc(r.transportadora)}</td>
        <td>${r.atrasos} de ${r.totalCargas}</td>
        <td>${fmtDuracao(r.tempoMedioAtraso)}</td>
        <td>${r.ultimoAtraso ? esc(fmtDataHora(r.ultimoAtraso)) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

/* Pontos críticos — o primeiro bloco de dado do relatório executivo.

   Cada linha é um caminhão parado esperando alguém destravar. Estava
   dentro de blocoGargalosPdf, atrás de três tabelas de análise histórica:
   o item mais acionável do documento chegava depois do que só explica o
   passado. Virou bloco próprio para poder subir.

   A coluna "Parada há" é o tempo desde o último registro da carga — não é
   o tempo de pátio. Uma carga pode ter chegado há uma hora e estar parada
   há cinquenta minutos porque ninguém mexeu nela desde a portaria. É esse
   silêncio que o gestor precisa enxergar. */
function blocoPendentesAntigasPdf(cargas){
  const g = analiseGargalos(cargas);
  const cabecalho = tituloSecaoPdf('Pontos críticos — cargas paradas há mais tempo',
    'Cargas ainda em aberto, da mais parada para a menos. "Parada há" = tempo desde o '
    + 'último registro em qualquer setor. Até dez linhas — se houver mais, são as dez piores.');

  if(!g.pendentesAntigas.length){
    return cabecalho + `<div class="print-vazio">Nenhuma carga em aberto no período. Nada travado.</div>`;
  }

  return cabecalho + `<table>
      <thead><tr>
        <th>Nº Carga</th><th>Placa</th><th>Transportadora</th><th>Status</th><th>Parada há</th>
      </tr></thead>
      <tbody>${g.pendentesAntigas.map(c=>{
        // Acima da meta ganha marca no texto, e não só na cor: este
        // documento é impresso em preto e branco com frequência.
        const critica = c.paradaHaMin > g.meta;
        return `<tr>
          <td class="id-cel">${esc(c.numeroCarga)}</td>
          <td class="id-cel">${esc(c.placa)}</td>
          <td>${esc(c.transportadora)}</td>
          <td>${esc(c.status)}</td>
          <td class="num-forte"${critica ? ' style="color:#a3271f"' : ''}>${fmtDuracao(c.paradaHaMin)}${critica ? ' ⚠' : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` +
    fonteDocumento(`registros de movimentação do pátio · ⚠ = acima da meta de ${fmtDuracao(g.meta)}`);
}

function blocoGargalosPdf(cargas){
  const g = analiseGargalos(cargas);
  const partes = [];

  const tabela = (titulo, explicacao, cabecalhos, linhas) => {
    if(!linhas.length) return '';
    return tituloSecaoPdf(titulo, explicacao) + `<table>
      <thead><tr>${cabecalhos.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.join('')}</tbody></table>`;
  };

  partes.push(tabela('Gargalos — veículos com atraso recorrente',
    'Dois ou mais atrasos no período. Um atraso é acaso; dois viram padrão.',
    ['Placa','Transportadora','Atrasos','Atraso Médio'],
    g.veiculosRecorrentes.map(v=>`<tr>
      <td class="id-cel">${esc(v.placa)}</td><td>${esc(v.transportadora)}</td>
      <td>${v.atrasos} de ${v.totalCargas}</td><td>${fmtDuracao(v.tempoMedioAtraso)}</td></tr>`)));

  partes.push(tabela('Gargalos — horários de maior congestionamento',
    'Pela hora de CHEGADA do caminhão. O congestionamento é físico, não da digitação.',
    ['Hora','Chegadas','Tempo Médio de Pátio'],
    g.horariosCongestionamento.map(h=>`<tr>
      <td>${String(h.hora).padStart(2,'0')}:00 — ${String(h.hora).padStart(2,'0')}:59</td>
      <td>${h.chegadas}</td><td>${fmtDuracao(h.tempoMedioPatio)}</td></tr>`)));

  partes.push(tabela('Gargalos — rotas com maior incidência de atraso',
    'Rota que atrasa sempre costuma ser problema de janela ou de sequenciamento.',
    ['Rota','Cargas Atrasadas','Atraso Médio'],
    g.rotasAtraso.map(r=>`<tr>
      <td>${esc(r.rotulo || r.rota)}</td>
      <td>${r.atrasadas} de ${r.total}</td><td>${fmtDuracao(r.atrasoMedio)}</td></tr>`)));

  /* "Pontos críticos" NÃO fica aqui.

     É o bloco mais acionável do relatório e estava no meio dos gargalos,
     depois de três tabelas de análise histórica. Gestor lê de cima para
     baixo e decide nos primeiros trinta segundos: o que exige ação hoje
     precisa vir antes do que explica o passado.

     Virou bloco próprio (blocoPendentesAntigasPdf) e subiu para o começo
     do documento. */

  const conteudo = partes.filter(Boolean).join('');
  return conteudo || (tituloSecaoPdf('Gargalos e Pontos Críticos',
    'Leitura automática do período.') +
    `<div class="print-vazio">Nenhum gargalo detectado — nenhuma carga passou da meta de ${fmtDuracao(g.meta)} em pátio.</div>`);
}

/* Painel de status na horizontal: um status por coluna, o número embaixo.

   Substitui a tabela vertical de 5 colunas (Status, Setor, Cargas, %,
   barra) que ocupava meia página para dizer seis números. O gestor lê "onde
   está parado o quê" de uma olhada, sem percorrer linha a linha.

   A ordem é a do fluxo, não a do volume: ler da esquerda para a direita é
   percorrer o caminho do caminhão pelo pátio, e um acúmulo numa coluna
   mostra em que etapa a fila está se formando. */
function painelStatusHorizontal(dist, total, titulo, explicacao){
  /* "Seguiu Viagem" fora: é o status de saída, então uma carga EM ABERTO
     nunca está nele. A coluna ficaria zerada para sempre — o mesmo ruído
     que acabamos de remover do resto do relatório. */
  dist = dist.filter(d => d.status !== 'Seguiu Viagem');

  const colunas = dist.map(d=>{
    const vazio = d.qtd === 0;
    return `
      <td class="ps-cel${vazio ? ' ps-vazio' : ''}"
          style="border-top:4px solid ${d.cor.fundo}">
        <div class="ps-num">${d.qtd}</div>
        <div class="ps-pct">${total && !vazio ? d.pct + '%' : '&nbsp;'}</div>
      </td>`;
  }).join('');

  const cabecalhos = dist.map(d=>`
      <th class="ps-th" style="background:${d.cor.fundo};color:${d.cor.texto}">
        ${esc(d.status)}
      </th>`).join('');

  return tituloSecaoPdf(titulo, explicacao) +
    `<table class="painel-status">
      <thead><tr>${cabecalhos}<th class="ps-th ps-total-th">Total</th></tr></thead>
      <tbody><tr>${colunas}
        <td class="ps-cel ps-total-cel">
          <div class="ps-num">${total}</div>
          <div class="ps-pct">${total ? '100%' : '&nbsp;'}</div>
        </td>
      </tr></tbody>
    </table>`;
}
