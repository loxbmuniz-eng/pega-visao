/* =====================================================================
   ROTAS POR DIA DA SEMANA — o template que vivia no Teams (24/08/2026)
   =====================================================================

   Faltou na primeira entrega e o efeito foi um botão mudo: "Puxar rotas
   do modelo" não tinha de onde puxar, porque não havia tela para
   cadastrar o modelo. A lição, anotada: rota de servidor sem tela é a
   mesma família do defeito da ocorrência #13 — a regra existe e o
   caminho para cumpri-la, não.

   Mudança aqui vale para as PRÓXIMAS semanas. O dia já montado é uma
   cópia, não um espelho: reprogramar o passado por tabelar o futuro seria
   reescrever história que a operação já viveu.
   ===================================================================== */

let _modeloDiaAtivo = null;   // 1=seg … 5=sex
let _modeloCache = [];

async function carregarModeloSemanaUI(){
  const card = document.getElementById('card-modelo-semana');
  if(!card) return;
  const setor = DB.operador && DB.operador.setor;
  const podeVer = setor === 'Logística' || setor === 'Administração';
  card.hidden = !podeVer;
  if(!podeVer || !SuincoSharePoint.estaConfigurado()) return;

  if(_modeloDiaAtivo === null){
    /* Abre no dia de HOJE quando é dia útil — é o que a pessoa quer ver
       na maioria das vezes. Fim de semana cai em segunda. */
    const h = new Date().getDay();
    _modeloDiaAtivo = (h >= 1 && h <= 5) ? h : 1;
  }
  try {
    const r = await SuincoSharePoint.modeloSemana.listar();
    /* O MODELO É O CATÁLOGO DE DESTINOS. Os apelidos que o dono digitou
       linha a linha são a única lista de cidades por rota que existe — e é
       de onde `destinosDaRota()` tira a maior parte do que oferece. */
    registrarDestinosDoModelo((r && r.modelo) || []);
    _modeloCache = r.modelo || [];
    renderModeloSemana();
  } catch(e){
    if(e && e.status === 404){ card.hidden = true; return; }
    notify('Não consegui carregar as rotas por dia: ' + (e.message || e), 'erro', 7000);
  }
}

function trocarDiaModeloUI(dia){
  _modeloDiaAtivo = Number(dia);
  renderModeloSemana();
}

