// Minimal step logger for the batch agents (agent/, quote-agent/) — never
// used on the web app's request path. Prefixes each line with the pipeline
// step so 221 concurrently-running families are distinguishable in the
// `npm run seed` / `npm run quote` output.
export function log(step: string, message: string): void {
  console.log(`[${step}] ${message}`);
}
