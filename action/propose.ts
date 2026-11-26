import { runAction } from '../src/lib/ci/github';

runAction(process.env).catch((error) => {
  console.log(`::error::${error.message.replaceAll('\n', '%0A')}`);
  process.exit(1);
});
