const P = require("pptxgenjs");
const A = "/tmp/claude-0/-home-user-pega-visao/348e86a7-e79e-5678-8e97-1bfec678684b/scratchpad/assets/";

const GRAF = "141312", CREME = "F5F0E5", BODY = "D6D0C4", MUDO = "8A8478",
      OLIVA = "A8B848", MAGENTA = "D8336B", LILAS = "9E5D9E",
      CORAL = "D63E3C", TEAL = "3D8FA6", OURO = "C9A063";
const SERIF = "Cambria", SANS = "Arial";
const M = 0.62, CWD = 13.333 - 2 * M;
const ilus = (n) => `${A}ilustras_png/ilustra-${String(n).padStart(2, "0")}.png`;
const foto = (n) => `${A}fotos/${n}.jpg`;

const pres = new P();
pres.layout = "LAYOUT_WIDE";
pres.author = "Luis Otávio Muniz · Ota Blind";
pres.title = "Pega Visão × Universo Paralello 19";

let N = 0;
function slide(accent) {
  const s = pres.addSlide();
  s.background = { color: GRAF };
  N++;
  return s;
}
function kicker(s, txt, accent) {
  s.addText(txt, { x: M, y: 0.34, w: 9, h: 0.3, fontFace: SANS, fontSize: 10.5,
    bold: true, color: accent, charSpacing: 3.4, margin: 0, valign: "middle" });
}
function pageno(s, accent) {
  s.addText(String(N).padStart(2, "0"), { x: 13.333 - M - 1, y: 6.86, w: 1, h: 0.3,
    fontFace: SANS, fontSize: 9.5, color: MUDO, align: "right", margin: 0, charSpacing: 1.6 });
}
function head(s, txt, accent, opt = {}) {
  s.addText(txt, Object.assign({ x: M, y: 0.86, w: 8.6, h: 1.5, fontFace: SERIF,
    fontSize: 40, bold: true, color: accent, margin: 0, valign: "top", lineSpacing: 44 }, opt));
}
function body(s, txt, o = {}) {
  s.addText(txt, Object.assign({ fontFace: SANS, fontSize: 13, color: BODY,
    margin: 0, valign: "top", lineSpacing: 20 }, o));
}
function bullets(s, items, o = {}) {
  s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i !== items.length - 1 } })),
    Object.assign({ fontFace: SANS, fontSize: 13, color: BODY, margin: 0,
      valign: "top", lineSpacing: 19, paraSpaceAfter: 9 }, o));
}
function card(s, x, y, w, h, accent) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06,
    fill: { color: "1E1C1A" }, line: { color: accent, width: 1 } });
}

/* ─────────────────────────────────── 01 · CAPA */
{
  const s = slide();
  s.addImage({ path: foto("obra_pegavisao"), x: 0, y: 0, w: 6.05, h: 7.5, sizing: { type: "cover", w: 6.05, h: 7.5 } });
  s.addShape(pres.ShapeType.rect, { x: 5.55, y: 0, w: 0.5, h: 7.5, fill: { color: GRAF }, line: { color: GRAF }, transparency: 45 });
  s.addImage({ path: `${A}logo/logo_pegavisao_creme.png`, x: 10.55, y: 0.42, w: 2.16, h: 0.78 });
  s.addText("PROPOSTA DE ATIVAÇÃO ARTÍSTICA · UP 19", { x: 6.5, y: 0.55, w: 3.9, h: 0.3,
    fontFace: SANS, fontSize: 10, bold: true, color: OURO, charSpacing: 2.6, margin: 0, valign: "middle" });
  s.addText([
    { text: "PEGA VISÃO", options: { color: OURO, breakLine: true } },
    { text: "NO UNIVERSO", options: { color: CREME, breakLine: true } },
    { text: "PARALELLO.", options: { color: CREME } },
  ], { x: 6.5, y: 1.52, w: 6.35, h: 3.0, fontFace: SERIF, fontSize: 46,
       bold: true, margin: 0, valign: "top", lineSpacing: 56, charSpacing: 0.5 });
  s.addText("19ª edição · 27 dez 2026 → 04 jan 2027", { x: 6.5, y: 4.78, w: 6.3, h: 0.36,
    fontFace: SANS, fontSize: 15, bold: true, color: BODY, margin: 0 });
  body(s, "Curadoria sensorial de arte tátil, cerâmica às cegas,\ndança guiada e música — atravessada por um gesto só:\na venda nos olhos.",
    { x: 6.5, y: 5.32, w: 6.3, h: 1.1, fontSize: 13.5, color: MUDO });
  s.addText("OTA BLIND · LUIS BADARÓ · MICKAELA · FERNANDA PISTELLI · ANDRÉ ZAMBONINI",
    { x: 6.5, y: 6.62, w: 6.3, h: 0.34, fontFace: SANS, fontSize: 8.6, bold: true,
      color: OURO, charSpacing: 1.1, margin: 0, valign: "middle" });
  s.addNotes("Capa. Janela oficial do UP19: 27/12/2026 a 04/01/2027.");
}

