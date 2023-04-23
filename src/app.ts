import {
  Builder,
  Browser,
  By,
  until,
  ThenableWebDriver,
} from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import args from 'args';
import fs from 'node:fs';
import fetch from 'node-fetch';

async function main() {
  const flags = parseArguments();
  const pages = await findScorePages(flags.url);
  await createPDF(pages);
}

async function createPDF(imagesSrc: string[]) {
  console.log(`Saving score to pdf...`);

  const head = imagesSrc.splice(0, 1)[0];
  const code = await (await fetch(head)).text();
  const width = code.match(/\swidth="[1-9\.]+"\s/)?.[0];
  const widthValue = Number(width?.match(/[1-9\.]+/)?.[0]);
  const height = code.match(/\sheight="[1-9\.]+"\s/)?.[0];
  const heightValue = Number(height?.match(/[1-9\.]+/)?.[0]);

  const scaleFactor = 0.75;
  const doc = new PDFDocument({
    size: [
      Math.round(widthValue * scaleFactor),
      Math.round(heightValue * scaleFactor),
    ],
  });
  doc.pipe(fs.createWriteStream('score.pdf'));
  SVGtoPDF(doc, code, 0, 0);

  const addSVG = async (src: string) => {
    const svgCode = await (await fetch(src)).text();
    console.log(`Adding ${src}`);
    SVGtoPDF(doc, svgCode, 0, 0);
  };

  for (const src of imagesSrc) {
    doc.addPage();
    await addSVG(src);
  }
  doc.end();
}

async function findScorePages(url: string) {
  console.log('Creating web driver...');
  const driver = await createWebDriver();

  try {
    await driver.get(url);

    const clickButton = async (selector: string) => {
      const buttonSelector = By.css(selector);
      await driver.wait(until.elementLocated(buttonSelector));
      const button = await driver.findElement(buttonSelector);
      await driver.wait(until.elementIsEnabled(button));
      await button.click();
    };

    const pageContainer = async () =>
      await driver.findElement(By.css('#jmuse-scroller-component'));

    // Agree button
    await clickButton('.css-47sehv');

    // Find all score pages
    const childElements = await (
      await pageContainer()
    ).findElements(By.xpath('./*'));

    // Make all pages visible
    childElements.forEach(async (childElement) => {
      await driver.executeScript(
        `
        arguments[0].style.position = 'absolute';
        arguments[0].style.top = '0';
        arguments[0].style.left = '0';
        `,
        childElement
      );
    });

    // Scroll to the bottom to activate lazy loading
    await driver.executeScript(
      `
      arguments[0].scrollTo(0, arguments[0].scrollHeight);
      `,
      await driver.findElement(By.css('#jmuse-scroller-component'))
    );

    // Wait for images to load
    console.log('Waiting for web page to load...');
    await driver.sleep(2000);

    const images = await (await pageContainer()).findElements(By.css('img'));
    const imagesSrc = await Promise.all(
      images.map(async (element) => await element.getAttribute('src'))
    );
    const scoreImages = imagesSrc.filter(
      (src) =>
        src.includes('s3.ultimate-guitar.com') ||
        src.includes('musescore.com/static/musescore/scoredata')
    );
    return scoreImages;
  } finally {
    await driver.quit();
  }
}

function parseArguments(): { url: string } {
  args.option('url', 'URL of the score page');

  const flags = args.parse(process.argv);
  const url = flags.url;

  if (!url) {
    console.error('No URL was provided.');
    process.exit(1);
  }

  return { url };
}

function createWebDriver(): ThenableWebDriver {
  return new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(
      new firefox.Options().headless().windowSize({ width: 1600, height: 1200 })
    )
    .build();
}

await main();
