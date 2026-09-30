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
  if(!metaNosIndicadores()){
    return tituloSecaoPdf('Tempo Médio de Pátio',
        'Da chegada física do caminhão até a saída — o tempo que a operação e o motorista sentem.') +
      `<table>
        <thead><tr><th>Tempo Médio</th><th>Base</th></tr></thead>
        <tbody><tr>
          <td class="num-forte">${fmtDuracao(t.media)}</td>
          <td>${t.amostra} carga(s)</td>
        </tr></tbody>
      </table>`;
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
  if(!metaNosIndicadores()) return '';   // o bloco inteiro é a meta
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
        const critica = metaNosIndicadores() && c.paradaHaMin !== null && c.paradaHaMin > g.meta;
        return `<tr>
          <td class="id-cel">${esc(c.numeroCarga)}</td>
          <td class="id-cel">${esc(c.placa)}</td>
          <td>${esc(c.transportadora)}</td>
          <td>${esc(c.status)}</td>
          <td class="num-forte"${critica ? ' style="color:#a3271f"' : ''}>${c.paradaHaMin === null ? 'sem registro de chegada' : fmtDuracao(c.paradaHaMin)}${critica ? ' ⚠' : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` +
    fonteDocumento(metaNosIndicadores()
      ? `registros de movimentação do pátio · ⚠ = acima da meta de ${fmtDuracao(g.meta)}`
      : 'registros de movimentação do pátio');
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

  const comMeta = metaNosIndicadores();
  partes.push(!comMeta ? '' : tabela('Gargalos — veículos com atraso recorrente',
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

  partes.push(!comMeta ? '' : tabela('Gargalos — rotas com maior incidência de atraso',
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
    (comMeta
      ? `<div class="print-vazio">Nenhum gargalo detectado — nenhuma carga passou da meta de ${fmtDuracao(g.meta)} em pátio.</div>`
      : `<div class="print-vazio">Nenhum gargalo detectado no período.</div>`));
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

