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
import { codigoDoMomento } from '../src/dominio/totp.js';
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

/* DOIS administradores, não um.

   A etapa 3 do protocolo de segurança (22/08/2026) exige que quem PEDE uma
   ação crítica não seja quem APROVA. Um administrador só na bancada de teste
   não conseguiria exercitar a regra — e uma regra que o teste não exercita é
   uma regra que ninguém garante. */
const ADMINS = [
  ['admin1@teste.local', 'Admin Um', 'Administração'],
  ['admin2@teste.local', 'Admin Dois', 'Administração'],
];
const adm = {};

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
  for (const [email, nome, setor] of [...OPERADORES, ...ADMINS]) {
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
  for (const [email, apelido] of ADMINS) {
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email, senha: SENHA } });
    assert.equal(r.status, 200, `login de ${email} falhou: ${r.texto}`);
    adm[apelido === 'Admin Um' ? 'a' : 'b'] = r.json.token;
  }
  // Compatibilidade: os blocos antigos usam tokens['Administração'].
  tokens['Administração'] = adm.a;
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { placa: rows[0].placa, numeroCarga: '90003' },
    });
    assert.equal(r.status, 403);
  });

  test('setor forjado no CORPO da requisição é ignorado', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
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
      const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1 OFFSET 1');
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
  /* Uma placa DIFERENTE por caso. Desde a trava de reentrada (bloco 20), um
     caminhão com carga em aberto não "chega" de novo — reaproveitar a mesma
     placa aqui faria o segundo caso bater naquela regra em vez de provar o
     que ele se propõe a provar. */
  let placas;
  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 4');
    placas = rows.map((r) => r.placa);
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = ANY($1)', [placas]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = ANY($1)', [placas]);
  });

  test('Portaria registra chegada sem programação — nasce em Aguardando Embarque', async () => {
    const rows = [{ placa: placas[0] }];
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
    const rows = [{ placa: placas[1] }];
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
    const rows = [{ placa: placas[2] }];
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'chegada_4', placa: rows[0].placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 201);
  });

  test('Expedição e Faturamento continuam sem poder criar carga, mesmo com aguardandoCarga:true', async () => {
    const rows = [{ placa: placas[3] }];
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 5 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 9 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 12 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 20 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 30 LIMIT 3');
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

  /* EXCLUIR CONTA — pedido do dono (25/08/2026). Até aqui só dava para
     bloquear. Bloquear continua sendo o caminho de quem saiu da empresa;
     excluir é para o cadastro errado, o teste e o duplicado. */
  test('Logística não exclui operador', async () => {
    const r = await req(`/api/operadores/${idCriado}`, {
      metodo: 'DELETE', token: tokens['Logística'],
    });
    assert.equal(r.status, 403);
  });

  test('o admin não exclui a si mesmo — não teria como desfazer', async () => {
    const eu = await req('/auth/eu', { token: tokenAdmin });
    const r = await req(`/api/operadores/${eu.json.operador.id}`, {
      metodo: 'DELETE', token: tokenAdmin,
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'NAO_PODE_EXCLUIR_A_SI');
  });

  test('excluir operador inexistente devolve 404', async () => {
    const r = await req('/api/operadores/98765432', {
      metodo: 'DELETE', token: tokenAdmin,
    });
    assert.equal(r.status, 404);
  });

  test('não dá para ficar sem nenhum administrador por este caminho', async () => {
    /* Escrevi uma trava de "último administrador" na rota e este teste
       mostrou que ela nunca dispararia: quem exclui já é administrador
       ATIVO e acabou de ser impedido de excluir a si mesmo, então sempre
       sobra ele. A trava saiu; esta checagem ficou no lugar dela, para
       registrar a garantia e pegar o dia em que alguém afrouxar a regra
       do auto-delete sem perceber a consequência. */
    const eu = await req('/auth/eu', { token: tokenAdmin });
    const r = await req(`/api/operadores/${eu.json.operador.id}`, {
      metodo: 'DELETE', token: tokenAdmin,
    });
    assert.equal(r.json.codigo, 'NAO_PODE_EXCLUIR_A_SI',
      'é esta recusa que garante que sempre reste um administrador');

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM operadores WHERE setor = 'Administração' AND ativo = TRUE");
    assert.ok(rows[0].n >= 1, 'precisa restar pelo menos um administrador ativo');
  });

  test('excluir de verdade some com a conta, e o histórico dela FICA', async () => {
    /* A razão de o DELETE ter sido considerado proibido por três dias era
       "o log referencia o operador". Não referencia: log_eventos guarda o
       nome como TEXTO copiado. Este teste é a prova disso — sem ela, a
       exclusão seria uma perda de rastreabilidade silenciosa. */
    await pool.query(
      `INSERT INTO log_eventos (evento_id, carga_id, placa, acao, setor,
                                operador_id, operador_nome, operador_verificado)
       VALUES ('log_excl_teste','carga_excl_teste','XXX0X00','registro de teste',
               'Portaria',$1,'Fulano Excluído',TRUE)`, [String(idCriado)]);

    const r = await req(`/api/operadores/${idCriado}`, {
      metodo: 'DELETE', token: tokenAdmin,
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.excluido, true);

    const { rows: conta } = await pool.query(
      'SELECT id FROM operadores WHERE id = $1', [idCriado]);
    assert.equal(conta.length, 0, 'a conta precisa ter sumido');

    const { rows: log } = await pool.query(
      "SELECT operador_nome FROM log_eventos WHERE evento_id = 'log_excl_teste'");
    assert.equal(log.length, 1, 'o histórico NÃO pode sumir junto');
    assert.equal(log[0].operador_nome, 'Fulano Excluído');

    await pool.query("DELETE FROM log_eventos WHERE evento_id = 'log_excl_teste'");
  });

  test('a sessão de quem foi excluído morre no pedido seguinte', async () => {
    const hash = await bcrypt.hash(SENHA, 4);
    const { rows } = await pool.query(
      `INSERT INTO operadores (email, nome, setor, senha_hash)
       VALUES ('vaisair@teste.local','Vai Sair','Portaria',$1)
       ON CONFLICT (email) DO UPDATE SET ativo = TRUE RETURNING id`, [hash]);
    const login = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'vaisair@teste.local', senha: SENHA },
    });
    const antes = await req('/auth/eu', { token: login.json.token });
    assert.equal(antes.status, 200, 'o token precisa valer ANTES da exclusão');

    await req(`/api/operadores/${rows[0].id}`, { metodo: 'DELETE', token: tokenAdmin });

    const depois = await req('/auth/eu', { token: login.json.token });
    assert.equal(depois.status, 401, 'conta apagada não pode continuar entrando');
  });
});

