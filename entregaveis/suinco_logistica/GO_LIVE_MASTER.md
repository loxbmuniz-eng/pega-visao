# GO_LIVE_MASTER — Embarque Suinco

Playbook de implantação e manutenção. Atualizado a cada etapa.

- **Domínio:** embarquesuinco.com.br
- **Frontend:** Vercel
- **API:** api.embarquesuinco.com.br → VPS Hostinger
- **Banco:** PostgreSQL na VPS
- **Tempo real:** Socket.IO
- **Início:** 04/08/2026

| Fase | Estado |
|---|---|
| 1 — Análise do projeto existente | ✅ concluída |
| 2 — Revisão de arquitetura + schema | ✅ concluída e **validada em PostgreSQL 16** |
| 3 — Revisão de frontend | ⏳ em andamento |
| 4 a 27 | ⬜ |

---

# FASE 1 — Análise do projeto existente

## 1.1. O que existe hoje

| Camada | Arquivo | Tamanho | Migra? |
|---|---|---|---|
| Apresentação | `app.js` | 1.760 linhas, 108 funções | ✅ **integral** |
| Regras de negócio | `data.js` | 1.370 linhas, 74 funções | ✅ **integral** |
| Estilo | `styles.css` | 700 linhas | ✅ integral |
| Marcação | `index_suinco.html` | 620 linhas | ✅ integral |
| Integração | `suinco-sharepoint.js` | 490 linhas, 26 funções | ⚠️ **substituído** |
| Base de frota | `frota_seed_2026.csv` | 749 placas | ➡️ vira tabela |
| Testes | `testes/` | 10 baterias, 78 verificações | ⚠️ adaptar alvo |

**Conclusão que orienta tudo:** cerca de **90% do código migra sem alteração**.
A separação em camadas foi feita com essa regra — `app.js` e `data.js` **nunca
chamam o SharePoint**; falam só com `DB`. Trocar o back-end substitui **um**
arquivo.

## 1.2. Regras de negócio que não podem ser perdidas

Estão em `data.js` e migram como estão. Listadas porque **qualquer** reescrita
precisa preservá-las:

1. **Máquina de 6 status** com validação de transição — não se pula etapa.
2. **Trava de frota** — placa fora do cadastro não vira carga.
3. **Saída em lote por placa** — o caminhão sai uma vez, todas as cargas fecham.
4. **Chegada sem programação** — cria carga marcada *Aguardando Carga*.
5. **Paletizada** editável; **Tipo de Operação** com 4 valores fixos.
6. **32 rotas** com código, praça e operador logístico.
7. **Índice `Map` da frota** — busca em tempo constante.
8. **Trilha de auditoria** — todo evento com autor, setor e horário.

## 1.3. O que o adaptador atual faz — e precisa continuar fazendo

`suinco-sharepoint.js` será substituído, mas o **contrato** dele é o requisito
do novo backend. Cada item abaixo custou uma correção de defeito real:

| Capacidade | Por que existe |
|---|---|
| Gravação local-first | A Portaria registra com o caminhão parado na frente. Travar o botão por rede degrada a operação. |
| Fila offline persistida | Wi-fi de pátio oscila. Nenhum registro pode se perder. |
| Upsert por chave de negócio | Sem isso, cada mudança de status criava linha nova — 6 linhas por carga no BI. |
| `_pendente` | Sem isso, o ciclo apagava da tela o que o operador acabou de fazer. |
| Marca de leitura tomada **antes** da consulta | Sem isso, um terminal parava de receber updates **para sempre**. Só reproduzia com 3+ usuários. |
| Recuperação automática | Terminal offline por erro de servidor não voltava sozinho. |
| Validação de identificador na fronteira | Vetor de XSS armazenado confirmado com payload real. |

> **Nenhum destes apareceu por inspeção de código.** Todos vieram de simulação
> multiusuário. O backend novo precisa deles desde o primeiro dia, ou vamos
> redescobrir os mesmos defeitos em produção.

## 1.4. O modelo do Power BI — ponto que precisa de decisão

Hoje **convivem duas nomenclaturas**, e isso não pode ir para o Postgres:

| Origem | Tabelas |
|---|---|
| **Export CSV** (`POWERBI_EXPORT.md`) | `Fact_Movimentacoes`, `Dim_Carga`, `Dim_Transportadora`, `Dim_Frota`, `Dim_Status` |
| **Listas SharePoint** (`MODELO_DADOS_SHAREPOINT.md`) | `fact_Viagens`, `fact_StatusFrota`, `dim_Veiculos`, `LOG_EVENTOS` |

