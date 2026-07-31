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
const NEXT_ACAO = {
  'Veículo em Pátio':       { label:'Liberar p/ Embarque', destino:'Liberado para Embarque' },
  'Liberado para Embarque': { label:'Iniciar Embarque',    destino:'Embarque Iniciado' },
  'Embarque Iniciado':      { label:'Finalizar Embarque',  destino:'Embarque Finalizado' },
  'Embarque Finalizado':    { label:'Faturar',             destino:'Faturado' },
  'Faturado':               { label:'Liberar p/ Saída',    destino:'Liberado para Saída' }
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
function aplicarPermissoesSetor(){
  if(!DB.operador) return;
  const permitido = SETOR_PERMISSOES[DB.operador.setor] || [];
  document.querySelectorAll('.nav-tab').forEach(el=>{
    el.hidden = !permitido.includes(el.dataset.tab);
  });
  if(!permitido.includes(TAB_ATUAL)) abrirTab(permitido[0] || 'torre');
}

/* ---------- navegação ---------- */
function abrirTab(tab){
  document.querySelectorAll('.tab-page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el=>el.classList.remove('active'));
  const page = document.getElementById('tab-'+tab);
  const navBtn = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
  if(page) page.classList.add('active');
  if(navBtn) navBtn.classList.add('active');
  TAB_ATUAL = tab;
  renderTabAtual();
}
function renderTabAtual(){
  atualizarDatalists();
  switch(TAB_ATUAL){
    case 'torre': renderTorre(); break;
    case 'programacao': renderProgFila(); renderProgAguardando(); break;
    case 'portaria': renderPortariaPatio(); break;
    case 'expedicao': renderExpedicao(); break;
    case 'faturamento': renderFaturamento(); break;
    case 'indicadores': renderIndicadores(); break;
    case 'cadastros': renderCadastros(); break;
    case 'historico': renderHistorico(); break;
  }
}
function renderAll(){ renderTabAtual(); }

/* ---------- TORRE DE CONTROLE ---------- */
function renderTorre(){
  const abertas = cargasAbertas();
  const porStatus = {};
  abertas.forEach(c=>{ porStatus[c.status] = (porStatus[c.status]||0) + 1; });
  const ordemExibicao = ['Aguardando Carga', ...STATUS_FLOW.slice(0,-1)];
  document.getElementById('torre-stats').innerHTML = ordemExibicao.map(s=>`
    <div class="stat-box"><div class="stat-num">${porStatus[s]||0}</div><div class="stat-label">${esc(s)}</div></div>
  `).join('');

  const lista = abertas.slice().sort(ordenarPorSequenciaEAtualizacao);
  const tbody = document.getElementById('torre-tbody');
  tbody.innerHTML = lista.map(c=>`
    <tr>
      <td>${c.sequencia ?? '—'}</td><td>${esc(c.numeroCarga)||'—'}</td><td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${esc(c.cliente)||'—'}</td><td>${esc(c.destino)||'—'}</td><td>${esc(c.produto)||'—'}</td><td>${c.peso||0}</td><td>${esc(c.doca)||'—'}</td>
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
    hint.innerHTML = '<span style="color:var(--warn)">⚠️ Placa não cadastrada na Frota. Preencha Transportadora/Tipo de Veículo manualmente ou cadastre em Cadastros → Frota.</span>';
  } else {
    hint.innerHTML = '';
  }
}
function criarCargaProgramadaUI(){
  const placa = document.getElementById('prog-placa').value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  try{
    criarCargaProgramada({
      placa,
      transportadora: document.getElementById('prog-transportadora').value,
      tipoVeiculo: document.getElementById('prog-tipoveiculo').value,
      numeroCarga: document.getElementById('prog-numero-carga').value,
      cliente: document.getElementById('prog-cliente').value,
      destino: document.getElementById('prog-destino').value,
      produto: document.getElementById('prog-produto').value,
      peso: document.getElementById('prog-peso').value,
      doca: document.getElementById('prog-doca').value,
      sequencia: document.getElementById('prog-sequencia').value,
      observacoes: document.getElementById('prog-obs').value,
      operador: nomeOperadorAtual()
    });
    notify(`Carga criada para a placa ${normalizarPlaca(placa)} — status Programado.`, 'success');
    ['prog-placa','prog-transportadora','prog-tipoveiculo','prog-numero-carga','prog-cliente','prog-destino','prog-produto','prog-peso','prog-doca','prog-sequencia','prog-obs']
      .forEach(id=>document.getElementById(id).value='');
    document.getElementById('prog-frota-hint').innerHTML = '';
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
function renderProgFila(){
  const lista = DB.cargas.filter(c=>c.status==='Programado').sort(ordenarPorSequenciaEAtualizacao);
  document.getElementById('prog-fila-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td><input type="number" class="seq-input" value="${c.sequencia ?? ''}" onchange="atualizarSequenciaUI('${c.id}',this.value)"></td>
      <td>${esc(c.numeroCarga)||'—'}</td>
      <td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td>
      <td>${esc(c.cliente)||'—'}</td><td>${esc(c.destino)||'—'}</td><td>${esc(c.doca)||'—'}</td>
      <td class="no-print"><button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${c.id}')">Excluir</button></td>
    </tr>`).join('');
  document.getElementById('prog-fila-empty').hidden = lista.length>0;
}
function atualizarSequenciaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.sequencia = val==='' ? null : Number(val);
  SuincoStore.save();
  renderProgFila();
}
function reordenarPorSequenciaUI(){
  renderProgFila();
  notify('Fila reordenada por Sequência.', 'success');
}
function excluirCargaUI(id){
  const c = getCarga(id); if(!c) return;
  if(c.status !== 'Programado'){ notify('Só é possível excluir cargas ainda em Programado — o resto já tem histórico operacional.', 'warn'); return; }
  if(!confirm(`Excluir a carga programada da placa ${c.placa}? Essa ação não pode ser desfeita.`)) return;
  DB.cargas = DB.cargas.filter(x=>x.id!==id);
  DB.movimentacoes = DB.movimentacoes.filter(m=>m.cargaId!==id);
  SuincoStore.save();
  notify('Carga excluída.', 'success');
  renderAll();
}
function renderProgAguardando(){
  const lista = DB.cargas.filter(c=>c.status==='Aguardando Carga');
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
  document.getElementById('completar-obs').value = '';
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
      observacoes: document.getElementById('completar-obs').value,
      operador: nomeOperadorAtual()
    });
    fecharModalCompletar();
    notify('Dados completados — carga agora em "Veículo em Pátio".', 'success');
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
    notify(`${normalizarPlaca(placa)}: nenhuma programação encontrada — criada entrada "Aguardando Carga". Avise a Logística para completar os dados.`, 'warn');
  } else if(r.atualizadas.length){
    notify(`${normalizarPlaca(placa)}: ${r.atualizadas.length} carga(s) agora em "Veículo em Pátio".`, 'success');
  } else if(r.jaNoPatio.length){
    notify(`${normalizarPlaca(placa)} já está no pátio (${r.jaNoPatio.map(c=>c.status).join(', ')}).`, '');
  }
  input.value = '';
  renderAll();
}
function acaoSaidaUI(){
  const input = document.getElementById('portaria-placa');
  const placa = input.value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  const r = registrarSaidaPortaria(placa, nomeOperadorAtual());
  if(r.liberadas.length) notify(`${normalizarPlaca(placa)}: saída registrada para ${r.liberadas.length} carga(s) — Seguiu Viagem.`, 'success');
  if(r.pendentes.length) notify(`${normalizarPlaca(placa)}: ${r.pendentes.length} carga(s) ainda não liberada(s) para saída (status atual: ${r.pendentes.map(c=>c.status).join(', ')}).`, 'warn');
  if(!r.liberadas.length && !r.pendentes.length) notify(`Nenhuma carga em aberto encontrada para a placa ${normalizarPlaca(placa)}.`, 'warn');
  input.value = '';
  renderAll();
}
function renderPortariaPatio(){
  const noPatio = cargasAbertas().filter(c=>c.status!=='Programado');
  const porPlaca = {};
  noPatio.forEach(c=>{ (porPlaca[c.placa] = porPlaca[c.placa]||[]).push(c); });
  const placas = Object.keys(porPlaca);
  document.getElementById('portaria-patio-tbody').innerHTML = placas.map(p=>{
    const cargas = porPlaca[p];
    const transp = cargas[0].transportadora || '—';
    const chegada = cargas.map(c=>primeiroTimestamp(c.id,'Veículo em Pátio')||primeiroTimestamp(c.id,'Aguardando Carga')||c.criadoEm).sort()[0];
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
  const alvo = ['Veículo em Pátio','Liberado para Embarque','Embarque Iniciado'];
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

/* ---------- INDICADORES ---------- */
function renderIndicadores(){
  const concluidas = DB.cargas.filter(c=>c.status==='Seguiu Viagem');
  const campos = ['tempoAguardandoEmbarque','tempoCarregamento','tempoFaturamento','tempoPatioTotal'];
  const labels = {
    tempoAguardandoEmbarque:'Tempo Aguardando Embarque',
    tempoCarregamento:'Tempo de Carregamento',
    tempoFaturamento:'Tempo de Faturamento',
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

  const rk = rankingTransportadoras();
  document.getElementById('ind-ranking-tbody').innerHTML = rk.map((r,i)=>`
    <tr><td>${i+1}º</td><td>${esc(r.transportadora)}</td><td>${r.cargas}</td><td>${fmtDuracao(r.leadTimeMedio)}</td><td>${fmtDuracao(r.tempoPatioMedio)}</td></tr>
  `).join('');
  document.getElementById('ind-ranking-empty').hidden = rk.length>0;
}

/* ---------- CADASTROS ---------- */
function renderCadastros(){
  renderFrotaTabela();
  renderTranspLista();
  renderDocaLista();
}
function renderFrotaTabela(){
  const lista = DB.frota.slice().sort((a,b)=>a.placa.localeCompare(b.placa));
  document.getElementById('frota-tbody').innerHTML = lista.map(f=>`
    <tr>
      <td>${esc(f.placa)}</td><td>${esc(f.transportadora)||'—'}</td><td>${esc(f.tipoVeiculo)||'—'}</td>
      <td class="no-print"><button class="btn btn-danger btn-sm" onclick="removerFrotaUI('${esc(f.placa)}')">Remover</button></td>
    </tr>`).join('');
  document.getElementById('frota-empty').hidden = lista.length>0;
}
function addFrotaUI(){
  const placa = document.getElementById('frota-placa').value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  upsertFrota(placa, document.getElementById('frota-transportadora').value, document.getElementById('frota-tipoveiculo').value);
  ['frota-placa','frota-transportadora','frota-tipoveiculo'].forEach(id=>document.getElementById(id).value='');
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
function exportarPdfOperacional(){
  const el = document.getElementById('print-operacional');
  const abertas = cargasAbertas().slice().sort(ordenarPorSequenciaEAtualizacao);
  const linhas = abertas.map(c=>{
    const ind = indicadoresDaCarga(c.id);
    return `<tr>
      <td>${c.sequencia ?? '—'}</td><td>${esc(c.numeroCarga)||'—'}</td><td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${esc(c.cliente)||'—'}</td><td>${esc(c.destino)||'—'}</td><td>${esc(c.produto)||'—'}</td><td>${c.peso||0}</td><td>${esc(c.doca)||'—'}</td>
      <td>${badgeHtml(c.status)}</td>
      <td>${fmtDuracao(ind.tempoAguardandoEmbarque)}</td><td>${fmtDuracao(ind.tempoCarregamento)}</td><td>${fmtDuracao(ind.tempoFaturamento)}</td>
    </tr>`;
  }).join('');
  const agora = new Date();
  el.innerHTML = `
    <div class="print-page">
      <div class="print-header">
        <img src="assets/logo_suinco.png" alt="Suinco">
        <div><h1>PDF Operacional — Painel Logístico</h1>
        <div class="meta">Gerado em ${fmtDataHora(agora.toISOString())} · ${abertas.length} carga(s) em aberto</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Seq.</th><th>Nº Carga</th><th>Placa</th><th>Transp.</th><th>Tipo Veíc.</th><th>Cliente</th><th>Destino</th><th>Produto</th><th>Peso(kg)</th><th>Doca</th><th>Status</th>
          <th>Aguard. Embarque</th><th>Carregamento</th><th>Faturamento</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="14" class="text-center text-dim">Nenhuma carga em aberto.</td></tr>'}</tbody>
      </table>
    </div>`;
  imprimirContainer(el);
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
        <div class="stat-box"><div class="stat-num">${porStatus['Aguardando Carga']||0}</div><div class="stat-label">Aguardando Carga</div></div>
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
function init(){
  atualizarDatalists();
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
