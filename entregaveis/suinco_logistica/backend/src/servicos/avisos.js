/* AVISO NO CELULAR — Web Push
   ---------------------------------------------------------------------
   Pedido do dono em 26/08/2026: "eu quero que todos que estiverem com o
   embarquesuinco ligado no celular com atalho direto nos icones do celular
   como se fosse um aplicativo recebam notificacoes push a cada vez que um
   caminhao entrar na portaria ou sair, a cada vez que a programacao for
   finalizada por inteiro".

   ISTO NÃO É O SOCKET, e a diferença é o ponto inteiro. O Socket.IO
   atualiza a TELA de quem está com o painel aberto. Aqui a mensagem chega
   com o aplicativo FECHADO e o celular no bolso: o navegador guardou uma
   inscrição (um endereço secreto na Google ou na Apple), e o servidor
   entrega ali.

   PRINCÍPIO HERDADO DO tempo-real.js, e vale igual aqui: aviso é
   acessório, nunca fonte da verdade. Nada nestas funções pode lançar
   exceção para quem chamou. O caminhão está no pátio e a gravação já foi
   confirmada no banco — se a notificação não sair, a gravação continua
   valendo. Por isso todo caminho de erro termina em console.warn, e as
   funções de envio não são esperadas (`await`) pelas rotas.

   DESLIGADO É UM ESTADO VÁLIDO. Sem as chaves VAPID no .env, `ligado()`
   devolve false e todas as funções viram no-op silencioso. Um pátio
   inteiro não pode parar porque uma notificação não foi configurada. */

import webpush from 'web-push';
import { consultar } from '../banco.js';
import { config } from '../config.js';

const { chavePublica, chavePrivada, contato } = config.avisos;

const LIGADO = Boolean(chavePublica && chavePrivada);
if (LIGADO) {
  webpush.setVapidDetails(contato, chavePublica, chavePrivada);
} else {
  console.warn('[avisos] VAPID não configurado — aviso no celular desligado.');
}

export function ligado() {
  return LIGADO;
}

export function chavePublicaDoPainel() {
  return chavePublica;
}

/* ---------------------------------------------------------------------
   Inscrições
   --------------------------------------------------------------------- */

/* Uma linha por APARELHO. A mesma pessoa no celular e no computador tem
   duas inscrições, e recebe nas duas. O ON CONFLICT existe porque o
   navegador devolve o MESMO endpoint quando a pessoa reativa o aviso no
   aparelho que já tinha — sem ele, reativar daria erro de chave repetida
   numa tela que não tem nada de errado.

   A troca de dono no conflito é de propósito: terminal compartilhado no
   pátio existe, e quando o segundo turno entra no mesmo aparelho, é ele
   quem passa a receber. `falhas` volta a zero porque uma inscrição
   reativada à mão é, por definição, uma inscrição viva. */
export async function inscrever(operadorId, inscricao, aparelho = '') {
  const endpoint = String(inscricao?.endpoint || '');
  const p256dh = String(inscricao?.keys?.p256dh || '');
  const auth = String(inscricao?.keys?.auth || '');
  if (!endpoint || !p256dh || !auth) {
    const e = new Error('Inscrição incompleta.');
    e.status = 400;
    e.codigo = 'INSCRICAO_INVALIDA';
    throw e;
  }
  await consultar(
    `INSERT INTO push_inscricoes (operador_id, endpoint, p256dh, auth, aparelho)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
        SET operador_id = EXCLUDED.operador_id,
            p256dh      = EXCLUDED.p256dh,
            auth        = EXCLUDED.auth,
            aparelho    = EXCLUDED.aparelho,
            falhas      = 0`,
    [operadorId, endpoint, p256dh, auth, String(aparelho).slice(0, 120)]
  );
}

export async function desinscrever(endpoint) {
  if (!endpoint) return 0;
  const r = await consultar('DELETE FROM push_inscricoes WHERE endpoint = $1', [endpoint]);
  return r.rowCount;
}

/* Quantos aparelhos deste operador estão inscritos. O painel usa para
   mostrar o estado certo do botão sem depender do que o navegador acha —
   o navegador só sabe do aparelho em que está. */
export async function inscricoesDoOperador(operadorId) {
  const { rows } = await consultar(
    `SELECT endpoint, aparelho, criado_em, usado_em
       FROM push_inscricoes WHERE operador_id = $1 ORDER BY criado_em`,
    [operadorId]
  );
  return rows;
}

/* ---------------------------------------------------------------------
   Envio
   --------------------------------------------------------------------- */

/* Duas falhas seguidas e a inscrição sai.

   Inscrição morre calada: o aparelho é trocado, o aplicativo é
   desinstalado, a permissão é revogada — e o servidor só descobre quando
   tenta enviar. 404 e 410 são a resposta oficial de "este endereço não
   existe mais" e valem exclusão na hora, sem segunda chance. Qualquer
   outro erro (rede, serviço fora do ar) pode ser passageiro, então conta
   uma falha; na segunda, sai. Sem isso a tabela vira um cemitério que o
   servidor tenta reanimar a cada caminhão, para sempre. */
