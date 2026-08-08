import { Router } from 'express';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';
import {
  COLUNAS_CARGA, paraPainel, saneiarCriacao, saneiarCriacaoChegadaSemProgramacao,
  saneiarEdicao, normalizarPlaca, idSeguro, camposDeAviso,
} from '../dominio/cargas.js';
import {
  validarTransicao, podeCriarCarga, podeRegistrarChegadaSemProgramacao,
  camposEditaveisPor, podeRegistrarSaida,
  ErroDeFluxo, ErroDePermissao, STATUS_INICIAL,
} from '../dominio/fluxo.js';

export const rotasCargas = Router();

function novoId(prefixo) {
  return `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* Grava a movimentação e o log na MESMA transação da mudança da carga.
   Se qualquer um falhar, nada é gravado — o Power BI nunca vê uma carga que
   mudou de status sem o evento correspondente. */
async function gravarEvento(cli, { cargaId, placa, de, para, operador, acao }) {
  const movId = novoId('mov');
  await cli.query(
    `INSERT INTO fact_statusfrota
       (movimentacao_id, carga_id, placa, status_anterior, status_novo, setor,
        operador_id, operador_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [movId, cargaId, placa, de, para, operador.setor, operador.id, operador.nome]
  );
  await cli.query(
    `INSERT INTO log_eventos
       (evento_id, carga_id, placa, acao, setor, operador_id, operador_nome,
        operador_verificado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
    [novoId('log'), cargaId, placa, acao, operador.setor, operador.id, operador.nome]
  );
  return movId;
}

/* ---------------------------------------------------------------------
   POST /api/cargas — cria carga programada
   --------------------------------------------------------------------- */
rotasCargas.post('/cargas', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;

    /* Dois caminhos sob a mesma rota, e a diferença é decisão de produto,
       não só de permissão:

       PROGRAMAÇÃO (Logística) — a carga inteira vem do corpo, e placa fora
       da Frota é bloqueada: a base de Frota é quem manda no que vira carga
       programada.

       CHEGADA SEM PROGRAMAÇÃO (Portaria) — um caminhão que apareceu no
       pátio sem programação prévia. O corpo do cliente não decide nada além
       da placa (saneiarCriacaoChegadaSemProgramacao ignora o resto de
       propósito — ver o comentário lá), e a trava de frota NÃO vale: a
       Portaria precisa registrar a presença do caminhão mesmo que ele nunca
       tenha sido cadastrado. A Logística corrige o cadastro depois.

       `aguardandoCarga:true` é o que escolhe o caminho. Não é o cliente
       quem decide se PODE usá-lo — isso é podeRegistrarChegadaSemProgramacao,
       validado no servidor como tudo mais nesta rota. */
    const chegadaSemProgramacao = req.body?.aguardandoCarga === true;

    /* A trava de setor é para impedir CRIAÇÃO nova por quem não pode —
       não faz sentido aplicá-la a uma carga que já existe.

       O painel reenvia a carga por este mesmo POST a CADA save() (data.js,
       sincronizarCarga), inclusive quando a única mudança foi status —
       que sobe por rota própria, à parte. Isso é o eco normal de
       sincronização (o servidor responde 200 e o cliente cai no PATCH),
       não uma tentativa de criar. Sem este desvio, checar a permissão
       ANTES de saber se a carga já existia rejeitava com "Só a Logística
       programa carga" qualquer sincronização vinda de Portaria/Expedição/
       Faturamento — achado em produção em 07/08/2026: Faturamento
       marcando "Faturado" recebia esse erro em toda gravação, mesmo a
       mudança de status em si tendo sido aceita pela rota própria. */
    const idCliente = idSeguro(req.body?.id);
    const jaExistia = idCliente
      ? !!(await consultar('SELECT 1 FROM fact_viagens WHERE carga_id = $1', [idCliente])).rows[0]
      : false;

    if (!jaExistia) {
      if (chegadaSemProgramacao) {
        if (!podeRegistrarChegadaSemProgramacao(op.setor)) {
          throw new ErroDePermissao('Registrar chegada sem programação é da Portaria ou da Logística.');
        }
      } else if (!podeCriarCarga(op.setor)) {
        throw new ErroDePermissao('Só a Logística programa carga.');
      }
    }

    const placa = normalizarPlaca(req.body?.placa);
    if (!placa) {
      return res.status(400).json({ erro: 'Placa é obrigatória.', codigo: 'PLACA_FALTANDO' });
    }

    /* A TRAVA DE FROTA. Regra de negócio inegociável PARA A PROGRAMAÇÃO:
       placa que não está na base oficial não vira carga programada. Ela
       existia só no navegador; aqui passa a valer também para quem chamar a
       API direto. Não vale para chegadaSemProgramacao — ver o comentário
       acima. */
    const { rows: frotaRows } = await consultar(
      'SELECT placa, transportadora, tipo_veiculo FROM dim_veiculos WHERE placa = $1',
      [placa]
    );
    if (!frotaRows[0] && !chegadaSemProgramacao) {
      return res.status(422).json({
        erro: `Placa ${placa} não está cadastrada na Frota. ` +
              `Cadastre em Cadastros → Frota antes de programar esta carga.`,
        codigo: 'PLACA_FORA_DA_FROTA',
      });
    }

    const dados = chegadaSemProgramacao
      ? saneiarCriacaoChegadaSemProgramacao(req.body, frotaRows[0])
      : saneiarCriacao(req.body, frotaRows[0]);

    const carga = await emTransacao(async (cli) => {
      const cols = Object.keys(dados);
      const vals = Object.values(dados);
      const marcadores = cols.map((_, i) => `$${i + 1}`);

      /* ON CONFLICT DO NOTHING + RETURNING vazio significa "já existe".
         Isso não é erro: é a fila offline reenviando algo que já subiu, e
         tratar como erro faria o painel repetir para sempre. */
      const ins = await cli.query(
        `INSERT INTO fact_viagens (${cols.join(',')}, operador_id, operador_nome, operador_setor)
         VALUES (${marcadores.join(',')}, $${cols.length + 1}, $${cols.length + 2}, $${cols.length + 3})
         ON CONFLICT (carga_id) DO NOTHING
         RETURNING ${COLUNAS_CARGA}`,
        [...vals, op.id, op.nome, op.setor]
      );

      if (!ins.rows[0]) {
        const jaExiste = await cli.query(
          `SELECT ${COLUNAS_CARGA} FROM fact_viagens WHERE carga_id = $1`,
          [dados.carga_id]
        );
        return { linha: jaExiste.rows[0], nova: false };
      }

      await gravarEvento(cli, {
        cargaId: dados.carga_id,
        placa,
        de: null,
        para: dados.status_atual || STATUS_INICIAL,
        operador: op,
        acao: chegadaSemProgramacao ? 'Chegada sem programação registrada' : 'Carga programada',
      });
      return { linha: ins.rows[0], nova: true };
    });

    const payload = paraPainel(carga.linha);
    if (carga.nova) emitir('carga:criada', payload);
    return res.status(carga.nova ? 201 : 200).json(payload);
  } catch (e) {
    return next(e);
  }
});

/* ---------------------------------------------------------------------
   PATCH /api/cargas/:id — edita campos de negócio (não muda status)
   --------------------------------------------------------------------- */
rotasCargas.patch('/cargas/:id', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });

    const permitidos = camposEditaveisPor(op.setor);
    const mudancas = saneiarEdicao(req.body, permitidos);
    if (Object.keys(mudancas).length === 0) {
      return res.status(400).json({
        erro: `Nada a alterar. O setor ${op.setor} pode editar: ${permitidos.join(', ') || 'nenhum campo'}.`,
        codigo: 'SEM_CAMPOS_PERMITIDOS',
      });
    }

    // Trocar a placa revalida a trava de frota e puxa a transportadora nova.
    if (mudancas.placa) {
      const { rows } = await consultar(
        'SELECT transportadora, tipo_veiculo FROM dim_veiculos WHERE placa = $1',
        [mudancas.placa]
      );
      if (!rows[0]) {
        return res.status(422).json({
          erro: `Placa ${mudancas.placa} não está cadastrada na Frota.`,
          codigo: 'PLACA_FORA_DA_FROTA',
        });
      }
      if (mudancas.transportadora === undefined) mudancas.transportadora = rows[0].transportadora;
      if (mudancas.tipo_veiculo === undefined) mudancas.tipo_veiculo = rows[0].tipo_veiculo;
    }

    /* Estado antes da gravação, para saber o que de fato mudou.

       Sem isto o aviso em tempo real só conseguiria dizer "a carga 12345
       mudou", que não ajuda ninguém no pátio: o que importa é "a placa saiu
       de ABC1D23 para XYZ4E56". O SELECT é barato e roda uma vez por edição,
       que é evento raro perto da leitura. */
    const antes = await consultar(
      `SELECT ${COLUNAS_CARGA} FROM fact_viagens WHERE carga_id = $1`, [id]
    );
    if (!antes.rows[0]) {
      return res.status(404).json({ erro: 'Carga não encontrada.', codigo: 'CARGA_NAO_ENCONTRADA' });
    }

    const cols = Object.keys(mudancas);
    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    const params = Object.values(mudancas);

    /* BLOQUEIO OTIMISTA. Se o cliente informar a versão que leu, a gravação
       só passa se ninguém tiver mexido no meio. É o que substitui o "última
       escrita vence" da versão anterior, onde dois setores editando a mesma
       carga faziam um sobrescrever o outro em silêncio.

       Sem `versao` no corpo, grava sem checar — a fila offline não tem como
       saber a versão atual depois de horas sem rede, e recusá-la ali seria
       transformar a proteção em perda de dado. */
    const versaoEsperada = Number(req.body?.versao);
    let filtroVersao = '';
    if (Number.isFinite(versaoEsperada)) {
      params.push(versaoEsperada);
      filtroVersao = ` AND versao = $${params.length}`;
    }
    params.push(id);

    const { rows } = await consultar(
      `UPDATE fact_viagens SET ${sets.join(', ')}
        WHERE carga_id = $${params.length}${filtroVersao}
        RETURNING ${COLUNAS_CARGA}`,
      params
    );

    if (!rows[0]) {
      const atual = await consultar(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens WHERE carga_id = $1`, [id]
      );
      if (!atual.rows[0]) {
        return res.status(404).json({ erro: 'Carga não encontrada.', codigo: 'CARGA_NAO_ENCONTRADA' });
      }
      // Existe, mas a versão mudou: outro operador gravou primeiro. Devolve
      // o estado atual para o painel mostrar o que aconteceu em vez de só
      // dizer "erro".
      return res.status(409).json({
        erro: 'Outro operador alterou esta carga enquanto você editava.',
        codigo: 'CONFLITO_DE_VERSAO',
        atual: paraPainel(atual.rows[0]),
      });
    }

    const payload = paraPainel(rows[0]);
    emitir('carga:atualizada', payload);

    /* Aviso legível, separado do dado.

       São dois eventos de propósito: `carga:atualizada` diz ao painel para
       recarregar, `carga:editada` diz à PESSOA o que aconteceu. Misturar os
       dois obrigaria cada tela a decidir sozinha o que merece aviso, e a
       decisão sairia diferente em cada lugar.

       Só entram os campos que mudaram de verdade — regravar a mesma placa
       não é notícia. E só os campos que o pátio precisa saber: mexer na
       observação de uma carga não pode disparar alerta em cinco terminais. */
    const alteracoes = camposDeAviso(antes.rows[0], rows[0]);
    if (alteracoes.length) {
      emitir('carga:editada', {
        cargaId: payload.id,
        numeroCarga: payload.numeroCarga || '',
        placa: payload.placa,
        alteracoes,
        operador: { id: op.id, nome: op.nome, setor: op.setor },
        // A placa é o que faz o caminhão errado entrar na doca. Ela toca;
        // o resto avisa em silêncio. Alerta que soa para tudo vira ruído,
        // e ruído é ignorado exatamente no dia em que importava.
        sonoro: alteracoes.some((a) => a.campo === 'Placa'),
        em: new Date().toISOString(),
      });
    }
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/* ---------------------------------------------------------------------
   POST /api/cargas/:id/status — avança a carga no fluxo
   --------------------------------------------------------------------- */
