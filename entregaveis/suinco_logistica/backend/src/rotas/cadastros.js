import { Router } from 'express';
import { consultar } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';
import { normalizarPlaca } from '../dominio/cargas.js';

export const rotasCadastros = Router();

/* Frota — a base que sustenta a trava de placa.

   Devolve tudo de uma vez (749 placas hoje, ~90 KB). Paginar isso
   complicaria o painel para economizar quase nada, e ele precisa da base
   inteira em memória para o autocompletar e a busca funcionarem offline. */
rotasCadastros.get('/frota', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT placa, transportadora, tipo_veiculo, capacidade_kg, uf,
              precisa_revisao, atualizado_em
         FROM dim_veiculos ORDER BY placa`
    );
    res.json(rows.map((v) => ({
      placa: v.placa,
      transportadora: v.transportadora,
      tipoVeiculo: v.tipo_veiculo,
      capacidadeKg: v.capacidade_kg,
      uf: v.uf,
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

    const { rows } = await consultar(
      `INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, capacidade_kg, uf, origem)
       VALUES ($1,$2,$3,$4,$5,'manual')
       ON CONFLICT (placa) DO UPDATE
         SET transportadora = EXCLUDED.transportadora,
             tipo_veiculo   = EXCLUDED.tipo_veiculo,
             capacidade_kg  = EXCLUDED.capacidade_kg,
             uf             = EXCLUDED.uf,
             atualizado_em  = now()
       RETURNING placa, transportadora, tipo_veiculo`,
      [
        placa,
        String(req.body?.transportadora ?? '').slice(0, 200),
        String(req.body?.tipoVeiculo ?? '').slice(0, 100),
        capacidadeKg,
        String(req.body?.uf ?? '').slice(0, 2).toUpperCase() || null,
      ]
    );
    emitir('frota:atualizada', { placa });
    res.status(201).json(rows[0]);
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
