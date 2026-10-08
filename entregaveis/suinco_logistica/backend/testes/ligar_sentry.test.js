/* scripts/ligar_sentry.sh — a chave do Sentry entra no .env sem tocar no resto
   (08/10/2026, decisão 27).

   O .env do servidor guarda a senha do banco e a chave do login; uma linha
   perdida e o servidor não sobe. O script é a alternativa a "abra o .env
   num editor e cole". Aqui ele roda contra um .env de mentira, com um
   /health de mentira, e o que se prova é o critério de cada passo:
   só as linhas do Sentry mudam, chave torta não entra, e servidor que não
   volta devolve o .env como estava.

   Rode com:  npm run teste */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../scripts/ligar_sentry.sh', import.meta.url).pathname;
const DSN_S = 'https://abc123@o9.ingest.us.sentry.io/4507001';
const DSN_P = 'https://def456@o9.ingest.us.sentry.io/4507002';
// Termina SEM quebra de linha de propósito: é o caso em que a chave grudaria.
const ORIGINAL = 'PGPASSWORD=senha-do-banco\nJWT_SECRET=0123456789abcdef0123456789abcdef\nVAPID_PRIVADA=xyz';

let pasta;
let saude;
let respondeOk = true;
let semCampo = false;   // /health de um servidor que ainda não tem o código do Sentry

before(async () => {
  pasta = await fs.mkdtemp(path.join(tmpdir(), 'ligar-sentry-'));
  saude = http.createServer((pedido, resposta) => {
    resposta.writeHead(respondeOk ? 200 : 503, { 'content-type': 'application/json' });
    resposta.end(!respondeOk ? '{"ok":false}'
      : semCampo ? '{"ok":true,"banco":"conectado"}' : '{"ok":true,"sentry":{"servidor":true,"painel":true}}');
  });
  await new Promise((r) => saude.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise((r) => saude.close(r));
  await fs.rm(pasta, { recursive: true, force: true });
});

async function envNovo(conteudo = ORIGINAL) {
  const arq = path.join(pasta, `env-${Math.random().toString(36).slice(2)}`);
  await fs.writeFile(arq, conteudo);
  await fs.chmod(arq, 0o600);
  return arq;
}

function rodar(envFile, entrada, extra = {}) {
  return new Promise((resolve) => {
    const filho = spawn('bash', [SCRIPT], {
      env: { ...process.env, ENV_FILE: envFile, SAUDE_URL: `http://127.0.0.1:${saude.address().port}/health`,
             REINICIAR: 'true', ESPERA_S: '2', ...extra },
    });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('close', (codigo) => resolve({ codigo, saida }));
    filho.stdin.end(entrada);
  });
}

describe('ligar_sentry.sh', () => {
  test('grava as duas chaves e NENHUMA outra linha muda (nem a última, sem quebra de linha)', async () => {
    respondeOk = true;
    const env = await envNovo();
    const r = await rodar(env, `${DSN_S}\n${DSN_P}\n`);
    assert.equal(r.codigo, 0, r.saida);
    const depois = await fs.readFile(env, 'utf8');
    assert.equal(depois, `${ORIGINAL}\nSENTRY_DSN=${DSN_S}\nSENTRY_DSN_PAINEL=${DSN_P}\n`);
    assert.equal((await fs.stat(env)).mode & 0o777, 0o600, 'a permissão do .env continua 600');
    assert.equal(await fs.readFile(`${env}.antes-do-sentry`, 'utf8'), ORIGINAL, 'a cópia é o .env de antes');
    assert.match(r.saida, /erros do servidor\): ligado/);
    assert.match(r.saida, /erros da tela\)\s+: ligado/);
  });

  test('chave torta NÃO entra: pede de novo, e só grava a certa', async () => {
    respondeOk = true;
    const env = await envNovo();
    const r = await rodar(env, `https://sentry.io/sem-chave\nabc\n${DSN_S}\n\n`);
    assert.equal(r.codigo, 0, r.saida);
    assert.equal((r.saida.match(/não tem a forma de um DSN/g) || []).length, 2);
    const depois = await fs.readFile(env, 'utf8');
    assert.ok(!depois.includes('sem-chave') && !/^abc$/m.test(depois));
    assert.equal(depois, `${ORIGINAL}\nSENTRY_DSN=${DSN_S}\n`, 'Enter vazio no painel: só a do servidor');
  });

  test('rodar de novo TROCA a chave (não duplica); "desligar" tira as duas linhas', async () => {
    respondeOk = true;
    const env = await envNovo(`${ORIGINAL}\nSENTRY_DSN=https://velha1@o9.ingest.us.sentry.io/1\nSENTRY_DSN_PAINEL=https://velha2@o9.ingest.us.sentry.io/2\n`);
    await rodar(env, `${DSN_S}\n${DSN_P}\n`);
    let depois = await fs.readFile(env, 'utf8');
    assert.equal((depois.match(/^SENTRY_DSN=/gm) || []).length, 1);
    assert.ok(!depois.includes('velha'));
    await rodar(env, 'desligar\n');
    depois = await fs.readFile(env, 'utf8');
    assert.ok(!/SENTRY_DSN/.test(depois), depois);
    assert.ok(depois.startsWith(ORIGINAL), 'o resto continua igual');
  });

  test('servidor que não volta: o .env de antes é devolvido e o script diz isso', async () => {
    respondeOk = false;
    const env = await envNovo();
    const r = await rodar(env, `${DSN_S}\n${DSN_P}\n`);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /devolvendo o \.env como estava/);
    assert.equal(await fs.readFile(env, 'utf8'), ORIGINAL, 'o .env voltou ao que era');
    respondeOk = true;
  });

  test('servidor ainda sem o código do Sentry: a chave fica gravada e ele diz para rodar o atualizar_tudo.sh', async () => {
    respondeOk = true;
    semCampo = true;
    try {
      const env = await envNovo();
      const r = await rodar(env, `${DSN_S}\n\n`);
      assert.equal(r.codigo, 1);
      assert.match(r.saida, /rode o atualizar_tudo\.sh/);
      assert.ok((await fs.readFile(env, 'utf8')).includes(`SENTRY_DSN=${DSN_S}`));
    } finally {
      semCampo = false;
    }
  });

  test('sem permissão de gravar o .env, não faz nada', async () => {
    const r = await rodar(path.join(pasta, 'nao-existe', '.env'), `${DSN_S}\n`);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /não achei/);
  });
});
