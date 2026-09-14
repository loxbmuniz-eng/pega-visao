#!/usr/bin/env python3
"""A lista de rotas do painel e a do servidor têm que ser a MESMA.

   Por que este teste existe (14/09/2026):

   A rota mora em dois lugares — `data.js` (constante ROTAS, o que a tela
   mostra quando está sem servidor) e `backend/scripts/seed.js` (o que o
   instalar.sh grava em `dim_rotas`). Não dá para as duas serem uma função
   só: uma é concatenada no navegador, a outra é módulo Node.

   Só que o servidor GANHA: no load(), `data.js` reaplica por cima da
   constante tudo que veio de `GET /cadastros/rotas` (data.js ~1393). Então
   divergência entre os dois arquivos não aparece como erro — aparece como
   o painel mostrando um operador e o relatório imprimindo outro depois da
   primeira sincronia. Silencioso, e do jeito mais caro de descobrir.

   E foi assim que a 171 (Buenos Aires) ficou de fora do `seed.js`: o painel
   oferece a rota no seletor, o servidor não a tem em `dim_rotas`, e
   `cargas.rota_codigo` é chave estrangeira — programar carga na 171 volta
   como recusa de cadastro inexistente (23503 → 422).

   Este teste não julga o CONTEÚDO da lista. Ele só exige que os dois
   arquivos digam exatamente a mesma coisa. Mudou um, muda o outro."""
import re, sys, pathlib

AQUI   = pathlib.Path(__file__).resolve().parent.parent
DATA   = AQUI / 'data.js'
SEED   = AQUI / 'backend' / 'scripts' / 'seed.js'

falhas = []
def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok: falhas.append(nome)

def bloco(texto, abre, fecha):
    """Recorta o literal da lista, do primeiro delimitador até o fechamento."""
    i = texto.index(abre)
    j = texto.index(fecha, i)
    return texto[i:j]

def rotas_do_painel():
    txt = DATA.read_text(encoding='utf-8')
    corpo = bloco(txt, 'const ROTAS = [', '\n];')
    saida = {}
    for linha in corpo.splitlines():
        m = re.search(r"codigo:'([^']*)'", linha)
        if not m: continue
        def campo(nome):
            mm = re.search(nome + r":'((?:[^'\\]|\\.)*)'", linha)
            return mm.group(1) if mm else ''
        saida[m.group(1)] = (campo('nome'), campo('detalhe'), campo('operador'))
    return saida

def rotas_do_servidor():
    txt = SEED.read_text(encoding='utf-8')
    corpo = bloco(txt, 'const ROTAS = [', '\n];')
    saida = {}
    for linha in corpo.splitlines():
        m = re.match(r"\s*\['((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\]",
                     linha)
        if not m: continue
        saida[m.group(1)] = (m.group(2), m.group(3), m.group(4))
    return saida

def main():
    painel   = rotas_do_painel()
    servidor = rotas_do_servidor()

    print('\n=== AS DUAS LISTAS FORAM LIDAS ===')
    ck('data.js tem rotas',            len(painel)   > 0, f'{len(painel)} rotas')
    ck('seed.js tem rotas',            len(servidor) > 0, f'{len(servidor)} rotas')
    if not painel or not servidor:
        return 1

    print('\n=== TODA ROTA DO PAINEL EXISTE NO SERVIDOR ===')
    # Esta é a que pega o caso da 171: rota oferecida no seletor mas ausente
    # de dim_rotas vira recusa de chave estrangeira na hora de programar.
    faltando = sorted(set(painel) - set(servidor))
    ck('nenhuma rota do painel falta no dim_rotas', not faltando,
       'faltam: ' + ', '.join(faltando) if faltando else 'todas cadastradas')

    print('\n=== E TODA ROTA DO SERVIDOR EXISTE NO PAINEL ===')
    sobrando = sorted(set(servidor) - set(painel))
    ck('nenhuma rota do servidor falta no painel', not sobrando,
       'sobram: ' + ', '.join(sobrando) if sobrando else 'nenhuma sobrando')

    print('\n=== NOME, DETALHE E OPERADOR IDÊNTICOS ===')
    divergentes = []
    for codigo in sorted(set(painel) & set(servidor)):
        if painel[codigo] != servidor[codigo]:
            divergentes.append(
                f"{codigo}: painel={painel[codigo]!r} servidor={servidor[codigo]!r}")
    ck('nenhum campo diverge', not divergentes,
       ' | '.join(divergentes) if divergentes else f'{len(set(painel) & set(servidor))} rotas conferidas')

    print('\n' + ('TODOS OS TESTES PASSARAM' if not falhas
                  else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas)))
    return 1 if falhas else 0

sys.exit(main())
