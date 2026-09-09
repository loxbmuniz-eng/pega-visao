# Navegador para agentes

Dá ao seu agente um navegador de verdade: ele carrega a página, espera o
JavaScript montar o conteúdo, e devolve **o que interessa** — texto limpo,
links, dado estruturado — em vez de HTML cru.

```bash
./navegador extrair https://exemplo.com --markdown
./navegador captura https://exemplo.com --inteira --saida pagina.png
./navegador fluxo receita.json
./navegador robots https://exemplo.com     # o que o site permite
./navegador servidor                       # API HTTP para o agente usar
```

---

## Por que não `fetch` + regex

Metade da web monta o conteúdo com JavaScript: `fetch` devolve o esqueleto e
o texto que você queria não está lá. E quando está, vem afogado em menu,
rodapé e script — o pedaço que gasta contexto e não responde pergunta
nenhuma.

Aqui a extração roda **dentro da página**, com o DOM montado, e escolhe o
container principal **por densidade de texto**, não por tag. Muito site não
usa `<article>`; muitos usam `<article>` no card da barra lateral. Densidade
erra menos:

```
pontos = tamanho do texto / (1 + número de links × 40)
```

Muito link e pouco texto é índice, não conteúdo.

---

## robots.txt e ritmo estão no núcleo, não numa opção

Um agente que navega rápido demais derruba site pequeno, queima o IP de quem
o roda e transforma pesquisa legítima em incidente.

- **robots.txt é consultado antes de cada URL**, com `Allow`/`Disallow`,
  curinga `*`, âncora `$`, precedência por regra mais específica, e grupo de
  `User-agent` específico ganhando do `*`.
- **`Crawl-delay` do site é respeitado**; sem ele, 1 segundo entre
  requisições ao mesmo host.
- **O agente se identifica**: `NavegadorAgente/0.1 (+agente de IA; respeita
  robots.txt; contato via operador)`.
- **robots.txt com erro 5xx é tratado como "não insista"** — servidor com
  problema não autoriza nada. 404 é liberado, como manda o padrão.

`--ignorar-robots` existe para site próprio e ambiente de teste. Vem
desligado, e quem liga assume a decisão.

---

## O que este projeto NÃO faz — e por quê

O Camofox original é um Firefox com falsificação de impressão digital no
nível de C++, para **não ser detectado**. Isso não foi construído aqui, e a
omissão é deliberada.

Contornar detecção é a parte que serve para burlar bloqueio de quem já disse
não: passar por limite de taxa, acessar o que o site recusa a robôs, criar
conta em massa. As coisas úteis do carrossel — **extrair dados de sites,
pesquisar concorrentes, automatizar fluxos** — não precisam disso. Elas
precisam de um navegador que execute JavaScript, e é isso que está aqui.

Se o seu caso legítimo esbarra em bloqueio (seu próprio site atrás de WAF,
um fornecedor que te deu acesso), o caminho é credencial, API oficial ou
liberação de IP — não disfarce. Se o alvo é um site que te bloqueou de
propósito, o projeto não vai te ajudar, e é o desenho.

---

## A API HTTP

```bash
./navegador servidor --porta 8787
```

| Rota | Corpo | Devolve |
|---|---|---|
| `POST /extrair` | `{"url":"…","formato":"markdown","seletor":".post"}` | JSON ou markdown |
| `POST /captura` | `{"url":"…","paginaInteira":true}` | `image/png` |
| `POST /fluxo` | `{"passos":[…]}` | resultado de cada passo |
| `GET /saude` | — | `{"ok":true}` |

**Ouve só em `127.0.0.1` por padrão.** Um serviço que abre qualquer URL e
devolve o conteúdo é um proxy: exposto na rede, vira porta de entrada para
alcançar o que estiver atrás do firewall de quem o roda. Mudar o host imprime
o aviso.

Bloqueio de robots.txt volta **403**, não 500 — um agente que trata os dois
igual fica tentando de novo contra um site que já disse não.

---

## Fluxos

```json
{
  "passos": [
    { "ir": "https://exemplo.com/busca" },
    { "digitar": { "seletor": "#q", "texto": "guarda-chuva" } },
    { "clicar": "#enviar" },
    { "esperar": ".resultado" },
    { "ler": ".resultado .preco" },
    { "extrair": true }
  ]
}
```

Passos: `ir` · `esperar` (seletor) · `pausar` (ms) · `clicar` · `digitar` ·
`ler` (devolve o texto de todos os que casam) · `extrair` (a extração
completa). Cada passo que falha diz **qual seletor** não foi encontrado.

O navegador é reaproveitado entre pedidos — cookie de sessão e login
continuam valendo. Cada aba é isolada.

---

## Estrutura

```
navegador             entrada (bash -> cli.mjs)
cli.mjs               os cinco comandos
nucleo/
  cdp.mjs             lança o Chromium e fala CDP (WebSocket nativo do Node)
  pagina.mjs          navegar, avaliar, capturar
  robos.mjs           robots.txt, ritmo por host, identificação
  extrair.mjs         a extração que roda dentro da página
  navegador.mjs       a sessão: extrair, capturar, fluxo
  servidor.mjs        a API HTTP
testes/               28 testes, contra um site de mentira em 127.0.0.1
```

**Zero dependências.** Node 22+ (WebSocket nativo) e um Chromium.
`CHROMIUM_BIN=/caminho/do/chrome` se não achar sozinho.

```bash
npm run teste
```

Nenhum teste toca a internet: teste que depende de rede falha por motivo
errado e ensina a ignorar vermelho.

---

## O que ainda não existe

- ⬜ **Sessão nomeada / persistência de login.** O navegador vive enquanto o
  servidor vive; não há perfil salvo em disco entre execuções.
- ⬜ **Paginação automática.** `fluxo` clica em "próxima" se você mandar, mas
  não descobre sozinho.
- ⬜ **Proxy por requisição.** Não há rotação nem configuração de saída.
- ⬜ **PDF.** O Chrome sabe imprimir; o comando não foi exposto.
- ⬜ **Limite global de requisições.** O ritmo é por host; não há teto de
  volume por hora para a máquina inteira.
