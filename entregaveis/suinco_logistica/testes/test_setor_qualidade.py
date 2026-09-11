#!/usr/bin/env python3
"""A QUALIDADE acompanha o checklist e exporta — e não escreve (09/09/2026).

PEDIDO DO DONO: "voce criou um setor no sistema para a QUALIDADE ter acesso
aos checklists? ela vai poder exportar relatorios tambem todos".

E, respondendo às três perguntas do PROMPT:
  1. "qualidade so acompanha e exporta relatorio"
  2. "tambem ve a devolucao das filiais, todos os relatorios que competem
      ao checklist"

O QUE ESTE TESTE TRAVA
  1. o setor existe nos DOIS lados, e as duas listas batem — a de SETORES
     já esteve escrita em SEIS lugares e recusou o cadastro de filial três
     vezes com o dono na frente (02/09/2026);
  2. ela vê Devoluções, Histórico e Relatórios — e NADA de pátio;
  3. na aba Relatórios aparece SÓ o de Devoluções: Operacional, Executivo
     e Power BI são de pátio, e o de Fretes carrega valor de frete, que é
     de Logística e Administração;
  4. ela NÃO escreve nada — nem cria checklist, nem avança etapa;
  5. ela NÃO é filial, que é o que faz ela enxergar a devolução das três;
  6. o banco aceita o setor (migração 048).

    python3 testes/test_setor_qualidade.py
"""
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def no_no(codigo):
    """Roda um trecho contra o domínio do servidor e devolve a saída."""
    r = subprocess.run(['node', '--input-type=module', '-e', codigo],
                       cwd=str(RAIZ), capture_output=True, text=True, timeout=60)
    return (r.stdout + r.stderr).strip()


print('\n=== 1. O SETOR EXISTE NOS DOIS LADOS, E AS LISTAS BATEM ===')
saida = no_no("""
import('./backend/src/dominio/fluxo.js').then(m => {
  console.log(JSON.stringify({
    setores: m.SETORES,
    soAcompanha: m.soAcompanha('Qualidade'),
    ehFilial: m.ehFilial('Qualidade'),
    campos: m.camposEditaveisPor('Qualidade'),
    veFrete: m.podeVerValorDeFrete('Qualidade'),
  }));
});""")
import json
dados = json.loads(saida.splitlines()[-1])
ck('o servidor conhece o setor Qualidade', 'Qualidade' in dados['setores'], str(dados['setores']))

data_js = (RAIZ / 'data.js').read_text(encoding='utf-8')
bloco = re.search(r'const SETOR_PERMISSOES = \{(.*?)\n\};', data_js, re.S)
ck('o painel tem SETOR_PERMISSOES', bool(bloco))
# DUAS FORMAS, e as duas contam. Os setores nascem dentro do literal, mas as
# três filiais são atribuídas DEPOIS dele (`SETOR_PERMISSOES['Filial 105 BSB']
# = [...]`), e `const SETORES = Object.keys(SETOR_PERMISSOES)` só é calculado
# no fim. Ler só o literal acusaria as filiais como ausentes — mediria um
# atalho que tem outra forma, que é a causa nº 2 das quatro do vermelho.
do_painel = set(re.findall(r"^\s*'([^']+)':\s*\[", bloco.group(1), re.M)) if bloco else set()
do_painel |= set(re.findall(r"^\s*'([^']+)':\s*ABAS", bloco.group(1), re.M)) if bloco else set()
do_painel |= set(re.findall(r"SETOR_PERMISSOES\['([^']+)'\]\s*=", data_js))
ck('o painel conhece o setor Qualidade', 'Qualidade' in do_painel, str(sorted(do_painel)))
faltando = set(dados['setores']) - do_painel
ck('nenhum setor do servidor falta no painel (a lista das SEIS cópias)',
   not faltando, f"faltam no painel: {sorted(faltando)}")

print('\n=== 2. O QUE ELA VÊ: CHECKLIST, HISTÓRICO E RELATÓRIOS ===')
abas = re.search(r"'Qualidade':\s*\[([^\]]+)\]", data_js)
ck('a Qualidade tem abas definidas', bool(abas))
lista = set(re.findall(r"'([^']+)'", abas.group(1))) if abas else set()
ck('vê Devoluções', 'devolucoes' in lista, str(sorted(lista)))
ck('vê Histórico', 'historico' in lista, str(sorted(lista)))
ck('vê Relatórios — é o ponto do pedido', 'relatorios' in lista, str(sorted(lista)))
patio = {'programacao', 'portaria', 'expedicao', 'faturamento', 'torre', 'cadastros', 'usuarios', 'indicadores'}
ck('e NADA de pátio nem de cadastro', not (lista & patio), str(sorted(lista & patio)))

print('\n=== 3. NA ABA RELATÓRIOS, SÓ O DO CHECKLIST ===')
html = (RAIZ / 'index_suinco.html').read_text(encoding='utf-8')
ck('o relatório de Devoluções está marcado como do checklist',
   'data-relatorio="checklist"' in html)
