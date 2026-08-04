# Notas sobre a Base de Frota real (recebida em 2026)

Origem: `FROTA_Base_Final_2026.xlsx` (227 placas, arquivo final já limpo) e
`Auditoria_FROTA_2026.xlsx` (como a limpeza foi feita, para rastreabilidade).
O CSV pronto para importar está em `frota_seed_2026.csv` (mesma pasta deste
documento, um nível acima), no formato `Placa,Transportadora,TipoVeiculo,PrecisaRevisao`
— já compatível com a importação em lote do painel.

## O que existe de verdade nos dados
Só **Placa, Transportadora, TipoVeiculo e um flag de revisão** (Sim/Não).
**Não existe** dado real de capacidade em kg, UF ou data da última
movimentação — esses campos foram mencionados como parte do modelo mas não
vieram populados nesta base. Ficam no schema como campos opcionais para o
futuro, sem valor inventado.

## Qualidade dos dados (da planilha de auditoria)
- **62 placas** ainda estão marcadas `Flag_Revisar = SIM` no arquivo final —
  não foram excluídas, só sinalizadas para alguém confirmar depois (ex:
  mesma placa apareceu associada a mais de uma transportadora ou tipo de
  veículo ao longo do histórico, e o sistema não pôde decidir sozinho qual
  vale). O painel deve exibir essa sinalização visualmente na tela de
  Cadastros → Frota, não escondê-la.
- **4 placas foram excluídas** por serem incertas/ilegíveis na origem (ex:
  dígito faltando, só 3 caracteres) — não estão no arquivo final, não
  precisam entrar no painel.
- Nomes de transportadora já vêm **normalizados** no arquivo final (ex:
  variantes como "AJB Transporte" / "AJBTransporte" / "AJBtransporte" já
  foram unificadas para "AJB Transportes" antes de gerar o arquivo). O
  painel não precisa reimplementar essa normalização — só precisa não
  quebrar ao importar nomes já limpos.
- Duas decisões humanas confirmadas que valem registrar (para não serem
  desfeitas por engano numa futura reimportação): "Coopdiesel" e "Marques e
  Silva" são empresas próprias (variantes de digitação agrupadas); "Marques
  Souza/Sousa" é uma empresa **diferente** de "Marques e Silva" e não deve
  ser mesclada.

## O que o painel deve fazer com isso
1. Importar `frota_seed_2026.csv` como dado inicial real da Frota (substitui
   qualquer exemplo/placeholder).
2. Exibir visualmente (badge ou coluna) quais placas têm `PrecisaRevisao =
   Sim`, para o Responsável pela Base de Frota revisar aos poucos, sem
   bloquear o uso normal do painel enquanto isso.

## Atualização 2026-07-31: mesclado com `Consulta_Veiculos_4.xlsx` (2 anos de movimentação)

Segunda fonte de dados recebida: extrato SQL bruto com 2 abas ("Consulta 1",
1.550 placas; "Consulta 2", 1.101 placas) cobrindo movimentações de veículos
nos últimos 2 anos, com **código da transportadora** (`Cod_transportador` /
`COD_TRANSPORTADORA`) e data da última movimentação — dados que a base
anterior não tinha. `frota_seed_2026.csv` foi atualizado no lugar (226 → 2.038
placas) seguindo o mesmo formato. Script de mesclagem não versionado (rodado
uma vez, ad-hoc); esta nota documenta as decisões para não se perderem numa
reimportação futura.

**Como a mesclagem decidiu "erro de digitação" vs. "transportadora real":**
Como o extrato traz código da transportadora, foi possível conferir por
código (não só pelo nome) quando duas grafias eram a mesma empresa. Casos
confirmados como **mesma empresa, grafia diferente** (mesmo código ou
nome idêntico salvo por typo/abreviação):
- "Cooperativa Riobranquense de Transportes" / "...de **Transprotes**" (troca
  de letras) — mesmo código-base, unificado.
- "Cooperativa de Transporte(s) Montenegro" (singular/plural).
- "Coopernova Cooperativa/Coop Riobranquense de Transporte".
- "Isavic Transporte(s) e Armazenamento/Armazenagem".
- "Transportes/Transportadora e Armazenagem/Armazem Zilli/Zille".
- Mais ~10 pares de código duplicado com o nome idêntico (mesma empresa
  recadastrada sob outro código ao longo do tempo).

