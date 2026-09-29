---
name: depurar-api
description: Roteiro em camadas para depurar API REST — conexão, tempo, TLS, autenticação, formato do pedido, leitura da resposta, sentido do dado — e o que cada código HTTP costuma querer dizer. Use ao integrar ou investigar a API do painel (/api, /bi), a do Delivery B2B ou a do ERP Atak; quando "funciona no Postman e não no código"; quando o servidor recusa e ninguém sabe por quê.
---

# Depurar API

Adaptada de `rest-graphql-debug` (Hermes Agent, Nous Research — autor
eren-karakus0, licença MIT). Ver `ORIGEM_DAS_SKILLS_DE_DESIGN.md`.

## Princípio: isole a camada, depois corrija

Um 200 pode esconder dado errado; um 500 pode ser uma letra na senha. Ande na
ordem, sem pular:

```
1. Conexão       → chego no host?
1.5 Tempo        → demora para conectar ou para responder?
2. TLS           → certificado válido e confiável?
3. Autenticação  → credencial certa e dentro da validade?
4. Pedido        → o formato bate com o que o servidor espera?
5. Resposta      → o código aceita o que voltou?
6. Sentido       → o dado significa o que eu acho que significa?
```

## Neste ambiente

- **Saída para a internet passa por um proxy.** `api.embarquesuinco.com.br`,
  `atak.com.br` e `ia.atak.com.br` estão BLOQUEADOS daqui. Não conclua "a API
  está fora" por um bloqueio de proxy: `curl -sS "$HTTPS_PROXY/__agentproxy/status"`
  e o erro `EGRESS_BLOCKED` dizem se é o proxy. A API do painel se testa
  LOCAL (`127.0.0.1:3010`, banco descartável).
- **Nunca** ponha token, senha ou chave em comando que vá para log, arquivo
  do repositório ou mensagem. Use variável de ambiente lida do `.env` do
  servidor, e não imprima o valor.

## Comandos de partida

```bash
curl -v --connect-timeout 5 http://127.0.0.1:3010/health             # 1 e 1.5
curl -sS -w '\nHTTP %{http_code} · %{time_total}s\n' URL              # código e tempo
curl -sS -H "Authorization: Bearer $TOKEN" URL | python3 -m json.tool  # 3 e 5
```

## O que o código HTTP costuma dizer

| Código | Leitura provável | Primeira conferência |
|---|---|---|
| 400 | pedido mal formado | corpo, `Content-Type`, campo obrigatório |
| 401 | sem credencial ou vencida | cabeçalho chegou? token expirou? |
| 403 | autenticado, sem permissão | no painel: o SETOR (`dominio/fluxo.js`, `exigirSetor`) |
| 404 | rota errada — ou servidor VELHO | a rota existe no commit que está no VPS? (`atualizar.sh` rodou?) |
| 409 | conflito de estado | no painel: transição de etapa inválida, versão desatualizada |
| 422 | JSON certo, dado inválido | a mensagem de erro diz o campo |
| 429 | limite de requisições | espere a janela; não repita em laço |
| 5xx | lado do servidor | log do servidor (`/tmp/suinco-api-teste.log` no teste) |

"A tela mostra mas não grava" no painel quase sempre é **servidor velho**
(404/409 de rota ou regra que ainda não subiu) — ver o raio-X e o
`backend/COMMIT_EM_PRODUCAO.txt` antes de caçar defeito no código.

## Paginação e idempotência

- Paginação: siga o cursor até o fim; confira o total; nunca suponha uma página.
- Escrita repetível: chave de negócio no destino. Reenviar não pode duplicar.

## Recusa nunca é silenciosa

`upsert()` do painel devolve `{recusado:true}` em vez de lançar — quem chama
tem de olhar o valor. Na integração com terceiros vale o mesmo: toda resposta
≠ 2xx fica registrada com hora, pedido (sem segredo) e resposta.

## Relato de um achado

Achado (camada e código) · Reprodução (comando exato, sem segredo) · Causa
com evidência · Correção · Teste que trava (em `backend/testes/` para a API
do painel).
