import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { podeVisitar, limparCache, AGENTE } from '../nucleo/robos.mjs';
import { subirFixture } from './fixtures/servidor.mjs';

let servidor, base;
before(async () => {
  servidor = await subirFixture();
  base = `http://127.0.0.1:${servidor.address().port}`;
  limparCache();
});
after(() => servidor?.close());

test('caminho liberado é permitido', async () => {
  assert.equal((await podeVisitar(`${base}/`)).permitido, true);
});

test('Disallow bloqueia o prefixo', async () => {
  const r = await podeVisitar(`${base}/privado/segredo.html`);
  assert.equal(r.permitido, false);
  assert.equal(r.regra, '/privado/');
});

test('Allow mais específico vence o Disallow', async () => {
  assert.equal((await podeVisitar(`${base}/privado/liberado.html`)).permitido, true);
});

test('curinga com âncora de fim é respeitado', async () => {
  assert.equal((await podeVisitar(`${base}/manual.pdf`)).permitido, false);
  assert.equal((await podeVisitar(`${base}/manual.pdf.html`)).permitido, true);
});

test('Crawl-delay do site manda no intervalo', async () => {
  assert.equal((await podeVisitar(`${base}/`)).atraso, 0);
});

test('sem robots.txt o site é considerado liberado', async () => {
  limparCache();
  const semRobots = await subirFixture();
  const url = `http://127.0.0.1:${semRobots.address().port}/`;
  // Este fixture serve robots.txt; simulamos ausência com um 404 forçado.
  semRobots.close();
  const r = await podeVisitar('http://127.0.0.1:1/', {
    buscar: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(r.permitido, true);
});

test('robots.txt com erro 5xx é tratado como "não insista"', async () => {
  limparCache();
  const r = await podeVisitar('http://127.0.0.1:2/x', {
    buscar: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(r.permitido, false);
});

test('o agente se identifica', () => {
  assert.match(AGENTE, /NavegadorAgente/);
  assert.match(AGENTE, /robots\.txt/);
});
