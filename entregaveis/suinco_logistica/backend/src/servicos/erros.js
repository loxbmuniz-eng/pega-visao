/* O ERRO CHEGA SOZINHO — e sem dado de cliente (08/10/2026, decisão 27).
   =====================================================================
   Pedido do dono ("Use Sentry for this"). Até aqui, erro de tela só era
   conhecido quando alguém mandava foto; erro de servidor, quando alguém
   abria o journal. Agora os dois vão para o Sentry (organização `suinco`,
   projetos `suinco-painel` e `suinco-servidor`, plano grátis).

   SEM BIBLIOTECA DO SENTRY, NEM AQUI NEM NO PAINEL (emenda da decisão 27).
   O envio é um POST de texto no formato "envelope" do próprio Sentry. Uma
   dependência a menos no `npm ci` do servidor, e — o que pesa mais — o que
   sai daqui é montado campo a campo, por LISTA BRANCA: só vai o que está
   escrito em montarEvento(). O SDK oficial faz o contrário (manda tudo e
   tenta apagar o proibido no beforeSend); um campo novo dele seria um
   vazamento novo nosso.

   O QUE VAI: tipo e mensagem do erro, a pilha (arquivo, função, linha),
   origem (painel ou servidor), versão, ambiente, setor e a tela ou a rota
   — a rota como MOLDE (`/api/cargas/:id`), nunca com o número.
   O QUE NUNCA VAI: corpo da requisição, parâmetros da URL, cookie, token,
   IP, nome de pessoa, telefone, CPF, nome de cliente, nota fiscal. Na
   mensagem, limparTexto() troca e-mail, token, CPF, CNPJ, telefone,
   qualquer número de 5 dígitos ou mais (carga, nota, documento) e o valor
   citado depois de dois-pontos ("valor inválido: \"Fulano\"").

   SÓ LIGA COM `SENTRY_DSN` no .env. Sem a variável, nada sai daqui — o
   servidor com este código e sem a chave se comporta como o antigo, e o
   erro do painel continua indo para o journal (`[erro do painel]`).

   NÃO VIRA BARULHO NEM CONTA: o mesmo erro (mesma origem, mensagem e
   primeiro ponto da pilha) sai uma vez por hora; no total, no máximo 20
   envios a cada 10 minutos. O plano grátis do Sentry tem cota mensal — um
   laço de erro numa tela aberta o dia todo não pode gastá-la numa tarde. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MENSAGEM_MAX = 300;
const PILHA_MAX = 4000;
const QUADROS_MAX = 30;
export const MESMO_ERRO_A_CADA_MS = 60 * 60 * 1000;
export const JANELA_MS = 10 * 60 * 1000;
export const ENVIOS_POR_JANELA = 20;
const ESPERA_DO_SENTRY_MS = 5000;

/* O DSN tem a forma https://<chave>@<host>[/<caminho>]/<projeto>.
   Devolve o endereço de entrega e a chave, ou null se não houver DSN ou se
   ele não tiver essa forma — DSN torto desliga o envio em vez de derrubar
   o servidor (um pátio não para por causa de um aviso de erro). */
export function lerDsn(dsn) {
  const texto = String(dsn || '').trim();
  if (!texto) return null;
  try {
    const u = new URL(texto);
    const partes = u.pathname.split('/').filter(Boolean);
    const projeto = partes.pop();
    if (!u.username || !projeto || !/^\d+$/.test(projeto)) return null;
    const prefixo = partes.length ? '/' + partes.join('/') : '';
    return {
      envio: `${u.protocol}//${u.host}${prefixo}/api/${projeto}/envelope/`,
      chave: decodeURIComponent(u.username),
    };
  } catch {
    return null;
  }
}

/* A mensagem pode carregar o que a pessoa digitou. Troca o que identifica
   alguém (ou um documento) por um rótulo, antes de sair do servidor. */
export function limparTexto(texto, max = MENSAGEM_MAX) {
  return String(texto ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [token]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '[cnpj]')
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '[cpf]')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}-\d{4}\b/g, '[telefone]')
    .replace(/\d{5,}/g, '[número]')
    // O valor citado depois de dois-pontos é dado, não código:
    // `invalid input syntax for type integer: "João"`.
    .replace(/:\s*"[^"]*"/g, ': "[valor]"')
    .replace(/:\s*'[^']*'/g, ": '[valor]'")
    // Trecho do texto que não era JSON: `"Fulano de T"... is not valid JSON`.
    .replace(/"[^"]*"\.\.\./g, '"[trecho]"...')
    .slice(0, max);
}

