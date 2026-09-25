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
  // Duas filiais DIFERENTES: é com duas que se prova o isolamento de escopo.
  ['dev.bsb@devteste.local', 'Posto BSB', 'Filial 105 BSB'],
  ['dev.ba@devteste.local', 'Posto BA', 'Filial 106 BAHIA'],
  // A TERCEIRA filial entrou com a nota de transferência (16/09/2026): o
  // dono citou as três — 105, 106 e 107 — e a regra precisa valer para as
  // três, não para as duas que já estavam aqui.
  ['dev.es@devteste.local', 'Posto ES', 'Filial 107 ES'],
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

  /* A REGRA MUDOU EM 27/08/2026, de propósito. A balança é usada DUAS
     vezes: a etapa do Faturamento na chegada grava o caminhão CHEIO
     (pesoEntrada), e a etapa NOVA depois da Expedição grava o caminhão
     VAZIO (pesoFinal). Antes existia um campo só, e ele era gravado na
     chegada — o que era o peso errado no campo errado. */
  test('a pesagem da chegada é opcional — vazio não trava', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { para: 'Conferida no Faturamento', pesoEntrada: '' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.pesoEntrada, null);
    assert.equal(r.json.carimbos.faturamento.por, 'Ana Dev');
  });

  test('o ciclo fecha com CADA setor assinando o próprio passo', async () => {
    // Setores criados em 18/08/2026 assinam de verdade — não é só a
    // Logística cobrindo: Expedição → Controles Internos → Central de Notas.
    /* ORDEM DE 08/09/2026: as duas balanças são seguidas e a Expedição
       vem DEPOIS. O que este teste garante continua o mesmo — cada setor
       assina o SEU passo, e o carimbo guarda quem foi. O que mudou foi a
       ordem, por pedido do dono, não a garantia. */
    const p = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'],
      corpo: { para: 'Peso Final Registrado', pesoFinal: 14000 },
    });
    assert.equal(p.status, 200, p.texto);
    assert.equal(p.json.pesoFinal, 14000);
    assert.equal(p.json.carimbos.pesofinal.por, 'Diego Dev');

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
    for (const etapa of ['portaria', 'faturamento', 'expedicao', 'pesofinal', 'controles', 'notas']) {
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

  test('alinhamento da capa: o Faturamento não mexe em item, tick de nota final é da Central de Notas', async () => {
    /* INVERTIDO EM 08/09/2026, e de propósito.

       Este teste garantia que o Faturamento PESAVA o item. O dono tirou
       essa tarefa dele com todas as letras — "nao digita nada por
       produto, so digita o peso" — porque a tela pedia que ele
       preenchesse linha a linha, e os dois pesos que ele deve dar são os
       do caminhão, que ficam na capa.

       Deixar o teste como estava seria manter verde uma regra que o dono
       mandou acabar. Ele passa a exigir o contrário: nenhum campo de item
       é do Faturamento. A coluna continua existindo para quem lança o
       checklist — isso é o bloco 16 que garante. */
    for (const campo of [{ pesoFaturamento: 15.5 }, { cx: 99 }]) {
      const r = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
        metodo: 'PATCH', token: tokens['Faturamento'], corpo: campo,
      });
      assert.equal(r.status, 403,
        `Faturamento não altera campo de item (${Object.keys(campo)[0]}): ${r.texto}`);
    }

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
describe('7. Sobras: entra, três OKs e o check de Controles Internos (25/09/2026)', () => {
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

  test('Portaria OK → Faturamento OK → Expedição OK, e a sobra NÃO encerra aí', async () => {
    /* A ESTEIRA DA SOBRA GANHOU UM QUARTO PASSO (25/09/2026), por decisão
       do dono revendo a dele própria de 18/08: "agora a sobra vai passar".
       Até aqui o OK da Expedição era o fim. Agora é o penúltimo passo. */
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
    assert.equal(c.json.carimbos.controles, null,
      'a sobra ainda espera o check de Controles Internos');
  });

  test('Controles Internos fecha a sobra, com o recado dele', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Controles Internos'],
      corpo: { para: 'Destinada', obsControles: 'Sobra conferida e destinada.' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Destinada');
    assert.ok(r.json.carimbos.controles, 'o carimbo de Controles é o fecho da sobra');
    /* O recado vai para a MESMA `obs_controles` da devolução normal: é o
       mesmo conceito, e duas colunas para um conceito divergem. */
    assert.equal(r.json.obsControles, 'Sobra conferida e destinada.');
  });

  test('sobra não volta à balança nem passa pela Central de Notas', async () => {
    /* A balança final continua fora (27/08/2026): o caminhão da sobra não
       é pesado vazio, e pedir esse peso seria pedir um número que ninguém
       tem. A Central de Notas também, porque a sobra não gera nota. */
    const peso = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'], corpo: { para: 'Peso Final Registrado' },
    });
    assert.equal(peso.status, 409);
    assert.equal(peso.json.codigo, 'ETAPA_NAO_EXISTE_PARA_SOBRA');
    // Nem a Administração fura: a etapa não existe pra sobra.
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

  test('Faturamento edita AS DUAS pesagens — e só elas nesse cabeçalho', async () => {
    const ok = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { pesoFinal: 47.5 },
    });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(Number(ok.json.pesoFinal), 47.5);
    // O peso de entrada é do mesmo dono (27/08/2026).
    const ent = await req(`/api/devolucoes/${id}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { pesoEntrada: 100.5 },
    });
    assert.equal(ent.status, 200, ent.texto);
    assert.equal(Number(ent.json.pesoEntrada), 100.5);
    assert.equal(Number(ent.json.pesoDevolvido), 53, 'devolvido = entrada - final');
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
      [tokens['Faturamento'], 'Peso Final Registrado'],
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

/* ------------------------------------------------------------------ */
describe('14. As duas pesagens e a esteira inteira (27/08/2026)', () => {
  /* O FLUXO REAL, contado pelo dono:

       "caminhão chega com devoluções, pesa na balança, vai pra expedição,
        descarrega, depois volta pra balança pra pesar vazio (...)
        faturamento colocar o peso final depois que descarregou (...) de lá
        vai pra controles internos e central de notas, que precisa só de um
        campo pro CHECK do checklist pra confirmar a etapa, e observações
        para que eles possam comunicar com a próxima etapa".

     O que este bloco prova, na ordem em que acontece no pátio. */
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', {
      metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist(),
    });
    id = r.json.id;
  });

  test('a esteira tem SETE etapas, com as DUAS balanças seguidas', async () => {
    /* ORDEM DE 08/09/2026: a Expedição saiu do meio das balanças e passou
       para depois delas — pedido do dono, porque o "OKzinho" dela demora
       por desenho e estava segurando o Faturamento. As sete etapas
       continuam sete; o que mudou foi quem vem antes de quem. */
    const passos = [
      [tokens['Portaria'], 'Recebida na Portaria', {}],
      [tokens['Faturamento'], 'Conferida no Faturamento', { pesoEntrada: 21500 }],
      [tokens['Faturamento'], 'Peso Final Registrado', { pesoFinal: 14300 }],
      [tokens['Expedição'], 'Descarga Conferida', {}],
      [tokens['Controles Internos'], 'Destinada', { obsControles: 'Separado, 2 cx para descarte' }],
      [tokens['Central de Notas'], 'Nota Finalizada', { obsNotas: 'NF 998877 emitida' }],
    ];
    let ultimo = null;
    for (const [token, para, extra] of passos) {
      const r = await req(`/api/devolucoes/${id}/etapa`, {
        metodo: 'POST', token, corpo: { para, ...extra },
      });
      assert.equal(r.status, 200, `${para}: ${r.texto}`);
      ultimo = r.json;
    }
    assert.equal(ultimo.status, 'Nota Finalizada');
    assert.equal(Number(ultimo.pesoEntrada), 21500, 'o caminhão cheio, na chegada');
    assert.equal(Number(ultimo.pesoFinal), 14300, 'o caminhão vazio, depois da descarga');
    assert.equal(Number(ultimo.pesoDevolvido), 7200, 'o devolvido é a diferença, calculada no servidor');
    assert.equal(ultimo.obsControles, 'Separado, 2 cx para descarte');
    assert.equal(ultimo.obsNotas, 'NF 998877 emitida', 'o recado da Central de Notas');
    // Cada balança tem a SUA assinatura: são dois momentos diferentes.
    assert.ok(ultimo.carimbos.faturamento, 'assinatura da pesagem de chegada');
    assert.ok(ultimo.carimbos.pesofinal, 'assinatura da pesagem de saída');
    assert.notEqual(ultimo.carimbos.faturamento.em, ultimo.carimbos.pesofinal.em);
  });

  test('pular a segunda balança é recusado — Expedição não vai direto para Destinada', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const did = c.json.id;
    for (const [token, para] of [
      [tokens['Portaria'], 'Recebida na Portaria'],
      [tokens['Faturamento'], 'Conferida no Faturamento'],
    ]) {
      const r = await req(`/api/devolucoes/${did}/etapa`, { metodo: 'POST', token, corpo: { para } });
      assert.equal(r.status, 200, r.texto);
    }
    /* A GARANTIA NÃO MUDOU COM A ORDEM: a destinação não acontece sem a
       balança de saída. Antes o salto testado era Expedição → Destinada;
       agora, com a Expedição depois das balanças, o salto que precisa ser
       recusado é chegada → Destinada. É a mesma coisa que o teste sempre
       protegeu — devolução sem peso final não segue adiante. */
    const pulo = await req(`/api/devolucoes/${did}/etapa`, {
      metodo: 'POST', token: tokens['Controles Internos'], corpo: { para: 'Destinada' },
    });
    assert.equal(pulo.status, 409, 'a balança de saída não se pula');
  });

  test('a segunda balança é do Faturamento — Expedição não assina por ele', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const did = c.json.id;
    for (const [token, para] of [
      [tokens['Portaria'], 'Recebida na Portaria'],
      [tokens['Faturamento'], 'Conferida no Faturamento'],
    ]) {
      await req(`/api/devolucoes/${did}/etapa`, { metodo: 'POST', token, corpo: { para } });
    }
    const r = await req(`/api/devolucoes/${did}/etapa`, {
      metodo: 'POST', token: tokens['Expedição'], corpo: { para: 'Peso Final Registrado' },
    });
    assert.equal(r.status, 403);
  });

  test('pesar só uma ponta NÃO inventa o devolvido — null não é zero', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const so = await req(`/api/devolucoes/${c.json.id}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { pesoEntrada: 20000 },
    });
    assert.equal(so.status, 200, so.texto);
    assert.equal(Number(so.json.pesoEntrada), 20000);
    assert.equal(so.json.pesoFinal, null);
    assert.equal(so.json.pesoDevolvido, null, 'sem as duas pontas não há conta');
  });

  test('o recado das duas últimas etapas é de quem faz a etapa, e de mais ninguém', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const did = c.json.id;
    const ci = await req(`/api/devolucoes/${did}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'], corpo: { obsControles: 'recado dos CI' },
    });
    assert.equal(ci.status, 200, ci.texto);
    assert.equal(ci.json.obsControles, 'recado dos CI');
    const cn = await req(`/api/devolucoes/${did}`, {
      metodo: 'PATCH', token: tokens['Central de Notas'], corpo: { obsNotas: 'recado das notas' },
    });
    assert.equal(cn.status, 200, cn.texto);
    assert.equal(cn.json.obsNotas, 'recado das notas');
    // Trocado: cada um só escreve no seu.
    const trocado = await req(`/api/devolucoes/${did}`, {
      metodo: 'PATCH', token: tokens['Central de Notas'], corpo: { obsControles: 'não é meu' },
    });
    assert.equal(trocado.status, 403);
    const trocado2 = await req(`/api/devolucoes/${did}`, {
      metodo: 'PATCH', token: tokens['Controles Internos'], corpo: { obsNotas: 'nem meu' },
    });
    assert.equal(trocado2.status, 403);
  });

  test('restaurar uma revisão devolve TAMBÉM o peso de entrada e a segunda assinatura', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const did = c.json.id;
    for (const [token, para, extra] of [
      [tokens['Portaria'], 'Recebida na Portaria', {}],
      [tokens['Faturamento'], 'Conferida no Faturamento', { pesoEntrada: 30000 }],
      [tokens['Faturamento'], 'Peso Final Registrado', { pesoFinal: 12000 }],
      [tokens['Expedição'], 'Descarga Conferida', {}],
    ]) {
      const r = await req(`/api/devolucoes/${did}/etapa`, { metodo: 'POST', token, corpo: { para, ...extra } });
      assert.equal(r.status, 200, r.texto);
    }
    const revs = await req(`/api/devolucoes/${did}/revisoes`, { token: tokens['Administração'] });
    assert.equal(revs.status, 200, revs.texto);
    /* A revisão anterior à segunda balança: ali ainda não havia peso
       final. Com a ordem de 08/09 esse estado é "Conferida no
       Faturamento" — antes era "Descarga Conferida", porque a Expedição
       ficava no meio das duas pesagens. */
    const antes = revs.json.find((r) => r.devolucao.status === 'Conferida no Faturamento');
    assert.ok(antes, 'existe revisão do estado antes da segunda pesagem');
    const volta = await req(`/api/devolucoes/${did}/restaurar`, {
      metodo: 'POST', token: tokens['Administração'], corpo: { revisaoId: antes.revisaoId },
    });
    assert.equal(volta.status, 200, volta.texto);
    assert.equal(volta.json.status, 'Conferida no Faturamento');
    assert.equal(volta.json.pesoFinal, null, 'o peso final volta a não existir');
    assert.equal(volta.json.carimbos.pesofinal, null, 'e a assinatura da segunda balança também');
    assert.equal(Number(volta.json.pesoEntrada), 30000, 'o peso de entrada daquele momento continua');
  });
});

/* ------------------------------------------------------------------ */
describe('15. O Faturamento não espera a Expedição (08/09/2026)', () => {
  /* O RELATO, do dono, depois de rodar o processo com o Faturamento:

       "o faturamento precisa conseguir dar continuidade antes da expedicao"
       "Não tem que ser os dois sequenciados (...) No sistema está
        sequenciado mas quando a gente faz na prática ele não está."

     A CAUSA. A máquina de estados exigia o OK da Expedição ENTRE as duas
     balanças: chegada → Expedição → peso final. Só que a etapa da
     Expedição virou o "OKzinho" em 28/08 justamente porque eles NÃO
     conseguem conferir na hora — então a devolução ficava parada na
     balança esperando um OK que, por desenho, demora.

     A tela mostrava a ordem certa (Bruna, 02/09: 2 Balança entrada, 3
     Peso final, 4 Expedição) e o servidor exigia outra. O Faturamento
     via o passo e não conseguia dar. Agora as duas dizem a mesma coisa. */
  let id;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
    await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { para: 'Recebida na Portaria' },
    });
    await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'],
      corpo: { para: 'Conferida no Faturamento', pesoEntrada: 21500 },
    });
  });

  test('o Faturamento fecha a SEGUNDA balança sem o OK da Expedição', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'],
      corpo: { para: 'Peso Final Registrado', pesoFinal: 15000 },
    });
    assert.equal(r.status, 200, `a balança final não pode depender da Expedição: ${r.texto}`);
    assert.equal(r.json.status, 'Peso Final Registrado');
    assert.equal(r.json.pesoFinal, 15000);
    assert.equal(r.json.pesoDevolvido, 6500, 'a conta é chegada − vazio');
  });

  test('a Expedição dá o OKzinho DEPOIS, no ritmo dela', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Expedição'],
      corpo: { para: 'Descarga Conferida', obsExpedicao: 'faltou 1 cx' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Descarga Conferida');
    assert.equal(r.json.obsExpedicao, 'faltou 1 cx');
  });

  test('e os Controles Internos seguem depois dela', async () => {
    const r = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Controles Internos'], corpo: { para: 'Destinada' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Destinada');
  });

  test('a ordem velha morreu: da chegada NÃO se pula para a Expedição', async () => {
    // Sem esta guarda, a correção teria deixado os DOIS caminhos abertos —
    // e a pesagem final viraria opcional sem ninguém decidir isso.
    const r2 = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    const outro = r2.json.id;
    await req(`/api/devolucoes/${outro}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { para: 'Recebida na Portaria' } });
    await req(`/api/devolucoes/${outro}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'], corpo: { para: 'Conferida no Faturamento' } });
    const r = await req(`/api/devolucoes/${outro}/etapa`, {
      metodo: 'POST', token: tokens['Expedição'], corpo: { para: 'Descarga Conferida' },
    });
    assert.equal(r.status, 409, 'a devolução normal não pula a balança final');
  });
});

/* ------------------------------------------------------------------ */
describe('16. O Faturamento digita o peso do CAMINHÃO, não do produto (08/09/2026)', () => {
  /* O dono, sobre a tela do Faturamento:

       "tá fazendo a sua linha o peso das quantidades de produtos. Não
        pode (...) Ele só coloca o peso e pronto acabou. Então na chegada,
        então no final."

     E, confirmando: "nao digita nada por produto, so digita o peso".

     `peso_faturamento` era a ÚNICA coluna de item que o Faturamento
     podia editar — ou seja, a tela dele pedia exatamente uma coisa:
     preencher peso linha a linha. Os dois pesos que ele deve dar são os
     do caminhão, e esses moram na CAPA, não no item. */
  let id, itemId;
  before(async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'], corpo: novoChecklist() });
    id = r.json.id;
    itemId = r.json.itens[0].itemId;
  });

  test('o Faturamento NÃO grava peso por produto', async () => {
    const r = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Faturamento'], corpo: { pesoFaturamento: 12.5 },
    });
    assert.equal(r.status, 403, `linha a linha não é trabalho do Faturamento: ${r.texto}`);
  });

  test('mas os DOIS pesos do caminhão continuam sendo dele', async () => {
    await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { para: 'Recebida na Portaria' } });
    const a = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'],
      corpo: { para: 'Conferida no Faturamento', pesoEntrada: 20000 } });
    assert.equal(a.status, 200, a.texto);
    assert.equal(a.json.pesoEntrada, 20000);
    const b = await req(`/api/devolucoes/${id}/etapa`, {
      metodo: 'POST', token: tokens['Faturamento'],
      corpo: { para: 'Peso Final Registrado', pesoFinal: 14000 } });
    assert.equal(b.status, 200, b.texto);
    assert.equal(b.json.pesoFinal, 14000);
  });

  test('a Logística continua podendo pesar o item (a conferência não sumiu)', async () => {
    // A lição da ocorrência #23: tirar da mão de um posto não é apagar a
    // coluna. Quem lança o checklist continua com ela.
    const r = await req(`/api/devolucoes/${id}/itens/${itemId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { pesoFaturamento: 12.5 },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.pesoFaturamento, 12.5);
  });
});

