/* Devoluções — o checklist digital, contra PostgreSQL de verdade.

   Cada bloco prova uma regra que veio do processo real (relato da Carol +
   reunião com o gestor, 18/08/2026):

   1. Criar/editar é da Logística (Administração irrestrita) — "as meninas
      têm controle total", os demais setores não escrevem no checklist.
   2. A rota é obrigatória e precisa existir — é ela que identifica o
      checklist na conferência.
   3. As etapas andam em sentido único e carimbam operador + hora (as
      "assinaturas" do papel). Setor errado não assina pelos outros.
   4. A FALTA é calculada, nunca gravada: checklist 5 cx, chegou 3 → o
      sistema aponta 2. Divergência (produto fora da lista) não apaga falta.
   5. Toda mudança real guarda o estado anterior (trigger) e a Administração
      restaura — status e carimbos voltam JUNTOS.

   Emails próprios (@devteste.local) para não colidir com api.test.js, que
   limpa os @teste.local no before() e pode rodar em paralelo. */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { criarServidor } from '../src/servidor.js';
import { pool } from '../src/banco.js';

let servidor;
let base;
const tokens = {};

const OPERADORES = [
  ['dev.ana@devteste.local', 'Ana Dev', 'Logística'],
  ['dev.bruno@devteste.local', 'Bruno Dev', 'Portaria'],
  ['dev.carla@devteste.local', 'Carla Dev', 'Expedição'],
  ['dev.diego@devteste.local', 'Diego Dev', 'Faturamento'],
  ['dev.chefe@devteste.local', 'Chefe Dev', 'Administração'],
  // Setores criados em 18/08/2026 — cada um assina UM passo do checklist.
  ['dev.controle@devteste.local', 'Controle Dev', 'Controles Internos'],
  ['dev.notas@devteste.local', 'Notas Dev', 'Central de Notas'],
];
const SENHA = 'senha-de-teste-123';
const ROTA = 'DEVT';
const ROTA2 = 'DEVT2';

async function req(caminho, { metodo = 'GET', token, corpo } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* vazio */ }
  return { status: r.status, json, texto };
}

before(async () => {
  await pool.query('DELETE FROM devolucao_divergencias');
  await pool.query('DELETE FROM devolucao_itens');
  await pool.query('DELETE FROM devolucao_rotas');
  await pool.query('DELETE FROM devolucao_revisoes');
  await pool.query('DELETE FROM devolucoes');
  await pool.query("DELETE FROM operadores WHERE email LIKE '%@devteste.local'");
  for (const cod of [ROTA, ROTA2]) {
    await pool.query(
      `INSERT INTO dim_rotas (codigo, nome) VALUES ($1, 'Rota de teste de devoluções')
       ON CONFLICT (codigo) DO NOTHING`, [cod]
    );
  }

  const hash = await bcrypt.hash(SENHA, 4);
  for (const [email, nome, setor] of OPERADORES) {
    await pool.query(
      'INSERT INTO operadores (email, nome, setor, senha_hash) VALUES ($1,$2,$3,$4)',
      [email, nome, setor, hash]
    );
  }

  servidor = criarServidor();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  for (const [email, , setor] of OPERADORES) {
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email, senha: SENHA } });
    assert.equal(r.status, 200, `login de ${email} falhou: ${r.texto}`);
    tokens[setor] = r.json.token;
  }
});

after(async () => {
  await new Promise((r) => servidor.close(r));
  await pool.end();
});

const HOJE = new Date().toISOString().slice(0, 10);

