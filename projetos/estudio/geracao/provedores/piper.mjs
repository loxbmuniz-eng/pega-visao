// Piper local — voz. Roda offline, em CPU, sem conta e sem cobrança.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lerConfig } from '../config.mjs';

export const nome = 'piper';
export const tipos = ['voz'];

export async function disponivel() {
  const { binario, voz } = await lerConfig('piper');
  return Boolean(binario && voz && existsSync(binario) && existsSync(voz));
}

export async function gerarVoz({ pedido, destino }) {
  const { binario, voz } = await lerConfig('piper');
  const r = spawnSync(binario, ['--model', voz, '--output_file', destino], { input: pedido, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`piper falhou (${r.status}): ${r.stderr ?? ''}`);
  return { arquivo: destino };
}
