import { resolve } from 'path';
import { config } from 'dotenv';
import { Octokit } from '@octokit/rest';

import githubQuery from './githubQuery';
import generateBarChart from './generateBarChart';
import { userInfoQuery, createContributedRepoQuery, createCommittedDateQuery } from './queries';
/**
 * get environment variable
 */
config({ path: resolve(__dirname, '../.env') });

interface IRepo {
  name: string;
  owner: string;
}

(async() => {
  /**
   * First, get user id
   */
  const userResponse = await githubQuery(userInfoQuery)
    .catch(error => console.error(`Unable to get username and id\n${error}`));
  const { login: username, id } = userResponse?.data?.viewer;

  /**
   * Second, get contributed repos
   */
  const contributedRepoQuery = createContributedRepoQuery(username);
  const repoResponse = await githubQuery(contributedRepoQuery)
    .catch(error => console.error(`Unable to get the contributed repo\n${error}`));
  const repos: IRepo[] = repoResponse?.data?.user?.repositoriesContributedTo?.nodes
    .filter(repoInfo => (!repoInfo?.isFork))
    .map(repoInfo => ({
      name: repoInfo?.name,
      owner: repoInfo?.owner?.login,
    }));

  /**
   * Third, get commit time and parse into commit-time/hour diagram
   */
  const committedTimeResponseMap = await Promise.all(
    repos.map(({name, owner}) => githubQuery(createCommittedDateQuery(id, name, owner)))
  ).catch(error => console.error(`Unable to get the commit info\n${error}`));

  if (!committedTimeResponseMap) return;

  let sunrise = 0; // 6 - 9
  let daytime = 0; // 9 - 18
  let sunsets = 0; // 18 - 21
  let evening = 0; //21 - 24
  let night = 0; // 0 - 6


  committedTimeResponseMap.forEach(committedTimeResponse => {
    committedTimeResponse?.data?.repository?.defaultBranchRef?.target?.history?.edges.forEach(edge => {
      const committedDate = edge?.node?.committedDate;
      const timeString = new Date(committedDate).toLocaleTimeString('en-US', { hour12: false, timeZone: process.env.TIMEZONE });
      const hour = +(timeString.split(':')[0]);

      /**
       * voting and counting
       */
      if (hour >= 6 && hour < 9) sunrise++;
      if (hour >= 9 && hour < 18) daytime++;
      if (hour >= 18 && hour < 21) sunsets++;
      if (hour >= 21 && hour < 24) evening++;
      if (hour >= 0 && hour < 6) night++;
    });
  });

  /**
   * Next, generate diagram
   */
  const sum = sunrise + daytime + sunsets + evening + night;
  if (!sum) return;

  const oneDay = [
    { label: '🌄 Sunrise', commits: sunrise },
    { label: '🌇 Daytime', commits: daytime },
    { label: '🌆 Sunsets', commits: sunsets },
    { label: '🌃 Evening', commits: evening },
    { label: '🌌 Night', commits: night },
  ];

  const lines = oneDay.reduce((prev, cur) => {
    const percent = cur.commits / sum * 100;
    const line = [
      `${cur.label}`.padEnd(10),
      `${cur.commits.toString().padStart(5)} commits`.padEnd(14),
      generateBarChart(percent, 21),
      String(percent.toFixed(1)).padStart(5) + '%',
    ];

    return [...prev, line.join(' ')];
  }, []);

  /**
   * Finally, write into gist
   */
  const octokit = new Octokit({ auth: `token ${process.env.GH_TOKEN}` });
  const gist = await octokit.gists.get({
    gist_id: process.env.GIST_ID
  }).catch(error => console.error(`Unable to update gist\n${error}`));
  if (!gist) return;

  const filename = Object.keys(gist.data.files)[0];
  await octokit.gists.update({
    gist_id: process.env.GIST_ID,
    files: {
      [filename]: {
        // eslint-disable-next-line quotes
        filename: (sunrise + daytime) > (sunsets + evening + night) ? "🐤 I'm an early chicken" : "🦉 I'm a night owl",
        content: lines.join('\n'),
      },
    },
  });
})();
