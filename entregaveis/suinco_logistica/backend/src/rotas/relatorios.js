import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { exigirLogin } from '../middleware/auth.js';
import { gerarPdf, nomeArquivoSeguro } from '../servicos/pdf.js';

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

  try {
    const bytes = await gerarPdf({ html, css, paisagem });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivoSeguro(nomeArquivo)}.pdf"`);
    return res.send(bytes);
  } catch (e) {
    return next(e);
  }
});
