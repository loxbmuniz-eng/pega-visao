# Migrações escritas e ainda SEM CÓDIGO que as use

`readdirSync` do migrador e o glob do portão leem `migrations/*.sql` — **não
entram nesta pasta**. É de propósito.

## Por que esta pasta existe

Uma migração pronta e um recurso pronto não chegam no mesmo instante. Entre
os dois há um intervalo, e nele o arquivo tem que ficar em algum lugar. Os
dois lugares óbvios são ruins:

- **Na pasta de migrações:** o portão a declara pendente, o `atualizar.sh` a
  aplica, e a produção ganha colunas que nenhuma linha de código lê. Schema
  sem consumidor é ponto solto — ninguém sabe dizer, três meses depois, se
  aquilo está em uso ou é lixo.
- **Fora do repositório:** o container é efêmero. O arquivo simplesmente
  some, e com ele a decisão que estava escrita no cabeçalho.

Aqui ela fica versionada, legível e inerte.

## Como tirar daqui

1. `git mv migrations/rascunho/NNN_*.sql migrations/`
2. Acrescente a linha que o portão exige, no topo:
   `-- SEM ESTA MIGRAÇÃO: <o que exatamente para de funcionar>`
3. Implemente o código que a usa, com teste.
4. `npm run migrar` local e bateria antes do portão.

## O que está aqui hoje

Nada. A 054 saiu daqui em 18/09/2026, quando o recurso do frete editável foi
implementado — migração, rota, painel e teste. A pasta fica para o próximo
caso.
