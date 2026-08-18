-- =====================================================================
-- 014 — Base oficial de produtos (INFORMAÇÕES DE PRODUTOS.xlsx)
-- ---------------------------------------------------------------------
-- Fonte: planilha oficial enviada pela operação (18/08/2026), 16 abas por
-- categoria. dim_produtos deixa de ser só código+nome+quilo e vira o
-- cadastro de produtos do painel — mesmo papel que dim_veiculos tem para
-- a Frota. A aba INATIVOS entra com ativo = FALSE (produto existe para
-- histórico, mas não é sugerido em lançamento novo).
--
-- peso_caixa_kg só é preenchido quando o Peso Líquido da planilha é UM
-- número limpo; textos como "Média 20" ou "16 a 25" ficam registrados em
-- peso_liquido_txt sem virar número inventado. ON CONFLICT preserva um
-- quilo já ajustado manualmente pela tela (COALESCE).
-- =====================================================================

ALTER TABLE dim_produtos ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT '';
ALTER TABLE dim_produtos ADD COLUMN IF NOT EXISTS temperatura TEXT NOT NULL DEFAULT '';
ALTER TABLE dim_produtos ADD COLUMN IF NOT EXISTS validade TEXT NOT NULL DEFAULT '';
ALTER TABLE dim_produtos ADD COLUMN IF NOT EXISTS ean TEXT NOT NULL DEFAULT '';
ALTER TABLE dim_produtos ADD COLUMN IF NOT EXISTS peso_liquido_txt TEXT NOT NULL DEFAULT '';
ALTER TABLE dim_produtos ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1152','COSTELA SUINA CONG. (AF)','AF-VÁCUO Desossa','C','365 dias','7898950833075','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1153','COSTELA SUINA RESF.','AF-VÁCUO Desossa','R','21 dias','7898950833617','Média 20',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1173','COSTELA SUINA RESF. VACUO','AF-VÁCUO Desossa','R','21 dias','7898659790105','Média 20',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1183','COSTELA SERRADA SUINA RESF - L','AF-VÁCUO Desossa','R','21 dias','7898659790532','Média 22,5',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1401','CARRE SUÍNO RESFRIADO','AF-VÁCUO Desossa','R','21 dias','7898659791232','Média 21',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('2022','CARRE SUINO CONG. (AF)','AF-VÁCUO Desossa','C','365 dias','7898950833105','Média 19',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('2032','BISTECA CONGELADA','AF-VÁCUO Desossa','C','365 dias','7898950833136','13',13,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('2033','BISTECA SUINA CONGELADA - 4 UN','AF-VÁCUO Desossa','C','365 dias','7898659791713','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10032','PERNIL S/OSSO CONGELADO (AF)','AF-VÁCUO Desossa','C','365 dias','7898950833112','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10051','STINCO SUINO CONGELADO UN','AF-VÁCUO Desossa','C','365 dias','7898659793229','11.5',11.5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10052','PERNIL COM OSSO CONGELADO (AF)','AF-VÁCUO Desossa','C','365 dias','7898950833143','Média 20',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10055','PERNIL SUINO COM PELE E OSSO CONG AF','AF-VÁCUO Desossa','C','365 dias','7898659791492','Média 20',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10062','PERNIL S/OSSO CONG. FRACIONADO (AF)','AF-VÁCUO Desossa','C','365 dias','7898659790914','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10063','PERNIL SUINO COM OSSO FRACIONADO','AF-VÁCUO Desossa','C','365 dias','7898658791034','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10132','LOMBO SUINO CONG. (AF)','AF-VÁCUO Desossa','C','365 dias','7898950833082','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10213','PALETA COM PELE E OSSO CONG AF','AF-VÁCUO Desossa','C','365 dias','7898659790891','15 a 20 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10312','BARRIGA COMUM CONGELADA (AF)','AF-VÁCUO Desossa','C','365 dias','7898950833167','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10403','PERNIL SUINO S/OSSO RESF','AF-VÁCUO Desossa','R','21 dias','7898950833570','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10413','PERNIL SUINO S/OSSO RESF VACUO','AF-VÁCUO Desossa','R','21 dias','7898659791744','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10423','PERNIL SUINO RESF VACUO - TRES PARTES','AF-VÁCUO Desossa','R','21 dias','7898659790624','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10503','LOMBO SUÍNO RESF','AF-VÁCUO Desossa','R','21 dias','7898950833587','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10523','FILE MIGNON RESF. PA','AF-VÁCUO Desossa','R','21 dias','7898950833624','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10533','SOBREPALETA SUINA RESF. PA','AF-VÁCUO Desossa','R','21 dias','7898950833631','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10543','FILE MIGNON RESF. VACUO','AF-VÁCUO Desossa','R','21 dias','7898659790112','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10553','SOBREPALETA SUINA RESF VÁCUO','AF-VÁCUO Desossa','R','21 dias','7898659791294','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10563','LOMBO SUINO RESF.VACUO','AF-VÁCUO Desossa','R','21 dias','7898659790129','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10572','SOBREPALETA S/ OSSO CONG. (AF)','AF-VÁCUO Desossa','C','365 dias','7898950833099','Média 21,5',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10585','SOBREPALETA COM OSSO FATIADA CONG - INTERFOLHADA','AF-VÁCUO Desossa','C','365 dias','7898659793090','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10586','SOBREPALETA COM OSSO FATIADA CONG - 4 UN','AF-VÁCUO Desossa','C','365 dias','7898659793083','13',13,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10603','PALETA S/OSSO  RESF','AF-VÁCUO Desossa','R','21 dias','7898950833600','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10703','BARRIGA COMUM RESF','AF-VÁCUO Desossa','R','21 dias','7898950833594','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10713','BARRIGA COMUM RESF VACUO','AF-VÁCUO Desossa','R','21 dias','7898659791645','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10717','PICANHA SUINA RESFRIADA VACUO','AF-VÁCUO Desossa','R','21 dias','7898659790648','Média 22',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10737','PICANHA SUÍNA RESFRIADA VÁCUO – SUINCO','AF-VÁCUO Desossa','R','21 dias','7898659791188','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10763','PICANHA SUÍNA CONGELADA (AF)','AF-VÁCUO Desossa','C','365 dias','7898659791409','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10826','PICANHA SUÍNA CONGELADA UNITÁRIA','AF-VÁCUO Desossa','C','365 dias','7898659791560','24',24,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10901','CARNE RESF DE SUÍNO SEM OSSO - RECORTE MAGRO','AF-VÁCUO Desossa','R','20 dias','7898659793243','19,5 a 20,5',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10625','TOUCINHO LOMBAR COM PELE CONGELADO','AF-VÁCUO Desossa','C','365 dias','7898659790259','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1002','ESPINHACO CONGELADO DE SUINO','DESOSSA (SACARIAS)','C','365 dias','7898659790389','19',19,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('2102','PERNIL C/ PELE  OSSO CONG','DESOSSA (SACARIAS)','C','365 dias','7898659790907','Máximo 18,600 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10018','OSSO CONGELADO DE SUINO (NAO COMESTIVEL) - FEMUR','DESOSSA (SACARIAS)','C','365 dias','7898659791416','17',17,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10020','OSSO CONGELADO DE SUINO (NAO COMESTIVEL) - UMERO','DESOSSA (SACARIAS)','C','365 dias','7898659791614','17',17,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10222','PALETA CONG SEM OSSO INDUSTRIAL','DESOSSA (SACARIAS)','C','365 dias','7898659790518','Máximo 22,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10250','PALETA RESF SEM OSSO INDUSTRIAL','DESOSSA (SACARIAS)','R','20 dias','7898649793106','Máximo 22,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10302','BARRIGA SUINA COMUM CONG.','DESOSSA (SACARIAS)','C','365 dias','7898659790921','Variável',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10612','TOUCINHO LOMBAR CONG.','DESOSSA (SACARIAS)','C','365 dias','7898659790488','19',19,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10622','TOUCINHO LOMBAR CONG. C/ PELE','DESOSSA (SACARIAS)','C','365 dias','7898659790495','Variável',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10632','PELE COM GORDURA CONG','DESOSSA (SACARIAS)','C','365 dias','7898659791010','Média 19 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10907','CARNE MECANICAMENTE SEPARADA CONGELADA DE SUINO','DESOSSA (SACARIAS)','C','90 dias','7898659793205','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('11002','RECORTE GORDO CONG.','DESOSSA (SACARIAS)','C','365 dias','7898659793182','Variável',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('11022','RECORTE MAGRO CONG.','DESOSSA (SACARIAS)','C','365 dias','7898659792901','Variável',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('11102','PELE SUINA CONG. (PERNIL/PALETA)','DESOSSA (SACARIAS)','C','365 dias','7898659793137','16',16,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12302','RECORTE DE COSTELA SUINO CONG.','DESOSSA (SACARIAS)','C','365 dias','7898659790471','Média 19 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12313','ESPINHACO PORCIONADO CONGELADO DE SUINO - SUÃ','DESOSSA (SACARIAS)','C','365 dias','7898950833648','18',18,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12402','PELE LOMBAR SUÍNA CONG','DESOSSA (SACARIAS)','C','365 dias','7898659790426','19',19,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12501','PELE RESFRIADA DE SUINO - PERNIL/PALETA','DESOSSA (SACARIAS)','R','','7898659793120','19',19,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1192','COSTELINHA SUINA CONG. (COZINHA PREMIADA)','CORTES PREMIADA','C','365 dias','7898950833051','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1196','COSTELA EM RIPA COZINHA PREMIADA','CORTES PREMIADA','C','365 dias','7898950833044','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1214','COSTELA GRILL CONGELADA COZINHA PREMIADA','CORTES PREMIADA','C','365 dias','7898659791935','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10182','LOMBO SUINO CONG. (COZINHA PREMIADA)','CORTES PREMIADA','C','365 dias','7898950833013','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10452','FILE MIGNON SUINO CONG. (COZINHA PREMIADA)','CORTES PREMIADA','C','365 dias','7898950833037','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10581','SOBREPALETA SUINA CONG COZINHA PREMIADA','CORTES PREMIADA','C','365 dias','7898659791478','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('902','CARCAÇA SUÍNA RESF COM CABEÇA','CARCAÇAS','R','12 dias','7898659790563','',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('922','CARCAÇA TIPO EXPORTAÇÃO (GANCHO)','CARCAÇAS','R','12 dias','7898659790556','',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('981','MEIA CARCACA SUINA TIPO EXPORTAÇÃO (CAIXA)','CARCAÇAS','R','12 dias','7898950833884','',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('982','MEIA CARCACA TIPO JUDIA (CAIXA) (S/ Paleta)','CARCAÇAS','R','12 dias','7898659790266','',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('985','MEIA CARCAÇA NA CAIXA CONGELADA','CARCAÇAS','C','365 dias','7898659792642','',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('986','CARCAÇA JUDIA PENDURADA S/ PALETA','CARCAÇAS','R','12 dias','7898659791942','',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70022','BACO SUINO CONG.','MIUDOS','C','365 dias','7898659791911','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70024','BAÇO CONGELADO (não comestivel)','MIUDOS','C','365 dias','7898659792277','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70032','GORDURA EM RAMA CONG','MIUDOS','C','365 dias','7898659791973','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70063','CARNE CONG DE SUINO SEM OSSO - CARNE INDUSTRIAL','MIUDOS','C','365 dias','7898659792604','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70092','CORAÇÃO SUÍNO CONGELADO','MIUDOS','C','365 dias','7898659790457','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70112','FÍGADO SUINO CONGELADO','MIUDOS','C','365 dias','7898659791584','23',23,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70114','MIUDOS CONG DE SUINO NAO COMESTIVEL - FIGADO','MIUDOS','C','365 dias','7898659791621','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70122','MIUDOS CONG DE SUINO – ORELHA','MIUDOS','C','365 dias','7898659791980','16',16,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70125','PERICARDIO RESF DE SUINO','MIUDOS','R','20 dias','7898659790952','Variável',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70130','VALVULA RESF DE SUINO','MIUDOS','R','20 dias','7898659790969','Variável',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70152','LINGUA SUINA CONG','MIUDOS','C','365 dias','7898659790402','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70162','MASCARA SUINA CONG','MIUDOS','C','365 dias','7898659790433','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70192','PES CONGELADO','MIUDOS','C','365 dias','7898659790419','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70199','INGREDIENTES PARA SARAPATEL EM CUBOS','MIUDOS','C','365 dias','7898659792123','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70222','MIUDOS CONG DE SUINO – PULMAO','MIUDOS','C','365 dias','7898659791904','média 12,5 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70223','MIUDOS CONG DE SUINO NAO COMESTIVEL - PULMAO','MIUDOS','C','365 dias','7898659792260','média 11,5 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70232','RABO CONGELADO DE SUÍNO','MIUDOS','C','365 dias','7898659790440','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70252','RINS SUINO CONGELADO','MIUDOS','C','365 dias','7898659791928','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70254','MIUDOS CONG DE SUINO NAO COMESTIVEL - RIM','MIUDOS','C','365 dias','7898659791638','média 20,45 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70962','VESICULA BILIAR SUINA REPLETA (NAO COMESTIVEL)','MIUDOS','C','730 dias','7898659792529','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10702','PAPADA CONG SEM PELE','MIUDOS','C','365 dias','7898659792024','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1189','COSTELINHA SUINA A PASSARINHO CONG','CORTES TEMP','C','180 dias','7898659790655','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1190','COSTELA SUINA TEMPERADA RESFRIADA','CORTES TEMP','R','45 dias','7898659790976','13',13,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1195','COSTELA SUINA TEMPERADA CONGELADA 15 kg','CORTES TEMP','C','365 dias','7898950833976','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10516','SOBREPALETA SUINA CONGELADA LT','CORTES TEMP','C','365 dias','7898659791454','23',23,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10700','LOMBO SUINO TEMPERADO RESFRIADO','CORTES TEMP','R','45 dias','7898950833488','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10709','LOMBO SUINO TEMPERADO CONGELADO','CORTES TEMP','C','365 dias','7898950833938','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10710','PICANHA SUINA TEMPERADA RESFRIADA','CORTES TEMP','R','45 dias','7898950833464','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10719','PICANHA SUINA TEMPERADA CONGELADA','CORTES TEMP','C','365 dias','7898950833914','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10720','FILE MIGNON SUINO TEMPERADO RESFRIADO','CORTES TEMP','R','45 dias','7898950833440','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10727','FILE MIGNON SUINO TEMPERADO CONGELADO','CORTES TEMP','C','365 dias','7898950833907','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10732','SOBREPALETA SUINA TEMPERADA RESFRIADA','CORTES TEMP','R','45 dias','7898950833501','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10736','SOBREPALETA SUINA TEMPERADA CONGELADA','CORTES TEMP','C','365 dias','7898659791461','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10740','ALCATRA SUINA TEMPERADA RESFRIADA','CORTES TEMP','R','45 dias','7898950833471','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10746','PERNIL C/ OSSO TEMPERADO FATIADO CONGELADO','CORTES TEMP','C','365 dias','7898659790716','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10747','PERNIL C/ OSSO TEMPERADO FATIADO RESFRIADO','CORTES TEMP','R','45 dias','7898659790990','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10749','ALCATRA SUINA TEMPERADA CONGELADA','CORTES TEMP','C','365 dias','7898950833921','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10750','PERNIL SUINO TEMPERADO RESFRIADO','CORTES TEMP','R','45 dias','7898950833433','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10759','PERNIL SUINO TEMPERADO CONGELADO','CORTES TEMP','C','365 dias','7898950833891','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10760','BARRIGA SUINA TEMPERADA RESFRIADA','CORTES TEMP','R','45 dias','7898950833525','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10762','PERNIL SUÍNO SEM OSSO LT (FRACIONADO)','CORTES TEMP','C','365 dias','7898659791430','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10765','BARRIGA SUINA TEMPERADA CONGELADA','CORTES TEMP','C','365 dias','7898950833952','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10771','PANCETA EM TIRAS TEMPERADA CONGELADA','CORTES TEMP','C','365 dias','7898659792505','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10795','COSTELA SUINA TEMPERADA CONGELADA 13 kg','CORTES TEMP','C','365 dias','7898950833976','13',13,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10796','LOMBO LT CONGELADO','CORTES TEMP','C','365 dias','7898659791423','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10797','LOMBO INTEIRO CONGELADO LT','CORTES TEMP','C','365 dias','7898659793281','Variável',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10810','FRALDINHA SUINA TEMPERADA RESFRIADA','CORTES TEMP','R','45 dias','7898950833679','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10815','FRALDINHA SUINA TEMPERADA CONGELADA','CORTES TEMP','C','365 dias','7898950833969','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10871','PANCETA SUÍNA TEMPERADA CONGELADA SABOR LIMÃO','CORTES TEMP','C','365 dias','7898659793045','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80116','MIUDOS CONGELADOS DE SUINO - EXPORTACAO ORELHAS B','EXPORTAÇÃO','C','730 dias','','18',18,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80121','MIUDOS CONGELADOS DE SUINO EXPORTACAO – ORELHAS A','EXPORTAÇÃO','C','730 dias','','18',18,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80130','MIUDOS CONGELADOS DE SUINO - PES DIANTEIRO A','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80135','MIUDOS CONGELADOS DE SUINO - PES DIANTEIROS B','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80152','MIUDOS CONGELADOS DE SUINO - LINGUA','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80154','MIUDOS CONGELADOS DE SUINO - LINGUA B','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80180','MIUDOS CONGELADOS DE SUINO - PES TRASEIROS A','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80185','MIUDOS CONGELADOS DE SUINO - PES TRASEIROS B','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80191','ENVOLTORIO NATURAL CONG DE SUINO EXPORTACAO – RETO','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80222','MIUDOS CONG. SUINO - ESTOMAGO COZIDO','EXPORTAÇÃO','C','730 dias','','18',18,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80230','MASCARA COM FOCINHO CONGELADA DE SUINO','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80309','CARNE CONGELADA DE SUINO C/OSSO - CARRE','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80311','CARNE CONGELADA DE SUINO C/OSSO - COSTELA','EXPORTAÇÃO','C','730 dias','','19',19,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80321','CARNE CONGELADA DE SUINOS SEM OSSO - PALETA','EXPORTAÇÃO','C','730 dias','','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80330','CARNE CONG. SUINA S/OSSO - BARRIGA S/ PELE','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80520','CARNE CONGELADA DE SUINO SEM OSSO - LOMBO','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80525','MIUDOS CONGELADOS DE SUÍNO - FÍGADO','EXPORTAÇÃO','C','540 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80540','CARNE CONG. DE SUINO S/ OSSO - SOBREPALETA','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80541','OSSO DO PESCOÇO','EXPORTAÇÃO','C','730 dias','','16',16,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80547','ESPINHAÇO SUINO CONGELADO - HK','EXPORTAÇÃO','C','730 dias','','16',16,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80550','CARNE CONG. DE SUINO S/OSSO - BARRIGA C/ PELE','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80571','CARNE CONGELADA DE SUINO S/ OSSO - PERNIL','EXPORTAÇÃO','C','730 dias','','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80592','OSSO DO PEITO 20KG - HK','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80166','PAPADA CONGELADA DE SUÍNO (MERCOSUL)','EXPORTAÇÃO','C','540 dias','','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80232','MASCARA COM FOCINHO CONGELADA DE SUINO','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80337','CARNE CONGELADA DE SUÍNO SEM OSSO - BARRIGA SEM PELE','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80509','CARRÉ (MERCOSUL)','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80542','SOBREPALETA (MERCOSUL)','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80543','LOMBO (MERCOSUL)','EXPORTAÇÃO','C','730 dias','','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80544','PERNIL SEM OSSO SEM PELE (MERCOSUL)','EXPORTAÇÃO','C','730 dias','','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80165','PAPADA CONGELADA DE SUÍNO','EXPORTAÇÃO','C','540 dias','','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80305','CARNE CONGELADA DE SUÍNO COM OSSO - BARRIGA COM COSTELA','EXPORTAÇÃO','C','730 dias','','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80310','CARNE CONGELADA DE SUÍNO COM OSSO - COSTELA','EXPORTAÇÃO','C','730 dias','','19',19,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80320','CARNE CONGELADA DE SUÍNO SEM OSSO - PALETA','EXPORTAÇÃO','C','730 dias','','22',22,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80325','CARNE CONGELADA DE SUÍNO COM OSSO - PALETA','EXPORTAÇÃO','C','730 dias','','entre 10 e 15 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80335','CARNE CONGELADA DE SUÍNO SEM OSSO - BARRIGA COM PELE','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80345','CARNE CONGELADA DE SUÍNO SEM OSSO - BARRIGA SEM PELE','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80521','CARNE CONGELADA DE SUÍNO SEM OSSO - LOMBO','EXPORTAÇÃO','C','730 dias','','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80527','MIÚDOS CONGELADOS DE SUÍNO - FÍGADO','EXPORTAÇÃO','C','540 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80546','CARNE CONGELADA DE SUÍNO SEM OSSO - SOBREPALETA','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80570','CARNE CONGELADA DE SUÍNO SEM OSSO - PERNIL COM PELE','EXPORTAÇÃO','C','730 dias','','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80572','CARNE CONGELADA DE SUÍNO COM OSSO - PERNIL COM PELE','EXPORTAÇÃO','C','730 dias','','entre 10 e 13 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80573','CARNE CONGELADA DE SUÍNO COM OSSO - PERNIL SEM PELE','EXPORTAÇÃO','C','730 dias','','entre 10 e 13 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80575','CARNE CONGELADA DE SUÍNO SEM OSSO - PERNIL SEM PELE','EXPORTAÇÃO','C','730 dias','','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80922','CARNE CONGELADA DE SUÍNO COM OSSO - MEIA CARCAÇA ESTOQUINETE','EXPORTAÇÃO','C','730 dias','','37 a 55 kg (meia carcaça)',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80984','CARNE CONGELADA DE SUÍNO COM OSSO - MEIA CARCAÇA 3 PARTES','EXPORTAÇÃO','C','730 dias','','35 a 40 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80985','CARNE CONG DE SUÍNO COM OSSO - MEIA CARCAÇA 4 PARTES','EXPORTAÇÃO','C','730 dias','','35 a 40 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80306','CARNE CONG DE SUINO C OSSO – MEIA CARCAÇA BARRIGA','EXPORTAÇÃO','C','730 dias','','35 a 40 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80326','CARNE CONG DE SUINO C OSSO – MEIA CARCAÇA PALETA','EXPORTAÇÃO','C','730 dias','','36 a 40 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80574','CARNE CONG DE SUINO C OSSO – MEIA CARCAÇA PERNIL','EXPORTAÇÃO','C','730 dias','','37 a 40 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80519','CARNE CONG DE SUINO S OSSO - LOMBO SINGAPURA','EXPORTAÇÃO','C','730 dias','','25',25,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80539','CARNE CONG DE SUINO S OSSO - SOBREPALETA SINGAPURA','EXPORTAÇÃO','C','730 dias','','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20040','LINGUICA DE PERNIL COM PIMENTA CONGELADA','LINGUIÇAS FRESCAIS','C','120 dias','7898659790754','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20043','LINGUICA DE PERNIL COM ERVAS CONGELADA','LINGUIÇAS FRESCAIS','C','120 dias','7898659790785','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20045','LINGUICA DE PERNIL COM ALHO CONGELADA','LINGUIÇAS FRESCAIS','C','120 dias','7898659790761','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20048','LINGUICA DE PERNIL COM BACON CONGELADA','LINGUIÇAS FRESCAIS','C','120 dias','7898659790778','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20053','LINGUICA DE PERNIL COM QUEIJO CONGELADA','LINGUIÇAS FRESCAIS','C','120 dias','7898659790792','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20121','LINGUICA DE PERNIL CONGELADA 1 KG','LINGUIÇAS FRESCAIS','C','120 dias','7898950833204','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20130','LINGUICA DE PERNIL CONGELADA 5 KG','LINGUIÇAS FRESCAIS','C','120 dias','7898950833242','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20134','LINGUICA DE PERNIL CONGELADA  2,5 KG','LINGUIÇAS FRESCAIS','C','120 dias','7898659791096','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20221','LINGUICA PARA CHURRASCO CONGELADA 1 KG','LINGUIÇAS FRESCAIS','C','120 dias','7898950833211','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20230','LINGUICA PARA CHURRASCO CONGELADA 5 KG','LINGUIÇAS FRESCAIS','C','120 dias','7898950833259','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20233','LINGUICA PARA CHURRASCO CONGELADA 2,5 KG','LINGUIÇAS FRESCAIS','C','120 dias','7898659791065','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20234','LINGUICA MINEIRA SUINCO CONG','LINGUIÇAS FRESCAIS','C','120 dias','7898659791751','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20236','LINGUICA COM PIMENTA BIQUINHO CONG','LINGUIÇAS FRESCAIS','C','120 dias','7898659791768','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20239','LINGUICA PARA CHURRASCO RESFRIADA 5 KG','LINGUIÇAS FRESCAIS','R','20 dias','7898950833235','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20240','LINGUICA FININHA COM PIMENTA SUINCO 1 KG','LINGUIÇAS FRESCAIS','C','120 dias','7898659792178','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12222','RABO SUINO DEFUMADO PORCIONADO','DEFUMADOS','A','60 dias','7898659792215','7',7,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12223','PÉ SUINO DEFUMADO PORCIONADO','DEFUMADOS','A','60 dias','7898659792208','9.5',9.5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12251','ORELHA SUINA DEFUMADA PORCIONADA','DEFUMADOS','A','60 dias','7898659792239','7.5',7.5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30020','BACON EM MANTA','DEFUMADOS','A','90 dias','7898950833280','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30022','BACON MEIA MANTA','DEFUMADOS','A','90 dias','7898659791072','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30025','FILE MIGNON SUINO DEFUMADO','DEFUMADOS','R','60 dias','7898659790594','5',5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30026','PALETA SUINA COM OSSO DEFUMADA','DEFUMADOS','R','60 dias','7898659791157','Variável (7,5 a 10,5 kg)',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30027','COSTELA SUÍNA DEFUMADA','DEFUMADOS','R','60 dias','7898659790600','5',5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30028','JOELHO SUÍNO DEFUMADO','DEFUMADOS','R','60 dias','7898659790570','5',5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30029','LOMBO SUINO DEFUMADO','DEFUMADOS','R','60 dias','7898659790587','6',6,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30030','BACON EM RETALHO','DEFUMADOS','A','90 dias','7898659790372','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30034','BACON EM PEDACOS COZINHA PREMIADA','DEFUMADOS','A','90 dias','7898950833365','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30035','BACON FRACIONADO','DEFUMADOS','A','90 dias','7898659791607','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30036','BACON DE PERNIL EM PEDACOS','DEFUMADOS','A','90 dias','7898659792079','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30037','BACON DE PALETA EM PEDACOS','DEFUMADOS','A','90 dias','7898659792086','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30039','BACON DE LOMBO EM PEDACOS','DEFUMADOS','A','90 dias','7898659792093','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30041','COSTELA SUÍNA DEFUMADA PORCIONADA','DEFUMADOS','R','60 dias','7898659792284','7',7,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30043','BACON DE PALETA EM MANTA','DEFUMADOS','A','90 dias','7898659792062','17',17,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30045','BACON DE PERNIL EM MANTA','DEFUMADOS','A','90 dias','7898659792055','17',17,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30050','BACON EM MANTA SEM PELE','DEFUMADOS','A','90 dias','7898659790099','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30051','BACON FATIADO 1 KG','DEFUMADOS','R','75 dias','7898659790174','4',4,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30054','BACON FATIADO CONGELADO 1KG','DEFUMADOS','C','180 dias','7898659793113','14',14,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30055','BACON DE PALETA EM CUBOS 1 KG','DEFUMADOS','R','90 dias','7898659792581','4',4,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30056','BACON DE PALETA EM CUBOS 250g','DEFUMADOS','R','90 dias','7898659792598','5',5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30057','BACON FATIADO 500G','DEFUMADOS','R','75 dias','7898659790167','4',4,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30059','BACON FATIADO CONGELADO 500g','DEFUMADOS','C','180 dias','7898659792574','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30060','PAPADA SUINA DEFUMADA','DEFUMADOS','A','90 dias','7898950833426','17',17,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30064','BACON DE PALETA EM CUBOS 5 KG','DEFUMADOS','R','90 dias','7898659793212','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30085','TENDER RESFRIADO','DEFUMADOS','R','90 dias','7898659790839','7',7,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30103','LINGUIÇA TIPO CALABRESA 2,5KG','DEFUMADOS','A','90 dias','7898950833563','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30106','EMBUTIDO MISTO COZIDO E DEFUMADO 2,5KG','DEFUMADOS','A','60 dias','7898659790242','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30110','LINGUIÇA TIPO CALABRESA 3 GOMOS','DEFUMADOS','A','90 dias','7898950833655','3.5',3.5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30112','LINGUIÇA TIPO CALABRESA 400g','DEFUMADOS','A','90 dias','7898659792918','4.8',4.8,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30114','LINGUIÇA CALABRESA SUINCO','DEFUMADOS','A','90 dias','7898659793236','4.8',4.8,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30150','PAIO COZINHA PREMIADA 2 GOMOS','DEFUMADOS','A','90 dias','7898950833839','4.5',4.5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30155','LINGUIÇA TIPO CALABRESA FATIADA  1 KG','DEFUMADOS','R','75 dias','7898659790211','5',5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30160','PAIO COZINHA PREMIADA 2,5 KG','DEFUMADOS','A','90 dias','7898950833778','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30170','LINGUICA TIPO CALABRESA FININHA 2,5 KG','DEFUMADOS','A','90 dias','7898950833846','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30173','LINGUIÇA TIPO CALABRESA FININHA 500 g','DEFUMADOS','A','90 dias','7898659791058','4',4,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30175','LINGUIÇA PETISCO','DEFUMADOS','R','90 dias','7898659790846','4',4,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30180','LOMBO TIPO CANADENSE 1KG','DEFUMADOS','R','90 dias','7898659790815','7',7,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30182','LOMBO TIPO CANADENSE 500 G','DEFUMADOS','R','90 dias','7898659790808','8',8,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30183','LOMBO TIPO CANADENSE FATIADO 180 g','DEFUMADOS','R','60 dias','7898659793199','',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30193','LINGUICA TIPO CALABRESA RETA 2,5KG','DEFUMADOS','A','90 dias','7898950833853','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70200','INGREDIENTES PARA FEIJOADA SUINCO RESF.','INGREDIENTES','R','60 dias','7898950833785','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70201','INGREDIENTES PARA FEIJOADA SODEXO','INGREDIENTES','A','120 dias','7898659791485','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70203','INGREDIENTES PARA FEIJOADA SUINCO AMB','INGREDIENTES','A','60 dias','7898659792192','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40000','PRESUNTO RESF COZINHA PREMIADA','PRESUNTARIA','R','90 dias','7898950833372','6.76',6.76,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40006','PRESUNTO RESF. COZINHA PREMIADA RETANGULAR','PRESUNTARIA','R','90 dias','7898659790075','8',8,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40009','PRESUNTO RETANGULAR SUINCO RESF - B','PRESUNTARIA','R','90 dias','7898659791386','8',8,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40012','PRESUNTO FATIADO 180G - 32 PÇS','PRESUNTARIA','R','45 dias','7898659792888','5.76',5.76,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40013','PRESUNTO FATIADO 1KG','PRESUNTARIA','R','60 dias','7898659791720','5',5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40014','APRESUNTADO FATIADO 1KG','PRESUNTARIA','R','60 dias','7898659791737','5',5,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40016','APRESUNTADO FATIADO 180G - 32 PÇS','PRESUNTARIA','R','45 dias','7898659792871','5.76',5.76,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40017','PRESUNTO PARA FATIAR','PRESUNTARIA','R','60 dias','7898659792376','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40018','APRESUNTADO PARA FATIAR','PRESUNTARIA','R','60 dias','7898659792383','20',20,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40019','EMBUTIDO DE PERNIL SUINO COZIDO LEVINI','PRESUNTARIA','R','90 dias','7898659792772','6.76',6.76,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40022','PRESUNTO FATIADO 180G - 14 PÇS','PRESUNTARIA','R','45 dias','7898659792888','2.52',2.52,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('40026','APRESUNTADO FATIADO 180G - 14 PÇS','PRESUNTARIA','R','45 dias','7898659792871','2.52',2.52,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('50000','APRESUNTADO RESF. COZINHA PREMIADA','PRESUNTARIA','R','90 dias','7898950833389','8',8,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('50006','LANCHE SUINCO (FIAMBRE)','PRESUNTARIA','R','60 dias','7898659792253','9',9,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30095','MORTADELA TUBULAR 1KG','MORTADELAS','A','60 dias','7898659791546','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30096','MORTADELA TUBULAR 3KG','MORTADELAS','A','60 dias','7898659791522','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30097','MORTADELA DEFUMADA FATIADA 180 g','MORTADELAS','R','60 dias','7898659792895','2.16',2.16,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30098','MORTADELA DEFUMADA','MORTADELAS','A','60 dias','7898659791539','7,3 a 8,3',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10540','FIGADO SUINO SALGADO','SALGADOS','A','120 dias','7898659790853','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12220','PES SALGADOS DE SUINO','SALGADOS','A','120 dias','7898659790273','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12221','PÉ SUÍNO SALGADO PORCIONADO','SALGADOS','A','120 dias','7898659790228','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12225','RABO SUINO SALGADO','SALGADOS','A','120 dias','7898659790280','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12226','RABO SUÍNO SALGADO PORCIONADO','SALGADOS','A','120 dias','7898659790235','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12230','MÁSCARA SUINA SALGADA','SALGADOS','A','120 dias','7898659790303','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12231','MÁSCARA SUÍNA SALGADA PORCIONADA','SALGADOS','A','120 dias','7898659791140','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12240','LÍNGUA SUINA SALGADA','SALGADOS','A','120 dias','7898659790297','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12250','ORELHA SUINA SALGADA','SALGADOS','A','120 dias','7898659790310','10',10,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12260','RETO SUINO SALGADO','SALGADOS','A','120 dias','7898659790662','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12270','TOUCINHO COM PELE SALGADO DE SUINO','SALGADOS','A','120 dias','7898659790679','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12280','PÉ SUÍNO FRACIONADO SALGADO','SALGADOS','A','120 dias','7898659790945','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12290','RECORTE DE COSTELA SUINA SALGADO','SALGADOS','A','120 dias','7898659790334','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12291','LOMBO SUINO SALGADO','SALGADOS','A','120 dias','7898659790341','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12292','PERNIL SUINO SALGADO','SALGADOS','A','120 dias','7898659790693','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12293','PALETA SUINA SALGADA','SALGADOS','A','120 dias','7898659790709','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12294','ESTOMAGO SUINO SALGADO','SALGADOS','A','120 dias','7898659790860','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12295','COSTELA SUÍNA SALGADA','SALGADOS','A','120 dias','7898659790358','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12296','GARGANTA SUINA SALGADA','SALGADOS','A','120 dias','7898659790877','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12297','ESPINHAÇO SUINO SALGADO','SALGADOS','A','120 dias','7898659790938','12',12,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70039','TORRESMO GOURMET 170g','MARCA PRÓPRIA SUINCO','A','180 dias','7898659792291','1,020 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70041','TORRESMO GOURMET 90g','MARCA PRÓPRIA SUINCO','A','180 dias','7898659792635','1,080 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70043','COPA SUINA CURADA SUINCO','MARCA PRÓPRIA SUINCO','A','180 dias','7898659792796','5,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70044','LOMBO SUINO CURADO SUINCO','MARCA PRÓPRIA SUINCO','A','180 dias','7898659792789','5,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70045','SALAMINHO SUINCO','MARCA PRÓPRIA SUINCO','A','180 dias','7898659792765','5,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70046','SALAME TIPO ITALIANO SUINCO','MARCA PRÓPRIA SUINCO','A','180 dias','7898659792666','5,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70047','BANHA DE POTE SUINCO 800g','MARCA PRÓPRIA SUINCO','A','365 dias','7898659792833','7,200 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70048','TORRESMO GOURMET PACOTE 50g','MARCA PRÓPRIA SUINCO','A','180 dias','7898659793267','1,500 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70054','LOMBO CURADO DE SUÍNO FATIADO 100g','MARCA PRÓPRIA SUINCO','A','150 dias','7898659793175','3,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70055','SALAME TIPO MILANO FATIADO 100g','MARCA PRÓPRIA SUINCO','A','150 dias','7898659793151','3,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70056','SALAME TIPO ITALIANO FATIADO 100g','MARCA PRÓPRIA SUINCO','A','150 dias','7898659793144','3,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('70057','COPA FATIADA 100g','MARCA PRÓPRIA SUINCO','A','150 dias','7898659793168','3,000 kg',NULL,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('01193','COSTELA SERRADA SUINA RESF VACUO DUAS PARTES','INATIVOS','R','21 dias','7898659790631','média 20',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10212','PALETA S/ OSSO CONG (AF)','INATIVOS','C','365 dias','7898950833129','média 21',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10233','PALETA C/ PELE E S/ OSSO (AF)','INATIVOS','C','365 dias','7898950833877','média 21',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10323','BARRIGA CONG INTERFOLHADA','INATIVOS','C','365 dias','7898659790198','média 21',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10416','PERNIL SUINO C/OSSO RESF A VACUO','INATIVOS','R','21 dias','7898659791355','média 24',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10584','SOBREPALETA COM OSSO CONG (AF) (COPA LOMBO)','INATIVOS','C','365 dias','7898659790525','20',20,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10616','PALETA C/OSSSO RESF A VACUO','INATIVOS','R','21 dias','7898659791362','média 23',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10813','BARRIGA RESF VACUO - DUAS PARTES','INATIVOS','R','21 dias','7898659790617','média 23',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1200','COSTELA GRIIL TEMPERADA CONGELADA','INATIVOS','C','365 dias','7898659792543','15',15,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10752','PICANHA SUÍNA LT','INATIVOS','C','365 dias','7898659791553','24',24,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10769','PERNIL SUÍNO SEM PELE SEM OSSO LT (INTEIRO)','INATIVOS','C','365 dias','7898659791508','Variável',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10776','PERNIL SUÍNO COM OSSO LT (FRACIONADO)','INATIVOS','C','365 dias','7898659791041','22',22,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12235','MÁSCARA DEFUMADA PORCIONADA','INATIVOS','A','60 dias','7898659792222','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30021','LOMBO SUÍNO DEFUMADO PARA PORCIONAR','INATIVOS','R','60 dias','7898659792475','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30023','COSTELA SUÍNA DEFUMADA PARA PORCIONAR','INATIVOS','R','90 dias','7898659792468','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30111','LINGUIÇA TIPO CALABRESA PARA FATIAR','INATIVOS','R','90 dias','7898659792406','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30174','LINGUIÇA PETISCO PARA FRACIONAR','INATIVOS','R','90 dias','7898659792482','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30181','LOMBO CANADENSE PARA FATIAR','INATIVOS','R','60 dias','7898659792512','20',20,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('11202','TOUCINHO PP','INATIVOS','365 d','07898659790501','7898659790501','17,76 a 19,06',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12233','COSTELA SUÍNA SALGADA FRACIONADA','INATIVOS','A','120 dias','7898659791690','10',10,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12252','ORELHA SUÍNA SALGADA PORCIONADA','INATIVOS','A','120 dias','7898659792369','7',7,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12271','TOUCINHO SUÍNO SALGADO PORCIONADO','INATIVOS','A','120 dias','7898659792352','10',10,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12298','LOMBO SUÍNO SALGADO PORCIONADO','INATIVOS','A','120 dias','7898659792321','10',10,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12299','PERNIL SUÍNO SALGADO PORCIONADO','INATIVOS','A','120 dias','7898659792314','10',10,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12303','BARRIGA SUÍNA SALGADA PORCIONADA','INATIVOS','A','120 dias','7898659792307','10',10,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12304','RECORTE DE COSTELA SUÍNA SALGADA PORCIONADA','INATIVOS','A','120 dias','7898659792345','10',10,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('12305','COSTELA SUÍNA SALGADA PORCIONADA','INATIVOS','A','120 dias','7898659792338','10',10,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80195','CARNE TEMPERADA CONGELADA DE SUÍNO COM OSSO - COSTELA','INATIVOS','C','365 dias','7898659791898','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80450','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - SOBREPALETA','INATIVOS','C','365 dias','7898659791812','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80581','JOELHO DA PALETA','INATIVOS','C','730 dias','-','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80590','JOELHO DO PERNIL','INATIVOS','','','-','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80591','JOELHO DO PERNIL','INATIVOS','C','730 dias','-','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80726','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - PICANHA','INATIVOS','C','365 dias','7898659791850','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80742','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - ALCATRA','INATIVOS','C','365 dias','7898659791805','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80743','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - FILÉ MIGNON','INATIVOS','C','365 dias','7898659791874','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80768','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - BARRIGA','INATIVOS','C','365 dias','7898659791836','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80771','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - PERNIL','INATIVOS','C','365 dias','7898659791843','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80777','CARNE TEMPERADA CONGELADA DE SUÍNO COM OSSO - PERNIL','INATIVOS','C','365 dias','7898659791881','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80795','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - LOMBO','INATIVOS','C','365 dias','7898659791829','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('80816','CARNE TEMPERADA CONGELADA DE SUÍNO SEM OSSO - FRALDINHA','INATIVOS','C','365 dias','7898659791867','',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20331','LINGUIÇA DE LOMBO FININHA 1KG','INATIVOS','C','120 dias','','15',15,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20333','LINGUIÇA DE LOMBO FININHA 2,5KG','INATIVOS','C','120 dias','','15',15,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20440','LINGUIÇA DE PERNIL COM PIMENTA CONGELADA PREMIUM','INATIVOS','C','120 dias','','12',12,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20443','LINGUIÇA DE PERNIL COM ERVAS CONGELADA PREMIUM','INATIVOS','C','120 dias','','12',12,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20445','LINGUIÇA DE PERNIL COM ALHO CONGELADA PREMIUM','INATIVOS','C','120 dias','','12',12,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20448','LINGUIÇA DE PERNIL COM BACON CONGELADA PREMIUM','INATIVOS','C','120 dias','','12',12,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20553','LINGUIÇA DE PERNIL COM QUEIJO CONGELADA PREMIUM','INATIVOS','C','120 dias','','12',12,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20334','LINGUIÇA MINEIRA SUINCO CONGELADA PREMIUM','INATIVOS','C','120 dias','','12',12,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('20336','LINGUIÇA COM PIMENTA BIQUINHO CONG PREMIUM','INATIVOS','C','120 dias','','12',12,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30225','FILÉ MIGNON DEFUMADO PREMIUM','INATIVOS','R','60 dias','','5',5,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30226','PALETA COM OSSO DEFUMADA PREMIUM','INATIVOS','R','60 dias','','7 a 10,5',NULL,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30227','COSTELINHA SUÍNA DEFUMADA PREMIUM','INATIVOS','R','60 dias','','5',5,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30228','JOELHO SUÍNO DEFUMADO PREMIUM','INATIVOS','R','60 dias','','5',5,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('30229','LOMBO DEFUMADO PREMIUM','INATIVOS','R','60 dias','','6',6,FALSE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('1185','COSTELA TEMPERADA RESFRIADA DIA','MARCA PRÓPRIA 3°','R','45 dias','2406566000009','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10706','PICANHA TEMPERADA RESFRIADA DIA','MARCA PRÓPRIA 3°','R','45 dias','2406561000004','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10707','LOMBO TEMPERADO RESFRIADO DIA','MARCA PRÓPRIA 3°','R','45 dias','2406560000005','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10726','FILÉ TEMPERADO RESFRIADO DIA','MARCA PRÓPRIA 3°','R','45 dias','2406562000003','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10742','SOBREPALETA TEMPERADA RESFRIADA DIA','MARCA PRÓPRIA 3°','R','45 dias','2406563000002','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10753','PERNIL TEMPERADO RESFRIADO DIA','MARCA PRÓPRIA 3°','R','45 dias','2406564000001','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
INSERT INTO dim_produtos (codigo, nome, categoria, temperatura, validade, ean, peso_liquido_txt, peso_caixa_kg, ativo)
VALUES ('10768','BARRIGA TEMPERADA RESFRIADA DIA','MARCA PRÓPRIA 3°','R','45 dias','2406565000000','15',15,TRUE)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, categoria = EXCLUDED.categoria,
  temperatura = EXCLUDED.temperatura, validade = EXCLUDED.validade, ean = EXCLUDED.ean,
  peso_liquido_txt = EXCLUDED.peso_liquido_txt,
  peso_caixa_kg = COALESCE(EXCLUDED.peso_caixa_kg, dim_produtos.peso_caixa_kg),
  ativo = EXCLUDED.ativo, atualizado_em = now();
