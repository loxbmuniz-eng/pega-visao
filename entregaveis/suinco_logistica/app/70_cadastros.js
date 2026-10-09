/* ---------- CADASTROS ---------- */
function renderCadastros(){
  renderFrotaTabela();
  renderTranspLista();
  const cardRota = document.getElementById('card-cadastrar-rota');
  if(cardRota){
    cardRota.hidden = !(DB.operador && DB.operador.setor === 'Administração');
    if(!cardRota.hidden) renderRotasCadastro();
  }
  /* Tabela de frete: Logística e Administração. A tela esconde, e o
     servidor recusa — as duas coisas, porque esconder sozinho é decoração:
     o dado ainda viajaria até o navegador de quem não pode vê-lo. */
  const cardFrete = document.getElementById('card-tabela-frete');
  if(cardFrete){
    cardFrete.hidden = !(DB.operador && podeVerValorDeFreteUI(DB.operador.setor));
    if(!cardFrete.hidden) renderTabelaDeFrete();
  }
}

/* Gêmea de podeVerValorDeFrete() em backend/src/dominio/fluxo.js.
   Duplicada porque o painel é build de arquivo único e não fala com o
   servidor em tempo de código — a mesma razão pela qual SETOR_PERMISSOES
   existe dos dois lados, e o teste testes/test_frete_tabela_e_planilha.py
   compara as duas listas. */
function podeVerValorDeFreteUI(setor){
  return setor === 'Logística' || setor === 'Administração';
}
/* =====================================================================
   TABELA DE FRETE — a tela do cadastro (09/09/2026)
   =====================================================================
   Espelha o cadastro de Rota de propósito: mesmo card, mesmo par
   "formulário em cima, tabela embaixo", mesmo botão de CSV. O dono pediu
   assim — "cadastro possa ser editavel e criada da mesma forma que
   funcionam os cadastros" — e a razão é boa: quem já cadastrou uma rota
   sabe cadastrar uma tarifa sem ninguém explicar.

   NÃO GRAVA OFFLINE, e isso é diferente da Frota. Tabela de preço não é
   operação de pátio: ninguém está com o caminhão parado esperando por ela,
   e uma tarifa subindo horas depois pela fila poderia passar por cima de
   uma correção feita no meio. Sem conexão, avisa e não grava. */
function renderTabelaDeFrete(){
  const tb = document.getElementById('frete-tarifas-tbody');
  if(tb){
    tb.innerHTML = TARIFAS_FRETE.slice()
      .sort((a,b)=> Number(a.valorPorKm) - Number(b.valorPorKm))
      .map(t=>`<tr>
        <td>${esc(t.tipoVeiculo)}</td>
        <td class="num">${fmtDinheiro(t.valorPorKm)}</td>
        <td>${t.vigenteDesde ? esc(dataCurtaLocal(t.vigenteDesde)) : '—'}</td>
        <td>${esc(t.operador)||'—'}</td></tr>`).join('');
    const vazio = document.getElementById('frete-tarifas-empty');
    if(vazio) vazio.hidden = TARIFAS_FRETE.length > 0;
  }

  const td = document.getElementById('frete-destinos-tbody');
  if(td){
    const busca = (document.getElementById('frete-destino-busca')||{}).value || '';
    const filtro = busca.trim().toUpperCase();
    const lista = DESTINOS_FRETE
      .filter(d => !filtro || String(d.destino).toUpperCase().includes(filtro))
      .sort((a,b)=> String(a.destino).localeCompare(String(b.destino), 'pt-BR'));
    td.innerHTML = lista.map(d=>`<tr>
        <td>${esc(d.destino)}</td>
        <td class="num">${Number(d.km).toLocaleString('pt-BR')} km</td>
        <td>${esc(d.operador)||'—'}</td>
        <td class="no-print"><button class="btn btn-sec btn-xs"
          onclick="editarDestinoFreteUI(${JSON.stringify(String(d.destino)).replace(/"/g,'&quot;')})"
          title="Traz este destino para o formulário acima"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-lapis"/></svg>Editar</button></td></tr>`).join('');
    const vazio = document.getElementById('frete-destinos-empty');
    if(vazio) vazio.hidden = lista.length > 0;
    const cont = document.getElementById('frete-destinos-contagem');
    if(cont) cont.textContent = filtro
      ? `${lista.length} de ${DESTINOS_FRETE.length} destinos`
      : `${DESTINOS_FRETE.length} destinos`;
  }
}

