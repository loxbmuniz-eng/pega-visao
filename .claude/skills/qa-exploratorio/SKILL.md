---
name: qa-exploratorio
description: QA exploratório do painel Suinco — navega como usuário por uma aba ou fluxo, anota cada defeito com print, console e passos para reproduzir, classifica por gravidade e entrega um relatório. Use para achar o que a bateria não testa (ela só cobre o que alguém já pensou), antes de uma publicação grande ou depois de mexer numa tela. Só levanta; a correção segue o fluxo de defeito da casa.
---

# QA exploratório

Adaptada de `dogfood` (Hermes Agent, Nous Research — autor Teknium, licença
MIT). Ver `ORIGEM_DAS_SKILLS_DE_DESIGN.md`.

## Onde roda

- Navegador: Playwright com `executable_path='/opt/pw-browsers/chromium'`.
- Alvo: `entregaveis/suinco_logistica/vitrine/vitrine.html` (gere com
  `python3 build_arquivo_unico.py && python3 vitrine/gerar_vitrine.py`), ou o
  `index.html` com a API local (`pg_ctlcluster 16 main start` e
  `cd backend && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node src/servidor.js`).
  **Nunca a produção**: nada de clicar em "Excluir" num pátio de verdade.
- Evidência: uma pasta no scratchpad (`qa-<aba>-<data>/prints/` + `relatorio.md`).
- Dado de teste é inventado e marcado (cargas 900001+). Nunca invente rota,
  placa ou cliente que pareça real.

## 1. Plano

Escolha o escopo (uma aba, um fluxo — "a carga do Chegou ao Seguiu Viagem",
"o checklist de devolução da filial") e liste o que vai tocar: navegação,
fluxo principal, cada formulário, estados vazios, erro, os dois temas, 1440px
e 390px, e o setor certo (`DB.operador = {setor:'Portaria'}` — cada setor vê
abas diferentes).

## 2. Explorar

Para cada tela: abra, leia o console (`page.on('pageerror')` e
`page.on('console')`), tire print, e mexa em tudo que é clicável:

- entrada válida e inválida; campo vazio; texto enorme; acento e ç;
- clique duplo e rápido (o botão grava duas vezes?);
- teclado: Tab, Enter, Esc;
- recarregar no meio de uma edição (a edição sobrevive à sincronia?);
- servidor fora (a tela diz "offline" ou finge que gravou?).

Depois de cada ação: console de novo, e "o que mudou × o que devia mudar".

## 3. Evidência de cada achado

Aba/URL, passos para reproduzir, esperado × obtido, erro de console, print.
Sem print e sem passos, não é achado.

## 4. Classificar

| Gravidade | Aqui quer dizer |
|---|---|
| **Crítica** | perde dado, trava o pátio, grava errado calado, segurança |
| **Alta** | fluxo principal quebra, mas há contorno; erro de JS em tela principal |
| **Média** | atrapalha e não bloqueia: sobreposição, lento > 3s, recusa sem explicar |
| **Baixa** | acabamento: texto, espaçamento, contraste que ainda passa |

Categoria: Funcional · Visual · Acessibilidade · Console · Uso · Texto.
Junte o que for o mesmo defeito em lugares diferentes.

## 5. Relatório

Resumo (quantos por gravidade, o que foi e o que NÃO foi testado), um bloco
por achado, e a tabela final. Depois:

- **Reconheça a família** em `docs/REGISTRO_DE_OCORRENCIAS.md` antes de
  concluir causa — os defeitos daqui se repetem em famílias.
- Achado vira o fluxo de defeito da casa: reproduzir → causa raiz com
  evidência → teste que reprova → correção → bateria → portão → ocorrência.
  Esta skill só faz o primeiro passo.
- "Parece funcionar" não é resultado: ou tem print/saída, ou não entra.
