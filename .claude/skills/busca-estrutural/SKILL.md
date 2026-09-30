---
name: busca-estrutural
description: Busca e reescrita pela ESTRUTURA do código (ast-grep), não pelo texto — para achar no app/, data.js, devolucoes.js e no backend a mesma decisão escrita em dois lugares, todo chamador de uma função, todo `Number(x) || null`, todo `upsert()` cujo retorno ninguém olha. Use quando a pergunta depende da forma do código; para texto (comentário, string, nome de arquivo) use o Grep.
---

# Busca estrutural (ast-grep)

Adaptada de `ast-grep` (Hermes Agent, Nous Research; vendorizada de
code-yeongyu/ast-grep-skill — licença MIT). Ver
`ORIGEM_DAS_SKILLS_DE_DESIGN.md`.

## Como rodar aqui

O binário `sg` deste container NÃO é o ast-grep (é um comando do sistema).
Use sempre pelo npx, que não mexe no projeto (conferido em 29/09/2026: ast-grep 0.45.3):

```bash
npx --yes --package @ast-grep/cli ast-grep run --lang js -p 'PADRÃO' entregaveis/suinco_logistica/app/
npx --yes --package @ast-grep/cli ast-grep run --lang js -p 'PADRÃO' --json=compact ARQUIVOS   # para processar
```

Aspas simples SEMPRE no padrão, para o shell não expandir `$VAR`.
Nunca instale como dependência do painel ou do backend: é ferramenta de
trabalho, não de produção.

## Três coisas para não errar

1. **Não é regex.** `$X` casa UM nó (um identificador, uma expressão);
   `$$$` casa zero ou mais. `foo|bar`, `.*`, `\w+`, `[a-z]` não funcionam —
   ou faça duas buscas, ou use o Grep.
2. **O padrão tem de ser código válido** na linguagem (`--lang js`).
3. **Reescrita em massa só com prévia.** `--rewrite` mostra; `-U` aplica.
   Aplicar é mudança de código como outra qualquer: PROMPT, teste que
   reprova, bateria, portão. Nunca aplique em `index.html` (é gerado).

## Buscas que já pagam o uso neste projeto

| Regra da casa | Padrão |
|---|---|
| "null ≠ zero" — `Number(0) \|\| null` já apagou capacidade de veículo | `Number($X) \|\| null` (29/09/2026: zero ocorrências em app/, data.js e devolucoes.js — deve continuar zero) |
| "Recusa nunca é silenciosa" — `upsert()` sem olhar o retorno | `await $API.upsert($$$)` e confira se o resultado é lido |
| "Uma função, dois chamadores" — quem chama uma decisão | `tempoDePatioDe($C)` · `kmValidoLocal($V)` · `numDevCurto($V)` |
| Carimbar a hora da edição no lugar da hora do fato | `new Date().toISOString()` perto de status/entrada |
| Transição de status escrita fora da máquina de estados | `$C.status = $S` |

Cada resultado é uma PISTA, não um defeito: leia o trecho, confira no
`docs/REGISTRO_DE_OCORRENCIAS.md` se a família já apareceu, e só então conclua.

## Quando NÃO usar

Texto em comentário, string, nome de arquivo, CSS: Grep. HTML de
`index_suinco.html`: Grep. Dúvida: "a resposta depende da árvore do código ou
só dos bytes?" — árvore, ast-grep; bytes, Grep.
