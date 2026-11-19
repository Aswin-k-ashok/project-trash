# CLAUDE.md

## Commit messages

When asked to write a commit message:

- Write it for the **staged** changes (`git diff --cached`). If nothing is staged, say so and ask which changes it should cover.
- **Never commit on your own.** Do not run `git commit`, `git add` or `git push`. Stop once the message is written; the user makes the commit.
- Give the message in the reply, ready to copy. Don't save it to a file unless asked.
- Match the repo's existing style: Conventional Commits (`feat:`, `fix:`, `chore:`, ...), a short imperative subject line, then a body saying what changed and why.
