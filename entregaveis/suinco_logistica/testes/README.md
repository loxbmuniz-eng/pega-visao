# Testes do painel

Provam que o painel funciona contra o servidor de verdade — Node + PostgreSQL —
e não só na máquina de quem escreveu.

## Como rodar

```bash
# 1. banco e API locais (deixe rodando em outro terminal)
cd backend
node scripts/migrar.js && node scripts/seed.js
node src/servidor.js            # lê backend/.env — porta e banco saem de lá

# 2. bateria do servidor (51 casos, sem navegador)
npm run teste

# 3. gera o arquivo único a partir das fontes
cd .. && python3 build_arquivo_unico.py

# 4. baterias de navegador
python3 testes/test_login_api.py         # painel inteiro contra a API
python3 testes/test_adaptador_api.py     # adaptador: fluxo, fila, permissão
python3 testes/test_diagnostico_login.py # a tela diz QUAL foi o problema
python3 testes/test_teste_conexao.py     # a tela "Testar conexão"
python3 testes/test_auditoria_refino.py  # as telas da mesma carga combinam
python3 testes/test_visao_patio.py       # linha do tempo dentro da aba do setor
python3 testes/test_aviso_alteracao.py   # tempo real: alteração e exclusão
python3 testes/test_relatorios.py        # relatórios impressos
python3 testes/test_mobile.py            # celular e tablet
python3 testes/test_refino.py            # filtros, somatórios, indicadores
python3 testes/test_seguranca.py         # auditoria
```

Cada teste sai com código 0 quando tudo passa.

**Passo 3 não é opcional.** Os testes de navegador abrem `index.html`, que é
gerado — editar `app.js` sem reconstruir faz o teste medir a versão anterior e
passar quando deveria falhar.

## O que cada um cobre

**`backend/testes/api.test.js`** — a API contra um PostgreSQL real: login,
expiração de token, máquina de estados no servidor, trava de frota, bloqueio
otimista por `versao`, exportação do BI e as rotas de operadores.

**`test_login_api.py`** — o painel publicado conversando com a API: login,
setor vindo do token, abas por setor, criação de carga chegando ao banco,
fluxo completo pelos quatro setores e a tela de usuários.

**`test_adaptador_api.py`** — o adaptador isolado: contrato de funções, token
em `sessionStorage`, fila offline que sobe na ordem certa, e quem pode mover
cada etapa (Logística move todas; setor restrito só a sua).

**`test_diagnostico_login.py`** — cinco falhas de login diferentes produzindo
cinco mensagens diferentes, cada uma com seu código: `[SENHA]`, `[LIMITE]`,
`[HTTP500]`, `[REDE]`, `[BLOQUEIO]`. Existe porque "servidor não respondeu"
para tudo tornava o diagnóstico remoto impossível.

**`test_aviso_alteracao.py`** — dois operadores logados ao mesmo tempo, um
deles num celular: a troca de placa numa carga já programada grava no
servidor e vira aviso na tela do outro, com o valor antigo, o novo, quem
alterou e som. Cobre também o que NÃO deve acontecer: quem editou não é
avisado da própria ação, e campo sem importância não toca alarme.

**`test_visao_patio.py`** — a Visão do Pátio dentro da aba de cada setor:
Portaria, Expedição e Faturamento enxergam o pátio sem trocar de aba, a
linha do tempo mostra por onde a carga passou e com que hora, e o filtro de
período alcança carga já encerrada — que é o motivo de ele existir.

**`test_auditoria_refino.py`** — as telas que tratam da mesma carga têm que
combinar: mesmos campos, mesma ordem, mesmas colunas. Existe porque Cliente e
Destino saíram da Programação e continuaram no modal que a Portaria abre
quando o caminhão chega sem carga programada. Confere também que cabeçalho e
linha têm o mesmo número de colunas — tirar um `<th>` e esquecer o `<td>`
desalinha a tabela inteira sem o navegador reclamar.

**`test_teste_conexao.py`** — a tela "Testar conexão" do modal de login,
nos cinco cenários que importam: aparelho sem rede, servidor recusando o
endereço, rede da empresa descartando o OPTIONS, firewall bloqueando o
login inteiro e tudo funcionando. Cada um tem que produzir uma conclusão
diferente, dizendo de quem é o problema.

**`test_relatorios.py`** — os documentos gerados: cabeçalho, nome do arquivo
com data, largura de coluna e número real de linhas de texto por célula.

**`test_mobile.py`** — 390 px e 820 px: tabela virando cartão, alvo de toque
da Portaria, nada de rolagem horizontal.

**`test_refino.py`** — filtros por data, somatórios de rodapé, tempo médio de
pátio, ranking de atraso e gargalos.

**`test_seguranca.py`** — auditoria do que sobrou de superfície exposta.
Ele **relata**, não reprova: os dois achados conhecidos (senha de aba em
texto puro e setor forjado no `localStorage` mudando só a interface) são
barreiras de conveniência, não controle de acesso. O controle real é o
servidor, e é o que as outras baterias cobram.

## Diagnóstico em produção

Para o servidor que está no ar, o equivalente destas baterias é
`backend/diagnostico.sh` — roda no VPS, não altera nada, e imprime um
relatório curto que pode ser fotografado.
