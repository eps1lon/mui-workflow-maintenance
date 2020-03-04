const core = require("@actions/core");
const github = require("@actions/github");

function main() {
  const repoToken = core.getInput("repoToken", { required: true });
  const dirtyLabel = core.getInput("dirtyLabel", { required: true });
  const removeOnDirtyLabel = core.getInput("removeOnDirtyLabel", { required: true });

  const client = new github.GitHub(repoToken);

  return checkDirty({
    client,
    dirtyLabel,
    removeOnDirtyLabel,
    page: 0
  });
}

/**
 *
 * @param {object} context
 * @param {import('@actions/github').GitHub} context.client
 */
async function checkDirty(context) {
  const { client, dirtyLabel, removeOnDirtyLabel, page } = context;

  const pullsResponse = await client.pulls.list({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    state: "open",
    per_page: 100,
    page
  });

  if (pullsResponse.data.length === 0) {
    return;
  }

  for (const pullRequest of pullsResponse.data.values()) {
    core.info(
      `found pr: ${pullRequest.title} last updated ${pullRequest.updated_at}`
    );

    const labelNames = pullRequest.labels.map(label => label.name);
    const isReady = labelNames.includes(mergeLabel);

    core.info(`pr's mergable state is ${pullRequest.mergeable_state}`);
    if (pullRequest.mergeable_state === "dirty") {
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
          name: mergeLabel
        })
      ]);
    }
  }

  return checkDirty({ ...context, page: page + 1 });
}

main().catch(error => {
  core.error(String(error));
  core.setFailed(String(error.message));
});
