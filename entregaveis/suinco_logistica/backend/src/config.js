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

  /* Token do robô de WhatsApp (n8n). Mesma ideia do BI_TOKEN e pelo mesmo
     motivo: automação não deve carregar senha de operador. Ela lê o resumo
     do dia e o PDF do relatório, e não tem como escrever nada — se o token
     vazar, o estrago possível é alguém ler o andamento do pátio. */
  botToken: (process.env.BOT_TOKEN || '').trim(),

  // Caminho do binário do Chromium usado pra gerar PDF de relatório
  // (backend/src/rotas/relatorios.js). Em produção fica vazio: o
  // Playwright usa o Chromium que `npx playwright install chromium`
  // instalou (ver instalar.sh). Só é preciso preencher em ambiente de
  // desenvolvimento/teste onde a revisão exata que o Playwright espera
  // não bate com a já instalada na máquina.
  playwrightChromiumPath: (process.env.PLAYWRIGHT_CHROMIUM_PATH || '').trim() || undefined,

  /* Senha mestre para FECHAR a programação havendo carga em aberto.

     Não é login: é a confirmação de uma decisão de operação (encerrar o
     ciclo com caminhão ainda no pátio). Escolha do usuário em 11/08/2026,
     ciente de que uma senha compartilhada circula pelo grupo — o log
     registra quem estava logado no momento, e o fechamento fica marcado
     como `forcado` na tabela `programacoes`.

     Vazia = ninguém consegue forçar; nesse caso o fechamento com carga em
     aberto é recusado com uma mensagem dizendo o que configurar. */
  senhaFechamento: (process.env.SENHA_FECHAMENTO || '').trim(),

  /* AVISO NO CELULAR (26/08/2026).

     As duas chaves do padrão VAPID, que é como o navegador confere que
     quem mandou a notificação é este servidor e não um estranho que
     descobriu o endereço de inscrição de alguém.

     GERAR UMA VEZ, NO SERVIDOR, e nunca mais:
         cd /opt/embarque-suinco && npx web-push generate-vapid-keys
     A pública vai em VAPID_PUBLICA, a privada em VAPID_PRIVADA, no .env.

     A PRIVADA É SEGREDO de verdade: quem a tem manda notificação em nome
     do painel para qualquer aparelho inscrito. Ela nunca sai do .env do
     servidor — não passa por conversa, não vai para o repositório.

     TROCAR AS CHAVES DESINSCREVE TODO MUNDO. A inscrição que cada celular
     guardou é amarrada à chave pública que ele viu no dia; com outra, o
     envio passa a ser recusado. Se um dia for preciso trocar, a tabela
     push_inscricoes tem que ser esvaziada junto e todos reativam o aviso.

     VAZIAS = FUNÇÃO DESLIGADA, e desligada de propósito: o painel mostra
     "avisos indisponíveis" e o resto do sistema roda exatamente igual.
     Um pátio inteiro não pode parar porque uma notificação não configurou. */
  avisos: {
    chavePublica: (process.env.VAPID_PUBLICA || '').trim(),
    chavePrivada: (process.env.VAPID_PRIVADA || '').trim(),
    // Exigido pelo padrão: um contato para o serviço de push (Google,
    // Apple) alcançar o dono do servidor se algo estiver errado.
    contato: (process.env.VAPID_CONTATO || 'mailto:lo.xbmuniz@gmail.com').trim(),
  },

  limites: {
    // O pátio inteiro em hora de pico faz muito menos que isso. O teto
    // existe para conter script, não para atrapalhar operador.
    janelaMs: 60_000,
    porJanela: Number(process.env.RATE_LIMIT || 300),

    /* Login: 30 SENHAS ERRADAS por minuto, por IP.

       O número não mudou desde 24/08, mas o que ele conta mudou em
       26/08/2026, e é isso que importa: o limitador passou a ignorar os
       logins que dão CERTO (skipSuccessfulRequests, em rotas/auth.js).

       Antes contava tudo. Como o pátio inteiro sai pelo mesmo IP (NAT do
       escritório), cada pessoa que entrava certo gastava o orçamento de
       todos, e a troca de turno estourava o limite sem ninguém errar
       nada — foi o que barrou o René Fonseca, da Expedição, em 25/08 às
       21:03, com a senha correta.

       Este teto já tinha sido subido de 10 para 30 por causa do MESMO
       sintoma, e o sintoma voltou. Fica registrado para o próximo que for
       tentado a subir de novo: enquanto o limitador contar acerto, não
       existe número alto o bastante — só um pátio maior. Contando apenas
       erro, 30/min é folgado para digitação humana e apertado para força
       bruta (cada tentativa custa ~250 ms de bcrypt).

       E não é a defesa principal: cinco senhas erradas em 30 minutos
       bloqueiam AQUELA CONTA por 15 minutos, o que é preciso onde um teto
       por IP é grosseiro. */
    loginPorJanela: Number(process.env.RATE_LIMIT_LOGIN || 30),
  },
};

/* OS SETORES NÃO MORAM MAIS AQUI (02/09/2026).

   Esta constante era uma SEGUNDA cópia da lista de setores, e foi ela que
   recusou o cadastro do usuário de filial com "Setor inválido" — as três
   filiais tinham sido acrescentadas em dominio/fluxo.js, e rotas/operadores.js
   valida contra ESTA. A lista estava certa na tela, certa no banco (migração
   043) e velha aqui, num arquivo cujo assunto é .env, não regra de operação.

   Agora é um reexport: quem já importava `SETORES` de '../config.js' continua
   funcionando sem mudar uma linha, e a lista real está em um lugar só.
   Setor novo se acrescenta em dominio/fluxo.js e na migração da CHECK — nunca
   mais aqui. */
export { SETORES } from './dominio/fluxo.js';
