/* =====================================================================
   O RELATÓRIO WRMVE790 DO SISATAK VIRA LINHAS DO CHECKLIST (28/09/2026)
   ---------------------------------------------------------------------
   Pedido do dono: importar o relatório "e trazer os dados dentro das devs,
   facilitando assim o retrabalho de ficar colocando item por item, coluna
   por coluna, célula por célula".

   AS DECISÕES DELE, uma por uma, e é por elas que este arquivo existe:
     · entra SÓ a "01 - DEVOLUÇÃO FÍSICA" — refaturamento e quebra de peso
       não trazem mercadoria de volta e não entram no checklist;
     · as linhas "Não Possui" (documento DDO, sem devolução gerada) ficam
       fora;
     · o Nº DEV é o documento INTEIRO: 103-001-53188-DEV;
     · a caixa (CX) não vem no relatório — o operador digita.

   ESTA FUNÇÃO NÃO GRAVA NADA. Ela devolve a prévia; quem escolhe o que
   entra é a pessoa, e cada linha escolhida entra pela mesma rota da
   digitação à mão. Dois caminhos de gravação divergiriam no primeiro
   campo novo do checklist.
   ===================================================================== */

/* As colunas pelo NOME do cabeçalho, nunca pela posição: se o Sisatak
   acrescentar uma coluna no meio, a leitura continua certa — ou recusa
   dizendo qual coluna faltou, em vez de ler o campo vizinho. */
const COLUNAS = {
  nf: 'Documento_NF', cliente: 'Cliente', supervisor: 'Supervisor',
  representante: 'Representante', valorNf: 'Valor_Total_NF',
  dev: 'Documento_DEN-DEV', dataDev: 'Data_DEN-DEV', produto: 'Produto',
  valorDev: 'Valor_Total_DEN-DEV', tipo: 'Tipo_Devolucao', motivo: 'Motivo_Devolucao',
};

export const TIPO_QUE_ENTRA = '01';   // "01 - DEVOLUÇÃO FÍSICA"

const txt = (v) => String(v ?? '').trim();

/* "441088-DMA Distribuidora SA" → { codigo: '441088', nome: 'DMA Distribuidora SA' } */
export function codigoENome(v) {
  const t = txt(v);
  const m = t.match(/^(\d+)\s*-\s*(.+)$/);
  return m ? { codigo: m[1], nome: m[2].trim() } : { codigo: '', nome: t };
}

/* "103-003-730566-NE" → "730566": o número da nota fiscal, que é o que a
   coluna Nota do checklist sempre recebeu. O Nº DEV, ao contrário, vai
   inteiro — decisão do dono. */
export function numeroDaNota(v) {
  const partes = txt(v).split('-');
  return partes.length >= 4 && /^\d+$/.test(partes[2]) ? partes[2] : txt(v);
}

/* "28/09/2026" → "2026-09-28". Outro formato não vira data inventada. */
export function dataIso(v) {
  const m = txt(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/* As linhas da planilha → a prévia. Devolve também QUANTAS ficaram de
   fora e por quê: quem importa precisa ver que 39 linhas não entraram de
   propósito, e não achar que a importação perdeu dado. */
export function previaDoSisatak(linhas) {
  const iCab = linhas.findIndex((l) => l.some((c) => txt(c) === COLUNAS.dev));
  if (iCab < 0) {
    throw new Error('Este arquivo não é o relatório WRMVE790 do Sisatak: não achei a coluna '
      + `"${COLUNAS.dev}".`);
  }
  const cab = linhas[iCab].map(txt);
  const pos = {};
  for (const [chave, nome] of Object.entries(COLUNAS)) {
    pos[chave] = cab.indexOf(nome);
    if (pos[chave] < 0) {
      throw new Error(`O relatório do Sisatak veio sem a coluna "${nome}". Exporte o WRMVE790 completo.`);
    }
  }
  const fora = { outroTipo: {}, semDocumento: 0 };
  const itens = [];
  for (const l of linhas.slice(iCab + 1)) {
    const c = (k) => l[pos[k]];
    const doc = txt(c('dev'));
    if (!txt(c('nf')) && !doc) continue;                        // linha vazia
    if (/^filtros/i.test(txt(l[0])) || /^tic\b/i.test(txt(l[0]))) break;   // o rodapé
    if (!doc || /^n[ãa]o possui$/i.test(doc)) { fora.semDocumento++; continue; }
    const tipo = txt(c('tipo'));
    if (!tipo.startsWith(TIPO_QUE_ENTRA)) {
      const rotulo = tipo || 'Não informado';
      fora.outroTipo[rotulo] = (fora.outroTipo[rotulo] || 0) + 1;
      continue;
    }
    const cliente = codigoENome(c('cliente'));
    const produto = codigoENome(c('produto'));
    const valorNf = Number(c('valorNf'));
    const valorDev = Number(c('valorDev'));
    itens.push({
      nota: numeroDaNota(c('nf')),
      notaDocumento: txt(c('nf')),
      supervisor: codigoENome(c('supervisor')).nome,
      vendedor: codigoENome(c('representante')).nome,
      codCliente: cliente.codigo,
      clienteNome: cliente.nome,
      codProduto: produto.codigo,
      produtoNome: produto.nome,
      numDev: doc,
      dataItem: dataIso(c('dataDev')),
      motivo: txt(c('motivo')),
      /* SUGESTÃO, não decisão: devolveu menos do que a nota daquele produto
         vendeu, então é parcial. A pessoa confirma na prévia. */
      parcialSugerido: Number.isFinite(valorNf) && Number.isFinite(valorDev) && valorDev < valorNf,
    });
  }
  return { itens, fora };
}
