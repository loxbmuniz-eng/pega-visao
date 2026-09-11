#!/usr/bin/env python3
"""A lista de Destino da Montagem do Dia mostra NOMES — não "[object Object]".

ACHADO DA REVISÃO DE CÓDIGO DE 11/09/2026, reproduzido no navegador antes de
qualquer correção:

    opções da lista: ['—', 'MARÍLIA', '[object Object]', '[object Object]']

A TABELA DE FRETE chega do servidor como objetos {destino, km} — é assim que
receberTabelaDeFrete() guarda DESTINOS_FRETE, e é assim que a Programação
(datalist) e o cálculo de KM a leem. A célula de Destino da Montagem tratava a
mesma lista como se fosse de TEXTO: `lista.includes(atual)` nunca achava o
destino atual, e `esc(d)` de um objeto imprime "[object Object]". Quem monta
não conseguia escolher destino pela lista; escolhendo, gravava
"[object Object]" no servidor, o KM do destino ficava nulo e a carga nascia
sem frete. É provável que seja o "quando adiciona a linha ela não aparece o
destino" relatado pelo dono em 10/09.

POR QUE NENHUM TESTE PEGOU: test_destino_frete_na_montagem.py prova a rota
(POST/PATCH gravam destino e KM) e nunca abre a célula na tela. Este aqui
mede a célula.

    python3 testes/test_lista_de_destino_na_montagem.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1000)

        print('\n=== 1. A CÉLULA MOSTRA OS NOMES DA TABELA, ORDENADOS, COM O ATUAL MARCADO ===')
        r = await pg.evaluate("""() => {
          DB.operador = {nome:'Wemerson', setor:'Logística'};
          /* A tabela como o SERVIDOR a devolve: objetos, fora de ordem. */
          receberTabelaDeFrete({ tarifas: [], destinos: [
            {destino:'RIBEIRÃO PRETO', km:300}, {destino:'ARAÇATUBA', km:520},
            {destino:'MARÍLIA', km:120} ] });
          _montagemDia = { dia:'2026-09-14', diaSemana:1, modelo:[], montagens:[{
            montagem_id:'m1', data_prog:'2026-09-14', rota_codigo:'500', rota_nome:'R',
            sequencia:1, numero_carga:'', peso:null, qtd_entregas:1, qtd_ganchos:0,
            paletizada:'Não', tipo_operacao:'', motorista:'', observacoes:'',
            placa:'', transportadora:'', frete_destino:'MARÍLIA', km_destino:120,
            km_deslocamento:120, frete_valor:null }] };
          renderAll(); abrirTab('programacao');
          const card = document.getElementById('card-montagem'); if(card) card.hidden = false;
          renderMontagem();
          if(typeof preencherSelectsDestinoFrete === 'function') preencherSelectsDestinoFrete();
          const sel = document.querySelector('#mont-tbody select.destino-inline');
          if(!sel) return { erro:'sem select de destino' };
          const dl = document.getElementById('lista-destinos-frete');
          return {
            opcoes: [...sel.options].map(o => o.textContent),
            valores: [...sel.options].map(o => o.value),
            selecionado: sel.value,
            datalist: dl ? [...dl.options].map(o => o.value) : null,
          };
        }""")
        ck('a célula existe', 'erro' not in r, str(r.get('erro')))
        ops = r.get('opcoes') or []
        ck('nenhuma opção é "[object Object]"', all('[object' not in o for o in ops), str(ops))
        ck('as três cidades estão na lista, sem repetir',
           ops == ['—', 'ARAÇATUBA', 'MARÍLIA', 'RIBEIRÃO PRETO'], str(ops))
        ck('o destino atual da linha vem marcado', r.get('selecionado') == 'MARÍLIA',
           str(r.get('selecionado')))
        ck('a ordem é a MESMA da lista da Programação (uma função, dois chamadores)',
           ops[1:] == (r.get('datalist') or []), f"célula {ops[1:]} × datalist {r.get('datalist')}")

        print('\n=== 2. ESCOLHER UM DESTINO MANDA O NOME AO SERVIDOR, NÃO UM OBJETO ===')
        e = await pg.evaluate("""async () => {
          const enviados = [];
          const original = SuincoSharePoint.montagem.alterar;
          SuincoSharePoint.montagem.alterar = async (id, mudanca) => { enviados.push({id, mudanca}); return {}; };
          const original2 = window.carregarMontagemUI;
          window.carregarMontagemUI = async () => {};
          const sel = document.querySelector('#mont-tbody select.destino-inline');
          sel.value = 'ARAÇATUBA';
          sel.dispatchEvent(new Event('change'));
          await new Promise(r => setTimeout(r, 50));
          SuincoSharePoint.montagem.alterar = original;
          window.carregarMontagemUI = original2;
          return enviados;
        }""")
        ck('uma alteração foi enviada', len(e) == 1, str(e))
        ck('com o NOME do destino', e and e[0]['mudanca'].get('freteDestino') == 'ARAÇATUBA',
           str(e[0]['mudanca'] if e else None))

        print('\n=== 3. DESTINO QUE SAIU DO CADASTRO CONTINUA NA LINHA QUE JÁ O TINHA ===')
        s = await pg.evaluate("""() => {
          _montagemDia.montagens[0].frete_destino = 'BAURU';   // não está mais na tabela
          renderMontagem();
          const sel = document.querySelector('#mont-tbody select.destino-inline');
          return { opcoes: [...sel.options].map(o => o.textContent), selecionado: sel.value };
        }""")
        ck('o destino antigo aparece e fica marcado', s.get('selecionado') == 'BAURU'
           and 'BAURU' in s.get('opcoes', []), str(s))
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
