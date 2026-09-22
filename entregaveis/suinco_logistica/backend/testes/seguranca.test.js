/* PROTOCOLO DE SEGURANÇA, MEDIDO — não declarado.

   Em 22/09/2026 o dono mandou passar no sistema uma lista de 20 itens de
   segurança e "adequar nosso protocolo a alto nível". A auditoria achou 13
   itens já atendidos. O problema de um relatório de auditoria é que ele
   descreve UM DIA: nada impede o item 17 de deixar de valer no commit
   seguinte, e ninguém descobre.

   Este arquivo é a auditoria virada TESTE. Cada propriedade que hoje está
   certa passa a reprovar a bateria se alguém a desfizer. É a mesma ideia do
   portão de publicação: tirar o controle da memória de quem escreveu.

   O que NÃO está aqui, de propósito: o que depende do servidor de produção
   (redirect 80->443 no Nginx, privilégio do usuário do banco em produção).
   Teste que mede o ambiente errado ensina a ignorar vermelho. Aquilo está em
   docs/PROTOCOLO_DE_SEGURANCA.md, com o comando e a conferência. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(AQUI, '..');
const RAIZ = path.resolve(BACKEND, '../../..');

const ler = (p) => fs.readFileSync(path.join(BACKEND, p), 'utf8');
const fontes = (dir) => {
  const saida = [];
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) andar(p);
      else if (e.name.endsWith('.js')) saida.push([path.relative(BACKEND, p), fs.readFileSync(p, 'utf8')]);
    }
  };
  andar(path.join(BACKEND, dir));
  return saida;
};

describe('SEGURANÇA 1 — segredo nunca entra no repositório', () => {
  test('nenhum .env com valor real jamais foi versionado', () => {
    /* `.env.exemplo` É versionado de propósito: é o molde, com placeholder
       no lugar de cada segredo, e é o que o instalar.sh preenche. O que não
       pode entrar no histórico é o .env de verdade. */
    const add = execFileSync('git', ['log', '--all', '--diff-filter=A', '--name-only',
      '--format=', '--', '*.env', '*.env.*'], { cwd: RAIZ, encoding: 'utf8' })
      .split('\n').map((x) => x.trim()).filter(Boolean)
      .filter((x) => !x.endsWith('.env.exemplo'));
    assert.deepEqual([...new Set(add)], [], `estes .env entraram no histórico:\n${add.join('\n')}`);
  });

  test('o .env.exemplo não carrega segredo de verdade', () => {
    /* Molde com valor real dentro é pior que segredo no código: ele parece
       inofensivo e é lido por todo mundo que instala. */
    const txt = fs.readFileSync(path.join(BACKEND, '.env.exemplo'), 'utf8');
    const suspeitas = txt.split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .filter((l) => /=[A-Za-z0-9+/=]{16,}$/.test(l.trim()));
    assert.deepEqual(suspeitas, [],
      `o molde tem valor que parece segredo real:\n${suspeitas.join('\n')}`);
  });

  test('o .env está ignorado', () => {
    const ig = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8');
    assert.ok(/(^|\/)\.env\b/m.test(ig), 'o .gitignore precisa ignorar .env');
  });

  test('nenhum segredo com valor fixo no código do servidor', () => {
    /* O que caça: atribuição de literal longo a nome de segredo. O que NÃO
       caça, de propósito: comentário e mensagem de erro — foi onde a primeira
       versão deste teste deu falso positivo, no texto que EXPLICA por que o
       segredo é obrigatório. */
    const suspeito = /\b(JWT_SECRET|jwtSegredo|SENHA|PASSWORD|SECRET|TOKEN_BI|TOKEN_BOT)\s*[:=]\s*['"`][A-Za-z0-9+/=_-]{16,}['"`]/;
    const achados = [];
    for (const [nome, txt] of fontes('src')) {
      const semComentario = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const m = semComentario.match(suspeito);
      if (m) achados.push(`${nome}: ${m[0].slice(0, 60)}`);
    }
    assert.deepEqual(achados, [], `segredo fixo no código:\n${achados.join('\n')}`);
  });

  test('o servidor RECUSA subir sem JWT_SECRET forte (32+)', () => {
    const cfg = ler('src/config.js');
    assert.match(cfg, /jwtSegredo:\s*obrigatorio\('JWT_SECRET',\s*32\)/,
      'JWT_SECRET precisa ser obrigatório com mínimo de 32 caracteres');
  });
});

