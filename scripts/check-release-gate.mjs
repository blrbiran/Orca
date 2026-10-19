// Spec 2026-10-20 §4.2 (human ruling, session f3a75a90): the full gate runs only when the human asked for a tagged
// release. The first step of `npm run verify`; it refuses on its own, without asking anyone, and names the command to
// run instead. Honour-based by design: the agent told to tag sets ORCA_RELEASE_TAG, and nothing reaches the human.
if (!process.env.ORCA_RELEASE_TAG) {
  console.error(
    "verify is the release gate: run it only when the human asked for a tagged release (ORCA_RELEASE_TAG=<tag> npm run verify). For iterations, fix rounds, merges, push or installing the panel service run: npm test",
  );
  process.exit(2);
}
console.log(`release gate: ${process.env.ORCA_RELEASE_TAG}`);
