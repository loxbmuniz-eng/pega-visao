/* PAGAMENTO DE FRETE — leitura dos relatórios, regras e planilha (sem banco).
   ---------------------------------------------------------------------
   Três promessas, cada uma travada aqui:
   1. OS PDFs SÃO LIDOS CERTO. Os de exemplo (dados inventados, 9008xx) cobrem
      carga liberada, pendente, com nota faltando de um lado e do outro, carga
      de 40 notas em 2 páginas (a que revelou o corte de rodapé que derrubava
      uma linha), PDF com várias cargas e PDF de outro relatório.
   2. A TELA E O ARQUIVO SÃO A MESMA PLANILHA. A grade que a tela desenha é a
      que o Excel recebe: o teste exporta, LÊ O ARQUIVO DE VOLTA e confere
      célula por célula. Se alguém mexer numa conta de um lado só, reprova.
   3. O PAINEL ENTENDE A LINGUAGEM DA PLANILHA — a original da Daniela e a
      exportada — mesmo sem botão de importar (decisão de 05/10/2026). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { lerPaginasDoPdf } from '../src/servicos/pdf_texto.js';
import { lerRelatorioDeFrete, tipoDoRelatorio, numeroDaCargaB2b } from '../src/dominio/relatorios_frete_pdf.js';
import {
  categoriaDoStatus, situacaoDaCarga, conferirCarga, indicadoresDaCarga, chaveDaNota,
  lerResumoDePendencia, lerTratativaDaPlanilha, TRATATIVAS, TRATATIVAS_QUE_LIBERAM, normalizarTratativa, statusParaPagamento,
  parearPeloNumeroDoSistema,
} from '../src/dominio/pagamento_frete.js';
import { montarGrade, COLUNAS, COLUNAS_DA_PLANILHA, idadeEmDias } from '../src/dominio/planilha_frete_grade.js';
import { montarPlanilhaDeFrete } from '../src/dominio/planilha_frete_export.js';
import { escreverXlsx, serialDaData } from '../src/servicos/planilha_xlsx_escrita.js';
import { lerPlanilhaXlsx } from '../src/servicos/planilha_xlsx.js';
import { lerPlanilhaDeControle } from '../src/dominio/planilha_controle.js';
import { CARGAS_DE_EXEMPLO } from './fixtures/frete/exemplo_cargas.js';

const pdf = (nome) => fs.readFileSync(new URL(`./fixtures/frete/${nome}`, import.meta.url));
const lerPdf = async (nome) => lerRelatorioDeFrete(await lerPaginasDoPdf(pdf(nome)));
const confere = async (n) => {
  const b = (await lerPdf(`b2b_${n}.pdf`)).cargas[0];
  const s = (await lerPdf(`sist_${n}.pdf`)).cargas[0];
  return { b, s, r: conferirCarga({ sist: s.notas, b2b: b.linhas }) };
};

describe('regras da conferência', () => {
  test('status do B2B: só "Finalizado" é entregue; palavra desconhecida NUNCA vira pagamento', () => {
    assert.equal(categoriaDoStatus('Finalizado'), 'finalizada');
    assert.equal(categoriaDoStatus('FINALIZADO'), 'finalizada');
    assert.equal(categoriaDoStatus('Aguardando'), 'aguardando');
    assert.equal(categoriaDoStatus('Não entregue'), 'nao_entregue');
    assert.equal(categoriaDoStatus('Cancelado'), 'outro');
    assert.equal(categoriaDoStatus('A caminho'), 'outro');
    assert.equal(categoriaDoStatus('Status inventado amanhã'), 'outro');
    assert.equal(categoriaDoStatus(''), 'outro');
  });

  test('situação da carga: LIBERADA / PENDENTE / VERIFICAR', () => {
    assert.equal(situacaoDaCarga({ qtdSist: 6, qtdB2b: 6, finalizadas: 6 }), 'LIBERADA');
    assert.equal(situacaoDaCarga({ qtdSist: 8, qtdB2b: 8, finalizadas: 4 }), 'PENDENTE');
    assert.equal(situacaoDaCarga({ qtdSist: 8, qtdB2b: 7, finalizadas: 7 }), 'PENDENTE', 'nota do sistema faltando no B2B é pendência, não trava (118771 real, 05/10 à tarde)');
    assert.equal(situacaoDaCarga({ qtdSist: 31, qtdB2b: 30, finalizadas: 23 }), 'PENDENTE', 'a 118771: paga-se as 23, a que falta espera');
    assert.equal(situacaoDaCarga({ qtdSist: 7, qtdB2b: 8, finalizadas: 7 }), 'VERIFICAR', 'B2B com mais notas que o sistema: suspeito');
    assert.equal(situacaoDaCarga({ qtdSist: 3, qtdB2b: 3, finalizadas: 0 }), 'VERIFICAR', 'nada finalizado');
    assert.equal(situacaoDaCarga({ qtdSist: 5, qtdB2b: 5, finalizadas: 5, soB2b: 1 }), 'VERIFICAR', 'mesma contagem, mas uma nota só existe no B2B');
  });

  test('número da nota: "725494-3", "725494" e "000725494" são a mesma nota; sem dígito, vazio', () => {
    assert.equal(chaveDaNota('725494-3'), '725494');
    assert.equal(chaveDaNota('000725494'), '725494');
    assert.equal(chaveDaNota(' 725494 '), '725494');
    assert.equal(chaveDaNota('sem número'), '');
    assert.equal(chaveDaNota(null), '');
  });

  test('nota repetida avisa, e no B2B vale a ÚLTIMA linha (reentrega)', () => {
    const r = conferirCarga({
      sist: [{ nota: '1' }, { nota: '1' }, { nota: '2' }],
      b2b: [{ seq: 1, nota: '1-3', status: 'Aguardando' }, { seq: 2, nota: '1-3', status: 'Finalizado' }, { seq: 3, nota: '2-3', status: 'Finalizado' }],
    });
    assert.equal(r.qtdSist, 2);
    assert.equal(r.qtdB2b, 2);
    assert.equal(r.finalizadas, 2);
    assert.equal(r.avisos.length, 2);
    assert.equal(r.situacao, 'LIBERADA');
  });

  test('indicadores: entregue, liberado e a pagar pela quantidade de notas', () => {
    const i = indicadoresDaCarga({
      qtdSist: 8, qtdB2b: 8, finalizadas: 4, pctPago: 50,
      pendencias: [
        { categoria: 'aguardando', tratativa: 'OK' }, { categoria: 'nao_entregue', tratativa: 'DEVOLUÇÃO' },
        { categoria: 'outro', tratativa: '' }, { categoria: 'outro', tratativa: 'SEM TRATATIVA' },
      ],
    });
    assert.equal(i.situacao, 'PENDENTE');
    assert.equal(i.entregue, 0.5);
    assert.equal(i.liberado, 0.75, 'OK e DEVOLUÇÃO liberam: (4 finalizadas + 2) de 8');
    assert.equal(i.pago, 0.5);
    assert.equal(i.aPagar, 0.25);
    assert.equal(i.statusPagamento, 'A PAGAR', 'há liberado ainda não pago');
    assert.deepEqual(TRATATIVAS, ['SEM TRATATIVA', 'DEVOLUÇÃO', 'OK', 'SUMIU DO B2B'], 'vocabulário da rodada 2');
    assert.deepEqual(TRATATIVAS_QUE_LIBERAM, ['OK', 'DEVOLUÇÃO']);
  });

  test('fechamento e idade (rodada 45): provisão em notas, pagamentos por mês, dias sem olhar', () => {
    const hoje = '2026-10-12';
    const cargas = [
      { numero: 1, dataConsulta: '2026-09-28', qtdSist: 10, qtdB2b: 10, finalizadas: 8, pctPago: 80,
        pagamentos: [{ pct: 50, data: '2026-09-30' }, { pct: 30, data: '2026-10-02' }],
        pendencias: [{ nota: 'a', categoria: 'aguardando', tratativa: '', vistoEm: '2026-09-28' }, { nota: 'b', categoria: 'aguardando', tratativa: 'OK', tratativaEm: '2026-10-01', vistoEm: '2026-09-28' }] },
      { numero: 2, dataConsulta: '2026-10-10', qtdSist: 4, qtdB2b: 4, finalizadas: 4, pctPago: 0, pagamentos: [], pendencias: [] },
      { numero: 3, dataConsulta: '2026-10-11', qtdSist: 6, qtdB2b: 6, finalizadas: 3, pctPago: 50, pagamentos: [{ pct: 50, data: null }],
        pendencias: [{ nota: 'c', categoria: 'aguardando', tratativa: '', vistoEm: '2026-10-11' }, { nota: 'd', categoria: 'nao_entregue', tratativa: '', vistoEm: '2026-09-20' }, { nota: 'e', categoria: 'outro', tratativa: 'SEM TRATATIVA', vistoEm: '2026-10-11' }] },
    ];
    const g = montarGrade(cargas, hoje);
    const r = g.resumo;
    assert.deepEqual(r.idade, { ate7: 1, de8a14: 1, mais15: 1, maisDe7: 2, maisAntiga: 22 }, 'a: 14 dias; c: 1 dia; d: 22 dias (só as SEM tratativa contam)');
    assert.equal(r.semOlhar, 3);
    // provisão: carga 1 liberado 0.9 (8 + OK) − pago 0.8 = 0.1 × 10 = 1 nota; carga 2 liberada 100% e nada pago = 4 notas; carga 3 liberado 0.5 − 0.5 = 0
    assert.deepEqual(r.provisao, { cargas: 2, notas: 5 });
    assert.deepEqual(r.porMes, [
      { mes: '2026-10', pagamentos: 1, cargas: 1, notas: 3 },
      { mes: '2026-09', pagamentos: 1, cargas: 1, notas: 5 },
      { mes: 'sem data', pagamentos: 1, cargas: 1, notas: 3 },
    ], 'mais recente primeiro; sem data por último; notas = % × emitidas');
    const linhaA = g.linhas.find((l) => l.nota === 'a'); const linhaB = g.linhas.find((l) => l.nota === 'b');
    assert.equal(linhaA.idadeDias, 14); assert.equal(linhaB.idadeDias, null, 'com tratativa não tem idade');
    assert.equal(idadeEmDias('2026-10-05', '2026-10-12'), 7);
  });

  test('status p/ pagamento é O QUE FAZER: conferir · A PAGAR · PARCIAL · INTEGRAL (fluxo da Daniela)', () => {
    const s = (liberado, pago, conferir = false) => statusParaPagamento({ conferir, liberado, pago });
    assert.equal(s(null, 0, true), 'conferir', 'carga VERIFICAR');
    assert.equal(s(0.99, 0), 'A PAGAR', '99 de 100 finalizadas, nada pago: paga-se as 99');
    assert.equal(s(0.99, 0.99), 'PARCIAL', 'pagou as 99; a pendente espera');
    assert.equal(s(1, 0.99), 'A PAGAR', 'a pendente recebeu OK ou DEVOLUÇÃO: falta pagar 1');
    assert.equal(s(1, 1), 'INTEGRAL', '100% liberado e 100% pago');
    assert.equal(s(1, 0), 'A PAGAR', 'carga LIBERADA ainda não paga');
    assert.equal(s(0.5, 0.5), 'PARCIAL');
    assert.equal(s(null, 0), '', 'sem notas no sistema: nada a dizer');
  });

  test('as palavras antigas da planilha viram as atuais; palavra desconhecida é recusada', () => {
    assert.equal(normalizarTratativa('DEV'), 'DEVOLUÇÃO');
    assert.equal(normalizarTratativa('dev no sistema'), 'DEVOLUÇÃO');
    assert.equal(normalizarTratativa('Devolucao'), 'DEVOLUÇÃO');
    assert.equal(normalizarTratativa('OK B2B'), 'OK');
    assert.equal(normalizarTratativa('ok'), 'OK');
    assert.equal(normalizarTratativa('  '), '');
    assert.equal(normalizarTratativa('falar com o Zé'), null);
  });

  test('carga VERIFICAR não libera nada: sem "a pagar", marcada para conferir', () => {
    const i = indicadoresDaCarga({ qtdSist: 5, qtdB2b: 5, finalizadas: 5, pendencias: [{ categoria: 'nao_localizada', tratativa: 'OK' }, { categoria: 'so_b2b', tratativa: '' }] });
    assert.equal(i.situacao, 'VERIFICAR');
    assert.equal(i.conferir, true);
    assert.equal(i.liberado, null);
    assert.equal(i.aPagar, null);
    assert.ok(i.entregue < 1, 'o entregue continua aparecendo — é o que o B2B diz');
  });

  test('nota "só no B2B" não entra na conta de percentual (não é nota do sistema)', () => {
    const i = indicadoresDaCarga({ qtdSist: 4, qtdB2b: 4, finalizadas: 4, pendencias: [{ categoria: 'so_b2b', tratativa: 'OK' }, { categoria: 'nao_localizada', tratativa: '' }] });
    assert.equal(i.entregue, 0.75, 'só a nota não localizada reduz o entregue');
    assert.equal(i.liberadasPorTratativa, 0, 'o OK da nota só-B2B não libera nada');
  });

  test('palavras da planilha: "173556 (Aguardando)", "SEM PENDÊNCIA", "OK 30/09"', () => {
    assert.deepEqual(lerResumoDePendencia('173556 (Aguardando)'), { nota: '173556', rotulo: 'Aguardando' });
    assert.deepEqual(lerResumoDePendencia('725300'), { nota: '725300', rotulo: '' });
    assert.equal(lerResumoDePendencia('SEM PENDÊNCIA'), null);
    assert.equal(lerResumoDePendencia(''), null);
    assert.deepEqual(lerTratativaDaPlanilha('OK 30/09', '2026-09-22'), { tratativa: 'OK', em: '2026-09-30', obs: '' });
    assert.deepEqual(lerTratativaDaPlanilha('dev no sistema', null), { tratativa: 'DEVOLUÇÃO', em: null, obs: '' });
    assert.deepEqual(lerTratativaDaPlanilha('falar com o Zé', null), { tratativa: '', em: null, obs: 'Planilha: falar com o Zé' });
  });
});

describe('leitura dos PDFs (exemplos inventados)', () => {
  test('carga LIBERADA: 6 notas, todas finalizadas nos dois relatórios', async () => {
    const { b, s, r } = await confere('900801');
    assert.equal(b.numero, '900801');
    assert.equal(s.numero, '900801');
    assert.deepEqual([r.qtdSist, r.qtdB2b, r.finalizadas, r.situacao], [6, 6, 6, 'LIBERADA']);
    assert.equal(r.pendencias.length, 0);
  });

  test('carga PENDENTE: 4 finalizadas, 1 aguardando, 1 não entregue, 2 de outro status', async () => {
    const { r } = await confere('900802');
    assert.deepEqual(
      [r.qtdSist, r.qtdB2b, r.finalizadas, r.aguardando, r.naoEntregue, r.outros, r.situacao],
      [8, 8, 4, 1, 1, 2, 'PENDENTE'],
    );
    assert.deepEqual(r.pendencias.map((p) => p.categoria), ['aguardando', 'nao_entregue', 'outro', 'outro']);
    assert.deepEqual(r.pendencias.filter((p) => p.categoria === 'outro').map((p) => p.statusB2b).sort(), ['A caminho', 'Cancelado']);
  });

  test('nota do sistema que falta no B2B: PENDENTE, com a pendência "não localizada" esperando (regra de 05/10 à tarde)', () => {
    const r = conferirCarga({
      sist: [{ nota: '1' }, { nota: '2' }, { nota: '3' }, { nota: '4' }],
      b2b: [{ seq: 1, nota: '1', status: 'Finalizado' }, { seq: 2, nota: '2', status: 'Finalizado' }, { seq: 3, nota: '3', status: 'Finalizado' }],
    });
    assert.deepEqual([r.qtdSist, r.qtdB2b, r.finalizadas, r.situacao], [4, 3, 3, 'PENDENTE']);
    assert.deepEqual(r.pendencias.map((p) => p.categoria), ['nao_localizada']);
    const i = indicadoresDaCarga(r);
    assert.equal(i.liberado, 0.75, 'as 3 finalizadas liberam; a que falta espera');
    assert.equal(i.statusPagamento, 'A PAGAR');
    const r2 = conferirCarga({ sist: [{ nota: '1' }], b2b: [{ seq: 1, nota: '1', status: 'Finalizado' }, { seq: 2, nota: '9', status: 'Finalizado' }] });
    assert.equal(r2.situacao, 'VERIFICAR', 'nota que só existe no B2B continua travando');
  });

  test('mesma contagem, notas diferentes: uma falta no B2B, outra sobra nele → VERIFICAR', async () => {
    const { r } = await confere('900803');
    assert.equal(r.qtdSist, 5);
    assert.equal(r.qtdB2b, 5);
    assert.equal(r.semCorrespondencia, 2);
    assert.deepEqual(r.pendencias.filter((p) => p.categoria === 'nao_localizada').map((p) => p.nota), ['810305']);
    assert.deepEqual(r.pendencias.filter((p) => p.categoria === 'so_b2b').map((p) => p.nota), ['810399']);
    assert.equal(r.situacao, 'VERIFICAR');
  });

  test('REGRESSÃO — carga de 40 notas em 2 páginas: nenhuma linha some no pé da folha', async () => {
    const { b, s, r } = await confere('900805');
    assert.equal(b.linhas.length, 40, 'o B2B tem de trazer as 40 linhas (a 31 caía no corte do rodapé)');
    assert.equal(s.notas.length, 40);
    assert.deepEqual(s.avisos, [], 'a data/hora de emissão no topo da 2ª página não é nota (aviso falso na 118771 real, 05/10)');
    assert.deepEqual([r.qtdSist, r.qtdB2b, r.finalizadas, r.aguardando, r.naoEntregue, r.semCorrespondencia], [40, 40, 36, 3, 1, 0]);
    assert.equal(r.situacao, 'PENDENTE');
    assert.deepEqual(b.linhas.map((l) => l.seq).sort((x, y) => x - y), Array.from({ length: 40 }, (_, i) => i + 1));
  });

  test('nada finalizado → VERIFICAR', async () => {
    const { r } = await confere('900806');
    assert.deepEqual([r.finalizadas, r.aguardando, r.situacao], [0, 3, 'VERIFICAR']);
  });

  test('um PDF com VÁRIAS cargas vira várias cargas, cada uma com as suas notas', async () => {
    const b = await lerPdf('b2b_varias.pdf');
    const s = await lerPdf('sist_varias.pdf');
    assert.equal(b.tipo, 'B2B');
    assert.equal(s.tipo, 'SIST');
    assert.deepEqual(b.cargas.map((c) => [c.numero, c.linhas.length]), [['900807', 3], ['900808', 2]]);
    assert.deepEqual(s.cargas.map((c) => [c.numero, c.notas.length]), [['900807', 3], ['900808', 2]]);
  });

  test('REGRESSÃO #112 — o B2B repete o cabeçalho a cada grupo de entregas: é UMA carga, e CARGA EXTERNA não cola no número', async () => {
    const b = await lerPdf('b2b_900809.pdf');
    assert.deepEqual(b.cargas.map((c) => [c.numero, c.externa, c.linhas.length]), [['900809', '103001', 4]], 'três blocos, uma carga, quatro notas');
    const { r } = await confere('900809');
    assert.deepEqual([r.qtdSist, r.qtdB2b, r.finalizadas, r.aguardando, r.situacao], [4, 4, 3, 1, 'PENDENTE']);
  });

  test('#112 — o B2B escreve a carga como "103-001-900810": o número é o último trecho, e a prévia fica sabendo', async () => {
    const b = await lerPdf('b2b_900810.pdf');
    assert.deepEqual(b.cargas.map((c) => [c.numero, c.identificador, c.linhas.length]), [['900810', '103-001-900810', 3]], 'dois blocos, uma carga');
    assert.ok(b.cargas[0].avisos.some((a) => /103-001-900810/.test(a) && /900810/.test(a)), String(b.cargas[0].avisos));
    assert.deepEqual(numeroDaCargaB2b('118882'), { numero: '118882', identificador: '118882' });
    assert.deepEqual(numeroDaCargaB2b('103-001-118771'), { numero: '118771', identificador: '103-001-118771' });
    assert.deepEqual(numeroDaCargaB2b(' 103 - 001 - 118771 '), { numero: '118771', identificador: '103-001-118771' });
    assert.deepEqual(numeroDaCargaB2b(''), { numero: '', identificador: '' });
  });

  test('#112 — segunda rede: B2B sozinho pareia com o Atak sozinho pelo final do número ou pela carga externa, nunca com dois candidatos', () => {
    const pares = parearPeloNumeroDoSistema([
      { numero: '103001118771', temB2b: true, temSist: false, externa: '' },
      { numero: '118771', temB2b: false, temSist: true },
      { numero: '900802', temB2b: true, temSist: true },
    ]);
    assert.deepEqual(pares.map((p) => [p.numB2b, p.numSist]), [['103001118771', '118771']]);
    assert.match(pares[0].aviso, /103001118771.*118771/);
    assert.deepEqual(parearPeloNumeroDoSistema([
      { numero: '555', temB2b: true, temSist: false, externa: '900811' }, { numero: '900811', temB2b: false, temSist: true },
    ]).map((p) => p.numSist), ['900811'], 'pela carga externa');
    assert.deepEqual(parearPeloNumeroDoSistema([
      { numero: '103001118771', temB2b: true, temSist: false, externa: '' },
      { numero: '118771', temB2b: false, temSist: true }, { numero: '1118771', temB2b: false, temSist: true },
    ]), [], 'dois candidatos: ninguém pareia, a prévia mostra os dois faltando');
    assert.deepEqual(parearPeloNumeroDoSistema([
      { numero: '1234', temB2b: true, temSist: false, externa: '' }, { numero: '234', temB2b: false, temSist: true },
    ]), [], 'final curto (menos de 5 dígitos) não vale');
  });

  test('a mesma nota é a mesma nos dois relatórios (B2B "810203-3" × Atak "810203")', async () => {
    const { b, s } = await confere('900802');
    const doB2b = new Set(b.linhas.map((l) => l.nota));
    for (const n of s.notas) assert.ok(doB2b.has(chaveDaNota(n.nota)), `nota ${n.nota} do Atak não achada no B2B`);
  });

  test('CNPJ/CPF e chave de acesso não ficam no resultado da leitura', async () => {
    const txt = JSON.stringify([await lerPdf('b2b_900802.pdf'), await lerPdf('sist_900802.pdf')]);
    assert.ok(!/\b\d{14}\b/.test(txt), 'nada com cara de CNPJ');
    assert.ok(!/\b\d{44}\b/.test(txt), 'nada com cara de chave de acesso');
  });

  test('relatório de OUTRO tipo é recusado com explicação, nunca lido como carga', async () => {
    const paginas = await lerPaginasDoPdf(pdf('outro_relatorio.pdf'));
    assert.equal(tipoDoRelatorio(paginas), null);
    assert.throws(() => lerRelatorioDeFrete(paginas), (e) => e.codigo === 'RELATORIO_DESCONHECIDO' && e.status === 422);
  });

  test('arquivo que não é PDF, vazio, truncado ou grande demais: erro claro, sem derrubar', async () => {
    await assert.rejects(lerPaginasDoPdf(Buffer.from('isto não é um pdf')), (e) => e.codigo === 'NAO_E_PDF');
    await assert.rejects(lerPaginasDoPdf(Buffer.alloc(0)), (e) => e.codigo === 'ARQUIVO_VAZIO');
    await assert.rejects(lerPaginasDoPdf(pdf('b2b_900801.pdf').subarray(0, 300)), (e) => e.codigo === 'PDF_ILEGIVEL');
    await assert.rejects(lerPaginasDoPdf(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(7 * 1024 * 1024)])), (e) => e.codigo === 'ARQUIVO_GRANDE');
  });
});

/* A planilha exportada, lida de volta: aba → linhas de valores. */
const exportada = (opcoes = {}) => lerPlanilhaXlsx(montarPlanilhaDeFrete({
  cargas: CARGAS_DE_EXEMPLO, geradoEm: new Date('2026-10-05T17:30:00Z'), exemplo: true, ...opcoes,
}));
const igual = (a, b) => (a === '' || a == null ? b === '' || b == null : (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b));

