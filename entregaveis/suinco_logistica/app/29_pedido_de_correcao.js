/* ---------- CORREÇÃO SEM TELEFONEMA (14/10/2026, aprovado: "marcha fio") ----------

   Quem avançou a etapa por engano (Portaria, Expedição, Faturamento) ou a
   Logística PEDE, na linha do tempo da carga, para voltar à etapa em que
   ela estava — com motivo. A Administração recebe no celular e decide no
   Histórico: na caixa "Pedidos de correção" do topo da aba, ou na própria
   linha do tempo da carga. Aprovar é a MESMA correção de etapa de sempre
   (servidor: aplicarCorrecaoDeEtapa), com quem pediu e quem aprovou.

   QUEM DECIDE É O SERVIDOR. A tela só mostra o botão a quem deu o passo
   (o setor dono da etapa, ou a Logística) — o servidor confere de novo, e
   a recusa dele diz quem pode. Pedir não muda nada na carga. */

const CORRECAO = { abertos: [], carregado: false };

function correcaoServidorOk(){
  return typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado()
    && !!SuincoSharePoint.correcao;
}

/* Para onde a carga VOLTA — a mesma leitura do servidor (etapaAnterior em
   rotas/pedidos_correcao.js): a etapa em que ela estava antes de entrar na
   atual. A saída só de devolução volta para "Aguardando Embarque", não
   para "Faturado". O servidor manda a palavra final no pedido gravado. */
function etapaParaOndeVolta(c){
  const i = STATUS_FLOW.indexOf(c.status);
  if(i <= 0) return null;
  const mov = historicoDaCarga(c.id)
    .filter(m => m.statusNovo === c.status && m.statusAnterior && m.statusAnterior !== c.status)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  const j = mov ? STATUS_FLOW.indexOf(mov.statusAnterior) : -1;
  return j >= 0 && j < i ? mov.statusAnterior : STATUS_FLOW[i - 1];
}

function podePedirCorrecao(c){
  const setor = (DB.operador || {}).setor;
  if(!c || !setor || setor === 'Administração' || !correcaoServidorOk()) return false;
  if(!etapaParaOndeVolta(c)) return false;
  return setor === 'Logística' || (STATUS_META[c.status] || {}).setor === setor;
}

function pedidoAbertoDaCarga(id){
  return CORRECAO.abertos.find(p => p.cargaId === id) || null;
}

async function carregarPedidosDeCorrecao(){
  if(!correcaoServidorOk()){ CORRECAO.abertos = []; renderPedidosDeCorrecao(); return; }
  try{
    const lista = await SuincoSharePoint.correcao.abertos();
    CORRECAO.abertos = Array.isArray(lista) ? lista : [];
    CORRECAO.carregado = true;
  }catch(e){
    /* Sem a lista agora (rede, servidor sem a rota): a caixa fica como
       estava e a linha do tempo só não mostra o pedido — o resto segue. */
    console.warn('[correção] não consegui ler os pedidos:', e && e.message);
  }
  renderPedidosDeCorrecao();
  if(TAB_ATUAL === 'historico' && _timelineCargaAtual) renderTimelineCarga(_timelineCargaAtual);
}

/* UM pedido, desenhado igual nos dois lugares em que a Administração o vê:
   a caixa do topo do Histórico e a linha do tempo da carga. */
