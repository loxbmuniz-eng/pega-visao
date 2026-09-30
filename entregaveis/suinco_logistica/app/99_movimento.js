/* ---------- 1. "SEGUIU VIAGEM": O CAMINHÃO SAI DO PÁTIO ----------

   A linha não pode sumir seca. Some seca e a pessoa fica sem saber se
   clicou no caminhão certo — e quando são duas cargas na mesma placa, sem
   saber qual das duas saiu.

   Duas metades dentro do teto de 300 ms:

     0–150 ms   o conteúdo da linha ANDA para a direita e apaga
                (só `transform` e `opacity`: roda na GPU, não repagina)
     150–240 ms a linha fecha o próprio espaço e as de baixo sobem

   240 ms e não 280: o teto de 300 ms é do que a PESSOA vê, não do que o
   CSS declara. Entre o clique e a linha sumir ainda cabem os atrasos do
   relógio do navegador e o redesenho da tabela — medido, ~60 ms. Gastar
   os 300 inteiros em animação estoura o teto no relógio de quem olha.

   A segunda metade mexe em altura, que é a única propriedade que fecha
   espaço de verdade numa tabela — `transform` não devolve espaço nenhum ao
   layout. A regra de "só transform e opacity" existe para não repaginar
   uma LISTA inteira a cada quadro; aqui é UMA linha, por 110 ms, ~31 vezes
   por dia. A conta fecha, e está escrita para quem vier depois não desfazer
   achando que foi descuido.

   A altura é medida antes e escrita em pixel porque `height:auto` não
   transiciona — de `auto` para `0` o navegador pula direto, sem animar. */
const MOV_SAIDA_ANDA = 150;
const MOV_SAIDA_FECHA = 90;

function _movSeletorCarga(id){
  return `tr[data-carga="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`;
}

function _movLinhasDaCarga(id){
  if(!id) return [];
  try{ return Array.from(document.querySelectorAll(_movSeletorCarga(id))); }
  catch(e){ return []; }
}

/* Anima a saída das cargas que acabaram de seguir viagem e SÓ ENTÃO deixa
   a tela ser redesenhada. Devolve uma promessa: quem chama espera por ela
   antes do `renderAll()`, senão o redesenho apaga a linha no primeiro
   quadro e não sobra nada para ver.

   Não é fonte de verdade de nada: se a linha não estiver na tela (outra
   aba, filtro escondendo), resolve na hora e o painel segue igual. */
async function despedirCargas(ids){
  const linhas = (Array.isArray(ids) ? ids : [ids])
    .reduce((acc, id) => acc.concat(_movLinhasDaCarga(id)), []);
  if(!linhas.length || movReduzida()) return;

  linhas.forEach((tr) => {
    tr.style.height = tr.offsetHeight + 'px';   // congela a altura de hoje
    tr.classList.add('linha-seguiu-viagem');
  });
  await movEsperar(MOV_SAIDA_ANDA);
  linhas.forEach((tr) => {
    tr.classList.add('linha-seguiu-viagem-fecha');
    tr.style.height = '0px';
  });
  await movEsperar(MOV_SAIDA_FECHA);
  /* Não removo a linha: quem redesenha é o `renderAll()` de quem chamou, e
     é ele quem manda. Tirar daqui seria a tela decidindo sozinha o que só
     o servidor confirma. */
}

/* ---------- 2. LINHA NOVA ENTRA DESLIZANDO DE CIMA ----------

   `translateY(-10px)` + opacidade, 260 ms. NUNCA `scale(0)`: nada no mundo
   real aparece do nada, e uma carga que surge de um ponto invisível parece
   defeito de tela, não carga nova.

   O QUE IMPEDE ISSO DE VIRAR TREMEDEIRA: a primeira pintura de cada tabela
   só ANOTA os ids; não anima nada. Abrir a aba com 30 cargas não faz 30
   linhas deslizarem. Depois disso, anima só o `data-carga` que apareceu
   agora — a sincronia redesenha as mesmas linhas e não dispara nada,
   porque redesenhar não é novidade. */
