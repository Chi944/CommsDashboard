import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import postcss from 'postcss';

import config from '../postcss.config.js';

test('the configured CSS pipeline emits dashboard utilities and custom theme styles', async () => {
  // Compile the real stylesheet with the real plugins, not a mocked Tailwind
  // version check: dependency migrations must still emit usable dashboard CSS.
  const plugins = await Promise.all(Object.entries(config.plugins).map(async ([name, options]) => {
    const { default: plugin } = await import(name);
    return plugin(options);
  }));
  const source = new URL('../src/index.css', import.meta.url);
  const result = await postcss(plugins).process(await readFile(source, 'utf8'), {
    from: fileURLToPath(source),
  });
  const declarations = (selector) => {
    const values = {};
    result.root.walkRules(selector, (rule) => {
      rule.walkDecls(({ prop, value }) => { values[prop] = value; });
    });
    return values;
  };
  assert.equal(declarations('.grid').display, 'grid');
  assert.match(declarations('.font-mono')['font-family'], /JetBrains Mono/);
  assert.match(declarations('.animate-marquee').animation, /marquee 60s linear infinite/);
  let hasResponsiveLayout = false;
  result.root.walkAtRules('media', (rule) => {
    if (rule.params.includes('min-width: 768px')) hasResponsiveLayout = true;
  });
  assert.equal(hasResponsiveLayout, true, 'responsive dashboard utilities must be generated');
});
