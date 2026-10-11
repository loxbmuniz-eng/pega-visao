# As skills do Embarque Suinco — quando usar cada uma

Curadoria de 11/10/2026, pedido do dono: *"faz uma curadoria profunda ai nas
skills que temos"*. Eram 94; ficaram as 46 abaixo, que servem a ESTE painel
(arquivo único, sem framework, um servidor Node + PostgreSQL na Hostinger,
painel na Vercel). As outras 48 estão em `.claude/skills-arquivadas/`, com o
motivo de cada uma — nada foi apagado.

**Regra para entrar uma skill nova aqui:** ela resolve um problema que este
painel tem hoje, e nenhuma das de baixo já resolve. Skill que só existe "para
um dia" vai para o arquivo — cada uma que fica é lida em toda conversa.

## O dia a dia do painel (escritas para a Suinco)

| Skill | Quando |
|---|---|
| `suinco-entrega-sem-ponto-solto` | antes de dizer que algo está pronto, publicado ou funcionando |
| `suinco-yard-flow` | mexer em etapa, transição, permissão por setor ou no SLA de 3 h |
| `busca-estrutural` | achar a mesma decisão em dois lugares, `Number(x) \|\| null`, recusa do servidor que ninguém olha |
| `qa-exploratorio` | navegar como usuário antes de uma publicação grande |
| `usuario-hostil` | achar atrito que teste nenhum pega (porteiro com pressa, de luva) |
| `depurar-api` | "a tela mostra mas não grava", código HTTP estranho, integração |
| `depurar-servidor-node` | teste da API falha e é preciso ver a transação no meio do caminho |
| `consulta-periodica` | vigia que consulta outro sistema de tempos em tempos |
| `questionario-de-decisao` | decisão travada esperando a ATAK, a TI, a filial |
| `especificar-painel` | aba ou relatório de indicadores novo, ANTES de construir |
| `ocorrencia-de-frete` | atraso, avaria, falta, sobra, recusa no cliente |
| `transportadoras` | nota de desempenho, concentrar ou espalhar carga |
| `suinco-edi-gs1` | romaneio, aviso de embarque, GS1 (o agente integrador do Atak usa) |
| `suinco-sanitary-traceability` | lote, SIF, temperatura (a `ocorrencia-de-frete` usa) |

## Números e dado (antes de mostrar qualquer número)

| Skill | Quando |
|---|---|
| `checklist-antes-do-numero` | SEMPRE antes de mostrar número ao Luis, à diretoria ou a um setor |
| `conciliar-indicador` | o mesmo número aparece diferente em dois lugares |
| `causa-de-variacao` | "por que esse indicador mudou?" |
| `tendencia-e-previsao` | série no tempo: tendência, dia da semana, mês |
| `auditoria-do-dado` | campo vazio, duplicado, placa sem Frota, antes de importar relatório novo |
| `analise-multiespecialista` | planilha que pede vários olhares (frete, pátio, qualidade, comercial) |

## Engenharia — limpar, revisar, não quebrar

| Skill | Quando |
|---|---|
| `systematic-debugging` | todo defeito, antes de propor correção |
| `test-driven-development` | o teste que reprova vem antes da correção |
| `verification-before-completion` | nenhuma afirmação de "pronto" sem a saída na mão |
| `code-review-and-quality` | revisar mudança antes do portão |
| `receiving-code-review` | quando chega revisão de fora (GitHub): rigor, não concordância |
| `codebase-design` | onde fica a costura de um módulo, arquivo grande demais |
| `improve-codebase-architecture` | varrer o código atrás de módulos para aprofundar (usa a `grilling`) |
| `grilling` | pressionar uma decisão de arquitetura até ela se sustentar |
| `deprecation-and-migration` | tirar código ou caminho antigo sem quebrar quem usa |
| `api-and-interface-design` | rota nova, contrato entre painel e servidor |
| `schema` | migração, índice, restrição, chave estrangeira |
| `weave` | máquina de estados (é a base da `suinco-yard-flow`) |
| `antislop-code` + `antislop` | limpar comentários de código sem tocar no código (a `antislop-code` exige o núcleo) |

## Segurança, backup e operação do servidor

| Skill | Quando |
|---|---|
| `security-and-hardening` | entrada de usuário, login, integração externa |
| `testing-for-broken-access-control` | conferir que cada setor só faz o que pode |
| `testing-jwt-token-security` | token de login, renovação, revogação |
| `validating-backup-integrity-for-recovery` | provar que o backup restaura; backup fora do servidor |
| `observability-and-instrumentation` | Sentry, vigias, saber o que acontece em produção |
| `lgpd` | dado pessoal (motorista, cliente) — a lei brasileira |
| `wizard` | roteiro passo a passo que só o dono pode fazer (ex.: migração do servidor) |

## Tela

| Skill | Quando |
|---|---|
| `impeccable` | criticar, auditar, polir uma tela (os 4 agentes `impeccable-*` dependem dela; `DESIGN.md` e `PRODUCT.md` vieram dela) |
| `mobile-native` | o painel no celular parecer instalado: toque, zoom no campo, barra do aparelho |
| `ui-ux-pro-max` | relatório ou painel HTML novo (o agente `suinco-entregavel-html` e a `especificar-painel` usam) |

## Escrita e manutenção

| Skill | Quando |
|---|---|
| `humanizer` | mensagem ao Luis ou texto de tela que soa robótico |
| `skill-creator` | criar ou ajustar uma skill desta lista |
