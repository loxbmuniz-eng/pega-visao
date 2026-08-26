# Guia de Implantação — Painel Logístico Suinco em ambiente compartilhado (Teams/SharePoint)

> ## ⚠️ Documento histórico — o SharePoint nunca entrou em produção
>
> Este texto foi escrito quando o painel **ia** rodar sobre Listas do
> SharePoint, com login da Microsoft (MSAL). Essa arquitetura **nunca chegou
> a ser usada**: nenhuma Lista foi provisionada, nenhum dado da operação
> passou por lá.
>
> Desde a migração de agosto/2026 o painel roda com backend próprio — Node +
> PostgreSQL num VPS — e o login é e-mail e senha do próprio painel.
>
> Os trechos sobre SharePoint, Teams, Graph, MSAL ou Listas ficam aqui como
> **registro de por que as decisões foram tomadas**, nunca como instrução do
> que fazer. O sistema de hoje está em `MAPA_COMPLETO_DO_SISTEMA.md`; a
> operação do servidor, em `MANUAL_DO_SERVIDOR.md`.
>
> **NÃO PROVISIONE NADA COM BASE NESTE ARQUIVO.** Ele é um roteiro de
> implantação de uma plataforma que foi descartada. Seguir os passos daqui
> significa configurar um ambiente que o painel não usa e nunca usou.

Este documento é o roteiro completo para o TI colocar o painel em produção, multiusuário
de verdade, dentro do ecossistema Microsoft 365 já existente na Suinco. Cobre: o que
precisa ser provisionado, na ordem certa; os problemas reais que vão aparecer; e a
solução definida para cada um.

**Aviso honesto antes de começar:** não existe sistema distribuído (vários usuários
escrevendo ao mesmo tempo num banco compartilhado) com "zero erro possível". O que dá
pra garantir é que todo problema conhecido dessa classe de arquitetura tem, abaixo, uma
solução específica e testável — não uma esperança de que "não vai acontecer".

---

## 1. Visão geral da arquitetura final

```
Usuário (Portaria/Expedição/Faturamento/Logística)
   │  abre a aba "Logística" dentro do Teams
   ▼
Aba personalizada do Teams (iframe HTTPS)
   │  carrega index.html/styles.css/data.js/app.js
   │  autentica via SSO Microsoft 365 (MSAL.js)
   ▼
Chamadas à API REST do SharePoint / Microsoft Graph
   │  usando o token do usuário logado (permissões dele valem)
   ▼
Listas do SharePoint (Frota, ProgramacaoEmbarque, Movimentacoes,
Usuarios, Transportadoras, Docas) — fonte única de dados real
   ▲
   │  conecta direto (sem exportar nada)
Power BI  /  Power Automate
```

O painel em si (HTML/JS) não muda de lugar depois de publicado — o que muda é onde ele
busca e grava dado: hoje é `localStorage` (um navegador só), na versão final é a API do
SharePoint (todo mundo lendo/escrevendo o mesmo lugar).

---

## 2. Pré-requisitos que o TI precisa provisionar, em ordem

### Passo 1 — Site do SharePoint
Criar (ou reaproveitar) um site do SharePoint dedicado à Logística (ex:
`https://suinco.sharepoint.com/sites/Logistica`). Precisa ser um site do tipo Time
(Team Site), não Comunicação, para permitir Listas com permissão granular.

### Passo 2 — As 6 Listas
Criar as Listas exatamente como especificado em `MODELO_DADOS_SHAREPOINT.md`: `Frota`,
`ProgramacaoEmbarque`, `Movimentacoes`, `Usuarios`, `Transportadoras`, `Docas`. Pontos
que evitam problema depois:
- A coluna `Status` em `ProgramacaoEmbarque` deve ser do tipo **Escolha (Choice)**, não
  texto livre — isso impede alguém digitar um status inválido direto na lista (por
  Excel, Power Apps, ou manualmente) e quebrar a máquina de estados do painel.
- Marcar `Placa` (em Frota) e `CargaId`+`Timestamp` (em Movimentacoes) como **colunas
  indexadas** — necessário para consultas rápidas e para não esbarrar no limite de
  visualização de 5.000 itens do SharePoint (ver seção 4).
