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

  test('Portaria não edita o cabeçalho → 403', async () => {
    const r = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { transportadora: 'X' },
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
    const div = await req(`/api/devolucoes/${id}/divergencias`, {
      metodo: 'POST', token: tokens['Logística'],
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
    let lista = await req('/api/devolucoes-cadastros', { token: tokens['Logística'] });
    let areal = lista.json.clientes.find((x) => x.codigo === 'AREAL');
    assert.equal(areal.vendedor, '80031 - L Marinho');
    assert.equal(areal.supervisor, '101454 - Makson Werlly');

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
    lista = await req('/api/devolucoes-cadastros', { token: tokens['Logística'] });
    const sendas = lista.json.clientes.find((x) => x.codigo === 'SENDAS');
    assert.ok(sendas, 'cliente aprendido do item');
    assert.equal(sendas.vendedor, '80235 - Carlos Eduardo');
    assert.equal(sendas.supervisor, '101781 - Manoel Antonio');

    // Item posterior SEM RCA/supervisor não apaga o que a base já sabe.
    await req(`/api/devolucoes/${dev.json.id}/itens`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { nota: '669628', codCliente: 'SENDAS', cx: 1 },
    });
    lista = await req('/api/devolucoes-cadastros', { token: tokens['Logística'] });
    const dePois = lista.json.clientes.find((x) => x.codigo === 'SENDAS');
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