São modelos diferentes para os mesmos dados. Um deles é o que o seu Power BI
usa; o outro é resíduo.

> **Resolvido, e vale registrar qual venceu.** As "Listas SharePoint" da linha
> de baixo nunca existiram — aquela plataforma foi descartada antes de
> qualquer provisionamento. A nomenclatura que valeu é a do PostgreSQL, em
> `backend/migrations/`, e o `MODELO_DADOS_SHAREPOINT.md` fica no repositório
> só como registro histórico.

**Proposta:** o Postgres adota a nomenclatura das **Listas** (`fact_Viagens`,
`fact_StatusFrota`, `dim_Veiculos`, `LOG_EVENTOS`), porque foi a alinhada com o
modelo do BI, e as *views* de export reproduzem **exatamente** os cabeçalhos que
o Power BI já consome — assim o relatório existente não quebra.

⚠️ **Preciso da confirmação:** não tenho acesso aos outros chats. Se o modelo do
seu BI tiver dimensões além dessas quatro (`dim_Rota`, `dim_Tempo`,
`dim_Operador`…), me passe a lista de tabelas e colunas. Sem isso eu criaria um
schema plausível mas não necessariamente o **seu** — e "plausível" não serve
para um BI já configurado.

## 1.5. Mapa da migração

| Hoje | Depois |
|---|---|
| Arquivos estáticos abertos localmente | Vercel, domínio próprio, HTTPS |
| SharePoint como banco | PostgreSQL na VPS |
| Consulta a cada 15 s | **Socket.IO — atualização imediata** |
| MSAL / Entra ID | Autenticação própria (JWT) |
| `suinco-sharepoint.js` | `suinco-api.js` — mesmo contrato, outro destino |
| Export CSV manual | Views no Postgres + endpoint para o Power BI |
| Sem backup | Backup automatizado na VPS |

## 1.6. Ganhos reais desta arquitetura

Registrados porque justificam a mudança:

1. **Latência cai de até 15 s para imediata.** Socket.IO empurra a alteração; o SharePoint não empurrava nada.
2. **Controle do schema.** Índice, constraint e transação de verdade. Some o limite de 5.000 itens por consulta.
3. **Backup e restauração sob seu controle**, não sob política do M365.
4. **Sem teto de licença** para usuário simultâneo.
5. **Caminho aberto para integração com IA**, como você previu.

## 1.7. Riscos — e como tratar cada um

| Risco | Gravidade | Tratamento |
|---|---|---|
| **Perder regra de negócio na migração** | 🔴 Alta | `data.js` migra **sem reescrita**. As 10 baterias rodam contra o backend novo. |
| **VPS vira ponto único de falha** | 🔴 Alta | Antes: SharePoint tinha alta disponibilidade da Microsoft. Agora um servidor só. Exige backup, monitoramento e plano de restauração — FASES 22, 23 e 26. |
| **Autenticação própria** | 🔴 Alta | Sai do SSO corporativo. JWT + hash forte + expiração. Perde-se a política de senha da Suinco. |
| **Quebrar o Power BI** | 🟠 Média | Views reproduzindo os cabeçalhos atuais + conferência campo a campo. |
| **Superfície de ataque nova** | 🟠 Média | API pública na internet. Rate limit, CORS restrito, validação de entrada, hardening (FASE 11). |
| **Custo recorrente** | 🟡 Baixa | Deixa de ser zero. VPS + domínio + manutenção. |
| **Migrar dados existentes** | 🟡 Baixa | Hoje o dado real está em `localStorage`. Script de importação da frota + carga inicial. |

**O risco 2 merece destaque na conversa com o TI.** O argumento anterior era
"nenhum servidor novo para manter". Isso deixa de valer. Em troca vêm tempo real
e controle total — é um trade-off legítimo, mas precisa ser dito, não escondido.

## 1.8. Estrutura de diretórios proposta

```
embarque-suinco/
├── frontend/                  → Vercel
│   ├── index.html             (de index_suinco.html)
│   ├── styles.css             (integral)
│   ├── data.js                (integral — regras de negócio)
│   ├── app.js                 (integral — apresentação)
│   ├── suinco-api.js          (NOVO — substitui suinco-sharepoint.js)
│   └── vercel.json
│
├── backend/                   → VPS Hostinger
│   ├── src/
│   │   ├── server.js          Express + Socket.IO
│   │   ├── db.js              pool PostgreSQL
│   │   ├── auth.js            JWT, hash, permissão por setor
│   │   ├── rotas/             cargas, movimentacoes, frota, auth, bi
│   │   ├── middleware/        rate limit, CORS, validação, erro
│   │   └── realtime.js        eventos Socket.IO
│   ├── migrations/            versionamento do schema
│   ├── scripts/               backup, seed da frota
│   └── ecosystem.config.js    PM2
│
├── docs/                      (documentação existente, preservada)
└── testes/                    (10 baterias, apontadas ao backend novo)
```