/* Endereço de arquivo na pilha: sem `?parâmetros` nem `#âncora` — é onde
   um token ou um número de carga poderia estar pendurado. */
function semParametros(arquivo) {
  return String(arquivo || '').replace(/[?#].*$/, '');
}

/* A pilha em quadros, do mais antigo para o mais novo (a ordem que o Sentry
   espera). Lê o formato do Chrome e do Node (`at f (arq:1:2)`) e o do
   Safari e do Firefox (`f@arq:1:2`). Linha que não se lê não entra. */
export function quadrosDaPilha(pilha) {
  const quadros = [];
  for (const linha of String(pilha || '').slice(0, PILHA_MAX).split('\n')) {
    const l = linha.trim();
    let m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l);
    if (!m) m = /^(.*?)@(.+?):(\d+):(\d+)$/.exec(l);
    if (!m) continue;
    const arquivo = limparTexto(semParametros(m[2]), 200);
    quadros.push({
      function: limparTexto(m[1] || '?', 120),
      filename: arquivo,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|node:internal|^node:/.test(arquivo),
    });
    if (quadros.length >= QUADROS_MAX) break;
  }
  return quadros.reverse();
}

/* "07/10 20:37 · 9b690af" → "9b690af": o commit é a versão que o Sentry
   agrupa; a data é só para gente ler. */
export function versaoCurta(texto) {
  const t = String(texto || '').trim();
  const m = /·\s*([0-9a-f]{7,40})\s*$/.exec(t);
  return m ? m[1] : (t ? limparTexto(t, 40) : 'desconhecida');
}

/* O evento, campo a campo. NADA além disto sai do servidor. */
export function montarEvento({ origem, tipo, mensagem, pilha, onde, setor, versao, ambiente }) {
  const daTela = origem === 'painel';
  const quadros = quadrosDaPilha(pilha);
  const valor = limparTexto(mensagem) || '(sem mensagem)';
  const tags = { origem: daTela ? 'painel' : 'servidor' };
  if (setor) tags.setor = limparTexto(setor, 40);
  if (onde) tags[daTela ? 'tela' : 'rota'] = limparTexto(onde, 120);
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: daTela ? 'javascript' : 'node',
    level: 'error',
    logger: daTela ? 'painel' : 'servidor',
    release: versaoCurta(versao),
    environment: limparTexto(ambiente || 'production', 30),
    tags,
    exception: {
      values: [{
        type: limparTexto(tipo || 'Error', 60),
        value: valor,
        ...(quadros.length ? { stacktrace: { frames: quadros } } : {}),
      }],
    },
  };
}

/* O formato que o Sentry recebe: três linhas de JSON — cabeçalho do
   envelope, cabeçalho do item, o evento. */
export function envelope(evento) {
  return JSON.stringify({ event_id: evento.event_id, sent_at: new Date().toISOString() }) + '\n'
    + JSON.stringify({ type: 'event' }) + '\n'
    + JSON.stringify(evento) + '\n';
}

/* ------------------------------------------------------------------ */
/* Controle de volume: um envio por erro por hora, 20 por 10 minutos.  */
const _vistos = new Map();       // impressão digital → quando saiu
let _janela = { inicio: 0, envios: 0 };

export function _zerarParaTeste() {
  _vistos.clear();
  _janela = { inicio: 0, envios: 0 };
}

function impressaoDigital(evento) {
  const ex = evento.exception.values[0];
  const q = (ex.stacktrace && ex.stacktrace.frames) || [];
  const ultimo = q[q.length - 1];
  return [evento.logger, ex.type, ex.value, ultimo ? `${ultimo.filename}:${ultimo.lineno}` : ''].join('|');
}

/* Devolve o motivo de NÃO enviar, ou null se pode. Conta o envio. */
function freio(evento, agora) {
  for (const [k, em] of _vistos) if (agora - em >= MESMO_ERRO_A_CADA_MS) _vistos.delete(k);
  const marca = impressaoDigital(evento);
  if (_vistos.has(marca)) return 'repetido';
  if (agora - _janela.inicio >= JANELA_MS) _janela = { inicio: agora, envios: 0 };
  if (_janela.envios >= ENVIOS_POR_JANELA) return 'teto';
  _janela.envios += 1;
  _vistos.set(marca, agora);
  return null;
}

