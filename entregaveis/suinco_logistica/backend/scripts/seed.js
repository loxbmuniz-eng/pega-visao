#!/usr/bin/env node
/* Carrega a base de Frota (749 placas) e as 32 rotas oficiais no banco.

   Lê exatamente o mesmo `frota_seed_2026.csv` e a mesma lista de rotas que o
   painel usa hoje. Uma única fonte para os dois — se divergirem, a trava de
   frota do servidor recusa placas que a tela aceita, e ninguém entende o
   porquê.

   Idempotente: rodar de novo atualiza o que mudou e não duplica nada. É
   chamado pelo instalar.sh a cada atualização. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/banco.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/* Dois lugares possíveis, e os dois são legítimos:

   - No repositório, o CSV mora ao lado do painel (../../).
   - No servidor, o instalador copia só a pasta backend para /opt/embarque-suinco,
     e o CSV vai para o nível de cima ou para dentro dela, dependendo das
     permissões do destino.

   Procurar nos dois evita o modo de falha mais chato possível: instalação
   que termina "com sucesso" e um banco sem nenhuma placa, que só aparece
   quando a Logística tenta programar a primeira carga. */
const CAMINHOS_CSV = [
  path.join(AQUI, '..', '..', 'frota_seed_2026.csv'),
  path.join(AQUI, '..', 'frota_seed_2026.csv'),
];
const CSV = CAMINHOS_CSV.find((c) => fs.existsSync(c)) || CAMINHOS_CSV[0];

const ROTAS = [
  ['500', 'Patos de Minas', '', ''],
  ['501', 'São Gotardo', '', ''],
  ['502', 'Araxá', '', ''],
  ['503', 'Patrocínio / Coromandel', '', ''],
  ['504', 'Alto Paranaíba', 'Paracatu, Unaí, João Pinheiro, Arinos e Buritis', ''],
  ['505', 'Triângulo Mineiro', 'Uberlândia', ''],
  ['506', 'Uberaba', '', ''],
  ['507', 'Araguari', '', ''],
  ['508', 'Iturama', '', 'Total Service ou FrigoCargo'],
  ['509', 'Centro-Oeste', '', ''],
  ['510', 'Belo Horizonte', '', 'RP Logística'],
  ['512', 'Varginha', 'Sul de Minas', 'Brasfrios'],
  ['513', 'Passos', 'Sul de Minas', 'MaxFrios'],
  ['516', 'Norte de Minas', 'Montes Claros', 'Total Services'],
  ['517', 'Rio de Janeiro (Varejo)', 'São João de Meriti', 'OmegaX'],
  ['518', 'Rio de Janeiro (Redes)', 'Canejo', ''],
  ['519', 'Brasília (Varejo)', '', 'RN Logística'],
  ['520', 'Goiás (Varejo)', '', 'AG Sestini'],
  ['521', 'SP Ribeirão Preto', '', 'CargoFrio'],
  ['522', 'SP Capital', 'Osasco', 'SPM LOG'],
  ['523', 'Vale do Aço', 'Governador Valadares', 'SSLog'],
  ['524', 'Zona da Mata', 'Juiz de Fora', 'BSF Logística'],
  ['525', 'Bahia Capital', '', 'LogMaster'],
  ['527', 'Nordeste', '', ''],
  ['529', 'Espírito Santo', 'Serra-ES', 'Nacional Log'],
  ['531', 'Paraná', '', ''],
  ['532', 'Bahia Interior', 'Vitória da Conquista', 'ConquistaLog'],
  ['534', 'Salvador', '', 'LogMaster'],
  ['536', 'Goiás', '', 'AG Sestini'],
  ['538', 'SP Interior', 'Marília', 'CargoFrio'],
  ['540', 'Salvador', '', 'LogMaster'],
  ['541', 'Brasília (Redes)', '', 'Versatto Logística'],
];

function normalizarPlaca(v) {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* Parser de CSV que respeita aspas. O nome de transportadora tem vírgula
   ("Cooperativa dos Transportadores Unidos Ltda."), então split(',') seco
   quebraria a linha no lugar errado e embaralharia as colunas. */
function lerCSV(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const cabecalho = dividir(linhas[0]);
  return linhas.slice(1).map((l) => {
    const campos = dividir(l);
    return Object.fromEntries(cabecalho.map((c, i) => [c.trim(), (campos[i] ?? '').trim()]));
  });
}

function dividir(linha) {
  const saida = [];
  let atual = '';
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
    } else if (c === ',' && !dentroDeAspas) {
      saida.push(atual); atual = '';
    } else {
      atual += c;
    }
  }
  saida.push(atual);
  return saida;
}

async function main() {
  console.log('Rotas...');
  for (const [codigo, nome, detalhe, operador] of ROTAS) {
    await pool.query(
      `INSERT INTO dim_rotas (codigo, nome, detalhe, operador) VALUES ($1,$2,$3,$4)
       ON CONFLICT (codigo) DO UPDATE
         SET nome = EXCLUDED.nome, detalhe = EXCLUDED.detalhe, operador = EXCLUDED.operador`,
      [codigo, nome, detalhe, operador]
    );
  }
  console.log(`  ${ROTAS.length} rotas.`);

  if (!fs.existsSync(CSV)) {
    console.error('\nERRO: não encontrei o frota_seed_2026.csv. Procurei em:');
    CAMINHOS_CSV.forEach((c) => console.error('  ' + c));
    process.exit(1);
  }

  console.log('Frota...');
  const registros = lerCSV(fs.readFileSync(CSV, 'utf8'));
  let gravadas = 0;
  let ignoradas = 0;

  for (const r of registros) {
    const placa = normalizarPlaca(r.Placa);
    if (!placa) { ignoradas++; continue; }
    await pool.query(
      `INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, precisa_revisao, origem)
       VALUES ($1,$2,$3,$4,'seed')
       ON CONFLICT (placa) DO UPDATE
         SET transportadora  = EXCLUDED.transportadora,
             tipo_veiculo    = EXCLUDED.tipo_veiculo,
             precisa_revisao = EXCLUDED.precisa_revisao,
             atualizado_em   = now()`,
      [placa, r.Transportadora || '', r.TipoVeiculo || '',
       String(r.PrecisaRevisao || '').toLowerCase().startsWith('s')]
    );
    gravadas++;
  }

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM dim_veiculos');
  console.log(`  ${gravadas} placas processadas (${ignoradas} sem placa válida).`);
  console.log(`\nBase de Frota no banco: ${rows[0].n} placas.`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('\nERRO no seed:', e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
