#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { Sessao } from './nucleo/navegador.mjs';
import { paraMarkdown } from './nucleo/extrair.mjs';
import { podeVisitar, AGENTE } from './nucleo/robos.mjs';
import { subir } from './nucleo/servidor.mjs';

function lerArgs(argv) {
  const soltos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [chave, colado] = a.slice(2).split('=');
      if (colado !== undefined) flags[chave] = colado;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[chave] = argv[++i];
      else flags[chave] = true;
    } else soltos.push(a);
  }
  return { soltos, flags };
}

const AJUDA = `
  navegador — um navegador de verdade para agentes de IA

  navegador extrair <url> [--markdown] [--seletor CSS] [--saida arq]
  navegador captura <url> [--saida arq.png] [--inteira]
  navegador fluxo <passos.json>
  navegador robots <url>            o que o site permite
  navegador servidor [--porta 8787]

  Opções gerais:
    --ignorar-robots    só para site próprio ou ambiente de teste
    --largura --altura  tamanho da janela (padrão 1280x900)
`;

async function comSessao(flags, funcao) {
  const sessao = new Sessao({
    largura: flags.largura ? Number(flags.largura) : undefined,
    altura: flags.altura ? Number(flags.altura) : undefined,
    ignorarRobots: flags['ignorar-robots'] === true,
  });
  try {
    return await funcao(sessao);
  } finally {
    await sessao.fechar();
  }
}

const COMANDOS = {
  async extrair({ soltos, flags }) {
    const url = soltos[0];
    if (!url) throw new Error('faltou a URL.');
    const dado = await comSessao(flags, (s) => s.extrair(url, { seletor: flags.seletor || null }));
    const texto = flags.markdown ? paraMarkdown(dado) : JSON.stringify(dado, null, 2);
    if (flags.saida) {
      await writeFile(flags.saida, texto, 'utf8');
      console.log(`\n  ${dado.palavras} palavras · ${dado.links.length} links -> ${flags.saida}\n`);
    } else {
      console.log(texto);
    }
  },

  async captura({ soltos, flags }) {
    const url = soltos[0];
    if (!url) throw new Error('faltou a URL.');
    const png = await comSessao(flags, (s) => s.capturar(url, { paginaInteira: flags.inteira === true }));
    const destino = flags.saida ?? 'captura.png';
    await writeFile(destino, png);
    console.log(`\n  ${(png.length / 1024).toFixed(0)} KB -> ${destino}\n`);
  },

  async fluxo({ soltos, flags }) {
    const arquivo = soltos[0];
    if (!arquivo) throw new Error('faltou o arquivo de passos.');
    const receita = JSON.parse(await readFile(arquivo, 'utf8'));
    const passos = Array.isArray(receita) ? receita : receita.passos;
    const saida = await comSessao(flags, (s) => s.fluxo(passos, { url: receita.url }));
    console.log(JSON.stringify(saida, null, 2));
  },

  async robots({ soltos }) {
    const url = soltos[0];
    if (!url) throw new Error('faltou a URL.');
    const r = await podeVisitar(url);
    console.log(`\n  ${url}`);
    console.log(`  permitido   ${r.permitido ? 'sim' : 'NÃO'}${r.regra ? `  (regra: ${r.regra})` : ''}`);
    console.log(`  intervalo   ${r.atraso}ms entre requisições`);
    console.log(`  agente      ${AGENTE}\n`);
  },

  async servidor({ flags }) {
    const porta = Number(flags.porta ?? 8787);
    const host = flags.host ?? '127.0.0.1';
    const sessao = new Sessao({ ignorarRobots: flags['ignorar-robots'] === true });
    await subir({ porta, host, sessao });
    console.log(`\n  navegador ouvindo em http://${host}:${porta}`);
    console.log('    POST /extrair   {"url": "...", "formato": "markdown"}');
    console.log('    POST /captura   {"url": "...", "paginaInteira": true}');
    console.log('    POST /fluxo     {"passos": [...]}');
    console.log('    GET  /saude\n');
    if (host !== '127.0.0.1') {
      console.log('  ATENÇÃO: fora de 127.0.0.1 este serviço vira um proxy aberto —');
      console.log('  qualquer um na rede pode pedir que ele busque qualquer URL.\n');
    }
  },
};

const [, , comando, ...resto] = process.argv;
if (!comando || ['ajuda', '--help', '-h'].includes(comando)) {
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
