/* Ponto de entrada da API do Embarque Suinco. */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

import { config } from './config.js';
import { verificarConexao, encerrar, consultar } from './banco.js';
import { iniciarTempoReal, conectados } from './tempo-real.js';
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
import { rotasRelatorios } from './rotas/relatorios.js';
import { rotasDevolucoes } from './rotas/devolucoes.js';

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
      const payload = jwt.verify(auth.slice(7), config.jwtSegredo);
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
function versaoDoServidor() {
  try {
    const daqui = path.dirname(fileURLToPath(import.meta.url));
    // backend/src -> backend -> suinco_logistica -> entregaveis -> raiz
    const raiz = path.resolve(daqui, '..', '..', '..', '..');
    const curto = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: raiz, encoding: 'utf8', timeout: 3000 }).trim();
    const quando = execFileSync('git', ['log', '-1', '--format=%cd', '--date=format:%d/%m %H:%M'],
      { cwd: raiz, encoding: 'utf8', timeout: 3000 }).trim();
    /* A data em ISO vai junto para o painel poder COMPARAR, e não só
       mostrar. Texto "26/08 11:44" é para gente ler; o ISO é o que permite
       a tela perceber sozinha que o servidor ficou para trás. */
    const iso = execFileSync('git', ['log', '-1', '--format=%cI'],
      { cwd: raiz, encoding: 'utf8', timeout: 3000 }).trim();
    return { texto: `${quando} · ${curto}`, em: iso };
  } catch {
    /* Sem git (container, cópia sem .git): não é erro. O /health continua
       respondendo tudo o mais — deixar de responder por causa disto seria
       trocar um diagnóstico por um problema. */
    return { texto: 'desconhecida', em: null };
  }
}

/* Uma vez por processo: o valor não muda enquanto o serviço está no ar. */
const VERSAO_SERVIDOR = versaoDoServidor();

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
  app.use((req, res, next) => {
    const origem = req.headers.origin;
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
  app.use(cors({
    origin(origem, cb) {
      if (!origem) return cb(null, true);
      if (config.origens.includes(origem)) return cb(null, true);
      return cb(new Error(`Origem não autorizada: ${origem}`));
    },
    credentials: true,
  }));

  app.use(compression());
  // 1 MB cobre a carga inicial com folga e barra corpo gigante como negação
  // de serviço barata.
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
      res.status(503).json({ ok: false, banco: 'inacessível', erro: e.message });
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
  app.use('/bi', rotasBI);
  // Robô de relatórios (n8n → WhatsApp) — leitura, token próprio.
  app.use('/bot', rotasBot);

  app.use((req, res) => {
    res.status(404).json({ erro: `Rota não encontrada: ${req.method} ${req.path}`, codigo: 'ROTA_INEXISTENTE' });
  });

  /* Handler global. Erros de domínio (fluxo, permissão) já trazem `status` e
     `codigo` — são repassados. Qualquer outro vira 500 com mensagem genérica:
     detalhe de erro do PostgreSQL na resposta entrega estrutura de tabela
     para quem está sondando. O detalhe vai para o log, onde é útil. */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
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
    console.error('[erro]', req.method, req.path, '—', err?.stack || err);
    return res.status(500).json({ erro: 'Erro interno no servidor.', codigo: 'ERRO_INTERNO' });
  });

  return app;
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
  const servidor = criarServidor();

  verificarConexao()
    .then(async (agora) => {
      await exigirBancoNaVersaoDoCodigo();
      servidor.listen(config.porta, '127.0.0.1', () => {
        console.log(`Embarque Suinco API · porta ${config.porta} · banco OK (${agora})`);
        console.log(`Origens permitidas: ${config.origens.join(', ')}`);
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
      servidor.close(async () => {
        await encerrar();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