function pedidoDeCorrecaoHtml(p, opcoes = {}){
  const id = Number(p.id);
  const carga = p.numeroCarga ? `Carga ${esc(p.numeroCarga)}` : esc(p.placa || 'Carga');
  return `<div class="pedido-correcao" data-pedido="${id}">
    <div class="pedido-correcao-linha"><b>${carga}</b>${p.numeroCarga && p.placa ? ` · ${esc(p.placa)}` : ''}
      · <span class="pedido-correcao-etapas">${esc(p.deStatus)} → ${esc(p.paraStatus)}</span></div>
    <div class="pedido-correcao-quem">${esc(p.pedidoPor)} · ${esc(p.pedidoSetor)} · ${esc(fmtDataHora(p.pedidoEm))}</div>
    <div class="pedido-correcao-motivo">“${esc(p.motivo)}”</div>
    <div class="pedido-correcao-acoes">
      ${opcoes.naLinhaDoTempo ? '' : `<button type="button" class="btn btn-sec btn-sm" onclick="abrirCargaDoPedidoUI('${escJs(p.cargaId)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-historico"/></svg>Linha do tempo</button>`}
      <input type="text" id="corr-obs-${id}" placeholder="Por que recusar (opcional)" aria-label="Por que recusar (opcional)">
      <button type="button" class="btn btn-primary btn-sm" onclick="decidirPedidoDeCorrecaoUI(${id},'aprovado')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-desfazer"/></svg>Aprovar e voltar</button>
      <button type="button" class="btn btn-sec btn-sm" onclick="decidirPedidoDeCorrecaoUI(${id},'recusado')">Recusar</button>
    </div>
  </div>`;
}

/* A caixa do topo do Histórico — só da Administração, e só quando há
   pedido esperando: caixa vazia é ruído. */
function renderPedidosDeCorrecao(){
  const card = document.getElementById('card-pedidos-correcao');
  if(!card) return;
  const admin = (DB.operador || {}).setor === 'Administração';
  const lista = admin ? CORRECAO.abertos : [];
  card.hidden = !lista.length;
  const alvo = document.getElementById('pedidos-correcao-lista');
  if(alvo) alvo.innerHTML = lista.map(p => pedidoDeCorrecaoHtml(p)).join('');
  const n = document.getElementById('pedidos-correcao-qtd');
  if(n) n.textContent = lista.length ? `(${lista.length})` : '';
}

/* O pedaço da linha do tempo da carga. Três casos, nenhum vazio:
   a Administração vê o pedido aberto com Aprovar/Recusar; quem pediu vê
   que está esperando; quem pode pedir vê o "Errou a etapa?". */
function correcaoDaCargaHtml(c){
  if(!correcaoServidorOk()) return '';
  const setor = (DB.operador || {}).setor;
  const p = pedidoAbertoDaCarga(c.id);
  if(p && setor === 'Administração'){
    return `<div class="admin-carga no-print pedido-correcao-caixa">
      <div class="admin-carga-tit">Pedido de correção esperando você</div>
      ${pedidoDeCorrecaoHtml(p, { naLinhaDoTempo: true })}
    </div>`;
  }
  if(p){
    return `<div class="correcao-carga no-print pedido-correcao-caixa">
      <div class="correcao-carga-tit">Pedido de correção enviado</div>
      <div class="correcao-carga-sub">${esc(p.deStatus)} → ${esc(p.paraStatus)} · ${esc(p.pedidoPor)}, ${esc(fmtDataHora(p.pedidoEm))}.
        Esperando a Administração — a resposta chega aqui e no celular de quem pediu.</div>
    </div>`;
  }
  if(!podePedirCorrecao(c)) return '';
  const para = etapaParaOndeVolta(c);
  return `<details class="correcao-carga no-print pedir-correcao" id="pedir-correcao-${esc(c.id)}">
    <summary>Errou a etapa? Pedir correção à Administração</summary>
    <div class="correcao-carga-sub">Se a Administração aprovar, a carga volta de “${esc(c.status)}” para “${esc(para)}”.
      Ela recebe o pedido no celular; nada muda até ela decidir.</div>
    <div class="correcao-carga-linha">
      <input type="text" id="corr-motivo-${esc(c.id)}" maxlength="500" placeholder="O que aconteceu? A Administração lê isto para decidir" aria-label="Motivo do pedido de correção">
      <button type="button" class="btn btn-sec btn-sm" onclick="pedirCorrecaoUI('${escJs(c.id)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-desfazer"/></svg>Enviar pedido</button>
    </div>
  </details>`;
}