rotasCargas.post('/cargas/:id/status', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });

    const statusNovo = String(req.body?.status ?? '');

    const resultado = await emTransacao(async (cli) => {
      /* FOR UPDATE trava a linha até o fim da transação. Sem isso, dois
         cliques simultâneos no mesmo botão leem o mesmo status, os dois
         passam na validação e a carga registra a etapa duas vezes. */
      const { rows } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens WHERE carga_id = $1 FOR UPDATE`,
        [id]
      );
      const carga = rows[0];
      if (!carga) return { naoEncontrada: true };

      // Lança ErroDeFluxo (409) ou ErroDePermissao (403). O rollback é
      // automático — nada fica gravado pela metade.
      validarTransicao(carga.status_atual, statusNovo, op.setor);

      const atualizada = await cli.query(
        `UPDATE fact_viagens
            SET status_atual = $1, operador_id = $2, operador_nome = $3, operador_setor = $4
          WHERE carga_id = $5
          RETURNING ${COLUNAS_CARGA}`,
        [statusNovo, op.id, op.nome, op.setor, id]
      );

      const movId = await gravarEvento(cli, {
        cargaId: id,
        placa: carga.placa,
        de: carga.status_atual,
        para: statusNovo,
        operador: op,
        acao: `Status: ${carga.status_atual} → ${statusNovo}`,
      });

      return { linha: atualizada.rows[0], movId, de: carga.status_atual };
    });

    if (resultado.naoEncontrada) {
      return res.status(404).json({ erro: 'Carga não encontrada.', codigo: 'CARGA_NAO_ENCONTRADA' });
    }

    const payload = paraPainel(resultado.linha);
    emitir('carga:atualizada', payload);
    emitir('movimentacao:nova', {
      id: resultado.movId,
      cargaId: payload.id,
      placa: payload.placa,
      statusAnterior: resultado.de,
      statusNovo: payload.status,
      setor: op.setor,
      operador: op.nome,
      data: payload.atualizadoEm,
    });
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/* ---------------------------------------------------------------------
   DELETE /api/cargas/:id — exclui carga que ainda não virou operação
   ---------------------------------------------------------------------
   A exclusão MARCA em vez de apagar. A leitura incremental do painel busca
   "o que mudou desde X": uma linha apagada não aparece em consulta nenhuma,
   então nenhum outro terminal saberia que ela sumiu — o operador excluiria
   e a carga continuaria na tela dos colegas até alguém recarregar tudo.

   A regra de negócio é a mesma que o painel mostra, e precisa valer aqui
   também: só sai o que ainda está em Aguardando Veículo. Depois disso a
   carga já tem histórico operacional, e apagar histórico é o começo de um
   relatório que ninguém consegue explicar. */
rotasCargas.delete('/cargas/:id', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });

    const resultado = await emTransacao(async (cli) => {
      const { rows } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens WHERE carga_id = $1 FOR UPDATE`,
        [id]
      );
      const carga = rows[0];
      if (!carga) return { ausente: true };

      /* Excluir de novo não é erro.

         A fila offline reenvia o que não confirmou, e duas pessoas podem
         clicar em Excluir na mesma carga. Tratar a segunda como falha faria
         o painel insistir para sempre em algo que já está feito. */
      if (carga.excluida_em) return { jaExcluida: true, carga };

      /* Permissão só é checada quando existe exclusão de verdade a fazer.
         Reenvio de uma carga já excluída (comentário acima) já retornou
         antes de chegar aqui, sem olhar setor — mesmo raciocínio da
         correção do POST /api/cargas (07/08/2026): checar permissão de
         criar/excluir ANTES de saber se ainda há o que fazer transforma
         todo eco de sincronização num 403 sem necessidade. Hoje só
         Logística/Administração têm o botão na tela (podeCancelarCarga,
         app.js), então isto ainda não gera 403 pra ninguém — é reforço
         preventivo, feito junto por ser a mesma causa. */
      if (!podeCriarCarga(op.setor)) {
        throw new ErroDePermissao('Só a Logística exclui carga programada.');
      }

      /* Carga que JÁ SEGUIU VIAGEM não sai por padrão. Ali o caminhão passou
         pela portaria, a nota existe e o cliente recebeu — apagar isso é
         apagar o que aconteceu de verdade, e o relatório do mês deixa de
         fechar.

         Qualquer etapa antes disso pode ser cancelada, e precisa poder: um
         caminhão que encostou e foi embora sem carregar trava a fila do
         pátio até alguém tirar. Antes só dava para excluir enquanto a carga
         estava em "Aguardando Veículo" — depois disso ela sumia da tela de
         Programação e não havia mais como agir sobre ela por lugar nenhum.

         `forcarSeguiuViagem` (pedido direto do usuário, 08/08/2026) é a
         válvula de escape: dado de teste que passou pelo fluxo inteiro
         (ex.: DJF8527) ficava preso pra sempre, sem nenhuma ação possível.
         O painel só manda essa flag depois que o operador digita a placa de
         próprio punho (excluirCargaSeguiuViagemUI, app.js) — a proteção não
         sai, só ganha uma porta que exige confirmação forte. */
      const forcarSeguiuViagem = req.body?.forcarSeguiuViagem === true;
      if (carga.status_atual === 'Seguiu Viagem' && !forcarSeguiuViagem) {
        return { jaSaiu: true, carga };
      }

      /* Cancelar carga que já andou exige MOTIVO. Não é burocracia: é a
         diferença entre "a carga sumiu" e "a carga foi cancelada porque o
         cliente desmarcou". Daqui a três meses, só o motivo responde. */
      const comHistorico = carga.status_atual !== STATUS_INICIAL;
      const motivo = String(req.body?.motivo ?? '').trim().slice(0, 300);
      if (comHistorico && motivo.length < 3) {
        return { motivoFaltando: true, carga };
      }

      await cli.query(
        `INSERT INTO log_eventos
           (evento_id, carga_id, placa, acao, setor, operador_id, operador_nome,
            operador_verificado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
        [novoId('log'), id, carga.placa,
         comHistorico
           ? `Carga cancelada em "${carga.status_atual}" — motivo: ${motivo}`
           : 'Carga programada excluída',
         op.setor, op.id, op.nome]
      );

      const { rows: upd } = await cli.query(
        `UPDATE fact_viagens
            SET excluida_em = now(), excluida_por = $1
          WHERE carga_id = $2
          RETURNING ${COLUNAS_CARGA}`,
        [op.nome, id]
      );
      return { excluida: upd[0] };
    });

    if (resultado.ausente) {
      return res.status(404).json({ erro: 'Carga não encontrada.', codigo: 'CARGA_NAO_ENCONTRADA' });
    }
    if (resultado.jaSaiu) {
      return res.status(409).json({
        erro: 'Esta carga já seguiu viagem. O que já aconteceu no pátio não '
            + 'pode ser apagado — se houve erro, registre a correção no '
            + 'histórico.',
        codigo: 'CARGA_JA_SAIU',
      });
    }
    if (resultado.motivoFaltando) {
      return res.status(400).json({
        erro: `A carga está em "${resultado.carga.status_atual}" e já tem `
            + 'histórico. Informe o motivo do cancelamento.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }
    if (resultado.jaExcluida) {
      return res.json({ ...paraPainel(resultado.carga), excluida: true });
    }

    const payload = { ...paraPainel(resultado.excluida), excluida: true };
    emitir('carga:atualizada', payload);
    emitir('carga:excluida', {
      cargaId: payload.id,
      numeroCarga: payload.numeroCarga || '',
      placa: payload.placa,
      operador: { id: op.id, nome: op.nome, setor: op.setor },
      em: new Date().toISOString(),
    });
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/* ---------------------------------------------------------------------
   POST /api/portaria/saida — o caminhão saiu do pátio
   ---------------------------------------------------------------------
   Uma placa pode carregar mais de uma carga. O caminhão sai uma vez só, e
   a Portaria não deveria ter que escolher qual carga está saindo. Então a
   saída vale para TODAS as cargas Faturadas daquela placa — e devolve as
   que não estavam faturadas, para o porteiro entender por que ficaram. */
rotasCargas.post('/portaria/saida', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    if (!podeRegistrarSaida(op.setor)) {
      throw new ErroDePermissao('A saída do pátio é registrada pela Portaria.');
    }
    const placa = normalizarPlaca(req.body?.placa);
    if (!placa) return res.status(400).json({ erro: 'Placa é obrigatória.', codigo: 'PLACA_FALTANDO' });

    const saida = await emTransacao(async (cli) => {
      const { rows: abertas } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens
          WHERE placa = $1 AND status_atual <> 'Seguiu Viagem'
          FOR UPDATE`,
        [placa]
      );
      const elegiveis = abertas.filter((c) => c.status_atual === 'Faturado');
      const pendentes = abertas.filter((c) => c.status_atual !== 'Faturado');

      const liberadas = [];
      for (const c of elegiveis) {
        const upd = await cli.query(
          `UPDATE fact_viagens
              SET status_atual = 'Seguiu Viagem', operador_id = $1,
                  operador_nome = $2, operador_setor = $3
            WHERE carga_id = $4
            RETURNING ${COLUNAS_CARGA}`,
          [op.id, op.nome, op.setor, c.carga_id]
        );
        await gravarEvento(cli, {
          cargaId: c.carga_id, placa, de: 'Faturado', para: 'Seguiu Viagem',
          operador: op, acao: 'Saída do pátio registrada',
        });
        liberadas.push(upd.rows[0]);
      }
      return { liberadas, pendentes };
    });

    const liberadas = saida.liberadas.map(paraPainel);
    liberadas.forEach((c) => emitir('carga:atualizada', c));

    return res.json({
      placa,
      liberadas,
      pendentes: saida.pendentes.map((c) => ({
        id: c.carga_id, numeroCarga: c.numero_carga, status: c.status_atual,
      })),
    });
  } catch (e) {
    return next(e);
  }
});

/* Erros de domínio já carregam status e código; o handler global em
   servidor.js só precisa repassá-los. */
export { ErroDeFluxo, ErroDePermissao };
