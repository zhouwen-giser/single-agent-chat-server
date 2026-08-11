# P00 execution baseline

The execution baseline is the merged v0.1 product tree plus the authorized v0.2
task package. PR #1 was squash-merged into `main` as `6a159aa87883568c96f7190c211150843a4d8ad4`.
The merged tree, the previous acceptance publication tree, and retained-branch
HEAD tree are byte-identical: `bd047752f44acf7fd4028bfa77916752f705d019`.

The retained branch was connected to merged `main` using ordinary non-ff merge
commit `0a3cace9ce92166c7aa8d23f8ba96694cf6b6278`. No history rewrite or force push
was performed. The remote branch had already been deleted by the PR merge.

The user explicitly authorized development on the current branch and final
delivery as a pull request to `main`. This overrides the task package's new
branch, waiting, and automatic-merge mechanics only. The PR must not be merged
by this execution.
