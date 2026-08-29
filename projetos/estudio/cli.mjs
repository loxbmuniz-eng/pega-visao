#!/usr/bin/env node
// Porta de entrada do estúdio. `node cli.mjs <comando>` ou `./estudio <comando>`.
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderizar } from './motor/renderizar.mjs';
import { renderizarLote } from './motor/lote.mjs';
import { acharFfmpeg, capacidades, escolherFormato, montarVideo } from './motor/ffmpeg.mjs';
import { acharChromium } from './motor/cdp.mjs';
import { gerar, listarProvedores } from './geracao/gerar.mjs';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const PASTA_CENAS = join(RAIZ, 'cenas');


// Carrega --dados e resolve caminhos de imagem.
//
// POR QUE resolver: a cena é carregada por file:// de dentro de cenas/<nome>/,
// então um caminho relativo no JSON seria procurado a partir DALI, não da
// pasta do JSON. O Chromium não acha, a imagem não aparece, e o vídeo sai
// com o card em branco sem nenhum erro. Resolver aqui, contra a pasta do
// próprio JSON, é o que faz "imagem": "cards/blind_story.png" funcionar.
async function lerDados(alvo) {
  if (!alvo) return {};
  if (typeof alvo !== 'string') return {};
  if (alvo.trim().startsWith('{')) return JSON.parse(alvo);
  const caminho = resolve(alvo);
  const base = dirname(caminho);
  const dados = JSON.parse(await readFile(caminho, 'utf8'));
  const resolverImagem = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [chave, valor] of Object.entries(obj)) {
      if (chave === 'imagem' && typeof valor === 'string' && valor && !/^(https?:|data:|file:)/.test(valor)) {
        const absoluto = resolve(base, valor);
        if (!existsSync(absoluto)) {
          throw new Error(`imagem não encontrada: ${valor}\n    procurei em ${absoluto}`);
        }
        obj[chave] = pathToFileURL(absoluto).href;
      } else if (typeof valor === 'object') {
        Array.isArray(valor) ? valor.forEach(resolverImagem) : resolverImagem(valor);
      }
    }
  };
  resolverImagem(dados);
  return dados;
}

function lerArgs(argv) {
  const soltos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [chave, valorColado] = a.slice(2).split('=');
      if (valorColado !== undefined) flags[chave] = valorColado;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[chave] = argv[++i];
      else flags[chave] = true;
    } else soltos.push(a);
  }
  return { soltos, flags };
}

// Aceita "cenas/social", "social" ou um .html direto.
function resolverCena(alvo) {
  if (!alvo) throw new Error('faltou dizer a cena. Rode "estudio cenas" para ver as que existem.');
  for (const tentativa of [alvo, join(PASTA_CENAS, alvo), join(PASTA_CENAS, alvo, 'cena.html')]) {
    if (existsSync(tentativa)) return tentativa;
  }
  throw new Error(`cena "${alvo}" não encontrada. Rode "estudio cenas".`);
}

const barra = (feito, total, largura = 24) => {
  const cheio = Math.max(0, Math.min(largura, Math.round((feito / Math.max(1, total)) * largura)));
  return `[${'#'.repeat(cheio)}${'.'.repeat(largura - cheio)}]`;
};

async function cmdCenas() {
  const itens = await readdir(PASTA_CENAS, { withFileTypes: true });
  console.log('\nCenas disponíveis:\n');
  for (const it of itens) {
    if (!it.isDirectory()) continue;
    const html = join(PASTA_CENAS, it.name, 'cena.html');
    if (!existsSync(html)) continue;
    const fonte = await readFile(html, 'utf8');
    const titulo = fonte.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const tamanho = `${fonte.match(/largura:\s*(\d+)/)?.[1] ?? '?'}x${fonte.match(/altura:\s*(\d+)/)?.[1] ?? '?'}`;
    console.log(`  ${it.name.padEnd(16)} ${tamanho.padEnd(11)} ${titulo}`);
  }
  console.log('\n  estudio renderizar <cena>            um vídeo');
  console.log('  estudio lote <cena> <dados.csv>      um vídeo por linha\n');
}

