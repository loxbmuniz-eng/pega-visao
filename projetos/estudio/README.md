# Estúdio — vídeo escrito em HTML, CSS e JS

Você escreve uma página. O estúdio devolve o vídeo.

Junta duas ideias do carrossel num projeto só, porque na prática são a mesma
bancada: **compor** o vídeo em código (HyperFrames) e **gerar** o material que
entra nele com modelos locais (Open-Gen-AI). Trading ficou de fora de
propósito — é outro projeto.

```bash
./estudio checar                              # o que a máquina tem
./estudio renderizar social                   # um vídeo
./estudio lote social exemplos/clientes.csv   # um vídeo por linha da planilha
```

---

## Para que serve

| | |
|---|---|
| Páginas de lançamento | `cenas/lancamento` · 1920x1080 |
| Demonstração de produto | `cenas/demo_produto` · 1920x1080 |
| Anúncios | `cenas/anuncio` · 1080x1080 |
| Redes sociais | `cenas/social` · 1080x1920 |

Cada uma é **um arquivo HTML**. Para mudar a arte, edite o HTML. Para criar
uma frente nova, copie a pasta.

---

## A regra que sustenta tudo: a cena não anima sozinha

Uma cena expõe `aoTempo(t)` e **o renderizador é quem manda no relógio**.

```js
window.cena = {
  duracao: 8, fps: 30, largura: 1080, altura: 1920,
  aoTempo(t) { /* posiciona a cena no instante t */ },
};
```

Por isso proibimos `animation` e `transition` do CSS (o `base.css` desliga os
dois à força). Com relógio próprio, o quadro 47 é o quadro 47 em qualquer
máquina — a rápida e a que está engasgada renderizando outras 200 linhas.
Gravação de tela não tem essa garantia: em máquina carregada ela pula quadro,
e o vídeo entregue deixa de ser o vídeo aprovado.

Existe um teste só para isso, e ele é o mais importante do projeto:
`testes/teste_render.mjs` renderiza o mesmo instante duas vezes e exige
bytes idênticos.

---

## Lote: a planilha vira os vídeos

Cada linha do CSV vira `window.__dados` de um render.

```
nome;titulo;destaque;itens;cta
padaria_do_ze;Sua padaria no Instagram;padaria;Foto do dia | Cardápio;peça no WhatsApp
```

- A coluna **`nome`** vira o nome do arquivo.
- Dentro de uma célula, **`|` separa itens de lista** e **`::` separa partes de
  um item** (`312 vídeos :: por mês`).

> **Por que `|` e não `;`.** O Excel em português exporta CSV separado por `;`.
> Um `;` solto dentro da célula desloca todas as colunas seguintes e o vídeo
> sai com o texto da coluna errada — sem erro, sem aviso. Aconteceu no
> primeiro lote deste projeto. Hoje o leitor de CSV **para e diz** quando uma
> linha tem mais campos que o cabeçalho, e a lista usa `|`, que não colide com
> nenhum separador de CSV.

Uma linha que falha não derruba as outras: o lote segue e imprime o resumo no
fim.

---

## Motor de geração (a parte "modelos locais")

O estúdio não conhece modelo nenhum — conhece **provedores**. Trocar de modelo
é editar `geracao/provedores.json`; nada no resto do estúdio muda.

```bash
./estudio gerar                            # lista provedores e quais estão prontos
./estudio gerar imagem "cozinha ao amanhecer"
./estudio gerar voz "texto da locução"
```

| Provedor | Tipo | Precisa de |
|---|---|---|
| `comfyui` | imagem | ComfyUI local + um workflow API exportado |
| `piper` | voz | binário do piper + arquivo de voz `.onnx` |
| `ollama` | texto | Ollama local |
| `openai_compativel` | texto | LM Studio, llama.cpp server, vLLM |
| `espaco_reservado` | imagem, voz | nada — sempre funciona |

