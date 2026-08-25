import { Router } from 'express';
import { consultar, emTransacao } from '../banco.js';
import { exigirLogin, exigirSetor } from '../middleware/auth.js';
import { emitir } from '../tempo-real.js';
import { programacaoAtual } from '../dominio/programacoes.js';
import {
  COLUNAS_CARGA, paraPainel, saneiarCriacao, saneiarCriacaoChegadaSemProgramacao,
  saneiarEdicao, normalizarPlaca, idSeguro, camposDeAviso,
} from '../dominio/cargas.js';
import {
  validarTransicao, podeCriarCarga, podeRegistrarChegadaSemProgramacao,
  camposEditaveisPor, podeRegistrarSaida,
  ErroDeFluxo, ErroDePermissao, STATUS_INICIAL, STATUS_FLOW,
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

/* A SEGUNDA ASSINATURA SAIU — decisão do dono, 25/08/2026.
   =====================================================================

   De 22 a 25/08 restaurar, desfazer exclusão e corrigir etapa exigiam
   PEDIDO de um administrador e APROVAÇÃO de outro. Aqui morava a guarda
   que consumia esse pedido. A regra caiu por decisão de quem responde
   pela operação: "quem for da administração não precisa da autorização
   de nada".

   O que ela protegia, dito sem rodeio para quem ler isto depois: essas
   três ações não mudam o pátio, mudam a HISTÓRIA do pátio — são as
   ferramentas de quem quer esconder um erro. A trava existia para que um
   administrador sozinho não reescrevesse o passado sem ninguém ver. Como
   as três rotas já eram exclusivas da Administração, dispensar a
   Administração é dispensar a trava inteira; não sobrou caso em que ela
   ainda valeria.

   O QUE NÃO SE PERDEU, e é por isso que a troca se sustenta: as três
   rotas continuam exigindo MOTIVO e continuam gravando em log_eventos o
   nome, o setor, a hora, o que foi feito e o porquê. "Quem mexeu nesta
   carga e por quê" continua tendo resposta — o que mudou é que ela passou
   a ser encontrada DEPOIS, em vez de a ação ser barrada ANTES.

   A tabela acoes_criticas fica de pé com os pedidos de 22 a 25/08. É
   histórico: nada novo é escrito nela. */

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
       propósito — ver o comentário lá).

       A trava de frota vale para OS DOIS caminhos desde 14/08/2026. Até
       então a chegada sem programação era exceção — a Portaria registrava
       a presença mesmo de placa nunca cadastrada, e a Logística acertava o
       cadastro depois. O gestor decidiu o contrário: a placa é o vínculo
       com a transportadora, e caminhão sem cadastro não gera movimento
       nenhum. Quem chega sem cadastro precisa ser cadastrado primeiro.

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
    if (!frotaRows[0]) {
      return res.status(422).json({
        erro: `Placa ${placa} não está cadastrada na Frota. ` +
              `Cadastre em Cadastros → Frota antes de programar esta carga.`,
        codigo: 'PLACA_FORA_DA_FROTA',
      });
    }

    /* CAMINHÃO QUE NÃO SAIU NÃO CHEGA DE NOVO (19/08/2026).

       Relato do gestor: um caminhão saiu do pátio, a Portaria não registrou
       a saída, e no dia seguinte o porteiro digitou a placa e clicou
       "Chegou". Nasceu uma SEGUNDA carga para a mesma placa e o processo da
       primeira — já em Faturado — ficou órfão: "ele aceitou e agora ele
       sumiu".

       A regra: "se o veículo tiver status em aberto, a portaria não pode
       conseguir alterar. Para ele aceitar que chegou, teria que ter dado
       saída antes."

       A trava mora aqui, e não no painel, porque o painel do porteiro pode
       estar com a lista velha — foi o que aconteceu: no terminal dele a
       carga anterior não estava à vista, então a checagem local não tinha
       o que checar. O servidor sempre tem.

       Vale só para a CHEGADA. A Logística continua programando livremente a
       próxima carga de um caminhão que ainda está no pátio — é assim que se
       monta o dia seguinte. */
    if (chegadaSemProgramacao && !jaExistia) {
      const { rows: abertas } = await consultar(
        `SELECT carga_id, numero_carga, status_atual
           FROM fact_viagens
          WHERE placa = $1 AND status_atual <> 'Seguiu Viagem' AND excluida_em IS NULL
          ORDER BY atualizado_em DESC`,
        [placa]
      );
      if (abertas[0]) {
        const lista = abertas
          .map((c) => `${c.numero_carga || 'sem número'} (${c.status_atual})`)
          .join(', ');
        return res.status(409).json({
          erro: `${placa} ainda tem ${abertas.length} carga(s) em aberto: ${lista}. `
            + 'Registre a SAÍDA desse caminhão antes de registrar a chegada dele de novo — '
            + 'sem isso o processo anterior fica pendurado e some da fila dos outros setores.',
          codigo: 'PLACA_COM_CARGA_ABERTA',
          cargasAbertas: abertas.map((c) => ({
            id: c.carga_id, numeroCarga: c.numero_carga, status: c.status_atual,
          })),
        });
      }
    }

    const dados = chegadaSemProgramacao
      ? saneiarCriacaoChegadaSemProgramacao(req.body, frotaRows[0])
      : saneiarCriacao(req.body, frotaRows[0]);
    // Entrada sem programação não tem data de programação, venha o que vier
    // no corpo (painel antigo mandava a data da CHEGADA aqui).
    if (chegadaSemProgramacao) dados.programado_em = null;

    /* Toda carga nasce dentro do ciclo de programação ABERTO. É o que faz
       o histórico de programações existir sem mover nem copiar carga: ela
       continua uma só, e o ciclo é só mais um recorte sobre ela. */
    dados.programacao_id = await programacaoAtual();

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

    /* REDE DE SEGURANÇA: lançar a carga carimba a data de programação AQUI,
       mesmo que o painel não a mande.

       Sair de `aguardando_carga: true` para `false` é, por definição, o
       momento em que a carga de um caminhão que já estava no pátio foi
       lançada. O painel atualizado manda `programadoEm` junto; um painel em
       versão antiga não manda campo nenhum, e aí a carga ficava sem data de
       programação e caía na data de CHEGADA na leitura — voltando a sumir do
       relatório do dia em que foi lançada.

       Depender de todo terminal estar atualizado no mesmo minuto não
       funciona numa operação com seis setores e turnos diferentes. O
       servidor sabe o suficiente para decidir sozinho, então decide.

       Combina com o COALESCE abaixo: só entra se ainda não houver data, e
       nunca sobrescreve o que o painel informou. */
    /* O LANÇAMENTO MANDA NA DATA (19/08/2026).

       Relato: a programação do dia saiu com 11 cargas e o relatório trouxe
       9. As duas que faltaram eram caminhões que deram entrada ONTEM e
       tiveram a carga lançada hoje — elas carregavam a data da ENTRADA, e o
       COALESCE abaixo (que existe para eco de sincronização não mover data)
       preservava justamente o valor errado.

       Duas regras, e as duas moram aqui porque o servidor é o único ponto
       que independe de painel atualizado:

         · enquanto a carga está AGUARDANDO CARGA, ela não tem data de
           programação — nenhuma. Entrada de caminhão não é programação, e
           inventar uma data aqui é a origem do problema;
         · no instante do LANÇAMENTO (aguardando_carga true → false), a data
           é gravada AGORA, por cima do que houver. É o único momento em que
           sobrescrever é o certo: a carga está sendo programada neste ato. */
    const eraAguardandoCarga = antes.rows[0].aguardando_carga === true;
    const estaVirandoCarga = eraAguardandoCarga && mudancas.aguardando_carga === false;
    let forcarProgramadoEm = null;
    if (estaVirandoCarga) {
      forcarProgramadoEm = new Date();
      mudancas.programado_em = forcarProgramadoEm;
    } else if (eraAguardandoCarga) {
      /* Continua sendo só uma ENTRADA: nada aqui pode gravar data de
         programação — nem o eco de um painel antigo, que mandava a data da
         chegada e cimentava o erro. */
      delete mudancas.programado_em;
    }

    const cols = Object.keys(mudancas);
    /* `programado_em` é GRAVÁVEL UMA VEZ SÓ — COALESCE, não atribuição.

       Descoberto em produção em 14/08/2026, olhando o banco depois da
       atualização: 109 cargas apareceram com `atualizado_em` nos MESMOS dois
       instantes (21:12 e 21:18), logo após o serviço reiniciar. Não foi
       ninguém editando: foram os painéis reconectando e reenviando as cargas
       que tinham em memória.

       O problema é que cada painel reenvia a carga INTEIRA a cada gravação,
       com a data de programação que ele tem localmente. Um terminal que
       ainda não recebeu o valor novo manda o antigo de volta — e a data
       correta, gravada quando a Logística lançou a carga, era desfeita por
       um colega que só tinha o painel aberto. O relatório voltava a errar
       sozinho, sem ninguém ter feito nada.

       Com COALESCE a data só entra quando ainda não existe: quem lança a
       carga define, e eco de sincronização não move mais. Corrigir de
       propósito continua possível direto no banco, que é operação rara e
       consciente. */
    const sets = cols.map((c, i) => {
      if (c === 'programado_em') {
        // No lançamento a data é atribuída; fora dele, COALESCE — a
        // proteção contra eco de terminal desatualizado continua de pé.
        return forcarProgramadoEm
          ? `programado_em = $${i + 1}`
          : `programado_em = COALESCE(programado_em, $${i + 1})`;
      }
      /* `observacoes`: texto VAZIO não apaga texto existente.

         Mesma origem do caso acima, e mais grave, porque observação é
         editável por todos os setores: o eco de sincronização de um
         terminal com cópia velha chegava com '' e zerava o que a
         Administração tinha acabado de escrever. Era o que fazia o
         relatório de Fretes voltar a mostrar "a preencher" depois de
         preenchido.

         A causa de fundo (painel reenviando o cache inteiro após um F5)
         foi corrigida em data.js. Isto aqui é a segunda linha de defesa,
         que vale enquanto existir terminal em versão antiga na operação —
         e no dia a dia sempre existe.

         O custo é não dar para ESVAZIAR uma observação pela tela; para
         trocar, basta escrever outro texto. Perder a possibilidade de
         apagar é muito menor que perder o texto sozinho. */
      if (c === 'observacoes') {
        return `observacoes = COALESCE(NULLIF($${i + 1}, ''), observacoes)`;
      }
      /* OS LACRES SEGUEM A MESMA REGRA — E PELO MESMO MOTIVO (20/08/2026).

         Descoberto medindo o tráfego do painel: um terminal que ainda não
         recebeu o lacre reenvia a carga com `lacre:'', lacre2:'', lacre3:''`
         no eco de sincronização, e isso APAGAVA números já gravados. Foi
         visto acontecer: a Portaria registrou dois lacres na saída, o banco
         guardou os dois, e minutos depois o segundo estava vazio — sem
         ninguém ter feito nada, sem erro em tela nenhuma.

         É a mesma família do sumiço das observações em 14/08 e recebe a
         mesma defesa: VAZIO NÃO APAGA. Para trocar um lacre, digita-se o
         outro número; para tirar um lacre errado do registro, a correção é
         consciente, no banco — e não um efeito colateral de alguém ter
         deixado uma aba aberta.

         Vale também para `lacre_retido`: retenção é ocorrência de inspeção,
         não pode evaporar por eco. */
      if (c === 'lacre' || c === 'lacre_2' || c === 'lacre_3' || c === 'lacre_retido') {
        return `${c} = COALESCE(NULLIF($${i + 1}, ''), ${c})`;
      }
      /* `aguardando_carga` anda em UM SENTIDO SÓ: true → false.

         Incidente de 15/08/2026: cinco cargas já lançadas (com peso, rota,
         e status até "Seguiu Viagem" e "Faturado") voltaram sozinhas para a
         lista "Aguardando Carga" e sumiram do relatório — 62 toneladas a
         menos entre duas emissões com poucas horas de diferença.

         A auditoria do código mostrou que NENHUM fluxo do painel liga essa
         marca de volta: ela nasce `true` só na chegada pela Portaria
         (registrarChegadaPortaria) e vira `false` quando a carga é lançada
         (completarCargaAguardando). Não existe "desprogramar".

         Como o campo é editável por PATCH, quem a religou foi eco de
         sincronização: um terminal que ainda tinha a cópia do dia em que o
         caminhão chegou — quando a carga de fato estava aguardando dados —
         reenviou essa cópia e desfez o lançamento. Junto com a marca voltava
         o peso zerado e a rota vazia daquela versão.

         `AND` resolve pela álgebra, sem exceção a manter: já lançada
         (false) com eco true continua false; aguardando (true) com o
         lançamento de verdade (false) vira false, que é o caminho normal. */
      if (c === 'aguardando_carga') {
        return `aguardando_carga = (aguardando_carga AND $${i + 1})`;
      }
      return `${c} = $${i + 1}`;
    });
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

      /* CHEGADA com outra carga da placa ainda no pátio (19/08/2026),
         CORRIGIDA EM 20/08/2026.

         O caso original: DUAS cargas na mesma placa, uma faturada do dia
         ANTERIOR sem saída registrada e uma programada para o dia. O
         "Chegou" promoveu a de hoje e deixou a de ontem pendurada — "ele
         aceitou e agora ele sumiu".

         A primeira versão desta trava barrava QUALQUER carga da placa que
         já estivesse no pátio, e isso quebrou o caso mais comum da
         operação. Relato do programador de embarque no dia seguinte, sobre
         uma placa com duas cargas do mesmo dia: "na segunda carga a placa
         está dando que o veículo não chegou, só que o veículo está no
         pátio... aí você dá a entrada nele e não dá. É isso que está dando
         interferência".

         Ele está certo. Caminhão com duas cargas no mesmo dia é rotina —
         carrega, pesa, carrega de novo, pesa — e as DUAS têm que estar no
         pátio. O que não pode é a carga de um dia anterior ficar pendurada.

         Então a trava passa a comparar o DIA DE PROGRAMAÇÃO: só barra
         quando a carga já no pátio é de uma programação ANTERIOR à que está
         chegando. Mesmo dia = mesmo caminhão, mesma visita, segue livre. */
      if (statusNovo === 'Aguardando Embarque') {
        const FUSO = 'America/Sao_Paulo';
        const { rows: noPatio } = await cli.query(
          `SELECT carga_id, numero_carga, status_atual
             FROM fact_viagens
            WHERE placa = $1 AND carga_id <> $2 AND excluida_em IS NULL
              AND status_atual NOT IN ('Aguardando Veículo', 'Seguiu Viagem')
              AND (COALESCE(programado_em, criado_em) AT TIME ZONE $3)::date
                  < (COALESCE($4::timestamptz, now()) AT TIME ZONE $3)::date`,
          [carga.placa, id, FUSO, carga.programado_em || carga.criado_em]
        );
        if (noPatio[0]) {
          return { bloqueadaPorPendencia: noPatio, placa: carga.placa };
        }
      }

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

    if (resultado.bloqueadaPorPendencia) {
      const lista = resultado.bloqueadaPorPendencia
        .map((c) => `${c.numero_carga || 'sem número'} (${c.status_atual})`)
        .join(', ');
      return res.status(409).json({
        erro: `${resultado.placa} ainda tem carga em aberto no pátio: ${lista}. `
          + 'Registre a SAÍDA desse caminhão antes de marcar a chegada dele de novo — '
          + 'sem isso o processo anterior fica pendurado e some da fila dos outros setores.',
        codigo: 'PLACA_COM_CARGA_ABERTA',
        cargasAbertas: resultado.bloqueadaPorPendencia.map((c) => ({
          id: c.carga_id, numeroCarga: c.numero_carga, status: c.status_atual,
        })),
      });
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

    /* Aceita `lacres: []` (painel novo) e `lacre: ''` (painel em cache) —
       enquanto existir terminal desatualizado na operação, as duas formas
       precisam funcionar, senão a saída volta a ser registrada sem número. */
    const lacres = (Array.isArray(req.body?.lacres) ? req.body.lacres : [req.body?.lacre])
      .map((x) => String(x ?? '').trim().slice(0, 50))
      .filter(Boolean)
      .slice(0, 3);

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
        /* O LACRE ENTRA AQUI, NA MESMA TRANSAÇÃO DA SAÍDA (20/08/2026).

           Até hoje o painel mandava a saída por esta rota e os números de
           lacre por um PATCH separado, logo depois. Duas gravações para um
           fato só: se a segunda falhasse — rede caindo, aba fechada, painel
           velho —, ficava registrada uma saída SEM lacre e ninguém saberia
           que faltou. Pedido do gestor: "grave fielmente no backend e traga
           as informações fiéis saindo nos relatórios". Fiel começa por não
           poder se perder no meio do caminho.

           Vazio não apaga: quem sai sem informar lacre não zera o que já
           estava lá (a Portaria pode ter registrado antes). */
        const upd = await cli.query(
          `UPDATE fact_viagens
              SET status_atual = 'Seguiu Viagem', operador_id = $1,
                  operador_nome = $2, operador_setor = $3,
                  lacre   = COALESCE(NULLIF($5, ''), lacre),
                  lacre_2 = COALESCE(NULLIF($6, ''), lacre_2),
                  lacre_3 = COALESCE(NULLIF($7, ''), lacre_3)
            WHERE carga_id = $4
            RETURNING ${COLUNAS_CARGA}`,
          [op.id, op.nome, op.setor, c.carga_id, lacres[0] || '', lacres[1] || '', lacres[2] || '']
        );
        await gravarEvento(cli, {
          cargaId: c.carga_id, placa, de: 'Faturado', para: 'Seguiu Viagem',
          operador: op,
          acao: 'Saída do pátio registrada'
            + (lacres.length ? ` — lacre(s) ${lacres.join(' / ')}` : ' — SEM lacre informado'),
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


/* ---------------------------------------------------------------------
   POST /api/portaria/lacre-retido — a retenção vira REGISTRO
   ---------------------------------------------------------------------

   Na inspeção da saída o lacre às vezes é retido: carga incorreta,
   conferência, divergência. Até 20/08/2026 o número tinha campo próprio,
   mas o MOTIVO, o AUTOR e a HORA iam para dentro de `observacoes`, numa
   frase concatenada — o que serve para ler na tela e não serve para mais
   nada: não dá para contar retenções do mês, nem filtrar por motivo, e a
   informação some no dia em que alguém editar a observação.

   Aqui a retenção passa a ser um fato com os quatro elementos: número,
   motivo, quem e quando. A observação continua recebendo a frase, porque é
   ali que o operador lê no dia a dia — mas ela deixou de ser a única
   guardiã do dado.

   Vale para as cargas da PLACA (o lacre é do caminhão, não de uma carga):
   as que saíram hoje, ou — se nenhuma saiu ainda — as que estão em aberto. */
rotasCargas.post('/portaria/lacre-retido', exigirLogin, async (req, res, next) => {
  try {
    const op = req.operador;
    if (!podeRegistrarSaida(op.setor)) {
      throw new ErroDePermissao('A retenção de lacre é registrada pela Portaria.');
    }
    const placa = normalizarPlaca(req.body?.placa);
    if (!placa) return res.status(400).json({ erro: 'Placa é obrigatória.', codigo: 'PLACA_FALTANDO' });

    const retido = String(req.body?.lacreRetido ?? '').trim().slice(0, 50);
    if (!retido) {
      return res.status(400).json({
        erro: 'Informe o número do lacre retido.', codigo: 'LACRE_FALTANDO',
      });
    }
    const novoLacre = String(req.body?.novoLacre ?? '').trim().slice(0, 50);
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);

    const FUSO = 'America/Sao_Paulo';
    const resultado = await emTransacao(async (cli) => {
      /* Alvo: quem saiu HOJE com essa placa. Se ninguém saiu ainda, as
         cargas em aberto — é o caso do porteiro que retém o lacre antes de
         liberar o caminhão. */
      const { rows: sairam } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens
          WHERE placa = $1 AND excluida_em IS NULL
            AND status_atual = 'Seguiu Viagem'
            AND (atualizado_em AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
          FOR UPDATE`,
        [placa, FUSO]
      );
      let alvo = sairam;
      if (!alvo.length) {
        const { rows: abertas } = await cli.query(
          `SELECT ${COLUNAS_CARGA} FROM fact_viagens
            WHERE placa = $1 AND excluida_em IS NULL AND status_atual <> 'Seguiu Viagem'
            FOR UPDATE`,
          [placa]
        );
        alvo = abertas;
      }

      const nota = `Lacre ${retido} RETIDO`
        + (motivo ? ` — ${motivo}` : '')
        + (novoLacre ? ` — novo lacre ${novoLacre}` : '')
        + ` (${op.nome})`;

      const atingidas = [];
      for (const c of alvo) {
        const upd = await cli.query(
          `UPDATE fact_viagens
              SET lacre_retido = $1,
                  lacre_retido_motivo = $2,
                  lacre_retido_por = $3,
                  lacre_retido_em = now(),
                  lacre = COALESCE(NULLIF($4, ''), lacre),
                  observacoes = CASE WHEN observacoes = '' THEN $5
                                     ELSE observacoes || ' | ' || $5 END,
                  operador_id = $6, operador_nome = $7, operador_setor = $8
            WHERE carga_id = $9
            RETURNING ${COLUNAS_CARGA}`,
          [retido, motivo, op.nome, novoLacre, nota, op.id, op.nome, op.setor, c.carga_id]
        );
        await cli.query(
          `INSERT INTO log_eventos
             (evento_id, carga_id, placa, acao, setor, operador_id, operador_nome,
              operador_verificado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
          [novoId('log'), c.carga_id, placa, nota, op.setor, op.id, op.nome]
        );
        atingidas.push(upd.rows[0]);
      }
      return atingidas;
    });

    const payloads = resultado.map(paraPainel);
    payloads.forEach((c) => emitir('carga:atualizada', c));
    return res.json({ placa, atingidas: payloads, total: payloads.length });
  } catch (e) {
    return next(e);
  }
});


/* =====================================================================
   REVISÕES E RESTAURAR — Administração (16/08/2026)
   =====================================================================
   O trigger da migration 009 guarda o estado ANTERIOR de toda mudança
   real. Estas rotas expõem esse histórico e permitem voltar uma carga a
   um ponto anterior — o que na semana de 14–15/08 precisou ser feito no
   braço, a partir de um PDF.

   RESTAURAR continua só da Administração (`exigirSetor()` sem argumento).
   LER as revisões abriu um degrau (21/08/2026): Logística também lê — o
   Controle da Programação mostra o log de alterações de cada carga, e o
   controle é de quem programa. Os setores de operação (Portaria,
   Expedição, Faturamento) continuam de fora, por decisão do gestor:
   "visualização somente Logística/Administração". */

rotasCargas.get('/cargas/:id/revisoes', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });
    const { rows } = await consultar(
      `SELECT revisao_id, dados, gravada_em, mudada_por, mudada_setor
         FROM carga_revisoes WHERE carga_id = $1
        ORDER BY revisao_id DESC LIMIT 50`,
      [id]
    );
    res.json(rows.map((r) => ({
      revisaoId: Number(r.revisao_id),
      gravadaEm: r.gravada_em,
      mudadaPor: r.mudada_por,
      mudadaSetor: r.mudada_setor,
      // O snapshot vai no formato do painel, para a tela mostrar os campos
      // com os mesmos nomes e formatações de sempre.
      carga: paraPainel(r.dados),
    })));
  } catch (e) { next(e); }
});

