#!/usr/bin/env python3
"""Aviso não tampa mais a tela — limite de 3 visíveis, o resto espera a vez.

Pedido do usuário (08/08/2026): "essa notificacao de atualizacoes no
mobile tao saindo muito grandes, no desktop tambem, quase tampa a tela
inteira se tiver 5 atualizacoes, entao vamos formatar isso de forma mais
funcional?".

Nada é descartado — o aviso de troca de placa é segurança (o caminhão
errado entra na doca por causa dele), não decoração. Só um número
limitado fica visível ao mesmo tempo; o resto entra numa fila e mostra
um contador "+N aguardando".

    python3 testes/test_fila_notificacoes.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(600)

        print('\n=== 1. 5 AVISOS DE UMA VEZ: SÓ 3 FICAM VISÍVEIS, O RESTO ENTRA NA FILA ===')
        # Zera o que já estava na tela (ex.: "Base de Frota carregada", que
        # dispara sozinho ao abrir o painel) pra começar a contagem do zero.
        await pg.evaluate("""() => {
            document.getElementById('notif').innerHTML = '';
            _notifFila.length = 0;
            for (let i = 0; i < 5; i++) notify('Aviso número ' + i, 'success', 60000);
        }""")
        await pg.wait_for_timeout(200)
        visiveis = await pg.evaluate("() => document.querySelectorAll('#notif .notif-item').length")
        ck('exatamente 3 avisos visíveis ao mesmo tempo (não 5)', visiveis == 3, str(visiveis))
        contador = await pg.evaluate("""() => {
            const el = document.getElementById('notif-fila-contador');
            return el ? el.textContent : null;
        }""")
        ck('contador mostra os 2 que ainda faltam', contador and '2' in contador, str(contador))

        print('\n=== 2. FECHAR UM NA MÃO LIBERA A VEZ DO PRÓXIMO DA FILA ===')
        await pg.evaluate("() => document.querySelector('#notif .notif-fechar').click()")
        await pg.wait_for_timeout(200)
        visiveis_depois = await pg.evaluate("() => document.querySelectorAll('#notif .notif-item').length")
        ck('continua em 3 visíveis (um saiu, o da fila entrou no lugar)', visiveis_depois == 3, str(visiveis_depois))
        contador_depois = await pg.evaluate("""() => {
            const el = document.getElementById('notif-fila-contador');
            return el ? el.textContent : null;
        }""")
        ck('fila caiu pra 1 (o contador reflete certo, não o valor de antes)',
           contador_depois and '1' in contador_depois, str(contador_depois))

        print('\n=== 3. NENHUM AVISO É PERDIDO — O ÚLTIMO DA FILA AINDA APARECE ===')
        # Estado ao entrar aqui: 3 visíveis, 1 ainda na fila ("Aviso número
        # 4"). Fecha só UM pra abrir vaga pra ele e confere ANTES de fechar
        # mais nada — fechar de mais apagaria a prova que o teste busca.
        await pg.evaluate("() => document.querySelector('#notif .notif-fechar').click()")
        await pg.wait_for_timeout(200)
        textos = await pg.evaluate(
            "() => [...document.querySelectorAll('#notif .notif-item')].map(e => e.textContent)")
        ck('o aviso "Aviso número 4" (o último da fila) chegou a aparecer',
           any('Aviso número 4' in t for t in textos), str(textos))

        # Drena o resto pra confirmar que a fila esvazia e o contador some.
        for _ in range(3):
            await pg.evaluate("() => { const b = document.querySelector('#notif .notif-fechar'); if(b) b.click(); }")
            await pg.wait_for_timeout(150)
        sem_contador = await pg.evaluate("() => !document.getElementById('notif-fila-contador')")
        ck('contador some quando a fila esvazia', sem_contador)

        print('\n=== 4. MENSAGEM DE SINCRONIA DIZ O QUE MUDOU, NÃO SÓ A CONTAGEM ===')
        msg = await pg.evaluate("""() => mensagemAtualizacaoRemota({
            cargasNovas: 1, cargasAtualizadas: 1,
            detalhes: [
                {placa:'ABC1234', numeroCarga:'M1', status:'Aguardando Embarque', setor:'Portaria', acao:'mudou de status'},
                {placa:'DEF5678', numeroCarga:null, status:null, setor:null, acao:'programada'},
            ],
        })""")
        ck('cita o setor (Portaria) em vez de só um número', 'Portaria' in msg, msg)
        ck('cita a carga/placa específica, não só "2 atualizadas"', 'M1' in msg or 'ABC1234' in msg, msg)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
