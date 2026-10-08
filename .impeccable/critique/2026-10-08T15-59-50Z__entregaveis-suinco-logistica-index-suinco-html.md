---
target: painel inteiro, foco Torre de Controle e Pátio ao vivo
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/pega-visao/entregaveis/suinco_logistica/index_suinco.html"
target_fingerprint: "sha256:a9875da09aa5cc43b48b440733ac81a143b94ad01a78da6913da81e1e704064a"
target_path: /home/user/pega-visao/entregaveis/suinco_logistica/index_suinco.html
timestamp: 2026-10-08T15-59-50Z
slug: entregaveis-suinco-logistica-index-suinco-html
---
Method: dual-agent (A: revisão de design · B: detector + navegador). Base: vitrine do painel atual (ae6d15c), Administração, 13 abas, temas escuro e claro, 1440/1366/1024/390 px. Foco do dono: Torre de Controle e Pátio ao vivo.

## Notas de Nielsen — 27/40 (Aceitável)
1 Estado 3 · 2 Mundo real 3 · 3 Controle 3 · 4 Consistência 2 · 5 Prevenção de erro 2 · 6 Reconhecer 3 · 7 Eficiência 3 · 8 Estética 2 · 9 Recuperar 3 · 10 Ajuda 3.

## Especificidade
Operação é da Suinco (Pátio ao vivo, Portaria/Expedição/Faturamento); gestão (Indicadores, Cadastros, Usuários) é genérica. Detector: 362 brutos, ~10 reais após conferência; falsos: vidro calculado sobre branco (~140), tema2027 não lido, media queries ignoradas, Modo Local.

## Problemas prioritários
- [P1] Preenchimento usado como texto: .vp-atrasado (styles.css:1873, 1,11:1 no claro), .seq-input (styles.css:2041, 1,4–1,6:1 no claro), Tendência do Gestor (app/60_indicadores.js, --st-*-fg), .pv-selo (tema2027/70_patio_ao_vivo.css:112, 2,28:1 no escuro). Guarda: test_contraste não lê valor de input e não planta caminhão atrasado. → colorize
- [P1] Ação arriscada em caixa nativa: senha em prompt() à vista (app/30_torre.js:145, app/87_celular_e_usuarios.js:304); motivo pré-preenchido em Encerrar (app/40_programacao.js:587); 16 confirm + 13 prompt. → harden
- [P1] Indicadores ~4.660 px, 12 seções, lista acionável no rodapé, tempo de pátio com 5 definições. → distill, layout
- [P2] Torre: 9 stat-box clicáveis sem teclado; 18 selects sem nome; campos 22–23 px e selo 18 px < 24 px no tablet; relógio cortado 1024–1180. → adapt, harden
- [P2] Etapas com outras cores na pizza (data.js:532-539); Remover × Excluir; dois estilos da mesma ação. → polish

## Personas
Logística (Torre 2,5 linhas em 1366×768; 3 datas na Programação; Encerrar com Enter; Seq. ilegível no claro) · Porteiro tablet (relógio cortado; ação a duas telas no retrato; tempo de pátio invisível no claro) · Administrador (4.660 px até quem está parado; 21/35 "Sem dados"; Rotas a 14.800 px) · Teclado (stat-box sem teclado; canvas sem texto).

## Menores
Botão de tema mostra estado; data repetida 3x; selects/cartões truncados; h2→h4; transportadora cortada sem title; canvas em Segoe UI; Histórico sem paginar; setor "Dem…" no celular; eixo SVG 11 px (graficos2027.js:178,252); select 11,5 px (styles.css:6266).

## Perguntas
Torre de leitura com 11 campos editáveis?; qual seção do Indicadores às 7h?; três jeitos de criar carga?; e se as janelas de risco fossem as mais bem-acabadas?
