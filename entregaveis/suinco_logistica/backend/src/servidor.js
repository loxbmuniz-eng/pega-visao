/* Ponto de entrada da API do Embarque Suinco. */

import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { verificarConexao, encerrar } from './banco.js';
import { iniciarTempoReal, conectados } from './tempo-real.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasEstado } from './rotas/estado.js';
import { rotasCargas } from './rotas/cargas.js';
import { rotasCadastros } from './rotas/cadastros.js';
import { rotasOperadores } from './rotas/operadores.js';
import { rotasBI } from './rotas/bi.js';

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

  app.use(rateLimit({
    windowMs: config.limites.janelaMs,
    limit: config.limites.porJanela,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    message: { erro: 'Muitas requisições. Espere um minuto.', codigo: 'LIMITE_EXCEDIDO' },
  }));

  /* /health não exige token de propósito: monitoramento externo precisa
     alcançá-lo. Não devolve nada sensível — só se o banco responde. */
  app.get('/health', async (req, res) => {
    try {
      const agora = await verificarConexao();
      res.json({ ok: true, banco: 'conectado', agora, conectados: conectados() });
    } catch (e) {
      res.status(503).json({ ok: false, banco: 'inacessível', erro: e.message });
    }
  });

  app.use('/auth', rotasAuth);
  app.use('/api', rotasEstado);
  app.use('/api', rotasCargas);
  app.use('/api', rotasCadastros);
  app.use('/api', rotasOperadores);
  app.use('/bi', rotasBI);

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

/* Só sobe sozinho quando executado direto. Importado pelos testes, não. */
const executadoDireto = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (executadoDireto) {
  const servidor = criarServidor();

  verificarConexao()
    .then((agora) => {
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