/* ------------------------------------------------------------------ */
describe('7c. Logística cobre todos os postos', () => {
  let cargaId;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 30 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 31 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 40 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 41 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 43 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 42 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 45 LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 44 LIMIT 1');
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
/* =====================================================================
   10. CINCO SENHAS ERRADAS (etapa 4, 24/08/2026)
   ---------------------------------------------------------------------
   A regra: entrada normal nunca pede código. Cinco senhas erradas dentro
   de 30 minutos mudam o tratamento da conta — quem tem segundo fator
   passa a digitar o código, quem não tem espera 15 minutos.

   O que isto pega: força bruta. O que não pega: senha vazada — quem sabe
   a senha acerta de primeira e nunca chega às cinco. A diferença está no
   cabeçalho da migração 032 e não deve se perder.
   ===================================================================== */
describe('10. Cinco senhas erradas', () => {
  const EMAIL = 'falhas@teste.local';
  const SENHA = 'senha-de-teste-123';
  let id;

  before(async () => {
    await pool.query('DELETE FROM operadores WHERE email = $1', [EMAIL]);
    const hash = await bcrypt.hash(SENHA, 10);
    const { rows } = await pool.query(
      `INSERT INTO operadores (nome, email, setor, senha_hash, ativo)
       VALUES ('Falhas', $1, 'Logística', $2, TRUE) RETURNING id`, [EMAIL, hash]);
    id = rows[0].id;
  });

  after(async () => {
    await pool.query('DELETE FROM operadores WHERE email = $1', [EMAIL]);
  });

  async function zerar() {
    await pool.query(
      `UPDATE operadores SET falhas_senha = 0, falhas_desde = NULL,
                             bloqueado_ate = NULL WHERE id = $1`, [id]);
  }

  test('entrada normal não pede nada além da senha', async () => {
    await zerar();
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 200, r.texto);
  });

  test('cada senha errada é contada', async () => {
    await zerar();
    for (let i = 0; i < 3; i += 1) {
      await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: 'errada' } });
    }
    const { rows } = await pool.query('SELECT falhas_senha FROM operadores WHERE id = $1', [id]);
    assert.equal(rows[0].falhas_senha, 3);
  });

  test('acertar a senha zera o contador', async () => {
    await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    const { rows } = await pool.query('SELECT falhas_senha FROM operadores WHERE id = $1', [id]);
    assert.equal(rows[0].falhas_senha, 0);
  });

  test('sem segundo fator, a quinta falha leva a bloqueio curto', async () => {
    await zerar();
    for (let i = 0; i < 5; i += 1) {
      await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: 'errada' } });
    }
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 429);
    assert.equal(r.json.codigo, 'BLOQUEIO_TEMPORARIO');
    assert.match(r.json.erro, /minuto/, 'a mensagem precisa dizer quanto esperar');
  });

  test('a resposta a senha errada continua idêntica à de e-mail inexistente', async () => {
    // Se o bloqueio vazasse antes da senha, um atacante descobriria quais
    // contas existem só de bater nelas até travar.
    const a = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: 'x' } });
    const b = await req('/auth/login',
      { metodo: 'POST', corpo: { email: 'ninguem@teste.local', senha: 'x' } });
    assert.equal(a.status, b.status);
    assert.equal(a.json.codigo, b.json.codigo);
  });

  test('falha VELHA não conta — a janela é de 30 minutos', async () => {
    /* Limpa também o bloqueio: o teste anterior deixou a conta travada por
       15 minutos, e é isso que se quer aqui — medir a JANELA, não o
       bloqueio, que tem teste próprio logo acima. */
    await pool.query(
      `UPDATE operadores SET falhas_senha = 9, falhas_desde = now() - interval '2 hours',
                             bloqueado_ate = NULL
        WHERE id = $1`, [id]);
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 200, 'erro de digitação de ontem não pode travar hoje: ' + r.texto);
  });
});

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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokenComercial,
      corpo: { placa: rows[0].placa, numeroCarga: '90090' },
    });
    assert.equal(r.status, 403);
  });

  test('NÃO registra chegada sem programação', async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1 OFFSET 2');
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokenComercial,
      corpo: { placa: rows[0].placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 403);
  });

  test('NÃO exclui carga', async () => {
    const criar = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: (await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1 OFFSET 3')).rows[0].placa, numeroCarga: '90091' },
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
      corpo: { placa: (await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1 OFFSET 4')).rows[0].placa, numeroCarga: '90092' },
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1 OFFSET 5');
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
      metodo: 'POST', token: tokens['Logística'], corpo: { css: CSS, tipo: 'relatorio-operacional' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'HTML_FALTANDO');
  });

  test('sem css → 400', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Logística'], corpo: { html: HTML, tipo: 'relatorio-operacional' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'CSS_FALTANDO');
  });

  test('conteúdo absurdamente grande → 413 (não derruba o servidor gerando)', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { html: 'x'.repeat(3_000_001), css: CSS, tipo: 'relatorio-operacional' },
    });
    assert.equal(r.status, 413);
    assert.equal(r.json.codigo, 'CONTEUDO_GRANDE_DEMAIS');
  });

  /* A REGRA INVERTEU EM 22/08/2026 (etapa 1 do protocolo de segurança).

     Antes: qualquer setor logado gerava qualquer relatório, com o argumento
     de que relatório é leitura e não muda estado. O argumento estava errado —
     relatório é o que ATRAVESSA A FRONTEIRA DA EMPRESA. A Portaria podia
     exportar a operação inteira em PDF, e ninguém ficava sabendo. */
  test('documento tem dono: a Portaria NÃO gera o Relatório Operacional', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { html: HTML, css: CSS, tipo: 'relatorio-operacional' },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'DOCUMENTO_SEM_PERMISSAO');
  });

  test('Expedição e Faturamento GERAM o Operacional — é a ordem de montagem deles', async () => {
    /* Correção do gestor em 22/08/2026: eu tinha fechado o Operacional na
       Logística. Errado — é o papel que a Expedição usa para saber o que
       carregar e o Faturamento para saber o que faturar. Restringir não
       protegia nada e tirava a ferramenta de quem trabalha com ela. */
    for (const setor of ['Expedição', 'Faturamento']) {
      const r = await fetch(base + '/api/relatorios/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[setor]}` },
        body: JSON.stringify({ html: HTML, css: CSS, tipo: 'relatorio-operacional' }),
      });
      assert.equal(r.status, 200, `${setor} precisa gerar o Operacional: ${await r.text()}`);
    }
  });

  test('a Portaria GERA o comprovante dela — o dono é por documento, não bloqueio geral', async () => {
    const r = await fetch(base + '/api/relatorios/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens['Portaria']}` },
      body: JSON.stringify({ html: HTML, css: CSS, tipo: 'comprovante-portaria' }),
    });
    assert.equal(r.status, 200, await r.text());
  });

  test('documento sem tipo é recusado — falha FECHADA, não aberta', async () => {
    const r = await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { html: HTML, css: CSS },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'DOCUMENTO_DESCONHECIDO');
  });

  test('a tentativa barrada fica REGISTRADA — negativa repetida é sinal, não silêncio', async () => {
    await req('/api/relatorios/pdf', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { html: HTML, css: CSS, tipo: 'relatorio-executivo' },
    });
    const { rows } = await pool.query(
      `SELECT operador_setor FROM log_leitura
        WHERE tipo = 'pdf:relatorio-executivo' AND NOT permitido
        ORDER BY leitura_id DESC LIMIT 1`
    );
    assert.ok(rows[0], 'a tentativa barrada precisa estar no registro');
    assert.equal(rows[0].operador_setor, 'Portaria');
  });

  test('a geração autorizada também fica registrada', async () => {
    const antes = (await pool.query(
      "SELECT count(*)::int n FROM log_leitura WHERE tipo = 'pdf:relatorio-operacional' AND permitido"
    )).rows[0].n;
    await fetch(base + '/api/relatorios/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens['Logística']}` },
      body: JSON.stringify({ html: HTML, css: CSS, tipo: 'relatorio-operacional', recorte: '22/08/2026' }),
    });
    const depois = (await pool.query(
      "SELECT count(*)::int n FROM log_leitura WHERE tipo = 'pdf:relatorio-operacional' AND permitido"
    )).rows[0].n;
    assert.equal(depois, antes + 1, 'toda geração de documento entra no registro');
  });

  test('devolve PDF de verdade, em A4 PAISAGEM — medido nos bytes, não no CSS', async () => {
    const r = await fetch(base + '/api/relatorios/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens['Logística']}` },
      body: JSON.stringify({ html: HTML, css: CSS, tipo: 'relatorio-operacional', nomeArquivo: 'Teste' }),
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
      body: JSON.stringify({ html: HTML, css: CSS, orientacao: 'retrato', tipo: 'relatorio-operacional' }),
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
      body: JSON.stringify({ html: HTML, css: CSS, tipo: 'relatorio-operacional', nomeArquivo: '../../etc/Relatório Operacional' }),
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
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

  test('o lançamento carimba a data de AGORA, não a que o painel mandar', async () => {
    /* ESTE TESTE INVERTEU DE PREMISSA EM 19/08/2026 — e o registro importa.

       Ele nascera afirmando que a data enviada pelo painel no lançamento era
       a que valia. Na prática o painel manda "agora" mesmo, então a
       diferença só aparecia no caso ruim: um terminal desatualizado mandando
       a data da CHEGADA. Foi assim que duas cargas lançadas hoje, em
       caminhões que entraram ontem, ficaram fora do relatório do dia — a
       programação saiu com 11 cargas e o relatório trouxe 9.

       Agora quem decide é o servidor: lançar a carga É programar a carga, e
       isso acontece no instante do clique. */
    const quando = '2026-08-14T18:30:00.000Z';   // data velha, como um painel antigo mandaria
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { numeroCarga: '900777', aguardandoCarga: false, programadoEm: quando },
    });
    assert.equal(r.status, 200);
    const { rows } = await pool.query(
      `SELECT (programado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
              (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje
         FROM fact_viagens WHERE carga_id = $1`, [idCarga]
    );
    assert.equal(String(rows[0].dia), String(rows[0].hoje),
      'a carga lançada agora conta como programação de agora');
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
    const { rows: hoje } = await pool.query(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
              ($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS dia`,
      [rows[0].programado_em]
    );
    assert.equal(String(hoje[0].dia), String(hoje[0].hoje),
      'a data de quem lançou a carga não pode ser desfeita por sincronização');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
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
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
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

/* ------------------------------------------------------------------ */
describe('18. Carga lançada não volta para "Aguardando Carga"', () => {
  /* INCIDENTE 15/08/2026: cinco cargas já lançadas — com peso, rota e
     status até "Seguiu Viagem" e "Faturado" — voltaram sozinhas para a
     lista "Aguardando Carga" e sumiram do relatório. 62 toneladas a menos
     entre duas emissões com poucas horas de diferença.

     A auditoria mostrou que nenhum fluxo do painel religa essa marca: ela
     nasce true na chegada pela Portaria e vira false no lançamento. Não
     existe "desprogramar". Quem a religava era eco de sincronização de um
     terminal com a cópia do dia da chegada — e junto voltava o peso zerado
     e a rota vazia daquela versão.

     Por isso a marca passou a andar em um sentido só. */
  let idCarga;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
    idCarga = `volta_aguard_${Date.now()}`;
    // Carga JÁ LANÇADA: tem peso, rota e não está aguardando dados.
    await pool.query(
      `INSERT INTO fact_viagens (carga_id, numero_carga, placa, aguardando_carga,
                                 status_atual, peso_kg, rota_codigo)
       VALUES ($1,'118176',$2,FALSE,'Embarque Iniciado',21700,'523')`,
      [idCarga, rows[0].placa]
    );
  });

  after(async () => {
    await pool.query('DELETE FROM fact_viagens WHERE carga_id = $1', [idCarga]);
  });

  test('eco com aguardandoCarga:true NÃO desfaz o lançamento', async () => {
    // É a cópia do dia em que o caminhão chegou: aguardando, sem peso e sem
    // rota. Exatamente o que o terminal desatualizado reenviou.
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { aguardandoCarga: true, peso: 0, rota: '' },
    });
    assert.equal(r.status, 200);

    const { rows } = await pool.query(
      'SELECT aguardando_carga FROM fact_viagens WHERE carga_id = $1', [idCarga]
    );
    assert.equal(rows[0].aguardando_carga, false,
      'carga lançada não pode voltar a "aguardando dados" por sincronização');
  });

  test('o caminho normal (lançar a carga) continua funcionando', async () => {
    const id2 = `lanca_ok_${Date.now()}`;
    const { rows: v } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
    await pool.query(
      `INSERT INTO fact_viagens (carga_id, numero_carga, placa, aguardando_carga, status_atual)
       VALUES ($1,'Aguardando Carga',$2,TRUE,'Aguardando Embarque')`,
      [id2, v[0].placa]
    );
    try {
      const r = await req(`/api/cargas/${id2}`, {
        metodo: 'PATCH', token: tokens['Logística'],
        corpo: { numeroCarga: '118999', aguardandoCarga: false, peso: 12000 },
      });
      assert.equal(r.status, 200);
      const { rows } = await pool.query(
        'SELECT aguardando_carga, peso_kg FROM fact_viagens WHERE carga_id = $1', [id2]
      );
      assert.equal(rows[0].aguardando_carga, false, 'lançar a carga precisa funcionar');
      assert.equal(Number(rows[0].peso_kg), 12000);
    } finally {
      await pool.query('DELETE FROM fact_viagens WHERE carga_id = $1', [id2]);
    }
  });
});

/* ------------------------------------------------------------------ */
describe('19. Revisões e Restaurar (Administração)', () => {
  /* Bloco B do upgrade de 16/08/2026. Na semana anterior, dado sobrescrito
     por eco de sincronização teve que ser restaurado A PARTIR DE UM PDF —
     nenhum log guardava os valores antigos completos. Agora um trigger
     (migration 009) guarda o estado anterior de toda mudança real, e a
     Administração restaura pela API, com auditoria. */
  let idCarga;
  let tokenAdmin;

  before(async () => {
    const bcrypt = (await import('bcryptjs')).default;
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

    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 1');
    idCarga = `rev_${Date.now()}`;
    await pool.query(
      `INSERT INTO fact_viagens (carga_id, numero_carga, placa, status_atual,
                                 peso_kg, rota_codigo, qtd_entregas)
       VALUES ($1,'700100',$2,'Aguardando Veículo',20500,'500',30)`,
      [idCarga, rows[0].placa]
    );
  });

  after(async () => {
    await pool.query('DELETE FROM carga_revisoes WHERE carga_id = $1', [idCarga]);
    await pool.query('DELETE FROM fact_viagens WHERE carga_id = $1', [idCarga]);
  });

  test('mudança real gera revisão com o estado ANTERIOR', async () => {
    const r = await req(`/api/cargas/${idCarga}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { peso: 999, rota: '' },
    });
    assert.equal(r.status, 200);
    const { rows } = await pool.query(
      'SELECT dados FROM carga_revisoes WHERE carga_id = $1 ORDER BY revisao_id DESC', [idCarga]
    );
    assert.ok(rows.length >= 1, 'o trigger precisa ter gravado a revisão');
    assert.equal(Number(rows[0].dados.peso_kg), 20500, 'a revisão guarda o valor ANTES da mudança');
  });

  test('eco que só toca atualizado_em NÃO gera revisão (anti-ruído)', async () => {
    const antes = (await pool.query(
      'SELECT count(*) n FROM carga_revisoes WHERE carga_id = $1', [idCarga])).rows[0].n;
    await pool.query(
      'UPDATE fact_viagens SET atualizado_em = now() WHERE carga_id = $1', [idCarga]);
    const depois = (await pool.query(
      'SELECT count(*) n FROM carga_revisoes WHERE carga_id = $1', [idCarga])).rows[0].n;
    assert.equal(antes, depois, 'eco de sincronização não pode virar revisão');
  });

  test('listar revisões é de Logística e Administração — operação fica de fora', async () => {
    // Mudou em 21/08/2026: o Controle da Programação mostra o log de
    // alterações, e o controle é de quem programa. RESTAURAR continua só
    // da Administração.
    const log = await req(`/api/cargas/${idCarga}/revisoes`, { token: tokens['Logística'] });
    assert.equal(log.status, 200);
    const portaria = await req(`/api/cargas/${idCarga}/revisoes`, { token: tokens['Portaria'] });
    assert.equal(portaria.status, 403, 'Portaria é operação, não controle');
    const semLogin = await req(`/api/cargas/${idCarga}/revisoes`);
    assert.equal(semLogin.status, 401, 'sem login continua sem nada');
  });

  test('Administração lista as revisões no formato do painel', async () => {
    const r = await req(`/api/cargas/${idCarga}/revisoes`, { token: tokenAdmin });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json) && r.json.length >= 1);
    assert.equal(r.json[0].carga.peso, 20500, 'snapshot vem traduzido para o painel');
    assert.ok(r.json[0].revisaoId > 0);
  });

  test('restaurar volta os campos e deixa trilha de auditoria', async () => {
    const lista = await req(`/api/cargas/${idCarga}/revisoes`, { token: tokenAdmin });
    const alvo = lista.json[0].revisaoId;
    const r = await req(`/api/cargas/${idCarga}/restaurar`, {
      metodo: 'POST', token: tokenAdmin,
      corpo: { revisaoId: alvo, motivo: 'peso lançado errado' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.peso, 20500, 'o peso voltou ao valor da revisão');
    assert.equal(r.json.rota, '500', 'a rota voltou');

    const { rows } = await pool.query(
      `SELECT acao FROM log_eventos WHERE carga_id = $1
        AND acao LIKE 'Carga restaurada%' ORDER BY data_evento DESC LIMIT 1`, [idCarga]);
    assert.ok(rows[0], 'restaurar sem trilha seria o mesmo buraco de antes');
  });

  test('Logística NÃO restaura', async () => {
    const r = await req(`/api/cargas/${idCarga}/restaurar`, {
      metodo: 'POST', token: tokens['Logística'], corpo: { revisaoId: 1 },
    });
    assert.equal(r.status, 403);
  });
});

