/* TRANSPORTADORA CONHECIDA (09/10/2026, #129).

   O Pagamento de Frete só aceita transportadora CADASTRADA (decisão do dono,
   05/10/2026). Cadastrada é: a de alguma placa da Frota (dim_veiculos) OU a
   da lista de transportadoras sem placa (migração 066) — "nem toda
   transportadora tem placa vinculada". Uma função, dois chamadores (a carga
   e a nota, rotas/pagamento_frete.js), para a regra não divergir de novo.

   A comparação é LETRA POR LETRA, como sempre foi: o nome gravado na carga é
   o nome do cadastro. O que evita "AG Sestini Transporte" ao lado de "AG
   Sestini Transportes" é a recusa de nome PARECIDO na hora de cadastrar
   (nomeParecido), não uma comparação frouxa na hora de usar. */

/* Sem acento, sem pontuação, sem diferença de maiúscula e com o plural
   simples desfeito: "Transportes e Logística Ltda." e "transporte e logistica
   ltda" viram a mesma chave. */
export function chaveDoNome(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((p) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p))
    .join(' ');
}

export function nomeLimpo(nome) {
  return String(nome ?? '').replace(/\s+/g, ' ').trim();
}

/* A tabela pode não existir (servidor com o código novo antes da 066): aí
   vale só a Frota, como antes — nunca um 500 no meio do pagamento. PERGUNTA
   se existe em vez de tentar e pegar o erro: dentro de uma transação, o erro
   de tabela inexistente estraga a transação inteira, e a gravação seguinte
   (o UPDATE da carga) cairia em 500 — o bloco 60 do api.test.js pegou isso. */
export async function existeCadastroSemPlaca(cx) {
  const { rows } = await cx.query("SELECT to_regclass('public.transportadoras') IS NOT NULL AS existe");
  return !!(rows[0] && rows[0].existe);
}
async function listaSemPlaca(cx) {
  if (!(await existeCadastroSemPlaca(cx))) return [];
  const { rows } = await cx.query('SELECT nome FROM transportadoras WHERE excluida_em IS NULL');
  return rows.map((r) => r.nome);
}

export async function transportadoraConhecida(cx, nome) {
  const { rows } = await cx.query('SELECT 1 FROM dim_veiculos WHERE transportadora = $1 LIMIT 1', [nome]);
  if (rows[0]) return true;
  return (await listaSemPlaca(cx)).includes(nome);
}

/* Todas as cadastradas — Frota e sem placa — com a origem de cada uma. */
export async function todasAsTransportadoras(cx) {
  const { rows } = await cx.query(
    `SELECT transportadora AS nome, count(*)::int AS placas FROM dim_veiculos
      WHERE coalesce(btrim(transportadora), '') <> '' GROUP BY transportadora`);
  const semPlaca = await listaSemPlaca(cx);
  return { frota: rows, semPlaca };
}

/* Já existe um nome cadastrado que é o MESMO escrito de outro jeito? Devolve
   o nome existente (para a tela dizer "já existe como …") ou null. */
export async function nomeParecido(cx, nome) {
  const { frota, semPlaca } = await todasAsTransportadoras(cx);
  const chave = chaveDoNome(nome);
  if (!chave) return null;
  const achado = [...frota.map((f) => f.nome), ...semPlaca].find((n) => chaveDoNome(n) === chave);
  return achado ?? null;
}
