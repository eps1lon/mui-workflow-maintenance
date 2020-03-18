const core = require("@actions/core");
const github = require("@actions/github");
const { graphql } = require("@octokit/graphql");

async function main() {
  const repoToken = core.getInput("repoToken", { required: true });
  const dirtyLabel = core.getInput("dirtyLabel", { required: true });
  const removeOnDirtyLabel = core.getInput("removeOnDirtyLabel", {
    required: true
  });

  const client = new github.GitHub(repoToken);

  return await checkDirty({
    client,
    dirtyLabel,
    removeOnDirtyLabel,
    after: null
  });
}

/**
 *
 * @param {object} context
 * @param {import('@actions/github').GitHub} context.client
 */
async function checkDirty(context) {
  const { after, client, dirtyLabel, removeOnDirtyLabel } = context;

  // mergeStateStatus is includede for experimenting
  // it's unclear if a pr can have mergeStateStatus=dirty AND mergable!=MERGABLE
  const query = `
query openPullRequests($owner: String!, $repo: String!, $after: String) { 
  repository(owner:$owner, name: $repo) { 
    pullRequests(first:100, after:$after, states: OPEN) {
      nodes {
        mergeable
        number
        permalink
        title
        updatedAt
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
    
  }
}
  `;
  core.debug(query);
  const pullsResponse = await client.graphql(query, {
    headers: {
      //accept: "application/vnd.github.merge-info-preview+json"
    },
    after,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo
  });

  const {
    repository: {
      pullRequests: { nodes: pullRequests, pageInfo }
    }
  } = pullsResponse;
  // JSON.stringify might be expensive
  if (core.isDebug) {
    core.debug(JSON.stringify(pullsResponse, null, 2));
  }

  if (pullRequests.length === 0) {
    return;
  }

  for (const pullRequest of pullRequests) {
    const isMergable = pullRequest.mergable === "MERGABLE";
    core.info(
      `PR "${pullRequest.title}" ${
        !isMergable ? "is not mergable" : "is mergable"
      }`
    );

    if (!isMergable) {
      // for labels PRs and issues are the same
      await Promise.all([
        client.issues.addLabels({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: pullRequest.number,
          labels: [dirtyLabel]
        }),
        client.issues.removeLabel({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: pullRequest.number,
          name: removeOnDirtyLabel
        })
      ]);
    }
  }

  if (pageInfo.hasNextPage) {
    return checkDirty({
      ...context,
      after: pageInfo.endCursor
    });
  }
}

main().catch(error => {
  core.error(String(error));
  core.setFailed(String(error.message));
});
