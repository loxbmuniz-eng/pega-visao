# -*- coding: utf-8 -*-
"""
Gera Suinco_Fretes_Fora_da_Competencia.html a partir do painel completo.

FONTE ÚNICA: entregaveis/suinco_logistica/Suinco_Painel_Despesas_Frete.html
  (que por sua vez carrega, embutidas, as 10.856 linhas do relatório
   WRVDA551 / Crystal — movimento de 02/01/2026 a 25/08/2026).

REGRA COPIADA DO PAINEL, SEM REINTERPRETAR:
  fora da competência  ⇔  mês da DATA DE EMBARQUE ≠ mês da DATA DE MOVIMENTO
  (linha 604 do painel: todosIdx.filter(i => mesDe(i) !== mesDm(i)))

Se este arquivo e o painel divergirem, o painel manda: ele é a origem.
"""
import json, re, os, datetime, sys

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)))
PAINEL = sys.argv[1] if len(sys.argv) > 1 else \
    '/home/user/pega-visao/entregaveis/suinco_logistica/Suinco_Painel_Despesas_Frete.html'
SAIDA = sys.argv[2] if len(sys.argv) > 2 else \
    '/home/user/pega-visao/entregaveis/suinco_logistica/Suinco_Fretes_Fora_da_Competencia.html'

src = open(PAINEL, encoding='utf-8').read()

i = src.index('const D = ')
j = src.index('\n', i)
D = json.loads(src[i + len('const D = '):j].rstrip().rstrip(';'))

m = re.search(r'src="(data:image/png;base64,[A-Za-z0-9+/=]+)"', src)
LOGO = m.group(1)

L = D['L']
NL = len(L['v'])


# ---------------------------------------------------------------------------
# LGPD — ESTE ARQUIVO SAI DA SUINCO.
#
# No cadastro do ERP, o transportador autônomo é gravado com o CPF dentro do
# NOME ("Fulano de Tal CPF 04625109647"). No painel gerencial, que roda dentro
# de casa, isso passou. Num extrato que vai por e-mail para a contabilidade e
# fica anexado em caixa de entrada, CPF por extenso é dado pessoal circulando
# sem necessidade: quem recebe precisa saber QUEM transportou, não o número do
# documento dele.
#
# A máscara guarda os três dígitos do meio — o suficiente para distinguir dois
# homônimos, nada perto do suficiente para identificar alguém.
#
# A regra é por FORMATO, não por lista de nomes: cadastro novo com CPF novo
# entra mascarado sozinho, sem ninguém precisar lembrar de vir aqui.
# ---------------------------------------------------------------------------
_CPF = re.compile(r'(?<!\d)(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})(?!\d)')


def sem_cpf(nome):
    def mascara(m):
        return '***.%s.***-**' % m.group(2)
    limpo = _CPF.sub(mascara, nome)
    # "Fulano CPF ***.251.***-**" -> "Fulano (CPF ***.251.***-**)"
    limpo = re.sub(r'\s*CPF\s+(\*{3}\.\d{3}\.\*{3}-\*{2})', r' (CPF \1)', limpo, flags=re.I)
    limpo = re.sub(r'\s+(\*{3}\.\d{3}\.\*{3}-\*{2})$', r' (CPF \1)', limpo)
    return re.sub(r'\s{2,}', ' ', limpo).strip()


MASCARADOS = [t['d'] for t in D['transportadoras'] if sem_cpf(t['d']) != t['d']]
BASE = datetime.date(*[int(x) for x in D['meta']['base_iso'].split('-')])
d_de = lambda i: BASE + datetime.timedelta(days=L['de'][i])
d_dm = lambda i: BASE + datetime.timedelta(days=L['dm'][i])
mes  = lambda d: '%04d-%02d' % (d.year, d.month)

fora = [i for i in range(NL) if mes(d_de(i)) != mes(d_dm(i))]
total_recorte = sum(L['v'])
total_fora = sum(L['v'][i] for i in fora)

# ---- só o que sai daqui para o arquivo novo ----
P = {
    'meta': {
        'total_recorte': total_recorte,
        'total_fora': total_fora,
        'linhas_recorte': NL,
        'linhas_fora': len(fora),
        'movto_de': D['meta']['movto_de'],
        'movto_ate': D['meta']['movto_ate'],
        'base_iso': D['meta']['base_iso'],
        'mes_incompleto': D['meta']['mes_incompleto'],
    },
    'itens': D['itens'], 'regionais': D['regionais'],
    'transportadoras': [{'c': t['c'], 'd': sem_cpf(t['d'])} for t in D['transportadoras']],
    'filiais': D['filiais'],
    'doctos': D['doctos'], 'principais': D['principais'],
    'retrabalho': D['retrabalho'],
    'L': {k: [L[k][i] for i in fora] for k in ('dm','de','fi','do','nd','nc','it','rg','tr','v')},
}

dados = json.dumps(P, ensure_ascii=False, separators=(',', ':'))