async function entregar(linha, corpoJson) {
  try {
    await webpush.sendNotification(
      { endpoint: linha.endpoint, keys: { p256dh: linha.p256dh, auth: linha.auth } },
      corpoJson,
      { TTL: 3600, urgency: 'high' }
    );
    await consultar(
      'UPDATE push_inscricoes SET usado_em = now(), falhas = 0 WHERE endpoint = $1',
      [linha.endpoint]
    );
    return true;
  } catch (e) {
    const status = e?.statusCode || 0;
    if (status === 404 || status === 410) {
      await consultar('DELETE FROM push_inscricoes WHERE endpoint = $1', [linha.endpoint])
        .catch(() => {});
      return false;
    }
    await consultar(
      `UPDATE push_inscricoes SET falhas = falhas + 1 WHERE endpoint = $1`,
      [linha.endpoint]
    ).catch(() => {});
    await consultar('DELETE FROM push_inscricoes WHERE endpoint = $1 AND falhas >= 2', [
      linha.endpoint,
    ]).catch(() => {});
    console.warn(`[avisos] falha ao entregar (${status || e?.message}) — inscrição marcada.`);
    return false;
  }
}

/* Envia para todos os aparelhos das pessoas ATIVAS dos setores pedidos.

   `ativo` entra na consulta porque bloquear um operador precisa desligar
   tudo dele de uma vez. Não adianta tirar o acesso à tela e o celular
   continuar apitando o movimento do pátio. */
export async function enviarParaSetores(setores, mensagem) {
  if (!LIGADO) return { enviados: 0, alvos: 0 };
  const lista = (Array.isArray(setores) ? setores : [setores]).filter(Boolean);
  if (!lista.length) return { enviados: 0, alvos: 0 };

  try {
    const { rows } = await consultar(
      `SELECT i.endpoint, i.p256dh, i.auth
         FROM push_inscricoes i
         JOIN operadores o ON o.id = i.operador_id
        WHERE o.ativo = TRUE AND o.setor = ANY($1::text[])`,
      [lista]
    );
    if (!rows.length) return { enviados: 0, alvos: 0 };

    const corpo = JSON.stringify(mensagem);
    const resultados = await Promise.all(rows.map((l) => entregar(l, corpo)));
    return { enviados: resultados.filter(Boolean).length, alvos: rows.length };
  } catch (e) {
    console.warn(`[avisos] não consegui enviar para ${lista.join(', ')}: ${e.message}`);
    return { enviados: 0, alvos: 0 };
  }
}

/* Envia só para os aparelhos de UMA pessoa. É o que o botão "mandar um
   aviso de teste" usa — e ele não é enfeite: sem um teste que a própria
   pessoa dispara, ela só descobre que o aviso não funciona no dia em que
   precisava dele. */
export async function enviarParaOperador(operadorId, mensagem) {
  if (!LIGADO) return { enviados: 0, alvos: 0 };
  try {
    const { rows } = await consultar(
      'SELECT endpoint, p256dh, auth FROM push_inscricoes WHERE operador_id = $1',
      [operadorId]
    );
    if (!rows.length) return { enviados: 0, alvos: 0 };
    const corpo = JSON.stringify(mensagem);
    const resultados = await Promise.all(rows.map((l) => entregar(l, corpo)));
    return { enviados: resultados.filter(Boolean).length, alvos: rows.length };
  } catch (e) {
    console.warn(`[avisos] não consegui enviar para o operador ${operadorId}: ${e.message}`);
    return { enviados: 0, alvos: 0 };
  }
}

/* ---------------------------------------------------------------------
   A CONTA QUE DECIDE SE O DIA ACABOU
   ---------------------------------------------------------------------
   Fica aqui, e não solta dentro da rota de saída, por um motivo só: assim
   dá para provar. Recebe quem executa a consulta (o pool, ou um cliente
   dedicado), e o teste passa um cliente com uma tabela temporária de
   mesmo nome — em PostgreSQL a temporária tem precedência na sessão dela,
   então a prova roda sobre dados controlados sem chegar perto da tabela
   de verdade nem atrapalhar outro teste rodando junto.

   O QUE CONTA COMO "AINDA ABERTO": qualquer carga não excluída, de HOJE OU
   DE ANTES, que não seguiu viagem. O "ou de antes" não é detalhe — carga
   de ontem esquecida no pátio significa que o ciclo não fechou, e anunciar
   "acabou" com um caminhão pendurado é o tipo de informação errada que faz
   a operação parar de confiar no painel. Carga programada para AMANHÃ fica
   de fora, senão o aviso nunca sairia. */
