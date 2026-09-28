/* =====================================================================
   LER UMA PLANILHA .XLS ANTIGA (Excel 97–2003, BIFF8) — 28/09/2026
   ---------------------------------------------------------------------
   Para a importação do relatório WRMVE790 do Sisatak, que sai do Crystal
   Reports no formato .xls antigo.

   POR QUE UM LEITOR PRÓPRIO, E NÃO A BIBLIOTECA DE SEMPRE. O pacote `xlsx`
   do npm (0.18.5, o último publicado lá) tem duas falhas de segurança
   altas conhecidas, e o portão recusa publicar dependência assim. A versão
   corrigida só existe fora do npm. O arquivo .xls é um contêiner (CFB) com
   um fluxo de registros dentro: o contêiner é aberto pelo `cfb`, da mesma
   equipe, sem falha conhecida; os registros de célula são meia dúzia e
   estão abaixo.

   O QUE ESTE LEITOR FAZ: devolve a PRIMEIRA aba como uma lista de linhas,
   cada linha uma lista de células (texto ou número). O que ele não conhece
   (fórmula de texto, erro, data formatada) sai vazio — nunca inventado.
   ===================================================================== */
import CFB from 'cfb';

const BOF = 0x0809, EOF = 0x000a, SST = 0x00fc, CONTINUE = 0x003c;
const LABELSST = 0x00fd, LABEL = 0x0204, NUMBER = 0x0203, RK = 0x027e;
const MULRK = 0x00bd, FORMULA = 0x0006, STRING = 0x0207, BOOLERR = 0x0205;

/* SEM `Buffer`: o mesmo código roda no servidor e no navegador (a vitrine
   lê o arquivo sem servidor nenhum). Bytes são Uint8Array, e os números
   saem por DataView. */
const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const f64 = (b, p) => new DataView(b.buffer, b.byteOffset + p, 8).getFloat64(0, true);
const DEC16 = new TextDecoder('utf-16le');
function latin1(b) {
  let t = '';
  for (let i = 0; i < b.length; i += 4096) t += String.fromCharCode.apply(null, b.subarray(i, i + 4096));
  return t;
}
const texto = (b, largo) => (largo === 2 ? DEC16.decode(b) : latin1(b));

/* O número compactado do Excel: 30 bits de um double ou de um inteiro,
   com o bit 0 dizendo "dividir por 100". */
function lerRk(rk) {
  let n;
  if (rk & 2) {
    n = rk >> 2;
  } else {
    const b = new Uint8Array(8);
    const v = new DataView(b.buffer);
    v.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    n = v.getFloat64(0, true);
  }
  return (rk & 1) ? n / 100 : n;
}

/* Os registros do fluxo, com os CONTINUE de cada um guardados à parte: o
   texto da tabela de strings (SST) atravessa CONTINUE, e ali cada pedaço
   recomeça com um byte que diz se os caracteres são de 1 ou 2 bytes. */
function registros(buf) {
  const out = [];
  let p = 0;
  while (p + 4 <= buf.length) {
    const tipo = u16(buf, p);
    const tam = u16(buf, p + 2);
    const dados = buf.subarray(p + 4, p + 4 + tam);
    p += 4 + tam;
    if (tipo === CONTINUE && out.length) out[out.length - 1].continua.push(dados);
    else out.push({ tipo, dados, continua: [] });
  }
  return out;
}

