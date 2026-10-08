# Product

<!-- impeccable:product-schema 1 -->

Registro do produto para a skill `/impeccable` (init de 08/10/2026). O que
está aqui foi confirmado pelo dono nesta data ou está provado no repositório
(caminho indicado). Regras de trabalho e de publicação continuam no
`CLAUDE.md`, que prevalece sobre este arquivo.

## Platform

web

Um painel de arquivo único (`entregaveis/suinco_logistica/index.html`,
gerado por `build_arquivo_unico.py`), servido pela Vercel em
embarquesuinco.com.br e, como reserva, pelo próprio servidor em
`https://api.embarquesuinco.com.br/painel`. Funciona no computador, no
tablet e no celular, com dois temas (escuro e claro).

## Users

**Quem tem prioridade quando duas necessidades brigam numa tela:
Administração e Logística** (confirmado pelo dono em 08/10/2026).

- **Logística** — monta, programa e acompanha o dia: Torre de Controle,
  Programação, Montagem, contratação do frete, Indicadores.
- **Administração** — gestão, usuários, vigias, pontos de atenção,
  relatórios executivos, decisões de exceção.
- **Portaria, Expedição, Faturamento** — cada um carimba a sua etapa do
  caminhão. Na Portaria o aparelho de trabalho é **tablet ou PC fixo**; o
  celular é exceção (confirmado pelo dono em 08/10/2026).
- **Pagamento de Frete** — confere notas e paga o frete por carga.
- **Controles Internos, Central de Notas** — passos do ciclo de devolução.
- **Comercial e Qualidade** — só acompanham (leitura).
- **Filiais 105 BSB, 106 BAHIA, 107 ES** — só devolução.

Lista de setores: `entregaveis/suinco_logistica/backend/src/dominio/fluxo.js`.

## Product Purpose

Controlar o embarque da Suinco — do caminhão programado até "Seguiu
Viagem" — e tudo o que gira em volta dele: programação e montagem das
cargas, frete contratado e pago, devoluções, relatórios e indicadores.
Usado ao vivo por todos os setores acima.

Sucesso é a operação não parar: *"Erro aqui não é bug de tela: é caminhão
parado no portão"* (CLAUDE.md). O dono cobra resultado, não explicação, e
não admite erro de dado: *"não temos oportunidade de errar, somente
acertos"*.

## Positioning

**Feito no fluxo da Suinco** (confirmado pelo dono em 08/10/2026): as
etapas, os setores, as regras de quem pode o quê e o vocabulário são os da
operação daqui — não os de um sistema genérico de pátio (Opendock, Senior
YMS, TOTVS YMS) nem os de uma planilha.

## Operating Context

- **As seis etapas do caminhão:** Aguardando Veículo → Aguardando
  Embarque → Embarque Iniciado → Embarque Finalizado → Faturado → Seguiu
  Viagem. Cada etapa é carimbada por um setor, com hora e nome.
- **As 13 abas:** Torre, Pátio ao vivo, Programação, Devoluções, Portaria,
  Expedição, Faturamento, Indicadores, Cadastros, Histórico, Relatórios,
  Pagamento de Frete, Usuários. Cada setor vê só as suas.
- **Fontes de dado:** ERP Atak ("Sisatak") por relatório exportado e
  importado no painel (nunca por API — decisão do dono de 29/09/2026);
  PDFs do DeliveryB2B e do Atak no Pagamento de Frete; Power BI lê o banco
  por uma porta própria (`/bi`).
- **Rede:** o pátio inteiro sai pelo mesmo IP; a rede cai. O painel grava
  local primeiro e envia quando a rede volta.

## Capabilities and Constraints

- **O servidor decide; a tela adianta.** Recusa do servidor nunca é
  silenciosa.
- **Fidelidade ao momento exato:** o caminhão entrou quando entrou;
  carimbar a hora da edição faz o indicador mentir.
- **Pátio não se apaga:** sai da operação e fica no Histórico, com o
  registro de para onde foi.
- **null ≠ zero.**
- **Botão desabilitado não ensina o caminho:** quando a ação é arriscada,
  pergunta explicando; não bloqueia quem tem autoridade.
- **Arquivo único, sem CDN:** tudo embutido; teto de 760 KB comprimido
  (`testes/test_logo_uma_copia_so`).
- **Nunca inventar** código de rota, placa, cliente ou número de carga.
- **Português do Brasil** em toda a interface; datas dd/mm/aaaa, fuso de
  Brasília.

## Brand Commitments

- **Nome da empresa nos documentos:** SUINCO - COOPERATIVA DE
  SUINOCULTORES LTDA · CNPJ 06.067.949/0001-95 (fonte única `EMPRESA` em
  `app/80_relatorios.js`).
- **Identidade já decidida e em produção:** navy e dourado, tema escuro
  padrão e tema claro, letra de relatório Inter só nos relatórios. O
  sistema visual em si fica no DESIGN.md (comando `document`), não aqui.
- **Voz:** português de operação, direto, sem jargão técnico; o texto diz o
  que fazer ("Peça para rodar a atualização do servidor"), não o código do
  erro.

## Evidence on Hand

- `docs/REGISTRO_DE_OCORRENCIAS.md` — todo defeito já visto e o teste que o
  trava (#1 a #120).
- `docs/DECISOES_CONFIRMADAS.md` — as decisões do dono, numeradas.
- `testes/` — cerca de 260 suítes de tela (Playwright) e a bateria da API
  (686 testes no portão 64).
- Raio-X da estrutura: https://claude.ai/artifact/WTXUCKLXH81K1r68vawzyK
- Guias por setor, apresentação e manual em `entregaveis/suinco_logistica/`.
- **Não existe, não inventar:** depoimento de usuário, número de economia
  ou de ganho medido para material externo, comparação de preço com os
  sistemas de mercado.

## Product Principles

1. Quem está operando não espera: a ação do dia vem antes da explicação.
2. O número na tela é o número do banco — uma fonte, uma conta.
3. Nada some: o que sai da operação vai para o Histórico com o motivo.
4. Quando a ação é arriscada, a tela pergunta e explica; não esconde nem
   bloqueia quem tem autoridade.
5. Nada é dado como pronto sem prova tirada como o usuário vê.

## Accessibility & Inclusion

- Contraste WCAG AA nos dois temas e nenhuma letra abaixo de 12 px —
  travados pela bateria (`test_piso_de_12px` e os testes de contraste).
- Aparelho principal da Portaria: tablet ou PC fixo; o celular continua
  suportado em todas as telas de operação (paridade conferida por
  `suinco-paridade-mobile`).
- Foco visível no teclado e respeito a `prefers-reduced-motion`.
