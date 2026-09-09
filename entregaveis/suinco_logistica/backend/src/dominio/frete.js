/* =====================================================================
   O FRETE — a tabela é uma conta, e o servidor é quem a faz (09/09/2026)
   ---------------------------------------------------------------------
   Pedido do dono, com a tabela oficial em PDF:

     "a tabela de frete deve fazer o calculo segundo a kilometragem e
      destino" · "valor kilometragem é por modalidade de veiculo" ·
     "transportadora suinco ou FOB nao tem valor de frete"

   AS 115 CÉLULAS DO PDF SÃO `km × tarifa`. Conferidas uma a uma. Por isso
   o banco guarda 5 tarifas e 23 km, e o valor sai daqui — guardar o
   resultado de uma conta é guardar algo que envelhece.

   AQUI, E SÓ AQUI. O painel NÃO refaz esta conta: ele mostra o que o
   servidor devolveu. Duas contas de dinheiro escritas em dois lugares
   divergem no primeiro caso de borda, e a divergência aparece como um
   frete pago errado — não como uma tela feia. É a regra da casa ("uma
   função, dois chamadores") aplicada ao caso em que copiar custa caro.
   ===================================================================== */

/* Texto de transportadora como comparação: maiúscula, sem acento, sem
   pontuação, com os espaços colapsados. "S/A", "S.A." e "SA" viram a mesma
   coisa — e o dono digita dos três jeitos. */
function normalizar(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/* QUEM NÃO TEM FRETE DE TABELA — e o motivo, que vai junto.

   Decisão do dono, com as palavras dele: "FOB é RETIRADA NO FRIGORIFICO e
   SUINCO é entrega da frota propria". Nos dois casos não há transportadora
   contratada para pagar: num, o cliente vem buscar; no outro, o caminhão é
   nosso.

   COMPARA POR PALAVRA INTEIRA, não por "contém". `includes('SUINCO')`
   pegaria "TRANSUINCO LTDA", que é uma transportadora terceira como outra
   qualquer — e zerar o frete dela em silêncio é dinheiro que ninguém
   cobra. */
export function semFreteDeTabela(transportadora) {
  const palavras = normalizar(transportadora).split(' ').filter(Boolean);
  if (!palavras.length) return null;
  if (palavras.includes('SUINCO')) {
    return { motivo: 'SUINCO — entrega da frota própria, sem frete de tabela.' };
  }
  if (palavras.includes('FOB')) {
    return { motivo: 'FOB — retirada no frigorífico, sem frete de tabela.' };
  }
  return null;
}

/* KM que vale: inteiro positivo, ou null. NUNCA zero por engano.

   `Number('') === 0` e `Number(null) === 0`: sem esta função, um campo em
   branco viraria "zero quilômetros" e o frete sairia R$ 0,00 sem ninguém
   perceber. É o mesmo defeito que já apagou capacidade de veículo aqui
   (`Number(0) || null`), do outro lado da moeda. */
export function kmValido(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

/* O VALOR. `km × tarifa`, com duas casas, ou null com o motivo.

   Devolve SEMPRE o motivo quando não há valor. Célula vazia sem explicação
   é o que faz a Administração ligar perguntando — e "recusa do servidor
   nunca pode ser silenciosa" vale também para um número que não veio. */
export function calcularFrete({ transportadora, tipoVeiculo, kmDeslocamento, tarifas }) {
  const isento = semFreteDeTabela(transportadora);
  if (isento) return { valor: null, tarifa: null, motivo: isento.motivo };

  const km = kmValido(kmDeslocamento);
  if (km === null) {
    return { valor: null, tarifa: null, motivo: 'Sem KM de deslocamento — o valor não pode ser calculado.' };
  }

  const tipo = String(tipoVeiculo ?? '').trim();
  const tarifa = tarifas instanceof Map ? tarifas.get(tipo) : (tarifas || {})[tipo];
  const t = Number(tarifa);
  if (!Number.isFinite(t) || t <= 0) {
    /* Tipo fora da tabela NÃO recusa a carga. Um caminhão não pode ficar
       parado no portão porque a tabela de preço ainda não tem a
       modalidade dele — a coluna sai vazia com o aviso, e a Logística
       cadastra a tarifa depois. */
    return {
      valor: null, tarifa: null,
      motivo: `Tipo de veículo "${tipo || '—'}" não está na tabela de frete. Cadastre a tarifa em Cadastros → Tabela de Frete.`,
    };
  }
  return { valor: Number((km * t).toFixed(2)), tarifa: t, motivo: '' };
}

/* A TRAVA DA CONTRATAÇÃO.

   Pergunta feita ao dono e respondida por ele: "1 KM" e "1 trava a
   contratacao". A carga NASCE sem KM — a Logística sabe rota e peso antes
   de saber o caminhão. O que exige KM é o ato de pôr a placa: é aí que
   existe frete a pagar, e é a última hora em que alguém ainda lembra a
   distância.

   `observacoes` entra na mesma trava por decisão dele ("2 observacao
   obrigatoria"): é o campo onde a Administração registra o valor combinado
   quando ele foge da tabela, e o relatório de fretes existe para ser lido
   por ela.

   VALE PARA O ATO, NÃO PARA A CARGA. Carga já contratada continua
   editável sem repetir nada — reexigir a cada PATCH travaria a Portaria
   trocando o motorista de um caminhão que já rodou. */
export function faltaParaContratar({ kmDeslocamento, observacoes }) {
  const falta = [];
  if (kmValido(kmDeslocamento) === null) falta.push('KM de deslocamento');
  if (!String(observacoes ?? '').trim()) falta.push('Observação');
  return falta;
}

/* POR QUE ESTA CARGA NÃO TEM VALOR — respondido a partir da própria linha.

   O painel precisa desta resposta em toda leitura, não só logo depois de
   gravar: a Administração abre o relatório na segunda-feira e vê a célula
   vazia. "Vazio" sozinho é a mesma coisa que R$ 0,00 aos olhos de quem
   confere, e foi assim que o relatório de fretes passou meses saindo com
   "a preencher" sem ninguém saber de quem era a pendência.

   NÃO LÊ A TABELA DE TARIFAS de propósito. Ela seria uma consulta a mais
   por carga em toda sincronização, e a resposta já está na linha: quem é a
   transportadora, se há KM, e se o valor saiu. É a mesma ordem de perguntas
   de calcularFrete(), sem o preço. */
export function motivoSemValor({ transportadora, kmDeslocamento, tipoVeiculo, freteValor }) {
  if (freteValor !== null && freteValor !== undefined) return '';
  const isento = semFreteDeTabela(transportadora);
  if (isento) return isento.motivo;
  if (kmValido(kmDeslocamento) === null) {
    return 'Sem KM de deslocamento — o valor não pode ser calculado.';
  }
  return `Tipo de veículo "${String(tipoVeiculo || '').trim() || '—'}" não está na tabela de frete. `
    + 'Cadastre a tarifa em Cadastros → Tabela de Frete.';
}
