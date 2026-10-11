/* O VIGIA DE DENTRO decide certo — e, tão importante quanto, NÃO age onde
   não deve (02/10/2026).
   ---------------------------------------------------------------------
   Pedido do dono: uma prevenção para cada "se quebrar" do raio-X. O vigia
   (scripts/vigia_servidor.mjs) reinicia servidor de produção sozinho; um
   erro de decisão aqui é o vigia derrubando a operação. Então cada decisão
   é provada rodando o script DE VERDADE, com o mundo de fora trocado por
   fakes (systemctl, /health, backup, certificado, npm audit) e o banco de
   teste real para as anotações.

   Arquivo próprio: só toca a tabela vigia_registros, que nenhum outro
   arquivo de teste usa — pode rodar em paralelo com o api.test.js. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync as spawnSyncBash0, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/banco.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.dirname(AQUI);
const SCRIPT = path.join(BACKEND, 'scripts', 'vigia_servidor.mjs');

let tmp;
let saudavel;    // servidor de /health que responde 200 ok
let semBanco;    // responde 503
let urlOk;
let url503;
let urlMorta;

/* O PÁTIO ISOLADO (11/10/2026). O vigia de travamento confere, de carona,
   as cargas acima de 3 h no pátio. Para isso não depender das cargas que o
   api.test.js cria em paralelo, o script roda com o search_path apontando
   primeiro para um esquema só deste arquivo, com fact_viagens e
   fact_statusfrota vazias da mesma forma das reais. O resto (vigia_registros,
   push_inscricoes) continua sendo o de verdade. */
const ESQUEMA_PATIO = 'vigia_patio_teste';
const PATIO_ISOLADO = `-c search_path=${ESQUEMA_PATIO},public`;

/* ASSÍNCRONO de propósito: os /health de mentira moram NESTE processo. Com
   spawnSync o teste congelava esperando o filho, o servidor de mentira não
   respondia, e todo caso virava "sem resposta" — o teste mentia, não o
   vigia. */
function rodar(modo, env = {}) {
  return new Promise((ok) => {
    const filho = spawn('node', [SCRIPT, modo], {
      cwd: BACKEND,
      env: { ...process.env, VIGIA_ESTADO: path.join(tmp, 'estado.json'), ...env },
    });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('close', (codigo) => ok({ codigo, saida }));
  });
}

async function anotacao(v) {
  const { rows } = await pool.query('SELECT * FROM vigia_registros WHERE verificacao = $1', [v]);
  return rows[0] || null;
}

function servirHealth(status, corpo) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(corpo));
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'vigia-'));
  await pool.query('DELETE FROM vigia_registros');
  await pool.query(`DROP SCHEMA IF EXISTS ${ESQUEMA_PATIO} CASCADE`);
  await pool.query(`CREATE SCHEMA ${ESQUEMA_PATIO}`);
  await pool.query(`CREATE TABLE ${ESQUEMA_PATIO}.fact_viagens (LIKE public.fact_viagens INCLUDING DEFAULTS)`);
  await pool.query(`CREATE TABLE ${ESQUEMA_PATIO}.fact_statusfrota (LIKE public.fact_statusfrota INCLUDING DEFAULTS)`);
  saudavel = await servirHealth(200, { ok: true, banco: 'conectado' });
  semBanco = await servirHealth(503, { ok: false, banco: 'inacessível' });
  urlOk = `http://127.0.0.1:${saudavel.address().port}/health`;
  url503 = `http://127.0.0.1:${semBanco.address().port}/health`;
  const morto = await servirHealth(200, {});
  urlMorta = `http://127.0.0.1:${morto.address().port}/health`;
  await new Promise((ok) => morto.close(ok));
});

after(async () => {
  saudavel.close();
  semBanco.close();
  await pool.query('DELETE FROM vigia_registros');
  await pool.query(`DROP SCHEMA IF EXISTS ${ESQUEMA_PATIO} CASCADE`);
  await pool.end();
  rmSync(tmp, { recursive: true, force: true });
});