describe('a tela e o arquivo são a MESMA planilha', () => {
  test('as colunas A–P são as da planilha da Daniela, na ordem dela', () => {
    assert.deepEqual(COLUNAS_DA_PLANILHA.slice(0, 16), [
      'Data Consulta', 'Carga', 'Qtde SIST', 'Qtde B2B', 'Diferença', 'Finalizadas', 'Aguardando', 'Não Entregue',
      'Outros Status', 'Situação', 'Resumo Pendências', 'Status Pendência', 'Status p/ pagamento', 'Data Pagamento',
      'Transportadora', 'CT-E',
    ]);
    assert.equal(COLUNAS.length, 24);
  });

  test('exportar e ler de volta: CADA célula do arquivo é a célula da grade da tela', () => {
    const grade = montarGrade(CARGAS_DE_EXEMPLO);
    const { abas } = exportada();
    assert.deepEqual(abas.map((a) => a.nome), ['CONTROLE_CARGAS', 'RESUMO', 'FECHAMENTO', 'LEIA-ME']);
    const linhas = abas[0].linhas;
    assert.equal(linhas.length, grade.linhas.length + 1, 'cabeçalho + uma linha por pendência');
    assert.deepEqual(linhas[0].slice(0, COLUNAS.length), COLUNAS.map((c) => c.t));
    grade.linhas.forEach((l, i) => {
      l.celulas.forEach((cel, j) => {
        const noArquivo = linhas[i + 1][j];
        assert.ok(igual(cel.v, noArquivo), `linha ${i + 2}, coluna ${COLUNAS[j].t}: tela=${JSON.stringify(cel.v)} arquivo=${JSON.stringify(noArquivo)}`);
      });
    });
  });

  test('o RESUMO do arquivo mostra os números do resumo da tela', () => {
    const { resumo } = montarGrade(CARGAS_DE_EXEMPLO);
    const r = exportada().abas[1].linhas;
    const achar = (rotulo) => {
      const i = r.findIndex((l) => (l ?? []).some((v) => v === rotulo));
      const col = r[i].findIndex((v) => v === rotulo);
      return r[i + 1][col];
    };
    assert.equal(achar('CARGAS NO CONTROLE'), resumo.cargas);
    assert.equal(achar('LIBERADAS'), resumo.liberadas);
    assert.equal(achar('PENDENTES'), resumo.pendentes);
    assert.equal(achar('VERIFICAR'), resumo.verificar);
    assert.equal(achar('PAGAS INTEGRALMENTE'), resumo.integral);
    assert.equal(achar('PAGAS EM PARTE'), resumo.parcial);
    assert.equal(achar('SEM PAGAMENTO'), resumo.semPagamento);
    assert.equal(achar('COM SALDO A PAGAR'), resumo.comSaldo);
    assert.equal(achar('EMITIDAS NO SISTEMA'), resumo.emitidas);
    assert.equal(achar('FINALIZADAS NO B2B'), resumo.finalizadas);
    assert.ok(Math.abs(achar('ENTREGUES') - resumo.entregue) < 1e-9);
    assert.equal(achar('PENDÊNCIAS ABERTAS'), resumo.pendAbertas);
    assert.equal(achar('CANHOTO VEIO'), resumo.comCanhoto);
    assert.equal(achar('CANHOTO NÃO VEIO'), resumo.semCanhoto);
    assert.equal(achar('PAGAS SEM CANHOTO'), resumo.pagasSemCanhoto);
    assert.equal(resumo.comCanhoto + resumo.semCanhoto, resumo.cargas, 'toda carga ou veio ou não veio');
    assert.equal(resumo.cargas, CARGAS_DE_EXEMPLO.length, 'cada carga conta UMA vez, mesmo com várias linhas');
    assert.equal(resumo.tratativas.reduce((s, t) => s + t.qtd, 0), resumo.pendAbertas, 'a tabela de tratativas fecha com as pendências abertas');
  });

  test('toda fórmula do arquivo traz o resultado gravado, e as contas da grade são as do domínio', () => {
    const grade = montarGrade(CARGAS_DE_EXEMPLO);
    const primeiras = grade.linhas.filter((l) => l.primeira);
    assert.equal(primeiras.length, CARGAS_DE_EXEMPLO.length);
    for (const l of primeiras) {
      const carga = CARGAS_DE_EXEMPLO.find((c) => c.numero === l.carga);
      const ind = indicadoresDaCarga(carga);
      const [sit, ent, lib, apagar] = ['situacao', 'entregue', 'liberado', 'aPagar'].map((k) => l.celulas[COLUNAS.findIndex((c) => c.chave === k)].v);
      assert.equal(sit, ind.situacao);
      assert.equal(ent, ind.entregue);
      assert.equal(lib, ind.conferir ? 'conferir' : ind.liberado);
      assert.equal(apagar, ind.conferir ? 'conferir' : ind.aPagar);
    }
  });

  test('estrutura do .xlsx: zip válido, painel congelado, filtro em TODAS as colunas, recálculo ao abrir', () => {
    const buf = montarPlanilhaDeFrete({ cargas: CARGAS_DE_EXEMPLO, geradoEm: new Date('2026-10-05T17:30:00Z'), exemplo: true });
    assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK');
    const z = unzipSync(new Uint8Array(buf));
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']) {
      assert.ok(z[f], `faltou ${f}`);
    }
    const s1 = strFromU8(z['xl/worksheets/sheet1.xml']);
    assert.match(s1, /<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"\/>/);
    const linhas = montarGrade(CARGAS_DE_EXEMPLO).linhas.length + 1;
    const ultimaColuna = String.fromCharCode(64 + COLUNAS.length); // X com o canhoto (W–X); era V
    assert.match(s1, new RegExp(`<autoFilter ref="A1:${ultimaColuna}${linhas}"/>`), `o filtro cobre até a última coluna, ${ultimaColuna} (a planilha dela deixava o CT-E de fora)`);
    assert.match(strFromU8(z['xl/workbook.xml']), /fullCalcOnLoad="1"/);
    assert.match(s1, /<dataValidation type="list"/, 'lista de escolha no Status Pendência');
    assert.ok(!/ mm-dd-yy|numFmtId="14"/.test(strFromU8(z['xl/styles.xml'])), 'data em formato americano não');
    assert.match(strFromU8(z['xl/styles.xml']), /formatCode="dd\/mm\/yyyy"/);
  });

  test('exportação VAZIA (sem carga nenhuma) ainda gera um arquivo abrível', () => {
    const { abas } = lerPlanilhaXlsx(montarPlanilhaDeFrete({ cargas: [], geradoEm: new Date('2026-10-05T12:00:00Z') }));
    assert.equal(abas.length, 3);
    assert.equal(abas[0].linhas.length, 1, 'só o cabeçalho');
  });
});