CSS = """
:root{
  --bg:#0D1017; --surface:#151B26; --surface2:#1B2331; --line:#28324a;
  --gold:#E3A93C; --gold-soft:#C99433; --wine:#C04A60; --wine-deep:#8E2A3C;
  --navy:#33507e; --blue:#5B84C4; --green:#5FB57A;
  --text:#F1EDE3; --muted:#9AA6BC; --focus:#FFD97A;
  --fs:16px;
  color-scheme:dark;
}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:var(--fs)}
body{background:var(--bg);color:var(--text);
  font-family:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  line-height:1.45;padding-bottom:4rem}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
button,select,input{font-family:inherit}

header{background:linear-gradient(135deg,#101625 0%,#0D1017 55%,#171208 100%);
  border-bottom:2px solid var(--gold-soft);padding:1.4rem 2rem 1.2rem}
.header-top{display:flex;align-items:center;gap:1.2rem;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:.7rem}
.logo-chip{background:#F7F4EC;border-radius:14px;padding:.35rem .6rem;
  border:1px solid var(--gold-soft);display:flex;align-items:center;justify-content:center}
.logo-chip img{height:62px;width:auto;display:block}
.logo-name small{display:block;font-size:.66rem;letter-spacing:.26em;color:var(--gold);
  font-weight:800;text-transform:uppercase;max-width:130px;line-height:1.6}
.title-block{flex:1;min-width:260px}
h1{font-size:1.35rem;font-weight:800;letter-spacing:-.01em}
.subtitle{color:var(--muted);font-size:.85rem;margin-top:.15rem}
.periodo-chip{background:var(--surface2);border:1px solid var(--line);border-radius:999px;
  padding:.4rem .95rem;font-size:.78rem;color:var(--gold);font-weight:700;white-space:nowrap}
.a11y{display:flex;gap:.3rem}
.a11y button{background:var(--surface2);border:1px solid var(--line);color:var(--text);
  border-radius:8px;width:2.1rem;height:2.1rem;font-weight:700;cursor:pointer;
  transition:transform 140ms cubic-bezier(.23,1,.32,1),border-color 140ms ease}
.a11y button:hover{border-color:var(--gold-soft)}
.a11y button:active{transform:scale(.94)}

main{padding:1.3rem 2rem 0;max-width:1680px;margin:0 auto}

.regra{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--gold);
  border-radius:10px;padding:1rem 1.15rem;margin-bottom:1.2rem}
.regra h2{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);
  font-weight:800;margin-bottom:.5rem}
.regra p{font-size:.9rem;color:var(--text);max-width:88ch}
.regra p+p{margin-top:.5rem}
.regra .mut{color:var(--muted);font-size:.83rem}
.regra code{background:var(--surface2);border:1px solid var(--line);border-radius:5px;
  padding:.05rem .35rem;color:var(--gold);font-size:.85em}

.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:.85rem;margin-bottom:1.2rem}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:.9rem 1rem}
.kpi.gold{border-top:3px solid var(--gold)}
.kpi.wine{border-top:3px solid var(--wine)}
.kpi.navy{border-top:3px solid var(--blue)}
.k-label{font-size:.7rem;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);font-weight:700}
.k-value{font-size:1.55rem;font-weight:800;margin-top:.25rem;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.k-sub{font-size:.75rem;color:var(--muted);margin-top:.3rem;line-height:1.35}
.k-sub strong{color:var(--gold)}

.filters{display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-end;
  background:var(--surface);border:1px solid var(--line);border-radius:10px;
  padding:.85rem 1rem;margin-bottom:1.2rem}
.filter{display:flex;flex-direction:column;gap:.25rem;min-width:150px}
.filter label{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}
.filter select,.filter input{background:var(--surface2);border:1px solid var(--line);color:var(--text);
  border-radius:8px;padding:.45rem .6rem;font-size:.85rem;min-height:2.3rem}
.filter.wide{flex:1;min-width:230px}
.filter.periodo{min-width:auto}
.periodo-campos{display:flex;align-items:center;gap:.4rem}
.periodo-campos input[type=date]{background:var(--surface2);border:1px solid var(--line);color:var(--text);
  border-radius:8px;padding:.45rem .5rem;font-size:.85rem;min-height:2.3rem;width:9.2rem;max-width:100%}
.periodo-campos span{color:var(--muted);font-size:.8rem;font-weight:700}
.faixa-aviso{font-size:.7rem;color:var(--muted);margin-top:.25rem}
.faixa-aviso.ativo{color:var(--gold);font-weight:700}
.btn{background:var(--surface2);border:1px solid var(--line);color:var(--text);border-radius:8px;
  padding:.5rem .95rem;font-size:.82rem;font-weight:700;cursor:pointer;min-height:2.3rem;
  transition:transform 140ms cubic-bezier(.23,1,.32,1),border-color 140ms ease}
.btn:hover{border-color:var(--gold-soft)}
.btn:active{transform:scale(.97)}
.btn.gold{background:var(--gold);color:#17120A;border-color:var(--gold)}

.grid{display:grid;gap:1rem;margin-bottom:1.2rem}
.g2{grid-template-columns:1fr;align-items:start}
@media (min-width:900px){.g2{grid-template-columns:repeat(2,1fr)}}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:1rem 1.1rem}
.card h3{font-size:.78rem;letter-spacing:.13em;text-transform:uppercase;color:var(--gold);
  font-weight:800;margin-bottom:.15rem}
.card .hint{font-size:.76rem;color:var(--muted);margin-bottom:.8rem}
.chart-wrap{width:100%;overflow-x:auto}
svg{display:block;max-width:100%}
svg text{font-family:"Segoe UI",Roboto,Arial,sans-serif}

.tabela-topo{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:.6rem}
.tabela-topo>*{min-width:0}
.tabela-topo .cnt{font-size:.8rem;color:var(--muted)}
.soma-strip{background:var(--surface2);border:1px solid var(--gold-soft);border-radius:10px;
  padding:.5rem .9rem;font-size:.9rem;font-variant-numeric:tabular-nums;max-width:100%}
.soma-strip b{color:var(--gold);font-size:1.15rem;font-weight:800}
tfoot td{position:sticky;bottom:0;background:var(--surface2);border-top:2px solid var(--gold-soft);
  padding:.55rem .6rem;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
tfoot td.rot{color:var(--gold);letter-spacing:.06em;text-transform:uppercase;font-size:.7rem}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:.8rem}
thead th{position:sticky;top:0;background:var(--surface2);color:var(--gold);text-align:left;
  padding:.55rem .6rem;font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;
  border-bottom:1px solid var(--line);cursor:pointer;white-space:nowrap;z-index:2}
thead th .ar{color:var(--muted);font-weight:400}
tbody td{padding:.44rem .6rem;border-bottom:1px solid rgba(40,50,74,.55);white-space:nowrap}
tbody tr:hover td{background:var(--surface2)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.txt{white-space:normal;min-width:170px}
.tag{display:inline-block;border-radius:999px;padding:.05rem .5rem;font-size:.68rem;font-weight:700;
  border:1px solid;white-space:nowrap}
.tag.atraso{color:var(--gold);border-color:var(--gold-soft);background:rgba(227,169,60,.10)}
.tag.antigo{color:var(--blue);border-color:var(--navy);background:rgba(91,132,196,.12)}
.tag.impossivel{color:#F0A3B0;border-color:var(--wine);background:rgba(192,74,96,.14)}
.mais{padding:.75rem;text-align:center;color:var(--muted);font-size:.8rem}

footer{max-width:1680px;margin:1.6rem auto 0;padding:0 2rem;color:var(--muted);font-size:.76rem;line-height:1.6}
footer strong{color:var(--gold)}
footer .nota-lgpd{border-left:3px solid var(--line);padding-left:.7rem;margin-top:.5rem}

@media (max-width:760px){
  header{padding:1rem}
  /* flex:1 tem base 0 — sem a base 100% o campo de busca fica espremido ao
     lado dos botões em vez de ocupar a linha dele. */
  .filter,.filter.wide,.filter.periodo{flex:1 1 100%;min-width:0;width:100%}
  .periodo-campos{flex-wrap:wrap}
  .periodo-campos input[type=date]{flex:1 1 8rem;width:auto}
  .btn{flex:1 1 calc(50% - .35rem)}
  main{padding:1rem 1rem 0}
  footer{padding:0 1rem}
  .logo-chip img{height:44px}
  .g2{grid-template-columns:1fr}
}
@media print{
  body{background:#fff;color:#111}
  .filters,.a11y,.btn{display:none}
  .card,.kpi,.regra,.tw{border-color:#bbb;background:#fff}
  .k-value,h1,.card h3,.regra h2{color:#111}
}
"""

