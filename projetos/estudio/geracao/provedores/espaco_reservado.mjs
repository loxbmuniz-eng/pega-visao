// Provedor que nunca falha — e que nunca finge.
//
// POR QUE existe: sem ele, você não consegue montar o vídeo enquanto o
// modelo não está instalado, e acaba testando o pipeline só no fim, junto
// com tudo o mais. Ele entrega um marcador com o pedido escrito na cara,
// no tamanho e na duração certos. O vídeo fecha; ninguém confunde com arte
// final; e o timing já é o real.
import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { abrirNavegador } from '../../motor/cdp.mjs';
import { abrirPagina } from '../../motor/pagina.mjs';

export const nome = 'espaco_reservado';
export const tipos = ['imagem', 'voz'];
export async function disponivel() { return true; }

const CARTAO = (pedido, largura, altura) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%;background:#0A0A0B;color:#F5F5F4;
    font-family:'Inter','Helvetica Neue',Arial,'Liberation Sans',sans-serif;}
  .q{position:absolute;inset:0;background-image:
      linear-gradient(#1F1F23 1px,transparent 1px),linear-gradient(90deg,#1F1F23 1px,transparent 1px);
    background-size:64px 64px;opacity:.5}
  .c{position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;
    padding:8%;gap:24px;box-sizing:border-box}
  .s{font-size:${Math.round(Math.min(largura, altura) * 0.028)}px;letter-spacing:.24em;text-transform:uppercase;
    color:#FF6B2C;font-weight:700}
  .p{font-size:${Math.round(Math.min(largura, altura) * 0.055)}px;line-height:1.25;font-weight:700;max-width:26ch}
  .d{font-size:${Math.round(Math.min(largura, altura) * 0.024)}px;color:#8B8B93;font-family:monospace}
  .b{position:absolute;inset:0;border:${Math.round(Math.min(largura, altura) * 0.008)}px dashed #FF6B2C;opacity:.55}
</style><div class="q"></div><div class="c">
  <div class="s">espaço reservado</div>
  <div class="p" id="p"></div>
  <div class="d">${largura}x${altura} · nenhum modelo de imagem configurado</div>
</div><div class="b"></div>
<script>document.getElementById('p').textContent = ${JSON.stringify(pedido)};</script>`;

export async function gerarImagem({ pedido, destino, largura = 1080, altura = 1080 }) {
  const navegador = await abrirNavegador();
  try {
    const pagina = await abrirPagina(navegador, { largura, altura });
    await pagina.irPara(`data:text/html;charset=utf-8,${encodeURIComponent(CARTAO(pedido, largura, altura))}`);
    await pagina.esperarFontes();
    await writeFile(destino, await pagina.capturar());
    return {
      arquivo: destino,
      aviso: 'espaço reservado — nenhum provedor de imagem configurado. Veja geracao/provedores.json.',
    };
  } finally {
    await navegador.fechar();
  }
}

// Silêncio com a DURAÇÃO que a fala teria. Serve para cronometrar a cena
// antes de existir voz: 150 palavras por minuto é a média de locução em
// português. Trocar pelo áudio real depois não mexe no tempo da cena.
export async function gerarVoz({ pedido, destino }) {
  const palavras = pedido.trim().split(/\s+/).filter(Boolean).length;
  const segundos = Math.max(1, (palavras / 150) * 60);
  const taxa = 22050;
  const amostras = Math.round(segundos * taxa);
  const dados = Buffer.alloc(amostras * 2);           // 16-bit mono, tudo zero = silêncio
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0);
  cab.writeUInt32LE(36 + dados.length, 4);
  cab.write('WAVE', 8);
  cab.write('fmt ', 12);
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);                            // PCM
  cab.writeUInt16LE(1, 22);                            // mono
  cab.writeUInt32LE(taxa, 24);
  cab.writeUInt32LE(taxa * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write('data', 36);
  cab.writeUInt32LE(dados.length, 40);
  await writeFile(destino, Buffer.concat([cab, dados]));
  return {
    arquivo: destino,
    aviso: `silêncio de ${segundos.toFixed(1)}s (${palavras} palavras a 150 ppm) — nenhum provedor de voz configurado.`,
  };
}