describe('17. A filial mexe no checklist DELA, e some sem sumir (14/09/2026)', () => {
  /* Relato do dono, com print da tabela de itens: "esse campo precisa estar
     liberado para as filiais preencherem suas devolucoes, filialbsb filialba
     filiales". E, sobre o alcance: "cada filial so mexe no que for do seu
     escopo" e "filial pode excluir checklist e editar".

     O defeito era de TELA: `podeEditarDevolucao()` só respondia sim para
     Logística e Administração, e era ela que ligava os campos — a filial
     criava o checklist e via a tabela inteira como texto. O servidor já
     deixava preencher; o que ele NÃO deixava era excluir, e é isso que muda
     aqui, junto com a exclusão de item virar macia PARA TODOS.

     Estes testes travam o lado do servidor. A tela tem guarda própria. */

  let devBSB = null;
  let itemBSB = null;

  test('a filial cria o próprio checklist e lança item nele', async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Filial 105 BSB'],
      corpo: novoChecklist() });
    assert.equal(r.status, 201, r.texto);
    devBSB = r.json.id || r.json.devolucaoId || r.json.devolucao_id;
    assert.ok(devBSB, `o checklist precisa voltar com id: ${r.texto}`);

    const it = await req(`/api/devolucoes/${devBSB}/itens`, { metodo: 'POST',
      token: tokens['Filial 105 BSB'], corpo: { nota: '9001', cx: 3, peso: 120 } });
    assert.equal(it.status, 201, it.texto);
    itemBSB = it.json.itemId || it.json.item_id || (it.json.item && it.json.item.itemId);
    assert.ok(itemBSB, `o item precisa voltar com id: ${it.texto}`);
  });

  test('e PREENCHE as colunas do lançamento dela', async () => {
    const r = await req(`/api/devolucoes/${devBSB}/itens/${itemBSB}`, { metodo: 'PATCH',
      token: tokens['Filial 105 BSB'], corpo: { motivo: 'AVARIA', cx: 5 } });
    assert.equal(r.status, 200, `a filial precisa preencher o lançamento dela: ${r.texto}`);
  });

  test('mas NÃO escreve na coluna de outro posto (o Nº carga dev é da Portaria)', async () => {
    const r = await req(`/api/devolucoes/${devBSB}/itens/${itemBSB}`, { metodo: 'PATCH',
      token: tokens['Filial 105 BSB'], corpo: { cargaDev: '777' } });
    assert.equal(r.status, 403, r.texto);
    assert.equal(r.json.codigo, 'SETOR_SEM_PERMISSAO');
  });

  test('OUTRA filial não enxerga nem toca no checklist desta', async () => {
    const patch = await req(`/api/devolucoes/${devBSB}/itens/${itemBSB}`, { metodo: 'PATCH',
      token: tokens['Filial 106 BAHIA'], corpo: { motivo: 'INVASAO' } });
    assert.equal(patch.status, 404, `a 106 não pode editar item da 105: ${patch.texto}`);

    const delItem = await req(`/api/devolucoes/${devBSB}/itens/${itemBSB}`,
      { metodo: 'DELETE', token: tokens['Filial 106 BAHIA'] });
    assert.equal(delItem.status, 404, `a 106 não pode excluir item da 105: ${delItem.texto}`);

    const delDev = await req(`/api/devolucoes/${devBSB}`,
      { metodo: 'DELETE', token: tokens['Filial 106 BAHIA'] });
    assert.equal(delDev.status, 404, `a 106 não pode excluir checklist da 105: ${delDev.texto}`);
  });

  test('exclui item do próprio checklist — e a linha SAI DA VISTA sem sumir do banco', async () => {
    const r = await req(`/api/devolucoes/${devBSB}/itens/${itemBSB}`,
      { metodo: 'DELETE', token: tokens['Filial 105 BSB'] });
    assert.equal(r.status, 200, `a filial precisa excluir item do checklist dela: ${r.texto}`);

    // Sai da vista:
    const lido = await req(`/api/devolucoes/${devBSB}`, { token: tokens['Filial 105 BSB'] });
    assert.equal(lido.status, 200, lido.texto);
    const ids = (lido.json.itens || []).map((i) => String(i.itemId ?? i.item_id));
    assert.ok(!ids.includes(String(itemBSB)),
      'item excluído não pode voltar a aparecer no checklist');

    // MAS NÃO SOME: é o ponto da migração 052. O checklist é a prova do que a
    // devolução trouxe — linha apagada sem registro é nota que existiu e
    // ninguém responde por ela.
    const { rows } = await pool.query(
      'SELECT excluido_em, excluido_por, excluido_setor FROM devolucao_itens WHERE item_id = $1',
      [itemBSB]);
    assert.equal(rows.length, 1, 'a linha tem que CONTINUAR no banco');
    assert.ok(rows[0].excluido_em, 'com a marca de quando saiu');
    assert.equal(rows[0].excluido_por, 'Posto BSB', 'e de QUEM apagou');
    assert.equal(rows[0].excluido_setor, 'Filial 105 BSB', 'e de qual setor');
  });

  test('a exclusão de item ficou macia TAMBÉM para a Logística (defeito antigo)', async () => {
    const d = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: novoChecklist() });
    assert.equal(d.status, 201, d.texto);
    const id = d.json.id || d.json.devolucaoId || d.json.devolucao_id;
    const it = await req(`/api/devolucoes/${id}/itens`, { metodo: 'POST',
      token: tokens['Logística'], corpo: { nota: '9002', cx: 1 } });
    const itemId = it.json.itemId || it.json.item_id || (it.json.item && it.json.item.itemId);

    const del = await req(`/api/devolucoes/${id}/itens/${itemId}`,
      { metodo: 'DELETE', token: tokens['Logística'] });
    assert.equal(del.status, 200, del.texto);

    const { rows } = await pool.query(
      'SELECT excluido_por FROM devolucao_itens WHERE item_id = $1', [itemId]);
    assert.equal(rows.length, 1,
      'até 14/09/2026 esta linha era DELETE de verdade e sumia sem rastro');
    assert.equal(rows[0].excluido_por, 'Ana Dev');
  });

  test('a filial exclui o próprio checklist', async () => {
    const r = await req(`/api/devolucoes/${devBSB}`,
      { metodo: 'DELETE', token: tokens['Filial 105 BSB'] });
    assert.equal(r.status, 200, `pedido do dono: "filial pode excluir checklist": ${r.texto}`);
  });

  test('mas continua SEM avançar etapa — o ciclo é da matriz, e a recusa explica', async () => {
    const d = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Filial 105 BSB'],
      corpo: novoChecklist() });
    const id = d.json.id || d.json.devolucaoId || d.json.devolucao_id;
    const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Filial 105 BSB'], corpo: { para: 'Recebida na Portaria' } });
    assert.equal(r.status, 403, r.texto);
    assert.match(r.json.erro, /matriz/i,
      'a recusa precisa DIZER por que, não ser um 403 seco');
  });
});

