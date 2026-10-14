#!/usr/bin/env python3
"""Toda carga é um link (14/10/2026) — Lote 1, aprovado pelo dono com "1 A".

O PEDIDO: "to no pátio ao vivo e sou da administração, clico na carga,
aparece as infos do lado, tem que ter um botão que eu clique e vá direto
pra onde pode alterar status da carga, tipo pro histórico daquela carga".
A resposta 1-A: o "Corrigir etapa" LEVA às Correções da Administração no
Histórico, já com a etapa aberta.

O QUE ESTE TESTE TRAVA, pela tela (cliques, não chamadas de função):
  1. Pátio ao vivo: o painel do lado da carga tem a barra; "Corrigir etapa"
     abre o Histórico na carga com o seletor de etapa em foco; "Ver na
     Torre" mostra a linha da carga na Torre, destacada;
  2. Indicadores: na lista do Pulso, a carga leva à linha do tempo;
  3. Torre: a linha da carga leva à linha do tempo, sem a coluna de ações
     crescer; o Pátio ao vivo leva ao Frete com a busca já no número;
  4. Visão do Pátio: o número da carga leva à linha do tempo;
  5. Pontos de atenção: a carga de exemplo leva à linha do tempo;
  6. Pagamento de Frete: a carga leva à linha do tempo dela no pátio;
  7. o botão só aparece onde a pessoa pode ir: a Logística não vê
     "Corrigir etapa"; a Portaria (sem Torre e sem Frete) só vê a linha do
     tempo.

REPROVA contra o publicado (nenhum desses botões existe):
    SUINCO_PAINEL=file://<index.html publicado> bash testes/rodar_tudo.sh toda_carga_e_um_link

    bash testes/rodar_tudo.sh toda_carga_e_um_link
"""
import asyncio
import json
import os
import pathlib
import sys
from playwright.async_api import async_playwright

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PAINEL = os.environ.get('SUINCO_PAINEL', (RAIZ / 'index.html').as_uri())
FRETE_DEMO = json.load(open(RAIZ / 'vitrine' / 'frete_demonstracao.json', encoding='utf-8'))
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg, setor):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(900)


# O pátio do teste, pelas formas do próprio painel. A carga LK-1 tem o mesmo
# número de uma carga do Pagamento de Frete de demonstração, para o caminho
# Frete → pátio ter onde chegar.
SEMEAR = """(numeroDoFrete) => {
  const agora = Date.now(), iso = (t) => new Date(t).toISOString();
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  function mk(id, numero, placa, status, seq, rota, transp){
    const t0 = agora - 2 * 3600000;
    DB.frota.push({placa, transportadora: transp, tipoVeiculo:'Truck', uf:'MG', capacidadeKg:14000, atualizadoEm: iso(agora)});
    DB.cargas.push({ id, numeroCarga: numero, placa, transportadora: transp, tipoVeiculo:'Truck',
      motorista:'M', cliente:'C', destino:'D', peso:10000, doca:'1', sequencia: seq, observacoes:'',
      praOnde:'ENTREGA DIRETA', rota, paletizada:'Não', qtdGanchos: 0, qtdEntregas: 1, status,
      aguardandoCarga:false, criadoEm: iso(t0), programadoEm: iso(t0), atualizadoEm: iso(t0), criadoPor:'Logística' });
    const ate = st.indexOf(status);
    for(let j = 0; j <= ate; j++){
      DB.movimentacoes.push({ id: 'mov_' + id + '_' + j, cargaId: id, placa,
        statusAnterior: j ? st[j-1] : null, statusNovo: st[j], operador:'Op', setor:'Portaria',
        timestamp: iso(t0 + j * 20 * 60000), numeroCarga: numero });
    }
  }
  mk('lk1', String(numeroDoFrete), 'LKA1B11', 'Embarque Iniciado', 1, '500', 'ALFA');
  mk('lk2', 'LK-2', 'LKB2C22', 'Aguardando Embarque', 2, '500', 'ALFA');
  mk('lk3', 'LK-3', 'LKC3D33', 'Aguardando Veículo', 3, '501', 'BETA');
  SuincoStore.save();
  renderAll();
}"""

LINHA_DO_TEMPO_DE = """(id) => {
  const ativa = document.querySelector('.tab-page.active');
  return { aba: ativa ? ativa.id : '', carga: typeof _timelineCargaAtual !== 'undefined' ? _timelineCargaAtual : null };
}"""


async def clicar(pg, seletor, nome):
    """Clica se o botão existe; se não existe, é a falha — e o teste segue,
    para dizer de uma vez tudo o que falta (e não parar no primeiro)."""
    alvo = pg.locator(seletor).first if isinstance(seletor, str) else seletor
    if await alvo.count() == 0:
        ck(nome, False, 'botão não existe')
        return False
    await alvo.click()
    return True


async def no_historico_da(pg, id_carga):
    r = await pg.evaluate(LINHA_DO_TEMPO_DE, id_carga)
    return r['aba'] == 'tab-historico' and r['carga'] == id_carga, r


