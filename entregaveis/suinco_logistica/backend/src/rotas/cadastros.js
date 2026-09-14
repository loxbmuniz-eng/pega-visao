import { Router } from 'express';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir, emitirCarga } from '../tempo-real.js';
import { normalizarPlaca, COLUNAS_CARGA, paraPainel } from '../dominio/cargas.js';
import { gravarNota } from './cargas.js';
import { kmValido } from '../dominio/frete.js';

export const rotasCadastros = Router();

/* Frota — a base que sustenta a trava de placa.

   Devolve tudo de uma vez (749 placas hoje, ~90 KB). Paginar isso
   complicaria o painel para economizar quase nada, e ele precisa da base
   inteira em memória para o autocompletar e a busca funcionarem offline. */
rotasCadastros.get('/frota', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT placa, transportadora, tipo_veiculo, capacidade_kg, uf,
              motorista, precisa_revisao, atualizado_em
         FROM dim_veiculos ORDER BY placa`
    );
    res.json(rows.map((v) => ({
      placa: v.placa,
      transportadora: v.transportadora,
      tipoVeiculo: v.tipo_veiculo,
      capacidadeKg: v.capacidade_kg,
      uf: v.uf,
      motorista: v.motorista,
      precisaRevisao: v.precisa_revisao,
      atualizadoEm: v.atualizado_em,
    })));
  } catch (e) { next(e); }
});

rotasCadastros.post('/frota', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const placa = normalizarPlaca(req.body?.placa);
    if (!placa) return res.status(400).json({ erro: 'Placa é obrigatória.', codigo: 'PLACA_FALTANDO' });

    /* `|| null` colapsava capacidadeKg:0 para null — Number(0) é falsy.
       0 é dado real (achado da auditoria "superpowers"); só a AUSÊNCIA do
       campo deveria virar null. */
    const capacidadeKg = Number.isFinite(Number(req.body?.capacidadeKg))
      && req.body?.capacidadeKg !== '' && req.body?.capacidadeKg != null
      ? Number(req.body.capacidadeKg) : null;

    const transportadoraNova = String(req.body?.transportadora ?? '').slice(0, 200);
    const op = req.operador;

    /* A PLACA MUDOU DE TRANSPORTADORA → AS CARGAS ABERTAS ACOMPANHAM (09/09/2026).

       Decisão do dono (opção A), depois da carga 118675 dizer "Rodosousa"
       na Torre com a Frota dizendo "Denia Transportes": a transportadora
       da carga é cópia feita quando a placa entra, e mudar a Frota não
       avisava ninguém. Agora, na MESMA transação: a Frota grava, as cargas
       da placa que ainda não saíram recebem a transportadora nova, cada
       uma ganha uma nota no Histórico, e a troca em si fica registrada
       mesmo sem carga aberta. As concluídas ficam como estavam — são
       registro do que aconteceu. Regravar a mesma transportadora (eco de
       sincronização) não é notícia: nada muda, nada é escrito. */
    const resultado = await emTransacao(async (cli) => {
      const antes = await cli.query('SELECT transportadora FROM dim_veiculos WHERE placa = $1', [placa]);
      const transportadoraAntes = antes.rows[0] ? String(antes.rows[0].transportadora || '') : null;
      const { rows } = await cli.query(
        `INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, capacidade_kg, uf, motorista, origem)
         VALUES ($1,$2,$3,$4,$5,$6,'manual')
         ON CONFLICT (placa) DO UPDATE
           SET transportadora = EXCLUDED.transportadora,
               tipo_veiculo   = EXCLUDED.tipo_veiculo,
               capacidade_kg  = EXCLUDED.capacidade_kg,
               uf             = EXCLUDED.uf,
               motorista      = EXCLUDED.motorista,
               atualizado_em  = now()
         RETURNING placa, transportadora, tipo_veiculo, motorista`,
        [
          placa,
          transportadoraNova,
          String(req.body?.tipoVeiculo ?? '').slice(0, 100),
          capacidadeKg,
          String(req.body?.uf ?? '').slice(0, 2).toUpperCase() || null,
          String(req.body?.motorista ?? '').slice(0, 200),
        ]
      );
      const mudou = transportadoraAntes !== null && transportadoraAntes !== transportadoraNova;
      let abertas = [];
      if (mudou) {
        const upd = await cli.query(
          `UPDATE fact_viagens
              SET transportadora = $1, operador_id = $2, operador_nome = $3, operador_setor = $4
            WHERE placa = $5 AND excluida_em IS NULL AND status_atual <> 'Seguiu Viagem'
            RETURNING ${COLUNAS_CARGA}`,
          [transportadoraNova, op.id, op.nome, op.setor, placa]
        );
        abertas = upd.rows;
        const acao = `Frota: transportadora da placa ${placa} mudou de "${transportadoraAntes || '—'}" para "${transportadoraNova || '—'}"`;
        await gravarNota(cli, { cargaId: null, placa, operador: op,
          acao: `${acao} — ${abertas.length} carga(s) aberta(s) acompanharam` });
        for (const c of abertas) {
          await gravarNota(cli, { cargaId: c.carga_id, placa, operador: op, acao: `${acao} — esta carga acompanhou` });
        }
      }
      return { frota: rows[0], abertas };
    });
    /* O AVISO LEVA O VEÍCULO JUNTO (14/09/2026) — ocorrência #65.

       Antes ia só `{ placa }`, e o painel, sem o dado, respondia baixando o
       PÁTIO INTEIRO. Medido com o medidor de lotação, em banco semeado igual
       ao de produção: cada operador conectado custava 1,23 MB e 41 ms nesse
       instante. Com 100 operadores, UMA placa cadastrada virava 123 MB e 4
       segundos de tela travada para todo mundo — e crescia em linha reta.

       Mandando a linha do veículo aqui, o painel atualiza a frota na memória
       e não faz chamada nenhuma. O formato é o MESMO que `GET /frota`
       devolve: uma forma só para o mesmo dado, senão os dois divergem. */
    emitir('frota:atualizada', {
      placa,
      veiculo: resultado.frota && {
        placa: resultado.frota.placa,
        transportadora: resultado.frota.transportadora,
        tipoVeiculo: resultado.frota.tipo_veiculo,
        capacidadeKg: resultado.frota.capacidade_kg,
        uf: resultado.frota.uf,
        motorista: resultado.frota.motorista,
        precisaRevisao: resultado.frota.precisa_revisao,
        atualizadoEm: resultado.frota.atualizado_em,
      },
    });
    resultado.abertas.forEach((c) => emitirCarga('carga:atualizada', paraPainel(c)));
    res.status(201).json({ ...resultado.frota, cargasAtualizadas: resultado.abertas.length });
  } catch (e) { next(e); }
});

/* Rotas — eram constante no código do painel. Como tabela, a Logística
   cadastra as que faltam (10 códigos ainda sem nome oficial) sem esperar
   uma versão nova ser publicada. */
rotasCadastros.get('/rotas', exigirLogin, async (req, res, next) => {
  try {
    /* `ativa` viaja junto (14/09/2026). O painel precisa das DUAS coisas:
       esconder a rota aposentada dos seletores e continuar resolvendo o
       nome da praça nos registros antigos. Devolver só as ativas apagaria
       o nome de toda carga que já rodou naquela rota. */
    const { rows } = await consultar(
      `SELECT codigo, nome, detalhe, operador, ativa, aposentada_em, aposentada_por
         FROM dim_rotas ORDER BY codigo`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

rotasCadastros.post('/rotas', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const codigo = String(req.body?.codigo ?? '').trim().slice(0, 20);
    if (!codigo) return res.status(400).json({ erro: 'Código da rota é obrigatório.', codigo: 'CODIGO_FALTANDO' });
    const { rows } = await consultar(
      `INSERT INTO dim_rotas (codigo, nome, detalhe, operador)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (codigo) DO UPDATE
         SET nome = EXCLUDED.nome, detalhe = EXCLUDED.detalhe, operador = EXCLUDED.operador
       RETURNING codigo, nome, detalhe, operador`,
      [
        codigo,
        String(req.body?.nome ?? '').slice(0, 200),
        String(req.body?.detalhe ?? '').slice(0, 500),
        String(req.body?.operador ?? '').slice(0, 200),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

/* EXCLUIR ROTA — APAGA A QUE NUNCA RODOU, APOSENTA A QUE RODOU (14/09/2026).

   Pedido do dono, e são dois na mesma frase: "apagar o que tiver repetido,
   ou se aposentar uma rota e criar uma nova".

   Repetição existe de verdade no cadastro oficial — 534 e 540 são as duas
   "Salvador", as duas LogMaster. Rota duplicada ou digitada com o código
   errado nunca foi usada por ninguém: essa sai do banco e some.

   Rota que já rodou é outra história. `rota_codigo` é chave estrangeira de
   QUATRO tabelas, e o DELETE seria recusado pelo próprio banco. Mesmo que
   passasse, as cargas antigas ficariam com um código sem nome de praça no
   relatório que a Administração lê. Regra da casa: o que sai da operação
   continua no Histórico, dizendo para onde foi.

   QUEM DECIDE QUAL DOS DOIS É O SERVIDOR, contando o uso na hora — e não a
   tela, que trabalha com uma cópia que pode estar velha. A resposta diz
   qual aconteceu e por quê, para a tela não ter de adivinhar. */
const USO_DA_ROTA = [
  ['fact_viagens',          'viagens'],
  ['devolucao_rotas',       'devoluções'],
  ['programacao_modelo',    'modelo da semana'],
  ['programacao_montagem',  'montagem do dia'],
];

rotasCadastros.delete('/rotas/:codigo', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const codigo = String(req.params.codigo ?? '').trim().slice(0, 20);
    const { rows: existe } = await consultar(
      'SELECT codigo, nome, ativa FROM dim_rotas WHERE codigo = $1', [codigo]
    );
    if (!existe[0]) {
      return res.status(404).json({ erro: `Rota "${codigo}" não está cadastrada.`, codigo: 'ROTA_NAO_ENCONTRADA' });
    }

    const uso = {};
    let total = 0;
    for (const [tabela, rotulo] of USO_DA_ROTA) {
      const { rows } = await consultar(
        `SELECT count(*)::int AS n FROM ${tabela} WHERE rota_codigo = $1`, [codigo]
      );
      if (rows[0].n > 0) { uso[rotulo] = rows[0].n; total += rows[0].n; }
    }

    if (total === 0) {
      await consultar('DELETE FROM dim_rotas WHERE codigo = $1', [codigo]);
      return res.json({
        codigo, apagada: true, aposentada: false, uso: {},
        mensagem: `Rota ${codigo} apagada — ela nunca foi usada em carga, devolução ou programação.`,
      });
    }

    const onde = Object.entries(uso).map(([k, n]) => `${n} em ${k}`).join(', ');
    await consultar(
      `UPDATE dim_rotas
          SET ativa = FALSE, aposentada_em = now(), aposentada_por = $2
        WHERE codigo = $1`,
      [codigo, req.operador?.nome || '']
    );
    res.json({
      codigo, apagada: false, aposentada: true, uso,
      mensagem: `Rota ${codigo} aposentada: sai dos seletores e não é mais oferecida. `
        + `Não foi apagada porque já foi usada (${onde}) — esses registros continuam `
        + `mostrando o nome da praça.`,
    });
  } catch (e) { next(e); }
});

/* =====================================================================
   TABELA DE FRETE — tarifas por modalidade e km por destino (09/09/2026)
   ---------------------------------------------------------------------
   "criar tabela de frete no embarquesuinco.com.br, cadastro possa ser
    editavel e criada da mesma forma que funcionam os cadastros"

   Por isso ela mora AQUI, junto de Frota e Rotas, e não numa tela à parte:
   é o mesmo gesto (abre, digita, salva) e o mesmo caminho de permissão.

   LEITURA É RESTRITA, ao contrário de Frota e Rotas. Decisão do dono
   perguntado sobre quem vê valor de frete: "logistica e administracao".
   Placa e rota o pátio inteiro precisa saber; quanto se paga por
   quilômetro, não — e a Portaria, a Expedição e o Comercial ficam de fora
   da tabela pelo mesmo motivo que ficam de fora do valor na carga.
   ===================================================================== */

/* AS DUAS LISTAS NUMA CHAMADA SÓ (09/09/2026).

   Elas nasceram como duas rotas, e o painel buscava as duas a cada leitura
   completa. Custou uma regressão que a bateria pegou: test_login_api
   reprovou por LIMITE DE REQUISIÇÕES (429) — o limite cai para o IP quando
   a chamada não tem token (login, polling do Socket.IO), e quatro terminais
   no mesmo IP já vinham perto da borda. Duas chamadas a mais por terminal
   empurraram por cima.

   Tarifas e destinos são lidos sempre juntos, pela mesma tela, na mesma
   hora. Duas chamadas para uma pergunta era desperdício antes de ser
   defeito. As rotas individuais continuam existindo para o cadastro (POST)
   e para quem quiser só uma das listas. */
rotasCadastros.get('/frete/tabela', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const [tarifas, destinos] = await Promise.all([
      consultar(`SELECT tipo_veiculo, valor_por_km, vigente_desde, operador, atualizado_em
                   FROM frete_tarifas ORDER BY valor_por_km`),
      consultar(`SELECT destino, km, ativo, operador, atualizado_em
                   FROM frete_destinos WHERE ativo ORDER BY destino`),
    ]);
    res.json({
      tarifas: tarifas.rows.map((t) => ({
        tipoVeiculo: t.tipo_veiculo, valorPorKm: Number(t.valor_por_km),
        vigenteDesde: t.vigente_desde, operador: t.operador, atualizadoEm: t.atualizado_em,
      })),
      destinos: destinos.rows.map((d) => ({
        destino: d.destino, km: d.km, ativo: d.ativo,
        operador: d.operador, atualizadoEm: d.atualizado_em,
      })),
    });
  } catch (e) { next(e); }
});

rotasCadastros.get('/frete/tarifas', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT tipo_veiculo, valor_por_km, vigente_desde, operador, atualizado_em
         FROM frete_tarifas ORDER BY valor_por_km`
    );
    res.json(rows.map((t) => ({
      tipoVeiculo: t.tipo_veiculo,
      valorPorKm: Number(t.valor_por_km),
      vigenteDesde: t.vigente_desde,
      operador: t.operador,
      atualizadoEm: t.atualizado_em,
    })));
  } catch (e) { next(e); }
});

