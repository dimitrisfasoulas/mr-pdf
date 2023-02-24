import chalk = require('chalk');
import puppeteer = require('puppeteer');
import { scrollPageToBottom } from 'puppeteer-autoscroll-down';
import * as fs from 'fs';

let contentHTML = '';
export interface generatePDFOptions {
  initialDocURLs: Array<string>;
  excludeURLs: Array<string>;
  outputPDFFilename: string;
  pdfMargin: puppeteer.PDFOptions['margin'];
  contentSelector: string;
  paginationSelector: string;
  pdfFormat: puppeteer.PDFFormat;
  excludeSelectors: Array<string>;
  cssStyle: string;
  puppeteerArgs: Array<string>;
  coverTitle: string;
  coverImage: string;
  disableTOC: boolean;
  coverSub: string;
  waitForRender: number;
  headerTemplate: string;
  footerTemplate: string;
}

export async function generatePDF({
  initialDocURLs,
  excludeURLs,
  outputPDFFilename = 'mr-pdf.pdf',
  pdfMargin = { top: 32, right: 32, bottom: 32, left: 32 },
  contentSelector,
  paginationSelector,
  pdfFormat,
  excludeSelectors,
  cssStyle,
  puppeteerArgs,
  coverTitle,
  coverImage,
  disableTOC,
  coverSub,
  waitForRender,
  headerTemplate,
  footerTemplate,
}: generatePDFOptions): Promise<void> {
  const browser = await puppeteer.launch({ args: puppeteerArgs });
  const page = await browser.newPage();

  for (const url of initialDocURLs) {
    let nextPageURL = url;

    // Create a list of HTML for the content section of all pages by looping
    while (nextPageURL) {
      console.log();
      console.log(chalk.cyan(`Retrieving html from ${nextPageURL}`));
      console.log();

      if (waitForRender) {
        await page.goto(`${nextPageURL}`);
        console.log(chalk.green('Rendering...'));
        await page.waitFor(waitForRender);
      } else {
        // Go to the page specified by nextPageURL
        await page.goto(`${nextPageURL}`, {
          waitUntil: 'networkidle0',
          timeout: 0,
        });
      }

      page.on('console', async (msg) => {
        const msgArgs = msg.args();
        for (let i = 0; i < msgArgs.length; ++i) {
          console.log(chalk.yellow(await msgArgs[i].jsonValue()));
        }
      });

      // Get the HTML string of the content section.
      const html = await page.evaluate(
        ({ contentSelector }) => {
          const element: HTMLElement | null = document.querySelector(
            contentSelector,
          );
          if (element) {
            // Add pageBreak for PDF
            element.style.pageBreakAfter = 'always';

            // Open <details> tag
            const detailsArray = element.getElementsByTagName('details');
            Array.from(detailsArray).forEach((element) => {
              element.open = true;
            });

            // Handle tabs
            const tabsArray = element.getElementsByClassName('tabs-container');
            Array.from(tabsArray).forEach((element) => {
              // Get titles of tabs
              const tabTitles = Array.from(
                element.getElementsByClassName('tabs__item '),
              );
              // Get tab contents
              const tabContents = Array.from(
                (element.lastChild as HTMLElement).childNodes,
              );
              // Remove hidden attribute from tab contents
              tabContents.forEach((tabContent) => {
                (tabContent as HTMLElement).removeAttribute('hidden');
              });
              const newElement = document.createElement('div');
              // Create new elements for each tab
              tabTitles.map(async (tabTitle, index) => {
                const newTab = document.createElement('div');
                newTab.classList.add('margin-top--md');
                const ul = document.createElement('ul');
                ul.setAttribute('role', 'tablist');
                ul.setAttribute('aria-orientation', 'horizontal');
                ul.setAttribute('class', 'tabs');
                tabTitle.classList.add('tabs__item--active');
                newTab.appendChild(ul);
                ul.appendChild(tabTitle);
                (tabContents[index] as HTMLElement).style.border =
                  '1px solid #ccc';
                newTab.appendChild(tabContents[index]);
                newElement.appendChild(newTab);
              });

              element.innerHTML = newElement.innerHTML;
            });

            // Handle Headings to build TOC
            const headings = Array.from(element.getElementsByTagName('h1'))
              .concat(Array.from(element.getElementsByTagName('h2')))
              .concat(Array.from(element.getElementsByTagName('h3')));

            headings.forEach((heading) => {
              // console.log(heading.id);
              if (heading.innerText === 'On this page') {
                // Remove On this page heading
                // heading.id = '';
              } else {
                // Ignore H2 and H3 headings with no existing id
                if (heading.tagName === 'H1' || !!heading.id) {
                  // console.log(
                  //   `working on ${heading.innerText} with tag ${heading.tagName} and id ${heading.id}`,
                  // );
                  // Add a unique id to each heading based on the url path
                  heading.id =
                    document.location.pathname
                      .split('/')
                      .join('_')
                      .substring(1) + heading.id;
                  if (heading.id === '') {
                    heading.id = heading.innerText.split(' ').join('-');
                  }
                  // } else {
                  //   console.log(
                  //     `ignoring ${heading.innerText} with tag ${heading.tagName} and id ${heading.id}`,
                  //   );
                }
              }
            });

            // Handle a tags to build TOC
            const aTags = Array.from(element.getElementsByTagName('a'));
            aTags.forEach((aTag) => {
              // Handle internal links only
              if (
                !aTag.getAttribute('href')?.startsWith('http') &&
                !aTag.getAttribute('href')?.startsWith('#')
              ) {
                // Convert href to unique id
                // console.log(`working on ${aTag.getAttribute('href')}`);
                aTag.href = '#'.concat(
                  (aTag.getAttribute('href') || '').split('/').join('_'),
                );
                // } else {
                // console.log(`ignoring ${aTag.getAttribute('href')}`);
              }
            });

            return element.outerHTML;
          } else {
            return '';
          }
        },
        { contentSelector },
      );

      // Make joined content html
      if (excludeURLs && excludeURLs.includes(nextPageURL)) {
        console.log(chalk.green('This URL is excluded.'));
      } else {
        contentHTML += html;
        console.log(chalk.green('Success'));
      }

      // Find next page url before DOM operations
      nextPageURL = await page.evaluate((paginationSelector) => {
        const element = document.querySelector(paginationSelector);
        if (element) {
          return (element as HTMLLinkElement).href;
        } else {
          return '';
        }
      }, paginationSelector);
    }
  }

  // Download buffer of coverImage if exists
  let imgBase64 = '';
  if (coverImage) {
    const imgSrc = await page.goto(coverImage);
    const imgSrcBuffer = await imgSrc?.buffer();
    imgBase64 = imgSrcBuffer?.toString('base64') || '';
  }

  // Go to initial page
  await page.goto(`${initialDocURLs[0]}`, { waitUntil: 'networkidle0' });

  const coverHTML = `
  <div
    class="pdf-cover"
    style="
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100vh;
      page-break-after: always;  
      text-align: center;
    "
  >
    ${coverTitle ? `<h1>${coverTitle}</h1>` : ''}
    ${coverSub ? `<h3>${coverSub}</h3>` : ''}
    <img
      class="cover-img"
      src="data:image/png;base64, ${imgBase64}"
      alt=""
      width="140"
      height="140"
    />
  </div>`;

  // Add Toc
  const { modifiedContentHTML, tocHTML } = generateToc(contentHTML);

  // Restructuring the html of a document
  await page.evaluate(
    ({ coverHTML, tocHTML, modifiedContentHTML, disableTOC }) => {
      // Empty body content
      const body = document.body;
      body.innerHTML = '';

      // Add Cover
      body.innerHTML += coverHTML;

      // Add toc
      if (!disableTOC) body.innerHTML += tocHTML;

      // Add body content
      body.innerHTML += modifiedContentHTML;
    },
    { coverHTML, tocHTML, modifiedContentHTML, disableTOC },
  );

  // Remove unnecessary HTML by using excludeSelectors
  excludeSelectors &&
    excludeSelectors.map(async (excludeSelector) => {
      // "selector" is equal to "excludeSelector"
      // https://pptr.dev/#?product=Puppeteer&version=v5.2.1&show=api-pageevaluatepagefunction-args
      await page.evaluate((selector) => {
        const matches = document.querySelectorAll(selector);
        matches.forEach((match) => match.remove());
      }, excludeSelector);
    });

  // Add CSS to HTML
  if (cssStyle) {
    await page.addStyleTag({ content: cssStyle });
  }

  // Scroll to the bottom of the page with puppeteer-autoscroll-down
  // This forces lazy-loading images to load
  await scrollPageToBottom(page, {});

  await page.pdf({
    path: outputPDFFilename,
    format: pdfFormat,
    printBackground: true,
    margin: pdfMargin,
    displayHeaderFooter: !!(headerTemplate || footerTemplate),
    headerTemplate,
    footerTemplate,
  });

  fs.writeFileSync('./temp/mr-context.html', contentHTML);
  fs.writeFileSync('./temp/mr-toc.html', tocHTML);
}

