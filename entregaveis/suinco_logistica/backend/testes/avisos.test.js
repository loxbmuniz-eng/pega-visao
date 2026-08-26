/* AVISO NO CELULAR — a prova de que ele entrega, e de que ele desiste.
   ---------------------------------------------------------------------
   Arquivo separado do api.test.js de propósito, e o motivo é técnico: o
   serviço lê as chaves VAPID UMA VEZ, no import. Para exercitar o estado
   "ligado" é preciso um processo onde as variáveis já existam antes de
   qualquer import — e o node:test roda cada arquivo no seu próprio
   processo, então este arquivo pode ligar o que o outro deixa desligado.

   NÃO TEM MOCK DE web-push. O que este arquivo faz é levantar um servidor
   HTTP de mentira e apontar o endpoint da inscrição para ele. Assim a
   biblioteca faz a requisição real, com a criptografia real, e o teste
   observa o que chega do outro lado — inclusive quando o outro lado
   responde 410 ou 500, que é onde mora o comportamento que interessa. */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import webpush from 'web-push';

/* O web-push chama https.request SEMPRE, mesmo para um endereço http://
   (web-push-lib.js linha 369) — e faz sentido, porque na vida real todo
   serviço de push é HTTPS. Aqui isso bateria TLS contra um servidor de
   teste em texto puro e o erro ('packet length too long') não teria nada a
   ver com o que se quer medir.

   A saída é desviar https.request para http.request só dentro deste
   arquivo. O que importa continua real: a biblioteca monta os cabeçalhos
   VAPID de verdade, cifra o conteúdo de verdade, e o teste observa o que
   chega. Trocar o transporte não é trocar o comportamento. */
const requestOriginal = https.request;
https.request = (opcoes, cb) => http.request(opcoes, cb);

const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLICA = chaves.publicKey;
process.env.VAPID_PRIVADA = chaves.privateKey;
process.env.VAPID_CONTATO = 'mailto:teste@local';

// Import dinâmico: as variáveis acima precisam existir ANTES de config.js
// ser lido, e um import estático seria içado para o topo do arquivo.
const avisos = await import('../src/servicos/avisos.js');
const { pool } = await import('../src/banco.js');

/* O falso serviço de push. Cada endereço decide sua própria resposta, e
   guarda o que recebeu — é assim que o teste separa "não enviou" de
   "enviou e o outro lado recusou". */
let servidorFalso;
let baseFalsa;
const recebidos = [];
const respostaDe = new Map(); // caminho -> código HTTP

before(async () => {
  servidorFalso = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (d) => pedacos.push(d));
    req.on('end', () => {
      recebidos.push({ caminho: req.url, bytes: Buffer.concat(pedacos).length });
      res.writeHead(respostaDe.get(req.url) ?? 201).end();
    });
  });
  await new Promise((ok) => servidorFalso.listen(0, '127.0.0.1', ok));
  baseFalsa = `http://127.0.0.1:${servidorFalso.address().port}`;

  await pool.query('DELETE FROM push_inscricoes');
  await pool.query("DELETE FROM avisos_enviados WHERE chave LIKE 'teste-%'");
  await pool.query("DELETE FROM operadores WHERE email LIKE '%@avisos.local'");
});

after(async () => {
  await pool.query('DELETE FROM push_inscricoes');
  await pool.query("DELETE FROM avisos_enviados WHERE chave LIKE 'teste-%'");
  await pool.query("DELETE FROM operadores WHERE email LIKE '%@avisos.local'");
  https.request = requestOriginal;
  await new Promise((ok) => servidorFalso.close(ok));
  await pool.end();
});

