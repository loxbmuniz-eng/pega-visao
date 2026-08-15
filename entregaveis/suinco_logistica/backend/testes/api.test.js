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
import jwt from 'jsonwebtoken';

import { criarServidor, chaveDoLimiteGeral } from '../src/servidor.js';
import { pool } from '../src/banco.js';
import { config } from '../src/config.js';

function jwtAssinar(payload) {
  return jwt.sign(payload, config.jwtSegredo, { expiresIn: '1h' });
}

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
describe('1b. Renovação de sessão', () => {
  /* O que precisa ser verdade é que a validade ANDA PARA FRENTE, não que o
     texto do token mude. Emitido dentro do mesmo segundo, o JWT sai byte a
     byte idêntico — mesma carga, mesmo `iat`. Comparar os textos mediria o
     relógio, não a renovação. Por isso a espera de pouco mais de um
     segundo: é o que torna a diferença observável. */
  test('renova empurrando a validade para frente', async () => {
    const validade = (jwt) =>
      JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp;

    const antes = validade(tokens['Portaria']);
    await new Promise((r) => setTimeout(r, 1100));

    const r = await req('/auth/renovar', { metodo: 'POST', token: tokens['Portaria'] });
    assert.equal(r.status, 200, r.texto);
    assert.ok(validade(r.json.token) > antes,
      'a renovação tem que estender a sessão, não devolver a mesma validade');

    const usa = await req('/auth/eu', { token: r.json.token });
    assert.equal(usa.status, 200);
    assert.equal(usa.json.operador.setor, 'Portaria');
  });

  test('sem token não renova', async () => {
    const r = await req('/auth/renovar', { metodo: 'POST' });
    assert.equal(r.status, 401);
  });

  /* A renovação relê o operador no BANCO. Sem isso, desativar alguém só
     teria efeito quando o token dele vencesse — até 12 horas depois, com a
     pessoa operando o pátio nesse meio tempo. */
  test('operador desativado NÃO renova, mesmo com token ainda válido', async () => {
    const login = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'carla@teste.local', senha: SENHA },
    });
    const tk = login.json.token;
    await pool.query("UPDATE operadores SET ativo = FALSE WHERE email = 'carla@teste.local'");
    try {
      const r = await req('/auth/renovar', { metodo: 'POST', token: tk });
      assert.equal(r.status, 401);
      assert.equal(r.json.codigo, 'OPERADOR_INATIVO');
    } finally {
      await pool.query("UPDATE operadores SET ativo = TRUE WHERE email = 'carla@teste.local'");
    }
  });

  test('mudança de setor passa a valer na renovação', async () => {
    const login = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'diego@teste.local', senha: SENHA },
    });
    await pool.query("UPDATE operadores SET setor = 'Expedição' WHERE email = 'diego@teste.local'");
    try {
      const r = await req('/auth/renovar', { metodo: 'POST', token: login.json.token });
      assert.equal(r.json.operador.setor, 'Expedição',
        'o setor tem que vir do banco, não do token antigo');
    } finally {
      await pool.query("UPDATE operadores SET setor = 'Faturamento' WHERE email = 'diego@teste.local'");
    }
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

  /* Achado em produção em 07/08/2026: Faturamento clicou "Faturado" em duas
     placas e recebeu "Só a Logística programa carga" nas duas.

     O painel (sincronizarCarga, data.js) reenvia a carga por POST /api/cargas
     a CADA save() — inclusive quando a única mudança foi status, que sobe
     por rota própria (POST /api/cargas/:id/status, chamada à parte). Esse
     reenvio é o eco de sincronização normal (o servidor responde 200 e o
     cliente cai no PATCH), não uma tentativa real de criar carga nova.

     A recusa acontecia porque a trava de setor (podeCriarCarga) era
     checada ANTES de olhar se aquele carga_id já existia — qualquer setor
     sem permissão de CRIAR levava 403 mesmo reenviando uma carga que já
     existia e que ele tinha todo o direito de estar sincronizando. */
  test('reenviar POST de uma carga que JÁ EXISTE não é bloqueado pela trava de criação',
    async () => {
      const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1 OFFSET 1');
      const criar = await req('/api/cargas', {
        metodo: 'POST', token: tokens['Logística'],
        corpo: { placa: rows[0].placa, numeroCarga: '90005' },
      });
      assert.equal(criar.status, 201, criar.texto);
      const id = criar.json.id;

      // Faturamento não pode CRIAR carga — mas reenviar essa MESMA carga
      // (o eco de sincronização do painel) tem que ser aceito como "já
      // existia", não recusado como se fosse uma criação nova.
      const reenvio = await req('/api/cargas', {
        metodo: 'POST', token: tokens['Faturamento'],
        corpo: { id, placa: rows[0].placa, numeroCarga: '90005' },
      });
      assert.equal(reenvio.status, 200,
        `esperado 200 ("já existia"), veio ${reenvio.status}: ${reenvio.texto}`);
    });
});

/* ------------------------------------------------------------------
   3b. Chegada sem programação (Portaria)
   ---------------------------------------------------------------------
   Achado da auditoria "superpowers": a Portaria registra a chegada de um
   caminhão sem programação prévia clicando "Chegou" — o painel cria a
   carga localmente (aguardandoCarga:true) e sobe pelo MESMO POST /api/cargas
   que a Logística usa para programar. Antes desta correção, esse POST só
   aceitava Logística/Administração (podeCriarCarga): a Portaria recebia
   403, o painel engolia a recusa em silêncio (upsert() devolve
   {recusado:true} em vez de lançar exceção, e sincronizarCargasAlteradas()
   só trata exceção lançada), e o caminhão nunca virava carga no banco —
   sumia de todos os outros terminais.

   Existia uma função pronta para exatamente este caso —
   podeRegistrarChegadaSemProgramacao(), em dominio/fluxo.js — escrita e
   nunca chamada por nenhuma rota. ------------------------------------ */
