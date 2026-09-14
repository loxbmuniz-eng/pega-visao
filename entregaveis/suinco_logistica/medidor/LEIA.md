# Medidor de lotação

Responde **quantos operadores o painel aguenta com folga** — não "aguenta 100?",
mas "a partir de quantos começa a doer?", porque folga é a distância entre o que
se usa e o teto.

Nasceu do pedido do dono, 14/09/2026: *"eu nao quero travamento funcionando com
100 pessoas se eu quiser, por isso quero essa folga"*.

## Rodar

Sempre em **banco e porta próprios** — nunca contra o banco da bateria, senão
contamina o portão:

```bash
cd backend
psql -h 127.0.0.1 -U "$PGUSER" -d embarque_suinco -c 'CREATE DATABASE suinco_medidor'
PGDATABASE=suinco_medidor npm run migrar
PGDATABASE=suinco_medidor node ../medidor/semear.mjs 150
PORT=3040 PGDATABASE=suinco_medidor RATE_LIMIT=100000 RATE_LIMIT_LOGIN=100000 \
  PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node src/servidor.js &
node ../medidor/medidor.mjs --api http://127.0.0.1:3040 --rampa 50,100,150
```

O semeador planta volume **igual ao de produção** (761 cargas, 3.044
movimentações, 77.095 clientes, medidos no VPS em 12/09/2026). Medir contra
banco vazio responde uma pergunta que ninguém fez.

## O que ele conta como dor, na ordem em que o operador sente

1. **401** — foi expulso para a tela de login;
2. **5xx / erro de rede** — a gravação dele não entrou;
3. **p95 acima do alvo** — a tela "está lenta".

## Os números que ficaram de marco

Medidos em 14/09/2026, neste contêiner (4 núcleos; o VPS tem 2).

**Antes da correção da rajada (#65)** — cadastrar uma placa fazia todo terminal
reler o pátio inteiro:

| operadores | ciclo normal p95 | a rajada p95 | dados na rajada |
|---:|---:|---:|---:|
| 10 | 197 ms | 710 ms | 12,3 MB |
| 50 | 130 ms | 2.192 ms | 61,3 MB |
| 100 | 263 ms | 4.035 ms | **122,6 MB** |
| 150 | 285 ms | 6.656 ms | 183,9 MB |

Linear: **1,23 MB e 41 ms por operador conectado**.

**Depois da #65** — o aviso leva o veículo e ninguém relê nada:

| operadores | ciclo normal p95 | expulsões | erros |
|---:|---:|---:|---:|
| 50 | 87 ms | 0 | 0 |
| 100 | 91 ms | 0 | 0 |
| 150 | **148 ms** | 0 | 0 |

**Teto medido: 150 operadores**, contra um alvo de 1 s.

## Por que o veredito julga o ciclo normal

Até a #65 o veredito olhava a rajada, porque era o que a operação vivia. Hoje o
painel não faz mais aquela leitura. A fase da rajada continua no medidor **de
propósito**: ela é a referência do que se evitou e o alarme se alguém
reintroduzir o comportamento. Mas quem decide a lotação é o ciclo de 15 s, que
roda o dia inteiro em todo terminal aberto.