**O que está pronto e o que não está.** Os adaptadores estão escritos e o
despacho funciona. Nenhum modelo foi instalado nem testado contra um servidor
real aqui — nesta máquina não há ComfyUI, Ollama nem piper. Então: 🟡 código
pronto, ⬜ **não validado contra servidor de verdade**. Quando você subir o seu,
`./estudio gerar` dirá na hora se ele foi encontrado.

O `espaco_reservado` existe para você não ficar travado: ele não inventa arte,
entrega um marcador com o pedido escrito na cara, no tamanho certo — e, para
voz, **silêncio com a duração que a locução teria** (150 palavras/min). Serve
para cronometrar a cena antes de existir áudio; trocar pelo real depois não
mexe no tempo.

---

## Formato de saída: o estúdio negocia com o ffmpeg que existir

`./estudio checar` diz o que a sua máquina consegue:

```
codecs     H.264/mp4: NÃO · VP8/webm: sim · áudio: NÃO
quadros    lê PNG em arquivo: não · aceita pipe: sim · mjpeg: sim
           -> os quadros serão capturados em JPEG (é o que este ffmpeg lê)
```

Duas builds de ffmpeg circulam por aí e elas **não** fazem as mesmas coisas:

- **ffmpeg completo** (`apt install ffmpeg`, `brew install ffmpeg`) — H.264,
  MP4, áudio, lê PNG. É o que você quer para publicar: Instagram e TikTok
  pedem MP4.
- **ffmpeg que vem com o Playwright** — só VP8/WebM, sem áudio, **não
  decodifica PNG** e só aceita quadro por `pipe:0`. Roda, mas não gera MP4.

O estúdio detecta qual é e se adapta: escolhe o codec, escolhe o formato do
quadro (PNG sem perda quando dá, JPEG 95 quando o ffmpeg não lê PNG) e entra
por arquivo ou por pipe. Os quadros ficam salvos, então dá para recodificar
depois **sem renderizar de novo**:

```bash
./estudio montar saida/social_quadros --formato mp4
```

---

## Estrutura

```
estudio               entrada (bash -> cli.mjs)
cli.mjs               os comandos
motor/
  cdp.mjs             lança o Chromium e fala CDP (WebSocket nativo do Node)
  pagina.mjs          navegar, avaliar, capturar
  renderizar.mjs      o laço quadro a quadro
  ffmpeg.mjs          descobre o que o ffmpeg local sabe fazer
  csv.mjs             leitor de CSV que não desalinha coluna
  lote.mjs            planilha -> N vídeos
cenas/
  base.css  kit.js    tokens e as ajudas de animação
  social/ lancamento/ demo_produto/ anuncio/
geracao/              provedores de imagem, voz e texto
testes/               node --test
```

**Zero dependências.** Nem npm no runtime. O Node 22 já traz WebSocket, então
o Chromium é dirigido direto por CDP; Puppeteer/Playwright trariam ~300 MB e
uma versão de navegador para gerenciar em troca de recursos que não usamos.

---

## Rodar

Precisa de Node 20+, um Chromium/Chrome e (para o vídeo) ffmpeg.

```bash
npm run teste     # ou: node --test "testes/teste_*.mjs"
npm run checar
```

Se faltar Chromium, aponte: `CHROMIUM_BIN=/caminho/do/chrome`.
Se quiser outro ffmpeg: `FFMPEG_BIN=/caminho/do/ffmpeg`.

---

## O que ainda não existe

Escrito aqui para ninguém contar com o que não foi feito:

- ⬜ **Trilha de áudio de verdade** — o código muxa áudio, mas depende de um
  ffmpeg com codificador de áudio. Não foi testado com arquivo real.
- ⬜ **Transição entre cenas** — cada cena vira um vídeo. Emendar dois ainda é
  trabalho de ffmpeg na mão.
- ⬜ **Render paralelo** — o lote é sequencial, um navegador por vídeo. É mais
  lento de propósito: estado vazado entre linhas produz vídeo com o dado da
  linha anterior.
- ⬜ **Provedores de geração validados** — ver a seção do motor de geração.
