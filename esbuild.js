// Bundle the extension entry point + runtime deps into a single file.
// VS Code provides `vscode` at runtime, so mark it external.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  esbuild
    .context(opts)
    .then((ctx) => ctx.watch())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  esbuild.build(opts).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
