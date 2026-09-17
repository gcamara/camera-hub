// Submits an EAS build to App Store Connect with the ASC API key taken from the environment
// (EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID). `eas submit --non-interactive`
// only reads the key from eas.json, and the key identifiers must not live in a public repo,
// so they are written into eas.json for the duration of the command and removed afterwards.
//   node scripts/eas-submit.mjs --latest          node scripts/eas-submit.mjs --id <build id>
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const required = ['EXPO_ASC_API_KEY_PATH', 'EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} first.`);
  process.exit(1);
}

const original = readFileSync('eas.json', 'utf8');
const config = JSON.parse(original);
config.submit.production.ios = {
  ...config.submit.production.ios,
  ascApiKeyPath: process.env.EXPO_ASC_API_KEY_PATH,
  ascApiKeyId: process.env.EXPO_ASC_KEY_ID,
  ascApiKeyIssuerId: process.env.EXPO_ASC_ISSUER_ID,
};
writeFileSync('eas.json', JSON.stringify(config, null, 2) + '\n');

let status = 1;
try {
  const args = ['eas-cli', 'submit', '--platform', 'ios', '--profile', 'production', '--non-interactive', '--no-wait', ...process.argv.slice(2)];
  status = spawnSync('npx', args, { stdio: 'inherit', shell: true }).status ?? 1;
} finally {
  writeFileSync('eas.json', original);
}
process.exit(status);
