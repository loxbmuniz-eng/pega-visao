// Despachante do motor de geração.
//
// A ideia do "rode 200 modelos na sua máquina" traduzida em código: o
// estúdio não conhece modelo nenhum, conhece PROVEDORES. Cada provedor diz
// que tipos atende e se está disponível agora. Trocar de modelo é editar
// geracao/provedores.json — nada no resto do estúdio muda.
import { join } from 'node:path';
import { ordemDe, lerTudo } from './config.mjs';

const REGISTRO = {
  espaco_reservado: () => import('./provedores/espaco_reservado.mjs'),
  ollama: () => import('./provedores/ollama.mjs'),
  openai_compativel: () => import('./provedores/openai_compativel.mjs'),
  comfyui: () => import('./provedores/comfyui.mjs'),
  piper: () => import('./provedores/piper.mjs'),
};

const EXTENSAO = { imagem: 'png', voz: 'wav', texto: 'txt' };
const METODO = { imagem: 'gerarImagem', voz: 'gerarVoz', texto: 'gerarTexto' };

export async function listarProvedores() {
  const saida = [];
  for (const [chave, carregar] of Object.entries(REGISTRO)) {
    const mod = await carregar();
    saida.push({ nome: chave, tipos: mod.tipos, disponivel: await mod.disponivel().catch(() => false) });
  }
  return saida;
}

function apelidar(pedido) {
  return pedido.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'saida';
}

export async function gerar({ tipo, pedido, provedor, destino, opcoes = {} }) {
  if (!METODO[tipo]) throw new Error(`tipo desconhecido: ${tipo}. Use imagem, voz ou texto.`);
  if (!pedido?.trim()) throw new Error('faltou o pedido. Ex: estudio gerar imagem "cozinha industrial ao amanhecer"');

  const candidatos = provedor ? [provedor] : await ordemDe(tipo);
  if (!candidatos.length) throw new Error(`nenhum provedor listado para "${tipo}" em geracao/provedores.json.`);

  const recusas = [];
  for (const chave of candidatos) {
    const carregar = REGISTRO[chave];
    if (!carregar) { recusas.push(`${chave}: não existe no registro`); continue; }
    const mod = await carregar();
    if (!mod.tipos.includes(tipo)) { recusas.push(`${chave}: não faz ${tipo}`); continue; }
    if (!(await mod.disponivel().catch(() => false))) { recusas.push(`${chave}: não configurado/fora do ar`); continue; }

    const arquivo = join(destino, `${apelidar(pedido)}.${EXTENSAO[tipo]}`);
    const r = await mod[METODO[tipo]]({
      pedido, destino: arquivo,
      largura: opcoes.largura ? Number(opcoes.largura) : undefined,
      altura: opcoes.altura ? Number(opcoes.altura) : undefined,
    });
    if (tipo === 'texto') {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(arquivo, r.texto ?? '');
      return { provedor: chave, arquivo, texto: r.texto };
    }
    return { provedor: chave, ...r };
  }

  // Falha explícita, com o motivo de cada recusa. Sem isso a mensagem vira
  // "não deu" e a pessoa perde a tarde adivinhando qual peça faltou.
  const cfg = await lerTudo();
  throw new Error(
    `nenhum provedor de ${tipo} disponível.\n    ` + recusas.join('\n    ') +
    `\n\n  Configure em geracao/provedores.json (ordem atual: ${(cfg.ordem?.[tipo] ?? []).join(' → ')}).`
  );
}
