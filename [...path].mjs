import { handler as apiHandler } from '../server/api.mjs';

// Disable Vercel's automatic body parser so multipart ZIP restore is preserved byte-for-byte.
export const config = { api: { bodyParser: false } };

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(request, response) {
  try {
    const raw = await readRawBody(request);
    const contentType = String(request.headers['content-type'] || '');
    const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data');
    const host = request.headers.host || 'localhost';
    const url = request.url || '/api';
    const safeHeaders = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(name.toLowerCase())));
    const event = {
      path: url.split('?')[0],
      rawUrl: `https://${host}${url}`,
      httpMethod: request.method || 'GET',
      headers: safeHeaders,
      body: isMultipart ? raw.toString('base64') : raw.toString('utf8'),
      isBase64Encoded: isMultipart
    };
    const result = await apiHandler(event);
    response.statusCode = result.statusCode || 200;
    for (const [name, value] of Object.entries(result.headers || {})) response.setHeader(name, value);
    if (result.isBase64Encoded) response.end(Buffer.from(result.body || '', 'base64'));
    else response.end(result.body || '');
  } catch (error) {
    console.error('NEXTGEN Vercel API wrapper:', error);
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify({ error: 'Terjadi kesalahan pada server. Periksa Vercel Function Logs.' }));
  }
}