rotasCadastros.post('/frete/tarifas', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const tipoVeiculo = String(req.body?.tipoVeiculo ?? '').trim().slice(0, 100);
    if (!tipoVeiculo) {
      return res.status(400).json({ erro: 'Tipo de veículo é obrigatório.', codigo: 'TIPO_FALTANDO' });
    }
    /* `Number(req.body.valorPorKm) || 0` colapsaria um campo em branco para
       zero, e tarifa zero é frete de graça gravado em silêncio. Ausente é
       recusa; zero digitado de propósito é aceito (a CHECK do banco
       permite >= 0) — mas quem digitou viu o número. */
    const bruto = req.body?.valorPorKm;
    const valor = bruto === '' || bruto === null || bruto === undefined ? NaN : Number(bruto);
    if (!Number.isFinite(valor) || valor < 0) {
      return res.status(400).json({
        erro: 'Valor por km inválido. Informe o preço em reais por quilômetro (ex.: 7,75).',
        codigo: 'TARIFA_INVALIDA',
      });
    }
    const { rows } = await consultar(
      `INSERT INTO frete_tarifas (tipo_veiculo, valor_por_km, vigente_desde, operador)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4)
       ON CONFLICT (tipo_veiculo) DO UPDATE
         SET valor_por_km  = EXCLUDED.valor_por_km,
             vigente_desde = EXCLUDED.vigente_desde,
             operador      = EXCLUDED.operador,
             atualizado_em = now()
       RETURNING tipo_veiculo, valor_por_km, vigente_desde, operador, atualizado_em`,
      [tipoVeiculo, valor, req.body?.vigenteDesde || null,
       String(req.body?.operador || req.operador?.nome || '').slice(0, 200)]
    );
    emitir('frete:tabela-atualizada', { tipoVeiculo });
    res.status(201).json({
      tipoVeiculo: rows[0].tipo_veiculo,
      valorPorKm: Number(rows[0].valor_por_km),
      vigenteDesde: rows[0].vigente_desde,
      operador: rows[0].operador,
      atualizadoEm: rows[0].atualizado_em,
    });
  } catch (e) { next(e); }
});

