import { readFile, writeFile } from 'node:fs/promises';

const login = process.env.GITHUB_LOGIN;
const token = process.env.GH_TOKEN;

if (!login || !token) {
  throw new Error('GITHUB_LOGIN and GH_TOKEN must be set.');
}

const query = `
  query ContributedRepositories($login: String!, $from: DateTime!, $to: DateTime!, $after: String) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        pullRequestContributions(first: 100, after: $after) {
          pageInfo {
            endCursor
            hasNextPage
          }
          nodes {
            occurredAt
            pullRequest {
              mergedAt
              repository {
                nameWithOwner
                url
                description
              }
            }
          }
        }
      }
    }
  }
`;

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - 1);

const nodes = [];
let after = null;

do {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { login, from: from.toISOString(), to: now.toISOString(), after } }),
  });

  const result = await response.json();
  if (!response.ok || result.errors) {
    throw new Error(`GitHub GraphQL query failed: ${JSON.stringify(result.errors ?? result)}`);
  }

  const connection = result.data.user.contributionsCollection.pullRequestContributions;
  nodes.push(...connection.nodes);
  after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
} while (after);

const escapeTableCell = (value) => (value ?? 'No description provided.')
  .replace(/\\/g, '\\\\')
  .replace(/\|/g, '\\|')
  .replace(/[\r\n]+/g, ' ');

const contributions = nodes
  .map(({ occurredAt, pullRequest }) => ({ occurredAt, ...pullRequest }))
  .filter(({ mergedAt, repository }) => mergedAt && repository)
  .sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));

const repositories = [...contributions.reduce((byRepository, { mergedAt, repository }) => {
  if (!byRepository.has(repository.url)) {
    byRepository.set(repository.url, { ...repository, mergedAt });
  }
  return byRepository;
}, new Map()).values()];

const content = repositories.length
  ? [
      '### Merged contributions in the last 12 months',
      '',
      '| Repository | About |',
      '| --- | --- |',
      ...repositories.map(({ nameWithOwner, url, description }) => `| [${escapeTableCell(nameWithOwner)}](${url}) | ${escapeTableCell(description)} |`),
    ].join('\n')
  : '_No merged public pull-request contributions in the past year._';

const readme = await readFile('README.md', 'utf8');
const start = '<!-- contributions:start -->';
const end = '<!-- contributions:end -->';
const pattern = new RegExp(`(${start})[\\s\\S]*?(${end})`);
if (!pattern.test(readme)) {
  throw new Error('Contribution markers were not found in README.md.');
}

await writeFile('README.md', readme.replace(pattern, `$1\n${content}\n$2`));
