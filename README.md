# Programação de Embarque — Suinco

Painel de logística de pátio usado **ao vivo, todo dia**, por oito setores da
Suinco Cooperativa Agroindustrial: Logística, Portaria, Expedição,
Faturamento, Controles Internos, Central de Notas, Administração e Comercial.

Substituiu uma planilha de Excel com VBA. O que ele resolve, em uma frase:
**onde está cada caminhão, quem registrou cada movimento e a que horas** —
sem ninguém precisar ligar para o pátio para descobrir.

---

## O que está no ar

| | |
|---|---|
| Painel | `https://embarquesuinco.com.br` (Vercel) |
| API | `https://api.embarquesuinco.com.br` (VPS própria) |
| Banco | PostgreSQL na mesma VPS |
| Tempo real | Socket.IO — o que um setor grava aparece nos outros sem recarregar |

---

## O caminho de uma carga

Seis etapas, e cada uma pertence a um setor. O servidor recusa quem tentar
pular ou voltar — voltar etapa existe, mas é ação separada, com motivo
obrigatório e registro de quem fez.

```
Aguardando Veículo  →  Aguardando Embarque  →  Embarque Iniciado
   (Logística)             (Portaria)              (Expedição)

   →  Embarque Finalizado  →  Faturado  →  Seguiu Viagem
         (Expedição)        (Faturamento)   (Portaria)
```

O relógio de pátio — o SLA de 3 horas — começa na **entrada real do
veículo**, não na criação do registro. São três relógios diferentes e
confundi-los já produziu incidente: ver `docs/MAPA_COMPLETO_DO_SISTEMA.md`.

---

## Onde fica cada coisa

Tudo vive em **`entregaveis/suinco_logistica/`**.

```
backend/            API em Node + Express + PostgreSQL
  src/rotas/        as rotas HTTP (cargas.js é o coração)
  src/dominio/      as regras: fluxo de status, permissão por setor
  migrations/       37 migrações, aplicadas por scripts/migrar.js
  testes/           346 casos rodando contra PostgreSQL de verdade
  instalar.sh       monta o servidor do zero (é o que rodou em produção)
  atualizar.sh      atualiza o servidor já instalado
  diagnostico.sh    "fulano não consegue entrar" — roda e fotografa

app.js              o painel (sem framework, sem npm no frontend)
data.js             regras de negócio e estado local
suinco-api.js       o adaptador que fala com a API, com fila offline
styles.css          o design system
index_suinco.html   a estrutura das 11 abas
build_arquivo_unico.py   junta tudo num index.html só

testes/             110 suítes de tela (Playwright), em português
tutoriais/          gera os guias em PDF, um por setor, com prints reais
docs/               26 documentos — arquitetura, operação, incidentes
publicar.sh         o portão: nada vai para a operação sem passar por ele
```

---

## Por onde começar a ler

Nesta ordem, e vale para qualquer pessoa nova no projeto:

1. **`docs/MAPA_COMPLETO_DO_SISTEMA.md`** — o manual técnico consolidado.
2. **`docs/MANUAL_DO_SERVIDOR.md`** — operar a VPS: subir, reiniciar, log, backup.
3. **`docs/O_QUE_FALTA_BLINDAR.md`** — o que está aberto agora, com os comandos.
4. **`docs/PROTOCOLO_MESTRE_DE_MUDANCAS.md`** — como se mexe aqui sem quebrar produção.
5. **`docs/POSMORTEM_2026-08-08.md`** — um incidente real, contado inteiro.

> **Aviso que evita uma reunião perdida.** Alguns documentos falam de
> SharePoint e Microsoft 365. Aquilo foi o desenho inicial e **nunca entrou
> em produção** — nenhuma Lista foi provisionada. Todos esses arquivos já
> abrem com um aviso dizendo isso. Não provisione nada com base neles.

---

## Rodar na sua máquina

Precisa de Node 20+ e PostgreSQL 14+.

```bash
cd entregaveis/suinco_logistica/backend
cp .env.exemplo .env          # preencha PGPASSWORD e JWT_SECRET
npm ci
npm run migrar
npm run teste                 # 346 casos
npm start                     # API na porta do .env
```

O painel é um arquivo só. Depois de mexer em `app.js`, `data.js`,
`suinco-api.js` ou `styles.css`:

```bash
python3 build_arquivo_unico.py     # regenera o index.html
```

---

## Como se publica

Nada vai para a operação sem passar pelo portão:

```bash
bash entregaveis/suinco_logistica/publicar.sh
```

Ele confere, nesta ordem: a branch, se não sobrou arquivo fora do commit, se
o `index.html` corresponde às fontes, os 346 testes da API, se o servidor de
teste está no ar **e consegue gerar PDF**, as 110 telas, e se toda migração
pendente declara o que quebra sem ela. Só então publica — e imprime o que
precisa ser repassado.

Cada uma dessas checagens nasceu de um erro que chegou na operação. As
histórias estão comentadas dentro do próprio script.

---

## Convenções

- **Tudo em português** — código, testes, commits, documentação. Quem opera
  o pátio lê os relatórios; quem mantém o sistema lê o código. Os dois falam
  a mesma língua.
- **Comentário explica POR QUE, não O QUE.** Boa parte deles cita o
  incidente ou o pedido que originou a regra, com data.
- **Teste antes do código** para correção de defeito: primeiro vermelho que
  reproduz, depois a correção.
- **Vermelho tem quatro causas** — a regra mudou de propósito · o teste mede
  um atalho que mudou de forma · contaminação de outra suíte · regressão de
  verdade. Nessa ordem, e a última só quando as três caem.
