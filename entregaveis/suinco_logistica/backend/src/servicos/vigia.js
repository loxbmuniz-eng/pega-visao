/* OS VIGIAS — o que confere, onde anota, quando avisa
   ---------------------------------------------------------------------
   Pedido do dono (02/10/2026): "no raio-X, tudo que fala 'se quebrar', você
   vai criar uma prevenção de quebra pra cada possibilidade apontada".

   Este arquivo é o miolo que DOIS chamadores usam (regra da casa: uma
   função, dois chamadores):
     · scripts/vigia_servidor.mjs — roda no cron do servidor, confere,
       anota e avisa no celular da Administração;
     · rotas/vigia.js — a caixa "Vigias do sistema" na aba Usuários lê o
       que foi anotado e roda a conferência do dado na hora.

   QUANDO AVISA: na VIRADA. Ficou ruim → aviso. Voltou ao normal → aviso.
   Continuou ruim → silêncio (a caixa na tela continua mostrando, com o
   "desde quando"). Aviso repetido a cada minuto é o que ensina a ignorar
   todos — e aí o aviso que importa passa batido. */

/* ---------------------------------------------------------------------
   A CONFERÊNCIA DO DADO (P3 — frente F3, "o dano é silencioso")
   ---------------------------------------------------------------------
   Os 509 testes provam o CÓDIGO. Nenhum deles olha o dado que já está
   gravado. Aqui entram SÓ estados que o próprio servidor garante que não
   existem — então todo achado é inconsistência de verdade, nunca "um jeito
   diferente de trabalhar". Regra que acusa o que é legítimo vira barulho.

   Ficou DE FORA, de propósito: "status atual diferente do último registro
   do histórico". Parece uma ótima regra, e daria alarme falso: restaurar
   uma revisão da carga (rotas/cargas.js) devolve o status sem gravar
   movimentação. A mesma placa em duas cargas abertas também ficou de fora:
   é o caminhão que leva duas cargas, e isso é permitido ("1 de 2").

   Janela de 30 dias: é o que a operação enxerga e corrige. O que veio de
   antes da entrada em produção (07/08) não tem como ser consertado por
   ninguém hoje, e não pode ficar gritando para sempre.

   SÓ LEITURA. Nenhuma consulta aqui altera nada. */
const JANELA = "now() - interval '30 days'";

export const REGRAS_DO_DADO = [
  {
    codigo: 'saida_sem_registro',
    titulo: 'Carga que seguiu viagem sem o registro da saída',
    explicacao: 'O status diz "Seguiu Viagem", mas o histórico não tem a saída. '
      + 'O tempo de pátio e os indicadores dessa carga ficam sem a hora em que ela saiu.',
    sql: `
      SELECT v.numero_carga, v.placa, ''::text AS detalhe
        FROM fact_viagens v
       WHERE v.excluida_em IS NULL
         AND v.status_atual = 'Seguiu Viagem'
         AND v.criado_em > ${JANELA}
         AND NOT EXISTS (
               SELECT 1 FROM fact_statusfrota m
                WHERE m.carga_id = v.carga_id AND m.apagada_em IS NULL
                  AND m.status_novo = 'Seguiu Viagem')
       ORDER BY v.criado_em DESC`,
  },
  {
    codigo: 'saida_antes_da_chegada',
    titulo: 'Saída registrada antes da chegada',
    explicacao: 'O caminhão aparece saindo antes de ter entrado. Quase sempre é uma hora '
      + 'corrigida à mão no lugar errado — o tempo de pátio dessa carga sai negativo.',
    sql: `
      SELECT v.numero_carga, v.placa,
             'entrou ' || to_char(c.em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
             || ', saiu ' || to_char(s.em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS detalhe
        FROM fact_viagens v
        JOIN LATERAL (SELECT max(data_evento) AS em FROM fact_statusfrota
                       WHERE carga_id = v.carga_id AND apagada_em IS NULL
                         AND status_novo = 'Seguiu Viagem') s ON s.em IS NOT NULL
        JOIN LATERAL (SELECT max(data_evento) AS em FROM fact_statusfrota
                       WHERE carga_id = v.carga_id AND apagada_em IS NULL
                         AND status_novo = 'Aguardando Embarque') c ON c.em IS NOT NULL
       WHERE v.excluida_em IS NULL
         AND v.status_atual = 'Seguiu Viagem'
         AND v.criado_em > ${JANELA}
         AND s.em < c.em
       ORDER BY v.criado_em DESC`,
  },
  {
    codigo: 'evento_no_futuro',
    titulo: 'Movimentação com hora no futuro',
    explicacao: 'Um registro do histórico tem hora que ainda não chegou. Os indicadores '
      + 'contam esse caminhão num momento que não aconteceu.',
    sql: `
      SELECT v.numero_carga, m.placa,
             m.status_novo || ' em ' || to_char(m.data_evento AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS detalhe
        FROM fact_statusfrota m
        JOIN fact_viagens v ON v.carga_id = m.carga_id
       WHERE m.apagada_em IS NULL
         AND v.excluida_em IS NULL
         AND m.data_evento > now() + interval '10 minutes'
       ORDER BY m.data_evento DESC`,
  },
];

