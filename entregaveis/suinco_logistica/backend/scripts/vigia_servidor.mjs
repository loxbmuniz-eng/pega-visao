#!/usr/bin/env node
/* =====================================================================
   O VIGIA DE DENTRO — o que o servidor confere sobre si mesmo
   ---------------------------------------------------------------------
   Pedido do dono (02/10/2026): "no raio-X, tudo que fala 'se quebrar', você
   vai criar uma prevenção de quebra pra cada possibilidade apontada".

   Instalado pelo instalar.sh em /etc/cron.d/embarque-suinco-vigia. Roda
   como root, de dentro de /opt/embarque-suinco (é de lá que vem o .env).

     travamento  (a cada minuto)  — F2. O systemd reinicia o servidor que
                 MORRE; não reinicia o que TRAVA (de pé, sem responder).
                 Três minutos seguidos sem /health → reinicia e avisa.
                 Teto de 3 reinícios por hora: se nem assim volta, reiniciar
                 de novo só esconde o problema — avisa e deixa para gente.
     diario      (1×/dia, de manhã) — F4, F5, F3. O backup de hoje existe e
                 tem tamanho de backup; o disco tem folga; o certificado não
                 vence nos próximos 20 dias; a conferência do dado (só
                 leitura) não acha estado impossível.
     semanal     (domingo de madrugada) — F4, F5. O backup RESTAURA (o mesmo
                 testar_restauracao_backup.sh do atualizar_tudo, num banco
                 descartável que ele mesmo apaga); as bibliotecas não têm
                 falha conhecida alta ou crítica.

   AVISO: no celular de quem é da Administração, na VIRADA — quando fica
   ruim e quando volta ao normal. Ver servicos/vigia.js (anotar).

   O QUE ESTE VIGIA NÃO VÊ, e por isso existe o de fora (vigia_externo.mjs,
   no GitHub): a máquina inteira caída, e o banco fora — sem banco ele não
   tem onde anotar nem para quem avisar (as inscrições do celular moram no
   banco). Nesses dois casos quem grita é o de fora.

   Tudo que toca o sistema pode ser trocado por variável de ambiente, para
   o teste (testes/test_vigia_servidor.py) provar cada decisão com fakes —
   inclusive que ele NÃO reinicia o que não deve.
   ===================================================================== */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const E = process.env;
const SERVICO = E.VIGIA_SERVICO || 'embarque-suinco';
const HEALTH = E.VIGIA_HEALTH_URL || 'http://127.0.0.1:3000/health';
const ESTADO = E.VIGIA_ESTADO || '/var/lib/embarque-suinco/vigia.json';
const CMD_ATIVO = E.VIGIA_CMD_ATIVO || `systemctl is-active ${SERVICO}`;
const CMD_REINICIAR = E.VIGIA_CMD_REINICIAR || `systemctl restart ${SERVICO}`;
const BACKUPS = E.VIGIA_BACKUPS || '/var/backups/embarque-suinco';
const CERT = E.VIGIA_CERT || '/etc/letsencrypt/live/api.embarquesuinco.com.br/fullchain.pem';
const DISCO = E.VIGIA_DISCO || '/';
const CMD_RESTAURA = E.VIGIA_CMD_RESTAURA
  || `bash ${path.join(process.cwd(), 'scripts', 'testar_restauracao_backup.sh')}`;
const CMD_AUDIT = E.VIGIA_CMD_AUDIT || 'npm audit --omit=dev --json';

const FALHAS_PARA_REINICIAR = 3;
const REINICIOS_POR_HORA = 3;
const DISCO_LIMITE = 85;           // %
const CERT_DIAS_MINIMO = 20;       // o certbot renova com 30 de folga
const BACKUP_IDADE_MAX_H = 26;     // diário + folga do horário do cron
const BACKUP_TAMANHO_MIN = 100 * 1024;

const sh = (cmd) => spawnSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: 20 * 60 * 1000 });
const hora = (d = new Date()) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* Banco e aviso só são carregados quando precisam: o vigia de travamento
   roda a cada minuto e, com o servidor saudável, quase nunca abre conexão. */
let _ctx = null;
async function ctx() {
  if (!_ctx) {
    const { pool } = await import('../src/banco.js');
    const vigia = await import('../src/servicos/vigia.js');
    const avisos = await import('../src/servicos/avisos.js');
    _ctx = { pool, vigia, avisos };
  }
  return _ctx;
}

