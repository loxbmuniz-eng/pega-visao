/* =====================================================================
   PAGAMENTO DE FRETE — as regras da conferência (05/10/2026)
   ---------------------------------------------------------------------
   Pedido da Logística (Daniela, via Alysson): o frete é pago POR CARGA, e
   só o que foi ENTREGUE. Cada carga tem dois relatórios, exportados um por
   vez: o DeliveryB2B ("RELATÓRIO DE STATUS DAS ENTREGAS", que diz se cada
   nota foi Finalizada) e o Atak (WRVDA501, "Relatório de Notas por Carga",
   que diz o que foi emitido). Tudo que está no sistema precisa estar no B2B;
   o que está finalizado se paga; o resto espera.

   ESTE ARQUIVO NÃO LÊ ARQUIVO NEM FALA COM O BANCO. Ele recebe as notas
   já lidas e devolve a conferência. Uma função, vários chamadores: a
   importação dos PDFs, a importação da planilha antiga, a lista e a
   exportação usam as MESMAS regras daqui — duas cópias da regra da
   "Situação" divergem no primeiro caso novo.

   AS COLUNAS DA PLANILHA DELA são o contrato (Controle_Cargas__B2B.xlsx):
     Qtde SIST · Qtde B2B · Diferença · Finalizadas · Aguardando ·
     Não Entregue · Outros Status · Situação · Resumo Pendências ·
     Status Pendência · Status p/ pagamento · Data Pagamento ·
     Transportadora · CT-E
   Conferido contra os dados reais dela (65 cargas da aba revisada): a
   Diferença é sempre SIST − B2B; Finalizadas + Aguardando + Não Entregue
   + Outros é sempre o total do B2B; a Situação segue a regra de
   `situacaoDaCarga` em 63 das 65 (as 2 exceções foram marcadas à mão).
   ===================================================================== */

/* O QUE A PESSOA FAZ COM UMA PENDÊNCIA — o vocabulário da planilha dela,
   como estava ('Status Pendência'). '' é "ninguém olhou ainda"; 'SEM
   TRATATIVA' é "olhei e não há o que fazer por enquanto" — a planilha
   distingue os dois, e a diferença é o que mostra o que falta olhar. */
export const TRATATIVAS = ['SEM TRATATIVA', 'DEV', 'DEV NO SISTEMA', 'OK B2B', 'OK', 'SUMIU DO B2B'];

/* QUEM LIBERA O PAGAMENTO. Decisão do dono (05/10/2026): "tratativa direta
   somente as com status finalizado; as demais, necessidade de consulta no
   sistema para liberação". Consultar o sistema e achar tudo certo é o 'OK'
   (e o 'OK B2B', que a planilha também usa). Devolução e "sumiu do B2B" NÃO
   liberam: a nota continua sem entrega comprovada. */
export const TRATATIVAS_QUE_LIBERAM = ['OK', 'OK B2B'];

export const semAcento = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const arredondar2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* O número da nota, como o sistema e o B2B concordam em escrevê-lo:
   "725494-3" (B2B: nota-série) e "725494" (Atak) são a mesma nota; "000725267"
   (o pedaço da chave de acesso) também. Sem dígito nenhum, vazio — nunca um
   número inventado. */
export function chaveDaNota(v) {
  const m = String(v ?? '').trim().match(/^0*(\d+)/);
  return m ? m[1] : '';
}

/* O STATUS QUE O B2B ESCREVE → o que a conferência faz com ele.
   POR PADRÃO, NÃO PAGA: qualquer palavra que não seja "Finalizado" cai em
   'outro' e fica na fila de consulta. Palavra nova do B2B nunca vira
   pagamento por engano — só deixa de ser reconhecida. */
export function categoriaDoStatus(texto) {
  const t = semAcento(texto);
  if (/^finaliz/.test(t)) return 'finalizada';
  if (/^aguardando/.test(t)) return 'aguardando';
  if (/^nao entreg/.test(t)) return 'nao_entregue';
  return 'outro';
}

/* O rótulo da pendência, como a planilha a escreve entre parênteses:
   "173556 (Aguardando)". */
export function rotuloDaPendencia({ categoria, statusB2b }) {
  switch (categoria) {
    case 'aguardando': return 'Aguardando';
    case 'nao_entregue': return 'Não entregue';
    case 'nao_localizada': return 'Não localizada no B2B';
    case 'so_b2b': return 'Só no B2B';
    default: {
      const s = String(statusB2b ?? '').trim();
      return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Outro status';
    }
  }
}

/* O inverso, para ler a planilha antiga: "Não localizada no B2B" → categoria. */
export function categoriaDoRotulo(rotulo) {
  const t = semAcento(rotulo);
  if (/^aguardando/.test(t)) return 'aguardando';
  if (/^nao entreg/.test(t)) return 'nao_entregue';
  if (/^nao localizada/.test(t)) return 'nao_localizada';
  if (/^so no b2b/.test(t)) return 'so_b2b';
  return 'outro';
}

