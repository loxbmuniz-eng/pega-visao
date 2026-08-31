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
function atualizarFaixaOffline(estado){
  let faixa = document.getElementById('faixa-offline');
  const online = estado === 'online';
  if(online){
    if(faixa) faixa.remove();
    document.body.classList.remove('esta-offline');
    return;
  }
  // Antes do login não existe "offline": ninguém tentou conectar ainda.
  if(!DB.operador){
    if(faixa) faixa.remove();
    document.body.classList.remove('esta-offline');
    return;
  }
  if(!faixa){
    faixa = document.createElement('div');
    faixa.id = 'faixa-offline';
    faixa.className = 'faixa-offline no-print';
    faixa.setAttribute('role', 'alert');
    faixa.innerHTML = '<span class="faixa-offline-tit">⚠️ ALERTA !!!</span>'
      + '<span class="faixa-offline-txt">VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL. '
      + 'CONECTE-SE PARA CONTINUAR.</span>'
      + '<span class="faixa-offline-sub">Nada digitado agora será gravado.</span>';
    document.body.insertBefore(faixa, document.body.firstChild);
  }
  document.body.classList.add('esta-offline');
}

function atualizarRodapeConexao(estado, detalhe){
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
function _exibirNotif(el, ms, opcoes){
  const container = document.getElementById('notif');
  // `perecivel`: notícia de outro setor. Ver o bloco de regras no topo.
  const perecivel = !!(opcoes && opcoes.perecivel) && !el.classList.contains('forte');
  if(perecivel && notifRecemChegado()) return;

  if(container.querySelectorAll('.notif-item').length >= NOTIF_MAX_VISIVEL){
    if(!perecivel){
      _notifFila.push({ el, ms, em: Date.now(), perecivel: false });
      _atualizarContadorFila();
    }
    // PERECÍVEL NÃO ESPERA (pedido do dono, 27/08/2026): notícia de outro
    // setor é tempo real ou nada. A tela já mostra o resultado da mudança;
    // guardar o aviso pra depois vira reprise retroativa — morre aqui.
    return;
  }
  _mostrarNotifAgora(el, ms);
}

/* Tira da fila o próximo que ainda VALE mostrar. Perecível vencido é
   descartado aqui, e não quando entrou: enquanto a fila anda rápido ele
   ainda é notícia; quando ela empaca, deixou de ser. */
function _proximoDaFila(){
  while(_notifFila.length){
    const item = _notifFila.shift();
    if(item.perecivel && (Date.now() - item.em) > NOTIF_VALIDADE_MS) continue;
    return item;
  }
  return null;
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
    const proximo = _proximoDaFila();   // tira da fila ANTES de contar — o contador reflete o que sobra
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
/* Aviso de gravação: nunca diz "pronto" quando o dado ainda não subiu.

   Incidente real relatado pelo gestor (12/08/2026): o programador lançou
   cargas por um tempo sem perceber que o painel estava DESCONECTADO. Elas
   não apareciam pra ninguém, e ele teve que lançar tudo de novo.

   O diagnóstico de "falta de cultura — as pessoas precisam olhar a luz
   verde" não se sustenta olhando o código: ao criar uma carga offline, o
   sistema respondia "Carga criada" em VERDE, com cara de sucesso. O aviso
   de conexão existia, mas passivo, no rodapé — enquanto a confirmação da
   ação, que é onde o olho está, dizia que tinha dado certo.

   Ninguém precisa lembrar de conferir nada se a própria confirmação for
   honesta. Aqui: gravou local e ainda não subiu, o aviso muda de cor, de
   ícone e de texto, e diz o que falta acontecer. */
function estadoDaConexao(){
  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.estado) return 'local';
  return SuincoSharePoint.estado();
}

function notifyGravacao(msgSucesso, msObrigatorio){
  const estado = estadoDaConexao();
  if(estado === 'online'){ notify(msgSucesso, 'success', msObrigatorio); return; }

  if(estado === 'offline'){
    /* A FRASE MUDOU COM A REGRA (31/08/2026). Ela dizia "está gravado só
       neste aparelho e sobe sozinho quando a rede voltar" — o que deixou de
       ser verdade quando o dono aboliu a gravação offline. Nada sobe sozinho
       agora, porque nada fica guardado.

       Esta função é o ponto por onde passa TODO aviso de gravação do painel:
       corrigir a mensagem aqui corrige em todas as telas de uma vez, em vez
       de caçar cada uma — e é o que evita a tela dizer "cadastrada" numa
       linha e "não foi cadastrada" na seguinte. */
    notify(`⛔ VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL. `
      + `NADA FOI GRAVADO. Conecte-se e faça de novo.`,
      'danger', 12000);
    return;
  }
  // 'local': nem sessão de servidor existe. Aqui não sobe nunca sozinho.
  notify(`⚠️ MODO LOCAL — ${msgSucesso} Fica SÓ neste navegador: `
    + 'nenhum outro setor vai ver, e não sobe sozinho. Entre com seu e-mail para compartilhar.',
    'danger', 12000);
}

function notify(msg, type, ms, opcoes){
  const el = document.createElement('div');
  el.className = 'notif-item' + (type ? ' ' + type : '');
  const texto = document.createElement('span');
  texto.textContent = msg;
  el.appendChild(texto);
  _exibirNotif(el, ms, opcoes);
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

/* Notícia de outro setor é TEMPO REAL OU NADA (pedido do dono, 27/08/2026:
   "quero que seja em tempo real e só, e não fique mostrando notificações
   retroativas"). Três regras, nesta ordem:

   1. Já tem um aviso verde de outro setor na tela? NÃO empilha outro:
      o mesmo aviso atualiza o texto com o total acumulado. No máximo UMA
      janelinha verde existe por vez.
   2. A tela está cheia de avisos mais importantes? A notícia é DESCARTADA,
      não enfileirada. A tela já mostra o resultado da mudança — reprise
      de "carga X mudou" minutos depois é ruído, nunca informação.
   3. O aviso dura pouco (7s) e morre sozinho.

   Avisos NÃO perecíveis (recusa do servidor, erro de gravação, troca de
   placa) continuam com a fila de antes — aqueles são resposta a uma ação
   de quem está na tela, e esperar a vez é correto. */
let _remotaEl = null;
let _remotaTotal = 0;
function notifyAtualizacaoRemota(r){
  const totalNovo = (r.cargasNovas||0) + (r.cargasAtualizadas||0);
  if(_remotaEl && _remotaEl.isConnected){
    _remotaTotal += totalNovo;
    const span = _remotaEl.querySelector('span');
    if(span) span.textContent = 'Atualizado por outros setores: '
      + `${_remotaTotal} movimentação(ões) agora há pouco — a tela já mostra tudo.`;
    return;
  }
  const container = document.getElementById('notif');
  if(container && container.querySelectorAll('.notif-item').length >= NOTIF_MAX_VISIVEL){
    return; // tela ocupada com coisa mais importante: notícia morre aqui
  }
  _remotaTotal = totalNovo;
  const el = document.createElement('div');
  el.className = 'notif-item success';
  const texto = document.createElement('span');
  texto.textContent = mensagemAtualizacaoRemota(r);
  el.appendChild(texto);
  _remotaEl = el;
  _exibirNotif(el, 7000, { perecivel: true });
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
  /* Perecível, EXCETO o sonoro: troca de placa é segurança (o caminhão
     errado entra na doca por causa dela) e nunca é descartada nem
     silenciada na janela de chegada. _exibirNotif já protege a classe
     `forte`; o sinalizador aqui é o mesmo, escrito por extenso. */
  _exibirNotif(el, aviso.sonoro ? 20000 : 9000, { perecivel: !aviso.sonoro });

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
/* A rota foi gravada aqui mas ainda não subiu — está na fila. É o aviso que
   faltava no incidente de 14/08/2026: o gestor cadastrou a 537, viu verde, e
   o programador nunca a recebeu. */
function receberEnfileiramentoDeRota(rota){
  const fila = (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.pendentes)
    ? SuincoSharePoint.pendentes() : 0;
  notify(
    `⚠️ Rota ${rota.codigo} ainda NÃO subiu ao servidor`
    + (fila ? ` (${fila} na fila)` : '')
    + '. Está salva neste aparelho e sobe sozinha quando a conexão voltar — '
    + 'até lá os outros setores NÃO veem esta rota.',
    'warn', 15000);
  tocarAlertaAlteracao();
}

function receberRecusaDeRota(rota, motivo, desfeita){
  /* Duas recusas, duas frases. Antes era uma só, e ela mentia metade do
     tempo: dizia "ficou salva só neste aparelho" mesmo quando a rota tinha
     sido desfeita. Rótulo que mente é a família da ocorrência #04. */
  notify(desfeita
    ? `Rota ${rota.codigo} NÃO foi cadastrada. ${motivo || ''} `
      + 'Ela não ficou guardada em lugar nenhum — conecte e cadastre de novo.'
    : `Rota ${rota.codigo}: o servidor recusou o cadastro. ${motivo || ''} `
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
/* O PAINEL PERCEBE SOZINHO QUE O SERVIDOR FICOU PARA TRAS (26/08/2026).
   =====================================================================
   Cobranca do Luis, e ele tem razao: "voce errou e ficou em silencio numa
   operacao rodando".

   O painel sobe sozinho no Vercel; o servidor so muda quando alguem roda o
   atualizar.sh por SSH. Entre os dois ha uma janela em que a tela ja tem o
   botao novo e o servidor ainda nao tem a rota. Em 25 e 26/08 essa janela
   custou tres relatos: o botao de excluir usuario dando "Rota nao
   encontrada", e a montagem do dia acumulando 53 linhas duplicadas porque
   a de-duplicacao dependia de uma migracao que nao tinha subido.

   Nas tres vezes a informacao existia e dependia de EU lembrar de avisar.
   Na terceira eu esqueci — e a operacao rodou o dia inteiro duplicando.

   Isto tira a memoria do caminho. O /health passou a dizer a data da versao
   do servidor; aqui o painel compara com a data da propria build e avisa
   quem pode agir.

   SO PARA QUEM RESOLVE. Administracao e Logistica sao quem pede o
   atualizar.sh; a Portaria nao tem o que fazer com essa informacao, e um
   aviso que a pessoa nao pode atender vira ruido que ela aprende a ignorar.

   MARGEM DE UMA HORA. Publicar o painel e atualizar o servidor nunca
   acontecem no mesmo minuto, e uma diferenca de minutos e o fluxo normal de
   um deploy. O aviso e para a defasagem que ficou — nao para a que esta
   acontecendo agora. */
/* =====================================================================
   AVISO NO CELULAR (26/08/2026)
   ---------------------------------------------------------------------
   Pedido do dono: "eu quero que todos que estiverem com o embarquesuinco
   ligado no celular com atalho direto nos icones do celular como se fosse
   um aplicativo recebam notificacoes push a cada vez que um caminhao
   entrar na portaria ou sair, a cada vez que a programacao for finalizada
   por inteiro".

   O QUE ESTA TELA PRECISA FAZER, e é só isso: dizer com honestidade o que
   está acontecendo. Ligar é um botão; o difícil é o caso em que NÃO dá — e
   aí a tela tem que dizer POR QUE e o que fazer. "Não funcionou" sem
   motivo é o que faz a pessoa desistir e nunca mais tentar.
   ===================================================================== */

/* Espelho da regra do servidor (servicos/avisos.js). Existe para a tela
   poder dizer "você recebe isto" sem chutar. Se um dia a lista de lá
   mudar, esta muda junto — e há teste de tela que reprova se divergirem. */
function _avisosQueEsteSetorRecebe(setor){
  const recebe = [];
  if(['Logística','Administração','Expedição'].includes(setor)){
    recebe.push('🚚 Caminhão entrando na portaria');
  }
  if(['Logística','Administração'].includes(setor)){
    recebe.push('✅ Caminhão que seguiu viagem');
  }
  recebe.push('🏁 Fim da programação do dia');
  return recebe;
}

async function abrirModalAvisos(){
  document.getElementById('modal-avisos').classList.add('open');
  await atualizarModalAvisos();
}

function fecharModalAvisos(){
  document.getElementById('modal-avisos').classList.remove('open');
}

async function atualizarModalAvisos(){
  const caixaLista = document.getElementById('avisos-oquerecebe');
  const caixaEstado = document.getElementById('avisos-estado');
  const botao = document.getElementById('avisos-alternar');
  const btnTeste = document.getElementById('avisos-testar');
  const setor = (DB.operador || {}).setor || '';

  caixaLista.innerHTML = '<strong>O que você recebe, como ' + esc(setor) + ':</strong><br>'
    + _avisosQueEsteSetorRecebe(setor).map(x => '· ' + esc(x)).join('<br>');

  /* `typeof`, e não `window.SuincoSharePoint`: o adaptador é declarado com
     `const` no topo do arquivo, e const de topo NÃO vira propriedade de
     window. Escrito da outra forma, esta tela dizia "painel desatualizado"
     em todos os casos — o teste de tela pegou. */
  const api = (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.avisos) || null;
  if(!api){
    caixaEstado.textContent = 'Este painel está desatualizado. Recarregue a página.';
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  /* Ordem das perguntas de propósito: primeiro o que impede o APARELHO
     (que a pessoa resolve sozinha), depois o que impede o SERVIDOR (que
     depende de outra pessoa). Começar pelo servidor faria o dono de um
     iPhone em aba receber "peça para atualizar o servidor" — e ele
     pediria, e continuaria sem funcionar. */
  const impedimento = api.porQueNaoPode();
  if(impedimento){
    caixaEstado.textContent = impedimento;
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  let servidor;
  try{
    servidor = await api.estadoNoServidor();
  }catch(e){
    caixaEstado.textContent = 'Não consegui falar com o servidor agora. Tente daqui a pouco.';
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  if(!servidor.ligado){
    caixaEstado.textContent = 'O aviso no celular ainda não foi ligado no servidor. '
      + 'É uma configuração de uma vez só — avise a Logística.';
    botao.hidden = true; btnTeste.hidden = true;
    return;
  }

  const ligado = await api.ligadoNesteAparelho();
  botao.hidden = false;
  botao.textContent = ligado ? 'Desligar neste aparelho' : 'Ligar avisos';
  botao.className = ligado ? 'btn btn-sec' : 'btn btn-primary';
  btnTeste.hidden = !ligado;

  if(ligado){
    caixaEstado.textContent = 'Ligado neste aparelho.'
      + (servidor.aparelhos > 1 ? ` Você tem ${servidor.aparelhos} aparelhos recebendo.` : '')
      + (api.ehAplicativoInstalado() ? '' :
         ' Dica: instale o painel na tela de início para o aviso chegar com o navegador fechado.');
  }else{
    caixaEstado.textContent = 'Desligado neste aparelho. '
      + 'Ao ligar, o aparelho vai pedir permissão uma vez.';
  }
}

async function alternarAvisosUI(){
  const api = SuincoSharePoint.avisos;
  const botao = document.getElementById('avisos-alternar');
  botao.disabled = true;
  try{
    if(await api.ligadoNesteAparelho()){
      await api.desligar();
      notify('Avisos desligados neste aparelho.', 'info');
    }else{
      await api.ligar();
      notify('Avisos ligados. Mande um teste para conferir.', 'success');
    }
  }catch(e){
    notify(e.message || 'Não consegui mudar os avisos.', 'error', 9000);
  }finally{
    botao.disabled = false;
    await atualizarModalAvisos();
  }
}

async function testarAvisosUI(){
  const btn = document.getElementById('avisos-testar');
  btn.disabled = true;
  try{
    const r = await SuincoSharePoint.avisos.testar();
    notify(r.enviados
      ? 'Mandei. Se não aparecer em alguns segundos, o aparelho está com os avisos bloqueados.'
      : 'O servidor não achou nenhum aparelho seu inscrito. Ligue os avisos de novo.',
      r.enviados ? 'success' : 'warning', 9000);
  }catch(e){
    notify(e.message || 'Não consegui mandar o teste.', 'error', 9000);
  }finally{
    btn.disabled = false;
  }
}

/* Reinscreve em silêncio quem JÁ tinha ligado.

   Duas coisas quebram uma inscrição sem ninguém perceber: o navegador
   trocar o endereço sozinho (rodízio de chave do serviço de push) e a
   pessoa entrar com outra conta no mesmo aparelho — a inscrição continua
   viva, mas amarrada a quem saiu. Nos dois casos o aviso simplesmente para
   de chegar, sem erro nenhum na tela.

   Por isso isto roda a cada login: se a permissão JÁ foi dada, reinscreve.
   Nunca PEDE permissão sozinho — pedir sem a pessoa ter clicado em nada é
   o caminho mais rápido para um "bloquear" definitivo. */
async function garantirInscricaoDeAvisos(){
  try{
    const api = (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.avisos) || null;
    if(!api) return;
    if(typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if(api.porQueNaoPode()) return;
    await api.ligar();
  }catch(e){
    /* Silêncio de propósito: quem não ligou os avisos não pode ganhar uma
       mensagem de erro sobre eles ao entrar no painel. */
  }
}

/* O service worker avisa quando o endereço de inscrição mudou. */
if(typeof navigator !== 'undefined' && navigator.serviceWorker){
  navigator.serviceWorker.addEventListener('message', (ev)=>{
    if(ev.data && ev.data.tipo === 'reinscrever-avisos') garantirInscricaoDeAvisos();
  });
}

const _FOLGA_DEPLOY_MS = 60 * 60 * 1000;

async function conferirVersaoDoServidor(){
  const setor = (DB.operador || {}).setor;
  if(setor !== 'Administração' && setor !== 'Logística') return;

  const nossoEm = (typeof window !== 'undefined' && window.SUINCO_BUILD_EM) || null;
  if(!nossoEm) return;   // build de desenvolvimento, sem carimbo

  try {
    const r = await fetch(SuincoSharePoint.enderecoDaApi() + '/health');
    if(!r.ok) return;
    const saude = await r.json();
    if(!saude || !saude.versaoEm) return;   // servidor antigo, sem o campo

    const servidor = new Date(saude.versaoEm).getTime();
    const painel   = new Date(nossoEm).getTime();
    if(!Number.isFinite(servidor) || !Number.isFinite(painel)) return;
    if(servidor >= painel - _FOLGA_DEPLOY_MS) return;   // em dia

    const horas = Math.round((painel - servidor) / 3600000);
    const quanto = horas < 24
      ? `${horas} hora(s)`
      : `${Math.round(horas / 24)} dia(s)`;
    notify(
      `O servidor está ${quanto} atrás deste painel (servidor: ${esc(saude.versao)}). `
      + 'Funções novas podem não funcionar até rodar a atualização do servidor '
      + '(atualizar.sh). Avise a TI.',
      'warn', 15000);
  } catch(e){
    /* Sem rede, ou /health fora do ar: silêncio. Este aviso é um extra —
       transformá-lo em mais um erro na tela de quem já está sem conexão
       seria trocar ajuda por barulho. */
  }
}

function abrirLogin(){
  /* Pré-login: o painel some por inteiro (body.pre-login esconde tudo que
     não é a tela de entrada — ver styles.css). Não é só estética: terminal
     de pátio fica ligado o dia todo, e quem ainda não se identificou não
     deve ver carga, placa nem status ao fundo. */
  document.body.classList.add('pre-login');
  const v = document.getElementById('login-versao');
  if(v) v.textContent = 'versão ' + BUILD_ID;
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
  /* DOIS 429 DIFERENTES, e confundi-los foi metade do problema do René
     (25/08/2026): a tela dizia "muitas tentativas deste local" para quem
     tinha digitado a senha certa uma vez só.

     BLOQUEIO_TEMPORARIO é da CONTA — cinco senhas erradas nela — e o
     servidor já manda a frase com quantos minutos faltam. Repassar a dele
     é melhor do que inventar uma versão mais vaga aqui.

     LIMITE_LOGIN é do LOCAL, e desde 26/08 só conta senha ERRADA: se esta
     mensagem aparecer para alguém que digitou certo, é defeito, não
     excesso de gente entrando junto. */
  if(e && e.codigo === 'BLOQUEIO_TEMPORARIO'){
    return (e.message || 'Esta conta está bloqueada por alguns minutos.') + ' [CONTA]';
  }
  if(e && e.status === 429){
    return 'Muitas senhas erradas deste local no último minuto. '
         + 'Espere 1 minuto e tente de novo. Se você não errou a senha, '
         + 'avise a Logística — isto não é para acontecer. [LIMITE]';
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
  const codigo = (document.getElementById('login-codigo') || {}).value || '';
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
    const op = await SuincoSharePoint.login(email, senha, codigo);
    // O id vem junto para o painel saber distinguir "eu editei" de "outro
    // editou" — dois operadores podem ter o mesmo primeiro nome.
    DB.operador = { id: op.id, nome: op.nome, setor: op.setor, email: op.email, turno: detectarTurnoPorHora() };
    SuincoStore.save();

    // Limpa a senha do DOM assim que ela deixa de ser necessária. Terminal de
    // pátio é compartilhado, e campo preenchido é o tipo de coisa que o
    // próximo turno encontra.
    document.getElementById('login-senha').value = '';

    document.getElementById('modal-operador').classList.remove('open');
    revelarPainel();
    atualizarHeaderOperador();
    aplicarPermissoesSetor();
    renderAll();
    notify(`Bem-vindo, ${op.nome}! Setor: ${op.setor}`, 'success');
    conferirVersaoDoServidor();   // sem await: não segura a entrada de ninguém
    garantirInscricaoDeAvisos(); // idem: e nunca pede permissão sozinho
  }catch(e){
    /* SEGUNDO FATOR (etapa 4). O servidor recusa com MFA_NECESSARIO quando
       a senha está certa e falta o código. Revelar o campo só aqui — e não
       de saída — significa que quem não ativou nunca vê um campo que não
       usa, e quem ativou é levado ao passo seguinte sem precisar entender
       nada de segurança. */
    const precisaCodigo = /MFA_NECESSARIO|aplicativo autenticador/i.test(String(e && e.message || ''));
    if(precisaCodigo){
      const bloco = document.getElementById('login-mfa-bloco');
      const campo = document.getElementById('login-codigo');
      if(bloco) bloco.hidden = false;
      if(campo){ campo.value = ''; campo.focus(); }
      mostrarErroLogin('Digite o código do seu aplicativo autenticador.');
    }else{
      const codigoErrado = /MFA_INVALIDO|Código incorreto/i.test(String(e && e.message || ''));
      if(codigoErrado){
        const campo = document.getElementById('login-codigo');
        if(campo){ campo.value = ''; campo.focus(); }
      }
      mostrarErroLogin(await explicarFalhaDeLogin(e));
    }
  }finally{
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

/* =====================================================================
   PEDIDOS DE APROVAÇÃO — desligado em 25/08/2026
   =====================================================================
   Este card era o outro lado da segunda assinatura: quem pedia para
   restaurar, corrigir etapa ou devolver carga excluída aparecia aqui para
   outro administrador aprovar.

   O dono tirou a exigência ("quem for da administração não precisa da
   autorização de nada") e, com ela, este card perdeu função: não há mais
   pedido nenhum a fazer. Ver o comentário no topo de
   backend/src/rotas/cargas.js para o que a trava protegia e o que ficou
   no lugar dela.

   A função continua existindo e continua sendo chamada de um lugar só —
   para MANTER O CARD ESCONDIDO. Sem isto, o card do HTML voltaria a
   aparecer vazio para quem estivesse com a página aberta. */
async function renderPedidosAprovacaoUI(){
  const card = document.getElementById('card-aprovacoes');
  if(card) card.hidden = true;
}

/* =====================================================================
   SEGUNDO FATOR — a tela de quem ativa o próprio
   =====================================================================
   Etapa 4 do protocolo de segurança (22/08/2026). Fica na aba Usuários,
   porque é onde a pessoa já vai cuidar da própria conta.

   O texto foi escrito para quem nunca ouviu falar de TOTP: a tela fala em
   "aplicativo autenticador" e "código de 6 dígitos", nunca em "segredo
   compartilhado" ou "one-time password". Controle que a pessoa não entende
   é controle que ela contorna. */
async function renderMinhaSegurancaUI(){
  const alvo = document.getElementById('mfa-painel');
  if(!alvo || !SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()) return;
  let sit;
  try{
    sit = await SuincoSharePoint.mfa.situacao();
  }catch(e){
    // Servidor ainda sem a etapa 4: some em silêncio em vez de mostrar erro
    // para quem não pediu nada.
    alvo.innerHTML = '';
    return;
  }
  if(sit.mfa_ativo){
    alvo.innerHTML = `
      <div class="mfa-ativo">
        <div><strong>Segundo fator ATIVO</strong>${sit.mfa_ativado_em
          ? ` · desde ${esc(fmtDataHora(sit.mfa_ativado_em))}` : ''}</div>
        <div class="card-sub" style="margin:6px 0 10px">
          Restam <strong>${Number(sit.codigos_restantes || 0)}</strong> códigos de recuperação.
          ${Number(sit.codigos_restantes || 0) <= 2
            ? 'Estão acabando — desative e ative de novo para gerar um lote novo.' : ''}
        </div>
        <button class="btn btn-sec btn-sm" onclick="desativarMfaUI()">Desativar segundo fator</button>
      </div>`;
    return;
  }
  alvo.innerHTML = `
    <div class="card-sub">Seu acesso está protegido só pela senha. Com o segundo fator,
      quem descobrir sua senha ainda não entra.</div>
    <button class="btn btn-primary btn-sm" onclick="iniciarMfaUI()">Ativar segundo fator</button>`;
}

/* ATIVAR O SEGUNDO FATOR — com QR, porque é assim que a pessoa faz.

   Pedido do gestor (25/08/2026): "a autenticação de dois fatores eu quero
   pelo Microsoft Authenticator".

   O painel já falava a língua do aplicativo — o que faltava era o QR. Antes,
   a tela pedia que a pessoa achasse "inserir chave manualmente" dentro de um
   menu do aplicativo e digitasse 32 caracteres embaralhados no celular. É o
   passo em que a adesão morre: quem erra dois caracteres não sabe que errou,
   vê "código inválido" e desiste.

   A CHAVE CONTINUA NA TELA, embaixo do QR e sem destaque. Não é redundância
   boba: câmera quebrada, permissão negada, aplicativo de empresa que só
   aceita entrada manual — e QR na tela de computador que o operador acessa
   pelo próprio celular (não dá para fotografar a própria tela). Uma saída
   só é uma saída frágil.

   Se o desenho do QR falhar por qualquer motivo, a tela mostra a chave e
   segue funcionando — nunca um quadrado quebrado no lugar. */
async function iniciarMfaUI(){
  const alvo = document.getElementById('mfa-painel');
  try{
    const r = await SuincoSharePoint.mfa.iniciar();
    const qr = (typeof SuincoQR !== 'undefined' && r.endereco)
      ? SuincoQR.svg(r.endereco, 190) : null;
    alvo.innerHTML = `
      <div class="mfa-passos">
        <div class="mfa-passo"><strong>1.</strong> No celular, abra o
          <strong>Microsoft Authenticator</strong> (ou o Google Authenticator —
          os dois servem e são gratuitos).</div>
        <div class="mfa-passo"><strong>2.</strong> Toque em <em>+</em> →
          <em>Conta corporativa ou de estudante</em> → <em>Ler código QR</em>
          e aponte a câmera para o quadrado abaixo.
          ${qr ? `<div class="mfa-qr">${qr}</div>` : ''}
          <details class="mfa-manual">
            <summary>Não consegue ler o código? Digite a chave</summary>
            <div class="card-sub" style="margin-top:6px">No aplicativo, escolha
              <em>inserir chave manualmente</em> e digite:</div>
            <div class="mfa-segredo">${esc((r.segredo.match(/.{1,4}/g) || []).join(' '))}</div>
            <span class="card-sub">Conta: Embarque Suinco · ${esc((DB.operador||{}).email || '')}</span>
          </details>
        </div>
        <div class="mfa-passo"><strong>3.</strong> Digite abaixo o código de 6 dígitos
          que o aplicativo mostrar:
          <div class="form-row" style="margin-top:8px">
            <input type="text" id="mfa-confirmar-codigo" placeholder="000000" maxlength="6"
                   inputmode="numeric" style="max-width:140px">
            <button class="btn btn-primary btn-sm" onclick="confirmarMfaUI()">Confirmar e ativar</button>
            <button class="btn btn-sec btn-sm" onclick="renderMinhaSegurancaUI()">Cancelar</button>
          </div>
        </div>
      </div>`;
  }catch(e){
    notify('Não consegui iniciar: ' + (e && e.message || 'erro'), 'danger', 6000);
  }
}

async function confirmarMfaUI(){
  const campo = document.getElementById('mfa-confirmar-codigo');
  const codigo = (campo && campo.value || '').trim();
  if(codigo.length !== 6){ notify('Digite os 6 dígitos do aplicativo.', 'warn'); return; }
  try{
    const r = await SuincoSharePoint.mfa.confirmar(codigo);
    const alvo = document.getElementById('mfa-painel');
    /* Os códigos de recuperação aparecem UMA VEZ. Mostrar em bloco grande,
       com o aviso de imprimir, porque a pessoa que fechar esta tela sem
       guardar vai depender de um administrador no dia em que perder o
       celular. */
    alvo.innerHTML = `
      <div class="mfa-recuperacao">
        <div class="mfa-recuperacao-tit">Guarde estes códigos agora — eles não aparecem de novo</div>
        <div class="card-sub">Cada um serve UMA vez, para entrar sem o celular.
          Imprima e guarde fora do aparelho.</div>
        <div class="mfa-codigos">${r.codigosRecuperacao.map(c=>`<span>${esc(c)}</span>`).join('')}</div>
        <div class="form-row" style="margin-top:10px">
          <button class="btn btn-sec btn-sm" onclick="window.print()">Imprimir</button>
          <button class="btn btn-primary btn-sm" onclick="renderMinhaSegurancaUI()">Já guardei</button>
        </div>
      </div>`;
    notify('Segundo fator ativado.', 'success');
  }catch(e){
    notify(e && e.message || 'Código incorreto.', 'danger', 6000);
  }
}

async function desativarMfaUI(){
  const senha = prompt('Confirme sua senha para desativar o segundo fator:');
  if(!senha) return;
  try{
    await SuincoSharePoint.mfa.desativar(senha);
    notify('Segundo fator desativado.', 'warn');
    renderMinhaSegurancaUI();
  }catch(e){
    notify(e && e.message || 'Não consegui desativar.', 'danger', 6000);
  }
}

async function resetarMfaDeUI(id, nome){
  const motivo = prompt(`Por que está removendo o segundo fator de ${nome}?\n`
    + '(fica registrado e avisa os outros administradores)');
  if(!motivo || !motivo.trim()) return;
  try{
    const r = await SuincoSharePoint.mfa.resetarDe(id, motivo.trim());
    notify(r.aviso || 'Segundo fator removido.', 'success', 8000);
    if(typeof renderUsuarios === 'function') renderUsuarios();
  }catch(e){
    notify(e && e.message || 'Não consegui remover.', 'danger', 6000);
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
  revelarPainel();
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
/* Tira o corpo do pré-login e dá uma entrada suave ao painel. A classe de
   animação é temporária de propósito: fica só o tempo do efeito, para não
   re-animar a cada render. `prefers-reduced-motion` é respeitado no CSS. */
function revelarPainel(){
  document.body.classList.remove('pre-login');
  document.body.classList.add('painel-entrando');
  setTimeout(()=>document.body.classList.remove('painel-entrando'), 600);
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
  const admin = DB.operador.setor === 'Administração';
  document.querySelectorAll('.nav-tab').forEach(el=>{
    /* A aba Usuários passa a ser de TODOS (22/08/2026, etapa 4).

       O motivo é o segundo fator: proteger a própria conta não pode ser
       privilégio de quem administra os outros. Quem não é Administração vê
       ali só "Minha segurança" — os cards de gerenciar usuários continuam
       escondidos, e o servidor recusa as rotas de qualquer jeito. */
    const liberada = doSetor.includes(el.dataset.tab)
      || (el.dataset.tab === 'usuarios');
    el.hidden = !liberada;
  });
  // Dentro da aba Usuários: gerenciar gente é só da Administração.
  document.querySelectorAll('#tab-usuarios .card').forEach(card=>{
    if(card.id === 'card-minha-seguranca') return;
    card.hidden = !admin;
  });
  if(!doSetor.includes(TAB_ATUAL) && TAB_ATUAL !== 'usuarios') irParaTab(doSetor[0] || 'torre');
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
    case 'programacao': renderProgFila(); renderProgAguardando(); renderRodapeControleProgramacao(); carregarMontagemUI(); carregarModeloSemanaUI(); break;
    // Módulo próprio (devolucoes.js, carregado depois deste arquivo). O
    // typeof protege a ordem de carga: se o módulo faltar, a aba fica
    // vazia em vez de derrubar a navegação inteira.
    case 'devolucoes': if(typeof renderDevolucoes === 'function') renderDevolucoes(); break;
    case 'portaria':
      renderPortariaProgramadas();
      renderPortariaPatio();
      renderVisaoPatio('portaria');
      { const el = document.getElementById('portaria-placa'); if(el) setTimeout(()=>el.focus(), 30); }
      break;
    case 'expedicao': renderExpedicao(); renderVisaoPatio('expedicao'); break;
    case 'faturamento': renderFaturamento(); renderVisaoPatio('faturamento'); break;
    case 'indicadores': renderIndicadores(); break;
    case 'cadastros':
      renderCadastros();
      // A tabela de produtos (base oficial de 18/08/2026) vive no módulo
      // de Devoluções e vem do servidor — carrega na primeira abertura.
      if (typeof carregarCadastrosDev === 'function' && typeof devServidorOk === 'function' && devServidorOk()) {
        if (typeof _devCadastrosCarregados !== 'undefined' && !_devCadastrosCarregados) carregarCadastrosDev();
        else if (typeof renderProdutosDevUI === 'function') renderProdutosDevUI();
      }
      break;
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
    case 'relatorios':
      atualizarResumoFiltroRelatorio();
      // O campo de dia do relatório de devoluções abre já com o dia de hoje
      // preenchido — quem quiser outro dia troca; vazio nunca fica, porque o
      // relatório "de hoje" é o caso de uso de toda hora na Logística.
      { const rd=document.getElementById('rel-dev-dia'); if(rd && !rd.value && typeof diaLocalDev==='function') rd.value=diaLocalDev(); }
      break;
    case 'usuarios': renderUsuarios(); renderMinhaSegurancaUI(); renderPedidosAprovacaoUI(); break;
  }
  // Depois de pintar, e não antes: os rótulos são derivados das células
  // que acabaram de ser criadas.
  prepararTabelasMobile();
}

/* =====================================================================
   CELULAR: TOQUE PARA ABRIR O CARTÃO (23/08/2026)
   =====================================================================

   Par obrigatório da regra de CSS que esconde os campos secundários em
   telas estreitas. O CSS decide O QUE some; isto decide COMO volta.

   DELEGADO NO DOCUMENTO, e não um ouvinte por linha: as tabelas do painel
   são redesenhadas o tempo todo (a Torre a cada sincronização), e ouvinte
   preso à linha morreria no primeiro render. Um ouvinte só, no documento,
   sobrevive a qualquer redesenho — e vale para toda tabela `mobile-cartao`
   de qualquer aba, que é o que o gestor pediu: "não só na torre, mas nas
   outras abas também".

   Não interfere no que já era clicável: se o toque veio de um botão, link,
   campo ou de uma linha que já tem clique próprio (Histórico, Raio-X), a
   função sai sem fazer nada e deixa o comportamento original acontecer. */
function ehTelaEstreita(){
  return window.matchMedia && window.matchMedia('(max-width:820px)').matches;
}

/* AS DUAS LISTAS QUE DECIDEM O CARTÃO DO CELULAR — e o motivo de estarem
   aqui, e não no CSS.

   A primeira versão escrevia cada uma dessas listas como seletor de CSS,
   repetido em três blocos diferentes (quem ocupa a linha toda, quem some
   no estado compacto, quem lê em linha). Três cópias da mesma verdade
   escritas à mão é uma que vai divergir — e divergiu: o Histórico voltou
   de 94px para 147px por cartão porque a terceira lista tinha seis
   rótulos e a primeira tinha dez. Nenhum erro de CSS; erro de ter a
   mesma decisão em três lugares.

   Agora a decisão mora num lugar só. `prepararTabelasMobile` carimba
   `data-larg="cheia"` e `data-sec="1"` em cada célula, e o CSS pergunta
   pelo carimbo. Acrescentar um rótulo aqui acerta os três blocos de uma
   vez, por construção. */

/* LARGURA CHEIA — o valor pode ser longo, então a célula ocupa as duas
   colunas da grade do cartão. Consequência: no estado compacto essa
   célula (e só ela) lê em linha, "Rótulo: valor", porque só numa célula
   de largura inteira o par cabe numa linha só. Na meia coluna ele quebra
   e fica MAIS alto que empilhado — foi medido, ver o CSS. */
const ROTULOS_LARGURA_CHEIA = new Set([
  // Medido no Histórico a 390px: com 'Data/Hora' e 'Placa' em meia coluna o
  // cartão dava 160px; em largura cheia, lendo em linha, deu 132px. Valor
  // curto ganha mais de ler em linha do que de dividir a largura.
  'Data/Hora', 'Placa',
  // 'Peso (kg)' entra pelo mesmo motivo e por mais um: na Torre ele caía
  // sozinho numa linha de grade cuja outra metade ficava vazia (o campo
  // seguinte é de largura inteira e força linha nova). Em linha cheia o
  // buraco some e o cartão cai de 271px para 253px — sem esconder nada.
  'Peso (kg)',
  'Transportadora', 'Rota', 'Motorista', 'Cliente', 'Destino',
  'Observações', 'Nome', 'E-mail', 'Atualizado em', 'Linha do tempo',
  'Operador', 'Setor', 'Registro', 'Etapa', 'Status',
  'Tipo de Operação', 'Programação · Última etapa', 'Tipo de Veículo',
  'Motivo', 'Produto', 'Cliente / Destino', 'Detalhe', 'Ação do operador',
]);

/* SECUNDÁRIO — some no cartão fechado, volta com um toque. O default é
   MOSTRAR: coluna nova nasce visível, e só entra aqui quem foi decidido.
   Errar para o lado de mostrar demais é recuperável; esconder um dado que
   alguém precisava, não. */
const ROTULOS_SECUNDARIOS = new Set([
  'Seq.', 'Motorista', 'Palet.', 'Paletizada', 'Tipo de Operação',
  'Ganchos · Entr.', 'Ganchos', 'Entregas', 'Doca', 'Transportadora',
  'Tipo de Veículo', 'Observações', 'Programação · Última etapa',
  'Atualizado em', 'Operador', 'Setor', 'Linha do tempo',
]);

/* Marca as linhas que TÊM algo escondido. Sem esta marca, o rodapé "toque
   para ver tudo" apareceria também em cartão que já mostra tudo — e aí a
   promessa da tela seria mentira.

   Lê o carimbo `data-sec` em vez de consultar o Set de novo: quem carimba
   é `prepararTabelasMobile`, e uma leitura só garante que a marca da linha
   e a regra do CSS nunca discordem. */
function marcarCartoesExpansiveis(raiz){
  const alvo = raiz && raiz.querySelectorAll ? raiz : document;
  alvo.querySelectorAll('table.mobile-cartao tbody tr').forEach(tr=>{
    if(!tr.querySelector('td[data-sec]')){
      tr.removeAttribute('data-expansivel'); tr.classList.remove('cartao-aberto'); return;
    }
    // Linha que JÁ tem clique próprio (Histórico e Raio-X abrem o registro
    // completo embaixo) recebe rodapé com outro texto. Prometer "toque para
    // ver tudo" e entregar outra coisa é pior que não prometer nada — e o
    // detalhe que ela abre mostra Operador e Setor, que são exatamente os
    // campos escondidos aqui.
    const temClique = tr.classList.contains('hist-linha') || tr.classList.contains('raiox-linha');
    tr.setAttribute('data-expansivel', temClique ? 'detalhe' : '1');
  });
}

document.addEventListener('click', (ev)=>{
  if(!ehTelaEstreita()) return;
  const tr = ev.target.closest && ev.target.closest('table.mobile-cartao tbody tr[data-expansivel]');
  if(!tr) return;
  /* Não sequestra clique de controle nem de linha que já responde sozinha.
     `[role="button"]` entrou em 28/08/2026: as células que filtram a aba
     Indicadores ao toque são <td role="button">, e sem isto um toque nelas
     fazia as duas coisas ao mesmo tempo — aplicava o filtro E abria o
     cartão. Duas respostas para um toque é o tipo de coisa que ensina a
     pessoa a não tocar. */
  if(ev.target.closest('button, a, input, select, textarea, label, [role="button"]')) return;
  if(tr.classList.contains('hist-linha') || tr.classList.contains('raiox-linha')) return;
  tr.classList.toggle('cartao-aberto');
});

/* Depois de todo redesenho as marcas precisam voltar. `renderTabAtual` já
   chama `prepararTabelasMobile` no fim de cada pintura; este observador é a
   rede para o que redesenha FORA dele — a busca de cargas excluídas, o log
   da programação do dia, qualquer tela que troca a tabela inteira por
   innerHTML sem passar pelo render geral.

   Observa o #main com subtree, e não cada tbody: tbody que nasce depois do
   carregamento nunca seria observado, e era isso que deixava essas telas
   sem rótulo no celular. O custo fica limitado por juntar a rajada de
   mutações num único passe por quadro — a mesma passada que o render normal
   já faz, nunca uma por linha inserida.

   Não realimenta: só `childList` é observado, e `prepararTabelasMobile`
   mexe apenas em atributos. */
if(typeof MutationObserver !== 'undefined'){
  let agendado = false;
  const observador = new MutationObserver(()=>{
    if(agendado) return;
    agendado = true;
    const passar = ()=>{
      agendado = false;
      try{ prepararTabelasMobile(); }catch(e){ /* DOM em transição */ }
    };
    if(typeof requestAnimationFrame === 'function') requestAnimationFrame(passar);
    else setTimeout(passar, 0);
  });
  document.addEventListener('DOMContentLoaded', ()=>{
    const main = document.getElementById('main');
    if(main) observador.observe(main, { childList:true, subtree:true });
    prepararTabelasMobile(document);
  });
}

/* O REDESENHO NÃO PODE ARRANCAR O CAMPO DA MÃO DE QUEM DIGITA (31/08/2026).

   RELATO, do Wemerson: "começa a preencher o campo e o campo para de
   digitar, tem que clicar de novo no campo; na hora de fazer um cadastro,
   completando informações, tem que ficar voltando no campo que tá digitando".

   O painel se redesenha inteiro a cada sincronia — de 15 em 15 segundos — e
   a cada dado que chega de outro setor. As linhas editáveis da Torre, da
   Fila e da Montagem são reescritas por completo: o campo que estava sob o
   dedo deixa de existir e um novo nasce no lugar, vazio. O foco vai para o
   BODY, o que já tinha sido digitado some, e o cursor volta para o começo.
   Reproduzido em teste antes desta correção.

   A PROTEÇÃO JÁ EXISTIA — e valia para um lugar só. `_devCapturarDigitacao`
   e `_devRestaurarDigitacao` (devolucoes.js) fazem exatamente isto, guardando
   valor, foco e posição do cursor, desde 27/08. Foram escritas para
   `#dev-lista`. É a família da ocorrência #20: a regra certa existe, com
   comentário e tudo, e não vale para os irmãos dela.

   Aqui ela passa a valer para o painel inteiro, no ponto por onde todo
   redesenho passa. Uma função, um chamador — em vez de cada tela lembrar. */
function _capturarDigitacao(){
  const foco = document.activeElement;
  const editavel = foco && (foco.tagName === 'INPUT' || foco.tagName === 'TEXTAREA'
                            || foco.tagName === 'SELECT');
  if(!editavel) return null;
  /* A âncora é o id quando existe; quando não existe, a posição do campo
     dentro da tabela. As linhas da Torre e da Montagem nascem com id; as
     células de carga usam classe, e para essas o caminho é o índice. */
  const linha = foco.closest('tr');
  const cel = foco.closest('td');
  return {
    id: foco.id || null,
    classe: foco.className || '',
    valor: (foco.type === 'checkbox' || foco.type === 'radio') ? foco.checked : foco.value,
    ini: typeof foco.selectionStart === 'number' ? foco.selectionStart : null,
    fim: typeof foco.selectionEnd === 'number' ? foco.selectionEnd : null,
    linhaId: linha ? (linha.dataset && linha.dataset.id) || null : null,
    idxLinha: linha && linha.parentElement
      ? [...linha.parentElement.children].indexOf(linha) : -1,
    idxCel: cel && cel.parentElement ? [...cel.parentElement.children].indexOf(cel) : -1,
    tabelaId: linha && linha.closest('tbody') ? linha.closest('tbody').id : null,
  };
}

function _restaurarDigitacao(e){
  if(!e) return;
  let el = e.id ? document.getElementById(e.id) : null;
  if(!el && e.tabelaId && e.idxLinha >= 0 && e.idxCel >= 0){
    const tb = document.getElementById(e.tabelaId);
    const tr = tb && tb.children[e.idxLinha];
    const td = tr && tr.children[e.idxCel];
    el = td ? td.querySelector('input, select, textarea') : null;
  }
  if(!el) return;   // a linha saiu da tela (outro setor moveu a carga)
  /* Só devolve o que a pessoa digitou se o campo voltou vazio ou diferente:
     se o redesenho trouxe um valor NOVO vindo do servidor, quem manda é o
     servidor — a tela adianta, a transação decide. */
  if(el.type === 'checkbox' || el.type === 'radio'){
    if(el.checked !== e.valor) el.checked = e.valor;
  } else if(el.value !== e.valor){
    el.value = e.valor;
  }
  try{
    el.focus({ preventScroll: true });
    if(e.ini !== null) el.setSelectionRange(e.ini, e.fim);
  }catch(err){ /* number e date não aceitam setSelectionRange */ }
}

function renderAll(){
  const _digitando = _capturarDigitacao();
  try { _renderAllInterno(); }
  finally { _restaurarDigitacao(_digitando); }
}

function _renderAllInterno(){
  /* Guardião do pré-login: qualquer caminho que resulte em operador logado
     (botões de login, restauração de sessão por token, teste automatizado
     que grava DB.operador direto) revela o painel — e qualquer caminho que
     o deslogue esconde. Concentrar aqui evita a classe presa: foi
     exatamente o que a primeira versão desta tela causou nos fluxos que
     não passavam pelos botões. */
  if(DB.operador && document.body.classList.contains('pre-login')){
    revelarPainel();
  } else if(!DB.operador && !document.body.classList.contains('pre-login')
            && document.getElementById('modal-operador').classList.contains('open')){
    document.body.classList.add('pre-login');
  }
  renderTabAtual();

  /* Explicação sob demanda no celular: cartão redesenhado volta sem a
     classe, então o estado escolhido é reaplicado a cada ciclo. */
  try { _prepararTitulosExplicaveis(); restaurarExplicacoes();
        restaurarSecoesIndicadores(); } catch(e){}
}

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
/* Botão de revisões (Bloco B, 16/08/2026) — só Administração.

   Abre a linha do tempo da carga vinda do SERVIDOR (trigger da migration
   009): quem mudou o quê, quando, e o botão Restaurar. Na semana de
   14–15/08, restaurar dado sobrescrito exigiu reconstruir valores a partir
   de um PDF; agora é um clique auditado. */
function botaoRevisoesHtml(c){
  if(!DB.operador || DB.operador.setor !== 'Administração') return '';
  return `<button class="btn btn-sec btn-sm btn-revisoes" onclick="abrirRevisoesUI('${escJs(c.id)}')"
            title="Ver alterações desta carga e restaurar uma versão anterior">↩</button>`;
}

async function abrirRevisoesUI(id){
  const c = getCarga(id);
  if(!c) return;
  if(!SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()){
    notify('O histórico de alterações mora no servidor — sem conexão não há o que listar.', 'warn');
    return;
  }
  const modal = document.getElementById('modal-revisoes');
  document.getElementById('revisoes-titulo').textContent =
    `Alterações — carga ${c.numeroCarga || '(sem número)'} · ${c.placa}`;
  const lista = document.getElementById('revisoes-lista');
  lista.innerHTML = '<div class="card-sub">Buscando no servidor…</div>';
  modal.classList.add('open');
  try{
    const revs = await SuincoSharePoint.listarRevisoes(id);
    if(!revs.length){
      lista.innerHTML = '<div class="card-sub">Nenhuma alteração registrada ainda — '
        + 'o histórico começa a valer a partir da ativação das revisões no servidor.</div>';
      return;
    }
    lista.innerHTML = revs.map(r=>{
      const s = r.carga || {};
      const peso = ((s.peso||0)/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      return `<div class="revisao-item">
        <div class="revisao-cab">
          <strong>${fmtDataHora(r.gravadaEm)}</strong>
          <span>alterada por ${esc(r.mudadaPor)||'—'}${r.mudadaSetor ? ' · '+esc(r.mudadaSetor) : ''}</span>
        </div>
        <div class="revisao-campos">
          <span>Nº <strong>${esc(s.numeroCarga)||'—'}</strong></span>
          <span>${esc(s.placa)||'—'}</span>
          <span>${peso} t</span>
          <span>rota ${esc(s.rota)||'—'}</span>
          <span>${esc(s.status)||'—'}${s.aguardandoCarga ? ' · aguardando dados' : ''}</span>
        </div>
        <button class="btn btn-warn btn-sm" onclick="restaurarRevisaoUI('${escJs(id)}', ${Number(r.revisaoId)})">
          Restaurar esta versão</button>
      </div>`;
    }).join('');
  }catch(e){
    lista.innerHTML = `<div class="aviso-local">Não consegui buscar: ${esc(e.message)}</div>`;
  }
}

async function restaurarRevisaoUI(id, revisaoId){
  /* UMA CAIXA, e a ação acontece (25/08/2026).

     Até aqui isto abria um PEDIDO e esperava outro administrador aprovar.
     O dono tirou essa exigência — ver o comentário no topo de
     backend/src/rotas/cargas.js para o que a trava protegia e o que ficou
     no lugar dela. O motivo continua obrigatório porque é ele que
     responde "por que esta carga voltou" no histórico. */
  const motivo = (prompt('Restaurar a carga para esta versão?\n\n'
    + 'A carga volta EXATAMENTE ao estado mostrado, em todos os aparelhos.\n\n'
    + 'Por que ela precisa voltar? (fica no histórico com o seu nome)')||'').trim();
  if(!motivo) return;
  try{
    const restaurada = await SuincoSharePoint.restaurarRevisao(id, revisaoId, motivo);
    // O servidor é a fonte da verdade da restauração: aplica a resposta
    // localmente na hora, sem esperar o próximo ciclo de sincronização.
    const local = getCarga(id);
    if(local && restaurada){
      Object.assign(local, {
        numeroCarga: restaurada.numeroCarga, placa: restaurada.placa,
        transportadora: restaurada.transportadora, tipoVeiculo: restaurada.tipoVeiculo,
        motorista: restaurada.motorista, cliente: restaurada.cliente,
        destino: restaurada.destino, peso: restaurada.peso, doca: restaurada.doca,
        rota: restaurada.rota, sequencia: restaurada.sequencia,
        praOnde: restaurada.praOnde, paletizada: restaurada.paletizada,
        qtdGanchos: restaurada.qtdGanchos, qtdEntregas: restaurada.qtdEntregas,
        observacoes: restaurada.observacoes, status: restaurada.status,
        aguardandoCarga: restaurada.aguardandoCarga,
        programadoEm: restaurada.programadoEm, atualizadoEm: restaurada.atualizadoEm,
      });
      // Marca como já sincronizada: o que acabou de vir do servidor não
      // pode ser devolvido a ele como se fosse edição nossa.
      SuincoStore._ultimoSync.set(local.id, local.atualizadoEm || '');
      if(DB._sincronizado) DB._sincronizado[local.id] = local.atualizadoEm || '';
      SuincoStore.save();
    }
    document.getElementById('modal-revisoes').classList.remove('open');
    notify('Versão restaurada. Todos os aparelhos recebem em instantes.', 'success');
    renderAll();
  }catch(e){
    notify('Não consegui restaurar: ' + (e.message || 'erro desconhecido'), 'danger', 8000);
  }
}

function fecharRevisoesUI(){
  document.getElementById('modal-revisoes').classList.remove('open');
}

/* "➕ Outra carga" na Torre — relato do Programador de Embarque
   (18/08/2026): "a opção de criar uma segunda carga não tá aparecendo".

   Não era regressão, era beco sem saída: o botão só existia na linha da
   Fila de Programados, e a fila só mostra carga de HOJE em "Aguardando
   Veículo" (decisão de 11/08). Carga programada ontem, ou caminhão que já
   chegou, não tem linha lá — e o formulário bloqueia a placa duplicada
   apontando para um botão que não estava em lugar nenhum. A Torre mostra
   TODA carga em aberto, sempre; é o lugar que não some. */
function botaoOutraCargaHtml(c){
  if(!podeCancelarCarga()) return '';
  // Caminhão que já seguiu viagem liberou a placa: o formulário aceita a
  // placa de novo sem autorização nenhuma — o botão aqui seria ruído.
  if(c.status === 'Seguiu Viagem') return '';
  return `<button class="btn btn-sec btn-sm" onclick="adicionarOutraCargaNaPlacaUI('${escJs(c.id)}')"
            title="Programar OUTRA carga para este mesmo caminhão — abre a Programação com placa, transportadora, motorista e rota preenchidos.">➕ Outra carga</button>`;
}

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

/* FROTA PRÓPRIA x TRANSPORTADORAS (19/08/2026).

   Pedido do gestor: na Visão de Pátio da Torre, "um bloco só para a frota
   própria, liberando o outro bloco para as de transportadoras". São duas
   conversas diferentes — o caminhão da casa a Suinco remaneja; o de
   transportadora ela cobra —, e ver as duas misturadas obriga a pessoa a
   filtrar com o olho a cada leitura.

   A marca é a transportadora do cadastro de Frota: os veículos próprios
   estão sob "Suinco". Comparação sem acento e sem caixa, porque cadastro
   digitado à mão sempre traz variação. */
const MARCAS_FROTA_PROPRIA = ['suinco'];
function ehFrotaPropria(carga){
  const t = String((carga && carga.transportadora) || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return MARCAS_FROTA_PROPRIA.some(m => t.includes(m));
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
  const LIMITE = ehTelaEstreita() ? 40 : 300;
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

  const linhaCarga = (c)=>{
    const etapas = etapasDaCarga(c);
    return `<tr class="linha-status-${esc((STATUS_META[c.status]||{}).cor || '')}">
      <td class="vp-carga">${esc(c.numeroCarga)||'—'}</td>
      <td class="vp-placa">${esc(c.placa)}${marcaCargaDaPlaca(c, lista)}${marcaEtapaDevolvidaHtml(c)}</td>
      <td class="vp-transp">${esc(c.transportadora)||'—'}</td>
      <td class="vp-rota">${esc(rotaCurta(c.rota))}</td>
      ${linhaDoTempoCompacta(etapas)}
      <td class="vp-tempo">${tempoNoPatioTexto(c)}</td>
    </tr>`;
  };

  /* A Torre separa em dois blocos; as outras abas seguem em lista única.
     Ali a pessoa olha o próprio posto e a origem do caminhão não muda o que
     ela faz — a divisão só somaria uma linha de título sem serviço. */
  if(prefixo === 'torre'){
    const propria = lista.filter(ehFrotaPropria);
    const terceiros = lista.filter(c=>!ehFrotaPropria(c));
    const grupo = (titulo, cargas)=> cargas.length
      ? `<tr class="vp-grupo"><td colspan="6">${titulo} <b>${cargas.length}</b> carga(s)</td></tr>`
        + cargas.map(linhaCarga).join('')
      : '';
    /* Transportadoras primeiro (19/08/2026, pedido do gestor): é o bloco
       maior e o que exige cobrança externa — a frota própria a casa
       remaneja quando quiser, então fecha a lista. */
    tbody.innerHTML = grupo('🚛 Transportadoras —', terceiros)
      + grupo('🏠 Frota própria —', propria);
  } else {
    tbody.innerHTML = lista.map(linhaCarga).join('');
  }

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
    const nPropria = listaCompleta.filter(ehFrotaPropria).length;
    resumo.innerHTML =
      `<span class="vp-total">${listaCompleta.length} carga(s)</span>`
      + (prefixo === 'torre' && listaCompleta.length
          ? `<span class="vp-chip badge">Frota própria: <b>${nPropria}</b></span>`
            + `<span class="vp-chip badge">Transportadoras: <b>${listaCompleta.length - nPropria}</b></span>`
          : '')
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
  /* A caixa "Entradas sem carga" não filtra a Torre: ela LEVA para a
     Programação (19/08/2026). Esses registros não aparecem mais aqui, e
     mandar o filtro devolveria uma tabela vazia — a resposta certa é a aba
     onde a carga é lançada. */
  if(chave === '__IR_PROGRAMACAO__'){
    const abas = (DB.operador && SETOR_PERMISSOES[DB.operador.setor]) || [];
    if(abas.includes('programacao')){
      abrirTab('programacao');
      const alvo = document.getElementById('prog-aguardando-tbody');
      if(alvo && alvo.scrollIntoView) alvo.scrollIntoView({block:'center'});
    } else {
      notify('As entradas sem carga são lançadas pela Logística, na aba Programação.', '', 6000);
    }
    return;
  }
  _torreFiltroStatus = (chave === '__TODAS__' || _torreFiltroStatus === chave) ? null : chave;
  renderTorre();
}
/* =====================================================================
   FAIXA DE INDICADORES NO FORMATO BI (23/08/2026)
   =====================================================================

   Pedido do usuário, depois de ver o preview: "aplicar essa ideia BI
   format na parte de indicador, tudo que for indicador na Torre de
   Controle... mas sem mudar também o que já está feito".

   Então é MISTURA, não substituição: a tabela da Torre, os cartões do
   celular, o Raio-X e a Visão do Pátio continuam exatamente como estavam.
   O que muda é só a faixa de números — e o que ela passa a dizer.

   O defeito que isso corrige é conceitual, não estético: um número solto
   ("8 Aguardando Veículo") é um CONTADOR. Vira INDICADOR quando ganha
   referência — quanto isso representa do total, e para onde estava indo.
   Daí as três peças novas em cada caixa: participação (% do pátio),
   variação contra o dia anterior, e a série dos últimos 14 dias.

   As três saem de dado REAL do próprio painel. Mini-gráfico com número
   inventado seria pior que não ter mini-gráfico: mente com aparência de
   evidência.
   ===================================================================== */

/* Um caminho SVG de uma linha só, sem eixo e sem rótulo — a forma da série,
   não a leitura precisa dela (o número grande ao lado é que se lê).

   `vector-effect="non-scaling-stroke"` porque o viewBox é esticado pela
   largura da caixa: sem isso a espessura do traço muda de caixa para
   caixa, e a faixa inteira fica visualmente desalinhada. */
function sparklineSvg(vals, cor, w = 74, h = 22){
  const v = (vals || []).filter(x => Number.isFinite(x));
  if(v.length < 2) return '';
  const mx = Math.max(...v), mn = Math.min(...v);
  /* Série sem variação (todos os valores iguais) precisa desenhar no MEIO
     da caixa. Com amp forçada em 1, (x-mn)/amp dá 0 para todo ponto e o
     traço encosta na base — lido como "despencou para o mínimo", que é o
     oposto de "não mudou". */
  const chata = mx === mn;
  const amp = chata ? 1 : (mx - mn);
  const px = i => (i / (v.length - 1)) * (w - 2) + 1;
  const py = x => chata ? (h / 2) : (h - 2 - ((x - mn) / amp) * (h - 5));
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(x).toFixed(1)}`).join(' ');
  const idg = 'spk' + Math.random().toString(36).slice(2, 8);
  return `<svg class="stat-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
      preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${idg}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${cor}" stop-opacity=".30"/>
      <stop offset="100%" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${px(v.length-1).toFixed(1)} ${h} L${px(0).toFixed(1)} ${h} Z" fill="url(#${idg})"/>
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linecap="round"
          stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${px(v.length-1).toFixed(1)}" cy="${py(v[v.length-1]).toFixed(1)}" r="2" fill="${cor}"/>
  </svg>`;
}

/* A variação escrita por extenso. `pioraQuandoSobe` existe porque a mesma
   seta significa coisas opostas dependendo do indicador: mais carga parada
   no pátio é ruim, mais carga concluída é bom. Cor errada aqui ensina o
   gestor a ler o painel ao contrário. */
/* `igual` é parâmetro porque a mesma função serve duas comparações
   diferentes: na Torre é contra ONTEM, nos tempos médios é a semana contra
   a anterior. Texto fixo dizia "igual a ontem" numa caixa que compara sete
   dias — número certo com legenda errada é pior que número ausente. */
function deltaHtml(atual, anterior, {pioraQuandoSobe = true, sufixo = '',
                                     percentual = false, igual = 'sem variação'} = {}){
  if(!Number.isFinite(atual) || !Number.isFinite(anterior)) return '';
  const dif = atual - anterior;
  if(dif === 0) return `<div class="stat-delta stat-igual">= ${esc(igual)}</div>`;
  const sobe = dif > 0;
  const ruim = sobe === pioraQuandoSobe;
  let texto;
  if(percentual){
    if(!anterior) return '';
    texto = Math.round(Math.abs(dif) / anterior * 100) + '%';
  } else {
    texto = Math.abs(dif) + sufixo;
  }
  return `<div class="stat-delta ${ruim ? 'stat-pior' : 'stat-melhor'}">`
       + `${sobe ? '▲' : '▼'} ${texto}</div>`;
}

/* Quantas cargas estavam EM ABERTO ao fim de cada um dos últimos N dias, e
   quantas seguiram viagem em cada um deles.

   Reconstruído do próprio histórico: uma carga estava aberta no dia D se
   nasceu até o fim de D e não tinha saído até o fim de D. Uma passada por
   carga (a saída é consultada uma vez só e fica em cache), depois N
   comparações por carga — barato o bastante para rodar a cada render da
   Torre, que é o que garante que a série nunca fica velha. */
function serieDoPatio(dias = 14){
  const fins = [];
  for(let i = dias - 1; i >= 0; i--){
    const d = new Date(); d.setHours(23, 59, 59, 999); d.setDate(d.getDate() - i);
    fins.push(d.getTime());
  }
  const abertas = new Array(dias).fill(0);
  const seguiu  = new Array(dias).fill(0);
  DB.cargas.forEach(c => {
    const nasceuEm = new Date(c.programadoEm || c.criadoEm || 0).getTime();
    if(!Number.isFinite(nasceuEm)) return;
    const saidaISO = c.status === 'Seguiu Viagem'
      ? (primeiroTimestamp(c.id, 'Seguiu Viagem') || c.concluidoEm || c.atualizadoEm)
      : null;
    const saiuEm = saidaISO ? new Date(saidaISO).getTime() : null;
    for(let i = 0; i < dias; i++){
      const fim = fins[i];
      if(nasceuEm <= fim && (saiuEm === null || saiuEm > fim)) abertas[i]++;
      if(saiuEm !== null && saiuEm <= fim && saiuEm > fim - 86400000) seguiu[i]++;
    }
  });
  return { abertas, seguiu };
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

  /* A TORRE MOSTRA CARGA LANÇADA (19/08/2026).

     Um caminhão que chega sem programação vira um registro "aguardando
     carga": tem placa, não tem carga. Ele aparecia na Torre junto com as
     cargas de verdade, e o gestor pediu para tirar: "não quero que
     apareçam na torre de controle, pois isso gera confusão... só devem ser
     exibidos após a carga ser lançada".

     O lugar dele é a aba Programação, onde já existe a tabela "Entradas
     aguardando carga" com o botão de criar a carga. A caixa aqui continua
     contando — sumir de vez esconderia caminhão parado no pátio —, mas o
     clique agora leva para lá, que é onde se resolve. */
  const emAberto = cargasAbertas();
  /* Sem placa, fora da Torre — o pedido literal do dono (26/08/2026): "só a
     partir da hora que colocarem a placa ela vai pra torre de controle". A
     Torre é o pátio; carga sem caminhão ainda é planejamento e mora na aba
     Programação, na lista "Cargas sem caminhão". */
  const abertas = emAberto.filter(c=>!c.aguardandoCarga && c.placa);
  const porStatus = {};
  abertas.forEach(c=>{ porStatus[c.status] = (porStatus[c.status]||0) + 1; });
  // "Aguardando Carga" não é mais um valor de status — é a flag
  // `aguardandoCarga` (o texto fica no campo Número da Carga). Mostrado
  // como uma caixa extra informativa, não como um dos 6 status oficiais.
  const statusVisiveis = STATUS_FLOW.slice(0,-1); // sem "Seguiu Viagem" (não fica em aberto)
  const aguardandoCargaCount = emAberto.filter(c=>c.aguardandoCarga).length;
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
  // Sobras da programação anterior — ver ehProgramacaoAntiga().
  const antigasCount = abertas.filter(ehProgramacaoAntiga).length;
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

  /* A série do pátio alimenta o mini-gráfico e a variação. Calculada UMA
     vez por render — cada caixa só lê o pedaço dela. */
  const serie = serieDoPatio(14);
  const totalAberto = abertas.length;

  const caixa = (num, rotulo, {destaque=false, alerta=false, nota='', filtro=null,
                               cor='', participacao=false, spark=null,
                               deltaDe=null, pioraQuandoSobe=true} = {}) => {
    const ehLimpar = filtro === '__TODAS__';
    const ativo = filtro !== null && (ehLimpar ? _torreFiltroStatus === null : _torreFiltroStatus === filtro);
    const clicavel = filtro !== null;
    // No celular a nota some da grade compacta (.stat-note{display:none} —
    // ver styles.css) pra caber em três colunas; o title garante que a
    // informação continua acessível, só muda de "sempre visível" pra
    // "sob demanda", como o próprio aviso de clique já era.
    const dicaClique = 'Clique para filtrar a tabela por esta caixa — clique de novo para limpar.';
    /* A participação entra no title junto com a nota: no celular ela sai da
       tela (ver .bi-faixa .stat-share em styles.css) e sem isso a
       informação desapareceria em vez de mudar de lugar. */
    const dicaPct = participacao && totalAberto > 0
      ? `${Math.round(num / totalAberto * 100)}% das ${totalAberto} cargas em aberto` : '';
    const titulo = [dicaPct, nota, clicavel ? dicaClique : ''].filter(Boolean).join(' — ');

    /* As três peças que transformam contador em indicador. Cada uma só
       aparece quando tem dado real por trás — caixa sem série não ganha
       traço reto fingindo tendência, e participação de zero sobre zero não
       vira "0% do pátio". */
    const pct = participacao && totalAberto > 0
      ? `<div class="stat-share">${Math.round(num / totalAberto * 100)}% do pátio</div>` : '';
    const delta = deltaDe
      ? deltaHtml(deltaDe[0], deltaDe[1],
                  {pioraQuandoSobe, sufixo:' vs. ontem', igual:'igual a ontem'}) : '';
    const linha = spark && spark.length > 1
      ? sparklineSvg(spark, corTema(alerta && num > 0 ? '--st-aguardando-veiculo-fg' : '--gold')) : '';

    return `<div class="stat-box${destaque?' stat-destaque':''}${alerta && num>0?' stat-alerta':''}${clicavel?' stat-clicavel':''}${ativo?' stat-ativo':''}"
       ${cor ? `style="--st-cor:var(--st-${cor}-bg)"` : ''}
       ${clicavel ? `onclick="filtrarTorrePorStatus('${escJs(filtro)}')"` : ''}
       ${titulo ? `title="${esc(titulo)}"` : ''}>
       <div class="stat-num" data-contador="${esc(rotulo)}">${num}</div>
       <div class="stat-label">${esc(rotulo)}</div>
       ${pct}${delta}
       ${nota ? `<div class="stat-note">${esc(nota)}</div>` : ''}
       ${linha}
     </div>`;
  };

  document.getElementById('torre-stats').innerHTML =
    // "Paradas há mais de Xh" foi removida a pedido do usuário
    // (08/08/2026): ícone considerado inútil na Torre.
    caixa(abertas.length, 'Cargas em aberto', {
      destaque:true, filtro:'__TODAS__', spark:serie.abertas,
      deltaDe:[serie.abertas[13], serie.abertas[12]], pioraQuandoSobe:true})
    + statusVisiveis.map(s=>caixa(porStatus[s]||0, s,
        {filtro:s, cor:statusSlug(s), participacao:true})).join('')
    + caixa(seguiuViagemHojeCount, 'Seguiu Viagem hoje', {
      destaque:true, filtro:'__SEGUIU_HOJE__', cor:'seguiu-viagem', spark:serie.seguiu,
      deltaDe:[serie.seguiu[13], serie.seguiu[12]], pioraQuandoSobe:false})
    + caixa(antigasCount, 'Programação anterior',
            {alerta:true, nota:'ainda em aberto de outros dias',
             filtro:'__PENDENTES_ANTIGAS__'})
    + caixa(aguardandoCargaCount, 'Entradas sem carga',
            {nota:'resolver na Programação', filtro:'__IR_PROGRAMACAO__'});
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
  } else if(_torreFiltroStatus === '__PENDENTES_ANTIGAS__'){
    lista = abertas.filter(ehProgramacaoAntiga);
  } else if(_torreFiltroStatus){
    lista = abertas.filter(c=>c.status === _torreFiltroStatus);
  } else {
    lista = abertas;
  }
  /* Hoje primeiro, sobras depois — e cada bloco na ordem de sempre
     (sequência, depois última movimentação). É o que separa o joio do
     trigo sem esconder nem o joio nem o trigo. */
  lista = lista.slice().sort((a,b)=>{
    const ga = ehProgramacaoAntiga(a) ? 1 : 0;
    const gb = ehProgramacaoAntiga(b) ? 1 : 0;
    if(ga !== gb) return ga - gb;
    if(ga === 1){
      const da = diasDesdeProgramacao(a), db = diasDesdeProgramacao(b);
      if(da !== db) return da - db;   // ontem antes de anteontem
    }
    return ordenarPorSequenciaEAtualizacao(a,b);
  });

  const thead = document.getElementById('torre-thead');
  if(thead){
    thead.innerHTML =
      /* 15 colunas não cabiam: a tabela media 1870px numa área de 1162px,
         e o operador tinha que rolar pro lado pra ver status e botões —
         justamente o que ele precisa pra agir. Pedido do usuário
         (11/08/2026): "otimize para que tudo apareca por completo sem
         precisar de rolagem".

         Nada foi removido: colunas que descrevem A MESMA coisa foram
         empilhadas numa célula só. Veículo reúne placa, transportadora e
         tipo (são o caminhão); Datas reúne quando foi programada e quando
         mexeram nela pela última vez. 15 colunas viram 11. */
      '<th>Seq.</th><th>Nº Carga</th><th>Veículo</th>'
      + '<th>Motorista</th><th>Rota</th><th>Peso (kg)</th>'
      + '<th>Palet.</th><th>Tipo de Operação</th><th title="Ganchos e quantidade de entregas">Ganchos · Entr.</th><th>Status</th>'
      + '<th title="Quando a carga foi programada e a última mudança de etapa — o mesmo horário que o Histórico mostra">Programação · Última etapa</th>'
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
  /* A FAIXA QUE SEPARA OS DOIS DIAS.

     Uma tabela só (não duas): a Torre é impressa, filtrada e ordenada como
     um bloco, e partir o HTML em duas tabelas duplicaria cabeçalho, ações e
     estado vazio. A faixa cumpre o mesmo papel na leitura e some sozinha
     quando não há sobra nenhuma. */
  const colunasTorre = editavel ? 12 : 11;
  const antigasNaLista = lista.filter(ehProgramacaoAntiga).length;
  const idPrimeiraAntiga = antigasNaLista && _torreFiltroStatus !== '__PENDENTES_ANTIGAS__'
    ? lista.find(ehProgramacaoAntiga).id : null;
  const faixa = (c)=> c.id === idPrimeiraAntiga
    ? `<tr class="torre-sep"><td colspan="${colunasTorre}">`
      + `⏳ Programação anterior — ${antigasNaLista} carga(s) que ainda não seguiram viagem. `
      + `<span class="torre-sep-nota">Ficam aqui até serem concluídas; não entram na programação de hoje.</span>`
      /* O botão nasce AQUI, colado na faixa, e não num canto do cabeçalho:
         quem decide encerrar está olhando exatamente estas linhas, e o
         número no botão é o mesmo número da faixa. */
      + (editavel
        ? ` <button class="btn btn-sec btn-sm no-print" onclick="encerrarProgramacaoAnteriorUI()"
              title="Fecha estas cargas de dias anteriores (leva cada uma a Seguiu Viagem, com motivo registrado) para a Torre ficar só com a programação de hoje.">🧹 Encerrar as ${antigasNaLista}</button>`
        : '')
      + `</td></tr>`
    : '';
  tbody.innerHTML = lista.map(c=>`
    ${faixa(c)}
    <tr class="${ehProgramacaoAntiga(c) ? 'linha-prog-antiga' : ''}">
      <td>${editavel
        ? `<input type="number" class="seq-input" value="${c.sequencia ?? ''}" onchange="atualizarSequenciaUI('${escJs(c.id)}',this.value)" title="Sequência livre.">`
        : (c.sequencia ?? '—')}</td>
      <td class="col-identificacao">${editavel
        ? `<input type="text" class="numero-carga-input" value="${esc(c.numeroCarga)}" onchange="atualizarNumeroCargaUI('${escJs(c.id)}',this.value)" title="Alterar o número desta carga.">`
        : (esc(c.numeroCarga)||'—')}</td>
      <td class="col-identificacao cel-veiculo">${editavel
        ? `<input type="text" class="placa-input" value="${esc(c.placa)}" onchange="atualizarPlacaUI('${escJs(c.id)}',this.value)" title="Trocar a placa.">`
        : `<span class="veic-placa">${esc(c.placa)}</span>`}
        <span class="veic-transp">${esc(c.transportadora)||'—'}</span>
        <span class="veic-tipo">${esc(c.tipoVeiculo)||'—'}</span>
        ${chipNoPatioHtml(c)}${chipLacreHtml(c)}</td>
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
      <td class="cel-gan-ent">${editavel
        /* Entregas na Torre — pedido do gestor (18/08/2026): era o único
           campo da carga sem edição aqui. Empilhado com Ganchos de
           propósito: coluna nova alargaria a tabela e traria de volta a
           rolagem lateral que foi eliminada em 11/08. */
        ? `<input type="number" class="ganchos-input" min="0" step="1" value="${c.qtdGanchos ?? 0}" onchange="atualizarGanchosUI('${escJs(c.id)}',this.value)" title="Ganchos — 0 = Liso">
           <input type="number" class="entregas-input" min="0" step="1" value="${c.qtdEntregas ?? 1}" onchange="atualizarEntregasUI('${escJs(c.id)}',this.value)" title="Quantidade de entregas.">`
        : `${c.qtdGanchos ? c.qtdGanchos : '<span class="text-dim">Liso</span>'} · <span title="Entregas">${c.qtdEntregas ?? 1}</span>`}</td>
      <td>${badgeHtml(c.status)}${situacaoPlacaHtml(c)}</td>
      <td class="cel-datas">
        <span class="dt-prog">${dataProgramacaoHtml(c)}</span>
        ${ultimaAcaoHtml(c)}</td>
      ${editavel ? `<td class="no-print">${botaoOutraCargaHtml(c)}${botaoRevisoesHtml(c)}${botaoCancelarHtml(c)}</td>` : ''}
    </tr>`).join('');
  const vazio = document.getElementById('torre-empty');
  vazio.hidden = lista.length>0;
  if(!vazio.hidden){
    vazio.innerHTML = _torreFiltroStatus === '__PENDENTES_ANTIGAS__'
      ? 'Nenhuma pendência de programações anteriores — o pátio está só com a programação de hoje.'
        + '<span class="empty-acao"><button class="btn btn-sec btn-sm" onclick="filtrarTorrePorStatus(\'__TODAS__\')">Ver todas em aberto</button></span>'
      : _torreFiltroStatus
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
/* Ordem do Relatório Operacional: a SEQUÊNCIA DE CARREGAMENTO manda.

   Pedido do gestor (15/08/2026), com a planilha dele na mão: "o relatório
   operacional precisa seguir a sequência de carga colocada no painel".

   Antes a folha era ordenada pela etapa do processo (todos os "Aguardando
   Embarque" juntos, depois os "Faturado"...) e a sequência só desempatava
   dentro de cada etapa. Isso faz sentido para acompanhar o andamento, mas
   não para MONTAR a fila: quem está no pátio precisa da ordem 1, 2, 3, e
   com a ordenação por etapa a carga 3 podia aparecer dez linhas abaixo da
   30 só porque avançou de status antes.

   O status continua na folha, com a cor — o que muda é só a ordem das
   linhas, que passa a ser a mesma da tela e a mesma da planilha que a
   operação já usava.

   Sem sequência preenchida vai para o fim: é carga que ainda não entrou na
   fila, e jogá-la para o meio empurraria a numeração de quem já está. */
function ordenarPorSequenciaDeCarregamento(a, b){
  const sa = (a.sequencia === null || a.sequencia === undefined || a.sequencia === '')
    ? Infinity : Number(a.sequencia);
  const sb = (b.sequencia === null || b.sequencia === undefined || b.sequencia === '')
    ? Infinity : Number(b.sequencia);
  if(sa !== sb) return sa - sb;
  // Empate real (duas cargas com a mesma sequência digitada): mantém a
  // ordem estável pelo número da carga, para a folha não trocar de ordem a
  // cada geração e confundir quem compara duas impressões.
  return String(a.numeroCarga || '').localeCompare(
    String(b.numeroCarga || ''), 'pt-BR', {numeric: true});
}

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

/* Fila de cada setor: primeiro o que espera a AÇÃO daquele setor.

   Pedido do usuário (12/08/2026): "no painel de cada setor, na fila...
   eu quero que fique organizado e apareca nas primeiras linhas de cima
   pra baixo as cargas que foram faturadas, e nao fique desorganizado e
   baguncado... para a expedicao tambem, e para o faturamento tambem".

   O princípio por trás dos três casos é o mesmo: quem abre a tela quer
   ver primeiro o que DEPENDE DELE agora. A Portaria libera quem já foi
   faturado; a Expedição carrega quem já chegou; o Faturamento fatura quem
   já terminou de embarcar. Tudo isso ficava misturado com carga que ainda
   não é da vez — e no Faturamento nem ordenação existia: saía na ordem
   bruta do array, que muda a cada sincronia.

   Dentro de cada grupo a ordem continua sendo a sequência de
   carregamento, que é a regra que a Logística define. */
const ACAO_DO_SETOR = {
  /* A Portaria age nas duas pontas do fluxo. "Faturado" vem primeiro por
     pedido explícito: é o caminhão pronto pra sair, ocupando pátio. */
  'Portaria':    ['Faturado', 'Aguardando Veículo'],
  /* Expedição: o que chegou e espera doca, depois o que já está na doca
     e precisa ser fechado. */
  'Expedição':   ['Aguardando Embarque', 'Embarque Iniciado'],
  'Faturamento': ['Embarque Finalizado'],
};

function ordenarPorAcaoDoSetor(setor){
  const prioridade = ACAO_DO_SETOR[setor] || [];
  return (a, b) => {
    // Quem não está na lista de ação do setor vai para depois de todos os
    // que estão — sem sumir da tela: continua consultável abaixo.
    const pa = prioridade.indexOf(a.status);
    const pb = prioridade.indexOf(b.status);
    const ra = pa === -1 ? prioridade.length : pa;
    const rb = pb === -1 ? prioridade.length : pb;
    if(ra !== rb) return ra - rb;
    return ordenarPorSequenciaEAtualizacao(a, b);
  };
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
  /* PLACA VAZIA CRIA A CARGA MESMO ASSIM (26/08/2026) — mas nunca em
     silêncio. O aviso diz o que aconteceu e o que falta: sem confirmação
     visível, criar sem placa e criar com placa parecem iguais na tela, e o
     dia em que alguém ESQUECE a placa fica indistinguível do dia em que
     ainda não contratou. O texto resolve os dois: quem esqueceu percebe,
     quem não contratou segue tranquilo. */
  const semPlaca = !normalizarPlaca(placa);

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
      + 'Para lançar outra carga no mesmo caminhão, use "➕ Outra carga" na linha dela — '
      + 'na Fila de Programados ou na Torre de Controle.',
      'warn', 9000);
    return;
  }

  try{
    const criada = criarCargaProgramada({
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
    if(semPlaca){
      notifyGravacao('Carga criada SEM caminhão — ela fica em "Cargas sem caminhão", '
        + 'aqui na Programação. Quando contratar, preencha a placa na linha e ela '
        + 'entra sozinha na Torre.');
    } else {
      /* O RECADO DA ABSORÇÃO VEM DA CRIAÇÃO (27/08/2026). Quando a placa
         já estava no pátio, a carga não nasce em "Aguardando Veículo" — ela
         assume a entrada que já existia. Dizer "Aguardando Veículo" aí
         seria mentir para quem acabou de gravar. */
      const recadosCriacao = (criada && criada._recados) || [];
      if(recadosCriacao.length){
        notifyGravacao(`Carga criada para a placa ${normalizarPlaca(placa)} — o caminhão JÁ ESTÁ no pátio, então ela nasce em Aguardando Embarque.`);
        recadosCriacao.forEach(m => notify(m, 'info'));
      } else {
        notifyGravacao(`Carga criada para a placa ${normalizarPlaca(placa)} — status Aguardando Veículo.`);
      }
    }
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
  /* O DIA É O DA PROGRAMAÇÃO, NÃO O DO REGISTRO (19/08/2026).

     Esta fila usava `criadoEm` — o instante em que a LINHA nasceu no banco.
     São coisas diferentes, e a diferença aparece todo dia:

       · carga programada às 22h de ontem PARA HOJE tinha criadoEm de ontem
         e sumia da fila de hoje;
       · caminhão que entrou pela Portaria dias atrás e teve a carga lançada
         hoje carregava o criadoEm da ENTRADA — "não é pra ser o dia que o
         carro deu entrada".

     `programadoEm` é o carimbo de quando a carga foi programada/lançada, e
     é gravável uma vez só justamente para não escorregar depois. É ele que
     responde "isto é trabalho de hoje?". */
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const doDia = (c)=>{
    const base = c.programadoEm || c.criadoEm || c.atualizadoEm;
    if(!base) return true;   // sem data conhecida, melhor mostrar que sumir
    const d = new Date(base); d.setHours(0,0,0,0);
    return d.getTime() === hoje.getTime();
  };
  const todosAguardando = DB.cargas.filter(c=>c.status==='Aguardando Veículo');
  const lista = todosAguardando.filter(doDia).sort(ordenarPorSequenciaEAtualizacao);
  const deOutrosDias = todosAguardando.length - lista.length;

  /* A FILA COM A CARA DA TORRE (28/08/2026).

     Pedido do dono: "na programação eu queria que ficasse igual à torre de
     controle (...) e clicar em cima e ela possa expandir e aí sim ter todas
     as informações completas".

     São as MESMAS sete colunas da Torre, na mesma ordem, com a mesma
     célula de Veículo (placa + transportadora + tipo empilhados). Ordem
     igual não é estética: é a mesma pessoa, no mesmo dia, olhando a mesma
     carga em duas telas — e duas ordens diferentes para o mesmo trabalho
     produzem erro de campo trocado.

     O que saiu da linha (Tipo de Operação, Ganchos, Entregas, Observações,
     Cliente, Destino) NÃO saiu do sistema: está na expansão, editável, e
     grava nas mesmas funções de sempre. Varrer a fila é procurar sequência,
     número e caminhão; preencher é outro momento, e agora tem lugar próprio.

     Os botões ficam NA LINHA, por decisão do dono — quem programa outra
     carga ou exclui está varrendo, não preenchendo. O stopPropagation
     impede que clicar neles abra a linha por tabela. */
  document.getElementById('prog-fila-tbody').innerHTML = lista.map(c=>{
    const id = escJs(c.id);
    const aberta = _progFilaAberta === c.id;
    const linha = `
    <tr class="prog-linha${aberta ? ' prog-linha-aberta' : ''}"
        onclick="alternarLinhaProgFilaUI('${id}')"
        title="Clique para abrir os demais campos desta carga">
      <td onclick="event.stopPropagation()"><input type="number" class="seq-input" value="${c.sequencia ?? ''}" onchange="atualizarSequenciaUI('${id}',this.value)" title="Sequência livre — digite o número que quiser, a qualquer momento."></td>
      <td class="col-identificacao" onclick="event.stopPropagation()">
        <input type="text" class="numero-carga-input" value="${esc(c.numeroCarga)}" onchange="atualizarNumeroCargaUI('${id}',this.value)" title="Alterar o número desta carga.">
      </td>
      <td class="col-identificacao cel-veiculo" onclick="event.stopPropagation()">
        <input type="text" class="placa-input" value="${esc(c.placa)}" onchange="atualizarPlacaUI('${id}',this.value)" title="Trocar a placa — a transportadora e o tipo de veículo são buscados na Frota automaticamente.">
        <span class="veic-transp" id="transp-${esc(c.id)}">${esc(c.transportadora)||'—'}</span>
        <span class="veic-tipo">${esc(c.tipoVeiculo)||'—'}</span>
        ${marcaCargaDaPlaca(c, lista)}${chipNoPatioHtml(c)}${marcaEtapaDevolvidaHtml(c)}</td>
      <td onclick="event.stopPropagation()">
        <input type="text" class="motorista-input" value="${esc(c.motorista||'')}" onchange="atualizarMotoristaUI('${id}',this.value)" title="Quem dirige ESTA viagem — não mexe no cadastro da placa."></td>
      <td onclick="event.stopPropagation()">${rotaSelectHtml(c)}</td>
      <td class="c-peso" onclick="event.stopPropagation()"><input type="number" class="peso-input" min="0" step="1" value="${c.peso ?? ''}" onchange="atualizarPesoUI('${id}',this.value)" title="Peso em kg."></td>
      <td onclick="event.stopPropagation()">${paletizadaSelectHtml(c)}</td>
      <td onclick="event.stopPropagation()">${praOndeSelectHtml(c)}</td>
      <td class="no-print gap8" onclick="event.stopPropagation()">
        <button class="btn btn-sec btn-sm" onclick="adicionarOutraCargaNaPlacaUI('${id}')"
                title="Programar OUTRA carga para este mesmo caminhão — o formulário já vem com placa, transportadora, motorista e rota preenchidos.">➕ Outra carga</button>
        <button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${id}')">Excluir</button>
        <span class="mont-seta${aberta ? ' aberta' : ''}" aria-hidden="true">▸</span>
      </td>
    </tr>`;
    return aberta ? linha + `<tr class="prog-detalhe"><td colspan="9">${formCargaFilaHtml(c)}</td></tr>` : linha;
  }).join('');
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

/* Qual linha da fila está aberta. Uma só: duas expansões abertas ao mesmo
   tempo empurram a lista para baixo e quem varre perde a referência. */
let _progFilaAberta = null;

function alternarLinhaProgFilaUI(id){
  _progFilaAberta = (_progFilaAberta === id) ? null : id;
  renderProgFila();
}

/* O QUE SAIU DA LINHA E VEIO PARA CÁ (28/08/2026).

   Nada foi removido do sistema: Tipo de Operação, Ganchos, Entregas,
   Observações, Cliente e Destino continuam editáveis e gravam nas MESMAS
   funções que a Torre e a montagem usam — a alteração cai na carga, entra
   no log de revisões do servidor e sobe para todos os setores.

   O desenho é o mesmo do formulário da montagem (`.mont-form`), de novo por
   causa da ordem: a pessoa que preenche aqui é a mesma que preenche lá. */
function formCargaFilaHtml(c){
  const id = escJs(c.id);
  return `
    <div class="mont-form">
      <div class="form-row">
        ${/* Tipo de Operação subiu para a LINHA em 28/08/2026 — é a 8ª coluna
             da Torre, e o dono contou oito campos editáveis. Sai daqui para
             não existir o mesmo campo em dois lugares da mesma tela. */''}
        <div class="form-group">
          <label>Qtd. Ganchos <span class="hint">0 = Liso</span></label>
          <input type="number" min="0" step="1" value="${c.qtdGanchos ?? 0}"
                 onchange="atualizarGanchosUI('${id}',this.value)"></div>
        <div class="form-group"><label>Qtd. Entregas</label>
          <input type="number" min="0" step="1" value="${c.qtdEntregas ?? 1}"
                 onchange="atualizarEntregasUI('${id}',this.value)"></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Cliente</label>
          <input type="text" value="${esc(c.cliente)}" placeholder="—"
                 onchange="atualizarClienteUI('${id}',this.value)"></div>
        <div class="form-group"><label>Destino</label>
          <input type="text" value="${esc(c.destino)}" placeholder="—"
                 onchange="atualizarDestinoUI('${id}',this.value)"></div>
        <div class="form-group">
          <label>Transportadora <span class="hint">(vem da Frota pela placa)</span></label>
          <input type="text" value="${esc(c.transportadora)}" disabled></div>
      </div>

      <div class="form-group" style="margin-bottom:10px"><label>Observações</label>
        <textarea onchange="atualizarObservacoesUI('${id}',this.value)"
          placeholder="O que a operação precisa saber sobre esta carga">${esc(c.observacoes)}</textarea></div>

      <div class="form-group" style="margin-bottom:10px">
        <span class="text-dim">Programada em ${dataProgramacaoHtml(c)} · status atual ${esc(c.status)}.</span></div>

      <div class="flex-end gap8">
        <button class="btn btn-sec btn-sm" onclick="alternarLinhaProgFilaUI('${id}')">Fechar</button>
      </div>
    </div>`;
}

/* Cliente e Destino da carga — os dois só existiam no formulário de
   criação, e quem errava a digitação tinha que excluir e refazer. */
function atualizarClienteUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.cliente = String(val || '').trim();
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarDestinoUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.destino = String(val || '').trim();
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
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
/* Transportadora e Observações da CARGA.

   As duas faltavam do lado da carga e existiam só no rascunho da montagem
   — e era por isso que a linha efetivada perdia campo ao virar janela para
   a carga. Os dois são editáveis pela Logística no servidor
   (CAMPOS_EDITAVEIS em dominio/fluxo.js), então a gravação sobe igual às
   demais.

   TRANSPORTADORA vazia significa "o que a Frota disser": quem carrega hoje
   pode não ser o dono do caminhão (subcontratação, troca de última hora), e
   escrever aqui vale só para ESTA carga — o cadastro do veículo fica como
   está. */
function atualizarTransportadoraUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.transportadora = String(val || '').trim();
  c.atualizadoEm = nowISO();   // sem isto a mudança não sobe — ver atualizarSequenciaUI
  SuincoStore.save();
  renderAll();
}
function atualizarObservacoesUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.observacoes = String(val || '');
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
/* ENCERRAR A PROGRAMAÇÃO ANTERIOR — deixar a Torre pronta para o dia novo.
   (20/08/2026)

   Pedido do gestor: "a programação das viagens que já seguiram viagem e que
   não têm nenhuma pendência aberta [precisa sair] da torre de controle de
   hoje... mantendo apenas as cargas que estão iniciando as etapas".

   Fecha só o que é de DIAS ANTERIORES — a regra mora no servidor, então
   nem um clique errado aqui alcança a programação de hoje. Cada carga
   fechada fica registrada com quem fez e por quê; nada é apagado. */
async function encerrarProgramacaoAnteriorUI(){
  const antigas = cargasAbertas().filter(c=>!c.aguardandoCarga && ehProgramacaoAntiga(c));
  if(!antigas.length){
    notify('Não há pendências de programações anteriores para encerrar.', 'info');
    return;
  }
  const lista = antigas.slice(0, 8)
    .map(c=>`· ${c.numeroCarga || 'sem número'} — ${c.placa} (${c.status})`).join('\n');
  const resumo = `${antigas.length} carga(s) de programações anteriores serão encerradas `
    + `como "Seguiu Viagem":\n\n${lista}`
    + (antigas.length > 8 ? `\n· … e mais ${antigas.length - 8}` : '')
    + '\n\nElas saem da Torre e continuam no Histórico e no relatório do dia delas.'
    + '\n\nMotivo (obrigatório):';
  const motivo = prompt(resumo, 'Caminhões já saíram; encerramento da programação anterior');
  if(motivo === null) return;
  if(!String(motivo).trim()){
    notify('Encerramento cancelado: o motivo é obrigatório.', 'warn');
    return;
  }
  try{
    const r = await comOverlaySync('Encerrando a programação anterior…',
      () => SuincoSharePoint.encerrarProgramacoesAnteriores(String(motivo).trim()));
    await SuincoSharePoint.sincronizarAgora();
    renderAll();
    notifyGravacao(`${r.total} carga(s) da programação anterior encerrada(s). A Torre agora mostra só o dia de hoje.`);
  }catch(e){
    notify('Não consegui encerrar: ' + (e && e.message ? e.message : 'erro no servidor') + '.', 'danger', 8000);
  }
}

/* O BLOCO DE LACRES DOS RELATÓRIOS (20/08/2026).

   Pedido do gestor: as informações de lacre precisam "sair marcadas onde
   devem ficar em todos os relatórios".

   Por que BLOCO e não coluna na tabela principal: a tabela do Operacional
   tem 12 colunas em A4 e foi calibrada para caber sem rolagem lateral —
   enfiar mais uma faria a folha voltar a quebrar, e o lacre não é uma
   propriedade da linha de carga: é do CAMINHÃO. Um caminhão com duas cargas
   apareceria com o mesmo lacre repetido em duas linhas, como se fossem
   dois. Aqui é uma linha por caminhão, que é a verdade do pátio.

   Some sozinho quando não há nada a dizer: relatório com seção vazia ensina
   o leitor a pular seção. */
function blocoLacresPdf(lista){
  const porPlaca = new Map();
  lista.forEach(c=>{
    const l = lacresDaCarga(c);
    if(!l.numeros.length && !l.retido && !l.faltando) return;
    const chave = normalizarPlaca(c.placa);
    const atual = porPlaca.get(chave);
    // Uma linha por caminhão: quem tem duas cargas junta os números delas.
    if(!atual){
      porPlaca.set(chave, {
        placa: c.placa, cargas: [c.numeroCarga].filter(Boolean),
        lacres: l.numeros.slice(), retido: l.retido, motivo: l.motivo,
        por: l.por, em: l.em, faltando: l.faltando,
      });
      return;
    }
    if(c.numeroCarga && !atual.cargas.includes(c.numeroCarga)) atual.cargas.push(c.numeroCarga);
    l.numeros.forEach(n=>{ if(!atual.lacres.includes(n)) atual.lacres.push(n); });
    if(l.retido && !atual.retido){
      atual.retido = l.retido; atual.motivo = l.motivo; atual.por = l.por; atual.em = l.em;
    }
    atual.faltando = atual.faltando && l.faltando;
  });

  const linhas = [...porPlaca.values()];
  if(!linhas.length) return '';

  const comRetencao = linhas.filter(x=>x.retido).length;
  const semLacre = linhas.filter(x=>x.faltando).length;

  const corpo = linhas.map(x=>`<tr${x.retido ? ' class="lacre-linha-retida"' : ''}>
      <td>${esc(x.placa)}</td>
      <td>${esc(x.cargas.join(', ')) || '—'}</td>
      <td>${x.lacres.length ? esc(x.lacres.join(' / ')) : '<span class="obs-pendente">sem lacre informado</span>'}</td>
      <td>${x.retido ? esc(x.retido) : '—'}</td>
      <td>${x.retido
        ? esc([x.motivo, x.por ? 'por ' + x.por : '', x.em ? fmtDataHora(x.em) : '']
            .filter(Boolean).join(' · ')) || '—'
        : '—'}</td>
    </tr>`).join('');

  return `
    <div class="print-bloco-tit">Controle de lacres</div>
    <table class="tab-lacres">
      <thead><tr>
        <th>Placa</th><th>Carga(s)</th><th>Lacre(s) da saída</th>
        <th>Retido</th><th>Motivo da retenção · quem · quando</th>
      </tr></thead>
      <tbody>${corpo}</tbody>
    </table>
    <div class="print-nota">
      ${linhas.length} caminhão(ões) com registro de lacre no período.
      ${comRetencao ? `<strong>${comRetencao} com lacre RETIDO na inspeção.</strong>` : ''}
      ${semLacre ? `<strong>${semLacre} seguiram viagem sem número de lacre informado.</strong>` : ''}
      O lacre é do caminhão, não da carga: quando a placa leva mais de uma carga, os números aparecem uma vez só.
    </div>`;
}

/* "O VEÍCULO JÁ ESTÁ NO PÁTIO" — dito na carga que ainda espera por ele.
   (20/08/2026)

   Relato do programador de embarque, sobre uma placa com duas cargas do
   mesmo dia: "na segunda carga a placa está dando que o veículo não chegou,
   só que o veículo está no pátio... está errado! Tem que ser ao contrário".

   Ele tem razão: "Aguardando Veículo" é o status DA CARGA, não do caminhão.
   Quando outra carga da mesma placa já está no pátio, a informação existe
   no sistema e simplesmente não estava sendo mostrada — quem lia a linha
   concluía o oposto do que era verdade.

   A marca não muda status nenhum: só conta o que já se sabe. Promover a
   segunda carga continua sendo um clique da Portaria, com registro. */
function veiculoJaNoPatio(carga){
  if(!carga || carga.status !== 'Aguardando Veículo') return false;
  const p = normalizarPlaca(carga.placa);
  return cargasAbertas().some(c => c.id !== carga.id
    && normalizarPlaca(c.placa) === p
    && c.status !== 'Aguardando Veículo');
}
/* A ETAPA FOI DEVOLVIDA — e quem olha a fila precisa ver isso ANTES de agir.

   Sem esta marca, a carga devolvida para "Aguardando Veículo" aparece para
   a Portaria idêntica a uma que nunca chegou. O porteiro, que já deixou
   aquele caminhão entrar, lê "não chegou", clica "Chegou" de boa-fé e
   desfaz a correção. Foi o laço do relato do FTZ2138 (29/08/2026).

   Vinho, e não verde: ao contrário do "veículo já no pátio", isto NÃO é
   informação tranquila — é um pedido para parar e conferir. Some sozinha
   quando alguém legitimamente move a carga (ver `aindaVale`). */
function marcaEtapaDevolvidaHtml(carga){
  const d = (typeof etapaDevolvida === 'function') ? etapaDevolvida(carga) : null;
  if(!d || !d.aindaVale) return '';
  const quando = d.quando ? fmtDataHora(d.quando) : 'horário não registrado';
  return `<span class="chip-devolvida" title="${esc(d.setor)} (${esc(d.quem)}) devolveu esta carga `
    + `de &quot;${esc(d.de)}&quot; para &quot;${esc(d.para)}&quot; em ${esc(quando)}. `
    + `O motivo está no Histórico da carga. Confira antes de fazer a carga andar de novo.">`
    + `↩ etapa devolvida</span>`;
}

function chipNoPatioHtml(carga){
  return veiculoJaNoPatio(carga)
    ? '<span class="chip-no-patio" title="Outra carga desta mesma placa já está no pátio — o caminhão chegou. '
      + 'Falta a Portaria registrar a chegada TAMBÉM para esta carga (botão Chegou).">🚚 veículo já no pátio</span>'
    : '';
}

/* CARGA DUPLA: O STATUS DA CARGA E A SITUAÇÃO DO CAMINHÃO, LADO A LADO.
   (20/08/2026)

   Pedido do gestor depois do relato do programador de embarque: "o status de
   uma placa com carga dupla, como isso aparece para eles da forma mais clara
   possível".

   O mal-entendido tem uma raiz só: a coluna Status responde sobre a CARGA, e
   quem lê a linha entende que é sobre o CAMINHÃO. Com uma carga por placa os
   dois coincidem e ninguém percebe a diferença. Com duas, elas se separam —
   e foi aí que a leitura virou o oposto da verdade ("está dando que o veículo
   não chegou, só que o veículo está no pátio").

   A solução não é trocar um pelo outro: é dizer os dois. O selo continua
   sendo o da carga; embaixo dele, em uma linha, a situação do caminhão e o
   que está acontecendo com a OUTRA carga dele. Só aparece quando a placa tem
   mais de uma carga em aberto — em caminhão de carga única não há ambiguidade
   e a linha seria ruído. */
function situacaoPlacaHtml(c){
  if(!c) return '';
  const p = normalizarPlaca(c.placa);
  const irmas = cargasAbertas().filter(x => normalizarPlaca(x.placa) === p);
  if(irmas.length < 2) return '';

  const ordenadas = irmas.slice().sort((a,b)=> new Date(a.criadoEm) - new Date(b.criadoEm));
  const posicao = ordenadas.findIndex(x => x.id === c.id) + 1;
  const noPatio = irmas.filter(x => x.status !== 'Aguardando Veículo');
  const outras = ordenadas.filter(x => x.id !== c.id);
  const resumoOutras = outras
    .map(x => `${esc(x.numeroCarga) || 'sem nº'}: ${esc(x.status)}`)
    .join(' · ');

  const ondeEsta = noPatio.length
    ? '<strong>Caminhão NO PÁTIO</strong>'
    : '<strong>Caminhão ainda não chegou</strong>';

  /* O aviso mais importante da tela: o caminhão está aqui e ESTA carga
     continua esperando por ele. É exatamente o caso que travou a Portaria. */
  const pendente = (noPatio.length && c.status === 'Aguardando Veículo')
    ? ' — <span class="sit-acao">falta registrar a chegada desta carga</span>'
    : '';

  return `<div class="sit-placa${noPatio.length ? ' sit-no-patio' : ''}"
      title="${esc('Esta placa tem ' + irmas.length + ' cargas em aberto. O selo acima é o status DESTA carga; '
        + 'esta linha é a situação do CAMINHÃO.')}">
      ${noPatio.length ? '🚚' : '⏳'} ${ondeEsta} · carga ${posicao} de ${irmas.length}${pendente}
      ${resumoOutras ? `<span class="sit-outras">outra(s): ${resumoOutras}</span>` : ''}
    </div>`;
}

/* OS LACRES DE UMA CARGA, EM UM LUGAR SÓ (20/08/2026).

   Pedido do gestor: "as informações de lacre dos porteiros — lacres, tanto
   na saída quanto devoluções, e lacre retido também — saiam como informação
   para a gente na torre de controle, nos relatórios".

   Uma função só monta o texto para todas as telas. É o que garante que a
   Torre, a ficha da carga e os três relatórios digam a MESMA coisa sobre o
   mesmo caminhão — a alternativa (cada tela montando o seu) é como se
   produz relatório que não bate com o painel. */
function lacresDaCarga(c){
  const nums = [c.lacre, c.lacre2, c.lacre3].filter(Boolean);
  return {
    numeros: nums,
    texto: nums.join(' / '),
    retido: c.lacreRetido || '',
    motivo: c.lacreRetidoMotivo || '',
    por: c.lacreRetidoPor || '',
    em: c.lacreRetidoEm || null,
    /* Só é "sem lacre" quem JÁ SAIU sem número informado. Carga que ainda
       está no pátio não tem lacre porque ainda não é hora — apontar isso
       como falta seria alarme falso o dia inteiro. */
    faltando: c.status === 'Seguiu Viagem' && !nums.length,
  };
}

/* O chip que aparece na Torre, embaixo da placa. Fica na célula do VEÍCULO
   porque o lacre é do caminhão, não de uma carga específica — o mesmo
   motivo pelo qual a saída aplica o número a todas as cargas da placa. */
function chipLacreHtml(c){
  const l = lacresDaCarga(c);
  const partes = [];
  if(l.numeros.length){
    partes.push(`<span class="chip-lacre" title="${esc('Lacre(s) da saída: ' + l.texto)}">🔒 ${esc(l.texto)}</span>`);
  }
  if(l.retido){
    const dica = ['Lacre RETIDO na inspeção: ' + l.retido,
      l.motivo ? 'Motivo: ' + l.motivo : '',
      l.por ? 'Registrado por ' + l.por : '',
      l.em ? 'em ' + fmtDataHora(l.em) : ''].filter(Boolean).join(' · ');
    partes.push(`<span class="chip-lacre chip-lacre-retido" title="${esc(dica)}">⚠️ retido ${esc(l.retido)}</span>`);
  }
  if(l.faltando){
    partes.push('<span class="chip-lacre chip-lacre-falta" title="O caminhão saiu sem número de lacre informado pela Portaria.">🔓 sem lacre</span>');
  }
  return partes.join('');
}

/* ÚLTIMA AÇÃO DE UMA PESSOA — não a última gravação da máquina.
   (20/08/2026)

   Relato do gestor olhando a Torre: "todos estão marcando o mesmo horário,
   no mesmo dia". Estavam mesmo, e o horário era verdadeiro para a coisa
   errada: `atualizadoEm` é quando a LINHA foi gravada, e ela é regravada
   sempre que um painel reconecta e reenvia o que tem em memória. Meia
   programação recebia o mesmo carimbo de uma vez, sem ninguém ter tocado
   em nada.

   `acaoEm` (migração 026) só se move quando um campo do processo muda de
   verdade, e vem com o nome de quem mudou. É o que responde a pergunta que
   a Torre existe para responder: "isto andou? quem tocou nisso por
   último?".

   Carga antiga, de antes da migração, não tem esse carimbo — e aí a tela
   diz isso, em vez de mostrar um horário que não significa nada. */
function ultimaAcaoHtml(c){
  /* A FONTE É A TRILHA, NÃO UM CAMPO DA CARGA (20/08/2026).

     Pedido do gestor: "o horário fiel ao horário do histórico da última
     atualização de status". `ultimaMovimentacaoDaCarga` lê exatamente o
     mesmo registro que o Histórico e a linha do tempo desenham — então as
     três telas não têm como discordar entre si, por construção.

     `acaoEm` (migração 026) continua valendo como segunda linha: ele marca
     também EDIÇÃO de campo (peso, rota, observação), que não gera
     movimentação de etapa. Quando alguém editou depois da última mudança de
     etapa, isso aparece na dica — sem tirar da célula o horário que o
     gestor pediu. */
  const mov = ultimaMovimentacaoDaCarga(c.id);
  if(mov){
    const quem = [mov.operador, mov.setor].filter(Boolean).join(' · ');
    const partes = [`Última mudança de etapa (a mesma do Histórico): ${fmtDataHora(mov.timestamp)}`
      + ` — ${mov.statusAnterior ? mov.statusAnterior + ' → ' : ''}${mov.statusNovo}`
      + (quem ? ` por ${quem}` : '')];
    if(c.acaoEm && new Date(c.acaoEm) > new Date(mov.timestamp)){
      partes.push(`Depois disso alguém ainda editou campos desta carga: ${fmtDataHora(c.acaoEm)}`
        + (c.acaoPor ? ` — ${c.acaoPor}${c.acaoSetor ? ' · ' + c.acaoSetor : ''}` : ''));
    }
    return `<span class="dt-atu" title="${esc(partes.join(' | '))}">${fmtDataHora(mov.timestamp)}`
         + (quem ? ` <small class="dt-quem">${esc(quem)}</small>` : '')
         + '</span>';
  }
  /* Sem trilha nenhuma: carga recém-criada, que ainda não mudou de etapa.
     Aí vale o carimbo de ação — e, faltando os dois, a tela diz que não
     sabe, em vez de exibir uma hora de sincronização como se fosse
     trabalho de alguém. */
  if(!c.acaoEm){
    return '<span class="dt-atu dt-sem-acao" title="Esta carga ainda não mudou de etapa e é anterior ao '
         + 'registro de ação por operador. O histórico completo dela está no Histórico e na linha do tempo.'
         + '">sem registro de etapa</span>';
  }
  const quem = [c.acaoPor, c.acaoSetor].filter(Boolean).join(' · ');
  return `<span class="dt-atu" title="${esc('Ainda sem mudança de etapa. Última edição: '
         + fmtDataHora(c.acaoEm) + (quem ? ' — ' + quem : ''))}">${fmtDataHora(c.acaoEm)}`
       + (quem ? ` <small class="dt-quem">${esc(quem)}</small>` : '')
       + '</span>';
}

/* PROGRAMAÇÃO DE HOJE x PENDÊNCIA DE PROGRAMAÇÃO ANTERIOR (19/08/2026).

   Pedido do gestor, no mesmo dia em que a data de programação foi
   corrigida: "manter na torre de controle o que não passou por todas as
   etapas ainda da programação antiga, SEM ATRAPALHAR a programação nova".

   As duas coisas convivem na Torre — carga de ontem que não seguiu viagem
   não pode sumir —, mas não podem se misturar na leitura: quem abre a Torre
   de manhã precisa ver o dia de hoje inteiro primeiro e as sobras do dia
   anterior claramente marcadas embaixo, não uma lista única em que os dois
   dias se confundem.

   O dia é o da PROGRAMAÇÃO (programadoEm), nunca o da entrada do veículo. */
function diasDesdeProgramacao(c){
  const base = c.programadoEm || c.criadoEm || c.atualizadoEm;
  if(!base) return 0;
  const d = new Date(base);
  if(isNaN(d)) return 0;
  d.setHours(0,0,0,0);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.max(0, Math.round((hoje - d) / 86400000));
}
function ehProgramacaoAntiga(c){ return diasDesdeProgramacao(c) >= 1; }

function dataProgramacaoHtml(c){
  // Data da PROGRAMAÇÃO (mesma regra da fila): `criadoEm` é quando a linha
  // nasceu — numa carga vinda de entrada da Portaria, é o dia em que o
  // caminhão entrou, não o dia em que ela foi programada.
  const base = c.programadoEm || c.criadoEm || c.atualizadoEm;
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
  if(!p) return '';   // sem caminhão não há "1 de 2" — vazio não é placa
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

  /* O botão também vive na Torre de Controle (relato de 18/08/2026: a
     carga saía da fila do dia e a opção "sumia"). O formulário fica na
     aba Programação — navega pra lá ANTES de preencher, senão o foco e o
     scrollIntoView miram campos de uma aba escondida. */
  if(typeof TAB_ATUAL !== 'undefined' && TAB_ATUAL !== 'programacao') irParaTab('programacao');

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
  /* Sem este carimbo a alteração NÃO SOBE ao servidor.

     `sincronizarCargasAlteradas` decide o que enviar comparando
     `atualizadoEm` com a marca do que já subiu — sem carimbo novo, a carga
     é lida como "nada mudou" e nunca é enviada. A sequência ficava só na
     tela de quem editou e voltava ao valor do servidor no sincronismo
     seguinte. Relato do programador de embarque em 14/08/2026: "já alterei
     três vezes e ela não se mantém na torre de controle". */
  c.atualizadoEm = nowISO();
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

  const recados = reconciliarPatioAoTrocarPlaca(c, anterior);

  SuincoStore.save();
  notify(`Placa alterada para ${nova} — transportadora ${c.transportadora || 'não informada'}.`, 'success');
  recados.forEach(m => notify(m, 'info'));
  renderAll();
}

/* O PÁTIO É CONSULTADO NA TROCA DE PLACA — relato do Alysson, 26/08/2026.

   "A carga do GPA já tinha entrado nesse caminhão aqui, o FTZ. A portaria
   tinha registrado nele também. Aí eu alterei a carga do GPA ali na torre...
   alterou tudo, só que o status do veículo, informando que a carga já estava
   aqui, não mudou. Tive que registrar na portaria novamente... depois
   apareceu duas informações."

   Duas metades, e as duas terminam na mesma duplicata:

     · a placa que ENTRA na carga já estava no pátio, e a carga continuava
       esperando um caminhão parado lá dentro;
     · a placa que SAI sumia da tela da Portaria, que só mostra placa com
       carga aberta. Para o porteiro, a entrada das 12:49 tinha evaporado —
       e ele registrou de novo. Essa segunda entrada é a duplicata.

   Isto aqui é a resposta IMEDIATA na tela. Quem manda é o servidor, que faz
   a mesma coisa em reconciliarPatioNaTrocaDePlaca (backend/src/rotas/
   cargas.js) e grava a trilha completa. O painel adianta o resultado para o
   operador não ficar olhando um estado que ele sabe estar errado.

   SÓ ANTES DA DOCA, decisão do dono: depois que o embarque começou, trocar
   placa é caso excepcional e a etapa só muda por correção com motivo. */
function reconciliarPatioAoTrocarPlaca(carga, placaAntiga){
  const recados = [];
  if(carga.status !== 'Aguardando Veículo' && carga.status !== 'Aguardando Embarque') return recados;

  const quem = (DB.operador && DB.operador.nome) || '(não identificado)';
  const setor = (DB.operador && DB.operador.setor) || 'Logística';
  const hora = (iso) => iso ? fmtDataHora(iso) : 'horário não registrado';

  /* ---- Metade 1: a placa nova já está no pátio ---- */
  /* O miolo mora em data.js (absorverEntradaDoPatio) porque a MESMA
     situação acontece por dois caminhos: trocar a placa de uma carga, e
     criar carga para uma placa que já entrou. Antes ele existia só aqui, e
     por isso o segundo caminho ficava sem tratamento — era o relato do
     dono em 27/08. Uma função, dois chamadores. */
  recados.push(...absorverEntradaDoPatio(carga, { nome: quem, setor }));

  /* ---- Metade 2: a placa antiga fica sozinha no pátio ---- */
  /* Só quando o caminhão antigo tinha de fato entrado: carga que nunca passou
     de "Aguardando Veículo" não deixa caminhão nenhum para trás. */
  const entradaAntiga = entradaNoPatioDe(carga);
  const aindaTemCarga = cargasAbertas().some(x =>
    x.id !== carga.id && normalizarPlaca(x.placa) === normalizarPlaca(placaAntiga));

  if(entradaAntiga && !aindaTemCarga){
    const frota = buscarFrota(placaAntiga);
    const solta = {
      id: uid('carga'), numeroCarga: 'Aguardando Carga', placa: normalizarPlaca(placaAntiga),
      transportadora: frota ? frota.transportadora : '',
      tipoVeiculo: frota ? frota.tipoVeiculo : '',
      motorista: '', cliente: '', destino: '', produto: '', peso: 0, doca: '',
      sequencia: null, observacoes: '', rota: '',
      praOnde: praOndeSugerido(frota ? frota.transportadora : ''),
      paletizada: 'Não', qtdGanchos: 0, qtdEntregas: 1,
      status: 'Aguardando Embarque', aguardandoCarga: true,
      criadoEm: entradaAntiga, criadoPor: quem,
      atualizadoEm: nowISO(), _nuncaConfirmada: true
    };
    DB.cargas.push(solta);
    registrarMovimentacao({
      cargaId: solta.id, placa: solta.placa,
      statusAnterior: null, statusNovo: 'Aguardando Embarque',
      operador: quem, setor, timestamp: entradaAntiga
    });
    recados.push(`${solta.placa} ficou no pátio sem carga — continua lá, com a `
      + `entrada de ${hora(entradaAntiga)}. A Portaria não precisa registrar de novo.`);
  }

  return recados;
}

function atualizarNumeroCargaUI(id, val){
  const c = getCarga(id);
  if(!c) return;
  /* Limpa aspas e espaços que vieram da digitação. O caso real que motivou
     isto: `118176'` entrou no sistema com uma aspa no fim e não casava com
     nada — nem na busca, nem na conferência do relatório. */
  const novo = normalizarNumeroCarga(val);

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
  c.atualizadoEm = nowISO();   // sem isto a mudança não sobe — ver atualizarSequenciaUI
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
  /* `cargasAbertas()`, não `DB.cargas` — relato de 14/08/2026: "não consigo
     excluir essas duas cargas que ficaram como resíduo".

     O caminho que gera o resíduo: um caminhão chega sem programação (nasce
     um registro `aguardandoCarga`), a carga dele nunca é lançada, e depois
     ele vai embora — a Portaria registra a saída e o registro vira "Seguiu
     Viagem", mas continua com a marca `aguardandoCarga`.

     Esta lista usava a lista CRUA, sem tirar quem já saiu, então o registro
     ficava aqui para sempre: não dá para lançar carga de um caminhão que já
     foi embora, e o botão Excluir se recusa — com razão — a apagar quem já
     viajou. O contador ao lado desta mesma tabela já usava `cargasAbertas()`
     (linha do `aguardandoCargaCount`), então os dois discordavam na tela.

     A correção não é liberar a exclusão: histórico do pátio não se apaga
     mesmo. É parar de chamar de "aguardando carga" um caminhão que já saiu.
     Ele continua no Histórico e nos relatórios, onde deve estar. */
  const lista = cargasAbertas().filter(c=>c.aguardandoCarga);
  const pill = document.getElementById('prog-aguardando-count');
  pill.hidden = lista.length===0; pill.textContent = lista.length;
  document.getElementById('prog-aguardando-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${fmtDataHora(c.criadoEm)}</td>
      <td class="no-print gap8">
        <!-- "Criar carga", não "Completar dados" — pedido do programador
             de cargas (12/08/2026), e a palavra dele descreve melhor o que
             acontece: o caminhão chegou sem programação, então ele está
             CRIANDO a carga daquele veículo, não preenchendo lacunas de
             algo que já existia. O botão é o mesmo, o fluxo é o mesmo; o
             nome é que estava contando outra história. -->
        <button class="btn btn-primary btn-sm" onclick="abrirCompletar('${escJs(c.id)}')">➕ Criar carga</button>
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
  /* "No pátio desde" só quando a chegada foi REGISTRADA. O `|| c.criadoEm`
     que estava aqui trocava a resposta honesta pela data em que a LINHA
     nasceu — que numa carga programada é a véspera. Foi assim que uma
     placa que chegou de manhã apareceu "no pátio desde 20:42 de ontem". */
  const entradaCompletar = entradaNoPatioDe(c);
  document.getElementById('completar-placa-info').textContent = entradaCompletar
    ? `Placa ${c.placa} — no pátio desde ${fmtDataHora(entradaCompletar)}`
    : `Placa ${c.placa} — chegada ainda não registrada pela Portaria`;
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
    notifyGravacao('Dados completados com sucesso.');
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}

/* ---------- PORTARIA ---------- */
async function acaoChegadaUI(){
  const input = document.getElementById('portaria-placa');
  const placa = input.value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  /* Antes de registrar chegada, puxa o servidor (19/08/2026).

     O caso que motivou isto: o caminhão saiu sem a Portaria registrar a
     saída, e no dia seguinte o porteiro clicou "Chegou". No terminal dele a
     carga anterior não estava à vista — lista velha —, então a checagem
     local não tinha o que checar e nasceu uma carga duplicada. Uma leitura
     de meio segundo antes do clique resolve o caso comum; o servidor
     continua sendo quem recusa de verdade (PLACA_COM_CARGA_ABERTA). */
  if(SuincoSharePoint && SuincoSharePoint.estaConfigurado && SuincoSharePoint.estaConfigurado()){
    try{ await SuincoSharePoint.sincronizarAgora(); }
    catch(e){ /* sem rede: segue com o que há e o servidor decide depois */ }
  }
  /* A ETAPA DEVOLVIDA PEDE CONFIRMAÇÃO — 29/08/2026, relato do FTZ2138.

     Aqui era onde o laço se fechava: a carga que a Administração devolveu
     para "Aguardando Veículo" reaparece na fila da Portaria como "não
     chegou", e o "Chegou" a empurrava de volta na hora, calado. Quem
     corrigiu tentava de novo, e a coisa girava.

     PERGUNTA, NÃO BLOQUEIA. A Portaria tem autoridade sobre a chegada e o
     caminhão pode de fato ter chegado de novo — botão desabilitado não
     ensina o caminho, só nega. O que faltava não era permissão, era a
     INFORMAÇÃO de que aquilo tinha sido feito de propósito, por alguém,
     com motivo. A pergunta traz quem, quando e de onde para onde.

     Roda DEPOIS do `sincronizarAgora()` acima, de propósito: a devolução
     pode ter acabado de acontecer em outro terminal, e perguntar com lista
     velha é não perguntar. */
  const devolvidas = cargasAbertasPorPlaca(normalizarPlaca(placa))
    .map(c => ({ carga: c, d: etapaDevolvida(c) }))
    .filter(x => x.d && x.d.aindaVale && x.d.para === 'Aguardando Veículo');
  if(devolvidas.length){
    const { carga, d } = devolvidas[0];
    const quando = d.quando ? fmtDataHora(d.quando) : 'horário não registrado';
    const qual = carga.numeroCarga ? `a carga ${carga.numeroCarga}` : 'esta carga';
    const ok = confirm(
      `${normalizarPlaca(placa)}: a etapa foi DEVOLVIDA de propósito.\n\n`
      + `${d.setor} (${d.quem}) devolveu ${qual} de "${d.de}" para "${d.para}" em ${quando}.\n`
      + `O motivo está no Histórico da carga.\n\n`
      + `Registrar a chegada agora desfaz essa correção.\n`
      + `O caminhão chegou de novo?`);
    if(!ok){
      notify(`Chegada NÃO registrada — ${normalizarPlaca(placa)} continua em "${d.para}", `
        + `como ${d.setor} deixou. Se o caminhão chegou mesmo, clique "Chegou" e confirme.`,
        'info', 9000);
      input.value = '';
      input.focus();
      return;
    }
  }

  let r;
  try{
    r = registrarChegadaPortaria(placa, nomeOperadorAtual());
  }catch(e){
    // A trava de frota na chegada (14/08/2026) passou a RECUSAR placa fora
    // do cadastro. Sem este try/catch o erro subia sem tratamento e o
    // porteiro não via aviso nenhum — a tela ficava muda, que é o pior
    // resultado possível para quem está com o caminhão parado no portão.
    notify(e.message, 'danger', 9000);
    input.focus();
    input.select();
    return;
  }
  if(r.criadas.length){
    notify(`${normalizarPlaca(placa)}: nenhuma programação encontrada — criada entrada "Aguardando Carga" (status Aguardando Embarque). Avise a Logística para completar os dados.`, 'warn');
    tocarBeepConfirmacao();
  } else if(r.atualizadas.length){
    notifyGravacao(`${normalizarPlaca(placa)}: ${r.atualizadas.length} carga(s) agora em "Aguardando Embarque".`);
    tocarBeepConfirmacao();
  } else if(r.jaNoPatio.length){
    /* Aviso ALTO, e não informativo: este é o momento em que o porteiro
       está prestes a registrar uma chegada que não pode existir. A carga
       anterior precisa SAIR primeiro — se o caminhão já foi embora sem
       baixa, é a saída que está faltando, não a chegada. */
    notify(`${normalizarPlaca(placa)} ainda tem carga em aberto (${r.jaNoPatio.map(c=>c.numeroCarga || c.status).join(', ')}). `
      + 'Registre a SAÍDA desse caminhão antes de registrar a chegada dele de novo — '
      + 'se ele já foi embora sem baixa, use o botão "Saiu".', 'warn', 12000);
  }
  input.value = '';
  input.focus();
  renderAll();
}
/* A SAÍDA DO PÁTIO — REESCRITA DEPOIS DO INCIDENTE DE 28/08/2026.

   O QUE ACONTECEU. A Portaria deu saída na placa PUX2971 às 06:38. No
   terminal do porteiro apareceu "Seguiu Viagem", com beep de confirmação, e
   no Histórico dele a movimentação estava lá. A Bruna, em OUTRO terminal,
   continuou vendo o caminhão no pátio; ligou para o Alysson, que às 08:59
   deu a saída de novo — e o servidor aceitou, porque para ele a carga
   nunca tinha saído. Duas horas e meia com o pátio dizendo uma coisa e o
   painel de cada um dizendo outra.

   POR QUE ACONTECEU — três defeitos meus, empilhados:

   1. A rota `POST /api/portaria/saida` existe no servidor desde 20/08 e
      NINGUÉM a chamava. A saída era escrita no navegador e entregue à
      sincronia comum. A etapa que solta o caminhão do pátio era a única
      que não falava direto com quem manda.
   2. `acaoChegadaUI` puxa o servidor ANTES de agir desde 19/08, justamente
      porque lista velha produz decisão errada. A saída, que é o espelho
      dela, nunca ganhou o mesmo cuidado. Uma função, dois chamadores — e
      aqui eram dois caminhos com um cuidado só.
   3. A confirmação era otimista: o beep e o "saída registrada" tocavam
      antes de qualquer resposta do servidor. Sem rede, ou com o terminal
      em modo local, a fila offline engolia tudo em silêncio e o porteiro
      liberava o caminhão achando que estava tudo gravado.

   COMO FICA. Quem decide o que saiu é o SERVIDOR, dentro de uma transação,
   lendo o estado real da placa. A tela só repete o que ele respondeu. Se
   ele não responder, o porteiro é avisado ALTO e a placa fica marcada como
   não confirmada até alguém resolver — porque caminhão liberado com saída
   não gravada é o começo da carga fantasma do dia seguinte. */
async function acaoSaidaUI(){
  const input = document.getElementById('portaria-placa');
  const placa = normalizarPlaca(input.value);
  if(!placa){ notify('Informe a placa.','warn'); return; }
  const lerLacre = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };
  const lacres = ['portaria-lacre', 'portaria-lacre-2', 'portaria-lacre-3']
    .map(lerLacre).filter(Boolean);
  const limparLacres = () => ['portaria-lacre', 'portaria-lacre-2', 'portaria-lacre-3']
    .forEach((id) => { const el = document.getElementById(id); if(el) el.value = ''; });

  const comServidor = typeof SuincoSharePoint !== 'undefined'
    && SuincoSharePoint.estaConfigurado && SuincoSharePoint.estaConfigurado()
    && typeof SuincoSharePoint.portariaSaida === 'function';

  /* SEM SERVIDOR NÃO EXISTE SAÍDA CONFIRMADA, e a tela precisa dizer isso
     com todas as letras. O caminho local continua existindo — o porteiro
     está com o caminhão na frente e não pode ficar parado —, mas ele sai
     daqui SABENDO que a baixa ainda não é oficial. */
  if(!comServidor){
    const r = registrarSaidaPortaria(placa, nomeOperadorAtual(), lacres);
    if(r.liberadas.length) limparLacres();
    marcarSaidaNaoConfirmada(placa, r.liberadas.length,
      'este terminal está sem servidor');
    avisarPendentesDaSaida(placa, r);
    input.value = ''; input.focus(); renderAll();
    return;
  }

  /* Lista velha decide errado: uma leitura antes do clique é o que separa
     "o servidor não sabia da segunda carga" de "o porteiro foi avisado". */
  try{ await SuincoSharePoint.sincronizarAgora(); }
  catch(e){ /* sem rede agora; o POST abaixo é quem vai dizer a verdade */ }

  let resposta;
  try{
    resposta = await comOverlaySync('Registrando a saída no servidor…',
      () => SuincoSharePoint.portariaSaida(placa, lacres));
  }catch(e){
    /* A saída NÃO foi gravada. Registrar localmente aqui só recriaria o
       defeito de hoje — tela verde, servidor mudo. O que se faz é gritar. */
    notify(`${placa}: a saída NÃO foi registrada no servidor `
      + `(${e && e.message ? e.message : 'sem resposta'}). `
      + 'NÃO libere o caminhão sem registrar — tente de novo, e se não passar, '
      + 'avise a Logística agora.', 'danger', 20000);
    tocarAlertaAlteracao();
    marcarSaidaNaoConfirmada(placa, 0, e && e.message ? e.message : 'sem resposta do servidor');
    input.focus(); input.select();
    return;
  }

  /* A verdade é a do servidor: o painel adota a resposta dele em vez de
     confiar no que tinha em memória. */
  await SuincoSharePoint.sincronizarAgora().catch(()=>{});
  const liberadas = (resposta && resposta.liberadas) || [];
  const pendentes = (resposta && resposta.pendentes) || [];
  limparSaidaNaoConfirmada(placa);

  if(liberadas.length){
    limparLacres();
    notifyGravacao(`${placa}: saída CONFIRMADA pelo servidor para ${liberadas.length} carga(s) — `
      + `Seguiu Viagem${lacres.length ? `, lacre ${lacres.join(' · ')}` : ''}.`);
    tocarBeepConfirmacao();
  }
  if(liberadas.length && !lacres.length){
    notify(`${placa} saiu SEM número de lacre informado. A saída está registrada; `
      + 'informe o lacre no campo ao lado da placa nas próximas.', 'warn', 7000);
  }
  avisarPendentesDaSaida(placa, { liberadas, pendentes });
  input.value = '';
  input.focus();
  renderAll();
}

/* O caminhão sai UMA vez, mas a placa pode ter mais de uma carga. Carga que
   fica para trás não pode ser um aviso que some em cinco segundos: ela é o
   motivo pelo qual outro setor vai continuar vendo o caminhão no pátio —
   foi o que a Bruna viu hoje. Então fica escrito na tela da Portaria. */
function avisarPendentesDaSaida(placa, r){
  const pendentes = r.pendentes || [];
  if(!pendentes.length && !r.liberadas.length){
    notify(`Nenhuma carga em aberto encontrada para a placa ${placa}.`, 'warn', 9000);
  }
  const faixa = document.getElementById('portaria-saida-aviso');
  if(!faixa) return;
  /* NÃO APAGA UM AVISO DE PERIGO. Os dois avisos moram na mesma faixa, e a
     ordem em que são escritos não pode decidir qual sobrevive: "a saída não
     foi confirmada" é mais grave que "sobrou carga" e não pode ser
     silenciado por não haver pendência. Este defeito apareceu no primeiro
     teste — o modo local levantava a faixa e ela era apagada uma linha
     depois. */
  if(faixa.className.indexOf('aviso-faixa-perigo') >= 0 && !faixa.hidden) return;
  if(!pendentes.length){ faixa.hidden = true; faixa.innerHTML = ''; return; }
  const lista = pendentes.map(c => `${esc(c.numeroCarga || c.numero_carga || c.id || '—')} `
    + `(${esc(c.status || c.status_atual || '—')})`).join(', ');
  faixa.hidden = false;
  faixa.className = 'aviso-faixa aviso-faixa-warn';
  faixa.innerHTML = `<strong>${esc(placa)}: ${pendentes.length} carga(s) NÃO saíram</strong> — `
    + `${lista}. Só sai o que está Faturado. Enquanto elas estiverem abertas, `
    + 'os outros setores continuam vendo este caminhão no pátio.';
  if(pendentes.length) tocarAlertaAlteracao();
}

/* Saída que não chegou ao servidor não pode virar assunto encerrado. Fica
   na tela, com a placa, até alguém registrar de verdade. */
function marcarSaidaNaoConfirmada(placa, quantas, motivo){
  notify(`${placa}: saída registrada SÓ NESTE TERMINAL (${motivo}). `
    + 'Os outros setores continuam vendo o caminhão no pátio. '
    + 'Confirme com a Logística antes de considerar resolvido.', 'danger', 20000);
  tocarAlertaAlteracao();
  const faixa = document.getElementById('portaria-saida-aviso');
  if(!faixa) return;
  faixa.hidden = false;
  faixa.className = 'aviso-faixa aviso-faixa-perigo';
  faixa.innerHTML = `<strong>⚠ ${esc(placa)}: saída NÃO confirmada pelo servidor</strong> — `
    + `${esc(motivo)}. ${quantas ? quantas + ' carga(s) mudaram só nesta tela. ' : ''}`
    + 'Registre de novo quando a conexão voltar, ou avise a Logística.';
}

function limparSaidaNaoConfirmada(placa){
  const faixa = document.getElementById('portaria-saida-aviso');
  if(faixa && faixa.className.indexOf('aviso-faixa-perigo') >= 0
     && faixa.innerHTML.indexOf(placa) >= 0){
    faixa.hidden = true; faixa.innerHTML = '';
  }
}

/* Retenção de lacre na inspeção da saída — pedido do gestor (18/08/2026).

   PASSA PELO SERVIDOR (20/08/2026). Antes isto era gravação local que subia
   junto com o resto da carga, e o motivo/autor/hora viviam só dentro do
   texto da observação. Agora existe rota própria e três campos próprios
   (migração 027), porque o gestor precisa dessa informação FIEL no
   relatório — e observação é campo que qualquer setor edita.

   O retorno do servidor é a fonte da verdade: se ele não achou carga para
   a placa, a tela diz isso em vez de fingir que gravou. */
async function registrarLacreRetidoUI(){
  const v = (id)=> (document.getElementById(id)||{}).value || '';
  const placa = v('lacre-ret-placa');
  if(!normalizarPlaca(placa)){ notify('Informe a placa do caminhão.','warn'); return; }
  const retido = v('lacre-ret-numero').trim();
  if(!retido){ notify('Informe o número do lacre retido.','warn'); return; }
  const novo = v('lacre-ret-novo').trim();
  const motivo = v('lacre-ret-motivo').trim();
  if(!motivo){
    notify('Diga o motivo da retenção — é ele que vai para o relatório e explica a ocorrência depois.', 'warn', 7000);
    return;
  }
  try{
    const r = await comOverlaySync('Registrando a retenção do lacre…',
      () => SuincoSharePoint.reterLacre({
        placa: normalizarPlaca(placa), lacreRetido: retido, novoLacre: novo, motivo,
      }));
    if(!r.total){
      notify(`Nenhuma carga encontrada para a placa ${normalizarPlaca(placa)} — nem saída de hoje, nem em aberto.`, 'warn', 7000);
      return;
    }
    await SuincoSharePoint.sincronizarAgora();
    notifyGravacao(`${normalizarPlaca(placa)}: lacre ${retido} retido em ${r.total} carga(s)`
      + (novo ? ` — novo lacre ${novo}` : '') + '.');
    tocarBeepConfirmacao();
    ['lacre-ret-placa','lacre-ret-numero','lacre-ret-novo','lacre-ret-motivo']
      .forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
    renderAll();
  }catch(e){
    notify('Não consegui registrar a retenção: ' + (e && e.message ? e.message : 'erro no servidor')
      + '. O lacre NÃO foi marcado como retido.', 'danger', 9000);
  }
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
  const lista = cargasAbertas().slice().sort(ordenarPorAcaoDoSetor('Portaria'));
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
      <td class="col-identificacao">${esc(c.placa)}${marcaCargaDaPlaca(c, lista)}${marcaEtapaDevolvidaHtml(c)}</td>
      <td class="col-identificacao">${esc(c.numeroCarga)||'—'}</td>
      <td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(rotaCurta(c.rota))}</td>
      <td>${badgeHtml(c.status)}${situacaoPlacaHtml(c)}</td>
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
    /* Uma definição só de "entrada no pátio" — ver entradaNoPatioDe().
       Sem `|| c.criadoEm`: quando não há chegada registrada a coluna fica
       vazia, em vez de mostrar a data em que a linha foi criada com cara
       de hora de chegada. */
    const chegada = cargas.map(entradaNoPatioDe).filter(Boolean).sort()[0] || null;
    /* A CONTA ERA SÓ DO QUE JÁ ESTAVA NO PÁTIO (20/08/2026).

       No print do programador de embarque a placa aparecia aqui com "1
       carga em aberto" enquanto tinha DUAS — a segunda ainda esperava o
       registro de chegada. Contar só metade do caminhão é o mesmo
       mal-entendido da coluna Status, de outro ângulo: o caminhão é um só,
       e a Portaria precisa saber que falta encostar a outra. */
    const todas = cargasAbertasPorPlaca(p);
    const aguardando = todas.filter(c=>c.status === 'Aguardando Veículo');
    const contagem = aguardando.length
      ? `${cargas.length} no pátio <span class="sit-acao">+ ${aguardando.length} sem entrada</span>`
      : String(cargas.length);
    return `<tr>
      <td>${esc(p)}</td><td>${esc(transp)}</td><td>${contagem}</td>
      <td>${cargas.map(c=>badgeHtml(c.status)).join(' ')}
        ${aguardando.map(c=>`<span class="badge-espera" title="Esta carga da MESMA placa ainda não teve a chegada registrada.">${esc(c.numeroCarga)||'sem nº'}: aguardando entrada</span>`).join(' ')}</td>
      <td>${chegada ? fmtDataHora(chegada)
            : '<span class="text-dim">chegada não registrada</span>'}</td>
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
/* FATURAR PEDE CONFIRMAÇÃO — e mostra QUAL carga (25/08/2026).

   Pedido do gestor: "quando o faturista clicar em FATURAR, aparecer um
   alerta na tela para confirmar aquela etapa".

   Faturar é a última etapa do pátio e a única que sai do painel para o
   dinheiro. Diferente de "Iniciar Embarque", que a pessoa corrige em
   dois cliques, uma carga faturada por engano vira nota emitida.

   A pergunta NÃO é "tem certeza?" — essa todo mundo aprende a clicar sem
   ler. A pergunta é "é esta carga?", e por isso a janela mostra número,
   placa, transportadora, destino e peso. O erro que ela existe para pegar
   é o de LINHA trocada numa tabela de dez cargas, não o de dedo.

   A trava mora aqui, no executarAvanco, e não no botão: as duas portas
   que chegam a "Faturado" (o botão da linha e o campo de placa da ação
   rápida, que ainda passa pelo seletor quando a placa tem mais de uma
   carga) desembocam nesta função. Guardar só o botão deixaria a outra
   porta destrancada. */
let _faturarPendente = null;

function pedirConfirmacaoFaturamentoUI(cargaId){
  const c = getCarga(cargaId);
  if(!c){ notify('Carga não encontrada.', 'danger'); return; }
  _faturarPendente = cargaId;
  const linha = (rot, val) => `<div class="fat-conf-linha">
      <span class="fat-conf-rot">${rot}</span>
      <span class="fat-conf-val">${esc(val) || '—'}</span></div>`;
  document.getElementById('faturar-resumo').innerHTML =
      linha('Nº da carga', c.numeroCarga)
    + linha('Placa', c.placa)
    + linha('Transportadora', c.transportadora)
    + linha('Destino', c.destino)
    + linha('Peso', `${(c.peso || 0).toLocaleString('pt-BR')} kg`);
  document.getElementById('modal-faturar').classList.add('open');
  // O foco vai para CANCELAR, não para o botão que age: quem apertar Enter
  // por reflexo não fatura sem ler.
  const cancelar = document.getElementById('faturar-cancelar');
  if(cancelar) cancelar.focus();
}

function fecharModalFaturar(){
  document.getElementById('modal-faturar').classList.remove('open');
  _faturarPendente = null;
}

function confirmarFaturamentoUI(){
  const id = _faturarPendente;
  fecharModalFaturar();
  if(id) executarAvanco(id, 'Faturado', true);
}

function executarAvanco(cargaId, statusDestino, jaConfirmado){
  if(statusDestino === 'Faturado' && !jaConfirmado){
    pedirConfirmacaoFaturamentoUI(cargaId);
    return;
  }
  try{
    const c = getCarga(cargaId);
    avancarStatusCarga(cargaId, statusDestino, nomeOperadorAtual(), setorOperadorAtual());
    notifyGravacao(`${c.placa}: agora em "${statusDestino}".`);
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
  const lista = cargasAbertas().filter(c=>alvo.includes(c.status)).sort(ordenarPorAcaoDoSetor('Expedição'));
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
  const lista = cargasAbertas().filter(c=>alvo.includes(c.status)).sort(ordenarPorAcaoDoSetor('Faturamento'));
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
const FILTRO_IND = { transportadora:'', rota:'', operacao:'', busca:'', periodo:'' };

function filtroIndicadoresAtivo(){
  return !!(FILTRO_IND.transportadora || FILTRO_IND.rota || FILTRO_IND.operacao || FILTRO_IND.busca);
}

// A REGRA MORA EM data.js, E OS GRÁFICOS USAM A MESMA (28/08/2026).
// Esta função existia com a regra escrita aqui dentro, e os gráficos tinham
// a sua própria em aplicarFiltrosCargas. Duas cópias da mesma ideia = duas
// que se desencontram: filtrar transportadora movia as tabelas e não mexia
// um pixel nos gráficos. Agora as duas telas chamam a MESMA função.
function filtrarPorFiltroIndicadores(cargas){
  if(!filtroIndicadoresAtivo()) return cargas;
  return aplicarFiltrosCargas(cargas, FILTRO_IND);
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

const ROTULO_PERIODO_IND = {
  '6h':'Últimas 6h', '12h':'Últimas 12h', 'hoje':'Hoje',
  'semana':'Semana (7d)', 'mes':'Mês',
};

/* CLICAR NO GRÁFICO VIRA FILTRO (28/08/2026).

   Pedido do dono: "quando clica nos gráficos e filtra por transportadora ele
   precisa interagir com aquele dado filtrado ou clicado". É o gesto que as
   pessoas já tentam — e até hoje não acontecia nada.

   Clicar de novo no mesmo valor LIMPA o filtro: sem isso, quem clica errado
   fica preso e tem que caçar o botão de limpar. */
function filtrarIndicadoresPor(campo, valor){
  const id = { transportadora:'ind-f-transp', rota:'ind-f-rota', operacao:'ind-f-operacao' }[campo];
  if(!id) return;
  const el = document.getElementById(id);
  if(!el) return;
  const v = String(valor ?? '');
  const limpar = (el.value === v);
  el.value = limpar ? '' : v;
  // Atribuir um valor que não está na lista de opções não dá erro: o select
  // fica em branco e o clique não faz nada visível — "não aconteceu nada" é
  // a pior resposta possível. Se acontecer, o valor entra como opção e o
  // filtro se aplica do mesmo jeito.
  if(!limpar && el.value !== v){
    el.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(v)}</option>`);
    el.value = v;
  }
  aplicarFiltroIndicadores();
}

/* Célula de tabela que aplica o filtro da aba ao ser clicada.

   Uma função, vários chamadores: gargalos (transportadora, rota, operação)
   e ranking usam esta mesma célula, então o gesto é idêntico em toda a aba
   e o estado "este é o filtro ligado agora" é desenhado de um jeito só.
   Teclado incluído: a tabela inteira é operável sem mouse. */
function celFiltro(campo, valor, rotulo){
  const v = (valor === 0 || valor) ? String(valor) : '';
  if(!v) return `<td>${esc(rotulo ?? '—')}</td>`;
  const ativo = String(FILTRO_IND[campo] || '') === v;
  const chamada = `filtrarIndicadoresPor('${escJs(campo)}','${escJs(v)}')`;
  return `<td class="cel-filtro${ativo ? ' cel-filtro-ativa' : ''}" role="button" tabindex="0"
      title="${ativo ? 'Clique para tirar este filtro' : 'Clique para filtrar a aba inteira por este item'}"
      onclick="${chamada}"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${chamada}}"
    >${esc(rotulo ?? v)}</td>`;
}

function aplicarFiltroIndicadores(){
  const ler = id => (document.getElementById(id)||{}).value || '';
  FILTRO_IND.transportadora = ler('ind-f-transp');
  FILTRO_IND.rota           = ler('ind-f-rota');
  FILTRO_IND.operacao       = ler('ind-f-operacao');
  FILTRO_IND.busca          = ler('ind-f-busca');
  /* PERÍODO ÚNICO PARA A ABA (28/08/2026). Ele morava só no filtro dos
     gráficos; os cartões usavam o histórico inteiro. Dois recortes de tempo
     na mesma tela, sem ninguém avisar qual era qual. */
  FILTRO_IND.periodo        = ler('ind-f-periodo');

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
    if(FILTRO_IND.periodo)        partes.push(ROTULO_PERIODO_IND[FILTRO_IND.periodo] || FILTRO_IND.periodo);
    nota.hidden = partes.length === 0;
    nota.innerHTML = partes.length
      ? `<strong>Filtro ativo:</strong> ${esc(partes.join(' · '))}`
        + ' — os números abaixo consideram só este recorte.'
      : '';
  }
  renderIndicadores();
}

function limparFiltroIndicadores(){
  ['ind-f-transp','ind-f-rota','ind-f-operacao','ind-f-busca','ind-f-periodo'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value = '';
  });
  aplicarFiltroIndicadores();
}

/* =====================================================================
   RAIO-X DA OPERAÇÃO — métricas por rota, transportadora e placa
   =====================================================================
   (21/08/2026) Pedido do gestor: "da mesma forma que no histórico eu
   consigo abrir um card detalhado, quero poder enxergar as métricas de
   cada linha selecionável, cada placa, cada rota... quero que os
   indicadores mostrem as rotas também".

   Decisões de desenho, na ordem em que importam:

   · TRÊS RECORTES, UMA ESTRUTURA. Rota, transportadora e placa respondem
     a mesma pergunta ("onde a operação gasta tempo, e com quem?") com
     chaves diferentes. Um controle segmentado troca o recorte; a tabela,
     a ordenação e o detalhe são os mesmos — aprender uma vez vale para os
     três.

   · A BARRA DOURADA É MAGNITUDE, NÃO ENFEITE. Cada linha carrega a fatia
     de cargas da entidade em relação à maior do recorte — sequencial, um
     tom só, como magnitude pede. Comparar comprimento é o que o olho faz
     melhor; comparar números em coluna, não.

   · O DETALHE COMPARA COM A MÉDIA GERAL. "Rota 517 gasta 3h12 aguardando
     embarque" não diz nada sozinho; com o risco da média geral na mesma
     barra, vira diagnóstico: acima do risco = pior que o pátio inteiro.
     As cores das etapas são as MESMAS dos selos de status do painel
     inteiro (identidade fixa por etapa — validadas para daltonismo e
     contraste contra o fundo navy, com rótulo direto em toda barra: cor
     nunca é o único canal).

   · SEM GRÁFICO DE PIZZA NOVO, SEM EIXO DUPLO, SEM HUE INVENTADA. As
     regras que os gráficos daqui seguem estão em
     docs/REGISTRO_DE_OCORRENCIAS.md e no método de dataviz: uma métrica
     por eixo, rótulos diretos, grade recessiva. */

let _raioxVisao = 'rota';
let _raioxExpandida = null;
/* Padrão: a atividade MAIS RECENTE primeiro — "as últimas placas da
   operação, da sequência mais recente" (21/08/2026). O histórico inteiro
   continua na lista, sem corte por data; a ordem é que traz o agora para
   cima. Qualquer coluna reordena com um clique. */
let _raioxOrdem = { campo: 'ultimaEm', asc: false };

const RAIOX_ETAPAS = [
  { key:'tempoAguardandoEmbarque', rotulo:'Aguardando embarque', cor:'--st-aguardando-embarque-bg' },
  { key:'tempoCarregamento',       rotulo:'Carregamento',        cor:'--st-embarque-iniciado-bg' },
  { key:'tempoFaturamento',        rotulo:'Faturamento',         cor:'--st-embarque-finalizado-bg' },
  { key:'tempoAguardandoSaida',    rotulo:'Aguardando saída',    cor:'--st-faturado-bg' },
];

function trocarVisaoRaioX(visao){
  _raioxVisao = visao;
  _raioxExpandida = null;        // detalhe aberto era de outra entidade
  renderRaioX();
}

function ordenarRaioX(campo){
  if(_raioxOrdem.campo === campo){ _raioxOrdem.asc = !_raioxOrdem.asc; }
  else { _raioxOrdem = { campo, asc: campo === 'chave' }; }
  renderRaioX();
}

function alternarDetalheRaioX(chave){
  _raioxExpandida = (_raioxExpandida === chave) ? null : chave;
  renderRaioX();
}

function rotuloEntidadeRaioX(item){
  if(_raioxVisao === 'rota') return esc(rotaCurta(item.chave));
  return esc(item.chave);
}

/* Barras horizontais de etapa em SVG — desenhadas à mão porque o painel é
   arquivo único, sem CDN, e um gráfico de 4 barras não justifica
   dependência. `mediasGeral` vira o risco de referência em cada barra. */
function barrasEtapasSvg(medias, mediasGeral){
  const dados = RAIOX_ETAPAS.map(e=>({ ...e, v: medias[e.key], g: mediasGeral[e.key] }));
  const max = Math.max(1, ...dados.map(d=>Math.max(d.v||0, d.g||0)));
  const ALT_BARRA = 16, VAO = 12, ROTULO = 148, LARG = 560, PADD = 6;
  const larguraUtil = LARG - ROTULO - 78;
  const linhas = dados.map((d, i)=>{
    const y = PADD + i * (ALT_BARRA + VAO);
    const w = d.v === null ? 0 : Math.max(2, (d.v / max) * larguraUtil);
    const gx = d.g === null ? null : ROTULO + (d.g / max) * larguraUtil;
    const cor = corTema(d.cor);
    const titulo = d.v === null
      ? `${d.rotulo}: sem medição neste recorte`
      : `${d.rotulo}: ${fmtDuracao(d.v)} neste recorte · média geral ${d.g === null ? '—' : fmtDuracao(d.g)}`;
    return `
      <g>
        <title>${esc(titulo)}</title>
        <text x="${ROTULO - 8}" y="${y + ALT_BARRA - 4}" text-anchor="end" class="etapa-rotulo">${esc(d.rotulo)}</text>
        <rect x="${ROTULO}" y="${y}" width="${larguraUtil}" height="${ALT_BARRA}" rx="4" class="etapa-trilho"/>
        ${d.v === null ? '' : `<rect x="${ROTULO}" y="${y}" width="${w}" height="${ALT_BARRA}" rx="4" fill="${cor}"/>`}
        ${gx === null ? '' : `<line x1="${gx}" y1="${y - 3}" x2="${gx}" y2="${y + ALT_BARRA + 3}" class="etapa-media-geral"><title>Média geral do recorte: ${esc(fmtDuracao(d.g))}</title></line>`}
        <text x="${ROTULO + larguraUtil + 8}" y="${y + ALT_BARRA - 4}" class="etapa-valor">${d.v === null ? '—' : esc(fmtDuracao(d.v))}</text>
      </g>`;
  }).join('');
  // +18px de respiro para a nota da legenda não encostar na última barra —
  // visto na captura de tela do teste, não em teoria.
  const altura = PADD * 2 + dados.length * (ALT_BARRA + VAO) - VAO + 18;
  return `<svg class="etapas-svg" viewBox="0 0 ${LARG} ${altura}" role="img"
      aria-label="Tempo médio por etapa, comparado com a média geral">
    ${linhas}
    <text x="${ROTULO}" y="${altura - 4}" class="etapa-nota">│ = média geral do recorte filtrado</text>
  </svg>`;
}

function detalheRaioXHtml(item, mediasGeral, colunas){
  const cargasDaEntidade = item.ids
    .map(id => getCarga(id)).filter(Boolean)
    .sort((a,b)=> new Date(b.atualizadoEm) - new Date(a.atualizadoEm));

  /* Melhor e pior ciclo: é a pergunta seguinte de quem abriu o detalhe.
     Média esconde variação — e variação é onde mora o problema operacional. */
  const comPatio = cargasDaEntidade
    .map(c => ({ c, patio: indicadoresDaCarga(c.id).tempoPatioTotal }))
    .filter(x => x.patio !== null);
  const melhor = comPatio.length ? comPatio.reduce((a,b)=> a.patio <= b.patio ? a : b) : null;
  const pior   = comPatio.length ? comPatio.reduce((a,b)=> a.patio >= b.patio ? a : b) : null;

  const LIMITE = 12;
  const recentes = cargasDaEntidade.slice(0, LIMITE);
  const linhas = recentes.map(({...c} = {}) => c).map(c => {
    const ind = indicadoresDaCarga(c.id);
    return `<tr>
      <td>${esc(c.numeroCarga) || '—'}</td>
      <td>${_raioxVisao === 'placa' ? esc(rotaCurta(c.rota)) : esc(c.placa)}</td>
      <td>${esc(String(c.programadoEm || c.criadoEm || '').slice(0,10).split('-').reverse().join('/'))}</td>
      <td class="c-peso">${c.peso ? c.peso.toLocaleString('pt-BR') : '—'}</td>
      <td class="c-peso">${fmtDuracao(ind.tempoPatioTotal)}</td>
      <td class="c-peso">${fmtDuracao(ind.leadTimeTotal)}</td>
      <td class="no-print raiox-acoes">
        <button class="btn btn-sec btn-sm" onclick="event.stopPropagation();verLinhaDoTempoDoHistoricoUI('${escJs(c.id)}')" title="Linha do tempo completa desta carga."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-historico"/></svg></button>
        <button class="btn btn-sec btn-sm" onclick="event.stopPropagation();relatorioDaCargaUI('${escJs(c.id)}')" title="PDF individual desta carga."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-relatorios"/></svg></button>
      </td>
    </tr>`;
  }).join('');

  return `<tr class="raiox-det"><td colspan="${colunas}">
    <div class="raiox-det-grid">
      <div class="raiox-det-col">
        <div class="raiox-det-tit">Onde o tempo é gasto</div>
        ${barrasEtapasSvg(item.mediasEtapas, mediasGeral)}
      </div>
      <div class="raiox-det-col">
        <div class="raiox-det-tit">Extremos do recorte</div>
        <div class="raiox-extremos">
          ${melhor ? `<div class="raiox-extremo"><span class="raiox-ext-rotulo">⚡ Ciclo mais rápido</span>
            <strong>${fmtDuracao(melhor.patio)}</strong> — carga ${esc(melhor.c.numeroCarga)||'s/nº'} · ${esc(melhor.c.placa)}</div>` : ''}
          ${pior ? `<div class="raiox-extremo"><span class="raiox-ext-rotulo">🐌 Ciclo mais lento</span>
            <strong>${fmtDuracao(pior.patio)}</strong> — carga ${esc(pior.c.numeroCarga)||'s/nº'} · ${esc(pior.c.placa)}</div>` : ''}
          ${!comPatio.length ? '<div class="text-dim">Sem ciclos completos medidos neste recorte.</div>' : ''}
        </div>
      </div>
    </div>
    <div class="raiox-det-tit" style="margin-top:10px">Cargas deste recorte ${cargasDaEntidade.length > LIMITE ? `(as ${LIMITE} mais recentes de ${cargasDaEntidade.length})` : `(${cargasDaEntidade.length})`}</div>
    <div class="table-wrap"><table class="table-raiox-cargas">
      <thead><tr><th>Nº Carga</th><th>${_raioxVisao === 'placa' ? 'Rota' : 'Placa'}</th><th>Dia</th><th>Peso (kg)</th><th title="Chegada até a saída">Pátio</th><th title="Criação da carga até Seguiu Viagem">Lead</th><th class="no-print"></th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="7" class="text-dim">Nenhuma carga carregada no painel para este recorte.</td></tr>'}</tbody>
    </table></div>
  </td></tr>`;
}

function renderRaioX(){
  const thead = document.getElementById('raiox-thead');
  const tbody = document.getElementById('raiox-tbody');
  if(!thead || !tbody) return;

  document.querySelectorAll('#raiox-seg .seg-btn').forEach(b=>{
    b.classList.toggle('seg-ativo', b.dataset.visao === _raioxVisao);
  });

  const concluidas = filtrarPorFiltroIndicadores(DB.cargas.filter(c=>c.status==='Seguiu Viagem'));
  let itens = metricasPorEntidade(_raioxVisao, concluidas);

  // A média geral do RECORTE FILTRADO — é contra ela que cada entidade se
  // compara. Média do histórico inteiro compararia agosto com a vida.
  const mediasGeral = {};
  RAIOX_ETAPAS.forEach(e=>{
    let soma = 0, n = 0;
    concluidas.forEach(c=>{
      const v = indicadoresDaCarga(c.id)[e.key];
      if(v !== null){ soma += v; n++; }
    });
    mediasGeral[e.key] = n ? Math.round(soma/n) : null;
  });

  const { campo, asc } = _raioxOrdem;
  itens = itens.slice().sort((a,b)=>{
    let va = a[campo], vb = b[campo];
    if(campo === 'chave'){ va = String(va); vb = String(vb); return asc ? va.localeCompare(vb) : vb.localeCompare(va); }
    va = va === null ? -1 : va; vb = vb === null ? -1 : vb;
    return asc ? va - vb : vb - va;
  });

  const seta = (c)=> _raioxOrdem.campo === c ? (_raioxOrdem.asc ? ' ▲' : ' ▼') : '';
  const ROTULO_VISAO = { rota:'Rota', transportadora:'Transportadora', placa:'Placa' };
  const colunas = 7;
  thead.innerHTML = `<tr>
    <th class="raiox-th" onclick="ordenarRaioX('chave')">${ROTULO_VISAO[_raioxVisao]}${seta('chave')}</th>
    <th class="raiox-th" onclick="ordenarRaioX('ultimaEm')" title="Última movimentação de qualquer carga desta linha">Última atividade${seta('ultimaEm')}</th>
    <th class="raiox-th" onclick="ordenarRaioX('cargas')" title="Cargas concluídas no recorte">Cargas${seta('cargas')}</th>
    <th class="raiox-th" onclick="ordenarRaioX('pesoTotal')">Peso total (kg)${seta('pesoTotal')}</th>
    <th class="raiox-th" onclick="ordenarRaioX('mediaPatio')" title="Chegada até a saída, média">Pátio médio${seta('mediaPatio')}</th>
    <th class="raiox-th" onclick="ordenarRaioX('mediaLead')" title="Criação da carga até Seguiu Viagem, média">Lead médio${seta('mediaLead')}</th>
    <th title="Fatia de cargas em relação à entidade líder do recorte">Volume</th>
  </tr>`;

  const maxCargas = Math.max(1, ...itens.map(i=>i.cargas));
  tbody.innerHTML = itens.map(item=>{
    const aberta = _raioxExpandida === item.chave;
    const linha = `<tr class="raiox-linha${aberta ? ' raiox-aberta' : ''}"
        onclick="alternarDetalheRaioX('${escJs(item.chave)}')"
        title="Clique para ${aberta ? 'fechar' : 'abrir'} o detalhe — etapas, extremos e as cargas individuais.">
      <td><span class="hist-seta">${aberta ? '▾' : '▸'}</span> ${rotuloEntidadeRaioX(item)}</td>
      <td class="raiox-cel-quando">${item.ultimaEm ? fmtDataHora(new Date(item.ultimaEm).toISOString()) : '—'}</td>
      <td class="c-peso">${item.cargas}</td>
      <td class="c-peso">${item.pesoTotal ? item.pesoTotal.toLocaleString('pt-BR') : '—'}</td>
      <td class="c-peso">${fmtDuracao(item.mediaPatio)}</td>
      <td class="c-peso">${fmtDuracao(item.mediaLead)}</td>
      <td class="raiox-cel-barra"><div class="raiox-barra" style="width:${Math.round((item.cargas/maxCargas)*100)}%"></div></td>
    </tr>`;
    return linha + (aberta ? detalheRaioXHtml(item, mediasGeral, colunas) : '');
  }).join('');

  document.getElementById('raiox-empty').hidden = itens.length > 0;
}

/* =====================================================================
   PULSO DO PÁTIO — heatmap de chegadas (hora × dia) + evolução diária
   =====================================================================

   As duas visões nascem do MESMO fato: a entrada no pátio registrada pela
   Portaria (entradaNoPatioDe). De propósito, o card ignora o filtro de
   período da aba — congestionamento é padrão que só aparece no acumulado,
   e um recorte de um dia mostraria uma linha solta e nenhum padrão.

   Regras de desenho (as mesmas do resto do painel):
   · magnitude = UMA cor (o dourado da casa), do claro ao escuro — nunca
     arco-íris; o número escrito é o segundo canal, cor nunca fica sozinha;
   · um eixo por gráfico — entradas e tempo médio são medidas de escalas
     diferentes, então viram DOIS gráficos empilhados dividindo o mesmo
     eixo de dias, não um gráfico de dois eixos. */
const PULSO_DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function coletarEntradasNoPatio(dias){
  const agora = Date.now();
  const inicio = agora - dias * 24 * 3600 * 1000;
  const entradas = [];
  (DB.cargas || []).forEach(c => {
    const e = entradaNoPatioDe(c);
    if(!e) return;
    const t = Date.parse(e);
    if(!Number.isFinite(t) || t < inicio || t > agora) return;
    entradas.push({ t, id: c.id });
  });
  return entradas;
}

function heatmapChegadasSvg(entradas){
  // matriz[linha Seg..Dom][hora 0..23] — getDay() dá 0=Domingo, e a semana
  // de trabalho começa na segunda, então o domingo vai para a última linha.
  const LINHA_DO_GETDAY = [6, 0, 1, 2, 3, 4, 5];
  const m = PULSO_DIAS_SEMANA.map(() => new Array(24).fill(0));
  entradas.forEach(({ t }) => {
    const d = new Date(t);
    m[LINHA_DO_GETDAY[d.getDay()]][d.getHours()]++;
  });
  const max = Math.max(1, ...m.flat());

  const CEL = 26, ALT = 21, GAP = 3, ROTULO = 36, TOPO = 16;
  const W = ROTULO + 24 * (CEL + GAP);
  const H = TOPO + 7 * (ALT + GAP);
  const celulas = [];
  m.forEach((linha, li) => {
    const y = TOPO + li * (ALT + GAP);
    celulas.push(`<text x="${ROTULO - 6}" y="${y + ALT / 2 + 3.5}" text-anchor="end"
      font-size="10" fill="var(--text-dim)">${PULSO_DIAS_SEMANA[li]}</text>`);
    linha.forEach((n, hora) => {
      const x = ROTULO + hora * (CEL + GAP);
      const frac = n / max;
      // 0 chegadas: célula fantasma (contorno leve), pra grade continuar
      // legível sem parecer que "0" é um dado dourado fraquinho.
      const caixa = n === 0
        ? `<rect x="${x}" y="${y}" width="${CEL}" height="${ALT}" rx="3" fill="var(--vidro-brilho)" opacity="0.35"/>`
        : `<rect x="${x}" y="${y}" width="${CEL}" height="${ALT}" rx="3" fill="var(--gold)" opacity="${(0.18 + 0.82 * frac).toFixed(2)}"/>`;
      const texto = n === 0 ? '' : `<text x="${x + CEL / 2}" y="${y + ALT / 2 + 3.5}"
        text-anchor="middle" font-size="10" font-weight="700"
        fill="${frac >= 0.55 ? '#161d2c' : 'var(--text-dim)'}">${n}</text>`;
      celulas.push(`<g>${caixa}${texto}
        <title>${PULSO_DIAS_SEMANA[li]} ${String(hora).padStart(2, '0')}h — ${n} chegada(s)</title></g>`);
    });
  });
  const horas = [];
  for(let h = 0; h < 24; h += 3){
    horas.push(`<text x="${ROTULO + h * (CEL + GAP) + CEL / 2}" y="11" text-anchor="middle"
      font-size="10" fill="var(--text-dim)">${h}h</text>`);
  }
  return { max, svg: `<svg class="heatmap-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    role="img" aria-label="Chegadas ao pátio por hora e dia da semana, últimos 30 dias">
    ${horas.join('')}${celulas.join('')}</svg>` };
}

function evolucaoPatioSvg(entradas){
  // Últimos 14 dias, do mais antigo para o mais novo. Cada dia soma as
  // chegadas e a média do tempo total de pátio das cargas que ENTRARAM
  // naquele dia e já concluíram o ciclo.
  const DIAS = 14;
  const chaves = [];
  for(let i = DIAS - 1; i >= 0; i--){
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    chaves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const porDia = new Map(chaves.map(k => [k, { n: 0, somaPatio: 0, nPatio: 0 }]));
  entradas.forEach(({ t, id }) => {
    const d = new Date(t);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const b = porDia.get(k);
    if(!b) return;
    b.n++;
    const patio = indicadoresDaCarga(id).tempoPatioTotal;
    if(patio !== null){ b.somaPatio += patio; b.nPatio++; }
  });
  const dados = chaves.map(k => {
    const b = porDia.get(k);
    return { k, n: b.n, media: b.nPatio ? Math.round(b.somaPatio / b.nPatio) : null };
  });

  const BARRA = 30, GAP = 8, ROTULO = 8, TOPO = 18, PAINEL = 74, ENTRE = 40, BASE = 18;
  const W = ROTULO + DIAS * (BARRA + GAP);
  const H = TOPO + PAINEL + ENTRE + PAINEL + BASE;
  const maxN = Math.max(1, ...dados.map(d => d.n));
  const maxMedia = Math.max(1, ...dados.map(d => d.media || 0));
  const y2Topo = TOPO + PAINEL + ENTRE;
  const partes = [];
  partes.push(`<text x="${ROTULO}" y="${TOPO - 7}" font-size="10" font-weight="800"
    fill="var(--text-dim)">ENTRADAS NO PÁTIO</text>`);
  partes.push(`<text x="${ROTULO}" y="${y2Topo - 7}" font-size="10" font-weight="800"
    fill="var(--text-dim)">TEMPO MÉDIO DE PÁTIO</text>`);
  dados.forEach((d, i) => {
    const x = ROTULO + i * (BARRA + GAP);
    const [ano, mes, dia] = d.k.split('-');
    // Painel 1 — entradas (contagem).
    const h1 = Math.round((d.n / maxN) * (PAINEL - 14));
    if(d.n > 0){
      partes.push(`<rect x="${x}" y="${TOPO + (PAINEL - h1)}" width="${BARRA}" height="${h1}"
        rx="3" fill="var(--gold)"/>`);
      partes.push(`<text x="${x + BARRA / 2}" y="${TOPO + (PAINEL - h1) - 3}" text-anchor="middle"
        font-size="10" font-weight="700" fill="var(--text-dim)">${d.n}</text>`);
    }else{
      partes.push(`<rect x="${x}" y="${TOPO + PAINEL - 2}" width="${BARRA}" height="2"
        rx="1" fill="var(--vidro-brilho)"/>`);
    }
    // Painel 2 — tempo médio (minutos). Sem carga concluída, sem barra —
    // um zero aqui mentiria (não é "pátio zerado", é "ainda sem medição").
    if(d.media !== null){
      const h2 = Math.max(3, Math.round((d.media / maxMedia) * (PAINEL - 14)));
      partes.push(`<rect x="${x}" y="${y2Topo + (PAINEL - h2)}" width="${BARRA}" height="${h2}"
        rx="3" fill="var(--gold)" opacity="0.62"/>`);
      partes.push(`<text x="${x + BARRA / 2}" y="${y2Topo + (PAINEL - h2) - 3}" text-anchor="middle"
        font-size="9.5" font-weight="700" fill="var(--text-dim)">${fmtDuracao(d.media)}</text>`);
    }
    partes.push(`<text x="${x + BARRA / 2}" y="${H - 5}" text-anchor="middle"
      font-size="9.5" fill="var(--text-dim)">${dia}/${mes}</text>`);
    partes.push(`<g><rect x="${x}" y="0" width="${BARRA + GAP}" height="${H}" fill="transparent">
      </rect><title>${dia}/${mes}/${ano} — ${d.n} entrada(s)${d.media !== null ? ' · pátio médio ' + fmtDuracao(d.media) : ''}</title></g>`);
  });
  return `<svg class="evolucao-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    role="img" aria-label="Entradas no pátio e tempo médio por dia, últimos 14 dias">${partes.join('')}</svg>`;
}

function renderPulsoDoPatio(){
  const heatEl = document.getElementById('pulso-heatmap');
  const evoEl = document.getElementById('pulso-evolucao');
  const vazioEl = document.getElementById('pulso-empty');
  if(!heatEl || !evoEl) return;
  const entradas = coletarEntradasNoPatio(30);
  const grade = document.querySelector('.pulso-grid');
  if(!entradas.length){
    if(grade) grade.hidden = true;
    if(vazioEl) vazioEl.hidden = false;
    return;
  }
  if(grade) grade.hidden = false;
  if(vazioEl) vazioEl.hidden = true;
  const { svg, max } = heatmapChegadasSvg(entradas);
  heatEl.innerHTML = svg;
  const leg = document.getElementById('pulso-heatmap-legenda');
  if(leg){
    leg.innerHTML = 'menos '
      + [0.18, 0.45, 0.7, 1].map(o => `<span class="grau" style="background:var(--gold);opacity:${o}"></span>`).join('')
      + ` mais — pico: ${max} chegada(s) num mesmo horário`;
  }
  evoEl.innerHTML = evolucaoPatioSvg(entradas);
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

  /* SÉRIE DIÁRIA DOS TEMPOS (23/08/2026) — formato BI nos indicadores.

     Bucket por dia, montado DENTRO da passada que já existia. O custo
     extra é uma soma por carga; refazer o laço só para ter a série
     dobraria o tempo da aba em bases grandes, e indicadoresDaCarga é a
     parte cara.

     14 buckets: os 7 primeiros são a semana anterior, os 7 últimos a
     semana corrente — é dessa divisão que sai a variação mostrada. Média
     por dia, não soma: soma sobe só porque saiu mais caminhão. */
  const DIAS_SERIE = 14;
  const inicioSerie = new Date(); inicioSerie.setHours(0,0,0,0);
  inicioSerie.setDate(inicioSerie.getDate() - (DIAS_SERIE - 1));
  const t0Serie = inicioSerie.getTime();
  const balde = {};
  campos.concat('leadTimeTotal').forEach(f=>{
    balde[f] = { soma:new Array(DIAS_SERIE).fill(0), n:new Array(DIAS_SERIE).fill(0) };
  });
  const diaDaCarga = (c) => {
    const q = primeiroTimestamp(c.id, 'Seguiu Viagem') || c.concluidoEm || c.atualizadoEm;
    if(!q) return -1;
    const i = Math.floor((new Date(q).getTime() - t0Serie) / 86400000);
    return (i >= 0 && i < DIAS_SERIE) ? i : -1;
  };

  concluidas.forEach(c=>{
    const ind = indicadoresDaCarga(c.id);
    campos.forEach(f=>{ if(ind[f]!==null){ somas[f]+=ind[f]; contagens[f]++; } });
    if(ind.leadTimeTotal!==null){ somaLead+=ind.leadTimeTotal; nLead++; }
    const d = diaDaCarga(c);
    if(d < 0) return;
    campos.concat('leadTimeTotal').forEach(f=>{
      if(ind[f]!==null && ind[f]!==undefined){ balde[f].soma[d]+=ind[f]; balde[f].n[d]++; }
    });
  });

  /* Média de cada dia, e a média de cada metade da janela. Dia sem carga
     concluída fica FORA da conta em vez de virar zero — zero ali diria
     "carregamos em 0 minutos", que é o oposto de "não carregamos". */
  const serieDe = (f) => balde[f].soma.map((sm,i)=> balde[f].n[i] ? sm/balde[f].n[i] : null);
  const mediaFatia = (serie, ini, fim) => {
    const v = serie.slice(ini, fim).filter(x=>x!==null);
    return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
  };

  const caixaTempo = (f, rotulo, nota='') => {
    const media = f === 'leadTimeTotal'
      ? (nLead ? Math.round(somaLead/nLead) : null)
      : (contagens[f] ? Math.round(somas[f]/contagens[f]) : null);
    const serie = serieDe(f);
    const semana  = mediaFatia(serie, 7, 14);
    const anterior = mediaFatia(serie, 0, 7);
    /* Tempo é indicador onde SUBIR é piorar — sempre. Por isso
       pioraQuandoSobe fica fixo aqui, diferente da faixa da Torre. */
    const delta = (semana !== null && anterior !== null)
      ? deltaHtml(Math.round(semana), Math.round(anterior),
                  {pioraQuandoSobe:true, percentual:true, igual:'estável na semana'})
      : '';
    const dica = (semana !== null && anterior !== null)
      ? `Média dos últimos 7 dias (${fmtDuracao(Math.round(semana))}) contra os 7 anteriores `
        + `(${fmtDuracao(Math.round(anterior))}). O traço é a média de cada dia; `
        + `dia sem carga concluída não entra na conta.`
      : 'Ainda sem dois períodos completos para comparar.';
    const linha = sparklineSvg(
      serie.filter(x=>x!==null),
      corTema(semana !== null && anterior !== null && semana > anterior
              ? '--st-aguardando-veiculo-txt' : '--st-faturado-txt'));
    return `<div class="stat-box" title="${esc(dica)}">
       <div class="stat-num">${fmtDuracao(media)}</div>
       <div class="stat-label">${esc(rotulo)}</div>
       ${delta}
       ${nota ? `<div class="stat-note">${esc(nota)}</div>` : ''}
       ${linha}
     </div>`;
  };

  let html = campos.map(f=>caixaTempo(f, labels[f])).join('');
  html += caixaTempo('leadTimeTotal', 'Lead Time Total', 'criação da carga → Seguiu Viagem');
  document.getElementById('ind-stats').innerHTML = html;

  renderRaioX();
  renderPulsoDoPatio();
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
      ${celFiltro('transportadora', r.transportadora)}
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
function renderGraficosIndicadores(){
  const canvasBarras = document.getElementById('grafico-barras');
  if(!canvasBarras) return; // aba ainda não renderizada

  /* UM FILTRO SÓ (28/08/2026). Estes três gráficos tinham filtros próprios e
     ignoravam o do topo da aba: filtrar uma transportadora lá em cima não
     mudava um pixel aqui — medido, 3.321/1.057/15.590 antes e depois. Agora
     leem de FILTRO_IND, o mesmo que move os cartões e as tabelas.

     `setor` não existe mais como filtro: ele só afetava um dos três gráficos
     e não tinha equivalente no filtro de cima. Filtro que muda um terço da
     tela e cala nos outros dois terços ensina a desconfiar do painel. */
  // O objeto do filtro vai INTEIRO. Montar um objeto novo aqui era o
  // caminho para esquecer uma chave e ter gráfico obedecendo metade do
  // filtro — pior que não obedecer, porque parece que funcionou.
  const filtros = FILTRO_IND;
  const periodo = FILTRO_IND.periodo || 'mes';

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
async function addRotaUI(){
  const codigo = document.getElementById('rota-codigo').value.trim();
  const nome = document.getElementById('rota-nome').value.trim();
  if(!codigo){ notify('Informe o código da rota.', 'warn'); return; }
  if(!nome){ notify('Informe o nome da rota.', 'warn'); return; }
  const jaExistia = !!rotaInfo(codigo);
  const rotaCriada = upsertRota(codigo, nome, document.getElementById('rota-detalhe').value,
             document.getElementById('rota-operador').value);
  ['rota-codigo','rota-nome','rota-detalhe','rota-operador'].forEach(id=>document.getElementById(id).value='');
  preencherSelectsRota();   // dropdowns de Rota atualizados na hora
  /* notifyGravacao, não notify('success') — incidente de 14/08/2026: o
     gestor cadastrou a rota 537, viu "cadastrada" em verde, e ela não
     apareceu para o programador nem depois de sair e entrar de novo.

     A sincronização estava certa (reproduzido: quem loga do zero recebe a
     rota do servidor). O que enganava era o aviso: cadastrando sem
     conexão, a rota vai só para o localStorage e para a fila, e mesmo
     assim a tela dizia "cadastrada. Já aparece no seletor de Rota" — em
     verde, com cara de compartilhado. Quem cadastra vê a rota (verdade
     local) e conclui que está feito para todos.

     É exatamente o padrão do incidente das cargas, corrigido lá e que
     tinha ficado de fora aqui. Agora o aviso conta o estado real: verde só
     quando subiu; amarelo "SEM CONEXÃO … os outros setores ainda NÃO
     veem" quando ficou na fila. A recusa do servidor já tinha aviso
     próprio (receberRecusaDeRota) e continua valendo. */
  /* O AVISO ESPERA O SERVIDOR (31/08/2026).

     Ele era otimista: dizia "Rota X cadastrada" no mesmo instante do clique,
     e só depois — quando a resposta chegava — vinha o "NÃO foi cadastrada".
     Duas frases contrárias na mesma tela, e a pessoa lê a primeira.

     É o incidente da rota 537 (14/08) voltando por outra porta: naquele dia
     o problema era o verde prometendo compartilhamento que não existia.
     Agora não existe nem gravação: com a regra do dono, offline não grava.
     Então o aviso de sucesso só pode sair depois de o servidor confirmar —
     quem avisa o contrário é `receberRecusaDeRota`, que já tem frase própria
     para cada caso. */
  /* ESPERA A RESPOSTA ANTES DE DIZER QUE CADASTROU.

     Olhar o estado da conexão não bastava: no instante do clique ele ainda
     diz "online", porque só vira offline quando alguma requisição falha. O
     que decide é a resposta desta gravação, não o estado de antes dela. */
  const r = await (rotaCriada && rotaCriada._promessa
    ? rotaCriada._promessa.catch(() => ({ recusado: true }))
    : Promise.resolve(null));
  if(r && r.recusado){
    // receberRecusaDeRota já falou — e com a frase certa para cada caso.
    renderAll();
    return;
  }
  notifyGravacao(jaExistia
    ? `Rota ${codigo} atualizada.`
    : `Rota ${codigo} — ${nome} cadastrada.`);
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
     Torre/Indicadores. Mesmo limiar que ativa o cartão — perguntado a
     ehTelaEstreita(), para não haver dois números para a mesma decisão. */
  const LIMITE = ehTelaEstreita() ? 30 : 300;

  /* NO CELULAR A FROTA COMEÇA FECHADA, E A BUSCA É A PORTA (27/08/2026).

     Pedido do dono sobre o celular: "tem que rolar muito até chegar na
     parte que é interessante ver". Medido em 390px: a aba Cadastros tinha
     8.822px de rolagem — 10,5 telas — e a Frota sozinha era 7.465px
     disso, 85% da aba. Trinta cartões de veículo que ninguém lê.

     Quem abre a Frota no celular quer UM caminhão, e já sabe a placa. A
     lista completa não é resposta para essa pergunta; é o obstáculo até
     ela. Então sem busca não sai lista: sai o total e o convite para
     digitar. Com busca, sai o que casa, com o mesmo limite de sempre.

     No computador nada muda — lá a tabela cabe e serve para varrer.

     O filtro "só quem precisa de revisão" continua mostrando lista sem
     busca: ali a pergunta É a lista, e ela é curta. */
  const semBuscaNoCelular = ehTelaEstreita() && !buscaTexto && !soRevisao;
  const exibidos = semBuscaNoCelular ? [] : lista.slice(0, LIMITE);
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
    contagemEl.textContent = semBuscaNoCelular
      ? `${todos.length} placa(s) cadastrada(s). Digite a placa ou a transportadora acima para ver.`
      : (lista.length > LIMITE
        ? `Mostrando ${LIMITE} de ${lista.length} (de ${todos.length} no total) — refine a busca pra ver outras.`
        : `${lista.length} de ${todos.length} placa(s) cadastrada(s).`);
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
  /* Placas da Frota para o campo de placa da Montagem. A sugestão mostra a
     transportadora junto: quem monta o dia reconhece o caminhão pela
     empresa, não pelas sete letras. */
  const dlPlacas = document.getElementById('lista-placas-frota');
  if(dlPlacas){
    dlPlacas.innerHTML = (DB.frota || []).map(f =>
      `<option value="${esc(f.placa)}">${esc(f.transportadora || '')}${f.tipoVeiculo ? ' · ' + esc(f.tipoVeiculo) : ''}</option>`).join('');
  }
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
    ['Qtd. Entregas', c.qtdEntregas ?? 1],
    // Lacres (18/08/2026): só aparecem quando existem — carga que nunca
    // saiu não precisa de duas linhas em branco na ficha.
    ...(lacresDaCarga(c).numeros.length
      ? [[lacresDaCarga(c).numeros.length > 1 ? 'Lacres da saída' : 'Lacre da saída',
          lacresDaCarga(c).numeros.join(' · ')]] : []),
    ...(c.lacreRetido ? [['Lacre retido', c.lacreRetido
        + (c.lacreRetidoMotivo ? ` — ${c.lacreRetidoMotivo}` : '')
        + (c.lacreRetidoPor ? ` (${c.lacreRetidoPor}` + (c.lacreRetidoEm ? `, ${fmtDataHora(c.lacreRetidoEm)}` : '') + ')' : '')]] : [])
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
      ${painelAdminDaCargaHtml(c)}
    </div>
  `;
}

/* Painel de correção da Administração, dentro da ficha da carga.

   Pedido de 19/08/2026: "quero conseguir voltar em qualquer etapa pelo
   painel de administrador, no painel histórico". Duas correções vivem aqui,
   e as duas exigem motivo — o motivo é o que separa correção de rasura:

     · voltar/corrigir a ETAPA (a máquina de estados segue de sentido único
       para quem opera; aqui é a saída para o clique errado);
     · corrigir a DATA DE PROGRAMAÇÃO (a carga que caiu no dia errado).

   As duas passam pelo servidor e deixam trilha no histórico da carga: quem
   corrigiu, de quando para quando e por quê. */
function painelAdminDaCargaHtml(c){
  if((DB.operador||{}).setor !== 'Administração') return '';
  const dia = String(c.programadoEm || c.criadoEm || '').slice(0,10);
  return `
    <div class="admin-carga no-print">
      <div class="admin-carga-tit">🛠 Correções da Administração</div>
      <div class="admin-carga-sub">Toda correção aqui pede motivo e fica registrada no histórico da carga,
        com o seu nome. Vale para todos os setores na hora.</div>

      <div class="admin-carga-linha">
        <label>Etapa</label>
        <select id="adm-etapa-${esc(c.id)}">
          ${STATUS_FLOW.map(st=>`<option value="${esc(st)}" ${st===c.status?'selected':''}>${esc(st)}</option>`).join('')}
        </select>
        <input type="text" id="adm-etapa-motivo-${esc(c.id)}" placeholder="Motivo da correção de etapa">
        <button class="btn btn-sec btn-sm" onclick="corrigirEtapaCargaUI('${escJs(c.id)}')">↩ Aplicar etapa</button>
      </div>

      <div class="admin-carga-linha">
        <label>Data da programação</label>
        <input type="date" id="adm-data-${esc(c.id)}" value="${esc(dia)}">
        <input type="text" id="adm-data-motivo-${esc(c.id)}" placeholder="Motivo da correção de data">
        <button class="btn btn-sec btn-sm" onclick="corrigirDataProgramacaoUI('${escJs(c.id)}')">📅 Aplicar data</button>
      </div>
    </div>`;
}

async function corrigirEtapaCargaUI(id){
  const c = getCarga(id);
  const status = (document.getElementById('adm-etapa-' + id)||{}).value;
  const motivo = ((document.getElementById('adm-etapa-motivo-' + id)||{}).value||'').trim();
  if(!c || !status) return;
  if(status === c.status){ notify('A carga já está nessa etapa.','warn'); return; }
  if(!motivo){ notify('Escreva o motivo da correção de etapa.','warn'); return; }
  const voltando = STATUS_FLOW.indexOf(status) < STATUS_FLOW.indexOf(c.status);
  if(!confirm(`${voltando ? 'VOLTAR' : 'Avançar'} a carga ${c.numeroCarga || c.placa} de "${c.status}" para "${status}"?\n\n`
    + 'Isso muda o andamento para todos os setores e fica registrado no histórico.')) return;
  try{
    await SuincoSharePoint.corrigirEtapa(id, status, motivo);
    await SuincoSharePoint.sincronizarAgora();
    notifyGravacao(`Etapa corrigida: ${c.status} → ${status}.`);
    renderAll();
    renderTimelineCarga(id);
  }catch(e){
    notify('Não consegui corrigir a etapa: ' + (e.message||'erro'), 'danger', 9000);
  }
}

async function corrigirDataProgramacaoUI(id){
  const c = getCarga(id);
  const data = (document.getElementById('adm-data-' + id)||{}).value;
  const motivo = ((document.getElementById('adm-data-motivo-' + id)||{}).value||'').trim();
  if(!c || !data) return;
  if(!motivo){ notify('Escreva o motivo da correção de data.','warn'); return; }
  try{
    await SuincoSharePoint.corrigirDataProgramacao(id, data, motivo);
    await SuincoSharePoint.sincronizarAgora();
    notifyGravacao(`Data de programação corrigida para ${data.split('-').reverse().join('/')}.`);
    renderAll();
    renderTimelineCarga(id);
  }catch(e){
    notify('Não consegui corrigir a data: ' + (e.message||'erro'), 'danger', 9000);
  }
}

/* Cargas excluídas — a tela que faltava para o "devolver" ter onde ser
   clicado (19/08/2026).

   A leitura do painel filtra as excluídas de propósito: o pátio é o que
   está em operação. O efeito colateral era que uma carga excluída por
   engano ficava sem tela nenhuma, e a única saída era o banco. Aqui a
   Administração busca (opcionalmente por placa), vê o que foi excluído e
   devolve com motivo. */
/* =====================================================================
   HISTÓRICO DA PROGRAMAÇÃO — "a programação do dia X como ela foi feita"
   =====================================================================

   Pedido do gestor (21/08/2026): "quero que haja um histórico da
   programação também, para controle das cargas que foram programadas".

   O nome disso em logística é ADERÊNCIA À PROGRAMAÇÃO: do que foi
   prometido para o dia, quanto de fato seguiu viagem. A consulta vem de
   rota própria porque precisa das cargas CANCELADAS — que o estado do
   painel esconde de propósito — e cancelada é justamente o que o controle
   mais quer enxergar. */
let _progDia = null; // { dia, cargas } da última consulta — alimenta o PDF

function dataHoraBR(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
}

function desfechoDaCarga(c){
  if(c.excluida){
    const quem = c.excluidaPor ? ` por ${c.excluidaPor}` : '';
    const quando = c.excluidaEm ? ` em ${dataHoraBR(c.excluidaEm)}` : '';
    return { classe:'progdia-cancelada', rotulo:`Cancelada${quem}${quando}` };
  }
  if(c.status === 'Seguiu Viagem'){
    const quando = c.acaoEm ? ` · ${dataHoraBR(c.acaoEm)}` : '';
    return { classe:'progdia-concluida', rotulo:`Seguiu Viagem${quando}` };
  }
  return { classe:'progdia-aberta', rotulo:`Em aberto — ${c.status}` };
}

function resumoProgramacaoHtml(cargas){
  const canceladas = cargas.filter(c=>c.excluida).length;
  const concluidas = cargas.filter(c=>!c.excluida && c.status==='Seguiu Viagem').length;
  const abertas = cargas.length - canceladas - concluidas;
  // Aderência sobre o PROGRAMADO (inclui canceladas no denominador): a
  // promessa foi feita; cancelar é um jeito de não cumpri-la, não de
  // apagá-la da conta.
  const pct = cargas.length ? Math.round(100*concluidas/cargas.length) : 0;
  return `
    <div class="progdia-resumo">
      <div class="stat-box"><div class="stat-num">${cargas.length}</div><div class="stat-label">Programadas</div></div>
      <div class="stat-box"><div class="stat-num">${concluidas}</div><div class="stat-label">Seguiram viagem</div></div>
      <div class="stat-box"><div class="stat-num">${canceladas}</div><div class="stat-label">Canceladas</div></div>
      <div class="stat-box"><div class="stat-num">${abertas}</div><div class="stat-label">Em aberto</div></div>
      <div class="stat-box"><div class="stat-num">${pct}%</div><div class="stat-label">Aderência</div>
        <div class="stat-note">seguiram viagem ÷ programadas</div></div>
    </div>`;
}

function tabelaProgramacaoHtml(cargas, paraPdf){
  return `
    <div class="table-wrap">
      <table class="tabela-patio tabela-progdia">
        <thead><tr>
          <th>Nº Carga</th><th>Placa</th><th>Rota</th><th>Cliente</th>
          <th>Peso (kg)</th><th>Programada por</th><th>Desfecho</th>
        </tr></thead>
        <tbody>${cargas.map(c=>{
          const d = desfechoDaCarga(c);
          const linha = `<tr class="${d.classe}${paraPdf ? '' : ' progdia-linha'}"
            ${paraPdf ? '' : `onclick="alternarLogProgramacaoUI('${escJs(c.id)}')"
              title="Clique para ver o log de alterações desta carga."`}>
            <td>${esc(c.numeroCarga||'—')}</td>
            <td><strong>${esc(c.placa)}</strong></td>
            <td>${esc(rotaCurta(c.rota)||'—')}</td>
            <td>${esc(c.cliente||'—')}</td>
            <td>${c.peso ? Number(c.peso).toLocaleString('pt-BR') : '—'}</td>
            <td>${esc(c.criadoPor||'—')}${c.criadoEm ? ` · ${dataHoraBR(c.criadoEm)}` : ''}</td>
            <td class="progdia-desfecho">${esc(d.rotulo)}</td>
          </tr>`;
          const log = paraPdf ? '' : `<tr class="progdia-log" id="progdia-log-${esc(c.id)}" hidden>
            <td colspan="7"></td></tr>`;
          return linha + log;
        }).join('')}</tbody>
      </table>
    </div>`;
}

/* O LOG DE CADA CARGA PROGRAMADA — "salvando logs de toda atualização do
   programador, alteração" (o complemento do pedido).

   O banco JÁ guarda cada mudança real (carga_revisoes, por trigger — até
   SQL manual entra). O que faltava era mostrar como LOG: cada revisão é o
   estado ANTES da mudança, então a alteração nº k transforma a revisão k
   na revisão k+1 — e a última desemboca na carga atual. O diff entre
   vizinhos, campo a campo, é exatamente "quem mudou o quê". */
const CAMPOS_LOG_PROG = [
  ['numeroCarga','Nº da carga'], ['placa','Placa'], ['rota','Rota'],
  ['cliente','Cliente'], ['destino','Destino'], ['peso','Peso (kg)'],
  ['sequencia','Sequência'], ['qtdEntregas','Entregas'], ['paletizada','Paletizada'],
  ['doca','Doca'], ['motorista','Motorista'], ['observacoes','Observações'],
  ['status','Status'],
];

function mudancasEntre(antes, depois){
  const m = [];
  CAMPOS_LOG_PROG.forEach(([k, rotulo])=>{
    const a = antes ? antes[k] : undefined;
    const b = depois ? depois[k] : undefined;
    if(String(a ?? '') !== String(b ?? '')){
      m.push(`${rotulo}: ${esc(String(a ?? '') || '—')} → ${esc(String(b ?? '') || '—')}`);
    }
  });
  return m;
}

function logDaCargaHtml(c, revs){
  // revs vem DESC do servidor; a linha do tempo lê melhor em ordem ASC e
  // se apresenta DESC (mais recente no topo), como todo log do painel.
  const asc = revs.slice().reverse();
  const eventos = [];
  for(let i = 0; i < asc.length; i++){
    const estadoDepois = (i + 1 < asc.length) ? asc[i + 1].carga : c;
    const mudancas = mudancasEntre(asc[i].carga, estadoDepois);
    if(!mudancas.length) continue; // eco sem mudança visível nos campos acompanhados
    eventos.push(`<div class="progdia-log-item">
      <div class="progdia-log-cab"><strong>${esc(dataHoraBR(asc[i].gravadaEm))}</strong>
        · ${esc(asc[i].mudadaPor || '—')}${asc[i].mudadaSetor ? ' (' + esc(asc[i].mudadaSetor) + ')' : ''}</div>
      <div class="progdia-log-mudancas">${mudancas.join('<br>')}</div>
    </div>`);
  }
  eventos.push(`<div class="progdia-log-item">
    <div class="progdia-log-cab"><strong>${esc(dataHoraBR(c.criadoEm))}</strong>
      · ${esc(c.criadoPor || '—')}</div>
    <div class="progdia-log-mudancas">Carga programada.</div>
  </div>`);
  return `<div class="progdia-log-caixa">${eventos.reverse().join('')}</div>`;
}

async function alternarLogProgramacaoUI(cargaId){
  const linha = document.getElementById(`progdia-log-${cargaId}`);
  if(!linha || !_progDia) return;
  if(!linha.hidden){ linha.hidden = true; return; }
  const c = _progDia.cargas.find(x=>x.id === cargaId);
  if(!c) return;
  const celula = linha.querySelector('td');
  linha.hidden = false;
  celula.innerHTML = '<div class="card-sub">Buscando o log no servidor…</div>';
  try{
    const revs = await SuincoSharePoint.listarRevisoes(cargaId);
    celula.innerHTML = logDaCargaHtml(c, revs || []);
  }catch(e){
    celula.innerHTML = `<div class="card-sub">Não consegui buscar o log: ${esc(e.message||'erro')}</div>`;
  }
}

/* Quem pode ver o controle. A mesma regra vale na tela (o rodapé nem
   aparece para os outros setores) e no servidor (a rota recusa) — tela
   escondida sem trava de servidor é cortina, não porta. */
function podeVerControleProgramacao(){
  const setor = (DB.operador || {}).setor;
  return setor === 'Logística' || setor === 'Administração';
}

function renderRodapeControleProgramacao(){
  const rodape = document.getElementById('progdia-rodape');
  const card = document.getElementById('card-programacao-dia');
  if(!rodape) return;
  const pode = podeVerControleProgramacao();
  rodape.hidden = !pode;
  if(!pode && card) card.hidden = true;
}

function alternarControleProgramacaoUI(){
  if(!podeVerControleProgramacao()) return;
  const card = document.getElementById('card-programacao-dia');
  if(!card) return;
  card.hidden = !card.hidden;
  if(!card.hidden){
    carregarProgramacaoDoDiaUI();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function carregarProgramacaoDoDiaUI(){
  if(!podeVerControleProgramacao()) return;
  const alvoResumo = document.getElementById('progdia-resumo');
  const alvoLista = document.getElementById('progdia-lista');
  const botaoPdf = document.getElementById('progdia-pdf');
  if(!alvoResumo || !alvoLista) return;
  const campo = document.getElementById('progdia-data');
  if(campo && !campo.value){
    // Dia LOCAL, nunca toISOString() (que é UTC e vira ontem depois das 21h
    // em Patos de Minas) — mesma lição de filtroRelatorioAtalho.
    const h = new Date();
    campo.value = `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
  }
  const dia = campo ? campo.value : '';
  if(!dia) return;

  _progDia = null;
  if(botaoPdf) botaoPdf.hidden = true;
  alvoResumo.innerHTML = '';
  alvoLista.innerHTML = '<div class="card-sub">Consultando…</div>';
  let cargas;
  try{
    cargas = await SuincoSharePoint.programacaoDoDia(dia);
  }catch(e){
    // Painel novo + servidor antigo: a rota ainda não existe lá. Dizer
    // exatamente isso vale mais que um "erro 404" solto.
    const semRota = /404|não encontrada|not found/i.test(String(e && e.message || ''));
    alvoLista.innerHTML = `<div class="card-sub">${semRota
      ? 'O servidor ainda não conhece esta consulta — falta rodar a atualização do servidor (atualizar.sh). O painel já está pronto.'
      : 'Não consegui consultar: ' + esc(e.message||'erro')}</div>`;
    return;
  }
  if(!cargas.length){
    alvoLista.innerHTML = `<div class="card-sub">Nenhuma carga foi programada para ${esc(fmtData(dia))}.</div>`;
    return;
  }
  _progDia = { dia, cargas };
  if(botaoPdf) botaoPdf.hidden = false;
  alvoResumo.innerHTML = resumoProgramacaoHtml(cargas);
  alvoLista.innerHTML = tabelaProgramacaoHtml(cargas, false);
}

async function pdfProgramacaoDoDiaUI(){
  if(!_progDia || !_progDia.cargas.length){
    notify('Consulte um dia com cargas antes de gerar o PDF.', 'warn');
    return;
  }
  const el = document.getElementById('print-programacao');
  if(!el) return;
  const { dia, cargas } = _progDia;
  el.innerHTML = `
    <div class="print-page doc-amplo">
      ${cabecalhoDocumento({
        titulo: `Programação de ${fmtData(dia)} — controle`,
        subtitulo: 'Tudo que foi programado para o dia, incluindo canceladas, com autoria e desfecho',
      })}
      ${resumoProgramacaoHtml(cargas)}
      ${tabelaProgramacaoHtml(cargas, true)}
      ${rodapeDocumento(
        'A aderência conta as canceladas no total de propósito: a programação foi feita; '
        + 'cancelar é um desfecho, não um apagador. Carga "em aberto" ainda estava no pátio '
        + 'na hora em que este documento foi gerado.', '', '')}
    </div>`;
  await exportarViaServidor(el, `Programacao-${dia}`, 'programacao-do-dia');
}

async function carregarCargasExcluidasUI(){
  const alvo = document.getElementById('exc-lista');
  if(!alvo) return;
  if((DB.operador||{}).setor !== 'Administração'){
    alvo.innerHTML = '<div class="card-sub">Só a Administração vê as cargas excluídas.</div>';
    return;
  }
  const placa = ((document.getElementById('exc-placa')||{}).value||'').trim();
  alvo.innerHTML = '<div class="card-sub">Buscando…</div>';
  let lista;
  try{
    lista = await SuincoSharePoint.listarExcluidas(placa);
  }catch(e){
    alvo.innerHTML = `<div class="card-sub">Não consegui buscar: ${esc(e.message||'erro')}</div>`;
    return;
  }
  if(!lista.length){
    alvo.innerHTML = '<div class="card-sub">Nenhuma carga excluída'
      + (placa ? ` para a placa ${esc(normalizarPlaca(placa))}` : '') + '.</div>';
    return;
  }
  alvo.innerHTML = `
    <div class="table-wrap">
      <table class="tabela-patio">
        <thead><tr>
          <th>Placa</th><th>Nº Carga</th><th>Status quando saiu</th>
          <th>Cliente</th><th>Destino</th><th>Programada</th><th class="no-print"></th>
        </tr></thead>
        <tbody>${lista.map(c=>`
          <tr>
            <td><strong>${esc(c.placa)}</strong></td>
            <td>${esc(c.numeroCarga||'—')}</td>
            <td>${badgeHtml(c.status)}</td>
            <td>${esc(c.cliente||'—')}</td>
            <td>${esc(c.destino||'—')}</td>
            <td>${esc(String(c.programadoEm||c.criadoEm||'').slice(0,10).split('-').reverse().join('/'))}</td>
            <td class="no-print"><button class="btn btn-sec btn-sm"
              onclick="devolverCargaExcluidaUI('${escJs(c.id)}')">↩ Devolver</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

async function devolverCargaExcluidaUI(id){
  const motivo = (prompt('Por que esta carga está voltando?\n\n'
    + 'O motivo fica registrado no histórico com o seu nome.')||'').trim();
  if(!motivo) return;
  try{
    await SuincoSharePoint.desfazerExclusao(id, motivo);
    await SuincoSharePoint.sincronizarAgora();
    notifyGravacao('Carga devolvida ao painel.');
    renderAll();
    carregarCargasExcluidasUI();
  }catch(e){
    notify('Não consegui devolver a carga: ' + (e.message||'erro'), 'danger', 9000);
  }
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
/* Limpa os quatro filtros do Histórico de uma vez.

   Com filtro de data entrando, "por que o log está vazio?" passa a ter
   mais de uma causa possível — e o operador não deve ter que caçar qual
   campo esqueceu preenchido. */
function limparFiltroHistorico(){
  ['hist-filtro-placa','hist-filtro-setor','hist-data-de','hist-data-ate']
    .forEach(id=>{ const e = document.getElementById(id); if(e) e.value = ''; });
  renderHistorico();
}

function renderHistorico(){
  const filtroPlaca = normalizarPlaca(document.getElementById('hist-filtro-placa')?.value || '');
  const filtroSetor = document.getElementById('hist-filtro-setor')?.value || '';
  /* Filtro por data — pedido do usuário (11/08/2026). Filtra pelo
     TIMESTAMP da movimentação (quando o registro aconteceu), não pela
     data de criação da carga: este log é auditoria de "o que foi feito e
     quando", então a pergunta que ele responde é "o que aconteceu no dia
     X", mesmo que a carga seja de antes.

     A data final vira o fim do dia: quem digita 05/08 quer o dia 05
     inteiro, não até 00:00 dele — mesma regra de
     filtrarPorDataProgramacao, em data.js. */
  const dDe = document.getElementById('hist-data-de')?.value || '';
  const dAte = document.getElementById('hist-data-ate')?.value || '';
  let lista = DB.movimentacoes.slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  if(filtroPlaca) lista = lista.filter(m=>m.placa.includes(filtroPlaca));
  if(filtroSetor) lista = lista.filter(m=>m.setor===filtroSetor);
  if(dDe || dAte){
    const ini = dDe ? new Date(dDe + 'T00:00:00').getTime() : -Infinity;
    const fim = dAte ? new Date(dAte + 'T23:59:59.999').getTime() : Infinity;
    lista = lista.filter(m=>{
      const t = Date.parse(m.timestamp) || 0;
      return t >= ini && t <= fim;
    });
  }
  const LIMITE = ehTelaEstreita() ? 40 : 500;
  const exibidos = lista.slice(0, LIMITE);
  /* LINHA QUE ABRE (20/08/2026).

     Pedido do gestor: "quero que cada linha do histórico se expanda quando
     clicada nela com as informações de log, tudo que é necessário quando
     vou acessar um histórico".

     O Histórico respondia QUANDO, QUEM e DE→PARA. Quem investiga um caso
     precisa do resto — qual carga era, qual cliente, que peso, que lacre,
     o que estava escrito na observação — e tinha que ir procurar em outra
     aba, perdendo o filtro que acabou de montar. Agora abre ali mesmo. */
  document.getElementById('hist-tbody').innerHTML = exibidos.map(m=>`
    <tr class="hist-linha" onclick="alternarDetalheHistoricoUI('${escJs(m.id)}')"
        title="Clique para ver tudo o que se sabe sobre este registro.">
      <td><span class="hist-seta" id="hist-seta-${esc(m.id)}">▸</span> ${fmtDataHora(m.timestamp)}</td>
      <td>${esc(m.placa)}</td>
      <td>${m.statusAnterior ? badgeHtml(m.statusAnterior) : '—'}</td><td>${badgeHtml(m.statusNovo)}</td>
      <td>${esc(m.operador)}</td><td>${esc(m.setor)}</td>
    </tr>
    <tr class="hist-detalhe" id="hist-det-${esc(m.id)}" hidden>
      <td colspan="6">${detalheHistoricoHtml(m)}</td>
    </tr>`).join('');
  document.getElementById('hist-empty').hidden = lista.length>0;
  const contagemEl = document.getElementById('hist-contagem');
  if(contagemEl){
    contagemEl.textContent = lista.length > LIMITE
      ? `Mostrando as ${LIMITE} mais recentes de ${lista.length} — use os filtros pra ver outras.`
      : (lista.length ? `${lista.length} movimentação(ões).` : '');
  }
}

/* A LINHA DO TEMPO DO PDF — a mesma jornada visual da tela (21/08/2026).

   Pedido do gestor: "o relatório individual de carga pode mostrar o mesmo
   feature da linha do tempo". A tabela que existia trazia os mesmos dados,
   mas obrigava o leitor a reconstruir a jornada de cabeça; a linha do
   tempo desenhada — bolinha por etapa, na cor do status, com o tempo
   decorrido no conector — é lida de relance, e é o que a pessoa já conhece
   da tela.

   Reusa `sequenciaDeStatusDaCarga` e `corStatusRelatorio`: as mesmas
   regras e as mesmas cores da timeline do Histórico e do Relatório
   Operacional. Etapa que não aconteceu aparece apagada, dita como "ainda
   não ocorreu" — no PDF de uma carga em andamento, o que falta é tão
   informação quanto o que já foi. */
function linhaDoTempoPdfHtml(c, eventos){
  const sequencia = sequenciaDeStatusDaCarga(eventos);
  const passos = sequencia.map(status => ({
    status, mov: eventos.find(m => m.statusNovo === status) || null,
  }));
  let anterior = null;
  const itens = passos.map((p) => {
    const cs = corStatusRelatorio(p.status);
    const decorrido = (p.mov && anterior)
      ? fmtDuracao(Math.round((new Date(p.mov.timestamp) - new Date(anterior.timestamp)) / 60000))
      : null;
    if(p.mov) anterior = p.mov;
    return `<div class="pdf-tl-step${p.mov ? '' : ' pdf-tl-pendente'}">
      <div class="pdf-tl-trilha">
        <span class="pdf-tl-dot" style="${p.mov ? `background:${cs.fundo};border-color:${cs.borda}` : ''}">${p.mov ? '✓' : ''}</span>
      </div>
      <div class="pdf-tl-corpo">
        ${decorrido ? `<div class="pdf-tl-decorrido">⏱ ${esc(decorrido)} na etapa anterior</div>` : ''}
        <div class="pdf-tl-status">${esc(p.status)}</div>
        ${p.mov
          ? `<div class="pdf-tl-meta">${fmtDataHora(p.mov.timestamp)} — ${esc(p.mov.operador)} · ${esc(p.mov.setor)}</div>`
          : '<div class="pdf-tl-meta">ainda não ocorreu</div>'}
      </div>
    </div>`;
  }).join('');
  return `<div class="pdf-timeline">${itens
    || '<div class="text-dim">Esta carga ainda não teve mudança de etapa registrada.</div>'}</div>`;
}

/* RELATÓRIO DE UMA CARGA SÓ (21/08/2026).

   Pedido do gestor: "quero conseguir gerar um relatório de qualquer número
   de carga individual do histórico".

   É um documento diferente dos outros três. O Operacional responde "como
   está o dia"; este responde "o que aconteceu com ESTA carga" — e quem
   pergunta isso está resolvendo uma pendência específica: uma cobrança de
   frete, uma divergência de peso, um lacre questionado, uma carga que
   demorou. Por isso ele traz a linha do tempo com o TEMPO ENTRE AS ETAPAS,
   que é a informação que a tabela do dia não tem espaço para mostrar.

   Nasce do Histórico, onde a pergunta aparece, e não de mais um botão numa
   barra de relatórios que ninguém lembra que existe. */
async function relatorioDaCargaUI(cargaId){
  const c = getCarga(cargaId);
  if(!c){
    notify('Esta carga não está mais no painel — pode ter sido excluída ou estar fora do período carregado.', 'warn', 8000);
    return;
  }
  const el = document.getElementById('print-carga');
  if(!el){ notify('Não achei o container do relatório.', 'danger'); return; }

  const eventos = historicoDaCarga(cargaId);
  const entrada = entradaNoPatioDe(c);
  const l = lacresDaCarga(c);

  const campo = (rot, val) => val === '' || val === null || val === undefined
    ? '' : `<div class="doc-campo"><dt>${esc(rot)}</dt><dd>${val}</dd></div>`;

  const totalCiclo = eventos.length > 1
    ? fmtDuracao(Math.round((new Date(eventos[eventos.length - 1].timestamp)
        - new Date(eventos[0].timestamp)) / 60000))
    : null;

  el.innerHTML = `
    <div class="print-page doc-normal">
      ${cabecalhoDocumento({
        titulo: `Carga ${esc(c.numeroCarga) || '(sem número)'} — ${esc(c.placa)}`,
        subtitulo: 'Ficha completa da carga, com a linha do tempo de todas as etapas',
      })}

      ${tituloSecaoPdf('Identificação', 'O que esta carga é, e para onde vai.')}
      <div class="doc-grid">
        ${campo('Nº da carga', esc(c.numeroCarga) || '—')}
        ${campo('Status atual', esc(c.status))}
        ${campo('Placa', esc(c.placa))}
        ${campo('Transportadora', esc(c.transportadora) || '—')}
        ${campo('Tipo de veículo', esc(c.tipoVeiculo) || '—')}
        ${campo('Motorista', esc(c.motorista) || '—')}
        ${campo('Rota', esc(rotaCurta(c.rota)))}
        ${campo('Cliente', esc(c.cliente) || '—')}
        ${campo('Destino', esc(c.destino) || '—')}
        ${campo('Tipo de operação', c.praOnde ? esc(PRA_ONDE_LABEL[c.praOnde] || c.praOnde) : '—')}
        ${campo('Peso', c.peso ? `${c.peso.toLocaleString('pt-BR')} kg` : '—')}
        ${campo('Paletizada', paletizadaDaCarga(c))}
        ${campo('Ganchos · Entregas', `${c.qtdGanchos ? c.qtdGanchos : 'Liso'} · ${c.qtdEntregas ?? 1}`)}
        ${campo('Sequência', c.sequencia ?? '—')}
      </div>

      ${tituloSecaoPdf('Datas', 'Três fatos diferentes — ver a nota no rodapé.')}
      <div class="doc-grid">
        ${campo('Programada em', c.programadoEm ? fmtDataHora(c.programadoEm) : '—')}
        ${campo('Registro criado em', c.criadoEm ? fmtDataHora(c.criadoEm) : '—')}
        ${campo('Entrada no pátio', entrada ? fmtDataHora(entrada) : 'chegada não registrada')}
        ${campo('Ciclo total', totalCiclo || '—')}
      </div>

      ${(l.numeros.length || l.retido || l.faltando) ? blocoLacresPdf([c]) : ''}

      ${tituloSecaoPdf('Linha do tempo',
        'A mesma jornada visual da tela do Histórico — etapa, hora, quem registrou e quanto tempo a carga ficou na etapa anterior.')}
      ${linhaDoTempoPdfHtml(c, eventos)}

      ${c.observacoes ? `${tituloSecaoPdf('Observações')}
        <div class="print-nota">${esc(c.observacoes)}</div>` : ''}

      ${rodapeDocumento(
        '<strong>Programada em</strong> = quando a Logística lançou a carga · '
        + '<strong>Registro criado em</strong> = quando a linha nasceu no sistema · '
        + '<strong>Entrada no pátio</strong> = quando a Portaria registrou a chegada do caminhão. '
        + 'São três fatos distintos e podem estar a horas de distância.',
        'Dados da própria carga e da trilha de movimentações — a mesma que alimenta o Histórico. '
        + 'Nada aqui é recalculado ou estimado.',
        fichaDocumento({
          titulo: `Carga ${c.numeroCarga || '(sem número)'}`,
          contagem: eventos.length,
          extra: `<strong>Etapas registradas:</strong> ${eventos.length}`,
        }))}
    </div>`;

  await exportarViaServidor(el, `Carga-${c.numeroCarga || c.placa}`, 'ficha-de-carga');
}

/* AS TRÊS DATAS DE UMA CARGA — e por que confundi-las custou caro.
   (21/08/2026)

   Relato do gestor olhando o Histórico: "que estranho essa data de entrada
   no pátio dessa placa". Estava estranha mesmo. A carga 118292 dizia
   "Entrada no pátio 20/08 19:57" e a movimentação logo acima mostrava a
   Portaria registrando a chegada em 21/08 09:06 — quatorze horas depois.

   O rótulo é que estava mentindo. A tela mostrava `criadoEm`, e `criadoEm`
   significa coisas diferentes dependendo de quem criou a linha:

     · carga PROGRAMADA pela Logística → quando ELA foi lançada (19:57 de
       ontem), e o caminhão nem tinha chegado;
     · entrada registrada pela PORTARIA (aguardandoCarga) → aí sim é a
       chegada do caminhão, porque a linha nasce no momento em que ele
       encosta.

   A entrada no pátio de verdade tem um registro próprio e inequívoco: o
   evento de mudança para "Aguardando Embarque", na trilha. É dele que esta
   função tira a resposta — e devolve null quando o caminhão ainda não
   chegou, em vez de oferecer uma data qualquer que pareça uma.

   As três datas, para não se misturarem de novo:
     criadoEm     — quando o REGISTRO nasceu
     programadoEm — quando a CARGA foi lançada/programada
     entrada      — quando o CAMINHÃO encostou (esta função) */
function entradaNoPatioDe(c){
  if(!c) return null;
  const ev = primeiroTimestamp(c.id, 'Aguardando Embarque');
  if(ev) return ev;
  /* Entrada registrada pela Portaria sem programação: a linha nasce no
     instante da chegada, então aí — e só aí — criadoEm é a entrada. */
  if(c.aguardandoCarga) return c.criadoEm || null;
  return null;
}

/* O QUE APARECE QUANDO A LINHA DO HISTÓRICO ABRE.

   Regra de conteúdo: tudo que responde "o que era essa carga naquele
   momento e o que aconteceu com ela", sem obrigar ninguém a trocar de aba.
   Quando a carga não existe mais no painel (excluída, ou fora da janela de
   sincronização), o bloco diz isso em vez de aparecer vazio — sumiço sem
   explicação é o que faz operador desconfiar do sistema. */
function detalheHistoricoHtml(m){
  const c = getCarga(m.cargaId);
  /* `largo` marca o campo que atravessa as duas colunas no celular: nome de
     cliente, destino, observação e id não cabem em meia largura sem virar
     três linhas — e aí o remédio fica pior que a doença. Ver .hist-campo-largo
     no styles.css. */
  const linha = (rot, val, largo)=> val === '' || val === null || val === undefined
    ? '' : `<div class="hist-campo${largo ? ' hist-campo-largo' : ''}">`
        + `<dt>${esc(rot)}</dt><dd>${val}</dd></div>`;

  const doEvento = [
    linha('Registro', `${fmtDataHora(m.timestamp)}`),
    linha('Etapa', `${m.statusAnterior ? esc(m.statusAnterior) + ' → ' : ''}<strong>${esc(m.statusNovo)}</strong>`),
    linha('Operador', `${esc(m.operador)}${m.setor ? ' · ' + esc(m.setor) : ''}`),
    linha('Carga (id)', `<code>${esc(m.cargaId)}</code>`, true),
  ].join('');

  if(!c){
    return `<div class="hist-det-grid">${doEvento}</div>
      <div class="hist-det-aviso">Esta carga não está mais no painel — pode ter sido excluída ou
      estar fora do período que o painel mantém carregado. O registro do evento acima continua
      valendo: ele é da trilha, e a trilha não se apaga.</div>`;
  }

  const l = lacresDaCarga(c);
  const daCarga = [
    linha('Nº da carga', esc(c.numeroCarga) || '—'),
    linha('Status atual', badgeHtml(c.status)),
    linha('Cliente', esc(c.cliente) || '—', true),
    linha('Destino', esc(c.destino) || '—', true),
    linha('Rota', esc(rotaCurta(c.rota)) || '—'),
    linha('Transportadora', esc(c.transportadora) || '—', true),
    linha('Veículo', `${esc(c.tipoVeiculo) || '—'}${c.motorista ? ' · ' + esc(c.motorista) : ''}`),
    linha('Peso', c.peso ? `${c.peso.toLocaleString('pt-BR')} kg` : '—'),
    linha('Tipo de operação', c.praOnde ? esc(PRA_ONDE_LABEL[c.praOnde] || c.praOnde) : '—'),
    linha('Paletizada', paletizadaDaCarga(c)),
    linha('Ganchos · Entregas', `${c.qtdGanchos || 'Liso'} · ${c.qtdEntregas ?? 1}`),
    linha('Sequência', c.sequencia ?? '—'),
  ].join('');

  const lacres = [
    linha('Lacre(s) da saída', l.numeros.length ? esc(l.texto)
      : (l.faltando ? '<span class="obs-pendente">saiu sem lacre informado</span>' : '—')),
    linha('Lacre retido', l.retido
      ? `${esc(l.retido)}${l.motivo ? ' — ' + esc(l.motivo) : ''}`
        + `${l.por ? ` <small>(${esc(l.por)}${l.em ? ', ' + fmtDataHora(l.em) : ''})</small>` : ''}`
      : '', true),
  ].join('');

  const datas = [
    linha('Programada em', c.programadoEm ? fmtDataHora(c.programadoEm) : '—'),
    linha('Entrada no pátio', (() => {
      const e = entradaNoPatioDe(c);
      return e ? fmtDataHora(e)
        : '<span class="text-dim">o caminhão ainda não teve chegada registrada</span>';
    })()),
    /* O instante em que a LINHA nasceu fica à mostra também, com o nome
       certo: numa auditoria a diferença entre "quando isto foi lançado" e
       "quando o caminhão chegou" é justamente o que se quer olhar. */
    linha('Registro criado em', c.criadoEm ? fmtDataHora(c.criadoEm) : '—'),
    linha('Observações', esc(c.observacoes) || '—', true),
  ].join('');

  return `
    <div class="hist-det-secao">Este registro</div>
    <div class="hist-det-grid">${doEvento}</div>
    <div class="hist-det-secao">A carga</div>
    <div class="hist-det-grid">${daCarga}</div>
    ${lacres ? `<div class="hist-det-secao">Lacres</div><div class="hist-det-grid">${lacres}</div>` : ''}
    <div class="hist-det-secao">Datas e observações</div>
    <div class="hist-det-grid">${datas}</div>
    <div class="hist-det-acoes no-print">
      <button class="btn btn-sec btn-sm" onclick="event.stopPropagation();verLinhaDoTempoDoHistoricoUI('${escJs(c.id)}')"
        title="Abre a linha do tempo completa desta carga, com todas as etapas."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-historico"/></svg> Linha do tempo completa</button>
      <button class="btn btn-sec btn-sm" onclick="event.stopPropagation();relatorioDaCargaUI('${escJs(c.id)}')"
        title="Gera o PDF desta carga: ficha completa, datas, lacres e a linha do tempo com o tempo de cada etapa."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-relatorios"/></svg> Relatório desta carga</button>
    </div>`;
}

function alternarDetalheHistoricoUI(movId){
  const alvo = document.getElementById('hist-det-' + movId);
  const seta = document.getElementById('hist-seta-' + movId);
  if(!alvo) return;
  alvo.hidden = !alvo.hidden;
  if(seta) seta.textContent = alvo.hidden ? '▸' : '▾';
}

/* Leva para a linha do tempo da carga sem perder o que a pessoa estava
   fazendo: a aba do Histórico continua com os filtros montados quando ela
   voltar, porque nada aqui é recarregado. */
function verLinhaDoTempoDoHistoricoUI(cargaId){
  /* COMO SE TIVESSE BUSCADO NO HISTÓRICO (21/08/2026) — literalmente.

     A primeira versão abria a TORRE, mas o cartão "Linha do Tempo de uma
     Carga" mora no HISTÓRICO: a timeline era desenhada num container que
     estava em outra aba, invisível. Relato do gestor: "é pra mostrar a
     linha do tempo daquela carga como se eu tivesse buscado ela no
     histórico". Então o clique agora faz exatamente o que a pessoa faria:
     abre o Histórico, preenche a busca com o número da carga (para o
     estado da tela ficar coerente — dá para refinar dali), seleciona a
     carga e rola até a timeline. */
  const c = getCarga(cargaId);
  abrirTab('historico');
  const busca = document.getElementById('hist-busca-carga');
  if(busca && c){
    busca.value = c.numeroCarga || c.placa || '';
    if(typeof renderBuscaTimeline === 'function') renderBuscaTimeline();
  }
  selecionarCargaTimeline(cargaId);
  const wrap = document.getElementById('hist-timeline-wrap');
  if(wrap && wrap.scrollIntoView) wrap.scrollIntoView({block:'start'});
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
  /* NÃO escreve mais largura aqui. Ela virou responsabilidade do CSS
     (@media print: .print-page{width:198mm}), junto com a folha A4
     vertical. Deixar o '287mm' da folha deitada nesta função — que já não
     é chamada na exportação — era uma contradição esperando alguém
     reativá-la e reintroduzir o bug do relatório miniaturizado. */

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

/* Carimbo de data do NOME DO ARQUIVO — o período filtrado, não a hora
   em que alguém clicou.

   Pedido do usuário (11/08/2026): "os relatorios filtrados por data,
   precisam sair com a data exata que foi filtrada no nome do arquivo...
   se foi do mes passado, preciso que saia com data do mes passado".

   Antes o nome sempre trazia `new Date()` — a emissão. Quem gerava hoje o
   relatório de julho recebia um arquivo carimbado com a data de hoje, e
   na pasta de downloads três relatórios de meses diferentes ficavam com
   nomes praticamente iguais, distinguíveis só abrindo um por um.

   Sem filtro nenhum não existe período a carimbar, e aí a emissão volta a
   ser a informação certa — mas marcada como `emitido-`, para ninguém
   confundir com recorte de data. */
function carimboDoPeriodo(){
  const { de, ate } = periodoRelatorio();

  if(de && ate) return de === ate ? de : `${de}_a_${ate}`;
  if(de) return `desde_${de}`;
  if(ate) return `ate_${ate}`;

  const d = new Date();
  const dia = [
    d.getFullYear(),
    String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0')
  ].join('-');
  return `emitido-${dia}_${String(d.getHours()).padStart(2,'0')}h${String(d.getMinutes()).padStart(2,'0')}`;
}

/* Junta a folha de estilo do painel para mandar junto com o relatório.

   Por que não é `document.querySelector('style')`, que era o que estava
   aqui até 14/08/2026: `querySelector` devolve o PRIMEIRO <style> do
   documento, e o código assumia que o primeiro é o do build (o
   build_arquivo_unico.py embute o CSS inteiro num <style> só). Basta
   QUALQUER outro <style> nascer antes dele — extensão de navegador,
   bloqueador de conteúdo, tema escuro de terceiro, tradutor de página —
   para o painel mandar o conteúdo do intruso, quase sempre vazio, e o
   servidor recusar com "Faltou o estilo do relatório (css)".

   Foi o incidente relatado pelo dono do projeto no Safari: o painel na
   tela estava perfeitamente estilizado (ou seja, a folha existia e tinha
   conteúdo) e mesmo assim o relatório saía sem css. Nada tinha mudado no
   código do relatório — mudou o que havia na frente dele no navegador.

   Agora junta TODOS os <style>, e ainda varre as folhas ligadas por
   <link> (caso alguém abra a fonte `index_suinco.html` em vez do arquivo
   único, onde o CSS não está embutido). Folha de outra origem lança ao ler
   `cssRules` por segurança do navegador — daí o try/catch: ignorar a que
   não dá pra ler é melhor que derrubar a exportação inteira. */
function coletarCssDoPainel(){
  const partes = [];

  document.querySelectorAll('style').forEach(s=>{
    const t = s.textContent || '';
    if(t.trim()) partes.push(t);
  });

  document.querySelectorAll('link[rel~="stylesheet"]').forEach(l=>{
    try{
      const regras = l.sheet && l.sheet.cssRules;
      if(!regras) return;
      const texto = [...regras].map(r=>r.cssText).join('\n');
      if(texto.trim()) partes.push(texto);
    }catch(e){ /* folha de outra origem: o navegador não deixa ler */ }
  });

  return partes.join('\n');
}

/* Substitui window.print(): monta o mesmo HTML que sempre foi montado,
   manda pro servidor gerar o PDF de verdade (A4 paisagem garantido) e
   baixa o arquivo pronto. */
/* ---------- Exportação de cadastros em CSV ----------
   Pedido do usuário (18/08/2026): "exportar qualquer relação de cadastros
   completa... por exemplo todo o registro de cadastro de Frota,
   atualizado". CSV e não XLSX de propósito: sai do próprio navegador, sem
   biblioteca externa (a CSP barra CDN), e com BOM + ponto-e-vírgula o
   Excel em português abre com acento e coluna certos num duplo clique. */
function baixarCsvCadastro(nome, cabecalhos, linhas){
  const escapa = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const corpo = [cabecalhos, ...linhas]
    .map((l) => l.map(escapa).join(';')).join('\r\n');
  // BOM: sem ele o Excel pt-BR abre "Ç" como lixo — visto em campo.
  const blob = new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8' });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const carimbo = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Suinco_Cadastro_${nome}_${carimbo}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  notifyGravacao(`Cadastro de ${nome} exportado: ${linhas.length} registro(s).`);
}

function exportarFrotaCsv(){
  baixarCsvCadastro('Frota',
    ['Placa','Transportadora','Tipo de Veículo','Motorista','Capacidade (kg)','UF','Última Movimentação','Precisa Revisão'],
    DB.frota.map((f) => [f.placa, f.transportadora || '', f.tipoVeiculo || '',
      f.motorista || '', f.capacidadeKg ?? '', f.uf || '',
      f.dataUltimaMovimentacao || '', f.precisaRevisao ? 'Sim' : 'Não']));
}

function exportarRotasCsv(){
  baixarCsvCadastro('Rotas',
    ['Código','Nome','Detalhe','Operador'],
    ROTAS.map((r) => [r.codigo, r.nome || '', r.detalhe || '', r.operador || '']));
}

function exportarTransportadorasCsv(){
  // Derivada da Frota (fonte viva): cada transportadora com quantas placas
  // tem hoje — mais útil que a lista solta de nomes.
  const porNome = new Map();
  DB.frota.forEach((f) => {
    const nome = (f.transportadora || '').trim();
    if (!nome) return;
    porNome.set(nome, (porNome.get(nome) || 0) + 1);
  });
  baixarCsvCadastro('Transportadoras',
    ['Transportadora','Placas cadastradas'],
    [...porNome.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

async function exportarViaServidor(el, nomeDoRelatorio, tipo){
  /* `tipo` identifica o documento para o servidor decidir se o SEU setor
     pode gerá-lo (etapa 1 do protocolo de segurança, 22/08/2026). Não é
     opcional: documento sem tipo é recusado, de propósito — assim um
     documento esquecido no mapa aparece na primeira tentativa, em vez de
     virar uma porta aberta que ninguém nota. */
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

  // Sem acento, espaço ou barra: o nome vira arquivo, e cada sistema
  // operacional estraga esses caracteres de um jeito diferente.
  const limpo = (nomeDoRelatorio || 'Relatorio')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const nomeArquivo = `Suinco_${limpo}_${carimboDoPeriodo()}`;

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
    const css = coletarCssDoPainel();
    if(!css.trim()){
      // Melhor parar aqui e dizer o que houve do que gastar a viagem até o
      // servidor pra ele responder "faltou o css" — que foi exatamente o
      // que o operador viu no incidente de 14/08/2026, sem pista nenhuma
      // do que fazer a respeito.
      notify('Não achei a folha de estilo do painel para montar o relatório. '
        + 'Recarregue a página (ou abra numa aba anônima, sem extensões) e tente de novo.',
        'danger', 9000);
      limpar();
      return;
    }
    const html = el.outerHTML;
    const blob = await SuincoSharePoint.gerarRelatorioPdf({
      html, css, orientacao: 'retrato', nomeArquivo, tipo,
      recorte: carimboDoPeriodo(),
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${nomeArquivo}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('Relatório baixado.', 'success');
  }catch(e){
    const semPermissao = /não gera este documento|DOCUMENTO_SEM_PERMISSAO/i.test(String(e && e.message || ''));
    notify(semPermissao
      ? 'Seu setor não gera este documento. Peça à Logística ou à Administração.'
      : 'Não consegui gerar o relatório: ' + (e && e.message || 'erro desconhecido'),
      'danger', 7000);
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
/* MONTAR e EXPORTAR são duas coisas (20/08/2026).

   Separado porque o relatório passou a ter um segundo leitor: o robô que
   manda o andamento do carregamento no grupo do WhatsApp de 3 em 3 horas.
   O servidor abre o painel sem operador nenhum na frente, chama
   `montarRelatorioOperacional()` e imprime o MESMO documento que a
   Logística exporta pela tela.

   Duplicar o modelo do relatório no servidor era o outro caminho, e seria
   o começo de dois relatórios que divergem no primeiro ajuste de coluna
   que alguém fizer aqui e esquecer de fazer lá. Uma fonte só. */
/* CAMINHÃO COM DUAS CARGAS: a informação fica no RODAPÉ, não na célula.

   Duas tentativas erradas antes desta, no mesmo dia (26/08/2026), e as duas
   valem registro porque a lição é a mesma:

     · escrever "(1 de 2, rotas diferentes)" dentro da célula da placa. A
       coluna Placa tem 7,5% da folha e não quebra linha: o texto inchou a
       coluna para um terço da página e derrubou a tabela inteira do A4. O
       dono viu o relatório do dia assim — "TA TOTALMENTE ZUADO";
     · encurtar para "1/2*" e pôr numa linha própria dentro da célula. O
       layout parou de quebrar, mas o dono foi direto ao ponto: "NAO PRECISA
       DESSA INFORMACAO 1 DE 2 2 DE 2, MANTEM A PLACA E QUE SEJA NORMAL
       MARCAR 2 CARGAS NUMA PLACA SO".

   Ele está certo, e a correção é melhor do que as duas: duas cargas no mesmo
   caminhão é rotina do pátio, não anomalia, e anomalia é o que merece marca
   na linha. As duas linhas já mostram a mesma placa com rotas diferentes —
   quem lê enxerga. O rodapé nomeia o caso para quem confere a folha inteira,
   e é lá que sobra largura para dizer QUAIS são as rotas.

   A regra que fica: célula de coluna estreita recebe DADO, nunca explicação. */
function avisoDePlacaRepetida(lista){
  const porPlaca = new Map();
  lista.forEach(c => {
    const p = normalizarPlaca(c.placa);
    if(!porPlaca.has(p)) porPlaca.set(p, []);
    porPlaca.get(p).push(c);
  });
  const repetidas = [...porPlaca.entries()].filter(([, cs]) => cs.length > 1);
  if(!repetidas.length) return '';
  /* TEXTO CORRIDO, sem <ul>. A caixa de aviso desta folha foi desenhada
     para uma ou duas linhas de texto; uma lista dentro dela empurra o bloco
     e come espaço da tabela numa folha que já é apertada. O mesmo formato
     do aviso de numeração, que já roda há semanas sem problema. */
  const itens = repetidas.map(([p, cs]) => {
    const rotas = [...new Set(cs.map(c => rotaCurta(c.rota) || 'sem rota'))];
    return `<strong>${esc(p)}</strong> (${cs.length} cargas`
      + `${rotas.length > 1 ? `, rotas ${esc(rotas.join(' e '))}` : ''})`;
  }).join(' · ');
  return `<div class="doc-aviso-numeracao">
    <strong>Caminhão com mais de uma carga:</strong> ${itens}. São viagens
    diferentes do mesmo veículo, não duplicidade.
  </div>`;
}

/* AS DATAS DE UMA LINHA DE RELATÓRIO — pedido do dono, 26/08/2026:
   "puxamos o relatório de administração de fretes dos últimos 30 dias e não
   está vindo com DATA, eu preciso da data e hora em cada linha de relatório,
   de todos os relatórios que precisam dessa informação clara".

   Ele está certo, e o relatório de fretes não tinha data NENHUMA: quatro
   colunas — número, placa, rota, observações. Trinta dias assim não se
   confere.

   UMA CARGA TEM MAIS DE UMA DATA, e confundi-las já produziu incidente. São
   três relógios diferentes:

     · a DATA DA PROGRAMAÇÃO — o dia a que a viagem pertence;
     · a ENTRADA no pátio — quando o caminhão de fato chegou;
     · a SAÍDA — quando ele seguiu viagem.

   Elas coincidem quase sempre, e se separam justamente nos casos que dão
   problema: caminhão programado num dia que só sai no outro. Foi isso que
   fez duas cargas sumirem do relatório em 19/08.

   A DATA DA PROGRAMAÇÃO usa `programadoEm || criadoEm` — exatamente o mesmo
   campo que `filtrarPorDataProgramacao` usa para decidir se a linha entra no
   período. Mostrar uma data diferente da que filtrou seria a receita para
   alguém jurar que o relatório está errado.

   FUSO: aqui NÃO se corta o texto do ISO com slice(0,10). O carimbo vem em
   UTC; cortar a string devolve o dia de Londres, e qualquer coisa depois das
   21h daqui apareceria no dia seguinte. `toLocaleDateString('pt-BR')`
   converte para o fuso de quem lê, que é o do pátio. */
function dataCurtaLocal(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR');
}

async function montarRelatorioOperacional(){
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
  const lista = cargasDoRelatorio().slice().sort(ordenarPorSequenciaDeCarregamento);
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
      <td class="c-placa">${c.placa ? esc(c.placa).toUpperCase()
        : '<span class="liso">a contratar</span>'}</td>
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
  /* Conta SEPARADA, decisão do dono (26/08): a tonelagem já planejada
     aparece sem se misturar com o que já tem caminhão contratado. */
  const semCaminhao = lista.filter(c=>!c.placa);
  const semCaminhaoTon = (semCaminhao.reduce((s,c)=>s+(c.peso||0),0)/1000)
    .toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
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
          <!-- "Ganch.", pelo mesmo motivo de "Palet." e "Entr." logo acima:
               nesta largura o navegador cortava a palavra. Com a coluna
               Data / Hora (26/08/2026) a folha ficou mais apertada e
               "GANCHOS" passou a sair cortado no cabeçalho. O significado
               está no rodapé, junto com "Liso = sem gancheira". -->
          <th class="c-ganchos">Ganch.</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="13" class="text-center text-dim">Nenhuma carga no período selecionado.</td></tr>'}</tbody>
        ${lista.length ? `<tfoot>${/* 8 é o número de colunas antes do Peso. A coluna "Data / Hora" chegou
             a existir aqui em 26/08 e saiu no mesmo dia, por decisão do dono:
             a folha do Operacional é do DIA, com a mesma data em toda linha e
             o dia já escrito no cabeçalho — a coluna gastava largura para
             repetir o que o documento inteiro já dizia. As datas ficaram onde
             fazem falta: no Fretes, que é de período. */''
           }${rodapeSomatorios(lista, 8, ['peso','', 'entregas','ganchos'])}</tfoot>` : ''}
      </table>
      <!-- Nota de rodapé enxugada.

           A anterior tinha cinco linhas explicando decisões de projeto —
           por que tal coluna saiu, o que a cor significa. Isso interessa a
           quem mantém o sistema, não a quem lê a folha no pátio. O que
           sobra é a única coisa que o leitor precisa saber e não consegue
           deduzir olhando a tabela. -->
      ${avisoDeNumeracao(lista)}
      ${avisoDePlacaRepetida(lista)}
      ${/* Os lacres do dia, logo abaixo da tabela: quem confere a folha no
            pátio termina de ler as cargas e encontra o controle de lacre no
            mesmo documento, sem precisar de outro relatório. */''}
      ${blocoLacresPdf(lista)}
      ${rodapeDocumento(
        'Todas as cargas da programação aparecem, em qualquer status — as concluídas ' +
        'continuam na lista para o acompanhamento do dia inteiro.<br>' +
        '<strong>Palet.</strong> = carga paletizada · <strong>Entr.</strong> = quantidade de ' +
        'entregas · <strong>Liso</strong> = sem gancheira.',
        'Todas as cargas do período selecionado, na SEQUÊNCIA DE CARREGAMENTO '
        + 'definida pela Logística — a mesma ordem da tela. Cargas sem sequência '
        + 'aparecem no fim. Cargas excluídas ou canceladas não entram.',
        fichaDocumento({
          titulo: 'Relatório Operacional',
          contagem: lista.length,
          extra: `<strong>Concluídas:</strong> ${concluidas} de ${lista.length}`
            + (semCaminhao.length
              ? ` · <strong>Sem caminhão contratado:</strong> ${semCaminhao.length} carga(s), ${semCaminhaoTon} t`
              : ''),
        }))}
    </div>`;
  return el;
}

async function exportarPdfOperacional(){
  const el = await montarRelatorioOperacional();
  await exportarViaServidor(el, 'Relatorio-Operacional', 'relatorio-operacional');
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
/* Aviso de conferência dos números da carga, impresso no próprio relatório.

   Pedido do gestor (15/08/2026): "o relatório precisa ser muito fiel aos
   números das cargas, não pode existir erro nesse relatório".

   O sistema não tem como adivinhar que `118713` era pra ser `118173`, nem
   escolher qual das duas cargas `118105` é a verdadeira. O que ele PODE
   fazer — e não fazia — é parar de imprimir um total como se estivesse
   tudo certo. Número repetido soma a mesma carga duas vezes no rodapé, que
   é exatamente a conferência de tonelagem que não fechava.

   Fica junto do total, não no fim da folha: quem confere olha o total, e é
   ali que a dúvida precisa aparecer. Não bloqueia nada — o relatório sai
   igual, só deixa de esconder. */
function avisoDeNumeracao(lista){
  const p = problemasDeNumeracao(lista);
  if(!p.total) return '';

  const partes = [];
  if(p.duplicados.length){
    const itens = p.duplicados.map(d =>
      `<strong>${esc(d.numero)}</strong> (${d.quantidade}× — ${esc(d.placas.join(', '))}` +
      `${d.pesoSomado ? ` · ${(d.pesoSomado/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} t somadas` : ''})`
    ).join(' · ');
    partes.push(`<strong>${p.duplicados.length} número(s) repetido(s):</strong> ${itens}. `
      + 'O total acima soma essas cargas mais de uma vez.');
  }
  if(p.foraDoPadrao.length){
    const itens = p.foraDoPadrao.map(f =>
      `<strong>${esc(f.numero)}</strong> (${esc(f.carga.placa)})`).join(' · ');
    partes.push(`<strong>${p.foraDoPadrao.length} número(s) fora do padrão:</strong> ${itens}.`);
  }
  if(p.semNumero.length){
    const itens = p.semNumero.map(c => esc(c.placa)).join(' · ');
    partes.push(`<strong>${p.semNumero.length} carga(s) sem número:</strong> ${itens}.`);
  }

  return `<div class="doc-aviso-numeracao">
    <strong>⚠ Conferir antes de usar este relatório</strong><br>${partes.join('<br>')}
  </div>`;
}

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
  await exportarViaServidor(el, 'Relatorio-Executivo', 'relatorio-executivo');
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
    /* A FILA VELHA DOS APARELHOS É DESCARTADA NA ABERTURA (31/08/2026).

       Sem isto, a trava do offline valeria só daqui para frente: o que já
       está guardado no celular de quem ficou sem rede subiria na próxima
       conexão e sobrescreveria de novo — que é exatamente o defeito que
       estamos fechando. Foi assim que o celular do Alysson desfez o que ele
       tinha acabado de fazer no computador.

       NÃO some calado: lista o que foi descartado, com placa e tipo, para a
       pessoa refazer o que ainda fizer sentido. */
    if(typeof SuincoSharePoint.descartarFilaAntiga === 'function'){
      const jogado = SuincoSharePoint.descartarFilaAntiga();
      if(jogado && jogado.havia){
        const linhas = jogado.itens.slice(0, 8).map(i =>
          `${i.tipo}${i.placa ? ' · ' + i.placa : ''}${i.numeroCarga ? ' · carga ' + i.numeroCarga : ''}`
        ).join(' | ');
        notify(`⚠️ ${jogado.havia} alteração(ões) que estavam guardadas NESTE aparelho foram DESCARTADAS. `
          + `O sistema não grava mais offline — elas subiriam por cima do que os outros setores já fizeram. `
          + `Refaça se ainda fizer sentido: ${linhas}`, 'danger', 30000);
      }
    }
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

      /* VOLTOU A ANDAR DEPOIS DE TER SIDO DEVOLVIDA (29/08/2026).

         Quem devolve uma etapa de propósito precisa saber na hora quando
         ela volta a andar. Sem isso, o dono corrigia, outro setor desfazia
         em silêncio, e ele tentava de novo achando que a correção não
         tinha gravado — o relato do FTZ2138 por inteiro.

         Vem ANTES do renderAll e fora do `if` de contagem: é notícia sobre
         uma decisão que esta pessoa tomou, não redesenho de tela. Alto e
         com som, no mesmo padrão da recusa de status. */
      (r.reandouAposDevolucao || []).forEach(x => {
        const quem = `${x.devolvida.setor} (${x.devolvida.quem})`;
        notify(`${x.placa}${x.numeroCarga ? ' · ' + x.numeroCarga : ''}: a carga VOLTOU A ANDAR `
          + `— de "${x.de}" para "${x.para}". ${quem} tinha devolvido a etapa. `
          + `Se não era pra andar, devolva de novo pelo Histórico e avise o setor.`,
          'warn', 14000);
        tocarBeepConfirmacao();
      });

      if(r.cargasNovas || r.cargasAtualizadas || r.movimentacoesNovas){
        renderAll();
        // Aviso discreto: a tela mudou por ação de outro setor, e o operador
        // precisa saber disso — tela que se altera sozinha sem explicação
        // destrói a confiança no painel.
        if(!dados.incremental) return;   // carga inicial não é "novidade"
        /* PERECÍVEL: é notícia de outro setor, e a tela já mostra o
           resultado dela. Quem acabou de abrir o painel não precisa
           assistir à reprise do que aconteceu antes de ele chegar. */
        if(r.cargasNovas || r.cargasAtualizadas){
          notifyAtualizacaoRemota(r);
        }
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
    if(typeof aoEnfileirarRota === 'function') aoEnfileirarRota(receberEnfileiramentoDeRota);
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
    document.body.classList.remove('pre-login');
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
  // O período vem do filtro do topo, não é mais 'hoje' fixo: com o seletor
  // de período na aba, uma caixa escrita "hoje" ao lado de tabelas de
  // "Últimas 6h" é convite a comparar coisas diferentes.
  const periodo = FILTRO_IND.periodo || 'hoje';
  const t = tempoMedioPatio(filtrarPorFiltroIndicadores(cargasConcluidasNoPeriodo(periodo)));
  const geral = tempoMedioPatio(filtrarPorFiltroIndicadores(DB.cargas.filter(c=>c.status==='Seguiu Viagem')));

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
      ${caixa(t, 'Tempo Médio de Pátio — ' + ((ROTULO_PERIODO_IND[periodo] || 'hoje').toLowerCase()), 'Chegada até a saída')}
      ${caixa(geral, 'Tempo Médio de Pátio — histórico', 'Todas as cargas concluídas')}
    </div>`;
}

/* Leitura automática de gargalos. Cada bloco só aparece se tiver conteúdo:
   seção cheia de "sem dados" treina o gestor a ignorar a seção inteira. */
function renderGargalos(){
  const wrap = document.getElementById('ind-gargalos');
  if(!wrap) return;
  // OBEDECE AO FILTRO DO TOPO (28/08/2026). Lia DB.cargas cru: com uma
  // transportadora filtrada lá em cima, os cartões e as tabelas mudavam e
  // esta seção continuava mostrando o pátio inteiro. Duas respostas
  // diferentes na mesma tela, sem nada dizendo que eram bases diferentes.
  const g = analiseGargalos(filtrarPorFiltroIndicadores(DB.cargas));
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
      <td><strong>${esc(v.placa)}</strong></td>${celFiltro('transportadora', v.transportadora)}
      <td class="cel-num">${v.atrasos} de ${v.totalCargas}</td>
      <td class="cel-num">${fmtDuracao(v.tempoMedioAtraso)}</td></tr>`)
  ));

  blocos.push(tabela(
    '⏳ Operações com maior permanência no pátio',
    'Tempo médio da chegada até a saída, por tipo de operação.',
    ['Tipo de Operação','Tempo Médio','Cargas'],
    g.operacoesMaiorPermanencia.map(o=>`<tr>
      ${celFiltro('operacao', o.operacao, PRA_ONDE_LABEL[o.operacao] || o.operacao)}
      <td class="cel-num">${fmtDuracao(o.media)}</td>
      <td class="cel-num">${o.amostra}</td></tr>`)
  ));

  blocos.push(tabela(
    '🚚 Transportadoras com concentração de atraso',
    'Informativo, sem ranking principal — parte do atraso é do pátio, não da transportadora.',
    ['Transportadora','Cargas Atrasadas','% do Total'],
    g.transportadorasAtraso.map(t=>`<tr>
      ${celFiltro('transportadora', t.transportadora)}
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
      ${celFiltro('rota', r.rota, r.rotulo || r.rota)}
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

/* O relatório precisa ser FIEL AO PAINEL no instante do clique.

   Bug relatado pelo usuário (12/08/2026): ele limpou a programação, deixou
   no pátio só os caminhões do dia, e mesmo assim o Executivo trouxe uma
   placa que havia seguido viagem ANTEONTEM. "ainda temos resquicios da
   programacao passadas e do reboot que dei no sistema... tudo precisa ser
   referente ao momento exato que clica em exportar relatorios".

   RAIZ: o painel (Torre, Portaria, Expedição, Faturamento) mostra
   `cargasAbertas()` — tudo que ainda não seguiu viagem. O relatório, sem
   filtro de data, varria `DB.cargas` INTEIRO: toda carga que já existiu
   naquele navegador, de qualquer dia, inclusive as encerradas há semanas.
   As duas telas liam bases diferentes e ninguém percebia enquanto a base
   era nova.

   Regra agora:
   - SEM filtro de data → espelha o painel: o que está em aberto AGORA,
     mais o que foi concluído HOJE (o Operacional acompanha o dia inteiro,
     então o caminhão que saiu de manhã ainda precisa constar).
   - COM filtro → respeita o filtro, que é justamente o caminho para
     consultar período passado de propósito.

   Carga concluída em dia anterior só aparece se alguém PEDIR aquele
   período. Nunca por sobra. */
function cargasDoRelatorio(){
  const { de, ate } = periodoRelatorio();
  const semRascunho = DB.cargas.filter(c=>!c.aguardandoCarga);

  if(de || ate) return filtrarPorDataProgramacao(semRascunho, de, ate);

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return semRascunho.filter(c=>{
    if(c.status !== 'Seguiu Viagem') return true;      // está no painel agora
    const saida = primeiroTimestamp(c.id, 'Seguiu Viagem');
    return saida && new Date(saida) >= hoje;           // saiu hoje: conta no dia
  });
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
  /* Data do DIA LOCAL, nunca `toISOString()`.

     `toISOString()` devolve sempre UTC. Patos de Minas é UTC−3, então das
     21h à meia-noite o UTC já está no dia seguinte: às 23h32 do dia 14 no
     pátio, o botão "Hoje" preenchia o filtro com 15/08 e o dia inteiro de
     trabalho sumia do relatório. Relatado ao vivo em 15/08/2026 — "ainda
     são 11 e 32 e o relatório já está falando dia 15".

     É o fim do turno, exatamente quando o relatório do dia é fechado. */
  const iso = d => [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
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
      <td class="col-data">${dataCurtaLocal(d.programada) || '—'}</td>
      <td class="col-saida">${d.saida
        ? fmtDataHora(d.saida)
        : '<span class="text-dim">ainda no pátio</span>'}</td>
      <td class="col-carga">${esc(d.numeroCarga)}</td>
      <td class="col-placa">${esc(d.placa)}</td>
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
          <!-- DUAS datas, e não uma: "Programada" é o dia a que a viagem
               pertence e é o campo que o filtro de período usa; "Saída" é
               quando o caminhão de fato seguiu viagem. Elas divergem
               exatamente nos casos que dão problema na conferência. -->
          <th class="col-data">Data</th>
          <th class="col-saida">Saída</th>
          <!-- "Nº Carga", como no Operacional. "Número da Carga" por extenso
               não cabia na largura da coluna e saía cortado no cabeçalho —
               achado pela conferência de layout do test_relatorios.py. -->
          <th class="col-carga">Nº Carga</th>
          <th class="col-placa">Placa</th>
          <th class="col-rota">Rota</th>
          <th class="col-obs">Observações</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="6" class="text-center text-dim">Nenhuma carga no período selecionado.</td></tr>'}</tbody>
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
  await exportarViaServidor(el, 'Administracao-de-Fretes', 'administracao-fretes');
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
        /* Célula que ATRAVESSA a tabela não é um campo, é um contêiner — a
           linha de detalhe do Histórico é um <td colspan="6"> com o registro
           inteiro dentro. Rotular pela posição colava nela o nome da PRIMEIRA
           coluna: o detalhe abria com um "DATA/HORA" dourado em cima de um
           bloco que não é data nenhuma. Sem rótulo ela cai na regra de
           largura inteira, que é o que um contêiner precisa. */
        if(td.colSpan > 1 || !rotulo || /^(ação|acao|ações|acoes)$/i.test(rotulo)){
          td.removeAttribute('data-rotulo');
          td.removeAttribute('data-larg');
          td.removeAttribute('data-sec');
          return;
        }
        td.setAttribute('data-rotulo', rotulo);
        // Os dois carimbos que o CSS do celular lê. Ver ROTULOS_LARGURA_CHEIA
        // e ROTULOS_SECUNDARIOS: a decisão está lá, num lugar só; aqui é só
        // aplicação.
        if(ROTULOS_LARGURA_CHEIA.has(rotulo)) td.setAttribute('data-larg', 'cheia');
        else td.removeAttribute('data-larg');
        if(ROTULOS_SECUNDARIOS.has(rotulo)) td.setAttribute('data-sec', '1');
        else td.removeAttribute('data-sec');
      });
    });
    // Carimbou, então já dá para dizer quais linhas têm algo escondido —
    // e fazer isso aqui dentro tira a dependência de ordem que existia
    // quando as duas coisas eram chamadas em pontos diferentes do render.
    marcarCartoesExpansiveis(tab);
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
          ${sou ? '' : `<button class="btn btn-danger btn-sm btn-excluir-usuario"
              onclick="excluirUsuarioUI('${escJs(u.id)}')"
              title="Apaga a conta de vez. O histórico do que a pessoa registrou continua.">🗑️ Excluir</button>`}
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

/* EXCLUIR DE VEZ — pedido do dono (25/08/2026): "não tem um botão excluir
   usuários, somente bloquear, preciso poder excluir também".

   Bloquear continua sendo o caminho normal, e a caixa de confirmação diz
   isso em vez de só perguntar "tem certeza?": quem saiu da empresa fica
   melhor BLOQUEADO (perde o acesso, mantém a ficha). Excluir é para o
   cadastro errado, o teste e o duplicado.

   Confirmação DIGITADA, não um "OK". Excluir conta não se desfaz pela
   tela, e o clique de reflexo em cima do botão vermelho ao lado do
   Bloquear é justamente o erro provável aqui. */
async function excluirUsuarioUI(id){
  const u = _usuarioPorId(id);
  if(!u) return;
  const resposta = prompt(`EXCLUIR a conta de ${u.nome} (${u.email})?\n\n`
    + 'A conta some da lista e a pessoa cai na hora. Isto NÃO se desfaz.\n\n'
    + 'O histórico do que ela registrou (chegadas, saídas, faturamentos) '
    + 'continua no sistema com o nome dela.\n\n'
    + 'Se a pessoa só saiu da empresa, BLOQUEAR é melhor: tira o acesso e '
    + 'mantém a ficha.\n\n'
    + 'Para confirmar, digite EXCLUIR:');
  if(resposta === null) return;
  if(resposta.trim().toUpperCase() !== 'EXCLUIR'){
    notify('Não excluí — a confirmação não conferiu.', 'warn', 5000);
    return;
  }
  try{
    await SuincoSharePoint.excluirOperador(id);
    notify(`Conta de ${u.nome} excluída.`, 'success', 6000);
  }catch(e){
    notify('Não consegui excluir: ' + (e && e.message || 'erro'), 'danger', 9000);
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

/* =====================================================================
   MONTAGEM DO DIA — a carga antes de ter placa (23/08/2026)
   =====================================================================

   O que ainda prendia a operação no Excel. O dia nascia numa planilha do
   Teams: o template do dia da semana traz as rotas, a Logística monta as
   cargas em cima delas, e só DEPOIS contrata as placas. O painel não
   participava dessa etapa porque `criarCargaProgramada` recusa placa
   vazia — no painel a carga só existia quando o veículo já estava
   contratado, que é o ÚLTIMO passo do processo real.

   A montagem vive no servidor (tabela própria, migração 031) e NÃO entra
   em DB.cargas. Consequência que é o ponto do desenho: a Torre de
   Controle não vê nada disso. Ela continua recebendo cargas com placa,
   como sempre recebeu.

   Quando a placa entra, a linha vira carga pelo caminho de sempre
   (criarCargaProgramada) e é marcada como efetivada.
   ===================================================================== */

let _montagemDia = null;      // { dia, diaSemana, modelo:[], montagens:[] }
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/* Dia de HOJE no fuso de quem está olhando, nunca em UTC.

   `toISOString()` devolve UTC: às 21h01 em Brasília a data UTC já é a de
   amanhã, e o botão "Hoje" abriria a programação do dia seguinte para
   quem monta o dia à noite. O guardião em testes/test_guardioes.py existe
   exatamente para impedir que isso volte — e pegou este código. */
function diaLocalISO(d = new Date()){
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function montagemHojeUI(){
  const el = document.getElementById('mont-data');
  if(el) el.value = diaLocalISO();
  carregarMontagemUI();
}

async function carregarMontagemUI(){
  const card = document.getElementById('card-montagem');
  if(!card) return;
  /* Só quem programa monta. Os demais setores continuam vendo a Fila e a
     Torre — a montagem é trabalho da Logística, não informação de pátio. */
  const setor = DB.operador && DB.operador.setor;
  const podeMontar = setor === 'Logística' || setor === 'Administração';
  card.hidden = !podeMontar;
  if(!podeMontar) return;

  const campoData = document.getElementById('mont-data');
  if(campoData && !campoData.value) campoData.value = diaLocalISO();
  const dia = campoData ? campoData.value : '';

  if(!SuincoSharePoint.estaConfigurado()){
    document.getElementById('mont-tbody').innerHTML = '';
    const av = document.getElementById('mont-faltando');
    if(av){
      av.hidden = false;
      av.textContent = 'A montagem do dia mora no servidor — entre com seu usuário para montar a programação.';
    }
    return;
  }

  try {
    _montagemDia = await SuincoSharePoint.montagem.doDia(dia);
    renderMontagem();
  } catch(e){
    /* SERVIDOR AINDA SEM A MIGRAÇÃO 031.
       O painel vai para o ar assim que a build publica; o servidor só
       ganha as tabelas novas quando alguém roda atualizar.sh na VPS.
       Nesse intervalo /api/montagem não existe e devolve 404.
       Cuspir "erro" nesse caso assustaria a Logística inteira por algo
       que não quebrou nada — o resto da Programação continua funcionando.
       A tela some e diz o que falta, uma vez, sem alarme. */
    if(e && e.status === 404){
      card.hidden = true;
      console.info('[Suinco] Montagem do dia: servidor ainda sem a atualização. '
        + 'Rode atualizar.sh na VPS para habilitar.');
      return;
    }
    notify('Não consegui carregar a montagem do dia: ' + (e.message || e), 'erro', 7000);
  }
}

function renderMontagem(){
  if(!_montagemDia) return;
  const { diaSemana, modelo, montagens } = _montagemDia;
  const nomeDia = document.getElementById('mont-dia-nome');
  if(nomeDia) nomeDia.textContent = NOMES_DIA[diaSemana];

  const vivas = montagens.filter(m => !m.cancelada_em);
  const comPlaca = vivas.filter(m => m.placa);
  const efetivadas = vivas.filter(m => m.efetivada_em);

  /* "Rotas do modelo que ainda não foram montadas" é o número que diz o
     que FALTA fazer — e é a única razão de a tela carregar o modelo junto
     com a montagem. Conta por rota, não por carga: o modelo pode prever
     duas saídas para a mesma praça, e o que interessa aqui é se a praça
     foi contemplada. */
  const rotasMontadas = new Set(vivas.map(m => m.rota_codigo));
  const faltando = modelo.filter(m => !rotasMontadas.has(m.rota_codigo));

  const faixa = document.getElementById('mont-stats');
  if(faixa){
    const caixa = (n, rot, cor) =>
      `<div class="stat-box"${cor ? ` style="--st-cor:${cor}"` : ''}>
         <div class="stat-num">${n}</div><div class="stat-label">${esc(rot)}</div></div>`;
    faixa.innerHTML =
      caixa(vivas.length, 'Cargas montadas')
      + caixa(comPlaca.length, 'Com placa', 'var(--st-embarque-finalizado-bg)')
      + caixa(vivas.length - comPlaca.length, 'Sem placa', 'var(--st-aguardando-embarque-bg)')
      + caixa(efetivadas.length, 'Já na Torre', 'var(--st-faturado-bg)')
      + caixa(faltando.length, 'Rotas do modelo sem carga',
              faltando.length ? 'var(--st-aguardando-veiculo-bg)' : '');
  }

  const aviso = document.getElementById('mont-faltando');
  if(aviso){
    aviso.hidden = !faltando.length;
    if(faltando.length){
      aviso.innerHTML = `<strong>Ainda sem carga montada:</strong> `
        + faltando.map(m => esc(m.rota_nome)).join(' · ');
    }
  }

  /* O BOTÃO DE LOTE. Na sexta são 39 cargas; confirmar uma a uma é o
     pedágio que faz a pessoa desistir e voltar para o Excel. */
  const prontas = vivas.filter(m => m.placa && !m.efetivada_em);
  const btnLote = document.getElementById('mont-btn-lote');
  if(btnLote){
    btnLote.hidden = prontas.length === 0;
    btnLote.textContent = prontas.length === 1
      ? '🚚 Enviar 1 carga para a Torre'
      : `🚚 Enviar as ${prontas.length} prontas para a Torre`;
  }

  /* Mesma fonte do seletor do modelo (ROTAS + rotaLabel): rota cadastrada
     em Cadastros aparece aqui na hora, sem lista paralela para envelhecer. */
  const selExtra = document.getElementById('mont-rota-extra');
  if(selExtra && !selExtra.options.length){
    selExtra.innerHTML = ROTAS.map(r =>
      `<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
  }

  const tbody = document.getElementById('mont-tbody');
  const vazio = document.getElementById('mont-empty');
  /* CANCELADA SOME DA TELA — pedido do dono (25/08/2026): "quando uma rota
     e cancelada na montagem do dia, ela precisa desaparecer das linhas, e
     nao ficar la como cancelada".

     Ele tem razao sobre ESTA tela: a montagem e a lista do que VAI rodar
     hoje, e linha cancelada ali e ruido entre as que ainda pedem trabalho.
     Numa sexta de 42 linhas, meia duzia de canceladas empurra para baixo
     justamente as que faltam preencher.

     Some da TELA, nao do banco: a linha continua gravada com o motivo, a
     hora e quem cancelou, e o Historico responde por ela. O Excel apagava
     sem deixar rastro; e isso que este painel existe para acabar. */
  const lista = montagens.filter(m => !m.cancelada_em);
  if(vazio) vazio.hidden = lista.length > 0;
  if(!tbody) return;

  tbody.innerHTML = lista.map(m => linhaMontagemHtml(m)).join('');
}

/* O DESTINO NO TÍTULO, A PRAÇA EMBAIXO (25/08/2026)

   Relato do dono: "nessas das cargas do dia tem várias duplicadas, tão
   saindo duplicadas as rotas".

   Fui conferir contra as cinco planilhas que ele mandou, linha a linha.
   Duas coisas diferentes estavam acontecendo, e só uma é defeito:

   NÃO É DEFEITO — a sexta tem MESMO quatro caminhões para Montes Claros e
   três para Brasília, cada um com número de carga e placa próprios. Copiar
   isso é ser fiel; enxugar seria inventar.

   É DEFEITO — o de-para colapsou destinos DIFERENTES no mesmo código,
   porque a praça cadastrada no painel cobre um circuito inteiro. Na terça,
   Arinos/Buritis, João Pinheiro, Paracatu, Riachinho e Unaí viram todos
   "504". A tela mostrava o nome da PRAÇA em negrito e o destino real em
   letra miúda embaixo — seis linhas com o mesmo título gritado e a
   diferença sussurrada. Quem olha lê seis duplicatas.

   Inverti: o destino da planilha é o título, a praça e o código viram a
   informação de apoio. O dado é o mesmo; o que muda é qual metade a tela
   grita. Onde não há apelido (carga fora do modelo), a praça continua
   sendo o título — não há nada mais específico para mostrar. */
/* A ROTA DA LINHA TAMBÉM SE TROCA NA LINHA (28/08/2026).

   Faz parte do mesmo relato do dono ("ficou faltando os campos rota
   peso..."). Trocar a rota era coisa de reabrir o formulário; na planilha
   antiga era mudar uma célula.

   O APELIDO VIRA ETIQUETA, NÃO TÍTULO. Ele vem do modelo da semana e
   identifica a transportadora dentro da praça ("Triângulo Mineiro - Total
   Service"). Se a pessoa trocar a rota, esse apelido passa a descrever uma
   coisa que não é mais a rota da linha — em negrito, por cima do nome
   certo, ele seria a primeira coisa lida e a errada. Aqui ele aparece
   embaixo, dito como o que é: o que o modelo trouxe.

   Mesma fonte do seletor de carga extra (ROTAS + rotaLabel): rota
   cadastrada em Cadastros aparece aqui na hora, sem lista paralela.  */
function rotaMontagemSelectHtml(m){
  const id = escJs(m.montagem_id);
  const atual = String(m.rota_codigo ?? '');
  // Rota que sumiu do cadastro não pode sumir da linha: sem esta opção o
  // select abriria em branco e a primeira gravação trocaria a rota da
  // carga sem ninguém pedir.
  const conhecida = ROTAS.some(r => String(r.codigo) === atual);
  /* O DESTINO CONTINUA SENDO O TÍTULO (28/08/2026 — segunda tentativa).

     A primeira versão desta função trocou o título pelo seletor, e o
     seletor mostra a PRAÇA. Isso desfez a correção da ocorrência #14: numa
     terça, Arinos/Buritis, João Pinheiro, Paracatu, Riachinho e Unaí são
     todos o código 504 — com a praça no lugar do título, seis linhas
     diferentes voltam a parecer a mesma, que foi o relato "tão saindo
     duplicadas as rotas". O teste pegou antes de ir para o pátio.

     Agora as duas coisas convivem: o destino em cima, em negrito, para
     RECONHECER a linha; o seletor embaixo, para TROCAR a rota. */
  return `${destinoMontagemHtml(m)}
    <select class="rota-inline" aria-label="Trocar a rota desta linha"
        title="Trocar a rota desta linha"
        onchange="alterarRotaMontagemUI('${id}', this.value)">
      ${conhecida ? '' : `<option value="${esc(atual)}" selected>${esc(m.rota_nome || atual)} · ${esc(atual)}</option>`}
      ${ROTAS.map(r => `<option value="${esc(r.codigo)}"${String(r.codigo)===atual?' selected':''}>${esc(rotaLabel(r.codigo))}</option>`).join('')}
    </select>`;
}

/* Trocar a rota limpa o apelido do modelo: ele pertencia à linha antiga.
   Mandar os dois juntos numa gravação só evita a janela em que a tela
   mostra a rota nova com a etiqueta velha. */
async function alterarRotaMontagemUI(id, codigo){
  try {
    await SuincoSharePoint.montagem.alterar(id, { rotaCodigo: codigo, apelidoRota: '' });
    await carregarMontagemUI();
  } catch(e){
    notify('Não gravou a rota: ' + (e.message || e), 'erro', 7000);
    await carregarMontagemUI();
  }
}

function destinoMontagemHtml(m){
  const praca = `<span class="text-dim mont-praca">${esc(m.rota_nome)} · ${esc(m.rota_codigo)}</span>`;
  return m.apelido_rota
    ? `<strong>${esc(m.apelido_rota)}</strong><div>${praca}</div>`
    : `<strong>${esc(m.rota_nome)}</strong> <span class="text-dim">${esc(m.rota_codigo)}</span>`;
}

/* A LINHA COMO RESUMO, O FORMULÁRIO COMO DETALHE (25/08/2026)

   Pedido do gestor: "cadê os campos pra poder começar a preencher essa
   rota na programação? eu preciso que essas linhas sejam expansíveis e
   quando se expande pode ser criada carga nela normalmente".

   Antes, os campos existiam — como dez inputs espremidos numa linha de
   tabela. Existir e ser usável são coisas diferentes: no celular aquilo
   não cabia, e no desktop faltavam justamente os campos que a Programação
   tem e a montagem não tinha (motorista, observações, o aviso da frota).

   Agora a linha mostra o que a pessoa precisa para RECONHECER a carga
   (sequência, rota, nº, placa, peso) e o clique abre o formulário
   completo, na MESMA ORDEM da aba Programação. Ordem igual não é capricho:
   é a mesma pessoa preenchendo a mesma carga, e duas telas com ordem
   diferente para o mesmo trabalho geram erro de campo trocado. */
let _montagemAberta = null;

function alternarLinhaMontagemUI(id){
  _montagemAberta = (_montagemAberta === id) ? null : id;
  renderMontagem();
  if(_montagemAberta){
    const foco = document.getElementById(`montf-placa-${_montagemAberta}`);
    if(foco) foco.focus();
  }
}

/* Abre a linha JÁ no campo da placa. É o que o botão "Colocar placa"
   promete, e prometer uma coisa e abrir outra é pior que não oferecer. */
function abrirParaColocarPlacaUI(id){
  _montagemAberta = id;
  renderMontagem();
  const campo = document.getElementById(`montf-placa-${id}`);
  if(campo){ campo.focus(); campo.scrollIntoView({ block: 'center' }); }
}

/* QUEM MEXE NA CARGA DO DIA, EM QUALQUER LUGAR (27/08/2026).

   Relato do dono: "o antonio ta tentando mexer nas cargas de hoje pela
   programacao aparece o simbolo de proibido, voce precisa liberar acesso
   pra administracao e logistica e nao bloquear".

   O servidor NUNCA bloqueou: camposEditaveisPor() já dá a lista inteira
   para Logística, e Administração herda ela. A trava era só de tela. */
function podeEditarCargaDoDia(){
  const s = (DB.operador && DB.operador.setor) || '';
  return s === 'Logística' || s === 'Administração';
}

/* Uma célula editável da linha efetivada. Chama a MESMA função que a Fila
   de Programados e a Torre chamam — nada de caminho paralelo: assim a
   alteração cai na carga, entra no log de revisões e sobe para todos os
   setores, em vez de morrer no rascunho da montagem. */
function celulaCargaHtml(carga, tipo){
  const id = escJs(carga.id);
  if(tipo === 'numero'){
    return `<input type="text" class="numero-carga-input" value="${esc(carga.numeroCarga)}"
      onchange="atualizarNumeroCargaUI('${id}',this.value)"
      title="Número da carga — grava na carga que já está na Torre.">`;
  }
  if(tipo === 'placa'){
    return `<input type="text" class="placa-input" value="${esc(carga.placa)}"
      onchange="atualizarPlacaUI('${id}',this.value)"
      title="Trocar a placa. Se o caminhão novo já estiver no pátio, a carga assume a entrada dele.">`;
  }
  if(tipo === 'peso'){
    return `<input type="number" class="peso-input" min="0" step="1" value="${carga.peso ?? ''}"
      onchange="atualizarPesoUI('${id}',this.value)" title="Peso em kg.">`;
  }
  return '';
}

/* AS AÇÕES DA LINHA QUE JÁ VIROU CARGA.

   Aqui não cabe "➕ Criar carga" — a carga já existe, e o botão ofereceria
   criar uma segunda para a mesma linha. Nem "Excluir": cancelar a linha da
   montagem não desfaz a carga que já está na Torre, e um botão que promete
   remover sem remover é pior que não ter botão. Quem precisa tirar a carga
   faz isso na Torre, onde a regra de exclusão vale por inteiro.

   Sobra o que é verdade: a linha virou carga, e a seta diz que ela abre. */
function acoesCargaNaMontagemHtml(aberta){
  return `<div class="mont-acoes"><span class="text-dim">virou carga</span>
    <span class="mont-seta${aberta ? ' aberta' : ''}" aria-hidden="true">▸</span></div>`;
}

/* O FORMULÁRIO COMPLETO DA LINHA QUE JÁ VIROU CARGA (27/08/2026).

   Relato do dono, no mesmo dia em que a linha efetivada foi destravada:

     "o tonin nao consegue mais abrir a carga e editar detalhadamente cada
      carga, quantidade de entrega, ganchos, isso precisa ser expansivel e
      nao pode faltar onde colocar"

   Erro meu, e da minha própria mudança: ao transformar a linha efetivada em
   janela para a carga, eu troquei o formulário de DOZE campos por três
   células na linha (número, placa, peso). Quem montava a carga perdeu
   Motorista, Tipo de Operação, Paletizada, Ganchos, Entregas e Observações
   — justamente os campos que só existem no formulário.

   Agora a linha abre de novo, com a MESMA ORDEM e o MESMO desenho do
   formulário da montagem (`formMontagemHtml`), campo por campo. Ordem igual
   não é capricho: é a mesma pessoa preenchendo a mesma carga, e duas telas
   com ordem diferente para o mesmo trabalho geram erro de campo trocado.

   A diferença é para onde cada campo grava: aqui tudo chama as MESMAS
   funções da Fila de Programados e da Torre, então a alteração cai na
   CARGA, entra no log de revisões do servidor e sobe para todos os setores
   — em vez de morrer no rascunho da montagem, que depois de efetivado é
   histórico e o servidor recusa com 409 JA_EFETIVADA.

   ROTA continua sem edição aqui, pelo mesmo motivo de sempre: a linha
   nasceu de uma rota do modelo do dia, e trocá-la transformaria "a segunda
   saída de Patos" em outra coisa sem ninguém perceber. Mas o campo NÃO fica
   só negando — ele diz onde se troca. */
function formCargaHtml(c, m){
  const id = escJs(c.id);
  const frota = c.placa ? buscarFrota(c.placa) : null;
  return `
    <div class="mont-form">
      <div class="mont-form-tit">${esc(m.apelido_rota || m.rota_nome)}
        <span class="text-dim" style="font-weight:400">
          ${m.apelido_rota ? esc(m.rota_nome) + ' · ' : ''}${esc(m.rota_codigo)}</span></div>

      <div class="form-group" style="margin-bottom:10px">
        <span class="text-dim">✅ Esta linha já virou carga. O que você mudar aqui grava na
        CARGA — aparece na Torre de Controle, nos relatórios e para os outros setores, com
        registro de quem mudou.</span></div>

      <div class="form-row">
        <div class="form-group">
          <label>Placa</label>
          <input type="text" id="montf-placa-${esc(m.montagem_id)}" value="${esc(c.placa)}"
                 placeholder="ABC1D23" autocomplete="off"
                 onchange="atualizarPlacaUI('${id}', this.value)"></div>
        <div class="form-group">
          <label>Transportadora <span class="hint">(da Frota — dá para trocar)</span></label>
          <input type="text" list="lista-transportadoras" value="${esc(c.transportadora)}"
                 placeholder="vem da placa"
                 onchange="atualizarTransportadoraUI('${id}',this.value)"></div>
        <div class="form-group">
          <label>Tipo de Veículo <span class="hint">(da Frota)</span></label>
          <input type="text" value="${esc(c.tipoVeiculo || (frota ? frota.tipoVeiculo : ''))}"
                 placeholder="vem da placa" disabled></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Número de Carga</label>
          <input type="text" value="${esc(c.numeroCarga)}" placeholder="Ex: 10245"
                 onchange="atualizarNumeroCargaUI('${id}',this.value)"></div>
        <div class="form-group"><label>Motorista</label>
          <input type="text" value="${esc(c.motorista)}" placeholder="Nome do motorista"
                 onchange="atualizarMotoristaUI('${id}',this.value)"></div>
        <div class="form-group"><label>Tipo de Operação</label>
          ${praOndeSelectHtml(c)}</div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Peso (kg)</label>
          <input type="number" min="0" value="${c.peso ?? ''}"
                 onchange="atualizarPesoUI('${id}',this.value)"></div>
        <div class="form-group">
          <label>Sequência <span class="hint">(prioridade de montagem do dia)</span></label>
          <input type="number" min="1" value="${c.sequencia ?? ''}"
                 onchange="atualizarSequenciaUI('${id}',this.value)"></div>
        <div class="form-group"><label>Paletizada?</label>
          ${paletizadaSelectHtml(c)}</div>
      </div>

      <div class="form-row">
        ${/* Ver a nota em formMontagemHtml: os dois campos ficam na linha E
              aqui, porque gravam na MESMA carga pela mesma função — e porque
              já sumiram daqui uma vez, o que virou guarda de teste. */''}
        <div class="form-group">
          <label>Qtd. Ganchos (Gancheira) <span class="hint">0 = Liso</span></label>
          <input type="number" min="0" step="1" value="${c.qtdGanchos ?? 0}"
                 onchange="atualizarGanchosUI('${id}',this.value)"></div>
        <div class="form-group"><label>Qtd. Entregas</label>
          <input type="number" min="1" step="1" value="${c.qtdEntregas ?? 1}"
                 onchange="atualizarEntregasUI('${id}',this.value)"></div>

        <div class="form-group">
          <label>Rota <span class="hint">(vem do modelo do dia)</span></label>
          <input type="text" value="${esc(rotaCurta(c.rota))}" disabled
                 title="A rota desta linha veio do modelo do dia. Para trocar, altere na Fila de Programados ou cancele a linha e puxe a rota certa."></div>
      </div>

      <div class="form-group" style="margin-bottom:10px"><label>Observações</label>
        <textarea onchange="atualizarObservacoesUI('${id}',this.value)"
          placeholder="O que a operação precisa saber sobre esta carga">${esc(c.observacoes)}</textarea></div>

      <div class="flex-end gap8">
        <button class="btn btn-sec btn-sm"
          onclick="alternarLinhaMontagemUI('${escJs(m.montagem_id)}')">Fechar</button>
      </div>
    </div>`;
}

function linhaMontagemHtml(m){
  /* CANCELADA continua trancada: ela é histórico e não tem carga viva do
     outro lado. EFETIVADA deixa de trancar para quem pode editar — a
     linha passa a ser uma janela para a carga, não um retrato dela. */
  const cargaViva = (m.efetivada_em && m.carga_id) ? getCarga(m.carga_id) : null;
  const comoCarga = !!cargaViva && podeEditarCargaDoDia();
  const trancada = !!m.cancelada_em || (!!m.efetivada_em && !comoCarga);
  const id = escJs(m.montagem_id);
  /* A LINHA EFETIVADA VOLTA A ABRIR (27/08/2026). O `&& !comoCarga` que
     estava aqui era o defeito relatado pelo dono: ela ficava clicável e não
     abria nada, e os campos que só existem no formulário sumiam da tela. */
  const aberta = _montagemAberta === m.montagem_id && !trancada;
  const marca = m.cancelada_em
    ? `<span class="badge badge-aguardando-veiculo">CANCELADA</span>`
    : m.efetivada_em ? `<span class="badge badge-faturado">NA TORRE</span>` : '';

  /* `mont-linha-carga` marca a linha que JÁ virou carga e continua
     editável. Ela não é "linha-fraca" (não está trancada) nem uma linha em
     montagem (não tem "Criar carga"): é uma terceira situação, e sem uma
     classe própria a tela e os testes só conseguem descrevê-la por
     ausência — foi assim que a checagem "toda linha traz uma ação de
     avanço" passou a contar uma linha que, com razão, não tem nenhuma. */
  const resumo = `<tr class="mont-linha${trancada ? ' linha-fraca' : ''}${comoCarga ? ' mont-linha-carga' : ''}${aberta ? ' mont-linha-aberta' : ''}"
      ${trancada ? '' : `onclick="alternarLinhaMontagemUI('${id}')" title="Clique para abrir os campos desta carga"`}>
      <!-- SEQUENCIA EDITAVEL NA LINHA — pedido do dono (25/08/2026):
           "o campo sequencia precisa estar disponivel para edicao e
           organizacao de sequencia tambem".

           Ordenar o dia e trabalho de VARREDURA: a pessoa olha as 42
           linhas e decide quem carrega primeiro. Abrir cada formulario
           para mexer num numero e o que fazia isso ser feito no Excel.
           O stopPropagation impede que digitar abra/feche a linha. -->
      <td onclick="event.stopPropagation()">
        <input type="number" min="1" class="seq-input" value="${comoCarga ? (cargaViva.sequencia ?? '') : (m.sequencia ?? '')}"
               aria-label="Sequência"
               onchange="${comoCarga
                 ? `atualizarSequenciaUI('${escJs(cargaViva.id)}',this.value)`
                 : `alterarMontagemUI('${id}','sequencia',this.value)`}"></td>
      ${/* AS MESMAS COLUNAS DA TORRE E DA FILA (28/08/2026). Quando a linha
            já virou carga, cada célula grava na CARGA; enquanto é rascunho,
            grava na montagem. Mesma tela, mesmo lugar, dono diferente — e o
            dono certo, que é o que impede a alteração de morrer no rascunho. */''}
      ${/* NÚMERO, PLACA E PESO SE DIGITAM NA PRÓPRIA LINHA (28/08/2026).

            Relato do dono, com foto da tela de hoje: "ficou faltando os
            campos rota peso numero de carga, veiculo ta aparecendo sem
            placa, porque nao estao editaveis???".

            Estas três células eram TEXTO enquanto a linha era rascunho:
            mostravam "—" e não recebiam nada. O único campo que aceitava
            digitação na linha era o de Motorista — e foi exatamente lá que
            as placas do dia foram parar (RNT5J03, RNV2A77...), porque era
            o único lugar onde dava para escrever. Coluna que mostra um
            traço e não aceita o dado ensina a pessoa a guardá-lo no campo
            errado.

            O servidor já aceitava os quatro campos desde sempre; faltava a
            tela oferecer. */''}
      <td onclick="event.stopPropagation()">${comoCarga
            ? celulaCargaHtml(cargaViva, 'numero')
            : `<input type="text" class="numero-carga-input" value="${esc(m.numero_carga)}"
                      placeholder="—" aria-label="Número da carga"
                      onchange="alterarMontagemUI('${id}','numeroCarga',this.value)">`}</td>
      <td class="cel-veiculo" onclick="event.stopPropagation()">${comoCarga
            ? celulaCargaHtml(cargaViva, 'placa')
            : `<input type="text" class="placa-input" value="${esc(m.placa)}"
                      list="lista-placas-frota" placeholder="sem placa" autocomplete="off"
                      aria-label="Placa do veículo"
                      onchange="definirPlacaMontagemUI('${id}', this.value)">`}
        <span class="veic-transp">${esc(comoCarga ? cargaViva.transportadora
            : (m.transportadora || (m.placa && buscarFrota(m.placa) ? buscarFrota(m.placa).transportadora : ''))) || '—'}</span>
        <span class="veic-tipo">${esc(comoCarga ? cargaViva.tipoVeiculo
            : (m.placa && buscarFrota(m.placa) ? buscarFrota(m.placa).tipoVeiculo : '')) || '—'}</span></td>
      <td onclick="event.stopPropagation()">
        <input type="text" class="motorista-input" value="${esc(comoCarga ? (cargaViva.motorista||'') : (m.motorista||''))}"
               aria-label="Motorista"
               onchange="${comoCarga
                 ? `atualizarMotoristaUI('${escJs(cargaViva.id)}',this.value)`
                 : `alterarMontagemUI('${id}','motorista',this.value)`}"></td>
      <td ${comoCarga ? '' : 'onclick="event.stopPropagation()"'}>${comoCarga
            ? `${destinoMontagemHtml(m)} ${marca}`
            : `${rotaMontagemSelectHtml(m)} ${marca}`}</td>
      <td onclick="event.stopPropagation()">${comoCarga
            ? celulaCargaHtml(cargaViva, 'peso')
            : `<input type="number" min="0" class="peso-input" value="${m.peso ?? ''}"
                      placeholder="—" aria-label="Peso em quilos"
                      onchange="alterarMontagemUI('${id}','peso',this.value)">`}</td>

      <td onclick="event.stopPropagation()">${comoCarga
            ? paletizadaSelectHtml(cargaViva)
            : `<select class="palet-inline" onchange="alterarMontagemUI('${id}','paletizada',this.value)">
                 ${['Não','Sim'].map(op=>`<option value="${op}" ${(m.paletizada||'Não')===op?'selected':''}>${op}</option>`).join('')}
               </select>`}</td>
      <td onclick="event.stopPropagation()">${comoCarga
            ? praOndeSelectHtml(cargaViva)
            : `<select class="praonde-inline" onchange="alterarMontagemUI('${id}','tipoOperacao',this.value)">
                 <option value=""${!m.tipo_operacao ? ' selected' : ''}>—</option>
                 ${PRA_ONDE_OPCOES.map(o=>`<option${m.tipo_operacao===o?' selected':''}>${esc(o)}</option>`).join('')}
               </select>`}</td>
      ${/* GANCHOS E ENTREGAS NA LINHA — pedido do dono (31/08/2026):
            "ta faltando o campo de quantidade de entregar e quantidade de
            ganchos igual na torre, precisa aparecer na programacao do dia"
            e "precisa aparecer e funcionar".

            O servidor já aceitava os dois no PATCH da montagem e a tabela já
            tinha `qtd_entregas` e `qtd_ganchos` desde a migração que criou a
            montagem — faltava só a tela oferecer. Mesma história das quatro
            colunas de 28/08: o dado tinha onde morar e ninguém tinha onde
            digitar.

            Como nas outras: virou carga, grava na CARGA (que tem log de
            revisões); ainda rascunho, grava na montagem. */''}
      <td class="c-ganchos" onclick="event.stopPropagation()">${comoCarga
            ? `<input type="number" class="ganchos-input" min="0" step="1"
                      value="${cargaViva.qtdGanchos ?? 0}" aria-label="Ganchos"
                      title="Ganchos — 0 = Liso"
                      onchange="atualizarGanchosUI('${escJs(cargaViva.id)}',this.value)">`
            : `<input type="number" class="ganchos-input" min="0" step="1"
                      value="${m.qtd_ganchos ?? 0}" aria-label="Ganchos"
                      title="Ganchos — 0 = Liso"
                      onchange="alterarMontagemUI('${id}','qtdGanchos',this.value)">`}</td>
      <td class="c-entregas" onclick="event.stopPropagation()">${comoCarga
            ? `<input type="number" class="entregas-input" min="1" step="1"
                      value="${cargaViva.qtdEntregas ?? 1}" aria-label="Entregas"
                      title="Quantidade de entregas."
                      onchange="atualizarEntregasUI('${escJs(cargaViva.id)}',this.value)">`
            : `<input type="number" class="entregas-input" min="1" step="1"
                      value="${m.qtd_entregas ?? 1}" aria-label="Entregas"
                      title="Quantidade de entregas."
                      onchange="alterarMontagemUI('${id}','qtdEntregas',this.value)">`}</td>
      <td class="no-print">${trancada
            ? acoesMontagemHtml(m, trancada)
            : comoCarga ? acoesCargaNaMontagemHtml(aberta)
            : acoesLinhaMontagemHtml(m, aberta)}</td>
    </tr>`;

  if(!aberta) return resumo;
  return resumo + `<tr class="mont-detalhe"><td colspan="11">${
    comoCarga ? formCargaHtml(cargaViva, m) : formMontagemHtml(m)}</td></tr>`;
}

/* O DIA EM PLANILHA — para o registro que a Suinco sempre teve.

   Pedido do dono (25/08/2026): "quero poder exportar por dia tudo isso no
   formato excel para seguir o padrão que era antes pelo menos para
   registro, ou relatório de rota do dia".

   O painel substituiu a planilha na OPERAÇÃO, e isso é o ponto dele: a
   planilha também era o ARQUIVO. Quem precisa responder "como foi o dia 21"
   daqui a seis meses abria o arquivo daquele dia. Tirar isso sem repor
   troca um problema por outro.

   CSV com ponto-e-vírgula e BOM, não .xlsx: é o que o Excel em português
   abre com duplo clique e colunas separadas, sem biblioteca nova dentro do
   painel — e o painel é um arquivo só, sem CDN. O BOM não é detalhe: sem
   ele o Excel pt-BR abre "Ç" como lixo, o que já apareceu em campo.

   As colunas seguem a ORDEM DA PLANILHA ANTIGA (Sequência, Carga, Rota,
   Pra onde, Placa, Transportadora, Perfil, Peso, Paletizada), com as que
   o painel acrescentou no fim. Quem abrir vai reconhecer o arquivo. */
async function exportarMontagemDoDiaUI(){
  if(!_montagemDia){ notify('Escolha o dia primeiro.', 'erro', 4000); return; }
  const { dia, montagens } = _montagemDia;
  const vivas = montagens.filter(m => !m.cancelada_em);
  if(!vivas.length){
    notify('Não há cargas montadas neste dia para exportar.', 'warn', 5000);
    return;
  }
  const frotaDe = (placa) => (placa ? buscarFrota(placa) : null) || {};
  const linhas = vivas.map(m => {
    const f = frotaDe(m.placa);
    return [
      m.sequencia ?? '',
      m.numero_carga || '',
      m.apelido_rota || m.rota_nome || '',
      m.tipo_operacao || '',
      m.placa || '',
      /* A transportadora do DIA na frente da do cadastro. Se o arquivo do
         dia mostrasse sempre a da Frota, a exceção que alguém registrou de
         propósito (subcontratação, freteiro) sumiria justamente no papel
         que existe para ser o registro — e quem conferisse o frete seis
         meses depois leria o transportador errado. */
      m.transportadora || f.transportadora || '',
      f.tipoVeiculo || '',
      // Vírgula decimal: é o que o Excel pt-BR entende como número.
      m.peso ? String((Number(m.peso) / 1000).toFixed(1)).replace('.', ',') : '',
      m.paletizada || '',
      m.qtd_entregas ?? '',
      m.qtd_ganchos ?? '',
      m.rota_codigo || '',
      m.motorista || '',
      m.observacoes || '',
      /* O desfecho no papel: sem ele, o arquivo do dia não distingue a
         carga que rodou da que ficou só planejada. */
      m.efetivada_em ? 'Na Torre' : (m.placa ? 'Com placa' : 'Sem placa'),
    ];
  });
  baixarCsvDoDia(`Programacao_${dia}`, [
    'Sequência', 'Carga', 'Rota', 'Pra onde?', 'Placa', 'Transportadora',
    'Perfil', 'Peso (t)', 'Paletizada', 'Entregas', 'Ganchos',
    'Código da rota', 'Motorista', 'Observações', 'Situação',
  ], linhas);
}

/* Mesmo escapamento e mesmo BOM de baixarCsvCadastro — separado só porque
   o nome do arquivo é outro (o dia, não o cadastro) e porque este some se
   alguém mexer nos cadastros amanhã. */
function baixarCsvDoDia(nome, cabecalhos, linhas){
  const escapa = (v) => {
    const t = String(v ?? '');
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const corpo = [cabecalhos, ...linhas].map(l => l.map(escapa).join(';')).join('\r\n');
  const blob = new Blob(['\ufeff' + corpo], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Suinco_${nome}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  notifyGravacao(`Programação do dia exportada: ${linhas.length} carga(s).`);
}

/* CARGA FORA DO MODELO — porque frete extra não é exceção rara.

   O modelo cobre a semana típica. Cliente novo, reforço de última hora e
   carga que a fábrica soltou depois do fechamento acontecem toda semana, e
   sem uma porta para eles a Logística sai desta tela e cria a carga na aba
   de cima — o dia deixa de estar todo num lugar só, e a contagem de "rotas
   do modelo sem carga" passa a mentir.

   A linha nasce SEM apelido de rota: ela não veio de planilha nenhuma, e
   inventar um apelido faria uma carga avulsa parecer parte do template na
   hora de conferir o dia. */
async function adicionarCargaForaDoModeloUI(){
  if(!_montagemDia){ notify('Escolha o dia primeiro.', 'erro', 4000); return; }
  const rota = (document.getElementById('mont-rota-extra') || {}).value;
  if(!rota){ notify('Escolha a rota da carga.', 'erro', 4000); return; }
  const { dia, montagens } = _montagemDia;
  try {
    await SuincoSharePoint.montagem.criar({
      dia, rotaCodigo: rota,
      sequencia: montagens.length + 1,
      qtdEntregas: 1, paletizada: 'Não',
    });
  } catch(e){
    notify('Não consegui adicionar: ' + (e && e.message || e), 'erro', 8000);
    return;
  }
  await carregarMontagemUI();
  /* Abre a linha nova na hora: quem clicou em "adicionar" vai preencher
     agora, e procurar a linha recém-criada numa lista de 39 é trabalho
     que a tela pode poupar. */
  const nova = (_montagemDia?.montagens || [])
    .filter(m => m.rota_codigo === rota && !m.efetivada_em && !m.cancelada_em).pop();
  if(nova){
    _montagemAberta = nova.montagem_id;
    renderMontagem();
    const foco = document.getElementById(`montf-placa-${nova.montagem_id}`);
    if(foco) foco.focus();
  }
  notify(`Linha de ${rotaLabel(rota)} adicionada ao dia.`, 'ok', 4000);
}

/* O BOTÃO DE CRIAR CARGA MORA NA LINHA, não só dentro do formulário.

   Eu tinha movido as ações para dentro do formulário quando a linha virou
   expansível, e isso foi um retrocesso: numa sexta de 39 cargas, mandar
   uma para a Torre passava a exigir abrir a linha, clicar, e a linha
   fechar sozinha. Três passos para o que era um.

   O formulário é para PREENCHER; a linha é para AGIR. As duas coisas
   convivem, e sem placa a linha não nega o clique: oferece o passo que
   falta (ver o comentário do botão, logo abaixo).

   stopPropagation é obrigatório: a linha inteira é clicável para abrir, e
   sem isso criar a carga abriria o formulário de uma linha que acabou de
   virar leitura. */
function acoesLinhaMontagemHtml(m, aberta){
  const id = escJs(m.montagem_id);
  /* SEM PLACA, O BOTAO OFERECE O QUE E POSSIVEL AGORA (25/08/2026).

     Relato do dono, com foto da tela: "por que nao consigo clicar em cima
     de criar carga?????". A resposta era "porque a linha esta sem placa" —
     e o botao dizia isso num `title` que so aparece parado em cima dele,
     depois de tentar clicar.

     O mecanismo funcionava (desabilitado, cursor de proibido, aviso no
     hover). O problema e outro: treze linhas com um botao dourado que nao
     aperta e um beco sem saida. Botao desabilitado nao ensina o caminho,
     so nega.

     Agora, sem placa, o botao E o caminho: abre a linha com o cursor no
     campo da placa. Uma acao a menos e nenhuma negativa. */
  const criar = m.placa
    ? `<button class="btn btn-primary btn-sm mont-btn-criar"
         onclick="event.stopPropagation(); efetivarMontagemUI('${id}')"
         title="Cria a carga e manda para a Torre de Controle.">➕ Criar carga</button>`
    : `<button class="btn btn-sec btn-sm mont-btn-placa"
         onclick="event.stopPropagation(); abrirParaColocarPlacaUI('${id}')"
         title="A carga so existe com placa cadastrada na Frota. Clique para colocar.">🚚 Colocar placa</button>`;
  /* EXCLUIR NA PRÓPRIA LINHA — pedido do dono (25/08/2026).

     A linha que não vai rodar hoje (rota que não saiu, carga que a
     fábrica cancelou) tinha que ser aberta para ser tirada. Numa sexta de
     42 linhas isso é um clique a mais em cada uma que sobra.

     "Cancelar", não "apagar": a linha some da montagem e continua no
     banco com o motivo e a hora — programação que se apaga sem rastro é
     como o Excel era, e é o que este painel existe para acabar. */
  return `<div class="mont-acoes">${criar}
    <button class="btn btn-danger btn-sm mont-btn-excluir"
      onclick="event.stopPropagation(); cancelarMontagemUI('${id}')"
      title="Tira esta linha do dia. Fica registrada, com o motivo.">Excluir</button>
    <span class="mont-seta${aberta ? ' aberta' : ''}" aria-hidden="true">▸</span></div>`;
}

/* O formulário de uma carga da montagem.

   A ROTA NÃO É EDITÁVEL AQUI de propósito: a linha nasceu de uma rota do
   modelo, e trocar a rota transformaria "a segunda saída de Patos" em
   outra coisa sem ninguém perceber. Quem errou a rota cancela a linha e
   puxa a certa — é uma ação a mais e uma confusão a menos.

   Tipo de Veículo não é campo: vem da Frota pela placa, e deixar alguém
   digitar por cima criaria uma segunda verdade sobre o mesmo caminhão. O
   aviso abaixo da placa mostra o que a Frota respondeu.

   TRANSPORTADORA É EXCEÇÃO, a pedido do dono (25/08/2026): "transportadora
   também". A Frota diz de quem é o caminhão; quem carrega aquele dia pode
   ser outra — subcontratação e troca de última hora acontecem, e antes
   isso era escrito na planilha sem discussão. O campo vazio significa "o
   que a Frota disser"; preenchido, vale só para esta carga e não mexe no
   cadastro do veículo. */
function formMontagemHtml(m){
  const id = escJs(m.montagem_id);
  const alt = (campo) => `onchange="alterarMontagemUI('${id}','${campo}',this.value)"`;
  const frota = m.placa ? buscarFrota(m.placa) : null;
  return `
    <div class="mont-form">
      <div class="mont-form-tit">${esc(m.apelido_rota || m.rota_nome)}
        <span class="text-dim" style="font-weight:400">
          ${m.apelido_rota ? esc(m.rota_nome) + ' · ' : ''}${esc(m.rota_codigo)}</span></div>

      <div class="form-row">
        <div class="form-group">
          <label>Placa <span class="hint">(quando o transporte for contratado)</span></label>
          <input type="text" id="montf-placa-${esc(m.montagem_id)}" value="${esc(m.placa)}"
                 placeholder="ABC1D23" autocomplete="off"
                 onchange="definirPlacaMontagemUI('${id}', this.value)">
        </div>
        <div class="form-group">
          <label>Transportadora <span class="hint">(da Frota — dá para trocar)</span></label>
          <input type="text" list="lista-transportadoras"
                 value="${esc(m.transportadora || (frota ? frota.transportadora : ''))}"
                 placeholder="vem da placa"
                 onchange="alterarMontagemUI('${id}','transportadora',this.value)">
        </div>
        <div class="form-group">
          <label>Tipo de Veículo <span class="hint">(da Frota)</span></label>
          <input type="text" value="${esc(frota ? frota.tipoVeiculo : '')}"
                 placeholder="vem da placa" disabled>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:10px">${avisoFrotaMontagemHtml(m)}</div>

      <div class="form-row">
        <div class="form-group"><label>Número de Carga</label>
          <input type="text" value="${esc(m.numero_carga)}" placeholder="Ex: 10245"
                 ${alt('numeroCarga')}></div>
        <div class="form-group"><label>Motorista</label>
          <input type="text" value="${esc(m.motorista)}" placeholder="Nome do motorista"
                 ${alt('motorista')}></div>
        <div class="form-group"><label>Tipo de Operação</label>
          <select ${alt('tipoOperacao')}>
            <option value=""${!m.tipo_operacao ? ' selected' : ''}>—</option>
            ${PRA_ONDE_OPCOES.map(o =>
              `<option${m.tipo_operacao === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}
          </select></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Peso (kg)</label>
          <input type="number" min="0" value="${m.peso ?? ''}" ${alt('peso')}></div>
        <div class="form-group">
          <label>Sequência <span class="hint">(prioridade de montagem do dia)</span></label>
          <input type="number" min="1" value="${m.sequencia ?? ''}" ${alt('sequencia')}></div>
        <div class="form-group"><label>Paletizada?</label>
          <select ${alt('paletizada')}>
            <option${m.paletizada === 'Não' ? ' selected' : ''}>Não</option>
            <option${m.paletizada === 'Sim' ? ' selected' : ''}>Sim</option>
          </select></div>
      </div>

      ${/* GANCHOS E ENTREGAS FICAM NOS DOIS LUGARES (31/08/2026).

            Eles subiram para a LINHA a pedido do dono ("precisa aparecer e
            funcionar"), e eu os tinha tirado daqui seguindo a regra do
            "mesmo campo em dois lugares". A bateria mostrou que a regra não
            se aplica: existe uma guarda dizendo "com Qtd. Entregas e Qtd.
            Ganchos, QUE ERA O QUE SUMIU" — eles já desapareceram daqui uma
            vez e viraram incidente.

            A regra do não-duplicar existe para campo que grava em lugares
            DIFERENTES (foi o caso do Tipo de Operação). Aqui os dois gravam
            na mesma carga, pela mesma função: alterar num reflete no outro
            no próximo desenho da tela. */''}
      <div class="form-row">
        <div class="form-group">
          <label>Qtd. Ganchos (Gancheira) <span class="hint">0 = Liso</span></label>
          <input type="number" min="0" step="1" value="${m.qtd_ganchos ?? 0}" ${alt('qtdGanchos')}></div>
        <div class="form-group"><label>Qtd. Entregas</label>
          <input type="number" min="1" step="1" value="${m.qtd_entregas ?? 1}" ${alt('qtdEntregas')}></div>
      </div>

      <div class="form-group" style="margin-bottom:10px"><label>Observações</label>
        <textarea ${alt('observacoes')} placeholder="O que a operação precisa saber sobre esta carga">${esc(m.observacoes)}</textarea></div>

      <div class="flex-end gap8">
        <button class="btn btn-sec btn-sm" onclick="cancelarMontagemUI('${id}')">Cancelar esta linha</button>
        <button class="btn btn-sec btn-sm" onclick="alternarLinhaMontagemUI('${id}')">Fechar</button>
        ${m.placa
          ? `<button class="btn btn-primary btn-sm mont-btn-criar" onclick="efetivarMontagemUI('${id}')"
               title="Cria a carga e manda para a Torre de Controle.">➕ Criar carga</button>`
          /* Mesmo motivo da linha (ver acoesLinhaMontagemHtml): botao
             desabilitado nega sem ensinar. Aqui o campo da placa esta a
             quatro linhas de distancia, entao o botao leva o cursor ate
             ele em vez de so ficar apagado. */
          : `<button class="btn btn-sec btn-sm mont-btn-placa"
               onclick="abrirParaColocarPlacaUI('${id}')"
               title="A carga so existe com placa cadastrada na Frota. Clique para colocar.">🚚 Colocar placa</button>`}
      </div>
    </div>`;
}

/* O mesmo aviso da aba Programação, pelo mesmo motivo: placa fora da Frota
   BLOQUEIA a criação da carga, e descobrir isso só na hora de clicar em
   "Criar carga" é tarde. Aqui a pessoa vê no momento em que digita. */
function avisoFrotaMontagemHtml(m){
  if(!m.placa) return '<span class="text-dim">Sem placa ainda — a linha fica no planejamento.</span>';
  const f = buscarFrota(m.placa);
  if(f){
    return '<span class="text-dim">✅ Placa encontrada na Frota — Transportadora e Tipo de Veículo '
      + 'vêm dela automaticamente.</span>';
  }
  return '<span style="color:var(--wine-light)">⛔ Placa não cadastrada na Frota — a criação da carga '
    + 'será BLOQUEADA.</span> <span class="text-dim">Cadastre em Cadastros → Frota.</span>';

}

function acoesMontagemHtml(m, trancada){
  const id = escJs(m.montagem_id);
  if(m.cancelada_em) return `<span class="text-dim" title="${esc(m.motivo_cancelo)}">cancelada</span>`;
  if(m.efetivada_em) return `<span class="text-dim">virou carga</span>`;
  /* O botão de efetivar só aparece com placa. Sem placa ele existiria só
     para dizer "não" — o defeito que a ocorrência #13 registrou. */
  const criar = m.placa
    ? `<button class="btn btn-primary btn-sm" onclick="efetivarMontagemUI('${id}')"
         title="Cria a carga e manda para a Torre de Controle.">➕ Criar carga</button>`
    : '';
  return `${criar}
    <button class="btn btn-sec btn-sm" onclick="cancelarMontagemUI('${id}')">Cancelar</button>`;
}

/* Puxa do modelo as rotas deste dia da semana que ainda não têm carga.
   Não apaga nem duplica o que já existe: rodar duas vezes seguidas não
   faz nada na segunda. */
/* O QUE AINDA FALTA MONTAR DO MODELO — UMA FUNÇÃO, DOIS CHAMADORES.

   Extraída de `aplicarModeloDoDiaUI` em 28/08/2026, e o motivo é um
   vermelho: o teste do dia reimplementava esta conta com um Set de códigos
   de rota — a PRIMEIRA versão desta lógica, abandonada justamente por
   errar. Ele passava por sorte, enquanto as linhas já montadas tivessem
   códigos distintos; no dia em que duas montagens caíram na mesma praça,
   ele acusou 38 onde o painel oferece 37.

   Teste que reimplementa a regra não testa a regra: testa a cópia que ele
   mesmo escreveu. Agora existe UMA conta, aqui, e quem quiser saber o que
   falta — a tela ou a prova — pergunta para ela.

   CONTA por rota, não presença.

   O modelo prevê a MESMA praça mais de uma vez no mesmo dia — duas
   saídas para Patos de Minas na sexta é rotina, e por isso o índice
   único é (dia, rota, ordem) e não (dia, rota).

   A primeira versão filtrava com um Set de rotas já montadas: bastava
   uma carga de Patos existir para as OUTRAS saídas de Patos sumirem da
   oferta. Na sexta isso escondia 20 das 39 cargas do dia. */
  /* CASA POR LINHA DO MODELO, NAO POR CODIGO DE ROTA (25/08/2026).

   Relato do dono: "ta tudo duplicado ainda na montagem do dia".

   As duas versoes anteriores erraram no mesmo lugar, cada uma de um
   jeito. A primeira usava um Set de codigos: bastava uma carga de Patos
   existir para as OUTRAS saidas de Patos sumirem da oferta. A segunda
   passou a CONTAR por codigo — resolveu o sumico e criou a duplicata.

   Contagem nao resolve ambiguidade. Na terca, Arinos/Buritis, Joao
   Pinheiro, Paracatu, Riachinho e Unai sao todos o codigo 504: contando,
   o painel sabe que "faltam 2 de 504" e nao sabe QUAIS 2. Puxa duas
   quaisquer, e o dia fica com Joao Pinheiro repetido e Unai faltando.

   Identidade resolve. Cada montagem guarda a linha do modelo que a
   originou (migracao 035), e a pergunta passa a ser exata: esta linha ja
   virou carga hoje?

   E QUANDO A MIGRACAO AINDA NAO SUBIU? (26/08/2026)

   A versao anterior desta funcao so sabia casar por modelo_id. Num
   servidor sem a migracao 035 esse campo simplesmente nao existe, entao
   NADA casava: cada clique em "puxar o modelo" recriava o dia inteiro.
   Foi o que a apuracao de 25/08 mostrou — 53 linhas na montagem, quase
   todas vazias e em pares, uma unica virando carga.

   Isso foi erro meu de projeto, nao do servidor: escrevi uma correcao
   que so funciona depois que outra coisa acontece, e sem plano B ela
   falha do jeito mais barulhento possivel. Agora ha plano B.

   O plano B e ROTA + APELIDO, e ele funciona porque a migracao 034 (essa
   sim ja aplicada) moveu o destino da planilha para apelido_rota. As
   seis linhas de codigo 504 da terca — Arinos, Joao Pinheiro, Paracatu,
   Riachinho, Unai — tem apelidos DIFERENTES. O que era ambiguo contando
   por codigo deixa de ser ao olhar o destino.

   E CONTAGEM, nao presenca: o modelo preve a mesma praca duas vezes no
   mesmo dia (duas saidas para Montes Claros na sexta), e um Set faria a
   segunda sumir da oferta. Cada montagem existente consome UMA linha do
   modelo; o que sobrar e o que ainda falta montar.

   Os dois criterios convivem porque o dia seguinte a uma migracao tem os
   dois tipos de linha na mesma tela: a antiga sem modelo_id e a nova com
   ele. Casar so por um dos dois traria a duplicata de volta pela metade. */
function linhasDoModeloQueFaltam(modelo, montagens){
  const contagem = new Map();
  const chaveExata   = (x) => `id:${x.modelo_id}`;
  const chaveDestino = (x) => `rt:${x.rota_codigo || ''}¦${x.apelido_rota || ''}`;

  for(const g of (montagens || [])){
    if(g.cancelada_em) continue;
    /* CARGA AVULSA NAO CONSOME LINHA DO MODELO — e isso e deliberado.

       O comentario antigo aqui dizia o contrario ("se alguem ja montou Unai
       na mao, o modelo nao precisa oferecer Unai de novo") e o codigo nunca
       fez isso: a linha feita a mao tem rota mas NAO tem apelido, e a chave
       de destino do modelo tem ("rt:504¦Unai"). As duas nunca casaram.
       Medido em 28/08/2026, com dois avulsos de rota 500 e um modelo que
       tem "500 ¦ Patos de Minas": consumo zero.

       E o comportamento CERTO, e o comentario e que estava errado. Uma
       carga extra na rota 500 nao e a saida de Patos de Minas prevista para
       o dia — e frete a mais. Deixar ela apagar a linha prevista seria uma
       rota que nao embarca, e ninguem descobre: linha que some da oferta
       nao aparece em lugar nenhum. Oferecer uma linha a mais aparece: a
       pessoa le a lista antes de confirmar e cancela o que nao quer.

       Vale a mesma razao do 504 mais abaixo — sem apelido nao da para saber
       QUAL destino a avulsa atende, e escolher um no chute e o defeito que
       a contagem por codigo produzia. */
    const k = g.modelo_id != null ? chaveExata(g) : chaveDestino(g);
    contagem.set(k, (contagem.get(k) || 0) + 1);
  }

  const consumir = (k) => {
    const n = contagem.get(k) || 0;
    if(n <= 0) return false;
    contagem.set(k, n - 1);
    return true;
  };

  // Tenta a identidade exata primeiro; so cai no destino se ela nao casar.
  return (modelo || []).filter(m =>
    !consumir(chaveExata(m)) && !consumir(chaveDestino(m)));
}

async function aplicarModeloDoDiaUI(){
  if(!_montagemDia) return;
  const { dia, modelo, montagens } = _montagemDia;
  const novas = linhasDoModeloQueFaltam(modelo, montagens);
  /* Duas situações MUITO diferentes que davam a mesma resposta, e a
     resposta era falsa quando o modelo estava vazio: dizer "já estão
     montadas" para quem nunca cadastrou rota nenhuma manda a pessoa
     procurar um erro que não existe. */
  if(!modelo.length){
    notify(`Não há rotas cadastradas para ${NOMES_DIA[_montagemDia.diaSemana]} ainda. `
      + 'Cadastre em "Rotas por dia da semana", logo abaixo.', 'erro', 8000);
    return;
  }
  if(!novas.length){
    notify('Todas as rotas do modelo deste dia já estão montadas.', '', 5000);
    return;
  }
  if(!confirm(`Criar ${novas.length} carga(s) a partir do modelo de ${NOMES_DIA[_montagemDia.diaSemana]}?`)) return;
  let criadas = 0, erros = [];
  for(const [i, m] of novas.entries()){
    try {
      await SuincoSharePoint.montagem.criar({
        dia, rotaCodigo: m.rota_codigo, sequencia: montagens.length + i + 1,
        modeloId: m.modelo_id,
        tipoOperacao: m.tipo_operacao, qtdEntregas: m.qtd_entregas || 1,
        paletizada: m.paletizada || 'Não',
        /* O nome como a operação o conhece ("Brasília - Versatto") viaja
           junto, mas em CAMPO PRÓPRIO: `observacoes` é da pessoa que monta
           a carga, e o apelido apagaria o que ela escreveu. */
        apelidoRota: m.apelido_rota || '',
      });
      criadas += 1;
    } catch(e){ erros.push(`${m.rota_nome}: ${e.message || e}`); }
  }
  await carregarMontagemUI();
  if(erros.length){
    notify(`${criadas} criada(s), ${erros.length} com problema — ${erros[0]}`, 'erro', 9000);
  } else {
    notify(`${criadas} carga(s) montada(s) a partir do modelo.`, 'ok', 5000);
  }
}

async function alterarMontagemUI(id, campo, valor){
  try {
    await SuincoSharePoint.montagem.alterar(id, { [campo]: valor });
    await carregarMontagemUI();
  } catch(e){
    notify('Não gravou: ' + (e.message || e), 'erro', 7000);
    await carregarMontagemUI();   // devolve a tela ao que o servidor tem
  }
}

/* Pôr, tirar ou trocar a placa. É o movimento que a planilha permitia o
   dia inteiro e o painel não permitia — e por isso tem tratamento
   próprio: a mensagem de placa fora da Frota precisa ensinar onde
   resolver, e a de placa repetida precisa dizer que já está em outra
   linha de hoje. */
async function definirPlacaMontagemUI(id, valor){
  /* A PLACA TRAZ O QUE A FROTA JÁ SABE (28/08/2026).

     Relato do dono: "as placas que estão neles não estão puxando direto as
     infos da placa como veículo". Transportadora e tipo de veículo já eram
     lidos da Frota na hora de desenhar a linha; o MOTORISTA não — ficava
     em branco mesmo com a Frota sabendo quem dirige aquele caminhão, e a
     pessoa redigitava um dado que o painel já tinha.

     Só preenche o que está VAZIO. Motorista escrito à mão é a exceção do
     dia (folga, troca de turno) e sobrescrevê-lo com o cadastro apagaria
     justamente a informação que alguém se deu ao trabalho de registrar. */
  const linha = ((_montagemDia || {}).montagens || []).find(m => m.montagem_id === id) || {};
  const mudanca = { placa: valor };
  const f = valor ? buscarFrota(valor) : null;
  if(f){
    if(!String(linha.motorista || '').trim() && f.motorista) mudanca.motorista = f.motorista;
    if(!String(linha.transportadora || '').trim() && f.transportadora) mudanca.transportadora = f.transportadora;
  }
  try {
    await SuincoSharePoint.montagem.alterar(id, mudanca);
    await carregarMontagemUI();
  } catch(e){
    notify(e.message || String(e), 'erro', 9000);
    await carregarMontagemUI();
  }
}

async function cancelarMontagemUI(id){
  const motivo = prompt('Por que esta rota não sai hoje?');
  if(motivo === null) return;
  if(!motivo.trim()){ notify('Precisa dizer o motivo.', 'erro', 5000); return; }
  try {
    await SuincoSharePoint.montagem.cancelar(id, motivo.trim());
    await carregarMontagemUI();
    notify('Rota marcada como não programada hoje.', 'ok', 4000);
  } catch(e){ notify('Não consegui cancelar: ' + (e.message || e), 'erro', 7000); }
}

/* A PONTE. Cria a carga pelo caminho de sempre e só então avisa o servidor
   de que a montagem virou aquela carga.

   A ordem importa: se avisasse primeiro e a criação falhasse (placa fora
   da Frota, recusa do servidor), a montagem ficaria marcada como
   efetivada apontando para uma carga que não existe. */
/* ENVIO EM LOTE — o pedágio que faria a pessoa voltar para o Excel.

   A confirmação carga a carga é deliberada (ver efetivarMontagemUI), mas
   na sexta são 39 linhas. Trinta e nove cliques não é cuidado, é castigo,
   e tela que castiga é tela que a operação abandona.

   O lote pergunta UMA vez, listando o que vai mandar, e segue em frente
   quando uma linha falha: uma placa que saiu da Frota entre a montagem e o
   clique não pode travar as outras 38. No fim, diz quantas foram e quais
   não foram, com o motivo de cada uma. */
async function efetivarLoteMontagemUI(){
  const prontas = (_montagemDia?.montagens || [])
    .filter(m => m.placa && !m.efetivada_em && !m.cancelada_em);
  if(!prontas.length){
    notify('Nenhuma linha com placa para enviar.', 'warn', 5000);
    return;
  }
  const nomes = prontas.map(m => `${m.rota_nome} (${m.placa})`).join('\n');
  const ok = confirm(`Criar ${prontas.length} carga(s) e mandar para a Torre de Controle?\n\n`
    + nomes + '\n\nDepois disso elas aparecem para a Portaria e a Expedição.');
  if(!ok) return;

  let criadas = 0;
  const erros = [];
  for(const m of prontas){
    try{
      await efetivarMontagemUI(m.montagem_id, { silencioso: true });
      criadas += 1;
    }catch(e){
      erros.push(`${m.rota_nome}: ${e && e.message || e}`);
    }
  }
  await carregarMontagemUI();
  renderAll();
  if(criadas) notify(`${criadas} carga(s) criada(s) e na Torre de Controle.`, 'ok', 6000);
  if(erros.length){
    notify(`${erros.length} não foi/foram criada(s):\n` + erros.join('\n'), 'erro', 12000);
  }
}

/* CRIAR A CARGA — o momento em que planejamento vira operação.

   POR QUE UM CLIQUE, E NÃO AUTOMÁTICO AO DIGITAR A PLACA. A pergunta veio
   do gestor (25/08/2026), e a resposta é o custo do erro nos dois lados.

   Automático: o campo da placa grava ao sair dele. Um dígito errado, um
   autocompletar do navegador, um Tab sem querer — e existe carga de
   verdade na Torre. Desfazer custa ir na Torre, cancelar, e torcer para a
   Portaria não ter registrado chegada no meio do caminho.

   Com clique: o custo do erro é fechar o formulário. A montagem é um
   RASCUNHO — placa entra, sai, troca de linha, transportadora desiste — e
   rascunho não pode vazar para a tela que a operação usa para trabalhar.

   O clique não é "tem certeza?". É a fronteira entre as duas tabelas.
   E para o pedágio não pesar, existe o envio em lote logo acima.

   `silencioso` é para o lote: ele avisa uma vez no fim, em vez de despejar
   39 avisos na tela. Nesse modo os erros SOBEM (throw) em vez de virar
   aviso, para o lote poder contá-los e seguir com as outras linhas. */
async function efetivarMontagemUI(id, { silencioso = false } = {}){
  const m = (_montagemDia?.montagens || []).find(x => x.montagem_id === id);
  if(!m) return;
  if(!m.placa){
    const erro = new Error('Coloque a placa antes de criar a carga.');
    if(silencioso) throw erro;
    notify(erro.message, 'erro', 5000);
    return;
  }
  let carga;
  try {
    carga = criarCargaProgramada({
      placa: m.placa,
      numeroCarga: m.numero_carga,
      rota: m.rota_codigo,
      peso: m.peso,
      sequencia: m.sequencia,
      praOnde: m.tipo_operacao,
      paletizada: m.paletizada,
      qtdGanchos: m.qtd_ganchos,
      qtdEntregas: m.qtd_entregas,
      motorista: m.motorista,
      /* Vazio = o que a Frota diz (criarCargaProgramada resolve pela
         placa). Preenchido = a exceção do dia — subcontratação, freteiro,
         veículo emprestado —, e aí é ela que vale. */
      transportadora: m.transportadora || '',
      /* O apelido da rota entra na frente da observação, não no lugar
         dela: quem lê a carga na Torre precisa saber que "517" é a Ômega,
         e a Logística precisa que o recado dela sobreviva. */
      observacoes: [m.apelido_rota, m.observacoes].filter(Boolean).join(' — '),
      operador: DB.operador ? DB.operador.nome : '',
    });
  } catch(e){
    if(silencioso) throw e;
    notify(e.message || String(e), 'erro', 9000);
    return;
  }
  try {
    await SuincoSharePoint.montagem.efetivar(id, carga.id);
  } catch(e){
    /* A carga JÁ existe e já está na Torre — este aviso é sobre o elo
       entre planejamento e execução, não sobre a carga. Dizer que "não
       criou" seria mentira e faria alguém criar de novo. */
    notify('A carga foi criada, mas não consegui marcar a montagem como efetivada: '
      + (e.message || e), 'erro', 9000);
  }
  if(silencioso) return;
  // A linha vira leitura depois de virar carga; deixar aberta mostraria um
  // formulário que não aceita mais nada.
  if(_montagemAberta === id) _montagemAberta = null;
  await carregarMontagemUI();
  renderAll();
  notify(`Carga da rota ${m.rota_nome} criada e enviada para a Torre.`, 'ok', 5000);
}

/* =====================================================================
   ROTAS POR DIA DA SEMANA — o template que vivia no Teams (24/08/2026)
   =====================================================================

   Faltou na primeira entrega e o efeito foi um botão mudo: "Puxar rotas
   do modelo" não tinha de onde puxar, porque não havia tela para
   cadastrar o modelo. A lição, anotada: rota de servidor sem tela é a
   mesma família do defeito da ocorrência #13 — a regra existe e o
   caminho para cumpri-la, não.

   Mudança aqui vale para as PRÓXIMAS semanas. O dia já montado é uma
   cópia, não um espelho: reprogramar o passado por tabelar o futuro seria
   reescrever história que a operação já viveu.
   ===================================================================== */

let _modeloDiaAtivo = null;   // 1=seg … 5=sex
let _modeloCache = [];

async function carregarModeloSemanaUI(){
  const card = document.getElementById('card-modelo-semana');
  if(!card) return;
  const setor = DB.operador && DB.operador.setor;
  const podeVer = setor === 'Logística' || setor === 'Administração';
  card.hidden = !podeVer;
  if(!podeVer || !SuincoSharePoint.estaConfigurado()) return;

  if(_modeloDiaAtivo === null){
    /* Abre no dia de HOJE quando é dia útil — é o que a pessoa quer ver
       na maioria das vezes. Fim de semana cai em segunda. */
    const h = new Date().getDay();
    _modeloDiaAtivo = (h >= 1 && h <= 5) ? h : 1;
  }
  try {
    const r = await SuincoSharePoint.modeloSemana.listar();
    _modeloCache = r.modelo || [];
    renderModeloSemana();
  } catch(e){
    if(e && e.status === 404){ card.hidden = true; return; }
    notify('Não consegui carregar as rotas por dia: ' + (e.message || e), 'erro', 7000);
  }
}

function trocarDiaModeloUI(dia){
  _modeloDiaAtivo = Number(dia);
  renderModeloSemana();
}

function renderModeloSemana(){
  const seg = document.getElementById('modelo-seg');
  if(seg){
    seg.innerHTML = [1, 2, 3, 4, 5].map(d => {
      const n = _modeloCache.filter(m => Number(m.dia_semana) === d).length;
      return `<button class="seg-btn${d === _modeloDiaAtivo ? ' seg-ativo' : ''}"
                onclick="trocarDiaModeloUI(${d})">${NOMES_DIA[d]}
                ${n ? `<span class="pill-count">${n}</span>` : ''}</button>`;
    }).join('');
  }

  /* A lista sai do cadastro oficial — nunca de texto livre. É o que
     impede "Belo Horinzonte" de virar rota nova, que foi exatamente o
     que a planilha acumulou em cinco dias.

     Usa ROTAS e rotaLabel, os mesmos de prog-rota: mantendo uma fonte só,
     rota cadastrada em Cadastros aparece aqui na hora. E reconstrói
     sempre, preservando a escolha — pela mesma razão. */
  const sel = document.getElementById('modelo-rota');
  if(sel){
    const atual = sel.value;
    sel.innerHTML = ROTAS.map(r =>
      `<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
    if(atual) sel.value = atual;
  }

  const doDia = _modeloCache
    .filter(m => Number(m.dia_semana) === _modeloDiaAtivo)
    .sort((a, b) => (a.ordem - b.ordem) || String(a.rota_codigo).localeCompare(b.rota_codigo));

  const vazio = document.getElementById('modelo-empty');
  if(vazio) vazio.hidden = doDia.length > 0;
  const tbody = document.getElementById('modelo-tbody');
  if(!tbody) return;
  tbody.innerHTML = doDia.map((m, i) => `<tr>
      <td class="text-dim">${i + 1}</td>
      <td>${destinoMontagemHtml(m)}</td>
      <td>${esc(m.tipo_operacao) || '<span class="text-dim">—</span>'}</td>
      <td>${m.qtd_entregas ?? '<span class="text-dim">—</span>'}</td>
      <td class="no-print">
        <button class="btn btn-sec btn-sm" onclick="removerDoModeloUI(${Number(m.modelo_id)})">Remover</button>
      </td></tr>`).join('');
}

async function adicionarAoModeloUI(){
  const rota = (document.getElementById('modelo-rota') || {}).value;
  if(!rota){ notify('Escolha a rota.', 'erro', 4000); return; }
  const jaTem = _modeloCache.filter(m =>
    Number(m.dia_semana) === _modeloDiaAtivo && m.rota_codigo === rota).length;
  try {
    await SuincoSharePoint.modeloSemana.gravar({
      diaSemana: _modeloDiaAtivo,
      rotaCodigo: rota,
      /* A ordem é o que permite a MESMA rota duas vezes no mesmo dia —
         duas saídas para a mesma praça acontecem, e o índice único é por
         (dia, rota, ordem). */
      ordem: jaTem,
      tipoOperacao: (document.getElementById('modelo-tipo') || {}).value || '',
      qtdEntregas: (document.getElementById('modelo-entregas') || {}).value || '',
    });
    await carregarModeloSemanaUI();
    notify('Rota adicionada ao modelo de ' + NOMES_DIA[_modeloDiaAtivo] + '.', 'ok', 4000);
  } catch(e){ notify(e.message || String(e), 'erro', 8000); }
}

async function removerDoModeloUI(id){
  if(!confirm('Tirar esta rota do modelo deste dia?')) return;
  try {
    await SuincoSharePoint.modeloSemana.remover(id);
    await carregarModeloSemanaUI();
  } catch(e){ notify('Não consegui remover: ' + (e.message || e), 'erro', 7000); }
}

/* ─────────────────────────────────────────────────────────────────────
   EXPLICAÇÃO SOB DEMANDA NO CELULAR — o interruptor
   ---------------------------------------------------------------------
   O CSS esconde `.card-sub` abaixo de 820px; aqui o título passa a abrir
   e fechar. Três decisões que valem explicação:

   1. DELEGAÇÃO, não listener por cartão. São 66 cartões e vários são
      redesenhados a cada sincronização — listener preso ao elemento morre
      no primeiro render. O clique é ouvido no documento e resolvido por
      `closest`, então funciona em cartão que ainda nem existe.

   2. A escolha é GUARDADA POR CARTÃO. Quem opera Devoluções todo dia não
      quer reabrir a mesma explicação amanhã; quem está aprendendo deixa
      aberta. A chave é o texto do título, que é estável entre versões —
      o índice do cartão não é (basta inserir um cartão no meio).

   3. NÃO É SEGREDO: no computador nada muda, e no celular o "?" ao lado
      do título anuncia que há explicação ali. Esconder sem avisar seria
      pior que o problema original.
   ───────────────────────────────────────────────────────────────────── */
const EXPLIC_CHAVE = 'suinco_explicacoes_abertas';

function _explicAbertas(){
  try { return new Set(JSON.parse(localStorage.getItem(EXPLIC_CHAVE) || '[]')); }
  catch { return new Set(); }
}
function _explicGravar(conjunto){
  try { localStorage.setItem(EXPLIC_CHAVE, JSON.stringify([...conjunto])); }
  catch { /* modo privado: a sessão funciona, só não lembra amanhã */ }
}
function _explicId(card){
  const t = card.querySelector(':scope > .card-title');
  return t ? t.textContent.trim().slice(0, 60) : '';
}

/* Reaplica o que a pessoa escolheu. Chamado depois de cada render, porque
   cartão redesenhado volta com a classe limpa. */
function restaurarExplicacoes(){
  if (window.innerWidth > 820) return;
  const abertas = _explicAbertas();
  document.querySelectorAll('.card').forEach(card => {
    if (!card.querySelector(':scope > .card-sub')) return;
    card.classList.toggle('exp-aberta', abertas.has(_explicId(card)));
  });
}

document.addEventListener('click', (ev) => {
  if (window.innerWidth > 820) return;
  const titulo = ev.target.closest('.card-title');
  if (!titulo) return;
  // Em Indicadores quem manda é a seção recolhida (ver styles.css,
  // "CONFLITO DE AFORDÂNCIA"): lá o mesmo toque abre a seção inteira, e a
  // explicação vem junto. Sem esta guarda, os dois tratadores disparavam
  // no mesmo clique e um desfazia o outro.
  if (titulo.closest('#tab-indicadores')) return;
  const card = titulo.parentElement;
  if (!card || !card.classList.contains('card')) return;
  if (!card.querySelector(':scope > .card-sub')) return;
  // Não sequestra clique em botão/link que viva dentro do título.
  if (ev.target.closest('button, a, input, select, label')) return;

  const aberta = card.classList.toggle('exp-aberta');
  const abertas = _explicAbertas();
  const id = _explicId(card);
  if (aberta) abertas.add(id); else abertas.delete(id);
  _explicGravar(abertas);
});

/* Teclado: o título virou controle, então precisa ser alcançável e
   acionável por quem não usa toque. */
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const t = document.activeElement;
  if (!t || !t.classList || !t.classList.contains('card-title')) return;
  if (window.innerWidth > 820) return;
  ev.preventDefault(); t.click();
});

function _prepararTitulosExplicaveis(){
  if (window.innerWidth > 820) return;
  document.querySelectorAll('.card > .card-sub').forEach(sub => {
    const t = sub.parentElement.querySelector(':scope > .card-title');
    if (t && !t.hasAttribute('tabindex')){
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
      t.setAttribute('aria-label', t.textContent.trim() + ' — toque para ver a explicação');
    }
  });
}

/* ─────────────────────────────────────────────────────────────────────
   INDICADORES NO CELULAR — abrir e fechar cada seção
   ---------------------------------------------------------------------
   Mesma mecânica da explicação sob demanda (delegação + escolha guardada
   por título), com uma diferença que importa: aqui o PRIMEIRO cartão abre
   sozinho na primeira visita. Uma aba de indicadores que abre inteiramente
   fechada parece quebrada; abrindo o primeiro, a pessoa vê um número e
   entende que os outros títulos são portas.

   Só a primeira visita decide isso. Depois vale o que a pessoa escolheu —
   inclusive fechar tudo, se for o que ela quer.
   ───────────────────────────────────────────────────────────────────── */
/* ABAS COM SEÇÃO RECOLHIDA NO CELULAR.
   Indicadores entrou em 27/08; Cadastros no mesmo dia, pela mesma medida:
   8.822px de rolagem, 10,5 telas. Uma mecânica, duas abas — a lista aqui é
   o único lugar que decide quais. */
const SECOES_ABAS = ['indicadores', 'cadastros'];
const SECOES_SELETOR = SECOES_ABAS
  .map(a => `#tab-${a} > .card > .card-title, #tab-${a} > .grid2 > .card > .card-title`)
  .join(', ');
function _secoesChave(aba){ return `suinco_secoes_${aba}`; }
/* A chave antiga fica: quem já escolheu em Indicadores não perde a escolha. */
const SECOES_CHAVE_LEGADO = { indicadores: 'suinco_indicadores_secoes' };

function _secoesEstado(aba){
  try {
    const cru = localStorage.getItem(_secoesChave(aba))
             || (SECOES_CHAVE_LEGADO[aba] ? localStorage.getItem(SECOES_CHAVE_LEGADO[aba]) : null);
    return cru ? JSON.parse(cru) : null;   // null = nunca escolheu nada
  } catch { return null; }
}
function _secoesGravar(aba, lista){
  try { localStorage.setItem(_secoesChave(aba), JSON.stringify(lista)); } catch {}
}
/* Os cartões de uma aba, na ordem da tela. Em Cadastros parte deles mora
   dentro de .grid2 — por isso não dá para usar só filho direto. */
function _secoesCards(abaEl){
  return [...abaEl.querySelectorAll(':scope > .card, :scope > .grid2 > .card')];
}
function _secaoId(card){
  const t = card.querySelector(':scope > .card-title');
  return t ? t.textContent.trim().slice(0, 60) : '';
}

function restaurarSecoesIndicadores(){
  SECOES_ABAS.forEach(restaurarSecoesDaAba);
}
function restaurarSecoesDaAba(nomeAba){
  const aba = document.getElementById(`tab-${nomeAba}`);
  if (!aba || window.innerWidth > 820) return;
  const cards = _secoesCards(aba);
  if (!cards.length) return;
  const guardado = _secoesEstado(nomeAba);
  const abertas = new Set(guardado || []);
  const primeiraVisita = guardado === null;
  cards.forEach((card, i) => {
    const t = card.querySelector(':scope > .card-title');
    if (!t) return;
    if (!t.hasAttribute('tabindex')){
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
    }
    const aberta = primeiraVisita ? (i === 0) : abertas.has(_secaoId(card));
    card.classList.toggle('sec-aberta', aberta);
    t.setAttribute('aria-expanded', aberta ? 'true' : 'false');
  });
}

document.addEventListener('click', (ev) => {
  if (window.innerWidth > 820) return;
  const titulo = ev.target.closest(SECOES_SELETOR);
  if (!titulo) return;
  if (ev.target.closest('button, a, input, select, label')) return;

  const card = titulo.parentElement;
  const aberta = card.classList.toggle('sec-aberta');
  titulo.setAttribute('aria-expanded', aberta ? 'true' : 'false');

  const aba = card.closest('[id^="tab-"]');
  if (!aba) return;
  const nomeAba = aba.id.replace('tab-', '');
  _secoesGravar(nomeAba, _secoesCards(aba)
    .filter(c => c.classList.contains('sec-aberta'))
    .map(_secaoId));
  /* A FROTA PRECISA DO FOCO NA BUSCA (27/08/2026). Ela abre sem lista — a
     busca é a porta. Abrir e deixar o dedo procurando o campo seria trocar
     uma rolagem por um garimpo. */
  if (aberta && nomeAba === 'cadastros'){
    const busca = card.querySelector('#frota-busca');
    if (busca) setTimeout(() => { try { busca.focus({preventScroll:true}); } catch(e){} }, 60);
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const t = document.activeElement;
  if (!t || !t.matches || !t.matches('#tab-indicadores > .card > .card-title')) return;
  if (window.innerWidth > 820) return;
  ev.preventDefault(); t.click();
});
