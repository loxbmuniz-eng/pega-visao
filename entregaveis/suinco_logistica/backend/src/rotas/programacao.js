import { Router } from 'express';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';
import { config } from '../config.js';
import { programacaoAtual, abrirProgramacao } from '../dominio/programacoes.js';

export const rotasProgramacao = Router();

function novoId(prefixo) {
  return `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* Comparação em tempo constante.

   A senha de fechamento é curta e digitada por humano; comparar com `===`
   permite, em tese, medir o tempo de resposta e descobrir o prefixo certo
   caractere a caractere. É barato defender e não custa nada. */
function senhaConfere(informada, esperada) {
  const a = String(informada ?? '');
  const b = String(esperada ?? '');
  if (!b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Fechamento de programação — encerra o ciclo atual e abre um novo.

   HISTÓRICO DA DECISÃO, registrado porque ela MUDOU:

   Em 08/08/2026 o usuário confirmou "bloqueia o fechamento" quando
   houvesse carga em andamento — para nunca esconder das telas
   operacionais um caminhão fisicamente no pátio.

   Em 11/08/2026 ele reverteu, conscientemente: "COLOCAR UMA SENHA AO
   INVES DE BLOQUEAR"; "da pra fechar programacao mesmo com carga em
   aberto mas essa carga fica em aberto na torre de controle e vai pro
   historico de programacoes... precisamos ter esse controle e tomada de
   decisao em nossas maos e nao depender de qualquer limitacao que seja
   imposta por uma falta de informacao que eu possa ter esquecido de
   passar".

   O risco original continua endereçado, por outro caminho: a carga em
   aberto NÃO some da Torre de Controle. Ela apenas passa a pertencer à
   programação arquivada — some da fila do dia, não da tela de quem opera.
   Fechar nunca apaga nem esconde carga; só troca o ciclo.

   Pátio limpo → fecha direto. Carga em aberto → exige a senha mestre, e o
   fechamento fica marcado como `forcado` para auditoria posterior. */
rotasProgramacao.post('/programacao/fechar', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const { rows: abertas } = await consultar(
      `SELECT carga_id, numero_carga, placa, status_atual
         FROM fact_viagens
        WHERE status_atual <> 'Seguiu Viagem'
        ORDER BY placa`
    );

    const forcado = abertas.length > 0;
    if (forcado) {
      if (!config.senhaFechamento) {
        return res.status(409).json({
          erro: `Há ${abertas.length} carga(s) em andamento e a senha de fechamento `
            + 'não está configurada no servidor. Fale com a TI (SENHA_FECHAMENTO no .env).',
          codigo: 'SENHA_NAO_CONFIGURADA',
          cargas: abertas.map((c) => ({
            placa: c.placa, numeroCarga: c.numero_carga, status: c.status_atual,
          })),
        });
      }
      if (!senhaConfere(req.body?.senha, config.senhaFechamento)) {
        return res.status(req.body?.senha ? 403 : 409).json({
          erro: req.body?.senha
            ? 'Senha de fechamento incorreta.'
            : `Há ${abertas.length} carga(s) em andamento. Informe a senha de fechamento para continuar.`,
          codigo: req.body?.senha ? 'SENHA_INCORRETA' : 'SENHA_NECESSARIA',
          cargas: abertas.map((c) => ({
            placa: c.placa, numeroCarga: c.numero_carga, status: c.status_atual,
          })),
        });
      }
    }

    const op = req.operador;
    const resultado = await emTransacao(async (cli) => {
      const atual = await programacaoAtual();
      await cli.query(
        `UPDATE programacoes
            SET fechada_em = now(), fechada_por = $2, fechada_setor = $3,
                forcado = $4, cargas_em_aberto = $5
          WHERE programacao_id = $1`,
        [atual, op.nome, op.setor, forcado, abertas.length]
      );
      const nova = await abrirProgramacao();

      await cli.query(
        `INSERT INTO log_eventos
           (evento_id, carga_id, placa, acao, setor, operador_id, operador_nome, operador_verificado)
         VALUES ($1, NULL, '', $2, $3, $4, $5, TRUE)`,
        [
          novoId('log'),
          forcado
            ? `Fechamento de Programação FORÇADO (${abertas.length} carga(s) em aberto)`
            : 'Fechamento de Programação',
          op.setor, op.id, op.nome,
        ]
      );
      return { fechada: atual, nova };
    });

    const quando = new Date().toISOString();
    emitir('programacao:fechada', {
      operador: op.nome, setor: op.setor, quando, forcado, emAberto: abertas.length,
    });
    return res.json({
      ok: true, quando, operador: op.nome, forcado,
      emAberto: abertas.length,
      programacaoFechada: resultado.fechada,
      programacaoNova: resultado.nova,
    });
  } catch (e) {
    return next(e);
  }
});

/* Histórico de programações — o "arquivo" que o fechamento alimenta.

   Traz também quantas cargas ficaram em aberto no momento do fechamento,
   que é o número que interessa quando alguém for revisar uma decisão de
   fechar com caminhão no pátio. */
rotasProgramacao.get('/programacoes', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT p.programacao_id, p.aberta_em, p.fechada_em, p.fechada_por,
              p.fechada_setor, p.forcado, p.cargas_em_aberto,
              COUNT(v.carga_id)::int AS total_cargas
         FROM programacoes p
         LEFT JOIN fact_viagens v ON v.programacao_id = p.programacao_id
        GROUP BY p.programacao_id
        ORDER BY p.aberta_em DESC
        LIMIT 100`
    );
    res.json(rows.map((p) => ({
      id: p.programacao_id,
      abertaEm: p.aberta_em,
      fechadaEm: p.fechada_em,
      fechadaPor: p.fechada_por,
      fechadaSetor: p.fechada_setor,
      forcado: p.forcado,
      cargasEmAberto: p.cargas_em_aberto,
      totalCargas: p.total_cargas,
      aberta: !p.fechada_em,
    })));
  } catch (e) { next(e); }
});