ck('o de Fretes está marcado como de frete (não é do checklist)',
   'data-relatorio="frete"' in html)
n_patio = html.count('data-relatorio="patio"')
ck('Operacional, Executivo, Power BI e o filtro de período são de pátio',
   n_patio == 4, f'{n_patio} marcados')
app = (RAIZ / 'app.js').read_text(encoding='utf-8')
fn = re.search(r'function renderEscopoDosRelatorios\(\)\{(.*?)\n\}', app, re.S)
ck('existe a função que esconde o que não é dela', bool(fn))
ck('e ela é chamada ao abrir a aba', "renderEscopoDosRelatorios();" in app)
if fn:
    ck('quem só acompanha fica com os cards de checklist',
       "!== 'checklist'" in fn.group(1), fn.group(1)[:160])

print('\n=== 4. ELA NÃO ESCREVE NADA ===')
ck('nenhum campo de carga é editável por ela', dados['campos'] == [], str(dados['campos']))
ck('e ela não vê valor de frete (o de Fretes não compete ao checklist)',
   dados['veFrete'] is False, str(dados['veFrete']))
ck('o servidor sabe que ela só acompanha', dados['soAcompanha'] is True, str(dados['soAcompanha']))

dev = (RAIZ / 'backend/src/rotas/devolucoes.js').read_text(encoding='utf-8')
guardas = dev.count('soAcompanha(req.operador.setor)')
ck('as rotas de escrita da devolução recusam explicitamente (criar, cabeçalho, etapa, item)',
   guardas >= 4, f"{guardas} guardas")
ck('e a recusa EXPLICA, em vez de dar 403 seco',
   'RECUSA_SO_ACOMPANHA' in dev and 'acompanha o checklist' in
   (RAIZ / 'backend/src/dominio/fluxo.js').read_text(encoding='utf-8'))

fluxo = (RAIZ / 'backend/src/dominio/fluxo.js').read_text(encoding='utf-8')
cria = re.search(r'export function podeCriarDevolucao', (RAIZ / 'backend/src/dominio/devolucoes.js').read_text(encoding='utf-8'))
ck('podeCriarDevolucao não menciona Qualidade',
   'Qualidade' not in (RAIZ / 'backend/src/dominio/devolucoes.js').read_text(encoding='utf-8'))

print('\n=== 5. ELA VÊ A DEVOLUÇÃO DAS FILIAIS ===')
# Isto sai de graça por ela NÃO ser filial: o filtro por criada_setor é
# aplicado só a quem ehFilial() aprova. Se alguém a colocasse em
# SETORES_FILIAL "para organizar", ela passaria a ver só o que criou —
# e ela não cria nada, então veria uma tela vazia.
ck('Qualidade NÃO está em SETORES_FILIAL', dados['ehFilial'] is False, str(dados['ehFilial']))
ck('o filtro de filial continua sendo por ehFilial (só filial é filtrada)',
   'if (ehFilial(op.setor)) {' in dev)

print('\n=== 6. O BANCO ACEITA O SETOR (migração 048) ===')
r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-qtA', '-d', 'embarque_suinco', '-c',
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='operadores_setor_check'"],
                   capture_output=True, text=True, timeout=30)
ck('a CHECK de setor aceita Qualidade', "'Qualidade'" in r.stdout, r.stdout.strip()[:200])
do_banco = set(re.findall(r"'([^']+)'::text", r.stdout))
ck('a CHECK do banco tem os MESMOS setores do servidor',
   do_banco == set(dados['setores']),
   f"só no banco: {sorted(do_banco - set(dados['setores']))} · só no servidor: {sorted(set(dados['setores']) - do_banco)}")

print('\n=== 7. O ÚNICO BOTÃO QUE ELA VÊ TEM QUE FUNCIONAR NO SERVIDOR ===')
print('    (achado da revisão de 11/09: a aba mostrava o card do checklist e o')
print('     servidor respondia 403 — a tabela de donos não tinha a Qualidade)')
saida7 = no_no("""
import('./backend/src/dominio/documentos.js').then(m => {
  console.log(JSON.stringify({
    dia: m.podeGerar('Qualidade', 'devolucoes-do-dia'),
    operador: m.podeGerar('Qualidade', 'devolucao-operador'),
    fretes: m.podeGerar('Qualidade', 'administracao-fretes'),
    operacional: m.podeGerar('Qualidade', 'relatorio-operacional'),
    manobrista: m.podeGerar('Qualidade', 'programacao-manobrista'),
  }));
});""")
d7 = json.loads(saida7.splitlines()[-1])
ck('gera o relatório de Devoluções do dia', d7['dia'] is True, str(d7))
ck('gera o de Devolução por operador', d7['operador'] is True, str(d7))
ck('e NÃO gera os de pátio nem o de frete',
   not d7['fretes'] and not d7['operacional'] and not d7['manobrista'], str(d7))

print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