/* ---------------------------------------------------------------------
   20. Caminhão com carga em aberto não "chega" de novo
   ---------------------------------------------------------------------
   Relato de produção (19/08/2026, placa real omitida): o caminhão saiu
   fisicamente, a Portaria não registrou a saída, e no dia seguinte o
   porteiro digitou a placa e clicou "Chegou". O sistema aceitou: nasceu uma
   SEGUNDA carga para a mesma placa, e o processo da primeira — que estava em
   Faturado — ficou órfão na tela de todo mundo.

   A regra, dita pelo gestor: "se o veículo tiver status em aberto, a
   portaria não pode conseguir alterar. Para ele aceitar que chegou, teria
   que ter dado saída antes."

   A trava mora no SERVIDOR porque o painel pode estar com a lista velha —
   foi exatamente o que aconteceu: no terminal da portaria a carga anterior
   não estava à vista, então a checagem local não tinha o que checar. -- */
describe('20. Chegada bloqueada enquanto a placa tem carga em aberto', () => {
  let placa;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 60 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
  });

  test('a primeira chegada passa', async () => {
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'reentrada_1', placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 201, r.texto);
  });

  test('a segunda chegada é RECUSADA enquanto a carga anterior está aberta', async () => {
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'reentrada_2', placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.json.codigo, 'PLACA_COM_CARGA_ABERTA');
    // A mensagem precisa ENSINAR a saída: travar sem dizer o que fazer
    // devolve o problema para o portão.
    assert.ok(/sa[ií]da/i.test(r.json.erro), r.json.erro);
  });

  test('vale também quando a carga aberta está em Faturado — o caso real', async () => {
    for (const [setor, status] of [['Expedição', 'Embarque Iniciado'],
      ['Expedição', 'Embarque Finalizado'], ['Faturamento', 'Faturado']]) {
      const t = await req('/api/cargas/reentrada_1/status', {
        metodo: 'POST', token: tokens[setor], corpo: { status },
      });
      assert.equal(t.status, 200, t.texto);
    }
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'reentrada_3', placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.json.codigo, 'PLACA_COM_CARGA_ABERTA');
  });

  test('depois da SAÍDA, a mesma placa chega de novo normalmente', async () => {
    const saida = await req('/api/portaria/saida', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { placa },
    });
    assert.equal(saida.status, 200, saida.texto);

    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'reentrada_4', placa, aguardandoCarga: true },
    });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.status, 'Aguardando Embarque');
  });

  test('a programação da Logística segue livre — a trava é da chegada', async () => {
    /* A Logística PODE programar a próxima carga do caminhão que ainda está
       no pátio: é assim que se monta o dia seguinte. O que não pode é a
       Portaria dizer que ele chegou sem ele ter saído. */
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'reentrada_5', placa, numeroCarga: '9911', cliente: 'CLIENTE',
               destino: 'DESTINO', peso: 1000 },
    });
    assert.equal(r.status, 201, r.texto);
  });
});

/* ---------------------------------------------------------------------
   21. Chegada não promove programação enquanto o caminhão não saiu
   ---------------------------------------------------------------------
   O bloco 20 tratou da chegada que CRIA carga. Este trata do outro caminho,
   que foi o do caso real: a placa tinha DUAS cargas — uma faturada de
   ontem, sem saída registrada, e uma programada para hoje. O "Chegou"
   promoveu a de hoje (Aguardando Veículo → Aguardando Embarque) e seguiu
   como se nada houvesse, deixando a de ontem pendurada.

   Enquanto existir carga da placa em Aguardando Embarque ou depois, o
   sistema entende que aquele caminhão ESTÁ no pátio. Registrar chegada de
   novo é dizer que ele chegou duas vezes sem nunca ter saído. ---------- */
describe('21. Chegada com carga pendente não promove a programação', () => {
  let placa;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 61 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);

    // A carga de ontem: chegou, embarcou, faturou — e ninguém deu a saída.
    await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'pend_ontem', placa, numeroCarga: '8801', cliente: 'C', destino: 'D', peso: 1000 },
    });
    for (const [setor, status] of [['Portaria', 'Aguardando Embarque'],
      ['Expedição', 'Embarque Iniciado'], ['Expedição', 'Embarque Finalizado'],
      ['Faturamento', 'Faturado']]) {
      const r = await req('/api/cargas/pend_ontem/status', {
        metodo: 'POST', token: tokens[setor], corpo: { status },
      });
      assert.equal(r.status, 200, r.texto);
    }
    /* A carga de ONTEM precisa ser de ontem de verdade (20/08/2026).

       Enquanto a trava barrava qualquer carga da placa no pátio, este bloco
       passava sem envelhecer nada. Depois que ela passou a distinguir o DIA
       — porque duas cargas do mesmo dia são rotina, e barrá-las travou a
       Portaria em produção —, deixar as duas no mesmo dia deixaria de
       reproduzir o incidente que o bloco existe para guardar. */
    await pool.query(
      "UPDATE fact_viagens SET programado_em = now() - interval '1 day' WHERE carga_id = 'pend_ontem'"
    );

    // A carga de hoje, recém-programada para a MESMA placa.
    await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'pend_hoje', placa, numeroCarga: '8802', cliente: 'C', destino: 'D', peso: 1000 },
    });
  });

  test('a Portaria NÃO consegue marcar a chegada da carga de hoje', async () => {
    const r = await req('/api/cargas/pend_hoje/status', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.json.codigo, 'PLACA_COM_CARGA_ABERTA');
    assert.ok(/sa[ií]da/i.test(r.json.erro), r.json.erro);

    const { rows } = await pool.query(
      'SELECT status_atual FROM fact_viagens WHERE carga_id = $1', ['pend_hoje']);
    assert.equal(rows[0].status_atual, 'Aguardando Veículo', 'a carga de hoje não pode ter andado');
  });

  test('depois da SAÍDA da carga pendente, a chegada de hoje passa', async () => {
    const saida = await req('/api/portaria/saida', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { placa },
    });
    assert.equal(saida.status, 200, saida.texto);

    const r = await req('/api/cargas/pend_hoje/status', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Aguardando Embarque');
  });

  test('as etapas seguintes da MESMA carga seguem livres', async () => {
    /* A trava é só da CHEGADA. Um caminhão com duas cargas no mesmo dia
       continua andando normalmente: chegou uma vez, embarca as duas. */
    const r = await req('/api/cargas/pend_hoje/status', {
      metodo: 'POST', token: tokens['Expedição'], corpo: { status: 'Embarque Iniciado' },
    });
    assert.equal(r.status, 200, r.texto);
  });
});

