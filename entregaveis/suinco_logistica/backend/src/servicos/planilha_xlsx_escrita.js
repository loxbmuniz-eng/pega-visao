/* =====================================================================
   ESCREVER UMA PLANILHA .XLSX (Excel moderno) — 05/10/2026
   ---------------------------------------------------------------------
   Para o botão "Exportar planilha" da aba Pagamento de Frete: o painel
   gera, do zero, a planilha de controle da Logística — a mesma que a
   Daniela mantinha à mão.

   POR QUE UM ESCRITOR PRÓPRIO, E NÃO UM PACOTE DO NPM. Mesmo motivo dos
   leitores (planilha_xls.js, planilha_xlsx.js): o pacote conhecido
   (`exceljs`) traz dependência com falha de segurança, e `xlsx` tem falhas
   ALTAS. Um .xlsx é um ZIP com XML dentro; o ZIP é da `fflate` (já usada na
   leitura), e o XML são poucas marcas conhecidas: células, estilos, filtro,
   painel congelado, validação de lista, formatação condicional, impressão.

   O QUE FICA DE FORA, DE PROPÓSITO: gráficos, imagens, macros, tabelas
   dinâmicas, senha. Quanto menos recurso, menos jeito de o Excel reclamar do
   arquivo ("encontramos um problema com algum conteúdo").

   PROVA DO FORMATO. O XML sai na ORDEM que o esquema OOXML exige (o Excel é
   mais exigente que o LibreOffice); o teste `planilha_frete_export.test.js`
   confere a estrutura, e a lição do dia do desenho está no REGISTRO.

   FÓRMULA TEM RESULTADO GRAVADO. Toda célula com fórmula leva também o valor
   que a fórmula dá — quem abre no celular, no visualizador de e-mail ou no
   Google Planilhas vê o número certo mesmo sem recalcular. O Excel recalcula
   ao abrir (`fullCalcOnLoad`).

   A ENTRADA É DECLARATIVA (sem classes):
     escreverXlsx({
       titulo, autor, geradoEm: Date|ISO,
       abas: [{
         nome, corAba:'1E2A52', grade:false, zoom:90,
         colunas:[{ larg:13, oculta:false }],
         linhas:[ [cel, cel, …]  |  { altura:30, c:[cel, …] } ],
         congelar:{ linhas:1, colunas:2 }, filtro:'A1:V200', mesclar:['A1:D1'],
         validacoes:[{ intervalo, tipo:'list'|'date'|'decimal', lista:[…], … }],
         condicionais:[{ intervalo, regras:[{ formula, estilo }, { barra:{cor} }] }],
         impressao:{ orientacao:'landscape', repetirLinhas:[1,1], rodape:'…' },
       }]
     }) → Buffer
     cel = { v, f, t:'n'|'s'|'d'|'b', e:estilo } — `v` sozinho vira texto,
           número ou data ('AAAA-MM-DD') conforme `t` (ou o tipo do JS);
           `f` é a fórmula sem o "=", e `v` o resultado gravado;
           `e` é o estilo { fonte:{nome,tam,neg,it,cor}, fundo:'RRGGBB',
           borda:{ topo|base|esq|dir|todas:{estilo,cor} }, alin:{h,v,quebrar,
           recuo}, fmt:'dd/mm/yyyy' }.
   ===================================================================== */
