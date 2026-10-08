/* ---------- PROGRAMAÇÃO ---------- */
function atualizarPreviewFrotaPrograma(){
  const placa = document.getElementById('prog-placa').value;
  const f = buscarFrota(placa);
  const hint = document.getElementById('prog-frota-hint');
  if(f){
    document.getElementById('prog-transportadora').value = f.transportadora;
    document.getElementById('prog-tipoveiculo').value = f.tipoVeiculo;
    /* Motorista habitual da placa — pedido do usuário (11/08/2026): "DA
       MESMA FORMA QUE QUANDO O INPUT DA PLACA É FEITO, E ALTERA
       AUTOMATICAMENTE A TRANSPORTADORA, ALTERAR O NOME DO MOTORISTA CASO
       JA TENHA NOME CADASTRADO NA PLACA".

       Só preenche se o campo estiver VAZIO: se o operador já digitou um
       nome (motorista de folga, substituto, freteiro do dia), sobrescrever
       apagaria o que ele acabou de informar — e o motorista real daquela
       viagem importa mais que o habitual do cadastro. */
    const elMot = document.getElementById('prog-motorista');
    if(elMot && !elMot.value.trim() && f.motorista) elMot.value = f.motorista;
    const oQue = f.motorista
      ? 'Transportadora, Tipo de Veículo e Motorista preenchidos'
      : 'Transportadora e Tipo de Veículo preenchidos';
    hint.innerHTML = `<span class="text-dim">✅ Placa encontrada na Frota — ${oQue} automaticamente.</span>`
                   + avisoPlacaJaProgramada(placa);
  } else if(normalizarPlaca(placa)){
    // Cadastrar sem sair da tela: antes disso, o único caminho era ir em
    // Cadastros → Frota, perder o que já estava digitado aqui, cadastrar,
    // voltar e preencher tudo de novo — no pátio, com o caminhão esperando,
    // isso é tempo que ninguém tem. Reaproveita Transportadora/Tipo de
    // Veículo que o operador já digitou nesta mesma tela.
    hint.innerHTML = '<span style="color:var(--wine-light)">⛔ Placa não cadastrada na Frota — a criação da carga será BLOQUEADA.</span>'
      + '<div class="gap8" style="margin-top:6px">'
      + '<button type="button" class="btn btn-sec btn-sm" onclick="cadastrarPlacaInlineUI()"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-mais"/></svg>Cadastrar esta placa na Frota agora</button>'
      + '</div>';
  } else {
    hint.innerHTML = '';
  }
}

/* Cadastra a placa na Frota sem sair da tela de Programação, usando o que
   o operador já digitou em Transportadora/Tipo de Veículo — e sem esperar
   confirmação do servidor pra liberar o próximo passo, porque
   upsertFrota() já dispara a sincronia real em segundo plano (corrigido em
   07/08/2026: antes o cadastro pela tela nunca chegava ao servidor —
   ver comentário em upsertFrota, data.js). Se o servidor recusar, o aviso
   de aoRecusarFrota chega do mesmo jeito, sozinho, poucos segundos depois. */
function cadastrarPlacaInlineUI(){
  const placa = document.getElementById('prog-placa').value;
  const transportadora = document.getElementById('prog-transportadora').value.trim();
  const tipoVeiculo = document.getElementById('prog-tipoveiculo').value.trim();
  if(!normalizarPlaca(placa)){ notify('Informe a placa antes de cadastrar.', 'warn'); return; }
  if(!transportadora || !tipoVeiculo){
    notify('Preencha Transportadora e Tipo de Veículo para cadastrar a placa.', 'warn');
    return;
  }
  upsertFrota(placa, transportadora, tipoVeiculo, {});
  notify(`Placa ${normalizarPlaca(placa)} cadastrada na Frota. Pode criar a carga agora.`, 'success');
  atualizarPreviewFrotaPrograma();
}

/* Aviso de placa que já tem carga em aberto.

   Um caminhão levar duas cargas é raro, mas acontece — e o sistema sempre
   permitiu, porque a Portaria já trata a chegada da placa aplicando o
   "Chegou" a todas as cargas dela de uma vez.

   O problema nunca foi permitir: foi não DIZER. Digitar a mesma placa duas
   vezes parece igual nos dois casos — o dia em que são de fato duas cargas
   e o dia em que alguém programou em duplicidade sem perceber. Sem aviso,
   o segundo caso só aparece na doca.

   Por isso avisa e NÃO bloqueia. Bloquear resolveria o engano e quebraria
   o caso legítimo; avisar resolve o engano e deixa o caso legítimo passar
   com um clique. Quem sabe o que está fazendo lê e segue. */
/* A MESMA FRASE NOS DOIS LUGARES (10/09/2026).

   A placa repetida aparece em dois pontos do dia: na Programação, quando
   alguém cria a segunda carga do mesmo caminhão, e na Montagem do Dia,
   quando a mesma placa vai para a segunda linha. É a MESMA situação — uma
   carreta que carrega em duas praças da mesma rota — e por isso é a mesma
   frase, escrita uma vez.

   Escrita duas vezes, uma das duas ficaria para trás na próxima correção:
   foi exatamente o que aconteceu com a TRAVA. A Programação abrandou a dela
   em 11/08/2026 (avisa e deixa passar) e a Montagem ficou com o índice
   único de 031 recusando no banco, até o relato de hoje — Ribeirão Preto e
   Marília no mesmo caminhão, e a segunda linha impossível de montar.

   `realce` existe porque um dos dois chamadores escreve HTML (a caixa do
   formulário) e o outro escreve texto puro (o recado da Montagem). Quem
   escreve HTML passa a função que marca e ESCAPA; quem escreve texto não
   passa nada. */
function fraseDePlacaRepetida(placa, ondeJaEsta, realce){
  const p = normalizarPlaca(placa) || String(placa || '').toUpperCase();
  const n = ondeJaEsta.length;
  const cabeca = `${p} já está em ${n === 1 ? 'outro lugar' : n + ' outros lugares'} do dia`;
  return `${realce ? realce(cabeca) : cabeca} (${ondeJaEsta.join(' · ')}). `
    + 'Duas cargas no mesmo caminhão é PERMITIDO — é a carreta que carrega em '
    + 'duas praças da mesma rota. Se não for isso, confira antes: pode ser '
    + 'programação em duplicidade.';
}

function avisoPlacaJaProgramada(placa){
  const p = normalizarPlaca(placa);
  if(!p) return '';
  const abertas = cargasAbertasPorPlaca(p);
  if(!abertas.length) return '';

  const lugares = abertas.map(c => esc(c.aguardandoCarga
    ? 'sem número ainda'
    : ('carga ' + (c.numeroCarga || 'sem número'))));

  return `<div class="aviso-placa-repetida">${
    fraseDePlacaRepetida(p, lugares, t => `<strong>${esc(t)}</strong>`)}</div>`;
}
/* Placa liberada para receber uma SEGUNDA carga nesta programação, por
   escolha explícita do operador (botão "➕ Outra carga"). Vale para uma
   criação só: some assim que a carga é criada, para não deixar a porta
   aberta sem querer. */
let _placaMultiCargaAutorizada = null;

