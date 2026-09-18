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

- **`054_frete_combinado_a_mao.sql`** — frete combinado no telefone, digitado
  à mão, guardado ao lado do calculado em vez de no lugar dele. Pedido do
  dono em 17/09/2026: *"caso eu precise alterar o valor do frete, ele também
  deve ser editável"*. A decisão (a) dele já está registrada no cabeçalho do
  arquivo: o valor digitado FICA quando o KM muda depois, e a linha avisa que
  o KM mudou — é por isso que existe a coluna `frete_manual_km`.
  Falta: domínio, rota, painel, relatório e testes.
