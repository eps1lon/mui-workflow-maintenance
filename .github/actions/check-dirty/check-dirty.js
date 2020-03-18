const core = require("@actions/core");
const github = require("@actions/github");

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
      // merge-info preview causes mergable to become "UNKNOW" (from "CONFLICTING")
      // kind of obvious to no rely on experimental features but...yeah
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
  core.debug(JSON.stringify(pullsResponse, null, 2));

  if (pullRequests.length === 0) {
    return;
  }

  for (const pullRequest of pullRequests) {
    core.debug(JSON.stringify(pullRequest, null, 2));

    const info = message => core.info(`for PR "${pullRequest.title}"`);

    switch (pullRequest.mergable) {
      case "CONFLICTING":
        info(`add "${dirtyLabel}", remove "${removeOnDirtyLabel}"`);
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
        break;
      case "MERGEABLE":
        info(`remove "${dirtyLabel}"`);
        await Promise.all([
          client.issues.removeLabel({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: pullRequest.number,
            name: dirtyLabel
          })
        ]);
        // while we removed a particular label once we enter "CONFLICTING"
        // we don't add it again because we assume that the removeOnDirtyLabel
        // is used to mark a PR as "merge!".
        // So we basically require a manual review pass after rebase.
        break;
      case "UNKNOWN":
        info(`do nothing`);
        break;
      default:
        throw new TypeError(
          `unhandled mergable state '${pullRequest.mergable}'`
        );
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