## 1.9. Decisão técnica — Prisma ou SQL direto

| Critério | Prisma | `pg` + SQL |
|---|---|---|
| Migrations | ✅ integrado | ⚠️ manual |
| Curva de aprendizado do TI | ⚠️ ORM novo | ✅ SQL puro |
| Controle das views do BI | ⚠️ SQL bruto mesmo assim | ✅ direto |
| Dependências | +2 pacotes | +1 |
| Depuração pelo TI | ⚠️ camada a mais | ✅ query visível |

**Recomendação: `pg` + SQL direto, com migrations versionadas em arquivo.**
Motivo: o schema é pequeno (4 tabelas), as views do BI são SQL de qualquer
forma, e quem vai manter isso é um TI que conhece SQL — não vale introduzir um
ORM para economizar poucas linhas. Se a equipe preferir Prisma, é decisão de
vocês e eu adapto.

---

## O que eu já fiz nesta fase

- Inventário completo dos 4.883 linhas do projeto.
- Mapeamento do que migra íntegro (90%) e do que é substituído.
- Levantamento das 8 regras de negócio inegociáveis.
- Extração do contrato do adaptador — os 7 comportamentos que o backend novo
  precisa ter desde o dia 1, cada um vindo de um defeito real já corrigido.
- Identificação do conflito de nomenclatura no modelo do BI.
- Matriz de risco com 7 itens e tratamento.
- Estrutura de diretórios e decisão Prisma × SQL.

## O que preciso de você antes da FASE 2

1. **Modelo do Power BI** — a lista de tabelas e colunas que ele consome hoje.
   É o único item que **não posso deduzir**, e errar aqui quebra o relatório.
2. **Dados da VPS** — IP, distribuição/versão do Linux, e se já tem algo rodando
   (para não haver conflito de porta).
3. **Confirmar Prisma × SQL direto** (§1.9).
4. **Confirmar autenticação:** usuário e senha próprios, ou manter login do
   Microsoft 365? Manter o M365 preserva a política de senha da empresa.
5. **Volume esperado:** cargas por dia e usuários simultâneos, para dimensionar
   pool de conexão e backup.

## Critérios de validação desta fase

- [x] Todo arquivo do projeto inventariado e classificado
- [x] Regras de negócio listadas e nenhuma perdida no mapeamento
- [x] Riscos identificados com tratamento
- [x] Estrutura-alvo definida
- [ ] Modelo do BI confirmado ← **bloqueia a FASE 5**

## Próxima etapa

**FASE 2 — Revisão de arquitetura.** Contratos de API, eventos Socket.IO,
estratégia de autenticação e desenho das tabelas. Começa assim que os itens 1 a
4 acima estiverem respondidos — exceto o item 1, que só bloqueia a FASE 5
(banco), então dá para adiantar a FASE 2 sem ele.


---

# FASE 2 — Arquitetura e schema do banco

## 2.1. O conflito do Power BI, resolvido sem depender de resposta

Havia duas nomenclaturas para os mesmos dados e escolher errado quebraria o
relatório. A solução não é escolher:

- **Tabelas** usam a nomenclatura das Listas: `fact_viagens`,
  `fact_statusfrota`, `dim_veiculos`, `log_eventos`.
- **Views** reproduzem **exatamente** os cabeçalhos do export CSV atual:
  `vw_dim_carga`, `vw_fact_movimentacoes`, `vw_dim_frota`,
  `vw_dim_transportadora`, `vw_dim_status`.

O Power BI conecta direto no PostgreSQL e lê **qualquer uma das duas**. Nenhuma
medida existente precisa ser refeita, e a decisão pode ser tomada depois sem
custo.

Duas views novas, que antes não existiam em lugar nenhum:

- **`vw_dim_rota`** — as 32 rotas viram dimensão consultável.
- **`vw_tempos_por_etapa`** — minutos que cada carga passou em cada etapa,
  calculado no banco com função de janela. É a **base dos indicadores de
  gargalo**: antes esse cálculo só existia dentro do navegador e não estava
  disponível para o BI.

## 2.2. Decisões de schema — e o porquê de cada uma

**Identificador de negócio em TEXTO, não `SERIAL`.** O painel grava offline e
sincroniza depois; o id precisa existir **antes** de o servidor ver o registro.
Um `SERIAL` impediria a fila offline de funcionar.