/* ---------------------------------------------------------------------
   22. Corrigir a data de programação (só Administração)
   ---------------------------------------------------------------------
   A data de programação é gravável uma vez só, para eco de sincronização
   não movê-la (bloco 15). Mas quando ela nasce errada — carga excluída e
   relançada no dia seguinte, caso de 19/08/2026 — alguém precisa poder
   corrigir sem abrir o banco. Com motivo, e com trilha. ---------------- */
describe('22. Correção da data de programação', () => {
  let id;
  let admin;

  before(async () => {
    // tokens['Administração'] não é global (mesmo padrão defensivo dos
    // outros blocos): rodando isolado, faz o login aqui.
    admin = tokens['Administração'];
    if (!admin) {
      const login = await req('/auth/login', {
        metodo: 'POST', corpo: { email: 'chefe@teste.local', senha: SENHA },
      });
      admin = login.json?.token;
    }
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 62 LIMIT 1');
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [rows[0].placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [rows[0].placa]);
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa: rows[0].placa, numeroCarga: '118245', cliente: 'C', destino: 'D', peso: 1000 },
    });
    id = r.json.id;
  });

  test('sem motivo, não corrige', async () => {
    const r = await req(`/api/cargas/${id}/data-programacao`, {
      metodo: 'POST', token: admin, corpo: { data: '2026-08-18' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'MOTIVO_OBRIGATORIO');
  });

  test('Logística NÃO corrige — é ação de Administração', async () => {
    const r = await req(`/api/cargas/${id}/data-programacao`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { data: '2026-08-18', motivo: 'tentativa' },
    });
    assert.equal(r.status, 403);
  });

  test('Administração move a carga para o dia certo, com trilha', async () => {
    const r = await req(`/api/cargas/${id}/data-programacao`, {
      metodo: 'POST', token: admin,
      corpo: { data: '2026-08-18', motivo: 'carga excluída e relançada — volta para o dia da programação original' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(String(r.json.programadoEm).slice(0, 10), '2026-08-18');

    const { rows } = await pool.query(
      `SELECT acao FROM log_eventos WHERE carga_id = $1
        AND acao LIKE 'Data de programação corrigida%' ORDER BY data_evento DESC LIMIT 1`, [id]);
    assert.ok(rows[0], 'correção sem trilha seria pior que o SQL na mão');
    assert.ok(rows[0].acao.includes('2026-08-18'), rows[0].acao);
    assert.ok(rows[0].acao.includes('Motivo:'), rows[0].acao);
  });

  test('a data corrigida não é desfeita por eco de sincronização', async () => {
    /* O eco reenvia a carga inteira com a data que o terminal tinha. O
       COALESCE do PATCH protege — e continua protegendo depois da
       correção, senão o problema volta pela porta dos fundos. */
    const r = await req(`/api/cargas/${id}`, {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { programadoEm: '2026-08-19T10:00:00.000Z', observacoes: 'eco' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(String(r.json.programadoEm).slice(0, 10), '2026-08-18', 'o eco não move a data corrigida');
  });
});

/* ---------------------------------------------------------------------
   23. Desfazer a exclusão de uma carga (só Administração)
   ---------------------------------------------------------------------
   19/08/2026: a Logística excluiu uma programação já faturada e relançou.
   A carga original, com o histórico de todos os setores, ficou marcada como
   excluída — e a única saída era UPDATE no banco à mão. ---------------- */
describe('23. Desfazer exclusão de carga', () => {
  let id, admin, placa;

  before(async () => {
    admin = tokens['Administração'];
    if (!admin) {
      const login = await req('/auth/login', {
        metodo: 'POST', corpo: { email: 'chefe@teste.local', senha: SENHA },
      });
      admin = login.json?.token;
    }
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 63 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa, numeroCarga: '118245', cliente: 'C', destino: 'D', peso: 3000 },
    });
    id = r.json.id;
    const del = await req(`/api/cargas/${id}`, {
      metodo: 'DELETE', token: tokens['Logística'], corpo: { motivo: 'excluída por engano' },
    });
    assert.equal(del.status, 200, del.texto);
  });

  test('sem motivo, não devolve', async () => {
    const r = await req(`/api/cargas/${id}/desfazer-exclusao`, { metodo: 'POST', token: admin });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'MOTIVO_OBRIGATORIO');
  });

  test('Logística NÃO devolve — é ação de Administração', async () => {
    const r = await req(`/api/cargas/${id}/desfazer-exclusao`, {
      metodo: 'POST', token: tokens['Logística'], corpo: { motivo: 'tentativa' },
    });
    assert.equal(r.status, 403);
  });

  test('Administração devolve a carga, com trilha, e ela reaparece na leitura', async () => {
    const r = await req(`/api/cargas/${id}/desfazer-exclusao`, {
      metodo: 'POST', token: admin,
      corpo: { motivo: 'excluída por engano — processo do dia anterior' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.excluida, false);

    const estado = await req('/api/estado', { token: admin });
    assert.ok(estado.json.cargas.some((c) => c.id === id), 'a carga voltou para o painel');

    const { rows } = await pool.query(
      `SELECT acao FROM log_eventos WHERE carga_id = $1
        AND acao LIKE 'Exclusão desfeita%' ORDER BY data_evento DESC LIMIT 1`, [id]);
    assert.ok(rows[0], 'devolver sem trilha seria o mesmo SQL na mão, só que escondido');
  });

  test('devolver uma carga que não estava excluída não quebra nada', async () => {
    const r = await req(`/api/cargas/${id}/desfazer-exclusao`, {
      metodo: 'POST', token: admin, corpo: { motivo: 'repetido' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.excluida, false);
  });
});

/* ---------------------------------------------------------------------
   24. Administração corrige (e volta) a etapa de uma carga
   ---------------------------------------------------------------------
   Pedido de 19/08/2026: "quero conseguir voltar em qualquer etapa pelo
   painel de administrador". A máquina de estados continua de sentido único
   para os setores; esta é a saída para o erro humano, com motivo e trilha
   dizendo que foi CORREÇÃO, não operação. ------------------------------ */
describe('24. Correção de etapa pela Administração', () => {
  let id, admin, placa;

  before(async () => {
    admin = tokens['Administração'];
    if (!admin) {
      const login = await req('/auth/login', {
        metodo: 'POST', corpo: { email: 'chefe@teste.local', senha: SENHA },
      });
      admin = login.json?.token;
    }
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 64 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { placa, numeroCarga: '77001', cliente: 'C', destino: 'D', peso: 1000 },
    });
    id = r.json.id;
    for (const [setor, status] of [['Portaria', 'Aguardando Embarque'],
      ['Expedição', 'Embarque Iniciado'], ['Expedição', 'Embarque Finalizado'],
      ['Faturamento', 'Faturado'], ['Portaria', 'Seguiu Viagem']]) {
      const t = await req(`/api/cargas/${id}/status`, {
        metodo: 'POST', token: tokens[setor], corpo: { status },
      });
      assert.equal(t.status, 200, t.texto);
    }
  });

  test('os setores continuam sem voltar etapa pela rota normal', async () => {
    const r = await req(`/api/cargas/${id}/status`, {
      metodo: 'POST', token: tokens['Faturamento'], corpo: { status: 'Embarque Finalizado' },
    });
    assert.equal(r.status, 409, 'sentido único segue valendo para quem opera');
  });

  test('a Logística NÃO corrige etapa — é ação de Administração', async () => {
    const r = await req(`/api/cargas/${id}/corrigir-etapa`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { status: 'Faturado', motivo: 'tentativa' },
    });
    assert.equal(r.status, 403);
  });

  test('sem motivo, não corrige', async () => {
    const r = await req(`/api/cargas/${id}/corrigir-etapa`, {
      metodo: 'POST', token: admin, corpo: { status: 'Faturado' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'MOTIVO_OBRIGATORIO');
  });

  test('a Administração VOLTA a carga de Seguiu Viagem para Faturado, com trilha', async () => {
    const r = await req(`/api/cargas/${id}/corrigir-etapa`, {
      metodo: 'POST', token: admin,
      corpo: {
        status: 'Faturado',
        motivo: 'saída registrada por engano — o caminhão ainda está no pátio',
      },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Faturado');

    const { rows } = await pool.query(
      `SELECT status_anterior, status_novo FROM fact_statusfrota
        WHERE carga_id = $1 ORDER BY data_evento DESC LIMIT 1`, [id]);
    assert.equal(rows[0].status_anterior, 'Seguiu Viagem');
    assert.equal(rows[0].status_novo, 'Faturado');

    const { rows: log } = await pool.query(
      `SELECT acao FROM log_eventos WHERE carga_id = $1
        AND acao LIKE 'Etapa REVERTIDA%' ORDER BY data_evento DESC LIMIT 1`, [id]);
    assert.ok(log[0], 'reverter sem trilha apaga a história em vez de corrigi-la');
    assert.ok(log[0].acao.includes('Motivo:'), log[0].acao);
  });

  test('etapa desconhecida é recusada, mesmo para a Administração', async () => {
    const r = await req(`/api/cargas/${id}/corrigir-etapa`, {
      metodo: 'POST', token: admin, corpo: { status: 'Inventada', motivo: 'x' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'STATUS_DESCONHECIDO');
  });

  test('depois de voltar, a carga anda de novo pelo caminho normal', async () => {
    const r = await req(`/api/cargas/${id}/status`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Seguiu Viagem' },
    });
    assert.equal(r.status, 200, r.texto);
  });
});

/* ---------------------------------------------------------------------
   25. A data de programação é a do LANÇAMENTO, nunca a da entrada
   ---------------------------------------------------------------------
   Relato de 19/08/2026: a programação do dia saiu com 11 cargas e o
   relatório mostrou 9. As duas que faltaram eram de caminhões que deram
   entrada ONTEM e tiveram a carga lançada hoje.

   A cadeia: a entrada sem programação subia com Programado_Em preenchido
   pelo painel (que derivava de criadoEm, a hora em que o caminhão entrou);
   o servidor gravava; e no lançamento o COALESCE — que existe para eco de
   sincronização não mover a data — preservava a data da ENTRADA.

   As duas regras que fecham isso, e ficam no servidor porque é o único
   lugar que independe de painel atualizado:

     1. carga aguardando carga NÃO tem data de programação, venha o que
        vier no corpo;
     2. quando ela é lançada (aguardando_carga: true → false), a data é
        gravada AGORA, por cima de qualquer valor anterior. ------------- */
describe('25. Data de programação = dia do lançamento', () => {
  let placa;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 65 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
  });

  test('entrada da Portaria nasce SEM data de programação, mesmo se o painel mandar uma', async () => {
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'prog_entrada', placa, aguardandoCarga: true,
               programadoEm: '2026-08-18T22:43:00.000Z' },
    });
    assert.equal(r.status, 201, r.texto);
    const { rows } = await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', ['prog_entrada']);
    assert.equal(rows[0].programado_em, null,
      'entrada não é programação — data inventada aqui é o que tirou carga do relatório');
  });

  test('eco de sincronização não cria data de programação numa entrada', async () => {
    const r = await req('/api/cargas/prog_entrada', {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { programadoEm: '2026-08-18T22:43:00.000Z', observacoes: 'eco' },
    });
    assert.equal(r.status, 200, r.texto);
    const { rows } = await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', ['prog_entrada']);
    assert.equal(rows[0].programado_em, null);
  });

  test('ao LANÇAR a carga, a data é a de agora — mesmo com data antiga gravada', async () => {
    // Cimenta a data de ontem na marra, como o painel antigo fazia.
    await pool.query(
      "UPDATE fact_viagens SET programado_em = now() - interval '1 day' WHERE carga_id = $1",
      ['prog_entrada']);

    const r = await req('/api/cargas/prog_entrada', {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { aguardandoCarga: false, numeroCarga: '9001', cliente: 'C',
               destino: 'D', peso: 1000 },
    });
    assert.equal(r.status, 200, r.texto);

    const { rows } = await pool.query(
      "SELECT (programado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,"
      + " (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje"
      + '  FROM fact_viagens WHERE carga_id = $1', ['prog_entrada']);
    assert.equal(String(rows[0].dia), String(rows[0].hoje),
      'a carga lançada hoje precisa contar como programação de HOJE');
  });

  test('carga já programada não tem a data movida por eco', async () => {
    /* O COALESCE existe por um motivo real (14/08/2026): terminais
       reenviando a carga inteira desfaziam a data correta. Isso continua
       protegido — o que mudou é só o momento do lançamento. */
    const antes = await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', ['prog_entrada']);
    const r = await req('/api/cargas/prog_entrada', {
      metodo: 'PATCH', token: tokens['Logística'],
      corpo: { programadoEm: '2020-01-01T10:00:00.000Z', observacoes: 'eco de terminal velho' },
    });
    assert.equal(r.status, 200, r.texto);
    const depois = await pool.query(
      'SELECT programado_em FROM fact_viagens WHERE carga_id = $1', ['prog_entrada']);
    assert.equal(String(depois.rows[0].programado_em), String(antes.rows[0].programado_em));
  });

  test('carga programada direto pela Logística nasce com a data de hoje', async () => {
    const { rows: outra } = await pool.query(
      'SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 66 LIMIT 1');
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [outra[0].placa]);
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'prog_direta', placa: outra[0].placa, numeroCarga: '9002',
               cliente: 'C', destino: 'D', peso: 1000 },
    });
    assert.equal(r.status, 201, r.texto);
    const { rows } = await pool.query(
      "SELECT (programado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia,"
      + " (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje"
      + '  FROM fact_viagens WHERE carga_id = $1', ['prog_direta']);
    assert.equal(String(rows[0].dia), String(rows[0].hoje));
  });
});