describe('o painel entende a linguagem da planilha (sem botão de importar)', () => {
  test('lê DE VOLTA a planilha que o painel exporta: nada se perde', () => {
    const lido = lerPlanilhaDeControle(exportada().abas);
    assert.equal(lido.cargas.length, CARGAS_DE_EXEMPLO.length);
    assert.deepEqual(lido.avisos, []);
    for (const original of CARGAS_DE_EXEMPLO) {
      const c = lido.cargas.find((x) => x.numero === String(original.numero));
      assert.ok(c, `carga ${original.numero} não voltou`);
      const ind = indicadoresDaCarga(original);
      assert.deepEqual(
        [c.dataConsulta, c.qtdSist, c.qtdB2b, c.finalizadas, c.aguardando, c.naoEntregue, c.outros, c.situacao, c.transportadora],
        [original.dataConsulta, original.qtdSist, original.qtdB2b, original.finalizadas, original.aguardando, original.naoEntregue, original.outros, ind.situacao, original.transportadora],
        `carga ${original.numero}`,
      );
      assert.equal(c.cte, original.cte);
      assert.equal(c.pagamento?.pct ?? 0, original.pctPago, `pago da carga ${original.numero}`);
      assert.equal(c.pagamento ? c.pagamento.estimado : false, false, '% Pago do modelo novo é número exato, não estimativa');
      assert.equal(c.pagamento?.dataPagamento ?? null, original.dataPagamento);
      assert.deepEqual(
        c.pendencias.map((p) => [p.nota, p.categoria, p.tratativa, p.tratativaEm]),
        original.pendencias.map((p) => [p.nota, p.categoria, p.tratativa, p.tratativaEm]),
        `pendências da carga ${original.numero}`,
      );
    }
  });

  test('lê o formato ORIGINAL da Daniela: "OK 30/09", PARCIAL, 1, CT-E com texto, "Não localizada no BNB"', () => {
    const cab = ['Data Consulta', 'Carga', 'Qtde SIST', 'Qtde B2B', 'Diferença', 'Finalizadas', 'Aguardando', 'Não Entregue', 'Outros Status', 'Situação', 'Resumo Pendências', 'Status Pendência', 'Status p/ pagamento', 'Data Pagamento', 'Transportadora', 'CT-E'];
    const d = (iso) => ({ v: iso, t: 'd', e: { fmt: 'dd/mm/yyyy' } }); // data só é data pelo FORMATO da célula
    const linhasOriginais = [
      cab,
      // carga 1: duas pendências, uma "OK 30/09", pagamento PARCIAL, CT-E numérico
      [d('2026-09-22'), 900901, 10, 10, 0, 8, 2, 0, 0, 'PENDENTE', '900011 (Aguardando)', 'OK 30/09', 'PARCIAL', d('2026-10-09'), 'Transp. Exemplo A', 17792],
      [d('2026-09-22'), 900901, null, null, null, null, null, null, null, null, '900012 (Aguardando)', 'SEM TRATATIVA', null, null, 'Transp. Exemplo A', null],
      // carga 2: contagem não bate, nota não localizada, CT-E com texto
      [d('2026-09-22'), 900902, 3, 2, 1, 2, 0, 0, 0, 'VERIFICAR', '900021 (Não localizada no BNB)', null, null, null, 'Transp. Exemplo B', 'NÃO TEM NO B2B (MANDAR FOTO)'],
      // carga 3: sem pendência, paga 100% (número 1)
      [d('2026-09-24'), 900903, 4, 4, 0, 4, 0, 0, 0, 'LIBERADA', 'SEM PENDÊNCIA', null, 1, d('2026-10-09'), 'Transp. Exemplo A', null],
    ].map((l) => l.map((c) => (c && typeof c === 'object' && c.t ? c : { v: c })));
    const buf = escreverXlsx({ abas: [{ nome: 'Controle Cargas Revisado', linhas: linhasOriginais }] });
    const lido = lerPlanilhaDeControle(lerPlanilhaXlsx(buf).abas);
    assert.deepEqual(lido.cargas.map((c) => [c.numero, c.situacao]), [['900901', 'PENDENTE'], ['900902', 'VERIFICAR'], ['900903', 'LIBERADA']]);
    const [c1, c2, c3] = lido.cargas;
    assert.deepEqual(c1.pendencias.map((p) => [p.nota, p.tratativa, p.tratativaEm]), [['900011', 'OK', '2026-09-30'], ['900012', 'SEM TRATATIVA', null]]);
    // "Status p/ pagamento" é o que estava LIBERADO, não o pago (decisão do dono, 05/10/2026,
    // rodada 2): a planilha original não diz quanto foi pago — nenhum pagamento é inventado.
    assert.equal(c1.pagamento, null, 'PARCIAL não vira pagamento');
    assert.ok(c1.avisos.some((a) => /PARCIAL.*liberado, não o pago/.test(a)), String(c1.avisos));
    assert.equal(c1.cte, '17792');
    assert.equal(c2.pendencias[0].categoria, 'nao_localizada');
    assert.match(c2.pendencias[0].obs, /MANDAR FOTO/, 'texto no CT-E não se perde: vai para a observação');
    assert.equal(c3.pagamento, null, 'o "1" da coluna também não vira pagamento');
    assert.ok(c3.avisos.some((a) => /liberado, não o pago/.test(a)), String(c3.avisos));
  });

  test('aba que não é de controle (o RESUMO, a LEIA-ME) é ignorada, não vira carga', () => {
    const lido = lerPlanilhaDeControle(exportada().abas);
    assert.deepEqual(lido.abas.filter((a) => !a.ehControle).map((a) => a.nome).sort(), ['LEIA-ME', 'RESUMO']);
  });
});

