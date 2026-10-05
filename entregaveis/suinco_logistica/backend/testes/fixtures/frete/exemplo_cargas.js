/* Cargas INVENTADAS (9008xx, notas 81xxxx, transportadoras "Exemplo") para o
   modelo da planilha de Pagamento de Frete e para os testes. Nenhum dado real:
   a regra da casa é nunca pôr carga, nota ou cliente de verdade no repositório. */
const p = (nota, categoria, extra = {}) => ({ nota: String(nota), categoria, statusB2b: '', tratativa: '', tratativaEm: null, obs: '', ...extra });

export const CARGAS_DE_EXEMPLO = [
  { numero: 900801, dataConsulta: '2026-09-28', qtdSist: 6, qtdB2b: 6, finalizadas: 6, aguardando: 0, naoEntregue: 0, outros: 0,
    transportadora: 'Transp. Exemplo A', cte: '18501', pctPago: 100, dataPagamento: '2026-10-02', pendencias: [] },
  { numero: 900802, dataConsulta: '2026-09-28', qtdSist: 8, qtdB2b: 8, finalizadas: 4, aguardando: 1, naoEntregue: 1, outros: 2,
    transportadora: 'Transp. Exemplo A', cte: '18502', pctPago: 50, dataPagamento: '2026-10-02',
    pendencias: [
      p(810203, 'aguardando', { tratativa: 'OK', tratativaEm: '2026-09-30' }),
      p(810205, 'nao_entregue', { tratativa: 'DEV', tratativaEm: '2026-09-30', obs: 'Cliente recusou' }),
      p(810207, 'outro', { statusB2b: 'Cancelado' }),
      p(810208, 'outro', { statusB2b: 'A caminho', tratativa: 'SEM TRATATIVA' }),
    ] },
  { numero: 900803, dataConsulta: '2026-09-29', qtdSist: 5, qtdB2b: 5, finalizadas: 4, aguardando: 1, naoEntregue: 0, outros: 0,
    transportadora: 'Transp. Exemplo B', cte: '', pctPago: 0, dataPagamento: null,
    pendencias: [
      p(810304, 'aguardando'),
      p(810305, 'nao_localizada', { tratativa: 'SEM TRATATIVA', obs: 'Não tem no B2B (mandar foto)' }),
      p(810399, 'so_b2b', { statusB2b: 'Finalizado', obs: 'Nota só aparece no B2B' }),
    ] },
  { numero: 900805, dataConsulta: '2026-09-29', qtdSist: 40, qtdB2b: 40, finalizadas: 36, aguardando: 3, naoEntregue: 1, outros: 0,
    transportadora: 'Transp. Exemplo B', cte: '18505', pctPago: 90, dataPagamento: '2026-10-02',
    pendencias: [
      p(810511, 'aguardando', { tratativa: 'OK', tratativaEm: '2026-10-01' }),
      p(810518, 'aguardando', { tratativa: 'OK B2B', tratativaEm: '2026-10-01' }),
      p(810522, 'aguardando'),
      p(810530, 'nao_entregue', { tratativa: 'DEV NO SISTEMA', tratativaEm: '2026-10-01' }),
    ] },
  { numero: 900806, dataConsulta: '2026-09-30', qtdSist: 3, qtdB2b: 3, finalizadas: 0, aguardando: 3, naoEntregue: 0, outros: 0,
    transportadora: 'Transp. Exemplo C', cte: '', pctPago: 0, dataPagamento: null, obs: 'Canhotos ainda não chegaram',
    pendencias: [p(810601, 'aguardando'), p(810602, 'aguardando'), p(810603, 'aguardando')] },
  { numero: 900807, dataConsulta: '2026-10-01', qtdSist: 3, qtdB2b: 3, finalizadas: 3, aguardando: 0, naoEntregue: 0, outros: 0,
    transportadora: 'Transp. Exemplo C', cte: '18507', pctPago: 0, dataPagamento: null, pendencias: [] },
  { numero: 900808, dataConsulta: '2026-10-01', qtdSist: 2, qtdB2b: 2, finalizadas: 1, aguardando: 1, naoEntregue: 0, outros: 0,
    transportadora: 'Transp. Exemplo A', cte: '18508', pctPago: 0, dataPagamento: null,
    pendencias: [p(810801, 'aguardando')] },
  { numero: 900809, dataConsulta: '2026-10-02', qtdSist: 12, qtdB2b: 11, finalizadas: 11, aguardando: 0, naoEntregue: 0, outros: 0,
    transportadora: 'Transp. Exemplo B', cte: '18509', pctPago: 0, dataPagamento: null,
    pendencias: [p(810909, 'nao_localizada', { tratativa: 'SUMIU DO B2B', tratativaEm: '2026-10-02', obs: 'Perguntei à Portaria' })] },
  { numero: 900810, dataConsulta: '2026-10-05', qtdSist: 20, qtdB2b: 20, finalizadas: 18, aguardando: 2, naoEntregue: 0, outros: 0,
    transportadora: '', cte: '', pctPago: 0, dataPagamento: null,
    pendencias: [p(811001, 'aguardando'), p(811004, 'aguardando')] },
  { numero: 900811, dataConsulta: '2026-10-05', qtdSist: 15, qtdB2b: 15, finalizadas: 15, aguardando: 0, naoEntregue: 0, outros: 0,
    transportadora: 'Transp. Exemplo C', cte: '18511', pctPago: 60, dataPagamento: '2026-10-05', pendencias: [] },
];
