// Run from the repository root: node --experimental-vm-modules checks/spaces-glow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Record native builder output; herdr-app check verifies the real GPUI API.
function element() {
  const node = { styles: {}, nodes: [] };
  const builder = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === 'when') return args[0] ? args[1](builder) : builder;
        if (key === 'children') node.nodes.push(...args[0]);
        else if (key === 'child') node.nodes.push(args[0]);
        else node.styles[key] = args;
        return builder;
      };
    },
  });
  return builder;
}

async function check() {
  let agentList = [];
  const dependencies = {
    'gpui-kit': { View: class {}, div: element, svg: element },
    'gpui-base': { v_flex: element, h_flex: element },
    herdr: Object.fromEntries([
      'spaces', 'machines', 'panes', 'run', 'openOverlay', 'exec', 'hc',
      'theme', 'shared', 'setShared', 'watchFolder', 'window', 'layout',
    ].map(name => [name, () => null])),
  };
  Object.assign(dependencies.herdr, {
    agents: () => agentList, spaces: () => [], machines: () => [],
  });
  const source = fs.readFileSync(path.join(__dirname, '../mods/spaces-glow/main.js'), 'utf8');
  const mod = new vm.SourceTextModule(source);
  await mod.link(name => new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
    for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
  }));
  await mod.evaluate();
  const view = new mod.namespace.default();
  const theme = { selected: '#303030', raised: '#404040', hover: '#505050', muted: '#808080', working: '#facc15' };
  const paint = node => typeof node === 'object'
    ? [...['bg', 'border_color'].flatMap(k => node.styles[k] ?? []), ...node.nodes.flatMap(paint)]
    : [];
  for (const method of ['row', 'compact']) {
    for (const active of [false, true]) {
      for (const [status, expected] of [
        ['done', '#22c55e'], ['blocked', '#f59e0b'],
        ['working', null], ['idle', null], [null, null],
      ]) {
        const row = view[method]({ w: { id: 'test', name: 'Test', status, active }, i: 0 }, theme);
        const colors = paint(row).filter(c => /^#(?:22c55e|f59e0b)/.test(c));
        const label = `${method}: ${status}, active=${active}`;
        if (expected) {
          assert(colors.length > 0, `Missing glow: ${label}`);
          assert(colors.every(c => c.startsWith(expected)), `Wrong glow color: ${label}`);
        } else {
          assert.deepEqual(colors, [], `Unexpected glow: ${label}`);
        }
      }
    }
  }
  view.machines = [];
  const descendants = node => typeof node === 'object' ? [node, ...node.nodes.flatMap(descendants)] : [];
  for (const [foreground, active] of [
    ['#eceef0', false], ['#eceef0', true], ['#222426', false], ['#222426', true],
  ]) {
    for (const collapsed of [false, true]) {
      for (const [status, workers, running] of [
        ['working', ['working'], true],
        ['done', ['done', 'working'], true],
        ['blocked', ['blocked', 'working'], true],
        ['done', ['done', 'idle'], false],
        ['idle', ['idle'], false],
        [null, [], false],
      ]) {
        agentList = workers.map(status => ({ space: 'test', status }));
        agentList.push({ space: 'remote/test', status: 'working' });
        view.ordered = () => [{ w: { id: 'test', name: 'Test', status, active }, i: 0 }];
        const [row] = view.grouped({ ...theme, foreground }, collapsed);
        const nodes = descendants(row);
        const pulses = nodes.filter(node => node.styles.loop);
        const label = `${collapsed ? 'compact' : 'expanded'}: ${workers}, ${foreground}, active=${active}`;
        assert.deepEqual(row.styles.bg, active ? [collapsed ? theme.raised : theme.selected] : undefined, `Keep selection background unchanged: ${label}`);
        assert.equal(nodes.filter(node => node.styles.spin).length, 0, `No rotating spinner: ${label}`);
        assert(!nodes.some(node => node.styles.text_color?.includes(theme.working)), `No colored working marker: ${label}`);
        assert.equal(pulses.length, running ? 1 : 0, `Pulse must reflect this space's workers: ${label}`);
        for (const pulse of pulses) {
          assert(!descendants(pulse).some(node => node.styles.bg), `Outline only, no animated fill: ${label}`);
          const outlines = descendants(pulse).filter(node => node.styles.border);
          assert(outlines.length > 1, `Keep a soft halo around the contour: ${label}`);
          for (const outline of outlines) {
            assert.deepEqual(outline.styles.border_color, [foreground], `Use neutral theme color: ${label}`);
            assert.deepEqual(outline.styles.border, [1], `Keep contour thin: ${label}`);
            assert.equal(outline.nodes.length, 0, `Do not animate labels or icons: ${label}`);
          }
          const [property, policy] = pulse.styles.loop;
          assert.equal(property, 'opacity', `No movement or resizing: ${label}`);
          assert(policy.from > 0 && policy.from < policy.to && policy.to <= 0.25, `Keep contour quieter than attention glows: ${label}`);
          assert(policy.period >= 3000, `Keep pulse slow: ${label}`);
          assert.equal(policy.easing, 'ease-in-out', `Keep pulse smooth: ${label}`);
        }
        const glow = paint(row).filter(c => /^#(?:22c55e|f59e0b)/.test(c));
        const expected = { done: '#22c55e', blocked: '#f59e0b' }[status];
        if (expected) assert(glow.length && glow.every(c => c.startsWith(expected)), `Keep attention glow: ${label}`);
        else assert.deepEqual(glow, [], `Working alone must not glow: ${label}`);
      }
    }
  }
  console.log('PASS: 20 glow cases + 48 outline pulse cases, including stable selection, themes and mixed states.');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
