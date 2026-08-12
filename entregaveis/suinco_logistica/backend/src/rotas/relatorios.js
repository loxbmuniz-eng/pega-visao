import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { chromium } from 'playwright';
import { exigirLogin } from '../middleware/auth.js';
import { config } from '../config.js';

export const rotasRelatorios = Router();

/* Por que esta rota existe (09/08/2026): os relatórios eram gerados com
   `window.print()` no aparelho de cada operador — e cada navegador/celular
   decide sozinho o tamanho de página final. Provado com PDFs reais nesta
   mesma investigação: o mesmo relatório, sem o motor de impressão respeitar
   o `@page{size:A4 landscape}` do CSS, sai em Carta (Letter) americana e
   quebra em páginas a mais. Depende do aparelho, exatamente o que o usuário
   não quer: "preciso que eles venham no mesmo formato para os usuários
   independente de onde tiver sendo exportado... tem sempre que sair do
   mesmo jeito independente do usuario" + "eu quero que saia no modo
   paisagem, e saiam iguais... tanto no ios ou android ou desktop".

   A única forma de GARANTIR isso é o PDF parar de passar pelo diálogo de
   impressão do aparelho do usuário. Aqui o SERVIDOR renderiza o relatório
   com um Chromium que nós controlamos e pedimos A4 paisagem explicitamente
   — não é um pedido que o motor de impressão pode ignorar, é um parâmetro
   direto da chamada. O HTML/CSS em si continua sendo o mesmo que o painel
   já constrói no navegador (a mesma lógica de `exportarPdfOperacional` /
   `exportarPdfExecutivo` / `exportarPdfFretes`, testada e aprovada antes) —
   só o "vira arquivo" que muda de lugar. */

const limitadorRelatorios = rateLimit({
  windowMs: 60_000,
  limit: 20, // gerar PDF é caro (sobe um Chromium); bem mais apertado que o limite geral da API
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.operador?.id || req.ip,
  message: { erro: 'Muitos relatórios gerados em pouco tempo. Espere um minuto.', codigo: 'LIMITE_EXCEDIDO' },
});

const LARGURA_MAX_HTML = 3_000_000; // ~3MB: CSS+fonte embutida (~190KB) tem folga enorme; acima disso é corpo suspeito, não relatório real
const LARGURA_MAX_CSS = 1_000_000;

function nomeArquivoSeguro(nome) {
  return String(nome || 'relatorio')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'relatorio';
}

rotasRelatorios.post('/relatorios/pdf', limitadorRelatorios, exigirLogin, async (req, res, next) => {
  const { html, css, orientacao, nomeArquivo } = req.body || {};

  if (typeof html !== 'string' || !html.trim()) {
    return res.status(400).json({ erro: 'Faltou o conteúdo do relatório (html).', codigo: 'HTML_FALTANDO' });
  }
  if (typeof css !== 'string' || !css.trim()) {
    return res.status(400).json({ erro: 'Faltou o estilo do relatório (css).', codigo: 'CSS_FALTANDO' });
  }
  if (html.length > LARGURA_MAX_HTML || css.length > LARGURA_MAX_CSS) {
    return res.status(413).json({ erro: 'Conteúdo do relatório grande demais.', codigo: 'CONTEUDO_GRANDE_DEMAIS' });
  }
  const paisagem = orientacao !== 'retrato';

  let navegador;
  try {
    navegador = await chromium.launch({
      headless: true,
      // Em produção o Playwright usa o Chromium instalado por
      // `npx playwright install chromium` (ver instalar.sh). Em
      // desenvolvimento/teste local, PLAYWRIGHT_CHROMIUM_PATH aponta pro
      // binário já instalado na máquina — sem isso cada ambiente teria que
      // ter a MESMA revisão exata do Chromium, o que não é garantido.
      executablePath: config.playwrightChromiumPath || undefined,
      args: ['--no-sandbox'], // roda como usuário sem privilégio no VPS; sandbox do Chromium exige capacidades que o serviço não tem
    });
    const pagina = await navegador.newPage();

    // Documento mínimo, só com o CSS que o próprio painel já usa para
    // imprimir (o navegador do operador manda o texto do <style> único do
    // bundle) + o HTML já pronto que `exportarPdfXxx()` constrói. Sem isso
    // ser um documento completo, `@page` e `@font-face` do CSS não têm
    // onde se aplicar.
    /* O `@page` do SERVIDOR vem DEPOIS do CSS recebido, de propósito.

       Achado ao testar: a regra `@page{size:...}` da própria página SEMPRE
       ganha do parâmetro `landscape` do Playwright — o parâmetro só decide
       quando a página não opina. Como o CSS do painel traz o seu próprio
       `@page{size:A4 landscape}`, sem esta linha o parâmetro `orientacao`
       desta rota seria decorativo: pedir retrato devolveria paisagem.

       Declarar por último faz esta regra vencer no cascata e torna o
       SERVIDOR a autoridade final sobre a folha — que é exatamente o
       ponto desta rota existir. A margem repete o valor do painel
       (styles.css, @page{margin:5mm}) pra folha não mudar de tamanho útil
       junto. */
    const folha = `@page{size:A4 ${paisagem ? 'landscape' : 'portrait'};margin:5mm}`;
    const documento = `<!doctype html><html><head><meta charset="utf-8">`
      + `<style>${css}</style><style>${folha}</style></head><body>${html}</body></html>`;

    await pagina.setContent(documento, { waitUntil: 'networkidle' });
    // A fonte embutida (base64, ver build_arquivo_unico.py) ainda precisa
    // decodificar e ficar pronta pro layout medir texto corretamente —
    // sem esperar isso, a primeira renderização mediria com a fonte de
    // fallback e o texto poderia não bater com o que o operador viu na
    // pré-visualização.
    await pagina.evaluate(() => document.fonts.ready);

    const bytes = await pagina.pdf({
      format: 'A4',
      landscape: paisagem,
      printBackground: true,
      // Sem margin aqui: o `@page{margin:5mm}` já embutido no CSS
      // encaminhado é quem define a margem — pedir os dois ao mesmo tempo
      // soma margem em dobro.
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivoSeguro(nomeArquivo)}.pdf"`);
    res.send(bytes);
  } catch (e) {
    return next(e);
  } finally {
    if (navegador) await navegador.close().catch(() => {});
  }
});
