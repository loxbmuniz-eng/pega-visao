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
import { TRATATIVAS } from './pagamento_frete.js';
import {
  COLUNAS, COLUNAS_DA_PLANILHA, SEM_PENDENCIA, montarGrade,
} from './planilha_frete_grade.js';

export { COLUNAS_DA_PLANILHA };

const C = {
  navy: '1E2A52', navyFundo: '101625', ouro: 'E9B954', ouroEscuro: 'B9903F', aco: '3E5C86',
  tinta: '1F2937', muda: '6B7280', apagada: '9CA3AF', linha: 'D5DAE5', faixa: 'F3F5FA', branco: 'FFFFFF',
  verdeFundo: 'C6EFCE', verdeTexto: '0B5D2A', vermelhoFundo: 'FFC7CE', vermelhoTexto: '9C0006',
  amareloFundo: 'FFEB9C', amareloTexto: '7A5200',
};
const FONTE = 'Calibri';

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

function abaControle(grade) {
  const linhas = [{ altura: 40, c: COLUNAS.map((c) => ({ v: c.t, e: cabecalho(c.tipo) })) }];
  const centroNeg = com({ alin: { h: 'center' }, fonte: { neg: true } });
  const centroNegMudo = com({ alin: { h: 'center' }, ...mudo });

  /* O estilo de cada célula depende só da COLUNA e de a linha ser a primeira
     da carga ou uma repetição (cinza). O valor e a fórmula vêm da grade. */
  const estiloDe = (chave, primeira) => {
    switch (chave) {
      case 'data': return primeira ? ESTILO.data : ESTILO.dataMuda;
      case 'dataPagamento': case 'dataTratativa': case 'canhotoEm': return ESTILO.data;
      case 'canhoto': return primeira ? centroNeg : ESTILO.vazio;
      case 'carga': return primeira ? ESTILO.carga : ESTILO.cargaMuda;
      case 'situacao': return primeira ? centroNeg : centroNegMudo;
      case 'statusPagamento': return centroNeg;
      case 'resumo': case 'observacao': return ESTILO.texto;
      case 'transportadora': return primeira ? ESTILO.texto : ESTILO.textoMudo;
      case 'entregue': case 'liberado': case 'pago': return ESTILO.pct;
      case 'aPagar': return com({ fmt: '0.0%', alin: { h: 'center' }, fonte: { neg: true } });
      case 'tratativa': case 'cte': case 'qtdSist': case 'qtdB2b': case 'diferenca': case 'finalizadas':
      case 'aguardando': case 'naoEntregue': case 'outros': return ESTILO.centro;
      default: return ESTILO.vazio;
    }
  };
  for (const l of grade.linhas) {
    linhas.push({
      altura: 20,
      c: l.celulas.map((cel, j) => ({ ...cel, e: estiloDe(COLUNAS[j].chave, l.primeira) })),
    });
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
        dicaTitulo: 'Status da pendência', dica: 'Escolha na lista. OK (conferi, está certo) e DEVOLUÇÃO (a nota voltou) liberam o pagamento da nota; SUMIU DO B2B e SEM TRATATIVA não.',
        erroTitulo: 'Fora da lista', erro: `Use uma destas: ${lista}. Para outro assunto, escreva na coluna Observação.`,
      },
      {
        intervalo: `N2:N${ate} U2:U${ate} X2:X${ate}`, tipo: 'date', operador: 'greaterThan', de: 36526, estilo: 'stop',
        erroTitulo: 'Data inválida', erro: 'Digite uma data, como 09/10/2026.',
      },
      {
        intervalo: `S2:S${ate}`, tipo: 'decimal', operador: 'between', de: 0, ate: 1, estilo: 'stop',
        dicaTitulo: '% pago', dica: 'Quanto da carga já foi pago, pela quantidade de notas. Ex.: 62,5%.',
        erroTitulo: '% pago inválido', erro: 'Digite de 0% a 100% (por exemplo 62,5%).',
      },
      {
        intervalo: `W2:W${ate}`, tipo: 'list', lista: ['SIM', 'NÃO'], estilo: 'stop',
        dicaTitulo: 'Canhoto original', dica: 'SIM quando o canhoto em papel chegou. É só acompanhamento: não mexe no pagamento.',
        erroTitulo: 'Fora da lista', erro: 'Use SIM ou NÃO.',
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
          { formula: 'OR($L2="OK",$L2="DEVOLUÇÃO")', estilo: { fonte: { cor: '1E7A3C', neg: true } } },
          { formula: '$L2="SUMIU DO B2B"', estilo: { fonte: { cor: 'B42318', neg: true } } },
          { formula: '$L2="SEM TRATATIVA"', estilo: { fonte: { cor: C.muda, it: true } } },
          { formula: `AND($L2="",$K2<>"",$K2<>"${SEM_PENDENCIA}")`, estilo: { fundo: 'FFF4D6' } },
        ],
      },
      {
        intervalo: `M2:M${ate}`,
        regras: [
          { formula: '$M2="A PAGAR"', estilo: { fundo: 'FDEBB0', fonte: { cor: C.amareloTexto, neg: true } } },
          { formula: '$M2="INTEGRAL"', estilo: { fonte: { cor: C.verdeTexto, neg: true } } },
          { formula: '$M2="PARCIAL"', estilo: { fonte: { cor: '2B4C8C', neg: true } } },
          { formula: '$M2="conferir"', estilo: { fonte: { cor: C.amareloTexto, it: true, neg: true } } },
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
        intervalo: `W2:W${ate}`,
        regras: [
          { formula: 'AND($C2<>"",$W2="SIM")', estilo: { fundo: C.verdeFundo, fonte: { cor: C.verdeTexto, neg: true } } },
          { formula: 'AND($C2<>"",$W2="NÃO")', estilo: { fundo: 'FFF4D6', fonte: { cor: C.muda, neg: true } } },
        ],
      },
      {
        intervalo: `A2:X${ate}`,
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

function abaResumo(r, { geradoEm, exemplo }) {
  const {
    cargas: total, liberadas, pendentes, verificar, integral, parcial, semPagamento, comSaldo,
    emitidas, finalizadas, entregue, pendAbertas, comCanhoto, semCanhoto, pagasSemCanhoto,
  } = r;

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
    { rotulo: 'Liberadas', f: `COUNTIFS(${rng('J')},"LIBERADA",${rng('C')},">=0")`, v: liberadas, legenda: 'tudo entregue no B2B', tom: 'verde' },
    { rotulo: 'Pendentes', f: `COUNTIFS(${rng('J')},"PENDENTE",${rng('C')},">=0")`, v: pendentes, legenda: 'parte ainda sem entrega', tom: 'vermelho' },
    { rotulo: 'Verificar', f: `COUNTIFS(${rng('J')},"VERIFICAR",${rng('C')},">=0")`, v: verificar, legenda: 'a contagem não bate — nada se paga até conferir', tom: 'amarelo' },
  ]);
  linha(8, 12);
  secao(9, 'PAGAMENTO (pela quantidade de notas)');
  cartoes(10, [
    { rotulo: 'Pagas integralmente', f: `COUNTIFS(${rng('S')},">=0.99995",${rng('C')},">=0")`, v: integral, legenda: 'cargas com 100% pago', tom: 'verde' },
    { rotulo: 'Pagas em parte', f: `COUNTIFS(${rng('S')},">0",${rng('S')},"<0.99995",${rng('C')},">=0")`, v: parcial, legenda: 'falta pagar o restante', tom: 'azul' },
    {
      rotulo: 'Sem pagamento', f: `COUNT(${rng('C')})-COUNTIFS(${rng('S')},">0",${rng('C')},">=0")`,
      v: semPagamento, legenda: 'nada pago ainda', tom: 'neutro',
    },
    { rotulo: 'Com saldo a pagar', f: `COUNTIF(${rng('T')},">0")`, v: comSaldo, legenda: 'liberado e ainda não pago', tom: 'amarelo' },
  ]);
  linha(13, 12);
  secao(14, 'NOTAS');
  cartoes(15, [
    { rotulo: 'Emitidas no sistema', f: `SUM(${rng('C')})`, v: emitidas, legenda: 'notas do relatório Atak', tom: 'neutro' },
    { rotulo: 'Finalizadas no B2B', f: `SUM(${rng('F')})`, v: finalizadas, legenda: 'entrega comprovada', tom: 'verde' },
    {
      rotulo: 'Entregues', f: `IFERROR(SUMPRODUCT(${rng('Q')},${rng('C')})/SUM(${rng('C')}),"")`, v: entregue ?? '',
      legenda: 'finalizadas ÷ emitidas', tom: 'verde', fmt: '0.0%',
    },
    {
      rotulo: 'Pendências abertas', f: `COUNTIFS(${rng('K')},"<>${SEM_PENDENCIA}",${rng('K')},"<>")`, v: pendAbertas,
      legenda: 'notas que ainda não foram entregues', tom: 'vermelho',
    },
  ]);
  linha(18, 14);
  /* Canhoto original: acompanhamento do papel, fora do pagamento. */
  secao(19, 'CANHOTO ORIGINAL (só acompanhamento — não entra no pagamento)');
  cartoes(20, [
    { rotulo: 'Canhoto veio', f: `COUNTIFS(${rng('W')},"SIM",${rng('C')},">=0")`, v: comCanhoto, legenda: 'papel já chegou', tom: 'verde' },
    { rotulo: 'Canhoto não veio', f: `COUNTIFS(${rng('W')},"NÃO",${rng('C')},">=0")`, v: semCanhoto, legenda: 'ainda sem o papel', tom: 'amarelo' },
    {
      rotulo: '% com canhoto', f: `IFERROR(COUNTIFS(${rng('W')},"SIM",${rng('C')},">=0")/COUNT(${rng('C')}),"")`,
      v: total ? comCanhoto / total : '', legenda: 'veio ÷ cargas', tom: 'neutro', fmt: '0.0%',
    },
    {
      rotulo: 'Pagas sem canhoto', f: `COUNTIFS(${rng('S')},">=0.99995",${rng('W')},"NÃO",${rng('C')},">=0")`,
      v: pagasSemCanhoto, legenda: '100% pago e o papel não chegou', tom: 'vermelho',
    },
  ]);
  linha(23, 14);

  /* Pendências por tratativa */
  secao(24, 'PENDÊNCIAS POR TRATATIVA');
  const eCab = { fonte: { nome: FONTE, tam: 10, neg: true, cor: C.branco }, fundo: C.navy, alin: { h: 'center', v: 'center', quebrar: true } };
  const eCabEsq = { ...eCab, alin: { h: 'left', v: 'center', recuo: 1 } };
  const ch = linha(25, 24);
  ch[0] = { v: 'Tratativa', e: eCabEsq }; ch[1] = { e: eCabEsq }; ch[2] = { v: 'Pendências', e: eCab }; ch[3] = { v: '% do total', e: eCab };
  ch[4] = { v: 'O que significa', e: eCabEsq }; for (let j = 5; j < 8; j += 1) ch[j] = { e: eCabEsq };
  mesclar.push('A26:B26', 'E26:H26');
  const SENTIDO = {
    '': 'Ninguém consultou ainda — é o que falta olhar.',
    'SEM TRATATIVA': 'Olhei e não há o que fazer por enquanto.',
    DEVOLUÇÃO: 'A nota voltou: a transportadora fez a parte dela — libera o pagamento da nota.',
    OK: 'Consultado no sistema, está certo — libera o pagamento da nota.',
    'SUMIU DO B2B': 'A nota sumiu do B2B — não libera até aparecer.',
  };
  const SENTIDOS = r.tratativas;
  const eCorpo = { fonte: { nome: FONTE, tam: 11, cor: C.tinta }, alin: { h: 'center', v: 'center' }, borda: { base: { estilo: 'thin', cor: C.linha } } };
  const eEsq = { ...eCorpo, alin: { h: 'left', v: 'center', recuo: 1 } };
  const ePct = { ...eCorpo, fmt: '0.0%' };
  const primeiraT = 26; // índice da primeira linha de tratativa (logo abaixo do cabeçalho da linha 25)
  const totalT = primeiraT + SENTIDOS.length;
  SENTIDOS.forEach(({ nome, chave, qtd, pct, libera }, k) => {
    const i = primeiraT + k;
    const l = linha(i, 22);
    const sentido = SENTIDO[chave ?? ''];
    const liberam = libera;
    l[0] = { v: nome, e: { ...eEsq, fonte: { ...eEsq.fonte, neg: !!liberam } } }; l[1] = { e: eEsq };
    l[2] = chave === null
      ? { f: `COUNTIFS(${rng('K')},"<>${SEM_PENDENCIA}",${rng('K')},"<>",${rng('L')},"")`, v: qtd, e: eCorpo }
      : { f: `COUNTIFS(${rng('L')},"${chave}")`, v: qtd, e: eCorpo };
    l[3] = { f: `IF(C$${totalT + 1}>0,C${i + 1}/C$${totalT + 1},0)`, v: pct, e: ePct };
    l[4] = { v: sentido, e: eEsq }; for (let j = 5; j < 8; j += 1) l[j] = { e: eEsq };
    mesclar.push(`A${i + 1}:B${i + 1}`, `E${i + 1}:H${i + 1}`);
  });
  const eTot = { ...eCorpo, fonte: { ...eCorpo.fonte, neg: true }, borda: { topo: { estilo: 'medium', cor: C.navy }, base: { estilo: 'thin', cor: C.linha } } };
  const lt = linha(totalT, 24);
  lt[0] = { v: 'Total', e: { ...eTot, alin: { h: 'left', v: 'center', recuo: 1 } } }; lt[1] = { e: eTot };
  lt[2] = { f: `SUM(C${primeiraT + 1}:C${totalT})`, v: pendAbertas, e: eTot };
  lt[3] = { f: `SUM(D${primeiraT + 1}:D${totalT})`, v: pendAbertas ? 1 : 0, e: { ...eTot, fmt: '0.0%' } };
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
  const primeiraTr = iSec + 2;
  r.transportadoras.forEach((tr, k) => {
    const i = primeiraTr + k; const x = i + 1;
    const l = linha(i, 22);
    const crit = tr.nome ? `$A${x}` : '""';
    l[0] = { v: tr.nome || '(sem transportadora)', e: eEsq }; l[1] = { e: eEsq };
    l[2] = { f: `COUNTIFS(${rng('O')},${crit},${rng('C')},">=0")`, v: tr.cargas, e: eCorpo };
    [['LIBERADA', tr.liberadas], ['PENDENTE', tr.pendentes], ['VERIFICAR', tr.verificar]].forEach(([sit, qtd], q) => {
      l[3 + q] = { f: `COUNTIFS(${rng('O')},${crit},${rng('J')},"${sit}",${rng('C')},">=0")`, v: qtd, e: eCorpo };
    });
    l[6] = { f: `COUNTIFS(${rng('O')},${crit},${rng('K')},"<>${SEM_PENDENCIA}",${rng('K')},"<>")`, v: tr.pendAbertas, e: eCorpo };
    l[7] = {
      f: `IFERROR(SUMPRODUCT(--(${rng('O')}=${crit}),${rng('Q')},${rng('C')})/SUMIFS(${rng('C')},${rng('O')},${crit}),"")`,
      v: tr.entregue ?? '', e: ePct,
    };
    mesclar.push(`A${x}:B${x}`);
  });
  const ultimaTr = primeiraTr + r.transportadoras.length - 1;
  const totTr = ultimaTr + 1;
  const ltr = linha(totTr, 24);
  ltr[0] = { v: 'Total', e: { ...eTot, alin: { h: 'left', v: 'center', recuo: 1 } } }; ltr[1] = { e: eTot };
  const somaCol = (col, valor) => ({ f: `SUM(${col}${primeiraTr + 1}:${col}${ultimaTr + 1})`, v: valor, e: eTot });
  ltr[2] = somaCol('C', total);
  ltr[3] = somaCol('D', liberadas); ltr[4] = somaCol('E', pendentes); ltr[5] = somaCol('F', verificar);
  ltr[6] = somaCol('G', pendAbertas);
  ltr[7] = { f: `IFERROR(SUMPRODUCT(${rng('Q')},${rng('C')})/SUM(${rng('C')}),"")`, v: entregue ?? '', e: { ...eTot, fmt: '0.0%' } };
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
  item('Dourado', 'Preenchimento manual: é aqui que se trabalha (tratativa, data do pagamento, % pago, observação, canhoto original).', chip(C.ouro, C.navy));
  espaco();
  secao('SITUAÇÃO DA CARGA');
  item('LIBERADA', 'Tudo que o sistema emitiu está Finalizado no B2B.', chip(C.verdeFundo, C.verdeTexto));
  item('PENDENTE', 'A contagem bate e parte das notas está Finalizada, parte não. Paga-se a parte finalizada; o resto espera.', chip(C.vermelhoFundo, C.vermelhoTexto));
  item('VERIFICAR', 'A contagem NÃO bate (Qtde SIST ≠ Qtde B2B), há nota que existe de um lado só, ou nada foi finalizado. Antes de pagar, alguém precisa olhar se o B2B está certo.', chip(C.amareloFundo, C.amareloTexto));
  espaco();
  secao('STATUS PENDÊNCIA — O QUE FOI FEITO COM A NOTA');
  item('(em branco)', 'Ninguém consultou ainda. A célula fica destacada em amarelo para mostrar o que falta olhar.');
  item('SEM TRATATIVA', 'Olhei e não há o que fazer por enquanto. Não libera.');
  item('DEVOLUÇÃO', 'A nota foi devolvida — a transportadora fez a parte dela. Libera o pagamento da nota.');
  item('OK', 'Consultei no sistema e está tudo certo (o canhoto existe; o status do B2B é que estava errado). Libera o pagamento da nota.');
  item('SUMIU DO B2B', 'A nota não aparece mais no B2B. Não libera até aparecer.');
  espaco();
  secao('PAGAMENTO — PELA QUANTIDADE DE NOTAS, SEM VALOR EM R$');
  item('% Entregue', 'Notas Finalizadas no B2B ÷ notas emitidas no sistema. É o que o B2B comprova.');
  item('% Liberado', '% Entregue + as notas pendentes marcadas OK ou DEVOLUÇÃO. É o máximo que pode ser pago hoje. Em carga VERIFICAR aparece "conferir": nada é liberado até alguém olhar se o B2B está certo.');
  item('% Pago', 'Quanto da carga já foi pago (digite como 62,5%). Vazio = nada pago.');
  item('A pagar agora', '% Liberado − % Pago. Fica dourado quando há saldo: é a lista do que ficou para trás. Em carga VERIFICAR aparece "conferir".');
  item('Status p/ pagamento', 'O que fazer com a carga: A PAGAR (há liberado ainda não pago — a carga inteira recém-liberada, ou a nota pendente que acabou de receber OK/DEVOLUÇÃO) · PARCIAL (pagou tudo que estava liberado; ainda há nota pendente) · INTEGRAL (100% liberado e 100% pago) · "conferir" (carga VERIFICAR). É fórmula: sai do % Liberado e do % Pago.');
  espaco();
  secao('CANHOTO ORIGINAL — SÓ ACOMPANHAMENTO');
  item('Canhoto original', 'SIM quando o canhoto em papel chegou; NÃO enquanto não chegou. A coluna ao lado guarda o dia em que alguém marcou. Não entra no % liberado, no % pago nem em "A pagar agora": o fechamento continua pelo digital (B2B e tratativas).', chip(C.verdeFundo, C.verdeTexto));
  item('Pagas sem canhoto', 'No RESUMO: cargas com 100% pago cujo papel ainda não chegou — a lista de quem cobrar o canhoto.');
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
  const grade = montarGrade(cargas);
  return escreverXlsx({
    titulo: exemplo ? 'Controle de Pagamento de Frete (modelo de exemplo)' : 'Controle de Pagamento de Frete',
    geradoEm: quando,
    abas: [abaControle(grade), abaResumo(grade.resumo, { geradoEm: quando, exemplo }), abaLeiaMe({ exemplo })],
  });
}
