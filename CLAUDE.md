# Programação de Embarque Suinco

Painel de logística **em produção**, usado ao vivo por Logística, Portaria,
Expedição, Faturamento, Controles Internos, Central de Notas, Comercial e
Administração. Erro aqui não é bug de tela: é caminhão parado no portão.

Este arquivo é lido por **qualquer Claude que acorde neste repositório** —
no chat, na GitHub Action, no servidor. É a memória compartilhada. Se uma
regra não estiver aqui, ela não existe para quem chegar depois.

---

## O dono

**Luis** — com S. Sempre. Ele é o dono da operação, não é técnico, e cobra
resultado, não explicação.

O que ele exige, com as palavras dele:

- *"não pode ficar ponto sem nó de forma alguma"*
- *"não temos oportunidade de errar, somente acertos"*
- *"não adianta nada você me falar que foi erro seu e que você OMITIU algo"*

Disso saem quatro regras que valem para todo mundo aqui:

1. **Toda demanda vira um PROMPT antes do código.** O que muda, onde, o que
   NÃO muda, e a pergunta que falta. Só depois de aprovado é que se escreve
   código. Exceção: correção de defeito em produção já relatado por ele.
2. **Nada é dado como pronto sem prova.** "Deve funcionar" não existe. Roda,
   mostra a saída, e só então afirma.
3. **Controle não pode depender da memória de quem escreveu.** Prazo mágico,
   número solto, "lembrar de rodar tal coisa" — tudo isso vira defeito.
4. **Marcação de três estados** em todo relato de entrega:
   ✅ no ar · 🟡 commitado, não publicado · ⬜ proposta.

**Nunca peça a ele para rodar `atualizar.sh`.** Ele já roda. Diga o que
depende do servidor e siga.

---

## Onde as coisas estão

```
entregaveis/suinco_logistica/
├── index.html          GERADO — não editar à mão
├── build_arquivo_unico.py   junta data.js + app.js + styles.css em index.html
├── data.js             estado, máquina de estados, sincronia, fusão
├── app.js              telas e ações
├── devolucoes.js       o ciclo de devolução (6 etapas)
├── suinco-api.js       cliente da API (fila offline, upsert, mudarStatus)
├── styles.css
├── backend/
│   ├── src/dominio/fluxo.js   AS TRANSIÇÕES E PERMISSÕES POR SETOR
│   ├── src/rotas/
│   ├── migrations/
│   └── testes/api.test.js
├── testes/             ~120 suítes Playwright + rodar_tudo.sh
└── docs/REGISTRO_DE_OCORRENCIAS.md   TODO defeito já visto, e o teste que o trava
.claude/agents/         9 agentes com as funções do fluxo
```

**`docs/REGISTRO_DE_OCORRENCIAS.md` é leitura obrigatória** antes de
investigar qualquer coisa. As ocorrências se repetem em famílias — reconhecer
a família é o que faz achar a causa em minutos em vez de horas.

---

## Comandos

```bash
# banco local descartável (morre sozinho neste container)
pg_ctlcluster 16 main start

# API local — a variável do Chromium NÃO é opcional: sem ela o gerador de
# PDF fica fora do ar e toda suíte de relatório reprova sem ter defeito
cd backend && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node src/servidor.js

cd backend && npm run migrar && npm run teste   # bateria da API
python3 build_arquivo_unico.py                  # regenera index.html
bash testes/rodar_tudo.sh                       # bateria completa (~30 min)
bash publicar.sh                                # o portão: bateria + merge
```

---

## Regras da casa

- **Uma função, dois chamadores.** A mesma decisão escrita em dois lugares
  diverge. Extraia e chame — não copie.
- **O servidor é quem manda.** A tela adianta o resultado; quem decide é a
  transação. Escrita otimista sem confirmação é como se perde dado.
- **Pátio não se apaga.** Sai da operação, continua no Histórico, com o
  registro de para onde foi.
- **Fidelidade ao momento exato.** O caminhão entrou quando entrou. Carimbar
  a hora da edição faz o indicador mentir a favor da operação.
- **null ≠ zero.** `Number(0) || null` já apagou capacidade de veículo aqui.
- **Botão desabilitado não ensina o caminho, só nega.** Quando a ação é
  arriscada, PERGUNTE explicando — não bloqueie quem tem autoridade.
- **Recusa do servidor nunca pode ser silenciosa.** `upsert()` devolve
  `{recusado:true}` em vez de lançar — quem chama precisa olhar o valor.
- **`data.js` não conhece `app.js`.** O build concatena nessa ordem.

### Vermelho tem QUATRO causas — descubra qual antes de mexer

1. a regra mudou de propósito → o teste é que está velho;
2. o teste mede um atalho que mudou de forma;
3. contaminação entre suítes (limpe o banco);
4. regressão de verdade.

Tratar (1) como (4) apaga uma decisão. Tratar (4) como (1) publica o defeito.

---

## Nunca

- **Nunca invente código de rota, placa, cliente ou número de carga.** Se o
  dado não existe na base, diga que não existe.
- **Nunca `git push` direto na branch de entrega.** O caminho é: branch de
  trabalho → `publicar.sh` → entrega → Vercel.
- **Nunca commite segredo** — chave, senha, token. Nem em exemplo.
- **Nunca edite `index.html` à mão.** Ele é gerado.
- **Nunca afirme que algo está publicado** sem a bateria verde e o portão.

---

## Fluxo de trabalho

**Demanda nova:** PROMPT → aprovação → teste que REPROVA contra o publicado
→ implementação → bateria completa → portão → relato com os três estados.

**Defeito relatado:** reproduza ANTES de propor correção. Causa raiz com
evidência, não hipótese. Depois: teste que reprova → correção → bateria →
portão → **ocorrência escrita em `docs/REGISTRO_DE_OCORRENCIAS.md`**.

Uma correção só está encerrada quando tem o teste que a trava. Correção sem
guarda é correção que volta.
