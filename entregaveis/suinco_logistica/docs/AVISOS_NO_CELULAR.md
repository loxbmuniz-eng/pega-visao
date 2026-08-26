# Avisos no celular

Pedido do Luis em 26/08/2026: quem tem o painel instalado como aplicativo
recebe um aviso a cada caminhão que entra na portaria, a cada saída, e
quando a programação do dia termina.

---

## Quem recebe o quê

| Aviso | Vai para |
|---|---|
| 🚚 Caminhão entrou na portaria | Logística, Administração, **Expedição** |
| ✅ Caminhão seguiu viagem | Logística, Administração |
| 🏁 Fim da programação do dia | Todos os setores |

O recorte é do Luis, e não é detalhe. No dia 25/08 foram **22 cargas**.
Mandar tudo para todos seriam 44 avisos por dia em cada celular, e em uma
semana a operação silencia o aplicativo — aí o aviso que importa também
não chega. Menos gente recebendo é o que mantém o aviso valendo alguma
coisa.

**"Fim da programação" dispara sozinho**, quando o último caminhão do dia
sai — não quando alguém aperta "Fechar programação". O botão pode ser
esquecido, e também pode ser apertado com carga ainda no pátio (o
fechamento aceita forçar, com senha). Pátio vazio não mente.

Carga de **ontem** ainda parada no pátio segura o aviso: o ciclo não
fechou. Carga programada para **amanhã** não segura, senão o aviso nunca
sairia.

---

## Ligar a função — não tem passo manual

As duas chaves de segurança que o aviso precisa (padrão VAPID) são geradas
**pelo próprio instalador**, na primeira atualização que rodar depois de
26/08/2026. Não há comando extra para lembrar.

```
ssh root@2.25.95.253
bash /opt/suinco-src/entregaveis/suinco_logistica/backend/atualizar_tudo.sh
```

No fim ele imprime um bloco com `aviso no celular: ligado`. É por aí que se
confere.

> **Por que gerar sozinho.** O primeiro desenho pedia dois comandos à mão e
> três linhas coladas no `.env`. Passo manual em roteiro de implantação é
> passo que uma hora não é dado — e o resultado seria a função pronta e
> desligada, que é a pior combinação possível. Agora ela nasce ligada, pelo
> mesmo caminho que já gera o `JWT_SECRET`.

> **As chaves nunca são regeradas.** A inscrição que cada celular guardou é
> amarrada à chave pública que ele viu no dia; trocar a chave desinscreve
> todo mundo em silêncio. O instalador confere se já existe chave privada e
> sai fora se existir. Se um dia for mesmo preciso trocar, a tabela
> `push_inscricoes` tem que ser esvaziada junto e todos reativam o aviso.

> **A chave privada é segredo de verdade.** Quem a tem manda notificação em
> nome do painel para qualquer aparelho inscrito. Ela vive só no
> `/opt/embarque-suinco/.env`, com permissão 600 — não vai para o
> repositório, não vai para conversa nenhuma.

## Cada pessoa liga no aparelho dela

Ninguém pode ligar pelos outros: a permissão é dada no aparelho, uma vez.

**No Android:** abrir o painel, tocar no **🔔** no cabeçalho, tocar em
**Ligar avisos**, e aceitar quando o aparelho perguntar.

**No iPhone é obrigatório instalar antes.** O Safari em aba **nunca** vai
receber, por decisão da Apple. O caminho:

1. abrir o painel no Safari;
2. tocar em **Compartilhar** (o quadrado com a seta para cima);
3. tocar em **Adicionar à Tela de Início**;
4. abrir o painel **pelo ícone novo**, não pelo Safari;
5. aí sim tocar no 🔔 e em **Ligar avisos**.

Se a pessoa pular o passo 4, o botão não aparece — e a tela explica o
motivo em vez de só falhar.

**Mandar um teste depois de ligar.** O botão está ali do lado, e existe por
um motivo: sem ele, a pessoa só descobre que o aviso não chega no dia em
que precisava dele.

---

## Quando não chega

| O que a tela diz | O que fazer |
|---|---|
| "ainda não foi ligado no servidor" | As chaves VAPID não foram geradas. Voltar à seção de cima. |
| "no iPhone o aviso só funciona com o painel instalado" | Instalar na tela de início e abrir pelo ícone. |
| "os avisos foram bloqueados para este site" | A pessoa recusou a permissão antes. Liberar nas configurações do navegador, no aparelho dela. |
| "não consegui falar com o servidor" | Rede ou servidor fora. Tentar de novo depois. |
| Ligado, mas não chega nada | Mandar o teste. Se o teste chega e o aviso do caminhão não, o setor dela pode não receber aquele aviso — conferir a tabela do começo. |

**Trocou de celular?** Basta ligar no aparelho novo. O antigo morre
sozinho: o servidor apaga a inscrição na primeira resposta de "este
aparelho não existe mais", e depois de duas falhas seguidas de qualquer
outro tipo.

**Entrou com outra conta no mesmo aparelho?** O painel reinscreve sozinho
no login, para o aviso passar a ser de quem entrou. Terminal compartilhado
de pátio funciona.

---

## O que isto NÃO é

Não é o sino da tela. O painel já avisa quem está com ele aberto — isso
continua igual, pelo Socket.IO. O aviso no celular é para o aplicativo
**fechado**, com o telefone no bolso.

E não existe rota para mandar aviso para os outros. Os três avisos saem
sozinhos dos três fatos da operação, e de mais nada. Uma função "mandar
recado para o setor X" seria a porta perfeita para alguém apitar o celular
do pátio inteiro.