describe('Vigia 1 — travamento (F2): reinicia o que TRAVOU, e só isso', () => {
  const marca = () => path.join(tmp, 'reiniciou');
  const base = () => ({ VIGIA_CMD_ATIVO: 'echo active', VIGIA_CMD_REINICIAR: `touch ${marca()}`, PGOPTIONS: PATIO_ISOLADO });

  test('serviço parado de propósito (atualizar.sh) não é travamento: não reinicia, não anota', async () => {
    rmSync(path.join(tmp, 'estado.json'), { force: true });
    for (let i = 0; i < 4; i++) {
      await rodar('travamento', { ...base(), VIGIA_CMD_ATIVO: 'echo inactive', VIGIA_HEALTH_URL: urlMorta });
    }
    assert.equal(existsSync(marca()), false, 'reiniciou um serviço que estava parado de propósito');
  });

  test('banco fora (/health 503) não reinicia o servidor — reiniciar não conserta banco', async () => {
    for (let i = 0; i < 4; i++) await rodar('travamento', { ...base(), VIGIA_HEALTH_URL: url503 });
    assert.equal(existsSync(marca()), false);
  });

  test('1 e 2 minutos sem resposta: espera, não reinicia', async () => {
    rmSync(path.join(tmp, 'estado.json'), { force: true });
    await rodar('travamento', { ...base(), VIGIA_HEALTH_URL: urlMorta });
    await rodar('travamento', { ...base(), VIGIA_HEALTH_URL: urlMorta });
    assert.equal(existsSync(marca()), false);
  });

  test('3º minuto sem resposta: reinicia, anota o problema e AVISA uma vez', async () => {
    const r = await rodar('travamento', { ...base(), VIGIA_HEALTH_URL: urlMorta });
    assert.equal(existsSync(marca()), true, `não reiniciou: ${r.saida}`);
    assert.match(r.saida, /AVISO piorou/);
    const a = await anotacao('travamento');
    assert.equal(a.ok, false);
    assert.match(a.detalhe, /reiniciado sozinho/);
    assert.ok(a.problema_desde, 'o "desde quando" do problema ficou vazio');
  });

  test('voltou a responder: anota normal e avisa que NORMALIZOU', async () => {
    const r = await rodar('travamento', { ...base(), VIGIA_HEALTH_URL: urlOk });
    assert.match(r.saida, /AVISO melhorou/);
    const a = await anotacao('travamento');
    assert.equal(a.ok, true);
    assert.equal(a.problema_desde, null);
  });

  test('saudável de novo no minuto seguinte: nem aviso, nem conexão nova (anotou há menos de 10 min)', async () => {
    const r = await rodar('travamento', { ...base(), VIGIA_HEALTH_URL: urlOk });
    assert.doesNotMatch(r.saida, /AVISO/);
    assert.doesNotMatch(r.saida, /travamento: ok/, 'anotou de novo sem precisar');
  });

  test('3 reinícios na última hora: o 4º NÃO acontece — avisa que precisa de gente', async () => {
    rmSync(marca(), { force: true });
    const agora = Date.now();
    writeFileSync(path.join(tmp, 'estado.json'), JSON.stringify({
      falhas: 2, reinicios: [agora - 50 * 60000, agora - 30 * 60000, agora - 5 * 60000], ultimoAnotado: 'ok',
    }));
    const r = await rodar('travamento', { ...base(), VIGIA_HEALTH_URL: urlMorta });
    assert.equal(existsSync(marca()), false, 'reiniciou pela 4ª vez na mesma hora');
    assert.match(r.saida, /AVISO piorou/);
    assert.match((await anotacao('travamento')).detalhe, /precisa de gente/);
  });
});