rotasCargas.post('/cargas/:id/restaurar', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const id = idSeguro(req.params.id);
    const revisaoId = Number(req.body?.revisaoId);
    if (!id || !Number.isFinite(revisaoId)) {
      return res.status(400).json({ erro: 'Informe a revisão a restaurar.', codigo: 'REVISAO_FALTANDO' });
    }
    const op = req.operador;
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
    if (!motivo) {
      return res.status(400).json({
        erro: 'Diga por que esta carga precisa voltar — o motivo fica no histórico.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }

    const { linha } = await emTransacao(async (cli) => {
      const rev = await cli.query(
        'SELECT dados FROM carga_revisoes WHERE revisao_id = $1 AND carga_id = $2',
        [revisaoId, id]
      );
      if (!rev.rows[0]) {
        const e = new Error('Revisão não encontrada para esta carga.');
        e.status = 404; e.codigo = 'REVISAO_NAO_ENCONTRADA';
        throw e;
      }
      const d = rev.rows[0].dados;

      /* Restaura os campos de NEGÓCIO do snapshot. Escrita direta, sem as
         travas de sentido único do PATCH, de propósito: as travas existem
         para barrar ECO de sincronização; isto aqui é decisão humana da
         Administração, auditada logo abaixo. criado_em fica intocado (é o
         histórico da chegada); excluida_em/excluida_por ficam como estão —
         restaurar conteúdo não é des-excluir. */
      const upd = await cli.query(
        `UPDATE fact_viagens SET
           numero_carga = $1, placa = $2, transportadora = $3, tipo_veiculo = $4,
           motorista = $5, cliente = $6, destino = $7, peso_kg = $8, doca = $9,
           rota_codigo = $10, sequencia = $11, pra_onde = $12, paletizada = $13,
           qtd_ganchos = $14, qtd_entregas = $15, observacoes = $16,
           status_atual = $17, aguardando_carga = $18, programado_em = $19,
           atualizado_em = now(),
           operador_id = $20, operador_nome = $21, operador_setor = $22
         WHERE carga_id = $23
         RETURNING ${COLUNAS_CARGA}`,
        [d.numero_carga, d.placa, d.transportadora, d.tipo_veiculo, d.motorista,
         d.cliente, d.destino, d.peso_kg, d.doca, d.rota_codigo, d.sequencia,
         d.pra_onde, d.paletizada, d.qtd_ganchos, d.qtd_entregas, d.observacoes,
         d.status_atual, d.aguardando_carga, d.programado_em,
         op.id, op.nome, op.setor, id]
      );
      if (!upd.rows[0]) {
        const e = new Error('Carga não encontrada.');
        e.status = 404; e.codigo = 'CARGA_NAO_ENCONTRADA';
        throw e;
      }

      // Auditoria: restaurar é exatamente o tipo de ação que precisa de
      // trilha — responde "quem voltou a carga X e para qual estado".
      await cli.query(
        `INSERT INTO log_eventos
           (evento_id, carga_id, placa, acao, setor, operador_id, operador_nome,
            operador_verificado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)`,
        [novoId('log'), id, upd.rows[0].placa,
         `Carga restaurada para o estado de ${new Date(d.atualizado_em || d.criado_em).toISOString()} `
           + `(revisão ${revisaoId}) — motivo: ${motivo}`,
         op.setor, op.id, op.nome]
      );
      return { linha: upd.rows[0] };
    });

    const payload = paraPainel(linha);
    emitir('carga:atualizada', payload);
    res.json(payload);
  } catch (e) { next(e); }
});

/* Erros de domínio já carregam status e código; o handler global em
   servidor.js só precisa repassá-los. */
export { ErroDeFluxo, ErroDePermissao };

/* Corrigir a DATA DE PROGRAMAÇÃO de uma carga — só a Administração.

   A data nasce quando a carga é lançada e é gravável UMA VEZ SÓ (COALESCE
   no PATCH), justamente para eco de sincronização não movê-la. Mas
   acontece de a carga ir para o dia errado: no caso de 19/08/2026, uma
   programação foi excluída e relançada, e caiu no dia seguinte — "eu quero
   essa carga de volta na programação de ontem".

   Até aqui a saída era mexer direto no banco. Agora é uma ação do painel,
   com motivo obrigatório e trilha: quem mudou, de quando para quando e por
   quê. Correção de data é rara, mas quando é preciso, é preciso — e mexer
   no banco à mão não deixa rastro que alguém consiga ler depois. */
rotasCargas.post('/cargas/:id/data-programacao', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });

    const dia = String(req.body?.data ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return res.status(400).json({
        erro: 'Informe a data da programação no formato AAAA-MM-DD.', codigo: 'DATA_INVALIDA',
      });
    }
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
    if (!motivo) {
      return res.status(400).json({
        erro: 'Diga o motivo da correção — a data entra no relatório do dia, e quem ler depois precisa saber por quê.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }
    const op = req.operador;

    const resultado = await emTransacao(async (cli) => {
      const { rows } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens
          WHERE carga_id = $1 AND excluida_em IS NULL FOR UPDATE`,
        [id]
      );
      const carga = rows[0];
      if (!carga) return { naoEncontrada: true };

      /* Meio-dia local, e não meia-noite: a data é lida em América/São_Paulo
         e a meia-noite UTC cairia no dia anterior no relatório — o mesmo
         erro de fuso que a data de programação já teve uma vez. */
      const nova = new Date(`${dia}T12:00:00-03:00`);
      const antes = carga.programado_em || carga.criado_em;

      const upd = await cli.query(
        `UPDATE fact_viagens
            SET programado_em = $1, atualizado_em = now(),
                operador_id = $2, operador_nome = $3, operador_setor = $4,
                versao = versao + 1
          WHERE carga_id = $5
          RETURNING ${COLUNAS_CARGA}`,
        [nova, op.id, op.nome, op.setor, id]
      );

      await gravarEvento(cli, {
        cargaId: id,
        placa: carga.placa,
        de: carga.status_atual,
        para: carga.status_atual,
        operador: op,
        acao: `Data de programação corrigida: ${new Date(antes).toISOString().slice(0, 10)} → ${dia}. Motivo: ${motivo}`,
      });

      return { linha: upd.rows[0] };
    });

    if (resultado.naoEncontrada) {
      return res.status(404).json({ erro: 'Carga não encontrada.', codigo: 'CARGA_NAO_ENCONTRADA' });
    }
    const payload = paraPainel(resultado.linha);
    emitir('carga:atualizada', payload);
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/* Desfazer a exclusão de uma carga — só a Administração.

   Caso de 19/08/2026: a Logística excluiu a programação 118245 e relançou,
   e a carga original — já faturada, com histórico de todos os setores —
   ficou marcada como excluída. "Devolve essa aqui." Até agora a única saída
   era UPDATE no banco à mão; era ele ou perder o processo.

   Exige motivo pelo mesmo motivo da exclusão: a carga volta a contar nos
   relatórios e nas filas, e quem ler depois precisa saber por quê. */
rotasCargas.post('/cargas/:id/desfazer-exclusao', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
    if (!motivo) {
      return res.status(400).json({
        erro: 'Diga o motivo de devolver a carga — ela volta a contar nos relatórios e nas filas.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }
    const op = req.operador;

    const resultado = await emTransacao(async (cli) => {
      const { rows } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens WHERE carga_id = $1 FOR UPDATE`, [id]
      );
      const carga = rows[0];
      if (!carga) return { naoEncontrada: true };
      if (!carga.excluida_em) return { naoEstavaExcluida: true, linha: carga };

      const upd = await cli.query(
        `UPDATE fact_viagens
            SET excluida_em = NULL, atualizado_em = now(),
                operador_id = $1, operador_nome = $2, operador_setor = $3,
                versao = versao + 1
          WHERE carga_id = $4
          RETURNING ${COLUNAS_CARGA}`,
        [op.id, op.nome, op.setor, id]
      );

      await gravarEvento(cli, {
        cargaId: id,
        placa: carga.placa,
        de: carga.status_atual,
        para: carga.status_atual,
        operador: op,
        acao: `Exclusão desfeita — carga devolvida ao painel. Motivo: ${motivo}`,
      });

      return { linha: upd.rows[0] };
    });

    if (resultado.naoEncontrada) {
      return res.status(404).json({ erro: 'Carga não encontrada.', codigo: 'CARGA_NAO_ENCONTRADA' });
    }
    const payload = paraPainel(resultado.linha);
    if (!resultado.naoEstavaExcluida) emitir('carga:atualizada', payload);
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/* Voltar (ou corrigir) a ETAPA de uma carga — só a Administração.

   A máquina de estados é de sentido único de propósito: uma etapa que anda
   sozinha para trás é histórico que ninguém consegue explicar depois. Mas
   quem opera precisa de uma saída para o erro humano — o clique errado, a
   carga faturada por engano, o "Seguiu Viagem" numa carga que ainda está no
   pátio. Pedido de 19/08/2026: "quero conseguir voltar em qualquer etapa
   pelo painel de administrador".

   Por isso esta rota existe separada da rota de status normal, e não como
   um parâmetro dela: aqui a transição não é validada contra o fluxo, e é
   justamente por isso que ela exige Administração, exige motivo e grava
   trilha dizendo que foi correção, não operação. */
rotasCargas.post('/cargas/:id/corrigir-etapa', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const id = idSeguro(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Id inválido.', codigo: 'ID_INVALIDO' });

    const statusNovo = String(req.body?.status ?? '');
    if (!STATUS_FLOW.includes(statusNovo)) {
      return res.status(400).json({
        erro: `Etapa desconhecida: "${statusNovo}".`, codigo: 'STATUS_DESCONHECIDO',
      });
    }
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
    if (!motivo) {
      return res.status(400).json({
        erro: 'Diga o motivo da correção de etapa — ela reescreve o andamento da carga para todos os setores.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }
    const op = req.operador;

    const resultado = await emTransacao(async (cli) => {
      const { rows } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens
          WHERE carga_id = $1 AND excluida_em IS NULL FOR UPDATE`,
        [id]
      );
      const carga = rows[0];
      if (!carga) return { naoEncontrada: true };
      if (carga.status_atual === statusNovo) return { semMudanca: true, linha: carga };

      const upd = await cli.query(
        `UPDATE fact_viagens
            SET status_atual = $1, atualizado_em = now(),
                operador_id = $2, operador_nome = $3, operador_setor = $4,
                versao = versao + 1
          WHERE carga_id = $5
          RETURNING ${COLUNAS_CARGA}`,
        [statusNovo, op.id, op.nome, op.setor, id]
      );

      const voltou = STATUS_FLOW.indexOf(statusNovo) < STATUS_FLOW.indexOf(carga.status_atual);
      const movId = await gravarEvento(cli, {
        cargaId: id,
        placa: carga.placa,
        de: carga.status_atual,
        para: statusNovo,
        operador: op,
        acao: `Etapa ${voltou ? 'REVERTIDA' : 'corrigida'} pela Administração: `
          + `${carga.status_atual} → ${statusNovo}. Motivo: ${motivo}`,
      });

      return { linha: upd.rows[0], movId, de: carga.status_atual };
    });

    if (resultado.naoEncontrada) {
      return res.status(404).json({ erro: 'Carga não encontrada.', codigo: 'CARGA_NAO_ENCONTRADA' });
    }
    const payload = paraPainel(resultado.linha);
    if (!resultado.semMudanca) {
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
    }
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/* ---------------------------------------------------------------------
   POST /api/cargas/encerrar-anteriores — limpa a Torre para o dia novo
   ---------------------------------------------------------------------

   Pedido do gestor (20/08/2026): "as viagens que já seguiram viagem e que
   não têm nenhuma pendência aberta [precisam sair] da torre de controle de
   hoje, para que possamos montar uma nova programação e a torre fique
   limpa, mantendo apenas as cargas que estão iniciando as etapas".

   O QUE ACONTECE NA VIDA REAL: o caminhão da programação de ontem saiu do
   pátio, mas o processo dele não chegou ao fim no sistema — faltou o
   "Faturado", ou faltou o "Saiu" da Portaria. Como a Torre mostra tudo que
   não seguiu viagem, essas cargas ficam ali para sempre, misturadas com a
   programação de hoje, e o pátio de hoje deixa de ser legível.

   O QUE ESTA ROTA FAZ: fecha, de uma vez, as cargas de programações
   ANTERIORES que ficaram em aberto — levando cada uma a "Seguiu Viagem",
   que é o fim de linha honesto para um caminhão que já foi embora. Cada
   carga fechada gera evento na trilha com o motivo, então em nenhum momento
   a informação some: ela sai da Torre e continua inteira no Histórico e no
   relatório do dia dela.

   O QUE ELA NÃO FAZ, de propósito:
     · não toca em carga de HOJE — a programação corrente nunca é fechada
       por engano;
     · não toca em carga excluída nem em entrada sem carga lançada;
     · não inventa faturamento nem lacre: o que não foi registrado continua
       não registrado, e o log diz que o encerramento foi administrativo.

   Motivo é obrigatório pelo mesmo motivo das outras correções: fechar carga
   dos outros setores sem dizer por quê é o tipo de ação que ninguém
   consegue auditar depois. */
rotasCargas.post('/cargas/encerrar-anteriores', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const op = req.operador;
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500);
    if (!motivo) {
      return res.status(400).json({
        erro: 'Diga o motivo do encerramento — ele fecha cargas de outros setores de uma vez.',
        codigo: 'MOTIVO_OBRIGATORIO',
      });
    }
    /* `ids` restringe a operação a cargas escolhidas na tela. Sem ele, vale
       para todas as pendências anteriores — que é o botão "limpar a Torre".
       O filtro de data continua valendo nos dois casos: nem passando id de
       carga de hoje ela é fechada. */
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(idSeguro).filter(Boolean)
      : null;

    const FUSO = 'America/Sao_Paulo';
    const resultado = await emTransacao(async (cli) => {
      const { rows: pendentes } = await cli.query(
        `SELECT ${COLUNAS_CARGA} FROM fact_viagens
          WHERE excluida_em IS NULL
            AND aguardando_carga = FALSE
            AND status_atual <> 'Seguiu Viagem'
            AND (COALESCE(programado_em, criado_em) AT TIME ZONE $1)::date
                < (now() AT TIME ZONE $1)::date
            ${ids ? 'AND carga_id = ANY($2)' : ''}
          ORDER BY COALESCE(programado_em, criado_em)
          FOR UPDATE`,
        ids ? [FUSO, ids] : [FUSO]
      );

      const fechadas = [];
      for (const carga of pendentes) {
        const upd = await cli.query(
          `UPDATE fact_viagens
              SET status_atual = 'Seguiu Viagem',
                  operador_id = $1, operador_nome = $2, operador_setor = $3
            WHERE carga_id = $4
            RETURNING ${COLUNAS_CARGA}`,
          [op.id, op.nome, op.setor, carga.carga_id]
        );
        const movId = await gravarEvento(cli, {
          cargaId: carga.carga_id,
          placa: carga.placa,
          de: carga.status_atual,
          para: 'Seguiu Viagem',
          operador: op,
          acao: `Programação anterior encerrada (${carga.status_atual} → Seguiu Viagem). `
            + `Motivo: ${motivo}`,
        });
        fechadas.push({ linha: upd.rows[0], movId, de: carga.status_atual });
      }
      return fechadas;
    });

    const payloads = resultado.map((f) => {
      const payload = paraPainel(f.linha);
      emitir('carga:atualizada', payload);
      emitir('movimentacao:nova', {
        id: f.movId,
        cargaId: payload.id,
        placa: payload.placa,
        statusAnterior: f.de,
        statusNovo: payload.status,
        setor: op.setor,
        operador: op.nome,
        data: payload.atualizadoEm,
      });
      return payload;
    });

    return res.json({ encerradas: payloads, total: payloads.length });
  } catch (e) {
    return next(e);
  }
});

/* Lista as cargas EXCLUÍDAS — só a Administração.

   A leitura completa do painel filtra `excluida_em IS NULL` de propósito: o
   pátio é o que está em operação. Só que isso deixava a carga excluída sem
   nenhuma tela — inclusive para desfazer a exclusão, que virou botão em
   19/08/2026 e não tinha onde ser clicado. Esta rota existe para essa tela,
   e por isso é enxuta: as últimas exclusões, com o essencial para
   reconhecer a carga. */
rotasCargas.get('/cargas-excluidas', exigirLogin, exigirSetor(), async (req, res, next) => {
  try {
    const placa = String(req.query.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const params = [];
    let filtro = 'excluida_em IS NOT NULL';
    if (placa) { params.push(placa); filtro += ` AND placa = $${params.length}`; }

    const { rows } = await consultar(
      `SELECT ${COLUNAS_CARGA} FROM fact_viagens
        WHERE ${filtro} ORDER BY excluida_em DESC LIMIT 200`,
      params
    );
    return res.json(rows.map(paraPainel));
  } catch (e) {
    return next(e);
  }
});

/* O HISTÓRICO DA PROGRAMAÇÃO — "me mostra a programação do dia X como ela
   foi feita" (pedido do gestor, 21/08/2026).

   A diferença desta consulta para a leitura normal do painel é UMA e é o
   motivo de ela existir: as cargas CANCELADAS entram. A leitura do pátio
   filtra `excluida_em IS NULL` de propósito (o pátio é o que opera); aqui o
   assunto é controle — "o que foi programado" inclui o que foi programado e
   depois caiu, senão a aderência à programação sai inflada e ninguém audita
   um cancelamento.

   Fica de fora o que NUNCA foi programado: chegada sem programação
   (aguardando_carga) é outro fato, com outra tela.

   Visualização SÓ de Logística e Administração (pedido do gestor,
   21/08/2026): é ferramenta de CONTROLE de quem programa, não tela de
   operação — a Portaria e os demais setores nem veem o botão, e esta
   trava garante que tela escondida não vira porta destrancada. */
rotasCargas.get('/programacao-do-dia', exigirLogin, exigirSetor('Logística'), async (req, res, next) => {
  try {
    const dia = String(req.query.dia || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return res.status(400).json({
        erro: 'Informe o dia da programação como AAAA-MM-DD.',
        codigo: 'DIA_INVALIDO',
      });
    }
    const FUSO = 'America/Sao_Paulo';
    const { rows } = await consultar(
      `SELECT ${COLUNAS_CARGA} FROM fact_viagens
        WHERE aguardando_carga = FALSE
          AND (COALESCE(programado_em, criado_em) AT TIME ZONE $1)::date = $2::date
        ORDER BY sequencia NULLS LAST, criado_em`,
      [FUSO, dia]
    );
    // paraPainel esconde os detalhes da exclusão de propósito (a leitura
    // normal só precisa do booleano). Aqui quem cancelou e quando É o dado.
    return res.json(rows.map((linha) => ({
      ...paraPainel(linha),
      excluidaEm: linha.excluida_em || null,
      excluidaPor: linha.excluida_por || '',
    })));
  } catch (e) {
    return next(e);
  }
});

/* As quatro rotas /acoes-criticas (pedir, listar, aprovar, recusar) viviam
   aqui e saíram em 25/08/2026 junto com a exigência de segunda assinatura.
   Ver o comentário no topo deste arquivo. */