/* A SITUAÇÃO DA CARGA — a regra da planilha dela (coluna J):
     LIBERADA  tudo que o sistema emitiu está Finalizado no B2B;
     PENDENTE  a contagem bate e parte está Finalizada, parte não;
     VERIFICAR a contagem NÃO bate, ou nada foi finalizado — antes de
               qualquer pagamento alguém precisa olhar se o B2B está
               certo ("pode ser que o B2B também esteja doido").
   `semCorrespondencia` (notas de um lado que não existem no outro) é o
   único acréscimo ao que a planilha mostra: com as duas contagens iguais
   mas notas diferentes (uma falta num lado, outra sobra no outro), a
   carga NÃO pode sair LIBERADA — é VERIFICAR. */
export function situacaoDaCarga({ qtdSist, qtdB2b, finalizadas, semCorrespondencia = 0 }) {
  if (qtdSist !== qtdB2b || semCorrespondencia > 0) return 'VERIFICAR';
  if (!finalizadas) return 'VERIFICAR';
  if (finalizadas === qtdSist) return 'LIBERADA';
  return 'PENDENTE';
}

/* A CONFERÊNCIA de uma carga.
     sist: [{ nota, cliente, cidade }]            — o que o Atak emitiu
     b2b : [{ seq, nota, status, cliente }]       — o que o B2B conta
   Devolve as contagens (as colunas C a I da planilha), as pendências e os
   avisos. Não decide pagamento nenhum. */
export function conferirCarga({ sist, b2b }) {
  const avisos = [];

  const porNotaSist = new Map();
  for (const n of sist) {
    const k = chaveDaNota(n.nota);
    if (!k) continue;
    if (porNotaSist.has(k)) avisos.push(`A nota ${k} aparece mais de uma vez no relatório do sistema; contei uma.`);
    else porNotaSist.set(k, { ...n, nota: k });
  }

  /* Nota repetida no B2B costuma ser reentrega. Vale a ÚLTIMA linha (maior
     SEQ): é a tentativa mais recente. E avisa — repetida pode também ser
     erro do relatório, e quem confere precisa saber. */
  const porNotaB2b = new Map();
  for (const n of [...b2b].sort((a, c) => (a.seq ?? 0) - (c.seq ?? 0))) {
    const k = chaveDaNota(n.nota);
    if (!k) continue;
    if (porNotaB2b.has(k)) avisos.push(`A nota ${k} aparece mais de uma vez no B2B (reentrega?); valeu a última linha.`);
    porNotaB2b.set(k, { ...n, nota: k, categoria: categoriaDoStatus(n.status) });
  }

  const cont = { finalizada: 0, aguardando: 0, nao_entregue: 0, outro: 0 };
  for (const n of porNotaB2b.values()) cont[n.categoria] += 1;

  const pendencias = [];
  let finalizadasNoSist = 0;
  for (const [k, s] of porNotaSist) {
    const b = porNotaB2b.get(k);
    if (!b) {
      pendencias.push({ nota: k, categoria: 'nao_localizada', statusB2b: '', cliente: s.cliente || '', cidade: s.cidade || '' });
    } else if (b.categoria === 'finalizada') {
      finalizadasNoSist += 1;
    } else {
      pendencias.push({
        nota: k, categoria: b.categoria, statusB2b: String(b.status ?? '').trim(),
        cliente: s.cliente || b.cliente || '', cidade: s.cidade || '',
      });
    }
  }
  for (const [k, b] of porNotaB2b) {
    if (porNotaSist.has(k)) continue;
    pendencias.push({ nota: k, categoria: 'so_b2b', statusB2b: String(b.status ?? '').trim(), cliente: b.cliente || '', cidade: '' });
  }
  pendencias.sort((a, c) => Number(a.nota) - Number(c.nota));

  const qtdSist = porNotaSist.size;
  const qtdB2b = porNotaB2b.size;
  const semCorrespondencia = pendencias.filter((p) => p.categoria === 'nao_localizada' || p.categoria === 'so_b2b').length;
  const out = {
    qtdSist, qtdB2b, diferenca: qtdSist - qtdB2b,
    finalizadas: cont.finalizada, aguardando: cont.aguardando, naoEntregue: cont.nao_entregue, outros: cont.outro,
    finalizadasNoSist, semCorrespondencia, pendencias, avisos,
  };
  out.situacao = situacaoDaCarga({ qtdSist, qtdB2b, finalizadas: cont.finalizada, semCorrespondencia });
  return out;
}

/* OS PERCENTUAIS, PELA QUANTIDADE DE NOTAS — decisão do dono: "pela
   quantidade de notas" (80 canhotos de 100 = paga os 80 e espera os 20),
   sem valor em R$.
     entregue — o que o B2B comprova (Finalizadas que o sistema também tem);
     liberado — o entregue MAIS as pendências que alguém consultou no
                sistema e liberou ('OK' / 'OK B2B'). */
export function percentuais({ qtdSist, finalizadasNoSist, liberadasPorTratativa = 0 }) {
  if (!qtdSist) return { entregue: null, liberado: null };
  return {
    entregue: arredondar2((finalizadasNoSist / qtdSist) * 100),
    liberado: arredondar2(Math.min(100, ((finalizadasNoSist + liberadasPorTratativa) / qtdSist) * 100)),
  };
}

