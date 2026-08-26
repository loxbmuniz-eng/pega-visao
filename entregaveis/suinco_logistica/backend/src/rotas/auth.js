import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { consultar, emTransacao } from '../banco.js';
import { config } from '../config.js';
import { assinarToken, exigirLogin } from '../middleware/auth.js';
import {
  conferirCodigo, hashDoCodigo, gerarSegredo, gerarCodigosRecuperacao,
  enderecoParaAplicativo,
} from '../dominio/totp.js';

export const rotasAuth = Router();

/* O LIMITE CONTA SÓ QUEM ERROU A SENHA.
   =====================================================================
   Relato de produção, 25/08/2026 21:03: René Fonseca, da Expedição,
   tentando entrar pelo celular e recebendo "muitas tentativas deste local"
   com a senha CERTA, sem ter errado nenhuma vez.

   A causa não era o teto ser baixo. Era o limitador contar TODA
   requisição — inclusive as bem-sucedidas — e ser chaveado por IP. A
   Suinco inteira sai pelo mesmo IP (NAT do escritório): o mesmo fato que
   já estava documentado em chaveDoLimiteGeral, e que na época foi
   corrigido só para o limitador geral. Cada colega que entrava CERTO
   gastava o orçamento de todos, e a troca de turno estourava o limite
   sozinha, sem ninguém errar nada.

   Isso já tinha sido "corrigido" uma vez, subindo o teto de 10 para 30
   (ver config.js). Subir número não resolve — adia até o pátio crescer de
   novo. `skipSuccessfulRequests` resolve pela raiz: um login que deu certo
   não é tentativa de invasão, e por isso não pode custar nada a ninguém.
   Com ele, a recusa só alcança quem de fato errou a senha várias vezes no
   último minuto — nunca quem digitou certo, não importa quantos colegas
   entrem junto.

   A defesa contra força bruta não depende deste teto e é mais precisa que
   ele: cinco senhas erradas em 30 minutos bloqueiam AQUELA CONTA por 15
   minutos (campos falhas_senha/bloqueado_ate, mais abaixo). O limitador
   por IP fica como rede de proteção contra quem varre e-mails que nem
   existem — caso em que não há conta para bloquear. */
const limiteLogin = rateLimit({
  windowMs: config.limites.janelaMs,
  limit: config.limites.loginPorJanela,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  /* A mensagem diz o que REALMENTE aconteceu. A antiga falava em
     "tentativas de login", e quem lia com a senha certa na mão concluía
     que o sistema estava quebrado — o que, naquele dia, era verdade. */
  message: {
    erro: 'Muitas senhas erradas deste local no último minuto. Espere um minuto.',
    codigo: 'LIMITE_LOGIN',
  },
});

