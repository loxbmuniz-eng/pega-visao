# Claude Ads — auditoria de anúncios

Você exporta o CSV da plataforma. O motor calcula onde o dinheiro está sendo
queimado, o que está ganhando e para onde mover a verba. O Claude escreve a
leitura de negócio em cima.

```bash
./ads auditar exemplos/meta_ads_exemplo.csv --roas-alvo 3
./ads verba <arquivo.csv>       # só o plano de realocação
./ads criativo <arquivo.csv>    # ranking por CTR
./ads plano <arquivo.csv>       # lista numerada de ações
```

No Claude Code: `/ads audit <arquivo>`, `/ads budget`, `/ads creative`,
`/ads plan`, `/ads google`, `/ads meta`, `/ads competitor`.

---

## A divisão que faz isto valer alguma coisa

**O motor calcula. O modelo interpreta.** Nunca o contrário.

Um LLM lendo planilha de mídia direto produz número plausível e errado — e
número errado sobre verba vira decisão errada sobre dinheiro. Aqui a
aritmética é Python auditável, com teste. O que o Claude acrescenta é a
leitura: *por que* aquele criativo não para o dedo, *o que* medir depois de
mexer, *em quantos dias*.

---

## As três travas

### 1. Volume mínimo — por dimensão

| Para dizer | Precisa de |
|---|---|
| algo sobre CTR | 1.000 impressões |
| "teve tráfego e não converteu" | 30 cliques |
| comparar CPA ou eleger vencedor | 5 conversões |

Matar um criativo com 3 cliques é o erro mais caro da otimização manual: o
que se mede ali é ruído, e o anúncio que seria vencedor morre antes de
existir amostra. O que fica abaixo do limiar sai em **"sem volume para
julgar"** — que não é sinônimo de perdedor.

> A primeira versão usava um limiar só, e elegeu **vencedor** uma linha com
> **uma** conversão. Um vencedor de uma conversão manda verba real para o
> lugar errado. Daí a trava por dimensão.

### 2. A referência é a mediana das SUAS linhas

Não há benchmark de mercado inventado aqui. A régua é a mediana das próprias
linhas com volume — mediana e não média, porque uma campanha gigante e ruim
puxaria a média e absolveria o resto.

E só vale com **pelo menos 3 linhas comparáveis**: com menos, a mediana é a
própria linha, nada pode ser 30% melhor que si mesmo e "1,5x acima da
mediana" acusa metade da conta por acaso. Nesse caso o relatório para e pede
`--cpa-alvo`.

### 3. Teto de crescimento na realocação

Dobrar a verba de um vencedor não dobra o resultado: o leilão encarece e o
público bom satura. O plano nunca sugere mais que **2x** o gasto atual de uma
linha. O que sobra vira recomendação de **criativo ou público novo** — não
mais verba no mesmo lugar.

---

## O leitor de planilha

Aceita o export como ele sai, sem você renomear coluna:

- **Meta Ads** e **Google Ads**, em português e inglês
- Separador `,` ou `;`
- Linhas de título antes do cabeçalho (o Google Ads põe duas)
- Rodapé de "Total: conta" — ignorado
- `R$ 1.234,56` e `1,234.56`

> **A convenção decimal é detectada nas células já separadas, não no texto
> cru.** Num CSV separado por vírgula, a vírgula de coluna é idêntica a uma
> vírgula decimal: `X,150.00,4000,90,7` contém `,90,` e o texto cru parecia
> português — lia `150.00` como `15000`. Num relatório de verba, isso erra
> por mil vezes com um número que parece plausível.

---

## Estrutura

```
ads                     entrada (bash -> cli.py)
cli.py                  os quatro comandos
motor/
  planilha.py           lê o export, mapeia coluna, detecta decimal
  auditoria.py          as travas e os achados
  relatorio.py          formatação
.claude/
  commands/ads.md       o slash command /ads
  skills/claude-ads/    a skill com as regras de leitura
testes/                 23 testes (unittest, stdlib)
exemplos/               um export de exemplo para rodar hoje
```

**Zero dependências.** Python 3.11+ da biblioteca padrão.

```bash
python3 -m unittest discover -s testes -p 'test_*.py'
```

---

## O que NÃO existe

- ⬜ **Concorrência.** `/ads competitor` monta o roteiro de coleta, não a
  análise: exige fonte externa (Biblioteca de Anúncios, Planejador de
  Palavras-chave) que este projeto não acessa. Análise de concorrente sem
  fonte é ficção.
- ⬜ **Conexão com API de plataforma.** É CSV na mão. Não há token, não há
  OAuth, e nada aqui altera campanha nenhuma.
- ⬜ **Série temporal.** O relatório é uma foto do período exportado. Não
  compara semanas nem detecta tendência.
- ⬜ **Atribuição.** Usa a conversão que a plataforma reporta, com o modelo
  de atribuição que ela usou. Não corrige nem reconcilia com o seu backend.
- ⬜ **Frequência e saturação.** A coluna não é lida — quando ela existir no
  export, é a próxima métrica a entrar.

## O que o relatório não sabe

Sazonalidade, estoque, margem por produto, o que mudou na landing page, e se
a conversão registrada é a que importa para o negócio. **Nada aqui deve virar
pausa automática sem alguém olhar.**
