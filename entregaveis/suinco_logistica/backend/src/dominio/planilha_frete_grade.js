/* =====================================================================
   A GRADE DO PAGAMENTO DE FRETE — a planilha, em dados — 05/10/2026
   ---------------------------------------------------------------------
   Pedido do dono (05/10/2026): "na aba de pagamento de frete, as
   informações precisam corresponder à planilha, como se o sistema
   utilizasse uma planilha no mesmo formato, com lógica compatível com a
   programação."

   Por isso a tela e o arquivo Excel NÃO calculam nada cada um por si: os
   dois recebem a MESMA grade, montada aqui —
     · a exportação (planilha_frete_export.js) põe estilo, fórmula e cor;
     · a tela (GET /pagamento-frete) desenha a mesma grade, coluna por
       coluna, linha por linha.
   Duas cópias da conta divergem no primeiro caso novo; uma só não tem como.

   A GRADE: 22 colunas (A–P são as da planilha da Daniela, na ordem dela; Q–V
   são acréscimo) e uma linha por pendência. A primeira linha de cada carga
   traz as contagens; as seguintes só repetem data, carga, situação e
   transportadora (para o filtro funcionar), e listam a pendência.
   ===================================================================== */
import {
  indicadoresDaCarga, rotuloDaPendencia, TRATATIVAS, TRATATIVAS_QUE_LIBERAM,
} from './pagamento_frete.js';

export const SEM_PENDENCIA = 'SEM PENDÊNCIA';

/* tipo: 'rel' vem dos relatórios · 'manual' alguém preenche · 'calc' é conta.
   chave: o nome da coluna no JSON da API. */
export const COLUNAS = [
  { chave: 'data', t: 'Data Consulta', tipo: 'rel', larg: 13.5 },
  { chave: 'carga', t: 'Carga', tipo: 'rel', larg: 10.5 },
  { chave: 'qtdSist', t: 'Qtde SIST', tipo: 'rel', larg: 10 },
  { chave: 'qtdB2b', t: 'Qtde B2B', tipo: 'rel', larg: 10 },
  { chave: 'diferenca', t: 'Diferença', tipo: 'calc', larg: 11 },
  { chave: 'finalizadas', t: 'Finalizadas', tipo: 'rel', larg: 11.5 },
  { chave: 'aguardando', t: 'Aguardando', tipo: 'rel', larg: 11.5 },
  { chave: 'naoEntregue', t: 'Não Entregue', tipo: 'rel', larg: 12.5 },
  { chave: 'outros', t: 'Outros Status', tipo: 'rel', larg: 12 },
  { chave: 'situacao', t: 'Situação', tipo: 'calc', larg: 14 },
  { chave: 'resumo', t: 'Resumo Pendências', tipo: 'rel', larg: 32 },
  { chave: 'tratativa', t: 'Status Pendência', tipo: 'manual', larg: 19 },
  { chave: 'statusPagamento', t: 'Status p/ pagamento', tipo: 'calc', larg: 15.5 },
  { chave: 'dataPagamento', t: 'Data Pagamento', tipo: 'manual', larg: 14.5 },
  { chave: 'transportadora', t: 'Transportadora', tipo: 'manual', larg: 24 },
  { chave: 'cte', t: 'CT-E', tipo: 'manual', larg: 12 },
  { chave: 'entregue', t: '% Entregue', tipo: 'calc', larg: 12 },
  { chave: 'liberado', t: '% Liberado', tipo: 'calc', larg: 12 },
  { chave: 'pago', t: '% Pago', tipo: 'manual', larg: 10.5 },
  { chave: 'aPagar', t: 'A pagar agora', tipo: 'calc', larg: 13 },
  { chave: 'dataTratativa', t: 'Data Tratativa', tipo: 'manual', larg: 14 },
  { chave: 'observacao', t: 'Observação', tipo: 'manual', larg: 38 },
  /* Canhoto original: SÓ acompanhamento (pedido do dono, 05/10/2026). Não
     entra em % liberado, % pago nem em "A pagar agora" — é a caixinha de
     "o papel chegou?", e a data é a de quando alguém marcou. */
  { chave: 'canhoto', t: 'Canhoto original', tipo: 'manual', larg: 12 },
  { chave: 'canhotoEm', t: 'Canhoto marcado em', tipo: 'calc', larg: 13 },
];
export const IX = Object.fromEntries(COLUNAS.map((c, i) => [c.chave, i]));
export const COLUNAS_DA_PLANILHA = COLUNAS.map((c) => c.t);

/* As fórmulas do Excel que dão o MESMO resultado das contas daqui. A conta
   do painel é `indicadoresDaCarga`; estas só a repetem em linguagem de
   planilha, para quem edita o arquivo offline (o teste confere as duas). */