const _movVistas = new Map();       // id do tbody -> Set de data-carga já visto

function movLinhasNovas(tbody){
  if(!tbody || !tbody.id) return;
  const agora = new Set(
    Array.from(tbody.querySelectorAll('tr[data-carga]'))
      .map(tr => tr.getAttribute('data-carga')));
  const antes = _movVistas.get(tbody.id);
  _movVistas.set(tbody.id, agora);
  if(!antes || !antes.size || movReduzida()) return;   // primeira pintura: só anota
  agora.forEach((id) => {
    if(antes.has(id)) return;
    const tr = tbody.querySelector(_movSeletorCarga(id));
    if(tr) tr.classList.add('linha-nova');
  });
}

/* ---------- 3. SEGURAR PARA CANCELAR ----------

   "Tem certeza?" é a pergunta que todo mundo aprende a responder sem ler.
   Segurar não dá para responder no automático: o dedo fica lá 1,5 s e a
   barra conta na frente dele. Solta antes, volta em 200 ms e NADA acontece
   — que é a regra da casa pelo lado certo: a ação perigosa PERGUNTA, em vez
   de um botão desabilitado que só nega.

   COMO ISSO NÃO TRANCA NINGUÉM FORA (e é a parte que importa num painel em
   produção): quem chega por TECLADO ou por chamada de programa continua
   passando direto pelo caminho de sempre. Clique de dedo/mouse tem
   `detail >= 1`; Enter numa tecla e `elemento.click()` têm `detail 0` — a
   mesma distinção que o guarda do toque duplo já usa neste arquivo. Então
   o gesto novo vale para a mão, e o teclado nunca fica sem saída.

   Toque curto não fica mudo: explica o que fazer. Botão que só nega é o
   defeito da ocorrência #13. */
const MOV_SEGURAR_MS = 1500;
let _movSegurando = null;           // { botao, relogio } enquanto o dedo está lá
let _movGestoAte = 0;               // até quando o gesto recém-completado vale

/* O GESTO É A CONFIRMAÇÃO — e é só isso que ele substitui.

   Quem segurou 1,5 s já respondeu "tem certeza?" com o dedo; repetir a
   pergunta numa janela do navegador seria cobrar duas vezes a mesma coisa,
   e é assim que se ensina alguém a clicar em OK sem ler.

   Quem chegou por teclado NÃO segurou nada, e para esse a janela continua
   existindo. Uma pergunta, nunca zero: a confirmação não some, muda de
   forma conforme a porta por onde a pessoa entrou.

   O que NÃO é confirmação continua acontecendo nos dois caminhos: o motivo
   do cancelamento é registro (alguém vai perguntar por ele daqui a três
   meses) e a placa digitada da carga que já seguiu viagem é prova. */
function movConfirmadoPorGesto(){
  return Date.now() < _movGestoAte;
}

function _movLimparSegurar(){
  if(!_movSegurando) return;
  clearTimeout(_movSegurando.relogio);
  _movSegurando.botao.classList.remove('segurando');
  _movSegurando = null;
}

function _movBotaoDeSegurar(alvo){
  return alvo && alvo.closest ? alvo.closest('[data-segurar]') : null;
}

document.addEventListener('pointerdown', (ev) => {
  const botao = _movBotaoDeSegurar(ev.target);
  if(!botao || botao.disabled) return;
  _movLimparSegurar();
  if(movReduzida()) return;   // sem barra para contar, o clique resolve
  botao.classList.add('segurando');
  const relogio = setTimeout(() => {
    _movLimparSegurar();
    botao.classList.add('segurado');
    setTimeout(() => botao.classList.remove('segurado'), 300);
    /* `click()` de programa tem `detail 0` e passa pelo porteiro abaixo —
       é o mesmo caminho do teclado, então a ação executada aqui é
       exatamente a do `onclick` da marcação, sem cópia paralela da regra. */
    _movGestoAte = Date.now() + 2000;
    try{ botao.click(); }catch(e){}
  }, MOV_SEGURAR_MS);
  _movSegurando = { botao, relogio };
}, true);

