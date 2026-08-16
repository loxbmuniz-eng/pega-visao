# Upgrade em 4 blocos — Programação de Embarque Suinco

Data: 16/08/2026 · Aprovado pelo dono do projeto (opção "Aprovar os 4 blocos")

## Contexto

Sistema em produção viva (Logística, Portaria, Expedição, Faturamento,
Comercial, Administração — Patos de Minas, UTC−3). A semana de 14–15/08
expôs uma família de defeitos de sincronização (terminal com cópia velha
desfazendo dado bom) e custou horas de operação. O dono pediu: auditoria e
upgrade geral usando esses aprendizados, visual de alto nível, e um jeito
de o Administrador desfazer erros. Pedido explícito: a tela de login não
pode mostrar o painel ao fundo.

Nota: a skill "apple-design" citada no pedido não existe neste projeto; o
equivalente disponível e usado é `ui-ux-pro-max` + diretrizes superpowers.

## Decisão de forma: 4 blocos, publicados separadamente

Big bang em produção viva foi descartado — a própria auto-atualização de
14/08 mostrou que uma publicação pode amplificar um defeito latente. Cada
bloco sai testado, com a suíte completa verde.

### Bloco A — Entrada do sistema

Problema: o login é um modal por cima do painel montado; o fundo aparece.
Desenho: tela cheia opaca (`#tela-login`) com identidade Suinco (navy,
logo, versão no rodapé); o painel (`#app`) fica oculto até `DB.operador`
existir; transição de fade na entrada. A lógica de autenticação não muda.
Restrições: IDs e funções usados pelos testes (`#login-email`,
`#login-senha`, `#btn-entrar`, `#login-nome`, `#login-setor`,
`mostrarLoginLocal()`, botão "Entrar sem servidor") são preservados.

### Bloco B — Revisões de carga + Restaurar (Administração)

Problema real da semana: dado sobrescrito sem rastro dos valores antigos —
a restauração das 5 cargas precisou ser feita a partir de um PDF.
Desenho:
- Migration 009: tabela `carga_revisoes` (snapshot JSONB do estado
  ANTERIOR + quem/quando/origem) preenchida por TRIGGER no Postgres em
  todo UPDATE de `fact_viagens`. Trigger, e não código de rota, de
  propósito: captura também SQL manual — que foi vetor de dano em 15/08.
- Rotas: `GET /api/cargas/:id/revisoes` e `POST /api/cargas/:id/restaurar`
  (só Administração; restauração gera evento em `log_eventos` e passa
  pelas travas já existentes — data de programação, aguardando_carga).
- Painel: para Administração, na Torre/Histórico, linha do tempo da carga
  (quem mudou o quê, quando) e botão Restaurar com confirmação.
Alternativa descartada: reconstruir dos logs atuais — não guardam os
valores antigos completos.

### Bloco C — Upgrade visual (refinamento, não redesign)

A identidade navy/dourado permanece: operadores acabaram de estabilizar
hábitos; troca radical em produção gera erro de pátio. Sobe de nível:
hierarquia tipográfica e espaçamento, estados de foco visíveis, alvos de
toque ≥44px, consistência de botões/cards, Indicadores compactos ("cabem
na tela"), gaveta mobile, telas de vazio com orientação, micro-animações
discretas (150–300ms, com `prefers-reduced-motion`). Guia: banco de
diretrizes do ui-ux-pro-max; auditoria de contraste (suíte própria) antes
de publicar.

### Bloco D — Aprendizados viram checagens permanentes

Guard-rails automatizados que reprovam o build se os erros da semana
voltarem: (1) todo campo do pacote de sincronização declarado nos TRÊS
pontos (ida `sincronizarCarga`, volta `daApiParaLinha`, conversão
`cargaDeLinhaRemota`); (2) proibido `toISOString()` para derivar dia
local no front; (3) regressão das três travas do servidor (data gravável
uma vez, observação vazia não apaga, carga não se desprograma); (4) toda
função `atualizar*UI` carimba `atualizadoEm` (já existe, mantida).

## Ordem e verificação

A → B → C → D. Cada bloco: testes novos + suíte completa do painel e do
backend verdes + build único regenerado + publicação nas duas branches.
B exige `atualizar.sh` no VPS (migration 009) — comunicar explicitamente.
