# Por quê — camada "Vercel"
Vidro (blur, translúcido, brilho de topo) e sombra difusa saem — o oposto
de "profundidade declarada". Entram: placas opacas com contorno de 1px,
cantos de 2px, e sombra dura (offset sólido, zero blur) só em modal, CTA
primário e o indicador em destaque.
Cor vira acento raro: painel inteiro em preto/branco puro; o dourado da
marca sobra como único acento. As seis cores de status **não mudam de
valor** (mandato do gestor) — só leem mais fortes contra fundo mono.
Toda a folha vive dentro de `@media screen`: forma mais segura de cumprir
"`@media print` intocado" sem depender de excluir regra por regra.
Cada token novo foi medido por contraste antes de entrar (texto e borda
não-textual ≥3:1) — números no cabeçalho do `camada.css`.
⬜ proposta de competição — nada commitado, nada publicado.
