#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
O extrato "Fretes fora da competência" é um RECORTE do painel completo.
Se um dia ele passar a contar outra coisa que o painel, quem recebe o arquivo
(a contabilidade, a diretoria) vê um número que não existe em lugar nenhum.

Este teste não abre navegador: ele lê os dois arquivos, aplica a regra do
painel sobre os dados do painel, e exige que o extrato publicado bata linha
por linha e centavo por centavo.

Regra do painel (Suinco_Painel_Despesas_Frete.html):
    fora da competência ⇔ mês(data de embarque) ≠ mês(data de movimento)
"""
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAINEL = os.path.join(RAIZ, 'Suinco_Painel_Despesas_Frete.html')
EXTRATO = os.path.join(RAIZ, 'Suinco_Fretes_Fora_da_Competencia.html')
GERADOR = os.path.join(RAIZ, 'build_fora_da_competencia.py')


def _dados(caminho):
    texto = open(caminho, encoding='utf-8').read()
    i = texto.index('const D = ')
    j = texto.index('\n', i)
    return json.loads(texto[i + len('const D = '):j].rstrip().rstrip(';'))


def _fora_do_painel():
    D = _dados(PAINEL)
    L = D['L']
    base = datetime.date(*[int(x) for x in D['meta']['base_iso'].split('-')])
    mes = lambda dias: (base + datetime.timedelta(days=dias)).strftime('%Y-%m')
    return [i for i in range(len(L['v'])) if mes(L['de'][i]) != mes(L['dm'][i])], D


def test_extrato_bate_com_a_regra_do_painel():
    fora, D = _fora_do_painel()
    E = _dados(EXTRATO)

    assert len(E['L']['v']) == len(fora), (
        'o extrato tem %d linha(s) e a regra do painel seleciona %d'
        % (len(E['L']['v']), len(fora)))

    esperado = sum(D['L']['v'][i] for i in fora)
    assert sum(E['L']['v']) == esperado, (
        'soma do extrato R$ %.2f ≠ soma da regra R$ %.2f'
        % (sum(E['L']['v']) / 100, esperado / 100))

    # o recorte tem de carregar o total do painel inteiro, senão o "% do frete
    # total" mostrado no extrato divide por um número que não é o do painel
    assert E['meta']['total_recorte'] == sum(D['L']['v'])
    assert E['meta']['linhas_recorte'] == len(D['L']['v'])

    # linha a linha, na mesma ordem: valor, embarque, movimento e carga.
    # 'tr' entra aqui de propósito: o nome da transportadora é mascarado, mas
    # o ÍNDICE tem de continuar apontando para a mesma empresa do painel.
    for coluna in ('v', 'de', 'dm', 'nc', 'nd', 'tr', 'it', 'rg', 'fi'):
        assert E['L'][coluna] == [D['L'][coluna][i] for i in fora], \
            'coluna %s do extrato divergiu do painel' % coluna


def test_extrato_publicado_e_o_que_o_gerador_produz():
    """Arquivo gerado não se edita à mão — e este teste é quem cobra isso."""
    with tempfile.TemporaryDirectory() as tmp:
        saida = os.path.join(tmp, 'extrato.html')
        r = subprocess.run([sys.executable, GERADOR, PAINEL, saida],
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        gerado = open(saida, encoding='utf-8').read()
    publicado = open(EXTRATO, encoding='utf-8').read()

    # a data de geração no rodapé é a única diferença legítima
    limpa = lambda t: re.sub(r'Gerado em \d{2}/\d{2}/\d{4}', 'Gerado em —', t)
    assert limpa(gerado) == limpa(publicado), (
        'Suinco_Fretes_Fora_da_Competencia.html não corresponde ao que '
        'build_fora_da_competencia.py gera — rode o gerador em vez de editar à mão')


def test_nenhum_cpf_por_extenso_sai_no_arquivo():
    """LGPD — este extrato circula fora da Suinco.

    O cadastro do ERP grava o transportador autônomo com o CPF dentro do nome.
    No painel interno isso passou; num anexo de e-mail, não. O gerador mascara
    por FORMATO, e este teste é quem cobra o resultado — inclusive de um
    cadastro novo que ninguém lembrou de conferir.
    """
    texto = open(EXTRATO, encoding='utf-8').read()
    # o logo é base64: uma sequência de dígitos lá dentro não é CPF de ninguém
    texto = re.sub(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+', '', texto)
    achado = re.search(r'(?<!\d)(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})(?!\d)', texto)
    assert not achado, 'CPF por extenso no extrato que vai para fora: %s' % achado.group(0)


def test_nenhum_lancamento_dentro_da_competencia_vazou():
    E = _dados(EXTRATO)
    L = E['L']
    base = datetime.date(*[int(x) for x in E['meta']['base_iso'].split('-')])
    mes = lambda dias: (base + datetime.timedelta(days=dias)).strftime('%Y-%m')
    dentro = [i for i in range(len(L['v'])) if mes(L['de'][i]) == mes(L['dm'][i])]
    assert not dentro, '%d lançamento(s) dentro da competência vazaram para o extrato' % len(dentro)


# ---------------------------------------------------------------------------
# A bateria roda cada suíte como "python3 arquivo.py" — sem pytest.
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    falhas = []
    for nome, prova in [
        ('o extrato bate com a regra do painel', test_extrato_bate_com_a_regra_do_painel),
        ('o publicado é o que o gerador produz', test_extrato_publicado_e_o_que_o_gerador_produz),
        ('nenhum CPF por extenso sai no arquivo', test_nenhum_cpf_por_extenso_sai_no_arquivo),
        ('nada de dentro da competência vazou', test_nenhum_lancamento_dentro_da_competencia_vazou),
    ]:
        try:
            prova()
            print('  OK   ' + nome)
        except AssertionError as e:
            print('  FALHA ' + nome + ' -> ' + str(e))
            falhas.append(nome)
        except Exception as e:                      # arquivo faltando, JSON quebrado
            print('  ERRO ' + nome + ' -> ' + repr(e))
            falhas.append(nome)

    print('=' * 55)
    if falhas:
        print('  %d FALHA(S): %s' % (len(falhas), ', '.join(falhas)))
        sys.exit(1)
    print('  Tudo verde.')
