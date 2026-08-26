#!/usr/bin/env python3
"""Avisos no celular: a tela precisa dizer a verdade sobre o que recebe.

Pedido do dono em 26/08/2026 — aviso no celular a cada caminhão que entra
na portaria, a cada saída, e no fim da programação do dia. Ele mesmo
recortou quem recebe o quê: entrada vai para Logística, Administração e
Expedição; saída, só para Logística e Administração.

O que este arquivo prova:

  1. a lista que a tela mostra ("o que você recebe") é a MESMA que o
     servidor usa. As duas moram em arquivos diferentes por necessidade —
     uma em JavaScript de navegador, outra em Node — e duas cópias de uma
     regra é a forma clássica de uma envelhecer sozinha. Aqui o teste lê o
     arquivo do servidor e compara;

  2. quando não dá para ligar, a tela diz POR QUE e o que fazer. "Não
     funcionou" sem motivo é o que faz a pessoa desistir e nunca mais
     tentar — e no iPhone, sem o atalho na tela de início, nunca vai
     funcionar mesmo.

    python3 testes/test_avisos_celular.py
"""
import asyncio
import pathlib
import re
import sys
from playwright.async_api import async_playwright

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PAINEL = f'file://{RAIZ}/index.html'
SERVIDOR = RAIZ / 'backend' / 'src' / 'servicos' / 'avisos.js'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def setores_do_servidor(constante):
    """Lê a lista de setores direto do arquivo do servidor."""
    texto = SERVIDOR.read_text(encoding='utf-8')
    m = re.search(constante + r"\s*=\s*\[(.*?)\]", texto, re.S)
    if not m:
        return None
    return sorted(re.findall(r"'([^']+)'", m.group(1)))


