# Chamado de TI — Liberação de rede para o painel de embarque

> Preencha os campos entre colchetes antes de enviar. Para obter hostname e IP,
> abra o Menu Iniciar em cada máquina afetada, digite `cmd` e cole:
> `hostname & ipconfig | findstr /i "IPv4"`

---

**Título:** Liberar `api.embarquesuinco.com.br` no firewall e excluir da inspeção de HTTPS

**Categoria:** Rede / Segurança — liberação de acesso

**Prioridade:** Alta — dois setores sem acesso pelo computador

**Solicitante:** [SEU NOME] — Logística

**Data:** [DATA]

---

## 1. Resumo

O painel de controle de embarque do pátio — sistema da própria Suinco, hospedado
em servidor contratado e administrado pela empresa — não funciona nas estações da
rede interna. A página abre normalmente, mas o login não completa.

O problema atinge **dois setores distintos, em máquinas distintas**, com sintoma
idêntico. Os mesmos usuários, com as mesmas credenciais e no mesmo endereço,
acessam normalmente pelo celular em rede móvel 4G.

## 2. Setores e estações afetadas

| Setor | Usuário | Máquina (hostname) | IP interno | Sistema | Sintoma |
|---|---|---|---|---|---|
| Gestão | Alysson (gestor) | `[HOSTNAME]` | `[IP]` | Windows | Painel abre, login não completa |
| Faturamento | João Pedro (faturista) | `[HOSTNAME]` | `[IP]` | Windows | Painel abre, login não completa |

## 3. O que solicito

Duas ações. **As duas são necessárias** — a primeira sozinha não resolve.

### 3.1 Liberar no firewall e no proxy web

| Item | Valor |
|---|---|
| Domínio da API | `api.embarquesuinco.com.br` |
| Domínio do painel | `embarquesuinco.com.br` |
| IP do servidor | `2.25.95.253` |
| Porta | `443` (HTTPS) |
| Protocolos | HTTPS e WebSocket (`wss://`), ambos sobre a porta 443 |

O WebSocket é usado para atualização em tempo real entre os setores. Se apenas o
HTTPS for liberado, o painel funciona com atraso de 15 segundos em vez de ser
imediato.

### 3.2 Excluir os domínios da inspeção de HTTPS (SSL/TLS Inspection)

Este é o item que efetivamente resolve. Solicito a inclusão de
`api.embarquesuinco.com.br` e `embarquesuinco.com.br` na lista de exceção de
decriptação do antivírus corporativo e do firewall.

**Não se trata de desativar a inspeção** — apenas de adicionar dois domínios à
lista de exceções, recurso presente em todos os appliances e normalmente já
utilizado para bancos e sistemas de folha de pagamento.

## 4. Evidência técnica

Diagnóstico executado nos navegadores das duas estações afetadas:

| Etapa testada | Resultado |
|---|---|
| Resolução de DNS | OK |
| Conexão TCP/TLS com o servidor | **OK** — resposta em 470 ms |
| Leitura da resposta HTTP pelo navegador | **Falha** — `TypeError: Failed to fetch` |
| Requisição de autenticação (login) | **Falha** — mesmo erro |

A conexão se estabelece normalmente e o servidor recebe a requisição, mas as
respostas HTTP não chegam íntegras ao navegador. O padrão é característico de
reescrita ou remoção de cabeçalhos de resposta por appliance intermediário.

## 5. Teste comparativo — isolamento da causa

| Cenário | Rede | Resultado |
|---|---|---|
| Estações afetadas | Interna (Suinco) | **Falha** |
| Mesmos usuários, mesmo endereço, celular | 4G (externa) | **Funciona** |
| Estação afetada, janela anônima | Interna | **Falha** |
| Estação afetada, outro navegador | Interna | **Falha** |

Mesmo servidor, mesmo endereço, mesmas credenciais, mesmos usuários.

- A janela anônima descarta **extensão de navegador**.
- O segundo navegador descarta **configuração de perfil**.
- Duas máquinas de setores diferentes descartam **problema pontual de estação**.
- O funcionamento em 4G descarta **servidor e aplicação**.

A única variável que altera o resultado é a rede utilizada.

## 6. Como validar em 1 minuto

No prompt de comando (`cmd`) de qualquer estação da rede interna:

```
curl -i -H "Origin: https://embarquesuinco.com.br" https://api.embarquesuinco.com.br/health
```

**Resultado esperado:** `HTTP/1.1 200`, contendo o cabeçalho
`access-control-allow-origin: https://embarquesuinco.com.br`.

Se esse cabeçalho **não aparecer** na rede interna, mas aparecer em uma conexão
externa (celular em 4G, por exemplo), fica objetivamente confirmado que a resposta
está sendo alterada dentro da rede corporativa. O servidor envia esse cabeçalho
para todas as requisições, sem exceção.

## 7. Sobre o servidor

| | |
|---|---|
| Natureza | Servidor da própria Suinco |
| Provedor | Hostinger (VPS contratado pela empresa) |
| Administração | Interna — pela própria Suinco |
| Certificado | Let's Encrypt, válido, renovação automática |
| Finalidade | Exclusivamente o painel de embarque do pátio |
| Terceiros | Nenhum. Não há serviço externo nem tráfego de terceiros |
| Dados | Operacionais de expedição (cargas, placas, horários). Sem dado financeiro, fiscal ou pessoal sensível |

## 8. Impacto operacional

O painel controla a fila do pátio em tempo real, usado simultaneamente por
Logística, Portaria, Expedição e Faturamento.

- O **gestor** está sem acompanhar a operação pela tela grande, onde ficam a
  programação do dia e os relatórios.
- O **Faturamento** não consegue operar pelo computador, que é onde a nota é
  emitida.

Ambos dependem hoje do celular em rede móvel pessoal para trabalhar — o que, além
de improdutivo, tira a operação do controle de rede da empresa, que é justamente o
oposto do que a inspeção de HTTPS pretende garantir.

## 9. Contato

Fico à disposição para acompanhar a validação junto à equipe, inclusive
remotamente durante o teste.

[SEU NOME] — [TELEFONE/RAMAL]