JS = r"""
const D = __DADOS__;
const L = D.L, N = L.v.length;
const $ = id => document.getElementById(id);
const BASE_MS = Date.parse(D.meta.base_iso + 'T00:00:00');
const DIA = 86400000;
const MESPT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const C = {gold:'#E3A93C', goldSoft:'#C99433', wine:'#C04A60', blue:'#5B84C4',
           navy:'#33507e', line:'#28324a', muted:'#9AA6BC', text:'#F1EDE3', surface2:'#1B2331'};

const fmtBRL  = c => 'R$ ' + (c/100).toLocaleString('pt-BR',{maximumFractionDigits:0});
const fmtBRL2 = c => 'R$ ' + (c/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN    = n => Number(n).toLocaleString('pt-BR');
const fmtPct  = x => (100*x).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%';
const dDe = i => new Date(BASE_MS + L.de[i]*DIA);
const dDm = i => new Date(BASE_MS + L.dm[i]*DIA);
const dBR = d => d.toLocaleDateString('pt-BR');
const mes = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const mesDe = i => mes(dDe(i)), mesDm = i => mes(dDm(i));
const rotMes = m => { const [a,b] = m.split('-'); return MESPT[+b-1] + '/' + a.slice(2); };
const lag = i => L.dm[i] - L.de[i];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* Três casos, e cada um pede uma providência diferente.
   'impossivel' é embarque DEPOIS do lançamento: não existe na operação,
   é data errada na origem. Fica visível em vez de virar média. */
function caso(i){
  if (lag(i) < 0) return 'impossivel';
  if (mesDe(i) < '2026-01') return 'antigo';
  return 'atraso';
}
const CASO_ROT = {atraso:'Atraso de lançamento', antigo:'Embarque antes de 2026', impossivel:'Data impossível'};

const F = {deIni:'', deFim:'', mesDm:'', caso:'', filial:'', item:'', tra:'', reg:'', busca:''};

/* Data em ISO (aaaa-mm-dd) porque é assim que o <input type=date> entrega o
   valor, e comparação de texto em ISO é a mesma coisa que comparação de data
   — sem construir Date nenhum dentro do laço, que roda 3.211 vezes por filtro. */
const isoDe = i => { const d = dDe(i);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const ISO_DE = Array.from({length:N},(_,i)=>isoDe(i));
const soma = idx => idx.reduce((a,i)=>a+L.v[i],0);
/* Algum filtro está de pé? É o que decide se o número mostrado é "o total"
   ou "a soma do que você pediu" — dizer "total" com filtro ligado é a forma
   mais rápida de alguém levar um número errado para uma reunião. */
const filtrado = () => Object.values(F).some(v => v !== '');

function porChave(idx, f){
  const m = new Map();
  for(const i of idx) m.set(f(i), (m.get(f(i))||0) + L.v[i]);
  return m;
}

function filtrar(){
  const b = F.busca.trim().toLowerCase();
  const out = [];
  for(let i=0;i<N;i++){
    /* Intervalo de EMBARQUE, e só de embarque. As duas pontas entram: pedir
       "01/03 até 31/03" tem que trazer o que embarcou dia 31. */
    if(F.deIni && ISO_DE[i] < F.deIni) continue;
    if(F.deFim && ISO_DE[i] > F.deFim) continue;
    if(F.mesDm && mesDm(i) !== F.mesDm) continue;
    if(F.caso && caso(i) !== F.caso) continue;
    if(F.filial && D.filiais[L.fi[i]] !== F.filial) continue;
    if(F.item !== '' && L.it[i] !== +F.item) continue;
    if(F.tra !== '' && L.tr[i] !== +F.tra) continue;
    if(F.reg !== '' && L.rg[i] !== +F.reg) continue;
    if(b){
      const alvo = (D.doctos[L.do[i]] + ' ' + L.nd[i] + ' ' + L.nc[i] + ' ' +
                    D.itens[L.it[i]].d + ' ' + D.regionais[L.rg[i]].d + ' ' +
                    D.transportadoras[L.tr[i]].d).toLowerCase();
      if(!alvo.includes(b)) continue;
    }
    out.push(i);
  }
  return out;
}

/* ---------- barras, desenhadas à mão: o arquivo tem que abrir sem internet ---------- */
function barrasV(el, dados, opts){
  const W = Math.max(el.clientWidth || 640, 320), H = opts.h || 230;
  const ml = 74, mr = 12, mt = 16, mb = 42;
  const iw = W - ml - mr, ih = H - mt - mb;
  const max = Math.max(1, ...dados.map(d=>d.v));
  const n = dados.length || 1;
  const passo = iw / n, bw = Math.min(passo * 0.62, 78);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.alt||'')}">`;
  for(let g=0; g<=4; g++){
    const y = mt + ih - (ih*g/4), val = max*g/4;
    s += `<line x1="${ml}" y1="${y}" x2="${W-mr}" y2="${y}" stroke="${C.line}" stroke-opacity=".55"/>`;
    s += `<text x="${ml-8}" y="${y+4}" text-anchor="end" font-size="10.5" fill="${C.muted}">${esc(opts.fmtY(val))}</text>`;
  }
  dados.forEach((d,k)=>{
    const h = Math.max(2, ih * d.v / max);
    const x = ml + passo*k + (passo-bw)/2, y = mt + ih - h;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4" fill="${d.cor||C.gold}"><title>${esc(d.rot)}: ${esc(opts.fmtT(d.v))}${d.n!=null?' · '+fmtN(d.n)+' lançamento(s)':''}</title></rect>`;
    if(bw >= 30) s += `<text x="${x+bw/2}" y="${y-5}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.text}">${esc(opts.fmtR(d.v))}</text>`;
    s += `<text x="${x+bw/2}" y="${H-24}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(d.rot)}</text>`;
    if(d.n!=null) s += `<text x="${x+bw/2}" y="${H-10}" text-anchor="middle" font-size="10" fill="${C.muted}" opacity=".8">${fmtN(d.n)}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}

function barrasH(el, dados, opts){
  const W = Math.max(el.clientWidth || 640, 320);
  const linha = 26, mr = 96, mt = 6;
  const maior = dados.reduce((a,d)=>Math.max(a, d.rot.length), 0);
  const ml = Math.min(Math.round(W*0.45), Math.max(110, Math.round(maior*6.35) + 14));
  const H = mt + dados.length*linha + 8;
  const iw = W - ml - mr;
  const max = Math.max(1, ...dados.map(d=>d.v));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.alt||'')}">`;
  dados.forEach((d,k)=>{
    const y = mt + k*linha, bh = 15;
    const bw = Math.max(2, iw * d.v / max);
    const lim = Math.max(12, Math.floor((ml-12)/6.4));
    const rot = d.rot.length > lim ? d.rot.slice(0,lim-1) + '…' : d.rot;
    s += `<text x="${ml-9}" y="${y+bh-2}" text-anchor="end" font-size="11" fill="${C.text}">${esc(rot)}<title>${esc(d.rot)}</title></text>`;
    s += `<rect x="${ml}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="${d.cor||C.gold}"><title>${esc(d.rot)}: ${esc(opts.fmtT(d.v))}${d.n!=null?' · '+fmtN(d.n)+' lançamento(s)':''}</title></rect>`;
    s += `<text x="${ml+bw+8}" y="${y+bh-2}" font-size="10.5" font-weight="700" fill="${C.text}">${esc(opts.fmtR(d.v))}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}

/* ---------- KPIs ---------- */
function kpis(idx){
  const v = soma(idx);
  $('kValor').textContent = fmtBRL2(v);
  $('kValorLabel').textContent = filtrado() ? 'Valor somado no filtro' : 'Valor fora da competência';
  $('kValorSub').innerHTML = filtrado()
    ? `<strong>${fmtPct(v / D.meta.total_fora)}</strong> dos ${fmtBRL(D.meta.total_fora)} fora da competência · ${fmtPct(v / D.meta.total_recorte)} de todo o frete do recorte`
    : `<strong>${fmtPct(v / D.meta.total_recorte)}</strong> dos ${fmtBRL(D.meta.total_recorte)} de frete do recorte`;
  $('kLanc').textContent = fmtN(idx.length);
  const cargas = new Set(idx.map(i=>L.nc[i])).size;
  const docs = new Set(idx.map(i=>D.doctos[L.do[i]] + L.nd[i])).size;
  $('kLancSub').innerHTML = `<strong>${fmtN(cargas)}</strong> carga(s) · ${fmtN(docs)} documento(s)`;
  const lags = idx.map(lag).filter(x=>x>=0);
  const medio = lags.length ? lags.reduce((a,b)=>a+b,0)/lags.length : 0;
  $('kLag').textContent = lags.length ? medio.toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' d' : '–';
  const pior = lags.length ? Math.max(...lags) : 0;
  $('kLagSub').innerHTML = `pior caso do escopo: <strong>${fmtN(pior)}</strong> dia(s)`;
  const imp = idx.filter(i=>lag(i)<0);
  $('kImp').textContent = fmtN(imp.length);
  $('kImpSub').innerHTML = imp.length
    ? `<strong>${fmtBRL(soma(imp))}</strong> — embarque depois do lançamento: data errada na origem`
    : 'nenhum no escopo atual';
  $('subResumo').textContent =
    `${fmtBRL(v)} em ${fmtN(idx.length)} lançamento(s) no escopo · ${fmtBRL(D.meta.total_fora)} / ${fmtN(D.meta.linhas_fora)} no total fora da competência`;
}

/* ---------- gráficos ---------- */
function gMes(idx){
  const m = new Map();
  for(const i of idx){ const k = mesDm(i); const o = m.get(k) || [0,0]; o[0]+=L.v[i]; o[1]++; m.set(k,o); }
  const dados = [...m.entries()].sort().map(([k,[v,n]])=>({
    rot: rotMes(k), v, n, cor: k === D.meta.mes_incompleto ? C.goldSoft : C.gold}));
  barrasV($('chMes'), dados, {h:250, alt:'Valor fora da competência por mês de lançamento',
    fmtY:fmtBRL, fmtT:fmtBRL2, fmtR:fmtBRL});
}
function gEmbarque(idx){
  /* O embarque vai de 2023 a 2029 — 24 meses no eixo colavam os rótulos uns
     nos outros e o gráfico deixava de ser legível. O que está fora do recorte
     de competência vira uma barra de cada lado; o detalhe mês a mês continua
     inteiro na tabela e no CSV. */
  const ANTES = 'antes de 2026', DEPOIS = 'após ' + rotMes(D.meta.mes_incompleto);
  const balde = i => {
    const m = mesDe(i);
    if(m < '2026-01') return ANTES;
    if(m > D.meta.mes_incompleto) return DEPOIS;
    return m;
  };
  const m = new Map();
  for(const i of idx){ const k = balde(i); const o = m.get(k) || [0,0]; o[0]+=L.v[i]; o[1]++; m.set(k,o); }
  const ord = k => k === ANTES ? '0' : (k === DEPOIS ? 'z' : k);
  const dados = [...m.entries()].sort((a,b)=>ord(a[0]).localeCompare(ord(b[0]))).map(([k,[v,n]])=>({
    rot: k === ANTES || k === DEPOIS ? k : rotMes(k), v, n,
    cor: k === ANTES ? C.blue : (k === DEPOIS ? C.wine : C.gold)}));
  barrasV($('chEmb'), dados, {h:250, alt:'Valor fora da competência por mês de embarque',
    fmtY:fmtBRL, fmtT:fmtBRL2, fmtR:fmtBRL});
}
const FAIXAS = [
  ['1 a 7 dias',       d => d>=1  && d<=7],
  ['8 a 15 dias',      d => d>=8  && d<=15],
  ['16 a 30 dias',     d => d>=16 && d<=30],
  ['31 a 60 dias',     d => d>=31 && d<=60],
  ['61 a 180 dias',    d => d>=61 && d<=180],
  ['mais de 180 dias', d => d>180],
  ['data impossível',  d => d<0],
];
function gFaixa(idx){
  const dados = FAIXAS.map(([rot,f])=>{
    const sel = idx.filter(i=>f(lag(i)));
    return {rot, v:soma(sel), n:sel.length, cor: rot.startsWith('data imposs') ? C.wine : C.gold};
  }).filter(d=>d.n>0);
  barrasH($('chFaixa'), dados, {ml:170, alt:'Valor por faixa de defasagem', fmtT:fmtBRL2, fmtR:fmtBRL});
}
function gTop(el, idx, chave, nomes, cor){
  const m = [...porChave(idx, chave).entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
  const cont = new Map();
  for(const i of idx) cont.set(chave(i), (cont.get(chave(i))||0)+1);
  barrasH($(el), m.map(([k,v])=>({rot:nomes(k), v, n:cont.get(k), cor})),
    {ml:200, alt:'Maiores valores', fmtT:fmtBRL2, fmtR:fmtBRL});
}

/* ---------- tabela ---------- */
let ordem = {k:'v', asc:false}, LIMITE = 500;
const COLS = [
  ['de','Data de embarque'], ['dm','Lançamento'], ['lag','Defasagem'], ['caso','Caso'],
  ['fil','Filial'], ['doc','Documento'], ['carga','Carga'],
  ['item','Item de frete'], ['reg','Regional'], ['tra','Transportadora'], ['v','Valor'],
];
function linhas(idx){
  return idx.map(i=>({
    i, de:dDe(i), dm:dDm(i), lag:lag(i), caso:caso(i),
    fil:D.filiais[L.fi[i]], doc:D.doctos[L.do[i]] + ' ' + L.nd[i], carga:L.nc[i],
    item:D.itens[L.it[i]].d, reg:D.regionais[L.rg[i]].d, tra:D.transportadoras[L.tr[i]].d, v:L.v[i],
  }));
}
function ordenar(rs){
  const k = ordem.k, s = ordem.asc ? 1 : -1;
  return rs.sort((a,b)=>{
    const x = a[k], y = b[k];
    if(x instanceof Date) return s*(x-y);
    if(typeof x === 'number') return s*(x-y);
    return s*String(x).localeCompare(String(y),'pt-BR');
  });
}
function gTabela(idx){
  const rs = ordenar(linhas(idx));
  $('tCabec').innerHTML = COLS.map(([k,r])=>
    `<th data-k="${k}" title="Ordenar por ${esc(r)}">${esc(r)} <span class="ar">${ordem.k===k?(ordem.asc?'▲':'▼'):'↕'}</span></th>`).join('');
  const vis = rs.slice(0, LIMITE);
  $('tCorpo').innerHTML = vis.map(r=>`<tr>
    <td class="num">${dBR(r.de)}</td><td class="num">${dBR(r.dm)}</td>
    <td class="num">${r.lag < 0 ? r.lag : '+'+r.lag} d</td>
    <td><span class="tag ${r.caso}">${esc(CASO_ROT[r.caso])}</span></td>
    <td>${esc(r.fil)}</td><td>${esc(r.doc)}</td><td class="num">${esc(r.carga)}</td>
    <td class="txt">${esc(r.item)}</td><td class="txt">${esc(r.reg)}</td><td class="txt">${esc(r.tra)}</td>
    <td class="num">${fmtBRL2(r.v)}</td></tr>`).join('');
  const somaTudo = rs.reduce((a,r)=>a+r.v, 0);
  /* A soma é de TODAS as linhas do filtro — não das 500 que estão na tela.
     Somar só o que está visível é como um painel mente sem querer. */
  $('tSoma').innerHTML = `Soma do que está filtrado: <b>${fmtBRL2(somaTudo)}</b>` +
    ` <span style="color:var(--muted)">em ${fmtN(rs.length)} lançamento(s)</span>`;
  $('tRodape').innerHTML =
    `<td class="rot" colspan="3">Soma de ${fmtN(rs.length)} lançamento(s)</td>` +
    `<td colspan="7" style="color:var(--muted);font-weight:400">` +
      (filtrado() ? 'todas as linhas do filtro, não só as que estão na tela' : 'tudo que está fora da competência') +
    `</td><td class="num" style="text-align:right;color:var(--gold)">${fmtBRL2(somaTudo)}</td>`;
  $('tCnt').textContent = rs.length > LIMITE
    ? `mostrando ${fmtN(LIMITE)} de ${fmtN(rs.length)} linha(s) — o CSV traz todas`
    : `${fmtN(rs.length)} linha(s)`;
  $('tMais').style.display = rs.length > LIMITE ? '' : 'none';
  $('tMais').textContent = `Mostrar mais ${fmtN(Math.min(500, rs.length-LIMITE))} linha(s)`;
  return rs;
}

let ULTIMAS = [];
function baixarCSV(){
  const cab = ['Data de embarque','Data de lançamento','Defasagem (dias)','Caso','Filial',
               'Documento','Carga','Item de frete','Regional','Transportadora','Valor (R$)'];
  const linha = r => [dBR(r.de), dBR(r.dm), r.lag, CASO_ROT[r.caso], r.fil, r.doc, r.carga,
                      r.item, r.reg, r.tra, (r.v/100).toFixed(2).replace('.',',')]
    .map(c => `"${String(c).replace(/"/g,'""')}"`).join(';');
  const txt = '﻿' + [cab.map(c=>`"${c}"`).join(';'), ...ULTIMAS.map(linha)].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], {type:'text/csv;charset=utf-8'}));
  const faixa = (F.deIni || F.deFim)
    ? '_embarque_' + (F.deIni || 'inicio').replace(/-/g,'') + '_a_' + (F.deFim || 'fim').replace(/-/g,'')
    : '';
  a.download = 'Suinco_fretes_fora_da_competencia' + faixa + '.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}

function render(){
  const idx = filtrar();
  kpis(idx);
  gMes(idx); gEmbarque(idx); gFaixa(idx);
  gTop('chTra', idx, i=>L.tr[i], k=>D.transportadoras[k].d, C.gold);
  gTop('chItem', idx, i=>L.it[i], k=>D.itens[k].d, C.blue);
  gTop('chReg', idx, i=>L.rg[i], k=>D.regionais[k].d, C.gold);
  ULTIMAS = gTabela(idx);
}

/* ---------- montagem dos filtros ---------- */
function opcoes(el, pares, rotTodos){
  $(el).innerHTML = `<option value="">${rotTodos}</option>` +
    pares.map(([v,r])=>`<option value="${esc(v)}">${esc(r)}</option>`).join('');
}
function iniciar(){
  const meses = [...new Set(Array.from({length:N},(_,i)=>mesDm(i)))].sort();
  opcoes('fMes', meses.map(m=>[m, rotMes(m)]), 'Todos os meses');
  opcoes('fCaso', Object.entries(CASO_ROT), 'Todos os casos');
  opcoes('fFilial', [...new Set(Array.from({length:N},(_,i)=>D.filiais[L.fi[i]]))].sort().map(f=>[f,f]), 'Todas');
  const usados = (arr, nomes) => [...new Set(Array.from({length:N},(_,i)=>arr[i]))]
    .map(k=>[k, nomes[k].d]).sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'));
  opcoes('fItem', usados(L.it, D.itens), 'Todos os itens');
  opcoes('fTra',  usados(L.tr, D.transportadoras), 'Todas');
  opcoes('fReg',  usados(L.rg, D.regionais), 'Todas');

  /* Os limites vêm do próprio dado: o embarque mais antigo e o mais novo que
     existem nesta lista. Assim ninguém escolhe um intervalo que não existe. */
  const MIN = ISO_DE.reduce((a,b)=>a<b?a:b), MAX = ISO_DE.reduce((a,b)=>a>b?a:b);
  const brISO = s => s.split('-').reverse().join('/');
  ['fDeIni','fDeFim'].forEach(id=>{ $(id).min = MIN; $(id).max = MAX; });
  function avisoFaixa(){
    const el = $('faixaAviso');
    const ativo = F.deIni || F.deFim;
    el.classList.toggle('ativo', !!ativo);
    if(!ativo){ el.textContent = `embarques de ${brISO(MIN)} a ${brISO(MAX)}`; return; }
    el.textContent = 'embarque ' + (F.deIni ? 'de ' + brISO(F.deIni) + ' ' : 'até ') +
      (F.deIni && F.deFim ? 'até ' + brISO(F.deFim) : (F.deFim && !F.deIni ? brISO(F.deFim) : 'em diante'));
  }
  const ligaData = (id, campo) => $(id).addEventListener('change', e=>{
    F[campo] = e.target.value;
    /* Intervalo invertido não é erro do usuário para punir com lista vazia:
       a outra ponta acompanha, e ele vê o que pediu. */
    if(F.deIni && F.deFim && F.deIni > F.deFim){
      if(campo === 'deIni'){ F.deFim = F.deIni; $('fDeFim').value = F.deFim; }
      else { F.deIni = F.deFim; $('fDeIni').value = F.deIni; }
    }
    LIMITE = 500; avisoFaixa(); render();
  });
  ligaData('fDeIni','deIni'); ligaData('fDeFim','deFim');

  const liga = (id, campo) => $(id).addEventListener('change', e=>{ F[campo] = e.target.value; LIMITE = 500; render(); });
  liga('fMes','mesDm'); liga('fCaso','caso'); liga('fFilial','filial');
  liga('fItem','item'); liga('fTra','tra'); liga('fReg','reg');
  let t; $('fBusca').addEventListener('input', e=>{
    clearTimeout(t); t = setTimeout(()=>{ F.busca = e.target.value; LIMITE = 500; render(); }, 220); });
  $('btLimpar').addEventListener('click', ()=>{
    Object.keys(F).forEach(k=>F[k]='');
    ['fDeIni','fDeFim','fMes','fCaso','fFilial','fItem','fTra','fReg','fBusca'].forEach(id=>$(id).value='');
    LIMITE = 500; avisoFaixa(); render();
  });
  $('btCSV').addEventListener('click', baixarCSV);
  $('tMais').addEventListener('click', ()=>{ LIMITE += 500; render(); });
  $('tCabec').addEventListener('click', e=>{
    const th = e.target.closest('th'); if(!th) return;
    const k = th.dataset.k;
    ordem = (ordem.k === k) ? {k, asc:!ordem.asc} : {k, asc:false};
    render();
  });

  let fs = 16;
  const setFs = v => { fs = Math.min(22, Math.max(13, v)); document.documentElement.style.setProperty('--fs', fs+'px'); render(); };
  $('fontMinus').addEventListener('click', ()=>setFs(fs-1));
  $('fontPlus').addEventListener('click', ()=>setFs(fs+1));
  $('fontReset').addEventListener('click', ()=>setFs(16));

  avisoFaixa();
  let r; addEventListener('resize', ()=>{ clearTimeout(r); r = setTimeout(render, 180); });
  render();
}
iniciar();
"""