/* ------------------------------------------------------------------ */
describe('26. Até três lacres na saída (20/08/2026)', () => {
  /* Pedido do gestor: "pode haver mais de um (ou dois, no máximo três)
     lacres na saída do caminhão". Cada um no seu campo — juntar os três num
     texto só faria o número deixar de ser pesquisável, que é exatamente
     para o que ele serve quando a inspeção pergunta por um lacre. */
  let placa;
  let cargaId;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 67 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
    const c = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'lacres_trio', placa, numeroCarga: 'LACRE-3', peso: 1000 },
    });
    assert.equal(c.status, 201, c.texto);
    cargaId = c.json.id;
  });

  test('a Portaria grava os três, e os três voltam separados', async () => {
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Portaria'],
      corpo: { lacre: '133476', lacre2: '133477', lacre3: '133478' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.lacre, '133476');
    assert.equal(r.json.lacre2, '133477');
    assert.equal(r.json.lacre3, '133478');
  });

  test('ECO com lacre vazio NÃO apaga número já gravado', async () => {
    /* Achado medindo o tráfego do painel em 20/08/2026: um terminal que
       ainda não recebeu os lacres reenvia a carga com os três em branco, e
       isso apagava o que a Portaria tinha acabado de registrar — sem erro
       em tela nenhuma. Mesma família do sumiço das observações em 14/08,
       mesma defesa: vazio não apaga. */
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Portaria'],
      corpo: { lacre: '', lacre2: '', lacre3: '' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.lacre, '133476');
    assert.equal(r.json.lacre2, '133477');
    assert.equal(r.json.lacre3, '133478');
  });

  test('para trocar um lacre, digita-se o outro número', async () => {
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { lacre: '900001' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.lacre, '900001');
    assert.equal(r.json.lacre2, '133477', 'os outros não se mexem');
  });

  test('os lacres continuam sendo da Portaria — a Expedição não escreve', async () => {
    /* O servidor filtra o que o setor não pode editar ANTES de gravar;
       sobrando nada, a resposta é 400 SEM_CAMPOS_PERMITIDOS (e não 403).
       O que importa aqui é o efeito: o número não muda. */
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Expedição'], corpo: { lacre2: '000000' },
    });
    assert.equal(r.status, 400, r.texto);
    assert.equal(r.json.codigo, 'SEM_CAMPOS_PERMITIDOS');
    const { rows } = await pool.query(
      'SELECT lacre_2 FROM fact_viagens WHERE carga_id = $1', [cargaId]);
    assert.equal(rows[0].lacre_2, '133477', 'a Expedição não deixou marca no lacre');
  });
});

/* ------------------------------------------------------------------ */
describe('26b. Duas cargas do MESMO dia na mesma placa entram as duas', () => {
  /* Relato do programador de embarque (20/08/2026), sobre a trava criada na
     véspera: "na segunda carga a placa está dando que o veículo não chegou,
     só que o veículo está no pátio... aí você dá a entrada nele e não dá. É
     isso que está dando interferência".

     Caminhão com duas cargas no mesmo dia é rotina do pátio — carrega,
     pesa, carrega de novo, pesa. A trava tem que barrar carga PENDURADA DE
     OUTRO DIA, e só. */
  let placa;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 77 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
    for (const [id, numero] of [['duas_a', '118287'], ['duas_b', '118288']]) {
      const r = await req('/api/cargas', {
        metodo: 'POST', token: tokens['Logística'],
        corpo: { id, placa, numeroCarga: numero, peso: 1000 },
      });
      assert.equal(r.status, 201, r.texto);
    }
  });

  test('a primeira carga entra', async () => {
    const r = await req('/api/cargas/duas_a/status', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 200, r.texto);
  });

  test('a SEGUNDA carga do mesmo dia também entra — o caminhão é o mesmo', async () => {
    const r = await req('/api/cargas/duas_b/status', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.status, 'Aguardando Embarque');
  });

  test('mas carga PENDURADA DE OUTRO DIA continua barrando a chegada', async () => {
    // A de ontem fica em aberto no pátio; a de hoje tenta entrar.
    await pool.query(
      "UPDATE fact_viagens SET programado_em = now() - interval '1 day' WHERE carga_id = 'duas_a'"
    );
    const c = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'duas_c', placa, numeroCarga: '118289', peso: 1000 },
    });
    assert.equal(c.status, 201, c.texto);
    const r = await req('/api/cargas/duas_c/status', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.json.codigo, 'PLACA_COM_CARGA_ABERTA');
  });
});