function renderModeloSemana(){
  const seg = document.getElementById('modelo-seg');
  if(seg){
    seg.innerHTML = [1, 2, 3, 4, 5].map(d => {
      const n = _modeloCache.filter(m => Number(m.dia_semana) === d).length;
      return `<button class="seg-btn${d === _modeloDiaAtivo ? ' seg-ativo' : ''}"
                onclick="trocarDiaModeloUI(${d})">${NOMES_DIA[d]}
                ${n ? `<span class="pill-count">${n}</span>` : ''}</button>`;
    }).join('');
  }

  /* A lista sai do cadastro oficial — nunca de texto livre. É o que
     impede "Belo Horinzonte" de virar rota nova, que foi exatamente o
     que a planilha acumulou em cinco dias.

     Usa ROTAS e rotaLabel, os mesmos de prog-rota: mantendo uma fonte só,
     rota cadastrada em Cadastros aparece aqui na hora. E reconstrói
     sempre, preservando a escolha — pela mesma razão. */
  const sel = document.getElementById('modelo-rota');
  if(sel){
    const atual = sel.value;
    sel.innerHTML = rotasParaEscolher().map(r =>
      `<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
    if(atual) sel.value = atual;
  }

  const doDia = _modeloCache
    .filter(m => Number(m.dia_semana) === _modeloDiaAtivo)
    .sort((a, b) => (a.ordem - b.ordem) || String(a.rota_codigo).localeCompare(b.rota_codigo));

  const vazio = document.getElementById('modelo-empty');
  if(vazio) vazio.hidden = doDia.length > 0;
  const tbody = document.getElementById('modelo-tbody');
  if(!tbody) return;
  tbody.innerHTML = doDia.map((m, i) => `<tr>
      <td class="text-dim">${i + 1}</td>
      <td>${destinoMontagemHtml(m)}</td>
      <td>${esc(m.tipo_operacao) || '<span class="text-dim">—</span>'}</td>
      <td>${m.qtd_entregas ?? '<span class="text-dim">—</span>'}</td>
      <td class="no-print">
        <button class="btn btn-sec btn-sm" onclick="removerDoModeloUI(${Number(m.modelo_id)})">Remover</button>
      </td></tr>`).join('');
}

async function adicionarAoModeloUI(){
  const rota = (document.getElementById('modelo-rota') || {}).value;
  if(!rota){ notify('Escolha a rota.', 'erro', 4000); return; }
  const jaTem = _modeloCache.filter(m =>
    Number(m.dia_semana) === _modeloDiaAtivo && m.rota_codigo === rota).length;
  try {
    await SuincoSharePoint.modeloSemana.gravar({
      diaSemana: _modeloDiaAtivo,
      rotaCodigo: rota,
      /* A ordem é o que permite a MESMA rota duas vezes no mesmo dia —
         duas saídas para a mesma praça acontecem, e o índice único é por
         (dia, rota, ordem). */
      ordem: jaTem,
      tipoOperacao: (document.getElementById('modelo-tipo') || {}).value || '',
      qtdEntregas: (document.getElementById('modelo-entregas') || {}).value || '',
    });
    await carregarModeloSemanaUI();
    notify('Rota adicionada ao modelo de ' + NOMES_DIA[_modeloDiaAtivo] + '.', 'ok', 4000);
  } catch(e){ notify(e.message || String(e), 'erro', 8000); }
}

async function removerDoModeloUI(id){
  if(!confirm('Tirar esta rota do modelo deste dia?')) return;
  try {
    await SuincoSharePoint.modeloSemana.remover(id);
    await carregarModeloSemanaUI();
  } catch(e){ notify('Não consegui remover: ' + (e.message || e), 'erro', 7000); }
}

/* ─────────────────────────────────────────────────────────────────────
   EXPLICAÇÃO SOB DEMANDA NO CELULAR — o interruptor
   ---------------------------------------------------------------------
   O CSS esconde `.card-sub` abaixo de 820px; aqui o título passa a abrir
   e fechar. Três decisões que valem explicação:

   1. DELEGAÇÃO, não listener por cartão. São 66 cartões e vários são
      redesenhados a cada sincronização — listener preso ao elemento morre
      no primeiro render. O clique é ouvido no documento e resolvido por
      `closest`, então funciona em cartão que ainda nem existe.

   2. A escolha é GUARDADA POR CARTÃO. Quem opera Devoluções todo dia não
      quer reabrir a mesma explicação amanhã; quem está aprendendo deixa
      aberta. A chave é o texto do título, que é estável entre versões —
      o índice do cartão não é (basta inserir um cartão no meio).

   3. NÃO É SEGREDO: no computador nada muda, e no celular o "?" ao lado
      do título anuncia que há explicação ali. Esconder sem avisar seria
      pior que o problema original.
   ───────────────────────────────────────────────────────────────────── */
const EXPLIC_CHAVE = 'suinco_explicacoes_abertas';

function _explicAbertas(){
  try { return new Set(JSON.parse(localStorage.getItem(EXPLIC_CHAVE) || '[]')); }
  catch { return new Set(); }
}
function _explicGravar(conjunto){
  try { localStorage.setItem(EXPLIC_CHAVE, JSON.stringify([...conjunto])); }
  catch { /* modo privado: a sessão funciona, só não lembra amanhã */ }
}
function _explicId(card){
  const t = card.querySelector(':scope > .card-title');
  return t ? t.textContent.trim().slice(0, 60) : '';
}

/* Reaplica o que a pessoa escolheu. Chamado depois de cada render, porque
   cartão redesenhado volta com a classe limpa. */
function restaurarExplicacoes(){
  if (window.innerWidth > 820) return;
  const abertas = _explicAbertas();
  document.querySelectorAll('.card').forEach(card => {
    if (!card.querySelector(':scope > .card-sub')) return;
    card.classList.toggle('exp-aberta', abertas.has(_explicId(card)));
  });
}

document.addEventListener('click', (ev) => {
  if (window.innerWidth > 820) return;
  const titulo = ev.target.closest('.card-title');
  if (!titulo) return;
  // Em Indicadores quem manda é a seção recolhida (ver styles.css,
  // "CONFLITO DE AFORDÂNCIA"): lá o mesmo toque abre a seção inteira, e a
  // explicação vem junto. Sem esta guarda, os dois tratadores disparavam
  // no mesmo clique e um desfazia o outro.
  if (titulo.closest('#tab-indicadores')) return;
  const card = titulo.parentElement;
  if (!card || !card.classList.contains('card')) return;
  if (!card.querySelector(':scope > .card-sub')) return;
  // Não sequestra clique em botão/link que viva dentro do título.
  if (ev.target.closest('button, a, input, select, label')) return;

  const aberta = card.classList.toggle('exp-aberta');
  const abertas = _explicAbertas();
  const id = _explicId(card);
  if (aberta) abertas.add(id); else abertas.delete(id);
  _explicGravar(abertas);
});

/* Teclado: o título virou controle, então precisa ser alcançável e
   acionável por quem não usa toque. */
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const t = document.activeElement;
  if (!t || !t.classList || !t.classList.contains('card-title')) return;
  if (window.innerWidth > 820) return;
  ev.preventDefault(); t.click();
});

function _prepararTitulosExplicaveis(){
  if (window.innerWidth > 820) return;
  document.querySelectorAll('.card > .card-sub').forEach(sub => {
    const t = sub.parentElement.querySelector(':scope > .card-title');
    if (t && !t.hasAttribute('tabindex')){
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
      t.setAttribute('aria-label', t.textContent.trim() + ' — toque para ver a explicação');
    }
  });
}

/* ─────────────────────────────────────────────────────────────────────
   INDICADORES NO CELULAR — abrir e fechar cada seção
   ---------------------------------------------------------------------
   Mesma mecânica da explicação sob demanda (delegação + escolha guardada
   por título), com uma diferença que importa: aqui o PRIMEIRO cartão abre
   sozinho na primeira visita. Uma aba de indicadores que abre inteiramente
   fechada parece quebrada; abrindo o primeiro, a pessoa vê um número e
   entende que os outros títulos são portas.

   Só a primeira visita decide isso. Depois vale o que a pessoa escolheu —
   inclusive fechar tudo, se for o que ela quer.
   ───────────────────────────────────────────────────────────────────── */
/* ABAS COM SEÇÃO RECOLHIDA NO CELULAR.
   Indicadores entrou em 27/08; Cadastros no mesmo dia, pela mesma medida:
   8.822px de rolagem, 10,5 telas. Uma mecânica, duas abas — a lista aqui é
   o único lugar que decide quais. */
const SECOES_ABAS = ['indicadores', 'cadastros'];
const SECOES_SELETOR = SECOES_ABAS
  .map(a => `#tab-${a} > .card > .card-title, #tab-${a} > .grid2 > .card > .card-title`)
  .join(', ');
function _secoesChave(aba){ return `suinco_secoes_${aba}`; }
/* A chave antiga fica: quem já escolheu em Indicadores não perde a escolha. */
const SECOES_CHAVE_LEGADO = { indicadores: 'suinco_indicadores_secoes' };

function _secoesEstado(aba){
  try {
    const cru = localStorage.getItem(_secoesChave(aba))
             || (SECOES_CHAVE_LEGADO[aba] ? localStorage.getItem(SECOES_CHAVE_LEGADO[aba]) : null);
    return cru ? JSON.parse(cru) : null;   // null = nunca escolheu nada
  } catch { return null; }
}
function _secoesGravar(aba, lista){
  try { localStorage.setItem(_secoesChave(aba), JSON.stringify(lista)); } catch {}
}
/* Os cartões de uma aba, na ordem da tela. Em Cadastros parte deles mora
   dentro de .grid2 — por isso não dá para usar só filho direto. */
function _secoesCards(abaEl){
  return [...abaEl.querySelectorAll(':scope > .card, :scope > .grid2 > .card')];
}
function _secaoId(card){
  const t = card.querySelector(':scope > .card-title');
  return t ? t.textContent.trim().slice(0, 60) : '';
}

function restaurarSecoesIndicadores(){
  SECOES_ABAS.forEach(restaurarSecoesDaAba);
}
function restaurarSecoesDaAba(nomeAba){
  const aba = document.getElementById(`tab-${nomeAba}`);
  if (!aba || window.innerWidth > 820) return;
  const cards = _secoesCards(aba);
  if (!cards.length) return;
  const guardado = _secoesEstado(nomeAba);
  const abertas = new Set(guardado || []);
  const primeiraVisita = guardado === null;
  cards.forEach((card, i) => {
    const t = card.querySelector(':scope > .card-title');
    if (!t) return;
    if (!t.hasAttribute('tabindex')){
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
    }
    const aberta = primeiraVisita ? (i === 0) : abertas.has(_secaoId(card));
    card.classList.toggle('sec-aberta', aberta);
    t.setAttribute('aria-expanded', aberta ? 'true' : 'false');
  });
}

document.addEventListener('click', (ev) => {
  if (window.innerWidth > 820) return;
  const titulo = ev.target.closest(SECOES_SELETOR);
  if (!titulo) return;
  if (ev.target.closest('button, a, input, select, label')) return;

  const card = titulo.parentElement;
  const aberta = card.classList.toggle('sec-aberta');
  titulo.setAttribute('aria-expanded', aberta ? 'true' : 'false');

  const aba = card.closest('[id^="tab-"]');
  if (!aba) return;
  const nomeAba = aba.id.replace('tab-', '');
  _secoesGravar(nomeAba, _secoesCards(aba)
    .filter(c => c.classList.contains('sec-aberta'))
    .map(_secaoId));
  /* A FROTA PRECISA DO FOCO NA BUSCA (27/08/2026). Ela abre sem lista — a
     busca é a porta. Abrir e deixar o dedo procurando o campo seria trocar
     uma rolagem por um garimpo. */
  if (aberta && nomeAba === 'cadastros'){
    const busca = card.querySelector('#frota-busca');
    if (busca) setTimeout(() => { try { busca.focus({preventScroll:true}); } catch(e){} }, 60);
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const t = document.activeElement;
  if (!t || !t.matches || !t.matches('#tab-indicadores > .card > .card-title')) return;
  if (window.innerWidth > 820) return;
  ev.preventDefault(); t.click();
});

/* ═══════════════════ MOVIMENTO (agente de interação) ═══════════════════

   Tudo que se MEXE no painel mora aqui, num lugar só, e a folha de estilo
   correspondente é o bloco de mesmo nome no fim de `styles.css`.

   Três regras que valem para o bloco inteiro, e que não são gosto:

   1. TETO DE 300 ms. A Torre despacha ~31 cargas por dia; uma saída de
      700 ms multiplicada por 31 é meio minuto de gente olhando o painel
      terminar de se mexer. Animação de interface acima de 300 ms não
      informa, atrasa.
   2. O QUE SE VÊ CEM VEZES POR DIA NÃO SE ANIMA. Troca de aba, a sincronia
      redesenhando a Torre, o pátio recarregando: nada disso entra aqui. Se
      cada sincronia animasse a tabela, a tela tremeria sozinha. Por isso a
      entrada de linha só dispara para um `data-carga` que NÃO existia no
      desenho anterior daquela tabela — redesenhar as mesmas 30 linhas não
      é novidade nenhuma.
   3. O PAPEL NÃO SE MEXE, E NÃO PODE NASCER INVISÍVEL. O servidor gera os
      PDFs com ESTE mesmo CSS (`backend/src/servicos/pdf.js` manda
      `{html, css}` para o Chromium). Toda regra daqui é desligada em
      `@media print`, e nenhum estado de REPOUSO é invisível: quem espera
      animação espera já visível, e a animação só tira e devolve. A
      ocorrência #72 é o lembrete do preço de errar isso — uma regra de
      papel escrita no nível errado fez o relatório sair com página em
      branco.

   Também respeita `prefers-reduced-motion: reduce`: o CSS desliga o
   movimento e o JavaScript encurta as esperas para zero, para que nenhuma
   ação fique presa atrás de uma animação que não vai acontecer. */

function movReduzida(){
  try{
    return !!(window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }catch(e){ return false; }
}

function movEsperar(ms){
  return new Promise(r => setTimeout(r, movReduzida() ? 0 : ms));
}