describe('3b. Chegada sem programação (Portaria)', () => {
  test('Portaria registra chegada sem programação — nasce em Aguardando Embarque', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'chegada_1', placa: rows[0].placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, 'Aguardando Embarque');
    assert.equal(r.json.numeroCarga, 'Aguardando Carga');
    assert.equal(r.json.aguardandoCarga, true);
  });

  test('placa FORA da frota é RECUSADA também na chegada sem programação', async () => {
    /* ESTE TESTE INVERTEU DE PREMISSA EM 14/08/2026 — e o registro importa.

       Ele nasceu afirmando o contrário: "placa FORA da frota é aceita
       quando é chegada sem programação". A ideia era que um caminhão pode
       chegar fisicamente sem nunca ter sido cadastrado, e a Portaria
       precisava registrar a presença dele mesmo assim, com a Logística
       corrigindo o cadastro depois.

       O gestor decidiu o oposto: "só vamos aceitar placas que estejam
       cadastradas, vinculadas a uma transportadora no cadastro". A placa é
       o vínculo com a transportadora — sem cadastro, não há a quem
       atribuir o veículo, e o movimento não deve existir.

       Não é o teste que foi afrouxado para acompanhar o código: é a regra
       de negócio que mudou, por decisão de quem opera. */
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'chegada_2', placa: 'ZZZ0001', aguardandoCarga: true },
    });
    assert.equal(r.status, 422, 'a trava de frota vale para os dois caminhos');
    assert.equal(r.json.codigo, 'PLACA_FORA_DA_FROTA');

    // E não pode ter deixado carga fantasma no banco.
    const { rows } = await pool.query(
      'SELECT 1 FROM fact_viagens WHERE carga_id = $1', ['chegada_2']
    );
    assert.equal(rows.length, 0, 'placa recusada não pode gravar carga');
  });

  test('campos de negócio enviados pela Portaria são ignorados — servidor força a forma restrita', async () => {
    // Sem isto, "aguardandoCarga:true" viraria um jeito de driblar a
    // permissão e criar carga com peso/motorista/número arbitrários.
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: {
        id: 'chegada_3', placa: rows[0].placa, aguardandoCarga: true,
        numeroCarga: '99999', peso: 50000, motorista: 'Forjado',
        destino: 'Lugar Nenhum', status: 'Faturado',
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.numeroCarga, 'Aguardando Carga', 'número não pode vir do corpo');
    assert.equal(r.json.peso, 0, 'peso não pode vir do corpo');
    assert.equal(r.json.motorista, '', 'motorista não pode vir do corpo');
    assert.equal(r.json.status, 'Aguardando Embarque', 'status não pode vir do corpo');
  });

  test('Logística também pode usar este caminho', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'chegada_4', placa: rows[0].placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 201);
  });

  test('Expedição e Faturamento continuam sem poder criar carga, mesmo com aguardandoCarga:true', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    for (const setor of ['Expedição', 'Faturamento']) {
      const r = await req('/api/cargas', {
        metodo: 'POST', token: tokens[setor],
        corpo: { id: `chegada_neg_${setor}`, placa: rows[0].placa, aguardandoCarga: true },
      });
      assert.equal(r.status, 403, `${setor} não deveria conseguir`);
    }
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

  /* Bug real encontrado em produção (08/08/2026): a leitura COMPLETA tem
     LIMIT (5000 cargas, 5000 movimentações). Com o histórico ordenado do
     mais ANTIGO pro mais NOVO, um sistema em operação real eventualmente
     passa da cota — e é o dado de HOJE, o mais novo, que fica de fora,
     sobrando só lixo histórico. Depois de uma tela recarregada do zero,
     "Seguiu Viagem hoje" mostrou 0 mesmo com viagens reais no dia. A
     correção troca ASC por DESC só na leitura completa — o merge no
     terminal (fundirEstadoRemoto, data.js) não depende de ordem, então
     isto é seguro. Este teste prova a ordem, não o corte em si (inserir
     5000 linhas deixaria a suíte lenta demais). */
  test('leitura completa vem do mais NOVO pro mais ANTIGO (prioriza o LIMIT certo)', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 30 LIMIT 3');
    const criadas = [];
    for (const [i, row] of rows.entries()) {
      const r = await req('/api/cargas', {
        metodo: 'POST', token: tokens['Logística'],
        corpo: { placa: row.placa, numeroCarga: `95${i}00` },
      });
      criadas.push(r.json.id);
      await new Promise((res) => setTimeout(res, 20));
    }
    const estado = await req('/api/estado', { token: tokens['Logística'] });
    assert.equal(estado.json.completo, true);
    const posicoes = criadas.map((id) => estado.json.cargas.findIndex((c) => c.id === id));
    assert.ok(posicoes.every((p) => p !== -1), 'as 3 cargas recém-criadas aparecem na leitura completa');
    // A última criada (mais nova) tem que vir ANTES das outras duas no array.
    assert.ok(posicoes[2] < posicoes[0] && posicoes[2] < posicoes[1],
      `esperava a mais nova primeiro — posições: ${posicoes}`);
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
describe('7d. Exclusão de carga programada', () => {
  let cargaId;
  let placa;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 40 LIMIT 1');
    placa = rows[0].placa;
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa, numeroCarga: '96000' },
    });
    cargaId = r.json.id;
  });

  test('a Portaria não exclui carga programada', async () => {
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'DELETE', token: tokens['Portaria'],
    });
    assert.equal(r.status, 403);
  });

  test('a Logística exclui, e a carga some da leitura completa', async () => {
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'DELETE', token: tokens['Logística'],
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.excluida, true);

    const estado = await req('/api/estado', { token: tokens['Portaria'] });
    assert.ok(!estado.json.cargas.some((c) => c.id === cargaId),
      'carga excluída não pode aparecer no estado atual do pátio');
  });

  /* O ponto central. A leitura incremental é "o que mudou desde X" — e uma
     linha apagada de verdade não apareceria em consulta nenhuma, então o
     terminal do colega ficaria com a carga na tela até recarregar a página.
     Por isso a exclusão é marcada, não apagada. */
  test('mas APARECE na leitura incremental, marcada como excluída', async () => {
    const antes = new Date(Date.now() - 60_000).toISOString();
    const inc = await req(`/api/estado?desde=${encodeURIComponent(antes)}`, {
      token: tokens['Portaria'],
    });
    const achada = inc.json.cargas.find((c) => c.id === cargaId);
    assert.ok(achada, 'sem isto, nenhum outro terminal descobre que a carga saiu');
    assert.equal(achada.excluida, true);
  });

  /* Mesmo raciocínio da correção do POST /api/cargas (07/08/2026): checar
     permissão ANTES de saber se ainda há o que fazer transforma um reenvio
     de algo já resolvido num 403 desnecessário. Reenviar DELETE de uma
     carga JÁ excluída é reenvio (fila offline, duplo clique) — precisa
     continuar OK mesmo vindo de um setor que não teria permissão para
     excluir uma carga ainda ativa. */
  test('reenviar DELETE de uma carga JÁ excluída não é bloqueado pela trava de exclusão',
    async () => {
      const r = await req(`/api/cargas/${cargaId}`, {
        metodo: 'DELETE', token: tokens['Portaria'],
      });
      assert.equal(r.status, 200, `esperado 200 (já excluída), veio ${r.status}: ${r.texto}`);
      assert.equal(r.json.excluida, true);
    });

  test('a trilha de auditoria guarda quem excluiu', async () => {
    const { rows } = await pool.query(
      "SELECT operador_nome, setor FROM log_eventos WHERE carga_id = $1 AND acao = 'Carga programada excluída'",
      [cargaId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].setor, 'Logística');
  });

  test('excluir de novo não é erro', async () => {
    // A fila offline reenvia o que não confirmou, e duas pessoas podem
    // clicar em Excluir na mesma carga. Falhar aqui faria o painel insistir
    // para sempre em algo que já está feito.
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'DELETE', token: tokens['Logística'],
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.excluida, true);
  });

  /* O caminhão encostou, a Portaria registrou a chegada, e a carga não vai
     carregar. Antes disso aqui, ela ficava presa: sumia da tela de
     Programação ao sair de "Aguardando Veículo" e não havia como agir sobre
     ela em lugar nenhum — travava a fila do pátio até alguém mexer no banco. */
  test('carga que já andou é CANCELADA, com motivo', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 41 LIMIT 1');
    const criada = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '96001' },
    });
    await req(`/api/cargas/${criada.json.id}/status`, {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { status: 'Aguardando Embarque' },
    });

    // Sem motivo, não sai: "sumiu" e "cliente desmarcou" não podem virar a
    // mesma linha no histórico.
    const semMotivo = await req(`/api/cargas/${criada.json.id}`, {
      metodo: 'DELETE', token: tokens['Logística'],
    });
    assert.equal(semMotivo.status, 400);
    assert.equal(semMotivo.json.codigo, 'MOTIVO_OBRIGATORIO');

    const r = await req(`/api/cargas/${criada.json.id}`, {
      metodo: 'DELETE', token: tokens['Logística'],
      corpo: { motivo: 'Cliente desmarcou o pedido' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.excluida, true);

    const { rows: log } = await pool.query(
      "SELECT acao FROM log_eventos WHERE carga_id = $1 AND acao LIKE 'Carga cancelada%'",
      [criada.json.id]
    );
    assert.equal(log.length, 1);
    assert.match(log[0].acao, /Aguardando Embarque/);
    assert.match(log[0].acao, /Cliente desmarcou o pedido/);
  });

  /* A permissão é conferida ANTES do status. Sem isso, a Portaria
     descobriria pela mensagem de erro que a carga existe e em que etapa
     está — e, pior, um dia alguém trocaria a ordem das checagens e a
     Expedição passaria a cancelar carga alheia. */
  test('setor restrito não cancela, nem carga que já andou', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 43 LIMIT 1');
    const criada = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '96003' },
    });
    await req(`/api/cargas/${criada.json.id}/status`, {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { status: 'Aguardando Embarque' },
    });
    for (const setor of ['Portaria', 'Expedição', 'Faturamento']) {
      const r = await req(`/api/cargas/${criada.json.id}`, {
        metodo: 'DELETE', token: tokens[setor],
        corpo: { motivo: 'não deveria passar' },
      });
      assert.equal(r.status, 403, `${setor} não pode cancelar carga`);
    }
    // E continua lá, intacta.
    const { rows: viva } = await pool.query(
      'SELECT excluida_em FROM fact_viagens WHERE carga_id = $1', [criada.json.id]);
    assert.equal(viva[0].excluida_em, null);
  });

  /* O limite é a saída do pátio, por padrão. Ali o caminhão passou pela
     portaria e a nota existe — apagar é apagar o que aconteceu de
     verdade. Sem a flag explícita de confirmação, a recusa é firme. */
  test('carga que já seguiu viagem NÃO sai sem confirmação explícita', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 42 LIMIT 1');
    const criada = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '96002' },
    });
    for (const status of ['Aguardando Embarque', 'Embarque Iniciado',
      'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']) {
      await req(`/api/cargas/${criada.json.id}/status`, {
        metodo: 'POST', token: tokens['Logística'], corpo: { status },
      });
    }
    const r = await req(`/api/cargas/${criada.json.id}`, {
      metodo: 'DELETE', token: tokens['Logística'],
      corpo: { motivo: 'tentativa indevida' },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'CARGA_JA_SAIU');
  });

  /* Válvula de escape pedida pelo usuário (08/08/2026): dado de teste que
     passou pelo fluxo inteiro (ex.: DJF8527) ficava preso na Torre pra
     sempre. `forcarSeguiuViagem` libera — mas só quem já tinha permissão
     de excluir (Logística/Administração), e ainda exige motivo, porque a
     carga tem histórico. */
  test('carga que já seguiu viagem SAI com forcarSeguiuViagem + motivo', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 43 LIMIT 1');
    const criada = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '96004' },
    });
    for (const status of ['Aguardando Embarque', 'Embarque Iniciado',
      'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']) {
      await req(`/api/cargas/${criada.json.id}/status`, {
        metodo: 'POST', token: tokens['Logística'], corpo: { status },
      });
    }
    const semMotivo = await req(`/api/cargas/${criada.json.id}`, {
      metodo: 'DELETE', token: tokens['Logística'],
      corpo: { forcarSeguiuViagem: true },
    });
    assert.equal(semMotivo.status, 400, 'ainda exige motivo mesmo forçando');
    assert.equal(semMotivo.json.codigo, 'MOTIVO_OBRIGATORIO');

    const r = await req(`/api/cargas/${criada.json.id}`, {
      metodo: 'DELETE', token: tokens['Logística'],
      corpo: { forcarSeguiuViagem: true, motivo: 'dado de teste, confirmado pela placa' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.excluida, true);
    const { rows: sumiu } = await pool.query(
      'SELECT excluida_em FROM fact_viagens WHERE carga_id = $1', [criada.json.id]);
    assert.ok(sumiu[0].excluida_em, 'carga foi marcada como excluída');
  });

  test('forcarSeguiuViagem continua bloqueado para setor sem permissão', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos OFFSET 44 LIMIT 1');
    const criada = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '96005' },
    });
    for (const status of ['Aguardando Embarque', 'Embarque Iniciado',
      'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']) {
      await req(`/api/cargas/${criada.json.id}/status`, {
        metodo: 'POST', token: tokens['Logística'], corpo: { status },
      });
    }
    const r = await req(`/api/cargas/${criada.json.id}`, {
      metodo: 'DELETE', token: tokens['Portaria'],
      corpo: { forcarSeguiuViagem: true, motivo: 'tentativa indevida' },
    });
    assert.equal(r.status, 403);
  });

  test('o Power BI não enxerga a carga excluída', async () => {
    const { rows } = await pool.query('SELECT "Id" FROM vw_dim_carga WHERE "Id" = $1', [cargaId]);
    assert.equal(rows.length, 0);
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

  /* A recusa precisa ser LEGÍVEL, não opaca.

     Quando o CORS só falha, o navegador esconde o motivo e o painel mostra
     algo indistinguível de Wi-Fi caído — foi o que deixou um operador sem
     entrar, com o servidor no ar, porque tinha aberto o painel em www. */
  test('a recusa por origem diz qual endereço foi barrado e qual é o certo', async () => {
    const r = await req('/auth/login', {
      metodo: 'POST',
      cabecalhos: { origin: 'https://www.endereco-errado.com.br' },
      corpo: { email: 'ana@teste.local', senha: SENHA },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'ORIGEM_NAO_AUTORIZADA');
    assert.match(r.json.erro, /www\.endereco-errado\.com\.br/);
    assert.match(r.json.erro, /embarquesuinco\.com\.br/);
    // Sem este cabeçalho o navegador descarta o corpo e o operador continua
    // sem saber de nada — a mensagem existiria só no log.
    assert.equal(r.headers.get('access-control-allow-origin'),
                 'https://www.endereco-errado.com.br');
    // Credencial NÃO é liberada: a origem barrada pode ler o erro, nunca
    // enviar cookie de sessão.
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  });

  test('origem barrada não chega na rota — nenhuma senha é conferida', async () => {
    const r = await req('/auth/login', {
      metodo: 'POST',
      cabecalhos: { origin: 'https://site-do-atacante.com' },
      corpo: { email: 'ana@teste.local', senha: 'senha-errada-de-proposito' },
    });
    // 403 de origem, não 401 de credencial: a requisição parou antes.
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'ORIGEM_NAO_AUTORIZADA');
  });

  test('preflight de origem barrada passa, para o 403 poder ser lido', async () => {
    const r = await req('/auth/login', {
      metodo: 'OPTIONS',
      cabecalhos: {
        origin: 'https://www.endereco-errado.com.br',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'),
                 'https://www.endereco-errado.com.br');
  });

  test('o painel abre pelo endereço com www', async () => {
    const r = await req('/health', {
      cabecalhos: { origin: 'https://www.embarquesuinco.com.br' },
    });
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

  test('/health devolve os limites de requisição em vigor', async () => {
    const r = await req('/health');
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.limites.porJanela, 'number');
    assert.equal(typeof r.json.limites.loginPorJanela, 'number');
    assert.equal(typeof r.json.limites.janelaMs, 'number');
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

/* ------------------------------------------------------------------
   9. Cadastros — Frota e Rotas
   ---------------------------------------------------------------------
   Achado da auditoria "superpowers": rotas/cadastros.js tinha ZERO
   cobertura — os oito blocos acima passam por autenticação, máquina de
   estados, concorrência, export do BI, mas nenhum bate em /api/frota nem
   /api/rotas. Placas e códigos usados aqui são prefixados para não
   colidir com o que os outros blocos já inseriram (o before() global só
   limpa log_eventos/fact_statusfrota/fact_viagens/operadores — NÃO
   dim_veiculos nem dim_rotas). ------------------------------------ */
describe('9. Cadastros — Frota e Rotas', () => {
  const PLACA_TESTE = 'TST9001';
  const CODIGO_TESTE = 'ZZ901';

  after(async () => {
    // Estas duas tabelas não são limpas pelo before() global — sem isto,
    // rodar a suíte de novo colidiria com o próprio ON CONFLICT dos testes.
    await pool.query('DELETE FROM dim_veiculos WHERE placa = $1', [PLACA_TESTE]);
    await pool.query('DELETE FROM dim_rotas WHERE codigo = $1', [CODIGO_TESTE]);
  });

  test('GET /api/frota sem token → 401', async () => {
    const r = await req('/api/frota');
    assert.equal(r.status, 401);
  });

  test('GET /api/frota com token → 200, formato da linha', async () => {
    const r = await req('/api/frota', { token: tokens['Logística'] });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
    assert.ok(r.json.length > 0);
    const linha = r.json[0];
    for (const campo of ['placa', 'transportadora', 'tipoVeiculo', 'capacidadeKg',
      'uf', 'precisaRevisao', 'atualizadoEm']) {
      assert.ok(campo in linha, `faltou o campo ${campo}`);
    }
  });

  test('POST /api/frota sem token → 401', async () => {
    const r = await req('/api/frota', { metodo: 'POST', corpo: { placa: PLACA_TESTE } });
    assert.equal(r.status, 401);
  });

  test('POST /api/frota por setor sem permissão → 403', async () => {
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { placa: PLACA_TESTE, transportadora: 'Teste Transp' },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'SETOR_SEM_PERMISSAO');
  });

  test('POST /api/frota por Logística sem placa → 400', async () => {
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Logística'], corpo: { transportadora: 'Teste' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'PLACA_FALTANDO');
  });

  test('POST /api/frota por Logística, placa nova → 201, grava em dim_veiculos', async () => {
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: PLACA_TESTE, transportadora: 'Teste Transportes', tipoVeiculo: 'Carreta', uf: 'MG' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.placa, PLACA_TESTE);
    const { rows } = await pool.query('SELECT * FROM dim_veiculos WHERE placa = $1', [PLACA_TESTE]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].transportadora, 'Teste Transportes');
  });

  test('POST /api/frota, placa existente (ON CONFLICT) → atualiza no lugar, sem duplicar', async () => {
    const antes = await pool.query('SELECT atualizado_em FROM dim_veiculos WHERE placa = $1', [PLACA_TESTE]);
    await new Promise((r) => setTimeout(r, 20));   // garante atualizado_em diferente
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: PLACA_TESTE, transportadora: 'Nova Transportadora', tipoVeiculo: 'Bitrem' },
    });
    assert.equal(r.status, 201);
    const { rows } = await pool.query('SELECT * FROM dim_veiculos WHERE placa = $1', [PLACA_TESTE]);
    assert.equal(rows.length, 1, 'não pode duplicar a linha');
    assert.equal(rows[0].transportadora, 'Nova Transportadora');
    assert.ok(new Date(rows[0].atualizado_em) > new Date(antes.rows[0].atualizado_em));
  });

  test('POST /api/frota por Administração → 201', async () => {
    let tokenAdmin = tokens['Administração'];
    if (!tokenAdmin) {
      const login = await req('/auth/login', {
        metodo: 'POST', corpo: { email: 'chefe@teste.local', senha: SENHA },
      });
      tokenAdmin = login.json?.token;
    }
    if (!tokenAdmin) return;   // bloco 7b pode não ter rodado nesta execução isolada
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokenAdmin,
      corpo: { placa: PLACA_TESTE, transportadora: 'Via Administração' },
    });
    assert.equal(r.status, 201);
  });

  test('POST /api/frota com capacidadeKg:0 preserva o zero — não vira null', async () => {
    /* Achado da auditoria: `Number(req.body?.capacidadeKg) || null` em
       rotas/cadastros.js colapsa um 0 legítimo para null, porque
       Number(0) é falsy. Este teste escreve a EXPECTATIVA primeiro — TDD
       contra o bug, não contra um design ainda a decidir. */
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: PLACA_TESTE, transportadora: 'Teste', capacidadeKg: 0 },
    });
    assert.equal(r.status, 201);
    const { rows } = await pool.query('SELECT capacidade_kg FROM dim_veiculos WHERE placa = $1', [PLACA_TESTE]);
    assert.equal(rows[0].capacidade_kg, 0, 'capacidadeKg:0 é dado real — carreta sem capacidade cadastrada é null, não zero');
  });

  test('GET /api/rotas sem token → 401', async () => {
    const r = await req('/api/rotas');
    assert.equal(r.status, 401);
  });

  test('GET /api/rotas com token → 200', async () => {
    const r = await req('/api/rotas', { token: tokens['Logística'] });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
  });

  test('POST /api/rotas sem token → 401', async () => {
    const r = await req('/api/rotas', { metodo: 'POST', corpo: { codigo: CODIGO_TESTE } });
    assert.equal(r.status, 401);
  });

  test('POST /api/rotas por setor sem permissão → 403', async () => {
    const r = await req('/api/rotas', {
      metodo: 'POST', token: tokens['Expedição'], corpo: { codigo: CODIGO_TESTE, nome: 'Teste' },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'SETOR_SEM_PERMISSAO');
  });

  test('POST /api/rotas sem codigo → 400', async () => {
    const r = await req('/api/rotas', {
      metodo: 'POST', token: tokens['Logística'], corpo: { nome: 'Sem código' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'CODIGO_FALTANDO');
  });

  test('POST /api/rotas, código novo → 201, grava em dim_rotas', async () => {
    const r = await req('/api/rotas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { codigo: CODIGO_TESTE, nome: 'Rota de Teste', operador: 'Teste Log' },
    });
    assert.equal(r.status, 201);
    const { rows } = await pool.query('SELECT * FROM dim_rotas WHERE codigo = $1', [CODIGO_TESTE]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nome, 'Rota de Teste');
  });

  test('POST /api/rotas, código existente (ON CONFLICT) → atualiza no lugar', async () => {
    const r = await req('/api/rotas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { codigo: CODIGO_TESTE, nome: 'Nome Atualizado', detalhe: 'Detalhe novo', operador: 'Outro' },
    });
    assert.equal(r.status, 201);
    const { rows } = await pool.query('SELECT * FROM dim_rotas WHERE codigo = $1', [CODIGO_TESTE]);
    assert.equal(rows.length, 1, 'não pode duplicar a linha');
    assert.equal(rows[0].nome, 'Nome Atualizado');
    assert.equal(rows[0].detalhe, 'Detalhe novo');
  });
});