Casos que **pareciam** digitação parecida mas são transportadoras
**diferentes de verdade** (não mesclados): pares curtos do tipo "AV
Transportes" / "GF Transportes" / "GDM Transportes" / "NSM Transportes" /
"LNF Transportes" — muitas transportadoras pequenas/autônomas no Brasil usam
sigla + "Transportes", o que gera alta similaridade textual sem ser erro de
digitação. Também não mesclados: "Cooperativa dos Transportadores Unidos"
≠ "...do Vale"; "Rodocunha" ≠ "Rodosousa"; "Transportadora Transol" ≠
"Translally" — nomes parecidos, empresas distintas.

**Resolvido o pedido explícito do usuário — "Coopdiesel" / "Cooperdiesel" /
"Coopediesel" são a mesma empresa:** o extrato confirma o nome oficial
"Coopdiesel Coop de PF e PJ Seg Transportes em Geral" (começa com D, não
"Coopdieser"). Isso resolve em definitivo o registro `INDEFINIDO (Coopdiesel
ou Cooperdiesel - confirmar)` que estava pendente desde a base anterior:
todas as variantes (`Cooperdiesel`, `INDEFINIDO (...)`) foram normalizadas
para **`Coopdiesel`** (15 placas). Isso é só a grafia — separadamente, o
extrato de 2 anos mostra que a maioria dessas placas específicas **já não
está mais com a Coopdiesel** hoje (foram para outras transportadoras, ver
abaixo); as duas coisas não se confundem.

**Pares confirmados de nome comercial (já usado na base antiga) ↔ razão
social (como aparece no extrato novo)**, por baterem em quase todas as
placas que usavam o nome comercial: AC ↔ AC Armazenagem e Crossdocking Ltda;
AJB Transportes ↔ Ailton Benedito Transportes Ltda; Baixotes Transportes ↔
Transportadora Baixotes Transportes Ltda; Cisne Branco ↔ Cisne Branco
Transportes Ltda EPP; Gold Star ↔ Gold Star Transportes Ltda; Coopertral ↔
Cooperativa Riobranquense de Transportes Ltda; Denia Transportes ↔ Cirio
Alves de Oliveira Junior - Transportes; Marizileia Transportes ↔ Comercio e
Transportes Marizileia Ltda; Marques e Silva ↔ Roosevelt Marques da Silva;
Max Frios ↔ Maxfrios Distribuidora e Transporte Eireli; Multi Express ↔
Transportadora Multi Express Ltda; MR Transportes ↔ MR Transportes de Cargas
VRB Ltda; LNF Transporte ↔ LNF Transportes Ltda ME; PH Fidelis ↔ PH Fidelis
Transportes e Representacoes Ltda; Posto Vanete ↔ Posto Vanete Ltda;
TransOliveira ↔ Eudes Transoliveira Eireli; Suinco ↔ Suinco Cooperativa de
Suinocultores Ltda; Transportes Marvel ↔ Transportes Marvel Ltda. Placas
novas dessas mesmas transportadoras entraram já com o nome comercial curto,
para não duplicar a mesma empresa sob dois rótulos diferentes no painel.

**Outras correções feitas nesta mesclagem:**
- 2 placas com `Transportadora = "Baixote Transportes"` (sem "s") e 1 com
  `"LMF Transporte"` eram erro de digitação interno da base anterior —
  confirmado porque nenhuma placa do extrato de 2 anos usa essas grafias
  (só existe "Baixotes" e "LNF"). Corrigidas.
- 3 placas (`EBQ6E39`, `EWJ7D98`, `FCT9179`) tinham as colunas trocadas:
  `Transportadora = "Container"` com `TipoVeiculo = "Carreta"`, quando
  "Container" é um tipo de veículo, não transportadora. O extrato confirma
  que essas 3 placas são da Gold Star (que já aparece com `TipoVeiculo =
  Container` em outras linhas) — corrigido para `Gold Star,Container`.
- 12 "placas" descartadas por serem lixo de dados na Consulta 2: 9 eram só
  números soltos (`109`, `18`, `235`...) sem formato de placa, e 3 eram
  variações corrompidas da placa real `NKY7226` (`NKY72226`, `NKY726`,
  `NKY72626`). A placa `NKY7226` verdadeira foi mantida normalmente.

