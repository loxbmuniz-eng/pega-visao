/* A DEMONSTRAÇÃO SEMPRE "DE HOJE" (07/10/2026, decisão 29).

   A base da vitrine (demonstracao.json) é gravada uma vez, com as datas do
   dia em que foi gerada. Com a regra da carga INATIVA (mais de 3 dias sem
   movimentação sai da fila e dos indicadores), uma semana depois a vitrine
   abriria com a Torre vazia — todas as cargas "esquecidas".

   Esta função anda TODAS as datas da base para a frente em DIAS INTEIROS,
   até a última movimentação cair nas últimas 24 horas: a hora do dia de cada
   fato fica igual (quem chegou às 7h continua chegando às 7h), a ordem e os
   intervalos entre os fatos ficam iguais, e nada vai para o futuro.

   Uma função, dois chamadores: a vitrine (gerar_vitrine.py a embute antes de
   o painel ler o disco) e os testes que usam a mesma base. */
function rejuvenescerDemonstracao(dados, agora) {
  agora = agora || Date.now();
  const DIA = 86400000;
  const movs = (dados && dados.movimentacoes) || [];
  const tempos = movs.map((m) => Date.parse(m.timestamp)).filter((t) => Number.isFinite(t));
  if (!tempos.length) return dados;
  const dias = Math.floor((agora - Math.max(...tempos)) / DIA);
  if (dias <= 0) return dados;
  const delta = dias * DIA;
  const instante = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const diaPuro = /^\d{4}-\d{2}-\d{2}$/;
  const andar = (v) => {
    if (typeof v === 'string') {
      if (instante.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t + delta).toISOString() : v; }
      if (diaPuro.test(v)) { const t = Date.parse(v + 'T12:00:00Z'); return Number.isFinite(t) ? new Date(t + delta).toISOString().slice(0, 10) : v; }
      return v;
    }
    if (Array.isArray(v)) return v.map(andar);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = andar(v[k]); return o; }
    return v;
  };
  return andar(dados);
}
