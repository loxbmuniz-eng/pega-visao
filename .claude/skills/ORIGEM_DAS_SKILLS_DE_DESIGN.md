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

## NousResearch/hermes-agent — MIT, © 2025 Nous Research

https://github.com/NousResearch/hermes-agent · trazidas a pedido do dono em
29/09/2026 ("processar meu projeto no hermes e utilizar tudo que for
benéfico"). Garimpadas do repositório OFICIAL (210 skills; lidas as
descrições das ~110 de software, web, servidor, segurança, produtividade e
design). As coleções da comunidade (900+ skills de autores desconhecidos)
NÃO foram usadas: skill é instrução que o agente segue, e instrução de fonte
desconhecida não entra num sistema em produção. Texto da licença:
`LICENCA_HERMES_AGENT.txt`.

**Sete entraram, ADAPTADAS** (português, ferramentas deste ambiente, regras
do CLAUDE.md), não copiadas:

| skill da casa | original (autor) | para quê |
|---|---|---|
| `usuario-hostil` | `adversarial-ux-test` (Omni @ Comelse) | o porteiro de luva e com pressa acha o atrito que teste nenhum pega |
| `qa-exploratorio` | `dogfood` (Teknium) | QA de usuário com print e passos — acha o que a bateria não sabe testar |
| `consulta-periodica` | `watchers` (Hermes Agent) | o desenho do vigia com marca d'água, para uma fonte que precise de consulta periódica (a ATAK ficou fora: §26 das decisões) |
| `depurar-api` | `rest-graphql-debug` (eren-karakus0) | depuração de API em camadas; a leitura dos códigos HTTP no painel |
| `questionario-de-decisao` | `decision-questionnaire` (← `to-questionnaire`, mattpocock/skills, MIT) | decisão travada em alguém de fora vira questionário para mandar |
| `busca-estrutural` | `ast-grep` (← code-yeongyu/ast-grep-skill, MIT) | busca pela forma do código: regra "uma função, dois chamadores" |
| `depurar-servidor-node` | `node-inspect-debugger` (Hermes Agent) | inspetor do Node no backend, só no ambiente de teste |

**Recusadas de propósito:** `godmode` (desbloquear IA contra as próprias
regras); `sherlock` e `unbroker` (caçam dado pessoal — LGPD);
`pinggy-tunnel`, `cloudflare-temporary-deploy`, `here-now`, `publish-site`
(expõem o servidor ou publicam fora do portão); `1password` (credencial);
`page-agent` (IA dentro do painel); `har-derived-api-client` (tirar a API
gravando o tráfego do site da ATAK — contrato); `web-pentest` (só com
autorização formal). As que já tínhamos equivalente (TDD, depuração
sistemática, revisão de código, subagentes, grilling, wizard, simplify,
cartographer, docx/xlsx/pdf/pptx) não foram duplicadas.

## Curadoria de logística e análise de dados (07/10/2026)

Pedido do dono: "varra o github também com skills de logística e data
analytics" — "aplique as 10". Cada arquivo foi LIDO inteiro antes (texto
puro, sem script, sem instrução escondida) e a licença conferida (MIT nos
três repositórios). Como na leva do Hermes, entraram ADAPTADAS — português,
regras do CLAUDE.md, dado e vocabulário da Suinco — não copiadas; o que era
americano (FMCSA, DAT, valores em dólar) saiu, e os limiares viraram ponto
de partida a calibrar com dado medido.

| skill da casa | original (autor, licença) | para quê |
|---|---|---|
| `transportadoras` | `carrier-relationship-management` (affaan-m/ECC, MIT, (c) 2026 Affaan Mustafa) | nota de desempenho, renegociar, trocar, documentação (RNTRC, seguro, CT-e/MDF-e) |
| `ocorrencia-de-frete` | `logistics-exception-management` (affaan-m/ECC, MIT, (c) 2026 Affaan Mustafa) | atraso, avaria, temperatura, falta, recusa — prova, gravidade, absorver ou cobrar |
| `conciliar-indicador` | `metric-reconciliation` (nimrodfisher/data-analytics-skills, MIT, (c) 2026 Nimrod Fisher) | o mesmo número diferente em dois lugares |
| `causa-de-variacao` | `root-cause-investigation` (idem) | por que o indicador da operação mudou |
| `auditoria-do-dado` | `data-quality-audit` (idem) | vazio, duplicado, órfão, fora da faixa, velho |
| `tendencia-e-previsao` | `time-series-analysis` (idem) | tendência, dia da semana, previsão com faixa |
| `especificar-painel` | `dashboard-specification` (idem) | a especificação que vira o PROMPT de uma aba de indicadores |
| `checklist-antes-do-numero` | `analysis-qa-checklist` (idem) | a conferência antes de mostrar qualquer número |
| `analise-multiespecialista` | `data-analysis-skill` (dongzhang84, MIT) | planilha analisada por 3–5 olhares em paralelo, relatório por tema |

**A décima é fonte, não skill:** `kishorkukreja/awesome-supply-chain`
(catálogo de 133 skills de transporte, roteirização, frota e armazém) entra
na rotina de varredura contínua — de lá sai candidata para ler, não coisa
para instalar inteira.

**Recusado:** o plugin FreightUtils (publicado em 05/10/2026, autor
avulso, servidor próprio recebendo as perguntas, feito para o Reino Unido
e frete aéreo/marítimo).
