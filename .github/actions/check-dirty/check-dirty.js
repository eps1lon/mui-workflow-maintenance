const core = require("@actions/core");
const github = require("@actions/github");

function main() {
  const repoToken = core.getInput("repoToken", { required: true });
  const dirtyLabel = core.getInput("dirtyLabel", { required: true });
  const removeOnDirtyLabel = core.getInput("removeOnDirtyLabel", {
    required: true
  });

  const client = new github.GitHub(repoToken);

  return checkDirty({
    client,
    dirtyLabel,
    removeOnDirtyLabel,
    endCursor: null
  });
}

/**
 *
 * @param {object} context
 * @param {import('@actions/github').GitHub} context.client
 */
async function checkDirty(context) {
  const { client, dirtyLabel, removeOnDirtyLabel, endCursor } = context;

  const query = `
query { 
  repository(owner:"${github.context.repo.owner}", name: "${github.context.repo.repo}") { 
    pullRequests(first:100, after:${endCursor}, states: OPEN) {
      nodes {
        mergeStateStatus
        number
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
  core.info(query);
  const pullsResponse = await client.graphql(query, {
    mediaType: { previews: ["merge-info-preview"] }
  });

  core.info(pullsResponse);

  if (pullsResponse.data.length === 0) {
    return;
  }

  for (const pullRequest of pullsResponse.data.values()) {
    core.info(
      `found pr: ${pullRequest.title} last updated ${pullRequest.updatedAt}`
    );

    core.info(Object.keys(pullRequest));
    core.info(`pr's mergable state is ${pullRequest.mergeStateStatus}`);
    if (pullRequest.mergeStateStatus === "DIRTY") {
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

  return checkDirty({
    ...context,
    endCursor: pullsResponse.data.pageInfo.endCursor
  });
}

main().catch(error => {
  core.error(String(error));
  core.setFailed(String(error.message));
});
