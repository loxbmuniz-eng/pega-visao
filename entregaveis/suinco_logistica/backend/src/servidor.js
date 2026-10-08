/* Ponto de entrada da API do Embarque Suinco. */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

import { config } from './config.js';
import { verificarConexao, encerrar, consultar } from './banco.js';
import { iniciarTempoReal, conectados, encerrarTempoReal } from './tempo-real.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasEstado } from './rotas/estado.js';
import { rotasCargas } from './rotas/cargas.js';
import { rotasCadastros } from './rotas/cadastros.js';
import { rotasOperadores } from './rotas/operadores.js';
import { rotasAvisos } from './rotas/avisos.js';
import { rotasBI } from './rotas/bi.js';
import { rotasBot } from './rotas/bot.js';
import { rotasProgramacao } from './rotas/programacao.js';
import { rotasModeloSemana } from './rotas/modelo_semana.js';
import { rotasVigia } from './rotas/vigia.js';
import { rotasIndicadores } from './rotas/indicadores.js';
import { rotasRelatorios } from './rotas/relatorios.js';
import { rotasDevolucoes } from './rotas/devolucoes.js';
import { rotasPagamentoFrete } from './rotas/pagamento_frete.js';
import { rotasErros } from './rotas/erros.js';
import { avisarErro, ligarRegistroDeQueda, enviarQuedaPendente, avisoLigado } from './servicos/erros.js';

/* Chave do limite geral: por OPERADOR autenticado, não por IP.

   Achado no incidente de 08/08/2026, confirmado num teste de carga com 30
   usuários simultâneos: o pátio inteiro sai pelo mesmo IP (NAT do
   escritório), então contar por IP faz 30 pessoas DIFERENTES dividirem o
   orçamento de UMA só — a 30ª pessoa a clicar num minuto tomava 429 mesmo
   com o limite alto, mesmo estando tudo saudável. O limite deveria estar
   protegendo contra script abusivo, não contra "muita gente de verdade
   trabalhando ao mesmo tempo".

   Corrigido pela raiz: quando a requisição chega com um token válido, a
   chave passa a ser o operador (uma pessoa = um orçamento de 2000/min,
   nunca dividido com os colegas). Sem token válido (não logado, ou rota
   de login antes de autenticar), cai para IP — que continua sendo a
   defesa certa contra quem ainda não provou quem é. */
export function chaveDoLimiteGeral(req) {
  const auth = req.headers?.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), config.jwtSegredo, { algorithms: ['HS256'] });
      if (payload?.sub) return `op:${payload.sub}`;
    } catch {
      // Token ausente, expirado ou inválido: cai para IP abaixo.
    }
  }
  return req.ip;
}

/* QUAL VERSÃO DO SERVIDOR ESTÁ NO AR — respondida sem SSH.
   =====================================================================
   O painel sobe sozinho no Vercel; o servidor só muda quando alguém roda
   o atualizar.sh. Entre os dois existe uma janela em que a tela já tem um
   botão e o servidor ainda não tem a rota.

   Isso custou dois relatos em 26/08/2026 — "não consigo excluir usuário",
   com a mensagem crua "Rota não encontrada" — e a pergunta que resolveria
   os dois em dez segundos ("o servidor já foi atualizado?") não tinha
   como ser respondida de fora. Era exatamente a situação que fez expor
   `limites` aqui depois do incidente de 08/08: um dado bobo que evita um
   SSH inteiro.

   Lido UMA VEZ, na subida. Rodar git a cada /health seria pagar um
   processo por batida de monitoramento para um valor que não muda
   enquanto o serviço está no ar. */
