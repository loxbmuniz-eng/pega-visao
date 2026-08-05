/* Bateria de testes da API contra um PostgreSQL de verdade.

   Não usa mock de banco de propósito: o que precisa ser provado aqui é
   justamente o comportamento que só aparece com o banco real — bloqueio
   otimista, FOR UPDATE em cliques simultâneos, gatilho de versão, chave
   estrangeira. Um mock passaria em tudo isso sem provar nada.

   Rode com:  npm run teste
   Exige as variáveis do .env apontando para um banco DESCARTÁVEL. */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

import { criarServidor } from '../src/servidor.js';
import { pool } from '../src/banco.js';

let servidor;
let base;
const tokens = {};

const OPERADORES = [
  ['ana@teste.local', 'Ana', 'Logística'],
  ['bruno@teste.local', 'Bruno', 'Portaria'],
  ['carla@teste.local', 'Carla', 'Expedição'],
  ['diego@teste.local', 'Diego', 'Faturamento'],
];
const SENHA = 'senha-de-teste-123';

async function req(caminho, { metodo = 'GET', token, corpo, cabecalhos = {} } = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...cabecalhos,
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* csv ou vazio */ }
  return { status: r.status, json, texto, headers: r.headers };
}

before(async () => {
  // Limpa na ordem das dependências. fact_statusfrota referencia
  // fact_viagens, então não dá para inverter.
  await pool.query('DELETE FROM log_eventos');
  await pool.query('DELETE FROM fact_statusfrota');
  await pool.query('DELETE FROM fact_viagens');
  await pool.query("DELETE FROM operadores WHERE email LIKE '%@teste.local'");

  const hash = await bcrypt.hash(SENHA, 4); // custo baixo: é teste
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

/* ------------------------------------------------------------------ */
describe('1. Autenticação', () => {
  test('senha errada é recusada', async () => {
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'ana@teste.local', senha: 'errada' },
    });
    assert.equal(r.status, 401);
  });

  test('e-mail inexistente devolve a MESMA mensagem que senha errada', async () => {
    const a = await req('/auth/login', { metodo: 'POST', corpo: { email: 'ana@teste.local', senha: 'x' } });
    const b = await req('/auth/login', { metodo: 'POST', corpo: { email: 'naoexiste@teste.local', senha: 'x' } });
    // Mensagens diferentes entregariam quais e-mails são válidos.
    assert.equal(a.json.erro, b.json.erro);
    assert.equal(a.status, b.status);
  });

  test('rota protegida sem token devolve 401', async () => {
    const r = await req('/api/estado');
    assert.equal(r.status, 401);
  });

  test('token adulterado é recusado', async () => {
    const falso = tokens['Logística'].slice(0, -4) + 'AAAA';
    const r = await req('/api/estado', { token: falso });
    assert.equal(r.status, 401);
  });

  test('/auth/eu devolve o setor vindo do banco', async () => {
    const r = await req('/auth/eu', { token: tokens['Portaria'] });
    assert.equal(r.json.operador.setor, 'Portaria');
  });
});

/* ------------------------------------------------------------------ */
describe('2. Trava de frota', () => {
  test('placa fora da base não vira carga', async () => {
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: 'ZZZ9999', numeroCarga: '90001' },
    });
    assert.equal(r.status, 422);
    assert.equal(r.json.codigo, 'PLACA_FORA_DA_FROTA');
  });

  test('placa da base é aceita e puxa a transportadora do cadastro', async () => {
    const { rows } = await pool.query('SELECT placa, transportadora FROM dim_veiculos LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      // Manda transportadora errada de propósito: quem manda é a base.
      corpo: { placa: rows[0].placa, numeroCarga: '90002', transportadora: '' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.transportadora, rows[0].transportadora);
  });
});