rotasCadastros.get('/frete/destinos', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT destino, km, ativo, operador, atualizado_em
         FROM frete_destinos WHERE ativo ORDER BY destino`
    );
    res.json(rows.map((d) => ({
      destino: d.destino, km: d.km, ativo: d.ativo,
      operador: d.operador, atualizadoEm: d.atualizado_em,
    })));
  } catch (e) { next(e); }
});

rotasCadastros.post('/frete/destinos', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    /* MAIÚSCULA, como na tabela oficial. O destino é a CHAVE — "Goiânia" e
       "GOIANIA" precisam ser o mesmo destino, senão o cadastro ganha duas
       linhas com km diferentes e o valor passa a depender de quem digitou.
       Mesma razão da normalização de placa. */
    const destino = String(req.body?.destino ?? '').trim().toUpperCase().slice(0, 200);
    if (!destino) {
      return res.status(400).json({ erro: 'Destino é obrigatório.', codigo: 'DESTINO_FALTANDO' });
    }
    const km = kmValido(req.body?.km);
    if (km === null) {
      return res.status(400).json({
        erro: 'KM do destino é obrigatório e precisa ser maior que zero.',
        codigo: 'KM_INVALIDO',
      });
    }
    const ativo = req.body?.ativo === undefined ? true : req.body.ativo !== false;
    const { rows } = await consultar(
      `INSERT INTO frete_destinos (destino, km, ativo, operador)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (destino) DO UPDATE
         SET km = EXCLUDED.km, ativo = EXCLUDED.ativo,
             operador = EXCLUDED.operador, atualizado_em = now()
       RETURNING destino, km, ativo, operador, atualizado_em`,
      [destino, km, ativo, String(req.body?.operador || req.operador?.nome || '').slice(0, 200)]
    );
    emitir('frete:tabela-atualizada', { destino });
    res.status(201).json({
      destino: rows[0].destino, km: rows[0].km, ativo: rows[0].ativo,
      operador: rows[0].operador, atualizadoEm: rows[0].atualizado_em,
    });
  } catch (e) { next(e); }
});