async function cmdRenderizar({ soltos, flags }) {
  const cena = resolverCena(soltos[0]);
  const dados = await lerDados(flags.dados);
  let ultimo = '';
  const r = await renderizar({
    cena,
    saida: flags.saida ?? join(RAIZ, 'saida'),
    dados,
    fps: flags.fps ? Number(flags.fps) : undefined,
    formato: flags.formato ?? 'auto',
    audio: flags.audio ?? null,
    manterQuadros: flags.limpar !== true,
    apenasQuadro: flags.quadro !== undefined ? Number(flags.quadro) : null,
    aoProgresso: ({ quadro, total }) => {
      const linha = `  ${barra(quadro, total)} ${quadro}/${total} quadros`;
      if (linha !== ultimo) { process.stdout.write(`\r${linha}`); ultimo = linha; }
    },
  });
  process.stdout.write('\n');
  console.log(`\n  cena     ${r.rotulo}`);
  console.log(`  tamanho  ${r.largura}x${r.altura} @ ${r.fps}fps · ${r.total} quadros`);
  if (r.quadros) console.log(`  quadros  ${r.quadros}`);
  if (r.video) console.log(`  vídeo    ${r.video}  (${r.formato})`);
  if (r.aviso) console.log(`  aviso    ${r.aviso}`);
  console.log('');
}

async function cmdLote({ soltos, flags }) {
  const cena = resolverCena(soltos[0]);
  const dados = soltos[1];
  if (!dados) throw new Error('faltou o CSV. Uso: estudio lote <cena> <dados.csv>');
  console.log(`\n  cena: ${basename(dirname(cena))}   dados: ${dados}\n`);
  const r = await renderizarLote({
    cena, arquivoDados: dados,
    saida: flags.saida ?? join(RAIZ, 'saida'),
    fps: flags.fps ? Number(flags.fps) : undefined,
    formato: flags.formato ?? 'auto',
    manterQuadros: flags.quadros === true,
    aoVideo: (v) => {
      const posicao = `${String(v.indice).padStart(3)}/${v.totalLinhas}`;
      console.log(v.ok ? `  ok   ${posicao}  ${v.rotulo} -> ${v.video ? basename(v.video) : 'quadros'}`
                       : `  ERRO ${posicao}  ${v.rotulo}: ${v.erro}`);
    },
  });
  console.log(`\n  ${r.feitos.length} vídeo(s) prontos, ${r.falhas.length} falha(s), de ${r.totalLinhas} linha(s).\n`);
  if (r.falhas.length) process.exitCode = 1;
}

async function cmdMontar({ soltos, flags }) {
  const pasta = soltos[0];
  if (!pasta) throw new Error('Uso: estudio montar <pasta_de_quadros> [--fps 30] [--formato mp4]');
  const bin = acharFfmpeg();
  if (!bin) throw new Error('ffmpeg não encontrado. Instale o ffmpeg (apt install ffmpeg / brew install ffmpeg).');
  const caps = capacidades(bin);
  const formato = escolherFormato(caps, flags.formato ?? 'auto');
  const nome = basename(resolve(pasta)).replace(/_quadros$/, '');
  const destino = join(dirname(resolve(pasta)), `${nome}.${formato.extensao}`);
  // A pasta manda no formato do quadro: ela pode ter vindo de outra máquina.
  const existentes = await readdir(resolve(pasta));
  const extensaoQuadro = existentes.some((f) => f.endsWith('.png')) ? 'png' : 'jpg';
  await montarVideo({
    bin, pastaQuadros: resolve(pasta), extensaoQuadro,
    fps: Number(flags.fps ?? 30), saida: destino, formato, audio: flags.audio ?? null, caps,
  });
  console.log(`\n  vídeo  ${destino}  (${formato.chave})\n`);
}

async function cmdGerar({ soltos, flags }) {
  const tipo = soltos[0];
  const pedido = soltos.slice(1).join(' ');
  if (!tipo) {
    console.log('\nUso: estudio gerar <imagem|voz|texto> "seu pedido" [--provedor nome]\n');
    console.log('Provedores configurados:\n');
    for (const p of await listarProvedores()) {
      console.log(`  ${p.nome.padEnd(20)} ${p.tipos.join(', ').padEnd(20)} ${p.disponivel ? 'pronto' : 'não configurado'}`);
    }
    console.log('');
    return;
  }
  const destino = flags.saida ?? join(RAIZ, 'saida', 'geracao');
  await mkdir(destino, { recursive: true });
  const r = await gerar({ tipo, pedido, provedor: flags.provedor, destino, opcoes: flags });
  console.log(`\n  provedor  ${r.provedor}`);
  console.log(`  arquivo   ${r.arquivo}`);
  if (r.aviso) console.log(`  aviso     ${r.aviso}`);
  console.log('');
}

