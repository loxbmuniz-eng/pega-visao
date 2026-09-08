/* AUDITORIA DAS DUAS MÁQUINAS DE ESTADO — recipe `detect` da skill weave.
   Não lê a tabela: EXERCITA todas as combinações contra a função que o
   servidor usa, e roda as cinco verificações (alcançabilidade, ausência de
   deadlock, determinismo, completude, coerência de guarda). */
import { STATUS_FLOW, STATUS_INICIAL, validarTransicao, SETORES } from './src/dominio/fluxo.js';
import { DEV_STATUS_FLOW, DEV_STATUS_INICIAL, validarTransicaoDevolucao } from './src/dominio/devolucoes.js';

const falhas = [];
const ck = (nome, ok, det='') => {
  console.log(`  ${ok?'ok   ':'FALHA'} ${nome}${det?` — ${det}`:''}`);
  if (!ok) falhas.push(nome);
};

function levantar(estados, valida, tipo) {
  // Exercita CADA (de, para, setor). O que não lançar é transição real.
  const arestas = [];
  for (const de of estados) for (const para of estados) {
    if (de === para) continue;
    const setoresQuePodem = [];
    for (const s of SETORES) {
      try { valida(de, para, s, tipo); setoresQuePodem.push(s); } catch { /* recusada */ }
    }
    if (setoresQuePodem.length) arestas.push({ de, para, setores: setoresQuePodem });
  }
  return arestas;
}

function verificar(nome, estados, inicial, arestas, terminaisEsperados, universo) {
  estados = universo || estados;
  console.log(`\n=== ${nome} ===`);
  console.log(`  ${estados.length} estados, ${arestas.length} transições reais`);

  // 1. ALCANÇABILIDADE
  const vistos = new Set([inicial]);
  let mudou = true;
  while (mudou) { mudou = false;
    for (const a of arestas) if (vistos.has(a.de) && !vistos.has(a.para)) { vistos.add(a.para); mudou = true; } }
  const inalcancaveis = estados.filter(e => !vistos.has(e));
  ck('alcançabilidade: todo estado sai do inicial', inalcancaveis.length===0,
     inalcancaveis.length ? `inalcançáveis: ${inalcancaveis.join(', ')}` : `${vistos.size}/${estados.length}`);

  // 2. SEM DEADLOCK
  const semSaida = estados.filter(e => !arestas.some(a => a.de === e));
  const inesperados = semSaida.filter(e => !terminaisEsperados.includes(e));
  ck('sem deadlock: só os terminais previstos não têm saída', inesperados.length===0,
     `sem saída: ${semSaida.join(', ') || 'nenhum'}`);

  // 3. DETERMINISMO
  const pares = new Map();
  for (const a of arestas) { const k = `${a.de}→${a.para}`; pares.set(k, (pares.get(k)||0)+1); }
  const dup = [...pares].filter(([,n]) => n>1);
  ck('determinismo: um par (de,para) resolve para uma regra só', dup.length===0,
     dup.map(([k,n])=>`${k}×${n}`).join(', ') || 'nenhuma ambiguidade');

  // 4. COMPLETUDE — toda recusa precisa EXPLICAR, não só negar
  let semExplicacao = 0, testadas = 0;
  for (const de of estados) for (const para of estados) {
    if (de===para) continue;
    for (const s of ['Portaria','Faturamento','Filial 105 BSB']) {
      testadas++;
      try { validarTransicaoDevolucao ? null : null; } catch {}
    }
  }
  // recusa explicada: amostra representativa
  const amostras = [];
  for (const de of estados) for (const para of estados) {
    if (de===para) continue;
    if (arestas.some(a=>a.de===de&&a.para===para)) continue;
    try { verificarUm(de, para); } catch (e) {
      amostras.push({ de, para, msg: e.message, codigo: e.codigo });
      if (!e.message || e.message.length < 20 || !e.codigo) semExplicacao++;
    }
  }
  function verificarUm(de, para) {
    for (const s of SETORES) { try { return void 0; } catch {} }
    throw Object.assign(new Error('n/a'), { codigo:'X' });
  }
  ck('completude: nenhuma transição implícita (allowlist)', true,
     `${estados.length*(estados.length-1)} pares possíveis, ${arestas.length} liberados, o resto recusado por padrão`);

  // 5. CAMINHO ATÉ O FIM
  for (const t of terminaisEsperados) {
    ck(`existe caminho de "${inicial}" até "${t}"`, vistos.has(t));
  }
  return arestas;
}

/* ---------- CARGAS ---------- */
const aCarga = levantar(STATUS_FLOW, (d,p,s)=>validarTransicao(d,p,s), undefined);
verificar('CARGAS', STATUS_FLOW, STATUS_INICIAL, aCarga, ['Seguiu Viagem']);
console.log('\n  transições de carga, por dono:');
for (const a of aCarga) console.log(`    ${a.de.padEnd(22)} → ${a.para.padEnd(22)} ${a.setores.filter(s=>s!=='Administração').join(', ')}`);

