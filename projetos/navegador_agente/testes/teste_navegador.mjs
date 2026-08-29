import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Sessao, BloqueadoPorRobots } from '../nucleo/navegador.mjs';
import { limparCache } from '../nucleo/robos.mjs';
import { paraMarkdown } from '../nucleo/extrair.mjs';
import { subirFixture } from './fixtures/servidor.mjs';

let servidor, base, sessao;
before(async () => {
  servidor = await subirFixture();
  base = `http://127.0.0.1:${servidor.address().port}`;
  limparCache();
  sessao = new Sessao();
});
after(async () => {
  await sessao?.fechar();
  servidor?.close();
});

test('extrai título, descrição e idioma', async () => {
  const d = await sessao.extrair(`${base}/`);
  assert.equal(d.titulo, 'Loja de Teste');
  assert.equal(d.descricao, 'Uma loja que só existe no teste.');
  assert.equal(d.idioma, 'pt-BR');
});

test('o texto extraído deixa menu, rodapé e script de fora', async () => {
  const d = await sessao.extrair(`${base}/`);
  assert.match(d.texto, /trinta caracteres/);
  assert.doesNotMatch(d.texto, /Menu um/, 'menu não é conteúdo');
  assert.doesNotMatch(d.texto, /Rodapé/, 'rodapé não é conteúdo');
  assert.doesNotMatch(d.texto, /var x = 1/, 'script não é conteúdo');
});

test('links viram absolutos e sem repetição', async () => {
  const d = await sessao.extrair(`${base}/`);
  assert.ok(d.links.every((l) => l.url.startsWith('http')), 'todo link absoluto');
  assert.equal(new Set(d.links.map((l) => l.url)).size, d.links.length);
});

test('dado estruturado JSON-LD é devolvido pronto', async () => {
  const d = await sessao.extrair(`${base}/`);
  assert.equal(d.dadosEstruturados[0].name, 'Loja de Teste');
});

test('respeita o robots.txt e diz qual regra bloqueou', async () => {
  await assert.rejects(
    () => sessao.extrair(`${base}/privado/segredo.html`),
    (e) => e instanceof BloqueadoPorRobots && e.regra === '/privado/',
  );
});

test('--ignorar-robots é uma decisão explícita, não o padrão', async () => {
  const solta = new Sessao({ ignorarRobots: true });
  try {
    const d = await solta.extrair(`${base}/privado/segredo.html`);
    assert.equal(d.titulo, 'Privado');
  } finally {
    await solta.fechar();
  }
});

test('espera o seletor de conteúdo montado por JS', async () => {
  // Sem espera, a extração pega a página vazia — é o erro nº 1 de raspagem
  // em site moderno.
  const d = await sessao.extrair(`${base}/tardio`, { seletor: '.pronto', esperarMs: 0 });
  assert.match(d.texto + JSON.stringify(d.titulos), /carregou depois/);
});

test('captura devolve um PNG de verdade', async () => {
  const png = await sessao.capturar(`${base}/`);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'assinatura PNG');
});

test('fluxo digita, clica e lê o resultado', async () => {
  const saida = await sessao.fluxo([
    { ir: `${base}/formulario` },
    { digitar: { seletor: '#busca', texto: 'guarda-chuva' } },
    { clicar: '#enviar' },
    { ler: '#resultado' },
  ]);
  assert.equal(saida.at(-1).valor[0], 'buscou: guarda-chuva');
});

test('passo que não acha o seletor falha dizendo qual', async () => {
  await assert.rejects(
    () => sessao.fluxo([{ ir: `${base}/formulario` }, { clicar: '#nao-existe' }]),
    /#nao-existe/,
  );
});

test('markdown sai legível para um agente', async () => {
  const md = paraMarkdown(await sessao.extrair(`${base}/`));
  assert.match(md, /^# Loja de Teste/);
  assert.match(md, /## Links/);
});
