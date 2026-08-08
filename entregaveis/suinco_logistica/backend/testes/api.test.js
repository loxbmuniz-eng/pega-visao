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

  test('placa FORA da frota é aceita quando é chegada sem programação', async () => {
    // Diferente da Programação: um caminhão pode chegar fisicamente sem
    // nunca ter sido cadastrado, e a Portaria precisa registrar a presença
    // dele mesmo assim — a Logística corrige o cadastro depois.
    const r = await req('/api/cargas', {
      metodo: 'POST', token: tokens['Portaria'],
      corpo: { id: 'chegada_2', placa: 'ZZZ0001', aguardandoCarga: true },
    });
    assert.equal(r.status, 201, 'a trava de frota não deveria valer aqui');
    assert.equal(r.json.status, 'Aguardando Embarque');
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