HTML = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Suinco &middot; Fretes Fora da Compet&ecirc;ncia &middot; jan&ndash;ago 2026</title>
<style>__CSS__</style>
</head>
<body>

<header>
  <div class="header-top">
    <div class="logo" aria-label="Suinco">
      <div class="logo-chip"><img src="__LOGO__" alt="Suinco"></div>
      <div class="logo-name"><small>Logística · Torre de Controle</small></div>
    </div>
    <div class="title-block">
      <h1>Fretes fora da competência</h1>
      <div class="subtitle">Extrato do Painel de Despesas de Frete · fonte: WRVDA551 (Crystal) · movimento de __DE__ a __ATE__<br>
        <span id="subResumo">–</span></div>
    </div>
    <div class="periodo-chip">Competência: jan–ago/2026</div>
    <div class="a11y" role="group" aria-label="Tamanho da fonte">
      <button id="fontMinus" title="Diminuir fonte">A−</button>
      <button id="fontReset" title="Fonte padrão">A</button>
      <button id="fontPlus" title="Aumentar fonte">A+</button>
    </div>
  </div>
</header>

<main>

<section class="regra">
  <h2>O que entra nesta lista</h2>
  <p>Só os lançamentos de frete em que <strong>o mês do embarque é diferente do mês do lançamento
     contábil</strong> — a carga saiu num mês e o custo dela caiu na contabilidade de outro.
     É a mesma regra do painel completo, sem nenhuma reinterpretação:
     <code>mês(data de embarque) ≠ mês(data de movimento)</code>.</p>
  <p class="mut">A competência do painel é sempre o <strong>mês do movimento</strong>. A data de embarque
     serve para medir a defasagem — não para dizer de que mês é o custo. Enquanto houver linha nesta
     lista, o custo de um mês carrega operação de outro, e a comparação entre meses erra por construção.</p>
  <p class="mut">Os <strong>casos</strong> estão separados porque pedem providências diferentes:
     <span class="tag atraso">Atraso de lançamento</span> é frete de 2026 lançado num mês posterior ao do embarque;
     <span class="tag antigo">Embarque antes de 2026</span> é carga de anos anteriores que só entrou na contabilidade dentro do período — real, e entra na conta;
     <span class="tag impossivel">Data impossível</span> é embarque marcado <em>depois</em> do lançamento, o que não acontece na operação: é data errada na origem, e por isso fica fora do cálculo da defasagem média.</p>
