/* A NOTA POR TRANSPORTADORA (07/10/2026, #49) — a parte que só o servidor sabe.

   O quadro da aba Indicadores tem quatro números por transportadora. Três
   saem da MESMA conta que a aba já faz no painel (cargas concluídas, tempo
   de pátio, frete combinado) — calculá-los de novo aqui faria dois números
   para a mesma pergunta. O outro só existe no servidor:

   · DEVOLUÇÃO POR CULPA DO TRANSPORTE — FICOU DE FORA (07/10/2026). O dono:
     "não são todas as devoluções que entram no Embarque Suinco, porque
     existem devoluções que nem voltam para a Suinco (...) esse dado não é
     concreto integralmente". A aba Devoluções só tem as que voltaram:
     contar por elas daria um número menor que o real, e menor de um jeito
     diferente para cada transportadora. Volta quando houver a fonte
     completa (um relatório do Sisatak com todas as devoluções).
   · CARGAS COM CT-E OU CANHOTO PENDENTE no Pagamento de Frete: CT-e em
     branco ou o canhoto original ainda não chegou.

   Só Logística e Administração: é número sensível de fornecedor. SÓ LEITURA. */
import { Router } from 'express';
import { pool } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { FUSO } from '../dominio/fuso.js';

export const rotasIndicadores = Router();

function instante(v, padrao) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t) : padrao;
}

rotasIndicadores.get('/indicadores/transportadoras', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const ate = instante(req.query.ate, new Date());
    const de = instante(req.query.de, new Date(ate.getTime() - 30 * 86400e3));
    const params = [de.toISOString(), ate.toISOString()];
    const doc = await pool.query(
      `SELECT transportadora, count(*)::int AS n
         FROM pgfrete_cargas
        WHERE excluida_em IS NULL
          AND (trim(cte) = '' OR NOT canhoto_original)
          AND primeira_consulta <= ($2::timestamptz AT TIME ZONE '${FUSO}')::date
          AND primeira_consulta >= ($1::timestamptz AT TIME ZONE '${FUSO}')::date
        GROUP BY 1`, params);
    const transportadoras = {};
    doc.rows.forEach((r) => { transportadoras[r.transportadora] = { docPendente: r.n }; });
    res.json({ de: params[0], ate: params[1], transportadoras });
  } catch (e) {
    next(e);
  }
});