describe('Vigia 1b — carga passando de 3 h no pátio: aviso uma vez por carga (11/10/2026)', () => {
  const env = () => ({ VIGIA_CMD_ATIVO: 'echo active', VIGIA_CMD_REINICIAR: 'true',
    VIGIA_HEALTH_URL: urlOk, PGOPTIONS: PATIO_ISOLADO });
  const estado = () => JSON.parse(readFileSync(path.join(tmp, 'estado.json'), 'utf8'));
  /* "Passaram 5 minutos": a cadência é guardada no estado; voltar o relógio
     dela é o mesmo que esperar. */
  const passar5min = () => {
    const e = estado(); e.patioEm = Date.now() - 6 * 60 * 1000;
    writeFileSync(path.join(tmp, 'estado.json'), JSON.stringify(e));
  };
  async function carga(id, minutosNoPatio) {
    await pool.query(
      `INSERT INTO ${ESQUEMA_PATIO}.fact_viagens (carga_id, numero_carga, placa, status_atual, criado_em)
            VALUES ($1, $2, $3, 'Embarque Iniciado', now() - make_interval(mins => $4))`,
      [id, `77${id.slice(-2)}`, `TSP${id.slice(-4)}`, minutosNoPatio + 30]);
    await pool.query(
      `INSERT INTO ${ESQUEMA_PATIO}.fact_statusfrota (movimentacao_id, carga_id, placa, status_novo, data_evento)
            VALUES ($1, $2, '', 'Aguardando Embarque', now() - make_interval(mins => $3))`,
      [`m-${id}`, id, minutosNoPatio]);
  }

  test('pátio sem atraso: confere, não avisa', async () => {
    rmSync(path.join(tmp, 'estado.json'), { force: true });
    const r = await rodar('travamento', env());
    assert.match(r.saida, /pátio: 0 carga\(s\) acima de 180 min/, r.saida);
    assert.doesNotMatch(r.saida, /AVISO pátio/);
  });

  test('uma carga passa de 3 h: avisa, com o número, a placa e o tempo', async () => {
    await carga('pv01', 190);
    await carga('pv02', 100);
    passar5min();
    const r = await rodar('travamento', env());
    assert.match(r.saida, /AVISO pátio: ⏱ Carga 7701 · TSPpv01: 3h10min no pátio/, r.saida);
    assert.doesNotMatch(r.saida, /TSPpv02/, 'avisou uma carga que está dentro da meta');
    assert.deepEqual(estado().patioAvisadas, ['pv01']);
  });

  test('no minuto seguinte não confere de novo (a cada 5 min)', async () => {
    const r = await rodar('travamento', env());
    assert.doesNotMatch(r.saida, /pátio:/, r.saida);
  });

  test('5 min depois, a mesma carga continua acima: NÃO toca de novo', async () => {
    passar5min();
    const r = await rodar('travamento', env());
    assert.match(r.saida, /pátio: 1 carga\(s\) acima/);
    assert.doesNotMatch(r.saida, /AVISO pátio/, 'avisou de novo a mesma carga');
  });

  test('uma segunda carga cruza: avisa SÓ a segunda', async () => {
    await pool.query(
      `UPDATE ${ESQUEMA_PATIO}.fact_statusfrota SET data_evento = now() - interval '185 minutes' WHERE carga_id = 'pv02'`);
    passar5min();
    const r = await rodar('travamento', env());
    assert.match(r.saida, /AVISO pátio: ⏱ Carga 7702 · TSPpv02: 3h05min no pátio/, r.saida);
    assert.doesNotMatch(r.saida, /AVISO pátio: .*TSPpv01/);
    assert.deepEqual(estado().patioAvisadas.sort(), ['pv01', 'pv02']);
  });

  test('a carga que saiu deixa a memória — e o pátio não entra nos Vigias do sistema', async () => {
    await pool.query(`UPDATE ${ESQUEMA_PATIO}.fact_viagens SET status_atual = 'Seguiu Viagem' WHERE carga_id = 'pv01'`);
    passar5min();
    await rodar('travamento', env());
    assert.deepEqual(estado().patioAvisadas, ['pv02']);
    const { rows } = await pool.query("SELECT 1 FROM vigia_registros WHERE verificacao ILIKE '%patio%'");
    assert.equal(rows.length, 0, 'carga atrasada é operação, não defeito do servidor');
  });

  test('servidor travado: não confere o pátio (só a saúde importa ali)', async () => {
    passar5min();
    const r = await rodar('travamento', { ...env(), VIGIA_HEALTH_URL: urlMorta });
    assert.doesNotMatch(r.saida, /pátio:/);
  });
});

