# Arquitetura, Configuração e Operação — Painel Logístico Suinco

- **Destinatário:** Tecnologia da Informação e revisão técnica sênior
- **Data:** 02/08/2026
- **Escopo:** back-end, front-end, integração, segurança, troubleshooting
- **Documentos irmãos:** `RELATORIO_TECNICO_SINCRONIA.md`,
  `RELATORIO_DE_TESTES.md`, `AUDITORIA_SEGURANCA.md`,
  `RELATORIO_TI_HOSPEDAGEM.md` (v3)

---

## 1. Visão geral em uma tela

```
┌──────────────────── NAVEGADOR DO OPERADOR ────────────────────┐
│                                                                │
│  index.html ──── styles.css                                    │
│      │                                                         │
│      ├── app.js               APRESENTAÇÃO (105 funções)       │
│      │    • render de cada aba, formulários, relatórios        │
│      │    • NÃO conhece SharePoint. Fala só com DB.            │
│      │                                                         │
│      ├── data.js              REGRAS DE NEGÓCIO (72 funções)   │
│      │    • máquina de 6 status, trava de frota, indicadores   │
│      │    • DB (estado em memória) + SuincoStore (persistência)│
│      │    • fundirEstadoRemoto: mescla o que vem do servidor   │
│      │                                                         │
│      └── suinco-sharepoint.js INTEGRAÇÃO (26 funções)          │
│           • MSAL (SSO) · Graph · fila offline · sincronia      │
│           • ÚNICO ponto que sabe que o SharePoint existe       │
│                                                                │
│  localStorage ← cache local + fila de pendências               │
└───────────────────────────┬────────────────────────────────────┘
                            │ HTTPS · Microsoft Graph
                            │ token do Entra ID (SSO)
┌───────────────────────────▼────────────────────────────────────┐
│         SHAREPOINT ONLINE — site de Logística (M365)           │
│                                                                │
│   fact_Viagens      1 linha por carga (atualizada)             │
│   fact_StatusFrota  1 linha por mudança de status (append)     │
│   dim_Veiculos      1 linha por placa                          │
│   LOG_EVENTOS       trilha de auditoria (append, imutável)     │
└───────────────────────────┬────────────────────────────────────┘
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
            Power BI            Power Automate
         (lê direto)         (arquiva o ciclo diário)
```

**Não existe servidor de aplicação.** O painel são arquivos estáticos; o
"back-end" é o próprio SharePoint. Isso é decisão de arquitetura, não limitação:
elimina servidor para manter, patch de sistema operacional e um ponto a mais de
falha, e usa uma plataforma que a Suinco já paga e o TI já sabe operar.

---

## 2. As três camadas

### 2.1. `app.js` — apresentação

Desenha as 9 abas, lê formulários, monta relatórios. **Regra que sustenta a
manutenibilidade:** esta camada nunca chama o SharePoint. Ela só lê `DB` e
chama funções de `data.js`. Trocar o back-end amanhã não toca nela.

Pontos principais:

| Função | Papel |
|---|---|
| `renderAll()` | Redesenha todas as abas. Chamada após qualquer mudança. |
| `atualizarRodapeConexao()` | Mostra o estado REAL da conexão (nunca finge). |
| `esc()` / `escJs()` | Escape para HTML e para string-JS-em-atributo. Ver §6.1. |
| `exportarPdfOperacional()` | Planilha de sequenciamento do dia. |
| `exportarCsvPowerBI()` | Gera os 5 CSVs do modelo dimensional. |

### 2.2. `data.js` — regras de negócio

O núcleo. Não conhece DOM nem rede.

| Bloco | Conteúdo |
|---|---|
| `STATUS_FLOW` | Os 6 status, em ordem. Fonte única da máquina de estados. |
| `criarCargaProgramada()` | Nascimento da carga. Aplica a trava de frota. |
| `registrarChegadaPortaria()` | 1→2. Trata placa sem programação prévia. |
| `avancarStatusCarga()` | Transições da Expedição e do Faturamento. |
| `registrarSaidaPortaria()` | →6, em lote por placa (o caminhão sai uma vez). |
| `registrarMovimentacao()` | Grava o log. **Não** sincroniza a carga (ver §4.3). |
| `fundirEstadoRemoto()` | Mescla o estado que veio do servidor. Ver §4.4. |
| `SuincoStore` | Persistência: localStorage + disparo da sincronia. |
| `buscarFrota()` | Busca por placa em `Map` — tempo constante. |
| `idSeguro()` | Valida identificadores vindos do servidor. Ver §6.1. |

