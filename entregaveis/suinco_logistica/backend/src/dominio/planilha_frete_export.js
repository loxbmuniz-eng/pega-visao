/* =====================================================================
   A PLANILHA DE CONTROLE DE PAGAMENTO DE FRETE, GERADA PELO PAINEL —
   05/10/2026
   ---------------------------------------------------------------------
   Pedido do dono: a planilha exportada pelo painel tem de seguir o modelo
   que a Daniela mantinha à mão (Controle_Cargas__B2B.xlsx), melhorada e
   APROVADA por ele antes de ir ao ar. O que ele aprova é o arquivo que
   este módulo gera — o botão "Exportar planilha" chama a MESMA função que
   gerou o modelo de exemplo (uma função, dois chamadores).

   O QUE FICA IGUAL À PLANILHA DELA: a aba CONTROLE_CARGAS, com as colunas
   A–P no mesmo lugar e com os mesmos nomes; uma carga ocupa várias linhas
   (a primeira traz as contagens, cada pendência vai numa linha com a nota e
   o status no B2B); a aba RESUMO; as cores da Situação e da Diferença.

   O QUE MELHORA (cada item corrige algo que se viu na planilha real):
     · Diferença, Situação e Status p/ pagamento são FÓRMULA — não se digita
       mais (2 das 65 Situações estavam marcadas à mão e erradas);
     · o RESUMO conta CARGAS, não linhas ("Total de Cargas" dizia 180; eram
       33) e cobre todas as cargas, não só a primeira aba;
     · "OK 30/09" (status + data no mesmo texto) vira Status Pendência "OK"
       + coluna Data Tratativa; observação ("MANDAR FOTO") sai da coluna do
       CT-E e vai para a coluna Observação;
     · "PARCIAL" passa a dizer QUANTO: colunas % Entregue, % Liberado, % Pago
       e A pagar agora (tudo pela quantidade de notas, sem valor em R$);
     · datas em dd/mm/aaaa (era mm-dd-yy, o formato americano), painel
       congelado no cabeçalho (estava congelado na linha 160), filtro em todas
       as colunas (não pegava o CT-E), uma fonte só (eram duas);
     · lista de escolha no Status Pendência, validação em data e em
       percentual, e a pendência que ninguém olhou ainda fica marcada.

   AS FÓRMULAS TÊM RESULTADO GRAVADO, calculado por `indicadoresDaCarga` — a
   mesma regra da tela. Se a conta da fórmula e a do painel divergirem, o
   teste reprova.
   ===================================================================== */
import { escreverXlsx } from '../servicos/planilha_xlsx_escrita.js';
import {
  indicadoresDaCarga, rotuloDaPendencia, TRATATIVAS, TRATATIVAS_QUE_LIBERAM,
} from './pagamento_frete.js';

const C = {
  navy: '1E2A52', navyFundo: '101625', ouro: 'E9B954', ouroEscuro: 'B9903F', aco: '3E5C86',
  tinta: '1F2937', muda: '6B7280', apagada: '9CA3AF', linha: 'D5DAE5', faixa: 'F3F5FA', branco: 'FFFFFF',
  verdeFundo: 'C6EFCE', verdeTexto: '0B5D2A', vermelhoFundo: 'FFC7CE', vermelhoTexto: '9C0006',
  amareloFundo: 'FFEB9C', amareloTexto: '7A5200',
};
const FONTE = 'Calibri';

/* AS COLUNAS — A a P são as dela, na ordem dela; Q em diante é acréscimo.
   tipo: 'rel' vem dos relatórios · 'manual' alguém preenche · 'calc' é fórmula. */
const COLUNAS = [
  { t: 'Data Consulta', tipo: 'rel', larg: 13.5 },
  { t: 'Carga', tipo: 'rel', larg: 10.5 },
  { t: 'Qtde SIST', tipo: 'rel', larg: 10 },
  { t: 'Qtde B2B', tipo: 'rel', larg: 10 },
  { t: 'Diferença', tipo: 'calc', larg: 11 },
  { t: 'Finalizadas', tipo: 'rel', larg: 11.5 },
  { t: 'Aguardando', tipo: 'rel', larg: 11.5 },
  { t: 'Não Entregue', tipo: 'rel', larg: 12.5 },
  { t: 'Outros Status', tipo: 'rel', larg: 12 },
  { t: 'Situação', tipo: 'calc', larg: 14 },
  { t: 'Resumo Pendências', tipo: 'rel', larg: 32 },
  { t: 'Status Pendência', tipo: 'manual', larg: 19 },
  { t: 'Status p/ pagamento', tipo: 'calc', larg: 15.5 },
  { t: 'Data Pagamento', tipo: 'manual', larg: 14.5 },
  { t: 'Transportadora', tipo: 'manual', larg: 24 },
  { t: 'CT-E', tipo: 'manual', larg: 12 },
  { t: '% Entregue', tipo: 'calc', larg: 12 },
  { t: '% Liberado', tipo: 'calc', larg: 12 },
  { t: '% Pago', tipo: 'manual', larg: 10.5 },
  { t: 'A pagar agora', tipo: 'calc', larg: 13 },
  { t: 'Data Tratativa', tipo: 'manual', larg: 14 },
  { t: 'Observação', tipo: 'manual', larg: 38 },
];
export const COLUNAS_DA_PLANILHA = COLUNAS.map((c) => c.t);

const SEM_PENDENCIA = 'SEM PENDÊNCIA';
const ABA_CONTROLE = 'CONTROLE_CARGAS';
const LIMITE = 20000;
const rng = (col) => `${ABA_CONTROLE}!$${col}$2:$${col}$${LIMITE}`;