rotasAuth.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const senha = String(req.body?.senha ?? '');
    if (!email || !senha) {
      return res.status(400).json({ erro: 'Informe e-mail e senha.', codigo: 'CAMPOS_FALTANDO' });
    }

    const { rows } = await consultar(
      `SELECT id, email, nome, setor, senha_hash, ativo, sessao_versao,
              mfa_segredo, mfa_ativo, falhas_senha, falhas_desde, bloqueado_ate
         FROM operadores WHERE email = $1`,
      [email]
    );
    const op = rows[0];

    /* Resposta idêntica para "e-mail não existe" e "senha errada". Mensagens
       diferentes entregam quais e-mails são válidos, e aí a força bruta já
       começa sabendo metade. O bcrypt roda mesmo sem usuário encontrado para
       o tempo de resposta não denunciar a diferença. */
    const hash = op?.senha_hash || '$2a$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalido';
    const confere = await bcrypt.compare(senha, hash);

    /* CONTAGEM DE SENHAS ERRADAS (etapa 4, 24/08/2026).
       Janela de 30 min: cinco erros espalhados ao longo de meses não são
       ataque, são digitação. O que interessa é a rajada. */
    const JANELA_MS = 30 * 60 * 1000;
    const desde = op?.falhas_desde ? new Date(op.falhas_desde).getTime() : 0;
    const naJanela = Boolean(desde) && (Date.now() - desde) < JANELA_MS;
    const falhas = naJanela ? Number(op?.falhas_senha || 0) : 0;

    if (!op || !confere || !op.ativo) {
      if (op && !op.ativo) console.warn('[auth] login de operador inativo:', email);
      if (op) {
        await consultar(
          `UPDATE operadores SET falhas_senha = $2, falhas_desde = COALESCE($3, now())
            WHERE id = $1`,
          [op.id, falhas + 1, naJanela ? op.falhas_desde : null]
        );
      }
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.', codigo: 'CREDENCIAL_INVALIDA' });
    }

    /* Bloqueio conferido DEPOIS da senha, pelo mesmo motivo de sempre:
       responder antes diria a um atacante quais contas estão sob ataque. */
    if (op.bloqueado_ate && new Date(op.bloqueado_ate).getTime() > Date.now()) {
      const faltam = Math.ceil((new Date(op.bloqueado_ate).getTime() - Date.now()) / 60000);
      return res.status(429).json({
        erro: `Muitas senhas erradas nesta conta. Tente de novo em ${faltam} minuto(s).`,
        codigo: 'BLOQUEIO_TEMPORARIO',
      });
    }

    /* SEGUNDO FATOR (etapa 4 do protocolo de segurança, 22/08/2026).

       Só cobra de quem ATIVOU. Quem não ativou entra como sempre — a adesão
       é por pessoa, e o dia da atualização não pode derrubar o pátio.

       A senha já foi conferida quando chegamos aqui. Isso é de propósito:
       pedir o código antes da senha diria a um atacante quais e-mails têm
       segundo fator, que é informação que ele não precisa ter.

       DESDE 24/08/2026 O CÓDIGO SÓ É PEDIDO DEPOIS DE CINCO SENHAS
       ERRADAS. Decisão do dono do projeto: "2FA não deve aparecer no
       login, somente caso erre a senha mais de 5x". Quem digita a senha
       certa entra como sempre — é isso que torna possível manter a
       proteção ligada sem parar o pátio. O que ela pega e o que não pega
       está na migração 032. */
    const SUSPEITO = falhas >= 5;

    if (SUSPEITO && !op.mfa_ativo) {
      /* Sem segundo fator não há código para pedir; o que resta é uma
         espera curta — inviabiliza a força bruta sem virar chamado. */
      await consultar(
        `UPDATE operadores SET bloqueado_ate = now() + interval '15 minutes',
                               falhas_senha = 0, falhas_desde = NULL
          WHERE id = $1`, [op.id]
      );
      return res.status(429).json({
        erro: 'Muitas senhas erradas nesta conta. Tente de novo em 15 minutos.',
        codigo: 'BLOQUEIO_TEMPORARIO',
      });
    }

    if (SUSPEITO && op.mfa_ativo) {
      const codigo = String(req.body?.codigo ?? '').trim();
      if (!codigo) {
        return res.status(401).json({
          erro: 'Digite o código do seu aplicativo autenticador.',
          codigo: 'MFA_NECESSARIO',
        });
      }

      let ok = conferirCodigo(op.mfa_segredo, codigo);

      /* Não bateu como código do aplicativo? Pode ser um código de
         RECUPERAÇÃO — o caminho de quem está sem o celular. Vale uma vez
         só, e é marcado como usado na mesma consulta que o encontra, para
         que dois logins simultâneos não gastem o mesmo código duas vezes. */
      if (!ok) {
        const { rows: usado } = await consultar(
          `UPDATE mfa_codigos_recuperacao
              SET usado_em = now()
            WHERE codigo_id = (
              SELECT codigo_id FROM mfa_codigos_recuperacao
               WHERE operador_id = $1 AND usado_em IS NULL AND codigo_hash = $2
               LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING codigo_id`,
          [op.id, hashDoCodigo(codigo)]
        );
        if (usado[0]) {
          ok = true;
          const { rows: restantes } = await consultar(
            'SELECT count(*)::int n FROM mfa_codigos_recuperacao WHERE operador_id = $1 AND usado_em IS NULL',
            [op.id]
          );
          console.warn(`[seguranca] ${op.email} entrou com CÓDIGO DE RECUPERAÇÃO; restam ${restantes[0].n}`);
        }
      }

      if (!ok) {
        console.warn('[seguranca] segundo fator incorreto para', op.email, 'de', req.ip);
        return res.status(401).json({
          erro: 'Código incorreto ou vencido. O código muda a cada 30 segundos.',
          codigo: 'MFA_INVALIDO',
        });
      }
    }

    /* Entrou: o contador zera e o bloqueio some.

       Sem isto, cinco erros de digitação numa terça passariam a cobrar
       código para sempre — a contagem só existe para descrever a rajada
       que está acontecendo AGORA, não o histórico da pessoa. */
    await consultar(
      `UPDATE operadores
          SET ultimo_acesso = now(), falhas_senha = 0,
              falhas_desde = NULL, bloqueado_ate = NULL
        WHERE id = $1`, [op.id]
    );

    return res.json({
      token: assinarToken(op),
      operador: { id: String(op.id), nome: op.nome, email: op.email, setor: op.setor },
    });
  } catch (e) {
    return next(e);
  }
});

