// Site de mentira, servido em 127.0.0.1. Os testes não tocam a internet:
// teste que depende de rede falha por motivo errado e ensina a ignorar
// vermelho.
import { createServer } from 'node:http';

export const PAGINAS = {
  '/robots.txt': [200, 'text/plain', `User-agent: *
Crawl-delay: 0
Disallow: /privado/
Disallow: /*.pdf$
Allow: /privado/liberado.html

User-agent: RoboMau
Disallow: /
`],
  '/': [200, 'text/html', `<!doctype html><html lang="pt-BR"><head>
    <meta charset="utf-8"><title>Loja de Teste</title>
    <meta name="description" content="Uma loja que só existe no teste.">
    <link rel="canonical" href="http://exemplo.test/">
    <script type="application/ld+json">{"@type":"Organization","name":"Loja de Teste"}</script>
  </head><body>
    <nav><a href="/menu1">Menu um</a><a href="/menu2">Menu dois</a></nav>
    <main>
      <h1>Bem-vindo à loja</h1>
      <p>Este parágrafo tem mais de trinta caracteres para entrar na extração do texto principal.</p>
      <h2>Nossos produtos</h2>
      <p>Outro parágrafo suficientemente longo para o extrator considerar conteúdo de verdade.</p>
      <img src="/foto.jpg" alt="Foto do produto">
      <a href="/produto/1">Produto um</a>
    </main>
    <footer><a href="/rodape">Rodapé que não deveria virar conteúdo</a></footer>
    <script>var x = 1;</script>
  </body></html>`],
  '/privado/segredo.html': [200, 'text/html', '<title>Privado</title><p>não deveria ser lido</p>'],
  '/formulario': [200, 'text/html', `<!doctype html><title>Formulário</title>
    <input id="busca"><button id="enviar">Enviar</button>
    <div id="resultado"></div>
    <script>
      document.getElementById('enviar').addEventListener('click', () => {
        document.getElementById('resultado').textContent =
          'buscou: ' + document.getElementById('busca').value;
      });
    </script>`],
  '/tardio': [200, 'text/html', `<!doctype html><title>Tardio</title><div id="alvo"></div>
    <script>setTimeout(() => {
      document.getElementById('alvo').innerHTML = '<span class="pronto">carregou depois</span>';
    }, 250);</script>`],
};

export function subirFixture(porta = 0) {
  const servidor = createServer((req, res) => {
    const caminho = new URL(req.url, 'http://interno').pathname;
    const p = PAGINAS[caminho];
    if (!p) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('não achei'); }
    res.writeHead(p[0], { 'content-type': `${p[1]}; charset=utf-8` });
    res.end(p[2]);
  });
  return new Promise((r) => servidor.listen(porta, '127.0.0.1', () => r(servidor)));
}
