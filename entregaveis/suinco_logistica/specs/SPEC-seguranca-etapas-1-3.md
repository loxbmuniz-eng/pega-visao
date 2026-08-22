# SPEC — Segurança, etapas 1 a 3

**Autorizado por Luis em 22/08/2026.** Etapa 4 (segundo fator) fica para depois,
com aviso prévio.

## Assunções que estou fazendo — corrija se alguma estiver errada

1. **A Torre compartilhada continua compartilhada.** `GET /estado` devolve o
   pátio inteiro a qualquer setor logado, e isso é FEATURE, não brecha: cinco
   setores enxergando o mesmo pátio é o que substituiu o WhatsApp. Não vou
   restringir leitura de pátio por setor.
2. **O que se controla é o documento que sai do prédio.** PDF e CSV são o que
   atravessa a fronteira da empresa; é neles que entra dono e registro.
3. **Sem parada da operação.** Nenhuma etapa exige que alguém mude de hábito.
4. **Segunda assinatura só para o que destrói ou reescreve o passado** —
   restaurar versão, desfazer exclusão e corrigir etapa. Operação normal
   (mudar status, lançar carga) não ganha atrito nenhum.

## Objetivo

| Etapa | Fecha | Resultado observável |
|---|---|---|
| 1 | B1, B2 | Cada relatório declara quem pode gerá-lo, validado no servidor; toda geração e exportação fica registrada com autor, hora, recorte e origem |
| 2 | B3 | Desligar ou revogar um operador derruba a sessão dele em todos os aparelhos, na hora |
| 3 | B5 | Restaurar, desfazer exclusão e corrigir etapa exigem dois administradores distintos, com motivo, e avisam os demais |

## Matriz de permissão de documento (etapa 1)

| Documento | Quem pode gerar |
|---|---|
| Relatório Operacional | Logística, Administração |
| Relatório Executivo | Logística, Administração |
| Administração de Fretes | Administração |
| Ficha de uma carga | Logística, Administração, Expedição, Faturamento |
| Programação do dia (controle) | Logística, Administração |
| Devoluções do dia | Logística, Administração, Controles Internos, Central de Notas |
| Relação por operador | Logística, Administração, Controles Internos, Central de Notas |
| Comprovante da Portaria | Portaria, Logística, Administração |
| Exportação CSV / Power BI | Administração |

Administração está em todas por definição do middleware (`exigirSetor` sempre
a inclui). Comercial e demais perfis de leitura ficam fora de todos — quem só
consulta não leva documento embora.

## Decisões de projeto

**Por que o tipo do documento é declarado pelo cliente e mesmo assim vale.**
A rota de PDF recebe HTML montado pelo painel; o servidor não tem como
inferir qual relatório é. Então o tipo vem declarado e é validado contra o
setor. Um cliente adulterado pode mentir no tipo — e é por isso que a mentira
**também fica registrada**: o registro guarda o tipo declarado, o setor, a hora
e o endereço. Barra o caminho fácil e transforma o caminho difícil em prova.

**Por que o registro de leitura não cobre `/estado`.** Cada terminal consulta o
estado a cada poucos segundos; registrar isso encheria a tabela de ruído e
esconderia o que importa. Registram-se as leituras que **produzem documento**:
PDF, CSV e exportação de BI. Leitura completa de estado (sem `desde`) é
registrada por ser o padrão de quem está copiando a base.

**Por que a versão de sessão é conferida no banco a cada requisição.** Custa uma
consulta indexada por requisição, com ~30 operadores e volume baixo. A
alternativa (conferir só na renovação) deixaria janela de até 12 horas — que é
exatamente a brecha B3.

**Por que a segunda assinatura não pode ser a mesma pessoa.** Duas contas de
administrador na mão de uma pessoa só derrotam o controle; o servidor recusa
aprovação de quem pediu, e o registro guarda os dois nomes.

## Critérios de aceite

- [ ] Portaria recebe 403 ao pedir Relatório Operacional; Logística recebe 200
- [ ] Toda geração de PDF grava linha em `log_leitura` com tipo, setor, autor, ip
- [ ] Exportação de BI grava linha com a view consultada e o número de linhas
- [ ] Desativar operador invalida o token dele na requisição seguinte
- [ ] Trocar a senha de um operador invalida as sessões antigas dele
- [ ] Restaurar revisão sem aprovação pendente devolve 409 com o pedido criado
- [ ] Aprovação pelo MESMO administrador que pediu é recusada com 403
- [ ] Aprovação por outro administrador executa a ação e registra os dois nomes
- [ ] Nenhuma suíte existente quebra (260 testes de servidor + 95 de navegador)

## Fronteiras

- **Sempre:** validação no servidor; migração reversível; teste antes do código.
- **Perguntar antes:** qualquer coisa que mude o fluxo de login da operação.
- **Nunca:** quebrar a Torre compartilhada; guardar segredo no repositório.