['pointerup', 'pointercancel', 'pointerleave'].forEach((evento) => {
  document.addEventListener(evento, (ev) => {
    if(!_movSegurando) return;
    if(_movBotaoDeSegurar(ev.target) !== _movSegurando.botao) return;
    _movLimparSegurar();
  }, true);
});

/* O porteiro: clique de dedo em botão de segurar não age sozinho. */
document.addEventListener('click', (ev) => {
  const botao = _movBotaoDeSegurar(ev.target);
  if(!botao) return;
  if(!ev.detail) return;              // teclado e chamada de programa passam
  if(movReduzida()) return;           // sem movimento, sem gesto novo
  ev.preventDefault();
  ev.stopImmediatePropagation();
  notify(botao.getAttribute('data-segurar-dica')
    || 'Segure o botão por 1,5 segundo para confirmar.', 'warn', 4000);
}, true);

/* ---------- 4. BOTÃO QUE CONTA O QUE ESTÁ FAZENDO ----------

   Salvar → Salvando… → ✓ Salvo. O texto troca EMBAÇADO (`blur(2.6px)`)
   para os dois estados não parecerem dois objetos: sem o borrão o olho vê
   duas palavras se sobrepondo; com ele, vê uma virando a outra.

   200 ms de ponta a ponta — 100 ms para embaçar, a troca no pico, 100 ms
   para voltar. Não 200 para cada metade: o teto de interface é 300.

   Quem chama passa a TAREFA, não o resultado. O botão só conta o que
   realmente aconteceu: se a promessa falhar, ele volta ao texto original
   sem nunca dizer "salvo". Esta é a regra da casa — a tela adianta, quem
   decide é a transação. */
const MOV_BORRAO_MS = 100;

function _movBotaoDaAcao(nomeDaFuncao){
  try{ return document.querySelector(`button[onclick*="${nomeDaFuncao}("]`); }
  catch(e){ return null; }
}

/* Quem pediu a troca mais recente é quem manda. Um salvamento que responde
   em 50 ms pede "Salvando…" e "✓ Salvo" quase juntos; sem esta senha, as
   duas trocas se atropelam e o botão pode acabar parado no texto errado —
   que é pior do que não animar. */
const _movSenhaDoTexto = new WeakMap();

async function _movTrocarTexto(botao, texto){
  if(!botao) return;
  if(movReduzida()){ botao.textContent = texto; return; }
  const senha = (_movSenhaDoTexto.get(botao) || 0) + 1;
  _movSenhaDoTexto.set(botao, senha);
  botao.classList.add('mov-conta');   // declara a transição do borrão
  botao.classList.add('mov-borrado');
  await movEsperar(MOV_BORRAO_MS);
  if(_movSenhaDoTexto.get(botao) !== senha) return;   // já pediram outra
  botao.textContent = texto;
  botao.classList.remove('mov-borrado');
  await movEsperar(MOV_BORRAO_MS);
}

/* `tarefa` é uma função que devolve promessa. O botão fica `aria-busy`
   enquanto ela corre — leitor de tela precisa saber que o painel está
   ocupado tanto quanto o olho precisa ver "Salvando…". */
/* O BOTÃO CONTA AO LADO DO TRABALHO, NUNCA NA FRENTE DELE.

   Nenhuma troca de texto é esperada por quem chamou: a promessa que esta
   função devolve resolve no instante em que a TAREFA resolve, e as trocas
   acontecem por fora. Sem isso, os 400 ms de contação entrariam no caminho
   da gravação e atrasariam o `renderAll()` que vem depois — o cadastro
   inteiro ficaria quatro décimos mais lento por causa de um enfeite.

   O teste `test_cadastrar_rota` foi quem mostrou isso, reprovando em "a
   rota nova aparece na tabela": a rota estava certa, a tabela é que ainda
   não tinha sido redesenhada. Vermelho de regressão de verdade, e a
   correção é de projeto — animação não entra no caminho crítico. */
