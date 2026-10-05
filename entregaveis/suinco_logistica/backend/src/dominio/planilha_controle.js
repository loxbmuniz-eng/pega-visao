/* =====================================================================
   O PAINEL ENTENDE A PLANILHA DE CONTROLE — 05/10/2026
   ---------------------------------------------------------------------
   DECISÃO DO DONO (05/10/2026): o painel NÃO importa XLSX — a entrada são os
   PDFs do B2B e do Atak. Mas "se precisar importar o xlsx alguma vez, é bom
   que você consiga entender a linguagem". Por isso este leitor FICA, sem botão:
   ele entende a planilha da Daniela (a original) E a que o painel exporta (o
   modelo novo, com % Pago, Data Tratativa e Observação), e o teste
   `pagamento_frete_leitura.test.js` exporta, lê de volta e confere que nada
   se perde. Ligar um botão de importar é questão de uma rota, não de entender
   o formato.

   (texto original, de quando o plano era migrar a planilha dela:)
   Pedido do dono: "nós faremos a migração dessa planilha para essa aba,
   então tudo funcionará no nosso sistema". A planilha é a
   Controle_Cargas__B2B.xlsx da Daniela: uma aba por rodada de conferência,
   com estas colunas (a ordem é a dela, mas a leitura é PELO NOME do
   cabeçalho — se ela acrescentar ou mover uma coluna, continua certo):

     Data Consulta · Carga · Qtde SIST · Qtde B2B · Diferença · Finalizadas
     · Aguardando · Não Entregue · Outros Status · Situação · Resumo
     Pendências · Status Pendência · Status p/ pagamento · Data Pagamento
     · Transportadora · CT-E

   O JEITO DA PLANILHA, medido nos dados reais:
     · a carga ocupa VÁRIAS linhas: a primeira traz as contagens (C a J) e
       as seguintes só repetem a carga e listam uma pendência por linha
       ("173556 (Aguardando)") com a tratativa ao lado;
     · "Status p/ pagamento" é `1` (formatado 100%) ou o texto PARCIAL —
       sem dizer QUANTO. O painel estima o percentual pelo que estava
       finalizado e MARCA como estimado: palavra dela é "PARCIAL", e o
       número é conta do painel;
     · a Situação (J) é recalculada pela regra do painel; se a planilha
       dizia outra coisa, vira aviso (63 de 65 cargas coincidem — as
       diferenças foram marcações à mão).

   ESTE ARQUIVO SÓ TRADUZ: não grava nada, não fala com o banco.
   ===================================================================== */
import {
  chaveDaNota, semAcento, arredondar2, categoriaDoRotulo, lerResumoDePendencia,
  lerTratativaDaPlanilha, situacaoDaCarga,
} from './pagamento_frete.js';

const COLUNAS = {
  dataConsulta: 'data consulta', carga: 'carga', qtdSist: 'qtde sist', qtdB2b: 'qtde b2b',
  finalizadas: 'finalizadas', aguardando: 'aguardando', naoEntregue: 'nao entregue',
  outros: 'outros status', situacao: 'situacao', resumo: 'resumo pendencias',
  tratativa: 'status pendencia', pagamento: 'status p/ pagamento', dataPagamento: 'data pagamento',
  transportadora: 'transportadora', cte: 'ct-e',
  // acréscimos do modelo novo (a planilha original não tem):
  pago: '% pago', dataTratativa: 'data tratativa', observacao: 'observacao',
  canhoto: 'canhoto original',
};
const OBRIGATORIAS = ['carga', 'qtdSist', 'qtdB2b', 'finalizadas', 'resumo'];

/* A linha do cabeçalho: a primeira, entre as cinco primeiras, que tem as
   colunas obrigatórias. Aba que não tem (o "RESUMO", um painel de fórmulas)
   simplesmente não é aba de controle. */
function acharCabecalho(linhas) {
  for (let i = 0; i < Math.min(5, linhas.length); i += 1) {
    const nomes = (linhas[i] ?? []).map((c) => semAcento(c));
    const ix = {};
    for (const [chave, nome] of Object.entries(COLUNAS)) {
      const j = nomes.indexOf(nome);
      if (j >= 0) ix[chave] = j;
    }
    if (OBRIGATORIAS.every((k) => ix[k] !== undefined)) return { linha: i, ix };
  }
  return null;
}

const inteiro = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null));
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const dataIso = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : null);

