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
  const abertas = filtrarPorFiltroIndicadores(cargasAtivas());   // sem as inativas (decisão 29)
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

/* O período do seletor em datas, para a busca no servidor. 'todos' vira a
   janela máxima da rota (90 dias): período aberto sem teto derruba
   servidor, e o Histórico continua sendo o caminho para ir mais longe. */
function periodoIndicadoresEmDatas(){
  const chave = (document.getElementById('ind-f-periodo') || {}).value || '';
  const { inicio } = janelaPeriodo(chave || 'mes');
  const de = chave === '' ? new Date(Date.now() - 90*86400000) : inicio;
  return { de: isoDiaLocal(de), ate: isoDiaLocal(new Date()) };
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
  // Período além dos 30 dias locais: busca no servidor (ver garantirPeriodoNoPainel).
  const p = periodoIndicadoresEmDatas();
  garantirPeriodoNoPainel(p.de, p.ate, 'ind-aviso-periodo');
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

/* Uma cor só para as quatro etapas: aqui a cor diz "duração", e o nome da
   etapa já está escrito ao lado. As cores de STATUS ficam reservadas ao
   status da carga — usá-las aqui dava dois significados à mesma cor
   (auditoria dataviz, 07/10/2026, #46). */
const RAIOX_ETAPAS = [
  { key:'tempoAguardandoEmbarque', rotulo:'Aguardando embarque', cor:'--graf-1' },
  { key:'tempoCarregamento',       rotulo:'Carregamento',        cor:'--graf-1' },
  { key:'tempoFaturamento',        rotulo:'Faturamento',         cor:'--graf-1' },
  { key:'tempoAguardandoSaida',    rotulo:'Aguardando saída',    cor:'--graf-1' },
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
      <td>${esc(diaDaProgramacao(c).split('-').reverse().join('/'))}</td>
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
      font-size="12" fill="var(--text-dim)">${PULSO_DIAS_SEMANA[li]}</text>`);
    linha.forEach((n, hora) => {
      const x = ROTULO + hora * (CEL + GAP);
      const frac = n / max;
      // 0 chegadas: célula fantasma (contorno leve), pra grade continuar
      // legível sem parecer que "0" é um dado dourado fraquinho.
      const caixa = n === 0
        ? `<rect x="${x}" y="${y}" width="${CEL}" height="${ALT}" rx="3" fill="var(--vidro-brilho)" opacity="0.35"/>`
        : `<rect x="${x}" y="${y}" width="${CEL}" height="${ALT}" rx="3" fill="var(--graf-1)" opacity="${(0.18 + 0.82 * frac).toFixed(2)}"/>`;
      const texto = n === 0 ? '' : `<text x="${x + CEL / 2}" y="${y + ALT / 2 + 3.5}"
        text-anchor="middle" font-size="12" font-weight="700"
        fill="${frac >= 0.55 ? 'var(--graf-1-tinta)' : 'var(--text)'}">${n}</text>`;
      celulas.push(`<g>${caixa}${texto}
        <title>${PULSO_DIAS_SEMANA[li]} ${String(hora).padStart(2, '0')}h — ${n} chegada(s)</title></g>`);
    });
  });
  const horas = [];
  for(let h = 0; h < 24; h += 3){
    horas.push(`<text x="${ROTULO + h * (CEL + GAP) + CEL / 2}" y="11" text-anchor="middle"
      font-size="12" fill="var(--text-dim)">${h}h</text>`);
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
  /* Rótulo SELETIVO: número só no maior dia e no dia de hoje de cada
     painel. Número em toda barra (eram 28) vira ruído e ninguém lê; o
     valor de qualquer dia continua na dica ao passar o mouse (#46). */
  const ultimo = dados.length - 1;
  const iMaiorN = dados.reduce((m, d, i) => d.n > dados[m].n ? i : m, 0);
  const iMaiorMedia = dados.reduce((m, d, i) => (d.media || 0) > (dados[m].media || 0) ? i : m, 0);
  const partes = [];
  partes.push(`<text x="${ROTULO}" y="${TOPO - 7}" font-size="12" font-weight="800"
    fill="var(--text-dim)">ENTRADAS NO PÁTIO</text>`);
  partes.push(`<text x="${ROTULO}" y="${y2Topo - 7}" font-size="12" font-weight="800"
    fill="var(--text-dim)">TEMPO MÉDIO DE PÁTIO</text>`);
  dados.forEach((d, i) => {
    const x = ROTULO + i * (BARRA + GAP);
    const [ano, mes, dia] = d.k.split('-');
    // Painel 1 — entradas (contagem).
    const h1 = Math.round((d.n / maxN) * (PAINEL - 14));
    if(d.n > 0){
      partes.push(`<rect x="${x}" y="${TOPO + (PAINEL - h1)}" width="${BARRA}" height="${h1}"
        rx="3" fill="var(--graf-1)"/>`);
      if(i === iMaiorN || i === ultimo){
        partes.push(`<text class="evo-rotulo" x="${x + BARRA / 2}" y="${TOPO + (PAINEL - h1) - 3}" text-anchor="middle"
          font-size="12" font-weight="700" fill="var(--text)">${d.n}</text>`);
      }
    }else{
      partes.push(`<rect x="${x}" y="${TOPO + PAINEL - 2}" width="${BARRA}" height="2"
        rx="1" fill="var(--vidro-brilho)"/>`);
    }
    // Painel 2 — tempo médio (minutos). Sem carga concluída, sem barra —
    // um zero aqui mentiria (não é "pátio zerado", é "ainda sem medição").
    if(d.media !== null){
      const h2 = Math.max(3, Math.round((d.media / maxMedia) * (PAINEL - 14)));
      partes.push(`<rect x="${x}" y="${y2Topo + (PAINEL - h2)}" width="${BARRA}" height="${h2}"
        rx="3" fill="var(--graf-1)" opacity="0.62"/>`);
      if(i === iMaiorMedia || i === ultimo){
        partes.push(`<text class="evo-rotulo" x="${x + BARRA / 2}" y="${y2Topo + (PAINEL - h2) - 3}" text-anchor="middle"
          font-size="12" font-weight="700" fill="var(--text)">${fmtDuracao(d.media)}</text>`);
      }
    }
    partes.push(`<text x="${x + BARRA / 2}" y="${H - 5}" text-anchor="middle"
      font-size="12" fill="var(--text-dim)">${dia}/${mes}</text>`);
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
      + [0.18, 0.45, 0.7, 1].map(o => `<span class="grau" style="background:var(--graf-1);opacity:${o}"></span>`).join('')
      + ` mais — pico: ${max} chegada(s) num mesmo horário`;
  }
  evoEl.innerHTML = evolucaoPatioSvg(entradas);
}

/* PULSO DO DIA — o topo que decide (24/09/2026)
   ---------------------------------------------------------------------
   Pedido do dono: Indicadores "muito mais sofisticado, com qualidade,
   animacoes, interacoes, facilidade, visual surpreendente", e compacto o
   bastante para caber na tela.

   NENHUMA CONTA NOVA MORA AQUI. Tudo o que este bloco mostra vem de
   função que já existe e já é testada: `tempoDePatioDe` (a resposta única
   de quanto tempo de pátio, unificada hoje), `minutosNoPatioAgora`,
   `paradasAlemDaMeta` e `cargasAbertas`. Indicador que recalcula por
   conta própria é como dois números do mesmo dia deixam de bater — foi
   exatamente o defeito do tempo de pátio, corrigido nesta mesma manhã. */
function renderPulsoDoDia(){
  if(typeof Graf === 'undefined') return;
  const abertas = cargasAtivas();   // sem as inativas (decisão 29)
  const meta = metaTempoPatio();
  const paradas = paradasAlemDaMeta(abertas);
  /* Sem a meta nos indicadores (26/09/2026 — ver metaNosIndicadores em
     data.js), o pulso deixa de julgar o tempo: mostra quanto, não se está
     "dentro" ou "acima". */
  const comMeta = metaNosIndicadores();

  const quando = document.getElementById('pulso-quando');
  if(quando) quando.textContent = 'agora · ' + new Date().toLocaleTimeString('pt-BR',
    { hour:'2-digit', minute:'2-digit' });

  /* ---- os números que fazem levantar da cadeira ---- */
  const tempos = abertas.map(c => minutosNoPatioAgora(c)).filter(m => m !== null);
  const maior = tempos.length ? Math.max(...tempos) : null;
  const medio = tempos.length ? Math.round(tempos.reduce((a,b)=>a+b,0)/tempos.length) : null;
  const caixa = document.getElementById('pulso-numeros');
  if(caixa){
    /* OS NÚMEROS ROLAM, NÃO RENASCEM (26/09/2026). Antes esta caixa era
       refeita inteira a cada sincronia. Agora cada número é guardado pelo
       rótulo e só o valor muda — e só os dígitos que mudaram rolam
       (Graf.rolar). O número parado fica parado. */
    const itens = [];
    const num = (v, r, d, alerta) => { itens.push({ v:String(v), r, d, alerta }); return ''; };
    void (
      num(abertas.length, 'no pátio', 'cargas em aberto')
      + (comMeta ? num(paradas.total, 'acima da meta', `passaram de ${fmtDuracao(meta)}`, paradas.total > 0) : '')
      + num(maior === null ? '—' : fmtDuracao(maior), 'o mais parado',
            !comMeta ? 'desde a chegada'
              : (maior !== null && maior > meta ? 'precisa de atenção' : 'dentro da meta'),
            comMeta && maior !== null && maior > meta)
      + num(medio === null ? '—' : fmtDuracao(medio), 'média no pátio', 'das que estão lá agora')
      /* A carga SEM CHEGADA não é zero: é desconhecida, e some se a gente
         calar. Só aparece quando existe. */
      + (paradas.semChegada
          ? num(paradas.semChegada, 'sem chegada', 'não dá para contar o tempo', true) : ''));
    const chaveNums = itens.map(i => i.r).join('|');
    if(caixa._chave !== chaveNums){
      caixa._chave = chaveNums;
      caixa.innerHTML = itens.map(i => `<div class="pulso-num"><span class="v"></span>`
        + `<span class="r">${esc(i.r)}</span><span class="d"></span></div>`).join('');
    }
    [...caixa.children].forEach((box, k) => {
      const i = itens[k];
      box.classList.toggle('alerta', !!i.alerta);
      Graf.rolar(box.querySelector('.v'), i.v);
      const d = box.querySelector('.d');
      if(d.textContent !== (i.d || '')) d.textContent = i.d || '';
      d.hidden = !i.d;
    });
  }

  /* ---- onde estão os caminhões: posição e rótulo, nunca cor sozinha ---- */
  const alvoFila = document.getElementById('pulso-fila');
  if(alvoFila){
    const etapas = STATUS_FLOW.map(st => ({
      rotulo: st, valor: abertas.filter(c => c.status === st).length
    })).filter(e => e.valor > 0);
    Graf.fila(alvoFila, { etapas });
  }

  /* ---- o dia por hora ---- */
  const alvoHora = document.getElementById('pulso-hora');
  if(alvoHora){
    const porHora = new Array(24).fill(0);
    abertas.forEach(c => {
      const t = tempoDePatioDe(c);
      if(!t.entrada || !t.entradaPlausivel) return;
      porHora[new Date(t.entrada).getHours()]++;
    });
    /* Só as horas com movimento, e da primeira à última: mostrar 24 barras
       de madrugada vazia é gastar a tela com o que não aconteceu. */
    let ini = porHora.findIndex(v => v > 0);
    let fim = porHora.length - 1 - [...porHora].reverse().findIndex(v => v > 0);
    const pontos = (ini < 0) ? [] : porHora.slice(ini, fim + 1)
      .map((v, i) => ({ rotulo: String(ini + i).padStart(2,'0') + 'h', valor: v }));
    Graf.area(alvoHora, { pontos, rotulo:'entradas no pátio por hora',
      formato: v => Math.round(v) + (Math.round(v) === 1 ? ' carga' : ' cargas') });
  }

  /* ---- rankings: quem está segurando o pátio ---- */
  const porChave = (fn) => {
    const m = new Map();
    abertas.forEach(c => {
      const min = minutosNoPatioAgora(c);
      if(min === null) return;
      const k = (fn(c) || '').trim() || '(sem informação)';
      const a = m.get(k) || { rotulo:k, valor:0, n:0 };
      a.valor = Math.max(a.valor, min); a.n++;
      m.set(k, a);
    });
    return [...m.values()].sort((a,b) => b.valor - a.valor);
  };
  const fmt = v => fmtDuracao(v);
  const grave = comMeta ? (it => it.valor > meta) : undefined;
  const r1 = document.getElementById('pulso-rank-rota');
  if(r1) Graf.ranking(r1, { itens: porChave(c => c.rota), formato: fmt,
                            rotulo:'tempo parado por rota', alerta: grave,
                            aoTocar: (it, el) => abrirDetalhePulso('rota', it.rotulo, el) });
  const r2 = document.getElementById('pulso-rank-transp');
  if(r2) Graf.ranking(r2, { itens: porChave(c => c.transportadora), formato: fmt,
                            rotulo:'tempo parado por transportadora', alerta: grave,
                            aoTocar: (it, el) => abrirDetalhePulso('transportadora', it.rotulo, el) });
  /* Gaveta aberta acompanha o pátio: se a sincronia trouxe mudança, o
     conteúdo dela é refeito com as mesmas cargas de agora. */
  const aberta = Graf.gavetaAberta();
  if(aberta && aberta.startsWith('pulso|')){
    const [, campo, chave] = aberta.split('|');
    abrirDetalhePulso(campo, chave, null, true);
  }
}

/* O DETALHE DE UMA LINHA DO RANKING (26/09/2026).
   O ranking diz QUAL rota ou transportadora está segurando o pátio; a
   pergunta seguinte é sempre "quais caminhões?". Tocar na linha abre a
   gaveta com as cargas em aberto dela, da mais parada para a menos. Só
   leitura: a ação continua nos botões de cada etapa, onde sempre esteve.

   A conta é a mesma do ranking (minutosNoPatioAgora), então a gaveta e a
   barra nunca discordam. */
function abrirDetalhePulso(campo, chave, origem, soAtualizar){
  const semInfo = '(sem informação)';
  const abertas = cargasAtivas().filter(c => {   // sem as inativas (decisão 29)
    const k = (c[campo] || '').trim() || semInfo;
    return k === chave;
  }).map(c => ({ c, min: minutosNoPatioAgora(c) }))
    .sort((a, b) => (b.min ?? -1) - (a.min ?? -1));
  const nome = campo === 'rota'
    ? (typeof rotaCurta === 'function' && chave !== semInfo ? rotaCurta(chave) : chave) : chave;
  const linhas = abertas.map(({ c, min }) => `<li class="gv-carga">
      <div class="gv-carga-topo"><b>${esc(c.placa || '—')}</b>
        <span class="gv-carga-tempo">${min === null ? 'sem chegada' : esc(fmtDuracao(min))}</span></div>
      <div class="gv-carga-sub">${badgeHtml(c.status)}
        <span>Carga ${esc(c.numeroCarga || '—')}</span>
        ${campo === 'rota' ? `<span>${esc(c.transportadora || '—')}</span>` : `<span>${esc(rotaCurta(c.rota) || '—')}</span>`}</div>
    </li>`).join('');
  const html = abertas.length
    ? `<ol class="gv-lista">${linhas}</ol>`
    : '<p class="gv-vazio">Nenhuma carga em aberto aqui agora. Ela pode ter seguido viagem desde a última leitura.</p>';
  if(soAtualizar){
    const miolo = document.getElementById('gv-miolo');
    if(miolo && miolo.innerHTML !== html) miolo.innerHTML = html;
    const sub = document.getElementById('gv-sub');
    if(sub) sub.textContent = abertas.length === 1 ? '1 carga em aberto' : `${abertas.length} cargas em aberto`;
    return;
  }
  Graf.abrirGaveta({
    chave: `pulso|${campo}|${chave}`,
    olho: campo === 'rota' ? 'Rota' : 'Transportadora',
    titulo: nome,
    sub: abertas.length === 1 ? '1 carga em aberto' : `${abertas.length} cargas em aberto`,
    html, origem,
  });
}

function renderIndicadores(){
  /* Texto fixo que cita a meta obedece à mesma chave (metaNosIndicadores,
     data.js): basta marcar o trecho com data-meta-patio. */
  document.querySelectorAll('[data-meta-patio]').forEach(el => { el.hidden = !metaNosIndicadores(); });
  // O pulso desenha junto com o resto da aba, do mesmo estado.
  try{ renderPulsoDoDia(); }catch(e){ console.warn('[Suinco] pulso:', e); }
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
    const q = saidaDaCarga(c);   // só o carimbo — sem ele, não se sabe o dia (#102)
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
  html += notaDescarteHtml(concluidas);
  document.getElementById('ind-stats').innerHTML = html;

  renderRaioX();
  renderPulsoDoPatio();
  renderNotaTransportadoras();
  // ---- Bloco 2: Painel do Gestor — comparação por período (novo) ----
  renderComparacaoPeriodos();
  renderRankingPeriodos();
  renderGraficosIndicadores();
}
/* A NOTA POR TRANSPORTADORA (07/10/2026, #49) — uma linha por empresa.

   Pedido do dono, com as recomendações aprovadas: só Logística e
   Administração (é número sensível de fornecedor) e SEM pontualidade —
   ninguém registra a hora combinada de chegada, e número que não se mede
   não entra. Quatro números, nenhum campo novo para ninguém preencher:
     · cargas concluídas no recorte do filtro de cima;
     · tempo de pátio TÍPICO (mediana: o caminhão esquecido não puxa a conta)
       — a mesma função do Pátio ao vivo, pvPercentil;
     · cargas com CT-e ou canhoto pendente — só o servidor sabe
       (rota /api/indicadores/transportadoras);
     · % de frete COMBINADO (fora da tabela) entre as cargas com a observação.
   Nada de nota única nem ranking: uma medida só pune quem pega a rota
   difícil (skill transportadoras, "o que NÃO fazer").

   DEVOLUÇÃO FICOU DE FORA (07/10/2026), pelo dono: a aba Devoluções só tem
   as que VOLTARAM à Suinco — "esse dado não é concreto integralmente". Volta
   quando houver a fonte completa. */
let _notaTranspServidor = { chave: '', dados: null, erro: '', em: 0 };

function chaveTransportadora(t){ return String(t || '').trim().toUpperCase(); }

function notaPorTransportadora(periodoKey, filtros, doServidor){
  const linhas = new Map();
  const linha = (nome) => {
    const k = chaveTransportadora(nome);
    if(!linhas.has(k)) linhas.set(k, { nome: String(nome).trim(), cargas: 0, patios: [], comObs: 0, combinado: 0, docPendente: null });
    return linhas.get(k);
  };
  cargasConcluidasNoPeriodoFiltrado(periodoKey, filtros).forEach(c => {
    if(!String(c.transportadora || '').trim()) return;
    const l = linha(c.transportadora);
    l.cargas++;
    const p = indicadoresDaCarga(c.id).tempoPatioTotal;
    if(p !== null && p !== undefined) l.patios.push(p);
    if(c.freteObservacao === 'TABELA' || c.freteObservacao === 'COMBINADO') l.comObs++;
    if(c.freteObservacao === 'COMBINADO') l.combinado++;
  });
  if(doServidor){
    Object.entries(doServidor).forEach(([nome, v]) => {
      if(!String(nome).trim()) return;
      if(filtros && filtros.transportadora && chaveTransportadora(nome) !== chaveTransportadora(filtros.transportadora)) return;
      linha(nome).docPendente = v.docPendente || 0;
    });
  }
  return [...linhas.values()].map(l => ({
    nome: l.nome, cargas: l.cargas,
    patioMediana: l.patios.length ? pvPercentil(l.patios, 0.5) : null,
    docPendente: doServidor ? (l.docPendente ?? 0) : null,
    pctCombinado: l.comObs ? Math.round(100 * l.combinado / l.comObs) : null,
    comObs: l.comObs,
  })).sort((a, b) => b.cargas - a.cargas || a.nome.localeCompare(b.nome));
}

async function renderNotaTransportadoras(){
  const card = document.getElementById('card-nota-transportadoras');
  const alvo = document.getElementById('nota-transp');
  if(!card || !alvo) return;
  const setor = DB.operador && DB.operador.setor;
  card.hidden = !(setor === 'Logística' || setor === 'Administração');
  if(card.hidden) return;
  const periodo = FILTRO_IND.periodo || 'mes';
  const { inicio, fim } = janelaPeriodo(periodo);
  const chave = periodo;
  const conectado = typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.estaConfigurado();
  const desenhar = () => {
    const linhas = notaPorTransportadora(periodo, FILTRO_IND, _notaTranspServidor.chave === chave ? _notaTranspServidor.dados : null);
    const traco = '<span class="text-dim">—</span>';
    const aviso = !conectado ? 'Os documentos pendentes vêm do servidor — entre com seu usuário para vê-los.'
      : _notaTranspServidor.erro ? _notaTranspServidor.erro : '';
    alvo.innerHTML = (aviso ? `<div class="text-dim nota-transp-aviso">${esc(aviso)}</div>` : '')
      + (linhas.length ? `<div class="tabela-rola"><table class="nota-transp-tabela">
        <thead><tr><th scope="col">Transportadora</th><th scope="col">Cargas concluídas</th><th scope="col">Tempo de pátio típico</th>
          <th scope="col">Cargas com CT-e ou canhoto pendente</th><th scope="col">Frete combinado</th></tr></thead>
        <tbody>${linhas.map(l => `<tr data-transportadora="${esc(l.nome)}">
          <th scope="row">${esc(l.nome)}</th>
          <td data-col="cargas">${l.cargas}</td>
          <td data-col="patio">${l.patioMediana === null ? traco : esc(fmtDuracao(l.patioMediana))}</td>
          <td data-col="doc">${l.docPendente === null ? traco : l.docPendente}</td>
          <td data-col="combinado" title="${l.comObs} carga(s) com a observação do frete">${l.pctCombinado === null ? traco : l.pctCombinado + '%'}</td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="text-dim">Nenhuma carga concluída com transportadora neste recorte.</div>');
  };
  desenhar();
  if(!conectado) return;
  const fresco = _notaTranspServidor.chave === chave && Date.now() - _notaTranspServidor.em < 120000;
  if(fresco) return;
  try{
    const r = await SuincoSharePoint.notaTransportadoras(inicio.toISOString(), fim.toISOString());
    _notaTranspServidor = { chave, dados: r.transportadoras || {}, erro: '', em: Date.now() };
  }catch(e){
    _notaTranspServidor = { chave, dados: null, em: Date.now(),
      erro: e.status === 404 ? 'O servidor ainda não tem esta conta — os documentos pendentes aparecem depois da próxima atualização do servidor.'
                             : 'Não consegui ler os documentos pendentes: ' + (e.message || 'erro') };
  }
  desenhar();
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
  // Passa o filtro do topo: a nota "só este recorte" precisa valer aqui também.
  const porPeriodo = PERIODOS_INDICADOR.map(p => ({ periodo:p, dados: indicadoresPorPeriodo(p.key, filtroIndicadoresAtivo() ? FILTRO_IND : null) }));
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
  /* O cartão inteiro é a meta: "atraso" é o que passa de 3h. Sem a meta
     nos indicadores, ele some da aba — escondido, não apagado. */
  const cartaoRk = document.getElementById('ind-ranking-tbody')?.closest('.card');
  if(cartaoRk) cartaoRk.hidden = !metaNosIndicadores();
  if(!metaNosIndicadores()) return;
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
  /* A dica ao passar o mouse: o canvas não tem <title> por barra, então
     guarda a faixa de cada barra e o movimento do mouse escolhe a do
     ponteiro. Ligado uma vez só por canvas — redesenhar não empilha. */
  canvas._barrasDica = itens.map((it,i)=>({ x0: espaco*i, x1: espaco*(i+1),
    texto: `${it.label}: ${it.valor===null ? 'sem medição neste filtro' : fmtDuracao(it.valor) + ' em média'}` }));
  if(!canvas._dicaLigada){
    canvas._dicaLigada = true;
    canvas.addEventListener('mousemove', ev=>{
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const b = (canvas._barrasDica || []).find(d=> x >= d.x0 && x < d.x1);
      canvas.title = b ? b.texto : '';
    });
  }
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
  drawBarChart(canvasBarras, etapas.map(e=>({ label:e.label, valor:e.media, cor:corTema('--graf-1') })));

  // 2) Linha — cargas concluídas por dia
  const dias = cargasConcluidasPorDia(periodo, filtros);
  drawLineChart(document.getElementById('grafico-linha'), dias);

  // 3) Pizza — distribuição por status atual
  const distrib = distribuicaoStatusAtual(filtros);
  drawPieChart(document.getElementById('grafico-pizza'), distrib);
}
window.addEventListener('resize', ()=>{ if(TAB_ATUAL==='indicadores') renderGraficosIndicadores(); });

