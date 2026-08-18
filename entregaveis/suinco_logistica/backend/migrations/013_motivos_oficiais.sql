-- =====================================================================
-- 013 — Catálogo oficial de motivos de devolução
-- ---------------------------------------------------------------------
-- Fonte: planilha "Motivos.xlsx" enviada pela operação (Bruna,
-- 18/08/2026) — o catálogo real usado nas capas de devolução, com o
-- código na frente (601–651) e as categorias Transporte, Qualidade,
-- Comercial e Expedição. Semeado por migração para chegar à produção
-- junto com o código, sem depender de digitação manual.
--
-- ON CONFLICT DO NOTHING: rodar de novo não duplica, e motivos criados
-- pela tela depois convivem com estes.
-- =====================================================================

INSERT INTO dim_motivos_devolucao (motivo) VALUES ('601 — Referente a NF de Devolução Parcial:________ de __/__/____.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('602 — Transporte/Erro na entrega. Transportadora não realiza entrega nessa rota, mercadoria foi fora de rota.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('603 — Transporte/Atraso na entrega. Cliente devolveu a mercadoria pelo atraso da entrega do produto.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('604 — Transporte/Falta de mercadoria. Ocorreu falta de mercadoria no ato da entrega.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('605 — Transporte/Erro na entrega. Monitoramento da transportadora solicitou o debito da nota .Autorizado pelo') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('606 — Transporte/Temperatura. Devolução do produto por falta de temperatura no ato da entrega.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('607 — Transporte/Avaria. Mercadoria chegou no cliente avariada, gerando a devolução do produto.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('608 — Transporte/Erro na entrega. Giro de mercadoria incorretamente.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('609 — Transporte/Erro na entrega. Debito 100% do operador por falta de ocorrência no grupo.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('626 — Transporte/Erro de monitoramento. Monitoramento não finalizou o processo no tempo hábil.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('627 — Transporte/Erro de monitoramento. Logistica efetuou o lançamento da refatura incorreta.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('649 — Transporte/Inversão de mercadoria: produto de código devolvido e substituído pelo cod.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('610 — Qualidade/Quebra de peso.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('611 — Qualidade/Ausência de vácuo. Cliente optou pela devolução do produto pois o mesmo consta sem vácuo.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('612 — Qualidade/Inversão de mercadoria. Produto foi incorreto dentro da caixa.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('613 — Qualidade/Data critica. Cliente optou pela devolução do produto por conta da data.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('614 — Qualidade/Temperatura. Carga saiu da Suinco fora da temperatura ideal.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('615 — Qualidade/Ausência de vácuo. Sac autorizou o descarte do produto, protocolo:') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('616 — Qualidade/Inversão de mercadoria. Sac solicitou o recolhimento, protocolo:') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('648 — Qualidade/datação incorreta gerando devolução devido à data.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('617 — Comercial/Pedido não solicitado pelo cliente.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('618 — Comercial/Erro de pedido. Cliente informou ter recebido um pedido parecido com esse, pedido duplicado.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('619 — Comercial/Erro de pedido. Vendedor digitou quantidade de caixas a mais do que foi solicitado pelo cliente.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('620 — Comercial/Erro de pedido. Vendedor digitou o valor do produto errado que foi combinado.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('621 — Comercial/Erro de pedido. Vendedor digitou o pedido para o cliente errado.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('622 — Comercial/Erro de pedido. Vendedor digitou o produto errado para o cliente.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('623 — Comercial/Cliente comprou de outro fornecedor.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('628 — Comercial/Cliente sem espaço. Cliente em balanço.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('629 — Comercial/Cliente sem espaço. Cliente sem espaço para recebimento.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('630 — Comercial/Cliente sem espaço. Cliente informou que frízer estragou. Portanto não consegue receber.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('631 — Comercial/Estabelecimento fechado. Não foi possível localizar o cliente para efetuar a entrega.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('632 — Comercial/Contratual/Trocas. Gestor Comercial autorizou lançar a nota parcial que o cliente emitiu contra a Suinco.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('633 — Comercial/bloqueado na UF. Cliente de origem estava bloqueado na UF. Faturado para o vendedor.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('646 — Comercial/Volumetria/Falta de volume para entrega na rota.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('647 — Comercial/Corte de produto gerou devolução do pedido, faturado com falta de item.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('650 — Comercial/Suporte comercial:digitação interna incorreta.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('651 — Comercial/Vendedor não prestou suporte ao cliente para esclarecer a situação e evitar a devolução.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('624 — Expedição/Atraso na entrega. Suinco atrasou o carregamento da carga gerando devolução por conta de atraso.') ON CONFLICT DO NOTHING;
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('625 — Expedição/Erro de carregamento. Expedição não carregou a mercadoria gerando falta no ato da entrega.') ON CONFLICT DO NOTHING;
