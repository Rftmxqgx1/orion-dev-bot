const { Octokit } = require("@octokit/rest")

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

async function createJobBranch(taskText) {
    const branchName = `job/${Date.now()}`

    const repo = {
        owner: process.env.REPO_OWNER,
        repo: process.env.REPO_NAME
    }

    const { data: refData } = await octokit.git.getRef({
        ...repo,
        ref: "heads/main"
    })

    await octokit.git.createRef({
        ...repo,
        ref: `refs/heads/${branchName}`,
        sha: refData.object.sha
    })

    // Trigger GitHub Action via repository_dispatch
    await octokit.repos.createDispatchEvent({
        ...repo,
        event_type: "run-agent",
        client_payload: { branch: branchName, task: taskText }
    })

    return branchName
}

module.exports = { createJobBranch }