/* ─────────────────────────────────── 02 · A HISTÓRIA */
{
  const s = slide();
  kicker(s, "A HISTÓRIA · VINTE ANOS COM O UP", MAGENTA);
  head(s, "Vinte anos depois,\nno lugar onde tudo começou.", MAGENTA, { w: 7.2, fontSize: 36, lineSpacing: 42 });
  body(s, "Em 2006, com 11 anos, meu pai me levou ao Universo Paralello pela primeira vez. Foi onde a música eletrônica começou pra mim. Voltei como artista em 2013, 2015 e 2017 — três edições no palco Tortuga.\n\nEntre julho de 2022 e setembro de 2024, minha visão ficou severamente comprometida por um descolamento de retina raro. Dois anos, dois meses e dois dias de cegueira. Voltei a enxergar e hoje sou pessoa com deficiência visual monocular.\n\nNo mesmo ano da recuperação, fundei em Cuiabá o Festival Pega Visão. Duas edições realizadas.\n\nO que proponho agora é a continuação natural: levar essa pesquisa de volta pro lugar onde tudo começou.",
    { x: M, y: 2.62, w: 7.1, h: 3.5, fontSize: 12.5, lineSpacing: 18.5 });
  s.addImage({ path: foto("ota_retrato"), x: 8.15, y: 1.02, w: 4.56, h: 4.66, sizing: { type: "cover", w: 4.56, h: 4.66 } });
  const anos = [["2006", "primeira vez"], ["2013/15/17", "palco Tortuga"], ["2022", "a travessia"],
                ["2024", "volta a enxergar · nasce o festival"], ["2025", "segunda edição"], ["2026/27", "o retorno · UP"]];
  const WS = [1.55, 1.95, 1.55, 3.15, 1.75, 1.85];
  let bx = M;
  anos.forEach(([a, b], i) => {
    const w = WS[i];
    s.addText(a, { x: bx, y: 6.28, w, h: 0.3, fontFace: SANS, fontSize: 14.5, bold: true, color: MAGENTA, margin: 0 });
    s.addText(b, { x: bx, y: 6.6, w, h: 0.3, fontFace: SANS, fontSize: 9, color: MUDO, margin: 0 });
    bx += w + 0.16;
  });
  pageno(s);
  s.addNotes("Slide emocional, primeira pessoa do Ota.");
}

/* ─────────────────────────────────── 03 · QUEM SOMOS */
{
  const s = slide();
  kicker(s, "QUEM SOMOS · FESTIVAL PEGA VISÃO", CORAL);
  head(s, "Inclusão como linguagem,\nnão como pauta.", CORAL, { w: 7.0, fontSize: 36, lineSpacing: 42 });
  bullets(s, [
    "Duas edições realizadas em Cuiabá, em 2024 e 2025.",
    "Programação musical, oficinas sensoriais, exposições táteis e tecnologia de acessibilidade.",
    "Público diverso, com protagonismo de pessoas com deficiência visual.",
    "O lucro das edições foi revertido em ação filantrópica local.",
  ], { x: M, y: 2.72, w: 6.5, h: 2.7, fontSize: 13.5, color: BODY });
  s.addImage({ path: foto("palco_cantora"), x: 7.9, y: 1.02, w: 4.81, h: 5.42, sizing: { type: "cover", w: 4.81, h: 5.42 } });
  s.addImage({ path: ilus(2), x: M, y: 5.62, w: 1.5, h: 0.9 });
  pageno(s);
}

/* ─────────────────────────────────── 04 · A IDEIA */
{
  const s = slide();
  kicker(s, "A IDEIA", OLIVA);
  s.addText("Uma sala onde quem entra\né convidado a fechar\nos olhos pra ver melhor.", { x: M, y: 1.24, w: 8.5, h: 2.85,
    fontFace: SERIF, fontSize: 35, bold: true, color: OLIVA, margin: 0, lineSpacing: 47, valign: "top" });
  body(s, "Não é um evento dentro do evento. É uma curadoria de experiências sensoriais integrada à programação do UP. Quatro frentes acontecem ao longo do festival: uma obra tátil na galeria, live painting, cerâmica guiada de olhos vendados e sets musicais. Tudo costurado por um gesto só — a venda de pano oferecida na entrada, passagem pra outro jeito de perceber a arte.",
    { x: M, y: 4.36, w: 8.5, h: 1.8, fontSize: 13.5 });
  s.addText("empatia · sinestesia · escuta · tato · cuidado · travessia · presença · ritual",
    { x: M, y: 6.42, w: 9.4, h: 0.34, fontFace: SANS, fontSize: 11.5, color: OLIVA, margin: 0, charSpacing: 0.6, valign: "middle" });
  s.addImage({ path: ilus(20), x: 9.5, y: 1.5, w: 3.2, h: 3.2 });
  s.addImage({ path: ilus(3), x: 10.4, y: 5.0, w: 2.3, h: 1.5 });
  pageno(s);
}