/* ------------------------------------------------------------------ */
describe('3. Permissão por setor — validada no SERVIDOR', () => {
  test('Portaria não programa carga', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { placa: rows[0].placa, numeroCarga: '90003' },
    });
    assert.equal(r.status, 403);
  });

  test('setor forjado no CORPO da requisição é ignorado', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      // Este era o furo da versão anterior: o setor vinha do cliente.
      corpo: { placa: rows[0].placa, numeroCarga: '90004', setor: 'Logística', operador_setor: 'Logística' },
    });
    assert.equal(r.status, 403, 'o setor tem que vir do token, não do corpo');
  });
});

/* ------------------------------------------------------------------ */
describe('4. Máquina de estados', () => {
  let cargaId;
  let placa;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 5 LIMIT 1');
    placa = rows[0].placa;
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa, numeroCarga: '91000', rota: '500', qtdGanchos: 30, paletizada: 'Sim' },
    });
    cargaId = r.json.id;
  });

  test('nasce em Aguardando Veículo', async () => {
    const r = await req('/api/estado', { token: tokens['Logística'] });
    const c = r.json.cargas.find((x) => x.id === cargaId);
    assert.equal(c.status, 'Aguardando Veículo');
    assert.equal(c.paletizada, 'Sim');
  });

  test('não dá para pular etapa', async () => {
    const r = await req(`/api/cargas/${cargaId}/status`, {
      metodo: 'POST', token: tokens['Faturamento'], corpo: { status: 'Faturado' },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'TRANSICAO_INVALIDA');
  });

  test('Expedição não registra a chegada — isso é da Portaria', async () => {
    const r = await req(`/api/cargas/${cargaId}/status`, {
      metodo: 'POST', token: tokens['Expedição'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 403);
  });

  test('fluxo completo, cada setor no seu passo', async () => {
    const passos = [
      ['Portaria', 'Aguardando Embarque'],
      ['Expedição', 'Embarque Iniciado'],
      ['Expedição', 'Embarque Finalizado'],
      ['Faturamento', 'Faturado'],
    ];
    for (const [setor, status] of passos) {
      const r = await req(`/api/cargas/${cargaId}/status`, {
        metodo: 'POST', token: tokens[setor], corpo: { status },
      });
      assert.equal(r.status, 200, `${setor} → ${status}: ${r.texto}`);
      assert.equal(r.json.status, status);
    }
  });

  test('a saída pela Portaria fecha o ciclo', async () => {
    const r = await req('/api/portaria/saida', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { placa },
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.liberadas.some((c) => c.id === cargaId));
    assert.equal(r.json.liberadas.find((c) => c.id === cargaId).status, 'Seguiu Viagem');
  });

  test('UMA linha por carga em fact_viagens, seis eventos em fact_statusfrota', async () => {
    const v = await pool.query('SELECT count(*)::int AS n FROM fact_viagens WHERE carga_id = $1', [cargaId]);
    const m = await pool.query(
      'SELECT status_novo FROM fact_statusfrota WHERE carga_id = $1 ORDER BY data_evento', [cargaId]
    );
    // Uma linha só é o que impede o Power BI de contar a mesma carga 6 vezes.
    assert.equal(v.rows[0].n, 1);
    assert.deepEqual(m.rows.map((r) => r.status_novo), [
      'Aguardando Veículo', 'Aguardando Embarque', 'Embarque Iniciado',
      'Embarque Finalizado', 'Faturado', 'Seguiu Viagem',
    ]);
  });

  test('o log de auditoria registra os quatro setores, todos verificados', async () => {
    const { rows } = await pool.query(
      'SELECT DISTINCT setor, operador_verificado FROM log_eventos WHERE carga_id = $1', [cargaId]
    );
    const setores = new Set(rows.map((r) => r.setor));
    assert.ok(setores.has('Logística') && setores.has('Portaria')
      && setores.has('Expedição') && setores.has('Faturamento'));
    assert.ok(rows.every((r) => r.operador_verificado === true));
  });
});

/* ------------------------------------------------------------------ */
describe('5. Conflito e concorrência', () => {
  let cargaId;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 9 LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '92000', peso: 1000 },
    });
    cargaId = r.json.id;
  });

  test('versão desatualizada é recusada com o estado atual junto', async () => {
    const antes = await req('/api/estado', { token: tokens['Logística'] });
    const versaoAntiga = antes.json.cargas.find((c) => c.id === cargaId).versao;

    const primeira = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { peso: 2000, versao: versaoAntiga },
    });
    assert.equal(primeira.status, 200);

    const segunda = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { peso: 3000, versao: versaoAntiga }, // versão já vencida
    });
    assert.equal(segunda.status, 409);
    assert.equal(segunda.json.codigo, 'CONFLITO_DE_VERSAO');
    assert.equal(segunda.json.atual.peso, 2000, 'devolve o estado atual para o painel mostrar');
  });

  test('sem versão informada, grava (fila offline não sabe a versão)', async () => {
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { peso: 4000 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.peso, 4000);
  });

  test('dois cliques simultâneos no mesmo botão: só um passa', async () => {
    await req(`/api/cargas/${cargaId}/status`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    const [a, b] = await Promise.all([
      req(`/api/cargas/${cargaId}/status`, {
        metodo: 'POST', token: tokens['Expedição'], corpo: { status: 'Embarque Iniciado' },
      }),
      req(`/api/cargas/${cargaId}/status`, {
        metodo: 'POST', token: tokens['Expedição'], corpo: { status: 'Embarque Iniciado' },
      }),
    ]);
    const ok = [a, b].filter((r) => r.status === 200);
    assert.equal(ok.length, 1, 'o FOR UPDATE precisa serializar os dois cliques');

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM fact_statusfrota WHERE carga_id = $1 AND status_novo = 'Embarque Iniciado'",
      [cargaId]
    );
    assert.equal(rows[0].n, 1, 'a etapa não pode aparecer duas vezes no histórico do BI');
  });

  test('reenvio da fila offline não duplica a carga', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 12 LIMIT 1');
    const corpo = { id: 'carga_fila_offline_1', placa: rows[0].placa, numeroCarga: '93000' };
    const a = await req('/api/cargas', { metodo: 'POST', token: tokens['Logística'], corpo });
    const b = await req('/api/cargas', { metodo: 'POST', token: tokens['Logística'], corpo });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200, 'reenvio não é erro — é a fila offline fazendo o trabalho dela');
    const { rows: c } = await pool.query(
      'SELECT count(*)::int AS n FROM fact_viagens WHERE carga_id = $1', [corpo.id]
    );
    assert.equal(c[0].n, 1);
  });
});

