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
import { exigirLogin, exigirSetor, recusarFilial } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';
import { calcularFrete } from '../dominio/frete.js';
import { filaReordenada, numerosDaFila } from '../dominio/cargas.js';

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

/* "HOJE" É O DE SÃO PAULO, não o do relógio UTC do servidor (09/09/2026).
   Entre 21h e meia-noite o servidor achava que já era amanhã e a tela da
   manhã abria no dia errado — o mesmo erro do relatório de 14/08, agora do
   lado do servidor. Exportada para o teste conferir. */
export function hojeISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/* ---------------------------------------------------------------------
   MODELO DA SEMANA
   --------------------------------------------------------------------- */

/* Leitura liberada a qualquer setor logado, pelo mesmo motivo da Torre
   compartilhada: enxergar o plano do dia não é privilégio, é o que
   substituiu a pasta do Teams. Escrever continua restrito. */
rotasModeloSemana.get('/modelo-semana', exigirLogin, recusarFilial, async (req, res, next) => {
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
rotasModeloSemana.get('/montagem', exigirLogin, recusarFilial, async (req, res, next) => {
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
        /* O TIPO DE VEÍCULO VEM DA FROTA, PELA PLACA (10/09/2026).
           A tarifa do frete é por modalidade (3/4, Toco, Truck, Bitruck,
           Carreta), e a linha da montagem não guarda modalidade — guarda
           placa. O LEFT JOIN traz o tipo sem exigir placa: linha sem placa
           continua aparecendo, só não tem como calcular valor ainda.

           A transportadora da LINHA vence a da frota quando preenchida —
           é a exceção do dia (subcontratação, freteiro), a mesma regra que
           efetivarMontagemUI já aplica ao criar a carga. */
        `SELECT g.*, r.nome AS rota_nome,
                v.tipo_veiculo AS frota_tipo_veiculo,
                v.transportadora AS frota_transportadora
           FROM programacao_montagem g
           JOIN dim_rotas r ON r.codigo = g.rota_codigo
           LEFT JOIN dim_veiculos v ON v.placa = g.placa
          WHERE g.data_prog = $1
          ORDER BY g.sequencia NULLS LAST, g.criado_em`, [dia]
      ),
    ]);

    /* O VALOR DO FRETE É CALCULADO NA LEITURA, NÃO GUARDADO.
       ---------------------------------------------------------------
       Pedido do dono: "montagem do dia precisa seguir com destino valor
       de frete".

       Não criei coluna para o valor de propósito. Linha de montagem é
       RASCUNHO: a placa muda, o destino muda, o KM é corrigido — e valor
       guardado em rascunho é valor que envelhece calado. Na carga é o
       oposto: lá ele é congelado, porque carga gravada é registro do que
       foi contratado.

       E a conta é a MESMA função do domínio que as cargas usam
       (calcularFrete). Repetir a fórmula aqui daria dois lugares para o
       preço do km divergir — que é exatamente o que a regra da casa
       proíbe: uma função, dois chamadores. */
    const { rows: tar } = await consultar('SELECT tipo_veiculo, valor_por_km FROM frete_tarifas');
    const tarifas = new Map(tar.map((t) => [t.tipo_veiculo, Number(t.valor_por_km)]));
    const comFrete = montagens.map((m) => {
      const r = calcularFrete({
        transportadora: m.transportadora || m.frota_transportadora,
        tipoVeiculo: m.frota_tipo_veiculo,
        kmDeslocamento: m.km_deslocamento,
        tarifas,
      });
      return { ...m, frete_valor: r.valor, frete_tarifa_usada: r.tarifa, frete_motivo: r.motivo };
    });

    res.json({ dia, diaSemana, modelo, montagens: comFrete });
  } catch (e) { next(e); }
});

/* DESTINO E KM NA LINHA DA MONTAGEM (10/09/2026).
   ---------------------------------------------------------------------
   Relato do dono: "quando adiciona a linha ela nao aparece o destino", e o
   pedido: "montagem do dia precisa seguir com destino valor de frete".

   O KM DO DESTINO É RESOLVIDO AQUI, NO SERVIDOR, e não aceito do corpo da
   requisição. É a mesma regra que precoDaCarga() já aplica às cargas: quem
   diz quantos quilômetros tem um destino é o cadastro, não quem monta a
   tela. Aceitar o número do cliente deixaria o valor do frete ser escolhido
   por quem envia a requisição.

   O KM DE DESLOCAMENTO, esse SIM vem de fora — é a correção do operador
   (desvio, retorno, coleta no caminho), e é ele que o cálculo usa. Sem
   correção, nasce igual ao do destino; é o painel que faz essa cópia, e o
   servidor só guarda o que chegou.

   `undefined` preserva o valor atual; string vazia LIMPA. Sem essa
   distinção, editar o peso de uma linha apagaria o destino dela. */