async function criarCargaProgramadaUI(){
  const placa = document.getElementById('prog-placa').value;
  /* PLACA VAZIA CRIA A CARGA MESMO ASSIM (26/08/2026) — mas nunca em
     silêncio. O aviso diz o que aconteceu e o que falta: sem confirmação
     visível, criar sem placa e criar com placa parecem iguais na tela, e o
     dia em que alguém ESQUECE a placa fica indistinguível do dia em que
     ainda não contratou. O texto resolve os dois: quem esqueceu percebe,
     quem não contratou segue tranquilo. */
  const semPlaca = !normalizarPlaca(placa);

  /* Duplicidade de placa na mesma programação — pedido do usuário
     (11/08/2026): "IMPEDIR DUPLICIDADE DE PLACAS DENTRO DA MESMA
     PROGRAMACAO DE EMBARQUE SOMENTE APÓS O VEICULO SAIR E RETORNAR PARA
     NOVO INPUT".

     A trava é sobre o ACIDENTE, não sobre o caso real de um caminhão
     levar duas cargas: quem quiser a segunda carga usa "➕ Outra carga"
     na linha da placa, que é uma decisão consciente e já herda os dados
     do veículo. Depois que o caminhão sai (Seguiu Viagem), a placa fica
     livre de novo sem precisar de nada. */
  const pNorm = normalizarPlaca(placa);
  const abertas = cargasAbertasPorPlaca(pNorm);
  if(abertas.length && _placaMultiCargaAutorizada !== pNorm){
    const numeros = abertas
      .map(c => c.aguardandoCarga ? 'sem número ainda' : (c.numeroCarga || 'sem número'))
      .join(', ');
    notify(
      `${pNorm} já está nesta programação (${numeros}) e ainda não seguiu viagem. `
      + 'Para lançar outra carga no mesmo caminhão, use "➕ Outra carga" na linha dela — '
      + 'na Fila de Programados ou na Torre de Controle.',
      'warn', 9000);
    return;
  }

  /* AQUI HAVIA UMA TRAVA DE KM E OBSERVAÇÃO, E ELA SAIU (09/09/2026).

     O dono tinha pedido "kilometragem obrigatoria" e confirmado "1 trava a
     contratacao". A bateria mostrou o custo antes de a operação pagar por
     ele: a Montagem do Dia cria carga por outro caminho, em lote, sem campo
     de KM — e carga recusada na criação é APAGADA do painel (proteção de
     07/08/2026). O lote inteiro sumiria na frente da Logística.

     Decisão dele, com a evidência na mão: "não põe a trava do quilômetro
     então".

     O CAMPO CONTINUA, e continua se preenchendo sozinho pelo destino. O que
     não existe mais é o portão. Carga sem KM nasce igual, e é o relatório
     de fretes que cobra: a linha aparece com o motivo escrito em vez de uma
     célula vazia. Cobrar onde o dado é usado, e não onde o caminhão passa. */

  /* COM PLACA É CONTRATAR: a observação do frete vem antes (06/10/2026).
     A pergunta abre aqui; cancelar não cria nada e diz por quê. */
  let frete = { freteObservacao: '', freteCombinado: null };
  if(pNorm){
    const frotaF = buscarFrota(pNorm);
    frete = await garantirFreteParaContratar({
      placa: pNorm,
      transportadora: document.getElementById('prog-transportadora').value || (frotaF && frotaF.transportadora) || '',
      tipoVeiculo: document.getElementById('prog-tipoveiculo').value || (frotaF && frotaF.tipoVeiculo) || '',
      numeroCarga: document.getElementById('prog-numero-carga').value,
      destino: document.getElementById('prog-frete-destino').value,
      km: kmValidoLocal(document.getElementById('prog-km-deslocamento').value),
      valorTabela: null,
    }, 'contratar');
    if(!frete){
      notify('Carga NÃO criada: sem a observação do frete (TABELA ou COMBINADO) a carga não é contratada.', 'warn', 8000);
      return;
    }
  }
  try{
    const criada = criarCargaProgramada({
      placa,
      freteObservacao: frete.freteObservacao,
      freteCombinado: frete.freteCombinado,
      transportadora: document.getElementById('prog-transportadora').value,
      tipoVeiculo: document.getElementById('prog-tipoveiculo').value,
      motorista: document.getElementById('prog-motorista').value,
      numeroCarga: document.getElementById('prog-numero-carga').value,
      cliente: document.getElementById('prog-cliente').value,
      destino: document.getElementById('prog-destino').value,
      peso: document.getElementById('prog-peso').value,
      sequencia: document.getElementById('prog-sequencia').value,
      observacoes: document.getElementById('prog-obs').value,
      praOnde: document.getElementById('prog-praonde').value,
      rota: document.getElementById('prog-rota').value,
      paletizada: document.getElementById('prog-paletizada').value,
      qtdGanchos: document.getElementById('prog-ganchos').value,
      qtdEntregas: document.getElementById('prog-entregas').value,
      freteDestino: destinoFreteNormalizado(document.getElementById('prog-frete-destino').value),
      kmDeslocamento: document.getElementById('prog-km-deslocamento').value,
      operador: nomeOperadorAtual()
    });
    _placaMultiCargaAutorizada = null;   // vale uma vez só
    if(semPlaca){
      notifyGravacao('Carga criada SEM caminhão — ela fica em "Cargas sem caminhão", '
        + 'aqui na Programação. Quando contratar, preencha a placa na linha e ela '
        + 'entra sozinha na Torre.');
    } else {
      /* O RECADO DA ABSORÇÃO VEM DA CRIAÇÃO (27/08/2026). Quando a placa
         já estava no pátio, a carga não nasce em "Aguardando Veículo" — ela
         assume a entrada que já existia. Dizer "Aguardando Veículo" aí
         seria mentir para quem acabou de gravar. */
      const recadosCriacao = (criada && criada._recados) || [];
      if(recadosCriacao.length){
        notifyGravacao(`Carga criada para a placa ${normalizarPlaca(placa)} — o caminhão JÁ ESTÁ no pátio, então ela nasce em Aguardando Embarque.`);
        recadosCriacao.forEach(m => notify(m, 'info'));
      } else {
        notifyGravacao(`Carga criada para a placa ${normalizarPlaca(placa)} — status Aguardando Veículo.`);
      }
    }
    ['prog-placa','prog-transportadora','prog-tipoveiculo','prog-motorista','prog-numero-carga','prog-cliente','prog-destino','prog-peso','prog-sequencia','prog-obs','prog-frete-destino','prog-km-destino','prog-km-deslocamento']
      .forEach(id=>document.getElementById(id).value='');
    document.getElementById('prog-frete-aviso').innerHTML = '';
    document.getElementById('prog-praonde').value = PRA_ONDE_PADRAO;
  document.getElementById('prog-rota').value = '';
  document.getElementById('prog-paletizada').value = 'Não';
    document.getElementById('prog-ganchos').value = '0';
    document.getElementById('prog-entregas').value = '1';
    document.getElementById('prog-frota-hint').innerHTML = '';
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}
/* O DESTINO PUXA O KM — e o campo KM (id histórico prog-km-deslocamento)
   nasce igual, para ser mudado.

   Pedido do dono: "a tabela de frete deve fazer o calculo segundo a
   kilometragem e destino" e "KM DESLOCAMENTO (precisa ser o valor certinho
   do valor que sera pago no frete)".

   Preencher o deslocamento com o KM do destino é o que torna o caso comum
   (viagem direta) um clique, e mantém o caso real (desvio, retorno,
   coleta) a uma digitação de distância. NÃO sobrescreve o que a pessoa já
   digitou: quem escreveu 640 no deslocamento e depois trocou o destino
   estava corrigindo o destino, não desistindo dos 640. */
function destinoFreteMudouUI(){
  const campo = document.getElementById('prog-frete-destino');
  const km = kmDoDestino(campo.value);
  const alvoKm = document.getElementById('prog-km-destino');
  const alvoDesl = document.getElementById('prog-km-deslocamento');
  alvoKm.value = kmTexto(km);
  if(km !== null && !alvoDesl.value) alvoDesl.value = kmTexto(km);
  avisarSobreKmUI();
}

function kmDeslocamentoMudouUI(){ avisarSobreKmUI(); }

/* O mesmo gesto no modal de Completar. Dois pares de campos e uma conta só
   (kmDoDestino) — o que NÃO se duplica é a decisão de quanto vale o km,
   que é do servidor. */
function destinoFreteCompletarUI(){
  const km = kmDoDestino(document.getElementById('completar-frete-destino').value);
  document.getElementById('completar-km-destino').value = kmTexto(km);
  const desl = document.getElementById('completar-km-deslocamento');
  if(km !== null && !desl.value) desl.value = kmTexto(km);
}

/* UM KM SÓ (06/10/2026). Até aqui havia dois campos — o KM do destino e o
   de deslocamento — e um aviso quando divergiam. O dono decidiu: "KM de
   deslocamento não é necessário. KM divergente não é necessário" e
   "somente o KM pode ser editavel". O que sobra de aviso é o destino que
   não está na tabela: aí não há KM para puxar e a pessoa precisa saber que
   o valor sai do KM que ela digitar. */
function avisarSobreKmUI(){
  const aviso = document.getElementById('prog-frete-aviso');
  if(!aviso) return;
  const destino = document.getElementById('prog-frete-destino').value.trim();
  if(destino && kmDoDestino(destino) === null){
    aviso.innerHTML = `<span class="text-warn">“${esc(destino.toUpperCase())}” não está na Tabela de Frete `
      + `— sem KM para puxar. O valor sai pelo KM que você digitar. `
      + `Para cadastrar: Cadastros → Tabela de Frete.</span>`;
    return;
  }
  aviso.innerHTML = '';
}

function renderProgFila(){
  /* Só os programados DE HOJE — pedido do usuário (11/08/2026): "no campo
     fila de programados na programacao manter somente os programados NO
     DIA".

     A fila é a lista de trabalho do dia: carga programada ontem que
     ninguém encostou não é tarefa de hoje, é pendência a resolver na
     Torre (onde ela continua visível, com a data da programação à
     mostra). Misturar as duas coisas fazia a fila crescer sem parar e
     perder a função de "o que embarca hoje".

     A carga NÃO é escondida do sistema: continua na Torre de Controle, no
     Histórico e nos relatórios. Só sai desta fila específica. */
  /* O DIA É O DA PROGRAMAÇÃO, NÃO O DO REGISTRO (19/08/2026).

     Esta fila usava `criadoEm` — o instante em que a LINHA nasceu no banco.
     São coisas diferentes, e a diferença aparece todo dia:

       · carga programada às 22h de ontem PARA HOJE tinha criadoEm de ontem
         e sumia da fila de hoje;
       · caminhão que entrou pela Portaria dias atrás e teve a carga lançada
         hoje carregava o criadoEm da ENTRADA — "não é pra ser o dia que o
         carro deu entrada".

     `programadoEm` é o carimbo de quando a carga foi programada/lançada, e
     é gravável uma vez só justamente para não escorregar depois. É ele que
     responde "isto é trabalho de hoje?". */
  /* A FILA TEM DIA (09/09/2026). Relato do dono: "a carga criada ontem, mas
     não contratada (...) some da programação (...) não pode acontecer". Ela
     não sumia do sistema — sumia DESTA lista, que só mostrava hoje e mandava
     olhar a Torre. Agora: a fila do dia escolhido (padrão hoje), e um bloco
     fixo abaixo com as de dias anteriores ainda sem veículo, editáveis, até
     ganharem placa. */
  const hojeISO = isoDiaLocal(new Date());
  const diaSel = diaFilaSelecionado();
  const diaDaCarga = (c)=>{
    const base = c.programadoEm || c.criadoEm || c.atualizadoEm;
    return base ? isoDiaLocal(new Date(base)) : null;
  };
  const doDia = (c)=>{
    const d = diaDaCarga(c);
    if(!d) return diaSel === hojeISO;   // sem data conhecida, melhor mostrar (em hoje) que sumir
    return d === diaSel;
  };
  const todosAguardando = DB.cargas.filter(c=>c.status==='Aguardando Veículo');
  const lista = todosAguardando.filter(doDia).sort(ordenarPorSequenciaEAtualizacao);
  const anteriores = todosAguardando
    .filter(c => { const d = diaDaCarga(c); return d && d < hojeISO && d !== diaSel; })
    .sort((a,b) => (diaDaCarga(a) < diaDaCarga(b) ? -1 : diaDaCarga(a) > diaDaCarga(b) ? 1 : ordenarPorSequenciaEAtualizacao(a,b)));
  const deOutrosDias = anteriores.length;
  const campoDia = document.getElementById('prog-fila-dia');
  if(campoDia && campoDia.value !== diaSel) campoDia.value = diaSel;

  /* A FILA COM A CARA DA TORRE (28/08/2026).

     Pedido do dono: "na programação eu queria que ficasse igual à torre de
     controle (...) e clicar em cima e ela possa expandir e aí sim ter todas
     as informações completas".

     São as MESMAS sete colunas da Torre, na mesma ordem, com a mesma
     célula de Veículo (placa + transportadora + tipo empilhados). Ordem
     igual não é estética: é a mesma pessoa, no mesmo dia, olhando a mesma
     carga em duas telas — e duas ordens diferentes para o mesmo trabalho
     produzem erro de campo trocado.

     O que saiu da linha (Tipo de Operação, Ganchos, Entregas, Observações,
     Cliente, Destino) NÃO saiu do sistema: está na expansão, editável, e
     grava nas mesmas funções de sempre. Varrer a fila é procurar sequência,
     número e caminhão; preencher é outro momento, e agora tem lugar próprio.

     Os botões ficam NA LINHA, por decisão do dono — quem programa outra
     carga ou exclui está varrendo, não preenchendo. O stopPropagation
     impede que clicar neles abra a linha por tabela. */
  document.getElementById('prog-fila-tbody').innerHTML = lista.map(c => linhaFilaHtml(c, lista, true)).join('');
  const antTbody = document.getElementById('prog-fila-anteriores-tbody');
  const antWrap = document.getElementById('prog-fila-anteriores');
  if(antTbody) antTbody.innerHTML = anteriores.map(c => linhaFilaHtml(c, anteriores, false)).join('');
  if(antWrap) antWrap.hidden = anteriores.length === 0;
  movLinhasNovas(document.getElementById('prog-fila-tbody'));
  document.getElementById('prog-fila-empty').hidden = lista.length>0;

  // Some sem explicação é pior que não sumir: quem programou ontem
  // precisa saber PARA ONDE a carga foi, não descobrir que "sumiu".
  const aviso = document.getElementById('prog-fila-outros-dias');
  if(aviso){
    aviso.hidden = deOutrosDias === 0;
    aviso.textContent = deOutrosDias === 1
      ? '1 carga de dia anterior ainda sem veículo — está listada logo abaixo, até ganhar placa.'
      : `${deOutrosDias} cargas de dias anteriores ainda sem veículo — estão listadas logo abaixo, até ganharem placa.`;
  }
}

/* Qual linha da fila está aberta. Uma só: duas expansões abertas ao mesmo
   tempo empurram a lista para baixo e quem varre perde a referência. */
let _progFilaAberta = null;

function alternarLinhaProgFilaUI(id){
  _progFilaAberta = (_progFilaAberta === id) ? null : id;
  renderProgFila();
}

/* O QUE SAIU DA LINHA E VEIO PARA CÁ (28/08/2026).

   Nada foi removido do sistema: Tipo de Operação, Ganchos, Entregas,
   Observações, Cliente e Destino continuam editáveis e gravam nas MESMAS
   funções que a Torre e a montagem usam — a alteração cai na carga, entra
   no log de revisões do servidor e sobe para todos os setores.

   O desenho é o mesmo do formulário da montagem (`.mont-form`), de novo por
   causa da ordem: a pessoa que preenche aqui é a mesma que preenche lá. */
function formCargaFilaHtml(c){
  const id = escJs(c.id);
  return `
    <div class="mont-form">
      <div class="form-row">
        ${/* Tipo de Operação subiu para a LINHA em 28/08/2026 — é a 8ª coluna
             da Torre, e o dono contou oito campos editáveis. Sai daqui para
             não existir o mesmo campo em dois lugares da mesma tela. */''}
        <div class="form-group">
          <label>Qtd. Ganchos <span class="hint">0 = Liso</span></label>
          <input type="text" inputmode="numeric" min="0" step="1" value="${c.qtdGanchos ?? 0}"
                 onchange="atualizarGanchosUI('${id}',this.value)"></div>
        <div class="form-group"><label>Qtd. Entregas</label>
          <input type="text" inputmode="numeric" min="0" step="1" value="${c.qtdEntregas ?? 1}"
                 onchange="atualizarEntregasUI('${id}',this.value)"></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Cliente</label>
          <input type="text" value="${esc(c.cliente)}" placeholder="—"
                 onchange="atualizarClienteUI('${id}',this.value)"></div>
        <div class="form-group"><label>Destino</label>
          <input type="text" value="${esc(c.destino)}" placeholder="—"
                 onchange="atualizarDestinoUI('${id}',this.value)"></div>
        <div class="form-group">
          <label>Transportadora <span class="hint">(vem da Frota pela placa)</span></label>
          <input type="text" value="${esc(c.transportadora)}" disabled>
          ${marcaTransportadoraHtml(c) ? `<button type="button" class="btn btn-sec btn-sm" style="margin-top:6px"
              onclick="event.stopPropagation(); usarTransportadoraDaFrotaUI('${id}')"
              title="A Frota diz outra transportadora para esta placa. Este botão alinha a carga ao cadastro.">≠ Frota — usar a da Frota (${esc((buscarFrota(c.placa)||{}).transportadora||'')})</button>` : ''}</div>
      </div>

      <div class="form-group" style="margin-bottom:10px"><label>Observações</label>
        <textarea onchange="atualizarObservacoesUI('${id}',this.value)"
          placeholder="O que a operação precisa saber sobre esta carga">${esc(c.observacoes)}</textarea></div>

      <div class="form-group" style="margin-bottom:10px">
        <span class="text-dim">Programada em ${dataProgramacaoHtml(c)} · status atual ${esc(c.status)}.</span></div>

      <div class="flex-end gap8">
        <button class="btn btn-sec btn-sm" onclick="alternarLinhaProgFilaUI('${id}')">Fechar</button>
      </div>
    </div>`;
}

/* Cliente e Destino da carga — os dois só existiam no formulário de
   criação, e quem errava a digitação tinha que excluir e refazer. */
function atualizarClienteUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.cliente = String(val || '').trim();
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarDestinoUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.destino = String(val || '').trim();
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}