function novoChecklist(extra = {}) {
  return {
    dataDev: HOJE,
    rotas: [ROTA],
    regiao: 'DF',
    transportadora: '83369',
    notaTransferencia: '171218',
    itens: [
      { nota: '170664', parcial: true, supervisor: 'MAKSON', vendedor: 'R&B',
        codCliente: 'AREAL', cx: 5, peso: 17.5, codProduto: '30110',
        produtoNome: 'LINGUIÇA', numDev: '9771', dataItem: HOJE, motivo: 'DATA PROXIMA' },
      { nota: '165116', parcial: true, supervisor: 'MAKSON', vendedor: 'ANL',
        codCliente: 'CENTRO OESTE', cx: 2, peso: 30, codProduto: '01189',
        produtoNome: 'COSTELINHA', numDev: '9770', dataItem: HOJE, motivo: 'ATRASO NA ENTREGA' },
    ],
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
describe('1. Criação: só Logística/Administração, rota obrigatória', () => {
  test('sem token → 401', async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', corpo: novoChecklist() });
    assert.equal(r.status, 401);
  });

  test('Portaria não cria checklist → 403', async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Portaria'], corpo: novoChecklist(),
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'SETOR_SEM_PERMISSAO');
  });

  test('sem rota → 400 (região + rotas identificam o checklist)', async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist({ rotas: [] }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'ROTA_FALTANDO');
  });

  test('rota inexistente → 422, dizendo QUAL código está errado', async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist({ rotas: [ROTA, 'XX999'] }),
    });
    assert.equal(r.status, 422);
    assert.equal(r.json.codigo, 'ROTA_DESCONHECIDA');
    assert.ok(r.json.erro.includes('XX999'), r.json.erro);
  });

  test('checklist aceita MAIS DE UMA rota — e a edição troca a lista inteira', async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: novoChecklist({ rotas: [ROTA, ROTA2] }),
    });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.json.rotas.slice().sort(), [ROTA, ROTA2].sort());

    const upd = await req(`/api/devolucoes/${r.json.id}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { rotas: [ROTA2] },
    });
    assert.equal(upd.status, 200, upd.texto);
    assert.deepEqual(upd.json.rotas, [ROTA2]);

    const vazio = await req(`/api/devolucoes/${r.json.id}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { rotas: [] },
    });
    assert.equal(vazio.status, 400);
  });

  test('Logística cria: número gerado, itens gravados, autoria discriminada', async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist(),
    });
    assert.equal(r.status, 201, r.texto);
    assert.ok(r.json.numero >= 1, 'número sequencial gerado');
    assert.equal(r.json.status, 'Lançada');
    assert.equal(r.json.criadaPor, 'Ana Dev');
    assert.equal(r.json.itens.length, 2);
    assert.equal(r.json.itens[0].codProduto, '30110');
    // Antes da conferência não existe falta — nem zero, nem número: null.
    assert.equal(r.json.itens[0].falta, null);
  });

  test('números são crescentes entre checklists (o "gerador" da reunião)', async () => {
    const a = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const b = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    assert.ok(b.json.numero > a.json.numero, `${a.json.numero} → ${b.json.numero}`);
  });
});

/* ------------------------------------------------------------------ */
describe('2. Edição: controle total da Logística, e de mais ninguém', () => {
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
  });

  test('Logística edita o cabeçalho', async () => {
    const r = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { transportadora: 'TRANSPORTADORA NOVA', motorista: 'Lucas' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.transportadora, 'TRANSPORTADORA NOVA');
    assert.equal(r.json.motorista, 'Lucas');
  });

  test('Expedição não edita o cabeçalho → 403', async () => {
    // A Portaria e o Faturamento ganharam os campos do próprio posto em
    // 18/08/2026 (bloco 8 prova os limites) — quem segue de fora é a
    // Expedição, que só confere quantidade nos itens.
    const r = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Expedição'], corpo: { transportadora: 'X' },
    });
    assert.equal(r.status, 403);
  });

  test('Logística acrescenta e remove item', async () => {
    const add = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '170092', cx: 1, codProduto: '12221', produtoNome: 'PE', motivo: 'SEM CADASTRO' },
    });
    assert.equal(add.status, 201, add.texto);
    const del = await req(`/api/devolucoes/${id}/itens/${add.json.itemId}`, {
      metodo: 'DELETE', token: tokens['Logística'],
    });
    assert.equal(del.status, 200);
  });
});

/* ------------------------------------------------------------------ */
describe('3. Etapas em sentido único, com carimbo (as assinaturas do papel)', () => {
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
  });

  test('pular etapa é recusado (Lançada → Conferida no Faturamento)', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Logística'], corpo: { para: 'Conferida no Faturamento' },
    });
    assert.equal(r.status, 409);
  });

  test('Faturamento não assina pela Portaria → 403', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'], corpo: { para: 'Recebida na Portaria' },
    });
    assert.equal(r.status, 403);
  });

  test('recebimento grava lacre, nº da carga e o carimbo da Portaria', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { para: 'Recebida na Portaria', lacre1: '133476', cargaNumero: '2484' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Recebida na Portaria');
    assert.equal(r.json.lacre1, '133476');
    assert.equal(r.json.cargaNumero, '2484');
    assert.equal(r.json.carimbos.portaria.por, 'Ana Dev');
    assert.ok(r.json.carimbos.portaria.em, 'instante carimbado');
  });

  test('peso final do Faturamento é opcional — vazio não trava', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { para: 'Conferida no Faturamento', pesoFinal: '' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.pesoFinal, null);
    assert.equal(r.json.carimbos.faturamento.por, 'Ana Dev');
  });

  test('o ciclo fecha com CADA setor assinando o próprio passo', async () => {
    // Setores criados em 18/08/2026 assinam de verdade — não é só a
    // Logística cobrindo: Expedição → Controles Internos → Central de Notas.
    const a = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Expedição'], corpo: { para: 'Descarga Conferida' },
    });
    assert.equal(a.status, 200, a.texto);
    assert.equal(a.json.carimbos.expedicao.por, 'Carla Dev');

    const b = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Controles Internos'],
      corpo: { para: 'Destinada', obsControles: 'Romaneio conferido, 2 itens para estoque' },
    });
    assert.equal(b.status, 200, b.texto);
    assert.equal(b.json.obsControles, 'Romaneio conferido, 2 itens para estoque');
    assert.equal(b.json.carimbos.controles.por, 'Controle Dev');

    const c = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Central de Notas'], corpo: { para: 'Nota Finalizada' },
    });
    assert.equal(c.status, 200, c.texto);
    assert.equal(c.json.status, 'Nota Finalizada');
    assert.equal(c.json.carimbos.notas.por, 'Notas Dev');
    for (const etapa of ['portaria', 'faturamento', 'expedicao', 'controles', 'notas']) {
      assert.ok(c.json.carimbos[etapa], `carimbo de ${etapa} presente`);
    }
  });

  test('Central de Notas não assina pelos outros nem cria checklist', async () => {
    const novo = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Central de Notas'], corpo: novoChecklist(),
    });
    assert.equal(novo.status, 403);
    const outra = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist(),
    });
    const r = await req(`/api/devolucoes/${outra.json.id}/etapa`, {
      metodo: 'POST', token: tokens['Central de Notas'], corpo: { para: 'Recebida na Portaria' },
    });
    assert.equal(r.status, 403);
  });
});

