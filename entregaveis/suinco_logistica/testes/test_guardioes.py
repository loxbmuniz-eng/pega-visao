#!/usr/bin/env python3
"""Guardiões: os erros da semana de 14–15/08 não podem voltar.

Cada checagem aqui nasceu de um incidente REAL de produção. Este teste não
olha comportamento — olha o CÓDIGO, para reprovar o build no instante em
que alguém reintroduzir o padrão de erro, antes de chegar ao pátio.

  1. TODO campo do pacote de sincronização precisa existir nos TRÊS pontos
     (ida, tradução da volta, conversão em carga do painel). Faltar em um
     deles fez a observação sumir em silêncio: quem digitou via o valor
     (localStorage) e todos os outros viam vazio.
  2. NENHUM `toISOString().slice(0,10)` para derivar dia local no painel.
     Às 23h32 de Patos de Minas o UTC já é amanhã: o botão "Hoje" preenchia
     15/08 e o dia inteiro de trabalho sumia do relatório.
  3. As TRÊS travas do servidor continuam no lugar: data de programação
     gravável uma vez, observação vazia não apaga, carga lançada não volta
     a "Aguardando Carga". Cada uma barrou um eco de sincronização que
     desfazia dado bom (62 t sumiram entre duas emissões).
  4. Toda função `atualizar*UI` carimba `atualizadoEm` — sem carimbo a
     mudança nunca sobe ("alterei a sequência três vezes e não se mantém").

    python3 testes/test_guardioes.py
"""
import re
import sys

BASE = '/home/user/pega-visao/entregaveis/suinco_logistica'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def ler(caminho):
    return open(f'{BASE}/{caminho}', encoding='utf-8').read()


def bloco(texto, inicio, fim='};'):
    i = texto.index(inicio)
    return texto[i:texto.index(fim, i)]


def main():
    data = ler('data.js')
    api = ler('suinco-api.js')
    app = ler('app.js')
    rotas = ler('backend/src/rotas/cargas.js')

    print('\n=== 1. CAMPO DE CARGA EXISTE NOS TRÊS PONTOS DE SINCRONIZAÇÃO ===')
    # Ponto A (ida): o pacote montado em sincronizarCarga (chaves Estilo_SharePoint).
    ida = bloco(data, "SuincoSharePoint.upsert('cargas', 'Carga_ID', {", '}, operador)')
    campos_ida = set(re.findall(r'^\s*([A-Z][A-Za-z_]+):', ida, re.MULTILINE))
    # Ponto B (volta): daApiParaLinha no adaptador.
    volta = bloco(api, 'function daApiParaLinha(c) {', '  }')
    campos_volta = set(re.findall(r'^\s*([A-Z][A-Za-z_]+):', volta, re.MULTILINE))
    # Ponto C (conversão): cargaDeLinhaRemota lê r.<Campo>.
    conv = bloco(data, 'function cargaDeLinhaRemota(r){', '\n}')
    campos_conv = set(re.findall(r'\br\.([A-Z][A-Za-z_]+)', conv))

    # Campos administrativos que legitimamente não fazem ida-e-volta completa.
    ISENTOS = {'Title', 'Rota_Nome', 'Rota_Operador', 'Excluida', 'Timestamp_Sincronia'}
    so_ida = (campos_ida - campos_volta) - ISENTOS
    so_volta = (campos_volta - campos_conv) - ISENTOS
    ck('todo campo enviado também é traduzido na volta', not so_ida,
       f'faltam na volta: {sorted(so_ida)}')
    ck('todo campo da volta também vira carga do painel', not so_volta,
       f'faltam na conversão: {sorted(so_volta)}')
    ck('a varredura enxergou os campos de verdade (não regrediu para vazio)',
       len(campos_ida) >= 15 and len(campos_conv) >= 15,
       f'ida={len(campos_ida)} conv={len(campos_conv)}')

    print('\n=== 2. NENHUM DIA LOCAL DERIVADO DE toISOString NO PAINEL ===')
    suspeitos = []
    for nome, texto in [('app.js', app), ('data.js', data)]:
        for m in re.finditer(r'toISOString\(\)\.slice\(0,\s*10\)', texto):
            linha = texto[:m.start()].count('\n') + 1
            # Comentários explicando a regra não contam.
            linha_txt = texto.splitlines()[linha - 1].lstrip()
            if not linha_txt.startswith(('//', '*', '/*')):
                suspeitos.append(f'{nome}:{linha}')
    ck('zero usos de toISOString para dia local', not suspeitos, ', '.join(suspeitos))

    print('\n=== 3. AS TRÊS TRAVAS DO SERVIDOR ESTÃO NO LUGAR ===')
    ck('data de programação: COALESCE (gravável uma vez)',
       'programado_em = COALESCE(programado_em' in rotas)
    ck('observação: vazio não apaga (COALESCE + NULLIF)',
       "observacoes = COALESCE(NULLIF($" in rotas)
    ck('aguardando_carga: sentido único (AND)',
       'aguardando_carga = (aguardando_carga AND' in rotas)

    print('\n=== 4. TODA FUNÇÃO DE EDIÇÃO CARIMBA A CARGA ===')
    sem_carimbo = []
    for m in re.finditer(r'^function (atualizar\w*UI)\(', app, re.MULTILINE):
        fim = app.find('\n}', m.end())
        if 'atualizadoEm' not in app[m.end():fim]:
            sem_carimbo.append(m.group(1))
    ck('nenhuma função atualizar*UI sem carimbo', not sem_carimbo,
       ', '.join(sem_carimbo))

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(main())