- `Movimentacoes` deve ter permissão de **Colaborar sem exclusão**: ninguém, nem
  administrador do site, deve poder apagar linhas — é o log de auditoria.

### Passo 3 — Registro do aplicativo no Microsoft Entra ID (SSO)
1. Entra admin center → App registrations → New registration.
2. Tipo: Single-page application (SPA) — é o que o MSAL.js do painel vai usar.
3. Redirect URI: a URL final onde o painel vai ficar hospedado (ver Passo 4).
4. Permissões de API: **`Sites.Selected`** (recomendado, mais restrito — dá acesso só
   ao site de Logística específico, não a todo o SharePoint do tenant) + `User.Read`.
   Evitar `Sites.ReadWrite.All` a não ser que o TI realmente queira dar acesso amplo.
5. Consentimento de administrador (Grant admin consent) — sem isso, cada usuário veria
   uma tela de permissão na primeira vez, o que confunde no chão de fábrica.
6. Anotar o `Application (client) ID` e o `Directory (tenant) ID` — são os dois valores
   que eu preciso para trocar o adaptador `SuincoStore` (hoje em `data.js`) pelas
   chamadas reais de API.

### Passo 4 — Hospedagem dos arquivos do painel (precisa de HTTPS)
Uma aba do Teams não aceita arquivo local — precisa de uma URL HTTPS pública (ou
interna à organização). Três caminhos, do mais simples ao mais robusto:

| Opção | Prós | Contras |
|---|---|---|
| **Biblioteca de documentos do próprio SharePoint** (upload dos arquivos + página) | Zero infraestrutura nova, mesmo tenant, sem custo extra | Precisa configurar a página para servir os arquivos como app, não como download |
| **Azure Static Web Apps** (recomendado) | HTTPS automático, deploy simples (CI/CD direto do GitHub), gratuito na maioria dos casos de uso deste porte | Precisa de uma assinatura Azure (a maioria das empresas com Microsoft 365 já tem) |
| **Power Pages** | Integração nativa Power Platform | Mais pesado que o necessário para um app deste tamanho |

Recomendo Azure Static Web Apps — é o caminho com menos superfície de erro.

### Passo 5 — Registrar a aba no Teams
1. Criar o manifesto do Teams (`manifest.json`) apontando para a URL do Passo 4, com o
   `validDomains` incluindo esse domínio e o `login.microsoftonline.com` (para o SSO).
2. Testar via **sideload** (upload manual do pacote `.zip` do app) num time de teste
   antes de publicar para toda a organização.
3. Publicar no catálogo interno do Teams da Suinco (App Catalog do admin center) para
   os 4 setores instalarem a aba.

### Passo 6 — Permissão por setor nas Listas
Nível mínimo viável: todos os 4 setores com permissão de **Colaborar** na lista
`ProgramacaoEmbarque` e `Movimentacoes` (o painel decide na interface o que cada setor
vê/edita, mas tecnicamente todos podem gravar).
Nível ideal (mais trabalho de configurar, recomendado se o TI tiver tempo): permissão
por coluna via **Power Automate** — um fluxo que valida se o setor de quem editou bate
com a transição de status permitida, e reverte/alerta se não bater. Isso fecha a
brecha "o painel esconde o botão, mas alguém edita a lista direto".

---

## 3. O que eu preciso de volta pra fechar a integração

Depois dos passos acima, para eu trocar `SuincoStore` (data.js) pelas chamadas reais:
- URL do site do SharePoint (Passo 1)
- Nomes/IDs internos das 6 Listas (Passo 2)
- `Client ID` e `Tenant ID` do App Registration (Passo 3)
- URL final onde o painel está hospedado (Passo 4)

Sem esses 4 itens eu não tenho como escrever a chamada de API real — e não vou
inventar valores de exemplo fingindo que são reais.

---

## 4. Problemas conhecidos desta arquitetura — e a solução de cada um

