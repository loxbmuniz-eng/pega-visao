// Renderiza uma cena HTML em vídeo, quadro a quadro.
//
// A ideia toda: a cena NÃO anima sozinha. Ela expõe `aoTempo(t)` e o
// renderizador é quem manda no relógio. Isso é o que separa este estúdio de
// "gravar a tela": o quadro 47 é o quadro 47 em qualquer máquina, hoje ou
// daqui a um ano, rápida ou lenta. Sem isso, render em máquina carregada
// pula frames e o vídeo sai diferente do que você aprovou.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirNavegador } from './cdp.mjs';
import { abrirPagina } from './pagina.mjs';
import { acharFfmpeg, capacidades, formatoDoQuadro, escolherFormato, montarVideo } from './ffmpeg.mjs';

export const CONTRATO_DA_CENA = `
A cena precisa definir window.cena antes do evento load:

  window.cena = {
    duracao: 8,          // segundos (obrigatório)
    fps: 30,             // opcional, padrão 30
    largura: 1080,       // opcional, padrão 1080
    altura: 1920,        // opcional, padrão 1920
    preparar() {},       // opcional, roda uma vez antes do primeiro quadro
    aoTempo(t) {}        // obrigatório: posiciona a cena no instante t
  };
`.trim();

function caminhoDaCena(alvo) {
  const p = resolve(alvo);
  if (existsSync(p) && !p.endsWith('.html')) {
    const dentro = join(p, 'cena.html');
    if (existsSync(dentro)) return dentro;
  }
  if (!existsSync(p)) throw new Error(`cena não encontrada: ${alvo}`);
  return p;
}

const ESPERAR_MIDIA = `
  (async () => {
    const imgs = [...document.images].filter(i => !i.complete);
    await Promise.all(imgs.map(i => new Promise(r => {
      i.addEventListener('load', r, { once: true });
      i.addEventListener('error', r, { once: true });
    })));
    return true;
  })()
`;

export async function renderizar({
  cena,
  saida = './saida',
  dados = {},
  fps: fpsForcado,
  formato: formatoPedido = 'auto',
  audio = null,
  manterQuadros = true,
  apenasQuadro = null,
  nome = null,
  aoProgresso = () => {},
} = {}) {
  const arquivo = caminhoDaCena(cena);
  const rotulo = nome ?? basename(arquivo).replace(/\.html$/, '').replace(/^cena$/, basename(resolve(arquivo, '..')));

  const pastaSaida = resolve(saida);
  const pastaQuadros = join(pastaSaida, `${rotulo}_quadros`);
  await rm(pastaQuadros, { recursive: true, force: true });
  await mkdir(pastaQuadros, { recursive: true });

  // O formato do quadro é decidido pelo que o ffmpeg local consegue LER, não
  // por gosto: a build enxuta do Playwright não decodifica PNG. Descobrir isso
  // antes do loop evita renderizar 900 quadros que o encoder vai recusar.
  const binFf = acharFfmpeg();
  const caps = binFf ? capacidades(binFf) : null;
  const quadroFmt = formatoDoQuadro(caps);

  const navegador = await abrirNavegador();
  try {
    // Viewport provisório: só para conseguir ler o que a cena declara.
    const pagina = await abrirPagina(navegador, { largura: 800, altura: 600 });
    await pagina.injetarAntes(`window.__dados = ${JSON.stringify(dados)};`);
    await pagina.irPara(pathToFileURL(arquivo).href);

    const meta = await pagina.avaliar(`
      (() => {
        const c = window.cena;
        if (!c) return null;
        return {
          duracao: c.duracao, fps: c.fps, largura: c.largura, altura: c.altura,
          temAoTempo: typeof c.aoTempo === 'function',
          temPreparar: typeof c.preparar === 'function',
        };
      })()
    `);
    if (!meta) throw new Error(`a cena ${arquivo} não define window.cena.\n\n${CONTRATO_DA_CENA}`);
    if (!meta.temAoTempo) throw new Error(`a cena ${arquivo} não define aoTempo(t).\n\n${CONTRATO_DA_CENA}`);
    if (!(meta.duracao > 0)) throw new Error(`a cena ${arquivo} precisa declarar duracao > 0.`);

    const fps = fpsForcado ?? meta.fps ?? 30;
    const largura = meta.largura ?? 1080;
    const altura = meta.altura ?? 1920;

    await pagina.enviar('Emulation.setDeviceMetricsOverride', {
      width: largura, height: altura, deviceScaleFactor: 1, mobile: false,
    });
    await pagina.esperarFontes();
    await pagina.avaliar(ESPERAR_MIDIA);
    if (meta.temPreparar) await pagina.avaliar('Promise.resolve(window.cena.preparar()).then(() => true)');

    const total = Math.max(1, Math.round(meta.duracao * fps));
    const quadros = apenasQuadro === null
      ? Array.from({ length: total }, (_, i) => i)
      : [Math.max(0, Math.min(total - 1, apenasQuadro))];

    for (const [posicao, i] of quadros.entries()) {
      const t = i / fps;
      await pagina.avaliar(`Promise.resolve(window.cena.aoTempo(${t})).then(() => true)`);
      const bytes = await pagina.capturar({ formato: quadroFmt.formato, qualidade: quadroFmt.qualidade });
      await writeFile(join(pastaQuadros, `${String(i + 1).padStart(5, '0')}.${quadroFmt.extensao}`), bytes);
      // `quadro` é a posição na fila deste render; `numeroQuadro` é o número
      // absoluto na linha do tempo. Com --quadro 90 os dois diferem, e trocar
      // um pelo outro já estourou a barra de progresso.
      aoProgresso({ quadro: posicao + 1, numeroQuadro: i + 1, total: quadros.length, rotulo });
    }

    await pagina.fechar();

    if (apenasQuadro !== null) {
      return { rotulo, quadros: pastaQuadros, video: null, largura, altura, fps, total: 1, extensaoQuadro: quadroFmt.extensao };
    }

    if (!binFf) {
      return {
        rotulo, quadros: pastaQuadros, video: null, largura, altura, fps, total,
        extensaoQuadro: quadroFmt.extensao,
        aviso: 'ffmpeg não encontrado — os quadros ficaram salvos. Instale o ffmpeg e rode "estudio montar".',
      };
    }
    const formato = escolherFormato(caps, formatoPedido);
    const video = join(pastaSaida, `${rotulo}.${formato.extensao}`);
    await montarVideo({
      bin: binFf, pastaQuadros, extensaoQuadro: quadroFmt.extensao,
      fps, saida: video, formato, audio, caps,
    });
    if (!manterQuadros) await rm(pastaQuadros, { recursive: true, force: true });

    return {
      rotulo, quadros: manterQuadros ? pastaQuadros : null, video, largura, altura, fps, total,
      formato: formato.chave, extensaoQuadro: quadroFmt.extensao,
      aviso: quadroFmt.extensao === 'jpg'
        ? 'quadros salvos em JPEG porque o ffmpeg encontrado não decodifica PNG. Com um ffmpeg completo os quadros saem sem perda.'
        : undefined,
    };
  } finally {
    await navegador.fechar();
  }
}
