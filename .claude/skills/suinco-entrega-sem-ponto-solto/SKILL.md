---
name: suinco-entrega-sem-ponto-solto
description: As regras de entrega do painel Suinco, tiradas de erros que já aconteceram neste projeto. Use ANTES de afirmar que algo está pronto, publicado ou funcionando; antes de mexer em carga, pátio, montagem ou permissão; e antes de qualquer commit, publicação ou mensagem de status ao dono.
---

# Entrega sem ponto solto — Suinco

Cada regra aqui nasceu de um erro real, com data. Não são boas práticas
genéricas: são as coisas que já custaram caro neste painel, que roda ao
vivo em oito setores.

A frase do dono que resume tudo, 27/08/2026:

> "não pode ficar ponto sem nó de forma alguma"
> "não temos oportunidade de errar, somente acertos"
> "nunca mais me entregue nada sem pé nem cabeça"

E a que explica por que este arquivo existe, 26/08/2026:

> "não adianta nada eu confiar em você aqui e você me falar que foi erro
> seu e que você OMITIU algo de mim"

Pedido de desculpas não é controle. Controle é isto aqui.

---

## 1. Os três estados. Nunca dizer "pronto" sem dizer qual

Toda afirmação sobre o estado de qualquer coisa usa um destes três, e o
símbolo vai junto:

| | Significa | Como se prova |
|---|---|---|
| ✅ | **No ar** — a operação está usando | commit está na branch de entrega E, se toca backend, o servidor rodou `atualizar.sh` |
| 🟡 | **Commitado, não publicado** | está na branch de trabalho e o portão ainda não passou |
| ⬜ | **Proposta** — não existe | nenhuma linha escrita |

**O erro que originou a regra (27/08):** o dono perguntou "e código? servidor?"
e a resposta foi "servidor: nada a fazer". Estava errada. O diff daquela
publicação não tocava `backend/`, mas havia TRÊS migrações de 26/08 esperando
no VPS desde a véspera. A conferência estava certa; a conclusão, não — olhou-se
a janela daquela publicação e falou-se do servidor inteiro.

**Antes de afirmar qualquer estado, rodar:**

```bash
git log -1 --format='%h %s' origin/<branch-de-entrega>          # o que o Vercel publica
git log origin/<branch-de-entrega>..<branch-de-trabalho>        # o que falta
git diff --stat origin/<branch-de-entrega>..<branch-de-trabalho> -- backend/
head -1 backend/migrations/APLICADAS_EM_PRODUCAO.txt           # até onde o SERVIDOR está
```

A última linha é a que responde "o servidor está em dia?" — e ela vale para
o servidor INTEIRO, não para a publicação da vez.

## 2. Reproduzir antes de afirmar. Medir antes de descrever

Nunca responder "isso funciona assim" a partir de leitura de código.
Reproduzir e mostrar a saída.

- Bug relatado → script que o reproduz e IMPRIME o estado errado, antes de
  qualquer correção.
- Número (rolagem, contraste, tamanho) → medido no navegador, nunca estimado.
- "Ficou igual ao que você viu" → amostrar os pixels dos dois e comparar.

**O erro (27/08):** a onda da capa foi entregue com as opacidades de UMA
camada quando o que o dono tinha visto era o MESMO desenho empilhado 17
vezes. Ele respondeu "não tô vendo o que eu pedi aí não". A conta certa
(1-0,97^17 = 0,404) só apareceu depois de comparar os dois renders pixel a
pixel. Medir teria evitado a ida e volta.

## 3. Nunca preencher lacuna com suposição

Se o pedido não responde algo que muda o que será construído, **marcar
"A CONFIRMAR"** e seguir com o resto. Não inventar a resposta.

Nunca inventar dado do negócio: código de rota, número de carga, placa,
nome de cliente. Se falta, falta — e fica escrito que falta.

## 4. O portão de publicação manda

```bash
bash entregaveis/suinco_logistica/publicar.sh
```

Ele roda as provas e **só faz o merge se tudo passar**. Se alguma coisa
depender do servidor, ele recusa e imprime o bloco de pendências, que
**tem que ser repassado ao dono na íntegra**.

Ao rodá-lo:

- **Nunca canalizar para `tail`/`head`** — o pipe segura a saída inteira e,
  se o comando for morto, perde-se tudo. Redirecionar para arquivo de log.
- **Nunca pôr limite de tempo curto** — a bateria passa de 15 minutos.
- **Nunca `pkill -f publicar.sh`** — o padrão casa com a própria linha de
  comando e o shell se mata antes de terminar. Usar `pkill -f 'publicar[.]sh'`.

