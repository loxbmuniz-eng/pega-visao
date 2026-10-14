#!/usr/bin/env node
/*
 * Abre monitor.html num Chromium real com a Binance SIMULADA (histórico REST e
 * WebSocket falsos, nenhum acesso à rede) e prova, de ponta a ponta:
 *   - o histórico carrega e a matriz mostra os 5 períodos;
 *   - a conexão fica "ao vivo";
 *   - um candle que fecha ao vivo com confluência dispara UM alerta de confluência, no lado certo;
 *   - o mesmo candle repetido não duplica o alerta;
 *   - com "só compra" (ou "só venda") ligado, o lado oposto não alerta e aparece filtrado;
 *   - nenhum erro de JavaScript na página.
 *
 * Rodar:  node testes/test_monitor_navegador.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function carregarPlaywright() {
  for (const p of ["playwright-core", "playwright", "/opt/node-tools/node_modules/playwright-core"]) {
    try { return require(p); } catch (e) { /* tenta o próximo */ }
  }
  return null;
}

const RAIZ = path.resolve(__dirname, "..");
const HTML = path.join(RAIZ, "monitor.html");
const SAIDA = process.argv[2] || null; // caminho opcional para salvar a captura de tela

// --- mesmo motor que a página usa, lido do próprio monitor.html ---
const fonte = fs.readFileSync(HTML, "utf8");
const bloco = fonte.match(/<script id="motor-confluencia">([\s\S]*?)<\/script>/);
if (!bloco) { console.error("motor não encontrado no monitor.html"); process.exit(1); }
const caixa = { module: { exports: {} } };
vm.runInNewContext(bloco[1], caixa);
const Motor = caixa.module.exports;

// --- série sintética com tendência, semente fixa ---
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const r = mulberry32(42);
const N = 900, c = { abertura: [], maxima: [], minima: [], fechamento: [], volume: [] };
let px = 60000, drift = 0;
for (let i = 0; i < N; i++) {
  drift = 0.97 * drift + gauss(r) * 0.00012;
  const nxt = px * (1 + drift + gauss(r) * 0.0008);
  c.abertura.push(px); c.maxima.push(Math.max(px, nxt) * (1 + Math.abs(gauss(r)) * 0.0004));
  c.minima.push(Math.min(px, nxt) * (1 - Math.abs(gauss(r)) * 0.0004)); c.fechamento.push(nxt);
  c.volume.push(Math.abs(100 + gauss(r) * 30) + 1); px = nxt;
}
const sinais = Motor.confluencia(c, { minimo: 4 });
let k = -1;
for (let i = 400; i < N; i++) if (sinais[i] !== 0) { k = i; break; }
if (k < 0) { console.error("série sem sinal para testar"); process.exit(1); }
const ladoEsperado = sinais[k] > 0 ? "COMPRA" : "VENDA";

const MS = { "15m": 9e5, "1h": 36e5, "4h": 144e5, "12h": 432e5, "1d": 864e5 };
const agora = Date.now();
function base(tf) { return agora - (N + 5) * MS[tf]; }
function historico(tf) {
  const b = base(tf), out = [];
  for (let i = 0; i < k; i++) {
    const t = b + i * MS[tf];
    out.push([t, String(c.abertura[i]), String(c.maxima[i]), String(c.minima[i]), String(c.fechamento[i]), String(c.volume[i]), t + MS[tf] - 1, "0", 0, "0", "0", "0"]);
  }
  return out;
}
function velaAoVivo(tf) {
  const t = base(tf) + k * MS[tf];
  return JSON.stringify({ stream: "btcusdt@kline_" + tf, data: { e: "kline", k: {
    t: t, T: t + MS[tf] - 1, s: "BTCUSDT", i: tf, o: String(c.abertura[k]), h: String(c.maxima[k]),
    l: String(c.minima[k]), c: String(c.fechamento[k]), v: String(c.volume[k]), x: true } } });
}