function generateToc(contentHtml: string) {
  const headers: Array<{
    header: string;
    level: number;
    id: string;
  }> = [];

  // Create TOC only for h1~h3
  const modifiedContentHTML = contentHtml.replace(
    /<h[1-3](.+?)<\/h[1-3]( )*>/g,
    htmlReplacer,
  );

  function htmlReplacer(matchedStr: string) {
    // docusaurus inserts #s into headers for direct links to the header
    const headerText = matchedStr
      .replace(/<a[^>]*>#<\/a( )*>/g, '')
      .replace(/<[^>]*>/g, '')
      .trim();

    const originalHeaderId = matchedStr.match(/id( )*=( )*"(.*)"/)?.[3] || '';

    const headerId = `${Math.random().toString(36).substr(2, 5)}-${
      headers.length
    }`;

    // level is h<level>
    const level = Number(matchedStr[matchedStr.indexOf('h') + 1]);

    // Ignore On this page header
    if (headerText !== 'On this page') {
      headers.push({
        header: headerText,
        level,
        id: originalHeaderId,
      });
    }

    // console.log(
    //   chalk.blueBright(
    //     `Found header: ${headerText} with level ${level} and id ${originalHeaderId}`,
    //   ),
    // );

    const modifiedContentHTML = matchedStr.replace(/<h[1-3].*?>/g, (header) => {
      // if (header.match(/id( )*=( )*"/g)) {
      //   return header.replace(/id( )*=( )*".*"/g, `id="${headerId}"`);
      // } else {
      return (
        header.substring(0, header.length - 1) + ` id="${originalHeaderId}">`
      );
      // }
    });

    // console.log(modifiedContentHTML);
    return modifiedContentHTML;
  }

  const toc = headers
    .map((header) => {
      let id;
      if (header.id[0] === '#') {
        id = header.id;
      } else {
        id = `#${header.id}`;
      }
      return `<li class="toc-item toc-item-${
        header.level
      }" style="margin-left:${(header.level - 1) * 20}px"><a href="${id}">${
        header.header
      }</a></li>`;
    })
    .join('\n');

  // console.log(chalk.magenta('TOC: ', toc));

  const tocHTML = `
  <div class="toc-page" style="page-break-after: always;">
    <h1 class="toc-header">Table of contents:</h1>
    <ul class="toc-list">${toc}</ul>
  </div>
  `;

  return { modifiedContentHTML, tocHTML };
}
