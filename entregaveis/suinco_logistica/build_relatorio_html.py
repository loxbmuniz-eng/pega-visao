#!/usr/bin/env python3
"""
Converte `docs/RELATORIO_TI_HOSPEDAGEM.md` em `RELATORIO_TI_HOSPEDAGEM.html`:
um arquivo único, autocontido, pronto para enviar ao TI ou imprimir em PDF
(Ctrl+P → Salvar como PDF).

Ao contrário do painel, este documento usa fundo claro — é feito para leitura
corporativa e impressão, não para o chão de fábrica.

Uso:  python3 build_relatorio_html.py
"""

import pathlib
import sys

try:
    import markdown
except ImportError:
    sys.exit('ERRO: falta a biblioteca markdown. Rode: pip install markdown')

BASE = pathlib.Path(__file__).parent
ORIGEM = BASE / 'docs' / 'RELATORIO_TI_HOSPEDAGEM.md'
SAIDA = BASE / 'RELATORIO_TI_HOSPEDAGEM.html'

CSS = """
:root { --tinta:#1a1d23; --suave:#5b6472; --linha:#dfe3e9; --destaque:#8b1520;
        --fundo-caixa:#f6f7f9; --aviso:#fff8e6; --aviso-borda:#e8c56a; }
* { box-sizing:border-box; }
body { margin:0; padding:0; background:#eef0f3; color:var(--tinta);
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
       font-size:15px; line-height:1.65; }
.folha { max-width:900px; margin:32px auto; background:#fff; padding:56px 64px;
         box-shadow:0 1px 4px rgba(0,0,0,.12); }
h1 { font-size:26px; line-height:1.25; margin:0 0 4px; color:var(--destaque);
     font-weight:700; letter-spacing:-.01em; }
h2 { font-size:19px; margin:38px 0 12px; padding-bottom:7px;
     border-bottom:2px solid var(--linha); font-weight:700; }
h3 { font-size:16px; margin:26px 0 8px; font-weight:700; color:#2b3038; }
h1 + h2 { margin-top:8px; border:0; font-size:17px; color:var(--suave);
          font-weight:600; padding:0; }
p { margin:10px 0; }
strong { font-weight:650; }
code { background:var(--fundo-caixa); padding:1px 5px; border-radius:3px;
       font-family:"SF Mono",Consolas,Monaco,monospace; font-size:.88em;
       border:1px solid var(--linha); }
pre { background:var(--fundo-caixa); border:1px solid var(--linha);
      border-left:3px solid var(--destaque); padding:14px 16px; border-radius:4px;
      overflow-x:auto; font-size:13px; line-height:1.5; }
pre code { background:none; border:0; padding:0; }
table { border-collapse:collapse; width:100%; margin:16px 0; font-size:13.5px; }
th { background:var(--fundo-caixa); text-align:left; font-weight:650;
     border-bottom:2px solid var(--linha); }
th, td { padding:8px 11px; border-bottom:1px solid var(--linha);
         vertical-align:top; }
tr:last-child td { border-bottom:0; }
blockquote { margin:16px 0; padding:12px 18px; background:var(--aviso);
             border-left:4px solid var(--aviso-borda); border-radius:0 4px 4px 0; }
blockquote p { margin:4px 0; }
hr { border:0; border-top:1px solid var(--linha); margin:32px 0; }
ul, ol { padding-left:24px; margin:10px 0; }
li { margin:5px 0; }
a { color:var(--destaque); }
.rodape { max-width:900px; margin:0 auto 40px; padding:0 64px; font-size:12px;
          color:var(--suave); }
@media print {
  body { background:#fff; font-size:11pt; }
  .folha { box-shadow:none; margin:0; padding:0; max-width:100%; }
  .rodape { padding:0; }
  h2 { page-break-after:avoid; }
  table, pre, blockquote { page-break-inside:avoid; }
}
@media (max-width:720px) {
  .folha { padding:28px 20px; margin:0; }
  .rodape { padding:0 20px; }
  table { font-size:12px; }
}
"""


def main():
    if not ORIGEM.exists():
        sys.exit(f'ERRO: não encontrei {ORIGEM}')

    corpo = markdown.markdown(
        ORIGEM.read_text(encoding='utf-8'),
        extensions=['tables', 'fenced_code', 'sane_lists'],
    )

    html = (
        '<!doctype html>\n<html lang="pt-BR">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<title>Relatório Técnico — Hospedagem do Painel Logístico Suinco</title>\n'
        f'<style>{CSS}</style>\n'
        '</head>\n<body>\n'
        f'<div class="folha">\n{corpo}\n</div>\n'
        '<div class="rodape">Documento gerado a partir de '
        'docs/RELATORIO_TI_HOSPEDAGEM.md — para imprimir em PDF use Ctrl+P → '
        'Salvar como PDF.</div>\n'
        '</body>\n</html>\n'
    )

    SAIDA.write_text(html, encoding='utf-8')
    print(f'OK: {SAIDA.name} gerado ({len(html) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