async function registrar(verificacao, ok, detalhe) {
  const { pool, vigia, avisos } = await ctx();
  const virada = await vigia.anotar(pool, verificacao, ok, detalhe);
  log(`${verificacao}: ${ok ? 'ok' : 'PROBLEMA'} — ${detalhe}${virada ? ` (${virada})` : ''}`);
  if (virada) {
    const nome = vigia.NOMES[verificacao] || verificacao;
    const msg = {
      titulo: virada === 'piorou' ? `⚠️ ${nome}` : `✅ ${nome}: normalizou`,
      corpo: detalhe,
      tag: `vigia:${verificacao}`,
      url: '/',
    };
    console.log(`AVISO ${virada}: ${msg.titulo} — ${msg.corpo}`);
    await avisos.enviarParaSetores(['Administração'], msg);
  }
  return virada;
}

function lerEstado() {
  try { return JSON.parse(readFileSync(ESTADO, 'utf8')); } catch { return { falhas: 0, reinicios: [] }; }
}
function gravarEstado(s) {
  mkdirSync(path.dirname(ESTADO), { recursive: true });
  writeFileSync(ESTADO, JSON.stringify(s));
}

async function perguntarHealth() {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(10000) });
    let j = {};
    try { j = await r.json(); } catch { /* sem JSON */ }
    return { respondeu: true, status: r.status, ok: r.status === 200 && j.ok === true };
  } catch {
    return { respondeu: false };
  }
}

/* ---------------------------------------------------------------- P2 */
async function travamento() {
  const ativo = sh(CMD_ATIVO).stdout.trim();
  /* PARADO DE PROPÓSITO NÃO É TRAVADO. Durante o atualizar.sh o serviço é
     parado e subido; morto por erro, o systemd já reinicia sozinho. O vigia
     só age no caso que ninguém mais cobre: "active" e mudo. */
  if (ativo !== 'active') {
    log(`serviço ${SERVICO} está "${ativo}" — não é travamento, não mexo`);
    return;
  }
  const est = lerEstado();
  const h = await perguntarHealth();
  if (h.respondeu && h.ok) {
    est.falhas = 0;
    /* Saudável, ele só abre o banco quando precisa: na volta de um problema
       (para avisar "normalizou") ou a cada 10 min, para a hora de "conferido
       às" na tela não envelhecer. Os outros 9 minutos não custam conexão. */
    const velho = !est.anotadoEm || Date.now() - est.anotadoEm > 10 * 60 * 1000;
    if (est.ultimoAnotado !== 'ok' || velho) {
      await registrar('travamento', true, `respondendo (conferido às ${hora()})`);
      est.ultimoAnotado = 'ok';
      est.anotadoEm = Date.now();
    }
    gravarEstado(est);
    return;
  }
  if (h.respondeu && h.status === 503) {
    /* O processo está de pé e diz que o BANCO não responde. Reiniciar o
       servidor não conserta banco; e sem banco não há onde anotar nem para
       quem avisar. Fica no registro do sistema; quem grita é o vigia de
       fora (GitHub), que vê o /health 503. */
    log('o /health respondeu 503 (banco fora) — não reinicio o servidor por isso');
    est.falhas = 0;
    gravarEstado(est);
    return;
  }
  est.falhas = (est.falhas || 0) + 1;
  log(`sem resposta do /health (${est.falhas}ª seguida)`);
  if (est.falhas < FALHAS_PARA_REINICIAR) { gravarEstado(est); return; }

  const umaHora = Date.now() - 3600 * 1000;
  est.reinicios = (est.reinicios || []).filter((t) => t > umaHora);
  if (est.reinicios.length >= REINICIOS_POR_HORA) {
    est.ultimoAnotado = 'falha';
    gravarEstado(est);
    await registrar('travamento', false,
      `travado e já reiniciado ${est.reinicios.length} vezes na última hora — não reinicio mais sozinho, precisa de gente olhar`);
    return;
  }
  const r = sh(CMD_REINICIAR);
  est.reinicios.push(Date.now());
  est.falhas = 0;
  est.ultimoAnotado = 'falha';
  gravarEstado(est);
  await registrar('travamento', false, r.status === 0
    ? `ficou ${FALHAS_PARA_REINICIAR} min sem responder e foi reiniciado sozinho às ${hora()}`
    : `ficou ${FALHAS_PARA_REINICIAR} min sem responder e o reinício FALHOU: ${(r.stderr || '').trim().slice(0, 200)}`);
}