/* ─────────────────────────────────── 05 · MANIFESTO */
{
  const s = slide();
  s.addText("O escuro me ensinou\no que só o escuro ensina.", { x: 1.4, y: 0.9, w: 10.53, h: 1.7,
    fontFace: SERIF, fontSize: 36, bold: true, color: OURO, align: "center", margin: 0 });
  body(s, "Os olhos são a porta da alma porque é por eles que a alma alcança o outro.\n\nQuando eles falham, o ouvido cresce. O tato fala. O corpo lembra.\n\nVer não é a única forma de presença. E olhar com cuidado é um gesto que se ensina.\n\nA arte que proponho nasce daí: música, tato, escuta e empatia atravessando o mesmo corpo. Cura, inclusão e cuidado deixam de ser tema e viram experiência viva.",
    { x: 2.3, y: 3.06, w: 8.73, h: 3.2, fontSize: 15, align: "center", lineSpacing: 28, color: CREME });
  pageno(s);
}

/* ─────────────────────────────────── 06 · A OBRA PEGA VISÃO */
{
  const s = slide();
  s.addImage({ path: foto("obra_pegavisao"), x: 6.3, y: 0, w: 7.03, h: 7.5, sizing: { type: "cover", w: 7.03, h: 7.5 } });
  kicker(s, "A OBRA PEGA VISÃO", OURO);
  head(s, "Feita pra ser tocada\nantes de vista.", OURO, { w: 5.3, fontSize: 36, lineSpacing: 42 });
  body(s, "Um painel em camadas — pintura, alto-relevo e cerâmica integrada, feito por Luis Badaró. É a peça-centro do festival desde a primeira edição e funciona como ponto de referência da galeria.\n\nO visitante é convidado a usar uma venda nos olhos e sentir a obra com as mãos: uma experiência sinestésica onde a mente lúdica percebe antes de ver. Só então vem a revelação visual.",
    { x: M, y: 2.72, w: 5.3, h: 2.9, fontSize: 13 });
  s.addText("CEDIDA AO UP19 PARA EXPOSIÇÃO NA GALERIA OFICIAL,\nDURANTE TODO O PERÍODO DO EVENTO", { x: M, y: 5.85, w: 5.3, h: 0.7,
    fontFace: SANS, fontSize: 10, bold: true, color: OURO, charSpacing: 1.2, margin: 0, lineSpacing: 15 });
  pageno(s);
}

/* ─────────────────────────────────── 07 · A NOVA OBRA · CIMÁTICA */
{
  const s = slide();
  kicker(s, "A NOVA OBRA · PRODUZIDA PARA O UP19", TEAL);
  s.addText("Cimática.", { x: M, y: 0.82, w: 5.6, h: 0.9, fontFace: SERIF, fontSize: 46, bold: true, color: TEAL, margin: 0 });
  s.addText("A forma que o som desenha\nna matéria — em relevo tátil.", { x: M, y: 1.78, w: 5.6, h: 0.95,
    fontFace: SANS, fontSize: 15, bold: true, color: CREME, margin: 0, lineSpacing: 23 });
  s.addImage({ path: `${A}cimatica_lente.png`, x: 6.42, y: 0.82, w: 6.29, h: 2.81 });
  body(s, "A cimática é o estudo de como o som, em vibração, organiza a matéria em padrões visíveis — a prova física de que toda frequência sonora carrega uma forma, mesmo antes de qualquer olho a perceber. A obra parte desse princípio: transforma, em relevo tátil, os padrões que diferentes frequências imprimem na matéria — as figuras que o som desenha quando encontra areia, água ou placas em vibração.",
    { x: M, y: 3.98, w: 5.85, h: 2.4, fontSize: 12.5, lineSpacing: 18 });
  body(s, "Ela convida quem vê a tocar o que o som desenha, e permite que quem não vê acesse, pela primeira vez, a forma visual da própria música. É a alma do Pega Visão em sua expressão mais literal: a certeza de que a percepção do mundo nunca dependeu de um único sentido — o som sempre teve corpo, mesmo para quem nunca pôde vê-lo.",
    { x: 6.86, y: 3.98, w: 5.85, h: 2.4, fontSize: 12.5, lineSpacing: 18 });
  s.addText("PEÇA NOVA, DE LUIS BADARÓ · PRODUZIDA ESPECIALMENTE PARA A GALERIA DO UP19", { x: M, y: 6.6, w: 11, h: 0.32,
    fontFace: SANS, fontSize: 9.5, bold: true, color: TEAL, charSpacing: 1.2, margin: 0, valign: "middle" });
  pageno(s);
  s.addNotes("Slide central da proposta. Conceito integral da obra cimática.");
}

