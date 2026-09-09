// Servidor HTTP: é assim que um agente usa o navegador sem saber CDP.
//
// Escuta só em 127.0.0.1 por padrão. Um serviço que abre qualquer URL e
// devolve o conteúdo é um proxy: exposto na rede, vira porta de entrada para
// alcançar o que estiver atrás do firewall de quem o roda.
import { createServer } from 'node:http';
import { Sessao } from './navegador.mjs';
import { paraMarkdown } from './extrair.mjs';
import { BloqueadoPorRobots } from './navegador.mjs';

const LIMITE_CORPO = 256 * 1024;

async function lerCorpo(req) {
  const pedacos = [];
  let tamanho = 0;
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > LIMITE_CORPO) throw new Error('corpo grande demais');
    pedacos.push(p);
  }
  if (!pedacos.length) return {};
  try {
    return JSON.parse(Buffer.concat(pedacos).toString('utf8'));
  } catch {
    throw new Error('corpo não é JSON válido');
  }
}

function responder(res, codigo, corpo, tipo = 'application/json; charset=utf-8') {
  const dados = tipo.startsWith('application/json') ? JSON.stringify(corpo, null, 2) : corpo;
  res.writeHead(codigo, { 'content-type': tipo });
  res.end(dados);
}

export function criarServidor({ sessao = new Sessao(), fila = new Map() } = {}) {
  return createServer(async (req, res) => {
    const rota = new URL(req.url, 'http://interno').pathname;

    if (req.method === 'GET' && rota === '/saude') {
      return responder(res, 200, { ok: true, navegadorAberto: Boolean(sessao.navegador) });
    }
    if (req.method !== 'POST') {
      return responder(res, 405, { erro: 'use POST em /extrair, /captura ou /fluxo' });
    }

    try {
      const corpo = await lerCorpo(req);

      if (rota === '/extrair') {
        if (!corpo.url) return responder(res, 400, { erro: 'faltou "url"' });
        const dado = await sessao.extrair(corpo.url, {
          esperarMs: corpo.esperarMs, seletor: corpo.seletor,
        });
        return corpo.formato === 'markdown'
          ? responder(res, 200, paraMarkdown(dado), 'text/markdown; charset=utf-8')
          : responder(res, 200, dado);
      }

      if (rota === '/captura') {
        if (!corpo.url) return responder(res, 400, { erro: 'faltou "url"' });
        const png = await sessao.capturar(corpo.url, { paginaInteira: corpo.paginaInteira });
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(png);
      }

      if (rota === '/fluxo') {
        if (!Array.isArray(corpo.passos)) return responder(res, 400, { erro: 'faltou "passos" (lista)' });
        return responder(res, 200, { passos: await sessao.fluxo(corpo.passos, { url: corpo.url }) });
      }

      return responder(res, 404, { erro: `rota desconhecida: ${rota}` });
    } catch (erro) {
      // 403 quando é o site que recusa, 500 quando o problema é nosso. A
      // diferença importa: um agente que trata os dois igual fica tentando
      // de novo contra um site que disse não.
      const codigo = erro instanceof BloqueadoPorRobots ? 403 : 500;
      return responder(res, codigo, { erro: erro.message, tipo: erro.nome ?? 'Erro' });
    }
  });
}

export function subir({ porta = 8787, host = '127.0.0.1', sessao } = {}) {
  const servidor = criarServidor({ sessao });
  return new Promise((resolver) => {
    servidor.listen(porta, host, () => resolver(servidor));
  });
}
