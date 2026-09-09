// Qualquer servidor LOCAL que fale a API da OpenAI: LM Studio, llama.cpp
// server, vLLM, text-generation-webui. Um adaptador cobre a categoria toda.
import { lerConfig } from '../config.mjs';

export const nome = 'openai_compativel';
export const tipos = ['texto'];

export async function disponivel() {
  const { endereco } = await lerConfig('openai_compativel');
  try {
    const r = await fetch(`${endereco}/models`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch { return false; }
}

export async function gerarTexto({ pedido }) {
  const { endereco, modelo, chave } = await lerConfig('openai_compativel');
  const r = await fetch(`${endereco}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(chave ? { authorization: `Bearer ${chave}` } : {}) },
    body: JSON.stringify({ model: modelo, messages: [{ role: 'user', content: pedido }] }),
  });
  if (!r.ok) throw new Error(`servidor respondeu ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { texto: j.choices?.[0]?.message?.content ?? '' };
}