/* ------------------------------------------------------------------ */
describe('6. Leitura incremental', () => {
  test('a marca devolvida recua no tempo (margem contra perda de update)', async () => {
    const antes = Date.now();
    const r = await req('/api/estado', { token: tokens['Logística'] });
    const marca = Date.parse(r.json.marca);
    // Se a marca fosse tomada depois da consulta, tudo gravado no meio
    // ficaria fora das leituras seguintes — para sempre.
    assert.ok(marca <= antes, 'a marca tem que ser anterior à consulta');
    assert.ok(antes - marca >= 4000, 'a margem de 5 s precisa estar aplicada');
  });

  test('?desde= traz o que mudou depois da marca', async () => {
    const marca = new Date().toISOString();
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 20 LIMIT 1');
    await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '94000' },
    });
    const r = await req(`/api/estado?desde=${encodeURIComponent(marca)}`, { token: tokens['Logística'] });
    assert.equal(r.json.completo, false);
    assert.ok(r.json.cargas.some((c) => c.numeroCarga === '94000'));
  });

  test('desde inválido não quebra — devolve tudo', async () => {
    const r = await req('/api/estado?desde=isso-nao-e-data', { token: tokens['Logística'] });
    assert.equal(r.status, 200);
    assert.equal(r.json.completo, true);
  });
});