/* ===================================================================
   18. UM CLIQUE ERRADO ÀS 2 DA MANHÃ TEM VOLTA (14/09/2026)

   Auditoria de prontidão operacional, antes de as devoluções entrarem em
   operação oficial: o ciclo inteiro rodava, cada setor no seu passo, a
   recusa ensinava e a trilha guardava tudo. Faltava UMA coisa — desfazer.

   Carimbada a etapa errada, NINGUÉM conseguia voltar: nem o setor que
   carimbou, nem a Logística, nem a Administração. Todos recebiam
   409 "Não é possível ir de X direto para Y", porque a máquina de estados
   só conhecia o caminho para a frente. O único socorro era a Administração
   abrir "↩ Alterações" e restaurar uma revisão — que a Logística nem
   enxerga, e que ninguém procura quando o que aconteceu foi um clique
   errado.

   A Portaria fica aberta 24 horas e o gestor carimba pelo celular de
   madrugada. Regra da casa: "botão desabilitado não ensina o caminho, só
   nega" — e aqui nem botão havia.

   QUEM DESFAZ, decisão do dono: quem carimbou desfaz o próprio passo,
   e Logística e Administração desfazem qualquer um. Na prática é a MESMA
   allowlist do avanço — quem podia dar o passo pode tirá-lo —, o que
   evita uma segunda tabela de permissão que divergiria da primeira. */