/* ------------------------------------------------------------- diário */
function backupDeHoje() {
  let arqs = [];
  try {
    arqs = readdirSync(BACKUPS).filter((f) => f.endsWith('.sql.gz'))
      .map((f) => ({ f, s: statSync(path.join(BACKUPS, f)) }))
      .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
  } catch { /* pasta não existe */ }
  if (!arqs.length) return [false, `nenhum backup em ${BACKUPS}`];
  const novo = arqs[0];
  const idadeH = (Date.now() - novo.s.mtimeMs) / 3600000;
  const mb = (novo.s.size / 1048576).toFixed(1);
  if (idadeH > BACKUP_IDADE_MAX_H) return [false, `o backup mais novo tem ${Math.round(idadeH)} h — o de hoje não foi feito (${novo.f})`];
  if (novo.s.size < BACKUP_TAMANHO_MIN) return [false, `o backup de hoje tem só ${novo.s.size} bytes — saiu vazio ou cortado (${novo.f})`];
  return [true, `${novo.f}, ${mb} MB, feito há ${Math.round(idadeH)} h`];
}

function disco() {
  const r = sh(`df -P ${DISCO}`);
  const linha = (r.stdout || '').trim().split('\n').pop() || '';
  const uso = Number((linha.match(/(\d+)%/) || [])[1]);
  if (!Number.isFinite(uso)) return [false, `não consegui ler o espaço em disco (${linha || r.stderr})`];
  return uso >= DISCO_LIMITE
    ? [false, `${uso}% do disco em uso — o limite de alerta é ${DISCO_LIMITE}%`]
    : [true, `${uso}% em uso`];
}

function certificado() {
  if (!existsSync(CERT)) return [false, `não achei o certificado em ${CERT}`];
  let fim;
  try {
    fim = execFileSync('openssl', ['x509', '-enddate', '-noout', '-in', CERT], { encoding: 'utf8' })
      .trim().replace(/^notAfter=/, '');
  } catch (e) {
    return [false, `não consegui ler o certificado (${e.message.slice(0, 120)})`];
  }
  const dias = Math.floor((new Date(fim).getTime() - Date.now()) / 86400000);
  if (!Number.isFinite(dias)) return [false, `data de validade ilegível: ${fim}`];
  const quando = new Date(fim).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return dias < CERT_DIAS_MINIMO
    ? [false, `vence em ${dias} dia(s) (${quando}) e não foi renovado — a renovação automática falhou`]
    : [true, `válido até ${quando} (${dias} dias)`];
}

async function diario() {
  for (const [nome, fn] of [['backup_de_hoje', backupDeHoje], ['disco', disco], ['certificado', certificado]]) {
    const [ok, detalhe] = fn();
    await registrar(nome, ok, detalhe);
  }
  const { pool, vigia } = await ctx();
  const achados = await vigia.auditarDado(pool);
  const total = achados.reduce((s, a) => s + a.quantidade, 0);
  await registrar('dado', total === 0, vigia.resumoDoDado(achados));
}

/* ------------------------------------------------------------ semanal */
async function semanal() {
  const r = sh(CMD_RESTAURA);
  const saida = `${r.stdout || ''}${r.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  const veredito = (saida.match(/O BACKUP[^\n]*/g) || []).pop() || saida.trim().split('\n').pop() || '';
  await registrar('backup_restaura', r.status === 0, veredito.slice(0, 300) || `saiu com código ${r.status}`);

  const a = sh(CMD_AUDIT);
  let j = null;
  try { j = JSON.parse(a.stdout); } catch { /* sem JSON */ }
  const v = j && j.metadata && j.metadata.vulnerabilities;
  if (!v) {
    /* Sem resposta do registro do npm (rede, fora do ar) não é falha das
       bibliotecas — é "não deu para conferir". Não vira aviso; fica no log
       e a anotação anterior continua valendo até a próxima semana. */
    log(`bibliotecas: não consegui conferir (npm audit sem resposta legível) — ${(a.stderr || '').trim().slice(0, 200)}`);
    return;
  }
  const graves = (v.high || 0) + (v.critical || 0);
  await registrar('bibliotecas', graves === 0, graves === 0
    ? `nenhuma falha alta ou crítica (${v.moderate || 0} moderada(s), ${v.low || 0} baixa(s))`
    : `${v.critical || 0} crítica(s) e ${v.high || 0} alta(s) — precisa de uma publicação com as bibliotecas atualizadas`);
}

const modo = process.argv[2];
const MODOS = { travamento, diario, semanal };
if (!MODOS[modo]) {
  console.error('uso: vigia_servidor.mjs travamento | diario | semanal');
  process.exit(2);
}
let codigo = 0;
try {
  await MODOS[modo]();
} catch (e) {
  log(`o vigia "${modo}" falhou: ${e.message}`);
  codigo = 1;
} finally {
  if (_ctx) await _ctx.pool.end().catch(() => {});
}
process.exit(codigo);
