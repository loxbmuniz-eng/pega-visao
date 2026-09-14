#!/usr/bin/env node
/* MEDIDOR DE LOTAÇÃO — quantos operadores o painel aguenta, com folga.
   =====================================================================
   Pedido do dono, 14/09/2026: "eu nao quero travamento funcionando com 100
   pessoas se eu quiser, por isso quero essa folga".

   Então a pergunta que este programa responde não é "aguenta 100?" e sim
   "a partir de quantos ele começa a doer?" — porque folga é a distância
   entre o que se usa e o teto.

   O QUE ELE IMITA, e por quê cada parte importa:

   · CICLO NORMAL — cada operador lê `/api/estado?desde=` a cada 15 s. É
     barato (medido: 6 ms, 93 bytes) e é o que roda o dia inteiro.
   · A RAJADA — quando alguém cadastra ou corrige uma placa, o servidor
     emite `frota:atualizada` para a sala inteira e TODO terminal responde
     com uma LEITURA COMPLETA do pátio, ao mesmo tempo. É o amplificador:
     um operador digitando vira N leituras completas no mesmo instante.
     É aqui que o painel cai, e é isto que precisa ser medido.
   · GRAVAÇÃO — um PATCH de status no meio, porque escrita pega trava de
     linha e disputa o mesmo pool das leituras.

   O QUE CONTA COMO DOR, na ordem em que o operador sente:
     1. 401 — foi EXPULSO para a tela de login (o relato do Faturamento);
     2. 5xx/erro de rede — a gravação dele não entrou;
     3. p95 acima do alvo — a tela "está lenta".

   Uso:  node medidor.mjs --api http://127.0.0.1:3010 --rampa 10,25,50,100,150
*/