describe('18. Um clique errado às 2 da manhã tem volta (14/09/2026)', () => {
  let dev;

  async function novaDevolucaoNoPasso(passos) {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: novoChecklist() });
    const id = c.json.id;
    for (const [para, setor] of passos) {
      const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
        token: tokens[setor], corpo: { para } });
      assert.equal(r.status, 200, `preparo (${setor} → ${para}): ${r.texto}`);
    }
    return id;
  }

  test('o setor que carimbou desfaz o PRÓPRIO passo', async () => {
    dev = await novaDevolucaoNoPasso([
      ['Recebida na Portaria', 'Portaria'],
      ['Conferida no Faturamento', 'Faturamento'],
    ]);
    const r = await req(`/api/devolucoes/${dev}/desfazer`, { metodo: 'POST',
      token: tokens['Faturamento'] });
    assert.equal(r.status, 200, `o Faturamento precisa conseguir desfazer o próprio carimbo: ${r.texto}`);
    assert.equal(r.json.status, 'Recebida na Portaria',
      'desfazer volta UMA etapa, não zera a devolução');
  });

  test('e o carimbo daquele passo é apagado — a linha não pode dizer duas coisas', async () => {
    const { rows } = await pool.query(
      'SELECT faturamento_por, faturamento_em, portaria_por FROM devolucoes WHERE devolucao_id = $1',
      [dev]);
    assert.equal(rows[0].faturamento_por, null, 'carimbo do passo desfeito tem que sair');
    assert.equal(rows[0].faturamento_em, null);
    assert.ok(rows[0].portaria_por, 'o carimbo das etapas ANTERIORES continua');
  });

  test('o passo desfeito pode ser dado de novo', async () => {
    const r = await req(`/api/devolucoes/${dev}/etapa`, { metodo: 'POST',
      token: tokens['Faturamento'], corpo: { para: 'Conferida no Faturamento' } });
    assert.equal(r.status, 200, `desfazer não pode deixar a devolução travada: ${r.texto}`);
  });

  test('a Logística desfaz etapa de QUALQUER setor', async () => {
    const id = await novaDevolucaoNoPasso([
      ['Recebida na Portaria', 'Portaria'],
      ['Conferida no Faturamento', 'Faturamento'],
      ['Peso Final Registrado', 'Faturamento'],
      ['Descarga Conferida', 'Expedição'],
    ]);
    const r = await req(`/api/devolucoes/${id}/desfazer`, { metodo: 'POST',
      token: tokens['Logística'] });
    assert.equal(r.status, 200, `"controle total das meninas" é o requisito nº 1: ${r.texto}`);
    assert.equal(r.json.status, 'Peso Final Registrado');
  });

  test('mas um setor NÃO desfaz o passo do outro', async () => {
    const id = await novaDevolucaoNoPasso([
      ['Recebida na Portaria', 'Portaria'],
      ['Conferida no Faturamento', 'Faturamento'],
    ]);
    const r = await req(`/api/devolucoes/${id}/desfazer`, { metodo: 'POST',
      token: tokens['Central de Notas'] });
    assert.equal(r.status, 403,
      'a Central de Notas não pode apagar a pesagem do Faturamento');
    assert.match(r.json.erro, /quem (fez|desfaz)|Faturamento/i,
      'a recusa precisa DIZER quem desfaz, não ser um 403 seco');
  });

  test('não há o que desfazer numa devolução recém-lançada', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: novoChecklist() });
    const r = await req(`/api/devolucoes/${c.json.id}/desfazer`, { metodo: 'POST',
      token: tokens['Logística'] });
    assert.equal(r.status, 409, r.texto);
    assert.match(r.json.erro, /nenhuma etapa|ainda não/i);
  });

  test('a filial não desfaz — ela cria e acompanha', async () => {
    const id = await novaDevolucaoNoPasso([['Recebida na Portaria', 'Portaria']]);
    const r = await req(`/api/devolucoes/${id}/desfazer`, { metodo: 'POST',
      token: tokens['Filial 105 BSB'] });
    assert.equal(r.status, 403, r.texto);
  });

  test('na SOBRA, desfazer a Expedição volta para a balança de ENTRADA', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: { ...novoChecklist(), tipo: 'SOBRA', rotas: [] } });
    const id = c.json.id;
    for (const [para, setor] of [['Recebida na Portaria', 'Portaria'],
                                 ['Conferida no Faturamento', 'Faturamento'],
                                 ['Descarga Conferida', 'Expedição']]) {
      const p = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
        token: tokens[setor], corpo: { para } });
      assert.equal(p.status, 200, `preparo da sobra (${para}): ${p.texto}`);
    }
    const r = await req(`/api/devolucoes/${id}/desfazer`, { metodo: 'POST',
      token: tokens['Expedição'] });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Conferida no Faturamento',
      'a sobra nunca passou pelo peso final — desfazer não pode inventar esse passo');
  });

  test('quem desfez fica registrado na trilha', async () => {
    const id = await novaDevolucaoNoPasso([['Recebida na Portaria', 'Portaria']]);
    await req(`/api/devolucoes/${id}/desfazer`, { metodo: 'POST', token: tokens['Logística'] });
    const r = await req(`/api/devolucoes/${id}/revisoes`, { metodo: 'GET',
      token: tokens['Administração'] });
    assert.equal(r.status, 200, r.texto);
    const revs = r.json.revisoes || r.json;
    assert.ok(Array.isArray(revs) && revs.length,
      'desfazer é alteração de dado: tem que deixar revisão');
  });

  /* ──────────────────────────────────────────────────────────────────
     A NOTA DE TRANSFERÊNCIA DA FILIAL (16/09/2026)

     Pedido do dono: "quero um campo chamado checklist devolução das
     filiais que registre a nota de transferência... só as filiais vão
     precisar preencher isso, 106 105 107".

     POR QUE SÓ PARA ELAS, e por que o campo tinha saído deste formulário
     em 19/08: numa devolução comum quem preenche a nota é a PORTARIA, no
     recebimento — na hora do lançamento o caminhão nem chegou. Numa
     devolução de FILIAL a mercadoria sai de lá com nota de transferência
     emitida na hora, então a filial TEM o número ao criar o checklist. O
     motivo que tirou o campo não vale para elas.

     O servidor é quem manda: a tela tem guarda própria, mas um checklist
     de filial sem nota não pode nascer nem por chamada direta. */
  test('filial NÃO cria checklist sem a nota de transferência', async () => {
    /* `novoChecklist()` já traz uma nota — para provar a RECUSA é preciso
       APAGÁ-LA. A primeira versão deste teste não apagava e passava com
       201 achando que tinha reprovado: verde e vermelho pelos motivos
       errados são o mesmo defeito. */
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Filial 106 BAHIA'],
      corpo: { ...novoChecklist(), notaTransferencia: '' } });
    assert.equal(r.status, 400, `esperava recusa, veio ${r.status}: ${r.texto}`);
    assert.equal(r.json.codigo, 'NOTA_TRANSFERENCIA_FALTANDO', r.texto);
    assert.match(r.json.erro || '', /nota de transfer/i,
      'a recusa precisa DIZER o que falta, não só negar');
  });

  test('filial cria com a nota, e ela fica gravada', async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Filial 106 BAHIA'],
      corpo: { ...novoChecklist(), notaTransferencia: '77123' } });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.notaTransferencia, '77123',
      'a nota tem que voltar gravada, senão a filial digita e o dado se perde');
  });

  test('espaço em branco não vale como nota', async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Filial 107 ES'],
      corpo: { ...novoChecklist(), notaTransferencia: '   ' } });
    assert.equal(r.status, 400, `esperava recusa, veio ${r.status}: ${r.texto}`);
    assert.equal(r.json.codigo, 'NOTA_TRANSFERENCIA_FALTANDO', r.texto);
  });

  test('quem NÃO é filial continua criando sem a nota', async () => {
    const r = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: novoChecklist() });
    assert.equal(r.status, 201,
      `a Logística cria antes do caminhão chegar e não tem a nota: ${r.texto}`);
  });
});