| # | Problema | Quando acontece | Solução |
|---|---|---|---|
| 1 | **Conflito de escrita simultânea** — duas pessoas mudam o status da mesma carga ao mesmo tempo | Portaria e Expedição mexendo na mesma placa no mesmo segundo | SharePoint REST suporta concorrência otimista via cabeçalho `If-Match` (ETag). O painel deve enviar o ETag da última leitura; se o servidor responder `412 Precondition Failed`, o painel recarrega o item, avisa "esse item mudou, veja o valor atual" e não sobrescreve às cegas. |
| 2 | **Token expira durante o turno** (sessões de 8h+) | Usuário fica com a aba aberta o turno inteiro | MSAL.js faz renovação silenciosa de token em segundo plano. Se falhar (ex: sessão do Windows expirou), o painel detecta erro 401 nas chamadas e mostra "sessão expirada, clique para entrar novamente" em vez de travar silenciosamente. |
| 3 | **Limite de 5.000 itens por view do SharePoint** | Lista `Movimentacoes` cresce (é um log que só cresce) | Colunas indexadas (Passo 2) evitam o erro na maioria das consultas filtradas. Complementar: arquivamento periódico (mensal) das cargas já "Seguiu Viagem" há mais de X dias para uma lista de histórico separada, mantendo a lista operacional enxuta. |
| 4 | **Usuário sem permissão na Lista** | Alguém é adicionado a um setor no painel mas o TI esqueceu de dar permissão na Lista | Erro 403 da API deve ser tratado explicitamente no painel: mensagem clara "Você não tem permissão de acesso — fale com o TI", nunca uma tela em branco ou travada. |
| 5 | **Alguém edita a Lista direto (Excel, Power Apps, SharePoint) fora do painel** | Comum em migração — pessoas ainda no hábito antigo | Coluna `Status` como Escolha (Passo 2) impede valor inválido. Para a transição errada mas com valor válido (ex: pular etapa), a validação de sequência da máquina de estados vive hoje em `data.js` (`avancarStatusCarga`) — a mesma regra deve ser espelhada num fluxo do Power Automate no lado do servidor, senão só quem usa o painel respeita a ordem. |
| 6 | **CORS bloqueando as chamadas** | Painel hospedado fora do domínio autorizado | Garantir que a URL de hospedagem (Passo 4) esteja no `validDomains` do manifesto do Teams e que o App Registration tenha esse Redirect URI cadastrado. Hospedar dentro do próprio tenant (SharePoint) evita esse problema por completo. |
| 7 | **Sem internet / Teams offline** | Rede instável no pátio/portaria | Não existe hoje — é uma limitação real, não meia-solução. Melhoria futura possível: fila local de ações pendentes no navegador, reenviadas automaticamente quando a conexão voltar. Não implementar isso agora seria inventar uma promessa; está documentado aqui como trabalho futuro real. |
| 8 | **Duas abas do mesmo usuário abertas** | Pessoa esquece uma aba aberta e abre outra | Diferente do localStorage de hoje, com a API real cada aba lê/escreve o mesmo dado — não há mais "dados divergentes" entre abas. Pode haver tela desatualizada até re-renderizar; mitigar com atualização periódica (polling a cada N segundos) ou, se o TI quiser investir mais, webhooks do SharePoint para atualização quase em tempo real. |
| 9 | **App do Teams no celular** | Portaria/Expedição usando celular no pátio | Testar responsividade antes de publicar — o painel já usa grid responsivo, mas precisa de teste real em tela pequena antes de liberar para uso móvel. |

---

## 5. Checklist definitivo, em ordem

1. [ ] Site do SharePoint criado (Passo 1)
2. [ ] 6 Listas criadas com os tipos de coluna corretos, `Status` como Choice (Passo 2)
3. [ ] Colunas indexadas em Frota.Placa e Movimentacoes.CargaId/Timestamp (Passo 2)
4. [ ] App Registration no Entra ID com `Sites.Selected` + consentimento admin (Passo 3)
5. [ ] Hospedagem HTTPS escolhida e publicada (Passo 4)
6. [ ] Manifesto do Teams criado e testado via sideload (Passo 5)
7. [ ] Permissão dos 4 setores nas Listas configurada (Passo 6)
8. [ ] Os 4 itens da seção 3 enviados de volta para eu trocar `SuincoStore` pela API real
9. [ ] Teste piloto com 1 pessoa de cada setor, ao mesmo tempo, antes do rollout geral
10. [ ] Publicação no catálogo interno do Teams para todos os 4 setores
