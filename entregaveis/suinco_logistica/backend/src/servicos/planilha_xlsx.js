/* =====================================================================
   LER UMA PLANILHA .XLSX (Excel moderno) — 05/10/2026
   ---------------------------------------------------------------------
   Para migrar a planilha de controle da Logística (Controle_Cargas__B2B.xlsx)
   para a aba Pagamento de Frete.

   POR QUE UM LEITOR PRÓPRIO, E NÃO O PACOTE `xlsx` DO NPM. Mesmo motivo do
   leitor de .xls (planilha_xls.js): o `xlsx` do npm (0.18.5) tem falhas de
   segurança altas conhecidas e o portão recusa publicar dependência assim.
   Um .xlsx é um ZIP com XML dentro; a descompactação é da `fflate`, e o que
   é preciso do XML são seis marcas (aba, texto compartilhado, célula,
   número, data, estilo).

   O QUE ESTE LEITOR FAZ: devolve cada aba como uma lista de linhas, cada
   linha uma lista de células — texto, número, ou data como "AAAA-MM-DD".
   Fórmula não é calculada: vale o último valor que o Excel gravou. O que ele
   não conhece (erro, tipo estranho) sai vazio — nunca inventado.

   DATA É DATA PELO FORMATO DA CÉLULA. O Excel guarda data como um número
   (dias desde 1899-12-30); só o formato da célula diz que aquele 46286 é o
   dia 21/09/2026. Por isso o leitor lê o styles.xml.

   LIMITES, porque o arquivo vem de fora: 8 MB compactado, 60 MB aberto,
   100 mil linhas por aba.
   ===================================================================== */
import { unzipSync, strFromU8 } from 'fflate';
import { ErroDeLeitura } from './pdf_texto.js';

const MAX_COMPACTADO = 8 * 1024 * 1024;
const MAX_ABERTO = 60 * 1024 * 1024;
const MAX_LINHAS = 100000;

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return ENTIDADES[e.toLowerCase()] ?? m;
});

const atributos = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodificar(m[2]);
  return out;
};

/* "AB12" → { col: 27, linha: 12 } (colunas de A=0) */
function enderecoDaCelula(r) {
  const m = String(r).match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, linha: Number(m[2]) };
}

/* Os formatos de data que o Excel traz de fábrica; os personalizados são
   conferidos pelo código do formato (tem d, m, y, h ou s fora de aspas). */
const FORMATOS_DE_DATA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function ehFormatoDeData(codigo) {
  const limpo = String(codigo)
    .replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/[_*].?/g, '');
  return /[dmyhs]/i.test(limpo);
}

function serialParaIso(n, base1904) {
  const dias = Math.floor(n);
  const base = Date.UTC(base1904 ? 1904 : 1899, base1904 ? 0 : 11, base1904 ? 1 : 30);
  const d = new Date(base + dias * 86400000);
  const dia = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const fracao = n - dias;
  if (fracao < 1e-9) return dia;
  const seg = Math.round(fracao * 86400);
  const h = String(Math.floor(seg / 3600) % 24).padStart(2, '0');
  const mi = String(Math.floor(seg / 60) % 60).padStart(2, '0');
  const se = String(seg % 60).padStart(2, '0');
  return `${dia}T${h}:${mi}:${se}`;
}

function textosCompartilhados(xml) {
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const semFonetica = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let t = '';
    for (const p of semFonetica.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += decodificar(p[1]);
    out.push(t);
  }
  return out;
}

function estilos(xml) {
  const personalizados = new Map();
  for (const m of (xml ?? '').matchAll(/<numFmt\b[^>]*>/g)) {
    const a = atributos(m[0]);
    if (a.numFmtId) personalizados.set(Number(a.numFmtId), a.formatCode ?? '');
  }
  const bloco = (xml ?? '').match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const ehData = [];
  for (const m of (bloco ? bloco[1] : '').matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
    const id = Number(atributos(m[0]).numFmtId ?? 0);
    ehData.push(personalizados.has(id) ? ehFormatoDeData(personalizados.get(id)) : FORMATOS_DE_DATA.has(id));
  }
  return ehData;
}

function lerAba(xml, textos, ehData, base1904) {
  const linhas = [];
  const dados = (xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/) ?? [])[1] ?? '';
  for (const m of dados.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = atributos(m[1]);
    const end = enderecoDaCelula(a.r);
    if (!end) continue;
    if (end.linha > MAX_LINHAS) {
      throw new ErroDeLeitura('PLANILHA_GRANDE', `A planilha tem mais de ${MAX_LINHAS} linhas.`);
    }
    const corpo = m[2] ?? '';
    const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
    let valor = null;
    if (a.t === 'inlineStr') {
      let t = '';
      for (const p of corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += decodificar(p[1]);
      valor = t;
    } else if (v !== undefined) {
      if (a.t === 's') valor = textos[Number(v)] ?? null;
      else if (a.t === 'str') valor = decodificar(v);
      else if (a.t === 'b') valor = v === '1';
      else if (a.t === 'e') valor = null;
      else {
        const n = Number(v);
        if (Number.isFinite(n)) valor = ehData[Number(a.s ?? 0)] ? serialParaIso(n, base1904) : n;
      }
    }
    if (valor === null || valor === '') continue;
    (linhas[end.linha - 1] ??= [])[end.col] = valor;
  }
  for (let i = 0; i < linhas.length; i += 1) linhas[i] ??= [];
  return linhas;
}

export function lerPlanilhaXlsx(buffer) {
  if (!buffer || !buffer.length) throw new ErroDeLeitura('ARQUIVO_VAZIO', 'O arquivo está vazio.');
  if (buffer.length > MAX_COMPACTADO) {
    throw new ErroDeLeitura('ARQUIVO_GRANDE', 'A planilha passa de 8 MB.');
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new ErroDeLeitura('NAO_E_XLSX',
      'Este arquivo não é uma planilha .xlsx (um .xls antigo ou outro formato não serve — salve como .xlsx).');
  }

  let aberto = 0;
  let arquivos;
  try {
    arquivos = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        if (!/^(xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml))$/.test(f.name)) return false;
        aberto += f.originalSize;
        if (aberto > MAX_ABERTO) throw new ErroDeLeitura('PLANILHA_GRANDE', 'A planilha, aberta, passa de 60 MB.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ErroDeLeitura) throw e;
    throw new ErroDeLeitura('XLSX_ILEGIVEL', 'Não consegui abrir esta planilha (o arquivo está corrompido?).');
  }

  const texto = (nome) => (arquivos[nome] ? strFromU8(arquivos[nome]) : null);
  const workbook = texto('xl/workbook.xml');
  if (!workbook) throw new ErroDeLeitura('NAO_E_XLSX', 'Este arquivo não parece uma planilha do Excel (.xlsx).');

  const base1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/i.test(workbook);
  const rels = new Map();
  for (const m of (texto('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const a = atributos(m[0]);
    if (a.Id && a.Target) rels.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const textos = textosCompartilhados(texto('xl/sharedStrings.xml'));
  const ehData = estilos(texto('xl/styles.xml'));

  const abas = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const a = atributos(m[0]);
    const caminho = rels.get(a['r:id']);
    const xml = caminho ? texto(caminho) : null;
    if (!xml) continue;
    abas.push({ nome: a.name ?? '', oculta: a.state === 'hidden' || a.state === 'veryHidden', linhas: lerAba(xml, textos, ehData, base1904) });
  }
  if (!abas.length) throw new ErroDeLeitura('XLSX_SEM_ABAS', 'Não achei nenhuma aba nesta planilha.');
  return { abas };
}