/* ------------------------------------------------------------------ */
describe('7. Export para o Power BI', () => {
  test('sem token, nada sai', async () => {
    const r = await req('/bi/dim_carga');
    assert.equal(r.status, 401);
  });

  test('token de operador NÃO serve para o BI', async () => {
    const r = await req('/bi/dim_carga', { token: tokens['Logística'] });
    assert.equal(r.status, 401);
  });

  test('as sete views respondem', async () => {
    const views = ['dim_carga', 'fact_movimentacoes', 'dim_frota',
      'dim_transportadora', 'dim_status', 'dim_rota', 'tempos_por_etapa'];
    for (const v of views) {
      const r = await req(`/bi/${v}?token=token-de-teste-do-bi`);
      assert.equal(r.status, 200, `${v}: ${r.texto.slice(0, 200)}`);
      assert.ok(Array.isArray(r.json), `${v} devia devolver lista`);
    }
  });

  test('view desconhecida devolve 404, não erro de SQL', async () => {
    const r = await req('/bi/nao_existe?token=token-de-teste-do-bi');
    assert.equal(r.status, 404);
    assert.equal(r.json.codigo, 'VIEW_DESCONHECIDA');
  });

  test('tentativa de injeção no nome da view não chega ao banco', async () => {
    const alvo = encodeURIComponent('dim_carga; DROP TABLE fact_viagens; --');
    const r = await req(`/bi/${alvo}?token=token-de-teste-do-bi`);
    assert.equal(r.status, 404);
    const { rows } = await pool.query(
      "SELECT to_regclass('public.fact_viagens') IS NOT NULL AS existe"
    );
    assert.equal(rows[0].existe, true, 'a tabela tem que continuar de pé');
  });

  test('CSV sai com BOM e ponto e vírgula (Excel em português)', async () => {
    /* Precisa olhar os BYTES. `Response.text()` remove o BOM na decodificação
       — é o que a especificação manda — então checar a string daria falso
       negativo mesmo com o arquivo correto. */
    const resposta = await fetch(base + '/bi/dim_carga?formato=csv&token=token-de-teste-do-bi');
    assert.equal(resposta.status, 200);
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xEF, 0xBB, 0xBF],
      'sem BOM o Excel erra a acentuação');

    const texto = new TextDecoder('utf-8').decode(bytes);
    assert.ok(texto.split('\r\n')[0].includes(';'));
  });

  test('os cabeçalhos do CSV batem com o export do painel', async () => {
    const r = await req('/bi/dim_carga?formato=csv&token=token-de-teste-do-bi');
    const cabecalho = r.texto.replace(/^﻿/, '').split('\r\n')[0].split(';');
    // Se estes nomes mudarem, o modelo do Power BI quebra.
    for (const esperado of ['Id', 'NumeroCarga', 'Placa', 'Transportadora',
      'TipoVeiculo', 'PesoKg', 'RotaCodigo', 'PraOnde', 'Paletizada',
      'QtdGanchos', 'QtdEntregas', 'StatusAtual']) {
      assert.ok(cabecalho.includes(esperado), `faltou a coluna ${esperado}`);
    }
  });
});

