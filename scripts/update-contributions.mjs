import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const query = `
  query CommitRepositories($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalRepositoriesWithContributedCommits
        commitContributionsByRepository(maxRepositories: 100) {
          repository {
            nameWithOwner url description isPrivate isFork
            owner { login }
          }
          contributions(first: 100) {
            pageInfo { hasNextPage }
            nodes { commitCount occurredAt }
          }
        }
      }
    }
  }
`;

// Fetch one calendar month at a time: contributions are daily aggregates,
// so a page of 100 covers every day without truncating an active repository.
export function monthWindows(now) {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  from.setUTCHours(0, 0, 0, 0);
  const windows = [];
  for (let start = from; start <= now;) {
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const end = new Date(Math.min(now.getTime(), next.getTime() - 1));
    windows.push({ from: start.toISOString(), to: end.toISOString() });
    start = next;
  }
  return windows;
}

export async function collectRepositories({ login, token, now = new Date(), request = fetch }) {
  const byRepository = new Map();
  for (const window of monthWindows(now)) {
    const response = await request('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { login, ...window } }),
    });
    const result = await response.json();
    if (!response.ok || result.errors) {
      throw new Error(`GitHub GraphQL query failed: ${JSON.stringify(result.errors ?? result)}`);
    }
    if (!result.data?.user) throw new Error(`GitHub user not found: ${login}`);
    const collection = result.data.user.contributionsCollection;
    const groups = collection.commitContributionsByRepository;
    if (collection.totalRepositoriesWithContributedCommits > groups.length) {
      throw new Error('GitHub truncated the repository list; refusing to publish an incomplete ranking.');
    }
    for (const { repository, contributions } of groups) {
      if (contributions.pageInfo.hasNextPage) {
        throw new Error('GitHub truncated daily commits; refusing to publish an incomplete ranking.');
      }
      if (repository.isPrivate || repository.isFork
        || repository.owner.login.toLowerCase() === login.toLowerCase()) continue;
      const entry = byRepository.get(repository.url) ?? {
        ...repository, commits: 0, months: new Set(), latest: '',
      };
      for (const { commitCount, occurredAt } of contributions.nodes) {
        if (commitCount <= 0) continue;
        entry.commits += commitCount;
        entry.months.add(occurredAt.slice(0, 7));
        if (occurredAt > entry.latest) entry.latest = occurredAt;
      }
      byRepository.set(repository.url, entry);
    }
  }
  return [...byRepository.values()]
    .filter(({ commits }) => commits > 0)
    .map(({ months, ...repository }) => ({ ...repository, activeMonths: months.size }));
}

export function selectRepositories(repositories) {
  return [...repositories].sort((a, b) => b.commits - a.commits
    || b.activeMonths - a.activeMonths
    || b.latest.localeCompare(a.latest)
    || a.nameWithOwner.localeCompare(b.nameWithOwner)).slice(0, 5);
}

const escapeTableCell = (value) => (value ?? 'No description provided.')
  .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderContributions(repositories) {
  return [
    '### Open-source contributions',
    '',
    'Top 5 external public projects by GitHub-recognized commit contributions over the past year,',
    'with ties broken by active months and most recent commit date. Issues and unlanded PRs are excluded.',
    '',
    ...(repositories.length ? [
      '| Repository | About | Commits | Active months | Latest commit (UTC) |',
      '| --- | --- | ---: | ---: | --- |',
      ...repositories.map(({ nameWithOwner, url, description, commits, activeMonths, latest }) =>
        `| [${escapeTableCell(nameWithOwner)}](${url}) | ${escapeTableCell(description)} | ${commits} | ${activeMonths} | ${latest.slice(0, 10)} |`),
    ] : ['_No public commit contributions found in the past year._']),
  ].join('\n');
}

async function main() {
  const login = process.env.GITHUB_LOGIN;
  const token = process.env.GH_TOKEN;
  if (!login || !token) throw new Error('GITHUB_LOGIN and GH_TOKEN must be set.');

  const repositories = selectRepositories(await collectRepositories({ login, token }));
  const content = renderContributions(repositories);
  const readme = await readFile('README.md', 'utf8');
  const pattern = /(<!-- contributions:start -->)[\s\S]*?(<!-- contributions:end -->)/;
  if (!pattern.test(readme)) throw new Error('Contribution markers were not found in README.md.');
  await writeFile('README.md', readme.replace(pattern,
    (_, start, end) => `${start}\n${content}\n${end}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
