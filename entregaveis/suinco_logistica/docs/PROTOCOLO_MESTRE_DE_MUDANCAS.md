# Protocolo mestre de mudanças — Embarque Suinco

Este documento é a regra de como qualquer pedido, meu (usuário) ou seu
(Claude), é processado neste projeto a partir de agora. Nasceu do incidente
de 08/08/2026 (`POSMORTEM_2026-08-08.md`): 5 horas de painel instável,
login bloqueado e um susto de perda de dado que não era real — e que
custou tempo, paciência e ansiedade que não deveria ter custado.

**Este painel está em produção, com gente de verdade trabalhando nele
agora.** Toda mudança daqui pra frente passa por isto antes de qualquer
código ser escrito ou qualquer comando ser sugerido.

---

## 1. Hierarquia de prioridades — nesta ordem, sem exceção

Quando dois objetivos competem, o de cima sempre vence:

1. **Nenhum dado gravado se perde.** Nunca. Nem por engano, nem "só para
   testar", nem sob pressão de tempo.
2. **Ninguém que já usa o sistema fica impedido de trabalhar.** Login,
   leitura, gravação de status — isso não pode parar.
3. **Estabilidade do que já funciona vem antes de qualquer funcionalidade
   nova.** Um recurso novo nunca é desculpa para arriscar o que roda hoje.
4. **A ação mais reversível ganha da mais rápida.** Entre "subir um número
   de configuração" e "resetar o sistema", a primeira vence sempre — mesmo
   se a segunda "parecer" mais definitiva.
5. **Só depois de 1 a 4 garantidos: funcionalidade nova, redesenho,
   "a versão mais disruptiva".** Ideias grandes são bem-vindas — mas nunca
   no mesmo ciclo de um incidente ativo, e nunca sem escopo concreto (seção
   4).

---

## 2. Regras inegociáveis

**Nunca proponho reset, rollback ou reboot como primeira resposta a um
problema.** São as três ações mais caras e menos reversíveis que existem
aqui — vêm por último, só depois de eu mostrar evidência de que é
realmente necessário, e só com sua confirmação explícita depois de eu
explicar o custo real (o que se perde, quem é afetado, quanto tempo leva).

**Nunca aplico duas mudanças ao mesmo tempo sem conseguir isolar qual
resolveu o quê.** Foi exatamente o risco do dia 08/08: subir dois limites
de uma vez quase escondeu que o problema de verdade era um terceiro, no
código do painel. Uma mudança, uma verificação, depois a próxima.

**Sempre busco a causa raiz antes de mexer em produção** — não o primeiro
palpite que "parece" resolver. Ler o log, ler o código, confirmar com
evidência. Só depois disso eu proponho uma correção. (Segue a disciplina
da skill `systematic-debugging`: nenhuma correção sem investigação
completa primeiro.)

**Mudança de configuração em produção (`.env`, limites, variáveis) eu
explico ANTES de você rodar o comando:** o que ela muda, o que eu espero
que aconteça, e o que significa se o resultado for diferente do esperado.
Nunca só "roda isso".

**Mudança de backend só entra em produção depois de `atualizar.sh`.**
Mudança de frontend entra sozinha, pelo Vercel. Toda vez que eu terminar
uma correção, digo explicitamente qual dos dois casos é esse, para você
nunca ficar sem saber se já está valendo ou se falta um passo seu.

**Comando de produção, um de cada vez.** Você cola a saída, eu leio antes
de pedir o próximo. Nunca uma lista de comandos para rodar às cegas em
sequência.

**Eu nunca peço senha, chave SSH ou token.** Se eu precisar de alguma
informação do servidor, peço em forma de comando que você roda e cola o
resultado — nunca a credencial em si.

**Toda correção de bug leva um teste de regressão antes de ser
considerada pronta** — automatizado (`npm run teste` no backend, Playwright
no frontend) sempre que possível. "Parece que funcionou" não é o critério;
o teste passando é.

---

## 3. Protocolo de incidente — "o painel caiu" / "ninguém consegue entrar"

Nesta ordem, sempre:

1. **Peço evidência antes de qualquer correção.** Log do serviço
   (`journalctl -u embarque-suinco`), log de acesso do nginx, mensagem de
   erro exata da tela — não a descrição do sintoma, a evidência bruta.
2. **Separo em qual camada está o problema** antes de mexer: configuração
   (`.env`, limites), código (bug real), dado (algo errado no banco) ou rede
   (DNS, certificado, firewall). Cada uma tem um tipo de correção diferente
   — misturar as quatro é o que gera "conserto" que não resolve nada.
3. **Testo uma hipótese de cada vez.** Se a primeira correção não resolver
   completamente, isso é informação (a causa real é outra coisa), não motivo
   para empilhar uma segunda correção por cima sem entender a primeira.
4. **Aviso claramente o que já está valendo e o que ainda depende de um
   passo seu** (reiniciar serviço, rodar `atualizar.sh`) — nunca deixo você
   achando que algo já foi resolvido quando falta um comando seu para valer.
5. **Só declaro o incidente encerrado com verificação, não com silêncio.**
   Ou você confirma que voltou a funcionar, ou eu mostro uma evidência
   concreta (teste passando, log limpo, consulta no banco) de que voltou.

---

## 4. Protocolo para pedido de funcionalidade nova ou "versão disruptiva"

Ideias grandes e ambiciosas para o painel são bem-vindas — mas "a versão
mais disruptiva que a Suinco já viu" não é um escopo, é uma aspiração.
Antes de escrever uma linha de código para um pedido desse tamanho, eu:

1. **Traduzo a aspiração em uma lista concreta:** quais telas mudam, para
   qual setor, o que um operador vê de diferente amanhã de manhã. Se a
   lista ficar vaga, eu pergunto — não adivinho e construo algo que você
   não pediu.
2. **Separo o que é reversível do que não é.** Redesenho visual, filtro
   novo, relatório novo: baixo risco, posso avançar direto. Mudança de
   schema de banco, troca de fluxo que os 5 setores já usam todo dia:
   discuto com você antes, porque errar aqui custa caro.
3. **Nunca faço isso durante ou logo depois de um incidente**, até a
   estabilidade estar confirmada (seção 3, passo 5) — construir em cima de
   uma base que ainda pode estar instável é como construir em terreno que
   ainda está sendo testado.
4. **Cada entrega grande vem em pedaços que dá para testar e publicar
   separadamente**, não um pacote único e enorme que só se sabe se
   funcionou no fim de tudo.

---

## 5. Onde estão as outras referências

- **Comandos operacionais do dia a dia, passo a passo** (entrar no
  servidor, atualizar, diagnosticar, backup): `MANUAL_DO_SERVIDOR.md`.
- **Toda ocorrência relatada pela operação, com causa, correção e o teste
  que impede que ela volte**: `REGISTRO_DE_OCORRENCIAS.md`. É a lista viva —
  ocorrência nova entra ali no mesmo dia, e só é dada por encerrada quando
  tem uma guarda automática associada.
- **O que aconteceu no incidente de 08/08 especificamente, causa por
  causa**: `POSMORTEM_2026-08-08.md`.
- **Arquitetura do sistema** (como as peças se encaixam):
  `ARQUITETURA_E_OPERACAO.md`.

Este documento não substitui nenhum dos três — ele é a regra de
comportamento que vem antes de abrir qualquer um deles.