async function destinoEKm(corpo, atual, q) {
  const temDestino = corpo?.freteDestino !== undefined;
  const destino = temDestino
    ? (String(corpo.freteDestino ?? '').trim() || null)
    : (atual ? atual.frete_destino : null);

  let kmDestino = atual ? atual.km_destino : null;
  if (temDestino) {
    kmDestino = null;
    if (destino) {
      const { rows } = await q('SELECT km FROM frete_destinos WHERE destino = $1', [destino]);
      if (rows[0]) kmDestino = rows[0].km;
    }
  }

  const kmDesl = corpo?.kmDeslocamento !== undefined
    ? kmInteiroOuNulo(corpo.kmDeslocamento)
    : (atual ? atual.km_deslocamento : null);

  return { destino, kmDestino, kmDesl };
}

/* Mesma régua de kmValido() do domínio de frete: inteiro positivo ou nada.
   Zero e negativo não são distância — viram nulo, e a coluna vazia diz "não
   informado" em vez de mentir um número. */
function kmInteiroOuNulo(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

/* O NÚMERO DA SEQUÊNCIA NÃO REPETE NO DIA (11/09/2026).
   ---------------------------------------------------------------------
   PEDIDO DO DONO: "fecha dois buracos de numero repedido", depois de
   "SEM DEIXAR QUE REPITA NUMEROS DA SEQUENCIA".

   A cascata de 10/09 fechou o caminho do meio: digitar o número numa linha
   que ainda vai carregar passa por /sequenciar, e lá a fila do dia é
   renumerada inteira, numa transação só. Faltavam os dois caminhos de fora:

     · PATCH gravava `sequencia` CRU. É por onde entra a linha CANCELADA —
       a tela manda o campo direto para cá quando a linha não vai mais
       carregar — e tudo que não é inteiro. E número de linha cancelada é
       RESERVADO: se ele virar o mesmo de uma linha viva, numerosDaFila()
       entende que o número é de quem saiu, tira a linha viva do pool e a
       renumera na cascata seguinte. A ordem do dia muda sozinha, e ninguém
       pediu.
     · POST aceitava o número que o painel mandasse, e o painel mandava
       `montagens.length + 1`. Contar linhas não é achar casa livre: dia com
       linha cancelada ou já reordenada tem buraco, e a conta acerta um
       número que já existe.

   POR QUE NÃO UM ÍNDICE ÚNICO NO BANCO — é a lição da placa, de ontem. O
   índice recusa no lugar mais fundo e mais cedo, sem saber do caso de uso,
   e o dia que ele torna impossível de montar só aparece na operação, com
   caminhão no portão. A regra mora na rota, que sabe o que fazer com o
   pedido: na criação acha casa livre e segue em frente; na edição recusa e
   ENSINA onde se muda a ordem.

   E A TRAVA POR DIA É O NÓ. Ler os números ocupados e gravar o novo são
   duas coisas, e entre uma e outra o segundo computador lê o mesmo "livre".
   Duas pessoas puxando rotas ao mesmo tempo não é caso de borda — é a manhã
   de sexta. `pg_advisory_xact_lock` põe as duas na fila e solta no fim da
   transação, sem tabela de controle e sem índice. */
async function travarSequenciasDoDia(cli, dia) {
  await cli.query(
    "SELECT pg_advisory_xact_lock(hashtext('montagem_sequencia'), hashtext($1::text))",
    [chaveDoDia(dia)]
  );
}

/* A CHAVE DA TRAVA É A DATA EM TEXTO ISO, SEMPRE — e isto é correção de um
   furo meu, achado pela revisão de código no mesmo dia (11/09/2026).

   A criação recebia o dia como texto ('2026-09-11'). A edição e a cascata
   liam `data_prog` do banco, que o driver devolve como Date, e String(Date)
   é 'Fri Sep 11 2026 00:00:00 GMT...'. Duas chaves diferentes para o mesmo
   dia: hashtext não bate, e as travas NÃO SE EXCLUÍAM. Meu teste de
   concorrência só disparou criação contra criação — mesma chave — e passou.
   O bloco 6 de test_numero_de_sequencia_nao_repete.py mede os três caminhos
   contra a mesma trava.

   Aceita Date e texto porque os dois chegam aqui; as consultas que
   alimentam a trava passaram a pedir `data_prog::text` para nem depender
   desta conversão. Formata pelos componentes locais, não por toISOString():
   num servidor fora de UTC, meia-noite local vira o dia anterior em UTC. */
function chaveDoDia(dia) {
  if (dia instanceof Date) {
    const mm = String(dia.getMonth() + 1).padStart(2, '0');
    const dd = String(dia.getDate()).padStart(2, '0');
    return `${dia.getFullYear()}-${mm}-${dd}`;
  }
  return String(dia).slice(0, 10);
}

/* Inteiro a partir de 1, ou nada — mesma régua de kmInteiroOuNulo. E ela
   faz falta por um motivo que só apareceu ao medir: `Number('')` é ZERO, e
   o campo apagado na tela vinha gravando 0 em vez de limpar a coluna.
   Quem apaga o número quer a coluna vazia, não uma linha na casa zero. */
function sequenciaInteiraOuNula(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 1 ? i : null;
}

/* As linhas do dia que já têm número — vivas, efetivadas e canceladas, que
   é o conjunto que reserva casa. Uma leitura, dois chamadores: a criação
   usa para achar casa livre, a edição para recusar o número de outra. */
async function linhasComNumero(cli, dia, exceto) {
  const { rows } = await cli.query(
    `SELECT montagem_id, sequencia, apelido_rota, rota_codigo, numero_carga,
            efetivada_em, cancelada_em
       FROM programacao_montagem
      WHERE data_prog = $1 AND sequencia IS NOT NULL
        AND ($2::text IS NULL OR montagem_id <> $2)`,
    [dia, exceto ?? null]
  );
  return rows;
}

/* Casa livre ACIMA DA MAIOR, nunca por baixo: preencher buraco de baixo
   mudaria a leitura de quem já estava numerado. Mesma decisão, e mesmo
   motivo, de numerosDaFila() em dominio/cargas.js. */
function primeiroNumeroLivre(ocupados) {
  return ocupados.reduce((maior, n) => (n > maior ? n : maior), 0) + 1;
}

/* Como a linha aparece na recusa. Número sozinho não ajuda quem está com 39
   linhas na tela — a mensagem precisa dizer em QUAL delas ele está, e por
   que aquela linha guarda o número mesmo não saindo. */
function nomeDaLinhaNaRecusa(l) {
  const nome = String(l.apelido_rota || '').trim() || `rota ${l.rota_codigo}`;
  const carga = String(l.numero_carga || '').trim();
  const estado = l.efetivada_em
    ? ', que já virou carga'
    : (l.cancelada_em ? ', cancelada — o número dela fica reservado' : '');
  return (carga ? `${nome} (carga ${carga})` : nome) + estado;
}

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
    /* O NÚMERO DA LINHA NOVA É DECIDIDO AQUI, dentro da trava do dia — ver
       a nota de travarSequenciasDoDia. O painel pode pedir um número; se
       ele estiver livre, é honrado (é o caso do "puxar rotas", que cria as
       linhas na ordem do modelo). Se estiver ocupado, ou se não vier
       número nenhum, a linha entra ACIMA da maior casa do dia: ninguém que
       já estava numerado muda de lugar por causa de uma linha nova. */
    const montagem = await emTransacao(async (cli) => {
      await travarSequenciasDoDia(cli, dia);
      const ocupados = (await linhasComNumero(cli, dia)).map((l) => l.sequencia);
      const pedida = sequenciaInteiraOuNula(req.body?.sequencia);
      const sequencia = (pedida !== null && !ocupados.includes(pedida))
        ? pedida
        : primeiroNumeroLivre(ocupados);
      const _dk = await destinoEKm(req.body, null, (q, v) => cli.query(q, v));
      const { rows } = await cli.query(
      `INSERT INTO programacao_montagem
         (montagem_id, data_prog, rota_codigo, sequencia, numero_carga, peso,
          qtd_entregas, qtd_ganchos, paletizada, tipo_operacao, motorista,
          observacoes, apelido_rota, modelo_id, criado_por, criado_setor, operador_nome,
          frete_destino, km_destino, km_deslocamento)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15,$17,$18,$19)
       RETURNING *`,
      [novoId(), dia, rota, sequencia,
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
       req.operador.nome, req.operador.setor,
       _dk.destino, _dk.kmDestino, _dk.kmDesl]
      );
      return rows[0];
    });
    emitir('montagem:criada', { dia, rota, por: req.operador.nome });
    res.status(201).json({ montagem });
  } catch (e) { next(e); }
});

