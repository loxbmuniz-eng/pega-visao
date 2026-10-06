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

/* KM que vale: positivo, com até duas casas, ou null. NUNCA zero por engano.

   `Number('') === 0` e `Number(null) === 0`: sem esta função, um campo em
   branco viraria "zero quilômetros" e o frete sairia R$ 0,00 sem ninguém
   perceber. É o mesmo defeito que já apagou capacidade de veículo aqui
   (`Number(0) || null`), do outro lado da moeda.

   COM CASAS DECIMAIS DESDE 28/09/2026 (migração 056). Pedido do dono: o KM
   "precisa poder ter quebra com vírgulas" — pagou R$ 36 mil a R$ 11,66/km,
   e o número que vale é o exato. Até ali esta função cortava tudo depois
   do ponto (`Math.trunc`) e recusava a vírgula (`Number('3087,48')` é NaN).

   COMO SE LÊ O QUE FOI DIGITADO — a mesma régua de `kmValidoLocal` no
   painel (data.js), travada pela mesma tabela nos dois testes:
     "3087,48"   → 3087.48   vírgula é sempre o decimal
     "3.087,48"  → 3087.48   com vírgula, o ponto é milhar
     "3087.48"   → 3087.48   ponto com 1 ou 2 dígitos depois é decimal
     "1.250"     → 1250      ponto com exatamente 3 dígitos é milhar — é
                             como quem já digita KM aqui escreve mil
                             duzentos e cinquenta, e mudar isso calado
                             multiplicaria o frete dele por mil
   Mais de duas casas arredonda no centésimo: é o que o banco guarda. */
export function kmValido(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : lerKmDigitado(v);
  if (!Number.isFinite(n)) return null;
  const km = Math.round(n * 100) / 100;
  return km > 0 ? km : null;
}

function lerKmDigitado(v) {
  let t = String(v).trim().replace(/\s+/g, '').replace(/km$/i, '');
  if (!/^\d[\d.,]*$/.test(t)) return NaN;
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');
  }
  return Number(t);
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
    return { valor: null, tarifa: null, motivo: 'Sem KM — o valor não pode ser calculado.' };
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

/* NÃO EXISTE AQUI UMA VALIDAÇÃO DE "CAMPO OBRIGATÓRIO", E É DE PROPÓSITO.

   Existiu: `faltaParaContratar()` recusava contratar uma placa sem KM e sem
   observação. Saiu em 09/09/2026, por decisão do dono — "não põe a trava do
   quilômetro então" — depois de a bateria mostrar que a Montagem do Dia cria
   carga EM LOTE por outro caminho, sem campo de KM, e que carga recusada na
   criação é apagada do painel. As 39 cargas do dia sumiriam na frente da
   Logística.

   A função foi REMOVIDA, e não deixada sem uso: uma função exportada chamada
   "o que falta para contratar" é um convite a religá-la, e quem religasse
   estaria desfazendo uma decisão sem saber que era uma.

   O KM continua sendo pedido na tela e preenchido sozinho pelo destino. A
   cobrança mora onde o dado é usado: `motivoSemValor()` abaixo faz o
   relatório de fretes dizer "Sem KM de deslocamento" em vez de mostrar uma
   célula muda. Ausência declarada em voz alta vale mais que um portão que
   para caminhão. */



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
    return 'Sem KM — o valor não pode ser calculado.';
  }
  return `Tipo de veículo "${String(tipoVeiculo || '').trim() || '—'}" não está na tabela de frete. `
    + 'Cadastre a tarifa em Cadastros → Tabela de Frete.';
}

/* =====================================================================
   A OBSERVAÇÃO DO FRETE — obrigatória para contratar (06/10/2026)
   ---------------------------------------------------------------------
   Decisão do dono: "o valor do frete não pode ser alterável, somente o KM
   pode ser editável e ele faz a conta sozinho (...) o que seguir o valor da
   tabela vai ser colocado na observação como tabela, e o que não seguir a
   tabela vai ser colocado o valor combinado" — e "só consegue contratar
   carga com frete combinado (...) sempre, sem exceções".

   CONTRATAR É PÔR A PLACA. Carga sem placa ainda não foi contratada e passa
   sem observação. A placa entra por quatro portas (Programação, Montagem,
   Torre/Fila, completar a chegada da Portaria) e as quatro chegam a uma das
   duas rotas de carga — que perguntam AQUI, numa função só.

   A ÚNICA PASSAGEM SEM OBSERVAÇÃO é a transportadora sem frete de tabela
   (SUINCO, frota própria; FOB, o cliente retira): não há frete a pagar, e
   travar a frota própria pararia o caminhão da casa por um valor que não
   existe. É a mesma pergunta que calcularFrete() já faz — semFreteDeTabela.

   O PAINEL TEM A MESMA REGRA (data.js, freteFaltandoParaContratar) para
   perguntar ANTES de criar: carga recusada na criação é apagada do painel,
   e foi exatamente isso que derrubou a trava do KM em 09/09 (39 cargas do
   lote sumindo). As duas cópias são travadas pelos mesmos casos nos testes
   de API e de tela. */
export const FRETE_OBSERVACOES = ['TABELA', 'COMBINADO'];

/* "R$ 14.000,00", "14000", "14.000" → 14000. Vazio, zero ou negativo → null:
   frete combinado de R$ 0 não é combinado, é campo esquecido. Morava em
   rotas/modelo_semana.js; mudou para cá porque a carga passou a ler o mesmo
   valor — uma régua só para a Montagem e para a carga. */
export function valorEmReaisOuNulo(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  let t = String(v).trim().replace(/[^\d.,-]/g, '');
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(/,/g, '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function observacaoDoFrete(v) {
  const t = String(v ?? '').trim().toUpperCase();
  return FRETE_OBSERVACOES.includes(t) ? t : null;
}

export function conferirFreteParaContratar({ placa, transportadora, freteObservacao, freteCombinado }) {
  if (!String(placa ?? '').trim()) return null;               // sem placa: ainda não contratou
  if (semFreteDeTabela(transportadora)) return null;          // frota própria / FOB: não há frete
  const obs = observacaoDoFrete(freteObservacao);
  if (!obs) {
    return {
      codigo: 'FRETE_OBRIGATORIO',
      erro: 'Para contratar a carga, informe a observação do frete: TABELA (vale o valor calculado '
        + 'pelo KM) ou COMBINADO, com o valor negociado.',
    };
  }
  if (obs === 'COMBINADO' && valorEmReaisOuNulo(freteCombinado) === null) {
    return {
      codigo: 'FRETE_COMBINADO_SEM_VALOR',
      erro: 'Frete COMBINADO precisa do valor negociado (ex.: 14.000,00).',
    };
  }
  return null;
}
