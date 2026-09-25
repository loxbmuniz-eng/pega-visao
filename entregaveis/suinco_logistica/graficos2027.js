/* =====================================================================
   MOTOR DE GRÁFICO — SVG, sem biblioteca, sem CDN
   =====================================================================

   POR QUE SVG E NÃO CANVAS. Os três gráficos antigos eram canvas: pixel
   pintado, sem alvo de toque. Para saber qual barra o dedo encostou era
   preciso recalcular a geometria à mão, e por isso nenhum deles tinha
   valor ao tocar — a operação via o desenho e não via o número. Em SVG
   cada marca é um elemento: o toque acerta sozinho, o texto escala com o
   zoom do aparelho, e o leitor de tela tem o que ler.

   POR QUE A COR NÃO IDENTIFICA ETAPA. As seis etapas do pátio são uma
   SEQUÊNCIA, não seis categorias. Medido com o validador de paleta em
   24/09/2026: qualquer tentativa de dar uma cor a cada etapa reprova, e
   sempre no mesmo lugar — etapas vizinhas ficam perto demais para o olho
   separar, inclusive para quem enxerga cor normalmente. Então a etapa é
   lida por POSIÇÃO e RÓTULO, e a cor carrega só a ordem, numa rampa única
   do dourado da marca.

   E VERMELHO É RESERVADO. Ele não é "a cor da primeira etapa": é alerta.
   Quando tudo é colorido, nada chama atenção — e o caminhão parado há
   cinco horas some no meio do arco-íris.
   ===================================================================== */
