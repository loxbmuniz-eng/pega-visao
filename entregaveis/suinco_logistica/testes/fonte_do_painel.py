"""O código do painel para os testes que o leem como texto (30/09/2026).

O antigo app.js virou a pasta app/, um arquivo por assunto. Quem precisa do
código inteiro — guardas que procuram um padrão em todas as funções — lê a
junção, na mesma ordem do build: é o mesmo texto que o app.js tinha.
Uma função, todos os chamadores: se a pasta mudar de novo, muda aqui.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent


def texto_do_app(base=None):
    raiz = Path(base) if base else BASE
    return ''.join(a.read_text(encoding='utf-8') for a in sorted((raiz / 'app').glob('*.js')))


def arquivos_do_app(base=None):
    raiz = Path(base) if base else BASE
    return sorted((raiz / 'app').glob('*.js'))
