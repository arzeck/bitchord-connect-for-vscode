const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  // Ensure dist directories exist
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  // Copy webview static files to dist/webview
  function copyWebviewFiles() {
    const srcDir = path.join(__dirname, 'src', 'webview', 'ui');
    const dstDir = path.join(__dirname, 'dist', 'webview');
    const fontsSrc = path.join(__dirname, 'src', 'fonts');
    const amLyricsSrc = path.join(
      __dirname,
      'node_modules',
      '@uimaxbai',
      'am-lyrics',
      'dist',
      'src',
      'am-lyrics.js'
    );

    if (fs.existsSync(amLyricsSrc)) {
      if (!fs.existsSync(srcDir)) {
        fs.mkdirSync(srcDir, { recursive: true });
      }
      if (!fs.existsSync(path.join(srcDir, 'am-lyrics.js'))) {
        fs.copyFileSync(amLyricsSrc, path.join(srcDir, 'am-lyrics.js'));
      }
    }

    // Ensure fonts are copied
    if (fs.existsSync(fontsSrc)) {
      const uiFontsDir = path.join(srcDir, 'fonts');
      fs.mkdirSync(uiFontsDir, { recursive: true });
      fs.cpSync(fontsSrc, uiFontsDir, { recursive: true });
    }

    if (fs.existsSync(srcDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }

  copyWebviewFiles();

  if (watch) {
    console.log('[watch] build started');
    await extensionCtx.watch();
    fs.watch(path.join(__dirname, 'src', 'webview', 'ui'), () => {
      copyWebviewFiles();
    });
  } else {
    await extensionCtx.rebuild();
    await extensionCtx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
