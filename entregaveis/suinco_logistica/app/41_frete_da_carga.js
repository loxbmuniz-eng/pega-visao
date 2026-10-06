/* =====================================================================
   A OBSERVAÇÃO DO FRETE NA TELA — a pergunta antes de contratar (06/10/2026)
   ---------------------------------------------------------------------
   Decisão do dono: sem a observação do frete (TABELA ou COMBINADO com o
   valor), não se contrata a carga — "sempre, sem exceções". A regra mora em
   data.js (freteFaltandoParaContratar, espelho do servidor); aqui mora a
   PERGUNTA. Ela abre nos quatro pontos em que a placa entra (Programação,
   Montagem, Torre/Fila e completar a chegada da Portaria) e também no selo
   "frete a definir" das cargas que nasceram antes da regra.

   PERGUNTAR, NÃO BLOQUEAR: botão desabilitado não ensina o caminho. Quem
   tem autoridade para contratar decide ali mesmo, e o valor da tabela vem
   mostrado para conferir quando já é conhecido.
   ===================================================================== */
let _freteContratar = null;   // { resolver }

function freteReais(n){
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Abre a pergunta e devolve { freteObservacao, freteCombinado } — ou null,
   se a pessoa cancelar. `info` descreve a carga: placa, transportadora,
   tipoVeiculo, numeroCarga, destino, km, valorTabela, e o que já existir
   (freteObservacao/freteCombinado) para vir marcado. `motivo` diz POR QUE a
   pergunta apareceu ("contratar", "troca de transportadora", "a definir"). */
function perguntarFreteUI(info, motivo){
  const el = (id) => document.getElementById(id);
  if(!el('modal-frete-contratar')) return Promise.resolve(null);
  if(_freteContratar) _freteContratar.resolver(null);
  const linha = (rot, val) => `<div class="fat-conf-linha"><span class="fat-conf-rot">${rot}</span><span class="fat-conf-val">${esc(val) || '—'}</span></div>`;
  el('frete-c-contexto').textContent = motivo === 'troca'
    ? `A transportadora mudou: informe o frete da nova. O anterior vem marcado para você confirmar ou corrigir.`
    : motivo === 'definir'
      ? 'Esta carga já foi contratada sem a observação do frete. Informe agora para a Administração de Fretes entender o valor.'
      : 'Sem a observação do frete a carga não é contratada. O valor do frete não é editável: ele é o KM × a tarifa da tabela.';
  el('frete-c-resumo').innerHTML = linha('Carga', info.numeroCarga)
    + linha('Placa', info.placa) + linha('Transportadora', info.transportadora)
    + linha('Destino do frete', info.destino) + linha('KM', info.km !== null && info.km !== undefined && info.km !== '' ? kmTexto(info.km) : '');
  el('frete-c-valor-tabela').textContent = info.valorTabela !== null && info.valorTabela !== undefined
    ? `(R$ ${freteReais(info.valorTabela)})`
    : '(o servidor calcula ao gravar: KM × tarifa do tipo de veículo)';
  const obs = String(info.freteObservacao || '').toUpperCase();
  el('frete-c-tabela').checked = obs === 'TABELA';
  el('frete-c-combinado').checked = obs === 'COMBINADO';
  el('frete-c-valor').value = obs === 'COMBINADO' && info.freteCombinado ? freteReais(info.freteCombinado) : '';
  el('frete-c-erro').hidden = true;
  freteContratarOpcaoUI();
  el('modal-frete-contratar').classList.add('open');
  setTimeout(() => (obs === 'COMBINADO' ? el('frete-c-valor') : el(obs ? 'frete-c-confirmar' : 'frete-c-tabela')).focus(), 30);
  return new Promise((resolver) => { _freteContratar = { resolver }; });
}

function freteContratarOpcaoUI(){
  const combinado = document.getElementById('frete-c-combinado').checked;
  document.getElementById('frete-c-valor-wrap').hidden = !combinado;
  if(combinado) document.getElementById('frete-c-valor').focus();
}

function freteContratarResponder(resposta){
  const m = document.getElementById('modal-frete-contratar');
  if(m) m.classList.remove('open');
  const atual = _freteContratar;
  _freteContratar = null;
  if(atual) atual.resolver(resposta);
}

function freteContratarConfirmarUI(){
  const erro = document.getElementById('frete-c-erro');
  const obs = document.getElementById('frete-c-tabela').checked ? 'TABELA'
    : document.getElementById('frete-c-combinado').checked ? 'COMBINADO' : '';
  if(!obs){
    erro.textContent = 'Escolha TABELA ou COMBINADO.';
    erro.hidden = false;
    return;
  }
  const valor = obs === 'COMBINADO' ? valorEmReaisLocal(document.getElementById('frete-c-valor').value) : null;
  if(obs === 'COMBINADO' && valor === null){
    erro.textContent = 'Digite o valor combinado, maior que zero (ex.: 14.000,00).';
    erro.hidden = false;
    document.getElementById('frete-c-valor').focus();
    return;
  }
  freteContratarResponder({ freteObservacao: obs, freteCombinado: valor });
}

/* Esc fecha como "Cancelar"; Enter no campo de valor confirma. */
document.addEventListener('keydown', (ev) => {
  if(!_freteContratar) return;
  if(ev.key === 'Escape'){ ev.preventDefault(); freteContratarResponder(null); }
  if(ev.key === 'Enter' && ev.target && ev.target.id === 'frete-c-valor'){ ev.preventDefault(); freteContratarConfirmarUI(); }
});

/* Garante a observação antes de contratar. Devolve os campos de frete a
   usar (os que já existiam, se já bastam) ou null se a pessoa cancelou. */
async function garantirFreteParaContratar(info, motivo){
  const falta = freteFaltandoParaContratar(info);
  if(!falta && motivo !== 'troca') return { freteObservacao: info.freteObservacao || '', freteCombinado: info.freteCombinado ?? null };
  return perguntarFreteUI(info, motivo);
}

/* O SELO "frete a definir" — carga contratada antes da regra. Só a Logística
   e a Administração o veem (são quem decide o frete); clicar abre a pergunta.

   SÓ QUANDO HÁ O QUE FAZER (06/10/2026). Havia também um selo informativo
   ("frete: tabela", "combinado R$ x") em toda linha. O portão 49 o barrou:
   letra de 11px (piso é 12), alvo de toque de 18px no celular (mínimo 44)
   e a Torre 74px mais alta — a compactação dela foi feita de propósito. A
   informação já está no relatório, na Montagem e na pergunta; na Torre
   fica só o que pede ação — e só na TORRE, embaixo do número da carga: na
   Fila de programados a coluna é estreita e o selo quebrava a linha (a Fila
   do dia recebe carga nova, que já nasce com a observação). */
function seloFreteHtml(c){
  if(!podeVerValorDeFreteLocal()) return '';
  if(!freteADefinir(c)) return '';
  return `<button type="button" class="selo-frete selo-frete-definir" onclick="event.stopPropagation(); definirFreteDaCargaUI('${escJs(c.id)}')"
    title="Carga contratada sem a observação do frete. Clique para informar TABELA ou COMBINADO.">frete a definir</button>`;
}

function podeVerValorDeFreteLocal(){
  const s = DB.operador && DB.operador.setor;
  return s === 'Logística' || s === 'Administração';
}

async function definirFreteDaCargaUI(id){
  const c = getCarga(id);
  if(!c) return;
  const r = await perguntarFreteUI(infoFreteDaCarga(c), freteADefinir(c) ? 'definir' : 'contratar');
  if(!r) return;
  aplicarFreteNaCarga(c, r);
}

function infoFreteDaCarga(c){
  return { placa: c.placa, transportadora: c.transportadora, tipoVeiculo: c.tipoVeiculo, numeroCarga: c.numeroCarga,
    destino: c.freteDestino || c.destino, km: c.kmDeslocamento ?? c.kmDestino ?? null, valorTabela: c.freteValor ?? null,
    freteObservacao: c.freteObservacao, freteCombinado: c.freteCombinado };
}

function aplicarFreteNaCarga(c, r){
  const antes = c.freteObservacao === 'COMBINADO' ? `COMBINADO R$ ${freteReais(c.freteCombinado || 0)}` : (c.freteObservacao || '—');
  c.freteObservacao = r.freteObservacao;
  c.freteCombinado = r.freteObservacao === 'COMBINADO' ? r.freteCombinado : null;
  c.atualizadoEm = nowISO();
  const depois = r.freteObservacao === 'COMBINADO' ? `COMBINADO R$ ${freteReais(r.freteCombinado)}` : 'TABELA';
  registrarAlteracao({ cargaId: c.id, placa: c.placa, campo: 'Observação do frete', de: antes, para: depois,
    setor: (DB.operador && DB.operador.setor) || 'Logística', operador: (DB.operador && DB.operador.nome) || '(não identificado)' });
  SuincoStore.save();
  notifyGravacao(`Frete da carga ${c.numeroCarga || c.placa}: ${depois}.`);
  renderAll();
}
