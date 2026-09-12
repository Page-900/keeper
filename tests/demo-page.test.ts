import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PUBLIC_DIRECTORY, demoServer, type DemoSources } from '../src/demo/server.js';
import { KeeperError } from '../src/shared/errors.js';
import { registryState } from './support/registry-state.js';

const read = (file: string): string => readFileSync(join(PUBLIC_DIRECTORY, file), 'utf8');

const SCRIPT = read('app.js') + read('ui.js');
const PAGE = read('index.html');

const RAW_HTML = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval('];

const idsLookedUp = (): string[] => [
  ...new Set([...SCRIPT.matchAll(/find\('([^']+)'\)/g)].map((found) => found[1] ?? '')),
];

describe('the page writes text and never markup', () => {
  it('reaches for no way of turning a stranger words into elements', () => {
    const found = RAW_HTML.filter((way) => SCRIPT.includes(way));

    expect(found).toEqual([]);
  });

  it('sets a link only when it points somewhere a browser will treat as a link', () => {
    expect(SCRIPT).toContain("startsWith('https://')");
  });
});

describe('the page and the code that fills it agree', () => {
  it('looks up no element the page does not carry', () => {
    const missing = idsLookedUp().filter((id) => !PAGE.includes(`id="${id}"`));

    expect(missing).toEqual([]);
  });

  it('holds every heading in the file itself, so the frame stands with no answer at all', () => {
    for (const heading of [
      'The situation',
      'What the permission allows',
      'What the investor told the agent',
      'Attack it yourself',
      'Check your address eligibility',
      'The cap table',
      'Refusals on the chain',
      'Authority changes',
      'Everything the agent has answered',
      'Bids you can try',
      'Who can refuse',
      'The bound, right now',
    ])
      expect(PAGE).toContain(heading);
  });

  it('says every live panel could not be read, rather than leaving one saying nothing', () => {
    const shown = SCRIPT.slice(SCRIPT.indexOf('const trouble ='), SCRIPT.indexOf('const NOT_FROM'));

    for (const id of ['blockNow', 'brief', 'document']) expect(shown).toContain(`'${id}'`);
  });

  it('leaves the attack box usable after a failed read, having told the visitor to write their own', () => {
    const shown = SCRIPT.slice(SCRIPT.indexOf('const trouble ='), SCRIPT.indexOf('const NOT_FROM'));

    expect(shown).toContain("find('run').disabled = false");
  });

  it('promises the visitor a reading and never a payment, in the section that invites them', () => {
    const opens = PAGE.indexOf('id="checkBox"');
    const section = PAGE.slice(opens, PAGE.indexOf('</dialog>', opens)).replace(/\s+/g, ' ');

    expect(section).toContain('Check your address eligibility');
    expect(section).not.toMatch(/receive|paid|payout|send you/i);
  });

  it('says what it is and what bounds it without waiting for a single answer', () => {
    expect(PAGE).toContain('holds a key, and the mandate is what it may do');
    expect(PAGE).toContain('Sunrise Lodge is invented');
  });

  it('never tells a visitor it signs nothing, which stopped being true when it got a key', () => {
    expect(PAGE).not.toContain('signs nothing');
    expect(PAGE).not.toContain('holds no key');
  });
});

describe('one dead source never takes the whole page with it', () => {
  it('still serves the state when the issuer records cannot be read', async () => {
    const server = demoServer({
      reads: { state: () => Promise.resolve(registryState()), balance: () => Promise.resolve(0n) },
      capTable: () => Promise.reject(new KeeperError('brickkenRateLimited', 'too many')),
      ramsStatus: () => Promise.reject(new KeeperError('brickkenRateLimited', 'too many')),
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as AddressInfo;

    try {
      const answer = await fetch(`http://127.0.0.1:${String(port)}/api/state`);
      const body = (await answer.json()) as { holdersRead: boolean; mandate: string[] };

      expect(answer.status).toBe(200);
      expect(body.holdersRead).toBe(false);
      expect(body.mandate.length).toBeGreaterThan(0);
    } finally {
      await new Promise((closed) => server.close(closed));
    }
  });
});

const unreachable = (): DemoSources => ({
  reads: {
    state: () => Promise.reject(new KeeperError('brickkenUnreachable', 'nothing answers')),
    balance: () => Promise.resolve(0n),
  },
  capTable: () => Promise.reject(new KeeperError('brickkenUnreachable', 'nothing answers')),
  ramsStatus: () => Promise.reject(new KeeperError('brickkenUnreachable', 'nothing answers')),
});

describe('a judge with nothing working still gets a page', () => {
  it('serves the page, its style, and its code even while every answer is failing', async () => {
    const server = demoServer(unreachable());
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as AddressInfo;
    const at = (path: string): Promise<Response> =>
      fetch(`http://127.0.0.1:${String(port)}${path}`);

    try {
      const page = await at('/');
      const code = await at('/app.js');
      const style = await at('/style.css');
      const state = await at('/api/state');

      expect([page.status, code.status, style.status]).toEqual([200, 200, 200]);
      expect(await page.text()).toContain('Attack it yourself');
      expect(state.status).toBe(502);
    } finally {
      await new Promise((closed) => server.close(closed));
    }
  });
});

describe('the page that says it signs nothing', () => {
  const SOURCE = fileURLToPath(new URL('../src/', import.meta.url));

  const importsOf = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/^import(?! type)[\s\S]*?from '(\.[^']+)'/gm)]
      .map((found) => join(dirname(file), (found[1] ?? '').replace(/\.js$/, '.ts')))
      .filter((path) => existsSync(path));

  const direct = (file: string): string[] =>
    importsOf(join(SOURCE, file)).map((one) => one.slice(SOURCE.length));

  it('never lets the server itself turn a decision into a transaction', () => {
    const imported = direct('demo/server.ts');

    expect(imported).toContain('demo/log.ts');
    for (const forbidden of ['keeper/act.ts', 'brickken/execute.ts'])
      expect(imported).not.toContain(forbidden);
  });

  it('reaches the send only through the tool that holds the switch and the rate', () => {
    expect(direct('demo/server.ts')).not.toContain('demo/execute.ts');
    expect(direct('demo/deliver.ts')).toContain('demo/execute.ts');
    expect(direct('demo/deliver.ts')).toContain('demo/spend.ts');
  });
});

describe('every panel on the page can be reached from the rail beside it', () => {
  it('gives each section a link, so none of them is only findable by scrolling', () => {
    const sections = [...PAGE.matchAll(/<details id="(\w+)"/g)].map((found) => found[1]);
    const linked = new Set([...PAGE.matchAll(/href="#(\w+)"/g)].map((found) => found[1]));

    expect(sections.filter((id) => id !== undefined && !linked.has(id))).toEqual([]);
  });
});

describe('the page shows one panel at a time, chosen by the rail', () => {
  it('switches on the address in the bar rather than leaving the visitor to scroll', () => {
    expect(SCRIPT).toContain("addEventListener('hashchange'");
    expect(SCRIPT).toContain('panel.hidden = panel.id !== chosen');
  });

  it('falls back to a panel that exists when the address names one that does not', () => {
    const shown = SCRIPT.slice(
      SCRIPT.indexOf('const showPanel'),
      SCRIPT.indexOf('const watchRail'),
    );

    expect(shown).toContain('known ? wanted : FIRST');
  });

  it('opens every panel in the file, so none can be shown while still collapsed', () => {
    const panels = [...PAGE.matchAll(/<details id="\w+" class="drop"( open)?>/g)];

    expect(panels.filter((found) => found[1] === undefined)).toEqual([]);
  });
});

describe('every part the page asks for is a part the server will hand over', () => {
  const MODULES = /(?:from |src=|href=)['"](?:\.?\/)?([\w-]+\.(?:js|css))['"]/g;

  const wantedBy = (file: string): string[] =>
    [...read(file).matchAll(MODULES)].map((found) => (found[1] ?? '').replace('./', ''));

  it('serves every module the page and its own scripts import', async () => {
    const wanted = new Set([
      ...wantedBy('index.html'),
      ...wantedBy('app.js'),
      ...wantedBy('chat.js'),
      ...wantedBy('live.js'),
    ]);

    expect(wanted.size).toBeGreaterThan(3);

    const server = demoServer(unreachable());
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as AddressInfo;

    try {
      for (const file of wanted) {
        const answer = await fetch(`http://127.0.0.1:${String(port)}/${file}`);

        expect([file, answer.status]).toEqual([file, 200]);
      }
    } finally {
      await new Promise((closed) => server.close(closed));
    }
  });
});