async function contarNoBotao(botao, textos, tarefa){
  if(!botao) return tarefa();
  const original = botao.textContent;
  botao.setAttribute('aria-busy', 'true');
  _movTrocarTexto(botao, (textos && textos.fazendo) || 'Salvando…');
  try{
    const resultado = await tarefa();
    _movTrocarTexto(botao, (textos && textos.feito) || '✓ Salvo');
    setTimeout(() => {
      botao.removeAttribute('aria-busy');
      _movTrocarTexto(botao, original);
    }, 900);
    return resultado;
  }catch(e){
    botao.removeAttribute('aria-busy');
    _movTrocarTexto(botao, original);
    throw e;
  }
}

/* ---------- 5. A TORRE DESLIZA (27/09/2026) ----------

   Pedido do dono, depois de tocar na "Torre de brinquedo": a linha que muda
   de lugar desliza até a posição nova. Com uma condição dele, que é a que
   manda: "as partes principais precisam manter sua estrutura (...) torre de
   controle editável seguindo o formato de colunas e campos editáveis".

   Por isso nada disto mexe no HTML da linha. A Torre continua sendo a mesma
   tabela de 12 colunas, redesenhada inteira a cada sincronia; o movimento é
   só uma camada por cima (FLIP): mede onde cada linha estava, deixa a
   tabela nascer na ordem nova, e faz cada linha que mudou de lugar partir
   de onde estava. `transform` e nada mais — não repagina, não toca campo.

   QUATRO REGRAS, cada uma com um porquê:

   1. SÓ SE MOVE QUANDO A ORDEM MUDOU. Sincronia que redesenha as mesmas
      linhas na mesma ordem não anima nada (regra 2 do bloco: o que se vê
      cem vezes por dia não se anima). Linha que entra ou sai não conta
      como mudança de ordem: a entrada já tem animação própria (seção 2) e
      a saída também (seção 1).
   2. A LINHA EM EDIÇÃO NÃO FOGE. Com o cursor num campo da Torre, uma
      mudança de ordem vinda de OUTRO setor espera: a tabela fica como a
      pessoa está vendo e se reorganiza quando ela sai da tabela. Mudança
      feita pela própria pessoa naquele campo (ela digitou a posição) vale
      na hora — foi ela quem pediu. Tudo isso sem prazo nem relógio: quem
      decide é onde o cursor está.
   3. MUDOU DE ETAPA, O SELO PULSA. Etapa não muda a ordem da Torre; o que
      muda é o selo de status, e é ele que se mexe — só o daquela carga.
   4. Movimento reduzido no sistema: a ordem muda, nada anima. */
const MOV_DESLIZA_MS = 260;
const _movOrdem = new Map();     // tbody.id → ids na ordem em que foram desenhados
const _movEtapa = new Map();     // tbody.id → Map(id → status)

function _movChaveDoCampo(el){
  const tr = el && el.closest ? el.closest('tr[data-carga]') : null;
  const td = el && el.closest ? el.closest('td') : null;
  if(!tr || !td) return null;
  return tr.dataset.carga + '|' + [...tr.children].indexOf(td);
}