/* Devolve quem o token diz que você é. O painel usa isto na abertura para
   restaurar a sessão sem pedir senha de novo, e para descobrir o setor —
   que ele deixa de guardar no localStorage. */
rotasAuth.get('/eu', exigirLogin, (req, res) => {
  res.json({ operador: req.operador });
});

/* Renova a sessão de quem está trabalhando.

   O token vale 12 horas. Isso protege o terminal compartilhado do pátio —
   sessão eterna faria o turno da noite operar com a identidade de quem
   sentou ali de manhã, e a auditoria passaria a mentir sobre quem fez o
   quê. Mas 12 horas fixas derrubam o terminal no meio do expediente, e
   painel que pede senha com o caminhão na doca é painel que atrapalha.

   A saída é renovar enquanto HOUVER trabalho acontecendo. O painel só
   chama esta rota quando alguém mexeu na tela nas últimas horas; parado,
   ele deixa vencer. Terminal em uso segue vivo, terminal esquecido aberto
   morre sozinho.

   A renovação relê o operador no BANCO, não no token. Isso é de propósito
   e vale mais que a conveniência: quem foi desativado perde o acesso na
   renovação seguinte, e quem mudou de setor passa a valer no setor novo
   sem precisar sair e entrar. Sem esta releitura, desativar alguém só teria
   efeito 12 horas depois. */
rotasAuth.post('/renovar', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      'SELECT id, email, nome, setor, ativo, sessao_versao FROM operadores WHERE id = $1',
      [req.operador.id]
    );
    const op = rows[0];
    if (!op || !op.ativo) {
      return res.status(401).json({
        erro: 'Seu acesso foi desativado. Fale com a Administração.',
        codigo: 'OPERADOR_INATIVO',
      });
    }
    return res.json({
      token: assinarToken(op),
      operador: { id: String(op.id), nome: op.nome, email: op.email, setor: op.setor },
    });
  } catch (e) {
    return next(e);
  }
});

/* =====================================================================
   SEGUNDO FATOR — ativação, desativação e recuperação
   =====================================================================
   Etapa 4 do protocolo de segurança (22/08/2026).

   A ativação tem DOIS passos de propósito. O primeiro gera o segredo e o
   mostra; o segundo só liga o segundo fator depois que a pessoa provar que
   o aplicativo dela já está gerando o código certo.

   Ligar em um passo só trancaria do lado de fora quem fechasse a tela antes
   de terminar de configurar o celular — e essa pessoa dependeria de outro
   administrador para voltar. Dois passos custam um clique e evitam isso. */

rotasAuth.post('/mfa/iniciar', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      'SELECT id, email, mfa_ativo FROM operadores WHERE id = $1', [req.operador.id]
    );
    const op = rows[0];
    if (!op) return res.status(404).json({ erro: 'Operador não encontrado.', codigo: 'NAO_ENCONTRADO' });
    if (op.mfa_ativo) {
      return res.status(409).json({
        erro: 'Seu segundo fator já está ativo. Desative antes de configurar de novo.',
        codigo: 'MFA_JA_ATIVO',
      });
    }

    // Segredo novo a cada tentativa: se a pessoa começou, desistiu e voltou,
    // o aplicativo dela pode ter guardado o anterior pela metade.
    const segredo = gerarSegredo();
    await consultar('UPDATE operadores SET mfa_segredo = $1 WHERE id = $2', [segredo, op.id]);

    return res.json({
      segredo,
      endereco: enderecoParaAplicativo(op.email, segredo),
      instrucao: 'Abra o aplicativo autenticador, escolha "inserir chave manualmente" '
        + 'e digite o segredo acima. Depois confirme com o código de 6 dígitos que aparecer.',
    });
  } catch (e) {
    return next(e);
  }
});

