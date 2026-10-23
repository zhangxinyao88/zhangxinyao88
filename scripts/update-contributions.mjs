import { readFile, writeFile } from 'node:fs/promises';

const login = process.env.GITHUB_LOGIN;
const token = process.env.GH_TOKEN;

if (!login || !token) {
  throw new Error('GITHUB_LOGIN and GH_TOKEN must be set.');
}

const query = `
  query ContributedRepositories($login: String!, $after: String) {
    user(login: $login) {
      repositoriesContributedTo(
        first: 100
        after: $after
        contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
        includeUserRepositories: false
        privacy: PUBLIC
      ) {
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          nameWithOwner
          url
          description
          isFork
        }
      }
    }
  }
`;

const nodes = [];
let after = null;

do {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { login, after } }),
  });

  const result = await response.json();
  if (!response.ok || result.errors) {
    throw new Error(`GitHub GraphQL query failed: ${JSON.stringify(result.errors ?? result)}`);
  }

  if (!result.data?.user) throw new Error(`GitHub user not found: ${login}`);
  const connection = result.data.user.repositoriesContributedTo;
  nodes.push(...connection.nodes);
  after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
} while (after);

const escapeTableCell = (value) => (value ?? 'No description provided.')
  .replace(/\\/g, '\\\\')
  .replace(/\|/g, '\\|')
  .replace(/[\r\n]+/g, ' ');

// GitHub's recent contribution index includes authored commits, so projects
// that land code outside GitHub's PR merge flow (such as Spark) are included.
// Its time window is controlled by GitHub, rather than an exact 12-month range.
const repositories = [...new Map(nodes
  .filter((repository) => repository && !repository.isFork)
  .map((repository) => [repository.url, repository])).values()]
  .sort((a, b) => a.nameWithOwner.localeCompare(b.nameWithOwner));

const content = repositories.length
  ? [
      '### Recent contribution repositories',
      '',
      'Public projects I have contributed to through commits, issues, or pull requests.',
      '',
      '| Repository | About |',
      '| --- | --- |',
      ...repositories.map(({ nameWithOwner, url, description }) => `| [${escapeTableCell(nameWithOwner)}](${url}) | ${escapeTableCell(description)} |`),
    ].join('\n')
  : '_No recent public contribution repositories found._';

const readme = await readFile('README.md', 'utf8');
const start = '<!-- contributions:start -->';
const end = '<!-- contributions:end -->';
const pattern = new RegExp(`(${start})[\\s\\S]*?(${end})`);
if (!pattern.test(readme)) {
  throw new Error('Contribution markers were not found in README.md.');
}

await writeFile('README.md', readme.replace(pattern, (_, startMarker, endMarker) => `${startMarker}\n${content}\n${endMarker}`));
