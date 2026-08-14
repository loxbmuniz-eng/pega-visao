#!/usr/bin/env python3
"""Caminhão que já saiu não fica preso na lista "Aguardando Carga".

RELATO (14/08/2026): "não consigo excluir essas duas cargas que ficaram
como resíduo". Ao clicar em Excluir, o painel respondia "Esta carga já
seguiu viagem e não pode ser removida. O histórico do pátio não se apaga."

O QUE ACONTECIA
Um caminhão chega sem programação: a Portaria registra e nasce um registro
`aguardandoCarga`. A carga dele nunca é lançada. Mais tarde ele sai, e a
Portaria registra a saída — o registro vira `Seguiu Viagem`, mas continua
com a marca `aguardandoCarga`.

`renderProgAguardando` listava `DB.cargas.filter(c => c.aguardandoCarga)`,
a lista CRUA, sem tirar quem já saiu. Todo o resto do painel usa
`cargasAbertas()`, que exclui `Seguiu Viagem` — inclusive o CONTADOR que
fica ao lado desta mesma lista. Contador e lista discordavam, e o registro
ficava lá para sempre: não dá para lançar carga de um caminhão que já foi
embora, e o botão Excluir se recusa (com razão) a apagar quem já viajou.

A CORREÇÃO não é liberar a exclusão — o histórico do pátio não se apaga
mesmo. É parar de chamar de "aguardando carga" um caminhão que já saiu.
Ele continua no Histórico e nos relatórios, onde deve estar.

    python3 testes/test_aguardando_carga_sem_residuo.py
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
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Luis')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== CENÁRIO: ENTROU SEM PROGRAMAÇÃO, SAIU SEM CARGA LANÇADA ===')
        r = await pg.evaluate("""() => {
            const placa = DB.frota[9].placa;
            registrarChegadaPortaria(placa, 'Porteiro');
            const c = DB.cargas.find(x => x.placa === placa && x.aguardandoCarga);
            // O caminhão vai embora sem que a carga tenha sido lançada.
            c.status = 'Seguiu Viagem';
            SuincoStore.save();
            renderAll();
            return {id: c.id, placa, aindaAguardando: c.aguardandoCarga};
        }""")
        ck('o registro continua marcado como aguardandoCarga (é o estado real)',
           r['aindaAguardando'])

        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(500)

        visto = await pg.evaluate("""(placa) => {
            const linhas = [...document.querySelectorAll('#prog-aguardando-tbody tr')];
            const pill = document.getElementById('prog-aguardando-count');
            return {
                naLista: linhas.some(tr => tr.textContent.includes(placa)),
                linhas: linhas.length,
                contador: Number(pill.textContent || 0),
            };
        }""", r['placa'])

        ck('o caminhão que já saiu NÃO aparece em "Aguardando Carga"',
           not visto['naLista'], str(visto))
        ck('contador e lista concordam', visto['contador'] == visto['linhas'],
           f"contador={visto['contador']} linhas={visto['linhas']}")

        print('\n=== O REGISTRO NÃO FOI APAGADO — SÓ SAIU DA LISTA ERRADA ===')
        # A trava de exclusão continua valendo: histórico do pátio não some.
        existe = await pg.evaluate("(id) => !!DB.cargas.find(c=>c.id===id)", r['id'])
        ck('a carga continua existindo nos dados', existe)

        print('\n=== QUEM AINDA ESTÁ NO PÁTIO CONTINUA APARECENDO ===')
        # O risco desta correção é esconder demais. Esta é a prova contrária.
        r2 = await pg.evaluate("""() => {
            const placa = DB.frota[10].placa;
            registrarChegadaPortaria(placa, 'Porteiro');
            renderAll();
            return placa;
        }""")
        await pg.wait_for_timeout(400)
        aparece = await pg.evaluate("""(placa) =>
            [...document.querySelectorAll('#prog-aguardando-tbody tr')]
                .some(tr => tr.textContent.includes(placa))""", r2)
        ck('caminhão no pátio sem carga lançada continua na lista', aparece, str(r2))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
