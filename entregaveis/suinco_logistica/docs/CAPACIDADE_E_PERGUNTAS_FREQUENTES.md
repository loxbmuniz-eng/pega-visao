# Capacidade, Concorrência e Perguntas Prováveis

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

- **Uso:** preparação para a reunião com TI e Diretoria
- **Data:** 01/08/2026
- **Documentos relacionados:** `RELATORIO_TI_HOSPEDAGEM.md` (v3), `RELATORIO_EXECUTIVO.md`

---

## PARTE 1 — A resposta direta

### "Quantos usuários simultâneos o painel suporta hoje?"

**Na configuração atual: nenhum, no sentido em que a pergunta é feita.**

Não é um limite de capacidade — é ausência de compartilhamento. Hoje o painel
grava em `localStorage`, ou seja, **no navegador de cada pessoa**. Dez pessoas
podem abrir o painel ao mesmo tempo sem qualquer lentidão, mas cada uma verá
apenas o que ela própria digitou. Não existe carga compartilhada.

A resposta honesta na reunião é: *"hoje são N cópias isoladas, não N usuários
de um sistema. O compartilhamento depende do provisionamento que estamos
pedindo."*

### "E depois que o TI provisionar o SharePoint?"

Aqui é preciso separar duas coisas que costumam ser confundidas:

| Capacidade | Situação após conectar |
|---|---|
| **Escrita** para o SharePoint / Power BI | ✅ Pronta e testada |
| **Login único (SSO)** | ✅ Pronta |
| **Operação offline com fila** | ✅ Pronta |
| **Trilha de auditoria por operador** | ✅ Pronta |
| **Leitura compartilhada entre setores** | ❌ **NÃO implementada** |

**Isto precisa ser dito com clareza:** conectar o SharePoint hoje faz o painel
**escrever** nas Listas — alimentando o Power BI — mas ele **não lê** de volta.
A Portaria continuaria não enxergando a carga criada pela Logística em outra
máquina.

Ou seja: o provisionamento entrega o **repositório e o BI**, não ainda a
**operação compartilhada**.

### O que falta para ser multiusuário de verdade

Três peças, todas do lado da aplicação (não do TI):

1. **Leitura inicial** — ao abrir, buscar as cargas do dia no SharePoint em vez
   de carregar só do navegador. A função de leitura (`pull`) já existe no
   adaptador, mas não é chamada por ninguém.
2. **Atualização periódica** — recarregar a cada 20–30 segundos, ou por
   notificação, para a Portaria ver o que a Logística acabou de criar.
3. **Resolução de conflito** — hoje não há trava nem verificação de versão. Se
   dois setores mexerem na mesma carga ao mesmo tempo, prevalece o último a
   gravar, sem aviso.

**Estimativa:** 2 a 3 dias de desenvolvimento, depois do ambiente provisionado.
Isso corrige a estimativa de "~1 hora" que consta na versão 3 do relatório do
TI — aquela hora cobre apenas ligar a escrita.

### Quando estiver completo, quantos usuários aguenta?

Para o porte da Suinco, **a quantidade de usuários não será o limite**. Quatro
setores, algo entre 10 e 30 pessoas simultâneas, é volume pequeno para o
SharePoint Online. Os limites reais que aparecem antes são de **volume de
itens** e **frequência de chamadas**, não de gente conectada:

| Limite | Valor | Impacto para a Suinco |
|---|---|---|
| Itens por Lista | 30 milhões | Muito acima do necessário |
| Itens retornados por consulta | **5.000** | **Este é o limite que importa** — ver Parte 2, pergunta 4 |
| Chamadas por aplicativo | Sujeito a limitação (HTTP 429) | Improvável no volume estimado |

**Volume estimado da operação:** cerca de 100 cargas/dia × 6 mudanças de status
= ~600 movimentações/dia. Cada movimentação gera 3 gravações (fato de status,
log de auditoria e a carga), ou seja **~1.800 gravações/dia** — algo em torno de
4 por minuto ao longo do expediente. É um volume baixo.

---

## PARTE 2 — Perguntas prováveis e como responder

### Do TI

**1. "Isso vai derrubar nosso SharePoint?"**
Não. O volume estimado é de ~1.800 gravações/dia, cerca de 4 por minuto. Um
site do SharePoint absorve isso sem esforço. Se houver limitação de taxa
(HTTP 429), o painel guarda o registro em fila e reenvia depois — não perde
dado nem trava a tela.
*Ressalva a declarar:* hoje a fila só é drenada quando a rede volta ou quando a
página é recarregada. Se houver limitação com a rede ativa, os registros ficam
na fila até o próximo desses eventos. É ajuste pequeno, mas ainda não feito.

**2. "Que permissão vocês estão pedindo?"**
`Sites.Selected` mais `User.Read`, no Microsoft Graph. `Sites.Selected` **não**
dá acesso a nenhum site por padrão — é preciso conceder explicitamente ao site
de Logística, uma vez. Recusamos deliberadamente `Sites.ReadWrite.All`, que
daria escrita em todo o tenant.
*Alerta:* se a concessão ao site específico não for feita, tudo autentica
normalmente e **toda gravação retorna 403**. É a causa mais provável de falha no
primeiro teste. O comando está na seção 9.2.1 do relatório técnico.

