/* Kit das cenas — o pouco que toda cena repete.
 *
 * Regra que vale para TODAS as cenas: nada de `animation` ou `transition` do
 * CSS. Quem manda no tempo é o renderizador, via aoTempo(t). Uma transition
 * de 300ms parece inofensiva e é justamente o que faz o mesmo quadro sair
 * diferente em duas máquinas — o print pode cair no meio da interpolação. */
(function (global) {
  'use strict';

  // Dados do lote. Fora do lote, `padrao` é o que aparece — assim a cena
  // abre no navegador direto, sem pipeline, enquanto você desenha.
  function dado(chave, padrao) {
    const d = global.__dados || {};
    return d[chave] !== undefined && d[chave] !== '' ? d[chave] : padrao;
  }

  const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  // Progresso 0→1 de uma janela de tempo. É o tijolo de toda animação aqui.
  function janela(t, inicio, duracao) {
    return limitar((t - inicio) / duracao);
  }

  const suave = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const saida = (p) => 1 - Math.pow(1 - p, 3);
  const entrada = (p) => p * p * p;
  const elastico = (p) => (p === 0 || p === 1 ? p : Math.pow(2, -9 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
  const mistura = (a, b, p) => a + (b - a) * p;

  // Entrada padrão: sobe e aparece. Usada por quase todo elemento.
  function surgir(el, t, inicio, duracao = 0.6, deslocaY = 40) {
    if (!el) return;
    const p = saida(janela(t, inicio, duracao));
    el.style.opacity = String(p);
    el.style.transform = `translate3d(0, ${mistura(deslocaY, 0, p)}px, 0)`;
  }

  // Escreve o texto letra a letra. Serve para dar ritmo de "código sendo
  // digitado" sem depender de animação do CSS.
  function digitar(el, texto, t, inicio, duracaoPorChar = 0.035) {
    if (!el) return;
    const n = Math.floor(limitar((t - inicio) / (duracaoPorChar * texto.length)) * texto.length);
    el.textContent = texto.slice(0, n);
  }

  function pintarLista(el, itens, classe) {
    el.innerHTML = '';
    return itens.map((texto) => {
      const li = document.createElement('li');
      li.className = classe || '';
      li.textContent = texto;
      li.style.opacity = '0';
      el.appendChild(li);
      return li;
    });
  }

  // Itens de lista dentro de UMA célula do CSV vêm separados por "|".
  //
  // POR QUE "|" e não ";": o CSV exportado do Excel em português já usa ";"
  // como separador de coluna. Um ";" dentro da célula desloca as colunas
  // seguintes e o vídeo sai com o texto errado — aconteceu no primeiro lote
  // deste projeto. "|" não colide com nenhum dos dois separadores de CSV.
  function lista(valor, padrao) {
    const v = dado(valor, null);
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) return v.split('|').map((s) => s.trim()).filter(Boolean);
    return padrao;
  }

  // Partes DENTRO de um item ("312 vídeos :: por mês"). Mesmo motivo do "|".
  function partes(item) {
    return String(item).split('::').map((s) => s.trim());
  }

  global.Kit = {
    dado, lista, partes, limitar, janela, suave, saida, entrada, elastico, mistura,
    surgir, digitar, pintarLista,
    $: (sel) => document.querySelector(sel),
    $$: (sel) => [...document.querySelectorAll(sel)],
  };
})(window);
