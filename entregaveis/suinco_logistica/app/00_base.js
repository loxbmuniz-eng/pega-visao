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

/* AVISO DE OUTRO SETOR É NOTÍCIA, E NOTÍCIA TEM PRAZO (25/08/2026)
   =====================================================================
   Relato do dono, com print de "+142 aviso(s) aguardando": "essa fila de
   avisos tá foda com esses avisos acumulados; deixa os avisos mais
   focados pro ao vivo mesmo, larga mão de ficar mostrando ele
   infinitamente pra quem tá abrindo o painel agora".

   A fila nunca descartava nada. Três avisos na tela por vez, cinco
   segundos cada — num pátio movimentado chegam mais rápido do que isso
   drena, e o resto ficava esperando a vez para sempre. Quem abria o painel
   às 12h assistia, um a um, a avisos de coisas que aconteceram às 9h. E
   pior: o painel já MOSTRAVA o estado atual daquelas cargas — o aviso não
   informava nada, só ocupava a tela.

   Três regras, e a terceira é a que o dono pediu:

   1. FILA CURTA. Além de MAX_FILA, o mais antigo cai. Aviso que espera
      atrás de dez outros já chegou tarde.

   2. PRAZO DE VALIDADE. Item que passou VALIDADE_MS na fila é descartado
      na hora de aparecer. "Carga 118350 mudou pra Faturado" às 9h07 não é
      notícia às 12h — é histórico, e histórico tem aba própria.

   3. JANELA DE CHEGADA. Nos primeiros segundos depois de o painel abrir,
      aviso de mudança de OUTRO setor não aparece. Quem acabou de chegar
      está lendo a tela inteira; a tela já mostra o resultado dessas
      mudanças. Anunciar o que ele nunca viu diferente é ruído.

   O QUE NÃO É SILENCIADO, em nenhuma das três: aviso com som (`forte`) —
   troca de placa é segurança, o caminhão errado entra na doca por causa
   dele — e tudo que é resposta a uma ação de QUEM ESTÁ NA FRENTE DA TELA
   (gravou, foi recusado, perdeu a conexão). Esses não são notícia de
   terceiro: são a conversa com quem clicou. */
const NOTIF_MAX_FILA = 4;
const NOTIF_VALIDADE_MS = 30000;
const NOTIF_JANELA_CHEGADA_MS = 12000;
const _notifAbertoEm = Date.now();

function notifRecemChegado(){
  return (Date.now() - _notifAbertoEm) < NOTIF_JANELA_CHEGADA_MS;
}

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

/* O crachá de conexão do cabeçalho, com a palavra separada do ícone.

   MOTIVO, medido em 26/08/2026: num iPhone SE (320px) o cabeçalho passou a
   transbordar 26px quando ganhou o sino dos avisos. O crachá sozinho ocupava
   80px — mais que qualquer botão — porque carregava "⚙️ Local" por extenso.
   E ele só aparece quando a conexão NÃO está boa, ou seja, exatamente na
   hora em que o operador está no pátio com o aparelho mais apertado.

   A saída é a mesma que os botões do cabeçalho já usavam desde 08/08: a
   palavra vai para <span class="rot-btn">, que a folha de estilo esconde
   abaixo de 560px. O ícone fica, o `title` e o `aria-label` carregam a
   frase inteira, e o rodapé continua explicando o estado por extenso — lá
   sobra largura.

   Quem tirar o .rot-btn daqui devolve o estouro. Existe teste que reprova:
   testes/test_auditoria_mobile.py, "cabeçalho não transborda a largura". */
function marcarBadgeConexao(badge, classe, icone, frase){
  badge.hidden = false;
  badge.className = 'badge-conexao ' + classe;
  badge.title = frase;
  badge.setAttribute('aria-label', frase);
  badge.innerHTML = esc(icone) + '<span class="rot-btn">&nbsp;' + esc(frase) + '</span>';
}

/* A FAIXA DE OFFLINE — texto do dono, 31/08/2026.

   "colocar uma mensagem quando esta offline VOCE ESTA OFFLINE SISTEMA
    INDISPONIVEL CONECTE-SE PARA CONTINUAR e ALERTA !!!"

   Fixa no topo, não fecha e não some sozinha. Enquanto ela estiver na tela,
   nada é gravado — a fila offline foi desligada (ver enfileirar() em
   suinco-api.js). Aviso que some é aviso que não impediu nada: a pessoa
   digita meia hora achando que gravou. */