/* ------------------------------------------------------------------ */
describe('27. Última ação é de GENTE, não de eco de sincronização', () => {
  /* Relato do gestor (20/08/2026): "todos estão marcando o mesmo horário,
     no mesmo dia... quero que seja informada a última vez que foi
     atualizada por um OPERADOR". A causa está documentada desde 14/08: o
     painel reenvia as cargas que tem em memória a cada reconexão, e o
     gatilho subia `atualizado_em` mesmo quando a gravação era idêntica. */
  let placa;
  let cargaId;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 69 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
    const c = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'acao_eco', placa, numeroCarga: 'ACAO-1', peso: 1000 },
    });
    assert.equal(c.status, 201, c.texto);
    cargaId = c.json.id;
  });

  const carimbo = async () => {
    const { rows } = await pool.query(
      'SELECT acao_em, acao_por, acao_setor, atualizado_em, operador_nome FROM fact_viagens WHERE carga_id = $1',
      [cargaId]
    );
    return rows[0];
  };

  test('a carga nasce com a ação carimbada', async () => {
    const a = await carimbo();
    assert.ok(a.acao_em, 'criar é ação de gente');
  });

  test('mudança de verdade move o carimbo e registra quem fez', async () => {
    const antes = await carimbo();
    await new Promise((r) => setTimeout(r, 50));
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { peso: 4321 },
    });
    assert.equal(r.status, 200, r.texto);
    const depois = await carimbo();
    assert.ok(depois.acao_em > antes.acao_em, 'peso mudou: a ação é nova');
    assert.ok(depois.acao_por, 'a ação tem autor');
  });

  test('ECO: regravar o mesmo valor NÃO inventa ação nova', async () => {
    const antes = await carimbo();
    await new Promise((r) => setTimeout(r, 50));
    // Exatamente o que um painel reconectando faz: reenvia o que tem.
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Logística'], corpo: { peso: 4321 },
    });
    assert.equal(r.status, 200, r.texto);
    const depois = await carimbo();
    assert.equal(depois.acao_em.getTime(), antes.acao_em.getTime(),
      'nada mudou: o horário da última ação tem que ficar parado');
    assert.ok(depois.atualizado_em > antes.atualizado_em,
      'a linha foi gravada — a sincronia incremental continua enxergando');
  });

  test('ECO de outro setor não rouba a autoria de quem mexeu', async () => {
    const antes = await carimbo();
    const r = await req(`/api/cargas/${cargaId}`, {
      metodo: 'PATCH', token: tokens['Portaria'], corpo: { motorista: '' },
    });
    // Portaria pode editar motorista; mandando o valor que já está lá, é eco.
    assert.equal(r.status, 200, r.texto);
    const depois = await carimbo();
    assert.equal(depois.acao_por, antes.acao_por);
    assert.equal(depois.operador_nome, antes.operador_nome);
  });

  test('a etapa também é ação: mudar status move o carimbo', async () => {
    const antes = await carimbo();
    await new Promise((r) => setTimeout(r, 50));
    const r = await req(`/api/cargas/${cargaId}/status`, {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    assert.equal(r.status, 200, r.texto);
    const depois = await carimbo();
    assert.ok(depois.acao_em > antes.acao_em);
    assert.equal(depois.acao_setor, 'Portaria');
  });

  test('o painel recebe os três campos na leitura do estado', async () => {
    const r = await req('/api/estado', { token: tokens['Logística'] });
    assert.equal(r.status, 200, r.texto);
    const c = r.json.cargas.find((x) => x.id === cargaId);
    assert.ok(c, 'a carga veio no estado');
    assert.ok(c.acaoEm, 'acaoEm');
    assert.ok(c.acaoPor, 'acaoPor');
    assert.equal(c.acaoSetor, 'Portaria');
  });
});

/* ------------------------------------------------------------------ */
describe('28. Encerrar a programação anterior deixa a Torre limpa', () => {
  /* "A programação das viagens que já seguiram viagem e que não têm
     pendência aberta [precisa sair] da torre de controle de hoje... para
     montar uma nova programação." */
  let placaOntem;
  let placaHoje;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 71 LIMIT 2');
    placaOntem = rows[0].placa;
    placaHoje = rows[1].placa;
    for (const p of [placaOntem, placaHoje]) {
      await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [p]);
      await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [p]);
    }
    await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'enc_ontem', placa: placaOntem, numeroCarga: 'ENC-ONTEM', peso: 1000 },
    });
    await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'enc_hoje', placa: placaHoje, numeroCarga: 'ENC-HOJE', peso: 1000 },
    });
    // A de ontem fica presa no meio do caminho, como acontece de verdade.
    await req('/api/cargas/enc_ontem/status', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { status: 'Aguardando Embarque' },
    });
    await pool.query(
      "UPDATE fact_viagens SET programado_em = now() - interval '1 day' WHERE carga_id = 'enc_ontem'"
    );
  });

  test('sem motivo, não encerra nada', async () => {
    const r = await req('/api/cargas/encerrar-anteriores', {
      metodo: 'POST', token: tokens['Logística'], corpo: {},
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'MOTIVO_OBRIGATORIO');
  });

  test('a Portaria não encerra programação — é da Logística', async () => {
    const r = await req('/api/cargas/encerrar-anteriores', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { motivo: 'teste' },
    });
    assert.equal(r.status, 403);
  });

  test('encerra a de ontem e NÃO toca na de hoje', async () => {
    const r = await req('/api/cargas/encerrar-anteriores', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { motivo: 'caminhões já saíram; limpando para a programação nova' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.encerradas.some((c) => c.id === 'enc_ontem'), 'a de ontem fecha');
    assert.ok(!r.json.encerradas.some((c) => c.id === 'enc_hoje'), 'a de hoje NUNCA fecha aqui');

    const { rows } = await pool.query(
      "SELECT carga_id, status_atual FROM fact_viagens WHERE carga_id IN ('enc_ontem','enc_hoje') ORDER BY carga_id"
    );
    const porId = Object.fromEntries(rows.map((x) => [x.carga_id, x.status_atual]));
    assert.equal(porId.enc_ontem, 'Seguiu Viagem');
    assert.equal(porId.enc_hoje, 'Aguardando Veículo');
  });

  test('o encerramento fica na trilha, com o motivo', async () => {
    const { rows } = await pool.query(
      "SELECT acao FROM log_eventos WHERE carga_id = 'enc_ontem' ORDER BY data_evento DESC LIMIT 1"
    );
    assert.match(rows[0].acao, /Programação anterior encerrada/);
    assert.match(rows[0].acao, /caminhões já saíram/);
  });

  test('rodar de novo não encontra mais nada para encerrar', async () => {
    const r = await req('/api/cargas/encerrar-anteriores', {
      metodo: 'POST', token: tokens['Logística'], corpo: { motivo: 'segunda passada' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.total, 0);
  });
});

/* ------------------------------------------------------------------ */
describe('29. Lacres gravados fielmente: saída, retenção e trilha', () => {
  /* Pedido do gestor (20/08/2026): "as informações de lacre dos porteiros —
     lacres, tanto na saída quanto devoluções, e lacre retido também — saiam
     como informação para a gente na torre de controle, nos relatórios...
     grave fielmente no backend". Fiel = campo, com motivo, autor e hora —
     não frase dentro da observação. */
  let placa;
  let cargaId;

  before(async () => {
    const { rows } = await pool.query('SELECT placa FROM dim_veiculos ORDER BY placa OFFSET 74 LIMIT 1');
    placa = rows[0].placa;
    await pool.query('DELETE FROM fact_statusfrota WHERE placa = $1', [placa]);
    await pool.query('DELETE FROM fact_viagens WHERE placa = $1', [placa]);
    const c = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'lacre_fiel', placa, numeroCarga: 'LACRE-FIEL', peso: 1000 },
    });
    assert.equal(c.status, 201, c.texto);
    cargaId = c.json.id;
    for (const [setor, status] of [
      ['Portaria', 'Aguardando Embarque'], ['Expedição', 'Embarque Iniciado'],
      ['Expedição', 'Embarque Finalizado'], ['Faturamento', 'Faturado'],
    ]) {
      const r = await req(`/api/cargas/${cargaId}/status`, {
        metodo: 'POST', token: tokens[setor], corpo: { status },
      });
      assert.equal(r.status, 200, `${setor}: ${r.texto}`);
    }
  });

  test('a saída grava os lacres na MESMA operação, sem PATCH depois', async () => {
    const r = await req('/api/portaria/saida', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { placa, lacres: ['133476', '133477', '133478'] },
    });
    assert.equal(r.status, 200, r.texto);
    const c = r.json.liberadas.find((x) => x.id === cargaId);
    assert.ok(c, 'a carga saiu');
    assert.equal(c.lacre, '133476');
    assert.equal(c.lacre2, '133477');
    assert.equal(c.lacre3, '133478');
  });

  test('a trilha da saída diz quais lacres foram', async () => {
    const { rows } = await pool.query(
      'SELECT acao FROM log_eventos WHERE carga_id = $1 ORDER BY data_evento DESC LIMIT 1', [cargaId]
    );
    assert.match(rows[0].acao, /133476 \/ 133477 \/ 133478/);
  });

  test('a retenção grava número, motivo, autor e hora — não só texto na observação', async () => {
    const r = await req('/api/portaria/lacre-retido', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { placa, lacreRetido: '133476', novoLacre: '900123', motivo: 'carga incorreta na conferência' },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.total, 1);
    const c = r.json.atingidas[0];
    assert.equal(c.lacreRetido, '133476');
    assert.equal(c.lacreRetidoMotivo, 'carga incorreta na conferência');
    assert.ok(c.lacreRetidoPor, 'quem reteve');
    assert.ok(c.lacreRetidoEm, 'quando reteve');
    assert.equal(c.lacre, '900123', 'o novo lacre passa a ser o vigente');
    assert.match(c.observacoes, /RETIDO/, 'a observação continua contando a história para quem lê a tela');
  });

  test('sem número de lacre, a retenção é recusada', async () => {
    const r = await req('/api/portaria/lacre-retido', {
      metodo: 'POST', token: tokens['Portaria'], corpo: { placa, motivo: 'x' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'LACRE_FALTANDO');
  });

  test('retenção é da Portaria — a Expedição não retém', async () => {
    const r = await req('/api/portaria/lacre-retido', {
      metodo: 'POST', token: tokens['Expedição'],
      corpo: { placa, lacreRetido: '1', motivo: 'x' },
    });
    assert.equal(r.status, 403);
  });

  test('a retenção fica na trilha, com o motivo', async () => {
    const { rows } = await pool.query(
      "SELECT acao FROM log_eventos WHERE carga_id = $1 AND acao LIKE '%RETIDO%' ORDER BY data_evento DESC LIMIT 1",
      [cargaId]
    );
    assert.match(rows[0].acao, /carga incorreta na conferência/);
  });
});