Os três já aconteceram, no mesmo dia.

## 5. O servidor: `su`, não `sudo`

O dono entra como root e **não tem `sudo`** nessa máquina. Comando com
`sudo` falha na hora mais sensível.

```
ssh root@<ip>
cd /opt/suinco-src && git pull && bash entregaveis/suinco_logistica/backend/atualizar.sh
```

`atualizar.sh` faz UM passo (código + migrações). `atualizar_tudo.sh` faz
TRÊS (mais a limpeza de duplicadas e a prova de que o backup restaura).
Dizer qual dos dois, e o que fica de fora se for o primeiro.

## 6. Registro só com prova do terminal dele

`backend/migrations/APLICADAS_EM_PRODUCAO.txt` é registro do que ACONTECEU.
O número só sobe depois que o dono colar o bloco `COPIE DAQUI`. Nunca por
dedução, nunca por "deve ter rodado".

A mesma regra vale para marcar qualquer tarefa como resolvida: prova de
uso real, não prova de que o código existe.

## 7. Teste primeiro. E vermelho tem quatro causas

Bug → escrever o teste que falha, ver falhar, corrigir, ver passar.

Quando um teste fica vermelho, descobrir QUAL das quatro antes de tocar em
código:

1. a regra mudou de propósito → **o teste é que está velho**;
2. o teste mede um atalho que mudou de forma, não a regra;
3. contaminação de outra suíte → rodar sozinha e confirmar;
4. regressão de verdade → só aqui se as três acima caírem.

E: **provar que a falha não é sua** antes de dizer que não é. `git stash`,
rodar, comparar contagem, restaurar.

**Cuidado com verde falso:** ao escrever a asserção, conferir que ela mede a
camada certa. Trilha de auditoria de carga vive em `carga_revisoes`, no
SERVIDOR — afirmar isso medindo `DB.alteracoes` no painel sem servidor dá
verde onde não há prova.

## 8. Padrões da casa — seguir, não reinventar

- **Excluir carga REMOVE da lista local** (`DB.cargas.filter`) e registra em
  `alteracoes`. Só marcar `excluida = true` deixa fantasma na tela até uma
  sincronia passar.
- **Quem manda é o servidor.** O painel adianta o resultado para o operador
  não olhar um estado que ele sabe estar errado — mas a verdade é a do banco.
  Toda correção de dado tem as DUAS metades, ou a sincronia seguinte desfaz.
- **Uma função, dois chamadores.** Se a mesma situação acontece por dois
  caminhos, a lógica é função própria chamada pelos dois. A absorção da
  entrada no pátio existia dentro da troca de placa e por isso o caminho de
  criar carga ficou sem tratamento por semanas.
- **Fidelidade ao momento exato.** Carimbo é quando aconteceu, não quando
  alguém digitou. Vale para chegada, descarga, pesagem, destinação.
- **Pátio não se apaga.** O que sai da operação continua no Histórico,
  dizendo para onde foi.
- **Botão desabilitado não ensina o caminho, só nega.** Se a tela vai
  impedir, ela mostra a saída.

## 9. Armadilhas deste contêiner

- **O PostgreSQL local cai sozinho** (o contêiner recolhe processo ocioso).
  Conferir `pg_lsclusters` e subir com `pg_ctlcluster 16 main start` ANTES de
  medir qualquer coisa. Já causou "teste travado" três vezes num dia.
- **A API local é a porta 3010**, não 3000.
- **`PLAYWRIGHT_CHROMIUM_PATH` não está no `.env`**: os 6 testes de PDF do
  backend falham fora do portão. Não é regressão.
- **Playwright**: `p.chromium.launch(executable_path='/opt/pw-browsers/chromium')`.
  Sem isso, "Executable doesn't exist".

## 10. Antes de mandar a mensagem — a conferência final

Nenhuma entrega sai sem estas seis:

1. `git status --short` vazio e branch empurrada;
2. cada afirmação com ✅ / 🟡 / ⬜, e o servidor conferido à parte;
3. o que foi medido, com o número;
4. o que ficou de fora, dito antes de ele perguntar;
5. o que depende dele, com o comando exato, sem `sudo`;
6. erro meu do dia, se houve, dito por mim primeiro.

O item 6 não é penitência. É que omissão descoberta depois custa mais que
erro contado na hora — e foi exatamente isso que ele cobrou.
