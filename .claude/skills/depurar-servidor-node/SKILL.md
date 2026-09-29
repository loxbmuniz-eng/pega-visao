---
name: depurar-servidor-node
description: Depurar o servidor Node do painel Suinco (backend/src) com o inspetor do próprio Node — ponto de parada, passo a passo, variáveis de uma transação no meio do caminho, perfil de CPU e de memória — quando o log não basta. Use quando um teste da API falha e o estado intermediário importa, quando uma regra de setor ou transição recusa sem motivo claro, ou para medir lentidão. Nunca no servidor de produção.
---

# Depurar o servidor Node

Adaptada de `node-inspect-debugger` (Hermes Agent, Nous Research, licença
MIT). Ver `ORIGEM_DAS_SKILLS_DE_DESIGN.md`. As partes do original sobre a
interface do Hermes saíram; ficou o que vale para o nosso backend.

## Onde

Só no ambiente de teste: banco descartável (`pg_ctlcluster 16 main start`) e
a API local. **Nunca** anexe o inspetor ao servidor do VPS — pausa a
operação inteira no ponto de parada.

Primeiro tente o barato: o teste que reproduz + um `console.log` temporário.
O inspetor vale quando isso não chega em um minuto.

## `node inspect` — sem instalar nada

```bash
cd entregaveis/suinco_logistica/backend
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node inspect src/servidor.js
```

| Comando | Faz |
|---|---|
| `c` | continua |
| `n` / `s` / `o` | passa por cima / entra / sai |
| `sb('src/dominio/fluxo.js', 42)` | ponto de parada na linha |
| `sb('validarTransicao')` | para quando a função é chamada (a regra de etapa × setor em `dominio/fluxo.js`) |
| `bt` | pilha de chamadas |
| `repl` | avalia expressões no quadro pausado (Ctrl+C volta) |
| `watch('expr')` | mostra a expressão a cada parada |

A variável do Chromium NÃO é opcional: sem ela o gerador de PDF fica fora e
as rotas de relatório falham sem defeito nenhum (CLAUDE.md).

## Anexar a um servidor que já está rodando (local)

```bash
kill -USR1 <pid-do-node>          # liga o inspetor; imprime ws://127.0.0.1:9229/...
node inspect -p <pid-do-node>
```

## Um teste da API sob o depurador

```bash
cd entregaveis/suinco_logistica/backend
RATE_LIMIT=20000 node --inspect-brk --test testes/api.test.js   # pausa na primeira linha
node inspect 127.0.0.1:9229                       # em outro terminal
```

## Perfil sem interação (lentidão, memória)

```bash
node --cpu-prof --cpu-prof-dir=/tmp/perfil src/servidor.js   # gera .cpuprofile ao sair
node --heapsnapshot-signal=SIGUSR2 src/servidor.js           # kill -USR2 <pid> tira o retrato
```

Guarde os arquivos no scratchpad, nunca no repositório.

## Armadilhas

- Ponto de parada dentro de transação segura a conexão do banco: outra
  requisição pode esperar ou dar timeout — é efeito do depurador, não defeito.
- Número de linha muda se o arquivo mudou desde que o processo subiu.
- `pg` devolve NUMERIC como Number aqui (tipo configurado); não conclua
  "virou string" sem olhar o valor no `repl`.
- Terminou: tire todo `console.log` temporário e rode `npm run teste` inteiro.

## Conferência

- [ ] reproduzido por um teste antes de abrir o depurador
- [ ] causa raiz com evidência (valor visto no quadro pausado)
- [ ] nenhum log temporário ficou no código
- [ ] o teste que trava a correção está em `backend/testes/`