(async () => {
  const pw = carregarPlaywright();
  if (!pw) { console.log("PULADO: playwright não instalado"); process.exit(0); }
  let browser;
  try { browser = await pw.chromium.launch(); }
  catch (e) { browser = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium" }); }

  const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });
  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });

  let pedidosRest = 0, wsRota = null;
  // fonte servida vazia (não bloqueada): bloquear gera erro de carregamento que não é do monitor
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (rt) => rt.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route(/\/api\/v3\/klines/, (rt) => {
    pedidosRest++;
    const tf = new URL(rt.request().url()).searchParams.get("interval");
    rt.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(historico(tf)) });
  });
  await page.routeWebSocket(/binance/, (ws) => { wsRota = ws; });

  const falhas = [];
  const checar = (ok, msg) => { console.log((ok ? "  ok    " : "  FALHA ") + msg); if (!ok) falhas.push(msg); };

  await page.goto("file://" + HTML);
  await page.waitForFunction(() => document.getElementById("conexao").textContent === "ao vivo", null, { timeout: 15000 }).catch(() => {});
  checar((await page.textContent("#conexao")) === "ao vivo", "conexão fica 'ao vivo' com o WebSocket simulado");
  checar(pedidosRest >= 5, `histórico pedido para os 5 períodos (${pedidosRest} pedidos)`);
  const linhas = await page.$$eval("#matriz tr", (trs) => trs.map((t) => t.textContent));
  checar(linhas.length === 5 && linhas.every((t) => /\/5/.test(t)), "matriz mostra votos nos 5 períodos");
  checar((await page.textContent("#contagem")) === "0", "histórico não gera alerta (alerta é só fechamento ao vivo)");

  const textos = () => page.$$eval("#log li", (lis) => lis.map((l) => l.textContent));
  wsRota.send(velaAoVivo("15m"));
  await page.waitForFunction(() => document.querySelectorAll("#log li:not(.vazio)").length > 0, null, { timeout: 5000 }).catch(() => {});
  const alertas = (await textos()).filter((t) => t.includes("confluência"));
  checar(alertas.length === 1, `candle fechado com confluência gera 1 alerta de confluência (${alertas.length})`);
  const alerta = alertas[0] || "";
  checar(alerta.startsWith(ladoEsperado), `alerta no lado certo: esperado ${ladoEsperado}, veio "${alerta.slice(0, 50)}"`);
  checar(/stop .* alvo .* liquidação/.test(alerta), "alerta traz stop, alvo e liquidação");
  checar((await page.textContent("#preco")) !== "—", "preço ao vivo atualiza pelo stream de 15 min");
  const total = await page.textContent("#contagem");

  wsRota.send(velaAoVivo("15m"));
  await page.waitForTimeout(400);
  checar((await page.textContent("#contagem")) === total, "o mesmo candle repetido não duplica nenhum alerta");
  const padroes = await page.$$eval("#padroes tr", (trs) => trs.length);
  checar(padroes === 5, "tabela de padrões mostra os 5 períodos");

  await page.fill("#alav", "100");
  await page.dispatchEvent("#alav", "input");
  checar((await page.textContent("#risco")).includes("O stop não executa"), "a 100x o painel avisa que o stop não executa");

  // filtro de lado: recarrega com o lado oposto ligado e fecha o mesmo candle de novo
  const oposto = ladoEsperado === "VENDA" ? "compra" : "venda";
  await page.selectOption("#lado", oposto);
  await page.reload();
  await page.waitForFunction(() => document.getElementById("conexao").textContent === "ao vivo", null, { timeout: 15000 }).catch(() => {});
  checar((await page.inputValue("#lado")) === oposto, `preferência 'só ${oposto}' sobrevive ao recarregar`);
  wsRota.send(velaAoVivo("15m"));
  await page.waitForTimeout(800);
  checar(!(await textos()).some((t) => t.includes("confluência")), `com 'só ${oposto}', a ${ladoEsperado} da confluência não alerta`);
  checar((await page.textContent("#matriz tr:first-child")).includes("filtrada"), "a matriz mostra a confluência como filtrada");

  checar(erros.length === 0, "nenhum erro de JavaScript" + (erros.length ? ": " + erros.join(" | ").slice(0, 300) : ""));
  if (SAIDA) await page.screenshot({ path: SAIDA, fullPage: true });
  await browser.close();

  console.log(falhas.length ? `\nREPROVADO: ${falhas.length} falha(s)` : "\nAPROVADO: monitor carrega, calcula e alerta");
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