/* Dinheiro em português, com duas casas — e SEM inventar zero.
   Tarifa ausente é "—", não "R$ 0,00": preço zero é uma afirmação, e
   afirmar de graça o que ninguém digitou é como o relatório passa a
   mentir. */
function fmtDinheiro(v){
  if(v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if(!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', {style:'currency', currency:'BRL', minimumFractionDigits:2});
}

function editarDestinoFreteUI(destino){
  const d = DESTINOS_FRETE.find(x => String(x.destino) === String(destino));
  if(!d) return;
  document.getElementById('frete-destino-nome').value = d.destino;
  document.getElementById('frete-destino-km').value = kmTexto(d.km);
  document.getElementById('frete-destino-nome').focus();
}

async function addTarifaFreteUI(){
  const tipo = document.getElementById('frete-tarifa-tipo').value.trim();
  const bruto = document.getElementById('frete-tarifa-valor').value;
  if(!tipo){ notify('Informe o tipo de veículo.', 'warn'); return; }
  /* Campo em branco NÃO é zero. `Number('')` é 0, e cadastrar tarifa zero
     sem querer é frete de graça gravado em silêncio para toda uma
     modalidade. */
  /* COM VÍRGULA (28/09/2026). Até aqui era `Number(bruto)`, e
     `Number('11,66')` não é número: a tarifa digitada como o próprio campo
     ensina ("ex.: 7,75") era recusada. `valorDigitado` (data.js) é a
     leitura de dinheiro do painel — vírgula decimal, ponto de milhar
     quando há vírgula. Ocorrência #91. */
  const valorPorKm = valorDigitado(bruto);
  if(valorPorKm === null || valorPorKm < 0){
    notify('Informe o valor por km (ex.: 7,75).', 'warn'); return;
  }
  /* O BOTÃO CONTA O QUE ESTÁ FAZENDO. Gravar tarifa é ida ao servidor: sem
     isso o botão fica mudo entre o clique e a resposta, e quem não vê nada
     acontecer clica de novo. "✓ Salvo" só aparece depois que a resposta
     chegou — quem decide é a transação, não a tela. */
  const r = await contarNoBotao(_movBotaoDaAcao('addTarifaFreteUI'),
    { fazendo: 'Salvando…', feito: '✓ Salvo' },
    () => SuincoSharePoint.gravarTarifaFrete({
      tipoVeiculo: tipo,
      valorPorKm,
      vigenteDesde: document.getElementById('frete-tarifa-vigencia').value || undefined,
      operador: (DB.operador && DB.operador.nome) || '',
    }));
  if(r && (r.recusado || r.enfileirado)){
    notify(`A tarifa de ${tipo} NÃO foi salva: ${r.erro || 'sem conexão com o servidor'}. `
      + 'Tabela de preço não fica em fila — tente de novo quando a conexão voltar.', 'erro', 9000);
    return;
  }
  ['frete-tarifa-tipo','frete-tarifa-valor','frete-tarifa-vigencia'].forEach(id=>document.getElementById(id).value='');
  await recarregarTabelaDeFrete();
  notifyGravacao(`Tarifa de ${tipo}: ${fmtDinheiro(bruto)} por km.`);
}

async function addDestinoFreteUI(){
  const destino = document.getElementById('frete-destino-nome').value.trim().toUpperCase();
  const km = kmValidoLocal(document.getElementById('frete-destino-km').value);
  if(!destino){ notify('Informe o destino.', 'warn'); return; }
  if(km === null){ notify('Informe o KM do destino (maior que zero).', 'warn'); return; }
  const r = await contarNoBotao(_movBotaoDaAcao('addDestinoFreteUI'),
    { fazendo: 'Salvando…', feito: '✓ Salvo' },
    () => SuincoSharePoint.gravarDestinoFrete({
      destino, km, operador: (DB.operador && DB.operador.nome) || '',
    }));
  if(r && (r.recusado || r.enfileirado)){
    notify(`O destino ${destino} NÃO foi salvo: ${r.erro || 'sem conexão com o servidor'}.`, 'erro', 9000);
    return;
  }
  ['frete-destino-nome','frete-destino-km'].forEach(id=>document.getElementById(id).value='');
  await recarregarTabelaDeFrete();
  /* A MENSAGEM DIZ O QUE O SERVIDOR GRAVOU, não o que foi digitado
     (29/09/2026). Servidor sem a migração 056 corta as casas decimais:
     "123,45" vira 123, e a tela dizia 123,45. Recusa nunca é silenciosa —
     corte também não. */
  const kmGravado = (r && r.item && r.item.km !== null && r.item.km !== undefined)
    ? Number(r.item.km) : km;
  if(kmGravado !== km){
    notify(`Destino ${destino}: ${kmTexto(kmGravado)} km. Você digitou ${kmTexto(km)} — o servidor `
      + `ainda grava sem as casas decimais (passam a valer com a atualização do servidor).`, 'warn', 12000);
    return;
  }
  notifyGravacao(`Destino ${destino}: ${kmTexto(kmGravado)} km.`);
}

/* Relê a tabela do servidor depois de gravar, em vez de mexer na lista
   local com o que acabou de ser digitado. É a regra da casa: quem manda é
   a transação, não a tela. Se o servidor normalizou o nome do destino ou
   recusou parte do que foi enviado, é a versão dele que aparece. */
async function recarregarTabelaDeFrete(){
  /* A TABELA, E SÓ A TABELA.

     Isto chamava pullTudo() — uma leitura COMPLETA do pátio — para reler
     cinco tarifas. Era o martelo errado: traz todas as cargas, a frota
     inteira e as rotas, de propósito nenhum, a cada tarifa salva. E
     requisição à toa custa caro aqui: o limite cai para o IP quando a
     chamada não tem token, e quatro terminais no mesmo IP já deram 429 na
     bateria (test_login_api). Agora pede a tabela, que é o que mudou. */
  try{
    const t = await SuincoSharePoint.tabelaDeFrete();
    if(t) receberTabelaDeFrete({tarifas: t.tarifas, destinos: t.destinos});
  }catch(e){ console.warn('[frete] recarga da tabela falhou:', e.message); }
  renderTabelaDeFrete();
  preencherSelectsDestinoFrete();
}

function exportarTabelaFreteCsv(){
  const linhas = [];
  TARIFAS_FRETE.forEach(t => linhas.push(['Tarifa', t.tipoVeiculo, '', String(t.valorPorKm).replace('.', ','), t.operador||'']));
  DESTINOS_FRETE.forEach(d => linhas.push(['Destino', '', d.destino, kmTexto(d.km), d.operador||'']));
  baixarCsvDoDia('Tabela_de_Frete',
    ['O quê', 'Tipo de veículo', 'Destino', 'Valor por km / KM', 'Quem cadastrou'], linhas,
    // Aqui o "3/4" é uma LINHA da tabela, não um caso de borda.
    ['O quê', 'Tipo de veículo', 'Destino', 'Quem cadastrou']);
}

/* Alimenta o <datalist> de destinos do formulário de carga. Chamado
   sempre que a tabela chega do servidor — mesmo padrão de
   preencherSelectsRota(), pelo mesmo motivo (painel de pátio fica aberto o
   dia inteiro e não pode ficar com a lista de ontem). */
/* A TABELA DE DESTINOS, NA ORDEM EM QUE A TELA MOSTRA. Uma função, dois
   chamadores (11/09/2026): o datalist da Programação e a célula da Montagem
   leem a mesma lista pela mesma ordenação. A Montagem tinha a própria
   leitura, e ela tratava os objetos {destino, km} como texto — a lista saía
   como "[object Object]" (ver test_lista_de_destino_na_montagem.py). */
function destinosFreteOrdenados(){
  const lista = (typeof DESTINOS_FRETE !== 'undefined' ? DESTINOS_FRETE : []);
  return lista.slice()
    .sort((a,b)=> String(a.destino).localeCompare(String(b.destino), 'pt-BR'));
}
function preencherSelectsDestinoFrete(){
  const dl = document.getElementById('lista-destinos-frete');
  if(!dl) return;
  dl.innerHTML = destinosFreteOrdenados()
    .map(d=>`<option value="${esc(d.destino)}">${Number(d.km).toLocaleString('pt-BR')} km</option>`).join('');
}

function renderRotasCadastro(){
  const tbody = document.getElementById('rotas-tbody');
  if(!tbody) return;
  /* A LISTA MOSTRA TUDO, inclusive a aposentada — e por isso não usa
     rotasParaEscolher(). Escondê-la aqui seria a pior das duas: ela
     continuaria existindo no banco, fora dos seletores, e ninguém
     descobriria que existe nem conseguiria trazê-la de volta. */
  const podeExcluir = podeExcluirRotaUI();
  /* O cabeçalho acompanha a coluna. Sem isto a tabela sai com quatro
     títulos e cinco células, e o navegador desalinha a linha inteira. */
  const th = document.getElementById('th-excluir-rota');
  if(th){ th.hidden = !podeExcluir; th.textContent = podeExcluir ? 'Excluir' : ''; }
  /* Praça repetida em dois códigos é o que o dono queria enxergar para
     limpar — 534 e 540 são as duas "Salvador". A marca não julga: só
     mostra que há duas, e deixa a decisão com quem conhece a operação. */
  const porNome = new Map();
  ROTAS.forEach(r => {
    const chave = (r.nome||'').trim().toLowerCase();
    if(!chave) return;
    porNome.set(chave, (porNome.get(chave) || 0) + 1);
  });
  tbody.innerHTML = ROTAS.slice()
    .sort((a,b)=> a.codigo.localeCompare(b.codigo, 'pt-BR', {numeric:true}))
    .map(r=>{
      const aposentada = r.ativa === false;
      const repetida = porNome.get((r.nome||'').trim().toLowerCase()) > 1;
      return `<tr${aposentada ? ' class="rota-aposentada"' : ''}>
        <td>${esc(r.codigo)}</td>
        <td>${esc(r.nome)||'—'}${repetida && !aposentada
            ? ' <span class="rota-chip-rep" title="Outra rota tem o mesmo nome — confira se uma das duas pode sair">praça repetida</span>' : ''}
          ${aposentada ? '<span class="rota-chip-apos" title="Fora dos seletores; continua nomeando os registros antigos">aposentada</span>' : ''}</td>
        <td>${esc(r.detalhe)||'—'}</td>
        <td>${esc(r.operador)||'—'}</td>
        ${podeExcluir ? `<td class="no-print">${aposentada
            ? '<span class="text-dim" title="Já está fora de circulação">—</span>'
            : `<button class="btn btn-danger btn-sm" onclick="excluirRotaUI('${escJs(r.codigo)}')"
                 title="Apaga se nunca foi usada; aposenta se já rodou">Excluir</button>`}</td>` : ''}
      </tr>`;
    })
    .join('');
}

/* Quem tira rota de circulação: a mesma mão que cadastra (o POST de rota já
   exige Logística) mais a Administração, irrestrita. Decisão do dono.
   Deixar criar numa mão e tirar noutra é como a lista cresce sem ninguém
   poder limpá-la. */
function podeExcluirRotaUI(){
  const setor = (DB.operador || {}).setor;
  return setor === 'Logística' || setor === 'Administração';
}

/* EXCLUIR PERGUNTA EXPLICANDO, E QUEM DECIDE O DESTINO É O SERVIDOR.

   Pedido do dono: "apagar o que tiver repetido, ou se aposentar uma rota e
   criar uma nova". São dois verbos, e qual deles vale depende do uso — que
   só o servidor sabe contar na hora. A tela avisa que pode ser um ou outro
   e mostra qual foi, em vez de prometer o que não controla. */
async function excluirRotaUI(codigo){
  const r = rotaInfo(codigo);
  const nome = r ? `${codigo} — ${r.nome}` : codigo;
  const ok = await perguntarUI({ titulo: `Excluir a rota ${nome}?`,
    texto: 'Se ela nunca foi usada em carga, devolução ou programação, é apagada de vez.\n\n'
      + 'Se já rodou, é APOSENTADA: sai dos seletores e ninguém mais a escolhe, '
      + 'mas continua nomeando as cargas antigas — senão elas viram um código sem praça.\n\n'
      + 'Quem decide qual dos dois é o servidor, contando o uso agora.',
    botao: 'Excluir', perigo: true });
  if(!ok) return;
  try {
    const resposta = await SuincoSharePoint.excluirRota(codigo);
    if(resposta && resposta.semServidor){
      notify('Sem servidor agora — excluir rota precisa dele para contar o uso. Tente de novo quando voltar.',
        'warn', 7000);
      return;
    }
    if(resposta && resposta.apagada) removerRotaLocal(codigo);
    else if(resposta && resposta.aposentada) upsertRota(codigo, r ? r.nome : '', r ? r.detalhe : '',
      r ? r.operador : '', { origem:'sharepoint', ativa:false, aposentadaEm: new Date().toISOString() });
    preencherSelectsRota();
    renderRotasCadastro();
    notifyGravacao((resposta && resposta.mensagem) || `Rota ${codigo} excluída.`);
  } catch(e){
    notify('Não excluiu: ' + (e.message || e), 'danger', 8000);
  }
}
async function addRotaUI(){
  const codigo = document.getElementById('rota-codigo').value.trim();
  const nome = document.getElementById('rota-nome').value.trim();
  if(!codigo){ notify('Informe o código da rota.', 'warn'); return; }
  if(!nome){ notify('Informe o nome da rota.', 'warn'); return; }
  const jaExistia = !!rotaInfo(codigo);
  const rotaCriada = upsertRota(codigo, nome, document.getElementById('rota-detalhe').value,
             document.getElementById('rota-operador').value);
  ['rota-codigo','rota-nome','rota-detalhe','rota-operador'].forEach(id=>document.getElementById(id).value='');
  preencherSelectsRota();   // dropdowns de Rota atualizados na hora
  /* notifyGravacao, não notify('success') — incidente de 14/08/2026: o
     gestor cadastrou a rota 537, viu "cadastrada" em verde, e ela não
     apareceu para o programador nem depois de sair e entrar de novo.

     A sincronização estava certa (reproduzido: quem loga do zero recebe a
     rota do servidor). O que enganava era o aviso: cadastrando sem
     conexão, a rota vai só para o localStorage e para a fila, e mesmo
     assim a tela dizia "cadastrada. Já aparece no seletor de Rota" — em
     verde, com cara de compartilhado. Quem cadastra vê a rota (verdade
     local) e conclui que está feito para todos.

     É exatamente o padrão do incidente das cargas, corrigido lá e que
     tinha ficado de fora aqui. Agora o aviso conta o estado real: verde só
     quando subiu; amarelo "SEM CONEXÃO … os outros setores ainda NÃO
     veem" quando ficou na fila. A recusa do servidor já tinha aviso
     próprio (receberRecusaDeRota) e continua valendo. */
  /* O AVISO ESPERA O SERVIDOR (31/08/2026).

     Ele era otimista: dizia "Rota X cadastrada" no mesmo instante do clique,
     e só depois — quando a resposta chegava — vinha o "NÃO foi cadastrada".
     Duas frases contrárias na mesma tela, e a pessoa lê a primeira.

     É o incidente da rota 537 (14/08) voltando por outra porta: naquele dia
     o problema era o verde prometendo compartilhamento que não existia.
     Agora não existe nem gravação: com a regra do dono, offline não grava.
     Então o aviso de sucesso só pode sair depois de o servidor confirmar —
     quem avisa o contrário é `receberRecusaDeRota`, que já tem frase própria
     para cada caso. */
  /* ESPERA A RESPOSTA ANTES DE DIZER QUE CADASTROU.

     Olhar o estado da conexão não bastava: no instante do clique ele ainda
     diz "online", porque só vira offline quando alguma requisição falha. O
     que decide é a resposta desta gravação, não o estado de antes dela. */
  /* O botão conta a espera que já existia: este `await` é justamente o que
     o comentário acima descreve — o painel para e escuta o servidor. Antes
     ele parava calado. */
  const r = await contarNoBotao(_movBotaoDaAcao('addRotaUI'),
    { fazendo: 'Salvando…', feito: '✓ Salvo' },
    () => (rotaCriada && rotaCriada._promessa
      ? rotaCriada._promessa.catch(() => ({ recusado: true }))
      : Promise.resolve(null)));
  if(r && r.recusado){
    // receberRecusaDeRota já falou — e com a frase certa para cada caso.
    renderAll();
    return;
  }
  notifyGravacao(jaExistia
    ? `Rota ${codigo} atualizada.`
    : `Rota ${codigo} — ${nome} cadastrada.`);
  renderAll();
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
  /* 300 já era alto demais pra navegar sem busca (ver comentário acima) —
     mas no CELULAR virou rolagem quase infinita depois que a tabela passou
     a sair em cartão de 2 colunas (08/08/2026): cada linha, que numa tabela
     comum ocupa ~40px, vira um cartão de ~250-300px. 300 cartões = a
     mesma altura de ~300 telas de celular empilhadas — medido: 98.676px de
     scroll numa Frota de 749 placas. Auditoria pedida pelo usuário
     ("refinamento em TODAS AS ABAS") depois de eu ter corrigido só a
     Torre/Indicadores. Mesmo limiar que ativa o cartão — perguntado a
     ehTelaEstreita(), para não haver dois números para a mesma decisão. */
  const LIMITE = ehTelaEstreita() ? 30 : 300;

  /* NO CELULAR A FROTA COMEÇA FECHADA, E A BUSCA É A PORTA (27/08/2026).

     Pedido do dono sobre o celular: "tem que rolar muito até chegar na
     parte que é interessante ver". Medido em 390px: a aba Cadastros tinha
     8.822px de rolagem — 10,5 telas — e a Frota sozinha era 7.465px
     disso, 85% da aba. Trinta cartões de veículo que ninguém lê.

     Quem abre a Frota no celular quer UM caminhão, e já sabe a placa. A
     lista completa não é resposta para essa pergunta; é o obstáculo até
     ela. Então sem busca não sai lista: sai o total e o convite para
     digitar. Com busca, sai o que casa, com o mesmo limite de sempre.

     No computador nada muda — lá a tabela cabe e serve para varrer.

     O filtro "só quem precisa de revisão" continua mostrando lista sem
     busca: ali a pergunta É a lista, e ela é curta. */
  const semBuscaNoCelular = ehTelaEstreita() && !buscaTexto && !soRevisao;
  const exibidos = semBuscaNoCelular ? [] : lista.slice(0, LIMITE);
  document.getElementById('frota-tbody').innerHTML = exibidos.map(f=>`
    <tr>
      <td>${esc(f.placa)}</td><td>${esc(f.transportadora)||'—'}</td><td>${esc(f.tipoVeiculo)||'—'}</td>
      <td>${f.capacidadeKg ? f.capacidadeKg.toLocaleString('pt-BR') : '—'}</td>
      <td>${esc(f.uf)||'—'}</td>
      <td>${f.dataUltimaMovimentacao ? new Date(f.dataUltimaMovimentacao+'T00:00:00').toLocaleDateString('pt-BR') : '—'}</td>
      <td>${f.precisaRevisao ? '<span class="badge badge-aguardando-veiculo">SIM</span>' : '<span class="text-dim">Não</span>'}</td>
      <td class="no-print"><button class="btn btn-danger btn-sm" onclick="removerFrotaUI('${escJs(f.placa)}')">Excluir</button></td>
    </tr>`).join('');
  document.getElementById('frota-empty').hidden = todos.length>0;
  const contagemEl = document.getElementById('frota-contagem');
  if(contagemEl){
    contagemEl.textContent = semBuscaNoCelular
      ? `${todos.length} placa(s) cadastrada(s). Digite a placa ou a transportadora acima para ver.`
      : (lista.length > LIMITE
        ? `Mostrando ${LIMITE} de ${lista.length} (de ${todos.length} no total) — refine a busca pra ver outras.`
        : `${lista.length} de ${todos.length} placa(s) cadastrada(s).`);
  }
}
function addFrotaUI(){
  const placa = document.getElementById('frota-placa').value;
  if(!normalizarPlaca(placa)){ notify('Informe a placa.','warn'); return; }
  upsertFrota(placa, document.getElementById('frota-transportadora').value, document.getElementById('frota-tipoveiculo').value, {
    capacidadeKg: document.getElementById('frota-capacidade').value,
    uf: document.getElementById('frota-uf').value,
    motorista: document.getElementById('frota-motorista').value,
    dataUltimaMovimentacao: document.getElementById('frota-ultima-mov').value,
    precisaRevisao: document.getElementById('frota-revisao').checked
  });
  ['frota-placa','frota-transportadora','frota-tipoveiculo','frota-motorista','frota-capacidade','frota-uf','frota-ultima-mov'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('frota-revisao').checked = false;
  notify('Placa cadastrada na Frota.', 'success');
  renderAll();
}
async function removerFrotaUI(placa){
  /* "Excluir", vermelho, como em todo o painel (08/10/2026, /impeccable
     Lote 5): o Cadastros tinha "Remover" (vermelho) e "Excluir" (neutro)
     para a mesma ação. */
  if(!(await perguntarUI({ titulo: `Excluir a placa ${placa} da Frota?`,
       texto: 'Ela sai da lista de placas que podem ser programadas.', botao: 'Excluir', perigo: true }))) return;
  removerFrota(placa);
  notify('Placa excluída.', 'success');
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
/* O QUADRO "TRANSPORTADORAS" MOSTRA AS DA FROTA (09/10/2026, #128; o dono
   escolheu "mostrar as da Frota"). Antes ele era uma lista solta de nomes,
   gravada só neste navegador: aceitava o nome, o Pagamento de Frete o
   oferecia, e o servidor — que só conhece a Frota — recusava. Transportadora
   nova entra cadastrando uma placa dela na Frota; o botão leva até lá. A
   busca não liga para acento nem maiúscula. */
function semAcentoMinusculo(s){
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function renderTranspLista(){
  const lista = transportadorasDaFrota();
  const busca = semAcentoMinusculo((document.getElementById('cad-transp-busca') || {}).value || '').trim();
  const vistas = busca ? lista.filter(t => semAcentoMinusculo(t.nome).includes(busca)) : lista;
  const conta = document.getElementById('cad-transp-conta');
  if(conta) conta.textContent = busca
    ? `${vistas.length} de ${lista.length} transportadoras da Frota`
    : `${lista.length} transportadora${lista.length === 1 ? '' : 's'} na Frota`;
  document.getElementById('cad-transp-lista').innerHTML = vistas.length ? vistas.map(t => `
    <div class="modal-list-item transp-item"><span>${esc(t.nome)}</span>
      <span class="transp-placas">${t.placas} placa${t.placas === 1 ? '' : 's'}</span></div>
  `).join('') : `<div class="empty-state">${busca
      ? 'Nenhuma placa da Frota é dessa transportadora. Se ela é nova, cadastre uma placa dela na Frota.'
      : 'Nenhuma placa cadastrada na Frota ainda.'}</div>`;
  const soAqui = transportadorasSoNesteNavegador();
  const caixa = document.getElementById('cad-transp-so-aqui');
  if(caixa){
    caixa.hidden = !soAqui.length;
    caixa.innerHTML = soAqui.length ? `
      <div class="transp-so-aqui-tit">Só neste computador — o servidor não conhece</div>
      <div class="card-sub">Nomes digitados no quadro antigo. Nenhuma placa da Frota usa estes nomes, e o Pagamento de Frete não os aceita. Confira na Frota como a transportadora está escrita e exclua o nome daqui.</div>
      ${soAqui.map(t => `<div class="modal-list-item"><span>${esc(t.nome)}</span>
        <button class="btn btn-danger btn-sm no-print" onclick="removerTransportadoraUI('${escJs(t.id)}')">Excluir</button></div>`).join('')}` : '';
  }
}
function irParaCadastroDePlacaUI(){
  irParaSecaoUI('card-frota');
  const campo = document.getElementById('frota-placa');
  if(campo) setTimeout(() => { try { campo.focus({ preventScroll: true }); } catch(e){} }, 60);
}
/* Excluir uma transportadora era UM clique, sem pergunta (achado no
   /impeccable Lote 5) — a Frota, ao lado, já perguntava. Agora pergunta
   como toda exclusão do painel. A lista é só de nomes: as placas da Frota
   que já usam o nome não mudam. */
async function removerTransportadoraUI(id){
  const t = DB.transportadoras.find(x => x.id === id);
  if(!t) return;
  if(!(await perguntarUI({ titulo: `Excluir a transportadora ${t.nome}?`,
       texto: 'O nome sai deste computador. Nenhuma placa da Frota usa esse nome — a Frota não muda.',
       botao: 'Excluir', perigo: true }))) return;
  removerTransportadora(id);
  notify('Transportadora excluída.', 'success');
  renderAll();
}
function atualizarDatalists(){
  /* As sugestões ao digitar transportadora (Frota, Programação, Montagem,
     completar a chegada) vêm da Frota — antes vinham da lista antiga do
     navegador e espalhavam a grafia que o servidor recusa (#128). */
  document.getElementById('lista-transportadoras').innerHTML = transportadorasDaFrota().map(t=>`<option value="${esc(t.nome)}">`).join('');
  /* Placas da Frota para o campo de placa da Montagem. A sugestão mostra a
     transportadora junto: quem monta o dia reconhece o caminhão pela
     empresa, não pelas sete letras. */
  const dlPlacas = document.getElementById('lista-placas-frota');
  if(dlPlacas){
    dlPlacas.innerHTML = (DB.frota || []).map(f =>
      `<option value="${esc(f.placa)}">${esc(f.transportadora || '')}${f.tipoVeiculo ? ' · ' + esc(f.tipoVeiculo) : ''}</option>`).join('');
  }
}

