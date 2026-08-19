import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.dirname(fileURLToPath(import.meta.url));

test('static WebUI client files exist and declare the same-origin job contract', () => {
  for (const file of ['index.html', 'app.js', 'styles.css']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
  }

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

  assert.match(html, /runtime-select/);
  assert.match(html, /source/);
  assert.match(html, /output/);
  assert.match(app, /\/v1\/runtimes/);
  assert.match(app, /\/v1\//);
  assert.match(app, /\/v1\/jobs\//);
  assert.match(app, /textContent/);
  assert.match(styles, /@media/);
});