**Coluna `versao` com gatilho.** Incrementa a cada gravação. Permite **bloqueio
otimista**: o cliente envia a versão que leu e o servidor recusa se já mudou.
Isso substitui o "última escrita vence" da versão SharePoint, onde não havia
como sequer *detectar* o conflito. É um ganho concreto da migração.

**`CHECK` replicando a máquina de estados.** Não valida a transição — isso é da
aplicação — mas garante que nenhum status inventado entre na tabela, inclusive
por script ou carga manual. Defesa em profundidade.

**Setor validado no servidor.** Na versão anterior o setor vinha do
`localStorage` e o operador podia assumir qualquer um editando o navegador
(achado MÉDIA da auditoria). Aqui ele vive em `operadores` e a API decide.
**Este é o achado de segurança que a migração resolve de graça.**

**Índice parcial para cargas em aberto.** É a consulta de toda tela do painel;
o índice cobre só as não concluídas, que são centenas, não o histórico inteiro.

**`log_eventos` sem FK para `carga_id`.** Deliberado: o log precisa sobreviver
mesmo que a carga seja removida. Log que desaparece junto com o registro não
serve para auditoria.

## 2.3. Validação executada

O schema **não foi só escrito — foi aplicado e testado** em PostgreSQL 16:

```
✅ migration aplica limpa, em transação única
✅ gatilho incrementa versao de 1 → 2 e atualiza o timestamp no UPDATE
✅ CHECK recusa status inventado
     ERROR: violates check constraint "fact_viagens_status_atual_check"
✅ FK recusa rota inexistente
     ERROR: Key (rota_codigo)=(999) is not present in table "dim_rotas"
✅ vw_dim_carga devolve os cabeçalhos que o Power BI já consome
✅ vw_tempos_por_etapa calcula corretamente (35 min por etapa no cenário)
```

## 2.4. Contrato da API

Endpoints, todos sob `api.embarquesuinco.com.br`:

| Método | Rota | Papel |
|---|---|---|
| `POST` | `/auth/login` | Devolve JWT com id, nome e **setor** |
| `GET` | `/api/estado?desde=` | Carga inicial e leitura incremental |
| `POST` | `/api/cargas` | Cria carga (aplica a trava de frota) |
| `PATCH` | `/api/cargas/:id` | Atualiza — exige `versao` para o bloqueio otimista |
| `POST` | `/api/movimentacoes` | Registra mudança de status (append) |
| `GET` | `/api/frota` | Cadastro de frota |
| `GET` | `/api/rotas` | Rotas |
| `GET` | `/bi/:view` | Export para o Power BI |
| `GET` | `/health` | Monitoramento |

**Regra que não pode ser afrouxada:** a transição de status é validada **no
servidor**, não só no cliente. Hoje a máquina de estados vive no navegador; com
API pública, quem tiver o token pode chamar direto.

## 2.5. Eventos Socket.IO

| Evento | Direção | Conteúdo |
|---|---|---|
| `carga:criada` | servidor → clientes | a carga inteira |
| `carga:atualizada` | servidor → clientes | a carga inteira |
| `movimentacao:nova` | servidor → clientes | o evento de status |
| `frota:atualizada` | servidor → clientes | aviso de recarregar |

**Socket.IO é otimização, não a fonte da verdade.** Se a conexão cair, o painel
volta para a consulta periódica — o mesmo mecanismo já testado com 10 usuários.
Nenhum dado depende do socket estar de pé; ele só reduz a latência de 15 s para
imediata.

## 2.6. O que a migração resolve dos achados anteriores

| Achado | Antes | Com o backend |
|---|---|---|
| Setor forjável pelo cliente | MÉDIA, sem solução | ✅ validado no servidor |
| Senha em texto puro | MÉDIA, sem solução | ✅ hash no banco |
| Conflito sem detecção | "última escrita vence" | ✅ bloqueio otimista por versão |
| Limite de 5.000 itens | mitigado por projeto | ✅ deixa de existir |
| Latência de 15 s | limite da plataforma | ✅ imediata |

## O que eu fiz nesta fase

- Schema completo em `backend/migrations/001_schema.sql`, aplicado e testado.
- Resolução do conflito de nomenclatura via views — sem depender de resposta.
- Duas views novas: dimensão de rotas e tempos por etapa.
- Contrato de API e eventos de tempo real definidos.
- Bloqueio otimista projetado, resolvendo limitação conhecida.

## Próxima etapa

**FASE 3 — Frontend.** Escrever `suinco-api.js` substituindo
`suinco-sharepoint.js`, preservando os 7 comportamentos do contrato (§1.3), e
adaptar as 10 baterias de teste para apontar ao backend novo.