const K_PEND = `$K:$K,"<>${SEM_PENDENCIA}",$K:$K,"<>*(Só no B2B)",$K:$K,"<>"`;
export const FORMULAS = {
  diferenca: (x) => `C${x}-D${x}`,
  situacao: (x) => `IF(OR(C${x}<>D${x},F${x}=0,COUNTIFS($B:$B,B${x},$K:$K,"*(Não localizada no B2B)")+COUNTIFS($B:$B,B${x},$K:$K,"*(Só no B2B)")>0),"VERIFICAR",IF(F${x}=C${x},"LIBERADA","PENDENTE"))`,
  situacaoRepetida: (primeira) => `J${primeira}`,
  statusPagamento: (x) => `IF(J${x}="VERIFICAR","conferir",IF(N(T${x})>0,"A PAGAR",IF(AND(N(R${x})>=0.99995,N(S${x})>=0.99995),"INTEGRAL",IF(N(R${x})>0,"PARCIAL",""))))`,
  entregue: (x) => `IF(C${x}>0,(C${x}-COUNTIFS($B:$B,B${x},${K_PEND}))/C${x},"")`,
  /* As tratativas que liberam vêm de TRATATIVAS_QUE_LIBERAM — uma regra, dois
     chamadores (a conta do painel e a fórmula do Excel). Em 05/10 a fórmula
     ainda somava "OK" e "OK B2B" com a lista já em OK e DEVOLUÇÃO: a prova no
     LibreOffice pegou 4 células divergindo antes de publicar. */
  liberado: (x) => `IF(C${x}>0,IF(J${x}="VERIFICAR","conferir",MIN(1,Q${x}+(${TRATATIVAS_QUE_LIBERAM.map((t) => `COUNTIFS($B:$B,B${x},$K:$K,"<>*(Só no B2B)",$L:$L,"${t}")`).join('+')})/C${x})),"")`,
  aPagar: (x) => `IF(C${x}>0,IF(J${x}="VERIFICAR","conferir",MAX(0,ROUND(R${x}-S${x},4))),"")`,
};

const num = (v) => Number(v) || 0;
/* Dia (AAAA-MM-DD) de um instante, no fuso da operação — o carimbo é UTC no banco. */
const DIA_LOCAL = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
export const diaLocal = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DIA_LOCAL.format(d);
};

/* cargas: [{ numero, dataConsulta:'AAAA-MM-DD', qtdSist, qtdB2b, finalizadas, aguardando,
              naoEntregue, outros, transportadora, cte, obs, pctPago (0–100), dataPagamento,
              pendencias:[{ nota, categoria, statusB2b, tratativa, tratativaEm, obs }] }]
   → { colunas, linhas, resumo } */
export function montarGrade(cargas) {
  const ordenadas = [...cargas].sort((a, b) => String(a.dataConsulta ?? '').localeCompare(String(b.dataConsulta ?? '')) || Number(a.numero) - Number(b.numero));
  const linhas = [];

  for (const carga of ordenadas) {
    const ind = indicadoresDaCarga(carga);
    const pend = carga.pendencias ?? [];
    const n = Math.max(1, pend.length);
    const primeiraLinha = linhas.length + 2; // número da linha na planilha (a 1 é o cabeçalho)

    for (let i = 0; i < n; i += 1) {
      const p = pend[i];
      const x = linhas.length + 2;
      const primeira = i === 0;
      const c = COLUNAS.map(() => ({ v: null }));
      c[IX.data] = { v: carga.dataConsulta ?? null, t: 'd' };
      c[IX.carga] = { v: Number(carga.numero), t: 'n' };
      c[IX.resumo] = { v: p ? `${p.nota} (${rotuloDaPendencia(p)})` : SEM_PENDENCIA };
      c[IX.tratativa] = { v: p?.tratativa || null };
      c[IX.transportadora] = { v: carga.transportadora || null };
      c[IX.dataTratativa] = { v: p?.tratativaEm ?? null, t: 'd' };
      c[IX.observacao] = { v: (primeira ? [carga.obs, p?.obs] : [p?.obs]).filter(Boolean).join(' · ') || null };

      if (primeira) {
        c[IX.qtdSist] = { v: num(carga.qtdSist), t: 'n' };
        c[IX.qtdB2b] = { v: num(carga.qtdB2b), t: 'n' };
        c[IX.diferenca] = { v: num(carga.qtdSist) - num(carga.qtdB2b), f: FORMULAS.diferenca(x), t: 'n' };
        c[IX.finalizadas] = { v: num(carga.finalizadas), t: 'n' };
        c[IX.aguardando] = { v: num(carga.aguardando), t: 'n' };
        c[IX.naoEntregue] = { v: num(carga.naoEntregue), t: 'n' };
        c[IX.outros] = { v: num(carga.outros), t: 'n' };
        c[IX.situacao] = { v: ind.situacao, f: FORMULAS.situacao(x) };
        c[IX.statusPagamento] = { v: ind.statusPagamento, f: FORMULAS.statusPagamento(x) };
        c[IX.dataPagamento] = { v: carga.dataPagamento ?? null, t: 'd' };
        c[IX.cte] = { v: carga.cte || null, t: 's' };
        c[IX.entregue] = { v: ind.entregue ?? '', f: FORMULAS.entregue(x), t: 'n' };
        c[IX.liberado] = { v: ind.conferir ? 'conferir' : (ind.liberado ?? ''), f: FORMULAS.liberado(x), t: 'n' };
        c[IX.pago] = { v: ind.pago > 0 ? ind.pago : null, t: 'n' };
        c[IX.aPagar] = { v: ind.conferir ? 'conferir' : (ind.aPagar ?? ''), f: FORMULAS.aPagar(x), t: 'n' };
        c[IX.canhoto] = { v: carga.canhotoOriginal === true ? 'SIM' : 'NÃO' };
        c[IX.canhotoEm] = { v: carga.canhotoOriginal === true ? diaLocal(carga.canhotoEm) : null, t: 'd' };
      } else {
        c[IX.situacao] = { v: ind.situacao, f: FORMULAS.situacaoRepetida(primeiraLinha) };
      }
      linhas.push({
        carga: Number(carga.numero), primeira, nota: p?.nota ?? null, categoria: p?.categoria ?? null,
        cliente: p?.cliente ?? '', cidade: p?.cidade ?? '',
        obsNota: p?.obs ?? '', obsCarga: primeira ? (carga.obs ?? '') : '', celulas: c,
      });
    }
  }
  return { colunas: COLUNAS, linhas, resumo: resumoDaGrade(ordenadas) };
}

