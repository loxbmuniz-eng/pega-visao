---
name: questionario-de-decisao
description: Transforma uma decisão travada — que depende do que OUTRA pessoa sabe (a ATAK, a TI, o gestor, a Expedição, a filial) — num questionário curto, pronto para mandar ou preencher numa reunião. Use quando uma demanda fica parada "esperando alguém responder", ou antes de um chamado ou reunião em que respostas específicas precisam voltar.
---

# Questionário de decisão

Adaptada de `decision-questionnaire` (Hermes Agent, Nous Research), que por
sua vez vem de `to-questionnaire` de mattpocock/skills — as duas com licença
MIT. Ver `ORIGEM_DAS_SKILLS_DE_DESIGN.md`.

## Quando usar

- Uma decisão depende de fato ou juízo que está com outra pessoa.
- O Luis diz "vou ver com fulano" e a demanda para.
- Antes de um chamado (ATAK, TI) ou de uma reunião em que precisa voltar
  com respostas.

Não use quando a resposta está no código, no banco, na documentação ou na
web: ache você mesmo primeiro.

## Pergunte ao Luis só sobre o ENVIO

Ele não sabe responder o assunto (é por isso que existe o questionário), mas
sempre sabe responder sobre o envio. Duas perguntas curtas, nada mais:

1. **Para quem vai?** Cargo, o que essa pessoa sabe que ele não sabe.
2. **O que precisa voltar?** As decisões ou fatos concretos que destravam.

## Monte o questionário

Mais importante primeiro (quem responde sem pressa responde só o começo).
Uma ideia por pergunta. Agrupe por tema quando passar de cinco.

```markdown
# <título>

**Para que serve:** a decisão que depende destas respostas.
**De:** Luis (Logística Suinco) · **Para:** <pessoa/setor/empresa>
**Como as respostas serão usadas:** <onde entram>

## Contexto
Um parágrafo para quem não está dentro do assunto. Sem histórico inteiro.

## Como responder
Prazo e esforço. "Não sei" e resposta parcial ajudam — marque a dúvida em
vez de pular.

## <Tema>
### <Uma pergunta, uma ideia só>
_Por que importa: <uma linha, só onde a pergunta pode ser mal lida>._
>

## Mais alguma coisa?
O que não perguntamos e deveríamos saber?
```

## Regras da casa por cima

- Português de operação, sem sigla sem explicar.
- **Nunca** peça senha, token ou credencial num questionário (senha do
  Delivery B2B, do ERP): credencial vai da TI direto para o servidor.
- Nenhum dado de cliente ou representante real (LGPD) no texto.
- Não invente número, prazo ou custo "de exemplo" — deixe o campo para a
  resposta.
- Entregue como arquivo no scratchpad (ou documento, se o Luis pedir) e diga
  o caminho. Estado: ⬜ até alguém responder.

## Conferência

- [ ] destinatário e o que precisa voltar definidos antes de escrever
- [ ] cada item "o que precisa voltar" tem pelo menos uma pergunta
- [ ] uma ideia por pergunta, mais importante primeiro, espaço de resposta
