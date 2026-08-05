# Chamado de TI — Solicitação de análise de acesso ao painel de embarque

> Preencha os campos entre colchetes antes de enviar. Para obter hostname e IP,
> abra o Menu Iniciar em cada máquina afetada, digite `cmd` e cole:
> `hostname & ipconfig | findstr /i "IPv4"`
>
> **Tom deste documento:** solicitação, não instrução. A decisão sobre política de
> rede e segurança é da TI. O que trazemos aqui são os dados que levantamos do
> lado da operação, para apoiar a análise de vocês — não uma conclusão fechada.
> Documento redigido nesse registro de propósito: pedido que chega dizendo à TI o
> que ela deve fazer costuma voltar como negativa, e quem fica sem sistema é o
> pátio.

---

**Título:** Solicitação de análise — acesso ao painel de embarque a partir da rede interna

**Categoria:** Rede / Segurança

**Prioridade sugerida:** Alta — dois setores operando pelo celular

**Solicitante:** [SEU NOME] — Logística

**Data:** [DATA]

---

## 1. Solicitação

Gostaria da ajuda da equipe para avaliar um acesso que não está funcionando a
partir das estações da rede interna.

Trata-se do painel de controle de embarque do pátio, sistema da própria Suinco,
hospedado em servidor contratado e administrado pela empresa. A página abre
normalmente, mas o login não completa em duas estações, de setores diferentes.

Levantamos alguns dados do lado da operação e encaminho abaixo para a avaliação de
vocês. Não temos visibilidade das políticas de rede e segurança, então a leitura
final e a decisão sobre o que fazer são de vocês — fico à disposição para o que
for definido.

## 2. Setores e estações afetadas

| Setor | Usuário | Máquina (hostname) | IP interno | Sistema | Sintoma |
|---|---|---|---|---|---|
| Gestão | Alysson (gestor) | `[HOSTNAME]` | `[IP]` | Windows | Painel abre, login não completa |
| Faturamento | João Pedro (faturista) | `[HOSTNAME]` | `[IP]` | Windows | Painel abre, login não completa |

## 3. Dados do destino, caso seja necessário para a análise

| Item | Valor |
|---|---|
| Domínio da API | `api.embarquesuinco.com.br` |
| Domínio do painel | `embarquesuinco.com.br` |
| IP do servidor | `2.25.95.253` |
| Porta | `443` (HTTPS) |
| Protocolos | HTTPS e WebSocket (`wss://`), ambos sobre a porta 443 |

Observação que pode ser útil: o WebSocket é usado para a atualização em tempo real
entre os setores. Se apenas o HTTPS estiver acessível, o painel continua
funcionando, porém com atraso de cerca de 15 segundos entre uma tela e outra.

## 4. O que observamos

Rodamos um diagnóstico pelo navegador nas duas estações. Os resultados:

| Etapa | Resultado |
|---|---|
| Resolução de DNS | OK |
| Conexão TCP/TLS com o servidor | OK — resposta em 470 ms |
| Leitura da resposta HTTP pelo navegador | Falha — `TypeError: Failed to fetch` |
| Requisição de autenticação (login) | Falha — mesmo erro |

A conexão se estabelece e o servidor recebe a requisição, mas a resposta não chega
completa ao navegador.

## 5. Testes comparativos que fizemos

Antes de abrir o chamado, tentamos eliminar as causas que estavam ao nosso alcance:

| Cenário | Rede | Resultado | O que isso descarta |
|---|---|---|---|
| Estações afetadas | Interna | Falha | — |
| Mesmos usuários, mesmo endereço, celular | 4G | Funciona | Servidor e aplicação |
| Estação afetada, janela anônima | Interna | Falha | Extensão de navegador |
| Estação afetada, outro navegador | Interna | Falha | Configuração de perfil |
| Duas máquinas, setores diferentes | Interna | Falha nas duas | Problema pontual de estação |

Mesmo servidor, mesmo endereço, mesmas credenciais, mesmos usuários. A única
variável que muda o resultado é a rede utilizada.

Por isso viemos até vocês: pelo que conseguimos observar daqui, o comportamento
parece estar relacionado ao caminho de rede interno. Mas essa é uma leitura feita
de fora, sem acesso à infraestrutura — vocês têm elementos que nós não temos.

## 6. Verificação que talvez ajude na análise

Se for útil, este comando executado em qualquer estação da rede interna (`cmd`)
mostra a resposta bruta do servidor:

```
curl -i -H "Origin: https://embarquesuinco.com.br" https://api.embarquesuinco.com.br/health
```

O servidor envia o cabeçalho `access-control-allow-origin` em todas as respostas,
sem exceção. Comparar essa saída na rede interna com a mesma saída em uma conexão
externa pode indicar se algo no caminho está alterando a resposta.

Se preferirem outro método de verificação, sem problema — foi apenas o recurso que
tínhamos aqui.

## 7. Sobre o servidor, para o registro do chamado

| | |
|---|---|
| Natureza | Servidor da própria Suinco |
| Provedor | Hostinger (VPS contratado pela empresa) |
| Administração | Interna |
| Certificado | Let's Encrypt, válido, renovação automática |
| Finalidade | Exclusivamente o painel de embarque do pátio |
| Terceiros | Nenhum — não há serviço externo nem tráfego de terceiros |
| Dados trafegados | Operacionais de expedição (cargas, placas, horários). Sem dado financeiro, fiscal ou pessoal sensível |

Se houver necessidade de documentação adicional sobre o servidor para atender a
alguma exigência de vocês, é só pedir que providencio.

## 8. Impacto atual, para vocês dimensionarem a prioridade

O painel controla a fila do pátio em tempo real e é usado ao mesmo tempo por
Logística, Portaria, Expedição e Faturamento.

- O gestor está sem acompanhar a operação pela tela do computador, onde ficam a
  programação do dia e os relatórios.
- O Faturamento não consegue operar pela estação, que é onde a nota é emitida.

No momento, os dois estão trabalhando pelo celular em rede móvel pessoal. Sinalizo
esse ponto porque imagino que seja relevante para vocês: é uma operação da empresa
acontecendo fora da rede corporativa, e a alternativa atual não é a que a gente
gostaria de manter.

## 9. Disponibilidade

Fico à disposição para acompanhar qualquer teste, no horário que for melhor para a
equipe, e para fornecer o que mais precisarem do lado do sistema.

Agradeço desde já pela análise.

[SEU NOME] — [TELEFONE/RAMAL]
