#!/usr/bin/env node
/* Teste de carga: 30 pessoas mexendo ao mesmo tempo, sem pane.

   Pedido direto do usuário depois do incidente de 08/08/2026: "eu quero
   que isso aguente no mínimo 30 pessoas mexendo sem pane ao mesmo tempo".
   Não é teste unitário — é evidência de capacidade real, contra o
   ambiente local (Postgres descartável + backend em :3010), simulando o
   pior caso plausível: todo mundo abrindo o painel e trabalhando nele ao
   mesmo tempo, sem intervalo entre as ações.

   O que cada "usuário virtual" faz, em loop, por DURACAO_S segundos:
     - GET /api/estado (leitura completa — a mais pesada que existe: até
       5000+5000+2000 linhas serializadas)
     - GET /health
     - POST /api/frota (upsert na própria placa — grava de verdade, exercita
       o pool de conexão do banco sem depender de máquina de estado de carga)

   Uso:
     cd backend && node testes/carga_30_usuarios.js
     USUARIOS=50 DURACAO_S=20 node testes/carga_30_usuarios.js   # ajustável

   Critério de "aguenta sem pane": zero 5xx, zero erro de conexão/timeout,
   e p95 de latência abaixo de um teto generoso (2s — bem acima do que um
   operador tolera esperando, mas não é meta de performance, é o limiar de
   "começou a cair aos pedaços").
*/
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { pool } from '../src/banco.js';

const BASE = `http://127.0.0.1:${config.porta}`;
const USUARIOS = Number(process.env.USUARIOS || 30);
const DURACAO_S = Number(process.env.DURACAO_S || 15);
const SETORES_CICLO = ['Logística', 'Portaria', 'Expedição', 'Faturamento', 'Administração'];

function token(i) {
  return jwt.sign(
    { sub: `carga-teste-${i}`, nome: `Usuário Carga ${i}`, setor: SETORES_CICLO[i % SETORES_CICLO.length] },
    config.jwtSegredo,
    { expiresIn: '1h' }
  );
}

const latencias = [];
const erros = [];
const statusCount = {};
let totalReq = 0;

async function medir(url, opcoes) {
  const inicio = Date.now();
  totalReq++;
  try {
    const r = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - inicio;
    latencias.push(ms);
    statusCount[r.status] = (statusCount[r.status] || 0) + 1;
    if (r.status >= 500) erros.push(`${opcoes?.method || 'GET'} ${url} → ${r.status}`);
    return r;
  } catch (e) {
    latencias.push(Date.now() - inicio);
    statusCount.EXCECAO = (statusCount.EXCECAO || 0) + 1;
    erros.push(`${opcoes?.method || 'GET'} ${url} → EXCEÇÃO: ${e.message}`);
  }
}

async function usuarioVirtual(i, ateQuando) {
  const tk = token(i);
  const cab = { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' };
  const placa = `TST${1000 + i}`;
  let ciclo = 0;
  while (Date.now() < ateQuando) {
    ciclo++;
    await medir(`${BASE}/api/estado`, { headers: cab });
    await medir(`${BASE}/health`);
    if (SETORES_CICLO[i % SETORES_CICLO.length] === 'Logística' || SETORES_CICLO[i % SETORES_CICLO.length] === 'Administração') {
      await medir(`${BASE}/api/frota`, {
        method: 'POST', headers: cab,
        body: JSON.stringify({ placa, transportadora: 'Carga de Teste', tipoVeiculo: 'Truck', capacidadeKg: 8000 + ciclo, uf: 'SP' }),
      });
    }
    await new Promise((res) => setTimeout(res, 150 + Math.random() * 250));
  }
}

function percentil(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p)];
}

async function main() {
  console.log(`\n=== TESTE DE CARGA: ${USUARIOS} usuários simultâneos, ${DURACAO_S}s ===`);
  console.log(`Alvo: ${BASE}\n`);

  const ateQuando = Date.now() + DURACAO_S * 1000;
  const inicio = Date.now();
  await Promise.all(Array.from({ length: USUARIOS }, (_, i) => usuarioVirtual(i, ateQuando)));
  const duracaoReal = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log(`Duração real: ${duracaoReal}s`);
  console.log(`Total de requisições: ${totalReq}`);
  console.log(`Vazão: ${(totalReq / duracaoReal).toFixed(1)} req/s`);
  console.log(`Latência — média: ${(latencias.reduce((a, b) => a + b, 0) / latencias.length).toFixed(0)}ms · p95: ${percentil(latencias, 0.95)}ms · máx: ${Math.max(...latencias)}ms`);
  console.log(`Códigos de resposta: ${JSON.stringify(statusCount)}`);
  console.log(`Erros (5xx ou exceção): ${erros.length}`);
  if (erros.length) {
    console.log('Amostra de erros:');
    erros.slice(0, 10).forEach((e) => console.log('  - ' + e));
  }

  /* 429 sustentado é pane, não proteção funcionando. Foi exatamente isso
     que aconteceu em 08/08/2026: o servidor "não caiu" (nenhum 5xx), mas
     metade das pessoas não conseguia trabalhar — pra quem está no pátio,
     as duas coisas são idênticas. Por isso o critério de aprovação trata
     uma fatia grande de 429 como reprovação, não só erro 5xx. */
  const total429 = statusCount['429'] || 0;
  const taxa429 = total429 / totalReq;

  // Limpa as placas de teste — não deixa lixo no banco descartável.
  await pool.query("DELETE FROM dim_veiculos WHERE placa LIKE 'TST1%'");
  await pool.end();

  const p95 = percentil(latencias, 0.95);
  const passou = erros.length === 0 && p95 < 2000 && taxa429 < 0.01;
  console.log(`Taxa de 429 (limite de requisições): ${(taxa429 * 100).toFixed(1)}%`);
  console.log(`\n=== RESULTADO: ${passou ? 'AGUENTA' : 'NÃO AGUENTA'} ${USUARIOS} usuários simultâneos ===\n`);
  process.exit(passou ? 0 : 1);
}

main();