/* A FAIXA NUNCA PODE FICAR NA FRENTE DE QUEM ESTÁ TENTANDO ENTRAR.

   Relato do Luis, do celular do Rene da Expedição (31/08/2026): "a faixa
   vermelha aparece e esconde o botão de login e a pessoa não consegue
   clicar no botão de login porque o alerta sobrepõe o lugar onde ficaria
   esse botão".

   Reproduzido em celular DEITADO (740x360, que é como ele estava segurando):
   a caixa do login começa em 31px, a faixa vai de 0 a 61px, e o toque no
   topo do formulário cai em `faixa-offline-sub` em vez de cair no campo.
   Em pé não acontece — sobra altura. Por isso o defeito parecia aleatório.

   DUAS COISAS MINHAS ERRARAM JUNTAS, e cada uma sozinha já bastava:

   1. A guarda "antes do login não existe offline" olhava `DB.operador` —
      que SOBREVIVE no localStorage (SuincoStore.save grava o DB inteiro).
      Quem já entrou uma vez tem operador salvo para sempre, então a guarda
      nunca protegia a tela de login de ninguém que já tivesse usado o
      painel. Agora a pergunta é a certa: a tela de login está aberta?
      Enquanto ela estiver, avisar "você está offline" não ajuda — a ação
      que resolve é justamente entrar.

   2. z-index 9999 contra 3600 do .modal-overlay: a faixa pintava por cima
      de QUALQUER caixa de diálogo, não só a do login, e comia o toque.
      Corrigido no CSS. */
function loginAberto(){
  const m = document.getElementById('modal-operador');
  return !!(m && m.classList.contains('open'));
}

function atualizarFaixaOffline(estado){
  let faixa = document.getElementById('faixa-offline');
  const online = estado === 'online';
  if(online || loginAberto()){
    if(faixa) faixa.remove();
    document.body.classList.remove('esta-offline');
    return;
  }
  /* SESSÃO VENCIDA E FALTA DE REDE NÃO SÃO A MESMA COISA, e dizer a
     errada manda a pessoa procurar um problema que não existe.

     O celular do Rene da Expedição estava com 5G no sinal e a faixa dizia
     "VOCÊ ESTÁ OFFLINE". Ele não estava: a sessão dele tinha vencido — o
     token mora em sessionStorage e morre quando a aba fecha, o que no
     celular acontece sozinho o tempo todo. O caminho de volta existia, mas
     numa linha pequena no rodapé: "entre de novo para voltar a
     compartilhar".

     Aqui a faixa passa a dizer qual dos dois é, e no caso da sessão ela
     LEVA a pessoa de volta — botão que só nega não ensina o caminho. */
  const sessaoVenceu = (typeof SuincoSharePoint !== 'undefined'
    && SuincoSharePoint.sessaoPerdida && SuincoSharePoint.sessaoPerdida());
  const corpo = sessaoVenceu
    ? '<span class="faixa-offline-tit">⚠️ ALERTA !!!</span>'
      + '<span class="faixa-offline-txt">SUA SESSÃO EXPIROU — SISTEMA INDISPONÍVEL. '
      + 'ENTRE DE NOVO PARA CONTINUAR.</span>'
      + '<span class="faixa-offline-sub">Nada digitado agora será gravado. '
      + 'O aparelho tem internet; foi o acesso que venceu.</span>'
      + '<button type="button" class="btn btn-primary btn-sm faixa-offline-btn" '
      + 'onclick="abrirLoginDeNovo()">Entrar de novo</button>'
    : '<span class="faixa-offline-tit">⚠️ ALERTA !!!</span>'
      + '<span class="faixa-offline-txt">VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL. '
      + 'CONECTE-SE PARA CONTINUAR.</span>'
      + '<span class="faixa-offline-sub">Nada digitado agora será gravado.</span>';
  if(!faixa){
    faixa = document.createElement('div');
    faixa.id = 'faixa-offline';
    faixa.className = 'faixa-offline no-print';
    faixa.setAttribute('role', 'alert');
    document.body.insertBefore(faixa, document.body.firstChild);
  }
  // Reescreve sempre: o mesmo painel pode passar de sessão vencida para
  // rede caída sem recarregar, e a faixa que sobrou mentiria.
  faixa.innerHTML = corpo;
  document.body.classList.add('esta-offline');
}

/* A volta para dentro, a partir da faixa. Abre a mesma tela de login de
   sempre; `atualizarFaixaOffline` tira a faixa sozinha assim que ela abre,
   pela guarda do `loginAberto()`. */
