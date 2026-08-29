// Lote: uma planilha entra, N vídeos saem.
//
// É o "gere centenas de vídeos automaticamente" na prática. Cada linha do CSV
// vira window.__dados de um render. A coluna `nome` (se existir) nomeia o
// arquivo; sem ela, usa-se o número da linha.
import { readFile } from 'node:fs/promises';
import { lerCsv } from './csv.mjs';
import { renderizar } from './renderizar.mjs';

function apelidar(linha, indice) {
  const bruto = linha.nome || linha.slug || linha.titulo || `linha_${indice + 1}`;
  return String(bruto)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento: nome de arquivo viaja melhor
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 60) || `linha_${indice + 1}`;
}

export async function renderizarLote({
  cena, arquivoDados, saida = './saida', fps, formato = 'auto',
  manterQuadros = false, aoProgresso = () => {}, aoVideo = () => {},
} = {}) {
  const linhas = lerCsv(await readFile(arquivoDados, 'utf8'));
  if (!linhas.length) throw new Error(`${arquivoDados} não tem nenhuma linha de dados.`);

  const feitos = [];
  const falhas = [];
  for (const [i, linha] of linhas.entries()) {
    const nome = apelidar(linha, i);
    try {
      // Um navegador por vídeo. Mais lento que reaproveitar, e de propósito:
      // estado vazado entre linhas (fonte, imagem em cache, variável global)
      // produz vídeo com o dado da linha anterior — erro caro e silencioso.
      const r = await renderizar({
        cena, saida, dados: linha, fps, formato, manterQuadros, nome,
        aoProgresso: (p) => aoProgresso({ ...p, indice: i + 1, totalLinhas: linhas.length }),
      });
      feitos.push(r);
      aoVideo({ ok: true, indice: i + 1, totalLinhas: linhas.length, ...r });
    } catch (erro) {
      // Uma linha ruim não pode derrubar as outras 199.
      falhas.push({ linha: i + 1, nome, erro: erro.message });
      aoVideo({ ok: false, indice: i + 1, totalLinhas: linhas.length, rotulo: nome, erro: erro.message });
    }
  }
  return { feitos, falhas, totalLinhas: linhas.length };
}
