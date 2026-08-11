# P10 failed attempt: shared clone alternates on Windows

- Date: 2026-08-11
- Gate: exact SDAR source intake
- Result: failed as observed

`git clone --shared` produced an unusable Windows alternates/object path and
failed with `unable to open .git/objects/a9`. Only that temporary clone was
removed. A normal local clone was used, verified at exact commit
`a9957c82c17ca01e77528f3817c03d86224aaf88`, and remained clean.
