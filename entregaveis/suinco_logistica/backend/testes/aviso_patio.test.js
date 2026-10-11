/* CARGA PASSANDO DE 3 HORAS NO PÁTIO: o vigia avisa no celular (11/10/2026).
   ---------------------------------------------------------------------
   Pedido do dono: "marcha em tudo que for melhorar", sobre a proposta de
   avisar quando uma carga passa de 3 h no pátio, pelo vigia que já existe,
   sem instalar nada. Até hoje o "acima de 3 h" era só a cor na Visão do
   Pátio: ninguém era avisado, e quem não estava olhando a tela não sabia.

   A RÉGUA É A DO PAINEL. "Há quanto tempo está no pátio" já tem uma
   definição só no painel (data.js: entradaNoPatioDe, dataDeEventoPlausivel,
   minutosNoPatioAgora, cargaInativa, paradasAlemDaMeta). O servidor não pode
   chamar aquele código — então cada regra de lá vira um caso aqui, e o
   número da meta é conferido contra o do painel. Se um dos dois mudar
   sozinho, este teste reprova.

   ISOLAMENTO: a consulta roda no Postgres de verdade, mas sobre tabelas
   TEMPORÁRIAS com a mesma forma das reais (o mesmo truque do avisos.test.js).
   Nada toca fact_viagens, que o api.test.js usa em paralelo. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/banco.js';
import * as vigia from '../src/servicos/vigia.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATA_JS = path.join(AQUI, '..', '..', 'data.js');

const MIN = 60 * 1000;
const atras = (min) => new Date(Date.now() - min * MIN);

describe('Aviso de pátio — a régua do servidor é a do painel', () => {
  let cli;

  before(async () => {
    cli = await pool.connect();
    await cli.query('CREATE TEMP TABLE fact_viagens (LIKE public.fact_viagens INCLUDING DEFAULTS)');
    await cli.query('CREATE TEMP TABLE fact_statusfrota (LIKE public.fact_statusfrota INCLUDING DEFAULTS)');
  });

  after(async () => {
    await cli.query('DROP TABLE IF EXISTS fact_statusfrota');
    await cli.query('DROP TABLE IF EXISTS fact_viagens');
    cli.release();
    await pool.end();
  });

  let n = 0;
  /* Uma carga e a trilha dela. `eventos`: [status, minutos atrás, apagada?]. */
  async function carga({ status = 'Embarque Iniciado', criadaHa = 200, programadaHa = null,
    aguardandoCarga = false, excluida = false, eventos = [] }) {
    const id = `pt${++n}`;
    await cli.query(
      `INSERT INTO fact_viagens (carga_id, numero_carga, placa, status_atual, aguardando_carga,
                                 criado_em, programado_em, excluida_em)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, String(900000 + n), `TST${String(n).padStart(4, '0')}`, status, aguardandoCarga,
        atras(criadaHa), programadaHa === null ? null : atras(programadaHa), excluida ? new Date() : null]);
    for (const [st, ha, apagada] of eventos) {
      await cli.query(
        `INSERT INTO fact_statusfrota (movimentacao_id, carga_id, placa, status_novo, data_evento, apagada_em)
              VALUES ($1, $2, '', $3, $4, $5)`,
        [`${id}-${st}-${ha}`, id, st, ha === 'futuro' ? new Date(Date.now() + 60 * MIN) : atras(ha),
          apagada ? new Date() : null]);
    }
    return id;
  }

  const acima = async () => (await vigia.cargasAcimaDaMetaNoPatio(cli)).map((c) => c.carga_id);

  test('a meta do servidor é a mesma do painel (META_TEMPO_PATIO_MIN, data.js)', () => {
    const m = readFileSync(DATA_JS, 'utf8').match(/const META_TEMPO_PATIO_MIN\s*=\s*(\d+)/);
    assert.ok(m, 'não achei META_TEMPO_PATIO_MIN no data.js');
    assert.equal(vigia.META_PATIO_MIN, Number(m[1]));
    assert.equal(vigia.META_PATIO_MIN, 180);
  });

  test('chegou há 3h10 e está embarcando: entra; há 2h50: não entra', async () => {
    const passou = await carga({ eventos: [['Aguardando Embarque', 190], ['Embarque Iniciado', 60]] });
    const dentro = await carga({ eventos: [['Aguardando Embarque', 170]] });
    const ids = await acima();
    assert.ok(ids.includes(passou), 'a carga de 3h10 não entrou');
    assert.ok(!ids.includes(dentro), 'a carga de 2h50 entrou');
    const linha = (await vigia.cargasAcimaDaMetaNoPatio(cli)).find((c) => c.carga_id === passou);
    assert.equal(linha.minutos, 190, 'os minutos não batem com a chegada');
    assert.equal(linha.status_atual, 'Embarque Iniciado');
  });

  test('conta pela PRIMEIRA chegada, como primeiroTimestamp do painel', async () => {
    const id = await carga({ eventos: [['Aguardando Embarque', 200], ['Aguardando Embarque', 30]] });
    assert.ok((await acima()).includes(id));
  });

  test('chegada apagada da trilha não conta', async () => {
    const id = await carga({ eventos: [['Aguardando Embarque', 200, true]] });
    assert.ok(!(await acima()).includes(id));
  });

  test('chegada no futuro (carimbo implausível) não conta', async () => {
    const id = await carga({ criadaHa: 400, eventos: [['Aguardando Embarque', 'futuro']] });
    assert.ok(!(await acima()).includes(id));
  });

  test('sem chegada (Aguardando Veículo) não conta — o caminhão não chegou', async () => {
    const id = await carga({ status: 'Aguardando Veículo', criadaHa: 400 });
    assert.ok(!(await acima()).includes(id));
  });

  test('chegada sem programação (Portaria): a entrada é quando a linha nasceu', async () => {
    const id = await carga({ status: 'Aguardando Embarque', aguardandoCarga: true, criadaHa: 200 });
    assert.ok((await acima()).includes(id));
  });

  test('carga que já saiu, ou excluída, não conta', async () => {
    const saiu = await carga({ status: 'Seguiu Viagem', eventos: [['Aguardando Embarque', 300], ['Seguiu Viagem', 10]] });
    const exc = await carga({ excluida: true, eventos: [['Aguardando Embarque', 300]] });
    const ids = await acima();
    assert.ok(!ids.includes(saiu));
    assert.ok(!ids.includes(exc));
  });

  test('carga inativa (decisão 29: 3 dias sem se mexer) não conta', async () => {
    const id = await carga({ criadaHa: 5 * 1440, eventos: [['Aguardando Embarque', 4 * 1440]] });
    assert.ok(!(await acima()).includes(id));
  });

  test('programada para hoje, chegada há 4 dias mas movimentada há 2 dias: ainda é ativa', async () => {
    const id = await carga({ criadaHa: 5 * 1440, eventos: [['Aguardando Embarque', 4 * 1440], ['Embarque Iniciado', 2 * 1440]] });
    assert.ok((await acima()).includes(id));
  });
});

describe('Aviso de pátio — quem toca o celular, e quantas vezes', () => {
  const c = (id, minutos = 190, extra = {}) => ({
    carga_id: id, numero_carga: `9${id}`, placa: `TST${id}`, status_atual: 'Embarque Iniciado',
    entrada: new Date(Date.now() - minutos * MIN), minutos, ...extra,
  });

  test('a carga que cruzou agora é avisada; a já avisada não toca de novo', () => {
    let r = vigia.decidirAvisoDoPatio([c('1')], []);
    assert.deepEqual(r.novas.map((x) => x.carga_id), ['1']);
    r = vigia.decidirAvisoDoPatio([c('1'), c('2')], r.avisadas);
    assert.deepEqual(r.novas.map((x) => x.carga_id), ['2'], 'avisou de novo a carga 1');
    assert.deepEqual(r.avisadas.sort(), ['1', '2']);
  });

  test('a carga que saiu da lista sai da memória (e, se voltar, avisa de novo)', () => {
    let r = vigia.decidirAvisoDoPatio([c('2')], ['1', '2']);
    assert.deepEqual(r.avisadas, ['2']);
    assert.equal(r.novas.length, 0);
    r = vigia.decidirAvisoDoPatio([], r.avisadas);
    assert.deepEqual(r.avisadas, []);
  });

  test('uma carga: o aviso diz qual, quanto tempo, a etapa e a hora da chegada', () => {
    const m = vigia.mensagemDoPatio([c('7', 185)], 180);
    assert.match(m.titulo, /97/);
    assert.match(m.titulo, /TST7/);
    assert.match(m.titulo, /3h05min/);
    assert.match(m.corpo, /Embarque Iniciado/);
    assert.match(m.corpo, /entrou às \d\d:\d\d/);
    assert.match(m.corpo, /3h00min/);
    assert.equal(m.tag, 'patio:7', 'o aviso de uma carga precisa de etiqueta própria — senão um substitui o outro no celular');
  });

  test('várias de uma vez (ex.: a primeira conferência do dia): UM aviso, não dez', () => {
    const lista = ['1', '2', '3', '4', '5', '6', '7'].map((id) => c(id));
    const m = vigia.mensagemDoPatio(lista, 180);
    assert.match(m.titulo, /7 cargas/);
    assert.match(m.corpo, /e mais 2/);
  });

  test('ninguém novo: nenhum aviso', () => {
    assert.equal(vigia.mensagemDoPatio([], 180), null);
  });

  test('vai para o celular da Administração, como os outros vigias', () => {
    assert.deepEqual(vigia.SETORES_DO_AVISO_DE_PATIO, ['Administração']);
  });
});
