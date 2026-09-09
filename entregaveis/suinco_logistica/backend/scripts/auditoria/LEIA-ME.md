# Auditorias que se repetem

Três auditorias escritas em 08/09/2026, aplicando as skills
`testing-for-broken-access-control`, `weave` e `testing-jwt-token-security`
ao painel. Elas existem para serem RODADAS DE NOVO — auditoria que só
aconteceu uma vez é foto, não controle.

## Como rodar

    pg_ctlcluster 16 main start
    cd backend && npm run migrar
    PORT=3010 node src/servidor.js &          # as duas primeiras precisam da API
    node scripts/auditoria/controle_de_acesso.mjs
    node scripts/auditoria/maquinas_de_estado.mjs   # esta não precisa da API
    node scripts/auditoria/token_de_login.mjs

## O que cada uma prova

**`controle_de_acesso.mjs`** — 27 testes com token real dos 11 setores:
escalação vertical (ninguém além da Administração mexe em operador), rotas
protegidas sem token e com token inválido, isolamento entre as três filiais
(IDOR direto, vazamento na listagem, escrita cruzada), troca de setor por
cabeçalho, auto-promoção por mass assignment, e os tokens de leitura (BI e
robô) tentando escrever.

**`maquinas_de_estado.mjs`** — não lê a tabela de transições: EXERCITA todos
os pares (de, para, setor) contra a função que o servidor usa, e roda as
cinco verificações da skill weave — alcançabilidade, ausência de deadlock,
determinismo, completude e coerência de guarda. Cobre as três máquinas:
cargas, devolução normal e sobra.

**`token_de_login.mjs`** — forja tokens de propósito: alg:none, assinatura
com outro segredo, payload adulterado com assinatura velha, token expirado,
algoritmo trocado, e token de operador bloqueado depois do bloqueio.

## Rodar quando

- Antes de publicar mudança de permissão, de setor ou de fluxo
- Depois de acrescentar rota nova na API
- Antes da migração para o servidor corporativo
- Quando entrar filial nova

Todas limpam o que criam. Rodam contra o banco LOCAL descartável — nunca
apontar para produção.