/* ------------------------------------------------------------------ */
describe('10. Limite geral por operador, não por IP compartilhado', () => {
  // Achado no teste de carga de 30 usuários (08/08/2026): o pátio inteiro
  // sai do mesmo IP (NAT do escritório). Contando por IP, 30 pessoas
  // DIFERENTES dividiam um único orçamento — a 30ª pessoa a agir num
  // minuto tomava 429 mesmo com tudo saudável. A chave do limite geral
  // precisa ser o operador autenticado, não o endereço de rede.

  test('chaveDoLimiteGeral: token válido vira chave por operador', () => {
    const token = jwtAssinar({ sub: 'op-123', nome: 'Teste', setor: 'Logística' });
    const chave = chaveDoLimiteGeral({ headers: { authorization: `Bearer ${token}` }, ip: '10.0.0.5' });
    assert.equal(chave, 'op:op-123');
  });

  test('chaveDoLimiteGeral: sem token, ou token inválido, cai para o IP', () => {
    assert.equal(chaveDoLimiteGeral({ headers: {}, ip: '10.0.0.5' }), '10.0.0.5');
    assert.equal(
      chaveDoLimiteGeral({ headers: { authorization: 'Bearer lixo-nao-e-jwt' }, ip: '10.0.0.5' }),
      '10.0.0.5'
    );
  });

  test('dois operadores no MESMO IP não dividem o orçamento (integração, limite baixo)', async () => {
    // Servidor isolado com limite de 3/janela, só para este teste — não
    // interfere no `servidor` principal (o valor é lido na criação do app,
    // não ao vivo a cada requisição).
    const original = config.limites.porJanela;
    config.limites.porJanela = 3;
    let s, b;
    try {
      s = criarServidor();
      await new Promise((r) => s.listen(0, '127.0.0.1', r));
      b = `http://127.0.0.1:${s.address().port}`;

      const chamar = (token) => fetch(`${b}/api/estado`, { headers: { authorization: `Bearer ${token}` } });

      // Operador A esgota o próprio limite de 3.
      const respostasA = [];
      for (let i = 0; i < 4; i++) respostasA.push((await chamar(tokens['Logística'])).status);
      assert.deepEqual(respostasA, [200, 200, 200, 429], 'A deveria ser barrado na 4ª');

      // Operador B, MESMO IP (127.0.0.1, mesmo processo de teste), ainda
      // tem seu próprio orçamento intacto — não herdou o bloqueio de A.
      const respostaB = await chamar(tokens['Portaria']);
      assert.equal(respostaB.status, 200, 'B não pode ser afetado pelo limite de A');
    } finally {
      config.limites.porJanela = original;
      if (s) await new Promise((r) => s.close(r));
    }
  });
});

