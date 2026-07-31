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
