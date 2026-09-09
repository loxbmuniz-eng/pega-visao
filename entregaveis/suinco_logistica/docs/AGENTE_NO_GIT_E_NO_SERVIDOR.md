# O Claude dentro do Git e dentro do servidor

Roadmap da automação de vigilância e revisão do painel Suinco.
Escrito em 29/08/2026, a pedido do Luis.

---

## Antes de tudo: o que isto é, e o que NÃO é

**Não existe um Claude "morando" no repositório vendo tudo o tempo todo.**
Isso seria caro, frágil, e nem é como a ferramenta funciona. O que existe é:

> **gatilho → o Claude acorda → ele olha → ele relata → ele dorme.**

Cada acordada é uma sessão nova, do zero. **Ele não lembra das conversas do
chat.** Quem trouxer um problema aqui no chat está falando com uma sessão; o
que roda no PR é outra.

**Então o que é que eles têm em comum?** Os arquivos do repositório. Toda
sessão, em qualquer lugar, lê:

| Arquivo | O que ele carrega |
|---|---|
| `CLAUDE.md` (raiz) | as regras da casa, o fluxo, o que nunca fazer, como falar com o Luis |
| `docs/REGISTRO_DE_OCORRENCIAS.md` | todo defeito já visto, a causa real e o teste que o trava |
| `.claude/agents/` | os nove agentes com as funções do fluxo |
| `.claude/skills/` | os procedimentos (fluxo do pátio, rastreabilidade, entrega sem ponto solto) |

**É por isso que escrever a ocorrência importa.** Não é burocracia: é a
única memória que atravessa as sessões. Um defeito que não virou linha no
registro é um defeito que o próximo Claude vai reinvestigar do zero.

---

## Onda 1 — Git (pronta neste commit, falta o que só o Luis pode fazer)

### O que já está escrito no repositório

| Arquivo | O que faz | Quando dispara |
|---|---|---|
| `.github/workflows/testes.yml` | bateria da API + `npm audit` | todo push e todo PR |
| `.github/workflows/claude.yml` | responde a `@claude` | comentário em issue ou PR |
| `.github/workflows/claude-revisao.yml` | revisa o diff e comenta na linha | PR aberto ou atualizado |
| `CLAUDE.md` | a memória compartilhada | lido em toda sessão |

### Os dois passos que só você pode dar

1. **Instalar o app do Claude no repositório** — <https://github.com/apps/claude>,
   escolhendo `loxbmuniz-eng/pega-visao`. Ele pede permissão de Conteúdo,
   Issues e Pull requests: é o que permite ler o código, comentar e empurrar
   commit.
2. **Guardar a chave como secret** — em *Settings → Secrets and variables →
   Actions → New repository secret*, com o nome exato **`ANTHROPIC_API_KEY`**,
   e a chave gerada em <https://platform.claude.com>.

> **Eu não posso fazer esses dois.** Não tenho acesso às configurações do
> repositório, e **não me mande a chave por aqui** — chave que passa por
> conversa é chave queimada. Ela vai direto do console para o secret.

Depois disso, teste escrevendo num comentário de qualquer issue:
`@claude o que esse arquivo faz?`

### Custo, e como ele fica sob controle

Cada acordada gasta minutos de GitHub Actions e tokens da chave. Três freios
já estão nos arquivos:

- `--max-turns 25` — pedido mal formulado não vira trinta rodadas;
- `timeout-minutes` — trabalho que passa do teto para sozinho;
- `concurrency` na revisão — PR atualizado três vezes seguidas é revisado
  uma vez, não três.

---

## Onda 2 — Servidor (proposta, ainda não executada)

**Um agente SÓ DE LEITURA no VPS**, acordado por horário, que olha o que
aconteceu e conta. Sem escrever no banco. Sem mexer em carga.

O que ele olharia, e por que cada coisa:

| Sinal | Por que importa |
|---|---|
| carga parada há mais que o SLA | é o caminhão ocupando pátio agora |
| etapa que voltou e voltou a andar | é exatamente o caso do FTZ2138 |
| erro repetindo no log da API | defeito que ninguém relatou ainda |
| sincronia falhando num terminal | terminal cego, que é como se perde dado |
| programação do dia não fechada | o dia que termina sem baixa |

Entrega pelo mesmo caminho que já está na fila (n8n + Evolution API,
tarefas #84–86): mensagem no WhatsApp, de X em X horas, e alerta na hora
quando algo quebra.

**Por que só leitura no começo:** um agente com poder de escrever no banco de
produção é risco sem contrapartida enquanto ele não tiver provado que acerta.
Ele observa, relata, você decide. Depois a gente amplia — e a ampliação é
uma decisão sua, com prompt e aprovação, como tudo aqui.

---

## Onda 3 — Depois que as duas primeiras estiverem de pé

- **A bateria de tela no CI**, de madrugada. Hoje as ~124 suítes de
  navegador só rodam no portão (`publicar.sh`), porque levam ~30 minutos.
  De madrugada isso não incomoda ninguém e pega o que apodreceu no dia.
  *A bateria de sábado já mostrou por que isso vale: uma guarda vermelha
  por causa do dia da semana, que ninguém veria até tentar publicar.*
- **O registro de ocorrências alimentado pelo próprio agente**: quando ele
  achar um defeito novo, abrir a issue já no formato do registro.
- **Revisão com os agentes da casa**: hoje a revisão do PR usa o revisor
  genérico. Ela pode chamar `suinco-fidelidade-do-dado` e
  `suinco-paridade-mobile`, que sabem o que este projeto já errou.

---

## O que continua sendo humano

O agente **comenta, não aprova**. Ele não publica, não decide o que vai para
a operação, e não fecha uma ocorrência. O portão (`publicar.sh`) continua
sendo bateria completa verde + decisão de gente.

Automação que decide sozinha o que vai para o pátio é como se troca um
problema conhecido por um problema que ninguém está olhando.
