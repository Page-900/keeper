import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
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
      'The cap table',
      'Refusals on the chain',
      'Authority changes',
      'What other people tried',
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

  it('says what it is and what it cannot do without waiting for a single answer', () => {
    expect(PAGE).toContain('holds no key and signs nothing');
    expect(PAGE).toContain('Sunrise Lodge is invented');
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
