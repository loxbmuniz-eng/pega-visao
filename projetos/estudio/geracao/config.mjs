// Leitura da configuração dos provedores, com override por variável de
// ambiente. Assim dá para apontar outro Ollama sem editar arquivo:
//   ESTUDIO_OLLAMA_ENDERECO=http://outra-maquina:11434
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
let cache = null;

export async function lerTudo() {
  if (!cache) cache = JSON.parse(await readFile(join(AQUI, 'provedores.json'), 'utf8'));
  return cache;
}

export async function lerConfig(provedor) {
  const tudo = await lerTudo();
  const base = { ...(tudo[provedor] ?? {}) };
  const prefixo = `ESTUDIO_${provedor.toUpperCase()}_`;
  for (const [chave, valor] of Object.entries(process.env)) {
    if (chave.startsWith(prefixo)) base[chave.slice(prefixo.length).toLowerCase()] = valor;
  }
  return base;
}

export async function ordemDe(tipo) {
  const tudo = await lerTudo();
  return tudo.ordem?.[tipo] ?? [];
}
