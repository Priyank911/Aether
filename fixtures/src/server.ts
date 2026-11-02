import * as http from 'node:http';
import {
  CROSS_ORIGIN_CHILD_HTML,
  CROSS_ORIGIN_PAGE_HTML,
  FORM_PAGE_HTML,
  LONG_LIST_PAGE_HTML,
  NESTED_CHILD_HTML,
  NESTED_GRANDCHILD_HTML,
  NESTED_IFRAMES_PAGE_HTML,
  SHADOW_DOM_PAGE_HTML,
  INJECTION_PAGE_HTML,
} from './pages.js';

export interface FixtureServers {
  mainBaseUrl: string;
  crossOriginBaseUrl: string;
  close: () => Promise<void>;
}

export async function startFixtureServers(
  mainPort = 4101,
  crossPort = 4102,
): Promise<FixtureServers> {
  // Main server (localhost)
  const mainServer = http.createServer((req, res) => {
    const url = req.url || '/';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (url === '/form.html' || url === '/') {
      res.end(FORM_PAGE_HTML);
    } else if (url === '/injection.html') {
      res.end(INJECTION_PAGE_HTML);
    } else if (url === '/nested-iframes.html') {
      res.end(NESTED_IFRAMES_PAGE_HTML);
    } else if (url === '/nested-child.html') {
      res.end(NESTED_CHILD_HTML);
    } else if (url === '/nested-grandchild.html') {
      res.end(NESTED_GRANDCHILD_HTML);
    } else if (url === '/cross-origin.html') {
      const childUrl = `http://127.0.0.1:${crossPort}/cross-origin-child.html`;
      res.end(CROSS_ORIGIN_PAGE_HTML(childUrl));
    } else if (url === '/shadow-dom.html') {
      res.end(SHADOW_DOM_PAGE_HTML);
    } else if (url === '/long-list.html') {
      res.end(LONG_LIST_PAGE_HTML);
    } else {
      res.statusCode = 404;
      res.end('<h1>404 Not Found</h1>');
    }
  });

  // Cross-origin server (127.0.0.1)
  const crossServer = http.createServer((req, res) => {
    const url = req.url || '/';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url === '/cross-origin-child.html' || url === '/') {
      res.end(CROSS_ORIGIN_CHILD_HTML);
    } else {
      res.statusCode = 404;
      res.end('<h1>404 Not Found</h1>');
    }
  });

  await Promise.race([
    Promise.all([
      new Promise<void>((resolve) => mainServer.listen(mainPort, 'localhost', resolve)),
      new Promise<void>((resolve) => crossServer.listen(crossPort, '127.0.0.1', resolve)),
    ]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture servers failed to bind')), 5000)),
  ]);

  const close = async (): Promise<void> => {
    await Promise.all([
      new Promise<void>((res) => mainServer.close(() => res())),
      new Promise<void>((res) => crossServer.close(() => res())),
    ]);
  };

  return {
    mainBaseUrl: `http://localhost:${mainPort}`,
    crossOriginBaseUrl: `http://127.0.0.1:${crossPort}`,
    close,
  };
}
