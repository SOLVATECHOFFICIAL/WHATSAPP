---
name: GitHub release target
description: The user expects code changes pushed to GitHub and does not want Replit publishing.
---

For this project, the user wants code changes pushed to GitHub, not published or deployed to Replit. Verify the remote branch SHA before claiming a push. If GitHub authentication blocks the push, report that clearly so the user can push manually; do not substitute a Replit publish.

**Why:** the user repeatedly asked for GitHub pushes rather than Replit publishing and asked to be told if a push cannot be completed. An attached GitHub integration reported healthy but did not authenticate the shell push.

GitHub's Replit integration may report healthy or already attached while the workspace Git CLI still rejects pushes. Treat only a successful push plus a matching remote SHA as proof of delivery; do not ask the user to paste credentials.

**How to apply:** After code changes, push to GitHub when possible and verify the remote commit. If authentication still fails after the available connection flow, keep the local commit and report the exact local and remote state. Never claim an unverified local commit is pushed.