async function pedirCorrecaoUI(id){
  const c = getCarga(id);
  const motivo = ((document.getElementById('corr-motivo-' + id) || {}).value || '').trim();
  if(!c) return;
  if(!motivo){ notify('Escreva o que aconteceu — é o que a Administração lê para decidir.', 'warn'); return; }
  try{
    const p = await SuincoSharePoint.correcao.pedir(id, motivo);
    CORRECAO.abertos = CORRECAO.abertos.filter(x => x.cargaId !== id).concat([p]);
    notifyGravacao(`Pedido enviado à Administração: ${p.deStatus} → ${p.paraStatus}.`);
    renderPedidosDeCorrecao();
    renderTimelineCarga(id);
  }catch(e){
    notify('Não consegui enviar o pedido: ' + (e.message || 'erro'), 'danger', 9000);
  }
}

async function decidirPedidoDeCorrecaoUI(pedidoId, decisao){
  const p = CORRECAO.abertos.find(x => Number(x.id) === Number(pedidoId));
  if(!p) return;
  const obs = ((document.getElementById('corr-obs-' + pedidoId) || {}).value || '').trim();
  if(decisao === 'aprovado'){
    const quem = p.numeroCarga ? `a carga ${p.numeroCarga}` : `a placa ${p.placa}`;
    if(!(await perguntarUI({ titulo: `VOLTAR ${quem}?`,
         texto: `De "${p.deStatus}" para "${p.paraStatus}".\n\n`
           + `Pedido de ${p.pedidoPor} (${p.pedidoSetor}): ${p.motivo}\n\n`
           + 'Isso muda o andamento para todos os setores e fica registrado no histórico, com o seu nome.',
         botao: 'Voltar a etapa', perigo: true }))) return;
  }
  try{
    await SuincoSharePoint.correcao.decidir(pedidoId, decisao, obs);
    CORRECAO.abertos = CORRECAO.abertos.filter(x => Number(x.id) !== Number(pedidoId));
    if(decisao === 'aprovado') await SuincoSharePoint.sincronizarAgora();
    notifyGravacao(decisao === 'aprovado'
      ? `Correção aprovada: ${p.deStatus} → ${p.paraStatus}.`
      : 'Pedido recusado — a carga continua como estava.');
    renderAll();
    renderPedidosDeCorrecao();
    if(_timelineCargaAtual) renderTimelineCarga(_timelineCargaAtual);
  }catch(e){
    notify('Não consegui registrar a decisão: ' + (e.message || 'erro'), 'danger', 9000);
    carregarPedidosDeCorrecao();
  }
}

function abrirCargaDoPedidoUI(cargaId){
  if(typeof irParaCargaUI === 'function'){ irParaCargaUI('linha', cargaId, ''); return; }
  abrirTab('historico');
  selecionarCargaTimeline(cargaId);
}

/* Chegou pelo tempo real (pedido novo, ou decidido em outro aparelho):
   atualiza a lista e conta a notícia a quem ela interessa — a
   Administração, do pedido novo; quem pediu, da decisão. */
function receberPedidoDeCorrecao(p){
  if(!p || !p.id) return;
  const op = DB.operador || {};
  const outros = CORRECAO.abertos.filter(x => Number(x.id) !== Number(p.id));
  const aberto = !p.decisao;
  if(op.setor === 'Administração' || p.pedidoSetor === op.setor){
    CORRECAO.abertos = aberto ? outros.concat([p]) : outros;
  }
  const carga = p.numeroCarga ? `carga ${p.numeroCarga}` : `placa ${p.placa}`;
  if(aberto && op.setor === 'Administração'){
    notify(`${p.pedidoPor} (${p.pedidoSetor}) pede correção da ${carga}: ${p.deStatus} → ${p.paraStatus}. Decida no Histórico.`, 'warn', 9000);
  } else if(!aberto && p.pedidoSetor === op.setor && op.setor !== 'Administração'){
    notify(p.decisao === 'aprovado'
      ? `Correção aprovada por ${p.decididoPor}: a ${carga} voltou para ${p.paraStatus}.`
      : `Correção recusada por ${p.decididoPor}: a ${carga} continua em ${p.deStatus}.${p.obsDecisao ? ' ' + p.obsDecisao : ''}`,
      p.decisao === 'aprovado' ? 'success' : 'warn', 9000);
  }
  renderPedidosDeCorrecao();
  if(TAB_ATUAL === 'historico' && _timelineCargaAtual) renderTimelineCarga(_timelineCargaAtual);
}