/* ------------------------------------------------------------------
   11. Setor Comercial — só leitura
   ---------------------------------------------------------------------
   Pedido do usuário (08/08/2026): visão de tudo que Logística/Administração
   vê (torre, histórico, relatórios), sem poder alterar nada. O setor foi
   adicionado a SETORES sem entrar em NENHUMA função de permissão de
   escrita (podeCriarCarga, podeRegistrarSaida, exigirSetor(...) etc.) —
   allowlist por padrão nega quem não está na lista. Esta bateria prova
   que a leitura funciona e que cada rota de escrita recusa, uma por uma —
   não é suposição sobre como allowlist deveria se comportar, é o servidor
   respondendo de verdade. ------------------------------------------ */
describe('11. Setor Comercial — só leitura', () => {
  let tokenComercial;

  before(async () => {
    const hash = await bcrypt.hash(SENHA, 4);
    await pool.query(
      `INSERT INTO operadores (email, nome, setor, senha_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET setor = EXCLUDED.setor, ativo = TRUE`,
      ['comercial@teste.local', 'Comercial Teste', 'Comercial', hash]
    );
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'comercial@teste.local', senha: SENHA },
    });
    assert.equal(r.status, 200, r.texto);
    tokenComercial = r.json.token;
  });

  test('loga e o setor vem do servidor como Comercial', async () => {
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'comercial@teste.local', senha: SENHA },
    });
    assert.equal(r.json.operador.setor, 'Comercial');
  });

  test('lê /api/estado normalmente — mesma leitura de qualquer setor autenticado', async () => {
    const r = await req('/api/estado', { token: tokenComercial });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.cargas));
  });

  test('NÃO cria carga', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokenComercial,
      corpo: { placa: rows[0].placa, numeroCarga: '90090' },
    });
    assert.equal(r.status, 403);
  });

  test('NÃO registra chegada sem programação', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1 OFFSET 2');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokenComercial,
      corpo: { placa: rows[0].placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 403);
  });

  test('NÃO exclui carga', async () => {
    const criar = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: (await pool.query('SELECT placa FROM dim_veiculos LIMIT 1 OFFSET 3')).rows[0].placa, numeroCarga: '90091' },
    });
    assert.equal(criar.status, 201, criar.texto);
    const r = await req(`/api/cargas/${criar.json.id}`, { metodo: 'DELETE', token: tokenComercial });
    assert.equal(r.status, 403);
  });

  test('NÃO muda status de carga', async () => {
    /* Achado nesta sessão: pegava uma linha QUALQUER de fact_viagens
       (LIMIT 1 sem ORDER BY não garante qual — Postgres pode devolver
       linhas diferentes entre execuções). validarTransicao() checa a
       transição de fluxo ANTES da permissão de setor — se a linha
       sorteada já estivesse além de "Aguardando Embarque" (sem transição
       de volta), a rota respondia 409 (fluxo inválido) em vez de 403
       (setor sem permissão), e o teste falhava de forma intermitente,
       sem nenhuma mudança de código real. Cria a própria carga aqui,
       igual ao teste "NÃO exclui carga" logo acima — status nasce em
       "Aguardando Veículo", e esse SEMPRE tem transição válida para
       "Aguardando Embarque", então é a permissão do Comercial que barra,
       de forma determinística. */
    const criar = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: (await pool.query('SELECT placa FROM dim_veiculos LIMIT 1 OFFSET 4')).rows[0].placa, numeroCarga: '90092' },
    });
    assert.equal(criar.status, 201, criar.texto);
    const r = await req(`/api/cargas/${criar.json.id}/status`, {
      metodo: 'POST', token: tokenComercial, corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 403);
  });

  test('NÃO cadastra frota', async () => {
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokenComercial, corpo: { placa: 'COM1234' },
    });
    assert.equal(r.status, 403);
  });

  test('NÃO cadastra rota', async () => {
    const r = await req('/api/rotas', {
      metodo: 'POST', token: tokenComercial, corpo: { codigo: '999', nome: 'Teste' },
    });
    assert.equal(r.status, 403);
  });

  test('NÃO gerencia operadores', async () => {
    const r = await req('/api/operadores', { token: tokenComercial });
    assert.equal(r.status, 403);
  });
});

