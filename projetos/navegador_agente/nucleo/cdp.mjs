// Cliente CDP mínimo — lança o Chromium e fala com ele por JSON-RPC.
//
// POR QUE sem biblioteca: o Node 22 já traz WebSocket nativo. Puppeteer e
// Playwright trariam ~300 MB e uma versão de navegador para gerenciar, e o
// que este projeto precisa do Chrome cabe em cinco métodos do CDP.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CANDIDATOS = [
  process.env.CHROMIUM_BIN,
  process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'),
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export function acharChromium() {
  for (const c of CANDIDATOS) {
    if (c && existsSync(c)) return c;
  }
  for (const nome of ['chromium', 'chromium-browser', 'google-chrome', 'chrome']) {
    try {
      const achado = execFileSync('which', [nome], { encoding: 'utf8' }).trim();
      if (achado) return achado;
    } catch { /* segue tentando */ }
  }
  throw new Error(
    'Chromium não encontrado. Instale um Chrome/Chromium ou aponte CHROMIUM_BIN=/caminho/do/chrome'
  );
}

export class Navegador {
  constructor(processo, ws, perfil) {
    this.processo = processo;
    this.ws = ws;
    this.perfil = perfil;
    this.proximoId = 1;
    this.pendentes = new Map();
    this.ouvintes = new Map();
    ws.addEventListener('message', (ev) => this.#receber(ev.data));
  }

  #receber(bruto) {
    const msg = JSON.parse(bruto);
    if (msg.id !== undefined) {
      const p = this.pendentes.get(msg.id);
      if (!p) return;
      this.pendentes.delete(msg.id);
      if (msg.error) p.rejeitar(new Error(`${msg.error.message} (${msg.method ?? ''})`));
      else p.resolver(msg.result);
      return;
    }
    const chave = msg.sessionId ? `${msg.sessionId}:${msg.method}` : msg.method;
    for (const cb of this.ouvintes.get(chave) ?? []) cb(msg.params);
  }

  enviar(metodo, params = {}, sessionId) {
    const id = this.proximoId++;
    const carta = { id, method: metodo, params };
    if (sessionId) carta.sessionId = sessionId;
    return new Promise((resolver, rejeitar) => {
      this.pendentes.set(id, { resolver, rejeitar });
      this.ws.send(JSON.stringify(carta));
    });
  }

  // Espera UM evento. Registrado antes da ação que o dispara, senão corre-se
  // o risco de o evento chegar primeiro e a espera nunca terminar.
  esperarEvento(metodo, sessionId, limiteMs = 30000) {
    const chave = sessionId ? `${sessionId}:${metodo}` : metodo;
    return new Promise((resolver, rejeitar) => {
      const lista = this.ouvintes.get(chave) ?? [];
      const cb = (params) => {
        clearTimeout(relogio);
        this.ouvintes.set(chave, (this.ouvintes.get(chave) ?? []).filter((x) => x !== cb));
        resolver(params);
      };
      const relogio = setTimeout(() => {
        this.ouvintes.set(chave, (this.ouvintes.get(chave) ?? []).filter((x) => x !== cb));
        rejeitar(new Error(`tempo esgotado esperando ${metodo}`));
      }, limiteMs);
      lista.push(cb);
      this.ouvintes.set(chave, lista);
    });
  }

  async fechar() {
    try { this.ws.close(); } catch { /* já caiu */ }
    try { this.processo.kill('SIGTERM'); } catch { /* já morreu */ }
    // Dá um instante para o Chromium soltar o perfil antes de apagar.
    await new Promise((r) => setTimeout(r, 120));
    if (this.perfil) await rm(this.perfil, { recursive: true, force: true }).catch(() => {});
  }
}

export async function abrirNavegador({ binario, argsExtra = [] } = {}) {
  const chrome = binario ?? acharChromium();
  const perfil = await mkdtemp(join(tmpdir(), 'navegador-perfil-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',          // 0 = o Chrome escolhe; evita colisão entre renders paralelos
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',                       // containers de CI rodam como root; sem isto o Chrome nem sobe
    '--disable-dev-shm-usage',            // /dev/shm pequeno em container derruba o Chrome no meio do render
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    ...argsExtra,
    'about:blank',
  ];
  const processo = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  const urlWs = await new Promise((resolver, rejeitar) => {
    let acumulado = '';
    const relogio = setTimeout(
      () => rejeitar(new Error(`Chromium não anunciou a porta em 30s. Saída:\n${acumulado.slice(-800)}`)),
      30000
    );
    processo.stderr.on('data', (pedaco) => {
      acumulado += pedaco.toString();
      const m = acumulado.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(relogio); resolver(m[1]); }
    });
    processo.on('exit', (codigo) => {
      clearTimeout(relogio);
      rejeitar(new Error(`Chromium saiu com código ${codigo} antes de abrir. Saída:\n${acumulado.slice(-800)}`));
    });
  });

  const ws = new WebSocket(urlWs);
  await new Promise((resolver, rejeitar) => {
    ws.addEventListener('open', resolver, { once: true });
    ws.addEventListener('error', () => rejeitar(new Error('falha ao conectar no CDP')), { once: true });
  });

  return new Navegador(processo, ws, perfil);
}
