import { Router } from 'express';
import { consultar } from '../banco.js';
import { exigirLogin } from '../middleware/auth.js';
import { ehFilial } from '../dominio/fluxo.js';
import { COLUNAS_CARGA, paraPainel, paraPainelPara } from '../dominio/cargas.js';
import { registrarLeitura } from '../servicos/registro_leitura.js';

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

    /* A FILIAL RECEBE O PÁTIO VAZIO, NÃO UM 403 (09/09/2026).

       Auditoria de segurança: o crachá de filial puxava daqui as cargas do
       pátio inteiro — cliente, destino, motorista, peso, placa — sem nenhum
       botão na tela para isso. A regra do dono é "filial só devolução".

       Por que não 403: o painel chama esta rota no sincronismo de TODO setor,
       a cada poucos segundos. Um 403 aqui viraria faixa de "recusado" na tela
       da filial o tempo inteiro. Ela recebe a mesma forma de resposta, com o
       pátio vazio e o escopo dito com todas as letras — o sincronismo dela
       segue normal, e as devoluções têm a rota própria, já filtrada por
       filial. */
    if (ehFilial(req.operador.setor)) {
      return res.json({
        marca, completo: !desdeValido, escopo: 'devolucoes',
        cargas: [], movimentacoes: [], log: [],
      });
    }

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
    /* MOVIMENTAÇÃO APAGADA DA VISTA (migração 051) não sai daqui. */
    const filtroMovs = desdeValido
      ? 'WHERE data_evento > $1 AND apagada_em IS NULL'
      : 'WHERE apagada_em IS NULL';

    /* A leitura INCREMENTAL é um delta pequeno e recente — ordem ASC (na
       ordem em que aconteceu) é natural e nunca esbarra no LIMIT.

       A leitura COMPLETA é outra história: representa "o pátio agora", e o
       histórico de um sistema em operação passa de 5000/2000 linhas mais
       cedo ou mais tarde. ASC + LIMIT nesse caso corta os registros MAIS
       RECENTES fora — os mais antigos enchem a cota e o que aconteceu hoje
       simplesmente não chega no terminal que acabou de recarregar do zero.
       Foi isso que fez "Seguiu Viagem hoje" mostrar 0 depois de uma
       recarga completa (08/08/2026). DESC + LIMIT traz o que importa: as
       linhas mais recentes primeiro. A ordem do array não importa para
       quem consome (fundirEstadoRemoto em data.js mescla por id, sem
       depender de sequência). */
    const ordemCargas = desdeValido ? 'ASC' : 'DESC';
    const ordemEvento = desdeValido ? 'ASC' : 'DESC';

    const [cargas, movimentacoes, log] = await Promise.all([
      consultar(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens ${filtro} ORDER BY atualizado_em ${ordemCargas} LIMIT 5000`,
        params
      ),
      consultar(
        `SELECT movimentacao_id, carga_id, placa, status_anterior, status_novo,
                setor, data_evento, operador_id, operador_nome
           FROM fact_statusfrota ${filtroMovs} ORDER BY data_evento ${ordemEvento} LIMIT 5000`,
        params
      ),
      consultar(
        `SELECT evento_id, carga_id, placa, acao, setor, data_evento,
                operador_id, operador_nome, operador_verificado
           FROM log_eventos ${filtroEvento} ORDER BY data_evento DESC LIMIT 2000`,
        params
      ),
    ]);

    /* Só a leitura COMPLETA entra no registro. A incremental roda a cada
       poucos segundos em cada terminal — registrá-la encheria a tabela de
       ruído e esconderia justamente o que importa. A completa é rara no uso
       normal (recarregar a página) e é o padrão de quem está copiando a
       base de uma vez só. */
    if (!desdeValido) {
      await registrarLeitura({
        tipo: 'estado-completo',
        detalhe: 'leitura integral do pátio',
        linhas: cargas.rows.length,
        operador: req.operador, ip: req.ip,
      });
    }

    res.json({
      marca,
      completo: !desdeValido,
      cargas: cargas.rows.map(paraPainelPara(req.operador.setor)),
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
