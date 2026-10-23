# Contribution repository selection

`update-contributions.mjs` updates only the contribution markers in the profile
README. The scheduled workflow runs it daily; `workflow_dispatch` also supports
manual updates. GitPeak serves the statistics card independently.

## Selection rules

- Use GitHub's commit contribution records from one year ago (starting at UTC
  midnight on that date) through the current time.
- Exclude private repositories, forks, and repositories owned by the profile user.
- Sum commit counts, count distinct UTC calendar months with commits, and retain
  the most recent contribution day for each repository.
- Sort by commit count descending, then active months descending, then most recent
  contribution date descending. Break remaining ties by repository name.
- Display at most ten repositories. There is no minimum count or hand-maintained
  include/exclude list; a small contribution can still qualify if it ranks in the
  top ten.

The profile table shows only Repository and About. About comes directly from the
repository's GitHub description, with table and HTML characters escaped for safe
rendering. Commit counts, active months, and dates are used only for selection.

These are GitHub-recognized commit contributions, independent of PR merge status.
This covers projects such as Spark that land authored commits separately from
their pull requests. It does not inspect diffs or assess contribution significance.
GitHub's attribution rules apply, including linked author email and qualifying
default-branch or `gh-pages` commits. See the [GitHub contribution rules](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference#contribution-criteria-for-commits).

Active months count calendar months, so a rolling year that starts and ends in the
middle of a month can touch 13 calendar months. The latest date comes from GitHub's
daily contribution record rather than an individual commit timestamp.

## Data completeness

Query each calendar month separately so that up to 31 daily contribution records
fit in a single 100-record page. Request up to 100 repositories per month. If
GitHub reports more repositories or another page of days, or returns an API error,
abort before writing the README instead of publishing a partial ranking.

## Local validation

Run `node --test scripts/update-contributions.test.mjs`. To regenerate the README,
run `node scripts/update-contributions.mjs` from the repository root with
`GITHUB_LOGIN` and `GH_TOKEN` set.
