import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderizar } from '../motor/renderizar.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CENA = join(AQUI, 'fixtures', 'cena.html');

test('renderiza a cena inteira e monta o vídeo', async () => {
  const saida = await mkdtemp(join(tmpdir(), 'teste-render-'));
  try {
    const r = await renderizar({ cena: CENA, saida });
    assert.equal(r.total, 2, 'duracao 0.2s a 10fps = 2 quadros');
    assert.equal(r.largura, 200);
    const quadros = await readdir(r.quadros);
    assert.equal(quadros.length, 2);
    assert.ok(r.video, 'devia ter montado o vídeo');
    const bytes = await readFile(r.video);
    assert.ok(bytes.length > 200, 'vídeo vazio');
  } finally {
    await rm(saida, { recursive: true, force: true });
  }
});

// A promessa do estúdio: o quadro N é o quadro N em qualquer execução. Se
// este teste ficar vermelho, alguma coisa passou a depender do relógio real
// (setTimeout, requestAnimationFrame, transition do CSS) e o vídeo aprovado
// deixou de ser o vídeo entregue.
test('o mesmo quadro renderizado duas vezes sai idêntico', async () => {
  const a = await mkdtemp(join(tmpdir(), 'det-a-'));
  const b = await mkdtemp(join(tmpdir(), 'det-b-'));
  try {
    const r1 = await renderizar({ cena: CENA, saida: a, apenasQuadro: 1 });
    const r2 = await renderizar({ cena: CENA, saida: b, apenasQuadro: 1 });
    const n1 = (await readdir(r1.quadros))[0];
    const n2 = (await readdir(r2.quadros))[0];
    const [q1, q2] = await Promise.all([readFile(join(r1.quadros, n1)), readFile(join(r2.quadros, n2))]);
    assert.deepEqual(q1, q2, 'mesmo instante devia dar bytes idênticos');
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test('dados do lote chegam na cena', async () => {
  const s1 = await mkdtemp(join(tmpdir(), 'dados-1-'));
  const s2 = await mkdtemp(join(tmpdir(), 'dados-2-'));
  try {
    const r1 = await renderizar({ cena: CENA, saida: s1, apenasQuadro: 1, dados: { rotulo: 'AAAA' }, nome: 'x' });
    const r2 = await renderizar({ cena: CENA, saida: s2, apenasQuadro: 1, dados: { rotulo: 'BBBB' }, nome: 'x' });
    const [q1, q2] = await Promise.all([
      readFile(join(r1.quadros, (await readdir(r1.quadros))[0])),
      readFile(join(r2.quadros, (await readdir(r2.quadros))[0])),
    ]);
    assert.notDeepEqual(q1, q2, 'dados diferentes deviam produzir quadros diferentes');
  } finally {
    await rm(s1, { recursive: true, force: true });
    await rm(s2, { recursive: true, force: true });
  }
});

test('cena sem window.cena falha dizendo o contrato', async () => {
  const saida = await mkdtemp(join(tmpdir(), 'ruim-'));
  const vazia = join(saida, 'vazia.html');
  await (await import('node:fs/promises')).writeFile(vazia, '<!doctype html><p>nada</p>');
  try {
    await assert.rejects(() => renderizar({ cena: vazia, saida }), /window\.cena/);
  } finally {
    await rm(saida, { recursive: true, force: true });
  }
});
