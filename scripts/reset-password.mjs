import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { findAccount, updateAccountCredentials } from '../server/auth.mjs';

const username = process.argv[2];
if (!username) {
  console.error('Usage: npm run reset-password -- <username>');
  process.exit(2);
}

const account = findAccount(username);
if (!account) {
  console.error(`No local account was found for "${username}".`);
  process.exit(1);
}

const terminal = createInterface({ input: stdin, output: stdout });
try {
  const password = await terminal.question('New password (at least 8 characters; input is visible): ');
  const confirmation = await terminal.question('Confirm new password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  updateAccountCredentials({ userId: account.user_id, username: account.username, password });
  console.log('Password updated. The user must sign in again on each device.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  terminal.close();
}
