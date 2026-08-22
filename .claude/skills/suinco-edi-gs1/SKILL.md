---
name: suinco-edi-gs1
description: "Romaneio, aviso de embarque (DESADV/ASN) e identificação GS1 (SSCC, GTIN, GLN) para o Embarque Suinco atender embarcadores e compradores internacionais. Use ao trabalhar em romaneio, aviso de embarque, integração com sistema de cliente, identificação de palete/produto/local, ou ao planejar exportação. Também ao decidir se um documento deve ser PDF para humano ou mensagem para máquina."
---

# EDI e GS1 — do PDF para o que a máquina lê

## O ponto de partida honesto

O sistema hoje tem **zero** EDI/GS1 (verificado: `MIGRATION-GAPS.md` G6). O que
existe é forte no que se propõe: romaneio, relatório operacional, comprovante de
devolução e ficha de carga em **PDF, auditados campo a campo**, com autoria,
horário fiel e lacres.

**PDF resolve o humano e não resolve a máquina.** O comprador internacional não
lê PDF: o sistema dele espera uma mensagem estruturada antes de o caminhão
chegar. Enquanto o romaneio for só PDF, cada cliente novo exige alguém
redigitando — e redigitação é onde nasce divergência de nota.

## As três identificações, e o que muda em cada uma

| Padrão | O que identifica | Estado no Suinco |
|---|---|---|
| **GTIN** | o produto comercial | `dim_produtos.codigo` é **interno** (ex.: `30110`) — não é GTIN |
| **SSCC** | a **unidade logística** (palete/caixa expedida) | não existe; a carga é rastreada pela **placa** |
| **GLN** | o local (planta, doca, destino, cliente) | `dim_clientes.codigo` e `dim_rotas.codigo` são internos |

A lacuna estrutural: **o sistema rastreia o veículo, não o que está dentro
dele.** SSCC é justamente o elo que falta — e é o mesmo elo que a
rastreabilidade sanitária precisa (ver `suinco-sanitary-traceability`). Resolver
os dois juntos, nunca em projetos separados.

## A mensagem que importa primeiro: DESADV / ASN

O aviso de embarque é o que o comprador quer **antes** da chegada: o que vem,
em quantos paletes, com que peso, em qual veículo, com qual lacre.

O Suinco **já tem quase todo o conteúdo**: número da carga, placa, transportadora,
motorista, destino, rota, peso, quantidade de entregas, lacres (até 3) e horário
de saída fiel. Falta a **estrutura por unidade logística** (o que tem em cada
palete) e a **identificação global**.

Ordem sensata:

1. **DESADV/ASN** — maior valor imediato, dado já existente em quase totalidade;
2. **RECADV** (aviso de recebimento) — fecha o ciclo e conversa com o módulo de
   **devoluções**, que hoje registra divergência só do lado de cá;
3. **INVOIC** — depois, junto do faturamento internacional (exige moeda, que é o
   gap G2 de i18n).

## Regras de projeto

1. **O documento humano continua.** EDI não substitui o PDF: a Portaria confere
   papel na mão do motorista. São duas saídas da **mesma fonte de dados** —
   nunca duas montagens paralelas, que divergem em semanas.
2. **Identificação global é cadastro, não campo de tela.** GTIN/GLN entram em
   `dim_produtos`/`dim_clientes` como coluna nova, preenchida com validação de
   dígito verificador. Sem DV validado, EDI quebra no cliente e você descobre
   pelo telefone.
3. **SSCC é sequencial e não se repete em 12 meses.** Exige prefixo de empresa
   GS1 (a cooperativa precisa ser associada — item de negócio, não de código) e
   contador persistente com garantia transacional. Reutilizar SSCC corrompe a
   rastreabilidade do comprador, não a sua.
4. **Toda mensagem enviada é registrada como enviada**, com conteúdo e resposta
   — mesma disciplina de `log_eventos`. Auditor pergunta "provou que avisou?".
5. **Multi-tenant desde o desenho**: prefixo GS1 é **por tenant**. Nasce com
   `tenant_id`, ou vira migração retroativa de identificador — o pior tipo.

## Antes de dar por pronto

- [ ] Dígito verificador validado na gravação (GTIN-13/14, SSCC-18, GLN-13).
- [ ] Contador de SSCC transacional, sem reuso, testado sob concorrência.
- [ ] Mensagem gerada da mesma fonte do PDF (uma verdade, duas saídas).
- [ ] Envio, conteúdo e resposta do parceiro registrados e consultáveis.
- [ ] Prefixo GS1 por tenant.
- [ ] Teste com a estrutura real do parceiro, não com exemplo do manual.

## Não invente

Layout de EDI é **acordo bilateral**: ANSI X12 (EUA) e EDIFACT (Europa) diferem,
e cada comprador tem sua variação. Sem a especificação **do parceiro real** em
mãos, não escreva o mapeamento — modele o dado interno (SSCC, GTIN, GLN,
lote) e deixe a tradução para quando a especificação existir. Dado bem
modelado se traduz; mapeamento adivinhado se joga fora.