/* A tabela de strings compartilhadas. Lê atravessando os pedaços. */
function lerSst(reg) {
  const pedacos = [reg.dados, ...reg.continua];
  let i = 0, p = 8;
  const total = u32(reg.dados, 4);
  const disponivel = () => pedacos[i].length - p;
  const proximo = () => { i++; p = 0; };
  const le8 = () => { if (disponivel() < 1) proximo(); return pedacos[i][p++]; };
  const le16 = () => { if (disponivel() < 2) proximo(); const v = u16(pedacos[i], p); p += 2; return v; };
  const le32 = () => { if (disponivel() < 4) proximo(); const v = u32(pedacos[i], p); p += 4; return v; };
  const pular = (n) => {
    while (n > 0) {
      if (disponivel() <= 0) proximo();
      const k = Math.min(n, disponivel());
      p += k; n -= k;
    }
  };
  const strings = [];
  for (let s = 0; s < total && i < pedacos.length; s++) {
    if (disponivel() <= 0) { if (i + 1 >= pedacos.length) break; proximo(); }
    const cch = le16();
    let flags = le8();
    let runs = 0, ext = 0;
    if (flags & 0x08) runs = le16();
    if (flags & 0x04) ext = le32();
    let t = '', faltam = cch;
    while (faltam > 0) {
      if (disponivel() <= 0) { proximo(); flags = le8(); }   // o pedaço novo diz a largura
      const largo = (flags & 0x01) ? 2 : 1;
      const cabem = Math.min(faltam, Math.floor(disponivel() / largo));
      const bytes = pedacos[i].subarray(p, p + cabem * largo);
      t += texto(bytes, largo);
      p += cabem * largo; faltam -= cabem;
    }
    pular(runs * 4 + ext);
    strings.push(t);
  }
  return strings;
}

function lerTextoCurto(dados, p) {
  const cch = u16(dados, p);
  const largo = (dados[p + 2] & 0x01) ? 2 : 1;
  return texto(dados.subarray(p + 3, p + 3 + cch * largo), largo);
}

/* A primeira aba como lista de linhas. Recusa com mensagem o que não é
   .xls — quem manda um .xlsx ou um PDF precisa saber o que mandar. `CFB` é
   o leitor do contêiner: no servidor, o import acima; na vitrine, o mesmo
   pacote carregado na página. */
export function lerPrimeiraAbaXls(buffer, leitorCfb = CFB) {
  let cfb;
  try { cfb = leitorCfb.read(buffer, { type: 'buffer' }); } catch (e) {
    throw new Error('O arquivo não é uma planilha .xls (Excel 97–2003). Exporte do Sisatak em "Excel (.xls)".');
  }
  const ent = leitorCfb.find(cfb, 'Workbook') || leitorCfb.find(cfb, 'Book');
  if (!ent || !ent.content) {
    throw new Error('O arquivo não tem a pasta de trabalho do Excel dentro. Exporte do Sisatak em "Excel (.xls)".');
  }
  return linhasDoFluxoXls(new Uint8Array(ent.content));
}

/* O fluxo de registros da pasta de trabalho → a primeira aba. */
export function linhasDoFluxoXls(fluxo) {
  const regs = registros(fluxo);
  let sst = [];
  const linhas = [];
  const por = (r, c, v) => {
    while (linhas.length <= r) linhas.push([]);
    const l = linhas[r];
    while (l.length <= c) l.push('');
    l[c] = v;
  };
  let naAba = false, formulaTexto = null;
  for (const reg of regs) {
    const d = reg.dados;
    if (reg.tipo === SST) { sst = lerSst(reg); continue; }
    if (reg.tipo === BOF) {
      const tipoBof = d.length >= 4 ? u16(d, 2) : 0;
      if (tipoBof === 0x0010) naAba = true;       // a primeira planilha
      continue;
    }
    if (!naAba) continue;
    if (reg.tipo === EOF) break;                   // só a primeira aba
    switch (reg.tipo) {
      case LABELSST: por(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? ''); break;
      case LABEL: por(u16(d, 0), u16(d, 2), lerTextoCurto(d, 6)); break;
      case NUMBER: por(u16(d, 0), u16(d, 2), f64(d, 6)); break;
      case RK: por(u16(d, 0), u16(d, 2), lerRk(u32(d, 6))); break;
      case MULRK: {
        const r = u16(d, 0);
        let c = u16(d, 2);
        for (let p = 4; p + 6 <= d.length - 2; p += 6, c++) por(r, c, lerRk(u32(d, p + 2)));
        break;
      }
      case FORMULA: {
        const r = u16(d, 0), c = u16(d, 2);
        if (u16(d, 12) === 0xffff) {
          formulaTexto = d[6] === 0 ? { r, c } : null;   // o texto vem no próximo STRING
        } else {
          por(r, c, f64(d, 6));
        }
        break;
      }
      case STRING:
        if (formulaTexto) { por(formulaTexto.r, formulaTexto.c, lerTextoCurto(d, 0)); formulaTexto = null; }
        break;
      case BOOLERR: break;
      default: break;
    }
  }
  return linhas;
}
