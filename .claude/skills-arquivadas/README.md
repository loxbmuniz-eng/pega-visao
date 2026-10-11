# Skills arquivadas — curadoria de 11/10/2026

Pedido do dono: *"faz uma curadoria profunda ai nas skills que temos"*, e,
sobre as de design: *"pode meter marcha nessas de design"*.

Estas 48 skills **não foram apagadas**. Estão aqui, fora de
`.claude/skills/`, porque o Claude só carrega o que está lá: cada skill
instalada é lida em toda conversa, e skill que não serve ao painel é ruído
— e custo — em todas elas. As que ficaram, e quando usar cada uma, estão em
`.claude/skills/README.md`.

**Para trazer uma de volta** (exemplo com a `slides`):

    git mv .claude/skills-arquivadas/slides .claude/skills/slides

e commitar. Se ela tiver licença própria aqui (`LICENCA_*.txt`), a licença
volta junto.

**Seis ficaram em `.claude/skills/` mesmo parecendo de arquivo**, porque
outra skill ou agente depende delas: `antislop` (a `antislop-code` exige o
núcleo), `grilling` (a `improve-codebase-architecture` chama), `weave` (é a
base da `suinco-yard-flow`), `ui-ux-pro-max` (o agente
`suinco-entregavel-html` e a `especificar-painel`), `suinco-edi-gs1` (o
agente integrador do Atak) e `suinco-sanitary-traceability` (a
`ocorrencia-de-frete`).

## Design, animação e visual — o design do painel foi fechado pelo dono

O Lote 6 do /impeccable foi descartado em 09/10 ("ta bom como esta"). Para
tela nova continuam a `impeccable`, a `mobile-native` e a `ui-ux-pro-max`.

| Skill | Por que saiu |
|---|---|
| `emil-design-eng` | filosofia de animação — o painel tem pouquíssima, e já revisada |
| `review-animations`, `improve-animations`, `find-animation-opportunities`, `animation-vocabulary` | auditoria e vocabulário de animação: idem |
| `apple-design` | gesto e mola no estilo Apple — fora do que o painel faz |
| `make-interfaces-feel-better` | acabamento fino — foi a lente do Lote 6, descartado |
| `hallmark`, `frontend-design` | páginas novas do zero — o painel já tem identidade (`DESIGN.md`) |
| `design`, `design-system`, `brand`, `banner-design` | logotipo, identidade de marca, banner de rede social |
| `ui-styling` | shadcn/Tailwind — o painel não usa nenhum dos dois |
| `slides` | apresentação HTML |
| `better-icons` | busca de ícones por linha de comando, com internet — os ícones do painel já estão no próprio arquivo |
| `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting` | a família anti-"cara de IA" para tela e texto — ficou só o núcleo e a de comentários de código |
| `stop-slop` | escrita — a `humanizer`, que ficou, faz o mesmo |

## Infraestrutura feita para sistemas muito maiores

O painel é um servidor na Hostinger e um site na Vercel. Estas pedem
instalar e manter mais programas sem resolver problema que ele tem hoje.

| Skill | Por que saiu | O que já cobre |
|---|---|---|
| `prometheus-grafana` | painel de métricas para dezenas de servidores | os vigias, com aviso no celular |
| `opentelemetry` | rastreamento entre muitos serviços | o Sentry (pronto, desligado até o dono ligar) |
| `beacon` | SLO e confiabilidade de grande porte | `observability-and-instrumentation` |
| `ledger` | custo de nuvem grande (AWS, Google) | — a conta é um servidor e a Vercel |
| `polyglot` | traduzir o sistema para vários idiomas | — o painel é só em português |
| `performing-sca-dependency-scanning-with-snyk` | verificador pago de pacotes | o `npm audit` barra no portão |
| `performing-service-account-credential-rotation` | rodízio de senha de serviço em escala de empresa | — volta se o dono pedir rodízio de chaves |

## Normas de outros contextos

| Skill | Por que saiu |
|---|---|
| `iso27001`, `soc2` | certificação de segurança de empresa de software — não é o caso |
| `gdpr-compliance` | lei europeia — a `lgpd`, que ficou, é a brasileira |
| `cloak` | privacidade de engenharia em escala — a `lgpd` e a `security-and-hardening` cobrem |
| `triaging-security-incident` | triagem de incidente pelo NIST — volta no dia de um incidente |

## Processo que a casa já tem de outro jeito

O fluxo daqui é o do `CLAUDE.md`: PROMPT → aprovação → teste que reprova →
correção → bateria → portão. Estas skills impõem outro fluxo, e duas regras
diferentes para a mesma coisa divergem.

| Skill | Por que saiu |
|---|---|
| `using-superpowers` | manda invocar skill antes de QUALQUER resposta — briga com o fluxo da casa |
| `brainstorming`, `spec-driven-development` | o PROMPT da casa (e o agente `suinco-tradutor-de-pedido`) faz isso |
| `writing-plans`, `executing-plans`, `planning-with-files` | plano em arquivo próprio — aqui é a `FILA_DE_EVOLUCAO.md` e a lista de tarefas |
| `subagent-driven-development`, `dispatching-parallel-agents` | orquestrar agentes em paralelo — os 16 agentes da casa já têm papel definido |
| `finishing-a-development-branch`, `using-git-worktrees` | decidir merge, PR e área de trabalho — aqui quem publica é o `publicar.sh` |
| `requesting-code-review` | a `code-review-and-quality`, que ficou, faz o mesmo |
| `shift` | migração de framework com codemod — o painel não tem framework |
| `trail` | arqueologia no git — o agente `suinco-investigador` já faz |
| `writing-skills` | a `skill-creator`, que ficou, faz o mesmo |
| `cartographer` | gera um mapa do código e mexe no `CLAUDE.md` — o mapa daqui é o raio-X, e mapa paralelo é o que a lei do raio-X proíbe |