async function criarOperador(nome, setor, ativo = true) {
  const { rows } = await pool.query(
    `INSERT INTO operadores (email, nome, setor, senha_hash, ativo)
          VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
    [`${nome.toLowerCase()}@avisos.local`, nome, setor, ativo]
  );
  return rows[0].id;
}

/* As chaves do aparelho. Precisam ser um par ECDH de verdade: a biblioteca
   cifra o conteúdo com elas, e uma chave inventada faz o envio falhar por
   criptografia, não pelo que o teste quer medir. */
import crypto from 'node:crypto';
function chavesDeAparelho() {
  const ec = crypto.createECDH('prime256v1');
  ec.generateKeys();
  return {
    p256dh: ec.getPublicKey().toString('base64url'),
    auth: crypto.randomBytes(16).toString('base64url'),
  };
}

async function inscreverAparelho(operadorId, caminho) {
  const k = chavesDeAparelho();
  await avisos.inscrever(operadorId, {
    endpoint: baseFalsa + caminho,
    keys: k,
  }, 'aparelho de teste');
  return baseFalsa + caminho;
}

describe('1. O estado desligado é um estado válido', () => {
  test('com VAPID configurado, o serviço se diz ligado', () => {
    assert.equal(avisos.ligado(), true);
    assert.equal(avisos.chavePublicaDoPainel(), chaves.publicKey);
  });
});

describe('2. Entrega', () => {
  test('quem é do setor recebe; quem não é, não', async () => {
    recebidos.length = 0;
    const log = await criarOperador('LogA', 'Logística');
    const fat = await criarOperador('FatA', 'Faturamento');
    await inscreverAparelho(log, '/quem-recebe');
    await inscreverAparelho(fat, '/quem-nao-recebe');

    const r = await avisos.enviarParaSetores(['Logística'], {
      titulo: 'Teste', corpo: 'corpo', tag: 't',
    });

    assert.equal(r.alvos, 1, 'só a inscrição da Logística é alvo');
    assert.equal(r.enviados, 1);
    assert.deepEqual(recebidos.map((x) => x.caminho), ['/quem-recebe']);
    assert.ok(recebidos[0].bytes > 0, 'a mensagem vai com conteúdo cifrado');
  });

  test('operador bloqueado não recebe — tirar o acesso desliga tudo', async () => {
    recebidos.length = 0;
    const bloqueado = await criarOperador('LogBloq', 'Logística', false);
    await inscreverAparelho(bloqueado, '/bloqueado');

    const r = await avisos.enviarParaSetores(['Logística'], { titulo: 'x', corpo: 'y' });

    assert.ok(!recebidos.some((x) => x.caminho === '/bloqueado'),
      'o celular de quem foi bloqueado não pode continuar apitando o pátio');
    assert.ok(r.alvos >= 1, 'os ativos do setor continuam recebendo');
  });

  test('dois aparelhos da mesma pessoa recebem os dois', async () => {
    recebidos.length = 0;
    const p = await criarOperador('LogDois', 'Administração');
    await inscreverAparelho(p, '/celular');
    await inscreverAparelho(p, '/computador');

    const r = await avisos.enviarParaSetores(['Administração'], { titulo: 'x', corpo: 'y' });

    assert.equal(r.enviados, 2);
    assert.deepEqual(recebidos.map((x) => x.caminho).sort(), ['/celular', '/computador']);
  });

  test('reinscrever o mesmo aparelho atualiza, não duplica', async () => {
    const p = await criarOperador('LogRe', 'Expedição');
    const url = await inscreverAparelho(p, '/mesmo-aparelho');
    await avisos.inscrever(p, { endpoint: url, keys: chavesDeAparelho() }, 'renomeado');

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM push_inscricoes WHERE endpoint = $1', [url]
    );
    assert.equal(rows[0].n, 1, 'reativar o aviso no mesmo celular não pode dar erro de chave repetida');
  });
});

describe('3. Inscrição morta sai sozinha', () => {
  test('410 (aparelho não existe mais) apaga na hora', async () => {
    const p = await criarOperador('LogMorta', 'Logística');
    const url = await inscreverAparelho(p, '/sumiu');
    respostaDe.set('/sumiu', 410);

    await avisos.enviarParaSetores(['Logística'], { titulo: 'x', corpo: 'y' });

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM push_inscricoes WHERE endpoint = $1', [url]
    );
    assert.equal(rows[0].n, 0, '404/410 é resposta oficial de "não existe mais" — sem segunda chance');
  });

  test('erro passageiro conta uma falha; na segunda, sai', async () => {
    const p = await criarOperador('LogFalha', 'Logística');
    const url = await inscreverAparelho(p, '/instavel');
    respostaDe.set('/instavel', 500);

    await avisos.enviarParaSetores(['Logística'], { titulo: 'x', corpo: 'y' });
    const meio = await pool.query(
      'SELECT falhas FROM push_inscricoes WHERE endpoint = $1', [url]
    );
    assert.equal(meio.rows.length, 1, 'uma falha só não apaga: pode ser rede');
    assert.equal(meio.rows[0].falhas, 1);

    await avisos.enviarParaSetores(['Logística'], { titulo: 'x', corpo: 'y' });
    const fim = await pool.query(
      'SELECT count(*)::int AS n FROM push_inscricoes WHERE endpoint = $1', [url]
    );
    assert.equal(fim.rows[0].n, 0, 'a tabela não pode virar cemitério que o servidor reanima a cada caminhão');
  });

  test('falha de envio nunca lança — a gravação já valeu', async () => {
    const p = await criarOperador('LogNaoLanca', 'Logística');
    // Endereço que não atende ninguém: a conexão é recusada.
    await avisos.inscrever(p, {
      endpoint: 'http://127.0.0.1:9/nada', keys: chavesDeAparelho(),
    });
    await assert.doesNotReject(
      () => avisos.enviarParaSetores(['Logística'], { titulo: 'x', corpo: 'y' }),
      'aviso é acessório: não pode derrubar quem já gravou no banco'
    );
  });
});

describe('4. Aviso único por dia', () => {
  test('a primeira vez devolve true; as seguintes, false', async () => {
    const assunto = `teste-${Date.now()}`;
    assert.equal(await avisos.primeiraVezHoje(assunto), true);
    assert.equal(await avisos.primeiraVezHoje(assunto), false);
    assert.equal(await avisos.primeiraVezHoje(assunto), false);
  });

  test('assuntos diferentes não se atrapalham', async () => {
    const a = `teste-a-${Date.now()}`;
    const b = `teste-b-${Date.now()}`;
    assert.equal(await avisos.primeiraVezHoje(a), true);
    assert.equal(await avisos.primeiraVezHoje(b), true);
  });
});

describe('5. Desinscrever', () => {
  test('apaga só aquele aparelho', async () => {
    const p = await criarOperador('LogSai', 'Administração');
    const fica = await inscreverAparelho(p, '/fica');
    const sai = await inscreverAparelho(p, '/sai');

    const n = await avisos.desinscrever(sai);
    assert.equal(n, 1);

    const restantes = await avisos.inscricoesDoOperador(p);
    assert.deepEqual(restantes.map((r) => r.endpoint), [fica]);
  });

  test('desinscrever endereço que não existe não é erro', async () => {
    assert.equal(await avisos.desinscrever('http://nao/existe'), 0);
    assert.equal(await avisos.desinscrever(''), 0);
  });
});

describe('6. A conta que decide se o dia acabou', () => {
  /* Roda sobre uma tabela TEMPORÁRIA de mesmo nome. Em PostgreSQL a
     temporária tem precedência dentro da sessão que a criou, então esta
     prova usa dados totalmente controlados sem encostar na tabela de
     verdade — e sem atrapalhar outro arquivo de teste rodando em paralelo,
     que é o risco real de contar linhas de uma tabela compartilhada. */
  let cli;

  before(async () => {
    cli = await pool.connect();
    await cli.query(`
      CREATE TEMP TABLE fact_viagens (
        carga_id      TEXT,
        status_atual  TEXT,
        excluida_em   TIMESTAMPTZ,
        programado_em TIMESTAMPTZ,
        criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  });

  after(async () => {
    await cli.query('DROP TABLE IF EXISTS fact_viagens');
    cli.release();
  });

  async function povoar(linhas) {
    await cli.query('DELETE FROM fact_viagens');
    for (const [status, quando, excluida] of linhas) {
      await cli.query(
        `INSERT INTO fact_viagens (carga_id, status_atual, programado_em, criado_em, excluida_em)
              VALUES ($1, $2, $3, $3, $4)`,
        [`c${Math.random()}`, status, quando, excluida || null]
      );
    }
  }

  const HOJE = new Date();
  const ONTEM = new Date(Date.now() - 24 * 3600e3);
  const AMANHA = new Date(Date.now() + 24 * 3600e3);

  test('pátio vazio depois de um dia de trabalho: o dia acabou', async () => {
    await povoar([
      ['Seguiu Viagem', HOJE],
      ['Seguiu Viagem', HOJE],
      ['Seguiu Viagem', HOJE],
    ]);
    const r = await avisos.contarPatio(cli);
    assert.equal(r.abertas, 0);
    assert.equal(r.concluidas_hoje, 3);
  });

  test('carga de ONTEM ainda no pátio segura o aviso', async () => {
    await povoar([
      ['Seguiu Viagem', HOJE],
      ['Faturado', ONTEM],
    ]);
    const r = await avisos.contarPatio(cli);
    assert.equal(r.abertas, 1,
      'anunciar "acabou" com caminhão de ontem pendurado é o que faz a operação parar de confiar no painel');
  });

  test('carga programada para AMANHÃ não segura o aviso de hoje', async () => {
    await povoar([
      ['Seguiu Viagem', HOJE],
      ['Aguardando Veículo', AMANHA],
    ]);
    const r = await avisos.contarPatio(cli);
    assert.equal(r.abertas, 0, 'senão o aviso nunca sairia — sempre há programação futura');
    assert.equal(r.concluidas_hoje, 1);
  });

  test('carga excluída não conta como aberta', async () => {
    await povoar([
      ['Seguiu Viagem', HOJE],
      ['Aguardando Embarque', HOJE, new Date()],
    ]);
    const r = await avisos.contarPatio(cli);
    assert.equal(r.abertas, 0);
  });

  test('dia sem nenhuma conclusão não é fim de expediente', async () => {
    await povoar([['Seguiu Viagem', ONTEM]]);
    const r = await avisos.contarPatio(cli);
    assert.equal(r.abertas, 0);
    assert.equal(r.concluidas_hoje, 0,
      'pátio vazio no domingo não pode virar "a programação terminou"');
  });
});