const base = { fonte: { nome: FONTE, tam: 11, cor: C.tinta }, alin: { v: 'center' }, borda: { base: { estilo: 'thin', cor: C.linha } } };
const com = (extra) => ({ ...base, ...extra, fonte: { ...base.fonte, ...(extra.fonte ?? {}) }, alin: { ...base.alin, ...(extra.alin ?? {}) } });
const mudo = { fonte: { cor: C.apagada } };

const ESTILO = {
  data: com({ fmt: 'dd/mm/yyyy', alin: { h: 'center' } }),
  dataMuda: com({ fmt: 'dd/mm/yyyy', alin: { h: 'center' }, ...mudo }),
  centro: com({ alin: { h: 'center' } }),
  centroMudo: com({ alin: { h: 'center' }, ...mudo }),
  carga: com({ fonte: { cor: C.navy, neg: true }, alin: { h: 'center' } }),
  cargaMuda: com({ alin: { h: 'center' }, ...mudo }),
  texto: com({ alin: { h: 'left', recuo: 1 } }),
  textoMudo: com({ alin: { h: 'left', recuo: 1 }, ...mudo }),
  pct: com({ fmt: '0.0%', alin: { h: 'center' } }),
  vazio: com({}),
};

const cabecalho = (tipo) => ({
  fonte: { nome: FONTE, tam: 11, neg: true, cor: tipo === 'manual' ? C.navy : C.branco },
  fundo: tipo === 'rel' ? C.navy : (tipo === 'manual' ? C.ouro : C.aco),
  alin: { h: 'center', v: 'center', quebrar: true },
  borda: { base: { estilo: 'medium', cor: tipo === 'manual' ? C.ouroEscuro : C.navyFundo } },
});

const dataBr = (d, tz = 'America/Sao_Paulo') => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const horaBr = (d, tz = 'America/Sao_Paulo') => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);

/* ---------------------------------------------------------- CONTROLE_CARGAS */

