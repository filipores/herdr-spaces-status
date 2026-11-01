// Run from the repository root: node --experimental-vm-modules checks/spaces-glow.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Record native builder output; herdr-app check verifies the real GPUI API.
function element() {
  const node = { styles: {}, nodes: [], events: {} };
  const builder = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === 'when') return args[0] ? args[1](builder) : builder;
        if (key.startsWith('on_mouse_')) node.events[`${key}:${typeof args[0] === 'string' ? args[0] : ''}`] = args.at(-1);
        else if (key === 'children') node.nodes.push(...args[0]);
        else if (key === 'child') node.nodes.push(args[0]);
        else node.styles[key] = args;
        return builder;
      };
    },
  });
  return builder;
}

async function check() {
  let agentList = [], spaceList = [];
  const commands = [];
  const dependencies = {
    'gpui-kit': { View: class {}, div: element, svg: element },
    'gpui-base': { v_flex: element, h_flex: element },
    herdr: Object.fromEntries([
      'spaces', 'machines', 'panes', 'run', 'openOverlay', 'exec', 'hc',
      'theme', 'shared', 'setShared', 'watchFolder', 'window', 'layout', 'nextCommand',
    ].map(name => [name, () => null])),
  };
  Object.assign(dependencies.herdr, {
    agents: () => agentList, spaces: () => spaceList, machines: () => [],
    run: (name, args) => commands.push({ name, args }),
  });
  const source = fs.readFileSync(path.join(__dirname, '../mods/spaces-glow/main.js'), 'utf8');
  const mod = new vm.SourceTextModule(source);
  const navigation = new vm.SourceTextModule(fs.readFileSync(path.join(__dirname, '../mods/spaces-glow/navigation.js'), 'utf8'));
  await mod.link(name => name === './navigation.js' ? navigation : new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
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
  spaceList = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', machine: null }, { id: 'remote/c', name: 'C', machine: 'remote' }];
  const row = i => view.row({ w: spaceList[i], i }, { ...theme, accent: '#abcdef' });
  const event = (i, name) => row(i).events[name]?.({}, { notify() {} });
  for (const [from, to, hover, move] of [[0, 1, true, true], [1, 0, true, true], [0, 2, true, false], [2, 0, true, false], [0, 1, false, false]]) {
    commands.length = 0;
    event(from, 'on_mouse_down:left');
    if (hover) event(to, 'on_mouse_move:');
    if (move) {
      assert.equal(view.over, to, 'Hover must track the drop target');
      assert.deepEqual(row(from).styles.opacity, [0.5]);
      const line = descendants(row(to)).find(n => n.styles.bg?.[0] === '#abcdef');
      assert.deepEqual(line?.styles[from < to ? 'bottom' : 'top'], [0], 'Drop line must show direction');
    }
    event(to, 'on_mouse_up:left');
    assert.deepEqual(commands, move ? [{ name: 'space.move', args: { id: spaceList[from].id, index: to + 1 } }] : [], 'Only hovered targets on the same machine may move');
    assert.equal(view.pressed, null);
    assert.equal(view.over, null);
  }
  event(0, 'on_mouse_down:left');
  event(0, 'on_mouse_up:left');
  assert.deepEqual(commands, [{ name: 'space.select', args: { id: 'a' } }]);
  const { navigationTarget } = navigation.namespace;
  const sp = [{ id: 'a' }, { id: 'b', active: true }, { id: 'remote/a' }];
  const ag = [{ address: 't1', space: 'a', status: 'done' }, { address: 'remote/t1', space: 'remote/a', status: 'done' }];
  assert.deepEqual(navigationTarget('first_done', sp, ag), { name: 'agent.focus', args: { terminal: 't1' } });
  assert.deepEqual(navigationTarget('first_done', sp, ag.slice(1)), { name: 'agent.focus', args: { terminal: 'remote/t1' } });
  ag[0].status = ag[1].status = 'working';
  assert.deepEqual(navigationTarget('next_working', sp, ag), { name: 'space.select', args: { id: 'remote/a' } });
  assert.deepEqual(navigationTarget('next_working', sp, ag.slice(0, 1)), { name: 'space.select', args: { id: 'a' } });
  assert.deepEqual(navigationTarget('next_working', [{ id: 'a', active: true }], ag), { name: 'space.select', args: { id: 'a' } });
  assert.deepEqual(navigationTarget('next_working', sp.map(s => ({ id: s.id })), ag), { name: 'space.select', args: { id: 'a' } });
  assert.equal(navigationTarget('first_done', sp, ag), undefined);
  assert.equal(navigationTarget('next_working', sp, []), undefined);
  assert.equal(navigationTarget('next_working', [], ag), undefined);
  assert.equal(navigationTarget('unknown', sp, ag), undefined);
  console.log('PASS: 20 glow cases + 48 outline pulse cases + drag/drop, click and navigation guards.');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
