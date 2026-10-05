/* ---------- navegação ---------- */
/* Gaveta de navegação do celular — pedido direto do usuário (08/08/2026):
   "ao inves de ser uma barra de rolagem pro lado... um atalho na
   esquerda que abre um menu". No desktop #nav continua barra horizontal
   sempre visível (ver @media em styles.css); estas duas funções só têm
   efeito visual abaixo do ponto de corte onde #nav vira gaveta. */
function alternarMenuMobile(){
  const nav = document.getElementById('nav');
  const aberto = nav.classList.toggle('nav-aberto');
  document.getElementById('menu-overlay').classList.toggle('visivel', aberto);
  document.getElementById('btn-menu').setAttribute('aria-expanded', aberto ? 'true' : 'false');
}
function fecharMenuMobile(){
  document.getElementById('nav').classList.remove('nav-aberto');
  document.getElementById('menu-overlay').classList.remove('visivel');
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
}
function abrirTab(tab){
  irParaTab(tab);
}
function irParaTab(tab){
  fecharMenuMobile();   // tocar num item da gaveta navega E fecha — não some sozinha
  document.querySelectorAll('.tab-page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el=>el.classList.remove('active'));
  const page = document.getElementById('tab-'+tab);
  const navBtn = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
  if(page) page.classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(el=>el.setAttribute('aria-selected','false'));
  if(navBtn){ navBtn.classList.add('active'); navBtn.setAttribute('aria-selected','true'); }
  TAB_ATUAL = tab;
  atualizarAvisoSetorAba();
  renderTabAtual();
}
function renderTabAtual(){
  atualizarDatalists();
  renderEscopoDoManobrista();
  switch(TAB_ATUAL){
    case 'torre': renderTorre(); renderVisaoPatio('torre'); break;
    case 'programacao': renderProgFila(); renderProgAguardando(); renderRodapeControleProgramacao(); carregarMontagemUI(); carregarModeloSemanaUI(); break;
    // Módulo próprio (devolucoes.js, carregado depois deste arquivo). O
    // typeof protege a ordem de carga: se o módulo faltar, a aba fica
    // vazia em vez de derrubar a navegação inteira.
    case 'devolucoes': if(typeof renderDevolucoes === 'function') renderDevolucoes(); break;
    case 'portaria':
      renderPortariaProgramadas();
      renderPortariaPatio();
      renderVisaoPatio('portaria');
      { const el = document.getElementById('portaria-placa'); if(el) setTimeout(()=>el.focus(), 30); }
      break;
    case 'expedicao': renderExpedicao(); renderVisaoPatio('expedicao'); break;
    case 'faturamento': renderFaturamento(); renderVisaoPatio('faturamento'); break;
    case 'indicadores': renderIndicadores(); break;
    // Módulo próprio (patio_vivo.js, carregado depois deste arquivo).
    case 'patio': if(typeof renderPatioVivo === 'function') renderPatioVivo(); break;
    case 'cadastros':
      renderCadastros();
      // A tabela de produtos (base oficial de 18/08/2026) vive no módulo
      // de Devoluções e vem do servidor — carrega na primeira abertura.
      if (typeof carregarCadastrosDev === 'function' && typeof devServidorOk === 'function' && devServidorOk()) {
        if (typeof _devCadastrosCarregados !== 'undefined' && !_devCadastrosCarregados) carregarCadastrosDev();
        else if (typeof renderProdutosDevUI === 'function') renderProdutosDevUI();
      }
      break;
    case 'historico':
      renderHistorico(); renderBuscaTimeline();
      // Se a carga aberta na timeline acabou de ser cancelada por aqui
      // mesmo, isto garante que a tela reflita o sumiço dela mesmo se a
      // busca ainda estiver vazia (sem isso o painel podia deixar a
      // timeline de uma carga já excluída na tela até o próximo F5).
      if(_timelineCargaAtual) renderTimelineCarga(_timelineCargaAtual);
      break;
    // A aba Relatórios é só de botões, mas o resumo do filtro tem que
    // refletir o estado atual do pátio — senão mostra a contagem de quando
    // a página abriu, que já mudou.
    case 'relatorios':
      renderEscopoDosRelatorios();
      atualizarResumoFiltroRelatorio();
      // O campo de dia do relatório de devoluções abre já com o dia de hoje
      // preenchido — quem quiser outro dia troca; vazio nunca fica, porque o
      // relatório "de hoje" é o caso de uso de toda hora na Logística.
      { const rd=document.getElementById('rel-dev-dia'); if(rd && !rd.value && typeof diaLocalDev==='function') rd.value=diaLocalDev(); }
      break;
    case 'usuarios': renderUsuarios(); renderMinhaSegurancaUI(); renderPedidosAprovacaoUI(); break;
    // Módulo próprio (app/76_pagamento_frete.js). O typeof protege a ordem de carga.
    case 'frete': if(typeof renderFrete === 'function') renderFrete(); break;
  }
  // Depois de pintar, e não antes: os rótulos são derivados das células
  // que acabaram de ser criadas.
  prepararTabelasMobile();
}

/* =====================================================================
   CELULAR: TOQUE PARA ABRIR O CARTÃO (23/08/2026)
   =====================================================================

   Par obrigatório da regra de CSS que esconde os campos secundários em
   telas estreitas. O CSS decide O QUE some; isto decide COMO volta.

   DELEGADO NO DOCUMENTO, e não um ouvinte por linha: as tabelas do painel
   são redesenhadas o tempo todo (a Torre a cada sincronização), e ouvinte
   preso à linha morreria no primeiro render. Um ouvinte só, no documento,
   sobrevive a qualquer redesenho — e vale para toda tabela `mobile-cartao`
   de qualquer aba, que é o que o gestor pediu: "não só na torre, mas nas
   outras abas também".

   Não interfere no que já era clicável: se o toque veio de um botão, link,
   campo ou de uma linha que já tem clique próprio (Histórico, Raio-X), a
   função sai sem fazer nada e deixa o comportamento original acontecer. */
function ehTelaEstreita(){
  return window.matchMedia && window.matchMedia('(max-width:820px)').matches;
}

/* AS DUAS LISTAS QUE DECIDEM O CARTÃO DO CELULAR — e o motivo de estarem
   aqui, e não no CSS.

   A primeira versão escrevia cada uma dessas listas como seletor de CSS,
   repetido em três blocos diferentes (quem ocupa a linha toda, quem some
   no estado compacto, quem lê em linha). Três cópias da mesma verdade
   escritas à mão é uma que vai divergir — e divergiu: o Histórico voltou
   de 94px para 147px por cartão porque a terceira lista tinha seis
   rótulos e a primeira tinha dez. Nenhum erro de CSS; erro de ter a
   mesma decisão em três lugares.

   Agora a decisão mora num lugar só. `prepararTabelasMobile` carimba
   `data-larg="cheia"` e `data-sec="1"` em cada célula, e o CSS pergunta
   pelo carimbo. Acrescentar um rótulo aqui acerta os três blocos de uma
   vez, por construção. */

/* LARGURA CHEIA — o valor pode ser longo, então a célula ocupa as duas
   colunas da grade do cartão. Consequência: no estado compacto essa
   célula (e só ela) lê em linha, "Rótulo: valor", porque só numa célula
   de largura inteira o par cabe numa linha só. Na meia coluna ele quebra
   e fica MAIS alto que empilhado — foi medido, ver o CSS. */
const ROTULOS_LARGURA_CHEIA = new Set([
  // Medido no Histórico a 390px: com 'Data/Hora' e 'Placa' em meia coluna o
  // cartão dava 160px; em largura cheia, lendo em linha, deu 132px. Valor
  // curto ganha mais de ler em linha do que de dividir a largura.
  'Data/Hora', 'Placa',
  // 'Peso (kg)' entra pelo mesmo motivo e por mais um: na Torre ele caía
  // sozinho numa linha de grade cuja outra metade ficava vazia (o campo
  // seguinte é de largura inteira e força linha nova). Em linha cheia o
  // buraco some e o cartão cai de 271px para 253px — sem esconder nada.
  'Peso (kg)',
  'Transportadora', 'Rota', 'Motorista', 'Cliente', 'Destino',
  'Observações', 'Nome', 'E-mail', 'Atualizado em', 'Linha do tempo',
  'Operador', 'Setor', 'Registro', 'Etapa', 'Status',
  'Tipo de Operação', 'Programação · Última etapa', 'Tipo de Veículo',
  'Motivo', 'Produto', 'Cliente / Destino', 'Detalhe', 'Ação do operador',
]);

/* SECUNDÁRIO — some no cartão fechado, volta com um toque. O default é
   MOSTRAR: coluna nova nasce visível, e só entra aqui quem foi decidido.
   Errar para o lado de mostrar demais é recuperável; esconder um dado que
   alguém precisava, não. */
const ROTULOS_SECUNDARIOS = new Set([
  'Seq.', 'Motorista', 'Palet.', 'Paletizada', 'Tipo de Operação',
  'Ganchos · Entr.', 'Ganchos', 'Entregas', 'Doca', 'Transportadora',
  'Tipo de Veículo', 'Observações', 'Programação · Última etapa',
  'Atualizado em', 'Operador', 'Setor', 'Linha do tempo',
]);

/* Marca as linhas que TÊM algo escondido. Sem esta marca, o rodapé "toque
   para ver tudo" apareceria também em cartão que já mostra tudo — e aí a
   promessa da tela seria mentira.

   Lê o carimbo `data-sec` em vez de consultar o Set de novo: quem carimba
   é `prepararTabelasMobile`, e uma leitura só garante que a marca da linha
   e a regra do CSS nunca discordem. */
function marcarCartoesExpansiveis(raiz){
  const alvo = raiz && raiz.querySelectorAll ? raiz : document;
  alvo.querySelectorAll('table.mobile-cartao tbody tr').forEach(tr=>{
    if(!tr.querySelector('td[data-sec]')){
      tr.removeAttribute('data-expansivel'); tr.classList.remove('cartao-aberto'); return;
    }
    // Linha que JÁ tem clique próprio (Histórico e Raio-X abrem o registro
    // completo embaixo) recebe rodapé com outro texto. Prometer "toque para
    // ver tudo" e entregar outra coisa é pior que não prometer nada — e o
    // detalhe que ela abre mostra Operador e Setor, que são exatamente os
    // campos escondidos aqui.
    const temClique = tr.classList.contains('hist-linha') || tr.classList.contains('raiox-linha');
    tr.setAttribute('data-expansivel', temClique ? 'detalhe' : '1');
  });
}

document.addEventListener('click', (ev)=>{
  if(!ehTelaEstreita()) return;
  const tr = ev.target.closest && ev.target.closest('table.mobile-cartao tbody tr[data-expansivel]');
  if(!tr) return;
  /* Não sequestra clique de controle nem de linha que já responde sozinha.
     `[role="button"]` entrou em 28/08/2026: as células que filtram a aba
     Indicadores ao toque são <td role="button">, e sem isto um toque nelas
     fazia as duas coisas ao mesmo tempo — aplicava o filtro E abria o
     cartão. Duas respostas para um toque é o tipo de coisa que ensina a
     pessoa a não tocar. */
  if(ev.target.closest('button, a, input, select, textarea, label, [role="button"]')) return;
  if(tr.classList.contains('hist-linha') || tr.classList.contains('raiox-linha')) return;
  /* Linha que se abre SOZINHA (Montagem e Fila têm onclick próprio que
     redesenha o tbody) já nasce com `cartao-aberto` quando está aberta —
     ver linhaFilaHtml e a linha da Montagem. Ligar a classe aqui de novo
     cairia num nó que o redesenho acabou de descartar. */
  if(tr.classList.contains('mont-linha') || tr.classList.contains('prog-linha')) return;
  tr.classList.toggle('cartao-aberto');
});

/* Depois de todo redesenho as marcas precisam voltar. `renderTabAtual` já
   chama `prepararTabelasMobile` no fim de cada pintura; este observador é a
   rede para o que redesenha FORA dele — a busca de cargas excluídas, o log
   da programação do dia, qualquer tela que troca a tabela inteira por
   innerHTML sem passar pelo render geral.

   Observa o #main com subtree, e não cada tbody: tbody que nasce depois do
   carregamento nunca seria observado, e era isso que deixava essas telas
   sem rótulo no celular. O custo fica limitado por juntar a rajada de
   mutações num único passe por quadro — a mesma passada que o render normal
   já faz, nunca uma por linha inserida.

   Não realimenta: só `childList` é observado, e `prepararTabelasMobile`
   mexe apenas em atributos. */
if(typeof MutationObserver !== 'undefined'){
  let agendado = false;
  const observador = new MutationObserver(()=>{
    if(agendado) return;
    agendado = true;
    const passar = ()=>{
      agendado = false;
      try{ prepararTabelasMobile(); }catch(e){ /* DOM em transição */ }
    };
    if(typeof requestAnimationFrame === 'function') requestAnimationFrame(passar);
    else setTimeout(passar, 0);
  });
  document.addEventListener('DOMContentLoaded', ()=>{
    const main = document.getElementById('main');
    if(main) observador.observe(main, { childList:true, subtree:true });
    prepararTabelasMobile(document);
  });
}

/* O REDESENHO NÃO PODE ARRANCAR O CAMPO DA MÃO DE QUEM DIGITA (31/08/2026).

   RELATO, do Wemerson: "começa a preencher o campo e o campo para de
   digitar, tem que clicar de novo no campo; na hora de fazer um cadastro,
   completando informações, tem que ficar voltando no campo que tá digitando".

   O painel se redesenha inteiro a cada sincronia — de 15 em 15 segundos — e
   a cada dado que chega de outro setor. As linhas editáveis da Torre, da
   Fila e da Montagem são reescritas por completo: o campo que estava sob o
   dedo deixa de existir e um novo nasce no lugar, vazio. O foco vai para o
   BODY, o que já tinha sido digitado some, e o cursor volta para o começo.
   Reproduzido em teste antes desta correção.

   A PROTEÇÃO JÁ EXISTIA — e valia para um lugar só. `_devCapturarDigitacao`
   e `_devRestaurarDigitacao` (devolucoes.js) fazem exatamente isto, guardando
   valor, foco e posição do cursor, desde 27/08. Foram escritas para
   `#dev-lista`. É a família da ocorrência #20: a regra certa existe, com
   comentário e tudo, e não vale para os irmãos dela.

   Aqui ela passa a valer para o painel inteiro, no ponto por onde todo
   redesenho passa. Uma função, um chamador — em vez de cada tela lembrar. */
function _capturarDigitacao(){
  const foco = document.activeElement;
  const editavel = foco && (foco.tagName === 'INPUT' || foco.tagName === 'TEXTAREA'
                            || foco.tagName === 'SELECT');
  if(!editavel) return null;
  /* A âncora é o id quando existe; quando não existe, a posição do campo
     dentro da tabela. As linhas da Torre e da Montagem nascem com id; as
     células de carga usam classe, e para essas o caminho é o índice. */
  const linha = foco.closest('tr');
  const cel = foco.closest('td');
  return {
    id: foco.id || null,
    classe: foco.className || '',
    valor: (foco.type === 'checkbox' || foco.type === 'radio') ? foco.checked : foco.value,
    ini: typeof foco.selectionStart === 'number' ? foco.selectionStart : null,
    fim: typeof foco.selectionEnd === 'number' ? foco.selectionEnd : null,
    linhaId: linha ? (linha.dataset && linha.dataset.id) || null : null,
    /* A CARGA DA LINHA, não a posição dela (27/09/2026). Ver o comentário
       em _restaurarDigitacao: posição de linha não é identidade de carga. */
    chaveLinha: linha && linha.dataset ? (linha.dataset.carga || linha.dataset.id || null) : null,
    idxLinha: linha && linha.parentElement
      ? [...linha.parentElement.children].indexOf(linha) : -1,
    idxCel: cel && cel.parentElement ? [...cel.parentElement.children].indexOf(cel) : -1,
    tabelaId: linha && linha.closest('tbody') ? linha.closest('tbody').id : null,
  };
}

function _restaurarDigitacao(e){
  if(!e) return;
  let el = e.id ? document.getElementById(e.id) : null;
  /* O CAMPO É ACHADO PELA CARGA, NUNCA PELA POSIÇÃO (27/09/2026).

     Achado ao preparar a Torre deslizando, e reproduzido no painel
     publicado: a Logística digitava no Nº da carga da segunda linha, outro
     setor mudava a sequência, a Torre se redesenhava — e o texto e o cursor
     iam para o campo da carga que AGORA estava na segunda linha. Ao sair do
     campo, o número daquela outra carga era sobrescrito. Os campos da Torre
     não têm id, então o caminho era "linha 2, coluna 2"; basta a ordem
     mudar para a linha 2 ser outra carga.

     Agora, quando a linha tem dono (data-carga ou data-id), é por ele que
     se procura. Se a carga saiu da tela, o texto em curso se perde — é
     melhor do que gravá-lo na carga errada. A posição só vale para linha
     sem dono. Guarda: testes/test_digitacao_nao_troca_de_carga.py. */
  if(!el && e.chaveLinha && e.tabelaId && e.idxCel >= 0){
    const tb = document.getElementById(e.tabelaId);
    const tr = tb && [...tb.children].find(x => x.dataset
      && (x.dataset.carga === e.chaveLinha || x.dataset.id === e.chaveLinha));
    if(!tr) return;   // a carga saiu da tela: não devolve em outra
    const td = tr.children[e.idxCel];
    el = td ? td.querySelector('input, select, textarea') : null;
    if(!el) return;
  }
  if(!el && !e.chaveLinha && e.tabelaId && e.idxLinha >= 0 && e.idxCel >= 0){
    const tb = document.getElementById(e.tabelaId);
    const tr = tb && tb.children[e.idxLinha];
    const td = tr && tr.children[e.idxCel];
    el = td ? td.querySelector('input, select, textarea') : null;
  }
  if(!el) return;   // a linha saiu da tela (outro setor moveu a carga)
  /* Só devolve o que a pessoa digitou se o campo voltou vazio ou diferente:
     se o redesenho trouxe um valor NOVO vindo do servidor, quem manda é o
     servidor — a tela adianta, a transação decide. */
  if(el.type === 'checkbox' || el.type === 'radio'){
    if(el.checked !== e.valor) el.checked = e.valor;
  } else if(el.value !== e.valor){
    el.value = e.valor;
  }
  try{
    el.focus({ preventScroll: true });
    if(e.ini !== null) el.setSelectionRange(e.ini, e.fim);
  }catch(err){ /* number e date não aceitam setSelectionRange */ }
}

function renderAll(){
  const _digitando = _capturarDigitacao();
  try { _marcarDesenho('renderAll', _renderAllInterno); }
  finally { _restaurarDigitacao(_digitando); }
}

function _renderAllInterno(){
  /* Guardião do pré-login: qualquer caminho que resulte em operador logado
     (botões de login, restauração de sessão por token, teste automatizado
     que grava DB.operador direto) revela o painel — e qualquer caminho que
     o deslogue esconde. Concentrar aqui evita a classe presa: foi
     exatamente o que a primeira versão desta tela causou nos fluxos que
     não passavam pelos botões. */
  /* "LOGADO" SIGNIFICA "TEM SESSÃO" — UMA FONTE DE VERDADE (31/08/2026).

     Esta linha era `if(DB.operador && ...)`, e essa é a causa raiz do dia
     inteiro de incidentes de 31/08. Dois fatos diferentes, guardados em
     lugares com PRAZOS diferentes, tratados como um só:

         DB.operador (nome, setor, e-mail)  →  localStorage  →  para sempre
         o token (a sessão de verdade)      →  sessionStorage →  morre com a aba

     Quem entrou uma vez ficava "logado" para sempre aos olhos da tela. A
     aba fecha (ou o Android a descarta, ou a sessão vence), o token morre,
     o operador fica — e o painel revelava a tela de trabalho INTEIRA sem
     sessão nenhuma. A partir daí, em cascata:

       · sem sessão ele não lê o servidor, então a Torre e a programação
         mostravam a cópia local — zero, num navegador limpo. Foi o "zerou
         tudo" que o dono viu no desktop enquanto o celular mostrava tudo
         certo (o celular tinha sessão, e por isso lia do servidor);
       · nada do que a pessoa digitasse subia — e até a manhã de 31/08 isso
         era silencioso (ocorrência #24);
       · e NÃO HAVIA LOGIN na tela para sair do estado, porque aos olhos do
         painel a pessoa já estava logada.

     Corrigi as consequências uma a uma durante o dia — a recusa, o aviso
     honesto, a faixa, o login abrindo sozinho. Todas necessárias, nenhuma
     suficiente: enquanto a decisão de revelar o painel olhasse um dado que
     sobrevive à sessão, o problema voltaria de outra forma.

     Modo local continua entrando: quem escolheu "Entrar sem servidor" não
     tem e-mail e não depende de token — é decisão de quem usa, não sessão
     perdida. */
  if(DB.operador && temSessaoParaOPainel()
     && document.body.classList.contains('pre-login')){
    revelarPainel();
  } else if((!DB.operador || !temSessaoParaOPainel())
            && !document.body.classList.contains('pre-login')
            && document.getElementById('modal-operador').classList.contains('open')){
    document.body.classList.add('pre-login');
  }
  renderTabAtual();

  /* Explicação sob demanda no celular: cartão redesenhado volta sem a
     classe, então o estado escolhido é reaplicado a cada ciclo. */
  try { _prepararTitulosExplicaveis(); restaurarExplicacoes();
        restaurarSecoesIndicadores(); } catch(e){}
}

