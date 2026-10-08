/* ---------- TORRE DE CONTROLE ---------- */
/* ====================================================================
   VISÃO DO PÁTIO — linha do tempo dentro da aba de cada setor
   ====================================================================

   Por que existe: quem opera um posto só (Portaria, Expedição,
   Faturamento) precisava trocar de aba para ver o pátio e voltar para
   agir. Duas abas para uma tarefa só, dezenas de vezes por turno.

   Por que em linha do tempo: a tabela de status dizia onde a carga está,
   mas não o que já aconteceu com ela. Numa fila de pátio, "está em
   Embarque Iniciado" vale menos do que "chegou 07:12, começou 09:40, e
   ainda não terminou" — a segunda leitura mostra onde o tempo foi embora.

   Uma função só alimenta as três abas. Duas cópias divergiriam na
   primeira correção feita com pressa, que foi exatamente o que aconteceu
   com o formulário de completar carga.
   ==================================================================== */

/* Marca de cada etapa para uma carga: quando passou, se é a etapa atual,
   ou se ainda não chegou lá. */
function etapasDaCarga(carga){
  const eventos = historicoDaCarga(carga.id);
  const atual = STATUS_FLOW.indexOf(carga.status);
  return STATUS_FLOW.map((status, i)=>{
    const ev = eventos.find(m=>m.statusNovo===status);
    // A primeira etapa não gera movimentação: a carga NASCE nela. Sem este
    // caso, "Aguardando Veículo" apareceria como pendente numa carga que
    // já andou metade do fluxo.
    const quando = ev ? ev.timestamp : (i===0 ? carga.criadoEm : null);
    return {
      status,
      quando,
      cumprida: i < atual,
      atual: i === atual,
      pendente: i > atual,
      operador: ev ? ev.operador : (i===0 ? (carga.criadoPor||'') : ''),
    };
  });
}

/* Linha do tempo COMPACTA — uma célula só, não seis.
   Pedido do usuário (08/08/2026, depois de reportar que a Visão do Pátio
   "não aparece mais" no celular): as seis colunas de etapa (uma por
   status) empilhavam em seis blocos rótulo+valor no cartão mobile —
   ~250-300px só para a sequência de status de UMA carga, empurrando o
   resto da lista tela abaixo. As seis etapas SÃO uma sequência por
   natureza (é literalmente "a carga passou por aqui, está aqui agora,
   ainda não chegou aqui"); o pedido foi "de forma mais compacta... usando
   sequência e organização" — junta as seis num só selo horizontal, na
   ordem em que acontecem, em vez de seis campos empilhados.
   Mesma marca (●/✓/·) e o mesmo `title` com o nome completo do status de
   antes — nada de informação depende só da cor (acessibilidade já
   estabelecida no restante do painel). */
/* O CAMINHÃO MARCA ONDE A CARGA ESTÁ (16/09/2026).

   Pedido do dono: um caminhão no painel, "padrão logística", e ele mesmo
   pediu o juízo de onde. A Visão do Pátio é o lugar, por quatro motivos:

     · é o único onde TODA linha é um veículo de verdade, parado no pátio
       agora — sem filtro de período a lista é `status !== 'Seguiu Viagem'`.
       Na Montagem do Dia a linha nasce sem placa, e desenhar caminhão para
       carga sem veículo seria mostrar na tela o que não existe;
     · a trilha já existe. Caminhão em cima de trilha carrega significado —
       a POSIÇÃO conta o quanto a carga andou. Caminhão numa coluna que não
       é trilha é adesivo;
     · serve quatro telas de uma vez: Torre, Portaria, Expedição e
       Faturamento usam esta mesma função;
     · custa ZERO de largura. Substitui a marca que já estava ali.

   TROCA SÓ O `●`, e isso é decisão. O desenho que mostrei na proposta
   virava a trilha inteira em pontos — mas as marcas `✓` e `·` são TEXTO, e
   este painel decidiu que nenhuma informação depende só de cor. As cores
   daqui também são calibradas por teste de contraste (test_contraste.py),
   com dois achados escritos logo abaixo na folha de estilo. Jogar tudo
   fora para pôr um desenho seria trocar acessibilidade por enfeite.

   O caminhão usa `currentColor`: herda a cor já calibrada da etapa atual,
   nos dois temas, sem uma segunda regra para manter em dia. */
const CAMINHAO_ETAPA =
  '<svg class="et-cam" viewBox="0 0 40 24" aria-hidden="true" focusable="false">'
  + '<rect x="1" y="7" width="19" height="11" rx="1.5" fill="none"'
  +   ' stroke="currentColor" stroke-width="2.2"/>'
  + '<path d="M21 10h6l5 4.2V18H21z" fill="currentColor"/>'
  + '<circle cx="8" cy="20" r="2.6" fill="currentColor"/>'
  + '<circle cx="26" cy="20" r="2.6" fill="currentColor"/></svg>';

function linhaDoTempoCompacta(etapas){
  const passos = etapas.map(e=>{
    const classe = e.atual ? 'et-mini-atual' : e.cumprida ? 'et-mini-ok' : 'et-mini-pendente';
    /* O caminhão entra no lugar do `●`, e o nome da etapa continua no
       `title` do selo — quem lê por leitor de tela não perde nada. */
    const marca = e.atual ? CAMINHAO_ETAPA : e.cumprida ? '✓' : '·';
    const titulo = e.atual ? `${e.status} — agora`
      : e.cumprida ? `${e.status}${e.operador ? ' — '+e.operador : ''}`
      : `${e.status} — ainda não`;
    const hora = e.atual ? (e.quando ? fmtHora(e.quando) : '') : (e.cumprida && e.quando ? fmtHora(e.quando) : '');
    return `<span class="et-mini ${classe}" title="${esc(titulo)}"><b>${marca}</b>${hora ? `<i>${esc(hora)}</i>` : ''}</span>`;
  }).join('');
  return `<td class="et-linha" data-rotulo="Linha do tempo">${passos}</td>`;
}

/* Quem pode tirar uma carga do pátio.

   O mesmo setor que programa é o que cancela — e é ele que responde por
   isso. Portaria, Expedição e Faturamento veem a coluna? Não: para eles a
   carga travada é problema a relatar, não a resolver sozinho. */
function podeCancelarCarga(){
  const setor = (DB.operador||{}).setor;
  return setor === 'Logística' || setor === 'Administração';
}

/* Fechamento de Programação — pedido do usuário (08/08/2026): "permitir
   que faça fechamento da programação e começar nova programação somente
   pela logística ou administração, resetando os painéis de todos os
   setores mantendo somente o histórico". A mesma regra de quem pode
   cancelar carga (Logística/Administração) vale aqui — o servidor confere
   de novo (POST /api/programacao/fechar), isto é só a tela. */
function podeFecharProgramacao(){ return podeCancelarCarga(); }

async function fecharProgramacaoUI(senhaJaInformada){
  if(!SuincoSharePoint || !SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()){
    notify('Fechar a programação exige conexão com o servidor.', 'warn');
    return;
  }
  if(senhaJaInformada === undefined
     && !confirm('Fechar a programação atual e começar uma nova?\n\nNada é apagado: as cargas ficam arquivadas na programação atual e continuam no Histórico.')) return;
  try{
    const r = await SuincoSharePoint.fecharPrograma(senhaJaInformada);
    notify(r.forcado
      ? `Programação fechada às ${fmtHora(r.quando)} com ${r.emAberto} carga(s) ainda em aberto — elas seguem visíveis na Torre.`
      : `Programação fechada às ${fmtHora(r.quando)}. Pronto para uma nova.`,
      r.forcado ? 'warn' : 'success', 7000);
    renderAll();
  }catch(e){
    const cod = e && e.codigo;

    /* Carga em aberto não bloqueia mais — pede a senha de fechamento
       (mudança pedida pelo usuário em 11/08/2026). Antes de pedir a senha,
       mostra QUAIS cargas ficarão em aberto: quem vai digitar a senha
       precisa saber o que está assumindo, senão a senha vira carimbo. */
    if(cod === 'SENHA_NECESSARIA'){
      const cargas = (e.dados && e.dados.cargas) || [];
      const lista = cargas.map(c => `• ${c.placa} — ${c.numeroCarga || 'sem nº'} (${c.status})`).join('\n');
      const senha = prompt(
        `${cargas.length} carga(s) ainda em andamento:\n\n${lista}\n\n`
        + 'Elas NÃO serão apagadas: continuam aparecendo na Torre de Controle, '
        + 'com a data em que foram programadas, e ficam arquivadas nesta programação.\n\n'
        + 'Digite a senha de fechamento para encerrar mesmo assim:');
      if(senha === null) return;                   // desistiu
      if(!senha.trim()){ notify('Fechamento cancelado — senha não informada.', 'warn'); return; }
      return fecharProgramacaoUI(senha);
    }
    if(cod === 'SENHA_INCORRETA'){
      notify('Senha de fechamento incorreta. A programação NÃO foi fechada.', 'danger', 7000);
      return;
    }
    if(cod === 'SENHA_NAO_CONFIGURADA'){
      alert('Há carga em andamento e a senha de fechamento ainda não foi configurada no servidor.\n\n'
            + 'Peça à TI para preencher SENHA_FECHAMENTO no .env do servidor.');
      return;
    }
    if(e && e.status === 403){
      notify('Só Logística ou Administração fecham a programação.', 'danger');
      return;
    }
    notify('Não consegui fechar a programação: ' + (e && e.message || 'erro desconhecido'), 'danger');
  }
}

