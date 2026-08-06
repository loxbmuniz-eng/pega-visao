#!/usr/bin/env python3
"""O botão de avanço veste a cor do status que ele produz.

Todos os botões da fila de Expedição e Faturamento eram btn-primary —
dourados. "Finalizar Embarque" saía amarelo e produzia um status
verde-claro: o operador apertava uma cor e recebia outra.

A escala de seis cores é a linguagem do painel. Ela está na badge, na linha
do tempo e no relatório impresso. Botão fora dessa escala obriga o operador
a decorar uma segunda convenção ("dourado = avançar") em vez de ler a cor
do destino.

O que se prova aqui:

1. A cor de fundo do botão é IDÊNTICA à cor da badge do status de destino —
   comparadas por valor calculado, não por nome de classe. Nome de classe
   igual não garante cor igual; valor calculado garante.
2. Vale nos dois temas.
3. O texto do botão tem contraste suficiente sobre o próprio preenchimento.
4. Expedição enxerga a aba Indicadores; Portaria e Faturamento, não.

    python3 testes/test_botao_avanco.py
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


def rgb(t):
    n = [float(x) for x in t.replace('rgba(', '').replace('rgb(', '').replace(')', '').split(',')]
    return tuple(n[:3])


def contraste(a, b):
    def lum(c):
        def ch(v):
            v /= 255
            return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        return .2126 * ch(c[0]) + .7152 * ch(c[1]) + .0722 * ch(c[2])
    la, lb = lum(a), lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)


# (aba, status em que a carga precisa estar, status que o botão produz)
CASOS = [
    ('expedicao',   'Aguardando Embarque',  'Embarque Iniciado'),
    ('expedicao',   'Embarque Iniciado',    'Embarque Finalizado'),
    ('faturamento', 'Embarque Finalizado',  'Faturado'),
]

ORDEM = ['Aguardando Veículo', 'Aguardando Embarque', 'Embarque Iniciado',
         'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
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

            for aba, origem, destino in CASOS:
                d = await pg.evaluate("""([aba, origem, destino, ordem]) => {
                    DB.cargas = []; DB.movimentacoes = [];
                    const f = DB.frota[0];
                    criarCargaProgramada({ placa:f.placa, numeroCarga:'77001',
                        peso:12000, rota:'500', operador:'Ana' });
                    const c = DB.cargas[0];
                    for(let i = 1; i <= ordem.indexOf(origem); i++){
                        avancarStatusCarga(c.id, ordem[i], 'Op', 'Logística');
                    }
                    abrirTab(aba); renderAll();

                    const tbody = document.getElementById(
                        aba === 'expedicao' ? 'exp-tbody' : 'fat-tbody');
                    const botao = tbody.querySelector('button');
                    if(!botao) return { erro: 'nenhum botão na fila' };

                    // A badge de referência é montada na hora, com o MESMO
                    // helper da tela, e medida fora do fluxo — comparar com
                    // a badge da linha mediria o status ATUAL, não o destino.
                    const ref = document.createElement('div');
                    ref.innerHTML = badgeHtml(destino);
                    ref.style.cssText = 'position:absolute;left:-9999px';
                    document.body.appendChild(ref);
                    const badge = ref.firstElementChild;
                    const gb = getComputedStyle(badge);
                    const gx = getComputedStyle(botao);
                    const r = {
                        rotulo: botao.textContent.trim(),
                        classe: botao.className,
                        fundoBotao: gx.backgroundColor,
                        fundoBadge: gb.backgroundColor,
                        textoBotao: gx.color,
                        textoBadge: gb.color
                    };
                    ref.remove();
                    return r;
                }""", [aba, origem, destino, ORDEM])

                if d.get('erro'):
                    ck(f'{aba} · {origem} → {destino}', False, d['erro'])
                    continue

                rot = d['rotulo']
                ck(f'{rot}: fundo igual ao da badge "{destino}"',
                   rgb(d['fundoBotao']) == rgb(d['fundoBadge']),
                   f"botão {d['fundoBotao']} · badge {d['fundoBadge']}")
                ck(f'{rot}: não usa mais o dourado genérico',
                   'btn-primary' not in d['classe'], d['classe'])
                cont = contraste(rgb(d['textoBotao']), rgb(d['fundoBotao']))
                ck(f'{rot}: texto legível sobre o preenchimento (AA = 4.5)',
                   cont >= 4.5, f'razão {cont:.2f}')

        print('\n=== INDICADORES POR SETOR ===')
        # Expedição opera as duas etapas mais longas do fluxo e pode agir
        # sobre o indicador no mesmo turno. Portaria só carimba chegada e
        # saída; Faturamento emite. Indicador sem poder de ação vira placar.
        for setor, deve_ver in (('Expedição', True), ('Portaria', False),
                                ('Faturamento', False), ('Logística', True)):
            visiveis = await pg.evaluate("""(setor) => {
                DB.operador = { nome:'Teste', setor, turno:'Manhã' };
                aplicarPermissoesSetor();
                return [...document.querySelectorAll('.nav-tab')]
                         .filter(t => !t.hidden).map(t => t.dataset.tab);
            }""", setor)
            tem = 'indicadores' in visiveis
            ck(f'{setor}: {"vê" if deve_ver else "NÃO vê"} Indicadores',
               tem == deve_ver, str(visiveis))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
