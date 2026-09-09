/* AUDITORIA DE CONTROLE DE ACESSO — metodologia da skill
   testing-for-broken-access-control aplicada com token real de cada setor. */
import bcrypt from 'bcryptjs';
import { pool } from '../../src/banco.js';

const BASE = 'http://127.0.0.1:3010';
const SENHA = 'auditoria-de-acesso-123';
const SETORES = ['Logística','Portaria','Expedição','Faturamento','Administração',
  'Comercial','Controles Internos','Central de Notas',
  'Filial 105 BSB','Filial 106 BAHIA','Filial 107 ES'];

const tok = {};
const achados = [];
function reg(grav, o) { achados.push({ grav, ...o }); }

async function req(caminho, { metodo='GET', token, corpo, extra={} } = {}) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'content-type':'application/json',
      ...(token ? { authorization:`Bearer ${token}` } : {}), ...extra },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const t = await r.text();
  let j=null; try { j = JSON.parse(t); } catch {}
  return { status:r.status, json:j, texto:t };
}

const hash = await bcrypt.hash(SENHA, 4);
for (const s of SETORES) {
  const email = `aud.${s.replace(/[^a-z0-9]/gi,'').toLowerCase()}@auditoria.local`;
  await pool.query(
    `INSERT INTO operadores (email,nome,setor,senha_hash) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET setor=EXCLUDED.setor, senha_hash=EXCLUDED.senha_hash, ativo=TRUE`,
    [email, `Aud ${s}`, s, hash]);
  const r = await req('/auth/login', { metodo:'POST', corpo:{ email, senha:SENHA } });
  if (r.status !== 200) { console.log(`!! login falhou: ${s} → ${r.status} ${r.texto.slice(0,90)}`); continue; }
  tok[s] = r.json.token;
}
console.log(`tokens obtidos: ${Object.keys(tok).length}/${SETORES.length}\n`);

/* ---- 3. ESCALAÇÃO VERTICAL: gestão de operadores é só da Administração ---- */
console.log('=== 3. ESCALAÇÃO VERTICAL — /api/operadores ===');
for (const s of SETORES.filter(x=>x!=='Administração')) {
  if (!tok[s]) continue;
  const lista = await req('/api/operadores', { token: tok[s] });
  const cria = await req('/api/operadores', { metodo:'POST', token: tok[s],
    corpo:{ email:`invasor.${Date.now()}@auditoria.local`, nome:'Invasor', setor:'Administração', senha:'senha-comprida-1' }});
  const ok = lista.status === 403 && cria.status === 403;
  console.log(`  ${ok?'ok   ':'FALHA'} ${s.padEnd(20)} listar=${lista.status} criar=${cria.status}`);
  if (!ok) reg('CRÍTICO', { teste:'vertical/operadores', setor:s, listar:lista.status, criar:cria.status });
}

/* ---- 5. NÍVEL DE FUNÇÃO: sem token e com token inválido ---- */
console.log('\n=== 5. NÍVEL DE FUNÇÃO — sem autenticação ===');
const PROTEGIDAS = [
  ['GET','/api/estado'], ['GET','/api/operadores'], ['GET','/api/devolucoes'],
  ['GET','/api/programacao-do-dia'], ['GET','/api/cargas-excluidas'],
  ['POST','/api/cargas'], ['POST','/api/relatorios/pdf'], ['GET','/api/montagem'],
  ['GET','/api/modelo-semana'], ['GET','/api/devolucoes-cadastros/clientes'],
];
for (const [metodo, e] of PROTEGIDAS) {
  const sem = await req(e, { metodo, corpo: metodo==='POST' ? {} : undefined });
  const invalido = await req(e, { metodo, token:'nao.e.um.token.valido', corpo: metodo==='POST' ? {} : undefined });
  const ok = sem.status===401 && invalido.status===401;
  console.log(`  ${ok?'ok   ':'FALHA'} ${(metodo+' '+e).padEnd(42)} sem=${sem.status} inválido=${invalido.status}`);
  if (!ok) reg('CRÍTICO', { teste:'sem-auth', rota:e, sem:sem.status, invalido:invalido.status });
}

