/* =====================================================================
   O TEXTO DE UM PDF, COM A POSIÇÃO DE CADA PEDAÇO — 05/10/2026
   ---------------------------------------------------------------------
   Para a conferência do Pagamento de Frete: os relatórios do DeliveryB2B e
   do Atak (WRVDA501) saem em PDF, e é o PDF que a Logística tem na mão.

   POR QUE COM POSIÇÃO. Texto corrido de tabela embaralha as colunas (o
   nome do cliente quebra em três linhas e o status vai junto). Cada pedaço
   vem com o x e o y da página, e os leitores montam a linha pela posição —
   igual ao olho de quem lê.

   A BIBLIOTECA É A `pdfjs-dist` (a leitora de PDF do Firefox, da Mozilla),
   e CARREGA SÓ NA PRIMEIRA IMPORTAÇÃO: ela é grande, e o servidor do pátio
   não paga o custo nem corre o risco dela enquanto ninguém importa nada.
   Se ela não carregar, só a importação responde erro — o resto do servidor
   nem fica sabendo.

   LIMITES, porque o arquivo vem de fora: 6 MB e 300 páginas por PDF, e o
   código embutido no PDF (`isEvalSupported`) nunca é executado.
   ===================================================================== */

export class ErroDeLeitura extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroDeLeitura';
    this.codigo = codigo;
    this.status = 422;
  }
}

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_PAGINAS = 300;
/* PDF montado para travar o leitor não pode travar o servidor do pátio: passou
   disto, a leitura é abandonada e a pessoa recebe a explicação. */
const TEMPO_MAXIMO_MS = 20000;

let _pdfjs = null;
async function carregarPdfjs() {
  if (!_pdfjs) {
    try {
      _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch (e) {
      const err = new Error('A leitura de PDF não está disponível neste servidor (a biblioteca não carregou). Rode o atualizar do servidor.');
      err.status = 503;
      err.codigo = 'LEITOR_PDF_INDISPONIVEL';
      err.causa = e;
      throw err;
    }
  }
  return _pdfjs;
}

/* Devolve [{ largura, altura, itens: [{ s, x, y }] }], uma entrada por
   página. `y` cresce para CIMA (como no PDF): o topo da página tem o maior y. */
export async function lerPaginasDoPdf(buffer) {
  if (!buffer || !buffer.length) {
    throw new ErroDeLeitura('ARQUIVO_VAZIO', 'O arquivo está vazio.');
  }
  if (buffer.length > MAX_BYTES) {
    throw new ErroDeLeitura('ARQUIVO_GRANDE', 'O PDF passa de 6 MB — não é um relatório de uma carga.');
  }
  if (Buffer.from(buffer.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    throw new ErroDeLeitura('NAO_E_PDF', 'Este arquivo não é um PDF.');
  }

  const pdfjs = await carregarPdfjs();
  let tarefa;
  let doc;
  try {
    tarefa = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    doc = await tarefa.promise;
  } catch (e) {
    if (tarefa) await tarefa.destroy().catch(() => {});
    throw new ErroDeLeitura('PDF_ILEGIVEL', 'Não consegui abrir este PDF (está corrompido ou protegido por senha).');
  }

  let relogio;
  try {
    if (doc.numPages > MAX_PAGINAS) {
      throw new ErroDeLeitura('PDF_GRANDE', `O PDF tem ${doc.numPages} páginas — passa do limite de ${MAX_PAGINAS}.`);
    }
    const ler = async () => {
      const paginas = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        const pg = await doc.getPage(n);
        const vp = pg.getViewport({ scale: 1 });
        const tc = await pg.getTextContent();
        const itens = [];
        for (const i of tc.items) {
          const s = String(i.str ?? '');
          if (!s.trim()) continue;
          // w: a largura do pedaço, para saber até onde ele vai (um valor largo e
          // centralizado começa antes do título da coluna dele — ocorrência #112)
          itens.push({ s, x: Math.round(i.transform[4] * 10) / 10, y: Math.round(i.transform[5] * 10) / 10, w: Math.round((Number(i.width) || 0) * 10) / 10 });
        }
        paginas.push({ largura: vp.width, altura: vp.height, itens });
      }
      return paginas;
    };
    const demorou = new Promise((_, rejeitar) => {
      relogio = setTimeout(() => rejeitar(new ErroDeLeitura('PDF_DEMOROU', 'A leitura deste PDF demorou demais e foi cancelada.')), TEMPO_MAXIMO_MS);
    });
    return await Promise.race([ler(), demorou]);
  } finally {
    clearTimeout(relogio);
    await tarefa.destroy().catch(() => {});
  }
}