export function lerPlanilhaDeControle(abas, escolhidas = null) {
  const resumoDasAbas = [];
  const candidatas = [];
  for (const aba of abas) {
    const cab = acharCabecalho(aba.linhas);
    if (!cab) {
      resumoDasAbas.push({ nome: aba.nome, ehControle: false, cargas: 0 });
      continue;
    }
    const cargas = new Set();
    for (const l of aba.linhas.slice(cab.linha + 1)) {
      const c = chaveDaNota(l?.[cab.ix.carga]);
      if (c) cargas.add(c);
    }
    resumoDasAbas.push({ nome: aba.nome, ehControle: true, cargas: cargas.size });
    candidatas.push({ aba, cab });
  }
  if (!candidatas.length) return { abas: resumoDasAbas, cargas: [], avisos: ['Não achei nenhuma aba de controle (com as colunas Carga, Qtde SIST, Qtde B2B, Finalizadas e Resumo Pendências).'] };

  /* Sem escolha, vale a aba com MAIS cargas — a revisada, que contém as
   outras (no arquivo real, as 33 cargas da primeira aba estão todas na
   revisada de 64). Com várias escolhidas, a ÚLTIMA da lista prevalece. */
  let usar;
  if (escolhidas && escolhidas.length) {
    usar = candidatas.filter((c) => escolhidas.includes(c.aba.nome));
  } else {
    const maior = candidatas.reduce((a, b) => (resumoDasAbas.find((r) => r.nome === b.aba.nome).cargas > resumoDasAbas.find((r) => r.nome === a.aba.nome).cargas ? b : a));
    usar = [maior];
  }
  for (const r of resumoDasAbas) r.usada = usar.some((u) => u.aba.nome === r.nome);

  const porCarga = new Map();
  const avisosGerais = [];
  for (const { aba, cab } of usar) {
    const { ix } = cab;
    const atual = new Map();
    for (const linha of aba.linhas.slice(cab.linha + 1)) {
      const carga = chaveDaNota(linha?.[ix.carga]);
      if (!carga) continue;
      if (!atual.has(carga)) {
        atual.set(carga, {
          numero: carga, dataConsulta: null, resumo: null, transportadora: '', ctes: new Set(), pagamento: null,
          pagamentoBruto: null, dataPagamento: null, pendencias: new Map(), avisos: [],
        });
      }
      const c = atual.get(carga);
      const d = dataIso(linha[ix.dataConsulta]);
      if (d && (!c.dataConsulta || d > c.dataConsulta)) c.dataConsulta = d;
      if (!c.transportadora) c.transportadora = texto(linha[ix.transportadora]);

      if (inteiro(linha[ix.qtdSist]) !== null) {
        if (c.resumo) c.avisos.push('A planilha tem duas linhas de resumo para esta carga; usei a última.');
        c.resumo = {
          qtdSist: inteiro(linha[ix.qtdSist]), qtdB2b: inteiro(linha[ix.qtdB2b]) ?? 0,
          finalizadas: inteiro(linha[ix.finalizadas]) ?? 0, aguardando: inteiro(linha[ix.aguardando]) ?? 0,
          naoEntregue: inteiro(linha[ix.naoEntregue]) ?? 0, outros: inteiro(linha[ix.outros]) ?? 0,
          situacao: texto(linha[ix.situacao]).toUpperCase(),
        };
      }

      const pend = lerResumoDePendencia(linha[ix.resumo]);
      if (pend) {
        const trat = lerTratativaDaPlanilha(linha[ix.tratativa], c.dataConsulta);
        const cte = linha[ix.cte];
        const ant = c.pendencias.get(pend.nota);
        const categoria = categoriaDoRotulo(pend.rotulo);
        // CT-E com texto (na planilha original: "MANDAR FOTO") é observação; no modelo novo há coluna própria.
        const obsCte = ix.observacao === undefined && typeof cte === 'string' && cte.trim() && !/^\d{3,}$/.test(cte.trim()) ? `CT-E na planilha: ${cte.trim()}` : '';
        const obsColuna = ix.observacao === undefined ? '' : texto(linha[ix.observacao]);
        c.pendencias.set(pend.nota, {
          nota: pend.nota, categoria, statusB2b: categoria === 'outro' ? pend.rotulo : '',
          tratativa: trat.tratativa || ant?.tratativa || '',
          tratativaEm: (ix.dataTratativa !== undefined ? dataIso(linha[ix.dataTratativa]) : null) || trat.em || ant?.tratativaEm || null,
          obs: [trat.obs, obsColuna, obsCte].filter(Boolean).join(' · ') || ant?.obs || '',
        });
      }

      const cteVal = linha[ix.cte];
      if (typeof cteVal === 'number') c.ctes.add(String(Math.trunc(cteVal)));
      else if (typeof cteVal === 'string' && /^\d{3,}$/.test(cteVal.trim())) c.ctes.add(cteVal.trim());
      else if (ix.observacao === undefined && typeof cteVal === 'string' && cteVal.trim() && !pend) c.avisos.push(`CT-E na planilha: ${cteVal.trim()}`);

      if (c.pagamentoBruto === null && linha[ix.pagamento] !== undefined && linha[ix.pagamento] !== null) c.pagamentoBruto = linha[ix.pagamento];
      // % Pago (modelo novo) é número exato — vale mais que o texto PARCIAL, que só dá a ideia.
      if (c.pctPagoExato === undefined && ix.pago !== undefined && typeof linha[ix.pago] === 'number' && linha[ix.pago] > 0) c.pctPagoExato = linha[ix.pago];
      if (!c.dataPagamento && dataIso(linha[ix.dataPagamento])) c.dataPagamento = dataIso(linha[ix.dataPagamento]);
      // Canhoto original (modelo novo): SIM na linha da carga. Só acompanhamento.
      if (ix.canhoto !== undefined && c.canhotoOriginal === undefined && texto(linha[ix.canhoto])) {
        c.canhotoOriginal = texto(linha[ix.canhoto]).toUpperCase() === 'SIM';
      }
    }
    for (const [numero, c] of atual) porCarga.set(numero, c);
  }

  const cargas = [];
  for (const c of porCarga.values()) {
    if (!c.resumo) {
      avisosGerais.push(`Carga ${c.numero}: a planilha não tem a linha de resumo (as contagens); não será importada.`);
      continue;
    }
    const r = c.resumo;
    const pendencias = [...c.pendencias.values()];
    const semCorrespondencia = pendencias.filter((p) => p.categoria === 'nao_localizada' || p.categoria === 'so_b2b').length;
    const situacao = situacaoDaCarga({ qtdSist: r.qtdSist, qtdB2b: r.qtdB2b, finalizadas: r.finalizadas, semCorrespondencia });
    const avisos = [...c.avisos];
    if (r.situacao && r.situacao !== situacao) {
      avisos.push(`A planilha dizia ${r.situacao}; pela regra do painel é ${situacao}. Vale a regra do painel.`);
    }
    const somaB2b = r.finalizadas + r.aguardando + r.naoEntregue + r.outros;
    if (somaB2b !== r.qtdB2b) avisos.push(`As contagens por status somam ${somaB2b}, e a planilha diz ${r.qtdB2b} no B2B.`);
    const finalizadasNoSist = Math.min(r.finalizadas, r.qtdSist);
    const entreguePct = r.qtdSist ? arredondar2((finalizadasNoSist / r.qtdSist) * 100) : null;
    /* "Status p/ pagamento" é o que estava LIBERADO para pagar (decisão do dono,
       05/10/2026, rodada 2), não o que foi pago: pagamento só vem do % Pago. */
    const pg = c.pctPagoExato !== undefined
      ? { pct: arredondar2(Math.min(1, c.pctPagoExato) * 100), estimado: false }
      : null;
    if (c.pctPagoExato === undefined && c.pagamentoBruto !== null && c.pagamentoBruto !== '') {
      avisos.push(`A planilha dizia "${c.pagamentoBruto}" em Status p/ pagamento — é o que estava liberado, não o pago; nenhum pagamento importado.`);
    }
    cargas.push({
      numero: c.numero, dataConsulta: c.dataConsulta, ...r, situacao, finalizadasNoSist,
      transportadora: c.transportadora, cte: [...c.ctes].join(', '),
      pagamento: pg ? { ...pg, dataPagamento: c.dataPagamento, entreguePct } : null,
      canhotoOriginal: c.canhotoOriginal === true,
      pendencias, avisos,
    });
  }
  cargas.sort((a, b) => Number(a.numero) - Number(b.numero));
  return { abas: resumoDasAbas, cargas, avisos: avisosGerais };
}
