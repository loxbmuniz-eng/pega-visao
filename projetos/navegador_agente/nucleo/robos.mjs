// robots.txt e limite de velocidade.
//
// POR QUE isto está no núcleo e não é opcional: um agente que navega rápido
// demais derruba site pequeno, queima o IP de quem o roda e transforma uma
// pesquisa legítima em incidente. Respeitar robots.txt e esperar entre
// requisições é o que separa "agente com navegador" de "raspador que causa
// problema". A trava fica aqui dentro para não depender de alguém lembrar.
import { setTimeout as esperar } from 'node:timers/promises';

const cacheRobos = new Map();     // host -> regras
const ultimoAcesso = new Map();   // host -> timestamp

export const AGENTE =
  'NavegadorAgente/0.1 (+agente de IA; respeita robots.txt; contato via operador)';

const INTERVALO_PADRAO = 1000;    // 1s entre requisições ao mesmo host

function analisarRobots(texto) {
  const grupos = [];
  let atual = null;
  for (const linhaBruta of texto.split('\n')) {
    const linha = linhaBruta.split('#')[0].trim();
    if (!linha) continue;
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const chave = linha.slice(0, i).trim().toLowerCase();
    const valor = linha.slice(i + 1).trim();

    if (chave === 'user-agent') {
      // Linhas de User-agent seguidas formam UM grupo.
      if (!atual || atual.regras.length || atual.atraso !== null) {
        atual = { agentes: [], regras: [], atraso: null };
        grupos.push(atual);
      }
      atual.agentes.push(valor.toLowerCase());
    } else if (atual && (chave === 'allow' || chave === 'disallow')) {
      atual.regras.push({ permite: chave === 'allow', caminho: valor });
    } else if (atual && chave === 'crawl-delay') {
      const n = Number(valor);
      if (Number.isFinite(n)) atual.atraso = n * 1000;
    }
  }
  return grupos;
}

function grupoAplicavel(grupos, agente) {
  const nosso = agente.toLowerCase();
  // Grupo específico ganha do curinga, como manda o padrão.
  return grupos.find((g) => g.agentes.some((a) => a !== '*' && nosso.includes(a)))
      ?? grupos.find((g) => g.agentes.includes('*'))
      ?? null;
}

function combina(caminho, padrao) {
  if (padrao === '') return false;              // Disallow vazio = permite tudo
  const fim = padrao.endsWith('$');
  const limpo = fim ? padrao.slice(0, -1) : padrao;
  const partes = limpo.split('*');
  let pos = 0;
  for (const [i, parte] of partes.entries()) {
    if (parte === '') continue;
    const achado = caminho.indexOf(parte, pos);
    if (achado < 0) return false;
    if (i === 0 && achado !== 0) return false;  // o primeiro pedaço ancora no início
    pos = achado + parte.length;
  }
  return fim ? pos === caminho.length : true;
}

export async function regrasDe(url, { buscar = fetch } = {}) {
  const alvo = new URL(url);
  const host = alvo.origin;
  if (cacheRobos.has(host)) return cacheRobos.get(host);

  let grupos = [];
  try {
    const r = await buscar(`${host}/robots.txt`, {
      headers: { 'user-agent': AGENTE },
      signal: AbortSignal.timeout(8000),
    });
    // 4xx = sem robots.txt = liberado. É o que o padrão diz e o que os
    // buscadores fazem. 5xx é outra história: servidor com problema não
    // autoriza nada — melhor não insistir.
    if (r.ok) grupos = analisarRobots(await r.text());
    else if (r.status >= 500) grupos = [{ agentes: ['*'], regras: [{ permite: false, caminho: '/' }], atraso: null }];
  } catch {
    grupos = [];       // sem rede para o robots.txt: segue, mas devagar
  }
  cacheRobos.set(host, grupos);
  return grupos;
}

export async function podeVisitar(url, opcoes = {}) {
  const grupos = await regrasDe(url, opcoes);
  const grupo = grupoAplicavel(grupos, opcoes.agente ?? AGENTE);
  if (!grupo) return { permitido: true, atraso: INTERVALO_PADRAO };

  const caminho = new URL(url).pathname + new URL(url).search;
  let melhor = null;
  for (const regra of grupo.regras) {
    if (!combina(caminho, regra.caminho)) continue;
    // Regra mais específica (mais longa) ganha; empate vai para Allow.
    if (!melhor || regra.caminho.length > melhor.caminho.length
        || (regra.caminho.length === melhor.caminho.length && regra.permite)) {
      melhor = regra;
    }
  }
  return {
    permitido: melhor ? melhor.permite : true,
    atraso: grupo.atraso ?? INTERVALO_PADRAO,
    regra: melhor?.caminho ?? null,
  };
}

// Espera o que falta para respeitar o intervalo daquele host.
export async function aguardarVez(url, atraso = INTERVALO_PADRAO) {
  const host = new URL(url).origin;
  const anterior = ultimoAcesso.get(host) ?? 0;
  const falta = anterior + atraso - Date.now();
  if (falta > 0) await esperar(falta);
  ultimoAcesso.set(host, Date.now());
}

export function limparCache() {
  cacheRobos.clear();
  ultimoAcesso.clear();
}
