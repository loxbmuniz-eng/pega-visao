// Extração do conteúdo da página.
//
// O que um agente precisa de uma página não é o HTML: é o texto que importa,
// os links, e o dado estruturado. Devolver HTML cru gasta contexto com menu,
// rodapé e script — e é justamente o pedaço que não responde pergunta
// nenhuma. Aqui o trabalho é feito DENTRO da página, onde o DOM já está
// montado, e volta só o que serve.

export const ROTEIRO = `
(() => {
  const limpar = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const absoluto = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };

  // Blocos que quase nunca contêm a resposta e sempre contêm ruído.
  const LIXO = 'script,style,noscript,nav,footer,header,aside,form,iframe,svg,[aria-hidden="true"]';

  // Escolhe o container principal por densidade de texto, não por tag: muito
  // site não usa <article>, e muitos usam <article> para o card da barra
  // lateral. Densidade erra menos.
  function corpoPrincipal() {
    const candidatos = [...document.querySelectorAll('article, main, [role="main"], #content, .content, .post, body')];
    let melhor = document.body, nota = -1;
    for (const el of candidatos) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(LIXO).forEach((n) => n.remove());
      const texto = limpar(clone.textContent);
      const links = clone.querySelectorAll('a').length;
      // Muito link e pouco texto = índice, não conteúdo.
      const pontos = texto.length / (1 + links * 40);
      if (texto.length > 200 && pontos > nota) { nota = pontos; melhor = el; }
    }
    return melhor;
  }

  const principal = corpoPrincipal();
  const limpo = principal.cloneNode(true);
  limpo.querySelectorAll(LIXO).forEach((n) => n.remove());

  const paragrafos = [...limpo.querySelectorAll('p, li, blockquote, td')]
    .map((n) => limpar(n.textContent))
    .filter((t) => t.length > 30);

  const texto = paragrafos.length
    ? paragrafos.join('\\n\\n')
    : limpar(limpo.textContent);

  const meta = (nome) =>
    document.querySelector(\`meta[name="\${nome}"], meta[property="\${nome}"]\`)?.content || null;

  const dadosEstruturados = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((n) => { try { return JSON.parse(n.textContent); } catch { return null; } })
    .filter(Boolean);

  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => ({ texto: limpar(a.textContent).slice(0, 120), url: absoluto(a.getAttribute('href')) }))
    .filter((l) => l.url && l.texto && !l.url.startsWith('javascript:'));

  // Deduplica por URL mantendo o primeiro texto — o mesmo link costuma
  // aparecer no menu e no corpo, e o do corpo raramente é o primeiro.
  const vistos = new Set();
  const linksUnicos = links.filter((l) => !vistos.has(l.url) && vistos.add(l.url));

  return {
    url: location.href,
    titulo: document.title || null,
    descricao: meta('description') || meta('og:description'),
    idioma: document.documentElement.lang || null,
    canonica: document.querySelector('link[rel="canonical"]')?.href || null,
    publicado: meta('article:published_time') || meta('date') || null,
    titulos: [...limpo.querySelectorAll('h1,h2,h3')]
      .map((h) => ({ nivel: Number(h.tagName[1]), texto: limpar(h.textContent) }))
      .filter((h) => h.texto),
    texto,
    palavras: texto ? texto.split(/\\s+/).length : 0,
    imagens: [...limpo.querySelectorAll('img[src]')]
      .map((i) => ({ url: absoluto(i.getAttribute('src')), alt: limpar(i.alt) }))
      .filter((i) => i.url).slice(0, 40),
    links: linksUnicos.slice(0, 200),
    dadosEstruturados,
  };
})()
`;

export function paraMarkdown(dado) {
  const linhas = [`# ${dado.titulo ?? '(sem título)'}`, '', dado.url];
  if (dado.descricao) linhas.push('', `> ${dado.descricao}`);
  if (dado.publicado) linhas.push('', `Publicado: ${dado.publicado}`);
  linhas.push('', '---', '', dado.texto || '(sem texto extraído)');
  if (dado.links?.length) {
    linhas.push('', '## Links', '');
    for (const l of dado.links.slice(0, 40)) linhas.push(`- [${l.texto}](${l.url})`);
  }
  return linhas.join('\n');
}