describe('SEGURANÇA 2 — SQL sempre parametrizado', () => {
  test('nenhum pedaço de SQL interpolado vem da requisição', () => {
    /* A PROPRIEDADE CERTA NÃO É "não interpola" — É "não interpola ENTRADA".

       A primeira versão deste teste procurava `${` numa linha só e achou
       apenas bi.js. Rodando de verdade apareceram outros cinco arquivos: a
       interpolação estava em linha DIFERENTE da chamada, e o padrão de uma
       linha não a via. Auditei os cinco um por um e os cinco são seguros —
       lista de colunas constante, nome de tabela vindo de um Map do código,
       'ASC'/'DESC' escolhido por booleano, e o padrão `$${params.length}`,
       que monta o NÚMERO do placeholder e manda o valor em `params`.

       Então o que este teste cobra é o que de fato importa: que nenhuma
       expressão interpolada dentro de um SQL mencione `req`. Nome de tabela
       e de coluna não aceitam placeholder — proibir interpolação seria
       proibir o código correto; deixar `req` entrar é injeção. */
    const achados = [];
    for (const [nome, txt] of fontes('src')) {
      /* Pega a template string inteira passada a query/consultar, inclusive
         quebrada em várias linhas. */
      for (const m of txt.matchAll(/(?:query|consultar)\(\s*`([\s\S]*?)`/g)) {
        for (const exp of m[1].matchAll(/\$\{([^}]*)\}/g)) {
          const dentro = exp[1];
          if (/\breq\b/.test(dentro)) achados.push(`${nome}: \${${dentro}}`);
        }
      }
    }
    assert.deepEqual(achados, [],
      `entrada da requisição interpolada em SQL:\n${achados.join('\n')}`);
  });

  test('a interpolação de bi.js continua vindo de lista fechada', () => {
    const txt = ler('src/rotas/bi.js');
    assert.match(txt, /const tabela = VIEWS\.get\(/,
      'o nome da tabela tem de sair do Map VIEWS, nunca de req');
    assert.match(txt, /if \(!tabela\)/, 'chave desconhecida precisa ser recusada');
  });
});

describe('SEGURANÇA 3 — autenticação e privilégio', () => {
  test('toda rota de operação exige login ou token de integração', () => {
    const semGuarda = [];
    for (const [nome, txt] of fontes('src/rotas')) {
      if (nome.endsWith('auth.js')) continue;      // é ela que autentica
      const rotas = txt.match(/\.\s*(get|post|patch|put|delete)\(\s*'[^']*'/g) || [];
      if (!rotas.length) continue;
      if (!/(exigirLogin|exigirTokenBI|exigirTokenBot)/.test(txt)) semGuarda.push(nome);
    }
    assert.deepEqual(semGuarda, [], `rotas sem guarda:\n${semGuarda.join('\n')}`);
  });

  test('a permissão por setor é allowlist — quem não está na lista é negado', () => {
    const txt = ler('src/dominio/fluxo.js');
    assert.ok(/includes\(setor\)|\.has\(setor\)/.test(txt),
      'a decisão de setor tem de ser por pertencer a uma lista, não por exclusão');
  });

  test('a senha é guardada com bcrypt, e o compare roda mesmo sem usuário', () => {
    const txt = ler('src/rotas/auth.js');
    assert.match(txt, /bcrypt\.compare/);
    assert.match(txt, /\$2[aby]\$/,
      'precisa do hash de fachada para o tempo de resposta não denunciar quem existe');
  });
});

describe('SEGURANÇA 3b — o instalador não cria usuário de banco privilegiado', () => {
  /* CORREÇÃO DE UM ACHADO MEU, 22/09/2026.

     Eu reportei ao dono que "a API fala com o Postgres como superusuário",
     medido neste container de desenvolvimento. Ele foi ao servidor conferir e
     a resposta foi `f`: em PRODUÇÃO o usuário nunca foi superusuário. Eu
     extrapolei do ambiente descartável para a produção sem confirmar, e ele
     quase rodou um ALTER ROLE que não precisava.

     A razão está no instalar.sh: ele cria o papel com `CREATE ROLE $DB_USER
     LOGIN PASSWORD`, e nada mais. A produção está certa POR CONSTRUÇÃO — e o
     superusuário daqui é sujeira local.

     O que se pode travar, então, não é o estado do banco de produção (este
     teste não o alcança, e teste que mede o ambiente errado ensina a ignorar
     vermelho): é o INSTALADOR, que é quem constrói a produção. Se alguém
     acrescentar SUPERUSER ali, a próxima instalação nasce errada e esta
     suíte reprova antes. */
  test('o instalar.sh cria o papel do banco SEM privilégio elevado', () => {
    const txt = fs.readFileSync(path.join(BACKEND, 'instalar.sh'), 'utf8');
    const criacao = txt.split('\n').filter((l) => /CREATE ROLE|CREATE USER|createuser/.test(l));
    assert.ok(criacao.length > 0, 'não achei a criação do papel no instalar.sh');
    for (const linha of criacao) {
      assert.ok(!/SUPERUSER|CREATEDB|CREATEROLE|BYPASSRLS|--superuser/i.test(linha),
        `o instalador daria privilégio elevado ao banco:\n${linha.trim()}`);
    }
  });
});

describe('SEGURANÇA 4 — a resposta não entrega mais do que deve', () => {
  test('o hash da senha nunca entra numa resposta', () => {
    const achados = [];
    for (const [nome, txt] of fontes('src')) {
      const semComentario = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      /* Procura senha_hash DENTRO de um res.json(...) da mesma linha. */
      for (const linha of semComentario.split('\n')) {
        if (/res\.(json|send)\(/.test(linha) && /senha_hash/.test(linha)) achados.push(`${nome}: ${linha.trim()}`);
      }
    }
    assert.deepEqual(achados, [], `hash em resposta:\n${achados.join('\n')}`);
  });

  test('e-mail inexistente e senha errada respondem IGUAL', () => {
    const txt = ler('src/rotas/auth.js');
    const codigos = [...txt.matchAll(/codigo:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    const invalidas = codigos.filter((c) => c === 'CREDENCIAL_INVALIDA').length;
    assert.ok(invalidas >= 1,
      'as duas recusas precisam devolver o MESMO código, senão dá para descobrir quais e-mails existem');
    assert.ok(!/usu[áa]rio n[ãa]o encontrado/i.test(txt),
      'nenhuma mensagem pode dizer que o usuário não existe');
  });
});

describe('SEGURANÇA 5 — cabeçalhos e transporte', () => {
  test('o helmet está ligado', () => {
    const txt = ler('src/servidor.js');
    assert.match(txt, /import helmet from 'helmet'/);
    assert.match(txt, /app\.use\(helmet\(/);
  });

  test('o HSTS não foi desligado', () => {
    const txt = ler('src/servidor.js');
    const bloco = txt.slice(txt.indexOf('app.use(helmet('), txt.indexOf('app.use(helmet(') + 600);
    assert.ok(!/hsts:\s*false/.test(bloco), 'hsts:false tira o Strict-Transport-Security');
    assert.ok(!/strictTransportSecurity:\s*false/.test(bloco));
  });

  test('trust proxy é o número de proxies, nunca true', () => {
    const txt = ler('src/servidor.js');
    assert.ok(!/app\.set\('trust proxy',\s*true\)/.test(txt),
      "'trust proxy' true faz o rate limit contar o mundo como um cliente só");
    assert.match(txt, /app\.set\('trust proxy',\s*\d+\)/);
  });

  test('o painel publica cabeçalho de segurança na Vercel', () => {
    const v = JSON.parse(fs.readFileSync(path.resolve(BACKEND, '..', 'vercel.json'), 'utf8'));
    const chaves = (v.headers || []).flatMap((h) => (h.headers || []).map((x) => x.key));
    for (const obrigatorio of ['X-Content-Type-Options', 'X-Frame-Options',
      'Referrer-Policy', 'Strict-Transport-Security', 'Content-Security-Policy']) {
      assert.ok(chaves.includes(obrigatorio), `falta ${obrigatorio} no vercel.json`);
    }
  });
});

describe('SEGURANÇA 6 — limite de requisição', () => {
  test('existe limitador geral, de login e de bot', () => {
    assert.match(ler('src/servidor.js'), /app\.use\(rateLimit\(/, 'falta o limitador geral');
    assert.match(ler('src/rotas/auth.js'), /rateLimit\(/, 'falta o limitador do login');
    assert.match(ler('src/rotas/bot.js'), /rateLimit\(/, 'falta o limitador do bot');
  });

  test('o limitador do login só conta senha ERRADA', () => {
    /* `skipSuccessfulRequests` é o que permite manter o teto baixo sem
       punir quem digita certo. Sem ele, o pátio inteiro — que sai por um IP
       só — gastaria a cota logando normalmente. */
    const txt = ler('src/rotas/auth.js');
    assert.match(txt, /skipSuccessfulRequests:\s*true/,
      'sem isso o login correto consome a cota do IP compartilhado');
  });

  test('existe bloqueio POR CONTA, além do limite por IP', () => {
    /* O limite por janela protege o serviço; o bloqueio por conta é o que
       protege A SENHA de uma pessoa. Os dois são necessários: o primeiro
       sozinho é contornável trocando de IP, e o segundo sozinho deixa o
       serviço ser inundado.

       ACHADO EM ABERTO (22/09/2026): o limitador de login não tem
       keyGenerator, então conta por IP — e o pátio sai por um IP só. 30
       senhas erradas num minuto barram o login de todos por aquele minuto.
       É disponibilidade, não vazamento, e a correção tem contrapartida
       (chavear por e-mail enfraquece a defesa contra força bruta). Está
       escrito em docs/PROTOCOLO_DE_SEGURANCA.md para o dono decidir. */
    const txt = ler('src/rotas/auth.js');
    assert.match(txt, /falhas_senha/, 'falta o contador de falhas por conta');
    assert.match(txt, /bloqueado_ate/, 'falta o bloqueio temporário por conta');
  });
});

describe('SEGURANÇA 7 — o corpo da requisição não escreve o que quiser', () => {
  test('o PATCH da montagem só aceita campos declarados', () => {
    const txt = ler('src/rotas/modelo_semana.js');
    const declarados = (txt.match(/campo\('/g) || []).length;
    assert.ok(declarados >= 10,
      `só ${declarados} campos declarados — o PATCH tem de listar campo por campo`);
    assert.ok(!/Object\.assign\(\s*atual,\s*req\.body/.test(txt),
      'Object.assign(atual, req.body) é mass assignment');
    assert.ok(!/\.\.\.\s*req\.body/.test(txt),
      'espalhar req.body num UPDATE é mass assignment');
  });

  test('o corpo da requisição tem tamanho máximo', () => {
    const txt = ler('src/servidor.js');
    assert.match(txt, /express\.json\(\{[^}]*limit/,
      'express.json sem limit aceita corpo de qualquer tamanho');
  });
});
