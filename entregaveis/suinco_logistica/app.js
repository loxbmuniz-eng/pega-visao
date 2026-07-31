/* =====================================================================
   PAINEL LOGÍSTICO SUINCO — interface (renderização + eventos)
   Toda a regra de negócio mora em data.js; este arquivo só lê/escreve em
   DB através das funções de lá e desenha a tela.
===================================================================== */

let TAB_ATUAL = 'torre';
let currentPickerCallback = null;

// Próxima ação disponível a partir de cada status (usada nos botões de
// linha das tabelas de Expedição/Faturamento — cada linha já é uma carga
// específica, então não há ambiguidade de "qual carga" aqui).
// Modelo de 6 status: sem "Liberado para Embarque"/"Liberado para Saída".
const NEXT_ACAO = {
  'Aguardando Embarque':  { label:'Iniciar Embarque',   destino:'Embarque Iniciado' },
  'Embarque Iniciado':    { label:'Finalizar Embarque', destino:'Embarque Finalizado' },
  'Embarque Finalizado':  { label:'Faturar',            destino:'Faturado' }
};

/* ---------- utilitários de UI ---------- */
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function nomeOperadorAtual(){ return DB.operador ? DB.operador.nome : '(não identificado)'; }
function setorOperadorAtual(){ return DB.operador ? DB.operador.setor : '—'; }
function badgeHtml(status){
  const meta = STATUS_META[status] || {badge:''};
  return `<span class="badge ${meta.badge}">${esc(status)}</span>`;
}
function notify(msg, type){
  const el = document.createElement('div');
  el.className = 'notif-item' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('notif').appendChild(el);
  setTimeout(()=>{ el.remove(); }, 5000);
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

/* ---------- login / operador (placeholder até SSO) ---------- */
function detectarTurnoPorHora(){
  const h = new Date().getHours();
  if(h>=6 && h<14) return 'Manhã (06h–14h)';
  if(h>=14 && h<22) return 'Tarde (14h–22h)';
  return 'Noite (22h–06h)';
}
function abrirLogin(){
  document.getElementById('login-turno').value = detectarTurnoPorHora();
  document.getElementById('modal-operador').classList.add('open');
}
function confirmarOperador(){
  const nome = document.getElementById('login-nome').value.trim();
  if(!nome){ notify('Informe seu nome.','warn'); return; }
  DB.operador = {
    nome,
    setor: document.getElementById('login-setor').value,
    turno: document.getElementById('login-turno').value
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
  atualizarHeaderOperador();
  abrirLogin();
}
function atualizarHeaderOperador(){
  const el = document.getElementById('operator-name');
  el.textContent = DB.operador ? `${DB.operador.nome} · ${DB.operador.setor} · ${DB.operador.turno}` : '—';
}
// TODAS as abas ficam visíveis e utilizáveis para todos os setores — ver o
// comentário de SETOR_PERMISSOES em data.js sobre por que a ocultação foi
// removida. Aqui só marcamos, discretamente, quais abas são de outro setor,
// pra pessoa saber que está agindo fora do posto dela (o registro na trilha
// de auditoria continua saindo com o setor real de quem operou).
function aplicarPermissoesSetor(){
  if(!DB.operador) return;
  const doSetor = SETOR_PERMISSOES[DB.operador.setor] || [];
  document.querySelectorAll('.nav-tab').forEach(el=>{
    el.hidden = false;
    el.classList.toggle('outro-setor', !doSetor.includes(el.dataset.tab));
  });
  atualizarAvisoSetorAba();
}

// Preenche, no topo de cada aba, o box que explica a função dela — e acrescenta
// o aviso "você é do setor X" quando a aba pertence a outro setor.
function atualizarAvisoSetorAba(){
  document.querySelectorAll('.funcao-aba').forEach(box=>{
    const tab = box.dataset.tab;
    const info = TAB_FUNCAO[tab];
    if(!info) return;
    const doSetor = DB.operador ? (SETOR_PERMISSOES[DB.operador.setor] || []) : [];
    const fora = DB.operador && !doSetor.includes(tab);
    box.innerHTML =
      `<div class="funcao-linha">` +
        `<span class="funcao-chip">${info.setor}</span>` +
        `<span class="funcao-oque"><strong>O que se faz aqui:</strong> ${info.oque}</span>` +
      `</div>` +
      `<div class="funcao-move"><strong>Efeito no status:</strong> ${info.move}</div>` +
      (fora ? `<div class="funcao-alerta">Você entrou como <strong>${DB.operador.setor}</strong> — esta etapa é normalmente da <strong>${info.setor}</strong>. Você pode registrar assim mesmo (cobertura de turno, por exemplo); o histórico vai gravar seu nome e seu setor.</div>` : '');
  });
}

/* ---------- TRAVA DE SENHA (Indicadores / Relatórios) -----------------
   ATENÇÃO — LEIA ANTES DE CONFIAR NISSO PRA QUALQUER COISA SÉRIA:
   Isto NÃO É segurança de verdade. É só uma barreira de UX pra evitar que
   alguém abra essas duas abas sem querer / por curiosidade casual. A senha
   fica em texto puro aqui embaixo, visível pra qualquer pessoa que abra o
   código-fonte da página (Ctrl+U no navegador) ou o F12. Não protege nada
   contra alguém com o mínimo de intenção de contornar. Controle de acesso
   de verdade só existe quando a permissão REAL da Lista do SharePoint
   estiver configurada por coluna/item e o SSO (Microsoft 365) estiver
   ligado — ver docs/MODELO_DADOS_SHAREPOINT.md. Até lá, isto é só uma
   cortina, não uma porta trancada. */
const SENHA_UX_ABAS_RESTRITAS = 'suinco2026';
const ABAS_COM_SENHA = ['indicadores','relatorios'];
let abasDesbloqueadasNestaSessao = new Set();
let _tabPendenteSenha = null;
function abaPrecisaSenha(tab){
  return ABAS_COM_SENHA.includes(tab) && !abasDesbloqueadasNestaSessao.has(tab);
}
function pedirSenhaAba(tab){
  _tabPendenteSenha = tab;
  document.getElementById('senha-titulo').textContent = 'Área restrita — ' + (tab==='indicadores' ? 'Indicadores' : 'Relatórios');
  document.getElementById('senha-input').value = '';
  document.getElementById('modal-senha').classList.add('open');
  setTimeout(()=>document.getElementById('senha-input').focus(), 50);
}
function confirmarSenhaAba(){
  const val = document.getElementById('senha-input').value;
  const tab = _tabPendenteSenha;
  document.getElementById('modal-senha').classList.remove('open');
  if(val === SENHA_UX_ABAS_RESTRITAS){
    abasDesbloqueadasNestaSessao.add(tab);
    _tabPendenteSenha = null;
    irParaTab(tab);
  } else {
    notify('Senha incorreta.', 'danger');
    _tabPendenteSenha = null;
  }
}
function cancelarSenhaAba(){
  document.getElementById('modal-senha').classList.remove('open');
  _tabPendenteSenha = null;
}

/* ---------- navegação ---------- */
function abrirTab(tab){
  if(abaPrecisaSenha(tab)){ pedirSenhaAba(tab); return; }
  irParaTab(tab);
}
function irParaTab(tab){
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
    case 'torre': renderTorre(); break;
    case 'programacao': renderProgFila(); renderProgAguardando(); break;
    case 'portaria':
      renderPortariaPatio();
      { const el = document.getElementById('portaria-placa'); if(el) setTimeout(()=>el.focus(), 30); }
      break;
    case 'expedicao': renderExpedicao(); break;
    case 'faturamento': renderFaturamento(); break;
    case 'indicadores': renderIndicadores(); break;
    case 'cadastros': renderCadastros(); break;
    case 'historico': renderHistorico(); renderBuscaTimeline(); break;
  }
}
function renderAll(){ renderTabAtual(); }

/* ---------- TORRE DE CONTROLE ---------- */
function renderTorre(){
  const abertas = cargasAbertas();
  const porStatus = {};
  abertas.forEach(c=>{ porStatus[c.status] = (porStatus[c.status]||0) + 1; });
  // "Aguardando Carga" não é mais um valor de status — é a flag
  // `aguardandoCarga` (o texto fica no campo Número da Carga). Mostrado
  // como uma caixa extra informativa, não como um dos 6 status oficiais.
  const statusVisiveis = STATUS_FLOW.slice(0,-1); // sem "Seguiu Viagem" (não fica em aberto)
  const aguardandoCargaCount = abertas.filter(c=>c.aguardandoCarga).length;
  document.getElementById('torre-stats').innerHTML =
    statusVisiveis.map(s=>`
      <div class="stat-box"><div class="stat-num">${porStatus[s]||0}</div><div class="stat-label">${esc(s)}</div></div>
    `).join('') +
    `<div class="stat-box"><div class="stat-num">${aguardandoCargaCount}</div><div class="stat-label">Aguardando Carga (dados incompletos)</div></div>`;

  const lista = abertas.slice().sort(ordenarPorSequenciaEAtualizacao);
  const tbody = document.getElementById('torre-tbody');
  tbody.innerHTML = lista.map(c=>`
    <tr>
      <td>${c.sequencia ?? '—'}</td><td>${esc(c.numeroCarga)||'—'}</td><td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${esc(c.motorista)||'—'}</td>
      <td>${esc(c.cliente)||'—'}</td><td>${esc(c.destino)||'—'}</td><td>${esc(c.produto)||'—'}</td><td>${c.peso||0}</td><td>${esc(c.doca)||'—'}</td>
      <td>${c.praOnde ? `<span class="chip-praonde">${esc(PRA_ONDE_LABEL[c.praOnde]||c.praOnde)}</span>` : '<span class="text-dim">—</span>'}</td>
      <td>${c.qtdGanchos ? c.qtdGanchos : '<span class="text-dim">Liso</span>'}</td>
      <td>${badgeHtml(c.status)}</td><td>${fmtDataHora(c.atualizadoEm)}</td>
    </tr>`).join('');
  document.getElementById('torre-empty').hidden = lista.length>0;
}
function ordenarPorSequenciaEAtualizacao(a,b){
  const sa = (a.sequencia===null||a.sequencia===undefined) ? Infinity : a.sequencia;
  const sb = (b.sequencia===null||b.sequencia===undefined) ? Infinity : b.sequencia;
  if(sa!==sb) return sa-sb;
  return new Date(a.atualizadoEm) - new Date(b.atualizadoEm);
}

/* ---------- PROGRAMAÇÃO ---------- */
function atualizarPreviewFrotaPrograma(){
  const placa = document.getElementById('prog-placa').value;
  const f = buscarFrota(placa);
  const hint = document.getElementById('prog-frota-hint');
  if(f){
    document.getElementById('prog-transportadora').value = f.transportadora;
    document.getElementById('prog-tipoveiculo').value = f.tipoVeiculo;
    hint.innerHTML = '<span class="text-dim">✅ Placa encontrada na Frota — Transportadora e Tipo de Veículo preenchidos automaticamente.</span>';
  } else if(normalizarPlaca(placa)){
    hint.innerHTML = '<span style="color:var(--wine-light)">⛔ Placa não cadastrada na Frota — a criação da carga será BLOQUEADA. Cadastre esta placa em Cadastros → Frota primeiro.</span>';
  } else {
    hint.innerHTML = '';
  }
}
// Calcula e mostra "Compartilhada?" (Sim/Não) a partir de "Pra onde?" —
// campo derivado, NUNCA editável manualmente (evita desalinhar do real).
function atualizarPreviewCompartilhada(selectId, previewId){
  const val = document.getElementById(selectId).value;
  document.getElementById(previewId).textContent = compartilhadaDaCarga({praOnde:val});
}
function criarCargaProgramadaUI(){
  const placa = document.getElementById('prog-placa').value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  try{
    criarCargaProgramada({
      placa,
      transportadora: document.getElementById('prog-transportadora').value,
      tipoVeiculo: document.getElementById('prog-tipoveiculo').value,
      motorista: document.getElementById('prog-motorista').value,
      numeroCarga: document.getElementById('prog-numero-carga').value,
      cliente: document.getElementById('prog-cliente').value,
      destino: document.getElementById('prog-destino').value,
      produto: document.getElementById('prog-produto').value,
      peso: document.getElementById('prog-peso').value,
      doca: document.getElementById('prog-doca').value,
      sequencia: document.getElementById('prog-sequencia').value,
      observacoes: document.getElementById('prog-obs').value,
      praOnde: document.getElementById('prog-praonde').value,
      qtdGanchos: document.getElementById('prog-ganchos').value,
      qtdEntregas: document.getElementById('prog-entregas').value,
      operador: nomeOperadorAtual()
    });
    notify(`Carga criada para a placa ${normalizarPlaca(placa)} — status Aguardando Veículo.`, 'success');
    ['prog-placa','prog-transportadora','prog-tipoveiculo','prog-motorista','prog-numero-carga','prog-cliente','prog-destino','prog-produto','prog-peso','prog-doca','prog-sequencia','prog-obs']
      .forEach(id=>document.getElementById(id).value='');
    document.getElementById('prog-praonde').value = '';
    document.getElementById('prog-ganchos').value = '0';
    document.getElementById('prog-entregas').value = '1';
    atualizarPreviewCompartilhada('prog-praonde','prog-compartilhada-preview');
    document.getElementById('prog-frota-hint').innerHTML = '';
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
function renderProgFila(){
  const lista = DB.cargas.filter(c=>c.status==='Aguardando Veículo').sort(ordenarPorSequenciaEAtualizacao);
  document.getElementById('prog-fila-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td><input type="number" class="seq-input" value="${c.sequencia ?? ''}" onchange="atualizarSequenciaUI('${c.id}',this.value)" title="Sequência livre — digite o número que quiser, a qualquer momento."></td>
      <td>${esc(c.numeroCarga)||'—'}</td>
      <td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(c.cliente)||'—'}</td><td>${esc(c.destino)||'—'}</td><td>${esc(c.doca)||'—'}</td>
      <td>${praOndeSelectHtml(c)}</td>
      <td><input type="number" class="ganchos-input" min="0" step="1" value="${c.qtdGanchos ?? 0}" onchange="atualizarGanchosUI('${c.id}',this.value)" title="0 = Liso"></td>
      <td class="no-print"><button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${c.id}')">Excluir</button></td>
    </tr>`).join('');
  document.getElementById('prog-fila-empty').hidden = lista.length>0;
}
// Sequência continua 100% livre: número manual do Programador de Embarque,
// sem geração automática nem trava de duplicidade — regra confirmada,
// não mexer nisso (docs/DECISOES_CONFIRMADAS.md item 2).
function atualizarSequenciaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.sequencia = val==='' ? null : Number(val);
  SuincoStore.save();
  renderProgFila();
}
function praOndeSelectHtml(c){
  return `<select class="praonde-inline" onchange="atualizarPraOndeUI('${c.id}',this.value)">
    ${PRA_ONDE_OPCOES.map(op=>`<option value="${op}" ${c.praOnde===op?'selected':''}>${esc(PRA_ONDE_LABEL[op])}</option>`).join('')}
  </select>`;
}
function atualizarPraOndeUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.praOnde = PRA_ONDE_OPCOES.includes(val) ? val : '';
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarGanchosUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.qtdGanchos = val==='' ? 0 : Math.max(0, Number(val)||0);
  SuincoStore.save();
  renderProgFila();
}
function reordenarPorSequenciaUI(){
  renderProgFila();
  notify('Fila reordenada por Sequência.', 'success');
}
function excluirCargaUI(id){
  const c = getCarga(id); if(!c) return;
  if(c.status !== 'Aguardando Veículo'){ notify('Só é possível excluir cargas ainda em Aguardando Veículo — o resto já tem histórico operacional.', 'warn'); return; }
  if(!confirm(`Excluir a carga programada da placa ${c.placa}? Essa ação não pode ser desfeita.`)) return;
  DB.cargas = DB.cargas.filter(x=>x.id!==id);
  DB.movimentacoes = DB.movimentacoes.filter(m=>m.cargaId!==id);
  SuincoStore.save();
  notify('Carga excluída.', 'success');
  renderAll();
}
function renderProgAguardando(){
  const lista = DB.cargas.filter(c=>c.aguardandoCarga);
  const pill = document.getElementById('prog-aguardando-count');
  pill.hidden = lista.length===0; pill.textContent = lista.length;
  document.getElementById('prog-aguardando-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${fmtDataHora(c.criadoEm)}</td>
      <td class="no-print"><button class="btn btn-primary btn-sm" onclick="abrirCompletar('${c.id}')">Completar dados</button></td>
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
  document.getElementById('completar-produto').value = '';
  document.getElementById('completar-peso').value = '';
  document.getElementById('completar-doca').value = '';
  document.getElementById('completar-sequencia').value = '';
  document.getElementById('completar-transportadora').value = c.transportadora || '';
  document.getElementById('completar-tipoveiculo').value = c.tipoVeiculo || '';
  document.getElementById('completar-motorista').value = '';
  document.getElementById('completar-obs').value = '';
  document.getElementById('completar-praonde').value = '';
  document.getElementById('completar-ganchos').value = '0';
  document.getElementById('completar-entregas').value = '1';
  atualizarPreviewCompartilhada('completar-praonde','completar-compartilhada-preview');
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
      produto: document.getElementById('completar-produto').value,
      peso: document.getElementById('completar-peso').value,
      doca: document.getElementById('completar-doca').value,
      sequencia: document.getElementById('completar-sequencia').value,
      transportadora: document.getElementById('completar-transportadora').value,
      tipoVeiculo: document.getElementById('completar-tipoveiculo').value,
      motorista: document.getElementById('completar-motorista').value,
      observacoes: document.getElementById('completar-obs').value,
      praOnde: document.getElementById('completar-praonde').value,
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
        <span class="text-dim">${esc(c.cliente)||'sem cliente'} · ${esc(c.produto)||'—'} · ${c.peso||0}kg · ${badgeHtml(c.status)}</span></div>
      <button class="btn btn-primary btn-sm" onclick="confirmarPicker('${c.id}')">Selecionar</button>
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
  document.getElementById('exp-tbody').innerHTML = lista.map(c=>{
    const acao = NEXT_ACAO[c.status];
    return `<tr>
      <td>${c.sequencia ?? '—'}</td><td>${esc(c.numeroCarga)||'—'}</td><td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(c.destino)||'—'}</td><td>${esc(c.produto)||'—'}</td><td>${badgeHtml(c.status)}</td>
      <td class="no-print">${acao?`<button class="btn btn-primary btn-sm" onclick="avancarStatusUI('${c.id}')">${acao.label}</button>`:'—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('exp-empty').hidden = lista.length>0;
}

/* ---------- FATURAMENTO ---------- */
function renderFaturamento(){
  const alvo = ['Embarque Finalizado','Faturado'];
  const lista = cargasAbertas().filter(c=>alvo.includes(c.status));
  document.getElementById('fat-tbody').innerHTML = lista.map(c=>{
    const acao = NEXT_ACAO[c.status];
    return `<tr>
      <td>${esc(c.numeroCarga)||'—'}</td><td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.destino)||'—'}</td><td>${esc(c.produto)||'—'}</td>
      <td>${c.peso||0}</td><td>${badgeHtml(c.status)}</td>
      <td class="no-print">${acao?`<button class="btn btn-primary btn-sm" onclick="avancarStatusUI('${c.id}')">${acao.label}</button>`:'—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('fat-empty').hidden = lista.length>0;
}

/* ---------- INDICADORES / PAINEL DO GESTOR ---------- */
let indRankingPeriodoAtivo = 'hoje';
function renderIndicadores(){
  // ---- Bloco 1: histórico completo (mantém o comportamento original) ----
  const concluidas = DB.cargas.filter(c=>c.status==='Seguiu Viagem');
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
    return `<tr><th class="row-label">${esc(linha.label)}</th>${celulas}</tr>`;
  }).join('');
}
// Ranking de transportadoras com seletor de período (pílulas). Mantido
// separado da tabela de comparação acima de propósito: o número de
// transportadoras é variável, então uma matriz gigante indicador×período
// ficaria densa demais — aqui um clique troca o período, mas a tabela em
// si já mostra todas as transportadoras daquele período de uma vez.
function renderRankingPeriodos(){
  const tabs = [...PERIODOS_INDICADOR, { key:'todos', label:'Histórico completo' }];
  document.getElementById('ind-ranking-periodos').innerHTML = tabs.map(p=>`
    <button class="btn btn-sm ${p.key===indRankingPeriodoAtivo ? 'btn-primary' : 'btn-sec'}" onclick="selecionarRankingPeriodo('${p.key}')">${esc(p.label)}</button>
  `).join('');
  const cargasPeriodo = indRankingPeriodoAtivo==='todos' ? undefined : cargasConcluidasNoPeriodo(indRankingPeriodoAtivo);
  const rk = rankingTransportadoras(cargasPeriodo);
  document.getElementById('ind-ranking-tbody').innerHTML = rk.map((r,i)=>`
    <tr><td>${i+1}º</td><td>${esc(r.transportadora)}</td><td>${r.cargas}</td><td>${fmtDuracao(r.leadTimeMedio)}</td><td>${fmtDuracao(r.tempoPatioMedio)}</td></tr>
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
  const cssH = canvas.height || 220;
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
  ctx.fillStyle = '#b7c0d4';
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
    ctx.fillStyle = it.valor===null ? '#374a86' : it.cor;
    ctx.fillRect(cx - larguraBarra/2, y, larguraBarra, altura || 2);
    // valor em texto, sempre acima da barra — nunca só a cor/altura carrega a informação
    ctx.fillStyle = '#f2f4f8';
    ctx.textAlign = 'center';
    ctx.fillText(it.valor===null ? 'sem dado' : fmtDuracao(it.valor), cx, y - 6 < 12 ? 12 : y - 6);
    // rótulo da etapa, embaixo
    ctx.fillStyle = '#b7c0d4';
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
  ctx.strokeStyle = 'rgba(233,185,84,.28)';
  ctx.beginPath(); ctx.moveTo(padL, padTop); ctx.lineTo(padL, padTop+areaH); ctx.lineTo(padL+areaW, padTop+areaH); ctx.stroke();
  // linha
  ctx.strokeStyle = '#e9b954'; ctx.lineWidth = 2.5; ctx.beginPath();
  pontos.forEach((p,i)=>{
    const x = padL + passoX*i, y = coordY(p.quantidade);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
  // pontos + valor em texto (nunca só a posição do ponto carrega a info)
  ctx.font = '12px Segoe UI, sans-serif'; ctx.textAlign = 'center';
  pontos.forEach((p,i)=>{
    const x = padL + passoX*i, y = coordY(p.quantidade);
    ctx.fillStyle = '#e9b954';
    ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f2f4f8';
    ctx.fillText(String(p.quantidade), x, y-10 < 10 ? 10 : y-10);
    if(pontos.length <= 14 || i%Math.ceil(pontos.length/14)===0){
      ctx.fillStyle = '#b7c0d4';
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
window.addEventListener('resize', ()=>{ if(TAB_ATUAL==='indicadores' && abasDesbloqueadasNestaSessao.has('indicadores')) renderGraficosIndicadores(); });

/* ---------- CADASTROS ---------- */
function renderCadastros(){
  renderFrotaTabela();
  renderTranspLista();
  renderDocaLista();
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
  const LIMITE = 300;
  const exibidos = lista.slice(0, LIMITE);
  document.getElementById('frota-tbody').innerHTML = exibidos.map(f=>`
    <tr>
      <td>${esc(f.placa)}</td><td>${esc(f.transportadora)||'—'}</td><td>${esc(f.tipoVeiculo)||'—'}</td>
      <td>${f.capacidadeKg ? f.capacidadeKg.toLocaleString('pt-BR') : '—'}</td>
      <td>${esc(f.uf)||'—'}</td>
      <td>${f.dataUltimaMovimentacao ? new Date(f.dataUltimaMovimentacao+'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
      <td>${f.precisaRevisao ? '<span class="badge badge-aguardando-veiculo">SIM</span>' : '<span class="text-dim">Não</span>'}</td>
      <td class="no-print"><button class="btn btn-danger btn-sm" onclick="removerFrotaUI('${esc(f.placa)}')">Remover</button></td>
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
    dataUltimaMovimentacao: document.getElementById('frota-ultima-mov').value,
    precisaRevisao: document.getElementById('frota-revisao').checked
  });
  ['frota-placa','frota-transportadora','frota-tipoveiculo','frota-capacidade','frota-uf','frota-ultima-mov'].forEach(id=>document.getElementById(id).value='');
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
      <button class="btn btn-danger btn-sm no-print" onclick="removerTransportadoraUI('${t.id}')">Remover</button></div>
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
function renderDocaLista(){
  const lista = listarDocas();
  document.getElementById('cad-doca-lista').innerHTML = lista.length ? lista.map(d=>`
    <div class="modal-list-item"><span>${esc(d.nome)}</span>
      <button class="btn btn-danger btn-sm no-print" onclick="removerDocaUI('${d.id}')">Remover</button></div>
  `).join('') : '<div class="empty-state">Nenhuma doca cadastrada.</div>';
}
function addDocaUI(){
  try{
    addDoca(document.getElementById('cad-doca-nome').value);
    document.getElementById('cad-doca-nome').value = '';
    notify('Doca adicionada.', 'success');
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
function removerDocaUI(id){ removerDoca(id); renderAll(); }
function atualizarDatalists(){
  document.getElementById('lista-transportadoras').innerHTML = DB.transportadoras.map(t=>`<option value="${esc(t.nome)}">`).join('');
  document.getElementById('lista-docas').innerHTML = DB.docas.map(d=>`<option value="${esc(d.nome)}">`).join('');
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
  return `<button class="btn btn-sec btn-sm" onclick="selecionarCargaTimeline('${c.id}')">
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
    ['Produto', c.produto || '—'],
    ['Transportadora', c.transportadora || '—'],
    ['Tipo de Veículo', c.tipoVeiculo || '—'],
    ['Motorista', c.motorista || '—'],
    ['Pra onde?', c.praOnde ? (PRA_ONDE_LABEL[c.praOnde]||c.praOnde) : '(Direto Suinco)'],
    ['Compartilhada?', compartilhadaDaCarga(c)],
    ['Qtd. Ganchos', (c.qtdGanchos ? c.qtdGanchos : 'Liso')],
    ['Qtd. Entregas', c.qtdEntregas ?? 1]
  ];

  wrap.innerHTML = `
    <div class="timeline-card">
      <div class="timeline-head">
        <div class="timeline-placa">🚚 ${esc(c.placa)} <span class="text-dim" style="font-size:14px;font-weight:600">status atual:</span> ${badgeHtml(c.status)}</div>
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
function renderHistorico(){
  const filtroPlaca = normalizarPlaca(document.getElementById('hist-filtro-placa')?.value || '');
  const filtroSetor = document.getElementById('hist-filtro-setor')?.value || '';
  let lista = DB.movimentacoes.slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  if(filtroPlaca) lista = lista.filter(m=>m.placa.includes(filtroPlaca));
  if(filtroSetor) lista = lista.filter(m=>m.setor===filtroSetor);
  document.getElementById('hist-tbody').innerHTML = lista.map(m=>`
    <tr>
      <td>${fmtDataHora(m.timestamp)}</td><td>${esc(m.placa)}</td>
      <td>${m.statusAnterior ? badgeHtml(m.statusAnterior) : '—'}</td><td>${badgeHtml(m.statusNovo)}</td>
      <td>${esc(m.operador)}</td><td>${esc(m.setor)}</td>
    </tr>`).join('');
  document.getElementById('hist-empty').hidden = lista.length>0;
}

/* ---------- RELATÓRIOS (PDF via impressão do navegador) ---------- */
function imprimirContainer(el){
  document.querySelectorAll('.print-only').forEach(x=>x.style.display='none');
  el.style.display = 'block';
  const limpar = ()=>{ el.style.display='none'; window.removeEventListener('afterprint', limpar); };
  window.addEventListener('afterprint', limpar);
  window.print();
}
// PDF Operacional — sequenciamento de carregamento do dia, redesenhado pra
// bater visualmente com a planilha real que a operação usa hoje.
// DECISÃO: cargas ainda com a flag "Aguardando Carga" (dados incompletos,
// sem Rota/Nº de Carga — texto "Aguardando Carga" no campo Número da
// Carga) ficam de fora desta lista — elas aparecem na Torre de Controle e
// na fila de pendências da Programação, mas não fazem sentido numa
// planilha de sequenciamento de carregamento ainda sem dados.
const CORES_PRA_ONDE = { 'CROSS':'#374a86', 'DEDICADA':'#8f1f26', 'RET FRIGO':'#b9903f' };
function exportarPdfOperacional(){
  const el = document.getElementById('print-operacional');
  const lista = cargasAbertas().filter(c=>!c.aguardandoCarga).slice().sort(ordenarPorSequenciaEAtualizacao);
  const linhas = lista.map((c,i)=>{
    const sc = statusCarregamentoInfo(c.status);
    const faturado = estaFaturado(c);
    const pesoTon = ((c.peso||0)/1000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2});
    const praOndeStyle = c.praOnde ? `style="background:${CORES_PRA_ONDE[c.praOnde]||'#e9b954'};color:#fff;font-weight:800"` : '';
    return `<tr>
      <td>${i+1}</td>
      <td>${esc(c.numeroCarga)||'—'}</td>
      <td>${esc(c.destino)||'—'}</td>
      <td ${praOndeStyle}>${c.praOnde ? esc(PRA_ONDE_LABEL[c.praOnde]) : '—'}</td>
      <td ${faturado?'style="background:#3fa66a;color:#06210f;font-weight:800"':''}>${faturado?'FATURADO':''}</td>
      <td style="background:${sc.cor};color:#06210f;font-weight:800">${esc(sc.texto)}</td>
      <td>${esc(c.placa)}</td>
      <td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${pesoTon}</td>
      <td>${compartilhadaDaCarga(c)}</td>
      <td>${c.qtdEntregas ?? 1}</td>
      <td>${c.qtdGanchos ? c.qtdGanchos : 'Liso'}</td>
    </tr>`;
  }).join('');
  const agora = new Date();
  el.innerHTML = `
    <div class="print-page">
      <div class="print-header">
        <img src="assets/logo_suinco.png" alt="Suinco">
        <div><h1>PDF Operacional — Sequenciamento de Carregamento</h1>
        <div class="meta">Gerado em ${fmtDataHora(agora.toISOString())} · ${lista.length} carga(s)</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Nº</th><th>Carga</th><th>Rota</th><th>Pra onde?</th><th>Faturado</th><th>Status de Carregamento</th>
          <th>Placa</th><th>Empresa</th><th>Perfil</th><th>Peso(ton)</th><th>Compartilhada?</th><th>Qtd. Entregas</th><th>Qtd. Ganchos</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="13" class="text-center text-dim">Nenhuma carga pronta para sequenciamento.</td></tr>'}</tbody>
      </table>
    </div>`;
  imprimirContainer(el);
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
function exportarPdfExecutivo(){
  const el = document.getElementById('print-executivo');
  const abertas = cargasAbertas();
  const concluidas = DB.cargas.filter(c=>c.status==='Seguiu Viagem');
  const porStatus = {};
  abertas.forEach(c=>{ porStatus[c.status] = (porStatus[c.status]||0) + 1; });
  let somaLead=0, nLead=0;
  concluidas.forEach(c=>{ const ind = indicadoresDaCarga(c.id); if(ind.leadTimeTotal!==null){ somaLead+=ind.leadTimeTotal; nLead++; } });
  const rk = rankingTransportadoras().slice(0,5);
  const agora = new Date();
  el.innerHTML = `
    <div class="print-page">
      <div class="print-header">
        <img src="assets/logo_suinco.png" alt="Suinco">
        <div><h1>PDF Executivo — Painel Logístico</h1>
        <div class="meta">${agora.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})} · ${agora.toLocaleTimeString('pt-BR')}</div></div>
      </div>
      <div class="grid4" style="margin-bottom:18px">
        <div class="stat-box"><div class="stat-num">${abertas.length}</div><div class="stat-label">Cargas em Aberto</div></div>
        <div class="stat-box"><div class="stat-num">${concluidas.length}</div><div class="stat-label">Concluídas (Seguiu Viagem)</div></div>
        <div class="stat-box"><div class="stat-num">${fmtDuracao(nLead?Math.round(somaLead/nLead):null)}</div><div class="stat-label">Lead Time Médio</div></div>
        <div class="stat-box"><div class="stat-num">${abertas.filter(c=>c.aguardandoCarga).length}</div><div class="stat-label">Aguardando Carga</div></div>
      </div>
      <div class="card-title" style="color:var(--gold);font-weight:800;margin-bottom:8px">Top Transportadoras (lead time médio)</div>
      <table>
        <thead><tr><th>Transportadora</th><th>Cargas</th><th>Lead Time Médio</th></tr></thead>
        <tbody>${rk.map(r=>`<tr><td>${esc(r.transportadora)}</td><td>${r.cargas}</td><td>${fmtDuracao(r.leadTimeMedio)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-center text-dim">Sem dados suficientes.</td></tr>'}</tbody>
      </table>
    </div>`;
  imprimirContainer(el);
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
  // Carrega a base real de Frota (2.038 placas) na primeira execução, antes
  // de desenhar a tela — ver carregarFrotaSeedSeVazia em data.js. Nunca
  // trava o painel se falhar (ex: aberto via file://): segue com Frota
  // vazia, exigindo cadastro/import manual como já era antes desta base.
  const seed = await carregarFrotaSeedSeVazia();
  if(seed.carregado) notify(`Base de Frota carregada: ${seed.total} placa(s).`, 'success');
  atualizarDatalists();
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