### 2.3. `suinco-sharepoint.js` — integração

Único módulo que sabe que o SharePoint existe.

| Função | Papel |
|---|---|
| `iniciar()` | Autentica, drena a fila, carga inicial, liga o ciclo. |
| `autenticar()` | MSAL v2, fluxo *redirect* (popup é bloqueado no Teams). |
| `upsert()` | Grava por chave de negócio: PATCH se existe, POST se não. |
| `pull()` / `pullTudo()` | Leitura, incremental após a primeira. |
| `sincronizarAgora()` | Um ciclo completo. Também é o caminho de recuperação. |
| `drenarFila()` | Sobe o que ficou pendente, na ordem original. |
| `arquivarDia()` | Dispara o fluxo de encerramento no Power Automate. |

---

## 3. Onde entram os parâmetros do TI

**Arquivo:** `suinco-sharepoint.js`, primeiras 40 linhas, bloco `SP_CONFIG`.
Na versão de arquivo único, o mesmo bloco está embutido no HTML — procure por
`const SP_CONFIG`.

```js
const SP_CONFIG = {
  clientId: '',      // ◄── TI PREENCHE
  tenantId: '',      // ◄── TI PREENCHE
  siteId:   '',      // ◄── TI PREENCHE
  redirectUri: window.location.origin + window.location.pathname,
  listIds: {
    cargas:        'fact_Viagens',
    movimentacoes: 'fact_StatusFrota',
    frota:         'dim_Veiculos',
    logs:          'LOG_EVENTOS'
  },
  intervaloSincroniaMs: 15000,
  powerAutomateArquivamento: '',   // opcional
  graphBaseUrl: 'https://graph.microsoft.com/v1.0',
  modoSimulacao: false             // NÃO ALTERAR em produção
};
```

### 3.1. Como obter cada valor

| Parâmetro | Onde | Formato |
|---|---|---|
| `clientId` | Entra ID → App registrations → sua app → *Application (client) ID* | GUID |
| `tenantId` | Entra ID → *Directory (tenant) ID* | GUID |
| `siteId` | `GET https://graph.microsoft.com/v1.0/sites/suinco.sharepoint.com:/sites/Logistica` → campo `id` | `host,guid,guid` |
| `powerAutomateArquivamento` | URL do gatilho HTTP do fluxo | URL |

### 3.2. Onde entra o ambiente que o TI cria

Três peças, e vale separá-las porque costumam ser confundidas:

**1. O site do SharePoint** — é o **banco de dados**. As 4 Listas ficam aqui.
É o que precisa das colunas e índices da §3.3.

**2. O App Registration no Entra ID** — é a **identidade da aplicação**. Não
hospeda nada; autoriza o painel a falar com o Graph em nome do usuário logado.

**3. A hospedagem dos arquivos estáticos** — onde o `index.html` fica. Três
opções, em ordem de simplicidade:

| Opção | Como | Observação |
|---|---|---|
| **Biblioteca do próprio site** (recomendada) | Subir os arquivos numa biblioteca de documentos e abrir pelo Teams | Zero infraestrutura nova; mesma origem das Listas |
| Azure Static Web Apps | Publicar o diretório | Custo baixo, CDN, domínio próprio |
| Servidor interno (IIS/nginx) | Servir o diretório por HTTPS | Só se já existir servidor web |

**A URL escolhida precisa ser cadastrada como *Redirect URI*** (tipo SPA) no
App Registration — senão o login volta com erro.

### 3.3. Provisionamento das Listas

Nomes **exatos** (o código procura por eles). Colunas que a sincronia exige:

