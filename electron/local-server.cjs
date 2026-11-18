const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function resolveClientAsset(clientDirectory, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const root = path.resolve(clientDirectory);
  const candidate = path.resolve(root, `.${decodedPath}`);
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function writeText(response, status, message) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

async function serveClientAsset(clientDirectory, pathname, method, response) {
  if (method !== "GET" && method !== "HEAD") return false;
  const filePath = resolveClientAsset(clientDirectory, pathname);
  if (!filePath) {
    writeText(response, 403, "Forbidden");
    return true;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
  if (!stat.isFile()) return false;

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "content-type": MIME_TYPES[extension] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (method === "HEAD") {
    response.end();
    return true;
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.once("error", reject);
    response.once("error", reject);
    response.once("finish", resolve);
    stream.pipe(response);
  });
  return true;
}

function createRequestHeaders(incomingHeaders) {
  const headers = new Headers();
  const hopByHopHeaders = new Set([
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  for (const [name, value] of Object.entries(incomingHeaders)) {
    if (value === undefined || hopByHopHeaders.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

async function createLocalAppServer(options) {
  const clientDirectory = path.resolve(options.clientDirectory);
  const serverEntry = path.resolve(options.serverEntry);
  const { default: handler } = await import(pathToFileURL(serverEntry).href);
  if (!handler || typeof handler.fetch !== "function") {
    throw new Error("The bundled GILNET server does not expose a Fetch handler.");
  }

  const host = options.host || "127.0.0.1";
  const requestedPort = options.port ?? 0;
  let origin = "";
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const requestHost = String(incoming.headers.host || "").toLowerCase();
      const expectedHost = origin.replace(/^http:\/\//, "").toLowerCase();
      if (requestHost !== expectedHost) {
        writeText(outgoing, 403, "Forbidden");
        return;
      }

      const requestOrigin = incoming.headers.origin;
      if (requestOrigin) {
        let parsedOrigin;
        try {
          parsedOrigin = new URL(requestOrigin).origin;
        } catch {
          writeText(outgoing, 403, "Forbidden");
          return;
        }
        if (parsedOrigin !== origin) {
          writeText(outgoing, 403, "Forbidden");
          return;
        }
      }

      const requestUrl = new URL(incoming.url || "/", origin);
      if (
        await serveClientAsset(
          clientDirectory,
          requestUrl.pathname,
          incoming.method || "GET",
          outgoing,
        )
      ) {
        return;
      }

      const method = incoming.method || "GET";
      if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)) {
        writeText(outgoing, 405, "Method Not Allowed");
        return;
      }
      const init = { method, headers: createRequestHeaders(incoming.headers) };
      if (method !== "GET" && method !== "HEAD") {
        init.body = Readable.toWeb(incoming);
        init.duplex = "half";
      }

      const result = await handler.fetch(new Request(requestUrl, init));
      const responseHeaders = {};
      result.headers.forEach((value, name) => {
        if (name.toLowerCase() !== "set-cookie") responseHeaders[name] = value;
      });
      const cookies = result.headers.getSetCookie?.();
      if (cookies?.length) responseHeaders["set-cookie"] = cookies;

      outgoing.writeHead(result.status, responseHeaders);
      if (!result.body || method === "HEAD") {
        outgoing.end();
        return;
      }
      Readable.fromWeb(result.body).pipe(outgoing);
    } catch (error) {
      if (outgoing.headersSent) {
        outgoing.destroy(error);
      } else {
        writeText(outgoing, 500, "The local GILNET server could not process this request.");
      }
      options.onRequestError?.(error);
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("The local GILNET server did not bind to a TCP port.");
  }
  origin = `http://${host}:${address.port}`;
  if (options.onServerError) server.on("error", options.onServerError);

  return {
    origin,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

module.exports = { createLocalAppServer, resolveClientAsset };