/* Rota e Paletizada viram campo editável na fila — pedido do usuário
   (11/08/2026): "DEIXAR TODOS OS CAMPOS DE PLACA PROGRAMADA EDITAVEIS,
   PESO, ROTA, PALETIZADA, ENTREGAS". Mesmo padrão já usado em
   praOndeSelectHtml. */
function rotaSelectHtml(c){
  return `<select class="rota-inline" aria-label="Rota da carga ${esc(c.numeroCarga || c.placa || '')}" onchange="atualizarRotaUI('${escJs(c.id)}',this.value)">
    <option value="">—</option>
    ${rotasParaEscolher().map(r=>`<option value="${esc(r.codigo)}" ${c.rota===r.codigo?'selected':''}>${esc(rotaCurta(r.codigo))}</option>`).join('')}
  </select>`;
}
function paletizadaSelectHtml(c){
  const atual = paletizadaDaCarga(c);
  return `<select class="palet-inline" aria-label="Paletizada? Carga ${esc(c.numeroCarga || c.placa || '')}" onchange="atualizarPaletizadaUI('${escJs(c.id)}',this.value)">
    ${['Não','Sim'].map(op=>`<option value="${op}" ${atual===op?'selected':''}>${op}</option>`).join('')}
  </select>`;
}
function atualizarRotaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.rota = val || '';
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarPaletizadaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.paletizada = val === 'Sim' ? 'Sim' : 'Não';
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarPesoUI(id, val){
  const c = getCarga(id); if(!c) return;
  /* `quantidadeDigitada`, não `Number`: "27.284" é vinte e sete mil
     duzentos e oitenta e quatro quilos, e o `Number` lia 27. Ver o bloco
     da função em data.js. */
  const nPeso = quantidadeDigitada(val);
  c.peso = nPeso === null ? null : Math.max(0, nPeso);
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarEntregasUI(id, val){
  const c = getCarga(id); if(!c) return;
  const nEnt = quantidadeDigitada(val);
  c.qtdEntregas = nEnt === null ? 1 : Math.max(0, nEnt);
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
/* Transportadora e Observações da CARGA.

   As duas faltavam do lado da carga e existiam só no rascunho da montagem
   — e era por isso que a linha efetivada perdia campo ao virar janela para
   a carga. Os dois são editáveis pela Logística no servidor
   (CAMPOS_EDITAVEIS em dominio/fluxo.js), então a gravação sobe igual às
   demais.

   TRANSPORTADORA vazia significa "o que a Frota disser": quem carrega hoje
   pode não ser o dono do caminhão (subcontratação, troca de última hora), e
   escrever aqui vale só para ESTA carga — o cadastro do veículo fica como
   está. */
function atualizarTransportadoraUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.transportadora = String(val || '').trim();
  c.atualizadoEm = nowISO();   // sem isto a mudança não sobe — ver atualizarSequenciaUI
  SuincoStore.save();
  renderAll();
}
function atualizarObservacoesUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.observacoes = String(val || '');
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
function atualizarMotoristaUI(id, val){
  const c = getCarga(id); if(!c) return;
  /* Só a carga muda — o cadastro da placa na Frota fica como está. São
     coisas diferentes: aqui é quem dirige ESTA viagem (substituto, folga,
     freteiro), lá é o habitual do veículo. */
  c.motorista = String(val || '').trim();
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}

/* Data em que a carga foi PROGRAMADA — pedido do usuário (11/08/2026):
   "NA TORRE DE CONTROLE MOSTRAR A DATA DA PROGRAMACAO DAS CARGAS QUE NAO
   TIVEREM FINALIZADO E SAIDO AINDA".

   Serve pra enxergar carga encalhada: uma linha programada há três dias
   ainda em "Aguardando Veículo" é um problema que a coluna "Atualizado
   em" não denuncia (ela mexe a cada toque, mesmo sem a carga andar).
   Carga de HOJE aparece só como hora, pra não poluir a coluna com a data
   repetida em toda linha no dia normal. */
/* ENCERRAR A PROGRAMAÇÃO ANTERIOR — deixar a Torre pronta para o dia novo.
   (20/08/2026)

   Pedido do gestor: "a programação das viagens que já seguiram viagem e que
   não têm nenhuma pendência aberta [precisa sair] da torre de controle de
   hoje... mantendo apenas as cargas que estão iniciando as etapas".

   Fecha só o que é de DIAS ANTERIORES — a regra mora no servidor, então
   nem um clique errado aqui alcança a programação de hoje. Cada carga
   fechada fica registrada com quem fez e por quê; nada é apagado. */
async function encerrarProgramacaoAnteriorUI(){
  const antigas = cargasAbertas().filter(c=>!c.aguardandoCarga && ehProgramacaoAntiga(c));
  if(!antigas.length){
    notify('Não há pendências de programações anteriores para encerrar.', 'info');
    return;
  }
  const lista = antigas.slice(0, 8)
    .map(c=>`· ${c.numeroCarga || 'sem número'} — ${c.placa} (${c.status})`).join('\n');
  const resumo = `${antigas.length} carga(s) de programações anteriores serão encerradas `
    + `como "Seguiu Viagem":\n\n${lista}`
    + (antigas.length > 8 ? `\n· … e mais ${antigas.length - 8}` : '')
    + '\n\nElas saem da Torre e continuam no Histórico e no relatório do dia delas.'
    + '\n\nMotivo (obrigatório):';
  const motivo = prompt(resumo, 'Caminhões já saíram; encerramento da programação anterior');
  if(motivo === null) return;
  if(!String(motivo).trim()){
    notify('Encerramento cancelado: o motivo é obrigatório.', 'warn');
    return;
  }
  try{
    const r = await comOverlaySync('Encerrando a programação anterior…',
      () => SuincoSharePoint.encerrarProgramacoesAnteriores(String(motivo).trim()));
    await SuincoSharePoint.sincronizarAgora();
    renderAll();
    notifyGravacao(`${r.total} carga(s) da programação anterior encerrada(s). A Torre agora mostra só o dia de hoje.`);
  }catch(e){
    notify('Não consegui encerrar: ' + (e && e.message ? e.message : 'erro no servidor') + '.', 'danger', 8000);
  }
}

/* O BLOCO DE LACRES DOS RELATÓRIOS (20/08/2026).

   Pedido do gestor: as informações de lacre precisam "sair marcadas onde
   devem ficar em todos os relatórios".

   Por que BLOCO e não coluna na tabela principal: a tabela do Operacional
   tem 12 colunas em A4 e foi calibrada para caber sem rolagem lateral —
   enfiar mais uma faria a folha voltar a quebrar, e o lacre não é uma
   propriedade da linha de carga: é do CAMINHÃO. Um caminhão com duas cargas
   apareceria com o mesmo lacre repetido em duas linhas, como se fossem
   dois. Aqui é uma linha por caminhão, que é a verdade do pátio.

   Some sozinho quando não há nada a dizer: relatório com seção vazia ensina
   o leitor a pular seção. */
function blocoLacresPdf(lista){
  const porPlaca = new Map();
  lista.forEach(c=>{
    const l = lacresDaCarga(c);
    if(!l.numeros.length && !l.retido && !l.faltando) return;
    const chave = normalizarPlaca(c.placa);
    const atual = porPlaca.get(chave);
    // Uma linha por caminhão: quem tem duas cargas junta os números delas.
    if(!atual){
      porPlaca.set(chave, {
        placa: c.placa, cargas: [c.numeroCarga].filter(Boolean),
        lacres: l.numeros.slice(), retido: l.retido, motivo: l.motivo,
        por: l.por, em: l.em, faltando: l.faltando,
      });
      return;
    }
    if(c.numeroCarga && !atual.cargas.includes(c.numeroCarga)) atual.cargas.push(c.numeroCarga);
    l.numeros.forEach(n=>{ if(!atual.lacres.includes(n)) atual.lacres.push(n); });
    if(l.retido && !atual.retido){
      atual.retido = l.retido; atual.motivo = l.motivo; atual.por = l.por; atual.em = l.em;
    }
    atual.faltando = atual.faltando && l.faltando;
  });

  const linhas = [...porPlaca.values()];
  if(!linhas.length) return '';

  const comRetencao = linhas.filter(x=>x.retido).length;
  const semLacre = linhas.filter(x=>x.faltando).length;

  const corpo = linhas.map(x=>`<tr${x.retido ? ' class="lacre-linha-retida"' : ''}>
      <td>${esc(x.placa)}</td>
      <td>${esc(x.cargas.join(', ')) || '—'}</td>
      <td>${x.lacres.length ? esc(x.lacres.join(' / ')) : '<span class="obs-pendente">sem lacre informado</span>'}</td>
      <td>${x.retido ? esc(x.retido) : '—'}</td>
      <td>${x.retido
        ? esc([x.motivo, x.por ? 'por ' + x.por : '', x.em ? fmtDataHora(x.em) : '']
            .filter(Boolean).join(' · ')) || '—'
        : '—'}</td>
    </tr>`).join('');

  return `
    <div class="print-bloco-tit">Controle de lacres</div>
    <table class="tab-lacres">
      <thead><tr>
        <th>Placa</th><th>Carga(s)</th><th>Lacre(s) da saída</th>
        <th>Retido</th><th>Motivo da retenção · quem · quando</th>
      </tr></thead>
      <tbody>${corpo}</tbody>
    </table>
    <div class="print-nota">
      ${linhas.length} caminhão(ões) com registro de lacre no período.
      ${comRetencao ? `<strong>${comRetencao} com lacre RETIDO na inspeção.</strong>` : ''}
      ${semLacre ? `<strong>${semLacre} seguiram viagem sem número de lacre informado.</strong>` : ''}
      O lacre é do caminhão, não da carga: quando a placa leva mais de uma carga, os números aparecem uma vez só.
    </div>`;
}

/* "O VEÍCULO JÁ ESTÁ NO PÁTIO" — dito na carga que ainda espera por ele.
   (20/08/2026)

   Relato do programador de embarque, sobre uma placa com duas cargas do
   mesmo dia: "na segunda carga a placa está dando que o veículo não chegou,
   só que o veículo está no pátio... está errado! Tem que ser ao contrário".

   Ele tem razão: "Aguardando Veículo" é o status DA CARGA, não do caminhão.
   Quando outra carga da mesma placa já está no pátio, a informação existe
   no sistema e simplesmente não estava sendo mostrada — quem lia a linha
   concluía o oposto do que era verdade.

   A marca não muda status nenhum: só conta o que já se sabe. Promover a
   segunda carga continua sendo um clique da Portaria, com registro. */
function veiculoJaNoPatio(carga){
  if(!carga || carga.status !== 'Aguardando Veículo') return false;
  const p = normalizarPlaca(carga.placa);
  return cargasAbertas().some(c => c.id !== carga.id
    && normalizarPlaca(c.placa) === p
    && c.status !== 'Aguardando Veículo');
}
/* A ETAPA FOI DEVOLVIDA — e quem olha a fila precisa ver isso ANTES de agir.

   Sem esta marca, a carga devolvida para "Aguardando Veículo" aparece para
   a Portaria idêntica a uma que nunca chegou. O porteiro, que já deixou
   aquele caminhão entrar, lê "não chegou", clica "Chegou" de boa-fé e
   desfaz a correção. Foi o laço do relato do FTZ2138 (29/08/2026).

   Vinho, e não verde: ao contrário do "veículo já no pátio", isto NÃO é
   informação tranquila — é um pedido para parar e conferir. Some sozinha
   quando alguém legitimamente move a carga (ver `aindaVale`). */
function marcaEtapaDevolvidaHtml(carga){
  const d = (typeof etapaDevolvida === 'function') ? etapaDevolvida(carga) : null;
  if(!d || !d.aindaVale) return '';
  const quando = d.quando ? fmtDataHora(d.quando) : 'horário não registrado';
  return `<span class="chip-devolvida" title="${esc(d.setor)} (${esc(d.quem)}) devolveu esta carga `
    + `de &quot;${esc(d.de)}&quot; para &quot;${esc(d.para)}&quot; em ${esc(quando)}. `
    + `O motivo está no Histórico da carga. Confira antes de fazer a carga andar de novo.">`
    + `↩ etapa devolvida</span>`;
}

/* SAIU SEM CARREGAR — a marca que impede o número de mentir (08/09/2026).

   Um caminhão que entrou, entregou devolução e foi embora fica em "Seguiu
   Viagem" igualzinho a quem levou 20 toneladas. Sem esta marca, qualquer
   leitura de "quantas cargas saíram hoje" conta os dois do mesmo jeito, e
   o indicador passa a mentir a favor da operação — que é justamente o que
   a regra da casa sobre fidelidade existe para evitar.

   A marca é da CARGA e vem do servidor (`saidaSemCarregar`), não de uma
   conta feita aqui: quem sabe se houve carregamento é a transação que
   registrou a saída. */
function marcaSaiuSemCarregarHtml(carga){
  if(!carga || carga.saidaSemCarregar !== true) return '';
  return '<span class="chip-sem-carregar" title="Este caminhão entrou, entregou a '
    + 'devolução e foi embora SEM carregar. A saída foi registrada pela Portaria.">'
    + '↩ só devolução</span>';
}

function chipNoPatioHtml(carga){
  return veiculoJaNoPatio(carga)
    ? '<span class="chip-no-patio" title="Outra carga desta mesma placa já está no pátio — o caminhão chegou. '
      + 'Falta a Portaria registrar a chegada TAMBÉM para esta carga (botão Chegou).">🚚 veículo já no pátio</span>'
    : '';
}

/* CARGA DUPLA: O STATUS DA CARGA E A SITUAÇÃO DO CAMINHÃO, LADO A LADO.
   (20/08/2026)

   Pedido do gestor depois do relato do programador de embarque: "o status de
   uma placa com carga dupla, como isso aparece para eles da forma mais clara
   possível".

   O mal-entendido tem uma raiz só: a coluna Status responde sobre a CARGA, e
   quem lê a linha entende que é sobre o CAMINHÃO. Com uma carga por placa os
   dois coincidem e ninguém percebe a diferença. Com duas, elas se separam —
   e foi aí que a leitura virou o oposto da verdade ("está dando que o veículo
   não chegou, só que o veículo está no pátio").

   A solução não é trocar um pelo outro: é dizer os dois. O selo continua
   sendo o da carga; embaixo dele, em uma linha, a situação do caminhão e o
   que está acontecendo com a OUTRA carga dele. Só aparece quando a placa tem
   mais de uma carga em aberto — em caminhão de carga única não há ambiguidade
   e a linha seria ruído. */
function situacaoPlacaHtml(c){
  if(!c) return '';
  const p = normalizarPlaca(c.placa);
  const irmas = cargasAbertas().filter(x => normalizarPlaca(x.placa) === p);
  if(irmas.length < 2) return '';

  const ordenadas = irmas.slice().sort((a,b)=> new Date(a.criadoEm) - new Date(b.criadoEm));
  const posicao = ordenadas.findIndex(x => x.id === c.id) + 1;
  const noPatio = irmas.filter(x => x.status !== 'Aguardando Veículo');
  const outras = ordenadas.filter(x => x.id !== c.id);
  const resumoOutras = outras
    .map(x => `${esc(x.numeroCarga) || 'sem nº'}: ${esc(x.status)}`)
    .join(' · ');

  const ondeEsta = noPatio.length
    ? '<strong>Caminhão NO PÁTIO</strong>'
    : '<strong>Caminhão ainda não chegou</strong>';

  /* O aviso mais importante da tela: o caminhão está aqui e ESTA carga
     continua esperando por ele. É exatamente o caso que travou a Portaria. */
  const pendente = (noPatio.length && c.status === 'Aguardando Veículo')
    ? ' — <span class="sit-acao">falta registrar a chegada desta carga</span>'
    : '';

  return `<div class="sit-placa${noPatio.length ? ' sit-no-patio' : ''}"
      title="${esc('Esta placa tem ' + irmas.length + ' cargas em aberto. O selo acima é o status DESTA carga; '
        + 'esta linha é a situação do CAMINHÃO.')}">
      ${noPatio.length ? '🚚' : '⏳'} ${ondeEsta} · carga ${posicao} de ${irmas.length}${pendente}
      ${resumoOutras ? `<span class="sit-outras">outra(s): ${resumoOutras}</span>` : ''}
    </div>`;
}

/* OS LACRES DE UMA CARGA, EM UM LUGAR SÓ (20/08/2026).

   Pedido do gestor: "as informações de lacre dos porteiros — lacres, tanto
   na saída quanto devoluções, e lacre retido também — saiam como informação
   para a gente na torre de controle, nos relatórios".

   Uma função só monta o texto para todas as telas. É o que garante que a
   Torre, a ficha da carga e os três relatórios digam a MESMA coisa sobre o
   mesmo caminhão — a alternativa (cada tela montando o seu) é como se
   produz relatório que não bate com o painel. */
function lacresDaCarga(c){
  const nums = [c.lacre, c.lacre2, c.lacre3].filter(Boolean);
  return {
    numeros: nums,
    texto: nums.join(' / '),
    retido: c.lacreRetido || '',
    motivo: c.lacreRetidoMotivo || '',
    por: c.lacreRetidoPor || '',
    em: c.lacreRetidoEm || null,
    /* Só é "sem lacre" quem JÁ SAIU sem número informado. Carga que ainda
       está no pátio não tem lacre porque ainda não é hora — apontar isso
       como falta seria alarme falso o dia inteiro. */
    faltando: c.status === 'Seguiu Viagem' && !nums.length,
  };
}

/* O chip que aparece na Torre, embaixo da placa. Fica na célula do VEÍCULO
   porque o lacre é do caminhão, não de uma carga específica — o mesmo
   motivo pelo qual a saída aplica o número a todas as cargas da placa. */
function chipLacreHtml(c){
  const l = lacresDaCarga(c);
  const partes = [];
  if(l.numeros.length){
    partes.push(`<span class="chip-lacre" title="${esc('Lacre(s) da saída: ' + l.texto)}">🔒 ${esc(l.texto)}</span>`);
  }
  if(l.retido){
    const dica = ['Lacre RETIDO na inspeção: ' + l.retido,
      l.motivo ? 'Motivo: ' + l.motivo : '',
      l.por ? 'Registrado por ' + l.por : '',
      l.em ? 'em ' + fmtDataHora(l.em) : ''].filter(Boolean).join(' · ');
    partes.push(`<span class="chip-lacre chip-lacre-retido" title="${esc(dica)}">⚠️ retido ${esc(l.retido)}</span>`);
  }
  if(l.faltando){
    partes.push('<span class="chip-lacre chip-lacre-falta" title="O caminhão saiu sem número de lacre informado pela Portaria.">🔓 sem lacre</span>');
  }
  return partes.join('');
}

/* ÚLTIMA AÇÃO DE UMA PESSOA — não a última gravação da máquina.
   (20/08/2026)

   Relato do gestor olhando a Torre: "todos estão marcando o mesmo horário,
   no mesmo dia". Estavam mesmo, e o horário era verdadeiro para a coisa
   errada: `atualizadoEm` é quando a LINHA foi gravada, e ela é regravada
   sempre que um painel reconecta e reenvia o que tem em memória. Meia
   programação recebia o mesmo carimbo de uma vez, sem ninguém ter tocado
   em nada.

   `acaoEm` (migração 026) só se move quando um campo do processo muda de
   verdade, e vem com o nome de quem mudou. É o que responde a pergunta que
   a Torre existe para responder: "isto andou? quem tocou nisso por
   último?".

   Carga antiga, de antes da migração, não tem esse carimbo — e aí a tela
   diz isso, em vez de mostrar um horário que não significa nada. */
function ultimaAcaoHtml(c){
  /* A FONTE É A TRILHA, NÃO UM CAMPO DA CARGA (20/08/2026).

     Pedido do gestor: "o horário fiel ao horário do histórico da última
     atualização de status". `ultimaMovimentacaoDaCarga` lê exatamente o
     mesmo registro que o Histórico e a linha do tempo desenham — então as
     três telas não têm como discordar entre si, por construção.

     `acaoEm` (migração 026) continua valendo como segunda linha: ele marca
     também EDIÇÃO de campo (peso, rota, observação), que não gera
     movimentação de etapa. Quando alguém editou depois da última mudança de
     etapa, isso aparece na dica — sem tirar da célula o horário que o
     gestor pediu. */
  const mov = ultimaMovimentacaoDaCarga(c.id);
  if(mov){
    const quem = [mov.operador, mov.setor].filter(Boolean).join(' · ');
    const partes = [`Última mudança de etapa (a mesma do Histórico): ${fmtDataHora(mov.timestamp)}`
      + ` — ${mov.statusAnterior ? mov.statusAnterior + ' → ' : ''}${mov.statusNovo}`
      + (quem ? ` por ${quem}` : '')];
    if(c.acaoEm && new Date(c.acaoEm) > new Date(mov.timestamp)){
      partes.push(`Depois disso alguém ainda editou campos desta carga: ${fmtDataHora(c.acaoEm)}`
        + (c.acaoPor ? ` — ${c.acaoPor}${c.acaoSetor ? ' · ' + c.acaoSetor : ''}` : ''));
    }
    return `<span class="dt-atu" title="${esc(partes.join(' | '))}">${fmtDataHora(mov.timestamp)}`
         + (quem ? ` <small class="dt-quem">${esc(quem)}</small>` : '')
         + '</span>';
  }
  /* Sem trilha nenhuma: carga recém-criada, que ainda não mudou de etapa.
     Aí vale o carimbo de ação — e, faltando os dois, a tela diz que não
     sabe, em vez de exibir uma hora de sincronização como se fosse
     trabalho de alguém. */
  if(!c.acaoEm){
    return '<span class="dt-atu dt-sem-acao" title="Esta carga ainda não mudou de etapa e é anterior ao '
         + 'registro de ação por operador. O histórico completo dela está no Histórico e na linha do tempo.'
         + '">sem registro de etapa</span>';
  }
  const quem = [c.acaoPor, c.acaoSetor].filter(Boolean).join(' · ');
  return `<span class="dt-atu" title="${esc('Ainda sem mudança de etapa. Última edição: '
         + fmtDataHora(c.acaoEm) + (quem ? ' — ' + quem : ''))}">${fmtDataHora(c.acaoEm)}`
       + (quem ? ` <small class="dt-quem">${esc(quem)}</small>` : '')
       + '</span>';
}

/* PROGRAMAÇÃO DE HOJE x PENDÊNCIA DE PROGRAMAÇÃO ANTERIOR (19/08/2026).

   Pedido do gestor, no mesmo dia em que a data de programação foi
   corrigida: "manter na torre de controle o que não passou por todas as
   etapas ainda da programação antiga, SEM ATRAPALHAR a programação nova".

   As duas coisas convivem na Torre — carga de ontem que não seguiu viagem
   não pode sumir —, mas não podem se misturar na leitura: quem abre a Torre
   de manhã precisa ver o dia de hoje inteiro primeiro e as sobras do dia
   anterior claramente marcadas embaixo, não uma lista única em que os dois
   dias se confundem.

   O dia é o da PROGRAMAÇÃO (programadoEm), nunca o da entrada do veículo. */
function diasDesdeProgramacao(c){
  const base = c.programadoEm || c.criadoEm || c.atualizadoEm;
  if(!base) return 0;
  const d = new Date(base);
  if(isNaN(d)) return 0;
  d.setHours(0,0,0,0);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.max(0, Math.round((hoje - d) / 86400000));
}
function ehProgramacaoAntiga(c){ return diasDesdeProgramacao(c) >= 1; }

function dataProgramacaoHtml(c){
  // Data da PROGRAMAÇÃO (mesma regra da fila): `criadoEm` é quando a linha
  // nasceu — numa carga vinda de entrada da Portaria, é o dia em que o
  // caminhão entrou, não o dia em que ela foi programada.
  const base = c.programadoEm || c.criadoEm || c.atualizadoEm;
  if(!base) return '<span class="text-dim">—</span>';
  const d = new Date(base);
  if(isNaN(d)) return '<span class="text-dim">—</span>';
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dia = new Date(d); dia.setHours(0,0,0,0);
  const diasAtras = Math.round((hoje - dia) / 86400000);
  if(diasAtras <= 0){
    return `<span class="text-dim">hoje ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>`;
  }
  // Destaque cresce com o atraso: 1 dia é normal (virada de turno),
  // 2+ dias é carga esquecida.
  const classe = diasAtras >= 2 ? 'prog-atrasada' : '';
  const rotulo = diasAtras === 1 ? 'ontem' : `há ${diasAtras} dias`;
  return `<span class="${classe}" title="Programada em ${fmtDataHora(base)}">`
       + `${d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} `
       + `<small>(${rotulo})</small></span>`;
}

/* Contagem de cargas por placa na fila, para a marca "1 de 2".

   Duas linhas com a mesma placa e sem marca nenhuma são indistinguíveis de
   um erro de digitação. Quem olha a fila precisa saber, sem contar linha,
   que aquilo é o mesmo caminhão com duas cargas — senão alguém "corrige" a
   duplicidade que não existe e apaga uma carga de verdade. */
/* A CARGA DIZ UMA TRANSPORTADORA, A FROTA DIZ OUTRA — A TELA MOSTRA (09/09/2026).
   Relato do dono: 118675 / JJB8946 — "Rodosousa" na Torre, "Denia" no
   cadastro. A transportadora da carga é cópia feita quando a placa entra e
   pode ser trocada à mão; a Frota pode mudar depois. Nenhuma das duas telas
   avisava. O marcador aparece quando divergem, e um clique alinha à Frota. */
function marcaTransportadoraHtml(c){
  const f = c && c.placa ? buscarFrota(c.placa) : null;
  if(!f || !f.transportadora) return '';
  const norm = (s)=>String(s||'').trim().toLowerCase();
  if(norm(f.transportadora) === norm(c.transportadora)) return '';
  /* Marcador, não botão: com 17px de altura ele reprovaria a regra dos 44px
     para o dedo no celular. A ação "usar a da Frota" é um botão de verdade
     na expansão da carga. */
  return `<span class="marca-multi marca-frota"
    title="A Frota diz ${esc(f.transportadora)}; esta viagem está com ${esc(c.transportadora || '—')}. Abra a carga para usar a da Frota.">≠ Frota: ${esc(f.transportadora)}</span>`;
}
function usarTransportadoraDaFrotaUI(id){
  const c = getCarga(id); if(!c) return;
  const f = buscarFrota(c.placa); if(!f || !f.transportadora) return;
  c.transportadora = f.transportadora;
  c.atualizadoEm = nowISO();   // sem carimbo a mudança não sobe
  SuincoStore.save();
  notifyGravacao(`Carga ${c.numeroCarga || c.placa}: transportadora alinhada à Frota (${f.transportadora}).`);
  renderAll();
}
function marcaCargaDaPlaca(carga, lista){
  const p = normalizarPlaca(carga.placa);
  if(!p) return '';   // sem caminhão não há "1 de 2" — vazio não é placa
  const irmas = lista.filter(c => normalizarPlaca(c.placa) === p);
  if(irmas.length < 2) return '';
  const posicao = irmas.findIndex(c => c.id === carga.id) + 1;
  return `<span class="marca-multi" title="Este caminhão leva ${irmas.length} cargas nesta programação.">${posicao} de ${irmas.length}</span>`;
}

/* Programar outra carga para o mesmo caminhão.

   Sem isto, o caminho é redigitar placa, transportadora, tipo de veículo,
   motorista, rota e tipo de operação — seis campos que já estão na tela,
   logo acima, na linha da primeira carga. Redigitar dá errado: troca-se um
   dígito da placa e nascem duas cargas em caminhões diferentes.

   O que se REPETE é o veículo e o roteiro. O que MUDA é a carga: número,
   peso, sequência, ganchos, entregas, observações. O formulário vem
   preenchido com o primeiro grupo e limpo no segundo — é exatamente a
   diferença entre as duas cargas, e é só isso que sobra para digitar. */
function adicionarOutraCargaNaPlacaUI(id){
  const c = getCarga(id);
  if(!c){ notify('Carga não encontrada.', 'warn'); return; }

  /* O botão também vive na Torre de Controle (relato de 18/08/2026: a
     carga saía da fila do dia e a opção "sumia"). O formulário fica na
     aba Programação — navega pra lá ANTES de preencher, senão o foco e o
     scrollIntoView miram campos de uma aba escondida. */
  if(typeof TAB_ATUAL !== 'undefined' && TAB_ATUAL !== 'programacao') irParaTab('programacao');

  const v = (campo, valor) => { const e = document.getElementById(campo); if(e) e.value = valor; };

  // Repete: o caminhão e para onde ele vai.
  v('prog-placa', c.placa);
  v('prog-transportadora', c.transportadora || '');
  v('prog-tipoveiculo', c.tipoVeiculo || '');
  v('prog-motorista', c.motorista || '');
  v('prog-rota', c.rota || '');
  v('prog-praonde', c.praOnde || PRA_ONDE_PADRAO);

  // Zera: tudo que é da CARGA, não do veículo. Herdar o número da carga
  // anterior seria a forma mais rápida de gravar duas cargas com o mesmo
  // número — o erro que este botão existe para evitar.
  v('prog-numero-carga', '');
  v('prog-peso', '');
  v('prog-sequencia', '');
  v('prog-obs', '');
  v('prog-paletizada', 'Não');
  v('prog-ganchos', '0');
  v('prog-entregas', '1');

  /* Marca que ESTA próxima criação é multi-carga deliberada, e não um
     lançamento repetido por engano. É o que diferencia os dois pedidos do
     usuário (11/08/2026), que só parecem se contradizer: "não duplicar
     placas na mesma programação" (acidente) versus "podendo somente
     duplicar cargas na mesma placa, e poder ter rotas diferentes se
     necessário" (intenção). O caminho deliberado é este botão. */
  _placaMultiCargaAutorizada = c.placa;

  atualizarPreviewFrotaPrograma();

  const campoNumero = document.getElementById('prog-numero-carga');
  if(campoNumero){
    campoNumero.scrollIntoView({ behavior: 'smooth', block: 'center' });
    campoNumero.focus();
  }
  notify(`Formulário preparado para outra carga da placa ${c.placa}. Informe o número da nova carga.`, 'info');
}
// Sequência continua 100% livre: número manual do Programador de Embarque,
// sem geração automática nem trava de duplicidade — regra confirmada,
// não mexer nisso (docs/DECISOES_CONFIRMADAS.md item 2).
/* DIGITAR UM NÚMERO REORDENA A FILA (08/09/2026).

   Pedido do Wemerson, trazido pelo dono: "se ele digitar 1 numa carga e já
   tiver uma como 1, ela vai automaticamente pra dois, e a que ele colocou 1
   entra no início da fila".

   Antes disto a sequência era um número solto — duas cargas podiam ser 1 ao
   mesmo tempo, e o próprio campo dizia "digite o número que quiser".

   QUEM FAZ A CONTA É O SERVIDOR, numa transação só. Reordenar quinze cargas
   mandando quinze alterações separadas é a família da ocorrência #16 — duas
   escritas em voo, a velha ganha — e com duas pessoas mexendo ao mesmo tempo
   a fila embaralharia sem ninguém entender por quê. Aqui a tela só diz para
   onde a carga foi; a fila nova volta pronta.

   Apagar o campo continua APAGANDO o número, e não mandando para o fim:
   campo vazio não é ordem de reordenar. */
async function moverNaFilaUI(id, posicao){
  const c = getCarga(id); if(!c) return;
  if(!devServidorOk_paraFila()){
    notify('Sem servidor agora — a ordem da fila é decidida pelo servidor e não pode ser mudada offline.', 'warn');
    renderAll();
    return;
  }
  const r = await SuincoSharePoint.sequenciar(id, posicao);
  /* `sequenciar` DEVOLVE a recusa em vez de lançar — quem chama precisa
     olhar o valor. É a regra da casa, e a ocorrência que a criou. */
  if(r && r.recusado){
    notify(r.erro || 'O servidor recusou a reordenação.', 'error');
    await SuincoSharePoint.sincronizarAgora();
    renderAll();
    return;
  }
  if(r && r.enfileirado){
    notify('Sem servidor agora — a ordem não foi mudada.', 'warn');
    renderAll();
    return;
  }
  await SuincoSharePoint.sincronizarAgora();
  notifyGravacao(`Carga ${c.numeroCarga || c.placa} foi para a posição ${posicao}.`);
  renderAll();
}

function devServidorOk_paraFila(){
  return typeof SuincoSharePoint !== 'undefined'
    && SuincoSharePoint.estaConfigurado && SuincoSharePoint.estaConfigurado();
}

/* POSIÇÃO NA FILA — NÃO É A MESMA COISA QUE "SEQUÊNCIA LIVRE" (08/09/2026).

   Estas duas telas escrevem no mesmo campo e querem coisas DIFERENTES:

     · Torre de Controle  — "Sequência livre": o número que o programador
       escreve. Vale o que ele digitou, mesmo 7 numa lista de 2.
     · Fila de Programados — "posição na fila": a carga entra naquela casa
       e as outras descem uma. O servidor renumera de 1 a N.

   Eu já mandei as duas para moverNaFilaUI() achando que era "uma função,
   dois chamadores". Não era: eram duas PERGUNTAS diferentes com o mesmo
   nome de campo. O resultado foi a Torre parar de guardar a sequência
   digitada — o defeito de 14/08/2026 de volta, "alterei três vezes e ela
   não se mantém". Juntar decisões diferentes quebra tanto quanto copiar
   a mesma decisão em dois lugares. */
function definirPosicaoNaFilaUI(id, val){
  const n = quantidadeDigitada(val);
  if(val === '' || !Number.isInteger(n) || n < 1){
    /* Campo vazio não é ordem de apagar a ordem: só redesenha e devolve
       o valor que o servidor tem. */
    renderAll();
    return;
  }
  moverNaFilaUI(id, n);
}

/* ARRASTAR E DIGITAR NA TORRE (09/09/2026).

   Pedido do dono: "quero conseguir arrastar a ordem do sequenciamento de
   carga na torre de controle" e, sobre digitar × arrastar: "os 2 precisam
   funcionar, mantendo a logica e a sequencia".

   O CUIDADO É A OCORRÊNCIA #27, desta mesma manhã. Lá eu mandei TODO inteiro
   para moverNaFilaUI porque a Torre e a Fila compartilhavam o nome do campo
   — e a Torre parou de guardar a sequência digitada, o defeito de 14/08 de
   volta. A diferença aqui: quem decide não é a TELA, é o STATUS DA LINHA,
   que está visível na cor do selo, e a alça só aparece onde arrastar
   funciona. A pessoa vê antes de tentar.

     ainda vai carregar  → posição na fila, cascata no servidor (o mesmo
                           caminho do arrastar: uma conta só)
     já carregou         → o número é registro; guarda o valor, carimba
                           para subir, e NÃO reordena ninguém */
function aindaVaiCarregar(c){
  /* A LISTA MORA EM data.js (09/09/2026) — uma função, dois chamadores.
     Ela já estava escrita aqui em prosa (dois `===` com ||) e passou a ser
     precisa também em dadosManobrista, que é dado e vive em data.js. Duas
     cópias da MESMA pergunta divergem no dia em que um status entrar no
     fluxo, e aí a Torre deixa de arrastar uma carga que o papel do
     manobrista continua listando. */
  return !!c && STATUS_QUE_AINDA_CARREGAM_UI.includes(c.status);
}
function definirSequenciaTorreUI(id, val){
  const c = getCarga(id); if(!c) return;
  if(aindaVaiCarregar(c)) return definirPosicaoNaFilaUI(id, val);
  return atualizarSequenciaUI(id, val);
}

function atualizarSequenciaUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.sequencia = quantidadeDigitada(val);
  /* Sem este carimbo a alteração NÃO SOBE ao servidor.

     `sincronizarCargasAlteradas` decide o que enviar comparando
     `atualizadoEm` com a marca do que já subiu — sem carimbo novo, a carga
     é lida como "nada mudou" e nunca é enviada. A sequência ficava só na
     tela de quem editou e voltava ao valor do servidor no sincronismo
     seguinte. Relato do programador de embarque em 14/08/2026: "já alterei
     três vezes e ela não se mantém na torre de controle". */
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();   // campo aparece na Fila de Programados E na Torre editável
}
// Popula os selects de Rota. Uma função só, alimentada por ROTAS em data.js —
// acrescentar uma rota lá aparece nos dois formulários sem tocar aqui.
/* ARRASTAR PARA MUDAR A ORDEM (08/09/2026).

   Arrastar e digitar são a MESMA operação — "mover para a posição N" — e
   por isso as duas terminam em moverNaFilaUI(). Uma função, dois
   chamadores: duas contas de posição diferentes divergiriam no primeiro
   caso de borda, e o caso de borda aqui é a fila do dia de embarque.

   Guarda só o id do que está sendo arrastado. A POSIÇÃO não é calculada
   aqui: quem responde "para que número isso vai" é a posição da linha
   sobre a qual soltou, lida da tela na hora — porque é isso que a pessoa
   está vendo quando solta. */