/* ------------------------------------------------------------------ */
describe('4. Conferência: falta calculada, divergência não apaga falta', () => {
  let id, itemId;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
    itemId = r.json.itens[0].itemId;   // 5 cx de 30110-LINGUIÇA
  });

  test('checklist diz 5, chegou 3 → o sistema aponta falta 2 sozinho', async () => {
    const r = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { qtdRecebida: 3 },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.qtdRecebida, 3);
    assert.equal(r.json.falta, 2);
  });

  test('produto fora do checklist entra como divergência — e a falta continua', async () => {
    // Divergentes: escopo EXCLUSIVO dos Controles Internos (18/08/2026) —
    // nem a Logística lança por eles.
    const negado = await req(`/api/devolucoes/${id}/divergencias`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { codProduto: 'X', cx: 1 },
    });
    assert.equal(negado.status, 403, 'Logística não lança divergente');
    const div = await req(`/api/devolucoes/${id}/divergencias`, {
      metodo: 'POST', token: tokens['Controles Internos'],
      corpo: { codProduto: '30063', produtoNome: 'SUBSTITUTO', cx: 1, observacao: 'veio no lugar do 30110' },
    });
    assert.equal(div.status, 201, div.texto);
    const dev = await req(`/api/devolucoes/${id}`, { token: tokens['Logística'] });
    assert.equal(dev.json.divergencias.length, 1);
    // A regra da reunião: substituição NÃO cancela a falta.
    assert.equal(dev.json.itens.find((i) => i.itemId === itemId).falta, 2);
  });

  test('Expedição confere quantidade, mas não reescreve o checklist (fase 2 pronta)', async () => {
    const ok = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Expedição'], corpo: { qtdRecebida: 4 },
    });
    assert.equal(ok.status, 200, ok.texto);
    const nao = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Expedição'], corpo: { cx: 99 },
    });
    assert.equal(nao.status, 403);
  });

  test('Controles Internos destina — e só destina', async () => {
    const ok = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'], corpo: { destinacao: 'Reprocesso' },
    });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.json.destinacao, 'Reprocesso');
    const nao = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'], corpo: { cx: 99 },
    });
    assert.equal(nao.status, 403);
  });

  test('alinhamento da capa: pesagem é do Faturamento, tick de nota final é da Central de Notas', async () => {
    // Pesagem por item — a confirmação de que passou pela balança.
    const pesa = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { pesoFaturamento: 15.5 },
    });
    assert.equal(pesa.status, 200, pesa.texto);
    assert.equal(pesa.json.pesoFaturamento, 15.5);
    const naoFat = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { cx: 99 },
    });
    assert.equal(naoFat.status, 403, 'Faturamento só pesa');

    // NOTA FINAL — o tick da Central de Notas por item.
    const tick = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Central de Notas'], corpo: { notaFinal: true },
    });
    assert.equal(tick.status, 200, tick.texto);
    assert.equal(tick.json.notaFinal, true);
    const naoNotas = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Central de Notas'], corpo: { motivo: 'x' },
    });
    assert.equal(naoNotas.status, 403, 'Central de Notas só dá o tick');
  });

  test('cód. do operador (monitoramento) no cabeçalho; Portaria imputa placa e motorista', async () => {
    const cab = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { operadorCodigo: '102345' },
    });
    assert.equal(cab.status, 200, cab.texto);
    assert.equal(cab.json.operadorCodigo, '102345');

    const nova = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist({ itens: [] }),
    });
    const rec = await req(`/api/devolucoes/${nova.json.id}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { para: 'Recebida na Portaria', placa: 'gfr8a80', motorista: 'Lucas' },
    });
    assert.equal(rec.status, 200, rec.texto);
    assert.equal(rec.json.placa, 'GFR8A80', 'placa normalizada, imputada pela Portaria');
    assert.equal(rec.json.motorista, 'Lucas');
    assert.equal(rec.json.carimbos.portaria.por, 'Bruno Dev');
  });

  test('destinação MÚLTIPLA: 3 caixas viram 1 Estoque + 2 Descarte', async () => {
    const r = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'],
      corpo: { destEstoque: 1, destDescarte: 2 },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.destEstoque, 1);
    assert.equal(r.json.destDescarte, 2);
    assert.equal(r.json.destReprocesso, null);
  });

  test('destinação aceita só os três destinos reais', async () => {
    const r = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { destinacao: 'Estoque' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.destinacao, 'Estoque');
    const inval = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { destinacao: 'Lixo' },
    });
    // Valor desconhecido vira null (limpa), nunca grava lixo no banco.
    assert.equal(inval.status, 200);
    assert.equal(inval.json.destinacao, null);
  });
});

/* ------------------------------------------------------------------ */
describe('5. Revisões: o estado anterior existe e a Administração restaura', () => {
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
    await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { transportadora: 'ESTRAGADA' },
    });
  });

  test('a revisão guarda o valor de ANTES da mudança', async () => {
    const r = await req(`/api/devolucoes/${id}/revisoes`, { token: tokens['Administração'] });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.length >= 1);
    assert.equal(r.json[0].devolucao.transportadora, '83369');
    assert.equal(r.json[0].mudadaPor, 'Ana Dev');
  });

  test('Logística não lista revisões (restaurar é gestão) → 403', async () => {
    const r = await req(`/api/devolucoes/${id}/revisoes`, { token: tokens['Logística'] });
    assert.equal(r.status, 403);
  });

  test('restaurar volta o dado e fica no log', async () => {
    const revs = await req(`/api/devolucoes/${id}/revisoes`, { token: tokens['Administração'] });
    const alvo = revs.json.find((x) => x.devolucao.transportadora === '83369');
    const r = await req(`/api/devolucoes/${id}/restaurar`, {
      metodo: 'POST', token: tokens['Administração'], corpo: { revisaoId: alvo.revisaoId },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.transportadora, '83369');
    const { rows } = await pool.query(
      "SELECT acao FROM log_eventos WHERE carga_id = $1 AND acao LIKE 'Devolução restaurada%'", [id]
    );
    assert.ok(rows.length >= 1, 'restauração auditada no log');
  });
});

/* ------------------------------------------------------------------ */
describe('6. Cadastros de apoio e exclusão', () => {
  test('Logística cadastra supervisor, produto e motivo; todos aparecem na lista', async () => {
    const s = await req('/api/devolucoes-cadastros/supervisores', {
      metodo: 'POST', token: tokens['Logística'], corpo: { nome: 'MAKSON' },
    });
    assert.equal(s.status, 201);
    const p = await req('/api/devolucoes-cadastros/produtos', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { codigo: '30110', nome: 'LINGUIÇA', pesoCaixaKg: 3.5 },
    });
    assert.equal(p.status, 201);
    assert.equal(p.json.pesoCaixaKg, 3.5, 'quilo por caixa preservado');
    const m = await req('/api/devolucoes-cadastros/motivos', {
      metodo: 'POST', token: tokens['Logística'], corpo: { motivo: 'DATA PROXIMA' },
    });
    assert.equal(m.status, 201);

    const lista = await req('/api/devolucoes-cadastros', { token: tokens['Portaria'] });
    assert.equal(lista.status, 200);
    assert.ok(lista.json.supervisores.includes('MAKSON'));
    assert.ok(lista.json.produtos.some(
      (x) => x.codigo === '30110' && x.nome === 'LINGUIÇA' && x.pesoCaixaKg === 3.5
    ), 'produto com código, nome e quilo na lista');
    assert.ok(lista.json.motivos.includes('DATA PROXIMA'));
  });

  test('Portaria não cadastra → 403', async () => {
    const r = await req('/api/devolucoes-cadastros/produtos', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { codigo: 'X', nome: 'X' },
    });
    assert.equal(r.status, 403);
  });

  test('cliente vincula RCA e supervisor — cadastro e APRENDIZADO automático', async () => {
    await pool.query("DELETE FROM dim_clientes WHERE codigo IN ('AREAL','SENDAS')");

    // Cadastro manual: código → RCA (com código) → supervisor (com código).
    const c = await req('/api/devolucoes-cadastros/clientes', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { codigo: 'AREAL', vendedor: '80031 - L Marinho', supervisor: '101454 - Makson Werlly' },
    });
    assert.equal(c.status, 201, c.texto);
    // A busca é no servidor (76 mil clientes não viajam para o painel).
    let busca = await req('/api/devolucoes-cadastros/clientes?q=AREAL', { token: tokens['Logística'] });
    let areal = busca.json.find((x) => x.codigo === 'AREAL');
    assert.ok(areal, 'cliente encontrado pela busca');
    assert.equal(areal.vendedor, '80031 - L Marinho');
    assert.equal(areal.supervisor, '101454 - Makson Werlly');

    // Base oficial: apelido também encontra ("SENDAS"/"AREAL" é como as
    // capas escrevem o cliente).
    const tropeira = await req('/api/devolucoes-cadastros/clientes?q=Tropeira', { token: tokens['Logística'] });
    assert.ok(tropeira.json.some((x) => x.codigo === '10003'),
      'apelido da base oficial encontra o cliente');

    // Aprendizado: um item gravado com cliente novo ENSINA o vínculo.
    const dev = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist({ itens: [] }),
    });
    const item = await req(`/api/devolucoes/${dev.json.id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '669627', codCliente: 'SENDAS', vendedor: '80235 - Carlos Eduardo',
               supervisor: '101781 - Manoel Antonio', cx: 2 },
    });
    assert.equal(item.status, 201, item.texto);
    busca = await req('/api/devolucoes-cadastros/clientes?q=SENDAS', { token: tokens['Logística'] });
    const sendas = busca.json.find((x) => x.codigo === 'SENDAS');
    assert.ok(sendas, 'cliente aprendido do item');
    assert.equal(sendas.vendedor, '80235 - Carlos Eduardo');
    assert.equal(sendas.supervisor, '101781 - Manoel Antonio');

    // Item posterior SEM RCA/supervisor não apaga o que a base já sabe.
    await req(`/api/devolucoes/${dev.json.id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '669628', codCliente: 'SENDAS', cx: 1 },
    });
    busca = await req('/api/devolucoes-cadastros/clientes?q=SENDAS', { token: tokens['Logística'] });
    const dePois = busca.json.find((x) => x.codigo === 'SENDAS');
    assert.equal(dePois.vendedor, '80235 - Carlos Eduardo', 'vazio não apaga o vínculo');
  });

  test('exclusão é suave: some da lista, mas a linha e as revisões ficam', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const del = await req(`/api/devolucoes/${c.json.id}`, { metodo: 'DELETE', token: tokens['Logística'] });
    assert.equal(del.status, 200);
    const lista = await req(`/api/devolucoes?de=${HOJE}&ate=${HOJE}`, { token: tokens['Logística'] });
    assert.ok(!lista.json.some((d) => d.id === c.json.id), 'não aparece mais na lista');
    const { rows } = await pool.query('SELECT excluida_em FROM devolucoes WHERE devolucao_id = $1', [c.json.id]);
    assert.ok(rows[0].excluida_em, 'linha continua no banco, marcada');
  });
});

/* ------------------------------------------------------------------ */
describe('7. Sobras: ciclo curto — entra, três OKs, acabou (18/08/2026)', () => {
  let id;

  test('sobra nasce sem rota e sem carga — só caixa/peso/produto/motivo', async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: {
        tipo: 'SOBRA', dataDev: HOJE,
        itens: [{ cx: 3, peso: 12.5, codProduto: '30110',
                  produtoNome: 'LINGUIÇA', motivo: '652 — Sobras' }],
      },
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.tipo, 'SOBRA');
    assert.deepEqual(r.json.rotas, [], 'sobra não tem rota');
    assert.equal(r.json.itens[0].motivo, '652 — Sobras');
    id = r.json.id;
  });

  test('o motivo 652 — Sobras está no cadastro oficial de motivos', async () => {
    const r = await req('/api/devolucoes-cadastros', { token: tokens['Logística'] });
    assert.equal(r.status, 200);
    assert.ok(r.json.motivos.includes('652 — Sobras'), 'motivo 652 semeado');
  });

  test('Portaria OK → Faturamento OK → Expedição OK, e a sobra encerra aí', async () => {
    const a = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { para: 'Recebida na Portaria' },
    });
    assert.equal(a.status, 200, a.texto);
    const b = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'], corpo: { para: 'Conferida no Faturamento' },
    });
    assert.equal(b.status, 200, b.texto);
    const c = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Expedição'], corpo: { para: 'Descarga Conferida' },
    });
    assert.equal(c.status, 200, c.texto);
    assert.equal(c.json.status, 'Descarga Conferida');
  });

  test('sobra não passa por Controles Internos nem Central de Notas', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Controles Internos'], corpo: { para: 'Destinada' },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'ETAPA_NAO_EXISTE_PARA_SOBRA');
    // Nem a Administração fura o ciclo curto — a etapa não existe pra sobra.
    const adm = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Administração'], corpo: { para: 'Nota Finalizada' },
    });
    assert.equal(adm.status, 409);
    assert.equal(adm.json.codigo, 'ETAPA_NAO_EXISTE_PARA_SOBRA');
  });

  test('devolução comum continua exigindo rota — sobra é a única exceção', async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { ...novoChecklist(), rotas: [] },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'ROTA_FALTANDO');
  });
});

/* ------------------------------------------------------------------ */
describe('8. Cabeçalho por posto: Portaria e Faturamento editam SÓ o que é deles', () => {
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
  });

  test('Portaria edita placa/motorista/transportadora/carga/lacres/NT', async () => {
    const r = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Portaria'],
      corpo: { placa: 'rrp-5f95', motorista: 'GILMAR', transportadora: '83369',
               cargaNumero: '2490', lacre1: '133480', lacre2: '133481',
               notaTransferencia: '171300' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.placa, 'RRP5F95');
    assert.equal(r.json.motorista, 'GILMAR');
    assert.equal(r.json.cargaNumero, '2490');
    assert.equal(r.json.lacre1, '133480');
    assert.equal(r.json.notaTransferencia, '171300');
  });

  test('Portaria NÃO mexe em campo da Logística (região, data, rotas)', async () => {
    const a = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { regiao: 'MG' },
    });
    assert.equal(a.status, 403);
    const b = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { placa: 'AAA1234', rotas: [ROTA2] },
    });
    assert.equal(b.status, 403, 'juntar campo permitido com rota não fura a regra');
  });

  test('Faturamento edita o peso final — e SÓ ele nesse cabeçalho', async () => {
    const ok = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { pesoFinal: 47.5 },
    });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(Number(ok.json.pesoFinal), 47.5);
    const nao = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { transportadora: 'OUTRA' },
    });
    assert.equal(nao.status, 403);
  });

  test('Expedição segue sem editar cabeçalho nenhum', async () => {
    const r = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Expedição'], corpo: { placa: 'BBB2C34' },
    });
    assert.equal(r.status, 403);
  });

  test('Controles Internos informam o RDC (romaneio) — e SÓ o RDC', async () => {
    const sim = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'], corpo: { gerouRdc: true },
    });
    assert.equal(sim.status, 200, sim.texto);
    assert.equal(sim.json.gerouRdc, true);
    // "Não gerou" é resposta de verdade, diferente de "não informado".
    const nao = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'], corpo: { gerouRdc: 'false' },
    });
    assert.equal(nao.status, 200, nao.texto);
    assert.equal(nao.json.gerouRdc, false);
    const fora = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'], corpo: { regiao: 'MG' },
    });
    assert.equal(fora.status, 403);
    // E o RDC não é da Portaria nem do Faturamento.
    const port = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { gerouRdc: true },
    });
    assert.equal(port.status, 403);
  });

  test('o RDC também entra junto com a assinatura da Destinada', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const did = c.json.id;
    for (const [token, para] of [
      [tokens['Portaria'], 'Recebida na Portaria'],
      [tokens['Faturamento'], 'Conferida no Faturamento'],
      [tokens['Expedição'], 'Descarga Conferida'],
    ]) {
      const r = await req(`/api/devolucoes/${did}/etapa`, { metodo: 'POST', token, corpo: { para } });
      assert.equal(r.status, 200, r.texto);
    }
    const dest = await req(`/api/devolucoes/${did}/etapa`, {
      metodo: 'POST', token: tokens['Controles Internos'],
      corpo: { para: 'Destinada', obsControles: 'Tudo para estoque', gerouRdc: 'true' },
    });
    assert.equal(dest.status, 200, dest.texto);
    assert.equal(dest.json.gerouRdc, true);
    assert.equal(dest.json.carimbos.controles.por, 'Controle Dev');
  });
});

/* ------------------------------------------------------------------ */
describe('9. A mesma nota em duas parciais (caso real de 18/08/2026)', () => {
  /* O cliente recebe 2 caixas do mesmo produto: uma fora de temperatura,
     outra avariada. Emite DUAS parciais na MESMA nota fiscal, cada uma com
     seu motivo e seu Nº DEV. É o número da parcial — coluna PARCIAL da capa
     de papel — que amarra cada DEV à caixa certa. */
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
  });

  test('duas linhas com a mesma nota e o mesmo produto convivem', async () => {
    const base = {
      nota: '678283', parcial: true, codCliente: 'AREAL',
      codProduto: '10719', produtoNome: 'LINGUIÇA DE PERNIL C/ PIMENTA', cx: 1,
    };
    const a = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { ...base, parcialDesc: '118274', numDev: '52140', motivo: 'TEMPERATURA' },
    });
    const b = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { ...base, parcialDesc: '383303', numDev: '52111', motivo: 'AVARIA' },
    });
    assert.equal(a.status, 201, a.texto);
    assert.equal(b.status, 201, b.texto);

    const dev = await req(`/api/devolucoes/${id}`, { token: tokens['Logística'] });
    const mesmaNota = dev.json.itens.filter((i) => i.nota === '678283');
    assert.equal(mesmaNota.length, 2, 'as duas parciais ficam na mesma nota');
    const porParcial = Object.fromEntries(mesmaNota.map((i) => [i.parcialDesc, i]));
    assert.equal(porParcial['118274'].numDev, '52140');
    assert.equal(porParcial['118274'].motivo, 'TEMPERATURA');
    assert.equal(porParcial['383303'].numDev, '52111');
    assert.equal(porParcial['383303'].motivo, 'AVARIA');
    assert.equal(porParcial['118274'].codProduto, porParcial['383303'].codProduto,
      'mesmo produto nas duas — o que separa é a parcial');
  });

  test('o nº da parcial é editável depois, como qualquer campo da linha', async () => {
    const dev = await req(`/api/devolucoes/${id}`, { token: tokens['Logística'] });
    const alvo = dev.json.itens.find((i) => i.parcialDesc === '383303');
    const r = await req(`/api/devolucoes/${id}/itens/${alvo.itemId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { parcialDesc: '383304' },
    });
    assert.equal(r.status, 200, r.texto);
    const depois = await req(`/api/devolucoes/${id}`, { token: tokens['Logística'] });
    assert.ok(depois.json.itens.some((i) => i.parcialDesc === '383304'));
  });

  test('o nº da parcial é campo da Logística — Expedição não escreve nele', async () => {
    const dev = await req(`/api/devolucoes/${id}`, { token: tokens['Logística'] });
    const alvo = dev.json.itens[0];
    const r = await req(`/api/devolucoes/${id}/itens/${alvo.itemId}`, {
      metodo: 'PATCH', token: tokens['Expedição'], corpo: { parcialDesc: '999' },
    });
    assert.equal(r.status, 403);
  });
});

