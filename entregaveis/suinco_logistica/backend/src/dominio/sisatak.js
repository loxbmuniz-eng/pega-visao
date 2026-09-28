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
   acrescentar ou tirar uma coluna, a leitura continua certa — ou recusa
   dizendo qual coluna faltou, em vez de ler o campo vizinho.

   DOIS FORMATOS, o mesmo leitor. O relatório completo tem 23 colunas; o
   que o operador de fato vai trazer (28/09/2026, pedido do dono) é a
   planilha LIMPA, com 7: nota, cliente, supervisor, representante, Nº DEV,
   produto e motivo. Só as três primeiras abaixo são obrigatórias. */
const OBRIGATORIAS = { nf: 'Documento_NF', dev: 'Documento_DEN-DEV', produto: 'Produto' };
const OPCIONAIS = {
  cliente: 'Cliente', supervisor: 'Supervisor', representante: 'Representante',
  motivo: 'Motivo_Devolucao', dataDev: 'Data_DEN-DEV', tipo: 'Tipo_Devolucao',
  valorNf: 'Valor_Total_NF', valorDev: 'Valor_Total_DEN-DEV',
};

export const TIPO_QUE_ENTRA = '01';   // "01 - DEVOLUÇÃO FÍSICA", quando a coluna existe

/* SEM A COLUNA DE TIPO (planilha limpa), quem separa é o documento.
   No relatório completo de 28/09/2026 a separação foi exata: as 5 linhas
   de DEVOLUÇÃO FÍSICA eram todas "-DEV"; as 34 de refaturamento e quebra
   de peso, todas "-DEN". Então: "-DEV" entra, "-DEN" fica fora — e a
   prévia diz quantas ficaram fora por isso. */
export const SUFIXO_QUE_ENTRA = 'DEV';

/* O documento do Sisatak: 103-001-53188-DEV. É também o que separa linha
   de dado de linha de rodapé ("Cod. Representante:", "Página -1 de 1"):
   rodapé não tem este formato. */
const DOCUMENTO = /^\d+-\d+-\d+-([A-Z]+)$/;

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
  const iCab = linhas.findIndex((l) => l.some((c) => txt(c) === OBRIGATORIAS.dev));
  if (iCab < 0) {
    throw new Error('Este arquivo não é o relatório WRMVE790 do Sisatak: não achei a coluna '
      + `"${OBRIGATORIAS.dev}".`);
  }
  const cab = linhas[iCab].map(txt);
  const pos = {};
  for (const [chave, nome] of Object.entries(OBRIGATORIAS)) {
    pos[chave] = cab.indexOf(nome);
    if (pos[chave] < 0) {
      throw new Error(`O relatório do Sisatak veio sem a coluna "${nome}". Ela é obrigatória.`);
    }
  }
  for (const [chave, nome] of Object.entries(OPCIONAIS)) pos[chave] = cab.indexOf(nome);
  const temTipo = pos.tipo >= 0;
  const temValores = pos.valorNf >= 0 && pos.valorDev >= 0;
  const fora = { outroTipo: {}, semDocumento: 0 };
  const itens = [];
  for (const l of linhas.slice(iCab + 1)) {
    const c = (k) => (pos[k] >= 0 ? l[pos[k]] : '');
    const doc = txt(c('dev'));
    if (/^n[ãa]o possui$/i.test(doc)) { fora.semDocumento++; continue; }
    const m = doc.match(DOCUMENTO);
    if (!m || !DOCUMENTO.test(txt(c('nf')))) continue;          // vazia ou rodapé
    if (temTipo) {
      const tipo = txt(c('tipo'));
      if (!tipo.startsWith(TIPO_QUE_ENTRA)) {
        const rotulo = tipo || 'Não informado';
        fora.outroTipo[rotulo] = (fora.outroTipo[rotulo] || 0) + 1;
        continue;
      }
    } else if (m[1] !== SUFIXO_QUE_ENTRA) {
      const rotulo = `documento ${m[1]} (não é devolução física)`;
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
      dataItem: dataIso(c('dataDev')),      // null na planilha limpa: vale a data do checklist
      motivo: txt(c('motivo')),
      /* SUGESTÃO, não decisão, e só quando há valores para comparar:
         devolveu menos do que a nota daquele produto vendeu → parcial.
         Sem valores (planilha limpa) é null, e a pessoa escolhe. */
      parcialSugerido: temValores && Number.isFinite(valorNf) && Number.isFinite(valorDev)
        ? valorDev < valorNf : null,
    });
  }
  return { itens, fora };
}