/* ─────────────────────────────────── 08 · AS FRENTES */
{
  const s = slide();
  kicker(s, "AS FRENTES NO UP19", LILAS);
  head(s, "Quatro coisas acontecendo, dentro da programação do UP.", LILAS, { w: 11.5, fontSize: 32, lineSpacing: 38 });
  const F = [
    ["01 · GALERIA TÁTIL", OLIVA, "Obra Pega Visão cedida + nova obra cimática, produzida para o UP19. Vendas de pano para quem quiser percorrer primeiro pelo tato.", 5],
    ["02 · LIVE PAINTING", CORAL, "Luis Badaró pinta ao vivo em área próxima à galeria. Uma obra nasce no processo, à vista do público.", 7],
    ["03 · CERÂMICA ÀS CEGAS", MAGENTA, "Vivência guiada de olhos vendados com Mickaela, nos dias 28, 29 e 30/12. Argila, mãos e escuta.", 19],
    ["04 · TRUST IN DANCE", LILAS, "Sessão de dance guidance com Fernanda Pistelli. O público dança de olhos vendados, navegando a música pelo corpo.", 3],
  ];
  F.forEach(([t, c, d, ic], i) => {
    const x = M + (i % 2) * (CWD / 2 + 0.16), y = 2.55 + Math.floor(i / 2) * 2.05;
    const w = CWD / 2 - 0.16;
    card(s, x, y, w, 1.82, c);
    s.addImage({ path: ilus(ic), x: x + 0.24, y: y + 0.26, w: 0.82, h: 0.62 });
    s.addText(t, { x: x + 1.24, y: y + 0.24, w: w - 1.5, h: 0.38, fontFace: SANS, fontSize: 13.5,
      bold: true, color: c, margin: 0, charSpacing: 0.8, valign: "middle" });
    body(s, d, { x: x + 1.24, y: y + 0.72, w: w - 1.5, h: 0.92, fontSize: 11.5, lineSpacing: 16 });
  });
  s.addText("Sets autorais de Ota Blind no Chill Out e no UP Club completam a curadoria.",
    { x: M, y: 6.68, w: 11, h: 0.32, fontFace: SANS, fontSize: 11.5, color: MUDO, margin: 0, valign: "middle" });
  pageno(s);
}

/* ─────────────────────────────────── 09 · CERÂMICA ÀS CEGAS */
{
  const s = slide();
  kicker(s, "CERÂMICA ÀS CEGAS · MICKAELA", MAGENTA);
  head(s, "Modelar sem ver é\ndeixar a mão pensar.", MAGENTA, { w: 6.4, fontSize: 36, lineSpacing: 42 });
  body(s, "Vivência guiada de olhos vendados, conduzida por Mickaela — ceramista e terapeuta. O participante recebe a argila já vendado: não há referência visual, só peso, temperatura e resistência do barro.\n\nO método já foi testado em edição anterior do festival, com participação de pessoas com deficiência visual. A peça que nasce nunca é a peça que se imaginou — e é esse o ponto.",
    { x: M, y: 2.72, w: 6.4, h: 2.6, fontSize: 13 });
  ["28 / 12", "29 / 12", "30 / 12"].forEach((d, i) => {
    const x = M + i * 2.2;
    card(s, x, 5.5, 1.98, 0.92, MAGENTA);
    s.addText(d, { x, y: 5.5, w: 1.98, h: 0.92, fontFace: SERIF, fontSize: 22, bold: true,
      color: CREME, align: "center", valign: "middle", margin: 0 });
  });
  s.addImage({ path: ilus(24), x: 9.15, y: 1.42, w: 3.1, h: 3.35 });
  s.addText("LOCAL A DEFINIR COM A PRODUÇÃO\nCIRCULOU · ESPAÇO DE CURA · PRÓXIMO AO CHILL OUT", { x: 7.6, y: 5.5, w: 5.11, h: 0.8,
    fontFace: SANS, fontSize: 9.5, bold: true, color: MAGENTA, charSpacing: 0.6, margin: 0, lineSpacing: 16 });
  pageno(s);
}