const Graf = (function(){
  const NS = 'http://www.w3.org/2000/svg';

  /* Quem desliga animação no sistema operacional não está pedindo menos
     bonito: costuma ser enjoo ou vertigem. Aqui isso desliga de verdade,
     não "quase". */
  function semMovimento(){
    try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch(e){ return false; }
  }

  function el(tag, attrs, pai){
    const n = document.createElementNS(NS, tag);
    for(const k in (attrs||{})) n.setAttribute(k, attrs[k]);
    if(pai) pai.appendChild(n);
    return n;
  }
  function cor(nome, alt){
    const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return v || alt || '#888';
  }
  /* A RAMPA DA FILA — uma cor só, do claro ao escuro, na ordem das etapas.
     Sequencial, como manda a régua: magnitude/ordem é uma rampa; categoria
     é que são hues diferentes. */
  /* CADA PASSO CARREGA O TEXTO QUE LÊ NELE (25/09/2026, medido).
     A primeira rampa reprovou no teste de contraste, e a medição mostrou
     por quê: o quinto passo (#9a762f) ficava num meio-termo onde NENHUM
     texto passava — 4,43 com escuro, 3,81 com claro, e o mínimo é 4,5.
     Rampa não é só bonita de olhar: cada degrau precisa de um texto que
     se leia nele. Os quatro primeiros usam tinta escura, os dois últimos
     tinta clara, e os seis foram conferidos um a um. */
  const RAMPA = [
    { fundo:'#f7dc9b', tinta:'#1a1200' },   // 13,86
    { fundo:'#edc468', tinta:'#1a1200' },   // 11,23
    { fundo:'#dcab45', tinta:'#1a1200' },   //  8,81
    { fundo:'#c3963c', tinta:'#1a1200' },   //  6,85
    { fundo:'#6d5220', tinta:'#f7f3ea' },   //  6,59
    { fundo:'#4a3714', tinta:'#f7f3ea' },   // 10,26
  ];

  /* Uma dica só para a tela inteira. Criar uma por gráfico multiplicaria
     elemento à toa e deixaria duas abertas ao mesmo tempo no celular. */
  let dica = null;
  function aDica(){
    if(dica && document.body.contains(dica)) return dica;
    dica = document.createElement('div');
    dica.className = 'graf-dica no-print';
    dica.setAttribute('role','status');
    dica.hidden = true;
    document.body.appendChild(dica);
    return dica;
  }
  function mostrarDica(html, x, y){
    const d = aDica();
    d.innerHTML = html;
    d.hidden = false;
    const r = d.getBoundingClientRect();
    /* Encostar na borda é o modo de falha do celular: a dica sai da tela
       justamente no primeiro e no último ponto, que são os que mais
       interessam. Por isso ela é presa dentro da janela. */
    const esq = Math.min(Math.max(8, x - r.width/2), innerWidth - r.width - 8);
    const topo = (y - r.height - 12 < 8) ? y + 16 : y - r.height - 12;
    d.style.left = Math.round(esq) + 'px';
    d.style.top = Math.round(topo) + 'px';
  }
  function esconderDica(){ if(dica) dica.hidden = true; }

  function limpar(alvo){
    while(alvo.firstChild) alvo.removeChild(alvo.firstChild);
    return alvo;
  }
  function vazio(alvo, msg){
    limpar(alvo);
    const p = document.createElement('p');
    p.className = 'graf-vazio';
    /* DIZER POR QUE ESTÁ VAZIO. "Sem dados" faz a pessoa achar que
       quebrou; dizer que o filtro não encontrou nada devolve a ela o que
       fazer em seguida. */
    p.textContent = msg || 'Nada para mostrar com este filtro.';
    alvo.appendChild(p);
  }

  /* ---------------------------------------------------------------
     ÁREA + LINHA — o dia por hora, com a meta como referência
     --------------------------------------------------------------- */
  function area(alvo, { pontos, meta, formato, rotulo }){
    if(!pontos || pontos.length < 2) return vazio(alvo, 'Ainda não há movimento suficiente no período.');
    limpar(alvo);
    const L = 38, R = 12, T = 14, B = 26;
    const W = Math.max(280, alvo.clientWidth || 320), H = alvo.clientHeight || 190;
    const svg = el('svg', { viewBox:`0 0 ${W} ${H}`, width:'100%', height:H,
                            role:'img', 'aria-label': rotulo || 'gráfico' }, alvo);
    const vals = pontos.map(p=>p.valor);
    const max = Math.max(meta || 0, ...vals) * 1.15 || 1;
    const x = i => L + i * (W-L-R) / (pontos.length-1);
    const y = v => T + (H-T-B) * (1 - v/max);

    // Grade recessiva: ela orienta, não compete.
    [0, .5, 1].forEach(f=>{
      const yy = T + (H-T-B)*f;
      el('line', { x1:L, x2:W-R, y1:yy, y2:yy, stroke:cor('--border-soft','#2a3a6c'),
                   'stroke-width':1 }, svg);
      const t = el('text', { x:L-6, y:yy+4, 'text-anchor':'end',
                             fill:cor('--text-dim','#b7c0d4'), 'font-size':10 }, svg);
      /* SÓ O NÚMERO NO EIXO. A primeira versão usava o mesmo `formato` da
         dica, que traz a unidade junto ("3 cargas") — e o texto ficou
         largo demais para a margem, empurrando o número para fora do
         desenho: sobrava "cargas" sem número nenhum. A unidade é do
         TÍTULO da seção; o eixo é só a escala. */
      t.textContent = Math.round(max*(1-f));
    });

    if(meta){
      el('line', { x1:L, x2:W-R, y1:y(meta), y2:y(meta), stroke:cor('--gold','#e9b954'),
                   'stroke-width':1.5, 'stroke-dasharray':'4 4', opacity:.8 }, svg);
      const m = el('text', { x:W-R, y:y(meta)-5, 'text-anchor':'end',
                             fill:cor('--gold-text','#e9b954'), 'font-size':10 }, svg);
      m.textContent = 'meta';
    }

    const d = pontos.map((p,i)=>`${i?'L':'M'}${x(i)},${y(p.valor)}`).join(' ');
    const grad = el('linearGradient', { id:'graf-area-g', x1:0,y1:0,x2:0,y2:1 }, svg);
    el('stop', { offset:'0%', 'stop-color':cor('--gold','#e9b954'), 'stop-opacity':.28 }, grad);
    el('stop', { offset:'100%','stop-color':cor('--gold','#e9b954'), 'stop-opacity':0 }, grad);
    el('path', { d:`${d} L${x(pontos.length-1)},${H-B} L${L},${H-B} Z`,
                 fill:'url(#graf-area-g)' }, svg);
    const linha = el('path', { d, fill:'none', stroke:cor('--gold','#e9b954'),
                               'stroke-width':2, 'stroke-linejoin':'round',
                               'stroke-linecap':'round' }, svg);

    /* A LINHA SE DESENHA — 420ms, e só na entrada. Movimento aqui tem
       função: ele conta a direção da leitura, da esquerda para a direita,
       que é a ordem do tempo. */
    if(!semMovimento()){
      const comp = linha.getTotalLength ? linha.getTotalLength() : 0;
      if(comp){
        linha.style.strokeDasharray = comp;
        linha.style.strokeDashoffset = comp;
        linha.style.transition = 'stroke-dashoffset 420ms cubic-bezier(.23,1,.32,1)';
        requestAnimationFrame(()=>{ linha.style.strokeDashoffset = '0'; });
      }
    }

    // Cruz de leitura: uma faixa invisível por ponto, bem maior que a marca.
    const cruz = el('line', { y1:T, y2:H-B, stroke:cor('--gold','#e9b954'),
                              'stroke-width':1, opacity:0 }, svg);
    const bola = el('circle', { r:4.5, fill:cor('--gold','#e9b954'),
                                stroke:cor('--card','#1e2a52'), 'stroke-width':2, opacity:0 }, svg);
    pontos.forEach((p,i)=>{
      const faixa = el('rect', { x:x(i)-(W-L-R)/pontos.length/2, y:T,
                                 width:(W-L-R)/pontos.length, height:H-T-B,
                                 fill:'transparent', 'pointer-events':'all' }, svg);
      const entrar = (ev)=>{
        cruz.setAttribute('x1', x(i)); cruz.setAttribute('x2', x(i));
        cruz.setAttribute('opacity', .5);
        bola.setAttribute('cx', x(i)); bola.setAttribute('cy', y(p.valor));
        bola.setAttribute('opacity', 1);
        const r = faixa.getBoundingClientRect();
        mostrarDica(`<b>${p.rotulo}</b><span>${formato ? formato(p.valor) : p.valor}</span>`,
                    r.left + r.width/2, r.top);
      };
      faixa.addEventListener('mouseenter', entrar);
      faixa.addEventListener('touchstart', entrar, { passive:true });
      faixa.addEventListener('focus', entrar);
      faixa.setAttribute('tabindex','0');
    });
    svg.addEventListener('mouseleave', ()=>{
      cruz.setAttribute('opacity',0); bola.setAttribute('opacity',0); esconderDica();
    });
  }

  /* ---------------------------------------------------------------
     RANKING — barra horizontal, valor na ponta
     --------------------------------------------------------------- */
  function ranking(alvo, { itens, formato, rotulo, alerta }){
    if(!itens || !itens.length) return vazio(alvo, 'Nenhuma linha com este filtro.');
    limpar(alvo);
    const lista = itens.slice(0, 8);
    const max = Math.max(1, ...lista.map(i=>i.valor));
    const cx = document.createElement('div');
    cx.className = 'graf-rank';
    cx.setAttribute('role','list');
    if(rotulo) cx.setAttribute('aria-label', rotulo);
    lista.forEach((it, i)=>{
      const li = document.createElement('div');
      li.className = 'graf-rank-item';
      li.setAttribute('role','listitem');
      /* ALERTA É ÍCONE E PALAVRA, NUNCA SÓ COR — quem não distingue
         vermelho precisa da mesma informação. */
      const grave = alerta && alerta(it);
      li.innerHTML =
        `<span class="graf-rank-nome">${grave ? '<b aria-hidden="true">▲</b> ' : ''}${it.rotulo}</span>`
        + `<span class="graf-rank-trilho"><i style="--w:${(it.valor/max*100).toFixed(1)}%"`
        + ` class="${grave ? 'grave' : ''}"></i></span>`
        + `<span class="graf-rank-valor">${formato ? formato(it.valor) : it.valor}`
        + `${grave ? '<em class="graf-rank-tag">acima da meta</em>' : ''}</span>`;
      if(!semMovimento()) li.style.setProperty('--atraso', (i*40) + 'ms');
      cx.appendChild(li);
    });
    alvo.appendChild(cx);
    if(!semMovimento()) requestAnimationFrame(()=>cx.classList.add('entrou'));
    else cx.classList.add('entrou');
  }

  /* ---------------------------------------------------------------
     FILA DO PÁTIO — as 6 etapas numa faixa só
     --------------------------------------------------------------- */
  function fila(alvo, { etapas, formato }){
    const total = (etapas||[]).reduce((s,e)=>s+e.valor, 0);
    if(!total) return vazio(alvo, 'Nenhuma carga em aberto agora.');
    limpar(alvo);
    const cx = document.createElement('div');
    cx.className = 'graf-fila';
    etapas.forEach((e,i)=>{
      const pedaco = document.createElement('div');
      pedaco.className = 'graf-fila-parte';
      pedaco.style.setProperty('--w', (e.valor/total*100).toFixed(2) + '%');
      const passo = RAMPA[i % RAMPA.length];
      pedaco.style.setProperty('--c', passo.fundo);
      pedaco.style.setProperty('--t', passo.tinta);
      pedaco.style.setProperty('--atraso', (i*45) + 'ms');
      /* O RÓTULO FICA NA MARCA. Legenda separada obriga o olho a ir e
         voltar, e no celular ela é a primeira coisa que quebra a linha. */
      pedaco.innerHTML = `<b>${e.valor}</b><span>${e.rotulo}</span>`;
      pedaco.setAttribute('title', `${e.rotulo}: ${e.valor}`);
      pedaco.setAttribute('tabindex','0');
      cx.appendChild(pedaco);
    });
    alvo.appendChild(cx);
    requestAnimationFrame(()=>cx.classList.add('entrou'));
  }

  return { area, ranking, fila, RAMPA, semMovimento, esconderDica };
})();
