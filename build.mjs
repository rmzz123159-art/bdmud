import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'config.js']) {
  await copyFile(file, `dist/${file}`);
}
console.log('NEXTGEN STORE static assets copied to dist/. Vercel Functions are built from /api.');