/* ─────────────────────────────────── 10 · TRUST IN DANCE */
{
  const s = slide();
  s.addImage({ path: foto("trust_principal"), x: 0, y: 0, w: 5.75, h: 7.5, sizing: { type: "cover", w: 5.75, h: 7.5 } });
  s.addText("TRUST IN DANCE · FERNANDA PISTELLI", { x: 6.2, y: 0.34, w: 6.5, h: 0.3,
    fontFace: SANS, fontSize: 10.5, bold: true, color: LILAS, charSpacing: 3.4, margin: 0, valign: "middle" });
  head(s, "Dançar de olhos vendados\né navegar a música pelo corpo.", LILAS, { x: 6.2, y: 1.0, w: 6.5, h: 1.7, fontSize: 30, lineSpacing: 38 });
  body(s, "Sessão de dance guidance conduzida por Fernanda Pistelli. O público dança vendado — uma experiência de escuta, confiança e presença total.\n\nPassagens por Boom Festival, Universo Paralello e residência DragonFruit (Brisbane / AUS). Sets entre Progressive House e Techno.",
    { x: 6.2, y: 3.5, w: 6.5, h: 2.0, fontSize: 13 });
  s.addImage({ path: foto("trust_grupo"), x: 6.2, y: 5.5, w: 3.1, h: 1.42, sizing: { type: "cover", w: 3.1, h: 1.42 } });
  s.addImage({ path: foto("trust_duo"), x: 9.5, y: 5.5, w: 3.21, h: 1.42, sizing: { type: "cover", w: 3.21, h: 1.42 } });
  s.addText("PARTICIPAÇÃO ARTÍSTICA · SEM CUSTO AO FESTIVAL", { x: 6.2, y: 2.86, w: 6.5, h: 0.32,
    fontFace: SANS, fontSize: 10, bold: true, color: LILAS, charSpacing: 1.2, margin: 0, valign: "middle" });
  pageno(s);
}

/* ─────────────────────────────────── 11 · LIVE PAINTING */
{
  const s = slide();
  s.addImage({ path: foto("live_painting"), x: 8.0, y: 0, w: 5.33, h: 7.5, sizing: { type: "cover", w: 5.33, h: 7.5 } });
  kicker(s, "LIVE PAINTING · LUIS BADARÓ", CORAL);
  head(s, "Uma obra nascendo\nà vista de quem passa.", CORAL, { w: 6.9, fontSize: 36, lineSpacing: 42 });
  body(s, "Luis Badaró pinta ao vivo durante o festival, em área próxima à galeria de arte. Quem passa duas vezes encontra coisas diferentes.\n\nArtista visual, desenha desde a infância e há quase dez anos profissionalmente. Trocou a arquitetura pelas artes. Murais em Rondonópolis e Cuiabá (2022) e em Barcelona (2019). Assina a identidade visual tátil do Pega Visão desde a primeira edição.",
    { x: M, y: 2.72, w: 6.9, h: 2.6, fontSize: 13 });
  s.addImage({ path: foto("badaro_retrato"), x: M, y: 5.42, w: 1.38, h: 1.5, sizing: { type: "cover", w: 1.38, h: 1.5 } });
  s.addText("SUPORTE MDF 220×180\nTINTA ACRÍLICA · EMBALAGEM PARA TRANSPORTE", { x: 2.2, y: 5.72, w: 5.2, h: 0.8,
    fontFace: SANS, fontSize: 10, bold: true, color: CORAL, charSpacing: 1.1, margin: 0, lineSpacing: 15 });
  pageno(s);
}

/* ─────────────────────────────────── 12 · SETS OTA BLIND */
{
  const s = slide();
  kicker(s, "MÚSICA · OTA BLIND", OLIVA);
  head(s, "Um artista da casa\nvoltando ao palco.", OLIVA, { w: 6.6, fontSize: 36, lineSpacing: 42 });
  body(s, "DJ desde 2008, três passagens pelo palco Tortuga do UP em 2013, 2015 e 2017. Idealizador e curador do Festival Pega Visão. Pessoa com deficiência visual monocular desde setembro de 2024.\n\nDois sets autorais foram enviados para apreciação da curadoria.",
    { x: M, y: 2.72, w: 6.6, h: 2.0, fontSize: 13 });
  [["CHILL OUT", "Em horário próximo à experiência Trust in Dance."],
   ["UP CLUB", "Set autoral."]].forEach(([t, d], i) => {
    const y = 4.86 + i * 1.06;
    card(s, M, y, 6.6, 0.9, OLIVA);
    s.addText(t, { x: M + 0.3, y, w: 2.1, h: 0.9, fontFace: SANS, fontSize: 13, bold: true,
      color: OLIVA, margin: 0, valign: "middle", charSpacing: 1 });
    body(s, d, { x: M + 2.3, y, w: 4.1, h: 0.9, fontSize: 11.5, valign: "middle" });
  });
  s.addImage({ path: ilus(36), x: 7.9, y: 1.6, w: 4.8, h: 3.6 });
  s.addImage({ path: ilus(19), x: 8.6, y: 5.3, w: 1.6, h: 1.2 });
  pageno(s);
}