/* Editar a montagem, INCLUSIVE a placa — é o movimento que a planilha
   permitia e o painel não: pôr placa, tirar, trocar de linha, o dia
   inteiro, sem que nada disso apareça na Torre. */
rotasModeloSemana.patch('/montagem/:id', SO_LOGISTICA, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    /* DUAS LEITURAS, DE PROPÓSITO. A trava é por DIA, e para travar o dia
       preciso saber qual é — então primeiro leio só a data, travo, e só
       depois leio a linha inteira. Ler tudo antes da trava daria um valor
       de `sequencia` velho: quem estava reordenando commitaria no meio, e
       eu compararia o número novo com o antigo. */
    const resultado = await emTransacao(async (cli) => {
      const { rows: qualDia } = await cli.query(
        'SELECT data_prog::text AS dia FROM programacao_montagem WHERE montagem_id = $1', [id]
      );
      if (!qualDia[0]) return { naoAchou: true };
      await travarSequenciasDoDia(cli, qualDia[0].dia);
      const { rows: atual } = await cli.query(
        'SELECT * FROM programacao_montagem WHERE montagem_id = $1', [id]
      );
      if (!atual[0]) return { naoAchou: true };
      /* Depois de efetivada a linha é histórico. Quem quiser mudar mexe na
         CARGA, que tem log de revisões — não aqui, onde a alteração passaria
         sem registro e as duas verdades divergiriam em silêncio. */
      if (atual[0].efetivada_em) return { jaEfetivada: true };

      const placa = req.body?.placa !== undefined ? normalizarPlaca(req.body.placa) : atual[0].placa;
      if (placa && placa !== atual[0].placa) {
        /* Trava de frota, a mesma da Programação: placa desconhecida não
           gera movimento nenhum, e a mensagem ensina onde resolver. */
        const { rows: f } = await cli.query('SELECT placa FROM dim_veiculos WHERE placa = $1', [placa]);
        if (!f[0]) return { placaSemCadastro: placa };
      }

      /* O NÚMERO DA SEQUÊNCIA — o buraco 1, fechado aqui (ver a nota de
         travarSequenciasDoDia). Gravar o número de outra linha é recusado,
         e a recusa diz onde o número está e por onde se muda a ordem.

         Reenviar o PRÓPRIO número passa: a tela manda campo a campo, e
         quem está gravando a placa não está pedindo para mudar a fila.

         LIMPAR CONTINUA PERMITIDO. Campo vazio é "esta linha ainda não tem
         lugar na fila" — e `null` não colide com ninguém. */
      const sequencia = req.body?.sequencia !== undefined
        ? sequenciaInteiraOuNula(req.body.sequencia)
        : atual[0].sequencia;
      if (sequencia !== null && sequencia !== atual[0].sequencia) {
        const dona = (await linhasComNumero(cli, atual[0].data_prog, id))
          .find((l) => l.sequencia === sequencia);
        if (dona) return { numeroEmUso: sequencia, dona };
      }

      const campo = (nome, col, conv) => (req.body?.[nome] !== undefined ? conv(req.body[nome]) : atual[0][col]);
      const _dk = await destinoEKm(req.body, atual[0], (q, v) => cli.query(q, v));
      const { rows } = await cli.query(
      `UPDATE programacao_montagem
          SET rota_codigo = $2, sequencia = $3, numero_carga = $4, peso = $5,
              qtd_entregas = $6, qtd_ganchos = $7, paletizada = $8,
              tipo_operacao = $9, motorista = $10, observacoes = $11,
              placa = $12, transportadora = $14, apelido_rota = $15,
              frete_destino = $16, km_destino = $17, km_deslocamento = $18,
              operador_nome = $13, atualizado_em = now()
        WHERE montagem_id = $1
        RETURNING *`,
      [id,
       campo('rotaCodigo', 'rota_codigo', v => String(v ?? '').trim() || atual[0].rota_codigo),
       sequencia,
       campo('numeroCarga', 'numero_carga', v => String(v ?? '').trim()),
       campo('peso', 'peso', v => (Number.isFinite(Number(v)) ? Number(v) : null)),
       campo('qtdEntregas', 'qtd_entregas', v => Math.max(1, Number(v) || 1)),
       campo('qtdGanchos', 'qtd_ganchos', v => Math.max(0, Number(v) || 0)),
       campo('paletizada', 'paletizada', v => (v === 'Sim' ? 'Sim' : 'Não')),
       campo('tipoOperacao', 'tipo_operacao', v => String(v ?? '').trim()),
       campo('motorista', 'motorista', v => String(v ?? '').trim()),
       campo('observacoes', 'observacoes', v => String(v ?? '').trim()),
       placa, req.operador.nome,
       /* Vazio = "o que a Frota diz". A coluna guarda só a EXCEÇÃO do dia
          (subcontratação, freteiro), para o cadastro continuar sendo a
          fonte e o dia registrar o desvio sem apagá-la. */
       campo('transportadora', 'transportadora', v => String(v ?? '').trim()),
       /* O APELIDO ACOMPANHA A ROTA (28/08/2026). Ele vem do modelo da
          semana e nomeia a transportadora dentro da praça. Quando alguém
          troca a rota da linha, o apelido antigo passa a descrever outra
          coisa — e era o texto em negrito da tela. Esta coluna ficava de
          fora do UPDATE, então não havia como limpá-lo junto: a linha
          mostrava a rota nova com o nome da velha. */
       campo('apelidoRota', 'apelido_rota', v => String(v ?? '').trim()),
       _dk.destino, _dk.kmDestino, _dk.kmDesl]
      );
      return { montagem: rows[0] };
    });

    if (resultado.naoAchou) {
      return res.status(404).json({ erro: 'Montagem não encontrada.', codigo: 'NAO_ENCONTRADA' });
    }
    if (resultado.jaEfetivada) {
      return res.status(409).json({
        erro: 'Esta montagem já virou carga. Altere pela Torre de Controle.',
        codigo: 'JA_EFETIVADA',
      });
    }
    if (resultado.placaSemCadastro) {
      return res.status(400).json({
        erro: `Placa ${resultado.placaSemCadastro} não está cadastrada na Frota. `
          + 'Cadastre em Cadastros → Frota antes de vincular.',
        codigo: 'PLACA_SEM_CADASTRO',
      });
    }
    if (resultado.numeroEmUso) {
      /* A RECUSA ENSINA O CAMINHO, não só nega — regra da casa, e aqui ela
         é o que evita a pessoa ficar tentando o mesmo número. */
      return res.status(409).json({
        erro: `O número ${resultado.numeroEmUso} já é de ${nomeDaLinhaNaRecusa(resultado.dona)}. `
          + 'Para mudar a ordem, digite o número na coluna Seq. da linha que ainda vai '
          + 'carregar: ela entra na posição e as outras descem uma casa.',
        codigo: 'SEQUENCIA_EM_USO',
        sequencia: resultado.numeroEmUso,
      });
    }
    emitir('montagem:alterada', { dia: resultado.montagem.data_prog, por: req.operador.nome });
    res.json({ montagem: resultado.montagem });
  } catch (e) {
    /* ESTE 409 DEIXOU DE EXISTIR NA PRÁTICA EM 10/09/2026, e continua
       escrito de propósito.

       A migração 050 tira o UNIQUE do índice de placa por dia: a mesma
       placa em duas linhas é caso REAL — a carreta que carrega em Ribeirão
       Preto e em Marília na mesma rota — e recusar no banco tornava esse
       dia impossível de montar. Quem trata a duplicidade por engano agora é
       o aviso da tela, que diz onde a placa já está e deixa passar.

       Fica aqui porque o servidor roda o código novo ANTES de rodar a
       migração: nessa janela o índice antigo ainda recusa, e recusa sem
       frase nenhuma seria um erro 500 na cara de quem está montando o dia.
       Depois de 050 aplicada este ramo não é mais alcançado. */
    if (e && e.code === '23505') {
      return res.status(409).json({
        erro: 'Esta placa já está em outra carga da programação de hoje '
          + '(o servidor ainda não recebeu a migração 050, que libera a '
          + 'mesma placa em duas linhas).',
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
/* REORDENAR A MONTAGEM DO DIA — A MESMA CASCATA DA TORRE (10/09/2026).
   ---------------------------------------------------------------------
   PEDIDO DO DONO: "eu quero conseguir arrumar e arrastar na montagem do
   dia", depois de pedir "aplica o efeito cascata que ta na torre de
   controle na programacao do dia".

   O QUE A TORRE JÁ FAZIA E A MONTAGEM NÃO: digitar 3 numa linha fazia ela
   entrar na posição 3 e as outras DESCEREM uma casa. Na Montagem, digitar
   3 só escrevia 3 — e se já houvesse uma linha na 3, ficavam duas com o
   mesmo número, sem ninguém avisar.

   A CONTA É A MESMA FUNÇÃO, e isso não é economia de código: é a única
   forma de a Torre e a Montagem concordarem sobre o que significa "entrar
   na posição 3". `filaReordenada` já vive em dominio/cargas.js e já foi
   corrigida uma vez (a renumeração silenciosa de 09/09). Reescrevê-la aqui
   seria garantir que só uma das duas receba a próxima correção.

   ORDEM ESTÁVEL, e ela importa: a fila é montada por `sequencia` e, no
   empate, por `criado_em`. Sem o segundo critério, duas linhas com o mesmo
   número trocam de lugar a cada leitura e o arrasto vira loteria. */
rotasModeloSemana.post('/montagem/:id/sequenciar', SO_LOGISTICA, async (req, res, next) => {
  try {
    const posicao = Number(req.body?.posicao);
    if (!Number.isInteger(posicao) || posicao < 1) {
      return res.status(400).json({
        erro: 'Posição precisa ser um número inteiro a partir de 1.',
        codigo: 'POSICAO_INVALIDA',
      });
    }
    const id = String(req.params.id);

    const resultado = await emTransacao(async (cli) => {
      const { rows: alvo } = await cli.query(
        'SELECT data_prog, data_prog::text AS dia FROM programacao_montagem WHERE montagem_id = $1', [id]
      );
      if (!alvo[0]) return { naoAchou: true };
      /* A MESMA TRAVA DO DIA que a criação e a edição usam. A cascata lê a
         fila e grava a fila nova; sem a trava, uma linha criada no meio
         disso ganha um número que a renumeração não viu. */
      await travarSequenciasDoDia(cli, alvo[0].dia);

      /* SÓ AS LINHAS QUE AINDA VÃO CARREGAR ENTRAM NA FILA.
         Linha já efetivada virou carga: o número dela é registro do que
         aconteceu, e reordenar registro é reescrever história. É a mesma
         distinção que a Torre faz entre "ainda vai carregar" e "já
         carregou", e que nasceu da ocorrência #27. */
      const { rows: fila } = await cli.query(
        `SELECT montagem_id AS id, sequencia FROM programacao_montagem
          WHERE data_prog = $1 AND efetivada_em IS NULL AND cancelada_em IS NULL
          ORDER BY sequencia NULLS LAST, criado_em`,
        [alvo[0].data_prog]
      );
      const { rows: fora } = await cli.query(
        `SELECT sequencia FROM programacao_montagem
          WHERE data_prog = $1 AND (efetivada_em IS NOT NULL OR cancelada_em IS NOT NULL)
            AND sequencia IS NOT NULL`,
        [alvo[0].data_prog]
      );
      const ocupados = fora.map((r) => r.sequencia);

      const mudancas = filaReordenada(fila, id, posicao, ocupados);
      if (mudancas === null) {
        return { invalida: true, casas: numerosDaFila(fila, ocupados) };
      }
      for (const m of mudancas) {
        await cli.query(
          `UPDATE programacao_montagem
              SET sequencia = $1, operador_nome = $2, atualizado_em = now()
            WHERE montagem_id = $3`,
          [m.sequencia, req.operador.nome, m.id]
        );
      }
      return { dia: alvo[0].data_prog, mexidas: mudancas.length };
    });

    if (resultado.naoAchou) {
      return res.status(404).json({ erro: 'Linha não encontrada.', codigo: 'NAO_ACHOU' });
    }
    if (resultado.invalida) {
      /* A RECUSA NOMEIA AS CASAS VÁLIDAS, não só nega. Botão desabilitado
         não ensina o caminho — e mensagem de erro sem o caminho também
         não. É a correção de 10/09 na rota de cargas, aplicada aqui. */
      const casas = resultado.casas || [];
      return res.status(400).json({
        erro: casas.length
          ? `Posição fora da fila. As posições válidas hoje são: ${casas.join(', ')}.`
          : 'Não há fila para reordenar hoje.',
        codigo: 'POSICAO_FORA_DA_FILA',
        casas,
      });
    }
    emitir('montagem:alterada', { dia: resultado.dia, por: req.operador.nome });
    res.json({ ok: true, mexidas: resultado.mexidas });
  } catch (e) { next(e); }
});

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
