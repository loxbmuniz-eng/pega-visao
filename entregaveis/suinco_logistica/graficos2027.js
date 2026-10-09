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


  /* =================================================================
     ATUALIZAR NO LUGAR, NÃO RECRIAR (26/09/2026)
     =================================================================
     Pedido do dono: os Indicadores com a qualidade da tela de
     demonstração "Pátio ao vivo".

     A diferença entre as duas NÃO era o desenho. A aba é redesenhada a
     cada sincronia do painel, e as três funções abaixo apagavam tudo e
     criavam de novo: a linha voltava a se desenhar, as barras nasciam do
     zero e cresciam, a fila se reabria — a cada poucos segundos, sem
     nada ter mudado. Movimento que se repete sem motivo deixa de dizer
     alguma coisa; vira tremedeira.

     Agora cada gráfico guarda o que desenhou (no próprio elemento-alvo)
     e, na próxima chamada, muda SÓ o que mudou. A entrada animada
     acontece uma vez, quando o gráfico nasce. Dali em diante, o que se
     mexe é o que mudou de valor — e aí o movimento é informação. */

  const SAIDA = 'cubic-bezier(.23,1,.32,1)';

  /* O ODÔMETRO. Só os dígitos que mudaram rolam, da unidade para a
     dezena, como um contador mecânico. Texto igual não se mexe. */
  function rolar(el, texto){
    texto = String(texto);
    const antigo = el._rolado;
    if(antigo === texto) return;
    el._rolado = texto;
    if(antigo === undefined || semMovimento() || antigo === '—' || texto === '—'){
      el.textContent = texto; return;
    }
    const num = s => parseInt(String(s).replace(/\D/g,'') || '0', 10);
    const sobe = num(texto) >= num(antigo);
    const velhos = [...antigo], novos = [...texto], off = velhos.length - novos.length;
    el.textContent = '';
    novos.forEach((ch, i)=>{
      const s = document.createElement('span');
      s.className = 'graf-dig'; s.textContent = ch; el.appendChild(s);
      if(velhos[i + off] !== ch){
        s.animate([
          { transform:`translateY(${sobe ? '60%' : '-60%'})`, opacity:0, filter:'blur(1.5px)' },
          { transform:'none', opacity:1, filter:'blur(0)' }
        ], { duration:260, easing:SAIDA, delay:(novos.length-1-i)*22, fill:'backwards' });
      }
    });
  }

  /* ---------------------------------------------------------------
     ÁREA + LINHA — o dia por hora
     --------------------------------------------------------------- */
  function area(alvo, { pontos, meta, formato, rotulo }){
    if(!pontos || pontos.length < 2){ alvo._area = null; return vazio(alvo, 'Ainda não há movimento suficiente no período.'); }
    const L = 38, R = 14, T = 14, B = 26;
    const W = Math.max(280, alvo.clientWidth || 320), H = alvo.clientHeight || 190;
    let st = alvo._area;
    /* TAMANHO NOVO NÃO RECRIA (27/09/2026). A primeira versão recriava o
       gráfico quando a largura mudava — e a largura muda por um pixel à
       toa: uma barra de rolagem que aparece, a letra que termina de
       carregar. A guarda pegou. Agora o tamanho é só mais um valor que o
       gráfico ajusta no lugar. */
    const nasce = !st || !alvo.contains(st.svg);
    if(nasce){
      limpar(alvo);
      st = alvo._area = {};
      const svg = st.svg = el('svg', { class:'graf-area' }, alvo);
      const gid = 'graf-area-g-' + Math.random().toString(36).slice(2, 8);
      const grad = el('linearGradient', { id:gid, x1:0,y1:0,x2:0,y2:1 }, svg);
      el('stop', { offset:'0%', 'stop-color':cor('--gold','#e9b954'), 'stop-opacity':.28 }, grad);
      el('stop', { offset:'100%','stop-color':cor('--gold','#e9b954'), 'stop-opacity':0 }, grad);
      st.grade = [0, .5, 1].map(()=>({
        linha: el('line', { stroke:cor('--border-soft','#2a3a6c'), 'stroke-width':1 }, svg),
        /* SÓ O NÚMERO NO EIXO — a unidade é do título da seção. */
        texto: el('text', { 'text-anchor':'end', fill:cor('--text-dim','#b7c0d4'), 'font-size':12 }, svg),
      }));
      st.eixoX = el('g', {}, svg);
      st.metaL = el('line', { stroke:cor('--gold','#e9b954'), 'stroke-width':1.5, 'stroke-dasharray':'4 4', opacity:0 }, svg);
      st.areaP = el('path', { fill:`url(#${gid})` }, svg);
      st.linha = el('path', { fill:'none', stroke:cor('--gold','#e9b954'), 'stroke-width':2,
                              'stroke-linejoin':'round', 'stroke-linecap':'round' }, svg);
      /* A PONTA VIVA: o último valor é o que a pessoa procura primeiro. */
      st.ponta = el('circle', { r:4.5, fill:cor('--gold','#e9b954'), stroke:cor('--card','#1e2a52'), 'stroke-width':2 }, svg);
      st.cruz = el('line', { stroke:cor('--text-dim','#b7c0d4'), 'stroke-width':1, 'stroke-dasharray':'3 3', opacity:0 }, svg);
      st.bola = el('circle', { r:5, fill:cor('--card','#1e2a52'), stroke:cor('--gold','#e9b954'), 'stroke-width':2, opacity:0 }, svg);
      /* UMA ÁREA DE TOQUE SÓ, O GRÁFICO INTEIRO. Antes era uma faixa por
         ponto, cada uma parada no Tab do teclado — doze paradas para ler
         um gráfico. E o toque no celular mostrava a dica e nunca a tirava. */
      const toque = st.toque = el('rect', { fill:'transparent',
                                            'pointer-events':'all', tabindex:'0', class:'graf-toque' }, svg);
      const perto = (clientX)=>{
        const r = svg.getBoundingClientRect();
        const xx = (clientX - r.left) * (st.W / r.width);
        let melhor = 0, dist = Infinity;
        st.pontos.forEach((p,i)=>{ const d = Math.abs(st.x(i) - xx); if(d < dist){ dist = d; melhor = i; } });
        return melhor;
      };
      const mostrar = (i)=>{
        st.i = i;
        const p = st.pontos[i];
        st.cruz.setAttribute('x1', st.x(i)); st.cruz.setAttribute('x2', st.x(i)); st.cruz.setAttribute('opacity', 1);
        st.bola.setAttribute('cx', st.x(i)); st.bola.setAttribute('cy', st.y(p.valor)); st.bola.setAttribute('opacity', 1);
        const r = svg.getBoundingClientRect(), esc = r.width / st.W;
        mostrarDica(`<b>${p.rotulo}</b><span>${st.formato ? st.formato(p.valor) : p.valor}</span>`,
                    r.left + st.x(i)*esc, r.top + st.y(p.valor)*esc);
      };
      const sumir = ()=>{ st.i = null; st.cruz.setAttribute('opacity',0); st.bola.setAttribute('opacity',0); esconderDica(); };
      let timer = 0;
      toque.addEventListener('pointermove', ev=>{ clearTimeout(timer); mostrar(perto(ev.clientX)); });
      toque.addEventListener('pointerdown', ev=>{ clearTimeout(timer); mostrar(perto(ev.clientX)); });
      /* No dedo, a dica fica o bastante para ler e some sozinha. */
      toque.addEventListener('pointerup', ev=>{ if(ev.pointerType !== 'mouse'){ clearTimeout(timer); timer = setTimeout(sumir, 1600); } });
      toque.addEventListener('pointerleave', ev=>{ if(ev.pointerType === 'mouse') sumir(); });
      toque.addEventListener('blur', sumir);
      toque.addEventListener('focus', ()=>mostrar(st.pontos.length - 1));
      toque.addEventListener('keydown', ev=>{
        if(ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        const i = st.i == null ? st.pontos.length - 1 : st.i + (ev.key === 'ArrowRight' ? 1 : -1);
        mostrar(Math.max(0, Math.min(st.pontos.length - 1, i)));
      });
    }
    st.pontos = pontos; st.formato = formato;
    if(st.W !== W || st.H !== H){
      st.W = W; st.H = H;
      st.svg.setAttribute('viewBox', `0 0 ${W} ${H}`); st.svg.setAttribute('width', '100%'); st.svg.setAttribute('height', H);
      st.grade.forEach((g, k)=>{
        const yy = T + (H-T-B)*[0,.5,1][k];
        g.linha.setAttribute('x1', L); g.linha.setAttribute('x2', W-R); g.linha.setAttribute('y1', yy); g.linha.setAttribute('y2', yy);
        g.texto.setAttribute('x', L-6); g.texto.setAttribute('y', yy+4);
      });
      st.metaL.setAttribute('x1', L); st.metaL.setAttribute('x2', W-R);
      st.cruz.setAttribute('y1', T); st.cruz.setAttribute('y2', H-B);
      st.toque.setAttribute('x', L); st.toque.setAttribute('y', T);
      st.toque.setAttribute('width', W-L-R); st.toque.setAttribute('height', H-T-B);
    }
    st.svg.setAttribute('role','img');
    st.svg.setAttribute('aria-label', (rotulo || 'gráfico') + '. Última leitura: ' + pontos[pontos.length-1].rotulo
      + ', ' + (formato ? formato(pontos[pontos.length-1].valor) : pontos[pontos.length-1].valor) + '.');
    const vals = pontos.map(p=>p.valor);
    const max = Math.max(meta || 0, ...vals) * 1.15 || 1;
    st.x = i => L + i * (W-L-R) / (pontos.length-1);
    st.y = v => T + (H-T-B) * (1 - v/max);
    st.grade.forEach((g, k)=>{ g.texto.textContent = Math.round(max*(1 - [0,.5,1][k])); });
    while(st.eixoX.firstChild) st.eixoX.removeChild(st.eixoX.firstChild);
    const passo = Math.max(1, Math.ceil(pontos.length / Math.max(2, Math.floor((W-L-R) / 54))));
    pontos.forEach((p,i)=>{
      if(i % passo && i !== pontos.length - 1) return;
      const t = el('text', { x:st.x(i), y:H-7, 'text-anchor':'middle', fill:cor('--text-dim','#b7c0d4'), 'font-size':12 }, st.eixoX);
      t.textContent = p.rotulo;
    });
    if(meta){ st.metaL.setAttribute('y1', st.y(meta)); st.metaL.setAttribute('y2', st.y(meta)); st.metaL.setAttribute('opacity', .8); }
    else st.metaL.setAttribute('opacity', 0);
    const d = pontos.map((p,i)=>`${i?'L':'M'}${st.x(i).toFixed(1)},${st.y(p.valor).toFixed(1)}`).join(' ');
    st.linha.setAttribute('d', d);
    st.areaP.setAttribute('d', `${d} L${st.x(pontos.length-1)},${H-B} L${L},${H-B} Z`);
    const ult = pontos[pontos.length-1];
    st.ponta.setAttribute('cx', st.x(pontos.length-1)); st.ponta.setAttribute('cy', st.y(ult.valor));
    if(st.i != null && st.i < pontos.length){
      const p = pontos[st.i];
      st.bola.setAttribute('cx', st.x(st.i)); st.bola.setAttribute('cy', st.y(p.valor));
    }
    /* A LINHA SE DESENHA UMA VEZ, NA ENTRADA — conta a direção da leitura,
       da esquerda para a direita, que é a ordem do tempo. */
    if(nasce && !semMovimento()){
      const comp = st.linha.getTotalLength ? st.linha.getTotalLength() : 0;
      if(comp){
        st.linha.animate([{ strokeDasharray:comp, strokeDashoffset:comp }, { strokeDasharray:comp, strokeDashoffset:0 }],
                         { duration:520, easing:SAIDA });
        st.ponta.animate([{ opacity:0, transform:'scale(.6)' }, { opacity:1, transform:'none' }],
                         { duration:260, delay:420, easing:SAIDA, fill:'backwards' });
      }
    }
  }

  /* ---------------------------------------------------------------
     RANKING — barra horizontal, valor na ponta
     Linhas guardadas pelo rótulo: quando a ordem muda, a linha DESLIZA
     até o lugar novo (FLIP), em vez de a lista inteira piscar.
     --------------------------------------------------------------- */
  /* `semItens`: o que dizer quando não há linha. O padrão fala do filtro
     (Indicadores); onde não há filtro à vista, quem chama diz o motivo. */
  function ranking(alvo, { itens, formato, rotulo, alerta, aoTocar, semItens }){
    if(!itens || !itens.length){ alvo._rank = null; return vazio(alvo, semItens || 'Nenhuma linha com este filtro.'); }
    let st = alvo._rank;
    const nasce = !st || !alvo.contains(st.cx);
    if(nasce){
      limpar(alvo);
      const cx = document.createElement('div');
      cx.className = 'graf-rank';
      cx.setAttribute('role','list');
      alvo.appendChild(cx);
      st = alvo._rank = { cx, linhas:new Map() };
    }
    if(rotulo) st.cx.setAttribute('aria-label', rotulo);
    const lista = itens.slice(0, 8);
    const max = Math.max(1, ...lista.map(i=>i.valor));
    const antes = new Map();
    if(!nasce) st.linhas.forEach((li, k)=>antes.set(k, li.getBoundingClientRect().top));
    const vivos = new Set();
    lista.forEach((it, i)=>{
      let li = st.linhas.get(it.rotulo);
      const nova = !li;
      if(nova){
        li = document.createElement(aoTocar ? 'button' : 'div');
        if(aoTocar){ li.type = 'button'; }
        li.className = 'graf-rank-item' + (aoTocar ? ' graf-rank-tocavel' : '');
        li.setAttribute('role','listitem');
        li.innerHTML = `<span class="graf-rank-nome"></span><span class="graf-rank-trilho"><i></i></span>`
          + `<span class="graf-rank-valor"><span class="graf-rank-num"></span></span>`;
        if(aoTocar) li.addEventListener('click', ()=>aoTocar(li._item, li));
        st.linhas.set(it.rotulo, li);
      }
      li._item = it;
      vivos.add(it.rotulo);
      /* ALERTA É ÍCONE E PALAVRA, NUNCA SÓ COR. */
      const grave = !!(alerta && alerta(it));
      li.classList.toggle('grave', grave);
      /* O NOME É TEXTO, NUNCA HTML (09/10/2026, #127): ele vem do cadastro
         (rota, transportadora) e entrava por innerHTML — um "<" no nome
         virava marcação na tela de todo mundo. E o nome cortado com
         reticências não se lia em lugar nenhum: o title traz ele inteiro. */
      const nomeEl = li.querySelector('.graf-rank-nome');
      nomeEl.textContent = '';
      if(grave){
        const b = document.createElement('b'); b.setAttribute('aria-hidden', 'true'); b.textContent = '▲';
        nomeEl.append(b, ' ');
      }
      nomeEl.append(String(it.rotulo));
      nomeEl.title = String(it.rotulo);
      const valorTxt = formato ? formato(it.valor) : String(it.valor);
      rolar(li.querySelector('.graf-rank-num'), valorTxt);
      let tag = li.querySelector('.graf-rank-tag');
      if(grave && !tag){ tag = document.createElement('em'); tag.className = 'graf-rank-tag'; tag.textContent = 'acima da meta'; li.querySelector('.graf-rank-valor').appendChild(tag); }
      if(!grave && tag) tag.remove();
      li.setAttribute('aria-label', `${it.rotulo}: ${valorTxt}${grave ? ', acima da meta' : ''}`);
      const barra = li.querySelector('.graf-rank-trilho i');
      const w = (it.valor/max*100).toFixed(1) + '%';
      if(nova && !semMovimento()){
        /* A barra nasce do zero e cresce até o valor: só na entrada. */
        barra.style.setProperty('--w', '0%');
        requestAnimationFrame(()=>requestAnimationFrame(()=>barra.style.setProperty('--w', w)));
        if(!nasce) li.animate([{ opacity:0, transform:'translateY(-6px)' }, { opacity:1, transform:'none' }], { duration:260, easing:SAIDA });
        else li.style.setProperty('--atraso', (i*40) + 'ms');
      } else barra.style.setProperty('--w', w);
      if(st.cx.children[i] !== li) st.cx.insertBefore(li, st.cx.children[i] || null);
    });
    st.linhas.forEach((li, k)=>{ if(!vivos.has(k)){ li.remove(); st.linhas.delete(k); } });
    if(!nasce && !semMovimento()) st.linhas.forEach((li, k)=>{
      const t0 = antes.get(k); if(t0 === undefined) return;
      const dy = t0 - li.getBoundingClientRect().top;
      if(Math.abs(dy) > .5) li.animate([{ transform:`translateY(${dy}px)` }, { transform:'none' }], { duration:380, easing:SAIDA });
    });
  }

  /* ---------------------------------------------------------------
     FILA DO PÁTIO — as 6 etapas numa faixa só
     Mesmas etapas de antes: as partes só mudam de largura e de número.
     --------------------------------------------------------------- */
  function fila(alvo, { etapas }){
    const total = (etapas||[]).reduce((s,e)=>s+e.valor, 0);
    if(!total){ alvo._fila = null; return vazio(alvo, 'Nenhuma carga em aberto agora.'); }
    const chave = etapas.map(e=>e.rotulo).join('|');
    let st = alvo._fila;
    const nasce = !st || st.chave !== chave || !alvo.contains(st.cx);
    if(nasce){
      limpar(alvo);
      const cx = document.createElement('div');
      cx.className = 'graf-fila';
      etapas.forEach((e,i)=>{
        const pedaco = document.createElement('div');
        pedaco.className = 'graf-fila-parte';
        const passo = RAMPA[i % RAMPA.length];
        pedaco.style.setProperty('--c', passo.fundo);
        pedaco.style.setProperty('--t', passo.tinta);
        pedaco.style.setProperty('--atraso', (i*45) + 'ms');
        /* O RÓTULO FICA NA MARCA. */
        pedaco.innerHTML = `<b></b><span>${e.rotulo}</span>`;
        pedaco.setAttribute('tabindex','0');
        cx.appendChild(pedaco);
      });
      alvo.appendChild(cx);
      st = alvo._fila = { cx, chave };
      requestAnimationFrame(()=>cx.classList.add('entrou'));
    }
    [...st.cx.children].forEach((pedaco, i)=>{
      const e = etapas[i];
      pedaco.style.setProperty('--w', (e.valor/total*100).toFixed(2) + '%');
      rolar(pedaco.querySelector('b'), String(e.valor));
      pedaco.setAttribute('title', `${e.rotulo}: ${e.valor}`);
      pedaco.setAttribute('aria-label', `${e.rotulo}: ${e.valor}`);
    });
  }

  /* =================================================================
     A GAVETA DE DETALHE — lateral no computador, de baixo no celular
     =================================================================
     A mesma física da tela de demonstração: uma mola de verdade
     (amortecimento + resposta), que o dedo pode agarrar no meio do
     movimento e jogar com velocidade. Sai pelo mesmo caminho por onde
     entrou. Com movimento reduzido, vira um esmaecer curto. */
  function Mola(aplicar){
    let x = 0, v = 0, alvoM = 0, k = 0, c = 0, raf = 0, fim = null, ultimo = 0;
    function passoM(t){
      const dt = Math.min(0.064, (t - ultimo) / 1000); ultimo = t;
      const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      for(let i = 0; i < n; i++){ const a = -k*(x - alvoM) - c*v; v += a*h; x += v*h; }
      if(Math.abs(x - alvoM) < 0.4 && Math.abs(v) < 8){
        x = alvoM; v = 0; aplicar(x); raf = 0; const f = fim; fim = null; if(f) f(); return;
      }
      aplicar(x); raf = requestAnimationFrame(passoM);
    }
    const parar = ()=>{ if(raf) cancelAnimationFrame(raf); raf = 0; fim = null; };
    return {
      get x(){ return x; }, parar,
      fixar(val){ parar(); x = val; v = 0; aplicar(x); },
      ir(novo, o = {}){
        const zeta = o.zeta ?? 1, resp = o.resp ?? 0.34, w = 2*Math.PI/resp;
        alvoM = novo; k = w*w; c = 2*zeta*w;
        if(o.vel !== undefined) v = o.vel;
        fim = o.aoFim || null;
        if(!raf){ ultimo = performance.now(); raf = requestAnimationFrame(passoM); }
      }
    };
  }
  const projetar = (v, d = 0.998) => (v/1000) * d / (1 - d);
  const elastico = (exc, dim, kk = 0.55) => (exc*dim*kk) / (dim + kk*exc);

  const G = { el:null, veu:null, eixo:'y', tam:0, pos:0, aberta:false, fechando:false, origem:null, mola:null, chave:null };
  function montarGaveta(){
    if(G.el && document.body.contains(G.el)) return;
    G.veu = document.createElement('div');
    G.veu.className = 'gv-veu no-print'; G.veu.hidden = true;
    G.el = document.createElement('aside');
    G.el.className = 'gv no-print'; G.el.hidden = true;
    G.el.setAttribute('role','dialog'); G.el.setAttribute('aria-labelledby','gv-titulo');
    G.el.innerHTML = '<div class="gv-alca" aria-hidden="true"><span></span></div>'
      + '<header class="gv-cab"><div class="gv-cab-txt"><p class="gv-olho" id="gv-olho"></p>'
      + '<h2 class="gv-titulo" id="gv-titulo"></h2><p class="gv-sub" id="gv-sub"></p></div>'
      + '<button type="button" class="gv-fechar" aria-label="Fechar o detalhe">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button></header>'
      + '<div class="gv-miolo" id="gv-miolo"></div>';
    document.body.appendChild(G.veu); document.body.appendChild(G.el);
    G.mola = Mola(pos=>{
      G.pos = pos;
      G.el.style.transform = G.eixo === 'y' ? `translate3d(0,${pos}px,0)` : `translate3d(${pos}px,0,0)`;
      if(G.eixo === 'y') G.veu.style.opacity = String(Math.max(0, Math.min(1, 1 - pos/G.tam)));
    });
    G.el.querySelector('.gv-fechar').addEventListener('click', ()=>fecharGaveta());
    G.veu.addEventListener('click', ()=>fecharGaveta());
    document.addEventListener('keydown', ev=>{ if(ev.key === 'Escape' && G.aberta) fecharGaveta(); });
    const arrastar = (e)=>{
      if(!G.aberta || (e.button !== undefined && e.button !== 0) || e.target.closest('button')) return;
      const alvoA = e.currentTarget;
      alvoA.setPointerCapture(e.pointerId);
      G.mola.parar(); G.fechando = false;   // agarrou no meio: vale a posição VISÍVEL
      const ehY = G.eixo === 'y', p0 = ehY ? e.clientY : e.clientX, pos0 = G.pos;
      const amostras = [{ t:e.timeStamp, p:p0 }];
      let moveu = false;
      const mover = ev=>{
        const p = ehY ? ev.clientY : ev.clientX;
        if(!moveu && Math.abs(p - p0) < 4) return;
        moveu = true;
        let pos = pos0 + (p - p0);
        if(pos < 0) pos = -elastico(-pos, G.tam);
        G.mola.fixar(pos);
        amostras.push({ t:ev.timeStamp, p }); if(amostras.length > 8) amostras.shift();
      };
      const soltar = ev=>{
        alvoA.removeEventListener('pointermove', mover);
        alvoA.removeEventListener('pointerup', soltar);
        alvoA.removeEventListener('pointercancel', soltar);
        if(!moveu){ if(G.pos !== 0) G.mola.ir(0, { zeta:1, resp:.3 }); return; }
        const rec = amostras.filter(a=>ev.timeStamp - a.t < 100);
        let v = 0;
        if(rec.length >= 2){ const a = rec[0], b = rec[rec.length-1]; if(b.t > a.t) v = (b.p - a.p)/(b.t - a.t)*1000; }
        /* decide pela velocidade e pela projeção, não por onde o dedo parou */
        if(v > 550 || (v > -550 && G.pos + projetar(v) > G.tam*.42)) fecharGaveta({ vel:v });
        else if(semMovimento()) G.mola.fixar(0);
        else G.mola.ir(0, { zeta: Math.abs(v) > 300 ? .8 : 1, resp:.3, vel:v });
      };
      alvoA.addEventListener('pointermove', mover);
      alvoA.addEventListener('pointerup', soltar);
      alvoA.addEventListener('pointercancel', soltar);
    };
    G.el.querySelector('.gv-cab').addEventListener('pointerdown', arrastar);
    G.el.querySelector('.gv-alca').addEventListener('pointerdown', arrastar);
  }

  /* abrirGaveta({ chave, olho, titulo, sub, html, origem }) — `chave` diz
     o que está aberto; tocar de novo na mesma coisa fecha. */
  function abrirGaveta(o){
    montarGaveta();
    if(G.aberta && !G.fechando && G.chave === o.chave){ fecharGaveta(); return; }
    const trocando = G.aberta && !G.fechando;
    G.chave = o.chave;
    G.el.querySelector('#gv-olho').textContent = o.olho || '';
    G.el.querySelector('#gv-titulo').textContent = o.titulo || '';
    const sub = G.el.querySelector('#gv-sub'); sub.textContent = o.sub || ''; sub.hidden = !o.sub;
    const miolo = G.el.querySelector('#gv-miolo'); miolo.innerHTML = o.html || ''; miolo.scrollTop = 0;
    if(G.origem && G.origem !== o.origem) G.origem.removeAttribute('aria-expanded');
    G.origem = o.origem || null;
    if(G.origem) G.origem.setAttribute('aria-expanded','true');
    if(trocando){
      if(!semMovimento()) miolo.animate([{ opacity:.25, filter:'blur(3px)' }, { opacity:1, filter:'blur(0)' }], { duration:220, easing:SAIDA });
      return;
    }
    if(G.fechando){ G.fechando = false; G.mola.ir(0, { zeta:1, resp:.34 }); return; }
    G.eixo = window.matchMedia('(max-width: 720px)').matches ? 'y' : 'x';
    const cab = document.getElementById('header');
    if(cab) G.el.style.setProperty('--gv-topo', Math.round(cab.getBoundingClientRect().bottom) + 'px');
    G.el.hidden = false; G.veu.hidden = G.eixo !== 'y';
    G.tam = (G.eixo === 'y' ? G.el.offsetHeight : G.el.offsetWidth) + 24;
    G.aberta = true;
    if(semMovimento()){ G.mola.fixar(0); G.el.animate([{ opacity:0 }, { opacity:1 }], { duration:180, easing:'ease-out' }); }
    else { G.mola.fixar(G.tam); G.mola.ir(0, { zeta:1, resp:.36 }); }
    G.el.querySelector('.gv-fechar').focus({ preventScroll:true });
  }
  function fecharGaveta(o = {}){
    if(!G.aberta || G.fechando) return;
    G.fechando = true;
    const concluir = ()=>{
      G.el.hidden = true; G.veu.hidden = true; G.aberta = false; G.fechando = false; G.chave = null;
      const orig = G.origem; G.origem = null;
      if(orig){ orig.removeAttribute('aria-expanded'); if(orig.isConnected && o.devolverFoco !== false) orig.focus({ preventScroll:true }); }
    };
    if(semMovimento()){ G.mola.parar(); const a = G.el.animate([{ opacity:1 }, { opacity:0 }], { duration:160 }); a.onfinish = concluir; return; }
    G.mola.ir(G.tam, { zeta:1, resp:.3, vel:o.vel, aoFim:concluir });
  }
  const gavetaAberta = ()=>G.aberta && !G.fechando ? G.chave : null;

  return { area, ranking, fila, rolar, abrirGaveta, fecharGaveta, gavetaAberta, RAMPA, semMovimento, esconderDica };
})();
