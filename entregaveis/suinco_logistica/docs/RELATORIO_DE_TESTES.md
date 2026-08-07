# Relatório de Testes — Painel Logístico Suinco

- **Data:** 02/08/2026
- **Escopo:** 10 baterias automatizadas, 78 verificações
- **Resultado:** todas as baterias sem falha; 1 vulnerabilidade ALTA encontrada e corrigida
- **Como reproduzir:** `testes/README.md`

> **NOTA (adicionada na auditoria de 07/08/2026 — não altera o relatório
> original abaixo).** Este documento fotografa o sistema em 02/08/2026,
> quando ele ainda usava SharePoint/Microsoft Graph/MSAL como backend. Em
> 05/08/2026 (commits `c4730d2`, `4d7d5e5`) essa arquitetura foi removida e
> substituída pelo backend Node/Express/PostgreSQL atual — login passou a
> ser e-mail e senha própria, sem MSAL, sem SharePoint, sem Graph.
>
> Os itens deste relatório que mencionam MSAL, CDN da Microsoft ou
> SharePoint (tabela da seção 5, item 5 da seção 6, comando de reprodução
> da seção 7) descrevem uma superfície que **não existe mais no sistema em
> produção**. Preservados aqui como registro histórico do que foi testado
> naquela data — não como lista de pendências atuais. A situação real de
> cada item está anotada entre colchetes onde aparece.

---

## 1. Resumo

| Bateria | Verifica | Verificações | Resultado |
|---|---|---|---|
| `auditoria` | Cores dos 6 status, contraste, relatório operacional, 3 exports | 14 | ✅ |
| `test_senha` | Barreira das abas restritas | 8 | ✅ |
| `test_praonde` | Tipo de Operação + migração de dados antigos | 9 | ✅ |
| `test_seed` | Versionamento da base de frota | 6 | ✅ |
| `test_csv` | Proteção do CSV contra autoformato do Excel | 9 | ✅ |
| `test_multiusuario` | 2 usuários, operação compartilhada | 10 | ✅ |
| `test_4setores` | Turno completo, 4 setores, 6 status | 16 | ✅ |
| `test_filas_tela` | Filas visíveis na tela, sem recarregar | 12 | ✅ |
| `test_10usuarios` | Concorrência com 10 terminais | 11 | ✅ |
| `test_seguranca` | Exploração real de 9 vetores | 9 | ✅ (após correção) |

**Ambiente:** Chromium headless; navegadores em contextos isolados (sem
compartilhar `localStorage` nem sessão, equivalente a máquinas distintas);
servidor implementando os endpoints do Graph usados pelo painel.

---

## 2. Concorrência — 10 usuários

O teste que responde "isso aguenta a operação real?".

```
=== A. 10 TERMINAIS SIMULTÂNEOS ===
[OK] 10 terminais conectados — 10/10 online

=== B. 6 CRIAÇÕES SIMULTÂNEAS ===
[OK] as 6 cargas chegaram ao repositório
[OK]    sem linha duplicada

=== C. CONFLITO: 2 OPERADORES NA MESMA CARGA ===
[OK] todos os 10 enxergam a carga antes do conflito
[OK] conflito NÃO duplicou a linha no repositório — 1 linha

=== D. CONVERGÊNCIA ===
[OK] os 10 terminais convergiram para o mesmo status (2s)
[OK] todos enxergam o mesmo conjunto de cargas — 1 visão

=== E. INTEGRIDADE DA AUDITORIA ===
[OK] log sem duplicatas — 7 eventos
[OK] log identifica os operadores — 6 nomes distintos
[OK] todo evento tem operador — 0 sem autor

=== F. CARGA ===
[OK] fact_Viagens: 1 linha por carga, não uma por status
[OK] nenhum erro de página em 10 navegadores
```

**Convergência em 2 segundos** com ciclo acelerado para 2 s no teste. Em
produção, com ciclo de 15 s, a convergência acompanha esse intervalo.

**Nota metodológica:** os navegadores sobem em escada, não no mesmo
milissegundo. Dez páginas de 765 KB carregando juntas saturam a máquina de
teste — o que mediria o ambiente, não o sistema. Operadores reais também não
abrem o painel no mesmo instante.

---

## 3. Operação compartilhada

### 3.1. Turno completo, 4 setores

```
[OK] Portaria vê a carga programada (500ms)
[OK] Portaria registra chegada
[OK] Expedição vê o veículo no pátio (0ms)
[OK] Expedição inicia o embarque
[OK] Expedição finaliza o embarque
[OK] Faturamento vê a carga carregada (500ms)
[OK] Faturamento fatura
[OK] Portaria vê que já foi faturada (500ms)
[OK] Portaria registra a saída
[OK] Logística vê o ciclo encerrado (0ms)

[OK] fact_Viagens: 1 linha, status final "Seguiu Viagem"
[OK] campos de negócio preservados — Rota 525, 30 ganchos, RET FRIGO
[OK] fact_StatusFrota registrou as 6 etapas
[OK] auditoria com os 4 operadores
```

### 3.2. Filas visíveis na tela

Este confere o que o operador **vê**, não só o dado — cada setor com sua aba
aberta, ninguém recarregando a página. Todas as 12 verificações passam.

Ele também tornou explícito um comportamento que parecia defeito e é intenção:
**a lista da Portaria é "Veículos no Pátio Agora"**. Quando a Expedição inicia
o embarque, o caminhão **não some** da tela do porteiro — continua no pátio, e é
ele quem libera a saída depois. O que muda é o status da linha.

---

## 4. Defeitos encontrados pelos testes