describe('12. Fechamento de Programação — senha mestre libera com carga em aberto', () => {
  before(async () => {
    // Este bloco roda depois de 11 outras suítes, que deixam cargas suas
    // abertas em fact_viagens (o before() global só limpa uma vez, no
    // início do arquivo inteiro). Pra testar "fecha quando o pátio está
    // limpo" de forma determinística, força esse estado aqui — não é
    // fluxo de negócio sendo testado, é só a base limpa que este bloco
    // precisa pra não depender da ordem/conteúdo das suítes anteriores.
    await pool.query("UPDATE fact_viagens SET status_atual = 'Seguiu Viagem' WHERE status_atual <> 'Seguiu Viagem'");
  });

  test('sem token → 401', async () => {
    const r = await req('/api/programacao/fechar', { metodo: 'POST' });
    assert.equal(r.status, 401);
  });

  test('Portaria não pode fechar', async () => {
    const r = await req('/api/programacao/fechar', { metodo: 'POST', token: tokens['Portaria'] });
    assert.equal(r.status, 403);
  });

  test('Expedição não pode fechar', async () => {
    const r = await req('/api/programacao/fechar', { metodo: 'POST', token: tokens['Expedição'] });
    assert.equal(r.status, 403);
  });

  /* Este bloco mudou de significado em 11/08/2026, e a mudança é o
     ponto: antes o fechamento era BLOQUEADO havendo carga em andamento;
     agora ele é LIBERADO por senha mestre, e o ciclo fica marcado como
     forçado. O usuário reverteu a decisão de propósito ("precisamos ter
     esse controle e tomada de decisao em nossas maos"). A garantia que
     resta — e que estes testes fixam — é que fechar NÃO apaga nem
     esconde carga: ela continua em fact_viagens, em aberto. */
  test('sem senha, carga em andamento pede a senha (não fecha em silêncio)', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1 OFFSET 5');
    const criar = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '90200' },
    });
    assert.equal(criar.status, 201, criar.texto);

    const r = await req('/api/programacao/fechar', { metodo: 'POST', token: tokens['Logística'] });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'SENHA_NECESSARIA');
    assert.ok(r.json.cargas.some((c) => c.numeroCarga === '90200'), JSON.stringify(r.json.cargas));
  });

  test('senha errada não fecha', async () => {
    const r = await req('/api/programacao/fechar', {
      metodo: 'POST', token: tokens['Logística'], corpo: { senha: 'chute-errado' },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'SENHA_INCORRETA');
  });

  test('senha certa FECHA com carga em aberto, marca como forçado e NÃO apaga a carga', async () => {
    const r = await req('/api/programacao/fechar', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { senha: config.senhaFechamento },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.forcado ?? r.json.forcado, true);
    assert.ok(r.json.emAberto > 0, 'devia relatar quantas ficaram em aberto');

    // A garantia que substituiu o bloqueio: a carga continua existindo e
    // continua EM ABERTO — o caminhão não sumiu da tela de ninguém.
    const ainda = await pool.query(
      "SELECT status_atual, programacao_id FROM fact_viagens WHERE numero_carga = '90200'"
    );
    assert.equal(ainda.rows.length, 1, 'a carga sumiu do banco ao fechar — isso nunca pode acontecer');
    assert.notEqual(ainda.rows[0].status_atual, 'Seguiu Viagem');

    // E ficou ligada à programação ARQUIVADA, não à nova.
    assert.equal(ainda.rows[0].programacao_id, r.json.programacaoFechada);

    const fechada = await pool.query(
      'SELECT forcado, cargas_em_aberto FROM programacoes WHERE programacao_id = $1',
      [r.json.programacaoFechada]
    );
    assert.equal(fechada.rows[0].forcado, true);
    assert.ok(fechada.rows[0].cargas_em_aberto > 0);

    // limpa pro próximo teste
    const { rows: cid } = await pool.query("SELECT carga_id FROM fact_viagens WHERE numero_carga = '90200'");
    for (const status of ['Aguardando Embarque', 'Embarque Iniciado', 'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']) {
      await req(`/api/cargas/${cid[0].carga_id}/status`, {
        metodo: 'POST', token: tokens['Logística'], corpo: { status },
      });
    }
  });

  test('GET /api/programacoes lista o histórico, com o ciclo forçado marcado', async () => {
    const r = await req('/api/programacoes', { token: tokens['Logística'] });
    assert.equal(r.status, 200, r.texto);
    assert.ok(Array.isArray(r.json));
    assert.ok(r.json.some((p) => p.forcado), 'nenhum ciclo forçado no histórico');
    assert.ok(r.json.some((p) => p.aberta), 'devia existir um ciclo aberto agora');
  });

  test('Logística: fecha quando o pátio está limpo, registra no log, avisa quem foi', async () => {
    const abertas = await pool.query("SELECT 1 FROM fact_viagens WHERE status_atual <> 'Seguiu Viagem'");
    assert.equal(abertas.rows.length, 0, 'pré-condição: pátio devia estar limpo pelo teste anterior');

    const r = await req('/api/programacao/fechar', { metodo: 'POST', token: tokens['Logística'] });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.operador, 'Ana');
    assert.ok(r.json.quando);

    const log = await pool.query(
      "SELECT * FROM log_eventos WHERE acao = 'Fechamento de Programação' ORDER BY data_evento DESC LIMIT 1"
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].operador_nome, 'Ana');
    assert.equal(log.rows[0].setor, 'Logística');
  });

  test('Administração também pode fechar (exigirSetor sempre libera Administração)', async () => {
    // tokens['Administração'] não é global (ver o mesmo padrão defensivo
    // em "POST /api/frota por Administração → 201", bloco 7c) — relogá
    // com a conta que o bloco 7b criou.
    let tokenAdmin = tokens['Administração'];
    if (!tokenAdmin) {
      const login = await req('/auth/login', {
        metodo: 'POST', corpo: { email: 'chefe@teste.local', senha: SENHA },
      });
      tokenAdmin = login.json?.token;
    }
    if (!tokenAdmin) return;   // bloco 7b pode não ter rodado nesta execução isolada
    const r = await req('/api/programacao/fechar', { metodo: 'POST', token: tokenAdmin });
    assert.equal(r.status, 200, r.texto);
  });
});

