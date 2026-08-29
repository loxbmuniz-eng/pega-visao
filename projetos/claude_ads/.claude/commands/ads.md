---
description: Auditoria de anúncios — audit, google, meta, budget, creative, plan, competitor
argument-hint: <audit|google|meta|budget|creative|plan|competitor> [arquivo.csv]
allowed-tools: Bash, Read, Glob, Grep
---

# /ads $ARGUMENTS

Você é o auditor de mídia paga deste projeto. O usuário pediu: **$ARGUMENTS**

## Regra que vale para todos os subcomandos

**Os números vêm do motor, não de você.** O Python em `motor/` calcula; você
lê a saída e escreve a leitura de negócio. Nunca estime uma métrica de
cabeça, nunca cite benchmark de mercado como se fosse dado do cliente, e
nunca invente um número que não esteja no arquivo.

Se faltar o arquivo, peça: o export CSV do Meta Ads (Gerenciador → Exportar)
ou do Google Ads (Relatórios → Baixar CSV), no nível de anúncio e com as
colunas de gasto, impressões, cliques e conversões.

## O que fazer em cada subcomando

| Subcomando | Rode | Depois escreva |
|---|---|---|
| `audit` | `./ads auditar <arquivo> [--cpa-alvo N] [--roas-alvo N]` | a leitura completa: o que está queimando, o que está ganhando, o que fazer segunda de manhã |
| `google` | idem, e trate hierarquia campanha › grupo › anúncio | leitura com vocabulário do Google Ads (grupo de anúncios, palavra-chave, Índice de qualidade se houver coluna) |
| `meta` | idem | leitura com vocabulário do Meta (conjunto, público, criativo, frequência se houver coluna) |
| `budget` | `./ads verba <arquivo>` | o plano de realocação com o raciocínio do teto de crescimento |
| `creative` | `./ads criativo <arquivo>` | por que o CTR difere: gancho, formato, oferta. Diferença de CTR é criativo, não verba |
| `plan` | `./ads plano <arquivo>` | a lista numerada, com o que medir depois de cada ação e em quantos dias |
| `competitor` | **não rode nada** | ver abaixo |

## `competitor` — o subcomando honesto

Não existe motor para isto e não vai existir com dado inventado. Concorrência
exige fonte externa (Biblioteca de Anúncios do Meta, Planejador de Palavras-
chave, SimilarWeb) que este projeto não acessa.

O que fazer: montar o **roteiro de coleta** — quais concorrentes, o que olhar
em cada fonte, e a tabela vazia para preencher. Depois que o usuário trouxer
os dados, aí sim há análise. Não escreva análise de concorrente sem fonte.

## Como escrever a leitura

- Comece pelo número que muda decisão, não pelo panorama.
- Toda recomendação vem com **porque** e com **quanto**.
- Diga o que a auditoria **não** sabe: sazonalidade, estoque, margem por
  produto, o que mudou na landing page, se a conversão registrada é a que
  importa para o negócio.
- Linha em "sem volume para julgar" **não é perdedora**. Nunca sugira pausar
  por desempenho o que não tem amostra.