const EXEMPLOS = 5;

export async function auditarDado(runner) {
  const achados = [];
  for (const r of REGRAS_DO_DADO) {
    const { rows } = await runner.query(r.sql);
    achados.push({
      codigo: r.codigo,
      titulo: r.titulo,
      explicacao: r.explicacao,
      quantidade: rows.length,
      exemplos: rows.slice(0, EXEMPLOS).map((x) => ({
        carga: x.numero_carga, placa: x.placa, detalhe: x.detalhe || '',
      })),
    });
  }
  return achados;
}

export function resumoDoDado(achados) {
  const com = achados.filter((a) => a.quantidade > 0);
  if (!com.length) return 'nenhuma inconsistência nos últimos 30 dias';
  return com.map((a) => `${a.quantidade} × ${a.titulo.toLowerCase()}`).join('; ');
}

/* ---------------------------------------------------------------------
   ANOTAR — e dizer se houve VIRADA
   ---------------------------------------------------------------------
   Devolve 'piorou', 'melhorou' ou null (continua igual). O primeiro
   registro de uma verificação que já nasce ruim conta como 'piorou'; o que
   já nasce bem não avisa nada (não há o que comemorar). */
export async function anotar(runner, verificacao, ok, detalhe) {
  const { rows } = await runner.query(
    'SELECT ok FROM vigia_registros WHERE verificacao = $1', [verificacao]);
  const antes = rows[0] ? rows[0].ok : null;
  await runner.query(
    `INSERT INTO vigia_registros (verificacao, ok, detalhe, conferido_em, problema_desde)
          VALUES ($1, $2, $3, now(), CASE WHEN $2 THEN NULL ELSE now() END)
     ON CONFLICT (verificacao) DO UPDATE
        SET ok = EXCLUDED.ok,
            detalhe = EXCLUDED.detalhe,
            conferido_em = now(),
            problema_desde = CASE
              WHEN EXCLUDED.ok THEN NULL
              ELSE COALESCE(vigia_registros.problema_desde, now()) END`,
    [verificacao, ok, String(detalhe || '').slice(0, 500)]
  );
  if (!ok && antes !== false) return 'piorou';
  if (ok && antes === false) return 'melhorou';
  return null;
}

export async function lerAnotacoes(runner) {
  const { rows } = await runner.query(
    `SELECT verificacao, ok, detalhe, conferido_em, problema_desde
       FROM vigia_registros ORDER BY verificacao`);
  return rows;
}

/* Os nomes que aparecem na tela e no aviso — num lugar só. */
export const NOMES = {
  travamento: 'Servidor respondendo',
  backup_de_hoje: 'Backup de hoje feito',
  backup_restaura: 'Backup restaura de verdade',
  disco: 'Espaço em disco',
  certificado: 'Certificado de segurança',
  bibliotecas: 'Falhas conhecidas nas bibliotecas',
  dado: 'Conferência do dado',
};