/* Cada origem no seu projeto do Sentry: o erro da tela em `suinco-painel`
   (SENTRY_DSN_PAINEL), o do servidor em `suinco-servidor` (SENTRY_DSN). Sem
   a do painel, os dois vão para o do servidor, separados pela etiqueta
   `origem`. Lido a cada envio, não na subida: a bateria liga e desliga o
   envio trocando a variável, sem subir outro servidor. */
function dsnDe(origem) {
  return (origem === 'painel' && process.env.SENTRY_DSN_PAINEL) || process.env.SENTRY_DSN;
}

export function avisoLigado(origem = 'servidor') {
  return !!lerDsn(dsnDe(origem));
}

/* Manda um erro ao Sentry. NUNCA lança e nunca segura quem chamou por mais
   de 5 s: devolve { enviado, motivo }. `enviar` é trocável no teste. */
export async function avisarErro(dados, { enviar = fetch, agora = Date.now() } = {}) {
  try {
    const destino = lerDsn(dsnDe(dados && dados.origem));
    if (!destino) return { enviado: false, motivo: 'desligado' };
    const evento = montarEvento({ ambiente: process.env.NODE_ENV, ...dados });
    const motivo = freio(evento, agora);
    if (motivo) return { enviado: false, motivo };
    const r = await enviar(destino.envio, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${destino.chave}, sentry_client=suinco/1.0`,
      },
      body: envelope(evento),
      signal: AbortSignal.timeout(ESPERA_DO_SENTRY_MS),
    });
    if (!r.ok) {
      console.warn('[sentry] recusou o envio:', r.status);
      return { enviado: false, motivo: `recusado ${r.status}` };
    }
    return { enviado: true, motivo: null, id: evento.event_id };
  } catch (e) {
    console.warn('[sentry] não consegui enviar:', e.message);
    return { enviado: false, motivo: 'falha' };
  }
}

/* ------------------------------------------------------------------ */
/* QUEDA DO SERVIDOR. Quando o processo morre de erro não tratado, não dá
   tempo de mandar nada pela rede: o Node sai logo depois. Então o erro é
   GRAVADO no disco, na hora, e enviado na próxima subida — o systemd sobe
   o serviço de novo em 5 s. Sem SENTRY_DSN, não grava nada. */
const DAQUI = path.dirname(fileURLToPath(import.meta.url));
export const ARQUIVO_DA_QUEDA = path.resolve(DAQUI, '..', '..', 'erro_da_ultima_queda.json');

export function gravarQueda(err, origem, { arquivo = ARQUIVO_DA_QUEDA, versao } = {}) {
  try {
    if (!avisoLigado()) return false;
    fs.writeFileSync(arquivo, JSON.stringify({
      origem: 'servidor',
      tipo: err?.name || 'Error',
      mensagem: limparTexto(`${origem === 'unhandledRejection' ? 'Promessa sem tratamento' : 'Queda do servidor'}: ${err?.message || err}`),
      // Só as linhas de código: a primeira linha da pilha do Node repete a
      // mensagem crua, e este arquivo não pode guardar o que a limpeza tirou.
      pilha: String(err?.stack || '').split('\n').filter((l) => /^\s*at /.test(l)).join('\n').slice(0, PILHA_MAX),
      onde: 'queda do processo',
      versao,
      em: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;   // disco cheio ou sem permissão: a queda segue como sempre
  }
}

export async function enviarQuedaPendente({ arquivo = ARQUIVO_DA_QUEDA, enviar = fetch } = {}) {
  let dados;
  try {
    dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return { enviado: false, motivo: 'nada pendente' };
  }
  const r = await avisarErro(dados, { enviar });
  // Enviado, repetido ou desligado: o arquivo sai. Só fica se a rede falhou,
  // para tentar de novo na próxima subida.
  if (r.motivo !== 'falha' && !String(r.motivo || '').startsWith('recusado')) {
    try { fs.unlinkSync(arquivo); } catch { /* já não existe */ }
  }
  return r;
}

/* Liga a gravação da queda. `uncaughtExceptionMonitor` OBSERVA sem mudar
   nada: o processo continua caindo como antes (e o systemd sobe de novo).
   Um `uncaughtException` comum faria o contrário — seguraria de pé um
   processo em estado desconhecido. Pega também a promessa sem tratamento,
   que no Node 24 derruba o processo pelo mesmo caminho. */
export function ligarRegistroDeQueda(versao, arquivo = ARQUIVO_DA_QUEDA) {
  process.on('uncaughtExceptionMonitor', (err, origem) => gravarQueda(err, origem, { versao, arquivo }));
}