</section>

<section class="kpis">
  <div class="card kpi wine">
    <div class="k-label" id="kValorLabel">Valor fora da competência</div>
    <div class="k-value" id="kValor">–</div>
    <div class="k-sub" id="kValorSub">–</div>
  </div>
  <div class="card kpi gold">
    <div class="k-label">Lançamentos</div>
    <div class="k-value" id="kLanc">–</div>
    <div class="k-sub" id="kLancSub">–</div>
  </div>
  <div class="card kpi navy">
    <div class="k-label">Defasagem média</div>
    <div class="k-value" id="kLag">–</div>
    <div class="k-sub" id="kLagSub">–</div>
  </div>
  <div class="card kpi wine">
    <div class="k-label">Datas impossíveis</div>
    <div class="k-value" id="kImp">–</div>
    <div class="k-sub" id="kImpSub">–</div>
  </div>
</section>

<section class="filters" id="filters">
  <div class="filter periodo">
    <label for="fDeIni">Data de embarque — de … até</label>
    <div class="periodo-campos">
      <input id="fDeIni" type="date" aria-label="Embarque a partir de">
      <span>até</span>
      <input id="fDeFim" type="date" aria-label="Embarque até">
    </div>
    <div class="faixa-aviso" id="faixaAviso">–</div>
  </div>
  <div class="filter"><label for="fMes">Mês do lançamento</label><select id="fMes"></select></div>
  <div class="filter"><label for="fCaso">Caso</label><select id="fCaso"></select></div>
  <div class="filter"><label for="fFilial">Filial</label><select id="fFilial"></select></div>
  <div class="filter"><label for="fItem">Item de frete</label><select id="fItem"></select></div>
  <div class="filter"><label for="fTra">Transportadora</label><select id="fTra"></select></div>
  <div class="filter"><label for="fReg">Regional</label><select id="fReg"></select></div>
  <div class="filter wide"><label for="fBusca">Buscar (documento, carga, item, regional, transportadora)</label>
    <input id="fBusca" type="search" placeholder="ex.: 109026, Reentrega, Maceió…"></div>
  <button class="btn" id="btLimpar">Limpar filtros</button>
  <button class="btn gold" id="btCSV">Baixar CSV</button>
