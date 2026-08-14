#!/usr/bin/env python3
"""A confirmação de gravação nunca diz "pronto" se o dado não subiu.

Incidente real relatado pelo gestor (12/08/2026): o programador lançou
cargas por um tempo sem perceber que o painel estava DESCONECTADO. Elas
não apareciam para ninguém, e ele teve que lançar tudo de novo.

O diagnóstico de "falta de cultura, as pessoas precisam olhar a luz
verde" não se sustenta olhando o código: ao criar uma carga offline, o
sistema respondia "Carga criada" em VERDE, com cara de sucesso. O aviso
de conexão existia — mas passivo, no rodapé — enquanto a confirmação da
ação, que é onde o olho está, dizia que tinha dado certo.

Ninguém precisa lembrar de conferir nada se a própria confirmação for
honesta.

    python3 testes/test_aviso_gravacao_honesto.py
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


async def avisos(pg):
    return await pg.evaluate(
        "() => Array.from(document.querySelectorAll('.notif-item'))"
        ".map(n=>({txt:n.textContent, cls:n.className})) ")


async def limpar_avisos(pg):
    await pg.evaluate("() => { document.getElementById('notif').innerHTML=''; }")


async def criar_carga(pg, num, i=0):
    await pg.evaluate("""([num, i]) => {
        const placa = DB.frota[i].placa;
        document.getElementById('prog-placa').value = placa;
        atualizarPreviewFrotaPrograma();
        document.getElementById('prog-numero-carga').value = num;
        document.getElementById('prog-peso').value = '9000';
        criarCargaProgramadaUI();
    }""", [num, i])
    await pg.wait_for_timeout(600)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Wemerson')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(600)
        await pg.evaluate("() => irParaTab('programacao')")
        await pg.wait_for_timeout(400)

        print('\n=== 1. MODO LOCAL: O AVISO NÃO PODE PARECER SUCESSO ===')
        # Entrou sem servidor: o dado fica só neste navegador, para sempre.
        await limpar_avisos(pg)
        await criar_carga(pg, 'LOCAL-1', 0)
        av = await avisos(pg)
        txt = ' '.join(a['txt'] for a in av)
        cls = ' '.join(a['cls'] for a in av)
        print(f'    {txt[:150]}')
        ck('o aviso avisa que NÃO subiu',
           'LOCAL' in txt.upper() or 'SÓ NESTE' in txt.upper(), txt[:120])
        ck('o aviso NÃO é verde de sucesso', 'success' not in cls, cls)
        ck('diz que os outros setores não veem',
           'setor' in txt.lower() and ('não' in txt.lower() or 'nenhum' in txt.lower()), txt[:120])

        print('\n=== 2. OFFLINE: AVISA QUE ESTÁ NA FILA ===')
        await pg.evaluate("""() => {
            SuincoSharePoint.estado = () => 'offline';
            SuincoSharePoint.pendentes = () => 3;
        }""")
        await limpar_avisos(pg)
        await criar_carga(pg, 'OFF-1', 1)
        av = await avisos(pg)
        txt = ' '.join(a['txt'] for a in av)
        cls = ' '.join(a['cls'] for a in av)
        print(f'    {txt[:150]}')
        ck('avisa que está sem conexão', 'SEM CONEXÃO' in txt.upper(), txt[:120])
        ck('informa quantos estão na fila', '3' in txt, txt[:120])
        ck('diz que sobe sozinho quando a rede voltar',
           'rede voltar' in txt.lower(), txt[:120])
        ck('não é verde de sucesso', 'success' not in cls, cls)

        print('\n=== 3. ONLINE: CONFIRMAÇÃO NORMAL, SEM ALARME FALSO ===')
        await pg.evaluate("""() => {
            SuincoSharePoint.estado = () => 'online';
            SuincoSharePoint.pendentes = () => 0;
        }""")
        await limpar_avisos(pg)
        await criar_carga(pg, 'ON-1', 2)
        av = await avisos(pg)
        txt = ' '.join(a['txt'] for a in av)
        cls = ' '.join(a['cls'] for a in av)
        print(f'    {txt[:120]}')
        ck('conectado: aviso é de sucesso', 'success' in cls, cls)
        ck('conectado: NÃO assusta com aviso de conexão',
           'SEM CONEXÃO' not in txt.upper() and 'MODO LOCAL' not in txt.upper(), txt[:120])

        print('\n=== 4. VALE PARA AS OUTRAS AÇÕES CRÍTICAS ===')
        # Avanço de status é o que a Portaria/Expedição/Faturamento fazem
        # o dia inteiro — o mesmo risco de "achei que tinha registrado".
        await pg.evaluate("() => { SuincoSharePoint.estado = () => 'offline'; }")
        await limpar_avisos(pg)
        await pg.evaluate("""() => {
            const c = DB.cargas.find(x=>x.numeroCarga==='ON-1');
            executarAvanco(c.id, 'Aguardando Embarque');
        }""")
        await pg.wait_for_timeout(700)
        txt = ' '.join(a['txt'] for a in await avisos(pg))
        ck('mudança de status offline também avisa',
           'SEM CONEXÃO' in txt.upper(), txt[:130])

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
