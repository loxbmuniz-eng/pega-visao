#!/usr/bin/env python3
"""A saída do pátio só é "registrada" quando o SERVIDOR diz que foi (28/08/2026).

O INCIDENTE, do dono:

    "hoje aconteceu um problema: o porteiro deu saída no PUX às 6:38, no
     painel do porteiro e histórico apareceu que seguiu viagem e ok, porém
     a Bruna identificou que não tinha saído no painel dela, ligou pro
     Alysson que deu saída às 8:59, no mesmo veículo que a portaria tinha
     feito tudo certo"

O MECANISMO, rastreado no código:

  1. `POST /api/portaria/saida` existe no servidor desde 20/08 e NINGUÉM a
     chamava. `acaoSaidaUI` gravava no navegador e deixava a sincronia
     comum levar o status depois.
  2. `acaoChegadaUI` puxa o servidor ANTES de agir desde 19/08, porque
     lista velha decide errado. A saída, que é o espelho dela, nunca ganhou
     o mesmo cuidado.
  3. A confirmação era otimista: `notifyGravacao` e o beep tocavam antes de
     qualquer resposta. Sem rede — ou com o terminal sem servidor —
     `mudarStatus` devolvia `{enfileirado:false}` e o painel considerava
     tudo gravado. Tela verde, servidor mudo.

O QUE ESTE TESTE EXIGE:

  · a saída vai pela ROTA do servidor, e não pelo caminho local;
  · o que sobe é a placa e os lacres, numa chamada só;
  · quando o servidor RECUSA, o porteiro é avisado ALTO e a tela NÃO diz
    que saiu;
  · quando não há resposta, fica uma faixa na tela — nada de balão que some;
  · carga que ficou para trás vira faixa fixa, porque é ela que faz o
    caminhão continuar no pátio para os outros setores.

    python3 testes/test_saida_confirmada_pelo_servidor.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Porteiro')
    await pg.select_option('#login-setor', 'Portaria')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(900)


# Finge um servidor: registra o que foi chamado e devolve o que o teste mandar.
FINGIR_SERVIDOR = """(cfg) => {
  window.__chamadas = [];
  window.SuincoSharePoint = window.SuincoSharePoint || {};
  SuincoSharePoint.estaConfigurado = () => true;
  SuincoSharePoint.sincronizarAgora = async () => { window.__chamadas.push(['sync']); };
  SuincoSharePoint.portariaSaida = async (placa, lacres) => {
    window.__chamadas.push(['saida', placa, lacres]);
    if (cfg.erro) throw new Error(cfg.erro);
    return cfg.resposta;
  };
}"""


async def preparar_carga(pg, status='Faturado'):
    return await pg.evaluate("""(status) => {
          const placa = (DB.frota && DB.frota[0] && DB.frota[0].placa) || '';
          const c = criarCargaProgramada({ placa, numeroCarga: 'SAI-1', cliente: 'C',
            destino: 'D', rota: '500', peso: 9000,
            operador: {nome:'Ana', setor:'Logística'} });
          c.status = status;
          SuincoStore.save();
          document.getElementById('portaria-placa').value = placa;
          return { placa, id: c.id };
        }""", status)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        # ---------------------------------------------------------------
        print('\n=== 1. A SAÍDA VAI PELA ROTA DO SERVIDOR ===')
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        d = await preparar_carga(pg)
        await pg.evaluate(FINGIR_SERVIDOR, {
            'resposta': {'liberadas': [{'id': d['id'], 'numeroCarga': 'SAI-1'}], 'pendentes': []},
        })
        await pg.evaluate("() => { document.getElementById('portaria-lacre').value = '133476'; }")
        await pg.evaluate("() => acaoSaidaUI()")
        await pg.wait_for_timeout(900)
        r = await pg.evaluate("""() => ({
              chamadas: window.__chamadas,
              faixa: (document.getElementById('portaria-saida-aviso')||{}).hidden,
            })""")
        nomes = [c[0] for c in r['chamadas']]
        ck('a saída chamou a rota própria do servidor', 'saida' in nomes, str(nomes))
        ck('e sincronizou ANTES de decidir — lista velha decide errado',
           nomes and nomes[0] == 'sync', str(nomes))
        envio = next((c for c in r['chamadas'] if c[0] == 'saida'), None)
        ck('mandou a placa e o lacre na MESMA chamada',
           bool(envio) and envio[1] == d['placa'] and envio[2] == ['133476'], str(envio))
        ck('sem carga pendente, nenhuma faixa fica na tela', r['faixa'] is True, str(r['faixa']))
        await pg.close()

        # ---------------------------------------------------------------
        print('\n=== 2. SERVIDOR NÃO RESPONDEU: A TELA NÃO DIZ QUE SAIU ===')
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        d = await preparar_carga(pg)
        await pg.evaluate(FINGIR_SERVIDOR, {'erro': 'Failed to fetch'})
        await pg.evaluate("() => acaoSaidaUI()")
        await pg.wait_for_timeout(900)
        r = await pg.evaluate("""(id) => {
              const f = document.getElementById('portaria-saida-aviso');
              return { status: getCarga(id).status,
                       faixaVisivel: f ? !f.hidden : false,
                       faixaTexto: f ? f.textContent : '',
                       perigo: f ? f.className.indexOf('perigo') >= 0 : false };
            }""", d['id'])
        # ISTO É O CORAÇÃO DO INCIDENTE: sem confirmação, a carga NÃO pode
        # aparecer como "Seguiu Viagem" na tela de quem clicou.
        ck('a carga NÃO vira "Seguiu Viagem" sem o servidor confirmar',
           r['status'] == 'Faturado', str(r['status']))
        ck('e a tela mostra uma faixa de perigo, que não some sozinha',
           r['faixaVisivel'] and r['perigo'], str(r))
        ck('a faixa diz para não liberar o caminhão',
           'NÃO confirmada' in r['faixaTexto'], r['faixaTexto'][:80])
        await pg.close()

        # ---------------------------------------------------------------
        print('\n=== 3. CARGA QUE FICOU PARA TRÁS VIRA AVISO FIXO ===')
        # Foi o que a Bruna viu: o caminhão "saiu" e continuava no pátio.
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        d = await preparar_carga(pg)
        await pg.evaluate(FINGIR_SERVIDOR, {
            'resposta': {
                'liberadas': [{'id': d['id'], 'numeroCarga': 'SAI-1'}],
                'pendentes': [{'numero_carga': 'SAI-2', 'status_atual': 'Embarque Iniciado'}],
            },
        })
        await pg.evaluate("() => acaoSaidaUI()")
        await pg.wait_for_timeout(900)
        r = await pg.evaluate("""() => {
              const f = document.getElementById('portaria-saida-aviso');
              return { visivel: f ? !f.hidden : False, texto: f ? f.textContent : '' };
            }""".replace('False', 'false'))
        ck('a faixa aparece quando sobra carga na placa', r['visivel'] is True, str(r['visivel']))
        ck('e diz QUAL carga ficou e em que etapa',
           'SAI-2' in r['texto'] and 'Embarque Iniciado' in r['texto'], r['texto'][:110])
        ck('explicando que os outros setores ainda veem o caminhão no pátio',
           'no pátio' in r['texto'], r['texto'][:110])
        await pg.close()

        # ---------------------------------------------------------------
        print('\n=== 4. TERMINAL SEM SERVIDOR AVISA QUE NÃO É OFICIAL ===')
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        d = await preparar_carga(pg)
        # Sem fingir servidor nenhum: é o modo local, como o painel abre
        # quando alguém entra "sem servidor" ou a sessão caiu.
        await pg.evaluate("() => acaoSaidaUI()")
        await pg.wait_for_timeout(900)
        r = await pg.evaluate("""() => {
              const f = document.getElementById('portaria-saida-aviso');
              return { faixa: f ? !f.hidden : false, texto: f ? f.textContent : '',
                       perigo: f ? f.className.indexOf('perigo') >= 0 : false };
            }""")
        ck('modo local também levanta a faixa de perigo',
           r['faixa'] and r['perigo'], str(r))
        ck('e diz que a saída ficou SÓ neste terminal',
           'sem servidor' in r['texto'] or 'NÃO confirmada' in r['texto'], r['texto'][:110])
        await pg.close()

        print('\n=== 5. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