async function cmdChecar() {
  console.log('\n  Diagnóstico do estúdio\n  ----------------------');
  let falhou = false;
  try {
    console.log(`  chromium   ok    ${acharChromium()}`);
  } catch (e) { falhou = true; console.log(`  chromium   FALTA  ${e.message}`); }

  const bin = acharFfmpeg();
  if (!bin) {
    falhou = true;
    console.log('  ffmpeg     FALTA  sem ffmpeg dá para gerar os quadros PNG, mas não o vídeo.');
  } else {
    const c = capacidades(bin);
    console.log(`  ffmpeg     ok    ${bin}`);
    console.log(`  codecs     H.264/mp4: ${c.h264 ? 'sim' : 'NÃO'} · VP9: ${c.vp9 ? 'sim' : 'não'} · VP8/webm: ${c.vp8 ? 'sim' : 'não'} · áudio: ${c.audio ? 'sim' : 'NÃO'}`);
    console.log(`  quadros    lê PNG em arquivo: ${c.lePngEmArquivo ? 'sim' : 'não'} · aceita pipe: ${c.lePipe ? 'sim' : 'não'} · mjpeg: ${c.leMjpeg ? 'sim' : 'não'}`);
    if (!c.lePngEmArquivo) console.log('             -> os quadros serão capturados em JPEG (é o que este ffmpeg lê).');
    try {
      console.log(`  saída      ${escolherFormato(c).chave} por padrão`);
    } catch (e) { falhou = true; console.log(`  saída      FALTA  ${e.message}`); }
    if (!c.h264) {
      console.log('\n  Sem H.264 este ffmpeg não gera MP4 — e MP4 é o que Instagram/TikTok pedem.');
      console.log('  Instale um ffmpeg completo (apt install ffmpeg / brew install ffmpeg).');
      console.log('  Os quadros PNG ficam salvos: "estudio montar <pasta>" recodifica sem re-renderizar.');
    }
  }
  console.log(`  node       ok    ${process.version}`);
  console.log('');
  if (falhou) process.exitCode = 1;
}

const AJUDA = `
  estudio — vídeo escrito em HTML, CSS e JS

  estudio cenas                          lista as cenas
  estudio renderizar <cena> [opções]     renderiza um vídeo
  estudio lote <cena> <dados.csv>        um vídeo por linha da planilha
  estudio montar <pasta_quadros>         recodifica quadros já renderizados
  estudio gerar <imagem|voz|texto> "…"   motor de geração (modelos locais)
  estudio checar                         diz o que falta na máquina

  Opções de render:
    --saida <pasta>     onde escrever            (padrão: ./saida)
    --dados <json|arq>  variáveis da cena
    --fps <n>           sobrepõe o fps da cena
    --formato mp4|webm  padrão: o melhor que o ffmpeg local suportar
    --quadro <n>        renderiza SÓ esse quadro (rápido, para conferir arte)
    --audio <arquivo>   trilha de áudio
    --limpar            apaga os PNGs depois de montar o vídeo
`;

const COMANDOS = {
  cenas: cmdCenas, renderizar: cmdRenderizar, lote: cmdLote,
  montar: cmdMontar, gerar: cmdGerar, checar: cmdChecar,
};

const [, , comando, ...resto] = process.argv;
if (!comando || comando === 'ajuda' || comando === '--help' || comando === '-h') {
  console.log(AJUDA);
} else if (!COMANDOS[comando]) {
  console.error(`\n  comando desconhecido: ${comando}\n${AJUDA}`);
  process.exitCode = 1;
} else {
  try {
    await COMANDOS[comando](lerArgs(resto));
  } catch (erro) {
    console.error(`\n  erro: ${erro.message}\n`);
    process.exitCode = 1;
  }
}
