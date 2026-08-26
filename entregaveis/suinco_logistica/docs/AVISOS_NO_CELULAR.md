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

## Ligar a função — uma vez só, no servidor

Sem isto a função fica desligada e o painel diz isso na cara, em vez de
oferecer um botão que não faria nada.

**1. Gerar as duas chaves** (no servidor, uma vez na vida):

```
ssh root@2.25.95.253
cd /opt/embarque-suinco && npx web-push generate-vapid-keys
```

**2. Guardar no `.env` do servidor:**

```
nano /opt/embarque-suinco/.env
```

Preencher as três linhas:

```
VAPID_PUBLICA=<a Public Key que apareceu>
VAPID_PRIVADA=<a Private Key que apareceu>
VAPID_CONTATO=mailto:lo.xbmuniz@gmail.com
```

**3. Aplicar:**

```
cd /opt/suinco-src && git pull
sudo bash entregaveis/suinco_logistica/backend/atualizar.sh
```

> **A chave privada é segredo de verdade.** Quem a tem manda notificação em
> nome do painel para qualquer aparelho inscrito. Ela nunca sai do `.env`
> do servidor — não vai para o repositório, não vai para conversa nenhuma.
>
> **Trocar as chaves desinscreve todo mundo.** A inscrição que cada celular
> guardou é amarrada à chave pública que ele viu no dia. Se um dia for
> preciso trocar, a tabela `push_inscricoes` tem que ser esvaziada junto e
> todos reativam o aviso.

---

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
