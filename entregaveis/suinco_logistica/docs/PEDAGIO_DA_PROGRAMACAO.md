# Vale-pedágio da programação do dia

Como o Luis pede, e o que é preciso ter em mãos para entregar na hora.

## O pedido dele, com as palavras dele

> "voce via puxar do relatorio e me informar qual tipo de veiculo por placa
> dentro do que te mandei do relatorio operacional com os respectivos cnpjs
> e numeros de carga e placa pra eu so copiar e colar no pamcard"

> "e faca o relacionamento e m,e traga a rota tambem quero tudo facil so pra
> colar sem erro"

E, depois de eu errar duas vezes qual placa era qual:

> "placa de cavalo é placa de cavalo, depois placa de carreta é placa de
> carreta"

> "voce precisa descriminar o que é cavalo, e o que é carreta, placa do
> cavalo sempre precisa ser fiel a placa do cavalo que enviei no documento
> placas, e placa carreta precisa ser fiel a coluna carreta"

**Combinado em 16/09/2026:** ele manda a programação do dia, e eu devolvo a
planilha pronta. Não construir adiantado.

## As três fontes — e o que cada uma responde

| Fonte | Responde | Onde fica |
|---|---|---|
| Relatório Operacional (PDF do painel) | quais cargas, placa, tipo, peso, rota, transportadora | ele manda no dia |
| Documento **PLACAS/MOTORISTA/TRANSPORTADORA** | **qual placa é cavalo e qual é carreta** | transcrito abaixo |
| Lista de CNPJ das transportadoras | o CNPJ de cada uma | **fica fora do repositório** — tem CPF de pessoa física no meio (LGPD). Ele reenvia |

## A regra que eu errei duas vezes

A placa que vem do Relatório Operacional **não é sempre a do cavalo.**
Conferido em 14/09/2026 contra o documento dele:

- `FTZ2138` e `PLI2A86` (AJB) estão na coluna **CAVALO**;
- `ASG3E42` (carga 118801, Baixotes) está na coluna **CARRETA** — o cavalo
  dela é `AXL7F05`.

Então: **procurar a placa do relatório NAS DUAS COLUNAS** da tabela abaixo,
e dizer no resultado de qual coluna ela veio. Nunca deduzir. Se a placa não
está em nenhuma das duas, isso é uma pendência para ele, não um palpite meu.

Veículo único (Truck, Bitruck, Toco, 3/4) repete a mesma placa nos dois
campos do PamCard — é o que o formulário pede.

## Categoria do PamCard, a partir do tipo

O PamCard cobra por eixo; o painel guarda o tipo. Esta é a conversão, e ela
é resposta minha, não pergunta devolvida a ele:

| Tipo | Eixos | PamCard |
|---|---|---|
| 3/4 · Toco | 2, rodagem dupla | `02` |
| Truck | 3, rodagem dupla | `04` |
| Bitruck | 4, rodagem dupla | `06` |
| Carreta · Container | 6 — cavalo trucado + semirreboque 3 eixos | `08` |
| …com cavalo TOCO | 5 eixos | `07` — exceção rara, corrigir no cartão |

## O documento de placas, transcrito (49 linhas, 14/09/2026)

Transcrito de uma imagem de planilha. **Se uma placa estiver errada, é aqui
que se corrige** — e vale confirmar com ele antes de usar numa que ele
ainda não viu.

