/* =====================================================================
   MODELO DA SEMANA E MONTAGEM DO DIA (23/08/2026)
   ---------------------------------------------------------------------
   As duas etapas que ainda aconteciam no Excel:

     1. o template — quais rotas rodam em cada dia da semana;
     2. a montagem — as cargas do dia, criadas ANTES de haver placa.

   A terceira etapa (contratar o transporte) é a ponte: quando a placa
   entra numa montagem, ela vira carga de verdade pela rota de sempre
   (POST /api/cargas) e passa a viver na Torre. Nada aqui reescreve a
   máquina de estados da carga — ver o cabeçalho da migração 031.
   ===================================================================== */
import { Router } from 'express';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';

export const rotasModeloSemana = Router();

/* Só quem programa mexe no template e na montagem — mesma regra de
   `podeCriarCarga`, porque é a mesma responsabilidade um passo antes.
   `exigirSetor` já inclui Administração. */
const SO_LOGISTICA = [exigirLogin, exigirSetor('Logística')];

function novoId() {
  return `mont_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* Normalização única de placa, igual à do painel: sem espaço, sem hífen,
   maiúscula. Duas grafias da mesma placa quebrariam o índice que impede
   placa repetida no dia. */
function normalizarPlaca(v) {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* Data em ISO curto. Aceita vazio (= hoje) porque a tela da manhã abre
   sem escolher dia nenhum. */
function diaOu(hoje, v) {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : hoje;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------------
   MODELO DA SEMANA
   --------------------------------------------------------------------- */

/* Leitura liberada a qualquer setor logado, pelo mesmo motivo da Torre
   compartilhada: enxergar o plano do dia não é privilégio, é o que
   substituiu a pasta do Teams. Escrever continua restrito. */
rotasModeloSemana.get('/modelo-semana', exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await consultar(
      `SELECT m.modelo_id, m.dia_semana, m.rota_codigo, m.ordem, m.tipo_operacao,
              m.qtd_entregas, m.paletizada, m.observacoes, m.apelido_rota, m.ativo,
              r.nome AS rota_nome
         FROM programacao_modelo m
         JOIN dim_rotas r ON r.codigo = m.rota_codigo
        WHERE m.ativo
        ORDER BY m.dia_semana, m.ordem, m.rota_codigo`
    );
    res.json({ modelo: rows });
  } catch (e) { next(e); }
});

rotasModeloSemana.post('/modelo-semana', SO_LOGISTICA, async (req, res, next) => {
  try {
    const dia = Number(req.body?.diaSemana);
    const rota = String(req.body?.rotaCodigo ?? '').trim();
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
      return res.status(400).json({ erro: 'Dia da semana inválido.', codigo: 'DIA_INVALIDO' });
    }
    if (!rota) {
      return res.status(400).json({ erro: 'Escolha a rota.', codigo: 'ROTA_FALTANDO' });
    }
    /* Rota tem que existir no cadastro oficial. A FK do banco garantiria,
       mas devolveria erro de constraint — e o operador precisa de uma
       frase que diga onde resolver. */
    const { rows: r } = await consultar('SELECT codigo FROM dim_rotas WHERE codigo = $1', [rota]);
    if (!r[0]) {
      return res.status(400).json({
        erro: `Rota ${rota} não está cadastrada. Cadastre em Cadastros → Rotas antes de colocá-la no modelo.`,
        codigo: 'ROTA_DESCONHECIDA',
      });
    }
    const ordem = Number.isFinite(Number(req.body?.ordem)) ? Number(req.body.ordem) : 0;
    const { rows } = await consultar(
      `INSERT INTO programacao_modelo
         (dia_semana, rota_codigo, ordem, tipo_operacao, qtd_entregas,
          paletizada, observacoes, apelido_rota, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (dia_semana, rota_codigo, ordem) DO UPDATE
         SET tipo_operacao = EXCLUDED.tipo_operacao,
             qtd_entregas  = EXCLUDED.qtd_entregas,
             paletizada    = EXCLUDED.paletizada,
             observacoes   = EXCLUDED.observacoes,
             apelido_rota  = EXCLUDED.apelido_rota,
             ativo         = TRUE,
             atualizado_em = now()
       RETURNING *`,
      [dia, rota, ordem,
       String(req.body?.tipoOperacao ?? '').trim(),
       Number.isFinite(Number(req.body?.qtdEntregas)) ? Number(req.body.qtdEntregas) : null,
       String(req.body?.paletizada ?? '').trim(),
       String(req.body?.observacoes ?? '').trim(),
       String(req.body?.apelidoRota ?? '').trim(),
       req.operador.nome]
    );
    emitir('modelo:alterado', { diaSemana: dia, por: req.operador.nome });
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

/* Tirar rota do modelo é DESATIVAR, não apagar: o dia já montado continua
   apontando para ela, e o histórico precisa saber que ela existiu. */
rotasModeloSemana.delete('/modelo-semana/:id', SO_LOGISTICA, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });
    }
    const { rows } = await consultar(
      `UPDATE programacao_modelo SET ativo = FALSE, atualizado_em = now()
        WHERE modelo_id = $1 RETURNING modelo_id, dia_semana`, [id]
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Item não encontrado.', codigo: 'NAO_ENCONTRADO' });
    emitir('modelo:alterado', { diaSemana: rows[0].dia_semana, por: req.operador.nome });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------------------------------------------------------------
   MONTAGEM DO DIA
   --------------------------------------------------------------------- */

/* O dia inteiro numa consulta: o modelo daquele dia da semana + o que já
   foi montado. A tela precisa dos dois juntos para mostrar "rota do
   modelo ainda sem carga" — que é o que diz à Logística o que falta
   fazer. */
rotasModeloSemana.get('/montagem', exigirLogin, async (req, res, next) => {
  try {
    const dia = diaOu(hojeISO(), req.query?.dia);
    /* Dia da semana calculado a partir da data ESCOLHIDA, não de "agora":
       consultar a montagem de ontem tem que trazer o modelo de ontem. O
       `T12:00` evita que fuso empurre a data um dia para trás. */
    const diaSemana = new Date(`${dia}T12:00:00`).getDay();

    const [{ rows: modelo }, { rows: montagens }] = await Promise.all([
      consultar(
        `SELECT m.*, r.nome AS rota_nome
           FROM programacao_modelo m
           JOIN dim_rotas r ON r.codigo = m.rota_codigo
          WHERE m.dia_semana = $1 AND m.ativo
          ORDER BY m.ordem, m.rota_codigo`, [diaSemana]
      ),
      consultar(
        `SELECT g.*, r.nome AS rota_nome
           FROM programacao_montagem g
           JOIN dim_rotas r ON r.codigo = g.rota_codigo
          WHERE g.data_prog = $1
          ORDER BY g.sequencia NULLS LAST, g.criado_em`, [dia]
      ),
    ]);
    res.json({ dia, diaSemana, modelo, montagens });
  } catch (e) { next(e); }
});

rotasModeloSemana.post('/montagem', SO_LOGISTICA, async (req, res, next) => {
  try {
    const rota = String(req.body?.rotaCodigo ?? '').trim();
    if (!rota) return res.status(400).json({ erro: 'Escolha a rota.', codigo: 'ROTA_FALTANDO' });
    const { rows: r } = await consultar('SELECT codigo FROM dim_rotas WHERE codigo = $1', [rota]);
    if (!r[0]) {
      return res.status(400).json({
        erro: `Rota ${rota} não está cadastrada.`, codigo: 'ROTA_DESCONHECIDA',
      });
    }
    const dia = diaOu(hojeISO(), req.body?.dia);
    const { rows } = await consultar(
      `INSERT INTO programacao_montagem
         (montagem_id, data_prog, rota_codigo, sequencia, numero_carga, peso,
          qtd_entregas, qtd_ganchos, paletizada, tipo_operacao, motorista,
          observacoes, apelido_rota, modelo_id, criado_por, criado_setor, operador_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15)
       RETURNING *`,
      [novoId(), dia, rota,
       Number.isFinite(Number(req.body?.sequencia)) ? Number(req.body.sequencia) : null,
       String(req.body?.numeroCarga ?? '').trim(),
       Number.isFinite(Number(req.body?.peso)) ? Number(req.body.peso) : null,
       Math.max(1, Number(req.body?.qtdEntregas) || 1),
       Math.max(0, Number(req.body?.qtdGanchos) || 0),
       req.body?.paletizada === 'Sim' ? 'Sim' : 'Não',
       String(req.body?.tipoOperacao ?? '').trim(),
       String(req.body?.motorista ?? '').trim(),
       String(req.body?.observacoes ?? '').trim(),
       // O apelido vem do MODELO, não de quem digita: identifica a
       // transportadora dentro da praça e viaja junto com a linha.
       String(req.body?.apelidoRota ?? '').trim(),
       /* De qual LINHA do modelo esta carga veio. NULL para carga avulsa.
          E o que permite ao "puxar rotas" perguntar "esta linha ja virou
          carga?" em vez de contar quantas daquele codigo existem — e
          contagem nao resolve ambiguidade quando cinco destinos dividem o
          mesmo codigo. */
       Number.isFinite(Number(req.body?.modeloId)) ? Number(req.body.modeloId) : null,
       req.operador.nome, req.operador.setor]
    );
    emitir('montagem:criada', { dia, rota, por: req.operador.nome });
    res.status(201).json({ montagem: rows[0] });
  } catch (e) { next(e); }
});

/* Editar a montagem, INCLUSIVE a placa — é o movimento que a planilha
   permitia e o painel não: pôr placa, tirar, trocar de linha, o dia
   inteiro, sem que nada disso apareça na Torre. */
rotasModeloSemana.patch('/montagem/:id', SO_LOGISTICA, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { rows: atual } = await consultar(
      'SELECT * FROM programacao_montagem WHERE montagem_id = $1', [id]
    );
    if (!atual[0]) return res.status(404).json({ erro: 'Montagem não encontrada.', codigo: 'NAO_ENCONTRADA' });
    /* Depois de efetivada a linha é histórico. Quem quiser mudar mexe na
       CARGA, que tem log de revisões — não aqui, onde a alteração passaria
       sem registro e as duas verdades divergiriam em silêncio. */
    if (atual[0].efetivada_em) {
      return res.status(409).json({
        erro: 'Esta montagem já virou carga. Altere pela Torre de Controle.',
        codigo: 'JA_EFETIVADA',
      });
    }

    const placa = req.body?.placa !== undefined ? normalizarPlaca(req.body.placa) : atual[0].placa;
    if (placa && placa !== atual[0].placa) {
      /* Trava de frota, a mesma da Programação: placa desconhecida não
         gera movimento nenhum, e a mensagem ensina onde resolver. */
      const { rows: f } = await consultar('SELECT placa FROM dim_veiculos WHERE placa = $1', [placa]);
      if (!f[0]) {
        return res.status(400).json({
          erro: `Placa ${placa} não está cadastrada na Frota. Cadastre em Cadastros → Frota antes de vincular.`,
          codigo: 'PLACA_SEM_CADASTRO',
        });
      }
    }

    const campo = (nome, col, conv) => (req.body?.[nome] !== undefined ? conv(req.body[nome]) : atual[0][col]);
    const { rows } = await consultar(
      `UPDATE programacao_montagem
          SET rota_codigo = $2, sequencia = $3, numero_carga = $4, peso = $5,
              qtd_entregas = $6, qtd_ganchos = $7, paletizada = $8,
              tipo_operacao = $9, motorista = $10, observacoes = $11,
              placa = $12, operador_nome = $13, atualizado_em = now()
        WHERE montagem_id = $1
        RETURNING *`,
      [id,
       campo('rotaCodigo', 'rota_codigo', v => String(v ?? '').trim() || atual[0].rota_codigo),
       campo('sequencia', 'sequencia', v => (Number.isFinite(Number(v)) ? Number(v) : null)),
       campo('numeroCarga', 'numero_carga', v => String(v ?? '').trim()),
       campo('peso', 'peso', v => (Number.isFinite(Number(v)) ? Number(v) : null)),
       campo('qtdEntregas', 'qtd_entregas', v => Math.max(1, Number(v) || 1)),
       campo('qtdGanchos', 'qtd_ganchos', v => Math.max(0, Number(v) || 0)),
       campo('paletizada', 'paletizada', v => (v === 'Sim' ? 'Sim' : 'Não')),
       campo('tipoOperacao', 'tipo_operacao', v => String(v ?? '').trim()),
       campo('motorista', 'motorista', v => String(v ?? '').trim()),
       campo('observacoes', 'observacoes', v => String(v ?? '').trim()),
       placa, req.operador.nome]
    );
    emitir('montagem:alterada', { dia: rows[0].data_prog, por: req.operador.nome });
    res.json({ montagem: rows[0] });
  } catch (e) {
    /* O índice único de placa por dia vira 409 com frase de gente: é o
       caso "essa placa já está em outra linha de hoje", que acontece de
       verdade quando duas pessoas montam ao mesmo tempo. */
    if (e && e.code === '23505') {
      return res.status(409).json({
        erro: 'Esta placa já está em outra carga da programação de hoje.',
        codigo: 'PLACA_DUPLICADA',
      });
    }
    next(e);
  }
});

/* Rota do modelo que hoje não sai. Marca em vez de apagar — "não saiu" é
   informação de programação. */
rotasModeloSemana.post('/montagem/:id/cancelar', SO_LOGISTICA, async (req, res, next) => {
  try {
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
    if (!motivo) {
      return res.status(400).json({
        erro: 'Diga o motivo — rota que não sai precisa ficar explicada.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }
    const { rows } = await consultar(
      `UPDATE programacao_montagem
          SET cancelada_em = now(), motivo_cancelo = $2, operador_nome = $3,
              atualizado_em = now()
        WHERE montagem_id = $1 AND efetivada_em IS NULL
        RETURNING *`,
      [String(req.params.id), motivo, req.operador.nome]
    );
    if (!rows[0]) {
      return res.status(409).json({
        erro: 'Montagem não encontrada ou já efetivada.', codigo: 'NAO_CANCELAVEL',
      });
    }
    emitir('montagem:cancelada', { dia: rows[0].data_prog, por: req.operador.nome });
    res.json({ montagem: rows[0] });
  } catch (e) { next(e); }
});

/* A PONTE. Marca a montagem como efetivada e guarda o id da carga que o
   painel acabou de criar.

   Por que o painel cria a carga e só depois avisa aqui, em vez de esta
   rota criar tudo: a criação de carga tem regras próprias (trava de
   frota, movimentação inicial, sincronização, aviso de recusa) que já
   estão testadas em POST /api/cargas. Duplicar isso aqui criaria um
   segundo caminho de criação — e dois caminhos divergem com o tempo. */
rotasModeloSemana.post('/montagem/:id/efetivar', SO_LOGISTICA, async (req, res, next) => {
  try {
    const cargaId = String(req.body?.cargaId ?? '').trim();
    if (!cargaId) {
      return res.status(400).json({ erro: 'Informe a carga criada.', codigo: 'CARGA_FALTANDO' });
    }
    const resultado = await emTransacao(async (cli) => {
      const { rows } = await cli.query(
        `UPDATE programacao_montagem
            SET carga_id = $2, efetivada_em = now(), operador_nome = $3,
                atualizado_em = now()
          WHERE montagem_id = $1 AND efetivada_em IS NULL AND cancelada_em IS NULL
          RETURNING *`,
        [String(req.params.id), cargaId, req.operador.nome]
      );
      return rows[0];
    });
    if (!resultado) {
      return res.status(409).json({
        erro: 'Montagem já efetivada ou cancelada.', codigo: 'NAO_EFETIVAVEL',
      });
    }
    emitir('montagem:efetivada', { dia: resultado.data_prog, cargaId, por: req.operador.nome });
    res.json({ montagem: resultado });
  } catch (e) { next(e); }
});