/* O botão muda de nome conforme a etapa, porque as duas ações são
   diferentes de verdade: excluir some com algo que nunca aconteceu;
   cancelar encerra algo que começou, e por isso pede motivo. */
/* Botão de revisões (Bloco B, 16/08/2026) — só Administração.

   Abre a linha do tempo da carga vinda do SERVIDOR (trigger da migration
   009): quem mudou o quê, quando, e o botão Restaurar. Na semana de
   14–15/08, restaurar dado sobrescrito exigiu reconstruir valores a partir
   de um PDF; agora é um clique auditado. */
function botaoRevisoesHtml(c){
  if(!DB.operador || DB.operador.setor !== 'Administração') return '';
  return `<button class="btn btn-sec btn-sm btn-revisoes" onclick="abrirRevisoesUI('${escJs(c.id)}')"
            title="Ver alterações desta carga e restaurar uma versão anterior"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-desfazer"/></svg></button>`;
}

async function abrirRevisoesUI(id){
  const c = getCarga(id);
  if(!c) return;
  if(!SuincoSharePoint.estaConfigurado || !SuincoSharePoint.estaConfigurado()){
    notify('O histórico de alterações mora no servidor — sem conexão não há o que listar.', 'warn');
    return;
  }
  const modal = document.getElementById('modal-revisoes');
  document.getElementById('revisoes-titulo').textContent =
    `Alterações — carga ${c.numeroCarga || '(sem número)'} · ${c.placa}`;
  const lista = document.getElementById('revisoes-lista');
  lista.innerHTML = '<div class="card-sub">Buscando no servidor…</div>';
  modal.classList.add('open');
  try{
    const revs = await SuincoSharePoint.listarRevisoes(id);
    if(!revs.length){
      lista.innerHTML = '<div class="card-sub">Nenhuma alteração registrada ainda — '
        + 'o histórico começa a valer a partir da ativação das revisões no servidor.</div>';
      return;
    }
    lista.innerHTML = revs.map(r=>{
      const s = r.carga || {};
      const peso = ((s.peso||0)/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      return `<div class="revisao-item">
        <div class="revisao-cab">
          <strong>${fmtDataHora(r.gravadaEm)}</strong>
          <span>alterada por ${esc(r.mudadaPor)||'—'}${r.mudadaSetor ? ' · '+esc(r.mudadaSetor) : ''}</span>
        </div>
        <div class="revisao-campos">
          <span>Nº <strong>${esc(s.numeroCarga)||'—'}</strong></span>
          <span>${esc(s.placa)||'—'}</span>
          <span>${peso} t</span>
          <span>rota ${esc(s.rota)||'—'}</span>
          <span>${esc(s.status)||'—'}${s.aguardandoCarga ? ' · aguardando dados' : ''}</span>
        </div>
        <button class="btn btn-warn btn-sm" onclick="restaurarRevisaoUI('${escJs(id)}', ${Number(r.revisaoId)})">
          Restaurar esta versão</button>
      </div>`;
    }).join('');
  }catch(e){
    lista.innerHTML = `<div class="aviso-local">Não consegui buscar: ${esc(e.message)}</div>`;
  }
}

async function restaurarRevisaoUI(id, revisaoId){
  /* UMA CAIXA, e a ação acontece (25/08/2026).

     Até aqui isto abria um PEDIDO e esperava outro administrador aprovar.
     O dono tirou essa exigência — ver o comentário no topo de
     backend/src/rotas/cargas.js para o que a trava protegia e o que ficou
     no lugar dela. O motivo continua obrigatório porque é ele que
     responde "por que esta carga voltou" no histórico. */
  const motivo = (prompt('Restaurar a carga para esta versão?\n\n'
    + 'A carga volta EXATAMENTE ao estado mostrado, em todos os aparelhos.\n\n'
    + 'Por que ela precisa voltar? (fica no histórico com o seu nome)')||'').trim();
  if(!motivo) return;
  try{
    const restaurada = await SuincoSharePoint.restaurarRevisao(id, revisaoId, motivo);
    // O servidor é a fonte da verdade da restauração: aplica a resposta
    // localmente na hora, sem esperar o próximo ciclo de sincronização.
    const local = getCarga(id);
    if(local && restaurada){
      Object.assign(local, {
        numeroCarga: restaurada.numeroCarga, placa: restaurada.placa,
        transportadora: restaurada.transportadora, tipoVeiculo: restaurada.tipoVeiculo,
        motorista: restaurada.motorista, cliente: restaurada.cliente,
        destino: restaurada.destino, peso: restaurada.peso, doca: restaurada.doca,
        rota: restaurada.rota, sequencia: restaurada.sequencia,
        praOnde: restaurada.praOnde, paletizada: restaurada.paletizada,
        qtdGanchos: restaurada.qtdGanchos, qtdEntregas: restaurada.qtdEntregas,
        observacoes: restaurada.observacoes, status: restaurada.status,
        aguardandoCarga: restaurada.aguardandoCarga,
        programadoEm: restaurada.programadoEm, atualizadoEm: restaurada.atualizadoEm,
      });
      // Marca como já sincronizada: o que acabou de vir do servidor não
      // pode ser devolvido a ele como se fosse edição nossa.
      SuincoStore._ultimoSync.set(local.id, local.atualizadoEm || '');
      if(DB._sincronizado) DB._sincronizado[local.id] = local.atualizadoEm || '';
      SuincoStore.save();
    }
    document.getElementById('modal-revisoes').classList.remove('open');
    notify('Versão restaurada. Todos os aparelhos recebem em instantes.', 'success');
    renderAll();
  }catch(e){
    notify('Não consegui restaurar: ' + (e.message || 'erro desconhecido'), 'danger', 8000);
  }
}

function fecharRevisoesUI(){
  document.getElementById('modal-revisoes').classList.remove('open');
}

/* "➕ Outra carga" na Torre — relato do Programador de Embarque
   (18/08/2026): "a opção de criar uma segunda carga não tá aparecendo".

   Não era regressão, era beco sem saída: o botão só existia na linha da
   Fila de Programados, e a fila só mostra carga de HOJE em "Aguardando
   Veículo" (decisão de 11/08). Carga programada ontem, ou caminhão que já
   chegou, não tem linha lá — e o formulário bloqueia a placa duplicada
   apontando para um botão que não estava em lugar nenhum. A Torre mostra
   TODA carga em aberto, sempre; é o lugar que não some. */
function botaoOutraCargaHtml(c){
  if(!podeCancelarCarga()) return '';
  // Caminhão que já seguiu viagem liberou a placa: o formulário aceita a
  // placa de novo sem autorização nenhuma — o botão aqui seria ruído.
  if(c.status === 'Seguiu Viagem') return '';
  return `<button class="btn btn-sec btn-sm" onclick="adicionarOutraCargaNaPlacaUI('${escJs(c.id)}')"
            title="Programar OUTRA carga para este mesmo caminhão — abre a Programação com placa, transportadora, motorista e rota preenchidos."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-mais"/></svg>Outra carga</button>`;
}

function botaoCancelarHtml(c){
  /* Carga em "Seguiu Viagem" tem proteção a mais (pede confirmação
     digitando a placa, ver excluirCargaSeguiuViagemUI) — mas não é mais
     intocável. Pedido direto do usuário (08/08/2026): dado de teste que
     passou pelo fluxo inteiro (ex.: DJF8527) ficava preso na Torre pra
     sempre, sem nenhuma ação disponível pra tirar de lá. */
  /* SEGURAR PARA CANCELAR (`data-segurar`). O gesto é o que confirma: o
     dedo fica 1,5 s no botão e a barra conta na frente dele. Solta antes e
     nada acontece. É a pergunta que não dá para responder no automático —
     "tem certeza?" todo mundo aprende a clicar sem ler.

     O que vem DEPOIS do gesto não mudou uma linha: `excluirCargaUI`
     continua pedindo o motivo de quem já andou, e a carga que seguiu
     viagem continua pedindo a placa digitada. O gesto substitui o
     "tem certeza?", não a pergunta que vira registro.

     Teclado e chamada de programa passam direto (ver o porteiro no bloco
     MOVIMENTO): o gesto novo é para a mão, e ninguém fica sem saída. */
  if(c.status === 'Seguiu Viagem'){
    return `<button class="btn btn-danger btn-sm" data-segurar="1"
              data-segurar-dica="Segure 1,5s para excluir esta carga já finalizada."
              onclick="excluirCargaSeguiuViagemUI('${escJs(c.id)}')"
              title="SEGURE 1,5s para excluir mesmo já tendo seguido viagem — ainda pede a placa digitada, some do histórico/relatórios.">Excluir</button>`;
  }
  const cancelar = c.status !== 'Aguardando Veículo';
  return `<button class="btn btn-danger btn-sm" data-segurar="1"
            data-segurar-dica="Segure 1,5s para ${cancelar ? 'cancelar' : 'excluir'} a carga da placa ${esc(c.placa)}."
            onclick="excluirCargaUI('${escJs(c.id)}')"
            title="${cancelar ? 'SEGURE 1,5s para cancelar esta carga (depois pede o motivo e fica no log)'
                              : 'SEGURE 1,5s para excluir esta carga programada'}">`
       + (cancelar ? 'Cancelar' : 'Excluir') + '</button>';
}

function limparPeriodoVisaoPatio(prefixo){
  ['de','ate','busca'].forEach(campo=>{
    const el = document.getElementById(`${prefixo}-vp-${campo}`);
    if(el) el.value = '';
  });
  renderVisaoPatio(prefixo);
}

/* FROTA PRÓPRIA x TRANSPORTADORAS (19/08/2026).

   Pedido do gestor: na Visão de Pátio da Torre, "um bloco só para a frota
   própria, liberando o outro bloco para as de transportadoras". São duas
   conversas diferentes — o caminhão da casa a Suinco remaneja; o de
   transportadora ela cobra —, e ver as duas misturadas obriga a pessoa a
   filtrar com o olho a cada leitura.

   A marca é a transportadora do cadastro de Frota: os veículos próprios
   estão sob "Suinco". Comparação sem acento e sem caixa, porque cadastro
   digitado à mão sempre traz variação. */
const MARCAS_FROTA_PROPRIA = ['suinco'];
function ehFrotaPropria(carga){
  const t = String((carga && carga.transportadora) || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return MARCAS_FROTA_PROPRIA.some(m => t.includes(m));
}

function renderVisaoPatio(prefixo){
  const tbody = document.getElementById(`${prefixo}-vp-tbody`);
  if(!tbody) return;                       // aba sem a visão (Logística usa a Torre)

  const de     = (document.getElementById(`${prefixo}-vp-de`)   || {}).value || '';
  const ate    = (document.getElementById(`${prefixo}-vp-ate`)  || {}).value || '';
  const buscaEl= document.getElementById(`${prefixo}-vp-busca`);
  const busca  = normalizarPlaca(buscaEl ? buscaEl.value : '');
  const textoBusca = (buscaEl ? buscaEl.value : '').trim().toLowerCase();

  /* Sem período escolhido, mostra o pátio de agora — as cargas em aberto.
     Com período, mostra tudo daquele intervalo, inclusive o que já seguiu
     viagem: é justamente para revisitar carga encerrada que o filtro
     existe. */
  const houvePeriodo = !!(de || ate);
  let lista = houvePeriodo
    ? filtrarPorDataProgramacao(DB.cargas, de, ate)
    : DB.cargas.filter(c=>c.status !== 'Seguiu Viagem');

  if(textoBusca){
    lista = lista.filter(c =>
      normalizarPlaca(c.placa).includes(busca) ||
      String(c.numeroCarga||'').toLowerCase().includes(textoBusca));
  }

  lista = lista.slice().sort(ordenarPorSequenciaEAtualizacao);

  /* Sem período, `lista` já é só o pátio aberto agora — naturalmente
     pequeno. COM período (pedido para "revisitar carga encerrada", ver
     comentário acima), não tinha limite NENHUM — a mesma classe de bug
     achada e corrigida na Frota e no Histórico (auditoria "refinamento em
     TODAS AS ABAS", 08/08/2026): um período de meses reais de operação
     vira centenas de linhas, e no celular (cartão de 2 colunas) isso é
     rolagem de dezenas de milhares de pixels — medido: 400 cargas =
     188.217px de altura de página. Esta função alimenta Torre, Portaria,
     Expedição e Faturamento — a correção vale pras quatro de uma vez. */
  const LIMITE = ehTelaEstreita() ? 40 : 300;
  const listaCompleta = lista;
  lista = lista.slice(0, LIMITE);

  const thead = document.getElementById(`${prefixo}-vp-thead`);
  if(thead){
    thead.innerHTML =
      '<th class="vp-carga">Nº Carga</th><th class="vp-placa">Placa</th>'
      + '<th class="vp-transp">Transportadora</th><th class="vp-rota">Rota</th>'
      + '<th class="et-cab-linha">Linha do tempo</th>'
      + '<th class="vp-tempo">No pátio</th>';
    /* SEM coluna de Ação aqui, e é decisão de operação, não de espaço.

       A Visão do Pátio aparece nas abas de Portaria, Expedição e
       Faturamento. Excluir e cancelar carga é da Programação — só ela sabe
       se aquela carga foi desmarcada pelo cliente ou se está só atrasada, e
       o servidor recusa a exclusão vinda de qualquer outro setor
       (podeCriarCarga, em rotas/cargas.js).

       Enquanto o botão aparecia para quem tem permissão de Logística, ele
       aparecia TAMBÉM quando essa pessoa estava olhando a aba da Expedição
       — a ação certa no lugar errado. Aqui a visão é de leitura: o setor
       acompanha o pátio e age pelo botão da própria etapa. */
  }

  const linhaCarga = (c)=>{
    const etapas = etapasDaCarga(c);
    /* `data-carga` NÃO desenha nada — é a etiqueta pela qual o movimento
       encontra a linha desta carga quando ela entra no pátio ou sai dele
       (ver o bloco MOVIMENTO no fim deste arquivo). A Torre e a Fila já
       tinham a etiqueta; a Visão do Pátio é justamente onde o caminhão é
       visto, e estava sem. */
    return `<tr class="linha-status-${esc((STATUS_META[c.status]||{}).cor || '')}" data-carga="${esc(c.id)}">
      <td class="vp-carga">${esc(c.numeroCarga)||'—'}</td>
      <td class="vp-placa">${esc(c.placa)}${marcaCargaDaPlaca(c, lista)}${marcaEtapaDevolvidaHtml(c)}${marcaSaiuSemCarregarHtml(c)}</td>
      <td class="vp-transp">${esc(c.transportadora)||'—'}</td>
      <td class="vp-rota">${esc(rotaCurta(c.rota))}</td>
      ${linhaDoTempoCompacta(etapas)}
      <td class="vp-tempo">${tempoNoPatioTexto(c)}</td>
    </tr>`;
  };

  /* A Torre separa em dois blocos; as outras abas seguem em lista única.
     Ali a pessoa olha o próprio posto e a origem do caminhão não muda o que
     ela faz — a divisão só somaria uma linha de título sem serviço. */
  if(prefixo === 'torre'){
    const propria = lista.filter(ehFrotaPropria);
    const terceiros = lista.filter(c=>!ehFrotaPropria(c));
    const grupo = (titulo, cargas)=> cargas.length
      ? `<tr class="vp-grupo"><td colspan="6">${titulo} <b>${cargas.length}</b> carga(s)</td></tr>`
        + cargas.map(linhaCarga).join('')
      : '';
    /* Transportadoras primeiro (19/08/2026, pedido do gestor): é o bloco
       maior e o que exige cobrança externa — a frota própria a casa
       remaneja quando quiser, então fecha a lista. */
    tbody.innerHTML = grupo('🚛 Transportadoras —', terceiros)
      + grupo('🏠 Frota própria —', propria);
  } else {
    tbody.innerHTML = lista.map(linhaCarga).join('');
  }
  movLinhasNovas(tbody);

  /* Estado vazio que oferece a saída.

     Filtro que não encontrou nada e só diz "nenhuma carga" deixa o operador
     preso: ele não sabe se o pátio está vazio ou se o filtro é que está
     estreito. Aqui a mensagem diz qual é o caso e, quando há filtro, traz o
     botão que o limpa. */
  const vazio = document.getElementById(`${prefixo}-vp-empty`);
  vazio.hidden = listaCompleta.length > 0;
  if(!vazio.hidden){
    const filtrando = houvePeriodo || !!textoBusca;
    vazio.innerHTML = filtrando
      ? 'Nenhuma carga encontrada com esse filtro.'
        + `<span class="empty-acao"><button class="btn btn-sec btn-sm" onclick="limparPeriodoVisaoPatio('${prefixo}')">Ver o pátio de agora</button></span>`
      : 'Nenhuma carga em aberto no pátio neste momento.';
  }

  const resumo = document.getElementById(`${prefixo}-vp-resumo`);
  if(resumo){
    // Contagem e distribuição por status usam a lista COMPLETA (antes do
    // corte de exibição) — o resumo tem que responder pela busca inteira,
    // mesmo quando a tabela abaixo mostra só as primeiras LIMITE linhas.
    const porStatus = STATUS_FLOW.map(st=>({
      status: st, n: listaCompleta.filter(c=>c.status===st).length
    })).filter(x=>x.n > 0);
    const nPropria = listaCompleta.filter(ehFrotaPropria).length;
    resumo.innerHTML =
      `<span class="vp-total">${listaCompleta.length} carga(s)</span>`
      + (prefixo === 'torre' && listaCompleta.length
          ? `<span class="vp-chip badge">Frota própria: <b>${nPropria}</b></span>`
            + `<span class="vp-chip badge">Transportadoras: <b>${listaCompleta.length - nPropria}</b></span>`
          : '')
      + (houvePeriodo ? '<span class="vp-periodo">no período escolhido</span>'
                      : '<span class="vp-periodo">em aberto agora</span>')
      + porStatus.map(x=>`<span class="vp-chip badge ${esc((STATUS_META[x.status]||{}).badge||'')}">${esc(x.status)}: <b>${x.n}</b></span>`).join('')
      + (listaCompleta.length > LIMITE
          ? `<span class="vp-periodo">— mostrando as ${LIMITE} mais recentes; refine o período ou a busca pra ver outras</span>`
          : '');
  }
}

/* Há quanto tempo a carga está no pátio. Conta da CHEGADA, não da
   programação: carga programada na véspera não passou a noite no pátio, e
   contar assim inflaria o número que o gestor usa para cobrar. */
function tempoNoPatioTexto(carga){
  /* A CONTA NÃO MORA MAIS AQUI (24/09/2026). Esta função refazia a conta
     por conta própria, lendo o carimbo cru — e era a única das três que
     não conferia se o carimbo prestava. Carga com data lá na frente saía
     `0min`: um caminhão parado há horas aparecia como recém-chegado, e
     nunca ganhava o destaque de acima da meta. Agora ela só DESENHA o que
     `tempoDePatioDe` respondeu. */
  const t = tempoDePatioDe(carga);
  /* Sem chegada é traço limpo: o caminhão não entrou, não há o que contar. */
  if(t.minutos === null && !t.suspeito) return '<span class="text-dim">—</span>';
  /* COM CARIMBO FURADO PODE NÃO HAVER DURAÇÃO NENHUMA — chegada no futuro
     não produz intervalo. A versão antiga desta tela resolvia com
     `Math.max(0, ...)` e escrevia `0min`, que é o pior resultado possível:
     um caminhão parado há horas passando por recém-chegado. Aqui a coluna
     assume que não sabe. */
  const h = t.minutos === null ? 0 : Math.floor(t.minutos/60);
  const m = t.minutos === null ? 0 : t.minutos%60;
  const texto = t.minutos === null ? '?'
    : (h ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`);
  /* CARIMBO RUIM MOSTRA O RELÓGIO E SE DECLARA — decisão do dono. Esconder
     o número (traço) apagaria junto o destaque de atrasado de um caminhão
     que ESTÁ no pátio; é melhor ver o número sabendo que ele é duvidoso do
     que não ver o caminhão. */
  if(t.suspeito){
    return `<span class="vp-suspeito" title="Carimbo suspeito: a data desta carga não fecha, `
      + `então este tempo pode estar errado. O número fica à vista para o caminhão não sumir `
      + `da tela, mas ele está fora das médias dos Indicadores.">${texto} <b>?</b></span>`;
  }
  // Acima da meta, destaca. É o número que faz alguém levantar da cadeira.
  const acima = t.emAndamento && t.minutos > META_TEMPO_PATIO_MIN;
  return acima ? `<b class="vp-atrasado">${texto}</b>` : texto;
}

/* Contagem crescente nos números da Torre de Controle — só quando o valor
   MUDA de um render pro outro, nunca na primeira pintura da tela nem em
   re-render sem mudança real (a Torre redesenha a cada sincronia, a cada
   ~15s; animar todo redesenho seria decoração, não informação — a mesma
   distinção que a esteira de UX chama de "motion precisa comunicar algo").

   Guardado por RÓTULO (não pelo nó do DOM, que é recriado a cada render
   via innerHTML) — funciona porque os rótulos das caixas da Torre são
   fixos ("Cargas em aberto", os 5 nomes de status etc.). */
let _ultimoValorTorre = {};
/* Filtro por clique nas caixas da Torre — pedido do usuário (08/08/2026):
   "clique nos quadrados... aguardando embarque, aguardando veiculo... e
   faça um filtro instantâneo apontando pra aquelas cargas de cada
   status". null = sem filtro (mostra as cargas em aberto, comportamento
   de sempre). Duas chaves especiais além dos 6 nomes de status reais:
   '__SEGUIU_HOJE__' (a caixa "Seguiu Viagem hoje" não é um status
   presente em cargasAbertas()) e '__AGUARDANDO_CARGA__' (a flag
   aguardandoCarga, não um valor de status). */
let _torreFiltroStatus = null;
function filtrarTorrePorStatus(chave){
  /* A caixa "Entradas sem carga" não filtra a Torre: ela LEVA para a
     Programação (19/08/2026). Esses registros não aparecem mais aqui, e
     mandar o filtro devolveria uma tabela vazia — a resposta certa é a aba
     onde a carga é lançada. */
  if(chave === '__IR_PROGRAMACAO__'){
    const abas = (DB.operador && SETOR_PERMISSOES[DB.operador.setor]) || [];
    if(abas.includes('programacao')){
      abrirTab('programacao');
      const alvo = document.getElementById('prog-aguardando-tbody');
      if(alvo && alvo.scrollIntoView) alvo.scrollIntoView({block:'center'});
    } else {
      notify('As entradas sem carga são lançadas pela Logística, na aba Programação.', '', 6000);
    }
    return;
  }
  _torreFiltroStatus = (chave === '__TODAS__' || _torreFiltroStatus === chave) ? null : chave;
  renderTorre();
}
/* =====================================================================
   FAIXA DE INDICADORES NO FORMATO BI (23/08/2026)
   =====================================================================

   Pedido do usuário, depois de ver o preview: "aplicar essa ideia BI
   format na parte de indicador, tudo que for indicador na Torre de
   Controle... mas sem mudar também o que já está feito".

   Então é MISTURA, não substituição: a tabela da Torre, os cartões do
   celular, o Raio-X e a Visão do Pátio continuam exatamente como estavam.
   O que muda é só a faixa de números — e o que ela passa a dizer.

   O defeito que isso corrige é conceitual, não estético: um número solto
   ("8 Aguardando Veículo") é um CONTADOR. Vira INDICADOR quando ganha
   referência — quanto isso representa do total, e para onde estava indo.
   Daí as três peças novas em cada caixa: participação (% do pátio),
   variação contra o dia anterior, e a série dos últimos 14 dias.

   As três saem de dado REAL do próprio painel. Mini-gráfico com número
   inventado seria pior que não ter mini-gráfico: mente com aparência de
   evidência.
   ===================================================================== */

/* Um caminho SVG de uma linha só, sem eixo e sem rótulo — a forma da série,
   não a leitura precisa dela (o número grande ao lado é que se lê).

   `vector-effect="non-scaling-stroke"` porque o viewBox é esticado pela
   largura da caixa: sem isso a espessura do traço muda de caixa para
   caixa, e a faixa inteira fica visualmente desalinhada. */
function sparklineSvg(vals, cor, w = 74, h = 22){
  const v = (vals || []).filter(x => Number.isFinite(x));
  if(v.length < 2) return '';
  const mx = Math.max(...v), mn = Math.min(...v);
  /* Série sem variação (todos os valores iguais) precisa desenhar no MEIO
     da caixa. Com amp forçada em 1, (x-mn)/amp dá 0 para todo ponto e o
     traço encosta na base — lido como "despencou para o mínimo", que é o
     oposto de "não mudou". */
  const chata = mx === mn;
  const amp = chata ? 1 : (mx - mn);
  const px = i => (i / (v.length - 1)) * (w - 2) + 1;
  const py = x => chata ? (h / 2) : (h - 2 - ((x - mn) / amp) * (h - 5));
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(x).toFixed(1)}`).join(' ');
  const idg = 'spk' + Math.random().toString(36).slice(2, 8);
  return `<svg class="stat-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
      preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${idg}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${cor}" stop-opacity=".30"/>
      <stop offset="100%" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${px(v.length-1).toFixed(1)} ${h} L${px(0).toFixed(1)} ${h} Z" fill="url(#${idg})"/>
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linecap="round"
          stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${px(v.length-1).toFixed(1)}" cy="${py(v[v.length-1]).toFixed(1)}" r="2" fill="${cor}"/>
  </svg>`;
}

/* A variação escrita por extenso. `pioraQuandoSobe` existe porque a mesma
   seta significa coisas opostas dependendo do indicador: mais carga parada
   no pátio é ruim, mais carga concluída é bom. Cor errada aqui ensina o
   gestor a ler o painel ao contrário. */
/* `igual` é parâmetro porque a mesma função serve duas comparações
   diferentes: na Torre é contra ONTEM, nos tempos médios é a semana contra
   a anterior. Texto fixo dizia "igual a ontem" numa caixa que compara sete
   dias — número certo com legenda errada é pior que número ausente. */
function deltaHtml(atual, anterior, {pioraQuandoSobe = true, sufixo = '',
                                     percentual = false, igual = 'sem variação'} = {}){
  if(!Number.isFinite(atual) || !Number.isFinite(anterior)) return '';
  const dif = atual - anterior;
  if(dif === 0) return `<div class="stat-delta stat-igual">= ${esc(igual)}</div>`;
  const sobe = dif > 0;
  const ruim = sobe === pioraQuandoSobe;
  let texto;
  if(percentual){
    if(!anterior) return '';
    texto = Math.round(Math.abs(dif) / anterior * 100) + '%';
  } else {
    texto = Math.abs(dif) + sufixo;
  }
  return `<div class="stat-delta ${ruim ? 'stat-pior' : 'stat-melhor'}">`
       + `${sobe ? '▲' : '▼'} ${texto}</div>`;
}

/* Quantas cargas estavam EM ABERTO ao fim de cada um dos últimos N dias, e
   quantas seguiram viagem em cada um deles.

   Reconstruído do próprio histórico: uma carga estava aberta no dia D se
   nasceu até o fim de D e não tinha saído até o fim de D. Uma passada por
   carga (a saída é consultada uma vez só e fica em cache), depois N
   comparações por carga — barato o bastante para rodar a cada render da
   Torre, que é o que garante que a série nunca fica velha. */
function serieDoPatio(dias = 14){
  const fins = [];
  for(let i = dias - 1; i >= 0; i--){
    const d = new Date(); d.setHours(23, 59, 59, 999); d.setDate(d.getDate() - i);
    fins.push(d.getTime());
  }
  const abertas = new Array(dias).fill(0);
  const seguiu  = new Array(dias).fill(0);
  DB.cargas.forEach(c => {
    /* A MESMA CONTA DO NÚMERO DO QUADRO (30/09/2026, #101). "Cargas em
       aberto" não conta a chegada sem programação nem carga sem placa; o
       mini-gráfico e a seta contavam, e diziam 3 ao lado de um 2. */
    if(c.aguardandoCarga || !c.placa) return;
    const nasceuEm = new Date(c.programadoEm || c.criadoEm || 0).getTime();
    if(!Number.isFinite(nasceuEm)) return;
    /* Quando saiu: só o carimbo (#102). Seguiu Viagem SEM carimbo não é
       aberta (o número não a conta) nem saída de dia nenhum. */
    const saidaISO = c.status === 'Seguiu Viagem' ? saidaDaCarga(c) : null;
    if(c.status === 'Seguiu Viagem' && !saidaISO) return;
    const saiuEm = saidaISO ? new Date(saidaISO).getTime() : null;
    for(let i = 0; i < dias; i++){
      const fim = fins[i];
      if(nasceuEm <= fim && (saiuEm === null || saiuEm > fim)) abertas[i]++;
      if(saiuEm !== null && saiuEm <= fim && saiuEm > fim - 86400000) seguiu[i]++;
    }
  });
  return { abertas, seguiu };
}

function animarContadoresTorre(){
  const reduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('#torre-stats [data-contador]').forEach(el=>{
    const chave = el.dataset.contador;
    const alvo = Number(el.textContent);
    if(!Number.isFinite(alvo)) return; // nunca deveria acontecer aqui, mas não trava se acontecer
    const anterior = _ultimoValorTorre[chave];
    _ultimoValorTorre[chave] = alvo;
    if(reduzido || anterior === undefined || anterior === alvo){
      el.textContent = alvo; // primeira pintura ou sem mudança: direto, sem show
      return;
    }
    const inicio = anterior, duracao = 500, t0 = performance.now();
    const passo = (agora)=>{
      const p = Math.min(1, (agora - t0) / duracao);
      // ease-out: rápido no começo, assenta no fim — número que "acelera"
      // no meio do pátio parece erro de leitura, não destaque.
      const suavizado = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(inicio + (alvo - inicio) * suavizado);
      if(p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}

function renderTorre(){
  /* O Fechar (no fim da lista) e o Reorganizar (junto da ação de rotina)
     moravam no mesmo bloco até 01/10/2026; separados, aparecem pela MESMA
     conta — uma decisão, dois botões. */
  const podeFechar = podeFecharProgramacao();
  ['btn-fechar-programacao-wrap', 'btn-reorganizar-torre-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.hidden = !podeFechar;
  });

  /* A TORRE MOSTRA CARGA LANÇADA (19/08/2026).

     Um caminhão que chega sem programação vira um registro "aguardando
     carga": tem placa, não tem carga. Ele aparecia na Torre junto com as
     cargas de verdade, e o gestor pediu para tirar: "não quero que
     apareçam na torre de controle, pois isso gera confusão... só devem ser
     exibidos após a carga ser lançada".

     O lugar dele é a aba Programação, onde já existe a tabela "Entradas
     aguardando carga" com o botão de criar a carga. A caixa aqui continua
     contando — sumir de vez esconderia caminhão parado no pátio —, mas o
     clique agora leva para lá, que é onde se resolve. */
  /* Sem as INATIVAS (decisão 29): mais de 3 dias sem movimentação saem
     da fila e dos números da Torre e vão para o bloco recolhido abaixo da
     tabela (renderTorreInativas) — fora da conta, não escondidas. */
  const emAberto = cargasAtivas();
  /* Sem placa, fora da Torre — o pedido literal do dono (26/08/2026): "só a
     partir da hora que colocarem a placa ela vai pra torre de controle". A
     Torre é o pátio; carga sem caminhão ainda é planejamento e mora na aba
     Programação, na lista "Cargas sem caminhão". */
  const abertas = emAberto.filter(c=>!c.aguardandoCarga && c.placa);
  const porStatus = {};
  abertas.forEach(c=>{ porStatus[c.status] = (porStatus[c.status]||0) + 1; });
  // "Aguardando Carga" não é mais um valor de status — é a flag
  // `aguardandoCarga` (o texto fica no campo Número da Carga). Mostrado
  // como uma caixa extra informativa, não como um dos 6 status oficiais.
  const statusVisiveis = STATUS_FLOW.slice(0,-1); // sem "Seguiu Viagem" (não fica em aberto)
  const aguardandoCargaCount = emAberto.filter(c=>c.aguardandoCarga).length;
  /* "Quantos já seguiram viagem" — pedido direto do usuário (08/08/2026):
     "na torre de controle nao aparece quantos seguiram viagem". Fica de
     fora de `abertas` de propósito (Seguiu Viagem não é mais pátio em
     aberto), então precisa de conta própria. Contado por HOJE, não
     total histórico — DB.cargas guarda tudo desde sempre, e "quantos
     saíram" só responde a pergunta de acompanhamento do dia se for do
     dia. Usa o instante real da saída (primeiroTimestamp), não a data de
     criação da carga: um caminhão programado ontem que só saiu hoje
     conta em hoje. */
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  // Sobras da programação anterior — ver ehProgramacaoAntiga().
  const antigasCount = abertas.filter(ehProgramacaoAntiga).length;
  const seguiuViagemHojeCount = DB.cargas.filter(c=>{
    if(c.status !== 'Seguiu Viagem') return false;
    const saida = primeiroTimestamp(c.id, 'Seguiu Viagem');
    return saida && new Date(saida) >= hoje;
  }).length;
  /* Hierarquia visual, não grade uniforme.

     Antes as seis caixas tinham exatamente o mesmo peso, e isso não é
     verdade no pátio: carga parada além da meta é o que faz alguém
     levantar da cadeira; "Faturado" é informação de acompanhamento. Grade
     igual obriga o olho a ler as seis para achar a que importa.

     A conta é a mesma de sempre — só o tamanho da caixa muda. */

  /* A série do pátio alimenta o mini-gráfico e a variação. Calculada UMA
     vez por render — cada caixa só lê o pedaço dela. */
  const serie = serieDoPatio(14);
  const totalAberto = abertas.length;

  const caixa = (num, rotulo, {destaque=false, alerta=false, nota='', filtro=null,
                               cor='', participacao=false, spark=null,
                               deltaDe=null, pioraQuandoSobe=true} = {}) => {
    const ehLimpar = filtro === '__TODAS__';
    const ativo = filtro !== null && (ehLimpar ? _torreFiltroStatus === null : _torreFiltroStatus === filtro);
    const clicavel = filtro !== null;
    // No celular a nota some da grade compacta (.stat-note{display:none} —
    // ver styles.css) pra caber em três colunas; o title garante que a
    // informação continua acessível, só muda de "sempre visível" pra
    // "sob demanda", como o próprio aviso de clique já era.
    const dicaClique = 'Clique para filtrar a tabela por esta caixa — clique de novo para limpar.';
    /* A participação entra no title junto com a nota: no celular ela sai da
       tela (ver .bi-faixa .stat-share em styles.css) e sem isso a
       informação desapareceria em vez de mudar de lugar. */
    const dicaPct = participacao && totalAberto > 0
      ? `${Math.round(num / totalAberto * 100)}% das ${totalAberto} cargas em aberto` : '';
    const titulo = [dicaPct, nota, clicavel ? dicaClique : ''].filter(Boolean).join(' — ');

    /* As três peças que transformam contador em indicador. Cada uma só
       aparece quando tem dado real por trás — caixa sem série não ganha
       traço reto fingindo tendência, e participação de zero sobre zero não
       vira "0% do pátio". */
    const pct = participacao && totalAberto > 0
      ? `<div class="stat-share">${Math.round(num / totalAberto * 100)}% do pátio</div>` : '';
    const delta = deltaDe
      ? deltaHtml(deltaDe[0], deltaDe[1],
                  {pioraQuandoSobe, sufixo:' vs. ontem', igual:'igual a ontem'}) : '';
    const linha = spark && spark.length > 1
      ? sparklineSvg(spark, corTema(alerta && num > 0 ? '--st-aguardando-veiculo-txt' : '--gold-text')) : '';

    /* CAIXA EM ZERO PARA DE GRITAR (16/09/2026).

       Medido na Torre com o pátio cheio: das nove caixas, TRÊS mostravam
       zero, cada uma com o mesmo peso visual de uma com dado. Num painel
       onde o olho procura o que exige ação, três zeros com peso igual são
       três falsos chamados.

       Ela NÃO SOME — "pátio não se apaga" vale aqui também. Continua no
       lugar, clicável e contando; só para de competir. Virou 1, acende
       sozinha. O passar do cursor também a acende, para quem foi olhar.

       A decisão mora AQUI e não no CSS porque é o número que a define, e
       folha de estilo não lê texto de elemento. */
    const zerada = num === 0;
    return `<div class="stat-box${destaque?' stat-destaque':''}${alerta && num>0?' stat-alerta':''}${clicavel?' stat-clicavel':''}${ativo?' stat-ativo':''}${zerada?' stat-zerada':''}"
       ${cor ? `style="--st-cor:var(--st-${cor}-bg)"` : ''}
       ${clicavel ? `onclick="filtrarTorrePorStatus('${escJs(filtro)}')" role="button" tabindex="0" aria-pressed="${ativo ? 'true' : 'false'}"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}"` : ''}
       ${titulo ? `title="${esc(titulo)}"` : ''}>
       <div class="stat-num" data-contador="${esc(rotulo)}">${num}</div>
       <div class="stat-label">${esc(rotulo)}</div>
       ${pct}${delta}
       ${nota ? `<div class="stat-note">${esc(nota)}</div>` : ''}
       ${linha}
     </div>`;
  };

  document.getElementById('torre-stats').innerHTML =
    // "Paradas há mais de Xh" foi removida a pedido do usuário
    // (08/08/2026): ícone considerado inútil na Torre.
    caixa(abertas.length, 'Cargas em aberto', {
      destaque:true, filtro:'__TODAS__', spark:serie.abertas,
      deltaDe:[serie.abertas[13], serie.abertas[12]], pioraQuandoSobe:true})
    + statusVisiveis.map(s=>caixa(porStatus[s]||0, s,
        {filtro:s, cor:statusSlug(s), participacao:true})).join('')
    + caixa(seguiuViagemHojeCount, 'Seguiu Viagem hoje', {
      destaque:true, filtro:'__SEGUIU_HOJE__', cor:'seguiu-viagem', spark:serie.seguiu,
      deltaDe:[serie.seguiu[13], serie.seguiu[12]], pioraQuandoSobe:false})
    + caixa(antigasCount, 'Programação anterior',
            {alerta:true, nota:'ainda em aberto de outros dias',
             filtro:'__PENDENTES_ANTIGAS__'})
    + caixa(aguardandoCargaCount, 'Entradas sem carga',
            {nota:'resolver na Programação', filtro:'__IR_PROGRAMACAO__'});
  animarContadoresTorre();

  // A tabela mostra as cargas do filtro clicado — ou as em aberto de
  // sempre, sem filtro nenhum. Os NÚMEROS das caixas acima nunca mudam
  // com o clique (continuam contando o total real de cada status); só a
  // lista abaixo é que aponta pras cargas daquele status específico.
  let lista;
  if(_torreFiltroStatus === '__SEGUIU_HOJE__'){
    lista = DB.cargas.filter(c=>{
      if(c.status !== 'Seguiu Viagem') return false;
      const saida = primeiroTimestamp(c.id, 'Seguiu Viagem');
      return saida && new Date(saida) >= hoje;
    });
  } else if(_torreFiltroStatus === '__PENDENTES_ANTIGAS__'){
    lista = abertas.filter(ehProgramacaoAntiga);
  } else if(_torreFiltroStatus){
    lista = abertas.filter(c=>c.status === _torreFiltroStatus);
  } else {
    lista = abertas;
  }
  /* Hoje primeiro, sobras depois — e cada bloco na ordem de sempre
     (sequência, depois última movimentação). É o que separa o joio do
     trigo sem esconder nem o joio nem o trigo. */
  lista = lista.slice().sort((a,b)=>{
    const ga = ehProgramacaoAntiga(a) ? 1 : 0;
    const gb = ehProgramacaoAntiga(b) ? 1 : 0;
    if(ga !== gb) return ga - gb;
    if(ga === 1){
      const da = diasDesdeProgramacao(a), db = diasDesdeProgramacao(b);
      if(da !== db) return da - db;   // ontem antes de anteontem
    }
    return ordenarPorSequenciaEAtualizacao(a,b);
  });
  /* Com o cursor num campo da Torre, a ordem que a pessoa está vendo não
     muda por baixo dela — ver "A TORRE DESLIZA" no bloco MOVIMENTO. */
  lista = movSegurarOrdemEmEdicao(document.getElementById('torre-tbody'), lista);

  const thead = document.getElementById('torre-thead');
  if(thead){
    thead.innerHTML =
      /* 15 colunas não cabiam: a tabela media 1870px numa área de 1162px,
         e o operador tinha que rolar pro lado pra ver status e botões —
         justamente o que ele precisa pra agir. Pedido do usuário
         (11/08/2026): "otimize para que tudo apareca por completo sem
         precisar de rolagem".

         Nada foi removido: colunas que descrevem A MESMA coisa foram
         empilhadas numa célula só. Veículo reúne placa, transportadora e
         tipo (são o caminhão); Datas reúne quando foi programada e quando
         mexeram nela pela última vez. 15 colunas viram 11. */
      '<th>Seq.</th><th>Nº Carga</th><th>Veículo</th>'
      + '<th>Motorista</th><th>Rota</th><th>Peso (kg)</th>'
      + '<th>Palet.</th><th>Tipo de Operação</th><th title="Ganchos e quantidade de entregas">Ganchos · Entr.</th><th>Status</th>'
      + '<th title="Quando a carga foi programada e a última mudança de etapa — o mesmo horário que o Histórico mostra">Programação · Última etapa</th>'
      + (podeCancelarCarga() ? '<th class="no-print">Ação</th>' : '');
  }

  const tbody = document.getElementById('torre-tbody');
  // Torre editável (pedido direto do usuário, 08/08/2026): "eu quero
  // conseguir excluir ou alterar qualquer coisa direto da torre de
  // controle como administrador ou logistica". Reaproveita EXATAMENTE as
  // mesmas funções já testadas da Fila de Programados (atualizarXUI) —
  // não é lógica nova, é o mesmo campo editável aparecendo num segundo
  // lugar. Só quem já podia cancelar/excluir (Logística/Administração)
  // ganha os campos editáveis; os demais setores continuam com texto.
  const editavel = podeCancelarCarga();
  /* A FAIXA QUE SEPARA OS DOIS DIAS.

     Uma tabela só (não duas): a Torre é impressa, filtrada e ordenada como
     um bloco, e partir o HTML em duas tabelas duplicaria cabeçalho, ações e
     estado vazio. A faixa cumpre o mesmo papel na leitura e some sozinha
     quando não há sobra nenhuma. */
  const colunasTorre = editavel ? 12 : 11;
  const antigasNaLista = lista.filter(ehProgramacaoAntiga).length;
  const idPrimeiraAntiga = antigasNaLista && _torreFiltroStatus !== '__PENDENTES_ANTIGAS__'
    ? lista.find(ehProgramacaoAntiga).id : null;
  const faixa = (c)=> c.id === idPrimeiraAntiga
    ? `<tr class="torre-sep"><td colspan="${colunasTorre}">`
      + `⏳ Programação anterior — ${antigasNaLista} carga(s) que ainda não seguiram viagem. `
      + `<span class="torre-sep-nota">Ficam aqui até serem concluídas; não entram na programação de hoje.</span>`
      /* O botão nasce AQUI, colado na faixa, e não num canto do cabeçalho:
         quem decide encerrar está olhando exatamente estas linhas, e o
         número no botão é o mesmo número da faixa. */
      + (editavel
        ? ` <button class="btn btn-sec btn-sm no-print" onclick="encerrarProgramacaoAnteriorUI()"
              title="Fecha estas cargas de dias anteriores (leva cada uma a Seguiu Viagem, com motivo registrado) para a Torre ficar só com a programação de hoje."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-limpar"/></svg>Encerrar as ${antigasNaLista}</button>`
        : '')
      + `</td></tr>`
    : '';
  const _posAntes = movFlipAntes(tbody);
  tbody.innerHTML = lista.map(c=>`
    ${faixa(c)}
    <tr class="${ehProgramacaoAntiga(c) ? 'linha-prog-antiga' : ''}" data-carga="${esc(c.id)}"
        ${editavel && aindaVaiCarregar(c) ? `draggable="true"
        ondragstart="filaArrastarInicio(event,'${escJs(c.id)}')"
        ondragover="filaArrastarSobre(event)"
        ondrop="filaArrastarSolta(event,'${escJs(c.id)}')"
        ondragend="filaArrastarFim(event)"` : ''}>
      <td class="cel-seq">${editavel
        ? `${aindaVaiCarregar(c) ? `<span class="alca-arrastar" title="Arraste para mudar a posição na fila">⠿</span>` : ''}<input type="text" inputmode="numeric" class="seq-input" value="${c.sequencia ?? ''}" onchange="definirSequenciaTorreUI('${escJs(c.id)}',this.value)" title="${aindaVaiCarregar(c) ? 'Digite a posição: a carga entra nela e as outras descem uma casa.' : 'Este caminhão já carregou — o número é registro do que aconteceu e NÃO reordena a fila.'}">`
        : (c.sequencia ?? '—')}</td>
      <td class="col-identificacao">${editavel
        ? `<input type="text" class="numero-carga-input" value="${esc(c.numeroCarga)}" onchange="atualizarNumeroCargaUI('${escJs(c.id)}',this.value)" title="Alterar o número desta carga.">`
        : (esc(c.numeroCarga)||'—')}${/* "frete a definir" embaixo do número: a célula tem só um campo e sobra
           altura, então a linha não cresce (na célula do veículo ele cortava ou
           deixava a Torre compactada mais alta — portão 49) */''}${seloFreteHtml(c)}</td>
      <td class="col-identificacao cel-veiculo">${editavel
        ? `<input type="text" class="placa-input" value="${esc(c.placa)}" onchange="atualizarPlacaUI('${escJs(c.id)}',this.value)" title="Trocar a placa.">`
        : `<span class="veic-placa">${esc(c.placa)}</span>`}
        <span class="veic-transp">${esc(c.transportadora)||'—'}</span>${marcaTransportadoraHtml(c)}
        <span class="veic-tipo">${esc(c.tipoVeiculo)||'—'}</span>
        ${chipNoPatioHtml(c)}${chipLacreHtml(c)}</td>
      <td>${editavel
        ? `<input type="text" class="motorista-input" value="${esc(c.motorista||'')}" onchange="atualizarMotoristaUI('${escJs(c.id)}',this.value)" title="Trocar o motorista desta carga.">`
        : (esc(c.motorista)||'—')}</td>
      ${/* A CIDADE EMBAIXO DA ROTA, NA MESMA CÉLULA (21/09/2026).

             Pedido do dono: "na torre de controle precisa aparecer o destino
             também de cada carga, ao invés de sair alto paranaiba por
             exemplo, que saia a cidade exata que a carga esta indo".

             Empilhado, e não coluna nova: a Torre já teve 15 colunas medindo
             1870px numa área de 1162px, e a redução para 11 foi pedido dele
             ("otimize para que tudo apareca por completo sem precisar de
             rolagem"). Uma 12ª coluna desfaria aquilo. Mesmo padrão da
             célula de Veículo, onde a placa manda e o resto fica de apoio.

             Carga sem destino não ganha linha nenhuma: linha vazia em metade
             da Torre é ruído, e a ausência já diz o que precisa dizer. */''
      }<td>${editavel ? rotaSelectHtml(c) : esc(rotaCurta(c.rota))}${
        destinoDaCarga(c)
          ? `<span class="rota-destino">${esc(destinoDaCarga(c))}</span>` : ''
      }</td>
      <td class="c-peso">${editavel
        ? `<input type="text" inputmode="numeric" class="peso-input" min="0" step="1" value="${c.peso ?? ''}" onchange="atualizarPesoUI('${escJs(c.id)}',this.value)" title="Peso em kg.">`
        : (c.peso ? c.peso.toLocaleString('pt-BR') : '—')}</td>
      <td>${editavel ? paletizadaSelectHtml(c) : paletizadaDaCarga(c)}</td>
      <td>${editavel ? praOndeSelectHtml(c)
        : (c.praOnde ? `<span class="chip-praonde">${esc(PRA_ONDE_LABEL[c.praOnde]||c.praOnde)}</span>` : '<span class="text-dim">—</span>')}</td>
      <td class="cel-gan-ent">${editavel
        /* Entregas na Torre — pedido do gestor (18/08/2026): era o único
           campo da carga sem edição aqui. Empilhado com Ganchos de
           propósito: coluna nova alargaria a tabela e traria de volta a
           rolagem lateral que foi eliminada em 11/08. */
        ? `<input type="text" inputmode="numeric" class="ganchos-input" min="0" step="1" value="${c.qtdGanchos ?? 0}" onchange="atualizarGanchosUI('${escJs(c.id)}',this.value)" title="Ganchos — 0 = Liso">
           <input type="text" inputmode="numeric" class="entregas-input" min="0" step="1" value="${c.qtdEntregas ?? 1}" onchange="atualizarEntregasUI('${escJs(c.id)}',this.value)" title="Quantidade de entregas.">`
        : `${c.qtdGanchos ? c.qtdGanchos : '<span class="text-dim">Liso</span>'} · <span title="Entregas">${c.qtdEntregas ?? 1}</span>`}</td>
      <td>${badgeHtml(c.status)}${situacaoPlacaHtml(c)}</td>
      <td class="cel-datas">
        <span class="dt-prog">${dataProgramacaoHtml(c)}</span>
        ${ultimaAcaoHtml(c)}</td>
      ${editavel ? `<td class="no-print">${botaoOutraCargaHtml(c)}${botaoRevisoesHtml(c)}${botaoCancelarHtml(c)}</td>` : ''}
    </tr>`).join('');
  movLinhasNovas(tbody);
  movFlipDepois(tbody, _posAntes, lista);
  const vazio = document.getElementById('torre-empty');
  vazio.hidden = lista.length>0;
  if(!vazio.hidden){
    vazio.innerHTML = _torreFiltroStatus === '__PENDENTES_ANTIGAS__'
      ? 'Nenhuma pendência de programações anteriores — o pátio está só com a programação de hoje.'
        + '<span class="empty-acao"><button class="btn btn-sec btn-sm" onclick="filtrarTorrePorStatus(\'__TODAS__\')">Ver todas em aberto</button></span>'
      : _torreFiltroStatus
      ? 'Nenhuma carga com esse status agora.'
        + '<span class="empty-acao"><button class="btn btn-sec btn-sm" onclick="filtrarTorrePorStatus(\'__TODAS__\')">Ver todas em aberto</button></span>'
      : 'Nenhuma carga em aberto no momento.';
  }
  renderTorreInativas();
}
/* O BLOCO DAS INATIVAS (decisão 29, 07/10/2026). Nasce recolhido e diz
   quantas são; aberto, lista cada uma com a última movimentação e há
   quantos dias está parada. Inclui as sem placa e as entradas sem carga:
   tudo que saiu da conta aparece em algum lugar. A ação (dar saída ou
   registrar a movimentação) continua nos lugares de sempre. */
function renderTorreInativas(){
  const el = document.getElementById('torre-inativas');
  if(!el) return;
  const lista = cargasInativas().slice().sort((a, b) => referenciaDeAtividade(a) - referenciaDeAtividade(b));
  el.hidden = lista.length === 0;
  if(!lista.length){ el.innerHTML = ''; return; }
  const aberto = el.open;
  const dias = (c) => Math.floor((Date.now() - referenciaDeAtividade(c)) / 86400000);
  el.innerHTML = `<summary>Inativos (mais de ${DIAS_PARA_INATIVA} dias) — ${lista.length} carga${lista.length === 1 ? '' : 's'} fora da fila e dos indicadores</summary>`
    + '<p class="torre-inativas-nota">Sem nenhuma movimentação há mais de ' + DIAS_PARA_INATIVA + ' dias. Continuam no Histórico; voltam para a fila sozinhas na próxima movimentação. Para encerrar, dê a saída ou arrume o registro.</p>'
    + '<div class="table-wrap"><table class="torre-inativas-tab"><thead><tr><th>Nº Carga</th><th>Placa</th><th>Status</th><th>Última movimentação</th><th>Parada há</th></tr></thead><tbody>'
    + lista.map(c => {
        const ult = ultimaMovimentacaoDaCarga(c.id);
        return `<tr><td>${esc(c.numeroCarga || c.id)}</td><td>${esc(c.placa || '—')}</td>`
          + `<td>${esc(c.aguardandoCarga ? 'Entrada sem carga' : c.status)}</td>`
          + `<td>${ult ? esc(fmtDataHora(ult.timestamp)) : 'nenhuma'}</td><td>${dias(c)} dias</td></tr>`;
      }).join('')
    + '</tbody></table></div>';
  el.open = aberto;
}
/* UMA LINHA DA FILA — usada pela fila do dia e pelo bloco de dias
   anteriores. `arrastavel` decide alça e arrasto: a sequência é do dia de
   cada carga, então só a fila do dia escolhido reordena por arrasto. No
   bloco de anteriores a alça vira a DATA da programação (clicável: leva a
   fila para aquele dia). */
function linhaFilaHtml(c, lista, arrastavel){
    const id = escJs(c.id);
    const aberta = _progFilaAberta === c.id;
    const linha = `
    <tr class="prog-linha${aberta ? ' prog-linha-aberta cartao-aberto' : ''}" data-carga="${esc(c.id)}"
        ${arrastavel ? `draggable="true"
        ondragstart="filaArrastarInicio(event,'${id}')"
        ondragover="filaArrastarSobre(event)"
        ondrop="filaArrastarSolta(event,'${id}')"
        ondragend="filaArrastarFim(event)"` : `draggable="false"`}
        onclick="alternarLinhaProgFilaUI('${id}')"
        title="Clique para abrir os demais campos. Arraste para mudar a ordem de carregamento.">
      <td onclick="event.stopPropagation()" class="cel-seq">
        ${arrastavel ? `<span class="alca-arrastar" title="Arraste para mudar a posição na fila">⠿</span>` : `<span class="chip-dia-prog" title="Programada em ${esc(fmtData(c.programadoEm || c.criadoEm))}" onclick="event.stopPropagation(); mudarDiaFilaUI('${esc(isoDiaLocal(new Date(c.programadoEm || c.criadoEm)))}')">${esc(fmtData(c.programadoEm || c.criadoEm).slice(0,5))}</span>`}
        <input type="text" inputmode="numeric" min="1" class="seq-input" value="${c.sequencia ?? ''}" onchange="definirPosicaoNaFilaUI('${id}',this.value)" title="Digite a posição: a carga entra nela e as outras descem uma casa."></td>
      <td class="col-identificacao" onclick="event.stopPropagation()">
        <input type="text" class="numero-carga-input" value="${esc(c.numeroCarga)}" onchange="atualizarNumeroCargaUI('${id}',this.value)" title="Alterar o número desta carga.">
      </td>
      <td class="col-identificacao cel-veiculo" onclick="event.stopPropagation()">
        <input type="text" class="placa-input" value="${esc(c.placa)}" onchange="atualizarPlacaUI('${id}',this.value)" title="Trocar a placa — a transportadora e o tipo de veículo são buscados na Frota automaticamente.">
        <span class="veic-transp" id="transp-${esc(c.id)}">${esc(c.transportadora)||'—'}</span>${marcaTransportadoraHtml(c)}
        <span class="veic-tipo">${esc(c.tipoVeiculo)||'—'}</span>
        ${marcaCargaDaPlaca(c, lista)}${chipNoPatioHtml(c)}${marcaEtapaDevolvidaHtml(c)}${marcaSaiuSemCarregarHtml(c)}</td>
      <td onclick="event.stopPropagation()">
        <input type="text" class="motorista-input" value="${esc(c.motorista||'')}" onchange="atualizarMotoristaUI('${id}',this.value)" title="Quem dirige ESTA viagem — não mexe no cadastro da placa."></td>
      <td onclick="event.stopPropagation()">${rotaSelectHtml(c)}</td>
      <td class="c-peso" onclick="event.stopPropagation()"><input type="text" inputmode="numeric" class="peso-input" min="0" step="1" value="${c.peso ?? ''}" onchange="atualizarPesoUI('${id}',this.value)" title="Peso em kg."></td>
      <td onclick="event.stopPropagation()">${paletizadaSelectHtml(c)}</td>
      <td onclick="event.stopPropagation()">${praOndeSelectHtml(c)}</td>
      <td class="no-print gap8" onclick="event.stopPropagation()">
        <button class="btn btn-sec btn-sm" onclick="adicionarOutraCargaNaPlacaUI('${id}')"
                title="Programar OUTRA carga para este mesmo caminhão — o formulário já vem com placa, transportadora, motorista e rota preenchidos."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-mais"/></svg>Outra carga</button>
        <button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${id}')">Excluir</button>
        <span class="mont-seta${aberta ? ' aberta' : ''}" aria-hidden="true">▸</span>
      </td>
    </tr>`;
    return aberta ? linha + `<tr class="prog-detalhe"><td colspan="9">${formCargaFilaHtml(c)}</td></tr>` : linha;
}

/* O dia que a Fila mostra. null = hoje (não guarda a data de hoje para não
   envelhecer: quem deixa a aba aberta de madrugada vê o dia virar). */
let _progFilaDia = null;
function isoDiaLocal(d){ return diaLocalISO(d); }   // a conta mora em data.js (#100)
function diaFilaSelecionado(){ return _progFilaDia || isoDiaLocal(new Date()); }
function mudarDiaFilaUI(v){
  if(v === 'hoje' || v === '' || v === null || v === undefined){ _progFilaDia = null; }
  else if(typeof v === 'number'){
    const [a,m,d] = diaFilaSelecionado().split('-').map(Number);
    const dt = new Date(a, m-1, d + v);
    const iso = isoDiaLocal(dt);
    _progFilaDia = iso === isoDiaLocal(new Date()) ? null : iso;
  } else if(/^\d{4}-\d{2}-\d{2}$/.test(String(v))){
    _progFilaDia = String(v) === isoDiaLocal(new Date()) ? null : String(v);
  }
  renderAll();
}
function ordenarPorSequenciaEAtualizacao(a,b){
  const sa = (a.sequencia===null||a.sequencia===undefined) ? Infinity : a.sequencia;
  const sb = (b.sequencia===null||b.sequencia===undefined) ? Infinity : b.sequencia;
  if(sa!==sb) return sa-sb;
  return new Date(a.atualizadoEm) - new Date(b.atualizadoEm);
}

/* Ordenação do RELATÓRIO OPERACIONAL: primeiro pela etapa da carga na linha
   do tempo dos 6 status, depois pela sequência de carregamento.

   Antes ordenava só por sequência, e o resultado embaralhava as etapas — uma
   carga que já "Seguiu Viagem" aparecia acima de outra ainda "Faturado" ou
   "Carregado" só por ter sequência menor. Como este relatório é acompanhado
   ao longo do dia inteiro, o que importa na leitura de relance é onde cada
   carga está no processo.

   A ordem segue a própria linha do tempo: o que ainda não chegou fica no
   topo, o que já saiu fica no fim. Assim a parte que ainda exige ação está
   sempre na parte de cima da folha. */
/* Ordem do Relatório Operacional: a SEQUÊNCIA DE CARREGAMENTO manda.

   Pedido do gestor (15/08/2026), com a planilha dele na mão: "o relatório
   operacional precisa seguir a sequência de carga colocada no painel".

   Antes a folha era ordenada pela etapa do processo (todos os "Aguardando
   Embarque" juntos, depois os "Faturado"...) e a sequência só desempatava
   dentro de cada etapa. Isso faz sentido para acompanhar o andamento, mas
   não para MONTAR a fila: quem está no pátio precisa da ordem 1, 2, 3, e
   com a ordenação por etapa a carga 3 podia aparecer dez linhas abaixo da
   30 só porque avançou de status antes.

   O status continua na folha, com a cor — o que muda é só a ordem das
   linhas, que passa a ser a mesma da tela e a mesma da planilha que a
   operação já usava.

   Sem sequência preenchida vai para o fim: é carga que ainda não entrou na
   fila, e jogá-la para o meio empurraria a numeração de quem já está. */
function ordenarPorSequenciaDeCarregamento(a, b){
  const sa = (a.sequencia === null || a.sequencia === undefined || a.sequencia === '')
    ? Infinity : Number(a.sequencia);
  const sb = (b.sequencia === null || b.sequencia === undefined || b.sequencia === '')
    ? Infinity : Number(b.sequencia);
  if(sa !== sb) return sa - sb;
  // Empate real (duas cargas com a mesma sequência digitada): mantém a
  // ordem estável pelo número da carga, para a folha não trocar de ordem a
  // cada geração e confundir quem compara duas impressões.
  return String(a.numeroCarga || '').localeCompare(
    String(b.numeroCarga || ''), 'pt-BR', {numeric: true});
}

/* Fila de cada setor: primeiro o que espera a AÇÃO daquele setor.

   Pedido do usuário (12/08/2026): "no painel de cada setor, na fila...
   eu quero que fique organizado e apareca nas primeiras linhas de cima
   pra baixo as cargas que foram faturadas, e nao fique desorganizado e
   baguncado... para a expedicao tambem, e para o faturamento tambem".

   O princípio por trás dos três casos é o mesmo: quem abre a tela quer
   ver primeiro o que DEPENDE DELE agora. A Portaria libera quem já foi
   faturado; a Expedição carrega quem já chegou; o Faturamento fatura quem
   já terminou de embarcar. Tudo isso ficava misturado com carga que ainda
   não é da vez — e no Faturamento nem ordenação existia: saía na ordem
   bruta do array, que muda a cada sincronia.

   Dentro de cada grupo a ordem continua sendo a sequência de
   carregamento, que é a regra que a Logística define. */
const ACAO_DO_SETOR = {
  /* A Portaria age nas duas pontas do fluxo. "Faturado" vem primeiro por
     pedido explícito: é o caminhão pronto pra sair, ocupando pátio. */
  'Portaria':    ['Faturado', 'Aguardando Veículo'],
  /* Expedição: o que chegou e espera doca, depois o que já está na doca
     e precisa ser fechado. */
  'Expedição':   ['Aguardando Embarque', 'Embarque Iniciado'],
  'Faturamento': ['Embarque Finalizado'],
};

function ordenarPorAcaoDoSetor(setor){
  const prioridade = ACAO_DO_SETOR[setor] || [];
  return (a, b) => {
    // Quem não está na lista de ação do setor vai para depois de todos os
    // que estão — sem sumir da tela: continua consultável abaixo.
    const pa = prioridade.indexOf(a.status);
    const pb = prioridade.indexOf(b.status);
    const ra = pa === -1 ? prioridade.length : pa;
    const rb = pb === -1 ? prioridade.length : pb;
    if(ra !== rb) return ra - rb;
    return ordenarPorSequenciaEAtualizacao(a, b);
  };
}