/* ------------------------------------------------------------------ */
describe('19. Quem pesou finaliza a sobra (16/09/2026)', () => {
  /* Relato do dono, com print de uma sobra pesada e parada:

       "E NA PARTE DEVOLUÇÃO DE SOBRA, DEPOIS QUE PESA TEM QUE COLOCAR A
        OPÇÃO DE FINALIZAR A ETAPA"

     Ele estava logado no Faturamento. Para a SOBRA, "Descarga Conferida" é
     o ÚLTIMO passo — ela não volta à balança nem passa por Controles
     Internos e Central de Notas. Esse passo estava liberado só para
     Expedição e Logística, então a sobra ficava pesada e parada esperando
     outro setor aparecer. Pior: a esteira da tela já chamava o Faturamento
     para ela ("SUA VEZ"), porque "Conferida no Faturamento" é o status onde
     a segunda etapa dele começa na devolução normal.

     O que NÃO muda, e é o ponto de metade dos testes abaixo: a devolução
     NORMAL. Lá, "Descarga Conferida" sai de "Peso Final Registrado" e
     continua sendo da Expedição — o Faturamento não ganhou atalho nenhum
     para pular a balança final. */

  async function sobraPesada() {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: { tipo: 'SOBRA', dataDev: HOJE, placa: 'SIY0G41', motorista: 'LEONARDO',
        itens: [{ cx: 3, peso: 12.5, codProduto: '30110',
                  produtoNome: 'LINGUIÇA', motivo: '652 — Sobras' }] } });
    assert.equal(c.status, 201, c.texto);
    const id = c.json.id;
    const a = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Portaria'], corpo: { para: 'Recebida na Portaria', chegouLacrado: false } });
    assert.equal(a.status, 200, a.texto);
    const b = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Faturamento'], corpo: { para: 'Conferida no Faturamento', pesoEntrada: 21500 } });
    assert.equal(b.status, 200, b.texto);
    return id;
  }

  test('o Faturamento encerra a sobra que ele mesmo pesou', async () => {
    const id = await sobraPesada();
    const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Faturamento'],
      corpo: { para: 'Descarga Conferida', obsExpedicao: 'sobra descarregada' } });
    assert.equal(r.status, 200, `quem pesou precisa conseguir finalizar: ${r.texto}`);
    assert.equal(r.json.status, 'Descarga Conferida');
    assert.equal(r.json.obsExpedicao, 'sobra descarregada',
      'o recado da etapa vai junto, como em qualquer outro passo');
  });

  test('o carimbo guarda QUEM finalizou — e o peso de entrada continua intacto', async () => {
    const id = await sobraPesada();
    await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Faturamento'], corpo: { para: 'Descarga Conferida' } });
    const { rows } = await pool.query(
      `SELECT expedicao_por, expedicao_em, peso_entrada, operador_setor
         FROM devolucoes WHERE devolucao_id = $1`, [id]);
    assert.equal(rows[0].expedicao_por, 'Diego Dev',
      'o carimbo é de quem deu o passo, não do setor dono dele — como já vale para a Logística');
    assert.ok(rows[0].expedicao_em, 'sem instante não há assinatura');
    assert.equal(rows[0].operador_setor, 'Faturamento',
      'e o setor de quem agiu fica registrado na linha');
    assert.equal(Number(rows[0].peso_entrada), 21500,
      'finalizar não mexe no peso da balança de entrada');
  });

  test('a Expedição continua finalizando a sobra — nada foi tirado dela', async () => {
    const id = await sobraPesada();
    const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Expedição'], corpo: { para: 'Descarga Conferida' } });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Descarga Conferida');
  });

  test('quem podia fazer, desfaz: o Faturamento desfaz o fecho da sobra', async () => {
    /* A allowlist do desfazer é a MESMA do avanço (decisão de 14/09) — não
       uma segunda tabela. Se o Faturamento pode encerrar, ele conserta o
       clique errado sem acordar ninguém. */
    const id = await sobraPesada();
    await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Faturamento'], corpo: { para: 'Descarga Conferida' } });
    const r = await req(`/api/devolucoes/${id}/desfazer`, { metodo: 'POST',
      token: tokens['Faturamento'] });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Conferida no Faturamento',
      'a sobra volta para a balança de ENTRADA — peso final ela nunca teve');
  });

  test('a devolução NORMAL não ganhou atalho: do peso de entrada não se pula para o fim', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: novoChecklist() });
    const id = c.json.id;
    for (const [para, setor] of [['Recebida na Portaria', 'Portaria'],
      ['Conferida no Faturamento', 'Faturamento']]) {
      const p = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
        token: tokens[setor], corpo: { para } });
      assert.equal(p.status, 200, p.texto);
    }
    const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Faturamento'], corpo: { para: 'Descarga Conferida' } });
    assert.equal(r.status, 409,
      `pular a balança final na devolução normal é o que não pode acontecer: ${r.texto}`);
  });

  test('na devolução normal, o OK da descarga continua recusando o Faturamento', async () => {
    const c = await req('/api/devolucoes', { metodo: 'POST', token: tokens['Logística'],
      corpo: novoChecklist() });
    const id = c.json.id;
    for (const [para, setor] of [['Recebida na Portaria', 'Portaria'],
      ['Conferida no Faturamento', 'Faturamento'],
      ['Peso Final Registrado', 'Faturamento']]) {
      const p = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
        token: tokens[setor], corpo: { para } });
      assert.equal(p.status, 200, p.texto);
    }
    const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Faturamento'], corpo: { para: 'Descarga Conferida' } });
    assert.equal(r.status, 403, `o OK da descarga é da Expedição: ${r.texto}`);
    assert.equal(r.json.codigo, 'SETOR_SEM_PERMISSAO');
  });

  test('setor de fora continua recusado, e a recusa ENSINA quem faz', async () => {
    const id = await sobraPesada();
    const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Central de Notas'], corpo: { para: 'Descarga Conferida' } });
    assert.equal(r.status, 403, r.texto);
    assert.match(r.json.erro || '', /Expedição, Faturamento ou Logística/,
      'com três setores a frase precisa ler como gente fala, não "A ou B ou C"');
  });

  test('a filial continua sem avançar etapa, nem na sobra', async () => {
    const id = await sobraPesada();
    const r = await req(`/api/devolucoes/${id}/etapa`, { metodo: 'POST',
      token: tokens['Filial 105 BSB'], corpo: { para: 'Descarga Conferida' } });
    assert.equal(r.status, 403, r.texto);
  });
});