**3. "Onde ficam os tokens? É seguro em terminal compartilhado?"**
Em `sessionStorage`, não em `localStorage`. A diferença importa: em
`localStorage` o token sobreviveria ao fechamento do navegador e o próximo
operador herdaria a sessão do anterior — o que destruiria a trilha de auditoria.
Com `sessionStorage`, fechar o navegador encerra a sessão.

**4. "E o limite de 5.000 itens das Listas?"**
É o limite que realmente aparece. As tabelas de histórico (`fact_StatusFrota` e
`LOG_EVENTOS`) crescem cerca de 110 mil registros/ano cada e passam de 5.000 em
poucas semanas. Duas mitigações previstas: indexar as colunas usadas em filtro,
e o encerramento de ciclo, que arquiva o movimento do dia e mantém a lista
operacional na casa das centenas de itens.

**5. "De onde vem o MSAL? É seguro carregar de CDN?"**
Hoje vem da CDN da Microsoft (`alcdn.msauth.net`), **sem atributo `integrity`**
— o hash SRI precisa ser gerado do arquivo da versão que for fixada, e não foi
inventado. Se a política da casa exigir, o caminho recomendado é baixar o
`msal-browser.min.js` e servi-lo do próprio tenant, eliminando a dependência
externa. Está documentado dentro do `index.html`.

**6. "Quem consegue ver ou alterar o quê?"**
Hoje, qualquer pessoa com o arquivo. A permissão por setor no painel apenas
esconde abas — **não é controle de acesso**. E a senha das abas Programação e
Indicadores está em texto puro no código, visível com Ctrl+U. Controle real
passa a existir com a permissão por Lista do SharePoint mais o SSO, que é
exatamente o que este provisionamento entrega.

**7. "Precisa de servidor? Que custo de infraestrutura?"**
Nenhum servidor de aplicação. São arquivos estáticos (HTML/CSS/JS), sem
framework e sem processo de build. Custo incremental de licença: zero, usando
o SharePoint já contratado.

### Da Diretoria / Logística

**8. "Quando entra em produção?"**
Depende do provisionamento. Depois dele: ~1 hora para ligar a escrita, mais 2 a
3 dias para a leitura compartilhada, mais 1 semana de piloto com um usuário de
cada setor. O Excel/VBA atual permanece disponível durante todo o período — não
há descontinuação antes da validação.

**9. "E se a internet do pátio cair?"**
O registro é gravado no aparelho e sobe sozinho quando a conexão volta, na
ordem original. O rodapé passa a "Modo Offline" e mostra quantos registros estão
pendentes. *Limite honesto:* a fila vive no navegador daquele terminal. Se a
máquina for reinstalada com registros pendentes, esses registros se perdem — na
prática uma janela de minutos, mas não é zero.

**10. "Dois setores podem mexer na mesma carga ao mesmo tempo?"**
Podem, e hoje **não há trava**. Prevalece o último a gravar, sem aviso. Na
prática o risco é baixo porque cada setor age em uma etapa diferente do fluxo,
mas é uma lacuna conhecida e deve ser resolvida junto com a leitura
compartilhada.

**11. "O Power BI vai ler direto?"**
Sim. As Listas usam a nomenclatura do modelo já existente (`fact_Viagens`,
`fact_StatusFrota`, `dim_Veiculos`, `LOG_EVENTOS`), sem renomear nada.
*Ponto de atenção técnico:* hoje cada mudança de status grava **uma linha nova**
em `fact_Viagens`. Uma carga que percorre os 6 status gera 6 linhas. Para o BI,
isso precisa ser tratado como fato de snapshot (usando a linha mais recente por
`Carga_ID`) ou a gravação precisa passar a atualizar a linha existente em vez de
criar outra. **Recomendo decidir isso com o time de BI antes de publicar o
modelo** — é o tipo de coisa que, descoberta depois, obriga a refazer medidas.

**12. "Perdemos o histórico do Excel?"**
Não. O painel não apaga nem migra o Excel. O histórico antigo continua onde
está; o painel começa a acumular a partir da entrada em produção.

**13. "Quanto tempo para treinar a equipe?"**
Cada aba traz um box explicando o que se faz ali e qual o efeito no status da
carga. O fluxo tem 6 status e cada setor age em 1 ou 2 deles. A expectativa é
de treinamento curto, mas isso só se confirma no piloto.

**14. "E se a pessoa digitar a placa errada?"**
A trava de frota impede criar carga com placa fora do cadastro. Erro de
digitação não vira carga fantasma.
*Pendência:* a placa `SIYOG36` na base não segue o formato brasileiro e
provavelmente é `SIY0G36`, com zero no lugar da letra O. Enquanto não for
confirmada, se o caminhão chegar com a placa real a trava vai recusar a carga.

---

## PARTE 3 — O que NÃO afirmar na reunião

Lista curta do que seria exagero, e que o TI checaria em minutos:

1. ❌ "O painel já é multiusuário." — Não é. Falta o caminho de leitura.
2. ❌ "É só ligar e usar." — Ligar a escrita é rápido; a operação compartilhada
   ainda exige desenvolvimento.
3. ❌ "Já está integrado ao SharePoint." — O código está escrito; a conexão
   depende de três parâmetros que ainda não existem.
4. ❌ "Tem controle de acesso." — Tem barreira de interface. Controle de acesso
   vem com a permissão por Lista mais o SSO.
5. ❌ "Os dados estão seguros e com backup." — Estarão, com o SharePoint. Hoje
   estão no navegador de cada pessoa, sem backup nenhum.
