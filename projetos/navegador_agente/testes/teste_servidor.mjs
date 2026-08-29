import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Sessao } from '../nucleo/navegador.mjs';
import { limparCache } from '../nucleo/robos.mjs';
import { subir } from '../nucleo/servidor.mjs';
import { subirFixture } from './fixtures/servidor.mjs';

let alvo, api, sessao, base, urlApi;
before(async () => {
  alvo = await subirFixture();
  base = `http://127.0.0.1:${alvo.address().port}`;
  limparCache();
  sessao = new Sessao();
  api = await subir({ porta: 0, sessao });
  urlApi = `http://127.0.0.1:${api.address().port}`;
});
after(async () => {
  api?.close();
  await sessao?.fechar();
  alvo?.close();
});

const post = (rota, corpo) =>
  fetch(`${urlApi}${rota}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });

test('/saude responde', async () => {
  const r = await fetch(`${urlApi}/saude`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('/extrair devolve o conteúdo em JSON', async () => {
  const r = await post('/extrair', { url: `${base}/` });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).titulo, 'Loja de Teste');
});

test('/extrair em markdown devolve markdown, não JSON', async () => {
  const r = await post('/extrair', { url: `${base}/`, formato: 'markdown' });
  assert.match(r.headers.get('content-type'), /markdown/);
  assert.match(await r.text(), /^# Loja de Teste/);
});

test('/captura devolve image/png', async () => {
  const r = await post('/captura', { url: `${base}/` });
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.ok((await r.arrayBuffer()).byteLength > 1000);
});

test('/fluxo executa os passos', async () => {
  const r = await post('/fluxo', {
    passos: [
      { ir: `${base}/formulario` },
      { digitar: { seletor: '#busca', texto: 'lanterna' } },
      { clicar: '#enviar' },
      { ler: '#resultado' },
    ],
  });
  const { passos } = await r.json();
  assert.equal(passos.at(-1).valor[0], 'buscou: lanterna');
});

test('bloqueio do robots.txt vira 403, não 500', async () => {
  // A diferença importa: um agente que trata os dois igual fica tentando de
  // novo contra um site que já disse não.
  const r = await post('/extrair', { url: `${base}/privado/segredo.html` });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).tipo, 'BloqueadoPorRobots');
});

test('pedido sem url é 400 com explicação', async () => {
  const r = await post('/extrair', {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /url/);
});

test('rota desconhecida é 404', async () => {
  assert.equal((await post('/inventada', {})).status, 404);
});

test('GET nos endpoints de trabalho é 405', async () => {
  assert.equal((await fetch(`${urlApi}/extrair`)).status, 405);
});
