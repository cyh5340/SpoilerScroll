import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await cp('public', 'dist', {recursive:true});
await build({entryPoints:['src/background.ts','src/content.ts','src/popup.ts'],outdir:'dist',bundle:true,format:'iife',target:'chrome120',sourcemap:true});
await build({entryPoints:['src/policy.ts','src/match.ts'],outdir:'dist',outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'node'});
console.log('Load extension/dist as an unpacked extension.');
