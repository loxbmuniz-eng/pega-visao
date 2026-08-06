#!/usr/bin/env python3
"""O acabamento de vidro não pode custar leitura nem papel.

O tema claro era branco sobre branco: fundo #eef1f6, card #ffffff. Dois tons
a cinco por cento de distância — a tela virava uma folha só e não se via
onde um card começava. Ninguém percebeu por meses porque nenhum teste olhava
para a SEPARAÇÃO entre superfícies, só para o contraste do texto.

O que se prova aqui:

1. Card e página têm diferença de luminância suficiente para o olho separar
   um do outro, NOS DOIS TEMAS. É o defeito que motivou a mudança.
2. O texto continua legível sobre a superfície translúcida — vidro que
   derruba o contraste é decoração cara.
3. Nada de vidro chega ao papel: sem backdrop-filter, sem camada de
   ambiente. Superfície translúcida vira cinza chapado na impressora.
4. O ambiente decorativo não intercepta clique.

    python3 testes/test_vidro.py
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


def rgb(txt):
    """'rgb(30, 42, 82)' ou 'rgba(30, 42, 82, 0.58)' -> (r,g,b,a)."""
    nums = [float(n) for n in txt.replace('rgba(', '').replace('rgb(', '')
            .replace(')', '').split(',')]
    return (nums[0], nums[1], nums[2], nums[3] if len(nums) > 3 else 1.0)


def sobre(frente, fundo):
    """Achata uma cor translúcida sobre o fundo — é o que o olho vê."""
    r, g, b, a = frente
    fr, fg, fb, _ = fundo
    return (r * a + fr * (1 - a), g * a + fg * (1 - a), b * a + fb * (1 - a), 1.0)


def lum(c):
    """Luminância relativa, WCAG."""
    def canal(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * canal(c[0]) + 0.7152 * canal(c[1]) + 0.0722 * canal(c[2])


def contraste(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        for tema in ('escuro', 'claro'):
            print(f'\n=== TEMA {tema.upper()} ===')
            await pg.evaluate(f"()=>document.documentElement.setAttribute('data-tema','{tema}')")
            await pg.wait_for_timeout(300)

            c = await pg.evaluate("""() => {
                const card = document.querySelector('.tab-page.active .card');
                const g = e => getComputedStyle(e);
                return {
                    pagina: g(document.body).backgroundColor,
                    card:   g(card).backgroundColor,
                    texto:  g(card).color,
                    borda:  g(card).borderTopColor,
                    // O ambiente é decoração: não pode receber clique nem
                    // entrar na ordem de foco. getComputedStyle SEM o
                    // segundo argumento lê o próprio body — que é clicável,
                    // e o teste acusaria falha onde não há.
                    ambienteClicavel:
                        getComputedStyle(document.body, '::before').pointerEvents !== 'none'
                };
            }""")

            pagina = rgb(c['pagina'])
            # O card é translúcido: o que o olho vê é ele ACHATADO sobre a página.
            card_visto = sobre(rgb(c['card']), pagina)
            texto_visto = sobre(rgb(c['texto']), card_visto)

            separacao = contraste(card_visto, pagina)
            legibilidade = contraste(texto_visto, card_visto)

            # 1.08 é pouco, e é de propósito: card e fundo NÃO devem contrastar
            # como texto contrasta com fundo — devem apenas se distinguir. O
            # tema claro antigo ficava em 1.04, indistinguível.
            ck(f'{tema}: o card se separa do fundo da página',
               separacao >= 1.08, f'razão {separacao:.3f} (mínimo 1.08)')
            ck(f'{tema}: texto legível sobre o vidro (AA = 4.5)',
               legibilidade >= 4.5, f'razão {legibilidade:.2f}')
            ck(f'{tema}: o card tem borda visível', rgb(c['borda'])[3] > 0.03,
               c['borda'])
            ck(f'{tema}: o ambiente não intercepta clique',
               not c['ambienteClicavel'])

        print('\n=== IMPRESSÃO: SEM VIDRO ===')
        await pg.emulate_media(media='print')
        await pg.wait_for_timeout(300)
        imp = await pg.evaluate("""() => {
            const alvos = [...document.querySelectorAll('#header,#nav,.card,.modal-overlay')];
            const comBorrao = alvos.filter(e => {
                const g = getComputedStyle(e);
                const f = g.backdropFilter || g.webkitBackdropFilter || 'none';
                return f && f !== 'none';
            }).length;
            return {
                comBorrao,
                ambiente: getComputedStyle(document.body, '::before').display,
                fundoPagina: getComputedStyle(document.body).backgroundColor
            };
        }""")
        ck('nenhuma superfície desfoca no papel', imp['comBorrao'] == 0,
           f"{imp['comBorrao']} elemento(s) com backdrop-filter")
        ck('a camada de ambiente some na impressão', imp['ambiente'] == 'none',
           imp['ambiente'])
        ck('a página imprime em branco', rgb(imp['fundoPagina'])[:3] == (255.0, 255.0, 255.0),
           imp['fundoPagina'])
        await pg.emulate_media(media='screen')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