let _filaArrastando = null;

function filaArrastarInicio(ev, id){
  _filaArrastando = id;
  ev.dataTransfer.effectAllowed = 'move';
  /* Firefox só inicia o arrasto se algum dado for escrito. */
  try{ ev.dataTransfer.setData('text/plain', id); }catch(e){}
  const tr = ev.currentTarget;
  if(tr && tr.classList) tr.classList.add('fila-arrastando');
}

function filaArrastarSobre(ev){
  if(!_filaArrastando) return;
  ev.preventDefault();                      // sem isto o navegador não deixa soltar
  ev.dataTransfer.dropEffect = 'move';
  const tr = ev.currentTarget;
  if(tr && tr.classList) tr.classList.add('fila-alvo');
}

function filaArrastarFim(){
  _filaArrastando = null;
  document.querySelectorAll('.fila-arrastando, .fila-alvo')
    .forEach(el => el.classList.remove('fila-arrastando','fila-alvo'));
}

function filaArrastarSolta(ev, idDestino){
  ev.preventDefault();
  ev.stopPropagation();
  const movido = _filaArrastando;
  filaArrastarFim();
  if(!movido || movido === idDestino) return;
  /* MANDA O NÚMERO DA LINHA DE DESTINO, NÃO A POSIÇÃO DELA (08/09/2026).

     Antes isto mandava o índice da linha na tela, contando de 1. Enquanto a
     fila era numerada 1, 2, 3... índice e número eram a mesma coisa e não
     dava para notar a diferença. Passaram a ser coisas distintas quando os
     números de quem já carregou viraram reservados: a fila pode ser
     4, 5, 6 num dia em que três caminhões já saíram, e a primeira linha da
     tela é o número 4.

     Quem solta em cima da linha que mostra "5" quer o número 5. É o mesmo
     valor que ela digitaria no campo — e por isso arrastar e digitar
     continuam sendo a mesma operação. */
  const alvo = getCarga(idDestino);
  if(!alvo) return;
  /* RECUSA CALADA É RECUSA QUE ENSINA A DESCONFIAR DO PAINEL (17/09/2026).

     Isto era `if(!alvo || alvo.sequencia == null) return;` — um `return`
     mudo. A pessoa arrastava a carga, soltava em cima de uma linha SEM
     número, não acontecia absolutamente nada, e a conclusão razoável era
     "o arrasto está quebrado". Não estava: ela tinha soltado no único tipo
     de linha que não é um destino, e o painel não contou.

     A regra da casa é "recusa do servidor nunca pode ser silenciosa". A da
     tela também não pode — e aqui ela ainda ensina o caminho. */
  if(alvo.sequencia == null){
    notify('Essa linha ainda não tem número na fila, então não dá para soltar em cima dela. '
      + 'Digite o número que você quer no campo Sequência da carga que está movendo.', 'warn', 8000);
    return;
  }
  moverNaFilaUI(movido, alvo.sequencia);
}

