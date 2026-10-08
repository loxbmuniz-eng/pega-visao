/* scripts/gravar_senha_usuarios.sh — a senha da aba Usuários entra no .env
   como HASH, sem tocar no resto (08/10/2026, pedido do dono).

   Roda contra um .env de mentira, com um /health de mentira, e prova o
   critério de cada passo: só a linha da senha muda, a senha não aparece
   na tela nem no arquivo, senha curta ou diferente não entra, e servidor
   que não volta devolve o .env como estava.

   Rode com:  npm run teste */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';

const SCRIPT = new URL('../scripts/gravar_senha_usuarios.sh', import.meta.url).pathname;
const APP_DIR = new URL('..', import.meta.url).pathname;
const SENHA = 'senha-da-aba-de-teste-9';
// Termina SEM quebra de linha de propósito: é o caso em que o hash grudaria.
const ORIGINAL = 'PGPASSWORD=senha-do-banco\nJWT_SECRET=0123456789abcdef0123456789abcdef\nSENTRY_DSN=';

let pasta;
let saude;
let respondeOk = true;
let estado = 'ligada';
let semCampo = false;   // /health de um servidor que ainda não tem o código da senha

before(async () => {
  pasta = await fs.mkdtemp(path.join(tmpdir(), 'senha-usuarios-'));
  saude = http.createServer((pedido, resposta) => {
    resposta.writeHead(respondeOk ? 200 : 503, { 'content-type': 'application/json' });
    resposta.end(!respondeOk ? '{"ok":false}'
      : semCampo ? '{"ok":true,"banco":"conectado"}' : `{"ok":true,"travaUsuarios":"${estado}"}`);
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

function rodar(envFile, entrada, args = [], extra = {}) {
  return new Promise((resolve) => {
    const filho = spawn('bash', [SCRIPT, ...args], {
      env: { ...process.env, ENV_FILE: envFile, APP_DIR, SAUDE_URL: `http://127.0.0.1:${saude.address().port}/health`,
             REINICIAR: 'true', ESPERA_S: '2', ...extra },
    });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('close', (codigo) => resolve({ codigo, saida }));
    filho.stdin.end(entrada);
  });
}

const hashGravado = (conteudo) => {
  const m = conteudo.match(/^SENHA_USUARIOS_HASH=(.+)$/m);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
};

describe('gravar_senha_usuarios.sh', () => {
  test('grava SÓ o hash, em base64, e nenhuma outra linha muda; a senha não aparece na tela nem no arquivo', async () => {
    respondeOk = true; semCampo = false; estado = 'ligada';
    const env = await envNovo();
    const r = await rodar(env, `${SENHA}\n${SENHA}\n`);
    assert.equal(r.codigo, 0, r.saida);
    const depois = await fs.readFile(env, 'utf8');
    assert.ok(depois.startsWith(`${ORIGINAL}\nSENHA_USUARIOS_HASH=`), depois);
    assert.equal(depois.split('\n').filter((l) => l.startsWith('SENHA_USUARIOS_HASH=')).length, 1);
    assert.match(depois.match(/^SENHA_USUARIOS_HASH=(.+)$/m)[1], /^[A-Za-z0-9+/]+={0,2}$/, 'base64: o bash do rodar_tudo.sh não come o "$"');
    assert.ok(bcrypt.compareSync(SENHA, hashGravado(depois)), 'o hash confere com a senha digitada');
    assert.ok(!depois.includes(SENHA) && !r.saida.includes(SENHA), 'a senha não fica em lugar nenhum');
    assert.equal((await fs.stat(env)).mode & 0o777, 0o600, 'a permissão do .env continua 600');
    assert.equal(await fs.readFile(`${env}.antes-da-senha-usuarios`, 'utf8'), ORIGINAL, 'a cópia é o .env de antes');
    assert.match(r.saida, /trava da aba Usuários: ligada/);
  });

  test('senha curta ou as duas diferentes: NADA é gravado', async () => {
    respondeOk = true; semCampo = false; estado = 'ligada';
    for (const entrada of ['curta\ncurta\n', `${SENHA}\n${SENHA}x\n`]) {
      const env = await envNovo();
      const r = await rodar(env, entrada);
      assert.equal(r.codigo, 1, r.saida);
      assert.match(r.saida, /Nada foi gravado/);
      assert.equal(await fs.readFile(env, 'utf8'), ORIGINAL);
      await assert.rejects(fs.access(`${env}.antes-da-senha-usuarios`), 'nem a cópia é feita');
    }
  });

  test('troca a senha que já existia — continua UMA linha só', async () => {
    respondeOk = true; semCampo = false; estado = 'ligada';
    const velho = Buffer.from(bcrypt.hashSync('a-senha-de-antes', 4)).toString('base64');
    const env = await envNovo(`${ORIGINAL}\nSENHA_USUARIOS_HASH=${velho}\n`);
    const r = await rodar(env, `${SENHA}\n${SENHA}\n`);
    assert.equal(r.codigo, 0, r.saida);
    const depois = await fs.readFile(env, 'utf8');
    assert.equal(depois.split('\n').filter((l) => l.startsWith('SENHA_USUARIOS_HASH=')).length, 1);
    assert.ok(bcrypt.compareSync(SENHA, hashGravado(depois)));
    assert.ok(!depois.includes(velho));
  });

  test('"desligar" tira a linha, e o resto fica', async () => {
    respondeOk = true; semCampo = false; estado = 'desligada';
    const env = await envNovo(`${ORIGINAL}\nSENHA_USUARIOS_HASH=QUJD\n`);
    const r = await rodar(env, '', ['desligar']);
    assert.equal(r.codigo, 0, r.saida);
    assert.equal(await fs.readFile(env, 'utf8'), `${ORIGINAL}\n`);
    assert.match(r.saida, /trava da aba Usuários: desligada/);
  });

  test('servidor ainda sem o código da senha: diz para rodar o atualizar_tudo.sh, e a senha fica gravada', async () => {
    respondeOk = true; semCampo = true;
    const env = await envNovo();
    const r = await rodar(env, `${SENHA}\n${SENHA}\n`);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /atualizar_tudo\.sh/);
    assert.ok(bcrypt.compareSync(SENHA, hashGravado(await fs.readFile(env, 'utf8'))));
    semCampo = false;
  });

  test('servidor que não volta: o .env volta a ser o de antes', async () => {
    respondeOk = false;
    const env = await envNovo();
    const r = await rodar(env, `${SENHA}\n${SENHA}\n`);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /devolvendo o \.env como estava/);
    assert.equal(await fs.readFile(env, 'utf8'), ORIGINAL);
    respondeOk = true;
  });
});
