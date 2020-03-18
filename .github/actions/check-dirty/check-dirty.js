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
      // merge-info preview causes mergeable to become "UNKNOW" (from "CONFLICTING")
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

    const info = message =>
      core.info(`for PR "${pullRequest.title}": ${message}`);

    switch (pullRequest.mergeable) {
      case "CONFLICTING":
        info(`add "${dirtyLabel}", remove "${removeOnDirtyLabel}"`);
        // for labels PRs and issues are the same
        await Promise.all([
          addLabel(dirtyLabel, pullRequest, { client }),
          removeLabel(removeOnDirtyLabel, pullRequest, { client })
        ]);
        break;
      case "MERGEABLE":
        info(`remove "${dirtyLabel}"`);
        await removeLabel(dirtyLabel, pullRequest, { client });
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
          `unhandled mergeable state '${pullRequest.mergeable}'`
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

/**
 *
 * @param {string} label
 * @param {object} pullRequest
 * @param {object} context
 */
function addLabel(label, { number }, { client }) {
  return client.issues
    .addLabels({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: number,
      labels: [label]
    })
    .catch(error => {
      core.error(`error adding "${label}": ${error}`);
    });
}

/**
 *
 * @param {string} label
 * @param {object} pullRequest
 * @param {object} context
 */
function removeLabel(label, { number }, { client }) {
  return client.issues
    .removeLabel({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: number,
      name: dirtyLabel
    })
    .catch(error => {
      core.error(`error removing "${label}": ${error}`);
    });
}

main().catch(error => {
  core.error(String(error));
  core.setFailed(String(error.message));
});
