import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerCsv } from '../motor/csv.mjs';

test('vírgula dentro de aspas não desloca as colunas', () => {
  const linhas = lerCsv('nome,titulo\npadaria,"Pão, café e bolo"');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].titulo, 'Pão, café e bolo');
});

test('detecta ponto e vírgula (padrão do Excel em português)', () => {
  const linhas = lerCsv('nome;cta\nzé;Compre já');
  assert.equal(linhas[0].cta, 'Compre já');
});

test('aspas duplicadas viram uma aspa só', () => {
  const linhas = lerCsv('t\n"ele disse ""oi"""');
  assert.equal(linhas[0].t, 'ele disse "oi"');
});

test('quebra de linha dentro do campo não vira linha nova', () => {
  const linhas = lerCsv('nome,texto\na,"linha 1\nlinha 2"');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].texto, 'linha 1\nlinha 2');
});

test('BOM do Excel não contamina o nome da primeira coluna', () => {
  const linhas = lerCsv('﻿nome,cta\nzé,vai');
  assert.deepEqual(Object.keys(linhas[0]), ['nome', 'cta']);
});

test('linha em branco no fim não vira registro fantasma', () => {
  assert.equal(lerCsv('a,b\n1,2\n\n').length, 1);
});