/* ------------------------------------------------------------------ */
describe('10. Lacre na devolução: informa, não trava (18/08/2026)', () => {
  /* Decisão do dia: o lacre da Expedição NÃO vira bloqueio na Portaria. A
     Portaria só informa — chegou lacrado (com número) ou chegou SEM lacre.
     "Sem lacre" precisa ser dito, não deduzido de campo vazio. */
  test('recebimento com lacre: número e resposta ficam gravados', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const r = await req(`/api/devolucoes/${c.json.id}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { para: 'Recebida na Portaria', chegouLacrado: true, lacre1: '133476' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.chegouLacrado, true);
    assert.equal(r.json.lacre1, '133476');
  });

  test('recebimento SEM lacre passa igual, com a resposta registrada', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const r = await req(`/api/devolucoes/${c.json.id}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { para: 'Recebida na Portaria', chegouLacrado: 'false' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.chegouLacrado, false, 'sem lacre é resposta, não ausência');
    assert.equal(r.json.status, 'Recebida na Portaria', 'a devolução anda mesmo sem lacre');
  });

  test('não informar também passa — fica null, para ninguém inventar resposta', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const r = await req(`/api/devolucoes/${c.json.id}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { para: 'Recebida na Portaria' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.chegouLacrado, null);
  });

  test('a Portaria corrige a resposta depois, pelo cabeçalho', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const r = await req(`/api/devolucoes/${c.json.id}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { chegouLacrado: false },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.chegouLacrado, false);
    // Continua sendo campo do posto da Portaria: a Expedição não escreve.
    const exp = await req(`/api/devolucoes/${c.json.id}`, {
      metodo: 'PATCH', token: tokens['Expedição'], corpo: { chegouLacrado: true },
    });
    assert.equal(exp.status, 403);
  });
});