**Placas que mudaram de transportadora ao longo dos 2 anos (churn real, não
erro de digitação):** quando uma placa já existente na base tinha uma
transportadora diferente da mais recente do extrato de 2 anos — e a
diferença não é um dos pares confirmados acima — a transportadora foi
**atualizada para a mais recente** (por data de última movimentação) e a
placa foi marcada/mantida `PrecisaRevisao = Sim`, já que o motorista/veículo
pode ter mudado de transportadora de verdade (comum no setor). 85 placas da
base antiga entraram nesse caso — inclui as 3 que estavam como "Rodosouza"
(nenhuma delas bate com a "Rodosousa Transportes Ltda" real do extrato;
viraram outras transportadoras mais recentes) e boa parte das que eram
"Coopdiesel"/"MR Transportes"/"Multi Express" (nomes que a base antiga
parece ter usado de forma mais genérica que o real, agrupando placas de
transportadoras diferentes sob o mesmo rótulo).

**1.824 placas novas** vieram só do extrato de 2 anos (não estavam na base
anterior de 227). 253 delas já aparecem com mais de uma transportadora
dentro do próprio extrato de 2 anos (`PrecisaRevisao = Sim`); as demais têm
transportadora única e consistente nas duas consultas (`Nao`). 30 placas
novas ficaram com `TipoVeiculo` vazio por falta do dado na origem — não
inventado.

## Atualização 2026-07-31 (2ª): substituição total por `FROTA_Base_Consolidada_2026.xlsx`

O usuário informou que a base anterior **estava puxando errado** e enviou
`FROTA_Base_Consolidada_2026.xlsx` como base **oficial e consolidada**.
Aplicada **substituição total**, conforme pedido: `frota_seed_2026.csv` foi
regravado do zero a partir desse arquivo. A base de 2.038 placas construída a
partir do extrato de 2 anos (`Consulta_Veiculos_4.xlsx`) foi **descartada**.

**Por que a contagem caiu de 2.038 para 749 — e por que isso é o correto:**
o extrato de 2 anos continha toda placa que passou pela Suinco no período,
incluindo veículos de terceiros que fizeram uma viagem única e placas já fora
de operação. Não era um cadastro de frota, era um histórico de movimentação.
A base consolidada é o cadastro de verdade. Menos linhas, porém corretas — e
a trava de Frota depende justamente disso: se a base tem placa que não
opera mais, a trava deixa de significar alguma coisa.

**Qualidade do arquivo recebido (conferida, não presumida):**
- 749 placas, **zero duplicadas**, **zero conflitos** (nenhuma placa com duas
  transportadoras ou dois tipos diferentes), **nenhum campo vazio**.
- 134 transportadoras distintas.
- Tipos: Carreta 477, 3/4 85, Bitruck 80, Truck 61, Toco 33, Container 13.
- Estrutura: sem cabeçalho, dados a partir da linha 3, colunas Placa /
  Transportadora / Tipo de Veículo.

**Sanitização aplicada na importação** (pedido explícito): placa forçada para
MAIÚSCULA e sem caracteres não alfanuméricos (traço, ponto, espaço). A mesma
normalização já era aplicada na busca, então digitar `aak-8958` encontra
`AAK8958`.

**Uma placa exige confirmação humana — `SIYOG36` (Suinco, 3/4).** Não bate com
o formato brasileiro (3 letras + dígito + alfanumérico + 2 dígitos). Quase
certamente é `SIY0G36`, com o algarismo **zero** no lugar da letra **O** —
confusão clássica de digitação. **Não foi corrigida automaticamente**: alterar
uma placa num sistema de registro por inferência é o tipo de "conserto" que
vira problema depois. Ficou na base com `PrecisaRevisao = Sim`, visível no
filtro "Só Precisa Revisão" em Cadastros → Frota.
**Atenção operacional:** enquanto não for confirmada, se o caminhão chegar com
a placa real `SIY0G36`, a trava de Frota vai **recusar** a criação da carga,
porque o que está cadastrado é `SIYOG36`. Vale confirmar na origem.

**Performance:** com a base indexada num `Map` (`indiceFrota()` em data.js), a
busca por placa passou de varredura linear para tempo constante — 20.000
buscas em ~5 ms na verificação automatizada. Importa porque `buscarFrota()` é
chamada a cada tecla digitada na Programação e uma vez por linha durante a
importação da base inteira.