</section>

<section class="grid g2">
  <div class="card">
    <h3>Onde o custo caiu</h3>
    <div class="hint">valor fora da competência por <strong>mês do lançamento contábil</strong> · o número embaixo é a quantidade de lançamentos · ago/2026 é mês incompleto (vai até 25/08)</div>
    <div class="chart-wrap" id="chMes"></div>
  </div>
  <div class="card">
    <h3>De quando é a operação</h3>
    <div class="hint">o mesmo valor, agora pelo <strong>mês do embarque</strong> · azul = embarque anterior a 2026 (uma barra só) · vinho = embarque posterior ao fim do recorte, que é data errada na origem</div>
    <div class="chart-wrap" id="chEmb"></div>
  </div>
</section>

<section class="grid g2">
  <div class="card">
    <h3>Quanto tempo entre embarcar e lançar</h3>
    <div class="hint">defasagem = data do lançamento − data do embarque</div>
    <div class="chart-wrap" id="chFaixa"></div>
  </div>
  <div class="card">
    <h3>Transportadoras — 12 maiores</h3>
    <div class="hint">só o valor que está fora da competência</div>
    <div class="chart-wrap" id="chTra"></div>
  </div>
  <div class="card">
    <h3>Itens de frete — 12 maiores</h3>
    <div class="hint">qual tipo de custo mais atrasa para entrar</div>
    <div class="chart-wrap" id="chItem"></div>
  </div>
  <div class="card">
    <h3>Regionais — 12 maiores</h3>
    <div class="hint">destino da carga cujo custo caiu em outro mês</div>
    <div class="chart-wrap" id="chReg"></div>
  </div>