/* ------------------------------------------------------------------ */
describe('11. Motivo por código vira código + descrição (19/08/2026)', () => {
  /* Reunião com a Logística: "o código do motivo tem que puxar na
     descrição, abaixo do campo, a nomenclatura referente ao código". Quem
     lança digita o número da capa; quem confere depois precisa ler o
     motivo. A regra é do servidor para valer por qualquer caminho. */
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
  });

  test('item criado com "607" guarda a linha inteira do catálogo', async () => {
    const r = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '999', cx: 1, codProduto: '10719', motivo: '607' },
    });
    assert.equal(r.status, 201, r.texto);
    assert.ok(r.json.motivo.startsWith('607 —'), r.json.motivo);
    assert.ok(r.json.motivo.length > 10, 'a descrição precisa vir junto');
  });

  test('editar para "606" também completa', async () => {
    const dev = await req(`/api/devolucoes/${id}`, { token: tokens['Logística'] });
    const alvo = dev.json.itens.find((i) => i.nota === '999');
    const r = await req(`/api/devolucoes/${id}/itens/${alvo.itemId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { motivo: '606' },
    });
    assert.equal(r.status, 200, r.texto);
    const depois = await req(`/api/devolucoes/${id}`, { token: tokens['Logística'] });
    const item = depois.json.itens.find((i) => i.itemId === alvo.itemId);
    assert.ok(item.motivo.startsWith('606 —'), item.motivo);
  });

  test('motivo escrito por extenso passa intacto', async () => {
    const r = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '998', cx: 1, motivo: 'DATA PROXIMA' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.motivo, 'DATA PROXIMA');
  });

  test('código que não existe no catálogo fica como veio', async () => {
    /* Inventar descrição para um código desconhecido seria pior que
       mostrar o número: quem confere passaria a ler uma informação que
       ninguém cadastrou. */
    const r = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '997', cx: 1, motivo: '9999' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.motivo, '9999');
  });
});

/* ------------------------------------------------------------------ */
describe('12. Nº DEV e Nº da carga de devolução são dois números (20/08/2026)', () => {
  /* Relato do gestor, com print do SIS ATAK junto: o checklist traz o
     código da DEV, lançado pela Logística. Depois a Portaria abre a
     "Montagem de Cargas" do SIS ATAK, escolhe a rota, joga as DEVs daquela
     rota para dentro e salva — e o "Número Documento" que sai dali é o
     número da CARGA de devolução. Dois números, dois momentos, dois donos:
     no mesmo campo, um apagaria o outro. */
  let id;
  before(async () => {
    const c = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist(),
    });
    id = c.json.id;
  });

  test('os dois convivem na mesma linha, sem um sobrescrever o outro', async () => {
    const item = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '654789', cx: 1, numDev: '41836' },
    });
    assert.equal(item.status, 201, item.texto);
    assert.equal(item.json.numDev, '41836');
    assert.equal(item.json.cargaDev, '', 'ainda não passou pela Portaria');

    const r = await req(`/api/devolucoes/${id}/itens/${item.json.itemId}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { cargaDev: '118294' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.cargaDev, '118294');
    assert.equal(r.json.numDev, '41836', 'o código da DEV continua o mesmo');
  });

  test('a Portaria só escreve ESSE campo do item', async () => {
    const item = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'], corpo: { nota: '654790', cx: 2 },
    });
    const r = await req(`/api/devolucoes/${id}/itens/${item.json.itemId}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { cx: 99 },
    });
    assert.equal(r.status, 403, 'caixa é da Logística, não da Portaria');
  });

  test('o cabeçalho guarda o número do caminhão inteiro, e a Portaria o escreve', async () => {
    const r = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { cargaNumero: '118294' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.cargaNumero, '118294');
  });

  test('terceiro lacre na chegada: o caminhão pode trazer três', async () => {
    const r = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Portaria'],
      corpo: { lacre1: '133476', lacre2: '133477', lacre3: '133478' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.lacre3, '133478');
  });
});

/* ------------------------------------------------------------------ */
describe('13. Nome do cliente junto do código (20/08/2026)', () => {
  /* Relato do gestor: "o código do cliente no relatório não está puxando o
     nome do cliente, está puxando só o código". O item guardava só o
     código, e o relatório vai para a mão de quem não digitou nada. */
  let id;

  before(async () => {
    await pool.query(
      `INSERT INTO dim_clientes (codigo, nome, apelido, vendedor, supervisor)
       VALUES ('99913', 'Comercial Teste de Alimentos Ltda', 'TESTE ALIM', '', '')
       ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, apelido = EXCLUDED.apelido`
    );
    const c = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist(),
    });
    id = c.json.id;
  });

  test('o servidor completa o nome a partir do cadastro', async () => {
    const r = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '771000', cx: 2, codCliente: '99913' },
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.codCliente, '99913');
    assert.equal(r.json.clienteNome, 'TESTE ALIM', 'o apelido é o que as capas usam');
  });

  test('nome mandado pelo painel é respeitado — quem digitou sabe mais', async () => {
    const r = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '771001', cx: 1, codCliente: '99913', clienteNome: 'NOME DA CAPA' },
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.clienteNome, 'NOME DA CAPA');
  });

  test('código fora do cadastro grava só o código, sem inventar nome', async () => {
    const r = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '771002', cx: 1, codCliente: '00000-nao-existe' },
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.clienteNome, '');
  });

  test('trocar o cliente da linha atualiza o nome junto', async () => {
    const item = await req(`/api/devolucoes/${id}/itens`, {
      metodo: 'POST', token: tokens['Logística'], corpo: { nota: '771003', cx: 1 },
    });
    const r = await req(`/api/devolucoes/${id}/itens/${item.json.itemId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { codCliente: '99913' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.clienteNome, 'TESTE ALIM');
  });
});
