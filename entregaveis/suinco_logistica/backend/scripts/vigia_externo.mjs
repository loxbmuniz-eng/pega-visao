#!/usr/bin/env node
/* =====================================================================
   O VIGIA DE FORA — roda no GitHub, nunca no servidor que ele vigia
   ---------------------------------------------------------------------
   Pedido do dono (02/10/2026): "no raio-X, tudo que fala 'se quebrar', você
   vai criar uma prevenção de quebra pra cada possibilidade apontada".

   Duas perguntas, dois modos:

   --publicado <index.html>
       "O que o portão acabou de publicar é o que está no ar?"
       Até hoje quem conferia era uma pessoa olhando o Vercel depois do
       portão — controle que dependia de memória. Aqui: espera o site servir
       o MESMO carimbo de build do arquivo publicado (SUINCO_BUILD_EM, único
       por build) e então abre o site num navegador de verdade e exige que a
       tela suba sem erro de JavaScript. Site que não troca de versão em 15
       minutos, ou que troca e quebra, reprova.

   --no-ar
       "O painel e o servidor estão de pé AGORA?" — a cada 30 minutos.
       O site responde e é o painel; o /health do servidor responde ok com o
       banco conectado. Três tentativas, com intervalo, antes de reprovar:
       um soluço de rede às 3h da manhã não pode virar alarme, senão o
       alarme vira barulho e ninguém mais olha.

   POR QUE NO GITHUB. Nada que roda dentro do VPS pode ser o alarme do VPS
   (docs/ALERTA_DE_QUEDA.md): se a máquina cai, o vigia cai junto e o
   silêncio dele parece "tudo bem". Este roda na infraestrutura do GitHub.
   Quando reprova, o GitHub manda e-mail ao dono do repositório.

   Saída: 0 = tudo certo; 1 = reprovou (o motivo vai na última linha).

   SITE e API podem ser trocados por variável de ambiente — é assim que o
   teste (testes/test_vigia_externo.py) aponta para servidores locais e
   prova que o vigia reprova quando deve.
   ===================================================================== */
import { readFileSync } from 'node:fs';

const SITE = (process.env.VIGIA_SITE || 'https://embarquesuinco.com.br/').replace(/\/?$/, '/');
const API = (process.env.VIGIA_API || 'https://api.embarquesuinco.com.br').replace(/\/$/, '');
const ESPERA_MAX_MS = Number(process.env.VIGIA_ESPERA_MS || 15 * 60 * 1000);
const INTERVALO_MS = Number(process.env.VIGIA_INTERVALO_MS || 20 * 1000);
const TENTATIVAS = Number(process.env.VIGIA_TENTATIVAS || 3);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function carimbo(html) {
  const m = String(html).match(/window\.SUINCO_BUILD_EM\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

async function baixar(url) {
  // `no-store` e um parâmetro novo a cada vez: a pergunta é o que o site
  // serve AGORA, não o que algum cache guardou há dez minutos.
  const sep = url.includes('?') ? '&' : '?';
  const r = await fetch(`${url}${sep}vigia=${Date.now()}`, {
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, corpo: await r.text() };
}

async function abrirNoNavegador() {
  const { chromium } = await import('playwright');
  const nav = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  try {
    const pg = await nav.newPage();
    const erros = [];
    pg.on('pageerror', (e) => erros.push(e.message));
    await pg.goto(SITE, { waitUntil: 'load', timeout: 60000 });
    await pg.waitForTimeout(3000);
    const tela = await pg.evaluate(() => ({
      painel: typeof window.renderAll === 'function',
      login: !!document.getElementById('modal-operador'),
      carimbo: window.SUINCO_BUILD_EM || null,
    }));
    return { erros, tela };
  } finally {
    await nav.close();
  }
}

async function publicado(arquivo) {
  const esperado = carimbo(readFileSync(arquivo, 'utf8'));
  if (!esperado) return `o arquivo publicado (${arquivo}) não tem carimbo de build`;
  console.log(`esperando o site servir o build ${esperado}`);
  const fim = Date.now() + ESPERA_MAX_MS;
  let visto = null;
  for (;;) {
    try {
      const r = await baixar(SITE);
      visto = r.status === 200 ? carimbo(r.corpo) : `HTTP ${r.status}`;
      if (visto === esperado) break;
    } catch (e) {
      visto = `sem resposta (${e.message})`;
    }
    if (Date.now() >= fim) {
      return `em ${Math.round(ESPERA_MAX_MS / 60000)} min o site não passou a servir o build publicado — esperado ${esperado}, no ar ${visto}`;
    }
    await dormir(INTERVALO_MS);
  }
  console.log('o site serve o build publicado; abrindo no navegador');
  const { erros, tela } = await abrirNoNavegador();
  if (erros.length) return `a tela publicada abre com erro de JavaScript: ${erros.slice(0, 3).join(' | ')}`;
  if (!tela.painel || !tela.login) return `a tela publicada não montou o painel (${JSON.stringify(tela)})`;
  if (tela.carimbo !== esperado) return `o navegador recebeu outro build (${tela.carimbo}) — cache?`;
  return null;
}

async function noAr() {
  let motivo = null;
  for (let i = 1; i <= TENTATIVAS; i++) {
    motivo = null;
    try {
      const site = await baixar(SITE);
      if (site.status !== 200) motivo = `o site respondeu HTTP ${site.status}`;
      else if (!carimbo(site.corpo)) motivo = 'o site respondeu, mas não é o painel (sem carimbo de build)';
    } catch (e) {
      motivo = `o site não respondeu (${e.message})`;
    }
    if (!motivo) {
      try {
        const r = await baixar(`${API}/health`);
        let j = {};
        try { j = JSON.parse(r.corpo); } catch { /* corpo não é JSON */ }
        if (r.status !== 200 || j.ok !== true) {
          motivo = `o servidor respondeu /health com HTTP ${r.status}` + (j.banco ? ` (banco: ${j.banco})` : '');
        }
      } catch (e) {
        motivo = `o servidor não respondeu /health (${e.message})`;
      }
    }
    if (!motivo) return null;
    console.log(`tentativa ${i} de ${TENTATIVAS}: ${motivo}`);
    if (i < TENTATIVAS) await dormir(INTERVALO_MS);
  }
  return motivo;
}

const [modo, arg] = process.argv.slice(2);
let motivo;
if (modo === '--publicado' && arg) motivo = await publicado(arg);
else if (modo === '--no-ar') motivo = await noAr();
else {
  console.error('uso: vigia_externo.mjs --publicado <index.html> | --no-ar');
  process.exit(2);
}
if (motivo) {
  console.log(`REPROVOU: ${motivo}`);
  process.exit(1);
}
console.log(modo === '--no-ar' ? 'OK: o painel e o servidor estão no ar' : 'OK: o build publicado está no ar e a tela abre sem erro');