/* ─────────────────────────────────── 13 · REGISTRO AUDIOVISUAL */
{
  const s = slide();
  kicker(s, "REGISTRO AUDIOVISUAL · ANDRÉ ZAMBONINI", TEAL);
  head(s, "Material que circula\njunto do nome do festival.", TEAL, { w: 7.2, fontSize: 34, lineSpacing: 40 });
  body(s, "Captação e produção de conteúdo documental do projeto no UP19, sem cachê. Diretor de fotografia, editor e piloto de drone, de Cuiabá. Registrou três edições do Festival Baguncinha e mais de cem live sessions.",
    { x: M, y: 2.62, w: 7.2, h: 1.3, fontSize: 13 });
  s.addText("KIT PROFISSIONAL PRÓPRIO", { x: M, y: 4.0, w: 7.2, h: 0.32, fontFace: SANS,
    fontSize: 10.5, bold: true, color: TEAL, charSpacing: 1.6, margin: 0, valign: "middle" });
  bullets(s, ["Câmera Sony A7IV, sensor de 33MP",
              "Lentes Sigma 24-70 Art e 70-200 GM",
              "Lapela Hollyland Lark Max 2 e tripé",
              "Tubo LED Sokani 25W, LED portátil 40W e flash Godox V1"],
    { x: M, y: 4.42, w: 7.2, h: 1.7, fontSize: 12.5 });
  card(s, 8.35, 2.55, 4.36, 3.6, TEAL);
  s.addText("INTERCÂMBIO", { x: 8.63, y: 2.82, w: 3.8, h: 0.34, fontFace: SANS, fontSize: 11.5,
    bold: true, color: TEAL, charSpacing: 1.8, margin: 0, valign: "middle" });
  body(s, "Todo o material captado pelo Pega Visão fica disponível ao UP para uso institucional.\n\nEm troca, pedimos acesso ao material audiovisual captado pela produção oficial do festival.",
    { x: 8.63, y: 3.34, w: 3.8, h: 2.5, fontSize: 12, lineSpacing: 18 });
  pageno(s);
}

/* ─────────────────────────────────── 14 · O QUE TRAZEMOS */
{
  const s = slide();
  kicker(s, "O QUE TRAZEMOS", OLIVA);
  head(s, "Aporte próprio do Pega Visão.", OLIVA, { w: 9, fontSize: 34, y: 0.82, h: 0.8 });
  const L = [
    ["Obra Pega Visão", "Cedida à galeria oficial, todo o período", "Contrapartida", "—"],
    ["Live painting", "Cachê de execução · Luis Badaró", "Pega Visão", "R$ 300,00"],
    ["Cerâmica Às Cegas", "Cachê de execução · Mickaela", "Pega Visão", "R$ 300,00"],
    ["Cobertura audiovisual", "Captação documental · Zambonini, sem cachê", "Pega Visão", "R$ 0,00"],
    ["Equipamento audiovisual", "Kit profissional próprio do diretor", "Qualidade técnica", "—"],
    ["Trust in Dance", "Participação artística · Fernanda Pistelli", "Contrapartida", "—"],
    ["Passagens aéreas", "3 pax, ida e volta · cotação de 27/07/2026", "Pega Visão", "R$ 7.583,00"],
    ["Translado Salvador ↔ Pratigi", "Ida e volta para a equipe", "Pega Visão", "R$ 930,00"],
    ["Hospedagem da equipe", "Casa própria no Jatimane, base de operação", "Pega Visão", "R$ 7.000,00"],
    ["Intercâmbio audiovisual", "Material do Pega Visão cedido ao UP", "Contrapartida", "—"],
  ];
  const Y0 = 1.90, RH = 0.37;
  [["ITEM", M, 3.5], ["DESCRIÇÃO", 4.2, 5.0], ["APORTE", 9.35, 1.9], ["VALOR", 11.3, 1.41]]
    .forEach(([t, x, w], k) => s.addText(t, { x, y: Y0, w, h: 0.3, fontFace: SANS, fontSize: 9,
      bold: true, color: MUDO, charSpacing: 1.6, margin: 0, valign: "middle", align: k === 3 ? "right" : "left" }));
  L.forEach(([it, de, ap, vl], i) => {
    const y = Y0 + 0.36 + i * RH;
    if (i % 2 === 0) s.addShape(pres.ShapeType.rect, { x: M - 0.12, y, w: CWD + 0.24, h: RH,
      fill: { color: "1B1917" }, line: { color: "1B1917" } });
    s.addText(it, { x: M, y, w: 3.5, h: RH, fontFace: SANS, fontSize: 11.5, bold: true,
      color: CREME, margin: 0, valign: "middle" });
    s.addText(de, { x: 4.2, y, w: 5.0, h: RH, fontFace: SANS, fontSize: 11, color: BODY,
      margin: 0, valign: "middle" });
    s.addText(ap, { x: 9.35, y, w: 1.9, h: RH, fontFace: SANS, fontSize: 10.5, bold: true,
      color: ap === "Pega Visão" ? OLIVA : MUDO, margin: 0, valign: "middle" });
    s.addText(vl, { x: 11.3, y, w: 1.41, h: RH, fontFace: SANS, fontSize: 12.5,
      bold: vl !== "—", color: vl === "—" ? MUDO : CREME, align: "right", margin: 0, valign: "middle" });
  });
  card(s, M, 6.02, CWD, 0.80, OLIVA);
  s.addText("TOTAL · APORTE PEGA VISÃO", { x: M + 0.34, y: 6.02, w: 7, h: 0.80, fontFace: SANS,
    fontSize: 13, bold: true, color: CREME, charSpacing: 1.4, margin: 0, valign: "middle" });
  s.addText("R$ 16.113,00", { x: 8.4, y: 6.02, w: 4.0, h: 0.80, fontFace: SERIF, fontSize: 24,
    bold: true, color: OLIVA, align: "right", margin: 0, valign: "middle" });
  pageno(s);
  s.addNotes("O kit audiovisual próprio entra como qualidade técnica, sem valor monetário — não compõe o total.");
}

