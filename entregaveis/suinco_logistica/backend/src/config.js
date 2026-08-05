/* Configuração central. Tudo que muda entre a máquina do desenvolvedor e o
   VPS mora aqui, lido do .env — nada de host, senha ou segredo escrito no
   código. É a correção direta do achado "senha em texto puro" da auditoria.

   O servidor RECUSA subir se um segredo obrigatório estiver faltando ou
   fraco. Isso é deliberado: subir com JWT_SECRET vazio é pior do que não
   subir, porque parece que está funcionando. */

import dotenv from 'dotenv';
dotenv.config();

function obrigatorio(nome, minimo = 1) {
  const v = (process.env[nome] || '').trim();
  if (v.length < minimo) {
    console.error(
      `\nERRO DE CONFIGURAÇÃO: ${nome} ausente ou curto demais ` +
      `(mínimo ${minimo} caracteres).\n` +
      `Preencha em backend/.env — veja .env.exemplo.\n`
    );
    process.exit(1);
  }
  return v;
}

function lista(nome, padrao = '') {
  return (process.env[nome] || padrao)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  ambiente: process.env.NODE_ENV || 'production',
  porta: Number(process.env.PORT || 3000),

  banco: {
    // Sem SSL de propósito: o Postgres escuta só em localhost, no mesmo
    // servidor. TLS entre dois processos da mesma máquina não acrescenta
    // proteção e só acrescenta o que pode quebrar.
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'embarque_suinco',
    user: process.env.PGUSER || 'suinco',
    password: obrigatorio('PGPASSWORD'),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  },

  // 32 caracteres é o mínimo razoável para HS256. Um segredo curto torna o
  // JWT quebrável por força bruta, e aí o controle de setor no servidor —
  // que é o ganho principal desta migração — deixa de valer.
  jwtSegredo: obrigatorio('JWT_SECRET', 32),
  jwtValidade: process.env.JWT_VALIDADE || '12h',

  // Turno de pátio é longo; 12h evita o operador ser deslogado no meio.
  // Mais que isso vira risco em terminal compartilhado.

  // Origens autorizadas. Curinga aqui anularia o CORS.
  origens: lista('ORIGENS_PERMITIDAS', 'https://embarquesuinco.com.br'),

  // Token separado para o Power BI. Não é login de operador: é leitura de
  // views, sem permissão de escrever nada.
  biToken: (process.env.BI_TOKEN || '').trim(),

  limites: {
    // O pátio inteiro em hora de pico faz muito menos que isso. O teto
    // existe para conter script, não para atrapalhar operador.
    janelaMs: 60_000,
    porJanela: Number(process.env.RATE_LIMIT || 300),
    loginPorJanela: Number(process.env.RATE_LIMIT_LOGIN || 10),
  },
};

export const SETORES = [
  'Logística',
  'Portaria',
  'Expedição',
  'Faturamento',
  'Administração',
];
