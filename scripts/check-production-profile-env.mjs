import { productionProfilePolicy } from './production-profile-policy.mjs';

const result = productionProfilePolicy(process.env);
if (result.errors.length > 0) {
  process.stderr.write(`${result.errors.join('\n')}\n`);
  process.exitCode = 1;
}