| Cavalo | Carreta | Transportadora | Capacidade | Carroceria | Modelo | Motorista |
|---|---|---|---|---|---|---|
| FLI6I57 | FLI6I57 | Bitruck | 14500 | LISO | MARQUES E SILVA | JOSE DOS REIS |
| FPJ8I20 | FPJ8I20 | Bitruck | 14500 | LISO | MARQUES E SILVA | LEANDRO RIBEIRO DA SILVA |
| HHI2J62 | HHI2J62 | Toco | 8000 | LISO | MARQUES E SILVA | LUCIO CAIXETA DA CUNHA |
| HLMJ60 | HLMJ60 | Bitruck | 14500 | LISO | MARQUES E SILVA | — |
| FRS4F21 | FRS4F21 | Bitruck | 14500 | LISO | MARQUES E SILVA | ALEXANDRE ARAUJO ROCHA |
| RNC7B23 | RNC7B23 | Bitruck | 14500 | LISO | MARQUES E SILVA | ROOSEVELT MARQUES DA SILVA |
| FTZ2138 | FTZ2138 | Truck | 11000 | GANCHEIRO | AJB TRANSPORTES | AILTON JOAO BENEDITO |
| PLI2A86 | PLI2A86 | Bitruck | 14500 | GANCHEIRO | AJB TRANSPORTES | BRUNO ELMIRO BRITO |
| SDB3F38 | SDB3F38 | Bitruck | 14500 | GANCHEIRO | AJB TRANSPORTES | AGNALDO PEREIRA DOS ANJOS |
| QPA2533 | QPA2533 | Bitruck | 14500 | GANCHEIRO | AJB TRANSPORTES | WESLEY JUNIO BORGES NOGUEIRA |
| RNY8J16 | RNY8J16 | Bitruck | 14500 | GANCHEIRO | AJB TRANSPORTES | VAGNER GOMES FERREIRA |
| JJB8946 | JJB8946 | Truck | 11000 | LISO | DENIA TRANSPORTES | CARLOS DE JESUS |
| FVA0A95 | OPM7C45 | Carreta | 25000 | LISO | DENIA TRANSPORTES | FABIO RUBENS DE SOUZA |
| FOS0G91 | MJW3B58 | Carreta | 25000 | LISO | DENIA TRANSPORTES | ITALO AUGUSTO MEIRA DA SILVA |
| BEF2F52 | MHF6C63 | Carreta | 25000 | LISO | DENIA TRANSPORTES | VINICIUS SAMEUL PINHIRO GOMES |
| GHO0B35 | JOK0I54 | Carreta | 25000 | LISO | DENIA TRANSPORTES | EDILON ALVES |
| RCP3C74 | HFF5A12 | Carreta | 25000 | GANCHEIRO | DENIA TRANSPORTES | CIRIO PAI |
| GFK8A80 | GFK8A80 | Carreta | 25000 | LISO | DENIA TRANSPORTES | LUCAS |
| SRC5E94 | PZR6H54 | Carreta | 25000 | LISO | DENIA TRANSPORTES | JOSE FRANSCISCO |
| LMO2E88 | LMO2E88 | Truck | 11000 | LISO | AC Transportes | GREISON GERALDO VIERA LINO |
| QMX6767 | QMX6767 | Truck | 11000 | GANCHEIRA | AC Transportes | CARLOS HENRIQUE ELIAS |
| KZM7J54 | MCV0B18 | Carreta | 25000 | GANCHEIRA | AC Transportes | ADAUTON MARTIS |
| LMX2J66 | NCH2H15 | Carreta | 25000 | GANCHEIRA | AC Transportes | JORGE MORAES TEIXEIRA |
| RFU2H43 | QXA2439 | Carreta | 25000 | GANCHEIRA | AC Transportes | LUIZ ZOPELARO NETO |
| RFU2H43 | FDC7122 | Carreta | 25000 | GANCHEIRA | AC Transportes | ADAUTON MARTIS |
| RVI5B24 | RVI5B24 | Carreta | 25000 | GANCHEIRA | AC Transportes | — |
| QXZ0J42 | MXB5C08 | Carreta | 25000 | GANCHEIRA | AC Transportes | FRANSCISCO DE PAULO |
| SRC5E94 | KWE2J56 | Carreta | 25000 | GANCHEIRA | AC Transportes | ROBSON DA ROSA SOARES |
| RMT0F41 | MFT1J92 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | Luiz Felipe da Silveria |
| PYZ1D03 | PYZ1D03 | Bitruck | 25000 | LISA | BAIXOTES TRANSPORTE | DIEGO DO RESI SILVA |
| QUE3054 | MFM7A88 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | JUNIOR TEODORO |
| TCC6E88 | KLA7D76 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | DIERLY PEREIRA SOUSA |
| RNN8C45 | AJM6032 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | FLAVIO LUIS FERREIRA |
| RNP1D94 | OBE9G93 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | ANTAONIO MARCOS |
| RMT0F38 | OFN0964 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | ABEL VITOR PEREIRA |
| RNN8C45 | AJM6032 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | EDVAR LUIZ FERREIRA |
| RUI6E69 | HEE9J46 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | ANTAONIO MARCOS |
| TCD2B57 | MFJ7G71 | Carreta | 25000 | GANCHEIRA | BAIXOTES TRANSPORTE | WELITON MARCOS SANTOS |
| AXL7F05 | ASG3E42 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | vagner cunha |
| PVM9B33 | ILI3H03 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | Vinicius alves fonseca |
| TCC6E88 | MFF8I79 | Carreta | 25000 | LISA | BAIXOTES TRANSPORTE | — |
| QQY5F68 | NCX0I40 | Carreta | 25000 | GANCHEIRA | COOPEDIESEL | JEFIM |
| PYL7D42 | PUO6C29 | Carreta | 25000 | GANCHEIRA | COOPEDIESEL | ADOLFO |
| QQR3D51 | QJZ7E76 | Carreta | 25000 | GANCHEIRA | COOPEDIESEL | ADRIANO |
| RFE9C57 | MKP9C15 | Carreta | 25000 | GANCHEIRA | COOPEDIESEL | ANDRE MARCAL |
| PYL7D42 | PUC6C29 | Carreta | 25000 | GANCHEIRA | COOPEDIESEL | Lucas |
| HMV3J00 | HMV3J00 | Bitruck | 14501 | LISO | COOPEDIESEL | — |
| PUS8E44 | GWI8D40 | Carreta | 25000 | GANCHEIRA | COOPEDIESEL | — |
| RMH8G11 | RMS9H45 | Carreta | 25000 | LISA | MULTEXPRESS | LUCIANO |

