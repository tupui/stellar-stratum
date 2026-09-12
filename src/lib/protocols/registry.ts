/**
 * Registry of the DeFi protocols this app knows how to read.
 *
 * Addresses are pinned so an imported transaction can be identified with zero
 * network access (the air-gapped signer depends on this). Function signatures
 * mirror the deployed contract specs, so an unknown deployment of a known
 * interface can still be recognised — as a weaker "likely" match.
 */

export type ProtocolId = 'soroswap' | 'defindex';

export type NetworkId = 'mainnet' | 'testnet';

/** What the call ultimately does to the signer's funds. */
export type Intent =
  | 'swap'
  | 'add-liquidity'
  | 'remove-liquidity'
  | 'vault-deposit'
  | 'vault-withdraw'
  | 'admin';

export interface ProtocolContract {
  protocol: ProtocolId;
  /** Human label for this deployment, e.g. "Router". */
  role: string;
  address: string;
  network: NetworkId;
}

export const PROTOCOL_LABELS: Record<ProtocolId, string> = {
  soroswap: 'Soroswap',
  defindex: 'DeFindex',
};

/**
 * Pinned deployments. Soroswap addresses come from
 * `GET https://api.soroswap.finance/api/{network}/{router|aggregator|factory}`;
 * DeFindex from `GET https://api.defindex.io/factory/address`.
 */
export const KNOWN_CONTRACTS: ProtocolContract[] = [
  // Soroswap — mainnet
  { protocol: 'soroswap', role: 'Router', address: 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH', network: 'mainnet' },
  { protocol: 'soroswap', role: 'Aggregator', address: 'CAYP3UWLJM7ZPTUKL6R6BFGTRWLZ46LRKOXTERI2K6BIJAWGYY62TXTO', network: 'mainnet' },
  { protocol: 'soroswap', role: 'Factory', address: 'CA4HEQTL2WPEUYKYKCDOHCDNIV4QHNJ7EL4J4NQ6VADP7SYHVRYZ7AW2', network: 'mainnet' },
  // Soroswap — testnet
  { protocol: 'soroswap', role: 'Router', address: 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD', network: 'testnet' },
  { protocol: 'soroswap', role: 'Aggregator', address: 'CC74XDT7UVLUZCELKBIYXFYIX6A6LGPWURJVUXGRPQO745RWX7WEURMA', network: 'testnet' },
  { protocol: 'soroswap', role: 'Factory', address: 'CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY', network: 'testnet' },
  // DeFindex — mainnet
  { protocol: 'defindex', role: 'Vault Factory', address: 'CDKFHFJIET3A73A2YN4KV7NSV32S6YGQMUFH3DNJXLBWL4SKEGVRNFKI', network: 'mainnet' },
  { protocol: 'defindex', role: 'Vault', address: 'CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK', network: 'mainnet' },
];

export interface FunctionSignature {
  protocol: ProtocolId;
  /** Contract role that exposes this entry point. */
  role: string;
  name: string;
  /** Parameter names in declaration order, matching the on-chain spec. */
  params: string[];
  intent: Intent;
  /** Short verb shown in the summary, e.g. "Swap". */
  action: string;
}

/**
 * Entry points we can read. Parameter names/order come from the deployed WASM
 * specs, so positional decoding below stays honest.
 */
export const KNOWN_FUNCTIONS: FunctionSignature[] = [
  {
    protocol: 'soroswap',
    role: 'Router',
    name: 'swap_exact_tokens_for_tokens',
    params: ['amount_in', 'amount_out_min', 'path', 'to', 'deadline'],
    intent: 'swap',
    action: 'Swap',
  },
  {
    protocol: 'soroswap',
    role: 'Router',
    name: 'swap_tokens_for_exact_tokens',
    params: ['amount_out', 'amount_in_max', 'path', 'to', 'deadline'],
    intent: 'swap',
    action: 'Swap',
  },
  {
    protocol: 'soroswap',
    role: 'Aggregator',
    name: 'swap_exact_tokens_for_tokens',
    params: ['token_in', 'token_out', 'amount_in', 'amount_out_min', 'distribution', 'to', 'deadline'],
    intent: 'swap',
    action: 'Swap',
  },
  {
    protocol: 'soroswap',
    role: 'Aggregator',
    name: 'swap_tokens_for_exact_tokens',
    params: ['token_in', 'token_out', 'amount_out', 'amount_in_max', 'distribution', 'to', 'deadline'],
    intent: 'swap',
    action: 'Swap',
  },
  {
    protocol: 'soroswap',
    role: 'Router',
    name: 'add_liquidity',
    params: ['token_a', 'token_b', 'amount_a_desired', 'amount_b_desired', 'amount_a_min', 'amount_b_min', 'to', 'deadline'],
    intent: 'add-liquidity',
    action: 'Add liquidity',
  },
  {
    protocol: 'soroswap',
    role: 'Router',
    name: 'remove_liquidity',
    params: ['token_a', 'token_b', 'liquidity', 'amount_a_min', 'amount_b_min', 'to', 'deadline'],
    intent: 'remove-liquidity',
    action: 'Remove liquidity',
  },
  {
    protocol: 'defindex',
    role: 'Vault',
    name: 'deposit',
    params: ['amounts_desired', 'amounts_min', 'from', 'invest'],
    intent: 'vault-deposit',
    action: 'Vault deposit',
  },
  {
    protocol: 'defindex',
    role: 'Vault',
    name: 'withdraw',
    params: ['withdraw_shares', 'min_amounts_out', 'from'],
    intent: 'vault-withdraw',
    action: 'Vault withdraw',
  },
  {
    protocol: 'defindex',
    role: 'Vault Factory',
    name: 'create_defindex_vault',
    params: ['roles', 'vault_fee', 'assets', 'soroswap_router', 'name_symbol', 'upgradable'],
    intent: 'admin',
    action: 'Create vault',
  },
  {
    protocol: 'defindex',
    role: 'Vault Factory',
    name: 'create_defindex_vault_deposit',
    // Not `vault-deposit`: the vault is created by this call, so there is no
    // vault address or asset list to describe the amounts against yet.
    params: ['caller', 'roles', 'vault_fee', 'assets', 'soroswap_router', 'name_symbol', 'upgradable', 'amounts'],
    intent: 'admin',
    action: 'Create vault & deposit',
  },
];

const addressIndex = new Map(
  KNOWN_CONTRACTS.map((c) => [`${c.network}:${c.address}`, c] as const),
);

export const findKnownContract = (
  address: string,
  network: NetworkId,
): ProtocolContract | undefined => addressIndex.get(`${network}:${address}`);

/** Every deployment we know of, regardless of network — used for cross-network warnings. */
export const findContractAnyNetwork = (address: string): ProtocolContract | undefined =>
  KNOWN_CONTRACTS.find((c) => c.address === address);

export interface KnownVault {
  address: string;
  network: NetworkId;
  name: string;
  /** Underlying asset contracts, in the order the vault's `amounts` vectors use. */
  assets: string[];
}

/**
 * Vaults we can describe without a network round-trip. Any other vault is
 * resolved at runtime through the DeFindex API when the signer is online.
 */
export const KNOWN_VAULTS: KnownVault[] = [
  {
    address: 'CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK',
    network: 'mainnet',
    name: 'Soroswap USDC Vault',
    assets: ['CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'],
  },
];

export const findKnownVault = (address: string, network: NetworkId): KnownVault | undefined =>
  KNOWN_VAULTS.find((v) => v.address === address && v.network === network);
