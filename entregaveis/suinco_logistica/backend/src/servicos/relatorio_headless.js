/* O RELATÓRIO SEM NINGUÉM NA FRENTE DA TELA.
   =====================================================================

   Existe por causa do robô do WhatsApp (20/08/2026): de 3 em 3 horas o
   grupo "Alinhamento Carregamento" recebe o andamento do pátio com o PDF do
   Relatório Operacional em anexo. Até aqui, esse PDF só nascia se um
   operador clicasse em "Exportar" — de madrugada não haveria clique nenhum.

   COMO FUNCIONA: o servidor abre o PRÓPRIO painel num Chromium headless,
   já com uma sessão válida injetada, espera a sincronização, e chama a
   mesma função que o botão da tela chama (`montarRelatorioOperacional`).
   O HTML e o CSS resultantes vão para o mesmo `gerarPdf` da rota comum.

   POR QUE NÃO REDESENHAR O RELATÓRIO AQUI EM NODE: seria um segundo
   relatório, com as mesmas colunas escritas duas vezes. Bastava alguém
   ajustar uma coluna no painel para o PDF do grupo começar a divergir do
   que a Logística vê — e ninguém perceberia por semanas, porque o PDF do
   grupo ninguém confere contra a tela. Uma fonte só.

   SESSÃO: o token é ASSINADO AQUI, com o mesmo segredo do login normal, e
   vale poucos minutos. Não existe usuário "robô" no banco, não existe senha
   de robô guardada em lugar nenhum, e não há o que vazar de um .env. O
   operador sintético entra como Logística porque é o setor dono deste
   relatório — e, de todo modo, esta sessão só lê: o robô nunca clica em
   nada. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
import { config } from '../config.js';
import { gerarPdf } from './pdf.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/* Onde está o painel de uma peça (index.html gerado por
   build_arquivo_unico.py). Em produção o instalar.sh copia para
   APP_DIR/painel/; em desenvolvimento ele está dois níveis acima, no
   próprio repositório. A primeira que existir vence. */
const CANDIDATOS_PAINEL = [
  process.env.PAINEL_HTML,
  path.join(AQUI, '..', '..', 'painel', 'index.html'),
  path.join(AQUI, '..', '..', '..', 'index.html'),
].filter(Boolean);

export function acharPainel() {
  for (const p of CANDIDATOS_PAINEL) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* segue tentando */ }
  }
  return null;
}

const OPERADOR_ROBO = {
  id: 'robo-relatorios',
  nome: 'Robô de Relatórios',
  email: 'robo@embarquesuinco.local',
  setor: 'Logística',
};

function tokenDoRobo() {
  return jwt.sign(
    {
      sub: OPERADOR_ROBO.id,
      nome: OPERADOR_ROBO.nome,
      email: OPERADOR_ROBO.email,
      setor: OPERADOR_ROBO.setor,
    },
    config.jwtSegredo,
    // Curto de propósito: a sessão do robô existe pelo tempo de montar um
    // relatório. Se vazasse do processo, já teria expirado.
    { expiresIn: '5m' }
  );
}

/* O dia de hoje em São Paulo, no formato do <input type="date">. O robô
   sempre pede o dia corrente — quem quiser outro período usa o painel. */
function hojeLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/* ---------------------------------------------------------------------
   Monta o Relatório Operacional do dia e devolve o PDF em bytes.
   --------------------------------------------------------------------- */