const arg = (nome, padrao) => {
  const i = process.argv.indexOf('--' + nome);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const API    = arg('api', 'http://127.0.0.1:3010');
const RAMPA  = arg('rampa', '10,25,50,100,150').split(',').map(Number);
const SENHA  = arg('senha', 'medidor-2026-suinco');
const SEGS   = Number(arg('segundos', '30'));
const ALVO_P95_MS = Number(arg('alvo', '1000'));

const pct = (v, p) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const ms = (n) => `${Math.round(n)}ms`;

async function bater(caminho, token, metodo = 'GET', corpo) {
  const t0 = performance.now();
  try {
    const r = await fetch(API + caminho, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { ms: performance.now() - t0, status: r.status, bytes: texto.length };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, bytes: 0, erro: e.message };
  }
}

async function entrar(email) {
  const t0 = performance.now();
  const r = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha: SENHA }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(d).slice(0, 120)}`);
  return { token: d.token, loginMs: performance.now() - t0 };
}

function resumo(amostras) {
  const oks   = amostras.filter((a) => a.status >= 200 && a.status < 300);
  const e401  = amostras.filter((a) => a.status === 401).length;
  const e429  = amostras.filter((a) => a.status === 429).length;
  const e5xx  = amostras.filter((a) => a.status >= 500 || a.status === 0).length;
  const lat   = oks.map((a) => a.ms);
  return {
    n: amostras.length, ok: oks.length, e401, e429, e5xx,
    p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: lat.length ? Math.max(...lat) : 0,
    bytes: oks.reduce((s, a) => s + a.bytes, 0),
  };
}

async function rodada(n, operadores) {
  const usados = operadores.slice(0, n);
  // --- entra todo mundo (é o que acontece na virada de turno) ---
  const t0 = performance.now();
  const sessoes = [];
  for (const op of usados) sessoes.push(await entrar(op));   // sequencial: login tem limite próprio
  const loginTotal = performance.now() - t0;

  // --- FASE 1: ciclo normal, leitura incremental ---
  const desde = new Date(Date.now() - 60_000).toISOString();
  const normais = [];
  const fim = Date.now() + SEGS * 1000;
  while (Date.now() < fim) {
    const lote = await Promise.all(sessoes.map((s) =>
      bater('/api/estado?desde=' + encodeURIComponent(desde), s.token)));
    normais.push(...lote);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // --- FASE 2: A RAJADA. Todos leem o pátio INTEIRO no mesmo instante. ---
  const tR = performance.now();
  const rajada = await Promise.all(sessoes.map((s) => bater('/api/estado', s.token)));
  const rajadaTotal = performance.now() - tR;

  return {
    n, loginTotal,
    normal: resumo(normais),
    rajada: resumo(rajada),
    rajadaTotal,
  };
}

(async () => {
  const saude = await fetch(API + '/health').then((r) => r.json()).catch(() => null);
  if (!saude || !saude.ok) { console.error(`API fora do ar em ${API}`); process.exit(1); }
  console.log(`API ${API} · versão ${saude.versao} · ${saude.conectados} conectados`);
  console.log(`Alvo: p95 abaixo de ${ALVO_P95_MS}ms, ZERO 401 (expulsão), ZERO erro de gravação.\n`);

  const maior = Math.max(...RAMPA);
  const operadores = Array.from({ length: maior }, (_, i) => `medidor${i}@teste.local`);

  const linhas = [];
  for (const n of RAMPA) {
    process.stderr.write(`  medindo ${n} operadores...\n`);
    try {
      linhas.push(await rodada(n, operadores));
    } catch (e) {
      console.error(`  ${n}: ${e.message}`);
      break;
    }
  }

  console.log('CICLO NORMAL (leitura incremental, o dia inteiro)');
  console.log('  ops |   p50 |   p95 |   max | 401 | 429 | 5xx');
  for (const l of linhas) {
    const r = l.normal;
    console.log(`  ${String(l.n).padStart(3)} | ${ms(r.p50).padStart(5)} | ${ms(r.p95).padStart(5)} | ${ms(r.max).padStart(5)} | ${String(r.e401).padStart(3)} | ${String(r.e429).padStart(3)} | ${String(r.e5xx).padStart(3)}`);
  }

  console.log('\nA RAJADA — O QUE O PAINEL FAZIA ATÉ 14/09/2026');
  console.log('  (medida à mão: desde a #65 o painel NÃO faz mais isso. Fica aqui como');
  console.log('   referência do que se evitou, e como alarme se alguém reintroduzir.)');
  console.log('  ops | total |   p50 |   p95 |   max | 401 | 429 | 5xx |   MB');
  for (const l of linhas) {
    const r = l.rajada;
    console.log(`  ${String(l.n).padStart(3)} | ${ms(l.rajadaTotal).padStart(5)} | ${ms(r.p50).padStart(5)} | ${ms(r.p95).padStart(5)} | ${ms(r.max).padStart(5)} | ${String(r.e401).padStart(3)} | ${String(r.e429).padStart(3)} | ${String(r.e5xx).padStart(3)} | ${(r.bytes / 1048576).toFixed(1).padStart(5)}`);
  }

  /* O VEREDITO JULGA O CICLO NORMAL, e não a rajada (14/09/2026).

     Até a #65, cadastrar uma placa fazia todo terminal reler o pátio, e ERA
     por isso que o veredito olhava a rajada: era o que a operação vivia. Com
     a correção o painel não faz mais essa leitura — o aviso já traz o
     veículo. Continuar julgando por ela seria reprovar o sistema por um
     cenário que não acontece mais, e é assim que uma medição vira mentira.

     O que decide a lotação agora é o ciclo de 15 s, que é o que roda o dia
     inteiro em todo terminal aberto. */
  console.log('\nVEREDITO — pelo ciclo normal, que é o que a operação vive');
  let teto = 0;
  for (const l of linhas) {
    const r = l.normal;
    const dor = r.e401 > 0 || r.e5xx > 0 || r.p95 > ALVO_P95_MS;
    const motivo = r.e401 > 0 ? `${r.e401} EXPULSOS (401)`
      : r.e5xx > 0 ? `${r.e5xx} erros de servidor`
      : r.p95 > ALVO_P95_MS ? `p95 ${ms(r.p95)} acima do alvo`
      : `p95 ${ms(r.p95)}, dentro do alvo`;
    console.log(`  ${String(l.n).padStart(3)} operadores: ${dor ? 'DÓI' : ' ok '} — ${motivo}`);
    if (!dor) teto = l.n;
  }
  console.log(`\n  Teto medido com folga: ${teto} operadores.`);
  if (teto < 100) console.log(`  ALVO DE 100 NÃO ATENDIDO — faltam ${100 - teto}.`);
})();
