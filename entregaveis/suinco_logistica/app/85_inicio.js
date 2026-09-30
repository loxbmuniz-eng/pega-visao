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
/* OS SELETORES DE SETOR SE MONTAM DA LISTA ÚNICA (02/09/2026).

   As três filiais foram criadas no servidor e em SETOR_PERMISSOES, e não
   apareceram na tela de Usuários. O dono, tentando cadastrar: "nao apareceu
   a filial pra cadastrar usuarios (...) precisa ter esse setor pra eu poder
   cadastrar nao aparece".

   A causa: a lista de setores estava escrita À MÃO no HTML, em TRÊS
   lugares — o filtro do Histórico, o cadastro de usuário e o login local.
   Somando `SETORES` (data.js) e `SETORES` (dominio/fluxo.js), eram CINCO
   cópias da mesma lista. Criar um setor exigia lembrar das cinco, e eu
   lembrei de duas.

   É a família da ocorrência #14 — "a mesma decisão escrita em dois
   lugares" —, agora com cinco. A correção é a mesma que valeu lá: uma
   fonte, e os outros perguntam. Setor novo passa a aparecer nas três telas
   sozinho.

   O LOGIN LOCAL FICA DE FORA da lista completa de propósito: ele é o modo
   sem servidor, e filial que entrasse por ali trabalharia isolada — que é
   exatamente o que a trava de offline existe para impedir. */
function montarSeletoresDeSetor(){
  const alvos = [
    { id: 'usr-setor',          comTodos: false, comFilial: true  },
    { id: 'hist-filtro-setor',  comTodos: true,  comFilial: true  },
    { id: 'login-setor',        comTodos: false, comFilial: false },
  ];
  alvos.forEach(({ id, comTodos, comFilial }) => {
    const sel = document.getElementById(id);
    if(!sel) return;
    const escolhido = sel.value;
    const lista = SETORES.filter(s => comFilial || !ehSetorFilial(s));
    sel.innerHTML = (comTodos ? '<option value="">Todos</option>' : '')
      + lista.map(s => `<option>${esc(s)}</option>`).join('');
    if(escolhido && lista.includes(escolhido)) sel.value = escolhido;
  });
}