/* ─────────────────────────────────── 15 · O QUE PEDIMOS */
{
  const s = slide();
  kicker(s, "O QUE PEDIMOS · CUSTO A COBRIR PELO UP", MAGENTA);
  head(s, "Materiais de produção.", MAGENTA, { w: 8, fontSize: 34 });
  const P4 = [
    ["Materiais · live painting", "Tinta acrílica, suporte MDF 220×180, embalagem e proteção para transporte.", "R$ 980,00"],
    ["Materiais · vendas para os olhos", "25 metros de tecido para 300 vendas, higienizadas e personalizadas, usadas em todas as experiências.", "R$ 750,00"],
    ["Materiais · cerâmica às cegas", "Argila, lona e bacias.", "R$ 500,00"],
    ["Produção · nova obra tátil cimática", "Materiais para a peça nova de Luis Badaró, produzida para a galeria do UP19.", "[A CONFIRMAR]"],
  ];
  P4.forEach(([t, d, v], i) => {
    const y = 2.28 + i * 0.90;
    card(s, M, y, 12.09, 0.80, i === 3 ? OURO : MAGENTA);
    s.addText(t, { x: M + 0.3, y, w: 3.5, h: 0.80, fontFace: SANS, fontSize: 12, bold: true,
      color: CREME, margin: 0, valign: "middle" });
    body(s, d, { x: M + 3.9, y, w: 5.5, h: 0.80, fontSize: 11, valign: "middle", lineSpacing: 15 });
    s.addText(v, { x: 9.7, y, w: 3.0, h: 0.80, fontFace: SERIF, fontSize: i === 3 ? 15 : 19,
      bold: true, color: i === 3 ? OURO : CREME, align: "right", margin: 0, valign: "middle" });
  });
  card(s, M, 6.02, 12.09, 0.80, MAGENTA);
  s.addText("TOTAL · SOLICITADO AO UP", { x: M + 0.34, y: 6.02, w: 5.2, h: 0.80, fontFace: SANS,
    fontSize: 13, bold: true, color: CREME, charSpacing: 1.4, margin: 0, valign: "middle" });
  s.addText("+ valor da obra cimática, a definir", { x: 5.9, y: 6.02, w: 3.3, h: 0.80, fontFace: SANS,
    fontSize: 10.5, color: MUDO, align: "right", margin: 0, valign: "middle" });
  s.addText("R$ 2.230,00", { x: 9.35, y: 6.02, w: 3.36, h: 0.80, fontFace: SERIF, fontSize: 24,
    bold: true, color: MAGENTA, align: "right", margin: 0, valign: "middle" });
  pageno(s);
}

