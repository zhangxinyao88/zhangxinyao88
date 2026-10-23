import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRepositories, monthWindows, renderContributions, selectRepositories } from './update-contributions.mjs';

const now = new Date('2026-10-23T15:30:00Z');

test('the rolling-year monthly windows have no overlapping or missing boundaries', () => {
  const windows = monthWindows(now);
  assert.equal(windows[0].from, '2025-10-23T00:00:00.000Z');
  assert.equal(windows.at(-1).to, now.toISOString());
  for (let index = 1; index < windows.length; index++) {
    assert.equal(Date.parse(windows[index].from) - Date.parse(windows[index - 1].to), 1);
  }
  assert.ok(windows.every(({ from, to }) => from.slice(0, 7) === to.slice(0, 7)));
});

test('commit totals and active months include Spark without requiring a merged PR', async () => {
  const repositories = await collectRepositories({ login: 'me', token: 'test', now,
    request: async (_url, options) => {
      const { from } = JSON.parse(options.body).variables;
      const repository = { nameWithOwner: 'apache/spark', url: 'https://github.com/apache/spark',
        owner: { login: 'apache' }, isFork: false, isPrivate: false };
      const contributions = { pageInfo: { hasNextPage: false },
        nodes: [{ commitCount: 2, occurredAt: from }, { commitCount: 1, occurredAt: from }] };
      const groups = [
        repository,
        { ...repository, url: 'private', isPrivate: true },
        { ...repository, url: 'fork', isFork: true },
        { ...repository, url: 'owned', owner: { login: 'ME' } },
      ].map((repository) => ({ repository, contributions }));
      return { ok: true, json: async () => ({ data: { user: { contributionsCollection: {
        totalRepositoriesWithContributedCommits: groups.length, commitContributionsByRepository: groups,
      } } } }) };
    },
  });
  assert.equal(repositories.length, 1);
  assert.equal(repositories[0].nameWithOwner, 'apache/spark');
  assert.equal(repositories[0].commits, 39);
  assert.equal(repositories[0].activeMonths, 13);
  assert.equal(repositories[0].latest, '2026-10-01T00:00:00.000Z');
});

test('ranking uses commits, months, recency, then name, and shows at most five', () => {
  const repo = (name, commits, activeMonths, latest = '2026-10-01') =>
    ({ nameWithOwner: name, commits, activeMonths, latest });
  const candidates = [repo('z', 3, 2), repo('a', 3, 2), repo('recent', 3, 2, '2026-10-02'),
    repo('steady', 3, 3), repo('most', 4, 1), repo('tiny', 1, 1)];
  const original = [...candidates];
  assert.deepEqual(selectRepositories(candidates).map(({ nameWithOwner }) => nameWithOwner),
    ['most', 'steady', 'recent', 'a', 'z']);
  assert.deepEqual(candidates, original);
});

test('incomplete data and API errors fail instead of publishing a partial ranking', async () => {
  const run = (result) => collectRepositories({ login: 'me', token: 'test', now,
    request: async () => ({ ok: true, json: async () => result }) });
  await assert.rejects(run({ errors: [{ message: 'rate limit' }] }), /query failed/);
  await assert.rejects(run({ data: { user: null } }), /not found/);
  await assert.rejects(run({ data: { user: { contributionsCollection: {
    totalRepositoriesWithContributedCommits: 101, commitContributionsByRepository: [],
  } } } }), /incomplete ranking/);
  await assert.rejects(run({ data: { user: { contributionsCollection: {
    totalRepositoriesWithContributedCommits: 1, commitContributionsByRepository: [{
      repository: {}, contributions: { pageInfo: { hasNextPage: true } },
    }],
  } } } }), /incomplete ranking/);
});

test('rendering keeps repository descriptions inside table cells and handles an empty result', () => {
  const markdown = renderContributions([{ nameWithOwner: 'org/repo', url: 'https://github.com/org/repo',
    description: 'test | <tag>\nnext $&', commits: 3, activeMonths: 2, latest: '2026-10-01T00:00:00Z' }]);
  assert.ok(markdown.includes('test \\| &lt;tag&gt; next $&amp;'));
  assert.ok(markdown.includes('| 3 | 2 | 2026-10-01 |'));
  assert.match(renderContributions([]), /No public commit contributions/);
});