function preencherSelectsRota(){
  const opcoes = '<option value="">(rota não informada)</option>' +
    rotasParaEscolher().map(r=>`<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
  // Sempre reconstrói (não só na primeira vez): uma rota cadastrada em
  // Cadastros → Cadastrar Rota precisa aparecer aqui na hora, sem esperar
  // reload. Preserva o valor selecionado — chamar isto não pode limpar uma
  // rota que o Programador já tinha escolhido no formulário.
  ['prog-rota','completar-rota'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const valorAtual = el.value;
    el.innerHTML = opcoes;
    if(valorAtual) el.value = valorAtual;
  });
}

function praOndeSelectHtml(c){
  return `<select class="praonde-inline" aria-label="Tipo de operação da carga ${esc(c.numeroCarga || c.placa || '')}" onchange="atualizarPraOndeUI('${c.id}',this.value)">
    ${PRA_ONDE_OPCOES.map(op=>`<option value="${op}" ${c.praOnde===op?'selected':''}>${esc(PRA_ONDE_LABEL[op])}</option>`).join('')}
  </select>`;
}
function atualizarPraOndeUI(id, val){
  const c = getCarga(id); if(!c) return;
  c.praOnde = PRA_ONDE_OPCOES.includes(val) ? val : PRA_ONDE_PADRAO;
  c.atualizadoEm = nowISO();
  SuincoStore.save();
  renderAll();
}
/* Troca de placa numa carga já criada.

   Segue EXATAMENTE a mesma regra do lançamento novo, e isso é intencional:
   se a placa nova não estiver na Frota, a troca é recusada e o campo volta
   ao valor anterior. Aceitar aqui o que o formulário de criação recusa
   abriria uma porta lateral para furar a trava de frota — bastaria criar a
   carga com uma placa válida e trocar depois.

   A transportadora e o tipo de veículo vêm da base, não do que estava na
   carga: trocar a placa e manter a transportadora antiga produziria um
   registro que não bate com a realidade, e ninguém perceberia. */
async function atualizarPlacaUI(id, val){
  const c = getCarga(id);
  if(!c) return;
  const nova = normalizarPlaca(val);

  if(!nova){
    notify('Placa não pode ficar em branco.', 'warn');
    renderAll();
    return;
  }
  if(nova === c.placa){ renderAll(); return; }

  const frota = buscarFrota(nova);
  if(!frota){
    notify(`Placa ${nova} não está cadastrada na Frota. Cadastre em Cadastros → Frota antes de usá-la.`, 'warn');
    renderAll();   // devolve o campo ao valor anterior
    return;
  }

  const anterior = c.placa;
  /* PLACA ENTRANDO É CONTRATAR, E TROCAR DE TRANSPORTADORA PEDE O FRETE DE
     NOVO (06/10/2026). Mesma transportadora (outro caminhão dela) mantém o
     frete. A pergunta vem com o anterior marcado, para confirmar ou corrigir. */
  const norm = (t) => String(t || '').trim().toUpperCase();
  const contratando = !String(anterior || '').trim();
  const trocou = !contratando && norm(frota.transportadora) !== norm(c.transportadora) && !freteIsentoLocal(frota.transportadora);
  if(contratando || trocou){
    const r = await garantirFreteParaContratar({
      ...infoFreteDaCarga(c), placa: nova, transportadora: frota.transportadora || '', tipoVeiculo: frota.tipoVeiculo || '',
      valorTabela: trocou ? null : c.freteValor ?? null,
    }, trocou ? 'troca' : 'contratar');
    if(!r){
      notify(`Placa NÃO alterada: sem a observação do frete${trocou ? ' da nova transportadora' : ''} a carga não é contratada.`, 'warn', 8000);
      renderAll();
      return;
    }
    c.freteObservacao = r.freteObservacao;
    c.freteCombinado = r.freteObservacao === 'COMBINADO' ? r.freteCombinado : null;
  }
  c.placa = nova;
  c.transportadora = frota.transportadora || '';
  c.tipoVeiculo = frota.tipoVeiculo || '';
  c.atualizadoEm = nowISO();

  // Troca de placa é alteração de dado operacional, não mudança de status:
  // entra no log de auditoria sem gerar movimentação na linha do tempo, que
  // ficaria poluída com evento que não é etapa do fluxo.
  registrarAlteracao({
    cargaId: c.id, placa: nova,
    campo: 'Placa',
    de: anterior,
    para: `${nova} (transportadora: ${c.transportadora || '—'})`,
    setor: (DB.operador && DB.operador.setor) || 'Logística',
    operador: (DB.operador && DB.operador.nome) || '(não identificado)'
  });

  const recados = reconciliarPatioAoTrocarPlaca(c, anterior);

  SuincoStore.save();
  notify(`Placa alterada para ${nova} — transportadora ${c.transportadora || 'não informada'}.`, 'success');
  recados.forEach(m => notify(m, 'info'));
  renderAll();
}

/* O PÁTIO É CONSULTADO NA TROCA DE PLACA — relato do Alysson, 26/08/2026.

   "A carga do GPA já tinha entrado nesse caminhão aqui, o FTZ. A portaria
   tinha registrado nele também. Aí eu alterei a carga do GPA ali na torre...
   alterou tudo, só que o status do veículo, informando que a carga já estava
   aqui, não mudou. Tive que registrar na portaria novamente... depois
   apareceu duas informações."

   Duas metades, e as duas terminam na mesma duplicata:

     · a placa que ENTRA na carga já estava no pátio, e a carga continuava
       esperando um caminhão parado lá dentro;
     · a placa que SAI sumia da tela da Portaria, que só mostra placa com
       carga aberta. Para o porteiro, a entrada das 12:49 tinha evaporado —
       e ele registrou de novo. Essa segunda entrada é a duplicata.

   Isto aqui é a resposta IMEDIATA na tela. Quem manda é o servidor, que faz
   a mesma coisa em reconciliarPatioNaTrocaDePlaca (backend/src/rotas/
   cargas.js) e grava a trilha completa. O painel adianta o resultado para o
   operador não ficar olhando um estado que ele sabe estar errado.

   SÓ ANTES DA DOCA, decisão do dono: depois que o embarque começou, trocar
   placa é caso excepcional e a etapa só muda por correção com motivo. */
function reconciliarPatioAoTrocarPlaca(carga, placaAntiga){
  const recados = [];
  if(carga.status !== 'Aguardando Veículo' && carga.status !== 'Aguardando Embarque') return recados;

  const quem = (DB.operador && DB.operador.nome) || '(não identificado)';
  const setor = (DB.operador && DB.operador.setor) || 'Logística';
  const hora = (iso) => iso ? fmtDataHora(iso) : 'horário não registrado';

  /* ---- Metade 1: a placa nova já está no pátio ---- */
  /* O miolo mora em data.js (absorverEntradaDoPatio) porque a MESMA
     situação acontece por dois caminhos: trocar a placa de uma carga, e
     criar carga para uma placa que já entrou. Antes ele existia só aqui, e
     por isso o segundo caminho ficava sem tratamento — era o relato do
     dono em 27/08. Uma função, dois chamadores. */
  recados.push(...absorverEntradaDoPatio(carga, { nome: quem, setor }));

  /* ---- Metade 2: a placa antiga fica sozinha no pátio ---- */
  /* Só quando o caminhão antigo tinha de fato entrado: carga que nunca passou
     de "Aguardando Veículo" não deixa caminhão nenhum para trás. */
  const entradaAntiga = entradaNoPatioDe(carga);
  const aindaTemCarga = cargasAbertas().some(x =>
    x.id !== carga.id && normalizarPlaca(x.placa) === normalizarPlaca(placaAntiga));

  if(entradaAntiga && !aindaTemCarga){
    const frota = buscarFrota(placaAntiga);
    const solta = {
      id: uid('carga'), numeroCarga: 'Aguardando Carga', placa: normalizarPlaca(placaAntiga),
      transportadora: frota ? frota.transportadora : '',
      tipoVeiculo: frota ? frota.tipoVeiculo : '',
      motorista: '', cliente: '', destino: '', produto: '', peso: 0, doca: '',
      sequencia: null, observacoes: '', rota: '',
      praOnde: praOndeSugerido(frota ? frota.transportadora : ''),
      paletizada: 'Não', qtdGanchos: 0, qtdEntregas: 1,
      status: 'Aguardando Embarque', aguardandoCarga: true,
      criadoEm: entradaAntiga, criadoPor: quem,
      atualizadoEm: nowISO(), _nuncaConfirmada: true
    };
    DB.cargas.push(solta);
    registrarMovimentacao({
      cargaId: solta.id, placa: solta.placa,
      statusAnterior: null, statusNovo: 'Aguardando Embarque',
      operador: quem, setor, timestamp: entradaAntiga
    });
    recados.push(`${solta.placa} ficou no pátio sem carga — continua lá, com a `
      + `entrada de ${hora(entradaAntiga)}. A Portaria não precisa registrar de novo.`);
  }

  return recados;
}

function atualizarNumeroCargaUI(id, val){
  const c = getCarga(id);
  if(!c) return;
  /* Limpa aspas e espaços que vieram da digitação. O caso real que motivou
     isto: `118176'` entrou no sistema com uma aspa no fim e não casava com
     nada — nem na busca, nem na conferência do relatório. */
  const novo = normalizarNumeroCarga(val);

  if(!novo){
    notify('Número da carga não pode ficar em branco.', 'warn');
    renderAll();   // devolve o campo ao valor anterior
    return;
  }
  if(novo === c.numeroCarga){ renderAll(); return; }

  const anterior = c.numeroCarga;
  c.numeroCarga = novo;
  c.atualizadoEm = nowISO();

  registrarAlteracao({
    cargaId: c.id, placa: c.placa,
    campo: 'Número da Carga',
    de: anterior || '—',
    para: novo,
    setor: (DB.operador && DB.operador.setor) || 'Logística',
    operador: (DB.operador && DB.operador.nome) || '(não identificado)'
  });

  SuincoStore.save();
  notify(`Número da carga alterado para ${novo}.`, 'success');
  renderAll();
}
function atualizarGanchosUI(id, val){
  const c = getCarga(id); if(!c) return;
  const nGan = quantidadeDigitada(val);
  c.qtdGanchos = nGan === null ? 0 : Math.max(0, nGan);
  c.atualizadoEm = nowISO();   // sem isto a mudança não sobe — ver atualizarSequenciaUI
  SuincoStore.save();
  renderAll();   // campo aparece na Fila de Programados E na Torre editável
}
/* REORGANIZAR POR SEQUÊNCIA — O BOTÃO QUE AVISAVA SUCESSO SEM FAZER NADA.
   =====================================================================

   RELATO DO DONO (17/09/2026): "um botão de 'reorganizar por sequência' em
   todas essas áreas, QUE FUNCIONE CORRETAMENTE".

   O QUE ESTAVA AQUI, inteiro:

       function reordenarPorSequenciaUI(){
         renderProgFila();
         notify('Fila reordenada por Sequência.', 'success');
       }

   Ele redesenhava a tela — que JÁ desenhava ordenada por sequência — e
   anunciava sucesso. O aviso era verdadeiro sobre a tela e mentiroso sobre
   a fila: quem clicava via 1, 2, 14 continuar 1, 2, 14 com um "pronto!"
   verde em cima. Botão que afirma ter feito e não fez gasta a confiança de
   quem opera em tudo o mais que o painel diz.

   QUEM FAZ A CONTA É O SERVIDOR, numa transação só — a mesma regra do
   arrasto e da digitação, pelo mesmo motivo: renumerar quinze cargas em
   quinze chamadas é a família da ocorrência #16.

   PERGUNTA ANTES, PORQUE MEXE EM TODO MUNDO. Digitar um número mexe numa
   carga; este botão mexe na fila inteira. Regra da casa: quando a ação é
   arriscada, PERGUNTE explicando — não bloqueie quem tem autoridade. */
async function reorganizarFilaDoDiaUI(dia, ondeEstou){
  if(!devServidorOk_paraFila()){
    notify('Sem servidor agora — quem renumera a fila é o servidor, e isso não pode ser feito offline.', 'warn', 8000);
    return;
  }
  const ok = confirm(
    `Reorganizar a sequência de ${fmtData(dia)}?\n\n`
    + `As cargas que ainda vão carregar passam a ocupar 1, 2, 3... na ordem `
    + `em que estão na tela, fechando os buracos.\n\n`
    + `Quem JÁ carregou não muda de número — aqueles números ficam reservados `
    + `e a fila desvia deles.`);
  if(!ok) return;

  const r = await SuincoSharePoint.reorganizarFila(dia);
  /* A recusa do servidor NUNCA é silenciosa, e `reorganizarFila` devolve a
     recusa em vez de lançar — quem chama tem que olhar o valor. */
  if(r && r.recusado){
    notify(r.erro || 'O servidor recusou a reorganização.', 'error', 8000);
    await SuincoSharePoint.sincronizarAgora();
    renderAll();
    return;
  }
  await SuincoSharePoint.sincronizarAgora();
  const n = (r && r.item && r.item.renumeradas) || 0;
  const total = (r && r.item && r.item.total) || 0;
  /* O AVISO DIZ O NÚMERO, e diz quando o número é zero. "Pronto!" depois de
     nada ter mudado é exatamente o defeito que este botão tinha. */
  notify(
    total === 0 ? `Não há carga esperando para carregar em ${fmtData(dia)}.`
    : n === 0   ? `A fila de ${fmtData(dia)} já estava em ordem — nada mudou.`
                : `Fila de ${fmtData(dia)} reorganizada: ${n} de ${total} carga(s) renumerada(s).`,
    n ? 'success' : 'info', 7000);
  renderAll();
}

function reordenarPorSequenciaUI(){
  return reorganizarFilaDoDiaUI(diaFilaSelecionado(), 'fila');
}

/* NA TORRE O BOTÃO É EXPLICITAMENTE DE HOJE, e o rótulo diz isso.

   A Torre mostra TODAS as cargas em aberto, de vários dias — ela não tem
   um "dia selecionado" como a Fila e a Montagem têm. Reorganizar sem
   dizer qual dia renumeraria uma fila que a pessoa talvez nem esteja
   olhando. Então o botão se compromete com um: hoje. */
function reorganizarSequenciaTorreUI(){
  return reorganizarFilaDoDiaUI(isoDiaLocal(new Date()), 'torre');
}
/* Excluir carga programada.

   A ordem aqui é deliberada: apaga da tela primeiro, avisa o servidor
   depois. É a mesma regra que vale para o resto do painel — quem clicou
   está com o caminhão na frente e não pode esperar a rede. Se o servidor
   recusar (carga já em operação, setor sem permissão), a carga volta na
   sincronia seguinte, com aviso do motivo.

   Sem rede, a exclusão entra na fila e sobe depois. */
async function excluirCargaUI(id){
  const c = getCarga(id); if(!c) return;

  /* Carga que já seguiu viagem não sai: o caminhão passou pela portaria, a
     nota existe. Apagar isso é apagar o que aconteceu, e o mês deixa de
     fechar. */
  if(c.status === 'Seguiu Viagem'){
    notify('Esta carga já seguiu viagem e não pode ser removida. O histórico do pátio não se apaga.', 'warn', 9000);
    return;
  }

  /* Carga que JÁ ANDOU é cancelamento, não exclusão — e cancelamento pede
     motivo. Antes, sair de "Aguardando Veículo" tornava a carga impossível
     de remover: ela sumia da tela de Programação e não havia mais como agir
     sobre ela em lugar nenhum. Um caminhão que encostou e foi embora sem
     carregar travava a fila do pátio até alguém mexer no banco.

     O motivo não é burocracia: é a diferença entre "a carga sumiu" e "o
     cliente desmarcou". Daqui a três meses, só ele responde. */
  const jaAndou = c.status !== 'Aguardando Veículo';
  let motivo = '';
  if(jaAndou){
    motivo = (prompt(
      `A carga da placa ${c.placa} está em "${c.status}" e já tem histórico.\n\n`
      + 'Descreva o motivo do cancelamento (fica registrado no log):') || '').trim();
    if(!motivo) return;                       // desistiu
    if(motivo.length < 3){
      notify('Escreva um motivo com pelo menos 3 letras.', 'warn');
      return;
    }
  } else if(!movConfirmadoPorGesto()
            && !confirm(`Excluir a carga programada da placa ${c.placa}? Essa ação não pode ser desfeita.`)){
    /* Segurar o botão 1,5 s JÁ é a confirmação (ver movConfirmadoPorGesto).
       A janela continua para quem chegou por teclado ou por outra porta —
       uma pergunta, nunca zero. */
    return;
  }

  await _efetivarExclusaoCarga(id, c, motivo, jaAndou);
}

/* Miolo comum de "excluir/cancelar", compartilhado por excluirCargaUI e
   excluirCargaSeguiuViagemUI — a diferença entre os dois está inteira na
   confirmação exigida antes de chegar aqui, não no efeito. */
async function _efetivarExclusaoCarga(id, c, motivo, jaAndou, forcarSeguiuViagem){
  const numero = c.numeroCarga || '';
  const placa = c.placa;

  DB.cargas = DB.cargas.filter(x=>x.id!==id);
  DB.movimentacoes = DB.movimentacoes.filter(m=>m.cargaId!==id);
  registrarAlteracao({
    cargaId: id, placa,
    campo: jaAndou ? 'Carga cancelada' : 'Carga excluída',
    de: numero ? `Carga ${numero}` : `Placa ${placa}`,
    para: jaAndou ? `(cancelada em ${c.status}) — ${motivo}` : '(excluída)',
    setor: (DB.operador && DB.operador.setor) || 'Logística',
    operador: (DB.operador && DB.operador.nome) || '(não identificado)'
  });
  SuincoStore.save();
  renderAll();

  if(typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.excluir){
    notify('Carga excluída.', 'success');
    return;
  }
  try{
    const r = await SuincoSharePoint.excluir(id, motivo, forcarSeguiuViagem ? { forcarSeguiuViagem: true } : undefined);
    if(r && r.recusado){
      notify(`O servidor recusou a exclusão: ${r.erro} A carga volta na próxima sincronia.`, 'danger', 12000);
      return;
    }
    notify(r && r.enfileirado
      ? 'Carga excluída aqui. Sem rede no momento — sobe assim que voltar.'
      : 'Carga excluída. Os outros setores já foram avisados.', 'success');
  }catch(e){
    notify('Carga excluída aqui, mas o servidor não confirmou. Ela pode voltar na próxima sincronia.', 'warn', 12000);
  }
}

/* Excluir uma carga que JÁ seguiu viagem — caminho deliberadamente mais
   pesado que excluirCargaUI. A proteção original (carga com nota fiscal
   emitida não deveria sumir, ou o mês não fecha) continua valendo por
   padrão; isto aqui é a válvula de escape para quando a carga não é uma
   viagem real — dado de teste que passou pelo fluxo inteiro (ex.:
   DJF8527), placa cadastrada errada, etc. Por isso pede a placa digitada
   de próprio punho: clique errado num botão "Excluir" não é o bastante
   pra apagar histórico de verdade. */
async function excluirCargaSeguiuViagemUI(id){
  const c = getCarga(id); if(!c) return;
  const digitado = (prompt(
    `Esta carga (placa ${c.placa}, nº ${c.numeroCarga || '—'}) já SEGUIU VIAGEM. `
    + 'Excluir agora apaga o histórico dela dos relatórios e do faturamento — '
    + 'só faça isso se for dado de teste ou cadastro errado, não uma viagem real.\n\n'
    + `Para confirmar, digite a placa exatamente: ${c.placa}`) || '').trim();
  if(!digitado) return;
  if(normalizarPlaca(digitado) !== c.placa){
    notify('Placa digitada não confere. Nada foi excluído.', 'warn');
    return;
  }
  const motivo = `Exclusão de carga já finalizada (Seguiu Viagem), confirmada digitando a placa — ${(DB.operador && DB.operador.nome) || '(não identificado)'}`;
  await _efetivarExclusaoCarga(id, c, motivo, true, true);
}
function renderProgAguardando(){
  /* `cargasAbertas()`, não `DB.cargas` — relato de 14/08/2026: "não consigo
     excluir essas duas cargas que ficaram como resíduo".

     O caminho que gera o resíduo: um caminhão chega sem programação (nasce
     um registro `aguardandoCarga`), a carga dele nunca é lançada, e depois
     ele vai embora — a Portaria registra a saída e o registro vira "Seguiu
     Viagem", mas continua com a marca `aguardandoCarga`.

     Esta lista usava a lista CRUA, sem tirar quem já saiu, então o registro
     ficava aqui para sempre: não dá para lançar carga de um caminhão que já
     foi embora, e o botão Excluir se recusa — com razão — a apagar quem já
     viajou. O contador ao lado desta mesma tabela já usava `cargasAbertas()`
     (linha do `aguardandoCargaCount`), então os dois discordavam na tela.

     A correção não é liberar a exclusão: histórico do pátio não se apaga
     mesmo. É parar de chamar de "aguardando carga" um caminhão que já saiu.
     Ele continua no Histórico e nos relatórios, onde deve estar. */
  const lista = cargasAbertas().filter(c=>c.aguardandoCarga);
  const pill = document.getElementById('prog-aguardando-count');
  pill.hidden = lista.length===0; pill.textContent = lista.length;
  document.getElementById('prog-aguardando-tbody').innerHTML = lista.map(c=>`
    <tr>
      <td>${esc(c.placa)}</td><td>${esc(c.transportadora)||'—'}</td><td>${esc(c.tipoVeiculo)||'—'}</td>
      <td>${fmtDataHora(c.criadoEm)}</td>
      <td class="no-print gap8">
        <!-- "Criar carga", não "Completar dados" — pedido do programador
             de cargas (12/08/2026), e a palavra dele descreve melhor o que
             acontece: o caminhão chegou sem programação, então ele está
             CRIANDO a carga daquele veículo, não preenchendo lacunas de
             algo que já existia. O botão é o mesmo, o fluxo é o mesmo; o
             nome é que estava contando outra história. -->
        <button class="btn btn-primary btn-sm" onclick="abrirCompletar('${escJs(c.id)}')"><svg class="ico ico-btn" aria-hidden="true"><use href="#i-mais"/></svg>Criar carga</button>
        <!-- Excluir aqui — pedido do usuário (11/08/2026): "ADICIONAR UM
             BOTAO DE EXCLUIR NO AGUARDANDO CARGA". Caminhão que a Portaria
             registrou por engano (placa errada, veículo que só passou)
             ficava preso nesta lista para sempre: sem número de carga não
             dá pra completar, e não havia como tirar. Usa a MESMA função
             de exclusão do resto do painel, com as mesmas travas de
             permissão e o mesmo registro no Histórico. -->
        <button class="btn btn-danger btn-sm" onclick="excluirCargaUI('${escJs(c.id)}')"
                title="Remover este registro — use quando a chegada foi lançada por engano.">Excluir</button>
      </td>
    </tr>`).join('');
  document.getElementById('prog-aguardando-empty').hidden = lista.length>0;
}
function abrirCompletar(id){
  const c = getCarga(id); if(!c) return;
  document.getElementById('completar-id').value = id;
  /* "No pátio desde" só quando a chegada foi REGISTRADA. O `|| c.criadoEm`
     que estava aqui trocava a resposta honesta pela data em que a LINHA
     nasceu — que numa carga programada é a véspera. Foi assim que uma
     placa que chegou de manhã apareceu "no pátio desde 20:42 de ontem". */
  const entradaCompletar = entradaNoPatioDe(c);
  document.getElementById('completar-placa-info').textContent = entradaCompletar
    ? `Placa ${c.placa} — no pátio desde ${fmtDataHora(entradaCompletar)}`
    : `Placa ${c.placa} — chegada ainda não registrada pela Portaria`;
  document.getElementById('completar-numero-carga').value = '';
  document.getElementById('completar-cliente').value = '';
  document.getElementById('completar-destino').value = '';
  document.getElementById('completar-peso').value = '';
  document.getElementById('completar-sequencia').value = '';
  document.getElementById('completar-transportadora').value = c.transportadora || '';
  document.getElementById('completar-tipoveiculo').value = c.tipoVeiculo || '';
  document.getElementById('completar-motorista').value = '';
  document.getElementById('completar-obs').value = '';
  document.getElementById('completar-praonde').value = praOndeSugerido(c.transportadora);
  document.getElementById('completar-rota').value = '';
  document.getElementById('completar-paletizada').value = 'Não';
  document.getElementById('completar-ganchos').value = '0';
  document.getElementById('completar-entregas').value = '1';
  document.getElementById('completar-frete-destino').value = c.freteDestino || '';
  document.getElementById('completar-km-destino').value = kmTexto(c.kmDestino);
  document.getElementById('completar-km-deslocamento').value = kmTexto(c.kmDeslocamento);
  document.getElementById('modal-completar').classList.add('open');
}
function fecharModalCompletar(){ document.getElementById('modal-completar').classList.remove('open'); }
async function salvarCompletarCarga(){
  const id = document.getElementById('completar-id').value;
  const cAg = getCarga(id);
  /* Completar a chegada é contratar: pergunta o frete antes (06/10/2026). */
  const frete = cAg ? await garantirFreteParaContratar({
    ...infoFreteDaCarga(cAg),
    transportadora: document.getElementById('completar-transportadora').value || cAg.transportadora,
    numeroCarga: document.getElementById('completar-numero-carga').value,
    destino: document.getElementById('completar-frete-destino').value,
    km: kmValidoLocal(document.getElementById('completar-km-deslocamento').value),
  }, 'contratar') : null;
  if(cAg && !frete){
    notify('Carga NÃO completada: sem a observação do frete a carga não é contratada.', 'warn', 8000);
    return;
  }
  try{
    completarCargaAguardando(id, {
      freteObservacao: frete && frete.freteObservacao,
      freteCombinado: frete && frete.freteCombinado,
      numeroCarga: document.getElementById('completar-numero-carga').value,
      cliente: document.getElementById('completar-cliente').value,
      destino: document.getElementById('completar-destino').value,
      peso: document.getElementById('completar-peso').value,
      sequencia: document.getElementById('completar-sequencia').value,
      transportadora: document.getElementById('completar-transportadora').value,
      tipoVeiculo: document.getElementById('completar-tipoveiculo').value,
      motorista: document.getElementById('completar-motorista').value,
      observacoes: document.getElementById('completar-obs').value,
      praOnde: document.getElementById('completar-praonde').value,
      rota: document.getElementById('completar-rota').value,
      paletizada: document.getElementById('completar-paletizada').value,
      qtdGanchos: document.getElementById('completar-ganchos').value,
      qtdEntregas: document.getElementById('completar-entregas').value,
      freteDestino: destinoFreteNormalizado(document.getElementById('completar-frete-destino').value),
      kmDeslocamento: document.getElementById('completar-km-deslocamento').value,
      operador: nomeOperadorAtual()
    });
    fecharModalCompletar();
    // Sem beep aqui de propósito: o status NÃO muda nesta ação (a carga já
    // nasceu em "Aguardando Embarque" quando a Portaria registrou a
    // chegada) — o som é só pra mudanças de status, não pra edição de dados.
    notifyGravacao('Dados completados com sucesso.');
    renderAll();
  }catch(e){ notify(e.message, 'danger'); }
}