export async function pdfOperacionalDoDia({ dia } = {}) {
  const arquivo = acharPainel();
  if (!arquivo) {
    const e = new Error(
      'Não achei o arquivo do painel (index.html) para montar o relatório. '
      + 'Rode o instalador de novo ou aponte PAINEL_HTML no .env.'
    );
    e.codigo = 'PAINEL_NAO_ENCONTRADO';
    throw e;
  }

  const alvo = dia || hojeLocal();
  const token = tokenDoRobo();
  /* O painel publicado fala com a API pública. Aqui ele está DENTRO do
     servidor: falar com 127.0.0.1 evita sair para a internet e voltar, e
     mantém o relatório funcionando mesmo se o DNS ou o certificado
     estiverem com problema — que são justamente as horas em que alguém
     mais precisa saber o que está acontecendo no pátio. */
  const apiLocal = `http://127.0.0.1:${config.porta}`;
  let html = fs.readFileSync(arquivo, 'utf-8');
  html = html
    .replace("api: 'https://api.embarquesuinco.com.br'", `api: '${apiLocal}'`)
    .replace(
      'https://api.embarquesuinco.com.br/socket.io/socket.io.js',
      `${apiLocal}/socket.io/socket.io.js`
    );

  let navegador;
  try {
    navegador = await chromium.launch({
      headless: true,
      executablePath: config.playwrightChromiumPath || undefined,
      args: ['--no-sandbox'],
    });
    const pagina = await navegador.newPage();

    await pagina.addInitScript(
      ({ tok, operador }) => {
        // Mesmas chaves que o painel usa (suinco-api.js e data.js).
        try { sessionStorage.setItem('suinco_token', tok); } catch (e) { /* ignora */ }
        try {
          localStorage.setItem('suinco_painel_v1', JSON.stringify({ operador }));
        } catch (e) { /* ignora */ }
      },
      { tok: token, operador: OPERADOR_ROBO }
    );

    const url = `${apiLocal}/__relatorio_robo`;
    await pagina.route(url, (rota) => rota.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: html,
    }));
    await pagina.goto(url, { waitUntil: 'domcontentloaded' });

    /* Identificador SOLTO, não `window.x` — o painel declara suas peças com
       `const` no escopo do script, e `const` de topo de script clássico NÃO
       vira propriedade de window (diferente de `var`/`function`). Foi o que
       fez a primeira versão disto esperar 30s por um `window.SuincoSharePoint`
       que nunca ia existir, com o painel funcionando perfeitamente ao lado. */
    await pagina.waitForFunction(
      () => typeof montarRelatorioOperacional === 'function'
        && typeof SuincoSharePoint === 'object'
        && SuincoSharePoint.estaConfigurado(),
      null,
      { timeout: 30_000 }
    );

    // O painel precisa ter puxado o estado do servidor antes de montar —
    // relatório com a lista pela metade é pior que relatório nenhum.
    const estado = await pagina.evaluate(async () => {
      try { await SuincoSharePoint.sincronizarAgora(); } catch (e) { /* estado dirá */ }
      return SuincoSharePoint.estado ? SuincoSharePoint.estado() : 'desconhecido';
    });
    if (estado === 'offline') {
      const e = new Error(
        'O painel abriu mas não conseguiu falar com a API para buscar as cargas '
        + '— relatório com lista incompleta não vale como relatório.'
      );
      e.codigo = 'SEM_SINCRONIA';
      throw e;
    }

    const { html: corpo, css } = await pagina.evaluate(async (diaAlvo) => {
      // O relatório respeita o filtro de período da aba Relatórios; o robô
      // fixa o dia corrente nos dois campos antes de mandar montar.
      const de = document.getElementById('rel-data-de');
      const ate = document.getElementById('rel-data-ate');
      if (de) de.value = diaAlvo;
      if (ate) ate.value = diaAlvo;

      const el = await montarRelatorioOperacional();
      // O container é `.print-only` (escondido em tela). O `display:block`
      // é o mesmo que a exportação pela tela aplica antes de mandar
      // imprimir — sem ele o documento sai em branco.
      el.style.display = 'block';
      return { html: el.outerHTML, css: coletarCssDoPainel() };
    }, alvo);

    if (!corpo || !css || !css.trim()) {
      const e = new Error('O painel abriu mas não devolveu o relatório montado.');
      e.codigo = 'RELATORIO_VAZIO';
      throw e;
    }

    // Retrato: é a mesma orientação que `exportarViaServidor` pede para o
    // Operacional na tela. O robô não escolhe folha diferente da do painel.
    return await gerarPdf({ html: corpo, css, paisagem: false });
  } finally {
    if (navegador) await navegador.close().catch(() => {});
  }
}