describe('Vigia 2 — diário (F4, F5, F3): backup de hoje, disco, certificado, dado', () => {
  let pastaBackup;
  let certBom;
  let certVencendo;

  before(() => {
    pastaBackup = path.join(tmp, 'backups');
    execFileSync('mkdir', ['-p', pastaBackup]);
    const gerar = (nome, dias) => {
      const arq = path.join(tmp, nome);
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=teste',
        '-days', String(dias), '-keyout', path.join(tmp, `${nome}.key`), '-out', arq], { stdio: 'ignore' });
      return arq;
    };
    certBom = gerar('bom.pem', 80);
    certVencendo = gerar('vencendo.pem', 10);
  });

  const env = (extra = {}) => ({ VIGIA_BACKUPS: pastaBackup, VIGIA_CERT: certBom, ...extra });

  test('sem backup nenhum: problema, e diz onde procurou', async () => {
    await rodar('diario', env());
    const a = await anotacao('backup_de_hoje');
    assert.equal(a.ok, false);
    assert.match(a.detalhe, /nenhum backup/);
  });

  test('backup de hoje com tamanho de backup: ok', async () => {
    writeFileSync(path.join(pastaBackup, 'embarque_suinco_20261002.sql.gz'), Buffer.alloc(300 * 1024, 1));
    const r = await rodar('diario', env());
    assert.match(r.saida, /AVISO melhorou/);
    assert.equal((await anotacao('backup_de_hoje')).ok, true);
  });

  test('backup de hoje VAZIO (o pg_dump falhou e o gzip gravou nada): problema', async () => {
    rmSync(pastaBackup, { recursive: true, force: true });
    execFileSync('mkdir', ['-p', pastaBackup]);
    writeFileSync(path.join(pastaBackup, 'embarque_suinco_20261002.sql.gz'), Buffer.alloc(20));
    await rodar('diario', env());
    const a = await anotacao('backup_de_hoje');
    assert.equal(a.ok, false);
    assert.match(a.detalhe, /vazio ou cortado/);
  });

  test('o mais novo é de 2 dias atrás (o cron parou): problema', async () => {
    const arq = path.join(pastaBackup, 'embarque_suinco_20261002.sql.gz');
    writeFileSync(arq, Buffer.alloc(300 * 1024, 1));
    const antes = new Date(Date.now() - 50 * 3600000);
    utimesSync(arq, antes, antes);
    await rodar('diario', env());
    const a = await anotacao('backup_de_hoje');
    assert.equal(a.ok, false);
    assert.match(a.detalhe, /não foi feito/);
  });

  test('certificado com 80 dias: ok; com 10 dias: problema ("a renovação automática falhou")', async () => {
    await rodar('diario', env());
    assert.equal((await anotacao('certificado')).ok, true);
    await rodar('diario', env({ VIGIA_CERT: certVencendo }));
    const a = await anotacao('certificado');
    assert.equal(a.ok, false);
    assert.match(a.detalhe, /renovação automática falhou/);
  });

  test('certificado que sumiu: problema, não silêncio', async () => {
    await rodar('diario', env({ VIGIA_CERT: path.join(tmp, 'nao-existe.pem') }));
    assert.match((await anotacao('certificado')).detalhe, /não achei o certificado/);
  });

  test('disco e dado são conferidos e anotados', async () => {
    await rodar('diario', env());
    assert.ok(await anotacao('disco'), 'o disco não foi anotado');
    const d = await anotacao('dado');
    assert.ok(d, 'a conferência do dado não foi anotada');
    assert.match(d.detalhe, /inconsist|×/);
  });
});

describe('Vigia 3 — semanal (F4, F5): o backup restaura; as bibliotecas', () => {
  test('restauração que presta: ok, com o veredito do próprio script', async () => {
    await rodar('semanal', {
      VIGIA_CMD_RESTAURA: 'echo "O BACKUP PRESTA. Restaurou inteiro, com os dados certos dentro."; exit 0',
      VIGIA_CMD_AUDIT: `echo '${JSON.stringify({ metadata: { vulnerabilities: { low: 1, moderate: 0, high: 0, critical: 0 } } })}'`,
    });
    const a = await anotacao('backup_restaura');
    assert.equal(a.ok, true);
    assert.match(a.detalhe, /O BACKUP PRESTA/);
    assert.equal((await anotacao('bibliotecas')).ok, true);
  });

  test('restauração que NÃO presta: problema e aviso', async () => {
    const r = await rodar('semanal', {
      VIGIA_CMD_RESTAURA: 'echo "O BACKUP NÃO PRESTA — 2 problema(s) grave(s)"; exit 1',
      VIGIA_CMD_AUDIT: `echo '${JSON.stringify({ metadata: { vulnerabilities: { high: 2, critical: 1 } } })}'`,
    });
    assert.match(r.saida, /AVISO piorou: ⚠️ Backup restaura/);
    assert.equal((await anotacao('backup_restaura')).ok, false);
    const b = await anotacao('bibliotecas');
    assert.equal(b.ok, false);
    assert.match(b.detalhe, /1 crítica\(s\) e 2 alta\(s\)/);
  });

  test('npm sem resposta (rede): NÃO vira aviso nem apaga a anotação anterior', async () => {
    const antes = await anotacao('bibliotecas');
    const r = await rodar('semanal', {
      VIGIA_CMD_RESTAURA: 'echo "O BACKUP NÃO PRESTA"; exit 1',
      VIGIA_CMD_AUDIT: 'echo "npm ERR! network" >&2; exit 1',
    });
    assert.doesNotMatch(r.saida, /AVISO.*bibliotecas|Falhas conhecidas/);
    const depois = await anotacao('bibliotecas');
    assert.equal(depois.detalhe, antes.detalhe);
  });
});