export function versaoDoServidor(daqui = path.dirname(fileURLToPath(import.meta.url))) {
  try {
    // backend/src -> backend -> suinco_logistica -> entregaveis -> raiz
    const raiz = path.resolve(daqui, '..', '..', '..', '..');
    /* stderr IGNORADO de propósito (12/09/2026): em produção o diretório
       publicado não é um repositório, e o git escrevia `fatal: not a git
       repository` no journal a cada subida do serviço. Linha de erro que
       não é erro suja exatamente o lugar onde se procura erro de verdade —
       apareceu no diagnóstico desta data e custou leitura. */
    const git = (args) => execFileSync('git', args,
      { cwd: raiz, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const curto = git(['rev-parse', '--short', 'HEAD']);
    const quando = git(['log', '-1', '--format=%cd', '--date=format:%d/%m %H:%M']);
    /* A data em ISO vai junto para o painel poder COMPARAR, e não só
       mostrar. Texto "26/08 11:44" é para gente ler; o ISO é o que permite
       a tela perceber sozinha que o servidor ficou para trás. */
    const iso = git(['log', '-1', '--format=%cI']);
    return { texto: `${quando} · ${curto}`, em: iso };
  } catch {
    /* PRODUÇÃO NÃO É UM REPOSITÓRIO, E O CONTROLE FICAVA CEGO (12/09/2026).

       O serviço roda de /opt/embarque-suinco, que é a CÓPIA publicada pelo
       rsync do instalar.sh — sem .git. O git falhava, `/health` respondia
       `versao: "desconhecida"`, e com isso dois controles deixavam de
       funcionar justamente em produção: o aviso do painel "o servidor ficou
       para trás" (que compara `versaoEm` com o build da tela) e o passo 5 do
       portão, que exige a API no HEAD (ocorrência #47). Foi encontrado no
       `/health` do VPS enquanto se investigava a instabilidade de 12/09 —
       ninguém tinha percebido porque o controle que avisaria era o próprio
       que estava cego.

       O instalar.sh passa a gravar VERSAO.json na publicação, com a versão
       que o repositório de origem tinha naquele momento. Aqui ele é lido. */
    try {
      const gravado = JSON.parse(
        readFileSync(path.resolve(daqui, '..', 'VERSAO.json'), 'utf8'));
      if (gravado && gravado.texto) {
        return { texto: String(gravado.texto), em: gravado.em || null };
      }
    } catch { /* sem arquivo também não é erro: cai no desconhecida abaixo */ }
    /* Sem git e sem arquivo: não é erro. O /health continua respondendo tudo
       o mais — deixar de responder por causa disto seria trocar um
       diagnóstico por um problema. */
    return { texto: 'desconhecida', em: null };
  }
}

/* Uma vez por processo: o valor não muda enquanto o serviço está no ar. */
const VERSAO_SERVIDOR = versaoDoServidor();

/* AS OUTRAS RECUSAS DO BANCO (auditoria de 06/10/2026). Só a chave
   estrangeira (23503, cadastro que falta) era traduzida; toda outra recusa
   do banco — valor repetido onde não pode, valor fora da lista permitida,
   número ou data que não é número ou data — saía como 500, e o painel trata
   500 como falha de REDE: enfileira e tenta para sempre uma gravação que
   nunca vai ser aceita, com "sistema offline" na tela (família da #57).
   Recusa do banco é recusa do pedido: 4xx com o motivo, para quem está com
   o dedo no botão saber que repetir não resolve. Pura e exportada: o teste
   confere cada código sem precisar provocar o erro no banco. */
const RECUSAS_DO_BANCO = {
  '23505': [409, 'VALOR_REPETIDO', 'Este registro já existe com o mesmo valor. Confira se não foi lançado antes.'],
  '23514': [422, 'VALOR_FORA_DA_REGRA', 'Um dos valores está fora do que o sistema aceita. Confira os campos e tente de novo.'],
  '23502': [422, 'CAMPO_OBRIGATORIO', 'Falta um campo obrigatório para gravar.'],
  '22P02': [422, 'VALOR_INVALIDO', 'Um dos valores não está no formato esperado (número, data ou código).'],
  '22001': [422, 'TEXTO_LONGO_DEMAIS', 'Um dos textos passou do tamanho que o sistema guarda.'],
  '22003': [422, 'NUMERO_FORA_DO_LIMITE', 'Um dos números está fora do limite aceito.'],
  '22007': [422, 'DATA_INVALIDA', 'Uma das datas não é válida.'],
  '22008': [422, 'DATA_INVALIDA', 'Uma das datas está fora do intervalo aceito.'],
};
export function recusaDoBanco(err) {
  const r = RECUSAS_DO_BANCO[err?.code];
  if (!r) return null;
  return { status: r[0], corpo: { erro: r[2], codigo: r[1], restricao: err.constraint || null } };
}

/* A rota como MOLDE (`/api/cargas/:id`), nunca com o número que veio nela:
   é o que agrupa o mesmo defeito no Sentry, e número de carga é dado da
   operação. Quando o erro chega aqui, o Express já devolveu o `baseUrl` do
   roteador (`/api`) — o prefixo sai do caminho de verdade, contando os
   trechos do molde. Sem molde (erro antes de achar a rota), os trechos com
   número viram `:n`. */
export function moldeDaRota(req) {
  const molde = req.route?.path;
  if (typeof molde === 'string') {
    const real = String(req.originalUrl || req.url || '').split('?')[0].split('/').filter(Boolean);
    const prefixo = real.slice(0, Math.max(0, real.length - molde.split('/').filter(Boolean).length));
    return (prefixo.length ? '/' + prefixo.join('/') : '') + molde;
  }
  return String(req.path || '').replace(/\/[^/]*\d[^/]*/g, '/:n');
}

/* Handler global. Erros de domínio (fluxo, permissão) já trazem `status` e
   `codigo` — são repassados. Qualquer outro vira 500 com mensagem genérica:
   detalhe de erro do PostgreSQL na resposta entrega estrutura de tabela
   para quem está sondando. O detalhe vai para o log, onde é útil. */
/* Exportado (08/10/2026): a bateria monta uma rota que quebra de propósito
   e prova, com ESTE tratamento, o que vai ao Sentry e o que não vai. */
// eslint-disable-next-line no-unused-vars
export function tratarErro(err, req, res, _next) {
  if (err?.status && err?.codigo) {
    return res.status(err.status).json({ erro: err.message, codigo: err.codigo });
  }
  if (err?.message?.startsWith('Origem não autorizada')) {
    return res.status(403).json({ erro: err.message, codigo: 'ORIGEM_NAO_AUTORIZADA' });
  }
  /* Corpo maior que o limite do express.json/express.text. O
     body-parser lança com `status` mas sem `codigo`, então caía no 500
     genérico logo abaixo — que diz "erro interno no servidor" para uma
     requisição que o servidor recusou de propósito, e manda o painel
     tratar como falha de rede (enfileirando pra tentar de novo uma
     coisa que nunca vai ser aceita). */
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      erro: 'Conteúdo grande demais para o servidor aceitar.',
      codigo: 'CONTEUDO_GRANDE_DEMAIS',
    });
  }
  /* CADASTRO QUE FALTA NÃO É ERRO DE SERVIDOR (12/09/2026).

     Exatamente a mesma armadilha descrita acima para `entity.too.large`,
     encontrada em produção: `POST /api/cargas` com código de rota que não
     existe em `dim_rotas` viola a chave estrangeira e saía como 500. O
     painel classifica TODO 500 como falha de rede (`eFalhaDeRede` em
     suinco-api.js), então a carga sumia da tela dizendo "offline" e ia para
     a fila tentar para sempre — contra uma recusa que nunca vai ser aceita.
     Treze vezes em 11/09/2026, e o operador lendo "sistema offline" com o
     servidor no ar.

     Chave estrangeira violada é cadastro que falta, não defeito de
     servidor: é recusa de cliente, e o operador tem que ler o motivo para
     saber que refazer não resolve — cadastrar resolve. */
  if (err?.code === '23503') {
    const achado = /Key \(([^)]+)\)=\(([^)]*)\)/.exec(err.detail || '');
    const campo = achado ? achado[1] : '';
    const valor = achado ? achado[2] : '';
    const oQue = /rota/.test(campo) ? 'rota'
      : /placa|veiculo/.test(campo) ? 'placa'
      : campo.replace(/_(codigo|id)$/, '').replace(/_/g, ' ');
    console.warn('[recusa] cadastro inexistente em', req.method, req.path,
      '—', err.constraint || campo);
    return res.status(422).json({
      erro: (oQue && valor)
        ? `A ${oQue} "${valor}" não está cadastrada. Cadastre antes de gravar.`
        : 'Esta gravação depende de um cadastro que não existe. Confira os dados.',
      codigo: 'CADASTRO_INEXISTENTE',
      campo: campo || null,
      valor: valor || null,
    });
  }
  const recusa = recusaDoBanco(err);
  if (recusa) {
    console.warn('[recusa do banco]', req.method, req.path, '—', err.code, err.constraint || '', err.message);
    return res.status(recusa.status).json(recusa.corpo);
  }
  console.error('[erro]', req.method, req.path, '—', err?.stack || err);
  /* Só o erro INESPERADO vai ao Sentry (decisão 27): recusa de regra,
     de permissão e do banco, acima, é resposta certa, não defeito. Sem
     await — a resposta ao painel não espera o Sentry. */
  avisarErro({
    origem: 'servidor', tipo: err?.name, mensagem: err?.message || String(err), pilha: err?.stack,
    onde: `${req.method} ${moldeDaRota(req)}`, setor: req.operador?.setor, versao: VERSAO_SERVIDOR.texto,
  });
  return res.status(500).json({ erro: 'Erro interno no servidor.', codigo: 'ERRO_INTERNO' });
}

