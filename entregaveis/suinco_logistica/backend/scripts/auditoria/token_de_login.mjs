/* AUDITORIA DO TOKEN DE LOGIN — skill testing-jwt-token-security.
   Forja tokens de propósito e confere que o servidor recusa todos. */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './src/banco.js';
import { config } from './src/config.js';

const BASE='http://127.0.0.1:3010', SENHA='auditoria-jwt-123';
const falhas=[];
const ck=(n,ok,d='')=>{ console.log(`  ${ok?'ok   ':'FALHA'} ${n}${d?` — ${d}`:''}`); if(!ok) falhas.push(n); };
async function chamar(token){
  const r=await fetch(BASE+'/api/estado',{headers:token?{authorization:`Bearer ${token}`}:{}});
  return r.status;
}

const hash=await bcrypt.hash(SENHA,4);
await pool.query(`INSERT INTO operadores (email,nome,setor,senha_hash) VALUES ($1,$2,$3,$4)
  ON CONFLICT (email) DO UPDATE SET setor=EXCLUDED.setor, senha_hash=EXCLUDED.senha_hash, ativo=TRUE`,
  ['aud.jwt@auditoria.local','Aud JWT','Portaria',hash]);
const login=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:'aud.jwt@auditoria.local',senha:SENHA})});
const { token } = await login.json();
const claims = jwt.decode(token);
console.log('=== TOKEN LEGÍTIMO ===');
console.log(`  claims: ${JSON.stringify(claims)}`);
ck('token válido é aceito', await chamar(token)===200);
ck('tem validade (exp)', !!claims.exp, claims.exp ? new Date(claims.exp*1000).toISOString() : 'SEM EXP');
ck('segredo tem 32+ caracteres', config.jwtSegredo.length>=32, `${config.jwtSegredo.length} chars`);

console.log('\n=== TOKENS FORJADOS ===');
// 1. alg none
const semAlg = Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')
  + '.' + Buffer.from(JSON.stringify({...claims, setor:'Administração'})).toString('base64url') + '.';
ck('alg:none é recusado', await chamar(semAlg)===401, `→ ${await chamar(semAlg)}`);

// 2. assinado com segredo errado
const outroSegredo = jwt.sign(claims, 'segredo-completamente-diferente-de-32-chars', {algorithm:'HS256'});
ck('assinatura com outro segredo é recusada', await chamar(outroSegredo)===401);

// 3. payload adulterado, assinatura original
const [h,,sig] = token.split('.');
const adulterado = h + '.' + Buffer.from(JSON.stringify({...claims, setor:'Administração'})).toString('base64url') + '.' + sig;
ck('payload adulterado com assinatura velha é recusado', await chamar(adulterado)===401);

// 4. expirado
const expirado = jwt.sign({...claims, exp: Math.floor(Date.now()/1000)-60}, config.jwtSegredo, {algorithm:'HS256'});
ck('token expirado é recusado', await chamar(expirado)===401);

// 5. confusão de algoritmo (HS x RS)
try {
  const rs = jwt.sign(claims, config.jwtSegredo, {algorithm:'HS512'});
  const st = await chamar(rs);
  ck('algoritmo diferente do esperado é recusado', st===401, `HS512 → ${st}`);
} catch { ck('algoritmo diferente do esperado é recusado', true, 'nem assinou'); }

console.log('\n=== OPERADOR BLOQUEADO ===');
await pool.query("UPDATE operadores SET ativo=FALSE WHERE email='aud.jwt@auditoria.local'");
const st = await chamar(token);
ck('token de operador BLOQUEADO deixa de valer na hora', st===401, `→ ${st}`);

console.log('\n'+'='.repeat(58));
console.log(falhas.length ? `${falhas.length} FALHA(S): ${falhas.join(' | ')}` : 'TODAS AS VERIFICAÇÕES PASSARAM.');
await pool.query("DELETE FROM operadores WHERE email LIKE '%@auditoria.local'");
await pool.end();
