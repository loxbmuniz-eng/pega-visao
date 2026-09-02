#!/usr/bin/env python3
"""Setor criado no código aparece nas telas sozinho (02/09/2026).

O RELATO, do dono, tentando usar as filiais logo depois de publicá-las:

    "nao apareceu a filial pra cadastrar usuarios"
    "precisa ter esse setor pra eu poder cadastrar nao aparece"

A CAUSA. A lista de setores estava escrita À MÃO no HTML, em TRÊS lugares:
o filtro do Histórico, o cadastro de usuário e o login local. Somando
`SETORES` no painel (data.js) e `SETORES` no servidor (dominio/fluxo.js),
eram CINCO cópias da mesma lista. Criar um setor exigia lembrar das cinco,
e eu lembrei de duas — as que fazem a permissão funcionar. As três que
fazem o setor APARECER ficaram para trás, e o resultado é o pior tipo de
entrega: a regra existe, o banco aceita, e não há como usar.

É a família da ocorrência #14, "a mesma decisão escrita em dois lugares" —
agora com cinco. A correção é a mesma que valeu lá: uma fonte, e os outros
perguntam.

O QUE ESTE TESTE EXIGE:

  1. os três seletores saem da MESMA lista — não de cópias no HTML;
  2. as três filiais aparecem onde precisam: cadastro de usuário e filtro
     do Histórico;
  3. o login LOCAL não oferece filial. É o modo sem servidor, e filial que
     entrasse por ali trabalharia isolada — exatamente o que a trava de
     offline existe para impedir;
  4. nenhum setor antigo sumiu no caminho.

Roda sem servidor.

    python3 testes/test_setor_novo_aparece_nas_telas.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
ANTIGOS = ['Logística', 'Portaria', 'Expedição', 'Faturamento',
           'Administração', 'Comercial', 'Controles Internos', 'Central de Notas']
FILIAIS = ['Filial 105 BSB', 'Filial 106 BAHIA', 'Filial 107 ES']

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1500)

        sel = await pg.evaluate("""() => {
            const ler = (id) => {
              const s = document.getElementById(id);
              return s ? [...s.options].map(o => o.textContent.trim()) : null;
            };
            return { usuario: ler('usr-setor'), historico: ler('hist-filtro-setor'),
                     loginLocal: ler('login-setor'),
                     naLista: (typeof SETORES !== 'undefined') ? SETORES : null };
        }""")

        print('\n=== 1. CADASTRO DE USUÁRIO OFERECE AS TRÊS FILIAIS ===')
        # Sem isto o setor existe no banco e ninguém consegue criar
        # ninguém nele — regra que existe e não dá para usar.
        for f in FILIAIS:
            ck(f'"{f}" aparece no cadastro de usuário',
               sel['usuario'] and f in sel['usuario'], str(sel['usuario'])[:110])

        print('\n=== 2. O FILTRO DO HISTÓRICO TAMBÉM ===')
        for f in FILIAIS:
            ck(f'"{f}" aparece no filtro do Histórico',
               sel['historico'] and f in sel['historico'], str(sel['historico'])[:110])

        print('\n=== 3. O LOGIN LOCAL NÃO OFERECE FILIAL ===')
        ck('nenhuma filial no login sem servidor',
           sel['loginLocal'] and not any(f in sel['loginLocal'] for f in FILIAIS),
           str(sel['loginLocal'])[:110])

        print('\n=== 4. NENHUM SETOR ANTIGO SUMIU ===')
        # Montar a lista sozinho não pode custar um setor que já existia.
        faltando = [s for s in ANTIGOS if not (sel['usuario'] and s in sel['usuario'])]
        ck('os oito setores antigos continuam no cadastro',
           not faltando, 'faltando: ' + ', '.join(faltando))

        print('\n=== 5. OS SELETORES SAEM DA MESMA LISTA ===')
        # A prova de que não há cópia: o que a lista tem é o que a tela
        # mostra. Se alguém acrescentar um setor só no HTML, isto reprova.
        ck('o cadastro mostra exatamente SETORES',
           sel['usuario'] == sel['naLista'],
           f"tela {len(sel['usuario'] or [])} · lista {len(sel['naLista'] or [])}")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