describe('Vigia 4 — a instalação: o cron que o instalar.sh escreve chama o vigia certo', () => {
  /* O vigia pode estar perfeito e nunca rodar: cron com modo errado, caminho
     errado, ou script fora da cópia que vai para o servidor. Aqui o trecho
     11b do instalar.sh roda de verdade, num diretório descartável no lugar
     de /etc, e o arquivo gerado é conferido linha por linha. */
  const instalar = readFileSync(path.join(BACKEND, 'instalar.sh'), 'utf8');

  test('o trecho 11b gera o cron com os três modos, o /health da porta do app e o certificado do domínio', async () => {
    const ini = instalar.indexOf('azul "11b. Vigias"');
    const fim = instalar.indexOf('ok "vigias agendados', ini);
    assert.ok(ini > 0 && fim > ini, 'o trecho 11b sumiu do instalar.sh');
    const raiz = mkdtempSync(path.join(tmpdir(), 'raiz-'));
    const trecho = instalar.slice(ini, fim)
      .replaceAll('/etc/cron.d/', `${raiz}/cron.d/`)
      .replaceAll('/etc/logrotate.d/', `${raiz}/logrotate.d/`)
      .replaceAll('/var/lib/embarque-suinco', `${raiz}/lib`);
    execFileSync('mkdir', ['-p', `${raiz}/cron.d`, `${raiz}/logrotate.d`]);
    const r = spawnSyncSh(`azul(){ :; }; PORTA_APP=3000; DOMINIO_API=api.exemplo.test; APP_DIR=/opt/embarque-suinco\n${trecho}`);
    assert.equal(r.status, 0, r.stderr);
    const cron = readFileSync(path.join(raiz, 'cron.d', 'embarque-suinco-vigia'), 'utf8');
    assert.match(readFileSync(path.join(raiz, 'logrotate.d', 'embarque-suinco-vigia'), 'utf8'), /rotate 4/);
    const modosNoCron = [...cron.matchAll(/vigia_servidor\.mjs (\w+)/g)].map((m) => m[1]).sort();
    const script = readFileSync(SCRIPT, 'utf8');
    const modosNoScript = (script.match(/const MODOS = \{([^}]*)\}/)[1]).split(',').map((x) => x.trim()).sort();
    assert.deepEqual(modosNoCron, modosNoScript, 'o cron chama um modo que o vigia não tem (ou esquece um)');
    assert.match(cron, /^VIGIA_HEALTH_URL=http:\/\/127\.0\.0\.1:3000\/health$/m);
    assert.match(cron, /^VIGIA_CERT=\/etc\/letsencrypt\/live\/api\.exemplo\.test\/fullchain\.pem$/m);
    assert.match(cron, /root cd \/opt\/embarque-suinco && node scripts\/vigia_servidor\.mjs travamento/);
    for (const linha of cron.split('\n').filter((l) => /^[*\d]/.test(l))) {
      assert.equal(linha.trim().split(/\s+/).length >= 7, true, `linha de cron malformada: ${linha}`);
    }
    rmSync(raiz, { recursive: true, force: true });
  });

  test('o script vai para o servidor: o rsync do instalar.sh não exclui scripts/', () => {
    const rsync = instalar.match(/rsync -a --delete[\s\S]*?"\$FONTE\/" "\$APP_DIR\/"/)[0];
    assert.doesNotMatch(rsync, /--exclude\s+scripts/);
  });

  test('o bloco COPIE DAQUI do atualizar_tudo.sh mostra os vigias', () => {
    const tudo = readFileSync(path.join(BACKEND, 'atualizar_tudo.sh'), 'utf8');
    assert.match(tudo, /echo "vigias\s+: \$VIGIAS"/);
    assert.match(tudo, /FROM vigia_registros/);
  });
});

function spawnSyncSh(codigo) {
  return spawnSyncBash0('bash', ['-c', codigo], { encoding: 'utf8' });
}
