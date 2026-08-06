# Chamado de TI — Conexão do Power BI ao painel de embarque

> Preencha os campos entre colchetes antes de enviar.
>
> **Enquadramento:** é uma solicitação de liberação de URL e entrega de
> credencial de leitura — procedimento de rotina. Não pede mudança de política
> nem abertura de porta de banco. Anexe o documento `MODELO_DE_DADOS_BI.md`:
> ele responde antecipadamente a maior parte das perguntas técnicas.

---

**Título:** Conexão do Power BI ao painel de embarque — liberação de URL e credencial de leitura

**Categoria:** Acesso à internet / Business Intelligence

**Prioridade sugerida:** Média

**Solicitante:** [SEU NOME] — Logística

**Data:** [DATA]

---

## 1. O pedido

Solicito apoio para conectar o Power BI aos dados do painel de embarque do pátio.
São duas coisas:

**1.1** Liberar o acesso, a partir da estação que roda o Power BI, ao endereço:

```
https://api.embarquesuinco.com.br
```

Porta 443 (HTTPS). É o mesmo endereço já em uso pelo painel — se ele já estiver
liberado, este item já está atendido.

**1.2** Definir com vocês a forma segura de guardar e entregar a credencial de
leitura (um token). Ela existe e está no servidor; a questão é qual o
procedimento de vocês para esse tipo de segredo — cofre de senhas, variável de
ambiente do gateway, ou outro que já usem.

**Não estou pedindo:** abertura de porta de banco de dados, VPN, instalação de
software, nem alteração de política de segurança.

## 2. Como a conexão funciona

A leitura é feita por **HTTPS, com token, sobre a porta 443** — igual a consumir
qualquer API web. O Power BI usa o conector **Web**, nativo.

```
GET https://api.embarquesuinco.com.br/bi/dim_carga
Authorization: Bearer <token de leitura>
```

A resposta vem em JSON (ou CSV, se preferirem).

**Ponto que costuma gerar dúvida:** não há conexão direta ao PostgreSQL. A porta
5432 está fechada para a internet e permanece fechada — o banco só aceita conexão
de dentro do próprio servidor. O Power BI conversa com uma camada de leitura, não
com o banco.

## 3. O que o token permite, e o que não permite

| Permite | Não permite |
|---|---|
| Ler as 7 views do modelo de BI | Criar, alterar ou apagar qualquer dado |
| Baixar em JSON ou CSV | Acessar cadastro de operadores, e-mails ou senhas |
| | Acessar a trilha de auditoria |
| | Qualquer operação no painel |

É credencial de **leitura de relatório**, com escopo fixo definido no servidor.
Não é credencial administrativa.

Se o token for comprometido, ele é trocado em um comando e o anterior deixa de
funcionar imediatamente.

## 4. O que será lido

Sete conjuntos de dados, todos operacionais de expedição:

| Endereço | Conteúdo | Tipo |
|---|---|---|
| `/bi/dim_carga` | Cargas e seu estado atual | Dimensão |
| `/bi/fact_movimentacoes` | Histórico de mudanças de status | Fato |
| `/bi/tempos_por_etapa` | Duração de cada etapa, em minutos | Fato |
| `/bi/dim_frota` | Cadastro de veículos (749 placas) | Dimensão |
| `/bi/dim_transportadora` | Transportadoras | Dimensão |
| `/bi/dim_status` | As 6 etapas do fluxo e sua ordem | Dimensão |
| `/bi/dim_rota` | As 32 rotas oficiais | Dimensão |

Conteúdo: placas, transportadoras, clientes, destinos, pesos, horários de cada
etapa e o setor que registrou. **Sem dado financeiro, fiscal ou pessoal
sensível.** Não há CPF, valor, nota fiscal nem dado de folha.

O dicionário completo — cada coluna, tipo e significado — está no documento
anexo `MODELO_DE_DADOS_BI.md`.

## 5. Volume e frequência

| | |
|---|---|
| Registros hoje | Ordem de dezenas de milhares de linhas |
| Crescimento | Cerca de 6 linhas de histórico por carga programada |
| Frequência de atualização pretendida | [A DEFINIR — sugestão: de hora em hora] |
| Impacto no servidor | Baixo. São consultas indexadas sobre tabelas pequenas |

## 6. Sobre o servidor

| | |
|---|---|
| Natureza | Servidor da própria Suinco |
| Provedor | Hostinger (VPS contratado pela empresa) |
| Endereço | `api.embarquesuinco.com.br` — IP `2.25.95.253` |
| Administração | Interna |
| Certificado | Let's Encrypt, válido, renovação automática |
| Banco | PostgreSQL, acessível **somente** de dentro do servidor |
| Finalidade | Exclusivamente o painel de embarque do pátio |

## 7. Restrição por IP, se vocês preferirem

Se a política de vocês pedir, dá para restringir o acesso ao endereço de BI
apenas ao IP de saída da Suinco ou ao IP do gateway do Power BI. Basta me
informarem o endereço e eu configuro no servidor.

Sinalizo como opção disponível — não como pedido.

## 8. Publicação no Power BI Service

Se o relatório for publicado com atualização agendada, pode ser necessário um
**gateway de dados local** ou o cadastro da fonte web no serviço, conforme o
padrão que vocês já adotam para outras fontes.

Como esse ponto depende do ambiente de vocês, prefiro combinar em vez de propor.
Me digam como funcionam as outras fontes web da empresa que eu me adapto.

## 9. O que preciso de vocês

1. Confirmação de que `https://api.embarquesuinco.com.br` está acessível pela
   estação/gateway do Power BI.
2. Orientação sobre como armazenar o token conforme a política da empresa.
3. Definição de como fazer a atualização agendada, se o relatório for publicado.

Fico à disposição para acompanhar a configuração junto com a equipe.

[SEU NOME] — [TELEFONE/RAMAL]

---

## Anexo — teste rápido de conexão

Executado na estação que rodará o Power BI, confirma a conectividade antes de
qualquer configuração:

```
curl -i -H "Authorization: Bearer SEU_TOKEN" https://api.embarquesuinco.com.br/bi/dim_status
```

Resposta esperada: `HTTP/1.1 200` e um JSON com as 6 etapas do fluxo. É o menor
conjunto de dados do modelo, ideal para o teste.