describe('o escritor de .xlsx', () => {
  test('data é a do calendário (dia 21/09/2026 = 46286), sem deslocar por fuso', () => {
    assert.equal(serialDaData('2026-09-21'), 46286);
    assert.equal(serialDaData('2026-09-22'), 46287);
    assert.equal(serialDaData('1900-03-01'), 61, 'a partir de março de 1900 o Excel e o calendário concordam');
    assert.equal(serialDaData('lixo'), null);
  });

  test('texto com caractere de controle e símbolos de XML não corrompe o arquivo', () => {
    const buf = escreverXlsx({ abas: [{ nome: 'A', linhas: [[{ v: 'a<b>&"c\u0001d' }, { v: '=1+1' }, { v: '  espaço nas pontas  ' }]] }] });
    const l = lerPlanilhaXlsx(buf).abas[0].linhas[0];
    assert.equal(l[0], 'a<b>&"cd');
    assert.equal(l[1], '=1+1', 'texto que começa com "=" fica TEXTO, nunca vira fórmula');
    assert.equal(l[2], '  espaço nas pontas  ');
  });

  test('nome de aba inválido ou repetido é recusado', () => {
    assert.throws(() => escreverXlsx({ abas: [{ nome: 'a/b', linhas: [] }] }), /nome de aba/);
    assert.throws(() => escreverXlsx({ abas: [{ nome: 'A', linhas: [] }, { nome: 'a', linhas: [] }] }), /nome de aba/);
    assert.throws(() => escreverXlsx({ abas: [{ nome: 'x'.repeat(32), linhas: [] }] }), /nome de aba/);
    assert.throws(() => escreverXlsx({ abas: [] }), /sem abas/);
  });

  test('o leitor recusa o que não é .xlsx, com explicação', () => {
    assert.throws(() => lerPlanilhaXlsx(Buffer.from('isto não é planilha')), (e) => e.codigo === 'NAO_E_XLSX');
    assert.throws(() => lerPlanilhaXlsx(Buffer.alloc(0)), (e) => e.codigo === 'ARQUIVO_VAZIO');
    assert.throws(() => lerPlanilhaXlsx(Buffer.concat([Buffer.from('PK'), Buffer.alloc(100)])), (e) => e.codigo === 'XLSX_ILEGIVEL');
  });
});
