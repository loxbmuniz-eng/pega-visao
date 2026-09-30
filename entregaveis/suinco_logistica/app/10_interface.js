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

  /* Aviso que já está SAINDO não ocupa vaga: ele fica 240 ms no ar só para
     terminar o movimento, e contá-lo faria o aviso seguinte ir para a fila
     sem necessidade. */
  if(container.querySelectorAll('.notif-item:not(.notif-saindo)').length >= NOTIF_MAX_VISIVEL){
    if(!perecivel){
      _notifFila.push({
        el, ms, em: Date.now(), perecivel: false,
        forte: el.classList.contains('forte'),
      });
      _apararFila();
      _atualizarContadorFila();
    }
    // PERECÍVEL NÃO ESPERA (pedido do dono, 27/08/2026): notícia de outro
    // setor é tempo real ou nada. A tela já mostra o resultado da mudança;
    // guardar o aviso pra depois vira reprise retroativa — morre aqui.
    return;
  }
  _mostrarNotifAgora(el, ms);
}

/* FILA CURTA — a regra 1 do bloco no topo deste arquivo (25/08/2026), que
   estava escrita, comentada e explicada, mas NUNCA implementada: até
   12/09/2026 `NOTIF_MAX_FILA` era declarada e não era lida em lugar nenhum.

   O custo apareceu em produção. Print do dono com "+41 aviso(s) aguardando"
   no Faturamento e outro com "+67" no celular, em cargas diferentes — cada
   carga aguardando confirmação abria o seu próprio aviso, sem fim, porque
   nada descartava e esses avisos não são perecíveis (são resposta a uma ação
   de quem está na frente da tela). Reprodução medida: 15 cargas + 13 leituras
   remotas = 45 avisos, 42 ainda na fila. Uma tela com 67 avisos esperando não
   informa o operador: cega ele.

   Cai o MAIS ANTIGO. Aviso com som (`forte`) nunca cai: troca de placa é
   segurança, o caminhão errado entra na doca por causa dele. Se só sobrarem
   avisos de segurança esperando, a fila passa do teto de propósito. */