/* ------------------------------------------------------------------ */
describe('13. Relatório em PDF gerado pelo SERVIDOR (A4 paisagem sempre)', () => {
  /* Existe porque o PDF saía com tamanho de página diferente conforme o
     aparelho do operador — provado com PDFs reais medidos byte a byte:
     sem o motor de impressão respeitar `@page{size:A4}`, o mesmo
     relatório sai em Carta americana (279×216mm) em vez de A4
     (297×210mm). Pedido do usuário (09/08/2026): "eu quero que saia no
     modo paisagem, e saiam iguais os relatorios que forem exportados
     tanto no ios ou android ou desktop".

     O que estes testes provam é justamente o que o `window.print()` NÃO
     conseguia garantir: o tamanho da página vem do servidor, não do
     aparelho de quem clicou. */

  const HTML = '<div class="print-page"><h1>Relatório de teste</h1><p>ABC1D23</p></div>';
  const CSS = '@page{size:A4 landscape;margin:5mm} body{font-family:sans-serif}';

  test('sem token → 401', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', corpo: { html: HTML, css: CSS },
    });
    assert.equal(r.status, 401);
  });

  test('sem html → 400', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Logística'], corpo: { css: CSS },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'HTML_FALTANDO');
  });

  test('sem css → 400', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Logística'], corpo: { html: HTML },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'CSS_FALTANDO');
  });

  test('conteúdo absurdamente grande → 413 (não derruba o servidor gerando)', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { html: 'x'.repeat(3_000_001), css: CSS },
    });
    assert.equal(r.status, 413);
    assert.equal(r.json.codigo, 'CONTEUDO_GRANDE_DEMAIS');
  });

  test('qualquer setor logado consegue gerar (relatório é leitura, não muda estado)', async () => {
    const r = await fetch(base + '/api/relatorios/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens['Portaria']}` },
      body: JSON.stringify({ html: HTML, css: CSS }),
    });
    assert.equal(r.status, 200, await r.text());
  });

  test('devolve PDF de verdade, em A4 PAISAGEM — medido nos bytes, não no CSS', async () => {
    const r = await fetch(base + '/api/relatorios/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens['Logística']}` },
      body: JSON.stringify({ html: HTML, css: CSS, nomeArquivo: 'Teste' }),
    });
    // O corpo só pode ser lido UMA vez: ler aqui, antes de qualquer
    // assert que pudesse consumi-lo na mensagem de erro.
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(r.status, 200, bytes.toString('utf8').slice(0, 300));
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition') || '', /filename="Teste\.pdf"/);

    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'não começa com a assinatura de PDF');

    /* Mede a página direto do MediaBox do PDF. É a única prova real de
       tamanho: qualquer coisa medida no CSS/DOM só diria o que foi
       PEDIDO, e o bug original era exatamente o pedido ser ignorado.
       A4 paisagem = 841,89 × 595,28 pt. */
    const texto = bytes.toString('latin1');
    const m = texto.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    assert.ok(m, 'não achei MediaBox no PDF gerado');
    const larguraPt = parseFloat(m[1]);
    const alturaPt = parseFloat(m[2]);
    assert.ok(Math.abs(larguraPt - 841.89) < 2, `largura ${larguraPt}pt (esperava 841,89 = A4 deitado)`);
    assert.ok(Math.abs(alturaPt - 595.28) < 2, `altura ${alturaPt}pt (esperava 595,28 = A4 deitado)`);
    assert.ok(larguraPt > alturaPt, 'PDF não saiu em paisagem');
  });

  test('orientacao:"retrato" muda a folha — e continua sendo A4 de verdade', async () => {
    const r = await fetch(base + '/api/relatorios/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens['Logística']}` },
      body: JSON.stringify({ html: HTML, css: CSS, orientacao: 'retrato' }),
    });
    assert.equal(r.status, 200);
    const texto = Buffer.from(await r.arrayBuffer()).toString('latin1');
    const m = texto.match(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    assert.ok(m);
    assert.ok(parseFloat(m[1]) < parseFloat(m[2]), 'pedi retrato e veio deitado');
  });

  test('nome de arquivo com acento/barra não vira caminho nem quebra o cabeçalho', async () => {
    const r = await fetch(base + '/api/relatorios/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens['Logística']}` },
      body: JSON.stringify({ html: HTML, css: CSS, nomeArquivo: '../../etc/Relatório Operacional' }),
    });
    assert.equal(r.status, 200);
    const disp = r.headers.get('content-disposition') || '';
    assert.ok(!disp.includes('..'), disp);
    assert.ok(!disp.includes('/'), disp);
    assert.match(disp, /filename="etc-Relatorio-Operacional\.pdf"/);
  });
});

