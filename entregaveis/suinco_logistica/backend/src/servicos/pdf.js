/* IMPRESSÃO DO RELATÓRIO — o pedaço que qualquer um pode chamar.
   =====================================================================

   Isto era o corpo de `POST /api/relatorios/pdf` (ver o comentário de lá
   para o porquê de o servidor imprimir no lugar do aparelho do operador).
   Virou módulo em 20/08/2026, quando o robô do WhatsApp passou a precisar
   do MESMO PDF sem passar por requisição de navegador nenhuma.

   Uma função só, um Chromium só, um `@page` só — a rota e o robô imprimem
   pela mesma régua. Se um dia a folha mudar, muda aqui e muda para os dois. */

import { chromium } from 'playwright';
import { config } from '../config.js';

export async function gerarPdf({ html, css, paisagem = true }) {
  let navegador;
  try {
    navegador = await chromium.launch({
      headless: true,
      // Em produção o Playwright usa o Chromium instalado por
      // `npx playwright install chromium` (ver instalar.sh). Em
      // desenvolvimento, PLAYWRIGHT_CHROMIUM_PATH aponta pro binário já
      // instalado na máquina.
      executablePath: config.playwrightChromiumPath || undefined,
      args: ['--no-sandbox'], // roda como usuário sem privilégio no VPS
    });
    const pagina = await navegador.newPage();

    /* O `@page` do SERVIDOR vem DEPOIS do CSS recebido, de propósito: a
       regra `@page{size:...}` da própria página SEMPRE ganha do parâmetro
       `landscape` do Playwright. Declarar por último faz esta linha vencer
       na cascata e torna o servidor a autoridade final sobre a folha. */
    const folha = `@page{size:A4 ${paisagem ? 'landscape' : 'portrait'};margin:5mm}`;
    const documento = `<!doctype html><html><head><meta charset="utf-8">`
      + `<style>${css}</style><style>${folha}</style></head><body>${html}</body></html>`;

    /* O RELATÓRIO É AUTOSSUFICIENTE — E O CHROMIUM NÃO SAI PARA A REDE
       (09/09/2026). O HTML e o CSS chegam prontos do painel; a fonte vem
       embutida em base64. Nada aqui precisa buscar recurso externo. Sem
       este bloqueio, um HTML com <img src="http://127.0.0.1:5432"> ou um
       endereço interno faria o servidor buscar o que não devia e esperar
       por ele no `networkidle` (auditoria de segurança: SSRF). Requisição
       `data:` não passa por aqui — o Playwright não intercepta esse esquema,
       e é só disso que o documento precisa. */
    await pagina.route('**/*', (rota) => rota.abort('blockedbyclient'));

    await pagina.setContent(documento, { waitUntil: 'networkidle' });
    // A fonte embutida (base64) ainda precisa decodificar antes de o layout
    // medir texto — sem esperar, a primeira medição usaria o fallback.
    await pagina.evaluate(() => document.fonts.ready);

    return await pagina.pdf({
      format: 'A4',
      landscape: paisagem,
      printBackground: true,
      // Sem margin aqui: o `@page{margin:5mm}` acima já define a margem.
    });
  } finally {
    if (navegador) await navegador.close().catch(() => {});
  }
}

export function nomeArquivoSeguro(nome) {
  return String(nome || 'relatorio')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'relatorio';
}