function _apararFila(){
  while(_notifFila.length > NOTIF_MAX_FILA){
    const i = _notifFila.findIndex(x => !x.forte);
    if(i < 0) return;
    _notifFila.splice(i, 1);
  }
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

  /* O AVISO SAI PELO MESMO LADO POR ONDE ENTROU (320 ms entra, 240 ms sai).

     Entrar deslizando e depois sumir no lugar são dois objetos diferentes
     para o olho: o que entrou não é o que saiu. Saindo pela mesma borda, é
     o mesmo papel indo embora — e é isso que faz o gesto de dispensar
     parecer natural em vez de arbitrário.

     Sair é mais rápido que entrar de propósito: entrar é o sistema
     chamando a atenção, sair é o sistema respondendo. Rápido onde o
     sistema responde, calmo onde ele pede atenção.

     O próximo da fila só entra DEPOIS que este terminou de sair — senão os
     dois dividem o mesmo lugar na pilha e o de baixo pula. */
  const remover = () => {
    clearTimeout(temporizador);
    if(el.classList.contains('notif-saindo')) return;   // já está saindo
    el.classList.add('notif-saindo');
    setTimeout(() => {
      el.remove();
      const proximo = _proximoDaFila();   // tira da fila ANTES de contar — o contador reflete o que sobra
      _atualizarContadorFila();
      if(proximo) _mostrarNotifAgora(proximo.el, proximo.ms);
    }, movReduzida() ? 0 : 240);
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

/* UM AVISO DE OFFLINE POR VEZ, NÃO UM POR TENTATIVA.

   Relato do dono, 31/08/2026, com a operação rodando: "ta vindo muitos
   avisos aguardando e eu nao quero isso aparecendo, sao todos avisos de
   voce esta offline".

   Ele tem razão e a causa é aritmética: com a sessão morta, TODA gravação
   é recusada — e cada recusa disparava seu próprio aviso, de 12 a 20
   segundos. A sincronia tenta a cada 15 s e o operador continua clicando,
   então em um minuto a tela vira uma pilha de tarjas iguais que esconde o
   painel e não acrescenta nada.

   A faixa do rodapé JÁ diz que está offline, e fica lá o tempo todo. O
   aviso individual só precisa existir uma vez: repetir a mesma frase não
   informa mais, informa menos — vira ruído que se aprende a ignorar, e aí
   o aviso que importa passa despercebido junto.

   Então: aviso de offline/sessão substitui o anterior em vez de empilhar.
   Um só na tela, sempre o mais recente. */
const _MARCA_OFFLINE = /VOCÊ ESTÁ OFFLINE|SESSÃO EXPIROU|SISTEMA INDISPONÍVEL|NADA FOI GRAVADO/i;

function notify(msg, type, ms, opcoes){
  const eDeConexao = _MARCA_OFFLINE.test(String(msg || ''));
  if(eDeConexao){
    // Tira os irmãos que já estão na tela antes de pôr este.
    document.querySelectorAll('.notif-item.aviso-de-conexao')
      .forEach(x => { try{ x.remove(); }catch(e){} });
  }
  const el = document.createElement('div');
  el.className = 'notif-item' + (type ? ' ' + type : '')
    + (eDeConexao ? ' aviso-de-conexao' : '');
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
function receberRecusaDeCarga(carga, motivo, removida, offline, incerta, tentativas){
  const rotulo = carga.numeroCarga && carga.numeroCarga !== 'Aguardando Carga'
    ? carga.numeroCarga : (carga.placa || carga.id);
  const sessaoVenceu = (typeof SuincoSharePoint !== 'undefined'
    && SuincoSharePoint.sessaoPerdida && SuincoSharePoint.sessaoPerdida());
  /* A MENSAGEM PRECISA DIZER O QUE ACONTECEU DE VERDADE (11/09/2026).

     Antes, todo `offline` dizia "a linha saiu da tela" — mesmo quando não
     saía (edição, ou agora criação incerta: ver a nota em data.js). Ler
     "saiu da tela" sobre uma linha que está bem ali na frente do operador
     é o tipo de mentira pequena que corrói a confiança no aviso GRANDE, o
     dia em que ele for verdade. `incerta` é o caso novo: criação que não
     foi confirmada nem recusada — a carga fica, e o painel vai tentar de
     novo sozinho na próxima sincronia. */
  if(offline && incerta){
    /* NÃO REPETE O AVISO A CADA TENTATIVA (11/09/2026).

       Achado no mesmo dia: uma carga que nunca confirma agora tenta de
       novo sozinha (data.js), com recuo — mas sem isto aqui, cada
       tentativa reabria o MESMO aviso, e uma carga presa virava alerta
       repetindo sem parar. Notifica na primeira vez, e depois só de longe
       em longe (a cada 6ª tentativa — com o recuo no máximo, ~1 a cada
       minuto — é aviso a cada uns 6 minutos), com o texto mudando de tom
       depois de muitas tentativas: aí já não é "espera", é "confira à
       mão". A carga NUNCA some sozinha por isto — só o texto muda. */
    const t = tentativas || 1;
    if(t > 1 && t % 6 !== 0) return;
    notify(
      t >= 6
        ? `⚠️ ${rotulo}: ainda não consegui confirmar com o servidor depois de `
          + `${t} tentativas. A carga CONTINUA na tela e o painel segue tentando `
          + 'sozinho — mas se isto persistir, confira à mão (placa, número) se '
          + 'ela já existe no servidor antes de decidir o que fazer.'
        : `⚠️ ${rotulo}: NÃO CONSEGUI CONFIRMAR COM O SERVIDOR. `
          + 'A carga CONTINUA na tela e o painel vai tentar de novo sozinho '
          + 'assim que a conexão melhorar — não relance nem exclua, ou pode '
          + 'duplicar. Se sumir daqui a pouco, aí sim relance.',
      'danger', 20000);
    tocarAlertaAlteracao();
    return;
  }
  notify(
    sessaoVenceu
      ? `⛔ ${rotulo}: SUA SESSÃO EXPIROU. NADA FOI GRAVADO e a linha saiu `
        + 'da tela. Entre de novo (o aviso vermelho no topo tem o botão) e '
        + 'lance outra vez.'
      : offline
      ? `⛔ ${rotulo}: VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL. `
        + 'NADA FOI GRAVADO e a linha saiu da tela. '
        + 'Conecte-se e lance de novo.'
      : removida
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

/* O SEGUNDO TOQUE NÃO VIRA SEGUNDA GRAVAÇÃO (16/09/2026).

   MEDIDO: o painel inteiro tinha TRÊS botões que se desabilitam enquanto a
   ação corre, e os três eram do modal de avisos. Os da operação aceitavam
   o segundo toque de braços abertos. A folha de estilo já registrava a
   causa, em 2026: "no celular não existe hover, e sem resposta visual o
   operador aperta duas vezes achando que não pegou". A resposta ao toque
   entrou hoje e resolve a PERCEPÇÃO; não resolve o que o segundo toque faz
   quando chega ao servidor.

   A PRIMEIRA VERSÃO BARRAVA TODO BOTÃO, E O PORTÃO v38 A REPROVOU.
   `test_segundo_fator` caiu em "um código de recuperação entra sem o
   celular": no segundo fator o MESMO `#btn-entrar` é apertado duas vezes de
   propósito — o primeiro toque PEDE o código, o segundo ENVIA. O guarda
   comeu o segundo.

   O levantamento nas suítes mostrou que isso é comum, não exceção: as abas,
   o menu da gaveta e o botão de entrar são apertados em sequência o tempo
   todo. A premissa "mesmo botão duas vezes é a mesma intenção repetida" é
   FALSA neste painel.

   Então a regra inverteu: em vez de barrar tudo e abrir exceção, barra só
   onde o repique CRIA REGISTRO — efetivar carga, cancelar, excluir, avançar
   etapa, criar usuário, lançar lacre. Nesses, o segundo toque não é
   impaciência: é uma segunda carga, um segundo cancelamento, uma segunda
   exclusão. Em aba, menu e login o segundo toque é navegação, e navegação
   não se trava.

   A lista mora AQUI, num lugar só, e é por nome de função — não por id nem
   por classe. Ação nova que grave entra nesta lista e ganha a trava; botão
   que só navega nunca entra. */
const ACOES_DE_UMA_VEZ = [
  'efetivarMontagemUI', 'efetivarLoteMontagemUI', 'cancelarMontagemUI',
  'excluirCargaUI', 'excluirCargaSeguiuViagemUI', 'excluirRotaUI',
  'excluirUsuarioUI', 'criarCargaProgramadaUI', 'criarUsuarioUI',
  'avancarStatusUI', 'registrarLacreRetidoUI',
];

const _ULTIMO_TOQUE = new WeakMap();
const JANELA_TOQUE_DUPLO = 400;

document.addEventListener('click', (ev) => {
  const alvo = ev.target && ev.target.closest
    ? ev.target.closest('button, .btn')
    : null;
  if (!alvo) return;
  /* Toque de teclado tem `detail` 0 — quem navega por teclado aperta uma
     vez, e travar ali seria resolver um problema de dedo criando um de
     acessibilidade. */
  if (!ev.detail) return;

  /* Só grava quem chama uma das ações da lista. O `onclick` do painel é
     texto na marcação, então dá para perguntar. */
  const acao = alvo.getAttribute('onclick') || '';
  if (!ACOES_DE_UMA_VEZ.some(nome => acao.includes(nome + '('))) return;

  const agora = Date.now();
  const antes = _ULTIMO_TOQUE.get(alvo) || 0;
  if (agora - antes < JANELA_TOQUE_DUPLO) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    /* O botão pisca: recusa silenciosa é o que fez a pessoa apertar de novo
       em primeiro lugar. */
    alvo.classList.remove('toque-recusado');
    void alvo.offsetWidth;
    alvo.classList.add('toque-recusado');
    return;
  }
  /* Toque BARRADO não atualiza o relógio, de propósito: se atualizasse,
     quem martelasse o botão renovaria a trava para sempre. */
  _ULTIMO_TOQUE.set(alvo, agora);
}, true);