/* OS NÚMEROS DE UMA CARGA, PRONTOS — uma função, vários chamadores: a lista
   da aba, a exportação da planilha e os testes leem DAQUI, e a planilha
   exportada traz as mesmas contas como fórmula (planilha_frete_export.js).
     carga: { qtdSist, qtdB2b, finalizadas, pctPago (0–100), pendencias:[{ categoria, tratativa }] }
   Tudo em FRAÇÃO (0–1).
   · Pendência "só no B2B" não é nota do sistema: não entra em conta de percentual.
   · CARGA VERIFICAR NÃO LIBERA NADA: `liberado` e `aPagar` saem null e
     `conferir` sai true — até alguém olhar se o B2B está certo, o painel não
     sugere pagamento. É o que a planilha real mostra: de 34 cargas VERIFICAR,
     32 estavam sem pagamento. O `entregue` continua aparecendo: é o que o B2B diz. */
export function indicadoresDaCarga(carga) {
  const qtdSist = Number(carga.qtdSist) || 0;
  const pend = carga.pendencias ?? [];
  const doSist = pend.filter((p) => p.categoria !== 'so_b2b');
  const semCorrespondencia = pend.filter((p) => p.categoria === 'nao_localizada' || p.categoria === 'so_b2b').length;
  const liberadasPorTratativa = doSist.filter((p) => TRATATIVAS_QUE_LIBERAM.includes(p.tratativa)).length;
  const situacao = situacaoDaCarga({
    qtdSist, qtdB2b: Number(carga.qtdB2b) || 0, finalizadas: Number(carga.finalizadas) || 0, semCorrespondencia,
  });
  const conferir = situacao === 'VERIFICAR';
  const pago = Math.min(1, Math.max(0, (Number(carga.pctPago) || 0) / 100));
  const statusPagamento = statusDoPagamento(pago * 100);
  if (!qtdSist) {
    return { situacao, conferir, entregue: null, liberado: null, pago, aPagar: null, liberadasPorTratativa, statusPagamento };
  }
  const entregue = (qtdSist - doSist.length) / qtdSist;
  if (conferir) {
    return { situacao, conferir, entregue, liberado: null, pago, aPagar: null, liberadasPorTratativa, statusPagamento };
  }
  const liberado = Math.min(1, entregue + liberadasPorTratativa / qtdSist);
  const aPagar = Math.max(0, Math.round((liberado - pago) * 10000) / 10000);
  return { situacao, conferir, entregue, liberado, pago, aPagar, liberadasPorTratativa, statusPagamento };
}

/* "Status p/ pagamento" da planilha: vazio, PARCIAL ou 100%. */
export function statusDoPagamento(pctPago) {
  const p = Number(pctPago) || 0;
  if (p <= 0) return '';
  return p >= 99.995 ? 'INTEGRAL' : 'PARCIAL';
}

/* Quanto ainda dá para pagar HOJE: o liberado menos o que já foi pago. */
export function saldoParaPagar({ liberado, pago }) {
  if (liberado == null) return null;
  return Math.max(0, arredondar2(liberado - (Number(pago) || 0)));
}

/* A linha da planilha, "173556 (Aguardando)" → { nota, rotulo }.
   Texto sem parêntese ("173556") → rótulo vazio. "SEM PENDÊNCIA" → null. */
export function lerResumoDePendencia(texto) {
  const t = String(texto ?? '').trim();
  if (!t || /^sem pend/i.test(semAcento(t))) return null;
  const m = t.match(/^0*(\d+)\s*(?:\((.*)\))?\s*$/);
  return m ? { nota: m[1], rotulo: (m[2] ?? '').trim() } : null;
}

/* O "Status Pendência" da planilha → o que o painel guarda.
   "OK 30/09" é "consultei no sistema e estava tudo certo, em 30/09": vira
   'OK' + a data (o ano vem da data da consulta, e o mês que ainda não
   chegou só pode ser do ano anterior). Texto que o painel não conhece NÃO
   é descartado: vai para a observação. */
export function lerTratativaDaPlanilha(texto, dataConsultaISO) {
  const t = String(texto ?? '').trim();
  if (!t) return { tratativa: '', em: null, obs: '' };
  const m = t.match(/^ok\s+(\d{1,2})\/(\d{1,2})$/i);
  if (m) {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(dataConsultaISO || '') ? dataConsultaISO : null;
    let em = null;
    if (base) {
      const [ano, mesBase] = base.split('-').map(Number);
      const dia = Number(m[1]); const mes = Number(m[2]);
      const a = mes - mesBase > 6 ? ano - 1 : ano;
      em = `${a}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    return { tratativa: 'OK', em, obs: '' };
  }
  const norm = semAcento(t);
  const achada = TRATATIVAS.find((x) => semAcento(x) === norm);
  if (achada) return { tratativa: achada, em: null, obs: '' };
  return { tratativa: '', em: null, obs: `Planilha: ${t}` };
}
