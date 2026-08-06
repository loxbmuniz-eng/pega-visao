# Chamado de TI — Liberação de acesso a URLs

> Preencha os campos entre colchetes antes de enviar. Para obter hostname e IP,
> abra o Menu Iniciar em cada máquina afetada, digite `cmd` e cole:
> `hostname & ipconfig | findstr /i "IPv4"`
>
> **Enquadramento deste pedido — importante.** Não estamos pedindo mudança de
> política de rede: estamos pedindo a liberação de **dois endereços específicos**,
> que é procedimento de rotina. Pedido enquadrado como "mexer na política de
> segurança" vira reunião e demora semanas; pedido de liberação de URL é o que a
> TI faz todo dia. O conteúdo técnico é o mesmo — o enquadramento é que decide a
> velocidade da resposta.

---

**Título:** Liberação de acesso a duas URLs — painel de embarque do pátio

**Categoria:** Acesso à internet / Liberação de URL

**Prioridade sugerida:** Alta — dois setores sem acesso pela estação

**Solicitante:** [SEU NOME] — Logística

**Data:** [DATA]

---

## 1. O pedido

Solicito a liberação de acesso, a partir das estações da rede interna, aos
seguintes endereços:

```
https://embarquesuinco.com.br
https://api.embarquesuinco.com.br
```

São os dois endereços do painel de controle de embarque do pátio — sistema da
própria Suinco, em servidor contratado e administrado pela empresa.

## 2. Detalhamento dos endereços

| Endereço | Função | Porta | Protocolo |
|---|---|---|---|
| `https://embarquesuinco.com.br` | Painel (interface que o usuário abre) | 443 | HTTPS |
| `https://api.embarquesuinco.com.br` | Servidor de dados do painel | 443 | HTTPS e WebSocket (`wss://`) |

IP do servidor da API: `2.25.95.253`

Os dois endereços trabalham juntos: o painel abre pelo primeiro e busca os dados
no segundo. Liberar só um não resolve — é essa a situação de hoje, e é o que
descrevo no item 4.

Sobre o WebSocket: é o que faz a atualização em tempo real entre os setores.
Se ele não estiver acessível, o painel continua funcionando, porém com atraso de
cerca de 15 segundos entre uma tela e outra.

## 3. Um ponto adicional sobre a liberação

Se o filtro de conteúdo ou o antivírus corporativo fizer inspeção de HTTPS
(decriptação do tráfego), peço que os dois endereços sejam incluídos também na
lista de exceção dessa inspeção, junto com a liberação.

Explico por que menciono isso: o acesso aos endereços já está passando hoje — a
conexão se estabelece normalmente. O que não funciona é a resposta chegar completa
ao navegador, e pelo que conseguimos observar isso é compatível com alteração do
tráfego no caminho. Como não temos visibilidade da configuração de vocês, deixo o
apontamento e a avaliação fica com a equipe.

## 4. Situação atual

O painel abre normalmente nas estações. O que não completa é o login — a tela fica
esperando resposta que não chega.

Estações afetadas:

| Setor | Usuário | Máquina (hostname) | IP interno | Sistema |
|---|---|---|---|---|
| Gestão | Alysson (gestor) | `[HOSTNAME]` | `[IP]` | Windows |
| Faturamento | João Pedro (faturista) | `[HOSTNAME]` | `[IP]` | Windows |

## 5. Testes que já fizemos

Antes de abrir o chamado, eliminamos o que estava ao nosso alcance:

| Cenário | Rede | Resultado | O que descarta |
|---|---|---|---|
| Estações acima | Interna | Não funciona | — |
| Mesmos usuários, mesmo endereço, celular | 4G | **Funciona** | Servidor e sistema |
| Estação afetada, janela anônima | Interna | Não funciona | Extensão de navegador |
| Estação afetada, outro navegador | Interna | Não funciona | Configuração de perfil |
| Duas máquinas, setores diferentes | Interna | Não funciona nas duas | Problema pontual de estação |

Mesmo servidor, mesmo endereço, mesmas credenciais, mesmos usuários — a única
variável que muda o resultado é a rede utilizada. Por isso o pedido de liberação.

Detalhe técnico do diagnóstico, caso ajude: a conexão TCP/TLS completa em 470 ms,
mas o navegador não consegue ler a resposta (`TypeError: Failed to fetch`).

## 6. Verificação, se for útil

Este comando, em qualquer estação da rede interna (`cmd`), mostra a resposta bruta
do servidor:

```
curl -i -H "Origin: https://embarquesuinco.com.br" https://api.embarquesuinco.com.br/health
```

O servidor envia o cabeçalho `access-control-allow-origin` em todas as respostas.
Comparar essa saída na rede interna com a mesma saída em conexão externa pode
indicar se algo no caminho está alterando a resposta.

Se preferirem outro método, sem problema — foi apenas o recurso que tínhamos aqui.

## 7. Sobre o destino, para o registro do chamado

| | |
|---|---|
| Natureza | Servidor da própria Suinco |
| Provedor | Hostinger (VPS contratado pela empresa) |
| Administração | Interna |
| Certificado | Let's Encrypt, válido, renovação automática |
| Finalidade | Exclusivamente o painel de embarque do pátio |
| Terceiros | Nenhum — não há serviço externo nem tráfego de terceiros |
| Dados trafegados | Operacionais de expedição (cargas, placas, horários). Sem dado financeiro, fiscal ou pessoal sensível |

Se precisarem de documentação adicional sobre o destino para atender alguma
exigência de vocês, é só pedir que providencio.

## 8. Impacto atual

O painel controla a fila do pátio em tempo real e é usado ao mesmo tempo por
Logística, Portaria, Expedição e Faturamento.

- O gestor está sem acompanhar a operação pela estação, onde ficam a programação
  do dia e os relatórios.
- O Faturamento não consegue operar pelo computador, que é onde a nota é emitida.

Hoje os dois trabalham pelo celular em rede móvel pessoal. Sinalizo porque imagino
que seja relevante para vocês: é uma operação da empresa acontecendo fora da rede
corporativa, e não é a alternativa que gostaríamos de manter.

## 9. Disponibilidade

Fico à disposição para acompanhar o teste depois da liberação, no horário que for
melhor para a equipe.

Agradeço desde já.

[SEU NOME] — [TELEFONE/RAMAL]