export async function contarPatio(runner) {
  const FUSO = 'America/Sao_Paulo';
  const { rows } = await runner.query(
    `SELECT
       count(*) FILTER (WHERE status_atual <> 'Seguiu Viagem')::int AS abertas,
       count(*) FILTER (WHERE status_atual =  'Seguiu Viagem'
                          AND (COALESCE(programado_em, criado_em) AT TIME ZONE $1)::date
                              = (now() AT TIME ZONE $1)::date)::int AS concluidas_hoje
       FROM fact_viagens
      WHERE excluida_em IS NULL
        AND (COALESCE(programado_em, criado_em) AT TIME ZONE $1)::date
            <= (now() AT TIME ZONE $1)::date`,
    [FUSO]
  );
  return rows[0] || { abertas: 0, concluidas_hoje: 0 };
}

/* ---------------------------------------------------------------------
   Trava de aviso único
   ---------------------------------------------------------------------
   Devolve true UMA vez por chave. O aviso de "programação do dia
   terminou" dispara quando a contagem de cargas em aberto chega a zero, e
   essa contagem pode chegar a zero mais de uma vez no mesmo dia: sai o
   último, chega um caminhão de última hora, ele sai também. Sem trava,
   todo mundo recebe "acabou" duas vezes.

   Quem consegue INSERIR é quem envia. É atômico, então nem dois
   caminhões saindo no mesmo segundo geram aviso dobrado. */
export async function primeiraVezHoje(assunto) {
  try {
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const r = await consultar(
      'INSERT INTO avisos_enviados (chave) VALUES ($1) ON CONFLICT DO NOTHING',
      [`${assunto}:${hoje}`]
    );
    return r.rowCount === 1;
  } catch (e) {
    /* Na dúvida, NÃO envia. Um aviso a menos é um incômodo; o mesmo aviso
       repetido é o que ensina a operação a ignorar todos eles. */
    console.warn(`[avisos] trava de aviso único falhou (${e.message}) — não envio.`);
    return false;
  }
}

/* ---------------------------------------------------------------------
   OS TRÊS AVISOS DA OPERAÇÃO
   ---------------------------------------------------------------------
   O texto mora aqui, num lugar só. Espalhar frase de notificação pelas
   rotas é como estava o Excel: a mesma informação escrita de três jeitos
   e ninguém sabe qual é a certa.

   QUEM RECEBE O QUÊ — decidido pelo dono em 26/08/2026, com estas
   palavras: "eu quero que a logistica e administracao e expedicao recebam
   notificacoes em seus celulares caso estejam logados a cada vez que um
   caminhao der entrada na portaria, e o seguiu viagem pode aparecer so
   pra logistica e administracao".

   O recorte não é detalhe: no dia 25/08 foram 22 cargas. Mandar tudo para
   todos seriam 44 avisos por dia em cada celular, e em uma semana a
   operação silencia o aplicativo — aí o aviso que importa também não
   chega. Menos gente recebendo é o que mantém o aviso valendo alguma
   coisa. */

const QUEM_RECEBE_CHEGADA = ['Logística', 'Administração', 'Expedição'];
const QUEM_RECEBE_SAIDA = ['Logística', 'Administração'];

/* O fim do dia vai para todo mundo: é UM aviso por dia, e é a informação
   que o pátio inteiro espera. */
const QUEM_RECEBE_FIM = [
  'Logística', 'Administração', 'Expedição',
  'Faturamento', 'Portaria', 'Comercial',
  'Controles Internos', 'Central de Notas',
];

function descreverCarga(c) {
  const partes = [];
  if (c.numero_carga && c.numero_carga !== 'Aguardando Carga') partes.push(`carga ${c.numero_carga}`);
  if (c.destino) partes.push(c.destino);
  else if (c.rota_codigo) partes.push(`rota ${c.rota_codigo}`);
  if (c.transportadora) partes.push(c.transportadora);
  return partes.join(' · ');
}

export function avisarChegada(carga) {
  const detalhe = descreverCarga(carga);
  return enviarParaSetores(QUEM_RECEBE_CHEGADA, {
    titulo: `🚚 ${carga.placa} entrou`,
    corpo: detalhe || 'Chegada sem programação — carga a definir.',
    // Uma etiqueta por placa: se o mesmo caminhão entrar de novo, o aviso
    // novo substitui o antigo em vez de empilhar dois iguais na tela.
    tag: `chegada:${carga.placa}`,
    url: '/',
  });
}

export function avisarSaida(placa, cargas) {
  const primeira = cargas[0] || {};
  const quantas = cargas.length > 1 ? ` (${cargas.length} cargas)` : '';
  return enviarParaSetores(QUEM_RECEBE_SAIDA, {
    titulo: `✅ ${placa} seguiu viagem`,
    corpo: (descreverCarga(primeira) || 'Saída registrada na Portaria') + quantas,
    tag: `saida:${placa}`,
    url: '/',
  });
}

export function avisarFimDaProgramacao(totalDoDia) {
  return enviarParaSetores(QUEM_RECEBE_FIM, {
    titulo: '🏁 Programação do dia encerrada',
    corpo: totalDoDia
      ? `O último caminhão saiu. ${totalDoDia} carga(s) concluída(s) hoje.`
      : 'O último caminhão saiu do pátio.',
    tag: 'fim-do-dia',
    url: '/',
  });
}