/* ------------------------------------------------------------------ */
describe('30. Histórico da programação do dia — canceladas incluídas', () => {
  let placaA, placaB, hoje;

  before(async () => {
    const { rows } = await pool.query(
      `SELECT v.placa FROM dim_veiculos v
        LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL
       WHERE v.transportadora <> '' AND f.carga_id IS NULL
       ORDER BY v.placa DESC LIMIT 2`);
    [placaA, placaB] = rows.map((r) => r.placa);
    hoje = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const a = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'progdia_a', placa: placaA, numeroCarga: 'PD-1', peso: 1000 },
    });
    assert.equal(a.status, 201);
    const b = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'progdia_b', placa: placaB, numeroCarga: 'PD-2', peso: 2000 },
    });
    assert.equal(b.status, 201);
    // A segunda é CANCELADA — é ela que a leitura normal esconde e esta
    // consulta precisa mostrar.
    const del = await req('/api/cargas/progdia_b', {
      metodo: 'DELETE', token: tokens['Logística'],
    });
    assert.equal(del.status, 200);
  });

  test('sem dia válido, a consulta recusa', async () => {
    const r = await req('/api/programacao-do-dia?dia=ontem', { token: tokens['Logística'] });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'DIA_INVALIDO');
  });

  test('sem login, nada', async () => {
    const r = await req(`/api/programacao-do-dia?dia=${hoje}`);
    assert.equal(r.status, 401);
  });

  test('a consulta é do controle: Portaria e Expedição não leem', async () => {
    for (const setor of ['Portaria', 'Expedição']) {
      const r = await req(`/api/programacao-do-dia?dia=${hoje}`, { token: tokens[setor] });
      assert.equal(r.status, 403, `${setor} é operação, não controle`);
    }
  });

  test('a programação do dia traz a ativa E a cancelada, com autoria do cancelamento', async () => {
    const r = await req(`/api/programacao-do-dia?dia=${hoje}`, { token: tokens['Logística'] });
    assert.equal(r.status, 200);
    const ativa = r.json.find((c) => c.id === 'progdia_a');
    const cancelada = r.json.find((c) => c.id === 'progdia_b');
    assert.ok(ativa, 'a carga ativa aparece');
    assert.ok(cancelada, 'a carga CANCELADA aparece — é a razão da rota existir');
    assert.equal(cancelada.excluida, true);
    assert.ok(cancelada.excluidaEm, 'com a data do cancelamento');
    assert.ok(cancelada.excluidaPor, 'e com quem cancelou');
    assert.equal(ativa.excluida, false);
  });

  test('chegada sem programação NÃO entra — nunca foi programada', async () => {
    const r = await req(`/api/programacao-do-dia?dia=${hoje}`, { token: tokens['Logística'] });
    assert.ok(r.json.every((c) => !c.aguardandoCarga));
  });

  test('outro dia devolve vazio (as cargas são de hoje)', async () => {
    const r = await req('/api/programacao-do-dia?dia=2001-01-01', { token: tokens['Logística'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.filter((c) => ['progdia_a', 'progdia_b'].includes(c.id)), []);
  });
});

/* ------------------------------------------------------------------ */
describe('31. Protocolo de segurança — sessão revogável (etapa 2)', () => {
  /* A brecha B3: JWT vale até expirar. Desligar um operador deixava a sessão
     dele viva por até 12 horas, em todos os aparelhos onde estivesse aberta.
     A correção é um contador por operador, assinado no token e conferido no
     banco a cada requisição. */
  let id, token;

  before(async () => {
    const hash = await bcrypt.hash(SENHA, 4);
    await pool.query(
      `INSERT INTO operadores (email, nome, setor, senha_hash)
       VALUES ('revoga@teste.local','Revoga','Logística',$1)
       ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, ativo = TRUE`,
      [hash]
    );
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'revoga@teste.local', senha: SENHA },
    });
    assert.equal(r.status, 200, r.texto);
    token = r.json.token;
    id = Number(r.json.operador?.id ?? (await pool.query(
      "SELECT id FROM operadores WHERE email = 'revoga@teste.local'")).rows[0].id);
  });

  test('a sessão funciona normalmente antes de qualquer revogação', async () => {
    const r = await req('/api/estado', { token });
    assert.equal(r.status, 200);
  });

  test('DESATIVAR o operador derruba a sessão dele na requisição seguinte', async () => {
    const p = await req(`/api/operadores/${id}`, {
      metodo: 'PATCH', token: adm.a, corpo: { ativo: false },
    });
    assert.equal(p.status, 200, p.texto);

    const r = await req('/api/estado', { token });
    assert.equal(r.status, 401, 'o token continuou valendo depois do desligamento');
    assert.ok(['OPERADOR_INATIVO', 'SESSAO_REVOGADA'].includes(r.json.codigo), r.json.codigo);
  });

  test('TROCAR A SENHA invalida as sessões antigas — senha nova com sessão velha não protege nada', async () => {
    await req(`/api/operadores/${id}`, {
      metodo: 'PATCH', token: adm.a, corpo: { ativo: true },
    });
    const novo = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'revoga@teste.local', senha: SENHA },
    });
    assert.equal(novo.status, 200);
    const tokenAntigo = novo.json.token;
    assert.equal((await req('/api/estado', { token: tokenAntigo })).status, 200);

    await req(`/api/operadores/${id}`, {
      metodo: 'PATCH', token: adm.a, corpo: { senha: 'outra-senha-bem-longa-123' },
    });
    const r = await req('/api/estado', { token: tokenAntigo });
    assert.equal(r.status, 401);
    assert.equal(r.json.codigo, 'SESSAO_REVOGADA');
  });

  test('MUDAR O SETOR também revoga — o setor viaja dentro do token', async () => {
    await req(`/api/operadores/${id}`, {
      metodo: 'PATCH', token: adm.a, corpo: { senha: SENHA },
    });
    const novo = await req('/auth/login', {
      metodo: 'POST', corpo: { email: 'revoga@teste.local', senha: SENHA },
    });
    const t = novo.json.token;
    await req(`/api/operadores/${id}`, {
      metodo: 'PATCH', token: adm.a, corpo: { setor: 'Portaria' },
    });
    const r = await req('/api/estado', { token: t });
    assert.equal(r.status, 401, 'rebaixar de setor sem revogar deixaria as permissões antigas de pé');
  });

  after(async () => {
    await pool.query("DELETE FROM operadores WHERE email = 'revoga@teste.local'");
  });
});