/* ------------------------------------------------------------------ */
describe('14. Motorista habitual da placa (dim_veiculos.motorista)', () => {
  /* Pedido do usuário (11/08/2026): "adicionar campo motorista ao
     cadastro de placas" + preencher sozinho ao programar, do mesmo jeito
     que a transportadora já faz. */
  const PLACA = 'MOT9X88';

  after(async () => {
    await pool.query('DELETE FROM dim_veiculos WHERE placa = $1', [PLACA]);
  });

  test('POST /api/frota grava o motorista e o GET devolve', async () => {
    const criar = await req('/api/frota', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: PLACA, transportadora: 'Transp X', tipoVeiculo: 'Truck', motorista: 'João da Silva' },
    });
    assert.equal(criar.status, 201, criar.texto);
    assert.equal(criar.json.motorista, 'João da Silva');

    const lista = await req('/api/frota', { token: tokens['Logística'] });
    const v = lista.json.find((x) => x.placa === PLACA);
    assert.ok(v, 'placa não voltou no GET');
    assert.equal(v.motorista, 'João da Silva');
  });

  test('sem motorista informado a placa continua válida (campo é opcional)', async () => {
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: PLACA, transportadora: 'Transp X', tipoVeiculo: 'Truck' },
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.motorista, '');
  });

  test('capacidade e UF sobrevivem ao upsert (não são apagadas por omissão no painel)', async () => {
    /* Bug real achado em 11/08/2026: o painel só enviava placa,
       transportadora e tipoVeiculo, e o ON CONFLICT zerava capacidade_kg
       e uf a cada edição. Este teste fixa o contrato do lado do servidor:
       mandando os campos, eles têm que ficar. */
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: {
        placa: PLACA, transportadora: 'Transp X', tipoVeiculo: 'Carreta',
        capacidadeKg: 27000, uf: 'MG', motorista: 'Maria Souza',
      },
    });
    assert.equal(r.status, 201, r.texto);

    const lista = await req('/api/frota', { token: tokens['Logística'] });
    const v = lista.json.find((x) => x.placa === PLACA);
    assert.equal(v.capacidadeKg, 27000);
    assert.equal(v.uf, 'MG');
    assert.equal(v.motorista, 'Maria Souza');
  });

  test('Portaria não cadastra placa (permissão continua valendo com o campo novo)', async () => {
    const r = await req('/api/frota', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { placa: 'MOT0X00', motorista: 'Quem Quer Que Seja' },
    });
    assert.equal(r.status, 403);
  });
});