function abrirLoginDeNovo(){
  const m = document.getElementById('modal-operador');
  if(m) m.classList.add('open');
  const srv = document.getElementById('login-servidor');
  const loc = document.getElementById('login-local');
  if(srv) srv.hidden = false;
  if(loc) loc.hidden = true;
  atualizarFaixaOffline('local');
  const email = document.getElementById('login-email');
  if(email) email.focus();
}

/* ===================================================================
   O MEDIDOR DE TRAVAMENTO (10/09/2026)
   -------------------------------------------------------------------
   Relato do dono, com print: "Page Unresponsive", e depois "travou no meu
   também" — duas máquinas diferentes.

   MEDI AQUI COM O VOLUME REAL DELE E NÃO REPRODUZI. Com os números da
   própria tela dele (18 cargas em aberto, 5 de programação anterior), a
   Torre desenha em menos de 1 s; com 80 linhas de montagem, 80 rotas e
   todos os selects, a Montagem desenha em 439 ms. Descartei vazamento de
   escuta (as 12 são delegadas e criadas uma vez), lista de sugestão por
   linha (são únicas), redesenho ao arrastar (o dragover só marca o
   destino) e redesenho a cada tique (só acontece se algo mudou).

   Nada disso explica dez segundos de aba congelada. E corrigir sem
   enxergar é chute — chute em produção é o que esta casa não faz.

   Então o painel passa a registrar SOZINHO: toda tarefa que segura a tela
   por mais de meio segundo fica gravada com hora, duração, aba aberta,
   o volume do momento e qual desenho estava em curso. Só leitura: não muda
   nenhuma decisão, nenhum dado, nenhuma tela — acrescenta um aviso no
   rodapé que só aparece quando há travamento registrado.

   O registro é POR NAVEGADOR e fica no armazenamento local, separado do
   cofre de dados: apagar os travamentos nunca pode encostar em carga. */
const TRAVAS_CHAVE = 'suinco_travamentos';
const TRAVA_MINIMA_MS = 500;
const TRAVAS_GUARDADAS = 25;
let _travamentos = [];
let _ultimosDesenhos = [];

