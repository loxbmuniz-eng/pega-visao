#!/usr/bin/env python3
"""Gera o PDF do Mapa Completo do Sistema a partir do Markdown fonte.

Markdown → HTML (python-markdown, com tabelas) → PDF (Playwright, mesmo
motor de impressão já usado pelos relatórios operacionais do painel) — para
ter um documento de referência com tipografia legível, numerado, pronto
para imprimir e ler offline.

    python3 ferramentas/gerar_manual_pdf.py
"""
import asyncio
import sys
from pathlib import Path

import markdown
from playwright.async_api import async_playwright

BASE = Path(__file__).resolve().parent.parent
FONTE = BASE / 'docs' / 'MAPA_COMPLETO_DO_SISTEMA.md'
SAIDA_HTML = BASE / 'ferramentas' / 'saida_relatorios' / 'MAPA_COMPLETO_DO_SISTEMA.html'
SAIDA_PDF = BASE / 'ferramentas' / 'saida_relatorios' / 'MAPA_COMPLETO_DO_SISTEMA.pdf'

CSS = """
@page { size: A4; margin: 20mm 18mm 22mm 18mm; }
:root{
  --ouro:#b9903f; --ouro-forte:#8a6a26; --tinta:#111418; --tinta-dim:#3d4a5c;
  --linha:#c9d4e8; --fundo-suave:#eef1f6;
}
*{box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--tinta); font-size:11px; line-height:1.55; margin:0;
}
.capa{
  /* 250mm, não 257: a área imprimível de uma A4 com as margens deste
     documento (20mm + 22mm) é 255mm. 257mm estourava por 2mm e deixava
     uma segunda página quase vazia antes do sumário. */
  height:250mm; display:flex; flex-direction:column; justify-content:center;
  align-items:flex-start; page-break-after:always; border-left:6px solid var(--ouro);
  padding-left:24px;
}
.capa .selo{
  font-size:11px; font-weight:800; letter-spacing:.12em; text-transform:uppercase;
  color:var(--ouro-forte); margin-bottom:18px;
}
.capa h1{font-size:34px; margin:0 0 10px; line-height:1.15}
.capa .sub{font-size:15px; color:var(--tinta-dim); margin-bottom:38px; max-width:420px}
.capa .meta{font-size:11px; color:var(--tinta-dim); line-height:1.9}
.capa .meta strong{color:var(--tinta)}

h1{
  font-size:19px; border-bottom:2px solid var(--tinta); padding-bottom:6px;
  margin:0 0 14px; page-break-before:always;
}
h1:first-of-type{page-break-before:auto}
h2{font-size:15px; border-left:3px solid var(--ouro); padding-left:9px; margin:26px 0 10px}
h3{font-size:12.5px; color:var(--ouro-forte); margin:18px 0 6px}
p{margin:8px 0}
code{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--fundo-suave);
  padding:1px 5px; border-radius:3px; font-size:10px;
}
pre{
  background:#1c2534; color:#e7ecf5; padding:12px 14px; border-radius:6px;
  overflow-x:auto; font-size:9.5px; line-height:1.5; page-break-inside:avoid;
}
pre code{background:none; color:inherit; padding:0}
table{
  width:100%; border-collapse:collapse; margin:10px 0 16px; font-size:9.8px;
  page-break-inside:avoid;
}
th{
  background:var(--fundo-suave); color:var(--tinta-dim); text-align:left;
  padding:5px 7px; border-bottom:1.5px solid var(--tinta); font-size:9px;
  letter-spacing:.03em; text-transform:uppercase; font-weight:800;
}
td{padding:5px 7px; border-bottom:1px solid var(--linha); vertical-align:top}
tr:nth-child(even) td{background:#f7f8fb}
a{color:var(--ouro-forte); text-decoration:none}
ul,ol{margin:6px 0; padding-left:20px}
li{margin:3px 0}
strong{color:var(--tinta)}
hr{border:none; border-top:1px solid var(--linha); margin:22px 0}
blockquote{
  border-left:3px solid var(--ouro); margin:10px 0; padding:2px 14px;
  color:var(--tinta-dim); background:var(--fundo-suave);
}
#indice ul{list-style:none; padding-left:0}
#indice > ul > li{margin:5px 0; font-weight:700}
#indice a{color:var(--tinta)}
"""


def markdown_para_html(caminho_md: Path) -> str:
    texto = caminho_md.read_text(encoding='utf-8')
    # split(maxsplit=2): título e subtítulo viram a capa (abaixo), então
    # precisam SAIR do corpo — senão aparecem duplicados, uma vez na capa
    # e outra como primeiro título da página seguinte.
    linhas = texto.split('\n', 2)
    titulo = linhas[0].lstrip('# ').strip()
    subtitulo = linhas[1].strip('*').strip() if len(linhas) > 1 else ''
    resto = linhas[2] if len(linhas) > 2 else ''
    corpo = markdown.markdown(
        resto, extensions=['tables', 'toc', 'fenced_code', 'sane_lists']
    )
    return titulo, subtitulo, corpo


async def main():
    SAIDA_HTML.parent.mkdir(exist_ok=True)
    titulo, subtitulo, corpo = markdown_para_html(FONTE)

    html = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>{titulo}</title><style>{CSS}</style></head><body>
<div class="capa">
  <div class="selo">Suinco &middot; Cooperativa Agroindustrial &middot; Uso interno</div>
  <h1>{titulo}</h1>
  <div class="sub">{subtitulo}</div>
  <div class="meta">
    <strong>Documento de referência técnica e operacional</strong><br>
    Programação de Embarque &mdash; painel, servidor e processos<br>
    Gerado em 07/08/2026 &middot; embarquesuinco.com.br
  </div>
</div>
{corpo}
</body></html>"""
    SAIDA_HTML.write_text(html, encoding='utf-8')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page()
        await pg.goto(f'file://{SAIDA_HTML}')
        await pg.wait_for_timeout(300)
        await pg.pdf(
            path=str(SAIDA_PDF), format='A4', print_background=True,
            margin={'top': '20mm', 'bottom': '22mm', 'left': '18mm', 'right': '18mm'},
            display_header_footer=True,
            header_template='<div></div>',
            footer_template=(
                '<div style="font-size:8px;color:#8a94a6;width:100%;'
                'text-align:center;padding-top:4px">'
                'Suinco &middot; Mapa Completo do Sistema &middot; '
                '<span class="pageNumber"></span> / <span class="totalPages"></span>'
                '</div>'
            ),
        )
        await nav.close()

    paginas = None
    try:
        import pypdf
        paginas = len(pypdf.PdfReader(str(SAIDA_PDF)).pages)
    except ImportError:
        pass

    print(f'OK: {SAIDA_PDF}' + (f' ({paginas} páginas)' if paginas else ''))


sys.exit(asyncio.run(main()) or 0)
