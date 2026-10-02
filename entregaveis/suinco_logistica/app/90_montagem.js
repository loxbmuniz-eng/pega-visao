/* =====================================================================
   MONTAGEM DO DIA — a carga antes de ter placa (23/08/2026)
   =====================================================================

   O que ainda prendia a operação no Excel. O dia nascia numa planilha do
   Teams: o template do dia da semana traz as rotas, a Logística monta as
   cargas em cima delas, e só DEPOIS contrata as placas. O painel não
   participava dessa etapa porque `criarCargaProgramada` recusa placa
   vazia — no painel a carga só existia quando o veículo já estava
   contratado, que é o ÚLTIMO passo do processo real.

   A montagem vive no servidor (tabela própria, migração 031) e NÃO entra
   em DB.cargas. Consequência que é o ponto do desenho: a Torre de
   Controle não vê nada disso. Ela continua recebendo cargas com placa,
   como sempre recebeu.

   Quando a placa entra, a linha vira carga pelo caminho de sempre
   (criarCargaProgramada) e é marcada como efetivada.
   ===================================================================== */

let _montagemDia = null;      // { dia, diaSemana, modelo:[], montagens:[] }
const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/* Dia de HOJE no fuso de quem está olhando, nunca em UTC.

   `toISOString()` devolve UTC: às 21h01 em Brasília a data UTC já é a de
   amanhã, e o botão "Hoje" abriria a programação do dia seguinte para
   quem monta o dia à noite. O guardião em testes/test_guardioes.py existe
   exatamente para impedir que isso volte — e pegou este código. */
function montagemHojeUI(){
  const el = document.getElementById('mont-data');
  if(el) el.value = diaLocalISO();
  carregarMontagemUI();
}

/* O CATÁLOGO PRECISA ESTAR DE PÉ ANTES DE A MONTAGEM DESENHAR.

   Quem abre a Montagem direto nunca passou pela aba do modelo, e sem isto
   `destinosDaRota()` devolveria vazio para todas as rotas — a tela diria
   "sem destino cadastrado" com o cadastro cheio. Lê uma vez por sessão;
   falha de leitura não derruba a Montagem, só deixa o catálogo menor. */
let _destinosCarregados = false;
async function garantirCatalogoDeDestinos(){
  if(_destinosCarregados) return;
  try {
    const r = await SuincoSharePoint.modeloSemana.listar();
    registrarDestinosDoModelo((r && r.modelo) || []);
    _destinosCarregados = true;
    /* Chegou depois do desenho: repovoa só o seletor de destino. Não
       redesenha a Montagem — quem está preenchendo uma linha perderia o
       campo em foco, e o catálogo não muda linha nenhuma. */
    popularDestinoExtraUI();
  } catch(e){ /* cadastro da rota ainda responde sozinho */ }
}

async function carregarMontagemUI(){
  /* O CATÁLOGO NÃO SEGURA O DESENHO DA TELA (corrigido em 22/09/2026).

     A primeira versão disto era `await garantirCatalogoDeDestinos()` aqui,
     nesta linha, antes de qualquer coisa aparecer. O portão reprovou
     test_sequencia_no_celular com "sem linha", e a bateria estava certa: eu
     tinha posto uma chamada de REDE na frente do desenho da Montagem.

     No celular do pátio, com sinal ruim, isso significa a tela em branco
     esperando um dado que ela não precisa para desenhar linha nenhuma — o
     catálogo serve só ao seletor de destino da linha extra.

     Agora ele carrega ATRÁS: a tela desenha na hora e o seletor melhora
     quando o modelo chega. Antes de chegar, `destinosDaRota()` ainda
     responde pelo cadastro da rota, então o seletor nunca está vazio. */
  garantirCatalogoDeDestinos();
  const card = document.getElementById('card-montagem');
  if(!card) return;
  /* Só quem programa monta. Os demais setores continuam vendo a Fila e a
     Torre — a montagem é trabalho da Logística, não informação de pátio. */
  const setor = DB.operador && DB.operador.setor;
  const podeMontar = setor === 'Logística' || setor === 'Administração';
  card.hidden = !podeMontar;
  if(!podeMontar) return;

  const campoData = document.getElementById('mont-data');
  if(campoData && !campoData.value) campoData.value = diaLocalISO();
  const dia = campoData ? campoData.value : '';

  if(!SuincoSharePoint.estaConfigurado()){
    document.getElementById('mont-tbody').innerHTML = '';
    const av = document.getElementById('mont-faltando');
    if(av){
      av.hidden = false;
      av.textContent = 'A montagem do dia mora no servidor — entre com seu usuário para montar a programação.';
    }
    return;
  }

  try {
    _montagemDia = await SuincoSharePoint.montagem.doDia(dia);
    renderMontagem();
  } catch(e){
    /* SERVIDOR AINDA SEM A MIGRAÇÃO 031.
       O painel vai para o ar assim que a build publica; o servidor só
       ganha as tabelas novas quando alguém roda atualizar.sh na VPS.
       Nesse intervalo /api/montagem não existe e devolve 404.
       Cuspir "erro" nesse caso assustaria a Logística inteira por algo
       que não quebrou nada — o resto da Programação continua funcionando.
       A tela some e diz o que falta, uma vez, sem alarme. */
    if(e && e.status === 404){
      card.hidden = true;
      console.info('[Suinco] Montagem do dia: servidor ainda sem a atualização. '
        + 'Rode atualizar.sh na VPS para habilitar.');
      return;
    }
    notify('Não consegui carregar a montagem do dia: ' + (e.message || e), 'erro', 7000);
  }
}

/* A DIGITAÇÃO SOBREVIVE AO REDESENHO (10/09/2026).
   ---------------------------------------------------------------------
   RELATO DO DONO: "no computador do wemerson ta dando umas travadas sera
   que ta muito pesado???".

   NÃO ERA PESO. Medido com 39 linhas — uma sexta cheia — e o processador
   4x mais lento para imitar a máquina dele: desenhar a tabela leva 187ms,
   o DOM fica com 5.494 nós e o JS ocupa 10 MB. Isso não trava nada.

   O QUE TRAVAVA: `renderMontagem` era chamada DIRETO por
   carregarMontagemUI, passando por fora da proteção de digitação que o
   renderAll já tinha. Reproduzido: digitar "215" no campo de peso e
   redesenhar deixava o campo VAZIO, com o elemento trocado e o foco
   perdido. A cada campo alterado a tabela inteira era refeita — então
   quem preenchia uma linha via o que acabou de digitar sumir.

   A sensação de "travada" era essa: a tela pisca e engole o que a pessoa
   escreveu. Trocar o computador não resolveria nada.

   A proteção já existia e já sabia ancorar pelo id da linha da Montagem —
   faltava esta função usá-la. Uma função, dois chamadores. */
function renderMontagem(){
  const _digitando = _capturarDigitacao();
  try { _marcarDesenho('renderMontagem', _renderMontagemInterno); }
  finally { _restaurarDigitacao(_digitando); }
}

