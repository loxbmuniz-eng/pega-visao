// Descobre qual ffmpeg existe na máquina e o que ele sabe codificar.
//
// POR QUE isto não é fixo: o ffmpeg que vem junto com o Playwright é uma
// build enxuta — só VP8/WebM, sem H.264 e sem áudio. Um ffmpeg normal
// (apt/brew) tem H.264. Em vez de exigir instalação ou mentir sobre o
// formato de saída, o estúdio olha o que existe e escolhe o melhor. Os
// quadros PNG ficam sempre em disco, então dá para recodificar em qualquer
// lugar depois, sem re-renderizar.
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function bundledPlaywright() {
  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(raiz)) return null;
  try {
    const dirs = execFileSync('ls', [raiz], { encoding: 'utf8' }).split('\n');
    for (const d of dirs) {
      if (!d.startsWith('ffmpeg')) continue;
      for (const nome of ['ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg.exe']) {
        const p = join(raiz, d, nome);
        if (existsSync(p)) return p;
      }
    }
  } catch { /* sem ffmpeg empacotado */ }
  return null;
}

export function acharFfmpeg() {
  if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN)) return process.env.FFMPEG_BIN;
  // O do sistema vem primeiro de propósito: costuma ser a build completa.
  try {
    const achado = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
    if (achado) return achado;
  } catch { /* segue */ }
  return bundledPlaywright();
}

export function capacidades(bin) {
  const rodar = (flag) => {
    const r = spawnSync(bin, ['-hide_banner', flag], { encoding: 'utf8' });
    return `${r.stdout ?? ''}${r.stderr ?? ''}`;
  };
  const enc = rodar('-encoders');
  const dec = rodar('-decoders');
  const dem = rodar('-demuxers');
  const temNo = (texto, nome) => new RegExp(`^\\s*\\S+\\s+${nome}\\s`, 'm').test(texto);

  return {
    // codecs de saída
    h264: temNo(enc, 'libx264'),
    vp9: temNo(enc, 'libvpx-vp9'),
    vp8: temNo(enc, 'libvpx'),
    aac: temNo(enc, 'aac'),
    opus: temNo(enc, 'libopus'),
    audio: temNo(enc, 'aac') || temNo(enc, 'libopus') || temNo(enc, 'libvorbis'),
    // COMO os quadros entram. A build enxuta que vem com o Playwright não tem
    // demuxer image2 nem decodificador PNG — só aceita JPEG por stdin. Descobrir
    // isso aqui é o que faz o estúdio rodar tanto num container pelado quanto
    // numa máquina com ffmpeg completo.
    lePngEmArquivo: /^\s*D\s+image2\s/m.test(dem) && temNo(dec, 'png'),
    lePipe: /image2pipe/.test(dem),
    leMjpeg: temNo(dec, 'mjpeg'),
  };
}

// Nome antigo, mantido para não quebrar quem já chamava.
export const codecsDe = capacidades;

// Em que formato os quadros devem ser capturados para este ffmpeg conseguir lê-los.
export function formatoDoQuadro(caps) {
  if (!caps) return { extensao: 'png', formato: 'png' };            // sem ffmpeg: guarda o master sem perda
  if (caps.lePngEmArquivo) return { extensao: 'png', formato: 'png' };
  if (caps.lePipe && caps.leMjpeg) return { extensao: 'jpg', formato: 'jpeg', qualidade: 95 };
  return { extensao: 'png', formato: 'png' };
}

// Devolve { chave, extensao, args } para o melhor formato disponível.
// `preferido` pode ser 'mp4' | 'webm' | 'auto'.
export function escolherFormato(codecs, preferido = 'auto') {
  const mp4 = {
    chave: 'mp4',
    extensao: 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
  };
  const vp9 = {
    chave: 'webm',
    extensao: 'webm',
    args: ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-pix_fmt', 'yuv420p'],
  };
  const vp8 = {
    chave: 'webm',
    extensao: 'webm',
    args: ['-c:v', 'libvpx', '-b:v', '2M', '-crf', '10', '-pix_fmt', 'yuv420p'],
  };

  if (preferido === 'mp4') {
    if (!codecs.h264) {
      throw new Error(
        'MP4/H.264 pedido, mas este ffmpeg não tem libx264.\n' +
        'Instale um ffmpeg completo (apt install ffmpeg / brew install ffmpeg) ou use --formato webm.\n' +
        'Os quadros PNG ficam salvos: dá para codificar depois sem renderizar de novo.'
      );
    }
    return mp4;
  }
  if (preferido === 'webm') {
    if (codecs.vp9) return vp9;
    if (codecs.vp8) return vp8;
    throw new Error('WebM pedido, mas este ffmpeg não tem libvpx.');
  }
  if (codecs.h264) return mp4;
  if (codecs.vp9) return vp9;
  if (codecs.vp8) return vp8;
  throw new Error('Nenhum codec de vídeo utilizável neste ffmpeg (nem libx264, nem libvpx).');
}

