#!/usr/bin/env python3
"""O nome da empresa nos documentos é o do CNPJ (06/10/2026).

Pedido do dono: "vamos mudar o nome que aparece em todos os relatorios para
o real nome do cnpj da suinco que nao é cooperativa agroindustrial" e
"voce vai corrigir em todos os lugares que tiver errado essas informacoes".

O painel escrevia "Suinco — Cooperativa Agroindustrial", que não é o nome de
registro. O nome do CNPJ, conferido em cadastros públicos (matriz em Patos
de Minas/MG, ativa desde 2004) e igual ao que o DeliveryB2B imprime nos
relatórios da operação, é:

    SUINCO - COOPERATIVA DE SUINOCULTORES LTDA · CNPJ 06.067.949/0001-95

Este teste trava os DOIS lados:
  1. o nome errado não volta em nada que vira papel ou tela — o painel
     publicado, os geradores (apresentação, comitê, manual, guias), o mapa
     do arquivo, o README e o TEXTO de dentro dos PDFs já gerados;
  2. o nome certo e o CNPJ estão na fonte única do painel (EMPRESA) e
     aparecem na tela de login, que é o que a pessoa vê primeiro.

A migração de clientes (019) fica de fora de propósito: lá "Agroindustrial"
é parte do nome de OUTRAS empresas, clientes da Suinco.

    bash testes/rodar_tudo.sh nome_oficial_da_empresa
"""
import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
RAZAO = 'SUINCO - COOPERATIVA DE SUINOCULTORES LTDA'
CNPJ = '06.067.949/0001-95'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


ERRADO = re.compile(r'cooperativa\s+agroindustrial', re.I)

FONTES = [
    RAIZ / 'index.html', RAIZ / 'index_suinco.html', RAIZ.parent.parent / 'README.md',
    RAIZ / 'docs' / 'MAPA_MESTRE_DO_ARQUITETO.md', RAIZ / 'docs' / 'MAPA_MESTRE_DO_ARQUITETO.html',
    RAIZ / 'apresentacao' / 'gerar_apresentacao.py', RAIZ / 'apresentacao' / 'Suinco_Apresentacao_Painel.html',
    RAIZ / 'comite' / 'gerar_ficha.py', RAIZ / 'ferramentas' / 'gerar_manual_pdf.py', RAIZ / 'tutoriais' / 'gerar_guias.py',
    *sorted((RAIZ / 'app').glob('*.js')),
]
PDFS = [RAIZ / 'comite' / 'Ficha_Priorizacao_Devolucoes.pdf', RAIZ / 'apresentacao' / 'Suinco_Apresentacao_Painel.pdf',
        *sorted((RAIZ / 'tutoriais' / 'pdf').glob('*.pdf'))]


def texto_dos_pdfs():
    """O texto de dentro de cada PDF, pela mesma leitura que o servidor usa."""
    js = f"""
      import fs from 'node:fs';
      import {{ lerPaginasDoPdf }} from '{RAIZ}/backend/src/servicos/pdf_texto.js';
      const saida = {{}};
      for (const f of {json.dumps([str(p) for p in PDFS])}) {{
        const paginas = await lerPaginasDoPdf(fs.readFileSync(f));
        saida[f] = paginas.map((p) => (p.itens || p.items || p).map((i) => i.s ?? i.str ?? '').join(' ')).join('\\n');
      }}
      console.log(JSON.stringify(saida));
    """
    r = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, cwd=str(RAIZ / 'backend'))
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        print('    [node]', (r.stderr or r.stdout)[:400])
        return None


async def main():
    print('\n=== 1. O NOME ERRADO NÃO VOLTA NAS FONTES ===')
    for f in FONTES:
        if not f.exists():
            ck(f'{f.name} existe', False)
            continue
        achou = [m.group(0) for m in ERRADO.finditer(f.read_text(encoding='utf-8', errors='ignore'))]
        ck(f'{f.relative_to(RAIZ.parent.parent)} sem "Cooperativa Agroindustrial"', not achou, f'{len(achou)} ocorrência(s)')

    print('\n=== 2. NEM DENTRO DOS PDFs JÁ GERADOS ===')
    textos = texto_dos_pdfs()
    ck('o texto dos PDFs foi lido', textos is not None)
    for f, t in (textos or {}).items():
        junto = re.sub(r'\s+', '', t).lower()
        ck(f'{Path(f).name} sem "Agroindustrial"', 'agroindustrial' not in junto)

    print('\n=== 3. O NOME CERTO, COM O CNPJ, NA FONTE ÚNICA DO PAINEL ===')
    app = '\n'.join(p.read_text(encoding='utf-8') for p in sorted((RAIZ / 'app').glob('*.js')))
    ck('EMPRESA traz a razão social do CNPJ', f"razaoSocial: '{RAZAO}'" in app)
    ck('EMPRESA traz o CNPJ da matriz', f"cnpj: '{CNPJ}'" in app)
    ck('cabeçalho e ficha dos PDFs usam a fonte única (sem nome escrito à mão)',
       app.count('EMPRESA.razaoSocial') >= 2 and 'EMPRESA.cnpj' in app)

    print('\n=== 4. COMO A PESSOA VÊ: A TELA DE LOGIN ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page()
        await pg.goto(f'file://{RAIZ / "index.html"}')
        await pg.wait_for_timeout(1200)
        marca = await pg.inner_text('#login-marca') if await pg.query_selector('#login-marca') else ''
        ck('a tela de login mostra a razão social do CNPJ', RAZAO.lower() in marca.lower(), marca.replace('\n', ' | ')[:120])
        await nav.close()

    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