async def estado_do_modal(pg, setor, resposta_chave=None, sem_push=False, ua=None):
    """Abre o modal com um setor e uma resposta de servidor de mentira."""
    await pg.evaluate(
        """([setor, resposta, semPush, ua]) => {
            window.DB = window.DB || {};
            DB.operador = { nome: 'Fulano de Teste', setor };
            window.__respostaChave = resposta;
            SuincoSharePoint.avisos.estadoNoServidor = async () => {
                if (window.__respostaChave === null) throw new Error('rede caiu');
                return window.__respostaChave;
            };
            SuincoSharePoint.avisos.ligadoNesteAparelho = async () => false;
            if (semPush) delete window.PushManager;
            if (ua) Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true });
        }""",
        [setor, resposta_chave, sem_push, ua],
    )
    await pg.evaluate("() => abrirModalAvisos()")
    await pg.wait_for_timeout(150)
    return await pg.evaluate(
        """() => ({
            aberto: document.getElementById('modal-avisos').classList.contains('open'),
            lista: document.getElementById('avisos-oquerecebe').innerText,
            estado: document.getElementById('avisos-estado').textContent,
            botaoVisivel: !document.getElementById('avisos-alternar').hidden,
            botaoTexto: document.getElementById('avisos-alternar').textContent,
            testeVisivel: !document.getElementById('avisos-testar').hidden,
        })"""
    )


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)

        print('\n=== 1. O SINO ESTÁ NO CABEÇALHO ===')
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        botao = await pg.query_selector('#btn-avisos')
        ck('existe o botão de avisos', botao is not None)
        if botao:
            rotulo = await botao.get_attribute('aria-label')
            ck('o botão tem nome para leitor de tela', bool(rotulo), str(rotulo))

        print('\n=== 2. A TELA E O SERVIDOR CONCORDAM SOBRE QUEM RECEBE ===')
        chegada_srv = setores_do_servidor('QUEM_RECEBE_CHEGADA')
        saida_srv = setores_do_servidor('QUEM_RECEBE_SAIDA')
        ck('consegui ler as listas do servidor',
           chegada_srv is not None and saida_srv is not None,
           f'chegada={chegada_srv} saida={saida_srv}')

        chegada_painel = []
        saida_painel = []
        for setor in ['Logística', 'Administração', 'Expedição', 'Faturamento', 'Portaria']:
            itens = await pg.evaluate("(s) => _avisosQueEsteSetorRecebe(s)", setor)
            texto = ' '.join(itens)
            if 'entrando na portaria' in texto:
                chegada_painel.append(setor)
            if 'seguiu viagem' in texto:
                saida_painel.append(setor)
            ck(f'{setor}: recebe o fim da programação',
               any('Fim da programação' in i for i in itens))

        ck('entrada: painel e servidor batem',
           sorted(chegada_painel) == chegada_srv,
           f'painel={sorted(chegada_painel)} servidor={chegada_srv}')
        ck('saída: painel e servidor batem',
           sorted(saida_painel) == saida_srv,
           f'painel={sorted(saida_painel)} servidor={saida_srv}')
        ck('Expedição recebe entrada mas NÃO a saída',
           'Expedição' in chegada_painel and 'Expedição' not in saida_painel,
           'foi o recorte explícito do dono')
        ck('Faturamento não recebe caminhão nenhum',
           'Faturamento' not in chegada_painel and 'Faturamento' not in saida_painel,
           '22 cargas/dia x 2 seria o caminho mais rápido para silenciarem o app')

        print('\n=== 3. SERVIDOR SEM AS CHAVES: A TELA NÃO FINGE ===')
        pg2 = await nav.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(900)
        r = await estado_do_modal(pg2, 'Logística',
                                  {'ligado': False, 'chavePublica': '', 'aparelhos': 0})
        ck('o modal abre', r['aberto'])
        ck('diz que o servidor ainda não ligou a função',
           'ainda não foi ligado no servidor' in r['estado'], r['estado'][:90])
        ck('esconde o botão em vez de oferecer o que não funciona',
           not r['botaoVisivel'])
        ck('esconde o teste também', not r['testeVisivel'])

        print('\n=== 4. SERVIDOR PRONTO, APARELHO AINDA NÃO ===')
        pg3 = await nav.new_page()
        pg3.on('pageerror', lambda e: erros.append(str(e)))
        await pg3.goto(PAINEL)
        await pg3.wait_for_timeout(900)
        r = await estado_do_modal(pg3, 'Administração',
                                  {'ligado': True, 'chavePublica': 'BOgus', 'aparelhos': 0})
        ck('oferece ligar', r['botaoVisivel'] and 'Ligar' in r['botaoTexto'], r['botaoTexto'])
        ck('avisa que o aparelho vai pedir permissão',
           'permissão' in r['estado'], r['estado'][:90])
        ck('não oferece testar antes de ligar', not r['testeVisivel'])

        print('\n=== 5. IPHONE EM ABA: ENSINA O CAMINHO EM VEZ DE FALHAR ===')
        pg4 = await nav.new_page()
        pg4.on('pageerror', lambda e: erros.append(str(e)))
        await pg4.goto(PAINEL)
        await pg4.wait_for_timeout(900)
        r = await estado_do_modal(
            pg4, 'Logística', {'ligado': True, 'chavePublica': 'x', 'aparelhos': 0},
            sem_push=True,
            ua='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        )
        ck('explica que no iPhone precisa do atalho na tela de início',
           'Tela de Início' in r['estado'] or 'tela de início' in r['estado'],
           r['estado'][:120])
        ck('não manda o dono do iPhone cobrar o servidor',
           'servidor' not in r['estado'].lower(),
           'ele pediria, e continuaria sem funcionar')
        ck('esconde o botão de ligar', not r['botaoVisivel'])

        print('\n=== 6. SERVIDOR FORA DO AR: MENSAGEM DE REDE, NÃO DE CONFIGURAÇÃO ===')
        pg5 = await nav.new_page()
        pg5.on('pageerror', lambda e: erros.append(str(e)))
        await pg5.goto(PAINEL)
        await pg5.wait_for_timeout(900)
        r = await estado_do_modal(pg5, 'Logística', None)
        ck('diz que não falou com o servidor',
           'servidor' in r['estado'].lower() and 'daqui a pouco' in r['estado'].lower(),
           r['estado'][:90])
        ck('esconde o botão', not r['botaoVisivel'])

        print('\n=== 7. NADA DE ERRO NO CONSOLE ===')
        ck('nenhum erro de página', not erros, ' | '.join(erros[:3]))

        await nav.close()

    print()
    if falhas:
        print(f"{len(falhas)} falha(s): " + ' | '.join(falhas))
        sys.exit(1)
    print('Tudo verde.')


asyncio.run(main())