function _renderMontagemInterno(){
  if(!_montagemDia) return;
  const { diaSemana, modelo, montagens } = _montagemDia;
  const nomeDia = document.getElementById('mont-dia-nome');
  if(nomeDia) nomeDia.textContent = NOMES_DIA[diaSemana];

  const vivas = montagens.filter(m => !m.cancelada_em);
  const comPlaca = vivas.filter(m => m.placa);
  const efetivadas = vivas.filter(m => m.efetivada_em);

  /* "Rotas do modelo que ainda não foram montadas" é o número que diz o
     que FALTA fazer — e é a única razão de a tela carregar o modelo junto
     com a montagem. Conta por rota, não por carga: o modelo pode prever
     duas saídas para a mesma praça, e o que interessa aqui é se a praça
     foi contemplada. */
  const rotasMontadas = new Set(vivas.map(m => m.rota_codigo));
  const faltando = modelo.filter(m => !rotasMontadas.has(m.rota_codigo));

  const faixa = document.getElementById('mont-stats');
  if(faixa){
    const caixa = (n, rot, cor) =>
      `<div class="stat-box"${cor ? ` style="--st-cor:${cor}"` : ''}>
         <div class="stat-num">${n}</div><div class="stat-label">${esc(rot)}</div></div>`;
    faixa.innerHTML =
      caixa(vivas.length, 'Cargas montadas')
      + caixa(comPlaca.length, 'Com placa', 'var(--st-embarque-finalizado-bg)')
      + caixa(vivas.length - comPlaca.length, 'Sem placa', 'var(--st-aguardando-embarque-bg)')
      + caixa(efetivadas.length, 'Já na Torre', 'var(--st-faturado-bg)')
      + caixa(faltando.length, 'Rotas do modelo sem carga',
              faltando.length ? 'var(--st-aguardando-veiculo-bg)' : '');
  }

  const aviso = document.getElementById('mont-faltando');
  if(aviso){
    aviso.hidden = !faltando.length;
    if(faltando.length){
      aviso.innerHTML = `<strong>Ainda sem carga montada:</strong> `
        + faltando.map(m => esc(m.rota_nome)).join(' · ');
    }
  }

  /* O BOTÃO DE LOTE. Na sexta são 39 cargas; confirmar uma a uma é o
     pedágio que faz a pessoa desistir e voltar para o Excel. */
  const prontas = vivas.filter(m => m.placa && !m.efetivada_em);
  const btnLote = document.getElementById('mont-btn-lote');
  if(btnLote){
    btnLote.hidden = prontas.length === 0;
    btnLote.textContent = prontas.length === 1
      ? '🚚 Enviar 1 carga para a Torre'
      : `🚚 Enviar as ${prontas.length} prontas para a Torre`;
  }

  /* Mesma fonte do seletor do modelo (ROTAS + rotaLabel): rota cadastrada
     em Cadastros aparece aqui na hora, sem lista paralela para envelhecer. */
  const selExtra = document.getElementById('mont-rota-extra');
  if(selExtra && !selExtra.options.length){
    selExtra.innerHTML = rotasParaEscolher().map(r =>
      `<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
    selExtra.addEventListener('change', () => popularDestinoExtraUI());
  }
  popularDestinoExtraUI();

  const tbody = document.getElementById('mont-tbody');
  const vazio = document.getElementById('mont-empty');
  /* CANCELADA SOME DA TELA — pedido do dono (25/08/2026): "quando uma rota
     e cancelada na montagem do dia, ela precisa desaparecer das linhas, e
     nao ficar la como cancelada".

     Ele tem razao sobre ESTA tela: a montagem e a lista do que VAI rodar
     hoje, e linha cancelada ali e ruido entre as que ainda pedem trabalho.
     Numa sexta de 42 linhas, meia duzia de canceladas empurra para baixo
     justamente as que faltam preencher.

     Some da TELA, nao do banco: a linha continua gravada com o motivo, a
     hora e quem cancelou, e o Historico responde por ela. O Excel apagava
     sem deixar rastro; e isso que este painel existe para acabar. */
  const lista = montagens.filter(m => !m.cancelada_em);
  if(vazio) vazio.hidden = lista.length > 0;
  if(!tbody) return;

  tbody.innerHTML = lista.map(m => linhaMontagemHtml(m)).join('');
}

/* O DESTINO NO TÍTULO, A PRAÇA EMBAIXO (25/08/2026)

   Relato do dono: "nessas das cargas do dia tem várias duplicadas, tão
   saindo duplicadas as rotas".

   Fui conferir contra as cinco planilhas que ele mandou, linha a linha.
   Duas coisas diferentes estavam acontecendo, e só uma é defeito:

   NÃO É DEFEITO — a sexta tem MESMO quatro caminhões para Montes Claros e
   três para Brasília, cada um com número de carga e placa próprios. Copiar
   isso é ser fiel; enxugar seria inventar.

   É DEFEITO — o de-para colapsou destinos DIFERENTES no mesmo código,
   porque a praça cadastrada no painel cobre um circuito inteiro. Na terça,
   Arinos/Buritis, João Pinheiro, Paracatu, Riachinho e Unaí viram todos
   "504". A tela mostrava o nome da PRAÇA em negrito e o destino real em
   letra miúda embaixo — seis linhas com o mesmo título gritado e a
   diferença sussurrada. Quem olha lê seis duplicatas.

   Inverti: o destino da planilha é o título, a praça e o código viram a
   informação de apoio. O dado é o mesmo; o que muda é qual metade a tela
   grita. Onde não há apelido (carga fora do modelo), a praça continua
   sendo o título — não há nada mais específico para mostrar. */
/* A ROTA DA LINHA TAMBÉM SE TROCA NA LINHA (28/08/2026).

   Faz parte do mesmo relato do dono ("ficou faltando os campos rota
   peso..."). Trocar a rota era coisa de reabrir o formulário; na planilha
   antiga era mudar uma célula.

   O APELIDO VIRA ETIQUETA, NÃO TÍTULO. Ele vem do modelo da semana e
   identifica a transportadora dentro da praça ("Triângulo Mineiro - Total
   Service"). Se a pessoa trocar a rota, esse apelido passa a descrever uma
   coisa que não é mais a rota da linha — em negrito, por cima do nome
   certo, ele seria a primeira coisa lida e a errada. Aqui ele aparece
   embaixo, dito como o que é: o que o modelo trouxe.

   Mesma fonte do seletor de carga extra (ROTAS + rotaLabel): rota
   cadastrada em Cadastros aparece aqui na hora, sem lista paralela.  */
function rotaMontagemSelectHtml(m){
  const id = escJs(m.montagem_id);
  const atual = String(m.rota_codigo ?? '');
  // Rota que sumiu do cadastro não pode sumir da linha: sem esta opção o
  // select abriria em branco e a primeira gravação trocaria a rota da
  // carga sem ninguém pedir.
  const conhecida = ROTAS.some(r => String(r.codigo) === atual);
  /* O DESTINO CONTINUA SENDO O TÍTULO (28/08/2026 — segunda tentativa).

     A primeira versão desta função trocou o título pelo seletor, e o
     seletor mostra a PRAÇA. Isso desfez a correção da ocorrência #14: numa
     terça, Arinos/Buritis, João Pinheiro, Paracatu, Riachinho e Unaí são
     todos o código 504 — com a praça no lugar do título, seis linhas
     diferentes voltam a parecer a mesma, que foi o relato "tão saindo
     duplicadas as rotas". O teste pegou antes de ir para o pátio.

     Agora as duas coisas convivem: o destino em cima, em negrito, para
     RECONHECER a linha; o seletor embaixo, para TROCAR a rota. */
  return `${destinoMontagemHtml(m)}
    <select class="rota-inline" aria-label="Trocar a rota desta linha"
        title="Trocar a rota desta linha"
        onchange="alterarRotaMontagemUI('${id}', this.value)">
      ${conhecida ? '' : `<option value="${esc(atual)}" selected>${esc(m.rota_nome || atual)} · ${esc(atual)}</option>`}
      ${rotasParaEscolher().map(r => `<option value="${esc(r.codigo)}"${String(r.codigo)===atual?' selected':''}>${esc(rotaLabel(r.codigo))}</option>`).join('')}
    </select>`;
}

/* Trocar a rota limpa o apelido do modelo: ele pertencia à linha antiga.
   Mandar os dois juntos numa gravação só evita a janela em que a tela
   mostra a rota nova com a etiqueta velha. */
async function alterarRotaMontagemUI(id, codigo){
  try {
    await SuincoSharePoint.montagem.alterar(id, { rotaCodigo: codigo, apelidoRota: '' });
    await carregarMontagemUI();
  } catch(e){
    notify('Não gravou a rota: ' + (e.message || e), 'erro', 7000);
    await carregarMontagemUI();
  }
}

function destinoMontagemHtml(m){
  const praca = `<span class="text-dim mont-praca">${esc(m.rota_nome)} · ${esc(m.rota_codigo)}</span>`;
  return m.apelido_rota
    ? `<strong>${esc(m.apelido_rota)}</strong><div>${praca}</div>`
    : `<strong>${esc(m.rota_nome)}</strong> <span class="text-dim">${esc(m.rota_codigo)}</span>`;
}

/* A LINHA COMO RESUMO, O FORMULÁRIO COMO DETALHE (25/08/2026)

   Pedido do gestor: "cadê os campos pra poder começar a preencher essa
   rota na programação? eu preciso que essas linhas sejam expansíveis e
   quando se expande pode ser criada carga nela normalmente".

   Antes, os campos existiam — como dez inputs espremidos numa linha de
   tabela. Existir e ser usável são coisas diferentes: no celular aquilo
   não cabia, e no desktop faltavam justamente os campos que a Programação
   tem e a montagem não tinha (motorista, observações, o aviso da frota).

   Agora a linha mostra o que a pessoa precisa para RECONHECER a carga
   (sequência, rota, nº, placa, peso) e o clique abre o formulário
   completo, na MESMA ORDEM da aba Programação. Ordem igual não é capricho:
   é a mesma pessoa preenchendo a mesma carga, e duas telas com ordem
   diferente para o mesmo trabalho geram erro de campo trocado. */
let _montagemAberta = null;

function alternarLinhaMontagemUI(id){
  _montagemAberta = (_montagemAberta === id) ? null : id;
  renderMontagem();
  if(_montagemAberta){
    const foco = document.getElementById(`montf-placa-${_montagemAberta}`);
    if(foco) foco.focus();
  }
}

/* Abre a linha JÁ no campo da placa. É o que o botão "Colocar placa"
   promete, e prometer uma coisa e abrir outra é pior que não oferecer. */
function abrirParaColocarPlacaUI(id){
  _montagemAberta = id;
  renderMontagem();
  const campo = document.getElementById(`montf-placa-${id}`);
  if(campo){ campo.focus(); campo.scrollIntoView({ block: 'center' }); }
}

/* QUEM MEXE NA CARGA DO DIA, EM QUALQUER LUGAR (27/08/2026).

   Relato do dono: "o antonio ta tentando mexer nas cargas de hoje pela
   programacao aparece o simbolo de proibido, voce precisa liberar acesso
   pra administracao e logistica e nao bloquear".

   O servidor NUNCA bloqueou: camposEditaveisPor() já dá a lista inteira
   para Logística, e Administração herda ela. A trava era só de tela. */
function podeEditarCargaDoDia(){
  const s = (DB.operador && DB.operador.setor) || '';
  return s === 'Logística' || s === 'Administração';
}

/* Uma célula editável da linha efetivada. Chama a MESMA função que a Fila
   de Programados e a Torre chamam — nada de caminho paralelo: assim a
   alteração cai na carga, entra no log de revisões e sobe para todos os
   setores, em vez de morrer no rascunho da montagem. */
function celulaCargaHtml(carga, tipo){
  const id = escJs(carga.id);
  if(tipo === 'numero'){
    return `<input type="text" class="numero-carga-input" value="${esc(carga.numeroCarga)}"
      onchange="atualizarNumeroCargaUI('${id}',this.value)"
      title="Número da carga — grava na carga que já está na Torre.">`;
  }
  if(tipo === 'placa'){
    return `<input type="text" class="placa-input" value="${esc(carga.placa)}"
      onchange="atualizarPlacaUI('${id}',this.value)"
      title="Trocar a placa. Se o caminhão novo já estiver no pátio, a carga assume a entrada dele.">`;
  }
  if(tipo === 'peso'){
    return `<input type="text" inputmode="numeric" class="peso-input" min="0" step="1" value="${carga.peso ?? ''}"
      onchange="atualizarPesoUI('${id}',this.value)" title="Peso em kg.">`;
  }
  return '';
}

/* AS AÇÕES DA LINHA QUE JÁ VIROU CARGA.

   Aqui não cabe "➕ Criar carga" — a carga já existe, e o botão ofereceria
   criar uma segunda para a mesma linha. Nem "Excluir": cancelar a linha da
   montagem não desfaz a carga que já está na Torre, e um botão que promete
   remover sem remover é pior que não ter botão. Quem precisa tirar a carga
   faz isso na Torre, onde a regra de exclusão vale por inteiro.

   Sobra o que é verdade: a linha virou carga, e a seta diz que ela abre. */
function acoesCargaNaMontagemHtml(aberta){
  return `<div class="mont-acoes"><span class="text-dim">virou carga</span>
    <span class="mont-seta${aberta ? ' aberta' : ''}" aria-hidden="true">▸</span></div>`;
}

/* O FORMULÁRIO COMPLETO DA LINHA QUE JÁ VIROU CARGA (27/08/2026).

   Relato do dono, no mesmo dia em que a linha efetivada foi destravada:

     "o tonin nao consegue mais abrir a carga e editar detalhadamente cada
      carga, quantidade de entrega, ganchos, isso precisa ser expansivel e
      nao pode faltar onde colocar"

   Erro meu, e da minha própria mudança: ao transformar a linha efetivada em
   janela para a carga, eu troquei o formulário de DOZE campos por três
   células na linha (número, placa, peso). Quem montava a carga perdeu
   Motorista, Tipo de Operação, Paletizada, Ganchos, Entregas e Observações
   — justamente os campos que só existem no formulário.

   Agora a linha abre de novo, com a MESMA ORDEM e o MESMO desenho do
   formulário da montagem (`formMontagemHtml`), campo por campo. Ordem igual
   não é capricho: é a mesma pessoa preenchendo a mesma carga, e duas telas
   com ordem diferente para o mesmo trabalho geram erro de campo trocado.

   A diferença é para onde cada campo grava: aqui tudo chama as MESMAS
   funções da Fila de Programados e da Torre, então a alteração cai na
   CARGA, entra no log de revisões do servidor e sobe para todos os setores
   — em vez de morrer no rascunho da montagem, que depois de efetivado é
   histórico e o servidor recusa com 409 JA_EFETIVADA.

   ROTA continua sem edição aqui, pelo mesmo motivo de sempre: a linha
   nasceu de uma rota do modelo do dia, e trocá-la transformaria "a segunda
   saída de Patos" em outra coisa sem ninguém perceber. Mas o campo NÃO fica
   só negando — ele diz onde se troca. */
function formCargaHtml(c, m){
  const id = escJs(c.id);
  const frota = c.placa ? buscarFrota(c.placa) : null;
  return `
    <div class="mont-form">
      <div class="mont-form-tit">${esc(m.apelido_rota || m.rota_nome)}
        <span class="text-dim" style="font-weight:400">
          ${m.apelido_rota ? esc(m.rota_nome) + ' · ' : ''}${esc(m.rota_codigo)}</span></div>

      <div class="form-group" style="margin-bottom:10px">
        <span class="text-dim">✅ Esta linha já virou carga. O que você mudar aqui grava na
        CARGA — aparece na Torre de Controle, nos relatórios e para os outros setores, com
        registro de quem mudou.</span></div>

      <div class="form-row">
        <div class="form-group">
          <label>Placa</label>
          <input type="text" id="montf-placa-${esc(m.montagem_id)}" value="${esc(c.placa)}"
                 placeholder="ABC1D23" autocomplete="off"
                 onchange="atualizarPlacaUI('${id}', this.value)"></div>
        <div class="form-group">
          <label>Transportadora <span class="hint">(da Frota — dá para trocar)</span></label>
          <input type="text" list="lista-transportadoras" value="${esc(c.transportadora)}"
                 placeholder="vem da placa"
                 onchange="atualizarTransportadoraUI('${id}',this.value)"></div>
        <div class="form-group">
          <label>Tipo de Veículo <span class="hint">(da Frota)</span></label>
          <input type="text" value="${esc(c.tipoVeiculo || (frota ? frota.tipoVeiculo : ''))}"
                 placeholder="vem da placa" disabled></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Número de Carga</label>
          <input type="text" value="${esc(c.numeroCarga)}" placeholder="Ex: 10245"
                 onchange="atualizarNumeroCargaUI('${id}',this.value)"></div>
        <div class="form-group"><label>Motorista</label>
          <input type="text" value="${esc(c.motorista)}" placeholder="Nome do motorista"
                 onchange="atualizarMotoristaUI('${id}',this.value)"></div>
        <div class="form-group"><label>Tipo de Operação</label>
          ${praOndeSelectHtml(c)}</div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Peso (kg)</label>
          <input type="text" inputmode="numeric" min="0" value="${c.peso ?? ''}"
                 onchange="atualizarPesoUI('${id}',this.value)"></div>
        <div class="form-group">
          <label>Sequência <span class="hint">(prioridade de montagem do dia)</span></label>
          <input type="text" inputmode="numeric" min="1" value="${c.sequencia ?? ''}"
                 onchange="atualizarSequenciaUI('${id}',this.value)"></div>
        <div class="form-group"><label>Paletizada?</label>
          ${paletizadaSelectHtml(c)}</div>
      </div>

      <div class="form-row">
        ${/* Ver a nota em formMontagemHtml: os dois campos ficam na linha E
              aqui, porque gravam na MESMA carga pela mesma função — e porque
              já sumiram daqui uma vez, o que virou guarda de teste. */''}
        <div class="form-group">
          <label>Qtd. Ganchos (Gancheira) <span class="hint">0 = Liso</span></label>
          <input type="text" inputmode="numeric" min="0" step="1" value="${c.qtdGanchos ?? 0}"
                 onchange="atualizarGanchosUI('${id}',this.value)"></div>
        <div class="form-group"><label>Qtd. Entregas</label>
          <input type="text" inputmode="numeric" min="1" step="1" value="${c.qtdEntregas ?? 1}"
                 onchange="atualizarEntregasUI('${id}',this.value)"></div>

        <div class="form-group">
          <label>Rota <span class="hint">(vem do modelo do dia)</span></label>
          <input type="text" value="${esc(rotaCurta(c.rota))}" disabled
                 title="A rota desta linha veio do modelo do dia. Para trocar, altere na Fila de Programados ou cancele a linha e puxe a rota certa."></div>
      </div>

      <div class="form-group" style="margin-bottom:10px"><label>Observações</label>
        <textarea onchange="atualizarObservacoesUI('${id}',this.value)"
          placeholder="O que a operação precisa saber sobre esta carga">${esc(c.observacoes)}</textarea></div>

      <div class="flex-end gap8">
        <button class="btn btn-sec btn-sm"
          onclick="alternarLinhaMontagemUI('${escJs(m.montagem_id)}')">Fechar</button>
      </div>
    </div>`;
}

/* O DESTINO NA LINHA DA MONTAGEM.

   Mesma lista de Cadastros → Tabela de Frete que a Programação usa, pela
   MESMA constante (DESTINOS_FRETE). Duas listas seriam duas verdades sobre
   para onde a carga vai.

   Escolher o destino não preenche o KM aqui na tela: quem resolve a
   distância é o SERVIDOR, a partir do cadastro, e ele devolve na leitura
   seguinte. Preencher pelo painel abriria a porta para o número da tela
   divergir do número que o frete usou. */
function freteDestinoMontagemHtml(m, id){
  const atual = m.frete_destino || '';
  /* NOMES, não objetos. DESTINOS_FRETE guarda {destino, km}; a célula lista
     o nome e o KM fica com o servidor, que o resolve pelo cadastro. */
  const lista = destinosFreteOrdenados().map(d => String(d.destino));
  /* Destino que saiu do cadastro (desativado, renomeado) continua na linha
     que já o tinha: sumir da lista apagaria em silêncio o destino de uma
     carga montada ontem. */
  const opcoes = atual && !lista.includes(atual) ? [atual, ...lista] : lista;
  return `<select class="destino-inline" aria-label="Destino do frete"
                  title="Destino da tabela de frete — define o KM"
                  onchange="alterarMontagemUI('${id}','freteDestino',this.value)">
            <option value=""${!atual ? ' selected' : ''}>—</option>
            ${opcoes.map(d=>`<option${atual===d?' selected':''}>${esc(d)}</option>`).join('')}
          </select>`;
}

/* O VALOR DO FRETE É SÓ LEITURA, E VEM DO SERVIDOR.

   Não há conta nenhuma aqui — `frete_valor` chega calculado na leitura do
   dia, pela mesma calcularFrete() do domínio que as cargas usam. Repetir a
   fórmula no painel daria dois lugares para o preço do km divergir.

   Quando não há valor, a célula diz POR QUE não há, em vez de ficar vazia:
   célula vazia ao lado de um destino é lida como "o sistema não sabe", e
   manda alguém perguntar. `frete_motivo` vem do servidor com a frase. */
function reais(n){
  return Number(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

/* O FRETE AGORA É EDITÁVEL — E O CALCULADO CONTINUA À VISTA (18/09/2026).

   RELATO DO DONO: "o campo frete ainda nao ta editavel". Ele tinha pedido
   em 17/09 e eu não implementei — a migração ficou escrita e parada.

   A CONTA CONTINUA SENDO DO SERVIDOR. Não há fórmula nenhuma aqui: o campo
   manda o que a pessoa digitou e o dia volta relido. Repetir `km × tarifa`
   no painel daria dois lugares para o preço divergir, que é a regra da casa
   que este projeto mais paga caro quando quebra.

   O QUE A CÉLULA MOSTRA, e por quê:

     · sem combinado  — o valor calculado, como antes, e o campo vazio com
                        ele de dica: quem não negociou nada não digita nada;
     · com combinado  — o valor digitado, marcado com ✎, e o calculado
                        embaixo em cinza. A conferência compara os dois em
                        vez de perder a tabela;
     · KM mudou depois — a linha AVISA. É a decisão (a) do dono: o valor
                        digitado fica, e a linha diz que foi fechado em
                        outra quilometragem. Sem esse aviso, um combinado de
                        583 km seguiria calado numa viagem de 640.

   APAGAR O CAMPO DESFAZ: volta a valer o calculado. Sem isso, um valor
   digitado por engano ficaria para sempre. */
function freteMontagemHtml(m, carga){
  if(carga){
    const v = carga.freteValor;
    return (v === null || v === undefined || v === '')
      ? `<span class="text-dim" title="${esc(m.frete_motivo || 'Sem valor de frete.')}">—</span>`
      : `<strong>R$ ${reais(v)}</strong>`;
  }
  const id = escJs(m.montagem_id);
  const manual = !!m.frete_e_manual;
  const calculado = m.frete_valor_calculado;
  const temCalculado = calculado !== null && calculado !== undefined && calculado !== '';
  const dica = temCalculado ? `R$ ${reais(calculado)}` : (m.frete_motivo || 'sem valor');

  /* A COLUNA TEM 60px, E ISSO NÃO É DESCUIDO — é medida.
     A largura de cada coluna desta tabela foi calculada para o dia inteiro
     caber num monitor de 1280 sem rolagem lateral, e há teste guardando
     (test_montagem_cabe_em_colunas). Então o que é NÚMERO fica na célula e
     o que é EXPLICAÇÃO fica no title: mostrar o calculado numa segunda
     linha cortava o valor no meio — e número de dinheiro cortado é pior que
     número ausente, porque parece completo. */
  const explicacao = manual
    ? `Frete combinado à mão${m.frete_manual_por ? ' por ' + m.frete_manual_por : ''}.`
      + (temCalculado ? ` Pela tabela seriam R$ ${reais(calculado)}.` : '')
      + ' Apague o campo para voltar ao calculado.'
    : `Frete calculado: ${kmTexto(m.km_deslocamento) || '—'} km × tarifa.`
      + ' Digite aqui para gravar um valor combinado.';

  const campo = `<input type="text" inputmode="decimal" class="frete-input"
      value="${manual ? reais(m.frete_valor) : ''}"
      placeholder="${esc(temCalculado ? reais(calculado) : (m.frete_motivo ? 'sem valor' : ''))}"
      aria-label="Valor do frete"
      title="${esc(explicacao)}"
      onchange="definirFreteManualMontagemUI('${id}', this.value)">`;

  if(!manual) return campo;

  /* O ⚠ é o único que ganha espaço próprio, e ganha porque significa
     dinheiro errado: o valor foi fechado numa quilometragem e a linha está
     em outra. Decisão (a) do dono — o combinado fica, mas não fica calado. */
  const aviso = m.frete_km_mudou
    ? `<span class="frete-aviso" title="Combinado com ${esc(kmTexto(m.frete_manual_km))} km; `
      + `a linha está com ${esc(kmTexto(m.km_deslocamento) || '—')} km — o frete não acompanhou.">⚠</span>`
    : '';
  return `${campo}<span class="frete-marca" title="${esc(explicacao)}">✎</span>${aviso}`;
}

/* O valor vai cru para o servidor, que é quem lê vírgula e ponto — uma
   função, um lugar. Ler aqui também daria duas réguas para o mesmo número. */
async function definirFreteManualMontagemUI(id, valor){
  try {
    await SuincoSharePoint.montagem.alterar(id, { freteValorManual: String(valor ?? '') });
    await carregarMontagemUI();
  } catch(e){
    notify(e && e.message ? e.message : 'Não consegui gravar o valor do frete.', 'erro', 8000);
    await carregarMontagemUI();
  }
}

function linhaMontagemHtml(m){
  /* CANCELADA continua trancada: ela é histórico e não tem carga viva do
     outro lado. EFETIVADA deixa de trancar para quem pode editar — a
     linha passa a ser uma janela para a carga, não um retrato dela. */
  const cargaViva = (m.efetivada_em && m.carga_id) ? getCarga(m.carga_id) : null;
  const comoCarga = !!cargaViva && podeEditarCargaDoDia();
  const trancada = !!m.cancelada_em || (!!m.efetivada_em && !comoCarga);
  const id = escJs(m.montagem_id);
  /* A LINHA EFETIVADA VOLTA A ABRIR (27/08/2026). O `&& !comoCarga` que
     estava aqui era o defeito relatado pelo dono: ela ficava clicável e não
     abria nada, e os campos que só existem no formulário sumiam da tela. */
  const aberta = _montagemAberta === m.montagem_id && !trancada;
  const marca = m.cancelada_em
    ? `<span class="badge badge-aguardando-veiculo">CANCELADA</span>`
    : m.efetivada_em ? `<span class="badge badge-faturado">NA TORRE</span>` : '';

  /* `mont-linha-carga` marca a linha que JÁ virou carga e continua
     editável. Ela não é "linha-fraca" (não está trancada) nem uma linha em
     montagem (não tem "Criar carga"): é uma terceira situação, e sem uma
     classe própria a tela e os testes só conseguem descrevê-la por
     ausência — foi assim que a checagem "toda linha traz uma ação de
     avanço" passou a contar uma linha que, com razão, não tem nenhuma. */
  /* `cartao-aberto` NASCE NO REDESENHO (11/09/2026). No celular os campos
     secundários só aparecem com esta classe, e quem a ligava era o ouvinte
     de toque do document — que aqui chegava tarde: o onclick da linha já
     tinha redesenhado o tbody, e a classe caía num <tr> destacado do DOM.
     Resultado medido: a coluna Seq. ficava escondida para sempre, e
     reordenar de celular não existia. O estado (`aberta`) é quem sabe se o
     cartão está aberto; ele desenha a classe. Mesma decisão na Fila. */
  const resumo = `<tr class="mont-linha${trancada ? ' linha-fraca' : ''}${comoCarga ? ' mont-linha-carga' : ''}${aberta ? ' mont-linha-aberta cartao-aberto' : ''}"
      data-id="${id}"
      ${/* ARRASTÁVEL SÓ ENQUANTO É RASCUNHO (10/09/2026). Depois de virar
           carga o número é registro — e a mesma regra vale para a alça,
           que some junto. */''}
      ${(!m.efetivada_em && !m.cancelada_em) ? `draggable="true"
        ondragstart="montArrastarInicio(event,'${id}')"
        ondragover="montArrastarSobre(event)"
        ondrop="montArrastarSolta(event,'${id}')"
        ondragend="montArrastarFim()"` : ''}
      ${trancada ? '' : `onclick="alternarLinhaMontagemUI('${id}')" title="Clique para abrir os campos desta carga"`}>
      <!-- SEQUENCIA EDITAVEL NA LINHA — pedido do dono (25/08/2026):
           "o campo sequencia precisa estar disponivel para edicao e
           organizacao de sequencia tambem".

           Ordenar o dia e trabalho de VARREDURA: a pessoa olha as 42
           linhas e decide quem carrega primeiro. Abrir cada formulario
           para mexer num numero e o que fazia isso ser feito no Excel.
           O stopPropagation impede que digitar abra/feche a linha. -->
      <td onclick="event.stopPropagation()">
        ${/* A ALÇA SÓ APARECE ONDE ARRASTAR FUNCIONA (10/09/2026).
              Linha já efetivada ou cancelada não reordena ninguém — o
              número dela é registro. Mostrar a alça ali seria oferecer um
              gesto que o servidor vai recusar, e botão que promete e nega
              é pior que botão que não existe. */''}
        ${(!m.efetivada_em && !m.cancelada_em)
            ? `<span class="alca-arrastar" title="Arraste para mudar a posição do dia">⠿</span>` : ''}
        <input type="text" inputmode="numeric" min="1" class="seq-input" value="${comoCarga ? (cargaViva.sequencia ?? '') : (m.sequencia ?? '')}"
               aria-label="Sequência"
               title="${(!m.efetivada_em && !m.cancelada_em)
                 ? 'Digite a posição: a linha entra nela e as outras descem uma casa.'
                 : 'Esta linha já virou carga — o número é registro e NÃO reordena a fila.'}"
               onchange="${comoCarga
                 ? `atualizarSequenciaUI('${escJs(cargaViva.id)}',this.value)`
                 : `definirSequenciaMontagemUI('${id}',this.value)`}"></td>
      ${/* AS MESMAS COLUNAS DA TORRE E DA FILA (28/08/2026). Quando a linha
            já virou carga, cada célula grava na CARGA; enquanto é rascunho,
            grava na montagem. Mesma tela, mesmo lugar, dono diferente — e o
            dono certo, que é o que impede a alteração de morrer no rascunho. */''}
      ${/* NÚMERO, PLACA E PESO SE DIGITAM NA PRÓPRIA LINHA (28/08/2026).

            Relato do dono, com foto da tela de hoje: "ficou faltando os
            campos rota peso numero de carga, veiculo ta aparecendo sem
            placa, porque nao estao editaveis???".

            Estas três células eram TEXTO enquanto a linha era rascunho:
            mostravam "—" e não recebiam nada. O único campo que aceitava
            digitação na linha era o de Motorista — e foi exatamente lá que
            as placas do dia foram parar (RNT5J03, RNV2A77...), porque era
            o único lugar onde dava para escrever. Coluna que mostra um
            traço e não aceita o dado ensina a pessoa a guardá-lo no campo
            errado.

            O servidor já aceitava os quatro campos desde sempre; faltava a
            tela oferecer. */''}
      <td onclick="event.stopPropagation()">${comoCarga
            ? celulaCargaHtml(cargaViva, 'numero')
            : `<input type="text" class="numero-carga-input" value="${esc(m.numero_carga)}"
                      placeholder="—" aria-label="Número da carga"
                      onchange="alterarMontagemUI('${id}','numeroCarga',this.value)">`}</td>
      <td class="cel-veiculo" onclick="event.stopPropagation()">${comoCarga
            ? celulaCargaHtml(cargaViva, 'placa')
            : `<input type="text" class="placa-input" value="${esc(m.placa)}"
                      list="lista-placas-frota" placeholder="sem placa" autocomplete="off"
                      aria-label="Placa do veículo"
                      onchange="definirPlacaMontagemUI('${id}', this.value)">`}
        <span class="veic-transp">${esc(comoCarga ? cargaViva.transportadora
            : (m.transportadora || (m.placa && buscarFrota(m.placa) ? buscarFrota(m.placa).transportadora : ''))) || '—'}</span>
        <span class="veic-tipo">${esc(comoCarga ? cargaViva.tipoVeiculo
            : (m.placa && buscarFrota(m.placa) ? buscarFrota(m.placa).tipoVeiculo : '')) || '—'}</span></td>
      <td onclick="event.stopPropagation()">
        <input type="text" class="motorista-input" value="${esc(comoCarga ? (cargaViva.motorista||'') : (m.motorista||''))}"
               aria-label="Motorista"
               onchange="${comoCarga
                 ? `atualizarMotoristaUI('${escJs(cargaViva.id)}',this.value)`
                 : `alterarMontagemUI('${id}','motorista',this.value)`}"></td>
      <td ${comoCarga ? '' : 'onclick="event.stopPropagation()"'}>${comoCarga
            ? `${destinoMontagemHtml(m)} ${marca}`
            : `${rotaMontagemSelectHtml(m)} ${marca}`}</td>
      <td onclick="event.stopPropagation()">${comoCarga
            ? celulaCargaHtml(cargaViva, 'peso')
            : `<input type="text" inputmode="numeric" min="0" class="peso-input" value="${m.peso ?? ''}"
                      placeholder="—" aria-label="Peso em quilos"
                      onchange="alterarMontagemUI('${id}','peso',this.value)">`}</td>

      <td onclick="event.stopPropagation()">${comoCarga
            ? paletizadaSelectHtml(cargaViva)
            : `<select class="palet-inline" onchange="alterarMontagemUI('${id}','paletizada',this.value)">
                 ${['Não','Sim'].map(op=>`<option value="${op}" ${(m.paletizada||'Não')===op?'selected':''}>${op}</option>`).join('')}
               </select>`}</td>
      <td onclick="event.stopPropagation()">${comoCarga
            ? praOndeSelectHtml(cargaViva)
            : `<select class="praonde-inline" onchange="alterarMontagemUI('${id}','tipoOperacao',this.value)">
                 <option value=""${!m.tipo_operacao ? ' selected' : ''}>—</option>
                 ${PRA_ONDE_OPCOES.map(o=>`<option${m.tipo_operacao===o?' selected':''}>${esc(o)}</option>`).join('')}
               </select>`}</td>
      ${/* GANCHOS E ENTREGAS NA LINHA — pedido do dono (31/08/2026):
            "ta faltando o campo de quantidade de entregar e quantidade de
            ganchos igual na torre, precisa aparecer na programacao do dia"
            e "precisa aparecer e funcionar".

            O servidor já aceitava os dois no PATCH da montagem e a tabela já
            tinha `qtd_entregas` e `qtd_ganchos` desde a migração que criou a
            montagem — faltava só a tela oferecer. Mesma história das quatro
            colunas de 28/08: o dado tinha onde morar e ninguém tinha onde
            digitar.

            Como nas outras: virou carga, grava na CARGA (que tem log de
            revisões); ainda rascunho, grava na montagem. */''}
      <td class="c-ganchos" onclick="event.stopPropagation()">${comoCarga
            ? `<input type="text" inputmode="numeric" class="ganchos-input" min="0" step="1"
                      value="${cargaViva.qtdGanchos ?? 0}" aria-label="Ganchos"
                      title="Ganchos — 0 = Liso"
                      onchange="atualizarGanchosUI('${escJs(cargaViva.id)}',this.value)">`
            : `<input type="text" inputmode="numeric" class="ganchos-input" min="0" step="1"
                      value="${m.qtd_ganchos ?? 0}" aria-label="Ganchos"
                      title="Ganchos — 0 = Liso"
                      onchange="alterarMontagemUI('${id}','qtdGanchos',this.value)">`}</td>
      <td class="c-entregas" onclick="event.stopPropagation()">${comoCarga
            ? `<input type="text" inputmode="numeric" class="entregas-input" min="1" step="1"
                      value="${cargaViva.qtdEntregas ?? 1}" aria-label="Entregas"
                      title="Quantidade de entregas."
                      onchange="atualizarEntregasUI('${escJs(cargaViva.id)}',this.value)">`
            : `<input type="text" inputmode="numeric" class="entregas-input" min="1" step="1"
                      value="${m.qtd_entregas ?? 1}" aria-label="Entregas"
                      title="Quantidade de entregas."
                      onchange="alterarMontagemUI('${id}','qtdEntregas',this.value)">`}</td>

      ${/* DESTINO, KM E FRETE NA LINHA (10/09/2026).
           Relato do dono: "quando adiciona a linha ela nao aparece o
           destino"; e o pedido: "montagem do dia precisa seguir com destino
           valor de frete".

           VIROU CARGA, MOSTRA A CARGA. Depois de efetivada, quem manda é o
           registro da carga — que tem trilha de revisões e valor congelado.
           A linha vira leitura, como já acontece com peso e paletizada. */''}
      <td class="c-destino" onclick="event.stopPropagation()">${comoCarga
            ? `<span title="Destino da carga">${esc(cargaViva.freteDestino || '—')}</span>`
            : freteDestinoMontagemHtml(m, id)}</td>

      <td class="c-kmdesl" onclick="event.stopPropagation()">${comoCarga
            /* DEPOIS DE VIRAR CARGA, O KM CONTINUA CORRIGÍVEL (14/09/2026).

               Pedido do dono: "o valor do destino nunca será exatamente o
               esperado, sempre haverá um ajuste a mais ou a menos (...)
               libere essa funcionalidade para que possamos ser mais
               assertivos".

               A gravação vai para a CARGA, não para a linha de montagem —
               que congela em `efetivada_em` justamente para que a correção
               passe por onde existe log de revisões. É o caminho que o
               próprio servidor mandava seguir e que nenhuma tela oferecia.

               Quem não corrige continua vendo o número, em texto: é dado
               de conferência para a Portaria e a Expedição, não campo. */
            ? (podeCorrigirKmDaCargaUI()
              ? `<input type="text" inputmode="decimal" class="km-input"
                        value="${kmTexto(cargaViva.kmDeslocamento)}" aria-label="KM de deslocamento"
                        placeholder="${kmTexto(cargaViva.kmDestino) || '—'}"
                        title="KM que o frete usa. Corrigir aqui recalcula o valor e fica registrado em Histórico."
                        onwheel="this.blur()"
                        onchange="corrigirKmDaCargaUI('${escJs(cargaViva.id)}',this.value)">`
              : `<span title="KM de deslocamento">${kmTexto(cargaViva.kmDeslocamento) || '—'}</span>`)
            /* `onwheel` tira o foco ANTES de a roda escrever (14/09/2026).
               Esconder a setinha no CSS não resolve isto: num `type=number`
               com foco, a roda do mouse altera o valor. A Montagem é tabela
               larga, rolada com a roda — passar por cima do KM já escolhido
               mudava a quilometragem sem ninguém digitar, e o frete é KM ×
               tarifa. `inputmode` mantém o teclado numérico no celular. */
            : `<input type="text" inputmode="decimal" class="km-input"
                      value="${kmTexto(m.km_deslocamento)}" aria-label="KM de deslocamento"
                      placeholder="${kmTexto(m.km_destino) || '—'}"
                      title="KM que o frete usa. Vem do destino e pode ser corrigido — desvio, retorno, coleta no caminho."
                      onwheel="this.blur()"
                      onchange="alterarMontagemUI('${id}','kmDeslocamento',kmValidoLocal(this.value) ?? this.value)">`}</td>

      <td class="c-frete cel-num">${freteMontagemHtml(m, comoCarga ? cargaViva : null)}</td>

      <td class="no-print">${trancada
            ? acoesMontagemHtml(m, trancada)
            : comoCarga ? acoesCargaNaMontagemHtml(aberta)
            : acoesLinhaMontagemHtml(m, aberta)}</td>
    </tr>`;

  if(!aberta) return resumo;
  return resumo + `<tr class="mont-detalhe"><td colspan="14">${
    comoCarga ? formCargaHtml(cargaViva, m) : formMontagemHtml(m)}</td></tr>`;
}

/* O DIA EM PLANILHA — para o registro que a Suinco sempre teve.

   Pedido do dono (25/08/2026): "quero poder exportar por dia tudo isso no
   formato excel para seguir o padrão que era antes pelo menos para
   registro, ou relatório de rota do dia".

   O painel substituiu a planilha na OPERAÇÃO, e isso é o ponto dele: a
   planilha também era o ARQUIVO. Quem precisa responder "como foi o dia 21"
   daqui a seis meses abria o arquivo daquele dia. Tirar isso sem repor
   troca um problema por outro.

   CSV com ponto-e-vírgula e BOM, não .xlsx: é o que o Excel em português
   abre com duplo clique e colunas separadas, sem biblioteca nova dentro do
   painel — e o painel é um arquivo só, sem CDN. O BOM não é detalhe: sem
   ele o Excel pt-BR abre "Ç" como lixo, o que já apareceu em campo.

   As colunas seguem a ORDEM DA PLANILHA ANTIGA (Sequência, Carga, Rota,
   Pra onde, Placa, Transportadora, Perfil, Peso, Paletizada), com as que
   o painel acrescentou no fim. Quem abrir vai reconhecer o arquivo. */
async function exportarMontagemDoDiaUI(){
  if(!_montagemDia){ notify('Escolha o dia primeiro.', 'erro', 4000); return; }
  const { dia, montagens } = _montagemDia;
  const vivas = montagens.filter(m => !m.cancelada_em);
  if(!vivas.length){
    notify('Não há cargas montadas neste dia para exportar.', 'warn', 5000);
    return;
  }
  const frotaDe = (placa) => (placa ? buscarFrota(placa) : null) || {};
  const linhas = vivas.map(m => {
    const f = frotaDe(m.placa);
    return [
      m.sequencia ?? '',
      m.numero_carga || '',
      m.apelido_rota || m.rota_nome || '',
      m.tipo_operacao || '',
      m.placa || '',
      /* A transportadora do DIA na frente da do cadastro. Se o arquivo do
         dia mostrasse sempre a da Frota, a exceção que alguém registrou de
         propósito (subcontratação, freteiro) sumiria justamente no papel
         que existe para ser o registro — e quem conferisse o frete seis
         meses depois leria o transportador errado. */
      m.transportadora || f.transportadora || '',
      f.tipoVeiculo || '',
      // Vírgula decimal: é o que o Excel pt-BR entende como número.
      m.peso ? String((Number(m.peso) / 1000).toFixed(1)).replace('.', ',') : '',
      m.paletizada || '',
      m.qtd_entregas ?? '',
      m.qtd_ganchos ?? '',
      m.rota_codigo || '',
      m.motorista || '',
      m.observacoes || '',
      /* O desfecho no papel: sem ele, o arquivo do dia não distingue a
         carga que rodou da que ficou só planejada. */
      m.efetivada_em ? 'Na Torre' : (m.placa ? 'Com placa' : 'Sem placa'),
    ];
  });
  baixarCsvDoDia(`Programacao_${dia}`, [
    'Sequência', 'Carga', 'Rota', 'Pra onde?', 'Placa', 'Transportadora',
    'Perfil', 'Peso (t)', 'Paletizada', 'Entregas', 'Ganchos',
    'Código da rota', 'Motorista', 'Observações', 'Situação',
  ], linhas,
  // "Perfil" é o tipo de veículo — é por ela que o 3/4 entra aqui.
  ['Carga', 'Rota', 'Pra onde?', 'Placa', 'Transportadora', 'Perfil',
   'Paletizada', 'Código da rota', 'Motorista', 'Observações', 'Situação']);
}

/* Mesmo escapamento e mesmo BOM de baixarCsvCadastro — separado só porque
   o nome do arquivo é outro (o dia, não o cadastro) e porque este some se
   alguém mexer nos cadastros amanhã. */
function baixarCsvDoDia(nome, cabecalhos, linhas, colunasDeTexto){
  const corpo = corpoCsv(cabecalhos, linhas, colunasDeTexto);
  const blob = new Blob(['\ufeff' + corpo], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Suinco_${nome}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  notifyGravacao(`Programação do dia exportada: ${linhas.length} carga(s).`);
}

/* CARGA FORA DO MODELO — porque frete extra não é exceção rara.

   O modelo cobre a semana típica. Cliente novo, reforço de última hora e
   carga que a fábrica soltou depois do fechamento acontecem toda semana, e
   sem uma porta para eles a Logística sai desta tela e cria a carga na aba
   de cima — o dia deixa de estar todo num lugar só, e a contagem de "rotas
   do modelo sem carga" passa a mentir.

   A linha nasce SEM apelido de rota: ela não veio de planilha nenhuma, e
   inventar um apelido faria uma carga avulsa parecer parte do template na
   hora de conferir o dia. */
/* O SELETOR DE DESTINO ACOMPANHA A ROTA ESCOLHIDA.

   Rota com um destino só já vem marcada — não se faz ninguém escolher entre
   uma opção. Rota com vários começa VAZIA e obriga a escolha: é o ponto do
   pedido do dono, e preencher o primeiro da lista seria a mesma adivinhação
   que ele reclamou.

   Rota sem destino conhecido diz isso em voz alta, com o caminho para
   resolver. Campo desabilitado que só nega é o que a casa não faz. */
function popularDestinoExtraUI(){
  const selRota = document.getElementById('mont-rota-extra');
  const selDest = document.getElementById('mont-destino-extra');
  const hint = document.getElementById('mont-destino-hint');
  if(!selRota || !selDest) return;
  const rota = selRota.value;
  const destinos = destinosDaRota(rota);
  /* A TABELA DE FRETE TAMBÉM ENTRA (29/09/2026). O dono: "precisamos às
     vezes colocar destinos novos e fazer o cálculo, e isso está nos
     impedindo". A lista vinha só do modelo e do cadastro da ROTA — o
     destino que a Logística acabou de cadastrar na Tabela de Frete não
     aparecia aqui. Agora vem num grupo próprio, sem repetir o que a rota
     já lista (test_destino_novo_em_todo_lugar.py). */
  const jaNaRota = new Set(destinos.map(destinoFreteNormalizado));
  const daTabela = destinosFreteOrdenados().map(d => String(d.destino))
    .filter(d => !jaNaRota.has(destinoFreteNormalizado(d)));
  const grupoTabela = daTabela.length
    ? `<optgroup label="Tabela de Frete">${daTabela.map(d =>
        `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</optgroup>`
    : '';
  if(!destinos.length){
    selDest.innerHTML = `<option value="">${daTabela.length ? '— escolha o destino —' : '(sem destino cadastrado)'}</option>`
      + grupoTabela;
    if(hint) hint.textContent = daTabela.length
      ? '— esta rota não tem cidades próprias; escolha na Tabela de Frete'
      : '— cadastre o destino em Cadastros → Tabela de Frete';
    return;
  }
  const unico = destinos.length === 1;
  const daRota = destinos.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  selDest.innerHTML = (unico ? '' : '<option value="">— escolha a cidade —</option>')
    + (grupoTabela ? `<optgroup label="Cidades da rota">${daRota}</optgroup>${grupoTabela}` : daRota);
  if(hint){
    hint.textContent = unico ? '' : `${destinos.length} destinos nesta rota`;
  }
}

async function adicionarCargaForaDoModeloUI(){
  if(!_montagemDia){ notify('Escolha o dia primeiro.', 'erro', 4000); return; }
  const rota = (document.getElementById('mont-rota-extra') || {}).value;
  if(!rota){ notify('Escolha a rota da carga.', 'erro', 4000); return; }
  /* O DESTINO É OBRIGATÓRIO QUANDO A ROTA TEM MAIS DE UM (21/09/2026).
     Deixar passar em branco recria o defeito relatado: a linha nasceria com
     "Alto Paranaíba" e ninguém saberia se vai para Paracatu ou para Unaí. */
  const destinos = destinosDaRota(rota);
  const destino = (document.getElementById('mont-destino-extra') || {}).value || '';
  if(destinos.length > 1 && !destino){
    notify(`A rota ${rotaCurta(rota)} atende ${destinos.length} destinos. Escolha a cidade.`,
           'erro', 6000);
    return;
  }
  const { dia } = _montagemDia;
  try {
    /* SEM NÚMERO NO PEDIDO (11/09/2026). Quem acha a casa livre é o
       servidor, dentro da trava do dia. `montagens.length + 1` parecia a
       próxima casa e não era: dia com linha cancelada ou já reordenada tem
       buraco, e contar linhas acertava um número que já existia. */
    await SuincoSharePoint.montagem.criar({
      dia, rotaCodigo: rota,
      /* MESMO CAMPO QUE O MODELO USA. A linha avulsa passa a se parecer com
         uma linha de modelo da mesma cidade — que é o pedido. O que separa
         avulsa de modelo continua sendo o `modelo_id`, não o apelido. */
      apelidoRota: destino,
      /* Destino que está na Tabela de Frete já vira o destino do FRETE da
         linha: o servidor acha o KM e calcula o valor na hora, em vez de a
         linha nascer sem KM esperando alguém escolher de novo na célula. */
      ...(destino && kmDoDestino(destino) !== null
        ? { freteDestino: destinoFreteNormalizado(destino) } : {}),
      qtdEntregas: 1, paletizada: 'Não',
    });
  } catch(e){
    notify('Não consegui adicionar: ' + (e && e.message || e), 'erro', 8000);
    return;
  }
  await carregarMontagemUI();
  /* Abre a linha nova na hora: quem clicou em "adicionar" vai preencher
     agora, e procurar a linha recém-criada numa lista de 39 é trabalho
     que a tela pode poupar. */
  const nova = (_montagemDia?.montagens || [])
    .filter(m => m.rota_codigo === rota && !m.efetivada_em && !m.cancelada_em).pop();
  if(nova){
    _montagemAberta = nova.montagem_id;
    renderMontagem();
    const foco = document.getElementById(`montf-placa-${nova.montagem_id}`);
    if(foco) foco.focus();
  }
  notify(`Linha de ${destino || rotaCurta(rota)} adicionada ao dia.`, 'ok', 4000);
}

/* O BOTÃO DE CRIAR CARGA MORA NA LINHA, não só dentro do formulário.

   Eu tinha movido as ações para dentro do formulário quando a linha virou
   expansível, e isso foi um retrocesso: numa sexta de 39 cargas, mandar
   uma para a Torre passava a exigir abrir a linha, clicar, e a linha
   fechar sozinha. Três passos para o que era um.

   O formulário é para PREENCHER; a linha é para AGIR. As duas coisas
   convivem, e sem placa a linha não nega o clique: oferece o passo que
   falta (ver o comentário do botão, logo abaixo).

   stopPropagation é obrigatório: a linha inteira é clicável para abrir, e
   sem isso criar a carga abriria o formulário de uma linha que acabou de
   virar leitura. */
function acoesLinhaMontagemHtml(m, aberta){
  const id = escJs(m.montagem_id);
  /* SEM PLACA, O BOTAO OFERECE O QUE E POSSIVEL AGORA (25/08/2026).

     Relato do dono, com foto da tela: "por que nao consigo clicar em cima
     de criar carga?????". A resposta era "porque a linha esta sem placa" —
     e o botao dizia isso num `title` que so aparece parado em cima dele,
     depois de tentar clicar.

     O mecanismo funcionava (desabilitado, cursor de proibido, aviso no
     hover). O problema e outro: treze linhas com um botao dourado que nao
     aperta e um beco sem saida. Botao desabilitado nao ensina o caminho,
     so nega.

     Agora, sem placa, o botao E o caminho: abre a linha com o cursor no
     campo da placa. Uma acao a menos e nenhuma negativa. */
  const criar = m.placa
    ? `<button class="btn btn-primary btn-sm mont-btn-criar"
         onclick="event.stopPropagation(); efetivarMontagemUI('${id}')"
         title="Cria a carga e manda para a Torre de Controle." aria-label="Criar carga"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-mais"/></svg><span class="mont-rot">Criar carga</span></button>`
    : `<button class="btn btn-sec btn-sm mont-btn-placa"
         onclick="event.stopPropagation(); abrirParaColocarPlacaUI('${id}')"
         title="A carga so existe com placa cadastrada na Frota. Clique para colocar." aria-label="Colocar placa"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-caminhao"/></svg><span class="mont-rot">Colocar placa</span></button>`;
  /* EXCLUIR NA PRÓPRIA LINHA — pedido do dono (25/08/2026).

     A linha que não vai rodar hoje (rota que não saiu, carga que a
     fábrica cancelou) tinha que ser aberta para ser tirada. Numa sexta de
     42 linhas isso é um clique a mais em cada uma que sobra.

     "Cancelar", não "apagar": a linha some da montagem e continua no
     banco com o motivo e a hora — programação que se apaga sem rastro é
     como o Excel era, e é o que este painel existe para acabar. */
  return `<div class="mont-acoes">${criar}
    <button class="btn btn-danger btn-sm mont-btn-excluir"
      onclick="event.stopPropagation(); cancelarMontagemUI('${id}')"
      title="Tira esta linha do dia. Fica registrada, com o motivo." aria-label="Excluir esta linha do dia"><span aria-hidden="true">✕</span><span class="mont-rot">Excluir</span></button>
    <span class="mont-seta${aberta ? ' aberta' : ''}" aria-hidden="true">▸</span></div>`;
}

/* O formulário de uma carga da montagem.

   A ROTA NÃO É EDITÁVEL AQUI de propósito: a linha nasceu de uma rota do
   modelo, e trocar a rota transformaria "a segunda saída de Patos" em
   outra coisa sem ninguém perceber. Quem errou a rota cancela a linha e
   puxa a certa — é uma ação a mais e uma confusão a menos.

   Tipo de Veículo não é campo: vem da Frota pela placa, e deixar alguém
   digitar por cima criaria uma segunda verdade sobre o mesmo caminhão. O
   aviso abaixo da placa mostra o que a Frota respondeu.

   TRANSPORTADORA É EXCEÇÃO, a pedido do dono (25/08/2026): "transportadora
   também". A Frota diz de quem é o caminhão; quem carrega aquele dia pode
   ser outra — subcontratação e troca de última hora acontecem, e antes
   isso era escrito na planilha sem discussão. O campo vazio significa "o
   que a Frota disser"; preenchido, vale só para esta carga e não mexe no
   cadastro do veículo. */
function formMontagemHtml(m){
  const id = escJs(m.montagem_id);
  const alt = (campo) => `onchange="alterarMontagemUI('${id}','${campo}',this.value)"`;
  const frota = m.placa ? buscarFrota(m.placa) : null;
  return `
    <div class="mont-form">
      <div class="mont-form-tit">${esc(m.apelido_rota || m.rota_nome)}
        <span class="text-dim" style="font-weight:400">
          ${m.apelido_rota ? esc(m.rota_nome) + ' · ' : ''}${esc(m.rota_codigo)}</span></div>

      <div class="form-row">
        <div class="form-group">
          <label>Placa <span class="hint">(quando o transporte for contratado)</span></label>
          <input type="text" id="montf-placa-${esc(m.montagem_id)}" value="${esc(m.placa)}"
                 placeholder="ABC1D23" autocomplete="off"
                 onchange="definirPlacaMontagemUI('${id}', this.value)">
        </div>
        <div class="form-group">
          <label>Transportadora <span class="hint">(da Frota — dá para trocar)</span></label>
          <input type="text" list="lista-transportadoras"
                 value="${esc(m.transportadora || (frota ? frota.transportadora : ''))}"
                 placeholder="vem da placa"
                 onchange="alterarMontagemUI('${id}','transportadora',this.value)">
        </div>
        <div class="form-group">
          <label>Tipo de Veículo <span class="hint">(da Frota)</span></label>
          <input type="text" value="${esc(frota ? frota.tipoVeiculo : '')}"
                 placeholder="vem da placa" disabled>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:10px">${avisoFrotaMontagemHtml(m)}</div>

      <div class="form-row">
        <div class="form-group"><label>Número de Carga</label>
          <input type="text" value="${esc(m.numero_carga)}" placeholder="Ex: 10245"
                 ${alt('numeroCarga')}></div>
        <div class="form-group"><label>Motorista</label>
          <input type="text" value="${esc(m.motorista)}" placeholder="Nome do motorista"
                 ${alt('motorista')}></div>
        <div class="form-group"><label>Tipo de Operação</label>
          <select ${alt('tipoOperacao')}>
            <option value=""${!m.tipo_operacao ? ' selected' : ''}>—</option>
            ${PRA_ONDE_OPCOES.map(o =>
              `<option${m.tipo_operacao === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}
          </select></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Peso (kg)</label>
          <input type="text" inputmode="numeric" min="0" value="${m.peso ?? ''}" ${alt('peso')}></div>
        <div class="form-group">
          <label>Sequência <span class="hint">(prioridade de montagem do dia)</span></label>
          <input type="text" inputmode="numeric" min="1" value="${m.sequencia ?? ''}" ${alt('sequencia')}></div>
        <div class="form-group"><label>Paletizada?</label>
          <select ${alt('paletizada')}>
            <option${m.paletizada === 'Não' ? ' selected' : ''}>Não</option>
            <option${m.paletizada === 'Sim' ? ' selected' : ''}>Sim</option>
          </select></div>
      </div>

      ${/* GANCHOS E ENTREGAS FICAM NOS DOIS LUGARES (31/08/2026).

            Eles subiram para a LINHA a pedido do dono ("precisa aparecer e
            funcionar"), e eu os tinha tirado daqui seguindo a regra do
            "mesmo campo em dois lugares". A bateria mostrou que a regra não
            se aplica: existe uma guarda dizendo "com Qtd. Entregas e Qtd.
            Ganchos, QUE ERA O QUE SUMIU" — eles já desapareceram daqui uma
            vez e viraram incidente.

            A regra do não-duplicar existe para campo que grava em lugares
            DIFERENTES (foi o caso do Tipo de Operação). Aqui os dois gravam
            na mesma carga, pela mesma função: alterar num reflete no outro
            no próximo desenho da tela. */''}
      <div class="form-row">
        <div class="form-group">
          <label>Qtd. Ganchos (Gancheira) <span class="hint">0 = Liso</span></label>
          <input type="text" inputmode="numeric" min="0" step="1" value="${m.qtd_ganchos ?? 0}" ${alt('qtdGanchos')}></div>
        <div class="form-group"><label>Qtd. Entregas</label>
          <input type="text" inputmode="numeric" min="1" step="1" value="${m.qtd_entregas ?? 1}" ${alt('qtdEntregas')}></div>
      </div>

      <div class="form-group" style="margin-bottom:10px"><label>Observações</label>
        <textarea ${alt('observacoes')} placeholder="O que a operação precisa saber sobre esta carga">${esc(m.observacoes)}</textarea></div>

      <div class="flex-end gap8">
        <button class="btn btn-sec btn-sm" onclick="cancelarMontagemUI('${id}')">Cancelar esta linha</button>
        <button class="btn btn-sec btn-sm" onclick="alternarLinhaMontagemUI('${id}')">Fechar</button>
        ${m.placa
          ? `<button class="btn btn-primary btn-sm mont-btn-criar" onclick="efetivarMontagemUI('${id}')"
               title="Cria a carga e manda para a Torre de Controle."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-mais"/></svg>Criar carga</button>`
          /* Mesmo motivo da linha (ver acoesLinhaMontagemHtml): botao
             desabilitado nega sem ensinar. Aqui o campo da placa esta a
             quatro linhas de distancia, entao o botao leva o cursor ate
             ele em vez de so ficar apagado. */
          : `<button class="btn btn-sec btn-sm mont-btn-placa"
               onclick="abrirParaColocarPlacaUI('${id}')"
               title="A carga so existe com placa cadastrada na Frota. Clique para colocar."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-caminhao"/></svg>Colocar placa</button>`}
      </div>
    </div>`;
}

/* O mesmo aviso da aba Programação, pelo mesmo motivo: placa fora da Frota
   BLOQUEIA a criação da carga, e descobrir isso só na hora de clicar em
   "Criar carga" é tarde. Aqui a pessoa vê no momento em que digita. */
function avisoFrotaMontagemHtml(m){
  if(!m.placa) return '<span class="text-dim">Sem placa ainda — a linha fica no planejamento.</span>';
  const f = buscarFrota(m.placa);
  if(f){
    return '<span class="text-dim">✅ Placa encontrada na Frota — Transportadora e Tipo de Veículo '
      + 'vêm dela automaticamente.</span>';
  }
  return '<span style="color:var(--wine-light)">⛔ Placa não cadastrada na Frota — a criação da carga '
    + 'será BLOQUEADA.</span> <span class="text-dim">Cadastre em Cadastros → Frota.</span>';

}

function acoesMontagemHtml(m, trancada){
  const id = escJs(m.montagem_id);
  if(m.cancelada_em) return `<span class="text-dim" title="${esc(m.motivo_cancelo)}">cancelada</span>`;
  if(m.efetivada_em) return `<span class="text-dim">virou carga</span>`;
  /* O botão de efetivar só aparece com placa. Sem placa ele existiria só
     para dizer "não" — o defeito que a ocorrência #13 registrou. */
  const criar = m.placa
    ? `<button class="btn btn-primary btn-sm" onclick="efetivarMontagemUI('${id}')"
         title="Cria a carga e manda para a Torre de Controle."><svg class="ico ico-btn" aria-hidden="true"><use href="#i-mais"/></svg>Criar carga</button>`
    : '';
  /* Cancelar a linha da Montagem também é destrutivo: a rota deixa de sair
     hoje. Mesmo gesto de segurar do botão de cancelar carga — uma regra de
     confirmação só, não duas. O motivo continua sendo pedido depois. */
  return `${criar}
    <button class="btn btn-sec btn-sm" data-segurar="1"
      data-segurar-dica="Segure 1,5s para marcar esta rota como não programada hoje."
      title="SEGURE 1,5s para cancelar — depois pede o motivo."
      onclick="cancelarMontagemUI('${id}')">Cancelar</button>`;
}

/* Puxa do modelo as rotas deste dia da semana que ainda não têm carga.
   Não apaga nem duplica o que já existe: rodar duas vezes seguidas não
   faz nada na segunda. */
/* O QUE AINDA FALTA MONTAR DO MODELO — UMA FUNÇÃO, DOIS CHAMADORES.

   Extraída de `aplicarModeloDoDiaUI` em 28/08/2026, e o motivo é um
   vermelho: o teste do dia reimplementava esta conta com um Set de códigos
   de rota — a PRIMEIRA versão desta lógica, abandonada justamente por
   errar. Ele passava por sorte, enquanto as linhas já montadas tivessem
   códigos distintos; no dia em que duas montagens caíram na mesma praça,
   ele acusou 38 onde o painel oferece 37.

   Teste que reimplementa a regra não testa a regra: testa a cópia que ele
   mesmo escreveu. Agora existe UMA conta, aqui, e quem quiser saber o que
   falta — a tela ou a prova — pergunta para ela.

   CONTA por rota, não presença.

   O modelo prevê a MESMA praça mais de uma vez no mesmo dia — duas
   saídas para Patos de Minas na sexta é rotina, e por isso o índice
   único é (dia, rota, ordem) e não (dia, rota).

   A primeira versão filtrava com um Set de rotas já montadas: bastava
   uma carga de Patos existir para as OUTRAS saídas de Patos sumirem da
   oferta. Na sexta isso escondia 20 das 39 cargas do dia. */
  /* CASA POR LINHA DO MODELO, NAO POR CODIGO DE ROTA (25/08/2026).

   Relato do dono: "ta tudo duplicado ainda na montagem do dia".

   As duas versoes anteriores erraram no mesmo lugar, cada uma de um
   jeito. A primeira usava um Set de codigos: bastava uma carga de Patos
   existir para as OUTRAS saidas de Patos sumirem da oferta. A segunda
   passou a CONTAR por codigo — resolveu o sumico e criou a duplicata.

   Contagem nao resolve ambiguidade. Na terca, Arinos/Buritis, Joao
   Pinheiro, Paracatu, Riachinho e Unai sao todos o codigo 504: contando,
   o painel sabe que "faltam 2 de 504" e nao sabe QUAIS 2. Puxa duas
   quaisquer, e o dia fica com Joao Pinheiro repetido e Unai faltando.

   Identidade resolve. Cada montagem guarda a linha do modelo que a
   originou (migracao 035), e a pergunta passa a ser exata: esta linha ja
   virou carga hoje?

   E QUANDO A MIGRACAO AINDA NAO SUBIU? (26/08/2026)

   A versao anterior desta funcao so sabia casar por modelo_id. Num
   servidor sem a migracao 035 esse campo simplesmente nao existe, entao
   NADA casava: cada clique em "puxar o modelo" recriava o dia inteiro.
   Foi o que a apuracao de 25/08 mostrou — 53 linhas na montagem, quase
   todas vazias e em pares, uma unica virando carga.

   Isso foi erro meu de projeto, nao do servidor: escrevi uma correcao
   que so funciona depois que outra coisa acontece, e sem plano B ela
   falha do jeito mais barulhento possivel. Agora ha plano B.

   O plano B e ROTA + APELIDO, e ele funciona porque a migracao 034 (essa
   sim ja aplicada) moveu o destino da planilha para apelido_rota. As
   seis linhas de codigo 504 da terca — Arinos, Joao Pinheiro, Paracatu,
   Riachinho, Unai — tem apelidos DIFERENTES. O que era ambiguo contando
   por codigo deixa de ser ao olhar o destino.

   E CONTAGEM, nao presenca: o modelo preve a mesma praca duas vezes no
   mesmo dia (duas saidas para Montes Claros na sexta), e um Set faria a
   segunda sumir da oferta. Cada montagem existente consome UMA linha do
   modelo; o que sobrar e o que ainda falta montar.

   Os dois criterios convivem porque o dia seguinte a uma migracao tem os
   dois tipos de linha na mesma tela: a antiga sem modelo_id e a nova com
   ele. Casar so por um dos dois traria a duplicata de volta pela metade. */
function linhasDoModeloQueFaltam(modelo, montagens){
  const contagem = new Map();
  const chaveExata   = (x) => `id:${x.modelo_id}`;
  const chaveDestino = (x) => `rt:${x.rota_codigo || ''}¦${x.apelido_rota || ''}`;

  for(const g of (montagens || [])){
    if(g.cancelada_em) continue;
    /* CARGA AVULSA NAO CONSOME LINHA DO MODELO — e isso e deliberado.

       O comentario antigo aqui dizia o contrario ("se alguem ja montou Unai
       na mao, o modelo nao precisa oferecer Unai de novo") e o codigo nunca
       fez isso: a linha feita a mao tem rota mas NAO tem apelido, e a chave
       de destino do modelo tem ("rt:504¦Unai"). As duas nunca casaram.
       Medido em 28/08/2026, com dois avulsos de rota 500 e um modelo que
       tem "500 ¦ Patos de Minas": consumo zero.

       E o comportamento CERTO, e o comentario e que estava errado. Uma
       carga extra na rota 500 nao e a saida de Patos de Minas prevista para
       o dia — e frete a mais. Deixar ela apagar a linha prevista seria uma
       rota que nao embarca, e ninguem descobre: linha que some da oferta
       nao aparece em lugar nenhum. Oferecer uma linha a mais aparece: a
       pessoa le a lista antes de confirmar e cancela o que nao quer.

       Vale a mesma razao do 504 mais abaixo — sem apelido nao da para saber
       QUAL destino a avulsa atende, e escolher um no chute e o defeito que
       a contagem por codigo produzia.

       A EXCLUSAO VIROU EXPLICITA EM 21/09/2026, E POR POUCO.

       Ate aqui a avulsa escapava por ACIDENTE: ela nascia sem apelido, e a
       chave de destino do modelo tem um ("rt:504¦Unai"), entao as duas nunca
       casavam. No mesmo dia a avulsa passou a PERGUNTAR o destino — pedido
       do dono, para a linha nova parar de sair como "Alto Paranaiba" — e com
       isso ela ganhou apelido. A chave passaria a casar, a avulsa consumiria
       a linha prevista, e uma saida do dia sumiria da oferta em silencio.
       Exatamente o defeito que o paragrafo acima existe para impedir.

       Agora quem decide e o `modelo_id`, que e o campo que RESPONDE a
       pergunta ("de qual linha do modelo esta carga veio; NULL para
       avulsa"), em vez de um efeito colateral de um campo de texto.

       O casamento por destino fica para a linha ANTIGA, anterior ao
       modelo_id. Se um dia velho passar a oferecer uma linha ja montada, o
       erro cai do lado seguro — e e o proprio raciocinio acima: oferta a
       mais a pessoa ve e cancela; linha que some da oferta nao aparece em
       lugar nenhum. */
    if(g.avulsa){
      /* A MARCA VEM DO BANCO (migracao 055), nao de uma deducao aqui.

         Tentei deduzir por "sem modelo_id e com apelido" e a bateria
         reprovou, com razao: linha ANTIGA do modelo — anterior ao
         modelo_id — tem exatamente essa cara, e ela PRECISA casar por
         destino. As duas sao identicas no dado; so quem estava presente na
         criacao sabe a diferenca, e agora ela fica gravada. */
      continue;
    }
    const k = g.modelo_id != null ? chaveExata(g) : chaveDestino(g);
    contagem.set(k, (contagem.get(k) || 0) + 1);
  }

  const consumir = (k) => {
    const n = contagem.get(k) || 0;
    if(n <= 0) return false;
    contagem.set(k, n - 1);
    return true;
  };

  // Tenta a identidade exata primeiro; so cai no destino se ela nao casar.
  return (modelo || []).filter(m =>
    !consumir(chaveExata(m)) && !consumir(chaveDestino(m)));
}

async function aplicarModeloDoDiaUI(){
  if(!_montagemDia) return;
  const { dia, modelo, montagens } = _montagemDia;
  const novas = linhasDoModeloQueFaltam(modelo, montagens);
  /* Duas situações MUITO diferentes que davam a mesma resposta, e a
     resposta era falsa quando o modelo estava vazio: dizer "já estão
     montadas" para quem nunca cadastrou rota nenhuma manda a pessoa
     procurar um erro que não existe. */
  if(!modelo.length){
    notify(`Não há rotas cadastradas para ${NOMES_DIA[_montagemDia.diaSemana]} ainda. `
      + 'Cadastre em "Rotas por dia da semana", logo abaixo.', 'erro', 8000);
    return;
  }
  if(!novas.length){
    notify('Todas as rotas do modelo deste dia já estão montadas.', '', 5000);
    return;
  }
  if(!confirm(`Criar ${novas.length} carga(s) a partir do modelo de ${NOMES_DIA[_montagemDia.diaSemana]}?`)) return;
  let criadas = 0, erros = [];
  for(const [i, m] of novas.entries()){
    try {
      /* Sem número aqui também: as linhas nascem na ordem em que são
         criadas, cada uma acima da maior casa do dia — ver a nota em
         adicionarCargaForaDoModeloUI. */
      await SuincoSharePoint.montagem.criar({
        dia, rotaCodigo: m.rota_codigo,
        modeloId: m.modelo_id,
        tipoOperacao: m.tipo_operacao, qtdEntregas: m.qtd_entregas || 1,
        paletizada: m.paletizada || 'Não',
        /* O nome como a operação o conhece ("Brasília - Versatto") viaja
           junto, mas em CAMPO PRÓPRIO: `observacoes` é da pessoa que monta
           a carga, e o apelido apagaria o que ela escreveu. */
        apelidoRota: m.apelido_rota || '',
      });
      criadas += 1;
    } catch(e){ erros.push(`${m.rota_nome}: ${e.message || e}`); }
  }
  await carregarMontagemUI();
  if(erros.length){
    notify(`${criadas} criada(s), ${erros.length} com problema — ${erros[0]}`, 'erro', 9000);
  } else {
    notify(`${criadas} carga(s) montada(s) a partir do modelo.`, 'ok', 5000);
  }
}

/* CASCATA E ARRASTO NA MONTAGEM DO DIA (10/09/2026).
   ---------------------------------------------------------------------
   PEDIDO DO DONO: "aplica o efeito cascata que ta na torre de controle na
   programacao do dia" e "eu quero conseguir arrumar e arrastar na montagem
   do dia".

   O QUE MUDA: digitar 3 numa linha fazia só escrever 3 — e se já houvesse
   uma linha na 3, ficavam DUAS com o mesmo número. Agora a linha entra na
   posição 3 e as outras descem uma casa, como na Torre.

   QUEM DECIDE É O SERVIDOR, e a conta é a mesma função (filaReordenada).
   O painel manda a posição desejada e redesenha com o que voltou — não
   renumera nada por conta própria. Duas contas divergem. */
let _montArrastando = null;

function montArrastarInicio(ev, id){
  _montArrastando = id;
  if(ev.dataTransfer){ ev.dataTransfer.effectAllowed = 'move'; try{ ev.dataTransfer.setData('text/plain', id); }catch(e){} }
  const tr = ev.target && ev.target.closest ? ev.target.closest('tr') : null;
  if(tr) tr.classList.add('arrastando');
}
function montArrastarSobre(ev){ ev.preventDefault(); if(ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; }
function montArrastarFim(){
  _montArrastando = null;
  document.querySelectorAll('#mont-tbody tr.arrastando').forEach(t => t.classList.remove('arrastando'));
}
async function montArrastarSolta(ev, idDestino){
  ev.preventDefault(); ev.stopPropagation();
  const movido = _montArrastando;
  montArrastarFim();
  if(!movido || movido === idDestino) return;
  /* O NÚMERO DA LINHA DE DESTINO, não a posição dela na tela — mesma
     lição de 08/09 na Fila: quando linhas efetivadas reservam números, o
     índice da tela e o número deixam de ser a mesma coisa. Quem solta em
     cima da linha que mostra "5" quer o 5. */
  const alvo = (_montagemDia?.montagens || []).find(m => m.montagem_id === idDestino);
  if(!alvo) return;
  // Mesma correção de 17/09 da Fila: soltar em linha sem número não pode
  // ser um `return` mudo — ver filaArrastarSolta.
  if(!Number.isInteger(Number(alvo.sequencia))){
    notify('Essa linha ainda não tem número, então não dá para soltar em cima dela. '
      + 'Digite o número que você quer no campo Sequência da linha que está movendo.', 'warn', 8000);
    return;
  }
  await moverMontagemUI(movido, Number(alvo.sequencia));
}

async function moverMontagemUI(id, posicao){
  try {
    await SuincoSharePoint.montagem.sequenciar(id, posicao);
    await carregarMontagemUI();
  } catch(e){
    /* A RECUSA DO SERVIDOR NUNCA É SILENCIOSA, e aqui ela ensina o caminho:
       a mensagem já vem com as posições válidas do dia. */
    notify(e && e.message ? e.message : 'Não consegui reordenar.', 'erro', 8000);
    await carregarMontagemUI();
  }
}

/* O MESMO BOTÃO DA FILA, NA MONTAGEM (17/09/2026) — pedido do dono: "um
   botão de 'reorganizar por sequência' EM TODAS ESSAS ÁREAS". A conta é a
   mesma função no servidor; aqui muda só de onde vem o dia. */
async function reorganizarMontagemUI(){
  const dia = (document.getElementById('mont-data') || {}).value || '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dia)){
    notify('Escolha o dia da montagem primeiro.', 'warn');
    return;
  }
  const ok = confirm(
    `Reorganizar a sequência da montagem de ${fmtData(dia)}?\n\n`
    + `As linhas que ainda não viraram carga passam a ocupar 1, 2, 3... na `
    + `ordem em que estão na tela, fechando os buracos.\n\n`
    + `Linha já efetivada não muda de número — ela virou registro.`);
  if(!ok) return;
  try {
    const r = await SuincoSharePoint.montagem.reorganizar(dia);
    await carregarMontagemUI();
    const n = (r && r.mexidas) || 0, total = (r && r.total) || 0;
    notify(
      total === 0 ? `Não há linha aberta na montagem de ${fmtData(dia)}.`
      : n === 0   ? `A montagem de ${fmtData(dia)} já estava em ordem — nada mudou.`
                  : `Montagem de ${fmtData(dia)} reorganizada: ${n} de ${total} linha(s) renumerada(s).`,
      n ? 'success' : 'info', 7000);
  } catch(e){
    notify(e && e.message ? e.message : 'Não consegui reorganizar.', 'erro', 8000);
    await carregarMontagemUI();
  }
}

/* Digitar o número: mesma cascata do arrasto, uma conta só. Linha já
   efetivada não reordena ninguém — o número dela é registro, e para essas
   o campo continua gravando direto na montagem. */
function definirSequenciaMontagemUI(id, val){
  const n = Number(val);
  const m = (_montagemDia?.montagens || []).find(x => x.montagem_id === id);
  if(!m) return;
  if(m.efetivada_em || m.cancelada_em) return alterarMontagemUI(id, 'sequencia', val);
  /* Apagar o campo APAGA o número: campo vazio não é ordem de reordenar,
     é "esta linha ainda não tem lugar na fila". */
  if(val === '') return alterarMontagemUI(id, 'sequencia', '');
  /* QUALQUER OUTRA COISA QUE NÃO SEJA CASA DA FILA NÃO SOBE (11/09/2026).
     Isto ia para o servidor como `sequencia` crua e 2,7 chegava lá para ser
     arredondado — podendo cair justo no número de outra linha. Número
     quebrado não é posição: a tela devolve o que o servidor tem. */
  if(!Number.isInteger(n) || n < 1) return carregarMontagemUI();
  return moverMontagemUI(id, n);
}

/* Quem corrige o KM de uma carga já efetivada — decisão do dono: a
   Logística, que é quem monta a carga e conhece o desvio, o retorno e a
   coleta no caminho; e a Administração, irrestrita como no resto do
   painel. Os outros setores continuam vendo o número. */
function podeCorrigirKmDaCargaUI(){
  const setor = (DB.operador || {}).setor;
  return setor === 'Logística' || setor === 'Administração';
}

/* A CORREÇÃO PERGUNTA QUANDO MUDA MUITO, e nunca bloqueia.

   Regra da casa: "botão desabilitado não ensina o caminho, só nega. Quando
   a ação é arriscada, PERGUNTE explicando". Trocar 583 por 640 é rotina —
   desvio, retorno, coleta. Trocar 583 por 58 é dedo no teclado, e o frete é
   KM × tarifa: o erro vira dinheiro. A pergunta só aparece quando a
   diferença passa da metade do número atual, e diz os dois números. */
async function corrigirKmDaCargaUI(cargaId, valor){
  const c = getCarga(cargaId);
  if(!c) return;
  const novo = kmValidoLocal(valor);
  const antigo = c.kmDeslocamento ?? null;
  if(novo === null){
    notify('O KM precisa ser um número maior que zero (pode ter vírgula: 3087,48) — é ele que multiplica a tarifa.',
      'warn', 6000);
    renderAll();
    return;
  }
  if(novo === antigo) return;
  if(antigo !== null && Math.abs(novo - antigo) > antigo / 2){
    const ok = confirm(
      `Trocar o KM de ${kmTexto(antigo)} para ${kmTexto(novo)}?\n\n`
      + `É mais que o dobro de diferença — confira antes, porque o frete é `
      + `KM × tarifa e o valor vai ser recalculado.\n\n`
      + `Fica registrado em Histórico quem mudou.`);
    if(!ok){ renderAll(); return; }
  }
  try {
    corrigirKmDaCarga(cargaId, novo, nomeOperadorAtual(), setorOperadorAtual());
    notifyGravacao(`KM corrigido para ${kmTexto(novo)}. O valor do frete é recalculado pelo servidor.`);
    renderAll();
  } catch(e){
    notify(e.message || 'Não foi possível corrigir o KM.', 'danger', 7000);
    renderAll();
  }
}

async function alterarMontagemUI(id, campo, valor){
  try {
    await SuincoSharePoint.montagem.alterar(id, { [campo]: valor });
    await carregarMontagemUI();
  } catch(e){
    notify('Não gravou: ' + (e.message || e), 'erro', 7000);
    await carregarMontagemUI();   // devolve a tela ao que o servidor tem
  }
}

/* Pôr, tirar ou trocar a placa. É o movimento que a planilha permitia o
   dia inteiro e o painel não permitia — e por isso tem tratamento
   próprio: a mensagem de placa fora da Frota precisa ensinar onde
   resolver, e a de placa repetida precisa dizer que já está em outra
   linha de hoje. */
async function definirPlacaMontagemUI(id, valor){
  /* A PLACA TRAZ O QUE A FROTA JÁ SABE (28/08/2026).

     Relato do dono: "as placas que estão neles não estão puxando direto as
     infos da placa como veículo". Transportadora e tipo de veículo já eram
     lidos da Frota na hora de desenhar a linha; o MOTORISTA não — ficava
     em branco mesmo com a Frota sabendo quem dirige aquele caminhão, e a
     pessoa redigitava um dado que o painel já tinha.

     Só preenche o que está VAZIO. Motorista escrito à mão é a exceção do
     dia (folga, troca de turno) e sobrescrevê-lo com o cadastro apagaria
     justamente a informação que alguém se deu ao trabalho de registrar. */
  const linha = ((_montagemDia || {}).montagens || []).find(m => m.montagem_id === id) || {};
  const mudanca = { placa: valor };
  const f = valor ? buscarFrota(valor) : null;
  if(f){
    if(!String(linha.motorista || '').trim() && f.motorista) mudanca.motorista = f.motorista;
    if(!String(linha.transportadora || '').trim() && f.transportadora) mudanca.transportadora = f.transportadora;
  }
  try {
    await SuincoSharePoint.montagem.alterar(id, mudanca);
    await carregarMontagemUI();
    /* PLACA REPETIDA NO DIA AVISA, NÃO RECUSA (10/09/2026).

       O recado vem DEPOIS de carregar: a conta é sobre o dia como o
       servidor o devolveu, não sobre o que a tela achava antes de gravar.
       E vem do mesmo texto da Programação — uma função, dois
       chamadores. */
    const outras = outrasLinhasComAPlaca(id, valor);
    if(outras.length) notify(fraseDePlacaRepetida(valor, outras), 'warn', 11000);
  } catch(e){
    notify(e.message || String(e), 'erro', 9000);
    await carregarMontagemUI();
  }
}

/* Onde mais esta placa está hoje. Linha cancelada fica fora — ela não sai,
   então o caminhão não está nela. Linha já efetivada fica DENTRO: ela virou
   carga de verdade, e é justamente o caso em que a pessoa precisa saber que
   o caminhão já tem serviço no dia. */
function outrasLinhasComAPlaca(id, placa){
  const p = normalizarPlaca(placa);
  if(!p) return [];
  return ((_montagemDia || {}).montagens || [])
    .filter(m => m.montagem_id !== id
              && !m.cancelada_em
              && normalizarPlaca(m.placa) === p)
    .map(m => {
      const nome = m.apelido_rota || m.rota_nome || 'rota sem nome';
      const num = String(m.numero_carga || '').trim();
      return num ? `${nome} (carga ${num})` : `${nome} (sem número ainda)`;
    });
}

async function cancelarMontagemUI(id){
  const motivo = prompt('Por que esta rota não sai hoje?');
  if(motivo === null) return;
  if(!motivo.trim()){ notify('Precisa dizer o motivo.', 'erro', 5000); return; }
  try {
    await SuincoSharePoint.montagem.cancelar(id, motivo.trim());
    await carregarMontagemUI();
    notify('Rota marcada como não programada hoje.', 'ok', 4000);
  } catch(e){ notify('Não consegui cancelar: ' + (e.message || e), 'erro', 7000); }
}

/* A PONTE. Cria a carga pelo caminho de sempre e só então avisa o servidor
   de que a montagem virou aquela carga.

   A ordem importa: se avisasse primeiro e a criação falhasse (placa fora
   da Frota, recusa do servidor), a montagem ficaria marcada como
   efetivada apontando para uma carga que não existe. */
/* ENVIO EM LOTE — o pedágio que faria a pessoa voltar para o Excel.

   A confirmação carga a carga é deliberada (ver efetivarMontagemUI), mas
   na sexta são 39 linhas. Trinta e nove cliques não é cuidado, é castigo,
   e tela que castiga é tela que a operação abandona.

   O lote pergunta UMA vez, listando o que vai mandar, e segue em frente
   quando uma linha falha: uma placa que saiu da Frota entre a montagem e o
   clique não pode travar as outras 38. No fim, diz quantas foram e quais
   não foram, com o motivo de cada uma. */
async function efetivarLoteMontagemUI(){
  const prontas = (_montagemDia?.montagens || [])
    .filter(m => m.placa && !m.efetivada_em && !m.cancelada_em);
  if(!prontas.length){
    notify('Nenhuma linha com placa para enviar.', 'warn', 5000);
    return;
  }
  const nomes = prontas.map(m => `${m.rota_nome} (${m.placa})`).join('\n');
  const ok = confirm(`Criar ${prontas.length} carga(s) e mandar para a Torre de Controle?\n\n`
    + nomes + '\n\nDepois disso elas aparecem para a Portaria e a Expedição.');
  if(!ok) return;

  let criadas = 0;
  const erros = [];
  for(const m of prontas){
    try{
      await efetivarMontagemUI(m.montagem_id, { silencioso: true });
      criadas += 1;
    }catch(e){
      erros.push(`${m.rota_nome}: ${e && e.message || e}`);
    }
  }
  await carregarMontagemUI();
  renderAll();
  if(criadas) notify(`${criadas} carga(s) criada(s) e na Torre de Controle.`, 'ok', 6000);
  if(erros.length){
    notify(`${erros.length} não foi/foram criada(s):\n` + erros.join('\n'), 'erro', 12000);
  }
}

/* CRIAR A CARGA — o momento em que planejamento vira operação.

   POR QUE UM CLIQUE, E NÃO AUTOMÁTICO AO DIGITAR A PLACA. A pergunta veio
   do gestor (25/08/2026), e a resposta é o custo do erro nos dois lados.

   Automático: o campo da placa grava ao sair dele. Um dígito errado, um
   autocompletar do navegador, um Tab sem querer — e existe carga de
   verdade na Torre. Desfazer custa ir na Torre, cancelar, e torcer para a
   Portaria não ter registrado chegada no meio do caminho.

   Com clique: o custo do erro é fechar o formulário. A montagem é um
   RASCUNHO — placa entra, sai, troca de linha, transportadora desiste — e
   rascunho não pode vazar para a tela que a operação usa para trabalhar.

   O clique não é "tem certeza?". É a fronteira entre as duas tabelas.
   E para o pedágio não pesar, existe o envio em lote logo acima.

   `silencioso` é para o lote: ele avisa uma vez no fim, em vez de despejar
   39 avisos na tela. Nesse modo os erros SOBEM (throw) em vez de virar
   aviso, para o lote poder contá-los e seguir com as outras linhas. */
async function efetivarMontagemUI(id, { silencioso = false } = {}){
  const m = (_montagemDia?.montagens || []).find(x => x.montagem_id === id);
  if(!m) return;
  if(!m.placa){
    const erro = new Error('Coloque a placa antes de criar a carga.');
    if(silencioso) throw erro;
    notify(erro.message, 'erro', 5000);
    return;
  }
  let carga;
  try {
    carga = criarCargaProgramada({
      placa: m.placa,
      numeroCarga: m.numero_carga,
      rota: m.rota_codigo,
      peso: m.peso,
      sequencia: m.sequencia,
      praOnde: m.tipo_operacao,
      paletizada: m.paletizada,
      qtdGanchos: m.qtd_ganchos,
      qtdEntregas: m.qtd_entregas,
      motorista: m.motorista,
      /* Vazio = o que a Frota diz (criarCargaProgramada resolve pela
         placa). Preenchido = a exceção do dia — subcontratação, freteiro,
         veículo emprestado —, e aí é ela que vale. */
      transportadora: m.transportadora || '',
      /* O APELIDO DA ROTA NÃO ENTRA MAIS NA OBSERVAÇÃO (17/09/2026).
         Ocorrência #77.

         Ele entrava desde 25/08 com uma intenção certa — "quem lê a carga
         na Torre precisa saber que 517 é a Ômega" — e um efeito que só
         apareceu 23 dias depois: o apelido do modelo é "Destino -
         Operadora", e ele passou a ocupar a coluna de Observações do
         relatório de Administração de Fretes, que é onde quem confere
         pagamento lê o valor combinado.

         Por que só agora: em 14/09 a lista de operadores do gestor foi
         aplicada às rotas. O campo existia e vivia vazio; a partir dali
         quase toda rota ganhou apelido, e quase toda carga nasceu com a
         operadora colada na frente do recado.

         O operador JÁ É DERIVÁVEL DA ROTA — `rotaOperador()` existe e
         `rotaApoio()` já o desenha no impresso. Copiá-lo para dentro de um
         campo de texto livre era a mesma decisão escrita em dois lugares,
         e aqui a cópia não só divergia: ela APAGAVA o campo do outro dono.

         A observação volta a ser só o que a pessoa escreveu. */
      observacoes: m.observacoes || '',
      /* O DESTINO E O KM SEGUEM PARA A CARGA (10/09/2026).
         Sem estas duas linhas a Montagem podia ter destino na tela e a
         carga nascer sem — que é a metade do defeito que o dono relatou.
         O KM que viaja é o de DESLOCAMENTO, porque é ele que o servidor
         usa para calcular; o do destino o servidor resolve sozinho pelo
         cadastro, e mandar daqui seria dar ao painel uma opinião sobre
         distância que ele não deve ter. */
      freteDestino: m.frete_destino || '',
      /* O DESTINO ESCOLHIDO SEGUE PARA A CARGA (21/09/2026).
         Sem esta linha a cidade morre na Montagem: a Torre e o Relatório
         Operacional leem a CARGA, não a linha de montagem, e voltariam a
         mostrar só a região — que é metade do defeito relatado.

         Vai no campo `destino`, que já existe na carga e já é exibido nos
         relatórios. Ele ficou vazio desde que o Destino saiu do formulário
         da Programação (virou campo oculto, e o comentário de lá diz por
         quê: "o Destino ainda é exibido nos relatórios"). Reaproveitar o
         campo certo é melhor que criar coluna nova para o mesmo conceito —
         e não exige migração nenhuma. */
      destino: m.apelido_rota || '',
      kmDeslocamento: m.km_deslocamento ?? '',
      operador: DB.operador ? DB.operador.nome : '',
    });
  } catch(e){
    if(silencioso) throw e;
    notify(e.message || String(e), 'erro', 9000);
    return;
  }
  try {
    await SuincoSharePoint.montagem.efetivar(id, carga.id);
  } catch(e){
    /* A carga JÁ existe e já está na Torre — este aviso é sobre o elo
       entre planejamento e execução, não sobre a carga. Dizer que "não
       criou" seria mentira e faria alguém criar de novo. */
    notify('A carga foi criada, mas não consegui marcar a montagem como efetivada: '
      + (e.message || e), 'erro', 9000);
  }
  if(silencioso) return;
  // A linha vira leitura depois de virar carga; deixar aberta mostraria um
  // formulário que não aceita mais nada.
  if(_montagemAberta === id) _montagemAberta = null;
  await carregarMontagemUI();
  renderAll();
  notify(`Carga da rota ${m.rota_nome} criada e enviada para a Torre.`, 'ok', 5000);
}

