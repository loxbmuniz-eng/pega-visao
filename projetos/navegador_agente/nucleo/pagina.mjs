// Camada de página: navegar, avaliar, capturar.
import { Buffer } from 'node:buffer';

export class Pagina {
  constructor(navegador, sessionId) {
    this.nav = navegador;
    this.sessionId = sessionId;
  }

  enviar(metodo, params) {
    return this.nav.enviar(metodo, params, this.sessionId);
  }

  // Roda ANTES de qualquer script da página. É assim que os dados do lote
  // chegam na cena: a cena já nasce enxergando window.__dados.
  async injetarAntes(fonteJs) {
    await this.enviar('Page.addScriptToEvaluateOnNewDocument', { source: fonteJs });
  }

  async irPara(url) {
    // O ouvinte entra antes do navigate. Ao contrário, uma página em cache
    // dispara o load antes de a espera existir e o render trava para sempre.
    const carregou = this.nav.esperarEvento('Page.loadEventFired', this.sessionId);
    await this.enviar('Page.navigate', { url });
    await carregou;
  }

  async avaliar(expressao) {
    const r = await this.enviar('Runtime.evaluate', {
      expression: expressao,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const msg = d.exception?.description ?? d.text;
      throw new Error(`erro dentro da cena: ${msg}`);
    }
    return r.result?.value;
  }

  // Fonte que ainda está carregando entrega quadro com a letra errada, e o
  // erro só aparece no vídeo pronto. Esperar aqui custa milissegundos.
  async esperarFontes() {
    await this.avaliar('document.fonts ? document.fonts.ready.then(() => true) : true');
  }

  async capturar({ formato = 'png', qualidade } = {}) {
    const params = { format: formato, captureBeyondViewport: false };
    if (formato === 'jpeg') params.quality = qualidade ?? 95;
    const r = await this.enviar('Page.captureScreenshot', params);
    return Buffer.from(r.data, 'base64');
  }

  async fechar() {
    await this.enviar('Page.close').catch(() => {});
  }
}

export async function abrirPagina(navegador, { largura, altura, escala = 1 }) {
  const { targetId } = await navegador.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await navegador.enviar('Target.attachToTarget', { targetId, flatten: true });
  const pagina = new Pagina(navegador, sessionId);
  await pagina.enviar('Page.enable');
  await pagina.enviar('Runtime.enable');
  await pagina.enviar('Emulation.setDeviceMetricsOverride', {
    width: largura,
    height: altura,
    deviceScaleFactor: escala,
    mobile: false,
  });
  return pagina;
}