Vale registrar que **nenhum destes apareceu por inspeção de código**.

### 4.1. Sincronia subia o estado anterior da carga

**Como apareceu:** simulação de 2 usuários. A Portaria mudava o status, o
servidor recebia a escrita, o `Timestamp_Sincronia` atualizava — mas o
`Status_Atual` continuava o antigo, e a mudança nunca chegava aos outros.

**Causa:** as regras chamam `registrarMovimentacao()` **antes** de aplicar a
mudança no objeto; sincronizar de lá capturava o estado anterior.

**Correção:** a carga passou a subir de `SuincoStore.save()`, que roda depois
da mutação. Nenhuma regra de negócio foi reordenada.

### 4.2. Terminal parava de receber atualizações

**Como apareceu:** só com **três** navegadores. Com dois não reproduzia.

**Causa:** a marca do "até quando já li" era gravada **depois** da consulta.
Qualquer escrita que chegasse no meio ficava com timestamp menor que a marca e o
filtro a excluía **para sempre**. Não era atraso — era perda permanente.

**Correção:** marca tomada **antes** da consulta, com margem de 5 s para
diferença de relógio. Reler alguns registros é inofensivo (a fusão é
idempotente); perder um não tem recuperação.

### 4.3. Base de frota não se atualizava

**Como apareceu:** relato do gestor — uma placa exibindo a operadora no lugar
da transportadora.

**Causa:** a importação só rodava com a frota vazia. Navegadores que já tinham a
base anterior seguiam com **1.289 placas fora de operação** e **327 com
transportadora errada**.

**Correção:** versão da base passou a ser o hash do próprio arquivo.

### 4.4. XSS armazenado via `Carga_ID`

Ver §5.

---

## 5. Auditoria de segurança

Premissa: alguém com escrita na Lista (usuário interno mal-intencionado, conta
comprometida, script de alimentação) grava conteúdo arbitrário. O que isso causa
nos navegadores dos outros?

| # | Vetor | Antes | Depois |
|---|---|---|---|
| 1 | XSS por campos de texto | ✅ inerte | ✅ |
| 2 | **`Carga_ID` em `onclick`** | 🔴 **ALTA** | ✅ corrigido |
| 3 | Payload como texto | ✅ | ✅ |
| 4 | Poluição de protótipo | ✅ | ✅ |
| 5 | Burla do modo de simulação | ✅ | ✅ |
| 6 | Segredos no pacote | ⚠️ senha | ⚠️ conhecido |
| 7 | Integridade do script externo | ⚠️ CDN | ⚠️ conhecido [MSAL não existe mais — ver nota no topo] |
| 8 | Adulteração do armazenamento | ⚠️ setor | ⚠️ conhecido |
| 9 | Erros durante ataque | ✅ | ✅ |

### 5.1. O achado ALTA

**Vetor confirmado com payload real.** `Carga_ID` contendo aspas quebrava o
atributo `onclick` e injetava código no navegador de **todos** os setores.

Só passou a existir porque a operação compartilhada mudou a origem do
identificador: antes ele era gerado localmente; agora vem de uma fonte que
outras pessoas escrevem. **Funcionalidade nova traz superfície nova** — e é por
isso que a auditoria foi refeita depois da sincronia, não antes.

**Correção em duas camadas** (fronteira + renderização), detalhada em
`ARQUITETURA_E_OPERACAO.md` §6.1. Reteste: vetor fechado.

### 5.2. Os dois achados MÉDIA que permanecem

São **limitações declaradas**, não descuidos: a senha em texto puro e o setor
declarado pelo cliente. Ambos se resolvem com permissão por Lista + SSO. Estão
registrados aqui para que ninguém os descubra numa auditoria externa e conclua
que foram escondidos.

---

## 6. O que os testes NÃO cobrem

Igualmente importante:

1. **Nada foi testado contra um tenant real da Suinco.** Nenhum esteve
   disponível. O que se provou é que a camada de sincronia está correta;
   latência real, limitação de taxa e o formato dos campos provisionados só se
   confirmam na homologação.
2. **Volume de produção não foi simulado.** Os testes usam dezenas de registros,
   não os ~110 mil/ano esperados. O limite de 5.000 itens por consulta foi
   tratado por projeto (leitura incremental + índices), não por medição.
3. **Não houve teste com usuário real.** Usabilidade e treinamento só o piloto
   responde.
4. **Sem teste de rede degradada** (alta latência, perda de pacote). Só queda
   total e recuperação.
5. **Sem varredura de dependências.** *[Corrigido pela migração de
   05/08/2026 — ver nota no topo do documento.]* Na data deste relatório, o
   MSAL vinha da CDN da Microsoft sem verificação de integridade. O MSAL
   saiu do sistema junto com o SharePoint. O único script externo carregado
   hoje é o cliente Socket.IO, servido pela própria infraestrutura do
   projeto (`api.embarquesuinco.com.br`), não por CDN de terceiro — ver
   `ARQUITETURA_E_OPERACAO.md` §6.4 para a situação atual dessa dependência.

---

## 7. Como reproduzir

```bash
python3 ferramentas/mock_graph_server.py 8899 &   # servidor de simulação
python3 build_arquivo_unico.py                    # gera o arquivo único
python3 testes/test_10usuarios.py                 # concorrência
python3 testes/test_4setores.py                   # turno completo
python3 testes/test_filas_tela.py                 # filas na tela
python3 testes/test_seguranca.py                  # auditoria de segurança
```

Cada teste sai com código 0 quando passa. O TI pode rodar tudo na máquina dele.
