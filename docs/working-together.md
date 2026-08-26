# Working in this repo alongside other sessions

Several Claude sessions work in this repository at once, in separate git worktrees. This
is the short protocol that keeps that from becoming a merge disaster. It exists because it
nearly did on 26 Aug: three sessions had edited `public/app.js` within an hour, and one had
changed the exact line another had just refactored.

## The layout

```
~/Desktop/alexandria                  main
~/Desktop/alexandria-longform         longform
~/Desktop/alexandria-visual-novel     visual-novel
```

`git worktree list` is the truth. A session's own terminal directory is not — work is often
driven into another worktree by absolute path, so a branch can be moving while nothing
appears to be sitting in it.

## Five rules

**Push.** `origin` is `punkerpunkest/alexandria`, private. Before 26 Aug there was no remote
at all and the entire project existed on one disk. Push at the end of a working session,
not at the end of a week.

**Work on a branch, not on `main`.** Every other lane branches from `main`, so committing
straight to it makes their base move underneath them. Infrastructure that everyone needs —
the fixture, the shared contract, an interface seam — is the one reasonable exception, and
it should be small, atomic, and pushed immediately so the others can pick it up.

**Merge `main` into your branch early and often.** Not at the end. The 26 Aug collision was
three commits' worth of drift and it took three files with it; the same merge a day later
would have taken far more. If your branch is more than a few commits behind, merge before
you write anything else.

**Test the merge before you need it.** `git merge-tree $(git merge-base main <branch>) main
<branch>` reports conflicts without touching anything. It is instant and it turns a surprise
into a scheduled piece of work.

**Resolve your own conflicts.** Whoever owns the branch has the context for the code in it.
Do not resolve someone else's lane for them — you will pick the wrong side of a change whose
reasoning you never saw.

## Before you commit

`npm run check-fixture` must pass. It is offline, model-free and takes milliseconds, so
there is no excuse to skip it. If it goes red and you believe the new behaviour is correct,
re-bless deliberately with `npm run capture-fixture`, read the diff, and say in the commit
message which it was: a bug you fixed, or an improvement you blessed.

Never edit a file under `fixtures/` by hand to make a test pass.

## If something goes badly wrong

`git bundle create ~/Desktop/alexandria-backup-$(date +%Y%m%d-%H%M).bundle --all` writes
every branch and all history into a single file, in seconds, with no network. Do it before
any operation you are unsure about — a rebase, a force push, a merge you expect to fight.
Restore with `git clone <bundle> <dir>`.
