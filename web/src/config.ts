import {
  createPublicClient,
  custom,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: {
      poolManager: Address;
      universalRouter: Address;
      quoter: Address;
      stateView: Address;
      positionManager: Address;
      permit2: Address;
    };
  };
  walletAddChain: {
    chainId: `0x${string}`;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: { pairedCurrency: Address; fee: number; tickSpacing: number };
  token: { name: string; symbol: string; decimals: number; contract: string };
  deploymentBlock: number;
};
export type Config = {
  deployment: Deployment;
  abis: Record<string, Abi>;
  hook: Deployment["contracts"][number];
  token: Deployment["contracts"][number];
};
export function canonical(v: unknown): string {
  return JSON.stringify(sort(v));
}
function sort(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
        )
      : v;
}
export const abiHash = (abi: unknown) =>
  keccak256(toHex(canonical(abi))).slice(2);
export const safePath = (p: string) =>
  /^(?!\/)[a-zA-Z0-9_./-]+$/.test(p) &&
  !p.split("/").some((x) => x === ".." || x === "." || x === "");
export async function loadConfig(): Promise<Config> {
  const get = async (p: string) => {
    const r = await fetch(new URL(p, document.baseURI), { cache: "no-cache" });
    if (!r.ok) throw Error(`Could not load ${p}. Reload to retry.`);
    return r.json();
  };
  const d: Deployment = await get("imd-deployment.json");
  if (
    d.version !== 1 ||
    d.chainId !== d.network?.chainId ||
    Number(d.walletAddChain?.chainId) !== d.chainId ||
    !d.contracts?.length ||
    !d.network.rpcUrls.length
  )
    throw Error(
      "Deployment configuration is inconsistent. Transactions are disabled.",
    );
  const abis: Record<string, Abi> = {};
  for (const c of d.contracts) {
    if (
      !isAddress(c.address) ||
      !safePath(c.abiPath) ||
      !d.assets.some((a) => a.path === c.abiPath)
    )
      throw Error("Invalid contract configuration.");
    const abi = await get(c.abiPath);
    if (!Array.isArray(abi) || abiHash(abi) !== c.abiHash)
      throw Error(
        `ABI verification failed for ${c.name}. Transactions are disabled.`,
      );
    abis[c.name] = abi;
  }
  const hook = d.contracts.find((c) => c.name === "SwapTipHook"),
    token = d.contracts.find((c) => c.name === d.token.contract);
  if (
    !hook ||
    !token ||
    Object.values(d.network.uniswapV4).some((a) => !isAddress(a))
  )
    throw Error("Missing deployment contracts.");
  return { deployment: d, abis, hook, token };
}
export const poolTuple =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export const protocolAbi = {
  stateView: parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  ]),
  quoter: parseAbi([
    `function quoteExactInputSingle((${poolTuple} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
  ]),
  router: parseAbi([
    "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
    "error ExecutionFailed(uint256 commandIndex,bytes message)",
    "error V4TooLittleReceived(uint256 minAmountOutReceived,uint256 amountReceived)",
  ]),
  permit2: parseAbi([
    "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
    "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  ]),
};
export function chainFor(c: Config) {
  const d = c.deployment;
  return defineChain({
    id: d.chainId,
    name: d.network.name,
    nativeCurrency: d.network.nativeCurrency,
    rpcUrls: { default: { http: d.network.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: d.network.explorer } },
    testnet: d.network.testnet,
  });
}
export function clientFor(c: Config, provider?: EIP1193Provider) {
  const transports = c.deployment.network.rpcUrls.map((url) =>
    http(url, { timeout: 8000, retryCount: 0 }),
  );
  return createPublicClient({
    chain: chainFor(c),
    transport: fallback(
      [
        ...transports,
        ...(provider
          ? [
              custom(
                {
                  request: async (args) => {
                    if (
                      Number(
                        await provider.request({ method: "eth_chainId" }),
                      ) !== c.deployment.chainId
                    )
                      throw Error("Wallet is on the wrong network.");
                    return provider.request(args);
                  },
                },
                { retryCount: 0 },
              ),
            ]
          : []),
      ],
      { retryCount: 0 },
    ),
  });
}
