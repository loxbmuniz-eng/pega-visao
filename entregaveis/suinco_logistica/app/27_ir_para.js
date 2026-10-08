/* =====================================================================
   "IR PARA" — O ÍNDICE DAS ABAS COMPRIDAS (08/10/2026, /impeccable Lote 4)
   ---------------------------------------------------------------------
   Medido na auditoria (1440 px): a Programação tem 6 seções e a Montagem do
   dia — onde a Logística monta o dia — começava a 1.268 px do topo; o
   Cadastros tem 17.534 px, as 300 linhas da Frota vêm antes de tudo, e
   "Cadastrar Rota" ficava a 14.822 px, sem âncora nem aba interna.

   Uma função só para as duas abas (regra da casa). A barra lista SÓ as
   seções que a pessoa vê — a Tabela de Frete, por exemplo, é da
   Administração —, na ordem da tela. No celular, o Cadastros recolhe as
   seções (app/95_modelo_da_semana.js): ir para uma fechada a abre antes,
   pelo mesmo clique no título, que guarda a escolha.

   O salto é imediato, sem rolagem animada: 15 mil pixels animados é
   espera, não informação. O foco vai para o título da seção — quem usa o
   teclado continua dali.
   ===================================================================== */
const IR_PARA = {
  programacao: [
    ['card-fila-programados', 'Fila'],
    ['card-nova-carga', 'Nova carga'],
    ['card-montagem', 'Montagem do dia'],
    ['card-modelo-semana', 'Rotas da semana'],
    ['card-aguardando-carga', 'Aguardando carga'],
    ['card-programacao-dia', 'Como o dia foi feito'],
  ],
  cadastros: [
    ['card-frota', 'Frota'],
    ['card-transportadoras', 'Transportadoras'],
    ['card-cadastrar-rota', 'Rotas'],
    ['card-tabela-frete', 'Tabela de Frete'],
    ['card-cad-devolucoes', 'Devoluções'],
  ],
};

function _irParaVisivel(el){ return !!el && !el.hidden && !el.closest('[hidden]'); }

function montarIrParaUI(aba){
  const nav = document.querySelector(`.ir-para[data-ir-para="${aba}"]`);
  const lista = IR_PARA[aba];
  if(!nav || !lista) return;
  const itens = lista.filter(([id]) => _irParaVisivel(document.getElementById(id)));
  // Com uma seção só, índice não ajuda: some.
  nav.hidden = itens.length < 2;
  // A aba se redesenha a cada sincronia (15 s). Refazer a barra sem
  // necessidade tiraria o foco de quem está nela pelo teclado.
  const assinatura = itens.map(([id]) => id).join(',');
  if(nav.dataset.assinatura === assinatura) return;
  nav.dataset.assinatura = assinatura;
  nav.innerHTML = '<span class="ir-para-rot">Ir para</span>' + itens.map(([id, rotulo]) =>
    `<button type="button" class="btn btn-sec btn-sm ir-para-item" data-alvo="${id}" onclick="irParaSecaoUI('${id}')">${esc(rotulo)}</button>`
  ).join('');
}

function irParaSecaoUI(id){
  const card = document.getElementById(id);
  if(!card) return;
  const titulo = card.querySelector(':scope > .card-title');
  // No celular, a seção do Cadastros pode estar recolhida: abre pelo mesmo
  // caminho do toque no título (que guarda a escolha da pessoa).
  if(window.innerWidth <= 820 && titulo && card.closest('#tab-cadastros') && !card.classList.contains('sec-aberta')){
    titulo.click();
  }
  card.scrollIntoView({ block: 'start' });
  const alvo = titulo || card;
  if(!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '-1');
  try{ alvo.focus({ preventScroll: true }); }catch(_){}
}

/* AS DUAS DATAS DA PROGRAMAÇÃO (08/10/2026, /impeccable Lote 4).
   A Fila de Programados e a Montagem do dia têm cada uma a sua data — de
   propósito: dá para montar amanhã olhando a fila de hoje. O defeito era
   não dizer: a pessoa mudava a data da Fila e a Montagem continuava na
   outra, sem aviso. Agora, quando diferem, a Montagem diz as duas, e um
   botão põe a Fila no dia da Montagem. (O Controle da programação, no fim
   da aba, é um terceiro assunto — o registro de um dia — e segue à parte.) */
function avisoDatasProgramacaoUI(){
  const el = document.getElementById('mont-aviso-datas');
  const mont = document.getElementById('mont-data');
  if(!el || !mont) return;
  const dm = mont.value;
  const df = (typeof diaFilaSelecionado === 'function') ? diaFilaSelecionado() : '';
  if(!dm || !df || dm === df){ el.hidden = true; el.innerHTML = ''; return; }
  el.innerHTML = `A Montagem está em <strong>${esc(rotuloDoDia(dm))}</strong>, e a Fila de Programados, `
    + `lá em cima, em <strong>${esc(rotuloDoDia(df))}</strong>. `
    + `<button type="button" class="btn btn-sec btn-sm" id="mont-alinhar-fila" onclick="mudarDiaFilaUI('${dm}')">Pôr a Fila no mesmo dia</button>`;
  el.hidden = false;
}