export function criarApp() {
  const app = express();

  /* Atrás do Nginx. Sem isso, `req.ip` é sempre 127.0.0.1 e o rate limit
     passa a contar o mundo inteiro como um único cliente — na prática,
     desligado. O valor 1 é o número de proxies à frente: só o Nginx. */
  app.set('trust proxy', 1);

  app.use(helmet({
    // A API não serve HTML. CSP aqui não protege nada e só atrapalha o
    // navegador quando ele busca /health.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  /* Origem recusada precisa de resposta LEGÍVEL, não de erro opaco.

     Quando o CORS simplesmente falha, o navegador esconde o motivo: o painel
     recebe um erro de rede genérico, idêntico a Wi-Fi caído. Um operador
     ficou sem entrar por isso — tinha aberto o painel de um endereço que a
     API não conhece (www., ou o arquivo salvo pelo WhatsApp), e a tela dizia
     que o servidor não respondia, com o servidor no ar.

     Aqui a recusa vira 403 com corpo lido pelo navegador, dizendo QUAL
     endereço foi barrado e qual é o certo. Para o corpo ser legível, o
     preflight desta origem barrada precisa passar — e passa, sem
     Allow-Credentials.

     Isso não abre nada: a requisição para aqui, nenhuma rota roda, nenhum
     dado sai. O que um site hostil consegue ler é a frase "seu endereço não
     está autorizado", que ele já saberia pelo erro de CORS. Cookie continua
     impossível (sem Allow-Credentials) e o token nunca é enviado sozinho —
     vai no cabeçalho Authorization, que só o painel legítimo monta. */
  /* PLANO B (07/10/2026): o painel também é servido por ESTE servidor, em
     /painel (ver servirPainel). Dali ele chama a API na MESMA origem — o que
     não abre nada a ninguém: mesma origem é o próprio servidor. Origem de
     fora continua barrada aqui e no CORS. */
  const mesmaOrigem = (req, origem) => {
    try { return new URL(origem).host === req.headers.host; } catch { return false; }
  };
  app.use((req, res, next) => {
    const origem = req.headers.origin;
    if (origem && origem !== 'null' && mesmaOrigem(req, origem)) { req._mesmaOrigem = true; return next(); }
    if (!origem || config.origens.includes(origem)) return next();

    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.sendStatus(204);

    // 'null' é o que o navegador manda quando a página veio de um arquivo
    // aberto do disco — caso comum quando o painel circula por WhatsApp.
    const doArquivo = origem === 'null';
    return res.status(403).json({
      codigo: 'ORIGEM_NAO_AUTORIZADA',
      erro: doArquivo
        ? `Este painel foi aberto de um arquivo salvo no aparelho, e não do `
          + `endereço oficial. Abra ${config.origens[0]} no navegador.`
        : `O painel foi aberto em ${origem}, que não está autorizado. `
          + `O endereço correto é ${config.origens[0]}.`,
    });
  });

  /* CORS restrito às origens do .env. O painel roda em outro domínio (Vercel),
     então CORS é obrigatório — mas `origin: '*'` junto com Authorization
     deixaria qualquer site chamar a API com o token do operador logado.

     Neste ponto, origem desconhecida já foi respondida acima; o que chega
     aqui é origem conhecida ou chamada sem navegador (curl, Power BI). */
  const corsDasOrigens = cors({
    origin(origem, cb) {
      if (!origem) return cb(null, true);
      if (config.origens.includes(origem)) return cb(null, true);
      return cb(new Error(`Origem não autorizada: ${origem}`));
    },
    credentials: true,
  });
  // Mesma origem não precisa de CORS (o navegador não pede).
  app.use((req, res, next) => (req._mesmaOrigem ? next() : corsDasOrigens(req, res, next)));

  servirPainel(app);

  app.use(compression());
  /* O PDF do relatório de frete viaja em base64 dentro do JSON e passa de 1 MB
     (até 6 MB de PDF = 8,5 MB). Só esta rota ganha o teto maior, e ele tem de
     vir ANTES do parser geral: o primeiro que lê o corpo vale. Os dois formatos
     (json e text/plain, o que evita pedido prévio de CORS) têm o mesmo teto. */
  app.use('/api/pagamento-frete/leituras', express.json({ limit: '9mb' }), express.text({ type: 'text/plain', limit: '9mb' }));
  // 1 MB cobre a carga inicial com folga e barra corpo gigante como negação
  // de serviço barata.
  /* O RELATÓRIO EM PDF LEVA O ESTILO INTEIRO DO PAINEL (563 KB medidos em
     06/10/2026) — com o teto geral de 1 MB sobravam ~460 KB para o conteúdo,
     e o PDF do frete sem filtro quebrava perto de 100 cargas (provado: 1.033
     KB → 413). O teto desta rota é o que a própria rota já declarava aceitar
     (LARGURA_MAX_HTML 3 MB + LARGURA_MAX_CSS 1 MB), com folga do envelope
     JSON. O Nginx (instalar.sh) tem de deixar passar o mesmo tamanho. */
  app.use('/api/relatorios/pdf', express.json({ limit: '5mb' }), express.text({ type: 'text/plain', limit: '5mb' }));
  app.use(express.json({ limit: '1mb' }));

  /* Corpo em text/plain, aceito e convertido para JSON.

     Não é capricho de formato: é a diferença entre passar e não passar por
     uma rede corporativa. Um POST com `content-type: application/json`
     obriga o navegador a mandar antes um pedido de permissão (OPTIONS), e
     proxy de empresa costuma descartar OPTIONS silenciosamente. Com
     text/plain a requisição vira "simples" pelas regras de CORS e vai
     direto, sem pergunta prévia.

     O conteúdo continua sendo JSON e passa pelas mesmas validações — só o
     rótulo do envelope muda. Corpo malformado não derruba o servidor: vira
     objeto vazio e a rota responde "campos faltando", como já responderia. */
  app.use(express.text({ type: 'text/plain', limit: '1mb' }));
  app.use((req, res, next) => {
    if (typeof req.body === 'string' && req.body.length) {
      try { req.body = JSON.parse(req.body); } catch (e) { req.body = {}; }
    }
    next();
  });

  app.use(rateLimit({
    windowMs: config.limites.janelaMs,
    limit: config.limites.porJanela,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    keyGenerator: chaveDoLimiteGeral,
    message: { erro: 'Muitas requisições. Espere um minuto.', codigo: 'LIMITE_EXCEDIDO' },
  }));

  /* /health não exige token de propósito: monitoramento externo precisa
     alcançá-lo. Não devolve nada sensível — só se o banco responde.

     `limites` devolve os valores de RATE_LIMIT/RATE_LIMIT_LOGIN em vigor.
     Não é segredo (não autentica nada, não identifica ninguém) e economiza
     um SSH inteiro na próxima vez que alguém perguntar "o limite que
     subimos ainda está valendo?" — foi exatamente essa pergunta, sem
     resposta rápida, que custou tempo no incidente de 08/08/2026. */
  app.get('/health', async (req, res) => {
    try {
      const agora = await verificarConexao();
      res.json({
        ok: true,
        banco: 'conectado',
        agora,
        // Responde "o servidor já foi atualizado?" sem SSH. `versao` é para
        // ler; `versaoEm` é o que deixa o painel comparar sozinho.
        versao: VERSAO_SERVIDOR.texto,
        versaoEm: VERSAO_SERVIDOR.em,
        conectados: conectados(),
        /* O aviso de erro ao Sentry está ligado? (08/10/2026) Responde sem
           SSH se a chave entrou no .env. Não é segredo: só sim ou não. */
        sentry: { servidor: avisoLigado('servidor'), painel: avisoLigado('painel') },
        /* A trava da parte de gerenciar usuários (08/10/2026): só a palavra —
           desligada, ligada ou invalida —, nunca o hash. O nome não diz
           "senha" de propósito: o /health não fala de segredo (bloco 8). */
        travaUsuarios: config.senhaUsuarios.estado,
        /* O RELATÓRIO EM PDF DEPENDE DE UM CHROMIUM, E ISSO PRECISA SER
           VISÍVEL DE FORA (26/08/2026).

           Um servidor subido sem PLAYWRIGHT_CHROMIUM_PATH responde /health
           com ok:true e aceita login — parece inteiro. Só o PDF não sai, e a
           falha aparece como "download não veio em 60s" na ponta.

           Custou 25 minutos de bateria: o portão perguntava só "está no ar?",
           três suítes de relatório reprovaram, e por um momento pareceu
           regressão de verdade. Agora dá para perguntar "está no ar E
           consegue gerar relatório?" numa requisição só.

           Não é segredo: diz se existe um executável no caminho configurado,
           não qual é o caminho. */
        pdf: {
          pronto: Boolean(config.playwrightChromiumPath)
            && existsSync(config.playwrightChromiumPath),
        },
        limites: {
          porJanela: config.limites.porJanela,
          loginPorJanela: config.limites.loginPorJanela,
          janelaMs: config.limites.janelaMs,
        },
      });
    } catch (e) {
      /* A mensagem crua do banco vai para o log, não para a resposta: este
         endereço é público, e "password authentication failed for user X"
         entrega o nome do usuário do banco a quem sondar (auditoria 06/10). */
      console.error('[health] banco inacessível —', e.message);
      res.status(503).json({ ok: false, banco: 'inacessível' });
    }
  });

  app.use('/auth', rotasAuth);
  app.use('/api', rotasEstado);
  app.use('/api', rotasCargas);
  app.use('/api', rotasCadastros);
  app.use('/api', rotasOperadores);
  app.use('/api', rotasAvisos);
  app.use('/api', rotasProgramacao);
  app.use('/api', rotasModeloSemana);
  app.use('/api', rotasRelatorios);
  app.use('/api', rotasDevolucoes);
  app.use('/api', rotasPagamentoFrete);
  app.use('/api', rotasVigia);
  app.use('/api', rotasIndicadores);
  app.use('/api', rotasErros);
  app.use('/bi', rotasBI);
  // Robô de relatórios (n8n → WhatsApp) — leitura, token próprio.
  app.use('/bot', rotasBot);

  app.use((req, res) => {
    res.status(404).json({ erro: `Rota não encontrada: ${req.method} ${req.path}`, codigo: 'ROTA_INEXISTENTE' });
  });

  app.use(tratarErro);

  return app;
}

/* ---------------------------------------------------------------------
   PLANO B — O PAINEL SERVIDO PELO PRÓPRIO SERVIDOR (07/10/2026)
   ---------------------------------------------------------------------
   O dono: "hobby, não pode parar o site". O painel mora na Vercel, no plano
   grátis; uso acima do limite pode PAUSAR o site até o mês virar — e o
   pátio para. Este servidor (Hostinger, já pago) entrega o MESMO arquivo em
   https://api.embarquesuinco.com.br/painel: sem DNS, sem certificado novo,
   sem Nginx. É o index.html que o git pull do atualizar_tudo.sh traz.

   · Cabeçalhos: os mesmos do vercel.json.
   · A base da API vira a própria origem (`api: location.origin`): o painel
     servido aqui fala com este servidor.
   · O sw.js NÃO é servido neste domínio, de propósito: um service worker no
     domínio da API poderia interceptar a própria API. O painel já registra o
     sw protegido — sem ele, só não fica disponível sem internet. */
/* Onde o arquivo está: no servidor, a cópia que o instalar.sh grava em
   $APP_DIR/painel/ (o que roda não é o repositório, é a cópia da pasta
   backend); na máquina de desenvolvimento e na bateria, o index.html do
   repositório, duas pastas acima. O primeiro que existir vale. */
export const PAINEL_CANDIDATOS = [
  fileURLToPath(new URL('../painel/index.html', import.meta.url)),
  fileURLToPath(new URL('../../index.html', import.meta.url)),
];
const PAINEL_ARQUIVO_ACHADO = () => PAINEL_CANDIDATOS.find((c) => existsSync(c)) || PAINEL_CANDIDATOS[0];
const PAINEL_CABECALHOS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'Cache-Control': 'no-cache',
};
let _painelCache = { mtime: 0, html: '' };

function servirPainel(app) {
  app.get(['/painel', '/painel/'], async (req, res, next) => {
    try {
      const arquivo = PAINEL_ARQUIVO_ACHADO();
      const st = await fs.stat(arquivo);
      if (st.mtimeMs !== _painelCache.mtime) {
        const bruto = await fs.readFile(arquivo, 'utf-8');
        _painelCache = { mtime: st.mtimeMs, html: bruto.replace("api: 'https://api.embarquesuinco.com.br'", 'api: location.origin') };
      }
      res.set(PAINEL_CABECALHOS).type('html').send(_painelCache.html);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return res.status(404).json({ erro: 'O painel não está neste servidor (index.html não encontrado).', codigo: 'PAINEL_AUSENTE' });
      }
      next(e);
    }
  });
}

export function criarServidor() {
  const app = criarApp();
  const servidor = http.createServer(app);
  iniciarTempoReal(servidor);
  return servidor;
}

/* Recusa subir com o banco atrás do código.

   Falha silenciosa e cara: o código novo consulta colunas que só existem
   depois da migração. Se o serviço sobe sem migrar, o login funciona, a
   tela abre, e TODA operação com carga devolve erro 500 — inclusive mudar
   status. Para quem está no pátio parece que "o painel parou", e a causa
   real fica escondida três camadas abaixo.

   Pior: o painel trata 500 como falha de rede e enfileira a gravação, então
   o operador vê o registro na tela dele e acha que subiu. Ninguém percebe
   até alguém comparar duas telas.

   Serviço fora do ar é ruim; serviço no ar mentindo é pior. Por isso ele
   morre aqui, com a mensagem dizendo exatamente o que rodar. */
async function exigirBancoNaVersaoDoCodigo() {
  const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  let arquivos = [];
  try {
    arquivos = (await fs.readdir(pasta)).filter((a) => a.endsWith('.sql')).sort();
  } catch (e) {
    return;   // sem pasta de migrations não há o que conferir
  }
  if (!arquivos.length) return;

  let aplicadas = new Set();
  try {
    const { rows } = await consultar('SELECT arquivo FROM _migrations');
    aplicadas = new Set(rows.map((r) => r.arquivo));
  } catch (e) {
    // Tabela ainda não existe: banco nunca migrado.
  }

  const pendentes = arquivos.filter((a) => !aplicadas.has(a));
  if (!pendentes.length) return;

  console.error(
    `\nNÃO SUBIU: o banco está atrás do código.\n\n` +
    `  Migração(ões) pendente(s): ${pendentes.join(', ')}\n\n` +
    `  Rode, nesta ordem:\n` +
    `    cd /opt/embarque-suinco\n` +
    `    sudo -u suinco node scripts/migrar.js\n` +
    `    sudo systemctl restart embarque-suinco\n\n` +
    `  Subir assim faria o login funcionar e toda operação com carga\n` +
    `  falhar em silêncio. Melhor parar aqui.\n`
  );
  process.exit(1);
}

/* Só sobe sozinho quando executado direto. Importado pelos testes, não. */
const executadoDireto = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (executadoDireto) {
  ligarRegistroDeQueda(VERSAO_SERVIDOR.texto);
  const servidor = criarServidor();

  verificarConexao()
    .then(async (agora) => {
      await exigirBancoNaVersaoDoCodigo();
      servidor.listen(config.porta, '127.0.0.1', () => {
        console.log(`Embarque Suinco API · porta ${config.porta} · banco OK (${agora})`);
        console.log(`Origens permitidas: ${config.origens.join(', ')}`);
        console.log(`Aviso de erro ao Sentry: ${avisoLigado() ? 'ligado' : 'desligado (sem SENTRY_DSN)'}`);
        // A queda anterior, gravada no disco, sai agora (servicos/erros.js).
        enviarQuedaPendente().then((r) => { if (r.enviado) console.log('[sentry] queda anterior enviada'); });
      });
    })
    .catch((e) => {
      console.error('Não subiu: banco inacessível —', e.message);
      process.exit(1);
    });

  /* Desligamento limpo. Sem isso, um `systemctl restart` no meio de uma
     gravação deixa a transação pendurada até o timeout do PostgreSQL. */
  for (const sinal of ['SIGTERM', 'SIGINT']) {
    process.on(sinal, () => {
      console.log(`\n${sinal} recebido, encerrando...`);
      /* O TEMPO REAL FECHA PRIMEIRO (auditoria de 06/10/2026). As conexões
         abertas do painel seguravam o servidor.close() até o limite de 10 s
         e a saída era com erro — a cada atualização, 10 s a mais de pátio
         sem servidor. Fechando as conexões, o close() termina na hora. */
      encerrarTempoReal();
      servidor.close(async () => {
        await encerrar();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
