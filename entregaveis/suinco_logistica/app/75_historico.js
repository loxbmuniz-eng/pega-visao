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
  const dia = diaDaProgramacao(c);   // dia de Brasília, não do UTC (#100)
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
        <button class="btn btn-sec btn-sm" onclick="corrigirEtapaCargaUI('${escJs(c.id)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-desfazer"/></svg>Aplicar etapa</button>
      </div>

      <div class="admin-carga-linha">
        <label>Data da programação</label>
        <input type="date" id="adm-data-${esc(c.id)}" value="${esc(dia)}">
        <input type="text" id="adm-data-motivo-${esc(c.id)}" placeholder="Motivo da correção de data">
        <button class="btn btn-sec btn-sm" onclick="corrigirDataProgramacaoUI('${escJs(c.id)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-calendario"/></svg>Aplicar data</button>
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
  if(!(await perguntarUI({ titulo: `${voltando ? 'VOLTAR' : 'Avançar'} a carga ${c.numeroCarga || c.placa}?`,
       texto: `De "${c.status}" para "${status}".\n\n`
         + 'Isso muda o andamento para todos os setores e fica registrado no histórico.',
       botao: voltando ? 'Voltar a etapa' : 'Avançar', perigo: voltando }))) return;
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
            <td>${esc(diaDaProgramacao(c).split('-').reverse().join('/'))}</td>
            <td class="no-print"><button class="btn btn-sec btn-sm"
              onclick="devolverCargaExcluidaUI('${escJs(c.id)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-desfazer"/></svg>Devolver</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

