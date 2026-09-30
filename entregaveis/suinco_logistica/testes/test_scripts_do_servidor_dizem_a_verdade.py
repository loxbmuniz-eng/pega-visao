#!/usr/bin/env python3
"""Os scripts que o dono roda no servidor dizem a verdade (30/09/2026).

ACHADOS NO DEBUGGING PREVENTIVO (ocorrência #103), no assistente_servidor.sh
— o script que o dono roda como root no servidor:
  1. conferia a saúde na porta 3010 (a do ambiente de TESTE); a produção
     responde na 3000 (instalar.sh, PORTA_APP). No servidor ele diria
     "HTTP 000" — servidor fora — com o servidor no ar;
  2. o passo 3 ainda se chamava "Limpar as linhas duplicadas da Montagem" e
     dizia "Este passo APAGA linha de programação" — a limpeza saiu em 30/09
     (#95, decisão do dono) e o bloco final ainda dizia "limpeza
     duplicadas: sim";
  3. o bloco COPIE DAQUI dizia "migrações aplicadas" lendo o último ARQUIVO
     da pasta, não o banco. Migração que falhasse sairia como aplicada — e é
     esse bloco que move a marca APLICADAS_EM_PRODUCAO.

O QUE ESTE TESTE TRAVA (estático):
  1. todo script do servidor que confere /health usa a porta do
     instalar.sh (número solto diferente dela reprova);
  2. nenhuma linha EXECUTADA do assistente fala em apagar linha, limpeza
     ou duplicadas;
  3. o assistente informa a última migração lida da tabela _migrations.

    python3 testes/test_scripts_do_servidor_dizem_a_verdade.py
"""
import glob
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(AQUI), 'backend')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def codigo(texto):
    """Só as linhas que o bash executa — comentário pode contar a história."""
    return [l for l in texto.splitlines() if not l.lstrip().startswith('#')]


porta = re.search(r'^PORTA_APP=(\d+)', open(os.path.join(BACKEND, 'instalar.sh'), encoding='utf-8').read(), re.M).group(1)
print(f'\n=== 1. A PORTA DE PRODUÇÃO É A DO instalar.sh ({porta}) ===')
erradas = []
for f in sorted(glob.glob(os.path.join(BACKEND, '*.sh')) + glob.glob(os.path.join(BACKEND, 'scripts', '*.sh'))):
    for n, l in enumerate(codigo(open(f, encoding='utf-8').read()), 1):
        for m in re.finditer(r'127\.0\.0\.1:(\d+)/health', l):
            if m.group(1) != porta:
                erradas.append(f'{os.path.basename(f)}: {m.group(0)}')
ck('nenhum script confere a saúde numa porta que não é a de produção', not erradas, '; '.join(erradas))

assist = open(os.path.join(BACKEND, 'assistente_servidor.sh'), encoding='utf-8').read()
linhas = codigo(assist)
print('\n=== 2. O ASSISTENTE NÃO PROMETE APAGAR NADA ===')
promete = [l.strip() for l in linhas if re.search(r'(?i)apaga linha|duplicadas|limpeza|FEITO_LIMPEZA', l)]
ck('nenhuma linha executada fala em apagar linha, limpeza ou duplicadas', not promete, ' | '.join(promete)[:300])

print('\n=== 3. A MIGRAÇÃO DO BLOCO VEM DO BANCO ===')
ck('o assistente lê a última migração da tabela _migrations', any('_migrations' in l for l in linhas))
ck('e não do último arquivo da pasta', not any(re.search(r'ls +migrations/\*\.sql', l) for l in linhas))

print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
