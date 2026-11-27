import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FormValues } from '../contract/form-values';
import { proposeSigning, stratumLink, type Proposal, type ProposeRequest } from './propose';

type Input = (name: string) => string;

const choice = <T extends string>(input: Input, name: string, options: readonly T[]): T => {
  const value = options.find((option) => option === input(name));
  if (!value) throw new Error(`The ${name} must be one of ${options.join(', ')}.`);
  return value;
};

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
};

const argsOf = (input: Input): FormValues | undefined => (input('args') ? JSON.parse(input('args')) : undefined);

export const readRequest = (input: Input): ProposeRequest => {
  const shared = {
    sourceAccount: input('source-account'),
    network: choice(input, 'network', ['testnet', 'mainnet']),
    signingKey: input('signing-key') || undefined,
  };
  const operation = choice(input, 'operation', ['upload', 'deploy', 'call']);
  if (operation === 'call') {
    return { ...shared, kind: operation, contractId: input('contract'), method: input('method'), args: argsOf(input) };
  }
  const wasm = readFileSync(input('wasm'));
  return operation === 'upload' ? { ...shared, kind: operation, wasm } : { ...shared, kind: operation, wasm, constructorArgs: argsOf(input) };
};

export const messageOf = (request: ProposeRequest, proposal: Proposal) => {
  const where = `Transaction for \`${request.sourceAccount}\` on ${request.network}`;
  if (proposal.stored) {
    const status = proposal.signed
      ? `is signed by the CI (${proposal.signed.weight} of ${proposal.signed.threshold}) and waits for the human signature`
      : 'is waiting for signatures';
    return `${where} ${status}: [Review and sign in Stratum](${stratumLink(proposal)}).`;
  }
  return (
    `${where} is too large for Refractor. Download the artifact from this run, open ` +
    `[Stratum](${stratumLink(proposal)}), choose Import in the transaction builder and paste the XDR. ` +
    `Stratum should show the transaction hash \`${proposal.hash}\`.`
  );
};

const saveArtifact = ({ hash, xdr }: Proposal, env: NodeJS.ProcessEnv) => {
  const directory = join(env.RUNNER_TEMP ?? tmpdir(), 'stratum');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `stratum-${hash}.xdr`);
  writeFileSync(path, xdr);
  return path;
};

const pullRequestNumber = (env: NodeJS.ProcessEnv): number => {
  const event: { pull_request?: { number: number } } = JSON.parse(readFileSync(required(env, 'GITHUB_EVENT_PATH'), 'utf8'));
  if (!event.pull_request) throw new Error('The comment is for a pull request but this run is not one.');
  return event.pull_request.number;
};

const postComment = async (target: 'pr' | 'commit', token: string, body: string, env: NodeJS.ProcessEnv) => {
  const path = target === 'pr' ? `issues/${pullRequestNumber(env)}` : `commits/${env.GITHUB_SHA}`;
  const response = await fetch(`${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/${path}/comments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} when posting the comment.`);
};

/** Runs the GitHub Action: reads its inputs from the environment and reports the result back. */
export const runAction = async (env: NodeJS.ProcessEnv) => {
  const input: Input = (name) => (env[`INPUT_${name.toUpperCase()}`] ?? '').trim();
  if (input('signing-key')) console.log(`::add-mask::${input('signing-key')}`);
  const comment = choice(input, 'comment', ['none', 'pr', 'commit']);
  const token = input('github-token');
  if (comment !== 'none' && !token) throw new Error('A github-token is needed to comment.');

  const request = readRequest(input);
  const proposal = await proposeSigning(request);
  const message = messageOf(request, proposal);

  const outputs = {
    'refractor-id': proposal.stored ? proposal.hash : '',
    'stratum-link': stratumLink(proposal),
    'artifact-path': proposal.stored ? '' : saveArtifact(proposal, env),
  };
  appendFileSync(required(env, 'GITHUB_OUTPUT'), Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join(''));
  appendFileSync(required(env, 'GITHUB_STEP_SUMMARY'), `${message}\n`);
  if (comment !== 'none') await postComment(comment, token, message, env);
  console.log(message);
};
