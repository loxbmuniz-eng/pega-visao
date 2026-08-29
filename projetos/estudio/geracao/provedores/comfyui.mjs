// ComfyUI local — imagem.
//
// POR QUE exige um workflow exportado: o ComfyUI não tem "gere uma imagem";
// ele executa um grafo que VOCÊ montou. Chutar um grafo aqui daria erro
// obscuro na sua máquina. Então: exporte o workflow em formato API, aponte
// em provedores.json, e o adaptador só troca o texto do prompt no nó certo.
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { lerConfig } from '../config.mjs';

export const nome = 'comfyui';
export const tipos = ['imagem'];

export async function disponivel() {
  const { endereco, fluxo } = await lerConfig('comfyui');
  if (!fluxo) return false;                     // sem grafo declarado, não se finge que dá
  try {
    const r = await fetch(`${endereco}/system_stats`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch { return false; }
}

function trocarPrompt(grafo, pedido) {
  // Substitui o texto do primeiro CLIPTextEncode positivo encontrado.
  for (const no of Object.values(grafo)) {
    if (no.class_type === 'CLIPTextEncode' && typeof no.inputs?.text === 'string' && !/negativ|ruim|pior/i.test(no._meta?.title ?? '')) {
      no.inputs.text = pedido;
      return grafo;
    }
  }
  throw new Error('o workflow não tem nó CLIPTextEncode para receber o prompt.');
}

export async function gerarImagem({ pedido, destino }) {
  const { endereco, fluxo } = await lerConfig('comfyui');
  const grafo = trocarPrompt(JSON.parse(await readFile(fluxo, 'utf8')), pedido);
  const envio = await fetch(`${endereco}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: grafo }),
  });
  if (!envio.ok) throw new Error(`comfyui recusou o grafo (${envio.status}): ${await envio.text()}`);
  const { prompt_id } = await envio.json();

  // Fila do ComfyUI é assíncrona: pergunta-se pelo histórico até aparecer.
  const limite = Date.now() + 5 * 60 * 1000;
  while (Date.now() < limite) {
    const h = await (await fetch(`${endereco}/history/${prompt_id}`)).json();
    const saidas = h?.[prompt_id]?.outputs;
    if (saidas) {
      for (const no of Object.values(saidas)) {
        const img = no.images?.[0];
        if (!img) continue;
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
        const bin = Buffer.from(await (await fetch(`${endereco}/view?${q}`)).arrayBuffer());
        await writeFile(destino, bin);
        return { arquivo: destino };
      }
      throw new Error('o workflow terminou sem produzir imagem (falta um nó SaveImage?).');
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error('comfyui não devolveu a imagem em 5 minutos.');
}