async function devolverCargaExcluidaUI(id){
  const motivo = await perguntarUI({ titulo: 'Devolver esta carga ao painel?',
    campo: { tipo: 'motivo', rotulo: 'Por que ela está voltando?', dica: 'Fica registrado no histórico com o seu nome.' },
    botao: 'Devolver' });
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

/* PEDIU MAIS QUE A JANELA LOCAL? BUSCA NO SERVIDOR (09/09/2026).

   O navegador guarda 30 dias (JANELA_LOCAL_DIAS, data.js). A decisão do
   dono foi explícita: "se eu quiser buscar mais ele vai aparecer". Esta é
   a ponte — uma função, três chamadores (Histórico, Indicadores,
   Relatórios). O que vem fica em memória e some ao recarregar; as telas
   não sabem de onde o dado veio, então nenhuma delas precisou mudar de
   cálculo.

   Sem servidor, DIZ. Mostrar 30 dias calados quando alguém pediu 90 é a
   família "número errado com cara de certo" — o gestor compararia meses
   com um deles pela metade. */
let _buscandoPeriodo = null;
async function garantirPeriodoNoPainel(de, ate, ondeAvisar){
  if(!de) return { ok:true, jaTinha:true };
  const inicio = Date.parse(de + 'T00:00:00');
  if(!Number.isFinite(inicio) || inicio >= limiteDaJanelaLocal()) return { ok:true, jaTinha:true };
  const fim = ate && /^\d{4}-\d{2}-\d{2}$/.test(ate) ? ate : isoDiaLocal(new Date());
  const chave = de + '|' + fim;
  if(_buscandoPeriodo === chave) return { ok:true, emAndamento:true };
  _buscandoPeriodo = chave;
  const aviso = ondeAvisar && document.getElementById(ondeAvisar);
  if(aviso){ aviso.hidden = false; aviso.textContent = 'Buscando no servidor o período anterior aos últimos '
    + JANELA_LOCAL_DIAS + ' dias…'; }
  const r = await buscarHistoricoNoServidor(de, fim);
  _buscandoPeriodo = null;
  if(aviso){
    if(r.ok){
      aviso.hidden = r.cargas === 0;
      aviso.textContent = `${r.cargas} carga(s) do período vieram do servidor — este navegador guarda `
        + `os últimos ${JANELA_LOCAL_DIAS} dias.`;
    }else{
      aviso.hidden = false;
      aviso.textContent = r.motivo === 'sem-servidor'
        ? `Sem servidor agora: só os últimos ${JANELA_LOCAL_DIAS} dias estão neste navegador. `
          + 'O que é mais antigo está guardado no servidor e aparece quando a conexão voltar.'
        : `Não consegui buscar o período no servidor (${esc(r.erro || '')}). O que está na tela são só os `
          + `últimos ${JANELA_LOCAL_DIAS} dias.`;
    }
  }
  if(r.ok && r.cargas) renderAll();
  return r;
}

/* APAGAR DA VISTA (11/09/2026) — botão só para Administração, e só quando
   uma placa está filtrada: apagar "todo o histórico" sem filtro nenhum é
   o tipo de clique acidental que a tela não pode permitir. O servidor
   decide de novo (é ele quem checa o setor); esconder o botão aqui é só
   o primeiro filtro, não o controle. */
function podeApagarHistoricoUI(){
  return (DB.operador || {}).setor === 'Administração';
}
async function apagarHistoricoDaPlacaUI(){
  const placa = normalizarPlaca(document.getElementById('hist-filtro-placa')?.value || '');
  if(!placa){ notify('Filtre por uma placa antes de apagar.', 'erro', 5000); return; }
  /* UMA pergunta com o motivo, em vez de duas caixas seguidas: a segunda
     ("Confirma?") virava clique de reflexo depois da primeira. */
  const motivo = await perguntarUI({ titulo: `Apagar da vista TODOS os lançamentos de ${placa}?`,
    texto: `${placa} some do Histórico e dos indicadores em todos os terminais, `
      + 'mas fica guardada — pátio não se apaga.',
    campo: { tipo: 'motivo', dica: 'Fica registrado com o seu nome.' },
    botao: 'Apagar da vista', perigo: true });
  if(motivo === null) return;
  try {
    const r = await SuincoSharePoint.apagarMovimentacoesDaPlaca(placa, motivo.trim());
    notify(`${r.apagadas} lançamento(s) de ${placa} apagado(s) da vista.`, 'ok', 6000);
    await SuincoSharePoint.sincronizarAgora();
    renderAll();
  } catch(e){
    notify('Não consegui apagar: ' + (e && e.message || e), 'erro', 8000);
  }
}
/* O NÚMERO DA CARGA DE UMA MOVIMENTAÇÃO (25/09/2026)
   ---------------------------------------------------------------------
   Pedido do dono: "eu quero que apareca o numero da carga em uma coluna
   do historico e fique mais facil".

   O BURACO ERA ESTE, e ele já existia com a busca do lado: o campo de
   procura do Histórico aceita número de carga desde sempre (o rótulo diz
   "Ex: ABC1D23 ou 10245") — mas nenhuma coluna mostrava o número. A
   pessoa procurava, vinham as linhas, e não dava para confirmar QUAL
   carga era cada uma. Procurar sem poder conferir é pior que não
   procurar: dá a resposta sem dar a prova.

   POR QUE O NÚMERO NÃO ESTÁ NO REGISTRO. A movimentação guarda `cargaId`,
   não o número — e está certo: o número pode ser corrigido depois, e um
   registro de auditoria que guardasse uma CÓPIA dele passaria a mentir no
   dia da correção. O número se resolve pela carga, sempre.

   QUANDO NÃO DÁ PARA RESOLVER. Se a carga não está na cópia local (fora
   da janela de 30 dias, e ainda não trazida por um filtro de período),
   devolve nulo — e a tela escreve o motivo em vez de um traço mudo.
   Traço sozinho faz a pessoa achar que a carga não tinha número. */
function numeroDaCargaDaMovimentacao(m){
  if(!m || !m.cargaId) return null;
  const c = (typeof getCarga === 'function') ? getCarga(m.cargaId) : null;
  if(!c) return null;
  const n = String(c.numeroCarga || '').trim();
  /* "Aguardando Carga" é a marca da entrada sem programação, não um
     número. Mostrá-la na coluna de número faria procurar por ela. */
  if(!n || n === 'Aguardando Carga') return null;
  return n;
}

/* Clique no número: joga o número na busca que JÁ EXISTE e redesenha.
   Não é busca nova — é a mesma, preenchida sem digitação. Uma busca,
   dois caminhos de entrada. */
function filtrarHistoricoPorCarga(numero){
  const campo = document.getElementById('hist-busca-carga');
  if(!campo) return;
  campo.value = numero;
  campo.dispatchEvent(new Event('input', { bubbles:true }));
  campo.scrollIntoView({ block:'center', behavior: Graf && Graf.semMovimento && Graf.semMovimento() ? 'auto' : 'smooth' });
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
  // Pediu antes da janela local: busca no servidor e redesenha quando chegar.
  garantirPeriodoNoPainel(dDe, dAte, 'hist-aviso-periodo');
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
  /* O DETALHE NASCE VAZIO — construído só quando alguém clica (11/09/2026).

     MEDIDO: com 500 linhas na tela (o teto do desktop), o Histórico sozinho
     respondia por 47.469 dos 57.196 elementos da página inteira — 83% do
     peso, e o número que apareceu no registro de travamento do dia. A causa:
     detalheHistoricoHtml(m) monta ~95 nós POR LINHA — grade de campos,
     lacres, datas, dois botões — para as 500 linhas de uma vez, mesmo que
     99% delas nunca sejam abertas.

     `alternarDetalheHistoricoUI` só ALTERNA `hidden`; nunca construiu nada.
     Agora ela constrói na primeira vez que a linha abre, e o resultado fica
     guardado no próprio nó — abrir de novo não reconstrói. */
  document.getElementById('hist-tbody').innerHTML = exibidos.map(m=>`
    <tr class="hist-linha" onclick="alternarDetalheHistoricoUI('${escJs(m.id)}')"
        title="Clique para ver tudo o que se sabe sobre este registro.">
      <td><span class="hist-seta" id="hist-seta-${esc(m.id)}">▸</span> ${fmtDataHora(m.timestamp)}</td>
      <td>${esc(m.placa)}</td>
      <td class="hist-carga">${(() => {
        const n = numeroDaCargaDaMovimentacao(m);
        /* CLICAR NO NÚMERO ABRE A LINHA DO TEMPO DELA — é o "fique mais
           fácil" do pedido. A busca do Histórico não filtra a tabela: ela
           desenha a jornada completa da carga, que é o que quem investiga
           está procurando. Achar a linha no meio de 500 e ter de digitar o
           número à mão é trabalho que a tela pode poupar.
           `stopPropagation` porque a linha inteira já abre o detalhe. */
        return n
          ? `<button type="button" class="hist-carga-btn"
               onclick="event.stopPropagation(); filtrarHistoricoPorCarga('${escJs(n)}')"
               title="Ver a linha do tempo completa da carga ${esc(n)}">${esc(n)}</button>`
          : `<span class="text-dim" title="Esta carga está fora do período carregado. Use o filtro de datas para trazê-la.">fora do período</span>`;
      })()}</td>
      <td>${m.statusAnterior ? badgeHtml(m.statusAnterior) : '—'}</td><td>${badgeHtml(m.statusNovo)}</td>
      <td>${esc(m.operador)}</td><td>${esc(m.setor)}</td>
    </tr>
    <tr class="hist-detalhe" id="hist-det-${esc(m.id)}" hidden>
      <td colspan="7"></td>
    </tr>`).join('');
  document.getElementById('hist-empty').hidden = lista.length>0;
  const contagemEl = document.getElementById('hist-contagem');
  if(contagemEl){
    contagemEl.textContent = lista.length > LIMITE
      ? `Mostrando as ${LIMITE} mais recentes de ${lista.length} — use os filtros pra ver outras.`
      : (lista.length ? `${lista.length} movimentação(ões).` : '');
  }
  const btnApagar = document.getElementById('btn-apagar-historico-placa');
  if(btnApagar) btnApagar.hidden = !(podeApagarHistoricoUI() && filtroPlaca);
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
/* entradaNoPatioDe() mora em data.js desde 09/09/2026 — a Torre, o PDF
   Executivo e a reconciliação da Portaria usam a mesma definição. */

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
  /* `hist-campo-vazio` (07/10/2026): campo que só diria "—". No computador
     continua à mostra (a grade é larga); no celular sai — ver styles.css. */
  const linha = (rot, val, largo)=> val === '' || val === null || val === undefined
    ? '' : `<div class="hist-campo${largo ? ' hist-campo-largo' : ''}${val === '—' ? ' hist-campo-vazio' : ''}">`
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

  /* NO CELULAR, A CARGA ABERTA CABE NUMA OLHADA (07/10/2026). Relato do
     dono: "abre um negócio gigante no cartão que utiliza quase duas telas".
     "Este registro" repete a linha fechada (data, etapa, operador) e o id é
     técnico: `hist-det-evento` sai no celular. Lacres sem nenhum lacre:
     `hist-det-vazia`. No computador nada muda. */
  const semLacre = !l.numeros.length && !l.faltando && !l.retido;
  return `
    <div class="hist-det-secao hist-det-evento">Este registro</div>
    <div class="hist-det-grid hist-det-evento">${doEvento}</div>
    <div class="hist-det-secao">A carga</div>
    <div class="hist-det-grid">${daCarga}</div>
    ${lacres ? `<div class="hist-det-secao${semLacre ? ' hist-det-vazia' : ''}">Lacres</div><div class="hist-det-grid${semLacre ? ' hist-det-vazia' : ''}">${lacres}</div>` : ''}
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
  /* CONSTRÓI NA PRIMEIRA ABERTURA, uma vez só — ver a nota em renderHistorico.
     `dataset.construido` é o carimbo: sem ele, fechar e abrir de novo
     reconstruiria o mesmo HTML à toa. Achar a movimentação é busca linear
     — cabe, porque só acontece no clique, nunca nas 500 linhas de uma vez. */
  if(!alvo.dataset.construido){
    const m = (DB.movimentacoes || []).find(x => x.id === movId);
    const td = alvo.querySelector('td');
    if(td) td.innerHTML = m ? detalheHistoricoHtml(m)
      : '<div class="hist-det-aviso">Este registro não está mais na cópia local — role a página para recarregar.</div>';
    alvo.dataset.construido = '1';
  }
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