async def main():
    numero_frete = FRETE_DEMO['linhas'][0]['carga']
    async with async_playwright() as p:
        nav = await p.chromium.launch(
            executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium'), headless=True)
        erros = []

        async def abrir(setor):
            pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: erros.append(str(e)))
            await pg.add_init_script("window.FRETE_DEMONSTRACAO = %s;" % json.dumps(FRETE_DEMO))
            await entrar(pg, setor)
            await pg.evaluate(SEMEAR, numero_frete)
            return pg

        # ==============================================================
        print('\n=== 1. PÁTIO AO VIVO → O PAINEL DO LADO TEM PARA ONDE IR ===')
        pg = await abrir('Administração')
        await pg.click('.nav-tab[data-tab="patio"]')
        await pg.wait_for_timeout(900)
        await pg.click('.pv-card[data-id="lk1"]')
        await pg.wait_for_timeout(600)
        barra = pg.locator('.gv .acoes-carga, #gv-miolo .acoes-carga').first
        ck('o painel do lado da carga tem a barra de ações', await barra.count() > 0 and await barra.is_visible())
        rotulos = await pg.eval_on_selector_all('#gv-miolo .acao-carga', 'els => els.map(e => e.dataset.destino)')
        ck('com Linha do tempo, Corrigir etapa, Ver na Torre e Frete', rotulos == ['linha', 'corrigir', 'torre', 'frete'], str(rotulos))

        await clicar(pg, '#gv-miolo .acao-carga[data-destino="corrigir"]', 'o botão Corrigir etapa existe')
        await pg.wait_for_timeout(700)
        ok, r = await no_historico_da(pg, 'lk1')
        ck('"Corrigir etapa" abre o Histórico na linha do tempo da carga', ok, str(r))
        foco = await pg.evaluate("() => document.activeElement && document.activeElement.id")
        ck('com o seletor de etapa das Correções em foco', foco == 'adm-etapa-lk1', str(foco))
        visivel = await pg.is_visible('#adm-etapa-lk1')
        ck('e o seletor está à vista', visivel)

        await pg.click('.nav-tab[data-tab="patio"]')
        await pg.wait_for_timeout(700)
        await pg.click('.pv-card[data-id="lk1"]')
        await pg.wait_for_timeout(600)
        await clicar(pg, '#gv-miolo .acao-carga[data-destino="torre"]', 'o botão Ver na Torre existe')
        await pg.wait_for_timeout(500)
        aba = await pg.evaluate("() => document.querySelector('.tab-page.active').id")
        apontada = await pg.evaluate("() => !!document.querySelector('#torre-tbody tr[data-carga=\"lk1\"].linha-apontada')")
        ck('"Ver na Torre" abre a Torre com a linha da carga destacada', aba == 'tab-torre' and apontada, f'{aba} {apontada}')
        gaveta = await pg.evaluate("() => Graf.gavetaAberta()")
        ck('e o painel do lado se fecha ao sair', not gaveta)

        # ==============================================================
        print('\n=== 2. INDICADORES → A LISTA DO PULSO LEVA À CARGA ===')
        await pg.click('.nav-tab[data-tab="indicadores"]')
        await pg.wait_for_timeout(900)
        # A transportadora ALFA tem as duas cargas que estão no pátio.
        await pg.locator('#pulso-rank-transp .graf-rank-tocavel', has_text='ALFA').first.click()
        await pg.wait_for_timeout(500)
        botoes = await pg.locator('#gv-miolo .acao-carga[data-destino="linha"]').count()
        ck('cada carga da lista do Pulso tem a Linha do tempo', botoes == 2, f'{botoes} botões para 2 cargas da ALFA')
        await clicar(pg, '#gv-miolo .acao-carga[data-destino="linha"]', 'o botão Linha do tempo do Pulso existe')
        await pg.wait_for_timeout(600)
        r = await pg.evaluate(LINHA_DO_TEMPO_DE, '')
        ck('e leva à linha do tempo daquela carga', r['aba'] == 'tab-historico' and r['carga'] in ('lk1', 'lk2'), str(r))

        # ==============================================================
        print('\n=== 3. TORRE → A LINHA DA CARGA LEVA À LINHA DO TEMPO; O PÁTIO AO VIVO LEVA AO FRETE ===')
        await pg.click('.nav-tab[data-tab="torre"]')
        await pg.wait_for_timeout(700)
        linha = pg.locator('#torre-tbody tr[data-carga="lk2"]')
        dest = await linha.locator('.acao-carga').evaluate_all('els => els.map(e => e.dataset.destino)')
        # Na Torre a data da última etapa É o link da linha do tempo: a coluna
        # de ações não ganha nada (um ícone a mais fazia a linha da Logística
        # crescer — portão 87). Da linha do tempo, as Correções estão logo abaixo.
        ck('a linha da Torre leva à Linha do tempo pela data da última etapa', dest == ['linha'], str(dest))
        na_data = await linha.locator('td.cel-datas .acao-carga[data-destino="linha"]').count()
        ck('e o link é a própria data (nenhum botão novo na coluna de ações)', na_data == 1, f'{na_data}')
        altura = await linha.evaluate('tr => Math.round(tr.getBoundingClientRect().height)')
        ck('e a linha da Torre não ficou mais alta por isso (até 110 px)', altura <= 110, f'{altura} px')
        await clicar(pg, linha.locator('.acao-carga[data-destino="linha"]'), 'o botão Linha do tempo da Torre existe')
        await pg.wait_for_timeout(600)
        ok, r = await no_historico_da(pg, 'lk2')
        ck('Linha do tempo leva ao Histórico da carga', ok, str(r))
        await pg.click('.nav-tab[data-tab="patio"]')
        await pg.wait_for_timeout(700)
        await pg.click('.pv-card[data-id="lk1"]')
        await pg.wait_for_timeout(600)
        await clicar(pg, '#gv-miolo .acao-carga[data-destino="frete"]', 'o botão Frete do Pátio ao vivo existe')
        await pg.wait_for_timeout(1200)
        aba = await pg.evaluate("() => document.querySelector('.tab-page.active').id")
        busca = await pg.evaluate("() => (document.getElementById('frete-busca') || {}).value")
        ck('Frete abre o Pagamento de Frete já buscando a carga', aba == 'tab-frete' and busca == str(numero_frete), f'{aba} busca={busca!r}')

        # ==============================================================
        print('\n=== 4. PAGAMENTO DE FRETE → A CARGA NO PÁTIO ===')
        bt = pg.locator(f'#frete-tbody .acao-carga[data-destino="linha"]').first
        ck('a carga do Frete tem a Linha do tempo do pátio', await bt.count() > 0)
        if await bt.count():
            await bt.click()
            await pg.wait_for_timeout(600)
            ok, r = await no_historico_da(pg, 'lk1')
            ck('e leva à linha do tempo da carga de mesmo número', ok, str(r))

        # ==============================================================
        print('\n=== 5. VISÃO DO PÁTIO → O NÚMERO DA CARGA É UM LINK ===')
        await pg.click('.nav-tab[data-tab="torre"]')
        await pg.wait_for_timeout(700)
        vp = pg.locator('#torre-vp-tbody tr[data-carga="lk2"] .acao-carga[data-destino="linha"]')
        ck('a linha da Visão do Pátio leva à linha do tempo', await vp.count() == 1)
        if await vp.count():
            await vp.click()
            await pg.wait_for_timeout(600)
            ok, r = await no_historico_da(pg, 'lk2')
            ck('e chega na carga certa', ok, str(r))

        # ==============================================================
        print('\n=== 6. PONTOS DE ATENÇÃO → A CARGA DE EXEMPLO LEVA À CARGA ===')
        await pg.evaluate("""() => {
          SuincoSharePoint.estaConfigurado = () => true;
          SuincoSharePoint.atencao = async () => ({ agora: new Date().toISOString(), pontos: [{
            codigo: 'teste', gravidade: 'media', titulo: 'Carga parada', explicacao: 'teste',
            quantidade: 1, desde: null, onde: { aba: 'torre', rotulo: 'Torre' },
            exemplos: [{ carga: 'LK-3', placa: 'LKC3D33', detalhe: 'parada' }] }] });
        }""")
        # A conferência que o painel faz sozinho a cada poucos minutos, agora:
        # ela acende o botão da caixa no topo.
        await pg.evaluate("() => atualizarPontosDeAtencao()")
        await pg.wait_for_timeout(300)
        await pg.click('#btn-atencao')
        await pg.wait_for_timeout(700)
        ex = pg.locator('#atencao-lista .acao-carga[data-destino="linha"]')
        ck('o exemplo "Carga LK-3" vira botão', await ex.count() == 1)
        if await ex.count():
            await ex.click()
            await pg.wait_for_timeout(600)
            ok, r = await no_historico_da(pg, 'lk3')
            ck('e leva à linha do tempo dela, com a caixa fechada', ok and not await pg.is_visible('#modal-atencao.open'), str(r))
        await pg.close()

        # ==============================================================
        print('\n=== 7. O BOTÃO SÓ APARECE ONDE A PESSOA PODE IR ===')
        pg = await abrir('Logística')
        await pg.click('.nav-tab[data-tab="patio"]')
        await pg.wait_for_timeout(900)
        await pg.click('.pv-card[data-id="lk1"]')
        await pg.wait_for_timeout(600)
        dest = await pg.eval_on_selector_all('#gv-miolo .acao-carga', 'els => els.map(e => e.dataset.destino)')
        ck('a Logística não vê "Corrigir etapa" (é da Administração)', 'corrigir' not in dest and 'linha' in dest, str(dest))
        await pg.close()

        pg = await abrir('Portaria')
        await pg.click('.nav-tab[data-tab="portaria"]')
        await pg.wait_for_timeout(800)
        dest = await pg.eval_on_selector_all('#portaria-vp-tbody tr[data-carga="lk2"] .acao-carga', 'els => els.map(e => e.dataset.destino)')
        ck('a Portaria (sem Torre e sem Frete) vê só a Linha do tempo', dest == ['linha'], str(dest))
        await pg.close()

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: de todo lugar onde a carga aparece, há para onde ir.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
