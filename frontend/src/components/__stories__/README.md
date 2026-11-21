# Component workbench

**The workbench exists** (F-09, [ADR-0004](../../../../docs/adr/0004-component-workbench.md)).
Storybook with `@storybook/react-vite`:

```bash
npm run storybook        # dev, :6006
npm run build-storybook  # static build
```

Stories are **colocated** next to their component as `Component.stories.tsx`,
not collected in this directory — §8.2.4's "one component, one file, colocated
tests/stories". This directory is kept only for this note.

`FRONTEND_ARCHITECTURE.md` §8.2.4 makes a story the acceptance artifact for a
Tier 1–2 component, covering:

1. Every variant × size matrix.
2. Every interaction state, light + dark (the toolbar's Theme switch).
3. Loading / disabled / error states where applicable.
4. Reduced-motion rendering.

Two conventions worth keeping, both visible in `Button.stories.tsx`:

- **Generate matrices from the type, never a hand-written list.** A hand-listed
  set silently omits the variant added last week, which is how a workbench
  stops being an acceptance artifact.
- **Name what a story cannot assert.** Hover and focus need a pointer and a
  Tab key; say so in the story rather than leaving a reader to assume the
  matrix is complete.

Five of about forty-five components have stories so far. Add one when you next
touch a component, against the pattern those five set.
