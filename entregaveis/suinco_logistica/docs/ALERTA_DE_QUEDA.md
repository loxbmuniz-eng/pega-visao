# Alerta de queda — como o Luis fica sabendo antes do pátio

Decisão de 26/08/2026: o aviso chega como **notificação no celular**.

---

## Por que o vigia tem que estar de fora

O servidor já se defende sozinho até certo ponto. O `systemd` reinicia o
processo se ele morre, e quem estiver com o painel aberto vê "⚠️ Modo
Offline" na hora. Isso cobre horário de trabalho e falha do processo.

Não cobre o resto: madrugada, fim de semana, feriado — e não cobre a
**máquina inteira** cair, que é justamente o caso pior.

E aqui está a parte que costuma ser esquecida: **nada que rode dentro do
VPS pode ser o alarme do VPS**. Se a máquina cai, o vigia cai junto e o
silêncio dele é indistinguível de "está tudo bem". Isso vale também para o
robô de WhatsApp que está planejado — ele vai morar no mesmo VPS, então
serve para mandar relatório, não para avisar que o servidor morreu.

Quem avisa precisa estar fora da máquina que ele vigia. É a única forma.

---

## O que vai ser vigiado

```
https://api.embarquesuinco.com.br/health
```

Esse endereço já existe e já foi feito para isto:

- **não pede login**, de propósito — monitoramento externo precisa alcançá-lo;
- **não devolve nada sigiloso** — só diz se o banco respondeu;
- **está de fora do limite de requisições**, então bater nele de 5 em 5
  minutos, para sempre, não tira vaga de ninguém;
- responde **200** com `{"ok":true, ...}` quando está tudo bem;
- responde **503** com `{"ok":false, ...}` quando **o processo está de pé mas
  o banco não responde** — que é uma queda tão real quanto a outra, e a que
  ninguém percebe olhando "o site abriu".

---

## Passo a passo

Recomendação: **UptimeRobot**, no plano gratuito. Motivo simples — o plano
grátis inclui verificação de 5 em 5 minutos e o aplicativo de celular com
notificação, que foi o que você escolheu. Alternativa equivalente:
**Better Stack**. Qualquer um dos dois serve; o que importa é estar fora do
VPS.

> As telas de cadastro desses serviços mudam de tempos em tempos. Se
> alguma etapa abaixo não bater com o que você está vendo, tire um print e
> me mande — o conteúdo do que preencher continua o mesmo.

**1. Criar a conta.** Vá em `uptimerobot.com`, plano gratuito, com o seu
e-mail.

**2. Instalar o aplicativo** no celular (UptimeRobot, na loja do Android ou
iPhone) e entrar com a mesma conta. É o aplicativo que faz a notificação
chegar — sem ele, o aviso só vai por e-mail.

**3. Criar o monitor.** "Add New Monitor", e preencher:

| Campo | O que pôr |
|---|---|
| Tipo | HTTP(s) |
| Nome | `API Embarque Suinco` |
| URL | `https://api.embarquesuinco.com.br/health` |
| Intervalo | 5 minutos |

**4. Ligar a notificação no celular.** Na parte de contatos/alertas do
monitor, marcar o aplicativo (aparece como *Mobile Push* ou *Push
Notification*) **e** o seu e-mail. Os dois: o push acorda, o e-mail deixa
rastro do horário.

**5. A configuração que quase todo mundo esquece — palavra-chave.** Se o
serviço permitir *Keyword monitoring*, troque o tipo para "Keyword" e use:

- palavra: `"ok":true`
- alertar quando: **a palavra NÃO existir**

Sem isso, o monitor só percebe que o endereço respondeu. Com isso, ele
percebe também quando o servidor responde **dizendo que está com problema**
— que é o caso do banco fora do ar. Se a tela não oferecer essa opção no
plano grátis, tudo bem: o 503 já dispara o alerta sozinho.

**6. Testar de verdade, uma vez.** Alarme que nunca tocou é igual a backup
que nunca foi restaurado. Combine um horário fora do pico, e no servidor:

```
ssh root@2.25.95.253
systemctl stop embarque-suinco
```

Espere o alerta chegar no celular — pode levar até o intervalo do monitor,
5 minutos. Assim que chegar:

```
systemctl start embarque-suinco
```

Confirme que o aviso de "voltou" também chega. Só depois disso o alerta
está de pé de verdade.

---

## Chegou o alerta. E agora?

Antes de qualquer coisa, o servidor já tem um comando que responde quase
tudo sozinho, e a saída dele foi escrita para ser fotografada e mandada no
grupo:

```
ssh root@2.25.95.253
sudo bash /opt/suinco-src/entregaveis/suinco_logistica/backend/diagnostico.sh
```

Ele não altera nada, só lê, e pode rodar com o pátio operando.

Se precisar agir na mão, na ordem:

```
systemctl status embarque-suinco      # o serviço está de pé?
journalctl -u embarque-suinco -n 50   # o que ele disse antes de cair
systemctl restart embarque-suinco     # levantar de novo
systemctl status postgresql           # o banco está de pé?
df -h                                 # o disco encheu?
```

Disco cheio é a causa mais comum de queda que "não tem motivo": o banco
para de gravar e o serviço cai atrás. Se `df -h` mostrar 100%, os backups
antigos em `/var/backups/embarque-suinco` são o primeiro lugar a olhar.

Mande a saída do diagnóstico. Com ela dá para dizer o que aconteceu sem
adivinhar.

---

## Alarme falso

Um alerta isolado que se resolve sozinho em minutos costuma ser oscilação
de rede entre o serviço de monitoramento e o VPS, não queda. O que importa
é padrão: **alerta que se repete no mesmo horário, ou que dura mais de um
intervalo, é para levar a sério.**

Não desligue o monitor por causa de alarme falso. Alarme desligado é a
forma mais rápida de voltar a não saber de nada.
