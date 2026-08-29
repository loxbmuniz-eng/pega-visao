// Leitor de CSV honesto: aspas, vírgula dentro do campo, quebra de linha
// dentro do campo, e detecção de separador.
//
// POR QUE não split(','): a primeira planilha real que chega tem uma vírgula
// dentro de um título entre aspas, e o split silenciosamente desloca todas as
// colunas. O vídeo sai com o texto errado e ninguém percebe até publicar.
export function lerCsv(texto) {
  const limpo = texto.replace(/^﻿/, '');            // BOM do Excel
  const sep = detectarSeparador(limpo);
  const linhas = [];
  let campo = '';
  let linha = [];
  let dentroDeAspas = false;

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') { campo += '"'; i++; }   // "" é uma aspa literal
        else dentroDeAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { dentroDeAspas = true; continue; }
    if (c === sep) { linha.push(campo); campo = ''; continue; }
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    if (c === '\r') continue;
    campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }

  const cheias = linhas.filter((l) => l.some((c) => c.trim() !== ''));
  if (!cheias.length) return [];
  const cabecalho = cheias[0].map((c) => c.trim());
  return cheias.slice(1).map((l, idx) => {
    // Linha com MAIS campos que o cabeçalho é quase sempre separador solto
    // dentro de uma célula. Ignorar o excedente desloca as colunas seguintes e
    // o vídeo sai com o texto da coluna errada — erro que só aparece depois de
    // publicado. Melhor parar aqui e dizer o que houve.
    if (l.length > cabecalho.length) {
      throw new Error(
        `linha ${idx + 2}: ${l.length} campos para ${cabecalho.length} colunas. ` +
        `Provavelmente há um "${sep}" dentro de uma célula sem aspas. ` +
        `Ponha a célula entre aspas, ou use "|" para separar itens de uma lista.`
      );
    }
    const obj = {};
    cabecalho.forEach((nome, i) => { obj[nome] = (l[i] ?? '').trim(); });
    return obj;
  });
}

function detectarSeparador(texto) {
  const primeira = texto.split('\n')[0] ?? '';
  const fora = (sep) => {
    let n = 0, aspas = false;
    for (const c of primeira) {
      if (c === '"') aspas = !aspas;
      else if (c === sep && !aspas) n++;
    }
    return n;
  };
  // Ponto e vírgula ganha empate: é o padrão do Excel em português.
  return fora(';') >= fora(',') && fora(';') > 0 ? ';' : ',';
}
