# Testes de operação compartilhada

Provam que o painel é multiusuário de verdade, sem depender de um tenant real.

## Como rodar

```bash
# 1. sobe o Graph de simulação (deixe rodando em outro terminal)
python3 ferramentas/mock_graph_server.py 8899

# 2. gera o arquivo único a partir das fontes
python3 build_arquivo_unico.py

# 3. roda as simulações
python3 testes/test_multiusuario.py    # 2 usuários: Logística e Portaria
python3 testes/test_4setores.py        # turno completo, 4 setores, 6 status
```

Cada teste sai com código 0 quando tudo passa.

## O que cada um cobre

**`test_multiusuario.py`** — dois navegadores independentes (contextos
separados, sem compartilhar localStorage nem sessão, como duas máquinas):
carga criada pela Logística aparece na Portaria; mudança da Portaria volta para
a Logística; `fact_Viagens` mantém uma linha por carga; auditoria com os dois
operadores; alteração local pendente não é sobrescrita pela sincronia; e a fila
sobe ao reconectar.

**`test_4setores.py`** — quatro navegadores percorrendo o fluxo inteiro dos 6
status. Verifica que cada setor enxerga o trabalho do anterior **sem recarregar
a página**, mede o tempo de propagação, e confere a consistência final das
quatro Listas.

## Por que existe um Graph de simulação

`ferramentas/mock_graph_server.py` implementa o subconjunto do Microsoft Graph
que o painel usa, com armazenamento em memória compartilhado entre os clientes.
Sem ele, provar a operação multiusuário exigiria um tenant real da Suinco.

O painel entra nesse modo apenas com `SP_CONFIG.modoSimulacao = true` **e**
`graphBaseUrl` apontando para localhost — as duas condições juntas. Apontando
para o Graph real, o modo é ignorado e a autenticação normal acontece: não há
como desligar o SSO em produção mexendo nessa chave.