/* ------------------------------------------------------------------ */
describe('7b. Gestão de operadores (só Administração)', () => {
  let tokenAdmin;
  let idCriado;
  const emailNovo = `novo_${Date.now()}@teste.local`;

  before(async () => {
    const hash = await bcrypt.hash(SENHA, 4);
    await pool.query(
      `INSERT INTO operadores (email, nome, setor, senha_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET setor = EXCLUDED.setor, ativo = TRUE`,
      ['chefe@teste.local', 'Chefe', 'Administração', hash]
    );
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'chefe@teste.local', senha: SENHA },
    });
    tokenAdmin = r.json.token;
  });

  test('Logística NÃO lista operadores', async () => {
    const r = await req('/api/operadores', { token: tokens['Logística'] });
    assert.equal(r.status, 403, 'criar acesso não é operar o pátio');
  });

  test('Administração lista', async () => {
    const r = await req('/api/operadores', { token: tokenAdmin });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
  });

  test('a listagem NUNCA devolve o hash da senha', async () => {
    const r = await req('/api/operadores', { token: tokenAdmin });
    // Mesmo sendo hash, exportá-lo permite ataque de dicionário offline.
    assert.ok(!/senha|hash|\$2[aby]\$/i.test(r.texto), 'vazou material de senha');
  });

  test('cria operador e ele consegue entrar', async () => {
    const r = await req('/api/operadores', {
      metodo: 'POST', token: tokenAdmin,
      corpo: { email: emailNovo, nome: 'Novo Porteiro', setor: 'Portaria', senha: 'senha-inicial-1' },
    });
    assert.equal(r.status, 201, r.texto);
    idCriado = r.json.id;

    const login = await req('/auth/login', {
      metodo: 'POST', corpo: { email: emailNovo, senha: 'senha-inicial-1' },
    });
    assert.equal(login.status, 200, 'de nada adianta criar se a pessoa não entra');
    assert.equal(login.json.operador.setor, 'Portaria');
  });

  test('e-mail duplicado é recusado', async () => {
    const r = await req('/api/operadores', {
      metodo: 'POST', token: tokenAdmin,
      corpo: { email: emailNovo, nome: 'Outro', setor: 'Portaria', senha: 'senha-inicial-1' },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'EMAIL_DUPLICADO');
  });

  test('senha curta é recusada', async () => {
    const r = await req('/api/operadores', {
      metodo: 'POST', token: tokenAdmin,
      corpo: { email: `curta_${Date.now()}@teste.local`, nome: 'X', setor: 'Portaria', senha: '123' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'SENHA_CURTA');
  });

  test('bloquear impede o login na hora', async () => {
    const r = await req(`/api/operadores/${idCriado}`, {
      metodo: 'PATCH', token: tokenAdmin, corpo: { ativo: false },
    });
    assert.equal(r.status, 200);
    const login = await req('/auth/login', {
      metodo: 'POST', corpo: { email: emailNovo, senha: 'senha-inicial-1' },
    });
    assert.equal(login.status, 401);
  });

  test('reativar devolve o acesso', async () => {
    await req(`/api/operadores/${idCriado}`, {
      metodo: 'PATCH', token: tokenAdmin, corpo: { ativo: true },
    });
    const login = await req('/auth/login', {
      metodo: 'POST', corpo: { email: emailNovo, senha: 'senha-inicial-1' },
    });
    assert.equal(login.status, 200);
  });

  test('redefinir senha invalida a anterior', async () => {
    await req(`/api/operadores/${idCriado}`, {
      metodo: 'PATCH', token: tokenAdmin, corpo: { senha: 'outra-senha-999' },
    });
    const velha = await req('/auth/login', {
      metodo: 'POST', corpo: { email: emailNovo, senha: 'senha-inicial-1' },
    });
    const nova = await req('/auth/login', {
      metodo: 'POST', corpo: { email: emailNovo, senha: 'outra-senha-999' },
    });
    assert.equal(velha.status, 401);
    assert.equal(nova.status, 200);
  });

  test('o admin não consegue desativar a si mesmo', async () => {
    const eu = await req('/auth/eu', { token: tokenAdmin });
    const r = await req(`/api/operadores/${eu.json.operador.id}`, {
      metodo: 'PATCH', token: tokenAdmin, corpo: { ativo: false },
    });
    // Sem esta trava o erro é irreversível pela própria interface: só
    // voltaria por SSH, que é o que esta tela existe para evitar.
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'AUTO_DESATIVACAO');
  });

  test('o admin não consegue tirar a si mesmo da Administração', async () => {
    const eu = await req('/auth/eu', { token: tokenAdmin });
    const r = await req(`/api/operadores/${eu.json.operador.id}`, {
      metodo: 'PATCH', token: tokenAdmin, corpo: { setor: 'Portaria' },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'AUTO_REBAIXAMENTO');
  });
});

/* ------------------------------------------------------------------ */
describe('7c. Logística cobre todos os postos', () => {
  let cargaId;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 30 LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '95000' },
    });
    cargaId = r.json.id;
  });

  test('a Logística registra o fluxo inteiro sozinha', async () => {
    /* Decisão do gestor: a Logística cobre qualquer posto quando falta
       gente. Recusar aqui empurraria para pedir a senha do porteiro
       emprestada — e aí o log diria "Portaria" quando foi a Logística. */
    for (const status of ['Aguardando Embarque', 'Embarque Iniciado',
      'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']) {
      const r = await req(`/api/cargas/${cargaId}/status`, {
        metodo: 'POST', token: tokens['Logística'], corpo: { status },
      });
      assert.equal(r.status, 200, `Logística → ${status}: ${r.texto}`);
    }
  });

  test('e o log registra Logística, não o setor dono do passo', async () => {
    const { rows } = await pool.query(
      'SELECT DISTINCT setor FROM fact_statusfrota WHERE carga_id = $1', [cargaId]
    );
    assert.deepEqual(rows.map((r) => r.setor), ['Logística'],
      'a rastreabilidade tem que dizer quem fez de verdade');
  });

  test('a Portaria continua SEM poder programar carga', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 31 LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { placa: rows[0].placa, numeroCarga: '95001' },
    });
    assert.equal(r.status, 403, 'acesso total é da Logística, não de todo mundo');
  });
});