| Lista | Colunas obrigatórias | Índice |
|---|---|---|
| `fact_Viagens` | `Carga_ID`(texto), `Atualizado_Em`(data/hora), `Timestamp_Sincronia`(data/hora), `Status_Atual`(escolha), `Aguardando_Carga`(sim/não) + campos de negócio | **`Carga_ID`, `Timestamp_Sincronia`** |
| `fact_StatusFrota` | `Movimentacao_ID`, `Carga_ID`, `Placa`, `Status_Anterior`, `Status_Novo`, `Setor`, `Data_Evento`, `Timestamp_Sincronia` | **`Timestamp_Sincronia`** |
| `dim_Veiculos` | `Placa`, `Transportadora`, `Tipo_Veiculo`, `Precisa_Revisao` | **`Placa`** |
| `LOG_EVENTOS` | `Evento_ID`, `Carga_ID`, `Placa`, `Acao`, `Setor`, `Data_Evento` | — |

Em **todas**: `Operador_ID`, `Operador_Nome`, `Operador_Setor`,
`Operador_Verificado`(sim/não), `Timestamp_Sincronia`.

> **Os índices não são otimização — são requisito.** Sem eles, o SharePoint
> **recusa** a consulta assim que a Lista passa de 5.000 itens, e a sincronia
> para de funcionar. As tabelas de histórico chegam lá em poucas semanas.

`Pra_Onde` é coluna de Escolha com exatamente: `FROTA PROPRIA`,
`CROSS-DOCKING`, `DEDICADA`, `RET FRIGO`.

### 3.4. Permissão — o passo que costuma ser esquecido

Escopos: `Sites.Selected` + `User.Read`.

`Sites.Selected` **não dá acesso a site nenhum por padrão.** É preciso conceder
ao site de Logística, uma vez:

```
POST https://graph.microsoft.com/v1.0/sites/{siteId}/permissions
{ "roles": ["write"],
  "grantedToIdentities": [{ "application": {
      "id": "{clientId}", "displayName": "Painel Logístico Suinco" }}] }
```

**Sem esse passo, tudo autentica normalmente e toda gravação retorna 403.**
É a causa mais provável de falha no primeiro teste.

---

## 4. Como o dado circula

### 4.1. Escrita — local primeiro

Toda ação grava no navegador e devolve o controle **na hora**; a subida
acontece em segundo plano. A Portaria registra chegada com o caminhão parado na
frente dela: travar o botão por rede seria degradar a operação.

```
ação → regra de negócio → DB → SuincoStore.save()
                                    ├─ localStorage (imediato)
                                    └─ upsert no Graph (em segundo plano)
                                          └─ falhou? → fila
```

### 4.2. Leitura — ciclo de 15 s

O SharePoint não empurra alterações. A cada 15 s o painel pergunta o que mudou
desde a última leitura. Também lê ao abrir e ao voltar para a aba.

### 4.3. Por que a carga sobe a partir do `save()`

As regras chamam `registrarMovimentacao()` **antes** de aplicar a mudança:

```js
registrarMovimentacao({ ..., statusNovo: 'Aguardando Embarque' });
c.status = 'Aguardando Embarque';   // ← só aqui a carga muda
```

Sincronizar de dentro do log subiria o estado **anterior**. Por isso a carga é
enviada de `SuincoStore.save()`, que roda depois da mutação. Nenhuma regra
precisou ser reordenada.

### 4.4. Fusão e conflito

1. Carga só no servidor → entra.
2. Nos dois lados → vence a de `Atualizado_Em` mais recente.
3. **Alteração local ainda não sincronizada nunca é sobrescrita** (`_pendente`).
4. Movimentações só são acrescentadas (log), deduplicadas por `id`.
5. O que vem do servidor é marcado como sincronizado, para não gerar eco.

A regra 3 vem antes de todas: sem ela, o ciclo apagaria da tela o que o
operador acabou de fazer.

---

## 5. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Rodapé em **"Modo Local"** | `SP_CONFIG` vazio | Preencher os três parâmetros |
| Rodapé em **"Modo Offline"**, fila crescendo | 401/403/timeout | Ver console (F12). 403 → §3.4 |
| **Toda gravação dá 403** | `Sites.Selected` sem concessão ao site | Rodar o POST da §3.4 |
| **401 depois de horas** | Token expirado, renovação falhou | O painel re-autentica; se persistir, verificar Conditional Access |
| Login **volta com erro** | *Redirect URI* não cadastrado | Cadastrar a URL exata (tipo SPA) |
| **Login não abre no Teams** | Popup bloqueado | Já usamos `loginRedirect`; verificar se a URL está na allowlist do app do Teams |
| Sincronia para **acima de 5.000 itens** | Coluna sem índice | Criar os índices da §3.3 |
| Setor **não vê** o que o outro fez | Ciclo parado ou offline | Conferir o rodapé; recarregar força leitura |
| **"3/4" vira data** no Excel | Autoformato do Excel | Já tratado no CSV; ver `DECISOES_CONFIRMADAS.md` §22 |
| Frota **desatualizada** | Base versionada por hash | Substituir o CSV e republicar; atualiza sozinho |
| **HTTP 429** | Limitação de taxa | A fila reenvia; se recorrente, aumentar `intervaloSincroniaMs` |

