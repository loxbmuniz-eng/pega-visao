/* ---------- TODA CARGA É UM LINK (14/10/2026) ----------

   Pedido do dono: "to no pátio ao vivo e sou da administração, clico na
   carga, aparece as infos do lado, tem que ter um botão que eu clique e va
   direto pra onde pode alterar status da carga, tipo pro histórico daquela
   carga". Aprovado com "1 A": o Corrigir LEVA às Correções da Administração
   do Histórico, já com a etapa aberta — um lugar só para corrigir, o mesmo
   registro com motivo e nome.

   UMA barra, chamada de todo lugar onde a carga aparece sem saída (Pátio ao
   vivo, Pulso dos Indicadores, Torre, Visão do Pátio, Pontos de atenção,
   Pagamento de Frete). Cada destino mora aqui uma vez só: se o caminho até
   a linha do tempo mudar, muda para os seis lugares juntos.

   O BOTÃO SÓ APARECE ONDE A PESSOA PODE IR. Destino de aba que o setor não
   tem não vira botão — botão que leva a uma recusa só ensina a desistir.
   Corrigir é da Administração (o servidor confere de novo). */

function setorVeAba(aba){
  const abas = (DB.operador && SETOR_PERMISSOES[DB.operador.setor]) || [];
  return abas.includes(aba);
}

/* A carga pelo id, ou pelo número quando é tudo o que o lugar sabe (Pontos
   de atenção e Pagamento de Frete falam em número de carga). */
function cargaDoLink(id, numero){
  if(id){ const c = getCarga(id); if(c) return c; }
  if(!numero) return null;
  const n = String(numero).trim();
  return DB.cargas.find(c => String(c.numeroCarga || '').trim() === n) || null;
}

/* Os botões. `opcoes.aqui` tira o destino em que a pessoa já está (na Torre
   não se oferece "Ver na Torre"); `opcoes.numero` serve quando o lugar só
   conhece o número; `opcoes.so` limita aos destinos que cabem numa tabela
   estreita (a Visão do Pátio só leva à linha do tempo). */
function acoesDaCargaHtml(c, opcoes = {}){
  const id = c ? c.id : '';
  const numero = (c && c.numeroCarga) || opcoes.numero || '';
  if(!id && !numero) return '';
  const aqui = opcoes.aqui || '';
  const cabe = (destino) => !opcoes.so || opcoes.so.includes(destino);
  const arg = `'${escJs(id)}','${escJs(numero)}'`;
  const botao = (destino, icone, rotulo, dica) =>
    `<button type="button" class="btn btn-sec btn-sm acao-carga" data-destino="${destino}"
       onclick="event.stopPropagation();irParaCargaUI('${destino}',${arg})"
       title="${esc(dica)}" aria-label="${esc(rotulo + (numero ? ' — carga ' + numero : ''))}">`
    + `<svg class="ico ico-btn" aria-hidden="true"><use href="#i-${icone}"/></svg><span class="acao-carga-rot">${esc(rotulo)}</span></button>`;
  const partes = [];
  if(cabe('linha') && setorVeAba('historico'))
    partes.push(botao('linha', 'historico', 'Linha do tempo', 'Abrir a linha do tempo desta carga no Histórico.'));
  if(cabe('corrigir') && (DB.operador || {}).setor === 'Administração' && setorVeAba('historico'))
    partes.push(botao('corrigir', 'lapis', 'Corrigir etapa', 'Ir às Correções da Administração desta carga, com a etapa aberta.'));
  if(cabe('torre') && aqui !== 'torre' && setorVeAba('torre') && (!c || c.status !== 'Seguiu Viagem'))
    partes.push(botao('torre', 'torre', 'Ver na Torre', 'Mostrar esta carga na Torre de Controle.'));
  if(cabe('frete') && aqui !== 'frete' && setorVeAba('frete') && numero)
    partes.push(botao('frete', 'fretes', 'Frete', 'Abrir o Pagamento de Frete desta carga.'));
  if(!partes.length) return '';
  return `<div class="acoes-carga no-print${opcoes.compacto ? ' acoes-carga-compacta' : ''}" role="group" aria-label="Ir para">${partes.join('')}</div>`;
}

/* O PRÓPRIO NÚMERO COMO LINK, para tabela que não pode crescer (a Visão do
   Pátio): um botão a mais por linha somou 413 px à Torre no portão 87
   (test_tema2027_etapa4_tabelas). Sem permissão de Histórico, fica texto. */
function numeroDaCargaComoLinkHtml(c){
  const n = (c && c.numeroCarga) || '';
  if(!n) return '—';
  if(!setorVeAba('historico')) return esc(n);
  return `<button type="button" class="carga-link acao-carga" data-destino="linha"
     onclick="event.stopPropagation();irParaCargaUI('linha','${escJs(c.id)}','${escJs(n)}')"
     title="Abrir a linha do tempo desta carga no Histórico." aria-label="Linha do tempo da carga ${esc(n)}">${esc(n)}</button>`;
}

/* O mesmo, em volta de um trecho que já existe na linha (na Torre, a data
   da última etapa — que É a linha do tempo resumida). A coluna de ações
   não ganha nada: com um ícone a mais, a linha da Logística crescia uma
   linha inteira (portão 87). */
function linhaDoTempoEmVoltaHtml(c, html){
  if(!c || !setorVeAba('historico')) return html;
  return `<button type="button" class="carga-link acao-carga" data-destino="linha"
     onclick="event.stopPropagation();irParaCargaUI('linha','${escJs(c.id)}','${escJs(c.numeroCarga || '')}')"
     title="Abrir a linha do tempo desta carga no Histórico.">${html}</button>`;
}

function irParaCargaUI(destino, id, numero){
  const c = cargaDoLink(id, numero);
  if(typeof Graf !== 'undefined' && Graf.gavetaAberta && Graf.gavetaAberta()) Graf.fecharGaveta();
  if(typeof fecharPontosDeAtencaoUI === 'function') fecharPontosDeAtencaoUI();

  if(destino === 'frete'){
    FRETE.busca = String((c && c.numeroCarga) || numero || '');
    abrirTab('frete');
    return;
  }
  if(!c){
    /* Fora da cópia deste painel (carga antiga): faz o que a pessoa faria —
       procura o número no Histórico, e a busca diz se achou. */
    abrirTab('historico');
    const busca = document.getElementById('hist-busca-carga');
    if(busca){ busca.value = String(numero || ''); if(typeof renderBuscaTimeline === 'function') renderBuscaTimeline(); }
    return;
  }
  if(destino === 'torre'){ verNaTorreUI(c.id); return; }

  verLinhaDoTempoDoHistoricoUI(c.id);
  if(destino === 'corrigir'){
    const sel = document.getElementById('adm-etapa-' + c.id);
    if(sel){
      if(sel.scrollIntoView) sel.scrollIntoView({ block: 'center' });
      sel.focus();
    }
  }
}

function verNaTorreUI(id){
  abrirTab('torre');
  const tr = document.querySelector(`#torre-tbody tr[data-carga="${CSS.escape(id)}"]`);
  if(!tr){
    notify('Esta carga não aparece na Torre agora — confira o filtro de etapa no topo da Torre.', 'warn', 6000);
    return;
  }
  if(tr.scrollIntoView) tr.scrollIntoView({ block: 'center' });
  tr.classList.remove('linha-apontada');
  void tr.offsetWidth;                 // recomeça o destaque se já estava
  tr.classList.add('linha-apontada');
  setTimeout(() => tr.classList.remove('linha-apontada'), 2400);
}