/* ------------------------------------------------------------------ */
describe('8. Superfície de ataque', () => {
  test('origem não autorizada é barrada no CORS', async () => {
    const r = await req('/health', { cabecalhos: { origin: 'https://site-do-atacante.com' } });
    assert.equal(r.status, 403);
  });

  test('a origem do painel passa', async () => {
    const r = await req('/health', { cabecalhos: { origin: 'https://embarquesuinco.com.br' } });
    assert.equal(r.status, 200);
  });

  test('id com payload de XSS é recusado antes de tocar no banco', async () => {
    const r = await req(`/api/cargas/${encodeURIComponent("x');alert(1)//")}/status`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'ID_INVALIDO');
  });

  test('erro interno não vaza detalhe do PostgreSQL', async () => {
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: 'AAK8958', rota: 'ROTA_QUE_NAO_EXISTE' },
    });
    if (r.status === 500) {
      assert.equal(r.json.erro, 'Erro interno no servidor.');
      assert.ok(!/relation|column|constraint|pg_/i.test(r.texto));
    }
  });

  test('/health responde sem token, e sem contar segredo', async () => {
    const r = await req('/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(!/senha|secret|token|password/i.test(r.texto));
  });

  test('rota inexistente devolve 404 em JSON', async () => {
    const r = await req('/api/rota-que-nao-existe', { token: tokens['Logística'] });
    assert.equal(r.status, 404);
    assert.equal(r.json.codigo, 'ROTA_INEXISTENTE');
  });

  test('Portaria não consegue editar peso da carga', async () => {
    const { rows } = await pool.query('SELECT carga_id, peso_kg FROM fact_viagens LIMIT 1');
    const r = await req(`/api/cargas/${rows[0].carga_id}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { peso: 99999 },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'SEM_CAMPOS_PERMITIDOS');
    const depois = await pool.query('SELECT peso_kg FROM fact_viagens WHERE carga_id = $1', [rows[0].carga_id]);
    assert.equal(depois.rows[0].peso_kg, rows[0].peso_kg);
  });
});
