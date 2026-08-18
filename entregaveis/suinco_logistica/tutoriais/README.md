# Guias do painel, um por setor

PDFs institucionais que ensinam cada setor a operar o painel, com prints
REAIS da tela — o navegador entra no painel com um usuário daquele setor e
fotografa exatamente o que a pessoa vai ver. Nenhuma tela é desenhada à mão,
então o guia envelhece junto com o sistema: mudou a tela, roda de novo.

Cada passo responde às mesmas quatro perguntas — **o que fazer**, **onde
fica**, **por que existe** e **quando fazer** —, porque é isso que falta num
manual de tela: a pessoa entende o botão e não entende o momento de usá-lo.

## Como gerar

```bash
# 1. banco local no ar, migrações aplicadas
cd backend && npm run migrar && node src/servidor.js &

# 2. operadores de demonstração (nomes limpos nos prints)
cd backend && node scripts/preparar_demo_guias.js

# 3. os guias
python3 tutoriais/gerar_guias.py               # todos
python3 tutoriais/gerar_guias.py Portaria      # um só
```

Os PDFs saem em `tutoriais/pdf/`. As capturas e o HTML intermediário ficam
em `tutoriais/capturas/` e `tutoriais/_guia_*.html` (fora do git — são
subprodutos, o script os refaz).

## Onde mexer

- `roteiros.py` — o texto de cada passo, por setor. É aqui que se escreve o
  guia: título, os quatro blocos, qual aba abrir, qual elemento destacar e
  qual cenário de dados o passo precisa.
- `dados_demo.py` — o checklist de exemplo (inclusive as duas parciais da
  mesma nota) e as cargas de demonstração.
- `gerar_guias.py` — a mecânica: login, cenário, realce, recorte, PDF.

## Pendência conhecida

O mascote **Pipo** ainda não está no repositório. A capa de cada guia já tem
o espaço reservado para ele; assim que o arquivo de imagem chegar, é só
apontar o caminho em `gerar_guias.py` (onde hoje está o bloco "ESPAÇO
RESERVADO") e regerar.