</section>

<section class="card">
  <div class="tabela-topo">
    <div>
      <h3>Lançamento por lançamento</h3>
      <div class="hint">clique no cabeçalho para ordenar · o CSV sai com <strong>todas</strong> as linhas do filtro atual</div>
    </div>
    <div class="soma-strip" id="tSoma">–</div>
  </div>
  <div class="tabela-topo">
    <div class="cnt" id="tCnt">–</div>
  </div>
  <div class="tw">
    <table>
      <thead><tr id="tCabec"></tr></thead>
      <tbody id="tCorpo"></tbody>
      <tfoot><tr id="tRodape"></tr></tfoot>
    </table>
    <div class="mais"><button class="btn" id="tMais">Mostrar mais</button></div>
  </div>
</section>

</main>

<footer>
  <p><strong>Origem:</strong> relatório <strong>WRVDA551</strong> (Crystal), movimento de __DE__ a __ATE__ —
     __NL__ linhas de frete, __TOTAL__ no total. Deste conjunto, <strong>__NF__ lançamentos</strong>
     (<strong>__VF__</strong>, __PCT__ do frete do período) estão fora da competência.</p>
  <p>Arquivo gerado a partir do <em>Painel de Despesas de Frete por Item</em> da Suinco. Funciona sem internet:
     abra em qualquer navegador. Nenhum valor foi recalculado, arredondado ou estimado aqui — os números são
     os mesmos do painel, apenas recortados pela regra acima.</p>
  <p class="nota-lgpd">__LGPD__</p>
  <p>Gerado em __HOJE__ · Suinco Logística</p>