import { zipSync, strToU8 } from 'fflate';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* O que não pode ir dentro de um XML: controle, e os caracteres < > & ". */
const XML_INVALIDO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s) => String(s).replace(XML_INVALIDO, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const argb = (c) => `FF${String(c).replace('#', '').toUpperCase()}`;

/* 0 → A, 25 → Z, 26 → AA */
export function letraDaColuna(i) {
  let n = i + 1; let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const enderecoDe = (linha, col) => `${letraDaColuna(col)}${linha + 1}`;

/* "AAAA-MM-DD" (ou Date) → número de série do Excel (dias desde 30/12/1899).
   Sempre por UTC: a data é a do calendário, nunca deslocada pelo fuso. */
export function serialDaData(v) {
  let ms;
  if (v instanceof Date) ms = Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  else {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000);
}

/* ---------------------------------------------------------------- estilos */

class Estilos {
  constructor() {
    this.fontes = [];
    this.fundos = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.bordas = [];
    this.formatos = new Map(); // código → id (a partir de 164)
    this.xfs = [];
    this.dxfs = [];
    this._chave = new Map();
    this._dxfChave = new Map();
    // O estilo 0 é o "Normal": Calibri 11, sem nada.
    this.indice({});
  }

  _fonte(f = {}) {
    const x = `<font>${f.neg ? '<b/>' : ''}${f.it ? '<i/>' : ''}<sz val="${f.tam ?? 11}"/><color rgb="${argb(f.cor ?? '1F2937')}"/><name val="${esc(f.nome ?? 'Calibri')}"/><family val="2"/></font>`;
    let i = this.fontes.indexOf(x);
    if (i < 0) { this.fontes.push(x); i = this.fontes.length - 1; }
    return i;
  }

  _fundo(c) {
    if (!c) return 0;
    const x = `<fill><patternFill patternType="solid"><fgColor rgb="${argb(c)}"/><bgColor indexed="64"/></patternFill></fill>`;
    let i = this.fundos.indexOf(x);
    if (i < 0) { this.fundos.push(x); i = this.fundos.length - 1; }
    return i;
  }

  _lado(tag, l) {
    return l && l.estilo ? `<${tag} style="${l.estilo}"><color rgb="${argb(l.cor ?? '9CA3AF')}"/></${tag}>` : `<${tag}/>`;
  }

  _borda(b) {
    if (!b) { b = {}; }
    const todas = b.todas;
    const x = `<border>${this._lado('left', b.esq ?? todas)}${this._lado('right', b.dir ?? todas)}${this._lado('top', b.topo ?? todas)}${this._lado('bottom', b.base ?? todas)}<diagonal/></border>`;
    let i = this.bordas.indexOf(x);
    if (i < 0) { this.bordas.push(x); i = this.bordas.length - 1; }
    return i;
  }

  _formato(codigo) {
    if (!codigo) return 0;
    if (codigo === '0%') return 9;
    if (codigo === '0') return 1;
    if (!this.formatos.has(codigo)) this.formatos.set(codigo, 164 + this.formatos.size);
    return this.formatos.get(codigo);
  }

  /* spec → índice em cellXfs (com o mesmo spec, o mesmo índice) */
  indice(spec = {}) {
    const k = JSON.stringify(spec);
    if (this._chave.has(k)) return this._chave.get(k);
    const al = spec.alin;
    const alin = al ? `<alignment${al.h ? ` horizontal="${al.h}"` : ''}${al.v ? ` vertical="${al.v}"` : ''}${al.quebrar ? ' wrapText="1"' : ''}${al.recuo ? ` indent="${al.recuo}"` : ''}/>` : '';
    const fmt = this._formato(spec.fmt);
    const xf = `<xf numFmtId="${fmt}" fontId="${this._fonte(spec.fonte)}" fillId="${this._fundo(spec.fundo)}" borderId="${this._borda(spec.borda)}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1"' : ''}${alin ? `>${alin}</xf>` : '/>'}`;
    this.xfs.push(xf);
    const i = this.xfs.length - 1;
    this._chave.set(k, i);
    return i;
  }

  /* estilo da formatação condicional (dxf): só fonte, fundo e borda fina */
  dxf(spec = {}) {
    const k = JSON.stringify(spec);
    if (this._dxfChave.has(k)) return this._dxfChave.get(k);
    const f = spec.fonte;
    const fonte = f ? `<font>${f.neg ? '<b/>' : ''}${f.it ? '<i/>' : ''}${f.cor ? `<color rgb="${argb(f.cor)}"/>` : ''}</font>` : '';
    const fundo = spec.fundo ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(spec.fundo)}"/><bgColor rgb="${argb(spec.fundo)}"/></patternFill></fill>` : '';
    const b = spec.borda;
    const lado = (tag, l) => (l ? `<${tag} style="${l.estilo ?? 'thin'}"><color rgb="${argb(l.cor ?? '9CA3AF')}"/></${tag}>` : '');
    const borda = b ? `<border>${lado('left', b.esq)}${lado('right', b.dir)}${lado('top', b.topo)}${lado('bottom', b.base)}</border>` : '';
    this.dxfs.push(`<dxf>${fonte}${fundo}${borda}</dxf>`);
    const i = this.dxfs.length - 1;
    this._dxfChave.set(k, i);
    return i;
  }

  xml() {
    const formatos = [...this.formatos].map(([c, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(c)}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}">`
      + (formatos ? `<numFmts count="${this.formatos.size}">${formatos}</numFmts>` : '')
      + `<fonts count="${this.fontes.length}">${this.fontes.join('')}</fonts>`
      + `<fills count="${this.fundos.length}">${this.fundos.join('')}</fills>`
      + `<borders count="${this.bordas.length}">${this.bordas.join('')}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs>`
      + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
      + '</styleSheet>';
  }
}

/* ------------------------------------------------------------------ abas */

function celulaXml(cel, linha, col, est, textos) {
  if (cel === null || cel === undefined) return '';
  const c = (typeof cel === 'object' && !(cel instanceof Date)) ? cel : { v: cel };
  const s = est.indice(c.e ?? {});
  const r = enderecoDe(linha, col);
  const sa = s ? ` s="${s}"` : '';

  let tipo = c.t;
  const v = c.v;
  if (!tipo) {
    if (v instanceof Date) tipo = 'd';
    else if (typeof v === 'number') tipo = 'n';
    else if (typeof v === 'boolean') tipo = 'b';
    else tipo = 's';
  }
  const vazio = v === null || v === undefined || v === '';

  if (c.f !== undefined && c.f !== null) {
    const f = `<f>${esc(String(c.f).replace(/^=/, ''))}</f>`;
    if (v === undefined || v === null) return `<c r="${r}"${sa}>${f}</c>`;
    if (tipo === 'n' && typeof v === 'number') {
      return Number.isFinite(v) ? `<c r="${r}"${sa}>${f}<v>${v}</v></c>` : `<c r="${r}"${sa}>${f}</c>`;
    }
    if (tipo === 'b') return `<c r="${r}"${sa} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
    return `<c r="${r}"${sa} t="str">${f}<v>${esc(String(v))}</v></c>`;
  }

  if (vazio) return `<c r="${r}"${sa}/>`;
  if (tipo === 'n') {
    const n = Number(v);
    return Number.isFinite(n) ? `<c r="${r}"${sa}><v>${n}</v></c>` : `<c r="${r}"${sa}/>`;
  }
  if (tipo === 'd') {
    const n = serialDaData(v);
    return n === null ? `<c r="${r}"${sa}/>` : `<c r="${r}"${sa}><v>${n}</v></c>`;
  }
  if (tipo === 'b') return `<c r="${r}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
  const texto = String(v).slice(0, 32767);
  return `<c r="${r}"${sa} t="s"><v>${textos.id(texto)}</v></c>`;
}

class TextosCompartilhados {
  constructor() { this.mapa = new Map(); this.total = 0; }
  id(t) {
    this.total += 1;
    if (!this.mapa.has(t)) this.mapa.set(t, this.mapa.size);
    return this.mapa.get(t);
  }
  xml() {
    // xml:space só quando há espaço nas pontas — como o próprio Excel grava.
    const itens = [...this.mapa.keys()].map((t) => `<si><t${/^\s|\s$/.test(t) ? ' xml:space="preserve"' : ''}>${esc(t)}</t></si>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${NS}" count="${this.total}" uniqueCount="${this.mapa.size}">${itens}</sst>`;
  }
}

function validacaoXml(v) {
  const aviso = v.estilo === 'stop' ? '' : ` errorStyle="${v.estilo ?? 'warning'}"`;
  const textoDe = (attr, val) => (val ? ` ${attr}="${esc(String(val).slice(0, /Title$/.test(attr) ? 32 : 255))}"` : '');
  const base = ` type="${v.tipo}"${aviso}${v.operador ? ` operator="${v.operador}"` : ''} allowBlank="1" showInputMessage="${v.dica ? 1 : 0}" showErrorMessage="1"`
    + `${textoDe('errorTitle', v.erroTitulo)}${textoDe('error', v.erro)}${textoDe('promptTitle', v.dicaTitulo)}${textoDe('prompt', v.dica)} sqref="${v.intervalo}"`;
  let f1; let f2 = '';
  if (v.tipo === 'list') f1 = `"${esc(v.lista.join(','))}"`;
  else { f1 = esc(String(v.de)); if (v.ate !== undefined) f2 = `<formula2>${esc(String(v.ate))}</formula2>`; }
  return `<dataValidation${base}><formula1>${f1}</formula1>${f2}</dataValidation>`;
}

function abaXml(aba, est, textos, selecionada) {
  const linhas = aba.linhas ?? [];
  let maxCol = 0;
  const sd = [];
  linhas.forEach((ln, i) => {
    if (!ln) return;
    const celulas = Array.isArray(ln) ? ln : (ln.c ?? []);
    const altura = Array.isArray(ln) ? null : ln.altura;
    let xml = '';
    celulas.forEach((cel, j) => {
      const x = celulaXml(cel, i, j, est, textos);
      if (x) { xml += x; maxCol = Math.max(maxCol, j + 1); }
    });
    if (!xml && !altura) return;
    sd.push(`<row r="${i + 1}"${altura ? ` ht="${altura}" customHeight="1"` : ''}>${xml}</row>`);
  });
  const maxLinha = linhas.length;
  maxCol = Math.max(maxCol, (aba.colunas ?? []).length);

  const partes = [];
  const props = `${aba.corAba ? `<tabColor rgb="${argb(aba.corAba)}"/>` : ''}${aba.impressao?.ajustarLargura ? '<pageSetUpPr fitToPage="1"/>' : ''}`;
  if (props) partes.push(`<sheetPr>${props}</sheetPr>`);
  partes.push(`<dimension ref="A1:${enderecoDe(Math.max(maxLinha - 1, 0), Math.max(maxCol - 1, 0))}"/>`);

  const z = aba.zoom ?? 100;
  const cg = aba.congelar;
  let painel = '';
  if (cg && (cg.linhas || cg.colunas)) {
    const x = cg.colunas ?? 0; const y = cg.linhas ?? 0;
    const topo = enderecoDe(y, x);
    const ativo = x && y ? 'bottomRight' : (y ? 'bottomLeft' : 'topRight');
    painel = `<pane${x ? ` xSplit="${x}"` : ''}${y ? ` ySplit="${y}"` : ''} topLeftCell="${topo}" activePane="${ativo}" state="frozen"/>`;
    if (x && y) painel += `<selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${topo}" sqref="${topo}"/>`;
    else painel += `<selection pane="${ativo}" activeCell="${topo}" sqref="${topo}"/>`;
  }
  partes.push(`<sheetViews><sheetView${aba.grade === false ? ' showGridLines="0"' : ''}${selecionada ? ' tabSelected="1"' : ''} zoomScale="${z}" zoomScaleNormal="${z}" workbookViewId="0">${painel}</sheetView></sheetViews>`);
  partes.push('<sheetFormatPr defaultRowHeight="15"/>');

  const cols = (aba.colunas ?? []).map((c, i) => (c ? `<col min="${i + 1}" max="${i + 1}" width="${c.larg ?? 10}" customWidth="1"${c.oculta ? ' hidden="1"' : ''}/>` : '')).join('');
  if (cols) partes.push(`<cols>${cols}</cols>`);
  partes.push(`<sheetData>${sd.join('')}</sheetData>`);
  if (aba.filtro) partes.push(`<autoFilter ref="${aba.filtro}"/>`);
  if (aba.mesclar?.length) partes.push(`<mergeCells count="${aba.mesclar.length}">${aba.mesclar.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);

  let prioridade = 1;
  for (const grupo of aba.condicionais ?? []) {
    const regras = grupo.regras.map((r) => {
      if (r.barra) {
        return `<cfRule type="dataBar" priority="${prioridade++}"><dataBar><cfvo type="num" val="${r.barra.min ?? 0}"/><cfvo type="num" val="${r.barra.max ?? 1}"/><color rgb="${argb(r.barra.cor)}"/></dataBar></cfRule>`;
      }
      return `<cfRule type="expression" dxfId="${est.dxf(r.estilo)}" priority="${prioridade++}"${r.parar ? ' stopIfTrue="1"' : ''}><formula>${esc(String(r.formula).replace(/^=/, ''))}</formula></cfRule>`;
    }).join('');
    partes.push(`<conditionalFormatting sqref="${grupo.intervalo}">${regras}</conditionalFormatting>`);
  }
  if (aba.validacoes?.length) partes.push(`<dataValidations count="${aba.validacoes.length}">${aba.validacoes.map(validacaoXml).join('')}</dataValidations>`);

  const imp = aba.impressao;
  if (imp?.centralizar) partes.push('<printOptions horizontalCentered="1"/>');
  partes.push('<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.55" header="0.3" footer="0.3"/>');
  if (imp) {
    partes.push(`<pageSetup paperSize="9" orientation="${imp.orientacao ?? 'landscape'}"${imp.ajustarLargura ? ' fitToWidth="1" fitToHeight="0"' : ''}/>`);
    if (imp.rodape) partes.push(`<headerFooter><oddFooter>${esc(imp.rodape)}</oddFooter></headerFooter>`);
  }
  if (aba.ignorarAvisos && maxLinha) {
    partes.push(`<ignoredErrors><ignoredError sqref="A1:${enderecoDe(maxLinha - 1, Math.max(maxCol - 1, 0))}" numberStoredAsText="1" formula="1" formulaRange="1" unlockedFormula="1"/></ignoredErrors>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}" xmlns:r="${NS_R}">${partes.join('')}</worksheet>`;
}

const NOME_PROIBIDO = /[\\/?*[\]:]/;

export function escreverXlsx({ titulo = '', autor = 'Painel Suinco', geradoEm = new Date(), abas }) {
  if (!Array.isArray(abas) || !abas.length) throw new Error('escreverXlsx: sem abas');
  const nomes = new Set();
  for (const a of abas) {
    if (!a.nome || a.nome.length > 31 || NOME_PROIBIDO.test(a.nome) || nomes.has(a.nome.toLowerCase())) {
      throw new Error(`escreverXlsx: nome de aba inválido ou repetido: "${a.nome}"`);
    }
    nomes.add(a.nome.toLowerCase());
  }
  const quando = geradoEm instanceof Date ? geradoEm : new Date(geradoEm);
  const iso = quando.toISOString().replace(/\.\d+Z$/, 'Z');

  const est = new Estilos();
  const textos = new TextosCompartilhados();
  const planilhas = abas.map((a, i) => abaXml(a, est, textos, i === 0));

  const nomesDefinidos = abas.map((a, i) => {
    const r = a.impressao?.repetirLinhas;
    return r ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(a.nome)}'!$${r[0]}:$${r[1]}</definedName>` : '';
  }).join('');

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${NS_R}">`
    + '<workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000" activeTab="0"/></bookViews>'
    + `<sheets>${abas.map((a, i) => `<sheet name="${esc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + (nomesDefinidos ? `<definedNames>${nomesDefinidos}</definedNames>` : '')
    + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';

  const n = abas.length;
  const relWorkbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + abas.map((a, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + '</Relationships>';

  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + abas.map((a, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>';

  const relRaiz = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    + '</Relationships>';

  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${esc(titulo)}</dc:title><dc:creator>${esc(autor)}</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Painel Suinco</Application></Properties>';

  const opt = { mtime: quando };
  const arquivos = {
    '[Content_Types].xml': [strToU8(tipos), opt],
    '_rels/.rels': [strToU8(relRaiz), opt],
    'docProps/core.xml': [strToU8(core), opt],
    'docProps/app.xml': [strToU8(app), opt],
    'xl/workbook.xml': [strToU8(workbook), opt],
    'xl/_rels/workbook.xml.rels': [strToU8(relWorkbook), opt],
    'xl/styles.xml': [strToU8(est.xml()), opt],
    'xl/sharedStrings.xml': [strToU8(textos.xml()), opt],
  };
  planilhas.forEach((x, i) => { arquivos[`xl/worksheets/sheet${i + 1}.xml`] = [strToU8(x), opt]; });
  return Buffer.from(zipSync(arquivos, { level: 6 }));
}