function abaControle(cargas) {
  const linhas = [{ altura: 40, c: COLUNAS.map((c) => ({ v: c.t, e: cabecalho(c.tipo) })) }];
  const L = (n) => n + 1; // índice 0-based da lista → número da linha do Excel
  const K_PEND = `$K:$K,"<>${SEM_PENDENCIA}",$K:$K,"<>*(Só no B2B)",$K:$K,"<>"`;

  for (const carga of cargas) {
    const ind = indicadoresDaCarga(carga);
    const pend = carga.pendencias ?? [];
    const n = Math.max(1, pend.length);
    const r = L(linhas.length); // linha do Excel da primeira linha da carga
    const qtdSist = Number(carga.qtdSist) || 0;

    for (let i = 0; i < n; i += 1) {
      const p = pend[i];
      const resumo = p ? `${p.nota} (${rotuloDaPendencia(p)})` : SEM_PENDENCIA;
      const primeira = i === 0;
      const x = L(linhas.length);
      const cel = new Array(COLUNAS.length).fill(null).map(() => ({ e: ESTILO.vazio }));

      cel[0] = { v: carga.dataConsulta ?? null, t: 'd', e: primeira ? ESTILO.data : ESTILO.dataMuda };
      cel[1] = { v: Number(carga.numero), t: 'n', e: primeira ? ESTILO.carga : ESTILO.cargaMuda };
      cel[10] = { v: resumo, e: ESTILO.texto };
      cel[11] = { v: p?.tratativa || null, e: ESTILO.centro };
      cel[14] = { v: carga.transportadora || null, e: primeira ? ESTILO.texto : ESTILO.textoMudo };
      cel[20] = { v: p?.tratativaEm ?? null, t: 'd', e: ESTILO.data };
      cel[21] = { v: (primeira ? [carga.obs, p?.obs] : [p?.obs]).filter(Boolean).join(' · ') || null, e: ESTILO.texto };

      if (primeira) {
        cel[2] = { v: qtdSist, e: ESTILO.centro };
        cel[3] = { v: Number(carga.qtdB2b) || 0, e: ESTILO.centro };
        cel[4] = { f: `C${x}-D${x}`, v: qtdSist - (Number(carga.qtdB2b) || 0), e: ESTILO.centro };
        cel[5] = { v: Number(carga.finalizadas) || 0, e: ESTILO.centro };
        cel[6] = { v: Number(carga.aguardando) || 0, e: ESTILO.centro };
        cel[7] = { v: Number(carga.naoEntregue) || 0, e: ESTILO.centro };
        cel[8] = { v: Number(carga.outros) || 0, e: ESTILO.centro };
        cel[9] = {
          f: `IF(OR(C${x}<>D${x},F${x}=0,COUNTIFS($B:$B,B${x},$K:$K,"*(Não localizada no B2B)")+COUNTIFS($B:$B,B${x},$K:$K,"*(Só no B2B)")>0),"VERIFICAR",IF(F${x}=C${x},"LIBERADA","PENDENTE"))`,
          v: ind.situacao, e: com({ alin: { h: 'center' }, fonte: { neg: true } }),
        };
        cel[12] = { f: `IF(S${x}>=0.99995,"INTEGRAL",IF(S${x}>0,"PARCIAL",""))`, v: ind.statusPagamento, e: com({ alin: { h: 'center' }, fonte: { neg: true } }) };
        cel[13] = { v: carga.dataPagamento ?? null, t: 'd', e: ESTILO.data };
        cel[15] = { v: carga.cte || null, t: 's', e: ESTILO.centro };
        cel[16] = { f: `IF(C${x}>0,(C${x}-COUNTIFS($B:$B,B${x},${K_PEND}))/C${x},"")`, v: ind.entregue ?? '', e: ESTILO.pct };
        cel[17] = {
          f: `IF(C${x}>0,IF(J${x}="VERIFICAR","conferir",MIN(1,Q${x}+(COUNTIFS($B:$B,B${x},$K:$K,"<>*(Só no B2B)",$L:$L,"OK")+COUNTIFS($B:$B,B${x},$K:$K,"<>*(Só no B2B)",$L:$L,"OK B2B"))/C${x})),"")`,
          v: ind.conferir ? 'conferir' : (ind.liberado ?? ''), e: ESTILO.pct,
        };
        cel[18] = { v: ind.pago > 0 ? ind.pago : null, e: ESTILO.pct };
        cel[19] = {
          f: `IF(C${x}>0,IF(J${x}="VERIFICAR","conferir",MAX(0,ROUND(R${x}-S${x},4))),"")`,
          v: ind.conferir ? 'conferir' : (ind.aPagar ?? ''), e: com({ fmt: '0.0%', alin: { h: 'center' }, fonte: { neg: true } }),
        };
      } else {
        cel[9] = { f: `J${r}`, v: ind.situacao, e: com({ alin: { h: 'center' }, ...mudo }) };
      }
      linhas.push({ altura: 20, c: cel });
    }
  }

  const ultima = Math.max(linhas.length, 2);
  const ate = Math.max(ultima, 1000); // formatação e validação já valem para as linhas que ela acrescentar
  const lista = TRATATIVAS.join(',');

  return {
    nome: ABA_CONTROLE,
    corAba: C.navy,
    zoom: 90,
    colunas: COLUNAS.map((c) => ({ larg: c.larg })),
    linhas,
    congelar: { linhas: 1, colunas: 2 },
    filtro: `A1:${String.fromCharCode(64 + COLUNAS.length)}${ultima}`,
    ignorarAvisos: true,
    impressao: { orientacao: 'landscape', ajustarLargura: true, repetirLinhas: [1, 1], rodape: '&LControle de Pagamento de Frete — Suinco&RPágina &P de &N' },
    validacoes: [
      {
        intervalo: `L2:L${ate}`, tipo: 'list', lista: TRATATIVAS, estilo: 'warning',
        dicaTitulo: 'Status da pendência', dica: 'Escolha na lista. OK e OK B2B = consultei no sistema e libera o pagamento da nota.',
        erroTitulo: 'Fora da lista', erro: `Use uma destas: ${lista}. Para outro assunto, escreva na coluna Observação.`,
      },
      {
        intervalo: `N2:N${ate} U2:U${ate}`, tipo: 'date', operador: 'greaterThan', de: 36526, estilo: 'stop',
        erroTitulo: 'Data inválida', erro: 'Digite uma data, como 09/10/2026.',
      },
      {
        intervalo: `S2:S${ate}`, tipo: 'decimal', operador: 'between', de: 0, ate: 1, estilo: 'stop',
        dicaTitulo: '% pago', dica: 'Quanto da carga já foi pago, pela quantidade de notas. Ex.: 62,5%.',
        erroTitulo: '% pago inválido', erro: 'Digite de 0% a 100% (por exemplo 62,5%).',
      },
    ],
    condicionais: [
      {
        intervalo: `J2:J${ate}`,
        regras: [
          { formula: 'AND($C2<>"",$J2="LIBERADA")', estilo: { fundo: C.verdeFundo, fonte: { cor: C.verdeTexto, neg: true } } },
          { formula: 'AND($C2<>"",$J2="PENDENTE")', estilo: { fundo: C.vermelhoFundo, fonte: { cor: C.vermelhoTexto, neg: true } } },
          { formula: 'AND($C2<>"",$J2="VERIFICAR")', estilo: { fundo: C.amareloFundo, fonte: { cor: C.amareloTexto, neg: true } } },
        ],
      },
      {
        intervalo: `E2:E${ate}`,
        regras: [
          { formula: 'AND($C2<>"",$E2<>0)', estilo: { fundo: C.vermelhoFundo, fonte: { cor: C.vermelhoTexto, neg: true } } },
          { formula: 'AND($C2<>"",$E2=0)', estilo: { fundo: C.verdeFundo, fonte: { cor: C.verdeTexto } } },
        ],
      },
      {
        intervalo: `L2:L${ate}`,
        regras: [
          { formula: 'OR($L2="OK",$L2="OK B2B")', estilo: { fonte: { cor: '1E7A3C', neg: true } } },
          { formula: 'OR($L2="DEV",$L2="DEV NO SISTEMA")', estilo: { fonte: { cor: '1F5FBF', neg: true } } },
          { formula: '$L2="SUMIU DO B2B"', estilo: { fonte: { cor: 'B42318', neg: true } } },
          { formula: '$L2="SEM TRATATIVA"', estilo: { fonte: { cor: C.muda, it: true } } },
          { formula: `AND($L2="",$K2<>"",$K2<>"${SEM_PENDENCIA}")`, estilo: { fundo: 'FFF4D6' } },
        ],
      },
      {
        intervalo: `K2:K${ate}`,
        regras: [
          { formula: 'ISNUMBER(SEARCH("(Aguardando)",$K2))', estilo: { fonte: { cor: '9A6700' } } },
          { formula: 'ISNUMBER(SEARCH("(Não entregue)",$K2))', estilo: { fonte: { cor: 'B42318' } } },
          { formula: 'OR(ISNUMBER(SEARCH("(Não localizada",$K2)),ISNUMBER(SEARCH("(Só no B2B)",$K2)))', estilo: { fonte: { cor: '6D3FC4' } } },
          { formula: `$K2="${SEM_PENDENCIA}"`, estilo: { fonte: { cor: '2E7D32' } } },
        ],
      },
      { intervalo: `R2:R${ate}`, regras: [{ formula: 'R2="conferir"', estilo: { fonte: { cor: C.amareloTexto, it: true, neg: true } } }] },
      { intervalo: `T2:T${ate}`, regras: [{ formula: 'T2="conferir"', estilo: { fonte: { cor: C.amareloTexto, it: true, neg: true } } }] },
      { intervalo: `T2:T${ate}`, regras: [{ formula: 'AND($C2<>"",N($T2)>0)', estilo: { fundo: 'FDEBB0', fonte: { cor: C.amareloTexto, neg: true } } }] },
      { intervalo: `Q2:Q${ate}`, regras: [{ barra: { cor: '7FC99A', min: 0, max: 1 } }] },
      { intervalo: `S2:S${ate}`, regras: [{ barra: { cor: '8EA4D8', min: 0, max: 1 } }] },
      {
        intervalo: `A2:V${ate}`,
        regras: [
          { formula: '$B2<>$B1', estilo: { borda: { topo: { estilo: 'thin', cor: C.navy } } } },
          { formula: '$C2<>""', estilo: { fundo: C.faixa } },
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------- RESUMO */

const TONS = {
  neutro: { fundo: C.faixa, cor: C.navy },
  verde: { fundo: 'E6F4EA', cor: '1E7A3C' },
  vermelho: { fundo: 'FDECEC', cor: 'B42318' },
  amarelo: { fundo: 'FFF4D6', cor: '8A5A00' },
  azul: { fundo: 'E8EEF9', cor: '2B4C8C' },
};

function abaResumo(cargas, { geradoEm, exemplo }) {
  const ind = cargas.map((c) => ({ c, i: indicadoresDaCarga(c) }));
  const total = ind.length;
  const por = (sit) => ind.filter((x) => x.i.situacao === sit).length;
  const integral = ind.filter((x) => x.i.statusPagamento === 'INTEGRAL').length;
  const parcial = ind.filter((x) => x.i.statusPagamento === 'PARCIAL').length;
  const comSaldo = ind.filter((x) => (x.i.aPagar ?? 0) > 0).length;
  const emitidas = ind.reduce((s, x) => s + (Number(x.c.qtdSist) || 0), 0);
  const finalizadas = ind.reduce((s, x) => s + (Number(x.c.finalizadas) || 0), 0);
  const entregues = ind.reduce((s, x) => s + (x.i.entregue ?? 0) * (Number(x.c.qtdSist) || 0), 0);
  const pendAbertas = ind.reduce((s, x) => s + (x.c.pendencias ?? []).length, 0);

  const linhas = [];
  const mesclar = [];
  const colunas = new Array(8).fill(null).map(() => ({ larg: 17 }));
  const linha = (i, altura) => { linhas[i] ??= { altura, c: new Array(8).fill(null) }; if (altura) linhas[i].altura = altura; return linhas[i].c; };
  const faixaTitulo = { fonte: { nome: FONTE, tam: 22, neg: true, cor: C.branco }, fundo: C.navy, alin: { h: 'left', v: 'center', recuo: 1 } };

  // Título, subtítulo e filete dourado
  const t = linha(0, 44); t[0] = { v: 'Pagamento de Frete — Resumo', e: faixaTitulo };
  for (let j = 1; j < 8; j += 1) t[j] = { e: faixaTitulo };
  mesclar.push('A1:H1');
  const sub = exemplo
    ? 'MODELO COM DADOS DE EXEMPLO — as cargas 9008xx e os números desta cópia são inventados, só para mostrar o desenho.'
    : `Atualizado em ${dataBr(geradoEm)} às ${horaBr(geradoEm)} · dados dos relatórios B2B e Atak importados no painel`;
  const s2 = linha(1, 24);
  const subE = { fonte: { nome: FONTE, tam: 11, cor: C.ouro, neg: !!exemplo }, fundo: C.navy, alin: { h: 'left', v: 'center', recuo: 1 } };
  s2[0] = { v: sub, e: subE };
  for (let j = 1; j < 8; j += 1) s2[j] = { e: subE };
  mesclar.push('A2:H2');
  const fio = linha(2, 5); for (let j = 0; j < 8; j += 1) fio[j] = { e: { fundo: C.ouro } };
  linha(3, 12);

  const secao = (i, texto) => {
    const s = linha(i, 24);
    const e = { fonte: { nome: FONTE, tam: 11, neg: true, cor: C.navy }, alin: { h: 'left', v: 'bottom' }, borda: { base: { estilo: 'medium', cor: C.ouroEscuro } } };
    s[0] = { v: texto, e };
    for (let j = 1; j < 8; j += 1) s[j] = { e };
    mesclar.push(`A${i + 1}:H${i + 1}`);
  };
  /* quatro cartões de dois em dois colunas, em três linhas (rótulo, número, legenda) */
  const cartoes = (i, lista) => {
    lista.forEach((cartao, k) => {
      const j = k * 2;
      const tom = TONS[cartao.tom];
      const borda = { esq: { estilo: 'thick', cor: C.branco }, dir: { estilo: 'thick', cor: C.branco } };
      const e1 = { fonte: { nome: FONTE, tam: 10, neg: true, cor: C.muda }, fundo: tom.fundo, alin: { h: 'center', v: 'bottom' }, borda };
      const e2 = { fonte: { nome: FONTE, tam: 28, neg: true, cor: tom.cor }, fundo: tom.fundo, alin: { h: 'center', v: 'center' }, borda, fmt: cartao.fmt };
      const e3 = { fonte: { nome: FONTE, tam: 9, cor: C.muda }, fundo: tom.fundo, alin: { h: 'center', v: 'top' }, borda };
      const a = linha(i, 22); const b = linha(i + 1, 46); const c = linha(i + 2, 22);
      a[j] = { v: cartao.rotulo.toUpperCase(), e: e1 }; a[j + 1] = { e: e1 };
      b[j] = { f: cartao.f, v: cartao.v, e: e2 }; b[j + 1] = { e: e2 };
      c[j] = { v: cartao.legenda, e: e3 }; c[j + 1] = { e: e3 };
      [i, i + 1, i + 2].forEach((ln) => mesclar.push(`${'ABCDEFGH'[j]}${ln + 1}:${'ABCDEFGH'[j + 1]}${ln + 1}`));
    });
  };

  secao(4, 'CARGAS');
  cartoes(5, [
    { rotulo: 'Cargas no controle', f: `COUNT(${rng('C')})`, v: total, legenda: 'cada carga conta uma vez', tom: 'neutro' },
    { rotulo: 'Liberadas', f: `COUNTIFS(${rng('J')},"LIBERADA",${rng('C')},">=0")`, v: por('LIBERADA'), legenda: 'tudo entregue no B2B', tom: 'verde' },
    { rotulo: 'Pendentes', f: `COUNTIFS(${rng('J')},"PENDENTE",${rng('C')},">=0")`, v: por('PENDENTE'), legenda: 'parte ainda sem entrega', tom: 'vermelho' },
    { rotulo: 'Verificar', f: `COUNTIFS(${rng('J')},"VERIFICAR",${rng('C')},">=0")`, v: por('VERIFICAR'), legenda: 'a contagem não bate — nada se paga até conferir', tom: 'amarelo' },
  ]);
  linha(8, 12);
  secao(9, 'PAGAMENTO (pela quantidade de notas)');
  cartoes(10, [
    { rotulo: 'Pagas integralmente', f: `COUNTIFS(${rng('M')},"INTEGRAL",${rng('C')},">=0")`, v: integral, legenda: 'cargas com 100% pago', tom: 'verde' },
    { rotulo: 'Pagas em parte', f: `COUNTIFS(${rng('M')},"PARCIAL",${rng('C')},">=0")`, v: parcial, legenda: 'falta pagar o restante', tom: 'azul' },
    {
      rotulo: 'Sem pagamento', f: `COUNT(${rng('C')})-COUNTIFS(${rng('M')},"INTEGRAL",${rng('C')},">=0")-COUNTIFS(${rng('M')},"PARCIAL",${rng('C')},">=0")`,
      v: total - integral - parcial, legenda: 'nada pago ainda', tom: 'neutro',
    },
    { rotulo: 'Com saldo a pagar', f: `COUNTIF(${rng('T')},">0")`, v: comSaldo, legenda: 'liberado e ainda não pago', tom: 'amarelo' },
  ]);
  linha(13, 12);
  secao(14, 'NOTAS');
  cartoes(15, [
    { rotulo: 'Emitidas no sistema', f: `SUM(${rng('C')})`, v: emitidas, legenda: 'notas do relatório Atak', tom: 'neutro' },
    { rotulo: 'Finalizadas no B2B', f: `SUM(${rng('F')})`, v: finalizadas, legenda: 'entrega comprovada', tom: 'verde' },
    {
      rotulo: 'Entregues', f: `IFERROR(SUMPRODUCT(${rng('Q')},${rng('C')})/SUM(${rng('C')}),"")`, v: emitidas ? entregues / emitidas : '',
      legenda: 'finalizadas ÷ emitidas', tom: 'verde', fmt: '0.0%',
    },
    {
      rotulo: 'Pendências abertas', f: `COUNTIFS(${rng('K')},"<>${SEM_PENDENCIA}",${rng('K')},"<>")`, v: pendAbertas,
      legenda: 'notas que ainda não foram entregues', tom: 'vermelho',
    },
  ]);
  linha(18, 14);

  /* Pendências por tratativa */
  secao(19, 'PENDÊNCIAS POR TRATATIVA');
  const eCab = { fonte: { nome: FONTE, tam: 10, neg: true, cor: C.branco }, fundo: C.navy, alin: { h: 'center', v: 'center', quebrar: true } };
  const eCabEsq = { ...eCab, alin: { h: 'left', v: 'center', recuo: 1 } };
  const ch = linha(20, 24);
  ch[0] = { v: 'Tratativa', e: eCabEsq }; ch[1] = { e: eCabEsq }; ch[2] = { v: 'Pendências', e: eCab }; ch[3] = { v: '% do total', e: eCab };
  ch[4] = { v: 'O que significa', e: eCabEsq }; for (let j = 5; j < 8; j += 1) ch[j] = { e: eCabEsq };
  mesclar.push('A21:B21', 'E21:H21');
  const SENTIDOS = [
    ['Sem olhar (em branco)', null, 'Ninguém consultou ainda — é o que falta olhar.'],
    ['SEM TRATATIVA', 'SEM TRATATIVA', 'Olhei e não há o que fazer por enquanto.'],
    ['DEV', 'DEV', 'Nota devolvida — não libera o pagamento.'],
    ['DEV NO SISTEMA', 'DEV NO SISTEMA', 'Devolução já lançada no sistema — não libera.'],
    ['OK B2B', 'OK B2B', 'Conferido no B2B — libera o pagamento da nota.'],
    ['OK', 'OK', 'Consultado no sistema, está certo — libera o pagamento da nota.'],
    ['SUMIU DO B2B', 'SUMIU DO B2B', 'A nota sumiu do B2B — não libera até aparecer.'],
  ];
  const todasPend = cargas.flatMap((c) => c.pendencias ?? []);
  const conta = (trat) => todasPend.filter((p) => (trat === null ? !p.tratativa : p.tratativa === trat)).length;
  const eCorpo = { fonte: { nome: FONTE, tam: 11, cor: C.tinta }, alin: { h: 'center', v: 'center' }, borda: { base: { estilo: 'thin', cor: C.linha } } };
  const eEsq = { ...eCorpo, alin: { h: 'left', v: 'center', recuo: 1 } };
  const ePct = { ...eCorpo, fmt: '0.0%' };
  const primeiraT = 21; // índice da primeira linha de tratativa
  const totalT = primeiraT + SENTIDOS.length;
  SENTIDOS.forEach(([nome, chave, sentido], k) => {
    const i = primeiraT + k;
    const l = linha(i, 22);
    const liberam = chave && TRATATIVAS_QUE_LIBERAM.includes(chave);
    l[0] = { v: nome, e: { ...eEsq, fonte: { ...eEsq.fonte, neg: !!liberam } } }; l[1] = { e: eEsq };
    l[2] = chave === null
      ? { f: `COUNTIFS(${rng('K')},"<>${SEM_PENDENCIA}",${rng('K')},"<>",${rng('L')},"")`, v: conta(null), e: eCorpo }
      : { f: `COUNTIFS(${rng('L')},"${chave}")`, v: conta(chave), e: eCorpo };
    l[3] = { f: `IF(C$${totalT + 1}>0,C${i + 1}/C$${totalT + 1},0)`, v: todasPend.length ? conta(chave) / todasPend.length : 0, e: ePct };
    l[4] = { v: sentido, e: eEsq }; for (let j = 5; j < 8; j += 1) l[j] = { e: eEsq };
    mesclar.push(`A${i + 1}:B${i + 1}`, `E${i + 1}:H${i + 1}`);
  });
  const eTot = { ...eCorpo, fonte: { ...eCorpo.fonte, neg: true }, borda: { topo: { estilo: 'medium', cor: C.navy }, base: { estilo: 'thin', cor: C.linha } } };
  const lt = linha(totalT, 24);
  lt[0] = { v: 'Total', e: { ...eTot, alin: { h: 'left', v: 'center', recuo: 1 } } }; lt[1] = { e: eTot };
  lt[2] = { f: `SUM(C${primeiraT + 1}:C${totalT})`, v: todasPend.length, e: eTot };
  lt[3] = { f: `SUM(D${primeiraT + 1}:D${totalT})`, v: todasPend.length ? 1 : 0, e: { ...eTot, fmt: '0.0%' } };
  lt[4] = { v: 'Tem de bater com "Pendências abertas" acima.', e: { ...eTot, alin: { h: 'left', v: 'center', recuo: 1 }, fonte: { ...eTot.fonte, neg: false, it: true, cor: C.muda } } };
  for (let j = 5; j < 8; j += 1) lt[j] = { e: eTot };
  mesclar.push(`A${totalT + 1}:B${totalT + 1}`, `E${totalT + 1}:H${totalT + 1}`);
  linha(totalT + 1, 14);

  /* Por transportadora */
  const iSec = totalT + 2;
  secao(iSec, 'POR TRANSPORTADORA');
  const hh = linha(iSec + 1, 38);
  ['Transportadora', null, 'Cargas', 'Liberadas', 'Pendentes', 'Verificar', 'Pendências abertas', '% entregue'].forEach((v, j) => {
    hh[j] = { v, e: j < 2 ? eCabEsq : eCab };
  });
  mesclar.push(`A${iSec + 2}:B${iSec + 2}`);
  const nomes = [...new Set(cargas.map((c) => (c.transportadora || '').trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (nomes.includes('')) { nomes.splice(nomes.indexOf(''), 1); nomes.push(''); }
  const primeiraTr = iSec + 2;
  nomes.forEach((nome, k) => {
    const i = primeiraTr + k; const x = i + 1;
    const l = linha(i, 22);
    const crit = nome ? `$A${x}` : '""';
    const dele = ind.filter((y) => (y.c.transportadora || '').trim() === nome);
    const qs = dele.reduce((s, y) => s + (Number(y.c.qtdSist) || 0), 0);
    const ent = dele.reduce((s, y) => s + (y.i.entregue ?? 0) * (Number(y.c.qtdSist) || 0), 0);
    l[0] = { v: nome || '(sem transportadora)', e: eEsq }; l[1] = { e: eEsq };
    l[2] = { f: `COUNTIFS(${rng('O')},${crit},${rng('C')},">=0")`, v: dele.length, e: eCorpo };
    ['LIBERADA', 'PENDENTE', 'VERIFICAR'].forEach((sit, q) => {
      l[3 + q] = { f: `COUNTIFS(${rng('O')},${crit},${rng('J')},"${sit}",${rng('C')},">=0")`, v: dele.filter((y) => y.i.situacao === sit).length, e: eCorpo };
    });
    l[6] = { f: `COUNTIFS(${rng('O')},${crit},${rng('K')},"<>${SEM_PENDENCIA}",${rng('K')},"<>")`, v: dele.reduce((s, y) => s + (y.c.pendencias ?? []).length, 0), e: eCorpo };
    l[7] = {
      f: `IFERROR(SUMPRODUCT(--(${rng('O')}=${crit}),${rng('Q')},${rng('C')})/SUMIFS(${rng('C')},${rng('O')},${crit}),"")`,
      v: qs ? ent / qs : '', e: ePct,
    };
    mesclar.push(`A${x}:B${x}`);
  });
  const ultimaTr = primeiraTr + nomes.length - 1;
  const totTr = ultimaTr + 1;
  const ltr = linha(totTr, 24);
  ltr[0] = { v: 'Total', e: { ...eTot, alin: { h: 'left', v: 'center', recuo: 1 } } }; ltr[1] = { e: eTot };
  const somaCol = (col, valor) => ({ f: `SUM(${col}${primeiraTr + 1}:${col}${ultimaTr + 1})`, v: valor, e: eTot });
  ltr[2] = somaCol('C', total);
  ltr[3] = somaCol('D', por('LIBERADA')); ltr[4] = somaCol('E', por('PENDENTE')); ltr[5] = somaCol('F', por('VERIFICAR'));
  ltr[6] = somaCol('G', pendAbertas);
  ltr[7] = { f: `IFERROR(SUMPRODUCT(${rng('Q')},${rng('C')})/SUM(${rng('C')}),"")`, v: emitidas ? entregues / emitidas : '', e: { ...eTot, fmt: '0.0%' } };
  mesclar.push(`A${totTr + 1}:B${totTr + 1}`);
  linha(totTr + 1, 14);

  const nota = linha(totTr + 2, 50);
  const eNota = { fonte: { nome: FONTE, tam: 10, it: true, cor: C.muda }, alin: { h: 'left', v: 'top', quebrar: true, recuo: 1 } };
  nota[0] = {
    v: 'Estes números são fórmulas sobre a aba CONTROLE_CARGAS: se você mudar uma Situação, um Status Pendência ou uma quantidade lá, o resumo se atualiza sozinho. '
      + 'Cada carga conta uma vez, mesmo tendo várias linhas de pendência.',
    e: eNota,
  };
  for (let j = 1; j < 8; j += 1) nota[j] = { e: eNota };
  mesclar.push(`A${totTr + 3}:H${totTr + 3}`);

  const fim = totTr + 3;
  for (let i = 0; i < fim; i += 1) linhas[i] ??= null;
  return {
    nome: 'RESUMO', corAba: C.ouro, grade: false, zoom: 100, colunas, linhas: linhas.map((l) => (l ? { altura: l.altura, c: l.c } : null)), mesclar,
    ignorarAvisos: true,
    impressao: { orientacao: 'portrait', ajustarLargura: true, centralizar: true },
    condicionais: [
      { intervalo: `D${primeiraT + 1}:D${totalT}`, regras: [{ barra: { cor: 'E9B954', min: 0, max: 1 } }] },
      { intervalo: `H${primeiraTr + 1}:H${ultimaTr + 1}`, regras: [{ barra: { cor: '7FC99A', min: 0, max: 1 } }] },
    ],
  };
}

/* ------------------------------------------------------------------ LEIA-ME */

function abaLeiaMe({ exemplo }) {
  const linhas = [];
  const mesclar = [];
  const colunas = [{ larg: 30 }, { larg: 104 }];
  const faixa = { fonte: { nome: FONTE, tam: 20, neg: true, cor: C.branco }, fundo: C.navy, alin: { h: 'left', v: 'center', recuo: 1 } };
  linhas.push({ altura: 42, c: [{ v: 'Como ler esta planilha', e: faixa }, { e: faixa }] }); mesclar.push('A1:B1');
  const subE = { fonte: { nome: FONTE, tam: 11, cor: C.ouro }, fundo: C.navy, alin: { h: 'left', v: 'center', recuo: 1 } };
  linhas.push({ altura: 24, c: [{ v: 'Controle de Pagamento de Frete · Programação de Embarque Suinco', e: subE }, { e: subE }] }); mesclar.push('A2:B2');
  linhas.push({ altura: 5, c: [{ e: { fundo: C.ouro } }, { e: { fundo: C.ouro } }] });
  linhas.push({ altura: 12, c: [] });

  const eSecao = { fonte: { nome: FONTE, tam: 11, neg: true, cor: C.navy }, alin: { h: 'left', v: 'bottom' }, borda: { base: { estilo: 'medium', cor: C.ouroEscuro } } };
  const secao = (t) => { linhas.push({ altura: 26, c: [{ v: t, e: eSecao }, { e: eSecao }] }); mesclar.push(`A${linhas.length}:B${linhas.length}`); };
  const eTermo = { fonte: { nome: FONTE, tam: 11, neg: true, cor: C.navy }, alin: { h: 'left', v: 'top', quebrar: true, recuo: 1 }, borda: { base: { estilo: 'thin', cor: C.linha } } };
  const eDesc = { fonte: { nome: FONTE, tam: 11, cor: C.tinta }, alin: { h: 'left', v: 'top', quebrar: true, recuo: 1 }, borda: { base: { estilo: 'thin', cor: C.linha } } };
  const item = (termo, desc, termoE = eTermo) => {
    const l = Math.max(1, Math.ceil(String(desc).length / 112));
    linhas.push({ altura: Math.max(22, 16 * l + 6), c: [{ v: termo, e: termoE }, { v: desc, e: eDesc }] });
  };
  const chip = (fundo, cor) => ({ ...eTermo, fundo, fonte: { nome: FONTE, tam: 11, neg: true, cor }, alin: { h: 'center', v: 'top' } });
  const espaco = () => linhas.push({ altura: 12, c: [] });

  secao('O QUE É CADA LINHA');
  item('Uma carga, um bloco', 'A primeira linha de cada carga traz as contagens (colunas C a J). As linhas seguintes listam uma pendência por linha: a nota e o status dela no B2B. Data, carga, situação e transportadora se repetem em todas as linhas do bloco, para o filtro funcionar.');
  item('De onde vêm os dados', 'Dos dois relatórios exportados, um por carga: DeliveryB2B ("Relatório de Status das Entregas") e Atak ("WRVDA501 – Relatório de Notas por Carga"). O painel lê os PDFs, cruza nota por nota e preenche as colunas.');
  espaco();
  secao('A COR DO TÍTULO DE CADA COLUNA');
  item('Azul-marinho', 'Vem dos relatórios (B2B e Atak). Não digite.', chip(C.navy, C.branco));
  item('Azul-aço', 'Calculado por fórmula. Não digite — se o número parecer errado, o erro está em outra coluna.', chip(C.aco, C.branco));
  item('Dourado', 'Preenchimento manual: é aqui que se trabalha (tratativa, data do pagamento, % pago, observação).', chip(C.ouro, C.navy));
  espaco();
  secao('SITUAÇÃO DA CARGA');
  item('LIBERADA', 'Tudo que o sistema emitiu está Finalizado no B2B.', chip(C.verdeFundo, C.verdeTexto));
  item('PENDENTE', 'A contagem bate e parte das notas está Finalizada, parte não. Paga-se a parte finalizada; o resto espera.', chip(C.vermelhoFundo, C.vermelhoTexto));
  item('VERIFICAR', 'A contagem NÃO bate (Qtde SIST ≠ Qtde B2B), há nota que existe de um lado só, ou nada foi finalizado. Antes de pagar, alguém precisa olhar se o B2B está certo.', chip(C.amareloFundo, C.amareloTexto));
  espaco();
  secao('STATUS PENDÊNCIA — O QUE FOI FEITO COM A NOTA');
  item('(em branco)', 'Ninguém consultou ainda. A célula fica destacada em amarelo para mostrar o que falta olhar.');
  item('SEM TRATATIVA', 'Olhei e não há o que fazer por enquanto.');
  item('DEV  ·  DEV NO SISTEMA', 'Nota devolvida; "no sistema" é a devolução já lançada. Não libera o pagamento.');
  item('OK  ·  OK B2B', 'Consultei no sistema e está tudo certo. É o único jeito de uma nota que não está Finalizada entrar no pagamento.');
  item('SUMIU DO B2B', 'A nota não aparece mais no B2B. Não libera até aparecer.');
  espaco();
  secao('PAGAMENTO — PELA QUANTIDADE DE NOTAS, SEM VALOR EM R$');
  item('% Entregue', 'Notas Finalizadas no B2B ÷ notas emitidas no sistema. É o que o B2B comprova.');
  item('% Liberado', '% Entregue + as notas que alguém consultou no sistema e marcou OK / OK B2B. É o máximo que pode ser pago hoje. Em carga VERIFICAR aparece "conferir": nada é liberado até alguém olhar se o B2B está certo.');
  item('% Pago', 'Quanto da carga já foi pago (digite como 62,5%). Vazio = nada pago.');
  item('A pagar agora', '% Liberado − % Pago. Fica dourado quando há saldo: é a lista do que ficou para trás. Em carga VERIFICAR aparece "conferir".');
  item('Status p/ pagamento', 'Vazio (nada pago) · PARCIAL (parte paga) · INTEGRAL (100%). É fórmula, sai do % Pago.');
  espaco();
  secao('DICAS');
  item('Achar o que está para pagar', 'Na coluna "A pagar agora", filtre os valores maiores que zero. Para ver só as pendências que ninguém olhou, filtre "Status Pendência" por (Vazias).');
  item('Acrescentar uma carga à mão', 'Copie as linhas de uma carga existente e troque os números: as fórmulas e as cores acompanham.');
  if (exemplo) {
    espaco();
    secao('SOBRE ESTA CÓPIA');
    item('Modelo de exemplo', 'Os números desta cópia são inventados (cargas 9008xx, transportadoras "Exemplo"). A planilha real sai do painel, com os dados dos relatórios.');
  }
  return {
    nome: 'LEIA-ME', corAba: C.muda, grade: false, zoom: 100, colunas, linhas, mesclar, ignorarAvisos: true,
    impressao: { orientacao: 'portrait', ajustarLargura: true },
  };
}

/* ------------------------------------------------------------------- ENTRADA */

/* cargas: [{ numero, dataConsulta:'AAAA-MM-DD', qtdSist, qtdB2b, finalizadas, aguardando,
              naoEntregue, outros, transportadora, cte, obs, pctPago (0–100), dataPagamento,
              pendencias:[{ nota, categoria, statusB2b, tratativa, tratativaEm, obs }] }] */
export function montarPlanilhaDeFrete({ cargas, geradoEm = new Date(), exemplo = false }) {
  const quando = geradoEm instanceof Date ? geradoEm : new Date(geradoEm);
  const ordenadas = [...cargas].sort((a, b) => String(a.dataConsulta ?? '').localeCompare(String(b.dataConsulta ?? '')) || Number(a.numero) - Number(b.numero));
  return escreverXlsx({
    titulo: exemplo ? 'Controle de Pagamento de Frete (modelo de exemplo)' : 'Controle de Pagamento de Frete',
    geradoEm: quando,
    abas: [abaControle(ordenadas), abaResumo(ordenadas, { geradoEm: quando, exemplo }), abaLeiaMe({ exemplo })],
  });
}