/* O RESUMO — as mesmas contas da aba RESUMO do arquivo, e dos cartões da tela. */
export function resumoDaGrade(cargas) {
  const ind = cargas.map((c) => ({ c, i: indicadoresDaCarga(c) }));
  const total = ind.length;
  const por = (sit) => ind.filter((x) => x.i.situacao === sit).length;
  /* Pagas integral/em parte são pelo % PAGO (o que já foi pago); o Status p/
     pagamento é outra coisa — o que fazer (statusParaPagamento). */
  const integral = ind.filter((x) => x.i.pago >= 0.99995).length;
  const parcial = ind.filter((x) => x.i.pago > 0 && x.i.pago < 0.99995).length;
  const emitidas = ind.reduce((s, x) => s + num(x.c.qtdSist), 0);
  const entregues = ind.reduce((s, x) => s + (x.i.entregue ?? 0) * num(x.c.qtdSist), 0);
  const todasPend = cargas.flatMap((c) => c.pendencias ?? []);

  const tratativas = [{ nome: 'Sem olhar (em branco)', chave: null }, ...TRATATIVAS.map((t) => ({ nome: t, chave: t }))].map((t) => {
    const qtd = todasPend.filter((p) => (t.chave === null ? !p.tratativa : p.tratativa === t.chave)).length;
    return { nome: t.nome, chave: t.chave, qtd, pct: todasPend.length ? qtd / todasPend.length : 0, libera: !!t.chave && TRATATIVAS_QUE_LIBERAM.includes(t.chave) };
  });

  const nomes = [...new Set(cargas.map((c) => (c.transportadora || '').trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (nomes.includes('')) { nomes.splice(nomes.indexOf(''), 1); nomes.push(''); }
  const transportadoras = nomes.map((nome) => {
    const dele = ind.filter((y) => (y.c.transportadora || '').trim() === nome);
    const qs = dele.reduce((s, y) => s + num(y.c.qtdSist), 0);
    const ent = dele.reduce((s, y) => s + (y.i.entregue ?? 0) * num(y.c.qtdSist), 0);
    return {
      nome, cargas: dele.length,
      liberadas: dele.filter((y) => y.i.situacao === 'LIBERADA').length,
      pendentes: dele.filter((y) => y.i.situacao === 'PENDENTE').length,
      verificar: dele.filter((y) => y.i.situacao === 'VERIFICAR').length,
      pendAbertas: dele.reduce((s, y) => s + (y.c.pendencias ?? []).length, 0),
      entregue: qs ? ent / qs : null,
    };
  });

  return {
    cargas: total, liberadas: por('LIBERADA'), pendentes: por('PENDENTE'), verificar: por('VERIFICAR'),
    integral, parcial, semPagamento: total - integral - parcial,
    comSaldo: ind.filter((x) => (x.i.aPagar ?? 0) > 0).length,
    comCanhoto: ind.filter((x) => x.c.canhotoOriginal === true).length,
    semCanhoto: ind.filter((x) => x.c.canhotoOriginal !== true).length,
    pagasSemCanhoto: ind.filter((x) => x.i.pago >= 0.99995 && x.c.canhotoOriginal !== true).length,
    aPagarAgora: ind.filter((x) => x.i.statusPagamento === 'A PAGAR').length,
    emitidas, finalizadas: ind.reduce((s, x) => s + num(x.c.finalizadas), 0),
    entregue: emitidas ? entregues / emitidas : null,
    pendAbertas: todasPend.length,
    tratativas, transportadoras,
  };
}