function _movCampoEmEdicao(tbody){
  const f = document.activeElement;
  return !!(f && tbody && tbody.contains(f)
    && (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA' || f.tagName === 'SELECT'));
}

/* Regra 2. Devolve a lista na ordem que a pessoa está vendo, se for o caso
   de segurar; senão, a lista como veio. */
function movSegurarOrdemEmEdicao(tbody, lista){
  if(!tbody || !tbody.id) return lista;
  if(!tbody._movOuvindo){
    tbody._movOuvindo = true;
    /* A mudança feita no próprio campo libera AQUELE campo: a linha vai
       para onde a pessoa mandou. Andar para outro campo arma de novo. */
    tbody.addEventListener('change', (ev) => {
      tbody._movLivre = _movChaveDoCampo(ev.target);
    }, true);
    tbody.addEventListener('focusin', (ev) => {
      if(_movChaveDoCampo(ev.target) !== tbody._movLivre) tbody._movLivre = null;
    });
    tbody.addEventListener('focusout', () => setTimeout(() => {
      if(!tbody._movSegurou || _movCampoEmEdicao(tbody)) return;
      tbody._movSegurou = false;
      renderAll();
    }, 0));
  }
  const vista = _movOrdem.get(tbody.id);
  const emEdicao = _movCampoEmEdicao(tbody)
    && _movChaveDoCampo(document.activeElement) !== tbody._movLivre;
  if(!vista || !emEdicao) return lista;
  const pos = new Map(vista.map((id, i) => [id, i]));
  const segurada = lista.slice().sort((a, b) =>
    (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
  if(segurada.some((c, i) => c !== lista[i])) tbody._movSegurou = true;
  return segurada;
}

/* Antes de redesenhar: onde cada linha está, medido a partir do topo do
   próprio corpo da tabela — as caixas de cima mudam de altura com os
   números, e medir pela página faria todas as linhas "andarem" juntas. */
function movFlipAntes(tbody){
  if(!tbody || movReduzida() || !tbody.getClientRects().length) return null;
  const topo = tbody.getBoundingClientRect().top;
  const pos = new Map();
  tbody.querySelectorAll('tr[data-carga]').forEach(tr => {
    pos.set(tr.dataset.carga, tr.getBoundingClientRect().top - topo);
  });
  return pos.size ? pos : null;
}

function movFlipDepois(tbody, antes, lista){
  if(!tbody || !tbody.id) return;
  const ordemAntes = _movOrdem.get(tbody.id);
  const etapaAntes = _movEtapa.get(tbody.id);
  const ordem = lista.map(c => c.id);
  _movOrdem.set(tbody.id, ordem);
  _movEtapa.set(tbody.id, new Map(lista.map(c => [c.id, c.status])));
  if(!ordemAntes || movReduzida()) return;

  // Regra 3: o selo de quem mudou de etapa.
  if(etapaAntes){
    lista.forEach(c => {
      if(!etapaAntes.has(c.id) || etapaAntes.get(c.id) === c.status) return;
      const selo = tbody.querySelector(_movSeletorCarga(c.id) + ' .badge');
      if(selo && selo.animate){
        selo.animate([{ transform: 'scale(.86)', opacity: .35 },
                      { transform: 'none', opacity: 1 }],
                     { duration: MOV_DESLIZA_MS, easing: 'cubic-bezier(.23,1,.32,1)' });
      }
    });
  }

  // Regra 1: a ordem relativa de quem estava e continua mudou?
  if(!antes) return;
  const ficaram = new Set(ordem);
  const a = ordemAntes.filter(id => ficaram.has(id) && antes.has(id));
  const tinha = new Set(a);
  const b = ordem.filter(id => tinha.has(id));
  if(a.every((id, i) => id === b[i])) return;

  const topo = tbody.getBoundingClientRect().top;
  const medidas = [];
  tbody.querySelectorAll('tr[data-carga]').forEach(tr => {
    const id = tr.dataset.carga;
    if(!antes.has(id)) return;
    const dy = antes.get(id) - (tr.getBoundingClientRect().top - topo);
    if(Math.abs(dy) >= 1) medidas.push([tr, dy]);
  });
  medidas.forEach(([tr, dy]) => {
    if(!tr.animate) return;
    tr.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
               { duration: MOV_DESLIZA_MS, easing: 'cubic-bezier(.23,1,.32,1)' });
  });
}