function _lerTravamentos(){
  try {
    const bruto = localStorage.getItem(TRAVAS_CHAVE);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch(e){ return []; }
}

/* Guarda quanto durou cada desenho e quando ele foi, para o travamento
   poder dizer "foi a Torre desenhando" em vez de só "foi 8 segundos". */
function _marcarDesenho(nome, fn){
  const inicio = performance.now();
  try { return fn(); }
  finally {
    _ultimosDesenhos.push({ nome, inicio, fim: performance.now() });
    if(_ultimosDesenhos.length > 6) _ultimosDesenhos.shift();
  }
}

function _desenhoQueEncostou(inicio, fim){
  const d = _ultimosDesenhos.find(x => x.fim >= inicio && x.inicio <= fim);
  return d ? `${d.nome} (${Math.round(d.fim - d.inicio)} ms)` : 'fora de desenho';
}

function registrarTravamento(ms, inicio){
  try {
    const volume = {
      cargas: (DB.cargas || []).length,
      abertas: (typeof cargasAbertas === 'function') ? cargasAbertas().length : null,
      movimentacoes: (DB.movimentacoes || []).length,
      montagem: (_montagemDia && _montagemDia.montagens) ? _montagemDia.montagens.length : 0,
      frota: (DB.frota || []).length,
      nos: document.getElementsByTagName('*').length,
    };
    /* MEDIDOR V2 (11/09/2026). O registro de hoje mostrou travamentos de
       21 s e 46 s "fora de desenho", com desenhos de 0,3 s dentro — o
       código do painel não explica os outros 20 s. Sobraram três suspeitos
       que só o próprio congelamento pode nomear: memória (o coletor de
       lixo parando a página), rajada de eventos (30 avisos → 30 desenhos
       em fila) e aba em segundo plano. Cada um deixa uma marca diferente
       aqui. */
    const porAba = {};
    document.querySelectorAll('.tab-page').forEach(sec => {
      porAba[(sec.id || '').replace(/^tab-/, '') || '?'] = sec.getElementsByTagName('*').length;
    });
    const mem = (performance && performance.memory) ? performance.memory : null;
    const contexto = {
      memoriaMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      memoriaLimiteMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
      eventos30s: (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.eventosNosUltimos)
        ? SuincoSharePoint.eventosNosUltimos(30000) : null,
      desenhos30s: _ultimosDesenhos.filter(d => d.fim >= inicio - 30000).length,
      visivel: document.visibilityState,
      porAba,
    };
    _travamentos.push({
      em: new Date().toISOString(),
      ms: Math.round(ms),
      aba: (typeof TAB_ATUAL !== 'undefined') ? TAB_ATUAL : '?',
      desenho: _desenhoQueEncostou(inicio, inicio + ms),
      volume,
      contexto,
      versao: BUILD_ID,
    });
    while(_travamentos.length > TRAVAS_GUARDADAS) _travamentos.shift();
    localStorage.setItem(TRAVAS_CHAVE, JSON.stringify(_travamentos));
    if(typeof atualizarRodapeConexao === 'function'){
      const est = (typeof SuincoSharePoint !== 'undefined') ? SuincoSharePoint.estado() : 'local';
      atualizarRodapeConexao(est);
    }
  } catch(e){ /* medir nunca pode quebrar a tela que ele mede */ }
}

function ligarMedidorDeTravamento(){
  _travamentos = _lerTravamentos();
  try {
    if(typeof PerformanceObserver !== 'function') return;
    const tipos = (PerformanceObserver.supportedEntryTypes || []);
    if(tipos.indexOf('longtask') === -1) return;   // navegador sem a medida
    new PerformanceObserver((lista) => {
      lista.getEntries().forEach((e) => {
        if(e.duration >= TRAVA_MINIMA_MS) registrarTravamento(e.duration, e.startTime);
      });
    }).observe({ entryTypes: ['longtask'] });
  } catch(e){ /* idem */ }
}

function _resumoTravamentosHtml(){
  if(!_travamentos.length) return '';
  const pior = Math.max(..._travamentos.map(t => t.ms));
  return ` · <button type="button" class="rodape-travas" onclick="mostrarTravamentosUI()"`
    + ` title="A tela congelou. Clique para ver o registro e mandar para quem cuida do painel.">`
    + `\u23F1 ${_travamentos.length} travamento(s), pior ${(pior/1000).toFixed(1)}s</button>`;
}

/* Mostra em diálogo do navegador de propósito: é texto selecionável, não
   depende de CSS nem de aba nenhuma, e a pessoa consegue fotografar ou
   copiar direto para mandar. */
function mostrarTravamentosUI(){
  if(!_travamentos.length){ notify('Nenhum travamento registrado neste navegador.', '', 4000); return; }
  const linhas = _travamentos.slice().reverse().map(t => {
    const h = new Date(t.em).toLocaleString('pt-BR');
    const v = t.volume || {};
    const c = t.contexto || {};
    const abas = c.porAba ? Object.entries(c.porAba).filter(([,n]) => n > 500)
      .sort((a,b) => b[1]-a[1]).slice(0,4).map(([k,n]) => `${k} ${n}`).join(', ') : '';
    return `${h} \u00b7 ${(t.ms/1000).toFixed(1)}s \u00b7 aba "${t.aba}" \u00b7 ${t.desenho}\n`
      + `    cargas ${v.cargas} (${v.abertas} em aberto) \u00b7 ${v.movimentacoes} movimenta\u00e7\u00f5es`
      + ` \u00b7 ${v.montagem} linhas de montagem \u00b7 ${v.nos} elementos na tela`
      + (t.contexto ? `\n    mem\u00f3ria ${c.memoriaMB ?? '?'} MB de ${c.memoriaLimiteMB ?? '?'}`
        + ` \u00b7 ${c.eventos30s ?? '?'} eventos e ${c.desenhos30s ?? '?'} desenhos nos 30 s antes`
        + ` \u00b7 aba ${c.visivel === 'hidden' ? 'em segundo plano' : 'vis\u00edvel'}`
        + (abas ? ` \u00b7 peso: ${abas}` : '') : '');
  }).join('\n');
  alert('TRAVAMENTOS REGISTRADOS NESTE NAVEGADOR\n'
    + 'vers\u00e3o ' + BUILD_ID + '\n\n' + linhas
    + '\n\nMande esta tela para quem cuida do painel.');
}

function limparTravamentosUI(){
  _travamentos = [];
  try { localStorage.removeItem(TRAVAS_CHAVE); } catch(e){}
}

/* A CONEXÃO VOLTOU: REENVIA O QUE FICOU PARA TRÁS (24/09/2026).
   ---------------------------------------------------------------------
   RISCO R1 DO RAIO-X, medido e fechado. A carga criada enquanto o servidor
   estava fora do ar era aceita pela tela e NUNCA chegava ao servidor — nem
   depois de voltar. Medido em `testes/test_escrita_offline_chega_ao_servidor.py`:
   120 segundos e 10 sincronias forçadas depois da reconexão, a carga
   continuava só na cópia local. Quem lançou viu a tela aceitar e foi embora.

   A CAUSA, confirmada cutucando uma função de propósito: quem reenvia carga
   é `SuincoStore.sincronizarCargasAlteradas()`, e ela só roda DENTRO de
   `SuincoStore.save()`. E `sincronizarAgora()` não é isso — ela drena a fila
   e LÊ o pátio. Com a fila vazia (carga não entra na fila, vai pelo caminho
   próprio dela) e nada mudando na cópia local depois da queda, ninguém
   chamava `save()`. A carga ficava parada para sempre.

   No instante em que o `save()` foi forçado, a carga subiu — é esta a prova
   que nomeia a causa.

   POR QUE CHAMAR A SINCRONIA E NÃO `save()`. `save()` grava o banco local
   inteiro; aqui não há nada novo para gravar, só para reenviar. Chamar a
   parte certa evita uma escrita de disco à toa no momento em que o painel
   acabou de voltar — que é justamente quando o aparelho do pátio está mais
   ocupado se reconectando.

   POR QUE SÓ NA SUBIDA PARA `online`. Chamar em toda mudança de estado
   faria a tentativa se repetir durante a queda, contra um servidor que já
   não responde — o oposto do recuo de 11/09/2026, que existe justamente
   para não martelar servidor doente. */
let _estadoConexaoAnterior = null;
function reenviarPendentesAoVoltar(estado){
  const voltou = estado === 'online' && _estadoConexaoAnterior !== 'online';
  _estadoConexaoAnterior = estado;
  if(!voltou) return;
  if(typeof SuincoStore === 'undefined' || !SuincoStore.sincronizarCargasAlteradas) return;
  try{ SuincoStore.sincronizarCargasAlteradas(); }
  catch(e){ console.warn('[Suinco] reenvio ao voltar:', e); }
}

function atualizarRodapeConexao(estado, detalhe){
  // A conexão voltando é o gatilho de reenviar o que a queda deixou para
  // trás. Fica aqui porque este é o ponto por onde TODA mudança de estado
  // passa — um lugar só, como manda a casa.
  reenviarPendentesAoVoltar(estado);
  /* SESSÃO MORTA ABRE O LOGIN. Não é aviso, é a única coisa que resolve.

     O que a operação relatou em 31/08/2026, com todo mundo parado: "quem tá
     tentando abrir a versão com a faixa não consegue fazer nada, nem clicar
     no novo login". Medido no desktop, com a sessão perdida:

         loginAberto: False   ·   DIGITOU NO EMAIL: NAO

     E o motivo não era a faixa tampando — era que NÃO HAVIA login na tela.
     O painel reabre com o operador restaurado do localStorage, monta a tela
     de trabalho inteira, e a caixa de login fica `display:none`. A pessoa
     olha botões que não gravam nada e não tem por onde entrar de novo.
     Todo o resto que eu fiz hoje (baixar o z-index, esconder a faixa, pôr
     um botão dentro dela) tratava o sintoma: a porta continuava fechada.

     Sem sessão não há o que fazer no painel — então o painel pede a sessão.
     Só vale para sessão PERDIDA: quem escolheu "Entrar sem servidor" decidiu
     isso, e não pode ser interrompido por uma tela de login. */
  try{
    if(typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.sessaoPerdida
       && SuincoSharePoint.sessaoPerdida()){
      const m = document.getElementById('modal-operador');
      if(m && !m.classList.contains('open') && typeof abrirLogin === 'function'){
        abrirLogin();
      }
    }
  }catch(e){ console.warn('[Suinco] abrir login apos sessao perdida:', e); }
  atualizarFaixaOffline(estado);
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
    /* A frase antiga dizia "gravando no aparelho e sincronizando assim que
       a rede voltar". Isso deixou de ser verdade em 31/08: offline não grava
       mais nada. Rótulo que mente é a família da ocorrência #04. */
    rod.innerHTML = `⛔ OFFLINE — o sistema não aceita alteração sem conexão${esc(carimbo)}`;
    if(badge) marcarBadgeConexao(badge, 'offline', '⚠️', 'Modo Offline');
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
    if(badge) marcarBadgeConexao(badge, 'local', '⚙️', 'Modo Local');
  }
  /* O aviso de travamento vai DEPOIS, uma vez só, nas três situações: ele
     não descreve a conexão, descreve a máquina — e some sozinho quando não
     há nada registrado. */
  const travas = _resumoTravamentosHtml();
  if(travas) rod.innerHTML += travas;
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

