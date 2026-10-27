# Project conventions

## Code comments

- Comments are **English only**.
- Comment **what the code does**, in the shortest form that stays readable. No narration of the development process: no bug-fix stories, no "fixed / now works / previously" notes, no TODO-as-comment about past mistakes, no explanations of why a line exists.
- Keep comments on their own line above the thing they describe. Use a doc comment (`/** ... */`, one or two sentences) for exported classes, functions and interface fields; use a short `//` line comment only to mark a distinct block of logic.
- Voice: doc comments describe the thing they document ("Merges the panel meshes into one simulation input"); inline block comments use an imperative or noun phrase ("Merge panels into one simulation input").
- Do not restate the code. `// increment counter` above `counter++` is noise; a name that already says what it does needs no comment.
- Prefer clearer code over a longer comment. If a comment is needed to explain confusing logic, simplify the code instead.
- Never translate or rewrite user-facing UI strings; the product interface is Chinese.
- WGSL/GLSL shader source and Chinese UI literals are code, not comments — leave them untouched.
