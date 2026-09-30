#!/usr/bin/env python3
"""O atualizar_tudo.sh não oferece mais apagar linha da Montagem (30/09/2026).

O QUE ACONTECEU: o passo 2 do atualizar_tudo.sh listou 47 linhas "duplicadas"
da Montagem do Dia e perguntou "Apagar? (digite SIM)". O critério era "mesma
rota e mesmo destino no mesmo dia" — e o modelo da semana do dono tem, DE
PROPÓSITO, duas cargas iguais em vários dias (quarta: duas Patos de Minas e
duas São Gotardo; 18 pares na semana). As duas linhas de 30/09 que ele
queria apagar eram a SEGUNDA carga de Patos de Minas e a segunda de São
Gotardo daquele dia. Nada foi apagado: o dono não confirmou.

A DECISÃO DO DONO: "não é minha intenção apagar destino nenhum".

O QUE ESTE TESTE TRAVA (estático, não abre servidor nem banco):
  1. o atualizar_tudo.sh não chama o limpar_montagem_duplicada.sql, não
     passa `apagar=1` a nada e não pergunta "digite SIM";
  2. o limpar_montagem_duplicada.sql, se alguém o rodar à mão, para na
     primeira linha e não apaga nada;
  3. o passo da prova de restauração do backup continua lá.

    python3 testes/test_atualizar_tudo_nao_apaga_montagem.py
"""
import pathlib
import sys

BASE = pathlib.Path(__file__).parent.parent / 'backend'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def codigo(texto):
    """Só as linhas que o bash executa — comentário pode citar o passo antigo."""
    return '\n'.join(l for l in texto.splitlines() if not l.lstrip().startswith('#'))


tudo = codigo((BASE / 'atualizar_tudo.sh').read_text(encoding='utf-8'))
print('\n=== 1. O ATUALIZAR_TUDO NÃO APAGA LINHA DA MONTAGEM ===')
ck('não chama o limpar_montagem_duplicada.sql', 'limpar_montagem_duplicada' not in tudo)
ck('não passa apagar=1 a nada', 'apagar=1' not in tudo)
ck('não pergunta "digite SIM"', 'SIM' not in tudo)

print('\n=== 2. O SQL, RODADO À MÃO, PARA ANTES DE QUALQUER COISA ===')
sql = (BASE / 'scripts' / 'limpar_montagem_duplicada.sql').read_text(encoding='utf-8')
primeiro_comando = next((l.strip() for l in sql.splitlines()
                         if l.strip() and not l.strip().startswith('--')), '')
ck('o primeiro comando do arquivo é um aviso seguido de \\quit',
   primeiro_comando.startswith('\\echo') and '\\quit' in sql.split('DELETE')[0], primeiro_comando[:80])

print('\n=== 3. A PROVA DE RESTAURAÇÃO CONTINUA ===')
ck('o atualizar_tudo.sh ainda roda o testar_restauracao_backup.sh', 'testar_restauracao_backup.sh' in tudo)

print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
