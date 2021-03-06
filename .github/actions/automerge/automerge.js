const core = require("@actions/core");
const github = require("@actions/github");

function main() {
  const repoToken = core.getInput("repoToken", { required: true });
  const dirtyLabel = core.getInput("dirtyLabel", { required: true });
  const failedLabel = core.getInput("failedLabel", { required: true });
  const mergeLabel = core.getInput("mergeLabel", { required: true });
  const mergeMethod = core.getInput("mergeMethod", { required: true });

  const client = new github.GitHub(repoToken);

  return automerge({
    client,
    failedLabel,
    mergeLabel,
    mergeMethod,
    page: 0
  });
}

/**
 *
 * @param {object} context
 * @param {import('@actions/github').GitHub} context.client
 */
async function automerge(context) {
  const { client, failedLabel, mergeLabel, mergeMethod, page } = context;

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
      `found issue: ${pullRequest.title} last updated ${pullRequest.updated_at}`
    );

    const labelNames = pullRequest.labels.map(label => label.name);
    const isReady = labelNames.includes(mergeLabel);

    core.info(
      `pr is ${
        isReady ? "ready" : "not ready"
      } because ([${labelNames}].includes('${mergeLabel}')) === ${isReady}`
    );

    if (isReady) {
      if (pullRequest.mergeable_state === "clean") {
        await client.pulls.merge({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          pull_number: pullRequest.number,
          commit_title: pullRequest.title,
          merge_method: mergeMethod
        });
      } else if (pullRequest.mergeable_state === "dirty") {
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
      } else {
        // for labels PRs and issues are the same
        await Promise.all([
          client.issues.addLabels({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: pullRequest.number,
            labels: [failedLabel]
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
  }

  return automerge({ ...context, page: page + 1 });
}

main().catch(error => {
  core.error(String(error));
  core.setFailed(String(error.message));
});