export async function montarVideo({
  bin, pastaQuadros, extensaoQuadro = 'png', fps, saida, formato, audio = null, caps = null,
}) {
  const capacidade = caps ?? capacidades(bin);
  const arquivos = (await readdir(pastaQuadros))
    .filter((f) => f.endsWith(`.${extensaoQuadro}`))
    .sort();
  if (!arquivos.length) throw new Error(`nenhum quadro .${extensaoQuadro} em ${pastaQuadros}`);

  const porArquivo = extensaoQuadro === 'png' ? capacidade.lePngEmArquivo : capacidade.lePipe;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps)];

  if (porArquivo && extensaoQuadro === 'png') {
    // -start_number 1 porque os quadros começam em 00001: sem isto o ffmpeg
    // procura 00000.png, não acha, e falha com "No such file or directory".
    args.push('-start_number', '1', '-i', join(pastaQuadros, `%05d.${extensaoQuadro}`));
  } else if (capacidade.lePipe) {
    // pipe:0, não "-": a build enxuta do Playwright não registra o atalho "-"
    // e responde "Protocol not found". pipe:0 funciona nas duas builds.
    args.push('-f', 'image2pipe', '-c:v', extensaoQuadro === 'png' ? 'png' : 'mjpeg', '-i', 'pipe:0');
  } else {
    throw new Error('este ffmpeg não sabe ler sequência de imagens (sem image2 e sem image2pipe).');
  }

  if (audio) args.push('-i', audio);
  args.push(...formato.args);
  if (audio) {
    if (!capacidade.audio) {
      throw new Error('áudio pedido, mas este ffmpeg não tem codificador de áudio. Use um ffmpeg completo.');
    }
    args.push('-c:a', formato.chave === 'mp4' ? 'aac' : 'libopus', '-shortest');
  }
  args.push(saida);

  const usaPipe = args.includes('pipe:0');
  const proc = spawn(bin, args, { stdio: [usaPipe ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let erroFf = '';
  proc.stderr.on('data', (d) => { erroFf += d.toString(); });

  let morreu = null;
  const terminou = new Promise((resolver, rejeitar) => {
    proc.on('error', (e) => { morreu = e; rejeitar(e); });
    proc.on('close', (codigo) => {
      if (codigo === 0) return resolver();
      morreu = new Error(`ffmpeg falhou (${codigo}):\n${erroFf}`);
      rejeitar(morreu);
    });
  });
  // Segurar a rejeição AGORA. Se o ffmpeg morre no primeiro quadro, `terminou`
  // rejeita enquanto ainda estamos escrevendo — e sem este catch vira
  // unhandled rejection, que derruba o processo sem dizer o que houve.
  terminou.catch(() => {});

  if (usaPipe) {
    proc.stdin.on('error', () => {});          // EPIPE quando o ffmpeg já saiu
    try {
      for (const nome of arquivos) {
        if (morreu) break;                      // não adianta empurrar 900 quadros num cano fechado
        const bytes = await readFile(join(pastaQuadros, nome));
        // Respeitar o retorno de write() evita estourar a memória num lote
        // grande: sem isso o Node enfileira tudo antes de o ffmpeg ler.
        if (!proc.stdin.write(bytes)) {
          await new Promise((r) => {
            proc.stdin.once('drain', r);
            proc.once('close', r);
          });
        }
      }
      proc.stdin.end();
    } catch (e) {
      proc.kill();
      throw e;
    }
  }

  await terminou;
  return saida;
}