/* ---- 4+6. HORIZONTAL / MULTI-INQUILINO: filial só vê o que é dela ---- */
console.log('\n=== 4+6. ISOLAMENTO ENTRE FILIAIS ===');
const HOJE = new Date().toISOString().slice(0,10);
const { rows: rotaRows } = await pool.query('SELECT codigo FROM dim_rotas LIMIT 1');
const ROTA = rotaRows[0]?.codigo;
const dev = {};
for (const f of ['Filial 105 BSB','Filial 106 BAHIA']) {
  const r = await req('/api/devolucoes', { metodo:'POST', token: tok[f],
    corpo:{ dataDev:HOJE, rotas:[ROTA], regiao:'AUDITORIA', itens:[{ nota:'999', cx:1, peso:10, codProduto:'X' }] }});
  if (r.status !== 201 && r.status !== 200) { console.log(`  !! ${f} não criou checklist: ${r.status} ${r.texto.slice(0,120)}`); continue; }
  dev[f] = r.json.id;
}
if (dev['Filial 105 BSB'] && dev['Filial 106 BAHIA']) {
  const alvo = dev['Filial 106 BAHIA'];
  const ler = await req(`/api/devolucoes/${alvo}`, { token: tok['Filial 105 BSB'] });
  console.log(`  ${ler.status===404?'ok   ':'FALHA'} 105 lê checklist da 106 direto → ${ler.status} (esperado 404)`);
  if (ler.status!==404) reg('CRÍTICO', { teste:'IDOR entre filiais', status:ler.status });

  const lista = await req('/api/devolucoes', { token: tok['Filial 105 BSB'] });
  const alheios = (lista.json||[]).filter(d => d.criadaSetor && d.criadaSetor!=='Filial 105 BSB');
  console.log(`  ${alheios.length===0?'ok   ':'FALHA'} listagem da 105 traz ${(lista.json||[]).length} checklist(s), ${alheios.length} de outro setor`);
  if (alheios.length) reg('CRÍTICO', { teste:'vazamento na listagem', alheios:alheios.length });

  const etapa = await req(`/api/devolucoes/${dev['Filial 105 BSB']}/etapa`, {
    metodo:'POST', token: tok['Filial 105 BSB'], corpo:{ para:'Recebida na Portaria' }});
  console.log(`  ${etapa.status===403?'ok   ':'FALHA'} filial avança etapa do próprio checklist → ${etapa.status} (esperado 403)`);
  if (etapa.status!==403) reg('ALTO', { teste:'filial avança etapa', status:etapa.status });

  const edit = await req(`/api/devolucoes/${alvo}`, { metodo:'PATCH', token: tok['Filial 105 BSB'], corpo:{ regiao:'INVADIDO' }});
  console.log(`  ${[403,404].includes(edit.status)?'ok   ':'FALHA'} 105 edita checklist da 106 → ${edit.status} (esperado 403/404)`);
  if (![403,404].includes(edit.status)) reg('CRÍTICO', { teste:'escrita entre filiais', status:edit.status });
}

/* ---- 6b. TROCA DE INQUILINO POR CABEÇALHO E POR CORPO ---- */
console.log('\n=== 6b. TROCA DE SETOR POR CABEÇALHO / CORPO ===');
const porHeader = await req('/api/devolucoes', { token: tok['Filial 105 BSB'],
  extra:{ 'x-setor':'Administração', 'x-tenant-id':'Filial 106 BAHIA' }});
const qtdH = (porHeader.json||[]).filter(d=>d.criadaSetor && d.criadaSetor!=='Filial 105 BSB').length;
console.log(`  ${qtdH===0?'ok   ':'FALHA'} cabeçalho x-setor/x-tenant-id não muda o escopo (${qtdH} alheio)`);
if (qtdH) reg('CRÍTICO', { teste:'troca de inquilino por cabeçalho', alheios:qtdH });

/* ---- MASS ASSIGNMENT: subir o próprio setor ---- */
console.log('\n=== MASS ASSIGNMENT — subir o próprio setor ===');
const eu = await req('/auth/eu', { token: tok['Portaria'] });
const meuId = eu.json?.operador?.id;
if (meuId) {
  const sobe = await req(`/api/operadores/${meuId}`, { metodo:'PATCH', token: tok['Portaria'], corpo:{ setor:'Administração' }});
  console.log(`  ${sobe.status===403?'ok   ':'FALHA'} Portaria se promove a Administração → ${sobe.status} (esperado 403)`);
  if (sobe.status!==403) reg('CRÍTICO', { teste:'auto-promoção', status:sobe.status });
} else { console.log('  ?? não consegui /auth/eu:', eu.status); }

/* ---- TOKEN DE LEITURA (BI / BOT) ESCREVE? ---- */
console.log('\n=== TOKENS DE LEITURA (BI / BOT) ===');
const { rows: cfg } = await pool.query("SELECT 1");
for (const [nome, valor] of [['BI_TOKEN', process.env.BI_TOKEN], ['BOT_TOKEN', process.env.BOT_TOKEN]]) {
  if (!valor) { console.log(`  --    ${nome} não configurado neste ambiente`); continue; }
  const escreve = await req('/api/cargas', { metodo:'POST', token: valor, corpo:{ placa:'AAA1A11', numeroCarga:'X' }});
  console.log(`  ${escreve.status>=400?'ok   ':'FALHA'} ${nome} tentando criar carga → ${escreve.status}`);
  if (escreve.status<400) reg('CRÍTICO', { teste:'token de leitura escreve', token:nome, status:escreve.status });
}

console.log('\n' + '='.repeat(60));
console.log(achados.length === 0 ? 'NENHUM ACHADO — todos os testes passaram.'
  : `${achados.length} ACHADO(S):\n` + achados.map(a=>`  [${a.grav}] ${JSON.stringify(a)}`).join('\n'));
await pool.query("DELETE FROM devolucoes WHERE regiao = 'AUDITORIA'");
await pool.query("DELETE FROM operadores WHERE email LIKE '%@auditoria.local'");
await pool.end();
