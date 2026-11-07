import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

const night = '2026-10-28';
const app = () => createApp(config);
let runsDir: string;

function writeNight(contents: string, date = night) {
  writeFileSync(join(runsDir, `${date}.jsonl`), contents);
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  config.runsDir = runsDir;
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves matching sorted HTML and JSON with aggregated warnings and original timestamps', async () => {
    writeNight([
      '{ malformed log line',
      '{"at":"2026-10-28T10:25:00+02:00","job":"alpha","status":"retry","owner":"Ada"}',
      '{"at":"2026-10-28T10:30:00+02:00","job":"alpha","status":"fail","owner":"Ada","error":"temporary fault"}',
      '{"at":"2026-10-28T09:15:00+02:00","job":"alpha","status":"ok","owner":"Ada"}',
      '{"at":"2026-10-28T10:15:00+02:00","job":"alpha","status":"retry","owner":"Ada"}',
      '{"at":"2026-10-28T11:00:00+02:00","job":"alpha","status":"ok","owner":null}',
      '{"at":"2026-10-28T10:20:00+02:00","job":"alpha","status":"retry","owner":"Ada"}',
      '{"at":"2026-10-28T08:00:00-04:00","job":"beta","status":"ok","owner":null}',
    ].join('\n'));

    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request(`/digest/${night}`),
      app().request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<title>rig · digest · 2026-10-28</title>');
    expect(html).toContain('1 malformed line skipped.');
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('<td>beta</td>'));
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td>3</td>');
    expect(html).toContain('<td>temporary fault</td>');
    expect(html).toContain('<td>2026-10-28T09:15:00+02:00</td>');
    expect(html).toContain('<td>2026-10-28T11:00:00+02:00</td>');
    expect(html).toMatch(/<tr class="warn">(?:(?!<\/tr>).)*<td>alpha<\/td>/s);
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    expect(digest).toEqual({
      rows: [
        {
          job: 'alpha', owner: null, runs: 6, retries: 3, fails: 1,
          lastStatus: 'ok', lastError: 'temporary fault',
          firstAt: '2026-10-28T09:15:00+02:00', lastAt: '2026-10-28T11:00:00+02:00',
        },
        {
          job: 'beta', owner: null, runs: 1, retries: 0, fails: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T08:00:00-04:00', lastAt: '2026-10-28T08:00:00-04:00',
        },
      ],
      badLines: 1,
      counts: { ok: 3, retry: 3, fail: 1 },
    });
  });

  it('renders an existing empty night as nothing ran and returns empty digest JSON', async () => {
    writeNight('');

    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request(`/digest/${night}`),
      app().request(`/api/digest/${night}`),
    ]);

    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('returns 404 for missing nights on both routes', async () => {
    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request(`/digest/${night}`),
      app().request(`/api/digest/${night}`),
    ]);

    expect(htmlResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
    expect(await jsonResponse.json()).toEqual({ error: 'night not found' });
  });

  it('returns 404 for invalid night names on both routes', async () => {
    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request('/digest/today'),
      app().request('/api/digest/today'),
    ]);

    expect(htmlResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
    expect(await jsonResponse.json()).toEqual({ error: 'night not found' });
  });
});