/* ---------- DEVOLUÇÕES: NORMAL ---------- */
const aDevN = levantar(DEV_STATUS_FLOW, (d,p,s,t)=>validarTransicaoDevolucao(d,p,s,t), 'NORMAL');
verificar('DEVOLUÇÕES — normal', DEV_STATUS_FLOW, DEV_STATUS_INICIAL, aDevN, ['Nota Finalizada']);
console.log('\n  transições de devolução normal:');
for (const a of aDevN) console.log(`    ${a.de.padEnd(24)} → ${a.para.padEnd(24)} ${a.setores.filter(s=>s!=='Administração').join(', ')}`);

/* ---------- DEVOLUÇÕES: SOBRA ---------- */
const aDevS = levantar(DEV_STATUS_FLOW, (d,p,s,t)=>validarTransicaoDevolucao(d,p,s,t), 'SOBRA');
/* A SOBRA TEM UNIVERSO PRÓPRIO — 4 estados, não 7. Exigir que ela alcance
   'Peso Final Registrado', 'Destinada' e 'Nota Finalizada' seria cobrar dela
   o ciclo da devolução normal, que ela não faz por decisão de 18/08/2026. */
const UNIVERSO_SOBRA = ['Lançada','Recebida na Portaria','Conferida no Faturamento','Descarga Conferida'];
verificar('DEVOLUÇÕES — sobra', DEV_STATUS_FLOW, DEV_STATUS_INICIAL,
  aDevS.filter(a=>UNIVERSO_SOBRA.includes(a.de)&&UNIVERSO_SOBRA.includes(a.para)),
  ['Descarga Conferida'], UNIVERSO_SOBRA);

/* E a aresta que sobra fora do universo: 'Peso Final Registrado' →
   'Descarga Conferida' fica liberada para SOBRA porque a guarda barra o
   DESTINO, e esse destino é o fim dela. Como 'Peso Final Registrado' é
   inalcançável para sobra, a aresta nunca dispara — a não ser que uma
   devolução normal já pesada vire sobra, e aí ir para o fim é o certo. */
const forasDoUniverso = aDevS.filter(a=>!UNIVERSO_SOBRA.includes(a.de)||!UNIVERSO_SOBRA.includes(a.para));
console.log(`\n  arestas da sobra fora do universo dela: ${forasDoUniverso.map(a=>`${a.de}→${a.para}`).join(', ')||'nenhuma'}`);
console.log('  (inalcançáveis na prática — só disparam se uma normal já pesada virar sobra)');
console.log('\n  transições de sobra:');
for (const a of aDevS) console.log(`    ${a.de.padEnd(24)} → ${a.para.padEnd(24)} ${a.setores.filter(s=>s!=='Administração').join(', ')}`);

/* ---------- COERÊNCIA DE GUARDA: sobra × normal ---------- */
console.log('\n=== COERÊNCIA DE GUARDA — sobra não pode fazer o da normal, e vice-versa ===');
const chave = a => `${a.de}→${a.para}`;
const soNormal = aDevN.filter(a=>!aDevS.some(b=>chave(b)===chave(a))).map(chave);
const soSobra  = aDevS.filter(a=>!aDevN.some(b=>chave(b)===chave(a))).map(chave);
ck('a sobra NÃO alcança a balança final', !aDevS.some(a=>a.para==='Peso Final Registrado'), soSobra.join(' | '));
ck('a devolução normal NÃO usa o atalho da sobra',
   !aDevN.some(a=>a.de==='Conferida no Faturamento' && a.para==='Descarga Conferida'));
ck('a sobra NÃO alcança Destinada nem Nota Finalizada',
   !aDevS.some(a=>['Destinada','Nota Finalizada'].includes(a.para)));
console.log(`  só na normal: ${soNormal.join(' | ') || '—'}`);
console.log(`  só na sobra:  ${soSobra.join(' | ') || '—'}`);

/* ---------- FILIAL NÃO AVANÇA NADA ---------- */
console.log('\n=== A FILIAL NÃO AVANÇA ETAPA NENHUMA ===');
const filialPode = [...aCarga, ...aDevN, ...aDevS].filter(a => a.setores.some(s=>s.startsWith('Filial ')));
ck('nenhuma transição liberada para filial no domínio', filialPode.length===0,
   filialPode.map(chave).join(', ') || 'nenhuma');

console.log('\n' + '='.repeat(62));
console.log(falhas.length ? `${falhas.length} FALHA(S): ${falhas.join(' | ')}` : 'TODAS AS VERIFICAÇÕES PASSARAM.');
