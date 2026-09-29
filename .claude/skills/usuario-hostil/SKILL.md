---
name: usuario-hostil
description: Faz o papel do pior usuário possível do painel Suinco (porteiro com pressa, de luva, sol na tela; conferente que odeia sistema) para achar ATRITO que teste nenhum pega, e depois filtra o desabafo para separar problema real de "odeio computador". Use antes de publicar tela nova de operação, depois de um lote de mudanças visuais, ou quando o Luis disser que "ninguém vai usar isso". Só aponta; não corrige.
---

# Usuário hostil

Adaptada de `adversarial-ux-test` (Hermes Agent, Nous Research — autor Omni
@ Comelse, licença MIT). Ver `ORIGEM_DAS_SKILLS_DE_DESIGN.md`.

A bateria acha defeito. Esta acha **atrito**: a tela tecnicamente certa que
ninguém consegue usar no portão às 5h da manhã.

## 1. Escolha UM personagem — do pátio, não genérico

Responda antes de abrir o painel:

1. Quem é o usuário MAIS difícil desta tela? (setor, idade, anos fazendo "do jeito antigo")
2. Qual o conforto dele com tecnologia? (quanto menor, melhor)
3. Qual a UMA coisa que ele precisa fazer? (a tarefa dele, não a lista de funções)
4. O que faz ele desistir e voltar para o papel / o rádio / o WhatsApp?
5. Como ele fala quando irrita?

Personagens de partida (ajuste à tela testada):

| Setor | Personagem | Traço que importa |
|---|---|---|
| Portaria | Porteiro do turno da madrugada, 55 anos | celular na mão, luva, sol ou chuva na tela, fila de caminhão buzinando |
| Expedição | Conferente na doca | uma mão ocupada, pressa, só quer "Iniciar" e "Finalizar" |
| Faturamento | Faturista com três sistemas abertos | não quer digitar duas vezes o que o Sisatak já tem |
| Filial | Operador de filial que usa o painel uma vez por semana | não lembra onde fica nada |
| Gestão | Gestor que abre o painel no celular entre reuniões | quer o número em 5 segundos, sem rolar |

Personagem vago ("um usuário que não gosta") não serve: tem de dar para ficar
no papel por 20 minutos.

## 2. Use a tela COMO o personagem

- Rode o painel de verdade no navegador da bateria (Chromium em
  `/opt/pw-browsers/chromium`), na largura dele: 390px para quem está no
  pátio (`is_mobile=True, has_touch=True`), 1440px para quem está na mesa.
  Base: `vitrine/vitrine.html` (dados de demonstração, sem servidor) ou a API
  local com o banco descartável — **nunca produção**.
- Faça a TAREFA dele, não um passeio pelas abas. Conte os toques até terminar.
- Tire print de cada ponto de dor; leia o console depois de cada ação.
- Categorias: primeira impressão, a tarefa principal, errar e se recuperar,
  leitura (tamanho, contraste, sol), velocidade, palavras que ele não usa,
  saber onde está e voltar.

## 3. O desabafo — na voz dele

```
Avaliação do [PERSONAGEM] — [TELA]
Continuaria usando? Sim / Não / Só se…
O QUE PRESTA (a contragosto):
O QUE ATRAPALHA:
O QUE FAZ LARGAR:
RECLAMAÇÕES: 1. [tela/botão]: "[frase dele]" — [o que aconteceu × o que esperava]
VEREDITO: "[uma frase dele]"
```

## 4. O filtro — OBRIGATÓRIO, fora do personagem

- **VERMELHO — defeito de uso real**: qualquer pessoa ocupada teria o problema;
  ou é acessibilidade (alvo < 44px, contraste, letra pequena); ou a tarefa
  principal passa de 5 toques.
- **AMARELO — real, mas de caso extremo**: anota numa lista só.
- **BRANCO — ruído do personagem** ("quero que seja papel"): só no relato.
- **VERDE — ideia boa escondida na reclamação**: vira proposta ⬜.

Nunca mande o desabafo cru como pedido de correção.

## 5. Entrega — com as regras da casa

- Até 10 itens VERMELHO/VERDE, cada um com: a frase do personagem, o problema
  objetivo, o print, e a sugestão. É **proposta ⬜** — nada é corrigido aqui
  (CLAUDE.md: toda demanda vira PROMPT antes do código).
- Cruze com `docs/REGISTRO_DE_OCORRENCIAS.md` DEPOIS do teste: problema que o
  personagem achou e já está registrado é o achado mais grave — alguém sabia e
  ninguém sentiu.
- Personagem sem nenhuma reclamação = personagem esperto demais. Refaça mais
  velho, com mais pressa.
- Não mexa em campo, coluna ou ordem de tela por conta própria: a estrutura da
  Torre, da Montagem e dos campos editáveis é decisão do dono.