async function init(){
  montarSeletoresDeSetor();
  // Carrega a base real de Frota antes de desenhar a tela — ver
  // carregarFrotaSeedSeVazia em data.js. Nunca trava o painel se falhar
  // (ex: aberto via file://): segue com Frota vazia, exigindo cadastro/import
  // manual como já era antes desta base.
  const seed = await carregarFrotaSeedSeVazia();
  if(seed.carregado){
    if(seed.primeiraCarga){
      notify(`Base de Frota carregada: ${seed.total} placa(s).`, 'success');
    } else {
      // Atualização de base numa máquina que já tinha a anterior. Isso NÃO
      // pode passar batido: se uma placa mudou de transportadora, quem
      // programa carga precisa saber que o dado na tela mudou hoje.
      const partes = [`Base de Frota atualizada: ${seed.total} placa(s)`];
      if(seed.alteradas) partes.push(`${seed.alteradas} com transportadora corrigida`);
      if(seed.removidas) partes.push(`${seed.removidas} fora de operação removida(s)`);
      if(seed.manuaisPreservadas) partes.push(`${seed.manuaisPreservadas} cadastrada(s) à mão preservada(s)`);
      notify(partes.join(' · ') + '.', 'warn', 9000);
    }
  }
  preencherSelectsRota();   // alimenta os selects de Rota a partir de ROTAS
  iniciarTema();            // antes de desenhar: evita piscar no tema errado
  ligarCalendarioNosCamposDeData();   // clique no campo abre a janelinha do calendário
  // Conecta ao servidor se houver sessão; caso contrário fica em modo
  // local e o rodapé diz isso. Nunca bloqueia a abertura do painel.
  if(typeof SuincoSharePoint !== 'undefined'){
    /* A FILA VELHA DOS APARELHOS É DESCARTADA NA ABERTURA (31/08/2026).

       Sem isto, a trava do offline valeria só daqui para frente: o que já
       está guardado no celular de quem ficou sem rede subiria na próxima
       conexão e sobrescreveria de novo — que é exatamente o defeito que
       estamos fechando. Foi assim que o celular do Alysson desfez o que ele
       tinha acabado de fazer no computador.

       NÃO some calado: lista o que foi descartado, com placa e tipo, para a
       pessoa refazer o que ainda fizer sentido. */
    if(typeof SuincoSharePoint.descartarFilaAntiga === 'function'){
      const jogado = SuincoSharePoint.descartarFilaAntiga();
      if(jogado && jogado.havia){
        const linhas = jogado.itens.slice(0, 8).map(i =>
          `${i.tipo}${i.placa ? ' · ' + i.placa : ''}${i.numeroCarga ? ' · carga ' + i.numeroCarga : ''}`
        ).join(' | ');
        notify(`⚠️ ${jogado.havia} alteração(ões) que estavam guardadas NESTE aparelho foram DESCARTADAS. `
          + `O sistema não grava mais offline — elas subiriam por cima do que os outros setores já fizeram. `
          + `Refaça se ainda fizer sentido: ${linhas}`, 'danger', 30000);
      }
    }
    SuincoSharePoint.aoMudarEstado(atualizarRodapeConexao);
    /* O adaptador não conhece `DB` de propósito, então quem responde "a cópia
       local sumiu?" é daqui. Marca de sincronia com base vazia é estado
       impossível num painel saudável: quer dizer que a gravação local falhou
       (cota do navegador) e o painel ficaria pedindo só o que mudou desde uma
       marca que não corresponde a dado nenhum — Torre zerada para sempre,
       naquele computador. Ver ocorrência #64. */
    if (SuincoSharePoint.aoPerguntarSeBaseEstaVazia) {
      SuincoSharePoint.aoPerguntarSeBaseEstaVazia(
        () => !Array.isArray(DB.cargas) || DB.cargas.length === 0);
    }
    // Toda leitura das Listas cai aqui: funde no DB e redesenha se algo mudou.
    // É o que faz a Portaria enxergar a carga que a Logística acabou de criar.
    SuincoSharePoint.aoReceberDados(dados => {
      /* A tabela de frete chega junto do resto (09/09/2026). Antes de
         fundir as cargas de propósito: se uma carga nova traz um destino,
         a tela já precisa saber o km dele para exibir. */
      if(dados.freteTarifas || dados.freteDestinos){
        receberTabelaDeFrete({tarifas: dados.freteTarifas, destinos: dados.freteDestinos});
        if(typeof renderTabelaDeFrete === 'function') renderTabelaDeFrete();
        if(typeof preencherSelectsDestinoFrete === 'function') preencherSelectsDestinoFrete();
      }
      const r = fundirEstadoRemoto(dados);

      /* liberarPendencias() estava escrita desde sempre e NUNCA era chamada
         de lugar nenhum — achado da auditoria "superpowers". O comentário
         dela já dizia quando deveria rodar: "quando a fila sobe por
         completo". Este callback dispara toda vez que sincronizarAgora()
         faz uma leitura — e sincronizarAgora() SEMPRE drena a fila de
         escrita antes de ler (drenarFila() → pull()). "Fila vazia agora" é
         exatamente o sinal de "subiu por completo".

         Sem isto, uma carga que passou pela fila offline (rede caiu no meio
         do registro) ficava com `_pendente`/`_statusPendentes` travados PARA
         SEMPRE, mesmo depois de a gravação ter subido com sucesso — e como
         essas marcas vão para o localStorage inteiro, o bloqueio sobrevivia
         a fechar a aba. A regra 3 de fundirEstadoRemoto (mais abaixo)
         recusa qualquer atualização remota de uma carga marcada assim: o
         terminal ficava permanentemente cego para o que os outros setores
         faziam naquela carga específica.

         `SuincoSharePoint.pendentes` é checado antes de chamar porque
         painéis muito antigos em cache podem não ter a versão do adaptador
         que exporta essa função — mesma cautela já usada para
         aoEditarCarga/aoExcluirCarga logo abaixo. */
      if(typeof SuincoSharePoint.pendentes === 'function' && SuincoSharePoint.pendentes() === 0){
        liberarPendencias();
      }

      /* VOLTOU A ANDAR DEPOIS DE TER SIDO DEVOLVIDA (29/08/2026).

         Quem devolve uma etapa de propósito precisa saber na hora quando
         ela volta a andar. Sem isso, o dono corrigia, outro setor desfazia
         em silêncio, e ele tentava de novo achando que a correção não
         tinha gravado — o relato do FTZ2138 por inteiro.

         Vem ANTES do renderAll e fora do `if` de contagem: é notícia sobre
         uma decisão que esta pessoa tomou, não redesenho de tela. Alto e
         com som, no mesmo padrão da recusa de status. */
      (r.reandouAposDevolucao || []).forEach(x => {
        const quem = `${x.devolvida.setor} (${x.devolvida.quem})`;
        notify(`${x.placa}${x.numeroCarga ? ' · ' + x.numeroCarga : ''}: a carga VOLTOU A ANDAR `
          + `— de "${x.de}" para "${x.para}". ${quem} tinha devolvido a etapa. `
          + `Se não era pra andar, devolva de novo pelo Histórico e avise o setor.`,
          'warn', 14000);
        tocarBeepConfirmacao();
      });

      if(r.cargasNovas || r.cargasAtualizadas || r.movimentacoesNovas){
        renderAll();
        // Aviso discreto: a tela mudou por ação de outro setor, e o operador
        // precisa saber disso — tela que se altera sozinha sem explicação
        // destrói a confiança no painel.
        if(!dados.incremental) return;   // carga inicial não é "novidade"
        /* PERECÍVEL: é notícia de outro setor, e a tela já mostra o
           resultado dela. Quem acabou de abrir o painel não precisa
           assistir à reprise do que aconteceu antes de ele chegar. */
        if(r.cargasNovas || r.cargasAtualizadas){
          notifyAtualizacaoRemota(r);
        }
      }
      atualizarRodapeConexao(SuincoSharePoint.estado());
    });
    // Alteração em carga já programada: aviso detalhado, com som quando é a
    // placa. Chega por fora da sincronia porque é notícia, não dado.
    if(SuincoSharePoint.aoEditarCarga) SuincoSharePoint.aoEditarCarga(receberEdicaoRemota);
    if(SuincoSharePoint.aoExcluirCarga) SuincoSharePoint.aoExcluirCarga(receberExclusaoRemota);
    // Quem está online, pra aba Usuários. Só redesenha se a aba estiver
    // aberta agora — nas outras telas a lista fica guardada e some vale na
    // próxima vez que a Administração abrir Usuários.
    if(SuincoSharePoint.aoAtualizarPresenca) SuincoSharePoint.aoAtualizarPresenca(online => {
      _operadoresOnline = new Set((online || []).map(String));
      if(TAB_ATUAL === 'usuarios') renderUsuarios();
    });
    // Alguém (Logística/Administração) fechou a programação atual — todo
    // mundo conectado precisa saber, não só quem clicou. Pedido do usuário
    // (08/08/2026): "resetando os paineis de todos os setores".
    if(SuincoSharePoint.aoFecharPrograma) SuincoSharePoint.aoFecharPrograma(dados => {
      notify(`Programação fechada por ${dados.operador} (${dados.setor}) — pronto para uma nova.`, 'info', 6000);
      renderAll();
    });
    if(typeof aoRecusarStatus === 'function') aoRecusarStatus(receberRecusaDeStatus);
    if(typeof aoRecusarCarga === 'function') aoRecusarCarga(receberRecusaDeCarga);
    if(typeof aoRecusarFrota === 'function') aoRecusarFrota(receberRecusaDeFrota);
    if(typeof aoRecusarRota === 'function') aoRecusarRota(receberRecusaDeRota);
    if(typeof aoEnfileirarRota === 'function') aoEnfileirarRota(receberEnfileiramentoDeRota);
    SuincoSharePoint.iniciar()
      .then(()=>{ atualizarRodapeConexao(SuincoSharePoint.estado()); sincronizarDocumentosDoSetor(); renderAll(); })
      .catch(e=>{ console.warn('[Suinco] init:', e); atualizarRodapeConexao('local'); });
  }
  atualizarDatalists();
  /* O medidor liga cedo: travamento que acontece durante a primeira pintura
     é justamente o que ninguém consegue descrever depois. */
  ligarMedidorDeTravamento();
  atualizarResumoFiltroRelatorio();  // resumo do filtro já na 1ª pintura
  // Mudar a data tem que refletir no resumo na hora: filtro cujo efeito só
  // aparece depois de gerar o PDF faz o gestor mandar o relatório errado.
  ['rel-data-de','rel-data-ate'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', atualizarResumoFiltroRelatorio);
  });
  atualizarAvisoSetorAba(); // preenche o box "função da aba" já na 1ª pintura
  if(DB.operador){
    document.body.classList.remove('pre-login');
    atualizarHeaderOperador();
    aplicarPermissoesSetor();
  } else {
    abrirLogin();
  }
  iniciarRelogio();
  renderAll();
}
document.addEventListener('DOMContentLoaded', init);
/* AS ABAS EXISTEM PARA O TECLADO (09/09/2026). Eram <div onclick> sem
   tabindex: o Tab pulava do cabeçalho direto para a tabela, e um gestor de
   mesa não trocava de aba sem mouse. Enter e Espaço fazem o que o clique
   faz; o anel de foco é o :focus-visible global. */
document.addEventListener('keydown', (ev) => {
  if(ev.key !== 'Enter' && ev.key !== ' ') return;
  const aba = ev.target && ev.target.closest && ev.target.closest('.nav-tab[data-tab]');
  if(!aba) return;
  ev.preventDefault();
  abrirTab(aba.dataset.tab);
});

