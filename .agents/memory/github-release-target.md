---
name: GitHub release target
description: The user expects code changes pushed to GitHub and does not want Replit publishing.
---

For this project, the user wants code changes pushed to GitHub, not published or deployed to Replit. Verify the remote branch SHA before claiming a push. If GitHub authentication blocks the push, report that clearly so the user can push manually; do not substitute a Replit publish.

**Why:** the user repeatedly asked for GitHub pushes rather than Replit publishing and asked to be told if a push cannot be completed.

**How to apply:** After code changes, push to GitHub when possible and verify the remote commit. Never claim an unverified local commit is pushed.