**Diagnóstico rápido no console (F12):**

```js
SuincoSharePoint.estado()          // 'local' | 'online' | 'offline'
SuincoSharePoint.estaConfigurado() // os 3 parâmetros estão lá?
SuincoSharePoint.pendentes()       // quantos registros na fila
SuincoSharePoint.ultimaSincronia() // instante da última leitura
await SuincoSharePoint.sincronizarAgora(false)   // força ciclo completo
```

---

## 6. Segurança — decisões e limites

### 6.1. Correção de XSS armazenado (achado ALTA, corrigido)

A operação compartilhada mudou a superfície de ataque: o painel passou a
renderizar dados que **outras pessoas escrevem**. A auditoria confirmou, com
payload real, que um `Carga_ID` com aspas quebrava o atributo `onclick` e
injetava código no navegador de **todos** os setores.

Corrigido em duas camadas:

1. **Fronteira** — `idSeguro()` valida identificadores contra
   `^[A-Za-z0-9_-]{1,64}$`; registro fora do formato é descartado. Protege todo
   uso do id de uma vez.
2. **Renderização** — `escJs()` neutraliza a aspa no nível do JavaScript antes
   de escapar para HTML. `esc()` sozinho não bastaria: o analisador de HTML
   decodifica `&#39;` de volta para aspa **antes** de o JavaScript ser lido.

### 6.2. Postura de segurança

| Item | Situação |
|---|---|
| Token | `sessionStorage` (não `localStorage`) — terminal compartilhado não herda sessão |
| Escopo Graph | `Sites.Selected`, não `Sites.ReadWrite.All` |
| Modo de simulação | Só ativa com a chave **e** endereço em localhost |
| Segredos no pacote | Nenhum `clientId`/`tenantId`/`siteId` embutido |
| XSS por texto | Escapado; payload sai como texto inerte |
| Poluição de protótipo | Não ocorre — objetos são reconstruídos com chaves fixas |

### 6.3. Limites conhecidos (MÉDIA, não resolvidos por design)

1. **A senha das abas está em texto puro no código.** É barreira contra clique
   acidental, não controle de acesso.
2. **O setor do operador é declarado pelo cliente.** Editando o `localStorage`,
   qualquer um assume qualquer setor.

Os dois só se resolvem com **permissão por Lista do SharePoint + SSO**, que é
exatamente o que este provisionamento entrega. Até lá, devem ser tratados como
o que são.

### 6.4. Recomendações à Segurança

1. Servir o `msal-browser.min.js` do próprio tenant, eliminando a CDN externa.
2. Definir `LOG_EVENTOS` como *Colaborar sem exclusão* — log não se apaga.
3. Revisar quem tem escrita nas Listas: com a operação compartilhada, escrita na
   Lista é escrita na tela de todos.
4. Habilitar retenção/versionamento nativo do SharePoint nas 4 Listas.

---

## 7. Próximos passos técnicos

**Antes da produção**
1. Preencher `SP_CONFIG` e validar em homologação.
2. Provisionar Listas, colunas e **índices**.
3. Conceder `Sites.Selected` ao site.
4. Cadastrar o *Redirect URI*.
5. Configurar o fluxo de arquivamento.

**Primeiras semanas**
6. Rodar os testes de `testes/` contra o ambiente real.
7. Piloto com um usuário de cada setor.
8. Medir o volume real e ajustar `intervaloSincroniaMs`.

**Evolução**
9. Notificação de mudança via Power Automate, reduzindo latência abaixo de 15 s.
10. Bloqueio otimista por versão, se a operação mostrar conflitos reais.
11. Aposentar a barreira de senha assim que a permissão por Lista estiver ativa.