### O que não fecha na planilha dele — perguntar, não consertar sozinho

- `SRC5E94` aparece como cavalo em **duas transportadoras diferentes**:
  DENIA (puxando `PZR6H54`) e AC Transportes (puxando `KWE2J56`).
- `RFU2H43` (AC), `TCC6E88` (Baixotes) e `PYL7D42` (COOPEDIESEL) aparecem
  cada um com **dois semirreboques**. Nesses o par depende da viagem.
- `RNN8C45` → `AJM6032` aparece **duas vezes idêntico**, com motoristas
  diferentes (Flavio Luis Ferreira e Edvar Luiz Ferreira).
- O código **83194** está em **MARQUES E SILVA e em COOPEDIESEL** ao mesmo
  tempo.
- `HLMJ60` tem **6 caracteres**, não 7.

### Transportadoras do documento que a lista de CNPJ não cobre

- **MARQUES E SILVA** e **AC Transportes** — não estão na lista de CNPJ.
- **COOPEDIESEL** — a lista tem DOIS: "COOPDIESEL MATHEUS" e
  "COOPDIESEL ERNANE". O documento de placas não diz qual. Perguntar.
- **MULTEXPRESS** no documento × "MULTI EXPRESS" na lista — provavelmente a
  mesma, mas o nome não é idêntico. Confirmar antes de usar.

## O que a planilha entregue precisa ter

Por carga, tudo pronto para colar no PamCard sem digitar nada:

CNPJ · placa do CAVALO · placa da CARRETA · nº da carga · categoria · rota

Mais: frota própria da Suinco fora (pedágio de veículo próprio não é
contratado), e o que faltar aparece como **pendência escrita**, nunca
preenchido por suposição.

A última entregue está em
`https://claude.ai/artifact/GTJkTWdz5QFbVXx1y7kvZm` (programação de 14/09).
O estado das marcações mora na própria página — ela se republica quando ele
marca. Antes de republicar, **ler a versão viva**: ele marca e desmarca por
lá, e sobrescrever isso apaga o trabalho dele.
