#!/usr/bin/env python3
"""27.284 não pode virar 27. O separador de milhar apagando o dado na mão.

RELATO DO DONO (17/09/2026): "Não estou conseguindo inserir o valor completo,
27.284; está aparecendo apenas 27, com duas casas decimais. Preciso colocar o
valor que quiser."

A CAUSA, medida no Chromium antes de qualquer correção:

    digitado "27.284"  ->  value "27.284"  ->  Number 27.284  ->  parseInt 27
    digitado "27,284"  ->  value ""        ->  o campo ESVAZIA
    digitado "1.250"   ->  value "1.250"   ->  Number 1.25    ->  1

`<input type="number">` fala inglês: o PONTO é separador decimal e a VÍRGULA
é caractere inválido — e caractere inválido num campo numérico faz o
navegador devolver string vazia em `.value`, sem avisar ninguém. Quem digita
peso em quilo no Brasil escreve 27.284 querendo vinte e sete mil. O painel
guardava 27. Não é campo que recusa: é campo que ACEITA e guarda outra coisa.

É a família do `Number(0) || null` que já apagou capacidade de veículo aqui:
uma conversão silenciosa que troca o dado por um parente dele.

A CORREÇÃO: os campos de contagem viram `type="text" inputmode="numeric"` (o
teclado do celular continua numérico) e passam por `quantidadeDigitada()`,
que lê os dígitos e ignora qualquer separador. Os dois campos que são de
DINHEIRO ou de fração — tarifa de frete e kg de produto na devolução — usam
`valorDigitado()`, que entende vírgula como decimal, do jeito que se escreve
aqui.

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_numero_digitado_com_ponto.py
    # contra o que está no ar (tem de REPROVAR):
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_numero_digitado_com_ponto.py --painel /tmp/publicado.html
"""
import argparse
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """() => {
  DB.cargas = []; DB.movimentacoes = [];
  DB.cargas.push({id:'n1', numeroCarga:'8001', placa:'ABC1D23', rota:'500',
    peso:null, qtdEntregas:1, sequencia:1, status:'Aguardando Veículo',
    criadoEm:new Date().toISOString(), programadoEm:new Date().toISOString()});
  renderAll();
  return DB.cargas.length;
}"""


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--painel', default=str(BASE / 'index.html'))
    args = ap.parse_args()
    painel = pathlib.Path(args.painel)
    print(f'\n  medindo: {painel}')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(f'file://{painel}')
        await pg.wait_for_function('typeof renderAll === "function"', timeout=25000)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)
        await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(300)

        print('\n=== 1. NENHUM CAMPO DE CONTAGEM AINDA É type="number" ===')
        # A conversao silenciosa e' do PROPRIO navegador: enquanto o campo for
        # type=number, nao ha' funcao de leitura que conserte — o `.value` ja'
        # chega vazio ou truncado.
        quantos = await pg.evaluate("""() => {
          const marcados = [];
          document.querySelectorAll('input[type="number"]').forEach(i => {
            marcados.push(i.id || i.className || '(sem nome)');
          });
          return marcados;
        }""")
        ck('zero inputs type="number" na tela', not quantos,
           '' if not quantos else f'ainda são type=number: {quantos[:8]}')

        print('\n=== 2. O NÚMERO DO RELATO: 27.284 KG ===')
        async def peso(digitado):
            """Digita e devolve o que ficou guardado. Um erro de JavaScript aqui
            é uma REPROVAÇÃO, não um estouro: teste que quebra no meio esconde
            os checks seguintes e não diz o que está errado."""
            try:
                return await pg.evaluate(
                    "(v) => { atualizarPesoUI('n1', v);"
                    " return (DB.cargas.find(c => c.id === 'n1') || {}).peso; }", digitado)
            except Exception as e:
                return f'ERRO: {str(e).splitlines()[0][:80]}'

        r = await peso('27.284')
        ck('27.284 digitado vira 27284 no dado', r == 27284, f'guardou {r!r}')

        r2 = await peso('27,284')
        ck('27,284 com vírgula também vira 27284', r2 == 27284, f'guardou {r2!r}')

        r3 = await peso('1.250')
        ck('1.250 vira 1250, e não 1', r3 == 1250, f'guardou {r3!r}')

        print('\n=== 3. O CAMPO VAZIO CONTINUA SENDO "NÃO INFORMADO", NÃO ZERO ===')
        # null != zero e' regra da casa: `Number(0) || null` ja' apagou
        # capacidade de veiculo neste projeto.
        r4 = await peso('')
        ck('campo apagado guarda null, não 0', r4 is None, f'guardou {r4!r}')

        print('\n=== 4. A SEQUÊNCIA LÊ PELO MESMO CAMINHO ===')
        # O campo de sequencia usa o mesmo leitor: sem isso, "12" digitado num
        # teclado que insere separador viraria outra coisa na fila.
        try:
            r5 = await pg.evaluate("""() => {
              const c = DB.cargas.find(x => x.id === 'n1');
              c.status = 'Seguiu Viagem';           // registro: guarda o numero digitado
              atualizarSequenciaUI('n1', '12');
              return c.sequencia;
            }""")
        except Exception as e:
            r5 = f'ERRO: {str(e).splitlines()[0][:80]}'
        ck('12 digitado na sequência é 12', r5 == 12, f'guardou {r5!r}')

        print('\n=== 5. DINHEIRO E FRAÇÃO ENTENDEM VÍRGULA COMO DECIMAL ===')
        # Sao os dois unicos campos que NAO sao contagem: tarifa de frete
        # (R$/km) e kg de produto na devolucao.
        # Contra um painel que ainda não tem `valorDigitado`, isto lança — e
        # lançar é REPROVAR, não estourar o arquivo e esconder o resto.
        try:
            v = await pg.evaluate("""() => [
              valorDigitado('7,75'), valorDigitado('7.75'),
              valorDigitado('1.234,56'), valorDigitado('')
            ]""")
        except Exception as e:
            ck('valorDigitado() existe no painel medido', False,
               str(e).splitlines()[-1][:100] if str(e) else 'não existe')
            v = ['(ausente)'] * 4
        ck('7,75 vira 7.75', v[0] == 7.75, f'{v[0]!r}')
        ck('7.75 também vira 7.75', v[1] == 7.75, f'{v[1]!r}')
        ck('1.234,56 vira 1234.56', v[2] == 1234.56, f'{v[2]!r}')
        ck('vazio vira null, não zero', v[3] is None, f'{v[3]!r}')

        print('\n=== 6. NENHUM ERRO DE JAVASCRIPT ===')
        ck('sem erro no console', not erros, str(erros)[:200])

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()) or 0)