/* ─────────────────────────────────── 16 · APOIO INSTITUCIONAL */
{
  const s = slide();
  kicker(s, "O QUE PEDIMOS · APOIO INSTITUCIONAL, SEM VALOR MONETÁRIO", OURO);
  head(s, "Espaço, slots e credenciais.", OURO, { w: 8, fontSize: 34 });
  const items = [
    ["Espaço · live painting", "Área próxima à galeria de arte."],
    ["Slot · galeria de arte", "Exposição da nova obra tátil cimática."],
    ["Cronograma da obra", "Dia de entrega na galeria e antecedência de montagem."],
    ["Espaço · cerâmica às cegas", "28, 29 e 30/12 — Circulou, Espaço de Cura ou próximo ao Chill Out."],
    ["Suporte · live painting", "MDF 220×180 cedido ou produzido localmente, a confirmar; fixação em cavalete ou lona."],
    ["Slot · Chill Out", "Set de Ota Blind, próximo à experiência Trust in Dance."],
    ["Slot · UP Club", "Set de Ota Blind."],
    ["Credenciais · equipe", "3 credenciais: Badaró, Zambonini e 1 vaga de apoio operacional."],
    ["Credencial · artista", "Luis (Ota Blind): credencial de artista + 1 acompanhante."],
    ["Acesso a mídias", "Material audiovisual da produção oficial do UP, como parte do intercâmbio."],
  ];
  items.forEach(([t, d], i) => {
    const x = M + (i % 2) * (CWD / 2 + 0.16), y = 2.3 + Math.floor(i / 2) * 0.92;
    const w = CWD / 2 - 0.16;
    s.addText(t, { x, y, w, h: 0.3, fontFace: SANS, fontSize: 12, bold: true, color: OURO, margin: 0, valign: "middle" });
    body(s, d, { x, y: y + 0.3, w, h: 0.52, fontSize: 10.5, lineSpacing: 14 });
  });
  pageno(s);
}

/* ─────────────────────────────────── 17 · QUEM ASSINA + FECHO */
{
  const s = slide();
  kicker(s, "QUEM ASSINA", CREME);
  const eq = [
    ["OTA BLIND", "Luis Otávio Muniz · Cuiabá / MT", "Curadoria geral, set autoral e coordenação. Idealizador do Festival Pega Visão.", OLIVA, 1],
    ["LUIS BADARÓ", "Artista visual · Rondonópolis / MT", "Direção visual, obras táteis e live painting. Murais em Cuiabá, Rondonópolis e Barcelona.", CORAL, 4],
    ["MICKAELA", "Ceramista e terapeuta", "Conduz a vivência Cerâmica Às Cegas, guiada de olhos vendados.", MAGENTA, 26],
    ["FERNANDA PISTELLI", "DJ · São Paulo / SP", "Sessão Trust in Dance. Boom Festival, Universo Paralello e residência DragonFruit.", LILAS, 3],
    ["ANDRÉ ZAMBONINI", "Diretor de fotografia · Cuiabá / MT", "Captação e produção do registro documental do projeto no UP19.", TEAL, 2],
  ];
  const cw = 2.34, gap = 0.11;
  eq.forEach(([n, r, d, c, ic], i) => {
    const x = M + i * (cw + gap);
    card(s, x, 1.5, cw, 3.5, c);
    s.addImage({ path: ilus(ic), x: x + (cw - 1.0) / 2, y: 1.76, w: 1.0, h: 0.76 });
    s.addText(n, { x: x + 0.16, y: 2.68, w: cw - 0.32, h: 0.34, fontFace: SANS, fontSize: 11.5,
      bold: true, color: c, align: "center", margin: 0, charSpacing: 0.5, valign: "middle" });
    s.addText(r, { x: x + 0.16, y: 3.0, w: cw - 0.32, h: 0.46, fontFace: SANS, fontSize: 9.5,
      color: MUDO, align: "center", margin: 0, lineSpacing: 13 });
    body(s, d, { x: x + 0.16, y: 3.52, w: cw - 0.32, h: 1.3, fontSize: 10, align: "center", lineSpacing: 14 });
  });
  s.addText("A venda no olho é o gesto.\nO resto está pronto pra acontecer.", { x: M, y: 5.32, w: 7.3, h: 1.1,
    fontFace: SERIF, fontSize: 26, bold: true, color: OLIVA, margin: 0, lineSpacing: 33 });
  s.addImage({ path: `${A}logo/logo_pegavisao_creme.png`, x: 10.2, y: 5.36, w: 2.5, h: 0.9 });
  s.addText("Luis Otávio Muniz · Ota Blind", { x: M, y: 6.62, w: 5, h: 0.3, fontFace: SANS,
    fontSize: 11, bold: true, color: CREME, margin: 0, valign: "middle" });
  s.addText("lo.xbmuniz@gmail.com · +55 65 98471 6681 · @ota.blind · @pegavisaofestival",
    { x: 5.7, y: 6.62, w: 7.0, h: 0.3, fontFace: SANS, fontSize: 11, color: MUDO,
      align: "right", margin: 0, valign: "middle" });
  pageno(s);
}

pres.writeFile({ fileName: "/home/user/pega-visao/entregaveis/PEGA_VISAO_x_UP19_PITCH_DECK.pptx" })
  .then((f) => console.log("gravado:", f, "| slides:", N));
