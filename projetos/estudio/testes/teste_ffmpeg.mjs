import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escolherFormato, formatoDoQuadro } from '../motor/ffmpeg.mjs';

const completo = { h264: true, vp9: true, vp8: true, audio: true, lePngEmArquivo: true, lePipe: true, leMjpeg: true };
const enxuto = { h264: false, vp9: false, vp8: true, audio: false, lePngEmArquivo: false, lePipe: true, leMjpeg: true };

test('com H.264 disponível o padrão é mp4', () => {
  assert.equal(escolherFormato(completo).chave, 'mp4');
});

test('sem H.264 cai para webm em vez de falhar', () => {
  assert.equal(escolherFormato(enxuto).chave, 'webm');
});

test('mp4 pedido sem libx264 falha com instrução, não em silêncio', () => {
  assert.throws(() => escolherFormato(enxuto, 'mp4'), /libx264|ffmpeg completo/);
});

test('ffmpeg que não decodifica PNG faz o quadro sair em JPEG', () => {
  assert.equal(formatoDoQuadro(enxuto).extensao, 'jpg');
  assert.equal(formatoDoQuadro(completo).extensao, 'png');
});

test('sem ffmpeg nenhum, guarda o master sem perda', () => {
  assert.equal(formatoDoQuadro(null).extensao, 'png');
});