rotasAuth.post('/mfa/confirmar', exigirLogin, async (req, res, next) => {
  try {
    const codigo = String(req.body?.codigo ?? '').trim();
    const { rows } = await consultar(
      'SELECT id, mfa_segredo, mfa_ativo FROM operadores WHERE id = $1', [req.operador.id]
    );
    const op = rows[0];
    if (!op?.mfa_segredo) {
      return res.status(409).json({
        erro: 'Comece a configuração antes de confirmar.', codigo: 'MFA_SEM_SEGREDO',
      });
    }
    if (!conferirCodigo(op.mfa_segredo, codigo)) {
      return res.status(400).json({
        erro: 'Código incorreto. Confira se o segredo foi digitado certo e tente o próximo código.',
        codigo: 'MFA_CODIGO_INVALIDO',
      });
    }

    /* Lote novo apaga o anterior: dois lotes válidos ao mesmo tempo
       dobrariam a superfície de ataque sem que ninguém percebesse. */
    const codigos = gerarCodigosRecuperacao();
    await emTransacao(async (cli) => {
      await cli.query('UPDATE operadores SET mfa_ativo = TRUE, mfa_ativado_em = now() WHERE id = $1', [op.id]);
      await cli.query('DELETE FROM mfa_codigos_recuperacao WHERE operador_id = $1', [op.id]);
      for (const c of codigos) {
        await cli.query(
          'INSERT INTO mfa_codigos_recuperacao (operador_id, codigo_hash) VALUES ($1,$2)',
          [op.id, hashDoCodigo(c)]
        );
      }
    });

    console.log(`[seguranca] ${req.operador.nome} ativou o segundo fator`);
    return res.json({
      ativo: true,
      codigosRecuperacao: codigos,
      aviso: 'Guarde estes códigos FORA do celular — impressos, numa gaveta. '
        + 'Cada um serve uma vez, e eles são o único jeito de entrar se você perder o aparelho. '
        + 'Esta é a única vez que eles aparecem.',
    });
  } catch (e) {
    return next(e);
  }
});

rotasAuth.post('/mfa/desativar', exigirLogin, async (req, res, next) => {
  try {
    /* Desativar exige a SENHA de novo, não só a sessão aberta.

       Sem isso, um terminal de pátio deixado destravado permitiria a
       qualquer um desligar o segundo fator do dono da sessão — e o segundo
       fator existe justamente para o caso de a senha ter vazado. */
    const senha = String(req.body?.senha ?? '');
    const { rows } = await consultar(
      'SELECT id, senha_hash FROM operadores WHERE id = $1', [req.operador.id]
    );
    const confere = rows[0] && await bcrypt.compare(senha, rows[0].senha_hash);
    if (!confere) {
      return res.status(401).json({
        erro: 'Confirme sua senha para desativar o segundo fator.', codigo: 'SENHA_INVALIDA',
      });
    }
    await emTransacao(async (cli) => {
      await cli.query(
        "UPDATE operadores SET mfa_ativo = FALSE, mfa_segredo = '', mfa_ativado_em = NULL WHERE id = $1",
        [rows[0].id]
      );
      await cli.query('DELETE FROM mfa_codigos_recuperacao WHERE operador_id = $1', [rows[0].id]);
    });
    console.warn(`[seguranca] ${req.operador.nome} DESATIVOU o próprio segundo fator`);
    return res.json({ ativo: false });
  } catch (e) {
    return next(e);
  }
});

rotasAuth.get('/mfa/situacao', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT o.mfa_ativo, o.mfa_ativado_em,
              (SELECT count(*)::int FROM mfa_codigos_recuperacao r
                WHERE r.operador_id = o.id AND r.usado_em IS NULL) AS codigos_restantes
         FROM operadores o WHERE o.id = $1`,
      [req.operador.id]
    );
    return res.json(rows[0] || { mfa_ativo: false, codigos_restantes: 0 });
  } catch (e) {
    return next(e);
  }
});
