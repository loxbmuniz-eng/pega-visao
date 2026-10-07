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
    /* Sem a meta nos indicadores, o número fica na cor do texto: verde e
       vermelho só significam alguma coisa contra uma referência. */
    if(!metaNosIndicadores()){
      return `<div class="stat-box">
          <div class="stat-num">${fmtDuracao(dados.media)}</div>
          <div class="stat-label">${rotulo}</div>
          <div class="stat-note">${nota} · base: ${dados.amostra} carga(s)</div>
        </div>`;
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
    </div>${notaDescarteHtml(filtrarPorFiltroIndicadores(DB.cargas.filter(c=>c.status==='Seguiu Viagem')))}`;
}

/* A NOTA DO QUE FICOU FORA DA CONTA (09/09/2026). Sai do cálculo, fica na
   tela. Sem isto o gestor não tem como saber que uma média de 3h00 foi
   calculada com 4 cargas e não 5 — e a quinta é justamente a que alguém
   precisa corrigir. */
function notaDescarteHtml(base){
  const fora = cargasComDataInconsistente(base);
  if(!fora.length) return '';
  const nomes = fora.slice(0, 8).map(c => esc(c.numeroCarga || c.placa || c.id)).join(', ')
    + (fora.length > 8 ? ` e mais ${fora.length - 8}` : '');
  return `<div class="ind-descarte" title="Etapa fora de ordem ou data impossível — corrija a etapa da carga no Histórico">`
    + `${fora.length} carga(s) fora da conta por data inconsistente: ${nomes}</div>`;
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
  /* E OBEDECE AO PERÍODO (09/09/2026). O subtítulo do card prometia
     "leitura do período selecionado acima" e a base era o histórico inteiro:
     escolher "Últimas 6h" não mudava uma linha. Base = concluídas NO PERÍODO
     (ou todas, quando o período é "todo o histórico") + as abertas de agora,
     que são o item acionável da seção. */
  const periodoG = FILTRO_IND.periodo;
  const concluidasG = periodoG ? cargasConcluidasNoPeriodo(periodoG)
                               : DB.cargas.filter(c => c.status === 'Seguiu Viagem');
  const g = analiseGargalos(filtrarPorFiltroIndicadores(concluidasG.concat(cargasAtivas())));
  const blocos = [];
  /* Três blocos só existem por causa da meta: "atraso" é o que passa de
     3h. Sem ela nos indicadores, eles saem; os que medem tempo e volume
     sem julgar ficam. */
  const comMeta = metaNosIndicadores();
  const soComMeta = (html) => comMeta ? html : '';

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

  blocos.push(soComMeta(tabela(
    '🔁 Veículos com atraso recorrente',
    'Dois ou mais atrasos. Um atraso é acaso; dois viram padrão.',
    ['Placa','Transportadora','Atrasos','Atraso Médio'],
    g.veiculosRecorrentes.map(v=>`<tr>
      <td><strong>${esc(v.placa)}</strong></td>${celFiltro('transportadora', v.transportadora)}
      <td class="cel-num">${v.atrasos} de ${v.totalCargas}</td>
      <td class="cel-num">${fmtDuracao(v.tempoMedioAtraso)}</td></tr>`)
  )));

  blocos.push(tabela(
    '⏳ Operações com maior permanência no pátio',
    'Tempo médio da chegada até a saída, por tipo de operação.',
    ['Tipo de Operação','Tempo Médio','Cargas'],
    g.operacoesMaiorPermanencia.map(o=>`<tr>
      ${celFiltro('operacao', o.operacao, PRA_ONDE_LABEL[o.operacao] || o.operacao)}
      <td class="cel-num">${fmtDuracao(o.media)}</td>
      <td class="cel-num">${o.amostra}</td></tr>`)
  ));

  blocos.push(soComMeta(tabela(
    '🚚 Transportadoras com concentração de atraso',
    'Informativo, sem ranking principal — parte do atraso é do pátio, não da transportadora.',
    ['Transportadora','Cargas Atrasadas','% do Total'],
    g.transportadorasAtraso.map(t=>`<tr>
      ${celFiltro('transportadora', t.transportadora)}
      <td class="cel-num">${t.atrasadas} de ${t.total}</td>
      <td class="cel-num">${t.percentual}%</td></tr>`)
  )));

  blocos.push(tabela(
    '🕐 Horários de maior congestionamento',
    'Pela hora de CHEGADA do caminhão — o congestionamento é físico, não da digitação.',
    ['Hora','Chegadas','Tempo Médio de Pátio'],
    g.horariosCongestionamento.map(h=>`<tr>
      <td>${String(h.hora).padStart(2,'0')}:00 — ${String(h.hora).padStart(2,'0')}:59</td>
      <td class="cel-num">${h.chegadas}</td>
      <td class="cel-num">${fmtDuracao(h.tempoMedioPatio)}</td></tr>`)
  ));

  blocos.push(soComMeta(tabela(
    '🛣️ Rotas com maior incidência de atraso',
    'Rota que atrasa sempre costuma ser problema de janela ou de sequenciamento.',
    ['Rota','Cargas Atrasadas','Atraso Médio'],
    g.rotasAtraso.map(r=>`<tr>
      ${celFiltro('rota', r.rota, r.rotulo || r.rota)}
      <td class="cel-num">${r.atrasadas} de ${r.total}</td>
      <td class="cel-num">${fmtDuracao(r.atrasoMedio)}</td></tr>`)
  )));

  blocos.push(tabela(
    '⚠️ Cargas paradas há mais tempo',
    'O bloco mais acionável: cada linha é um caminhão esperando alguém destravar.',
    ['Nº Carga','Placa','Transportadora','Status','Parada há'],
    g.pendentesAntigas.map(c=>`<tr>
      <td>${esc(c.numeroCarga)}</td><td><strong>${esc(c.placa)}</strong></td>
      <td>${esc(c.transportadora)}</td>
      <td>${badgeHtml(c.status)}</td>
      <td class="cel-num">${c.paradaHaMin === null ? '<span class="text-dim">sem registro de chegada</span>' : fmtDuracao(c.paradaHaMin)}</td></tr>`)
  ));

  const conteudo = blocos.filter(Boolean).join('');
  wrap.innerHTML = conteudo || (comMeta
    ? `<div class="empty-state">
      Nenhum gargalo detectado — nenhuma carga passou da meta de ${fmtDuracao(g.meta)} em pátio.
    </div>`
    : `<div class="empty-state">Nenhum gargalo detectado no período.</div>`);
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
/* A OBSERVAÇÃO DO FRETE NO RELATÓRIO (06/10/2026): TABELA, COMBINADO com o
   valor e a diferença para a tabela, ou "a definir" em destaque — carga
   contratada antes da regra. Uma função para o PDF e outra linha para o CSV. */
function obsFreteTexto(d){
  if(d.freteObservacao === 'COMBINADO' && d.freteCombinado != null){
    const dif = d.freteValor != null ? Number(d.freteCombinado) - Number(d.freteValor) : null;
    const br = (n) => Number(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    return `COMBINADO R$ ${br(d.freteCombinado)}` + (dif !== null && dif !== 0 ? ` (${dif > 0 ? '+' : '−'}${br(Math.abs(dif))} vs tabela)` : '');
  }
  if(d.freteObservacao === 'TABELA') return 'TABELA';
  return d.freteADefinir ? 'a definir' : '';
}
function obsFreteRelatorioHtml(d){
  const t = obsFreteTexto(d);
  if(t === 'a definir') return '<span class="obs-pendente">a definir</span>';
  if(!t) return '<span class="text-dim">—</span>';
  return d.freteObservacao === 'COMBINADO' ? `<strong>${esc(t)}</strong>` : esc(t);
}

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

  const linhaHtml = d=>`<tr>
      <td class="col-data">${dataCurtaLocal(d.programada) || '—'}</td>
      <td class="col-fat">${d.faturamento ? dataCurtaLocal(d.faturamento) : '<span class="text-dim">—</span>'}</td>
      <td class="col-saida">${d.saida
        ? fmtDataHora(d.saida)
        : '<span class="text-dim">ainda no pátio</span>'}</td>
      <td class="col-carga">${esc(d.numeroCarga)}</td>
      <td class="col-placa">${esc(d.placa)}</td>
      <td class="col-rota">${esc(d.rota)}</td>
      <td class="col-km">${d.kmDeslocamento === null
        ? '<span class="text-dim">—</span>'
        : esc(kmTexto(d.kmDeslocamento))}</td>
      <td class="col-valor">${d.freteValor === null || d.freteValor === undefined
        ? '<span class="text-dim">—</span>'
        : esc(Number(d.freteValor).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}))}</td>
      <td class="col-obsfrete">${obsFreteRelatorioHtml(d)}</td>
      <td class="col-obs">${d.observacoes
        ? esc(d.observacoes)
        : '<span class="obs-pendente">a preencher</span>'}</td>
    </tr>`;
  /* SEPARAÇÃO POR DIA (05/10/2026): período de vários dias sai um dia depois do
     outro, cada um com o seu cabeçalho e a sua lista. Um dia só sai como
     sempre saiu, sem cabeçalho. A ordem dentro do dia é a de sempre (número
     da carga) — o que mudou é só o agrupamento. */
  const grupos = separarPorDia(dados, d => diaDaProgramacao({ programadoEm: d.programada }));
  const linhas = grupos.map(g => (grupos.length > 1
    ? `<tr class="linha-dia"><th colspan="10" scope="colgroup">${esc(cabecalhoDoDia(g.dia, g.itens.length))}</th></tr>`
    : '') + g.itens.map(linhaHtml).join('')).join('');

  el.innerHTML = `
    <div class="print-page doc-amplo doc-paisagem">
      ${cabecalhoDocumento({
        titulo: 'Administração de Fretes',
        subtitulo: 'Logística — valor, negociação e instruções por carga',
      })}
      <table class="tab-fretes">
        <thead><tr>
          <!-- TRÊS datas (05/10/2026), e não uma: "Programação" é o dia a que a
               viagem pertence e é o campo que o filtro de período usa;
               "Faturamento" é quando a nota foi emitida; "Saída" é quando o
               caminhão de fato seguiu viagem. Elas divergem exatamente nos
               casos que dão problema na conferência. -->
          <th class="col-data">Programação</th>
          <th class="col-fat">Faturamento</th>
          <th class="col-saida">Saída</th>
          <!-- "Nº Carga", como no Operacional. "Número da Carga" por extenso
               não cabia na largura da coluna e saía cortado no cabeçalho —
               achado pela conferência de layout do test_relatorios.py. -->
          <th class="col-carga">Nº Carga</th>
          <th class="col-placa">Placa</th>
          <th class="col-rota">Rota</th>
          <!-- KM E FRETE (05/10/2026): o KM de deslocamento da carga (o da
               Programação) e o valor do frete, lado a lado — é a conta que a
               Administração faz. Com desvio, o KM da tabela sai pequeno ao lado. -->
          <th class="col-km">KM</th>
          <!-- O VALOR É A TABELA; A OBSERVAÇÃO DIZ O QUE VALE (06/10/2026).
               Decisão do dono: o valor não é editável (KM × tarifa) e a
               observação do frete diz TABELA ou COMBINADO com o valor — era
               a informação que chegava incompleta à Administração. -->
          <th class="col-valor">Frete tabela (R$)</th>
          <th class="col-obsfrete">Obs. do frete</th>
          <th class="col-obs">Observações</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="10" class="text-center text-dim">Nenhuma carga no período selecionado.</td></tr>'}</tbody>
      </table>
      ${rodapeDocumento(
        'O <strong>KM</strong> é o da carga (vem do destino e só ele é editável); <strong>Frete tabela</strong> é o KM × a tarifa do tipo de veículo, ' +
        'que ninguém digita. <strong>Obs. do frete</strong> diz o que vale: <strong>TABELA</strong> ou <strong>COMBINADO</strong> com o valor negociado e a diferença; ' +
        '"a definir" é carga contratada antes da regra de 06/10/2026. O campo <strong>Observações</strong> é onde a administração registra ' +
        'negociação e instruções. As linhas marcadas como <strong>a preencher</strong> são as cargas ainda sem registro administrativo.',
        'Uma linha por carga do período, com os campos administrativos '
        + 'registrados até o momento da emissão. Campos em branco significam '
        + 'não preenchido, e não zero.',
        fichaDocumento({
          titulo: 'Administração de Fretes',
          contagem: dados.length,
          extra: semObs ? `<strong>Sem registro:</strong> ${semObs} de ${dados.length}` : null,
        }))}
    </div>`;
  /* FOLHA DEITADA (06/10/2026): com a observação do frete são 10 colunas, e
     em pé as datas e o valor voltavam a transbordar as larguras medidas. */
  await exportarViaServidor(el, 'Administracao-de-Fretes', 'administracao-fretes', { orientacao: 'paisagem' });
}

/* QUAIS RELATÓRIOS ESTE SETOR VÊ (09/09/2026).

   A Qualidade ganhou a aba Relatórios — nenhum outro setor de devolução
   tem — porque o pedido era esse: "ela vai poder exportar relatorios". Mas
   ele delimitou logo depois: "todos os relatorios que competem ao
   CHECKLIST".

   Então a aba abre com um card só: o Relatório de Devoluções. Operacional,
   Executivo e Power BI são de pátio; Administração de Fretes carrega valor
   de frete, que é de Logística e Administração. Esconder não é a trava —
   o servidor recusa o valor de qualquer jeito (podeVerValorDeFrete) e
   nenhum dado de frete chega ao navegador dela. Aqui é só não oferecer o
   que não é dela, para a tela não virar um menu de coisas que dão erro. */
/* Quem vê o botão do papel do manobrista.

   Decisão do dono: "so a logistica e admisnistracao". A mesma regra do valor
   de frete, e por isso reusa a mesma função em vez de escrever um segundo
   `setor === 'Logística' || ...` — duas cópias da mesma pergunta divergem.

   Chamada no render de TODA aba (renderTabAtual), não só da Torre: o botão
   existe nas duas telas que ele pediu, e esconder numa e esquecer na outra
   seria pior que não ter. */
function renderEscopoDoManobrista(){
  const pode = podeVerValorDeFreteUI((DB.operador || {}).setor);
  document.querySelectorAll('[data-botao="manobrista"]').forEach(b => { b.hidden = !pode; });
}

function renderEscopoDosRelatorios(){
  const setor = (DB.operador || {}).setor;
  const soChecklist = soAcompanhaUI(setor);
  document.querySelectorAll('#tab-relatorios [data-relatorio]').forEach(card => {
    card.hidden = soChecklist && card.getAttribute('data-relatorio') !== 'checklist';
  });
}

/* ---------- O PAPEL DO MANOBRISTA (09/09/2026) ----------

   "um relatorio da programacao do dia que traga a placa, numero de ganchos
    para o manobrista" · "mandar no celular, da pra imprimir tambem, mesmo
    padrao dos nossos relatorios"

   MESMO PADRÃO, e é por isso que ele passa por exportarViaServidor como os
   outros três: o PDF sai idêntico em qualquer aparelho, o setor é conferido
   no servidor, e a geração fica registrada. Papel que sai do pátio é
   documento, e documento tem dono.

   O PADRÃO DA CASA, POR PEDIDO DO DONO (10/09/2026). Ele mandou os dois PDFs
   lado a lado e escreveu: "faz do tamanho e padrao formato do administracao
   de fretes por favor o dos manobristas".

   Eu tinha feito com letra de 22px, argumentando que duas colunas sobram
   página e que o papel é lido de pé. O argumento não era falso — e era
   irrelevante: o manobrista recebe este papel junto dos outros relatórios da
   casa, e um que sai com o dobro do tamanho dos outros não parece cuidado,
   parece outro sistema. Consistência entre os documentos vale mais do que a
   otimização de um deles, e quem lê os seis é quem decide isso.

   Resultado medido: o meu estourava para 2 páginas; no padrão `doc-amplo`
   (13px, A4 em pé, zebra nas linhas pares) a fila cabe em UMA. */
async function exportarPdfManobrista(){
  await atualizarDadosAntesDoRelatorio();
  const el = document.getElementById('print-manobrista');
  const dados = dadosManobrista(cargasDoRelatorio());

  if(!dados.length){
    notify('Nenhuma carga esperando para carregar — não há o que passar ao manobrista.',
           'warn', 6000);
    return;
  }

  /* GANCHOS 0 VIRA "LISO", em palavra. Zero é instrução — caminhão sem
     gancheira — e uma célula vazia ao lado de uma placa é lida como "não
     sei", que manda o manobrista perguntar. O número também aparece para
     quem conta gancho, mas quem só precisa saber o tipo lê a palavra. */
  const linhas = dados.map(d=>`<tr>
      <td class="col-mb-placa">${esc(d.placa) || '<span class="text-dim">sem placa</span>'}</td>
      <td class="col-mb-ganchos">${d.ganchos > 0
        ? `<strong>${d.ganchos}</strong> ganchos`
        : '<span class="mb-liso">Liso</span>'}</td>
    </tr>`).join('');

  const comGancheira = dados.filter(d=>d.ganchos > 0).length;

  el.innerHTML = `
    <div class="print-page doc-amplo doc-manobrista">
      ${cabecalhoDocumento({
        titulo: 'Manobrista — fila de carregamento',
        subtitulo: 'Caminhões esperando para carregar, na ordem da fila',
      })}
      <table class="tab-manobrista">
        <thead><tr>
          <th class="col-mb-placa">Placa</th>
          <th class="col-mb-ganchos">Ganchos</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      ${rodapeDocumento(
        'A ordem das linhas é a <strong>ordem da fila</strong>: a primeira é o próximo caminhão. '
        + '<strong>Liso</strong> é caminhão sem gancheira.',
        'Somente as cargas que ainda vão carregar (Aguardando Veículo e Aguardando '
        + 'Embarque) no momento da emissão. Caminhão que já está na doca não aparece.',
        fichaDocumento({
          titulo: 'Manobrista',
          contagem: dados.length,
          extra: `<strong>Com gancheira:</strong> ${comGancheira} de ${dados.length}`,
        }))}
    </div>`;
  await exportarViaServidor(el, 'Manobrista-fila-de-carregamento', 'programacao-manobrista');
}

/* ---------- PLANILHA DE ADMINISTRAÇÃO DE FRETES (09/09/2026) ----------

   "Nosso relatório de administração de fretes atualmente sai em PDF; ele
    precisa ser disponibilizado em formato de planilha para reduzir
    retrabalho."

   O PDF CONTINUA. Ele não é substituído: serve para arquivar e assinar, e
   tirar isso seria trocar um problema por outro. O que faltava era o
   formato em que a Administração TRABALHA — e trabalhar num PDF é
   redigitar.

   CSV com ponto-e-vírgula e BOM, não .xlsx: é o que o Excel em português
   abre com duplo clique já em colunas, sem biblioteca nova dentro do
   painel — e o painel é arquivo único, sem CDN. O BOM não é detalhe: sem
   ele o Excel pt-BR abre "Ç" como lixo, o que já apareceu em campo.

   NÚMEROS COM VÍRGULA DECIMAL, pelo mesmo motivo: peso e valor precisam
   chegar como NÚMERO na planilha, senão a Daniela não soma a coluna. */
async function exportarPlanilhaFretes(){
  await atualizarDadosAntesDoRelatorio();
  const dados = dadosPlanilhaDeFretes(cargasDoRelatorio());
  if(!dados.length){
    notify('Nenhuma carga no período selecionado — não há o que exportar.', 'warn', 5000);
    return;
  }
  const veValor = podeVerValorDeFreteUI((DB.operador||{}).setor);
  const num = (v) => (v === null || v === undefined || v === '') ? '' : String(v).replace('.', ',');

  const linhaDaCarga = d => [
    d.sequencia ?? '',
    d.numeroCarga,
    // Os dois dias lado a lado: o da PROGRAMAÇÃO (a que a sequência pertence) e o
    // do FATURAMENTO. Ficam fora das colunas de texto: chegam como data.
    d.programada ? dataCurtaLocal(d.programada) : '',
    d.faturamento ? dataCurtaLocal(d.faturamento) : '',
    d.rota,
    d.praOnde,
    d.placa,
    d.transportadora,
    d.tipoVeiculo,
    // Peso em toneladas, com vírgula: é como a operação fala e como a
    // planilha antiga trazia.
    d.peso ? num((Number(d.peso)/1000).toFixed(1)) : '',
    d.freteDestino,
    /* UM KM SÓ (06/10/2026): "KM de deslocamento não é necessário, KM
       divergente não é necessário" — o KM da carga é o que entra na conta. */
    kmTexto(d.kmDeslocamento),
    d.qtdEntregas,
    d.motorista,
    // Valor só para quem pode ver. Para os outros a coluna existe e vem
    // vazia — sumir com ela faria duas versões da mesma planilha andarem
    // pela empresa com colunas em posições diferentes.
    veValor ? num(d.freteValor === null ? '' : Number(d.freteValor).toFixed(2)) : '',
    veValor ? obsFreteTexto(d) : '',
    veValor && d.freteObservacao === 'COMBINADO' && d.freteCombinado != null ? num(Number(d.freteCombinado).toFixed(2)) : '',
    veValor ? d.freteMotivo : '',
    d.observacoes,
    d.freteDocumento,
  ];

  /* SEPARAÇÃO POR DIA (05/10/2026). Pedido do dono: período de vários dias sai
     "dia 1, dia 2, dia 3…", cada dia com o seu cabeçalho e a sua lista, e a
     sequência recomeça no 1 em cada um. Dia só tem cabeçalho quando há MAIS DE
     UM; um dia só sai como sempre saiu. A linha de cabeçalho tem só a primeira
     célula preenchida — quem filtra a planilha reconhece pela coluna "Nº da
     Carga" vazia. */
  const grupos = separarPorDia(dados, d => diaDaProgramacao({ programadoEm: d.programada }));
  const linhas = [];
  grupos.forEach(g => {
    if(grupos.length > 1) linhas.push([cabecalhoDoDia(g.dia, g.itens.length)]);
    g.itens.forEach(d => linhas.push(linhaDaCarga(d)));
  });

  baixarCsvDoDia(`Administracao_de_Fretes_${isoDiaLocal(new Date())}`, [
    'Sequência', 'Nº da Carga', 'Data da Programação', 'Data do Faturamento', 'Rota', 'Tipo de Operação',
    'Placa', 'Transportadora', 'Tipo de Veículo', 'Peso (t)',
    'Destino do Frete', 'KM',
    'Entregas', 'Motorista',
    'Frete pela Tabela (R$)', 'Observação do Frete', 'Frete Combinado (R$)', 'Motivo sem Valor', 'Observações',
    'Documento de Frete',
  ], linhas,
  /* AS COLUNAS DE TEXTO. "Data da Programação" e "Data do Faturamento" ficam
     FORA de propósito: têm de chegar como data para a Administração ordenar e
     filtrar por elas. Peso, KM e valor também ficam fora — são números que a
     Daniela soma. */
  ['Nº da Carga', 'Rota', 'Tipo de Operação', 'Placa', 'Transportadora',
   'Tipo de Veículo', 'Destino do Frete', 'Motorista',
   'Observação do Frete', 'Motivo sem Valor', 'Observações', 'Documento de Frete'],
  dados.length);
}