/* ------------------------------------------------------------------ */
describe('32. Reescrever o passado — sem segunda assinatura, com motivo', () => {
  /* A REGRA MUDOU DE PROPÓSITO EM 25/08/2026.

     De 22 a 25/08 restaurar, desfazer exclusão e corrigir etapa exigiam
     pedido de um administrador e aprovação de OUTRO. O dono tirou a
     exigência: "quem for da administração não precisa da autorização de
     nada". Como as três rotas já eram exclusivas da Administração,
     dispensar a Administração dispensou a trava inteira.

     Este bloco existe para garantir o que FICOU no lugar dela: as três
     ações continuam sendo só da Administração, continuam exigindo MOTIVO,
     e o motivo continua chegando ao histórico da carga. Sem isso a
     mudança teria trocado uma trava por um buraco. */
  let cargaId;

  before(async () => {
    const { rows } = await pool.query(
      `SELECT v.placa FROM dim_veiculos v
        LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL
       WHERE v.transportadora <> '' AND f.carga_id IS NULL ORDER BY v.placa LIMIT 1`);
    const c = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { id: 'seg_assinatura_1', placa: rows[0].placa, numeroCarga: 'SEG-1', peso: 1000 },
    });
    assert.equal(c.status, 201, c.texto);
    cargaId = 'seg_assinatura_1';
  });

  test('a Administração corrige a etapa SOZINHA — sem pedir aval a ninguém', async () => {
    const r = await req(`/api/cargas/${cargaId}/corrigir-etapa`, {
      metodo: 'POST', token: adm.a,
      corpo: { status: 'Faturado', motivo: 'lançamento em duplicidade' },
    });
    assert.equal(r.status, 200, r.texto);
  });

  test('e o MOTIVO foi para o histórico da carga', async () => {
    const { rows } = await pool.query(
      `SELECT acao, operador_nome FROM log_eventos
        WHERE carga_id = $1 ORDER BY data_evento DESC LIMIT 5`, [cargaId]);
    const achou = rows.find((l) => (l.acao || '').includes('lançamento em duplicidade'));
    assert.ok(achou, 'o motivo digitado precisa aparecer no log: '
      + JSON.stringify(rows.map((l) => l.acao)));
    assert.equal(achou.operador_nome, 'Admin Um');
  });

  test('corrigir etapa SEM motivo continua recusado — o histórico ficaria mudo', async () => {
    const r = await req(`/api/cargas/${cargaId}/corrigir-etapa`, {
      metodo: 'POST', token: adm.a, corpo: { status: 'Seguiu Viagem' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'MOTIVO_OBRIGATORIO');
  });

  test('restaurar SEM motivo é recusado pelo mesmo princípio', async () => {
    const revs = await req(`/api/cargas/${cargaId}/revisoes`, { token: adm.a });
    assert.equal(revs.status, 200, revs.texto);
    const r = await req(`/api/cargas/${cargaId}/restaurar`, {
      metodo: 'POST', token: adm.a, corpo: { revisaoId: revs.json[0].revisaoId },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'MOTIVO_OBRIGATORIO');
  });

  test('restaurar COM motivo executa, e o motivo fica no histórico', async () => {
    const revs = await req(`/api/cargas/${cargaId}/revisoes`, { token: adm.a });
    const r = await req(`/api/cargas/${cargaId}/restaurar`, {
      metodo: 'POST', token: adm.a,
      corpo: { revisaoId: revs.json[revs.json.length - 1].revisaoId,
               motivo: 'informação incorreta' },
    });
    assert.equal(r.status, 200, r.texto);
    const { rows } = await pool.query(
      `SELECT acao FROM log_eventos WHERE carga_id = $1
        ORDER BY data_evento DESC LIMIT 3`, [cargaId]);
    assert.ok(rows.some((l) => (l.acao || '').includes('informação incorreta')),
      'motivo da restauração precisa estar no log: '
      + JSON.stringify(rows.map((l) => l.acao)));
  });

  test('a Logística continua sem poder reescrever o passado', async () => {
    const r = await req(`/api/cargas/${cargaId}/corrigir-etapa`, {
      metodo: 'POST', token: tokens['Logística'],
      corpo: { status: 'Faturado', motivo: 'nao deveria passar' },
    });
    assert.equal(r.status, 403);
    assert.equal(r.json.codigo, 'SETOR_SEM_PERMISSAO');
  });

  test('as rotas de pedido/aprovação não existem mais', async () => {
    const pedir = await req('/api/acoes-criticas', {
      metodo: 'POST', token: adm.a,
      corpo: { tipo: 'corrigir-etapa', cargaId, motivo: 'x' },
    });
    assert.equal(pedir.status, 404, 'POST /acoes-criticas saiu em 25/08');
    const listar = await req('/api/acoes-criticas', { token: adm.a });
    assert.equal(listar.status, 404, 'GET /acoes-criticas saiu em 25/08');
  });
});

/* ------------------------------------------------------------------ */
describe('33. Protocolo de segurança — segundo fator (etapa 4)', () => {
  /* A brecha B4: senha vazada de administrador dá poder de restaurar,
     apagar e criar usuário. Senha sozinha protege contra quem não sabe a
     senha; não protege contra quem a descobriu.

     REGRA DE IMPLANTAÇÃO que estes testes também guardam: o segundo fator
     nasce DESLIGADO. Publicar não pode derrubar o login de ninguém. */
  let id, token, segredo, codigosRec;
  const EMAIL = 'mfa@teste.local';

  before(async () => {
    const hash = await bcrypt.hash(SENHA, 4);
    await pool.query(
      `INSERT INTO operadores (email, nome, setor, senha_hash)
       VALUES ($1,'Fator Duplo','Logística',$2)
       ON CONFLICT (email) DO UPDATE
         SET senha_hash = EXCLUDED.senha_hash, ativo = TRUE,
             mfa_ativo = FALSE, mfa_segredo = ''`,
      [EMAIL, hash]
    );
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 200, r.texto);
    token = r.json.token;
    id = (await pool.query('SELECT id FROM operadores WHERE email = $1', [EMAIL])).rows[0].id;
  });

  test('quem NÃO ativou entra só com a senha — a adesão é por pessoa', async () => {
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 200, 'publicar o segundo fator não pode derrubar quem não ativou');
  });

  test('iniciar devolve o segredo e o endereço do aplicativo', async () => {
    const r = await req('/auth/mfa/iniciar', { metodo: 'POST', token });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.segredo && r.json.segredo.length >= 16);
    assert.match(r.json.endereco, /^otpauth:\/\/totp\//);
    segredo = r.json.segredo;
  });

  test('iniciar NÃO liga o segundo fator — quem fecha a tela no meio não fica trancado fora', async () => {
    const { rows } = await pool.query('SELECT mfa_ativo FROM operadores WHERE id = $1', [id]);
    assert.equal(rows[0].mfa_ativo, false);
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 200, 'segredo gerado e não confirmado não pode cobrar código');
  });

  test('confirmar com código errado é recusado', async () => {
    const r = await req('/auth/mfa/confirmar', {
      metodo: 'POST', token, corpo: { codigo: '000000' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'MFA_CODIGO_INVALIDO');
  });

  test('confirmar com o código certo ativa e entrega os códigos de recuperação', async () => {
    const r = await req('/auth/mfa/confirmar', {
      metodo: 'POST', token, corpo: { codigo: codigoDoMomento(segredo) },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.ativo, true);
    assert.equal(r.json.codigosRecuperacao.length, 8);
    codigosRec = r.json.codigosRecuperacao;

    // Guardados com HASH: quem ler o banco não pode usá-los para entrar.
    const { rows } = await pool.query(
      'SELECT codigo_hash FROM mfa_codigos_recuperacao WHERE operador_id = $1 LIMIT 1', [id]
    );
    assert.ok(!codigosRec.includes(rows[0].codigo_hash), 'código de recuperação em claro no banco');
  });


  /* Coloca a conta no estado que a regra de 24/08/2026 exige para o
     segundo fator aparecer: cinco senhas erradas dentro da janela.
     Escrito direto no banco em vez de cinco POSTs porque o que se testa
     aqui é a REGRA, não o contador — o contador tem teste próprio. */
  async function sobSuspeita() {
    await pool.query(
      `UPDATE operadores SET falhas_senha = 5, falhas_desde = now(),
                             bloqueado_ate = NULL WHERE id = $1`, [id]);
  }
  async function semSuspeita() {
    await pool.query(
      `UPDATE operadores SET falhas_senha = 0, falhas_desde = NULL,
                             bloqueado_ate = NULL WHERE id = $1`, [id]);
  }

  /* MUDANÇA DE REGRA (24/08/2026), e ela inverte o teste anterior.

     Até aqui: ativou o segundo fator, digitava o código em TODA entrada.
     Agora: o código só é pedido depois de CINCO senhas erradas. Decisão
     do dono do projeto — "2FA não deve aparecer no login, somente caso
     erre a senha mais de 5x" — tomada porque em dois dias ninguém ativou
     a versão anterior, e proteção que ninguém liga não protege nada.

     O teste velho ("a senha sozinha NÃO entra mais") virou o oposto e
     está logo abaixo. Quem vier depois e achar que isto é regressão:
     não é. Está no cabeçalho da migração 032, com o que a regra pega
     (força bruta) e o que ela não pega (senha vazada). */
  test('com o segundo fator ativo, a senha sozinha AINDA entra — não há suspeita', async () => {
    await semSuspeita();
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 200, 'entrada normal não pode pedir código: ' + r.texto);
    token = r.json.token;
  });

  test('depois de CINCO senhas erradas, a senha sozinha deixa de bastar', async () => {
    await sobSuspeita();
    const r = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(r.status, 401);
    assert.equal(r.json.codigo, 'MFA_NECESSARIO');
  });

  test('sob suspeita, senha certa + código do aplicativo entra', async () => {
    await sobSuspeita();
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: EMAIL, senha: SENHA, codigo: codigoDoMomento(segredo) },
    });
    assert.equal(r.status, 200, r.texto);
    token = r.json.token;
  });

  test('entrar zera o contador — cinco erros de um dia não cobram código para sempre', async () => {
    const { rows } = await pool.query(
      'SELECT falhas_senha, falhas_desde, bloqueado_ate FROM operadores WHERE id = $1', [id]);
    assert.equal(rows[0].falhas_senha, 0);
    assert.equal(rows[0].falhas_desde, null);
    assert.equal(rows[0].bloqueado_ate, null);
  });

  test('quem TEM segundo fator nunca é bloqueado — digita o código e entra', async () => {
    await sobSuspeita();
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: EMAIL, senha: SENHA, codigo: codigoDoMomento(segredo) },
    });
    assert.notEqual(r.json.codigo, 'BLOQUEIO_TEMPORARIO', 'bloqueio é só para quem não tem código');
    assert.equal(r.status, 200, r.texto);
  });

  test('senha ERRADA com código certo não entra — o segundo fator soma, não substitui', async () => {
    await sobSuspeita();
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: EMAIL, senha: 'errada', codigo: codigoDoMomento(segredo) },
    });
    assert.equal(r.status, 401);
    assert.equal(r.json.codigo, 'CREDENCIAL_INVALIDA');
  });

  test('CELULAR PERDIDO: um código de recuperação entra', async () => {
    await sobSuspeita();
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: EMAIL, senha: SENHA, codigo: codigosRec[0] },
    });
    assert.equal(r.status, 200, r.texto);
  });

  test('o mesmo código de recuperação NÃO serve duas vezes', async () => {
    await sobSuspeita();
    const r = await req('/auth/login', {
      metodo: 'POST', corpo: { email: EMAIL, senha: SENHA, codigo: codigosRec[0] },
    });
    assert.equal(r.status, 401);
    assert.equal(r.json.codigo, 'MFA_INVALIDO');
  });

  test('a situação mostra quantos códigos ainda restam', async () => {
    const entrou = await req('/auth/login', {
      metodo: 'POST', corpo: { email: EMAIL, senha: SENHA, codigo: codigoDoMomento(segredo) },
    });
    const r = await req('/auth/mfa/situacao', { token: entrou.json.token });
    assert.equal(r.status, 200);
    assert.equal(r.json.mfa_ativo, true);
    assert.equal(r.json.codigos_restantes, 7, 'um código foi gasto no teste anterior');
  });

  test('desativar exige a SENHA — terminal destravado não desliga o segundo fator', async () => {
    const entrou = await req('/auth/login', {
      metodo: 'POST', corpo: { email: EMAIL, senha: SENHA, codigo: codigoDoMomento(segredo) },
    });
    const r = await req('/auth/mfa/desativar', {
      metodo: 'POST', token: entrou.json.token, corpo: { senha: 'chute' },
    });
    assert.equal(r.status, 401);
    assert.equal(r.json.codigo, 'SENHA_INVALIDA');
  });

  test('a Administração RESETA o segundo fator de quem perdeu o celular — com motivo', async () => {
    const semMotivo = await req(`/api/operadores/${id}/mfa/resetar`, {
      metodo: 'POST', token: adm.a, corpo: {},
    });
    assert.equal(semMotivo.status, 400);
    assert.equal(semMotivo.json.codigo, 'MOTIVO_OBRIGATORIO');

    const r = await req(`/api/operadores/${id}/mfa/resetar`, {
      metodo: 'POST', token: adm.a,
      corpo: { motivo: 'celular quebrado, sem os códigos de recuperação' },
    });
    assert.equal(r.status, 200, r.texto);

    const { rows } = await pool.query(
      'SELECT mfa_ativo, mfa_segredo FROM operadores WHERE id = $1', [id]
    );
    assert.equal(rows[0].mfa_ativo, false);
    assert.equal(rows[0].mfa_segredo, '', 'o segredo antigo precisa sumir no reset');

    const volta = await req('/auth/login', { metodo: 'POST', corpo: { email: EMAIL, senha: SENHA } });
    assert.equal(volta.status, 200, 'depois do reset a pessoa volta com a senha');
  });

  test('a Logística NÃO reseta o segundo fator de ninguém', async () => {
    const r = await req(`/api/operadores/${id}/mfa/resetar`, {
      metodo: 'POST', token: tokens['Logística'], corpo: { motivo: 'tentativa' },
    });
    assert.equal(r.status, 403);
  });

  after(async () => {
    await pool.query('DELETE FROM operadores WHERE email = $1', [EMAIL]);
  });
});
