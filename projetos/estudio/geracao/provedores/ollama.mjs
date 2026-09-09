// Ollama local — texto. Nada de chave de API, nada de cobrança por token.
import { lerConfig } from '../config.mjs';

export const nome = 'ollama';
export const tipos = ['texto'];

export async function disponivel() {
  const { endereco } = await lerConfig('ollama');
  try {
    const r = await fetch(`${endereco}/api/tags`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch { return false; }
}

export async function gerarTexto({ pedido }) {
  const { endereco, modelo } = await lerConfig('ollama');
  const r = await fetch(`${endereco}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, prompt: pedido, stream: false }),
  });
  if (!r.ok) throw new Error(`ollama respondeu ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { texto: j.response ?? '' };
}