/* ------------------------------------------------------------------ */
describe('15. Data de programação é gravável uma vez só', () => {
  /* Achado de produção (14/08/2026): depois de reiniciar o serviço, 109
     cargas apareceram com `atualizado_em` nos mesmos dois instantes — eram
     os painéis reconectando e reenviando o que tinham em memória.

     Como cada painel reenvia a carga inteira, um terminal com cópia velha
     mandava a data de programação antiga de volta e desfazia a data correta
     gravada por quem lançou a carga. O relatório voltava a errar sozinho.

     Por isso a coluna é COALESCE e não atribuição: quem lança define, eco
     de sincronia não move. */
  let idCarga;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    idCarga = `prog_em_${Date.now()}`;
    // Nasce como chegada sem programação: sem data de programação ainda.
    await pool.query(
      `INSERT INTO fact_viagens (carga_id, numero_carga, placa, aguardando_carga,
                                 status_atual, programado_em)
       VALUES ($1,'Aguardando Carga',$2,TRUE,'Aguardando Embarque',NULL)`,
      [idCarga, rows[0].placa]
    );
  });

  after(async () => {
    await pool.query('DELETE FROM fact_viagens WHERE carga_id = $1', [idCarga]);
  });

  test('a primeira gravação define a data', async () => {
    const quando = '2026-08-14T18:30:00.000Z';
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { numeroCarga: '900777', aguardandoCarga: false, programadoEm: quando },
    });
    assert.equal(r.status, 200);
    const { rows } = await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', [idCarga]
    );
    assert.equal(new Date(rows[0].programado_em).toISOString(), quando);
  });

  test('eco de sincronia NÃO move a data já definida', async () => {
    // É exatamente o que o painel de um colega faz ao reconectar: reenvia a
    // carga com a data que ele tinha — no caso, a da chegada.
    const dataDaChegada = '2026-08-13T10:00:00.000Z';
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { observacoes: 'eco de sincronia', programadoEm: dataDaChegada },
    });
    assert.equal(r.status, 200);
    const { rows } = await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', [idCarga]
    );
    assert.equal(
      new Date(rows[0].programado_em).toISOString(), '2026-08-14T18:30:00.000Z',
      'a data de quem lançou a carga não pode ser desfeita por sincronização'
    );
  });
});

/* ------------------------------------------------------------------ */
describe('16. Observação não é apagada por eco de sincronização', () => {
  /* Mesma família do achado da data de programação (suíte 15), e mais grave:
     `observacoes` é editável por TODOS os setores, então qualquer terminal
     com cópia velha pode zerar o que a Administração acabou de escrever.

     Como o painel reenvia a carga INTEIRA a cada gravação, um colega que só
     tem a tela aberta manda `observacoes: ''` de volta e apaga o texto —
     sem ninguém ter editado nada. É o que fazia o relatório de Fretes
     continuar mostrando "a preencher" mesmo depois de preenchido.

     Regra: texto vazio não sobrescreve texto existente. Trocar por outro
     texto continua funcionando normalmente. */
  let idCarga;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    idCarga = `obs_eco_${Date.now()}`;
    await pool.query(
      `INSERT INTO fact_viagens (carga_id, numero_carga, placa, status_atual, observacoes)
       VALUES ($1,'900888',$2,'Aguardando Veículo','')`,
      [idCarga, rows[0].placa]
    );
  });

  after(async () => {
    await pool.query('DELETE FROM fact_viagens WHERE carga_id = $1', [idCarga]);
  });

  const leObs = async () => (await pool.query(
    'SELECT observacoes FROM fact_viagens WHERE carga_id = $1', [idCarga]
  )).rows[0].observacoes;

  test('a Administração escreve a observação', async () => {
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { observacoes: 'Frete R$ 2.480 — cobrar pedágio à parte' },
    });
    assert.equal(r.status, 200);
    assert.equal(await leObs(), 'Frete R$ 2.480 — cobrar pedágio à parte');
  });

  test('eco de sincronia com texto vazio NÃO apaga', async () => {
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Portaria'],
      corpo: { observacoes: '', motorista: 'Fulano' },
    });
    assert.equal(r.status, 200);
    assert.equal(
      await leObs(), 'Frete R$ 2.480 — cobrar pedágio à parte',
      'observação existente não pode ser zerada por reenvio de sincronização'
    );
  });

  test('trocar por outro texto continua funcionando', async () => {
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Faturamento'],
      corpo: { observacoes: 'Frete revisado R$ 2.600' },
    });
    assert.equal(r.status, 200);
    assert.equal(await leObs(), 'Frete revisado R$ 2.600');
  });
});

/* ------------------------------------------------------------------ */
describe('17. Lançar a carga carimba a data mesmo com painel antigo', () => {
  /* Relato do gestor (14/08/2026, terceira rodada): "tem mais duas placas
     que deram entrada ontem, fez o lançamento hoje e não está puxando".

     O painel atualizado manda `programadoEm` ao lançar a carga. Um painel em
     versão ANTIGA não manda campo nenhum — e a carga ficava sem data de
     programação, caindo na data de CHEGADA na leitura. Ou seja: sumia do
     relatório do dia em que foi lançada, exatamente como antes.

     Numa operação com seis setores e turnos diferentes não dá para exigir
     que todo terminal esteja atualizado no mesmo minuto. Sair de
     `aguardando_carga` é, por definição, o momento do lançamento — o
     servidor tem essa informação e passa a carimbar sozinho. */
  let idCarga;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos LIMIT 1');
    idCarga = `sem_prog_${Date.now()}`;
    // Chegada de ontem, ainda sem carga lançada e sem data de programação —
    // o estado em que a migration 008 deixa quem está no pátio.
    await pool.query(
      `INSERT INTO fact_viagens (carga_id, numero_carga, placa, aguardando_carga,
                                 status_atual, criado_em, programado_em)
       VALUES ($1,'Aguardando Carga',$2,TRUE,'Aguardando Embarque',
               now() - interval '1 day', NULL)`,
      [idCarga, rows[0].placa]
    );
  });

  after(async () => {
    await pool.query('DELETE FROM fact_viagens WHERE carga_id = $1', [idCarga]);
  });

  test('painel ANTIGO lança a carga sem mandar a data — servidor carimba hoje', async () => {
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      // Repare: nenhum `programadoEm` no corpo, como faz a versão antiga.
      corpo: { numeroCarga: '901234', aguardandoCarga: false, peso: 21000 },
    });
    assert.equal(r.status, 200);

    const { rows } = await pool.query(
      `SELECT programado_em::date = CURRENT_DATE AS eh_hoje,
              criado_em::date < CURRENT_DATE   AS chegou_antes
         FROM fact_viagens WHERE carga_id = $1`, [idCarga]
    );
    assert.equal(rows[0].eh_hoje, true, 'a data de programação tem que ser hoje');
    assert.equal(rows[0].chegou_antes, true, 'a data de chegada não pode ser mexida');
  });

  test('a data carimbada não é movida por sincronização posterior', async () => {
    const antes = (await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', [idCarga]
    )).rows[0].programado_em;

    await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Portaria'],
      corpo: { motorista: 'Eco de sincronia', programadoEm: '2026-08-01T00:00:00.000Z' },
    });

    const depois = (await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', [idCarga]
    )).rows[0].programado_em;
    assert.equal(String(antes), String(depois));
  });
});
