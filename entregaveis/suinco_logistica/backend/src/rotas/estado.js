import { Router } from 'express';
import { consultar } from '../banco.js';
import { exigirLogin } from '../middleware/auth.js';
import { COLUNAS_CARGA, paraPainel } from '../dominio/cargas.js';

export const rotasEstado = Router();

/* Margem contra defasagem de relógio e transações longas.

   Esta constante é a correção de um bug que causou PERDA PERMANENTE de
   atualizações na versão anterior: a marca de leitura era tomada DEPOIS da
   consulta, então tudo que fosse gravado no intervalo entre a consulta e a
   marca ficava para sempre fora das leituras seguintes — o terminal
   simplesmente parava de ver o que os outros faziam.

   A regra: a marca é tomada ANTES da consulta, e ainda recua 5 s. O custo é
   reenviar alguns registros repetidos; o painel resolve isso por id. O custo
   do contrário é dado perdido sem ninguém perceber. */
const MARGEM_MS = 5000;

rotasEstado.get('/estado', exigirLogin, async (req, res, next) => {
  try {
    const desde = req.query.desde ? new Date(String(req.query.desde)) : null;
    const desdeValido = desde && !Number.isNaN(desde.getTime()) ? desde.toISOString() : null;

    // A marca vem primeiro. Não mova esta linha para depois das consultas.
    const marca = new Date(Date.now() - MARGEM_MS).toISOString();

    const params = desdeValido ? [desdeValido] : [];

    /* Carga excluída aparece na leitura INCREMENTAL e some da COMPLETA.

       Parece contraditório, mas as duas leituras respondem perguntas
       diferentes. A completa é "qual é o pátio agora" — excluída não faz
       parte. A incremental é "o que mudou desde que eu vi" — e a exclusão é
       exatamente uma das mudanças que o terminal precisa receber, senão a
       carga fica na tela do colega até alguém recarregar a página inteira.

       Vale inclusive para quem estava sem rede na hora: ao voltar, a carga
       excluída chega na primeira leitura e sai da tela. */
    const filtro = desdeValido
      ? 'WHERE atualizado_em > $1'
      : 'WHERE excluida_em IS NULL';
    const filtroEvento = desdeValido ? 'WHERE data_evento > $1' : '';

    const [cargas, movimentacoes, log] = await Promise.all([
      consultar(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens ${filtro} ORDER BY atualizado_em ASC LIMIT 5000`,
        params
      ),
      consultar(
        `SELECT movimentacao_id, carga_id, placa, status_anterior, status_novo,
                setor, data_evento, operador_id, operador_nome
           FROM fact_statusfrota ${filtroEvento} ORDER BY data_evento ASC LIMIT 5000`,
        params
      ),
      consultar(
        `SELECT evento_id, carga_id, placa, acao, setor, data_evento,
                operador_id, operador_nome, operador_verificado
           FROM log_eventos ${filtroEvento} ORDER BY data_evento DESC LIMIT 2000`,
        params
      ),
    ]);

    res.json({
      marca,
      completo: !desdeValido,
      cargas: cargas.rows.map(paraPainel),
      movimentacoes: movimentacoes.rows.map((m) => ({
        id: m.movimentacao_id,
        cargaId: m.carga_id,
        placa: m.placa,
        statusAnterior: m.status_anterior,
        statusNovo: m.status_novo,
        setor: m.setor,
        data: m.data_evento,
        operador: m.operador_nome,
      })),
      log: log.rows.map((l) => ({
        id: l.evento_id,
        cargaId: l.carga_id,
        placa: l.placa,
        acao: l.acao,
        setor: l.setor,
        data: l.data_evento,
        operador: l.operador_nome,
        verificado: l.operador_verificado,
      })),
    });
  } catch (e) {
    next(e);
  }
});
