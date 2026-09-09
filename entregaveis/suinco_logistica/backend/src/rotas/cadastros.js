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
    emitir('frota:atualizada', { placa });
    resultado.abertas.forEach((c) => emitirCarga('carga:atualizada', paraPainel(c)));
    res.status(201).json({ ...resultado.frota, cargasAtualizadas: resultado.abertas.length });
  } catch (e) { next(e); }
});

/* Rotas — eram constante no código do painel. Como tabela, a Logística
   cadastra as que faltam (10 códigos ainda sem nome oficial) sem esperar
   uma versão nova ser publicada. */
rotasCadastros.get('/rotas', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      'SELECT codigo, nome, detalhe, operador FROM dim_rotas ORDER BY codigo'
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
