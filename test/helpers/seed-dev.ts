const isReset = process.argv.includes('--reset');
const mode = isReset ? 'reset' : 'dev';

console.log(`[seed-${mode}] stub — real seed implementation lands in a later story.`);
console.log(`[seed-${mode}] See _bmad-output/implementation-artifacts/sprint-status.yaml for the current backlog.`);

process.exit(0);