</footer>

<script>__JS__</script>
</body>
</html>
"""

pct = total_fora / total_recorte
saida = (HTML
    .replace('__CSS__', CSS)
    .replace('__LOGO__', LOGO)
    .replace('__DE__', '%02d/%02d/%04d' % tuple(reversed([int(x) for x in D['meta']['movto_de'].split('-')])))
    .replace('__ATE__', '%02d/%02d/%04d' % tuple(reversed([int(x) for x in D['meta']['movto_ate'].split('-')])))
    .replace('__NL__', '{:,}'.format(NL).replace(',', '.'))
    .replace('__TOTAL__', 'R$ ' + '{:,.2f}'.format(total_recorte/100).replace(',', 'X').replace('.', ',').replace('X', '.'))
    .replace('__NF__', '{:,}'.format(len(fora)).replace(',', '.'))
    .replace('__VF__', 'R$ ' + '{:,.2f}'.format(total_fora/100).replace(',', 'X').replace('.', ',').replace('X', '.'))
    .replace('__PCT__', ('%.2f' % (100*pct)).replace('.', ',') + '%')
    .replace('__HOJE__', datetime.date.today().strftime('%d/%m/%Y'))
    .replace('__LGPD__',
             ('Proteção de dados: o cadastro do ERP grava o transportador autônomo com o CPF dentro do nome. '
              'Neste extrato, que circula fora da empresa, %d nome(s) saem com o CPF mascarado '
              '(***.000.***-**) — o transportador continua identificado pelo nome, o número do documento não '
              'viaja junto.' % len(MASCARADOS)) if MASCARADOS else
             'Proteção de dados: nenhum CPF no conjunto — nada a mascarar.')
    .replace('__JS__', JS.replace('__DADOS__', dados)))

open(SAIDA, 'w', encoding='utf-8').write(saida)
print('OK', SAIDA, len(saida), 'bytes ·', len(fora), 'linhas · R$ %.2f' % (total_fora/100), '· %.2f%%' % (100*pct))
print('CPF mascarado em %d transportadora(s):' % len(MASCARADOS), '; '.join(sem_cpf(n) for n in MASCARADOS) or '—')

# Cinto e suspensório: o arquivo não sai daqui com CPF por extenso.
_sobrou = _CPF.search(re.sub(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+', '', saida))
if _sobrou:
    raise SystemExit('ABORTADO: CPF por extenso no arquivo gerado -> %s' % _sobrou.group(0))
