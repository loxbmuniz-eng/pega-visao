# De onde vieram as skills de design e animação

Trazidas a pedido do dono em 16/09/2026.

## emilkowalski/skills — MIT, © 2026 Emil Kowalski

https://github.com/emilkowalski/skills · o autor é o do animations.dev
(o "transitions.dev" que o dono citou), Sonner e Vaul.

**Sete entraram**, as que valem para um painel de arquivo único, sem
framework, usado no computador e no celular:

| skill | para quê |
|---|---|
| `emil-design-eng` | a filosofia — a primeira pergunta é "isto deveria animar?" |
| `review-animations` | a régua: aprovação se ganha, não se presume |
| `animation-vocabulary` | do "aquele efeito saltitante" para o nome exato |
| `apple-design` | movimento físico e gesto, traduzido para a web |
| `mobile-native` | fazer a web parecer instalada no celular — **a mais útil aqui**, metade da operação é celular no pátio |
| `find-animation-opportunities` | acha onde falta movimento, e recusa onde não cabe |
| `improve-animations` | auditoria e plano, para outro agente executar |

**Seis ficaram de fora, e o motivo:** `animate`, `animate-expo`,
`prototype`, `ask-sonner` e `pick-ui-library` são de React / React Native /
npm — o painel não tem nada disso. `write-swift` é Swift.

**E o DialKit NÃO entrou.** O dono pediu, e a resposta honesta é que ele é
um pacote npm de React (`<DialRoot>`, `useDialKit`). Não há onde encaixar
num arquivo HTML único sem build. Instalar seria pôr instrução para uma
ferramenta que não roda aqui.

## OneRedOak/claude-code-workflows — MIT, © 2025 Patrick Ellis

https://github.com/OneRedOak/claude-code-workflows/tree/main/design-review

O agente `design-review` foi **adaptado**, não copiado: o original depende
de um servidor Playwright que esta sessão não tem, e traz princípios de
design genéricos. Virou `.claude/agents/suinco-revisao-de-design.md`, com o
nosso Playwright, a identidade navy/dourado, os dois temas, e as regras que
já custaram caro aqui.

## anthropics/skills — Apache 2.0, © Anthropic

https://github.com/anthropics/skills/tree/main/skills/frontend-design

Trazida a pedido do dono em 26/09/2026 ("as melhores skills de UI
disponíveis e trending do github"). **Uma entrou: `frontend-design`**, a
skill de direção visual da própria Anthropic — a de maior peso entre as de
UI no GitHub, e a única do grupo que faltava aqui.

Lida inteira antes de entrar: é só orientação de design, sem comando, sem
chamada externa, sem dependência. Copiada sem alteração, com a licença ao
lado (`frontend-design/LICENSE.txt`).

Ela CONFRONTA as outras em um ponto, e isso é bom: lista os vícios de
página gerada por IA — rótulo em CAIXA ALTA espaçada sobre cada título,
metadado ligado por ponto médio ("A · B · C"), fonte mono para rotulinho,
tudo picado em cartão arredondado igual com a mesma sombra. Quem desenhar
tela nova aqui passa por essa lista antes de escrever CSS.
