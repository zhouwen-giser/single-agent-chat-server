# P10 failed attempt: repeated Skill Goal identifier

- Date: 2026-08-11
- Gate: repeated real Task creation
- Result: failed as observed

A constant fixture Skill Goal ID collided with `skill_goal_pkey` on the next
Task. The model fixture now derives the identifier from the current Goal ID,
preserving uniqueness without changing SDAR state directly.
