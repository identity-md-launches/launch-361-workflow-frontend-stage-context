import {
  createWalletClient,
  custom,
  formatUnits,
  parseAbiItem,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { chainFor, clientFor, protocolAbi, type Config } from "./config";
import {
  hookData,
  minimumOut,
  poolId,
  poolKey,
  swapArguments,
  type TipEvent,
  type Trade,
} from "./domain";
export type Provider = EIP1193Provider & {
  on?: (event: string, handler: (value: unknown) => void) => void;
  removeListener?: (event: string, handler: (value: unknown) => void) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export async function switchChain(c: Config, p: Provider) {
  const chainId = c.deployment.walletAddChain.chainId;
  try {
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    const e = error as { code?: number; message?: string };
    if (
      e.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(e.message ?? "")
    )
      throw error;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [c.deployment.walletAddChain],
    });
    await p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
}
export type Snapshot = {
  block: bigint;
  total: bigint;
  claimable: bigint;
  tipped: bigint;
  received: bigint;
  tokenBalance: bigint;
  ethBalance: bigint;
  decimals: number;
  symbol: string;
  price: number;
  liquidity: bigint;
  allowance: bigint;
  permitAmount: bigint;
  permitExpiry: number;
  timestamp: number;
};
export async function snapshot(
  c: Config,
  account?: Address,
  p?: Provider,
): Promise<Snapshot> {
  const pc = clientFor(c, p),
    u = c.deployment.network.uniswapV4;
  if ((await pc.getChainId()) !== c.deployment.chainId)
    throw Error("RPC returned the wrong chain. Transactions are disabled.");
  const block = await pc.getBlockNumber();
  for (const [name, address] of [
    ...c.deployment.contracts.map((x) => [x.name, x.address] as const),
    ...(
      [
        "poolManager",
        "stateView",
        "quoter",
        "universalRouter",
        "permit2",
      ] as const
    ).map((k) => [k, u[k]] as const),
  ]) {
    const code = await pc.getCode({ address, blockNumber: block });
    if (!code || code === "0x")
      throw Error(
        `${name} has no code on this network. Transactions are disabled.`,
      );
  }
  const hook = (functionName: string, args: readonly unknown[] = []) =>
    pc.readContract({
      address: c.hook.address,
      abi: c.abis[c.hook.name],
      functionName,
      args,
      blockNumber: block,
    });
  const token = (functionName: string, args: readonly unknown[] = []) =>
    pc.readContract({
      address: c.token.address,
      abi: c.abis[c.token.name],
      functionName,
      args,
      blockNumber: block,
    });
  const [total, slot, liquidity, decimals, symbol, manager] = await Promise.all(
    [
      hook("totalTipped", [poolId(c)]),
      pc.readContract({
        address: u.stateView,
        abi: protocolAbi.stateView,
        functionName: "getSlot0",
        args: [poolId(c)],
        blockNumber: block,
      }),
      pc.readContract({
        address: u.stateView,
        abi: protocolAbi.stateView,
        functionName: "getLiquidity",
        args: [poolId(c)],
        blockNumber: block,
      }),
      token("decimals"),
      token("symbol"),
      hook("poolManager"),
    ],
  );
  if (String(manager).toLowerCase() !== u.poolManager.toLowerCase())
    throw Error("Hook PoolManager differs from the handoff.");
  if (Number(decimals) !== c.deployment.token.decimals)
    throw Error("Token decimals differ from the handoff.");
  const personal = account
    ? await Promise.all([
        hook("balanceOf", [account]),
        hook("tippedBy", [account]),
        hook("receivedBy", [account]),
        token("balanceOf", [account]),
        pc.getBalance({ address: account, blockNumber: block }),
        token("allowance", [account, u.permit2]),
        pc.readContract({
          address: u.permit2,
          abi: protocolAbi.permit2,
          functionName: "allowance",
          args: [account, c.token.address, u.universalRouter],
          blockNumber: block,
        }),
      ])
    : [0n, 0n, 0n, 0n, 0n, 0n, [0n, 0, 0]];
  const permit = personal[6] as readonly [bigint, number, number];
  return {
    block,
    total: total as bigint,
    claimable: personal[0] as bigint,
    tipped: personal[1] as bigint,
    received: personal[2] as bigint,
    tokenBalance: personal[3] as bigint,
    ethBalance: personal[4] as bigint,
    allowance: personal[5] as bigint,
    permitAmount: permit[0],
    permitExpiry: permit[1],
    decimals: Number(decimals),
    symbol: String(symbol),
    price:
      (Number(slot[0]) / 2 ** 96) ** 2 *
      10 ** (c.deployment.network.nativeCurrency.decimals - Number(decimals)),
    liquidity,
    timestamp: Date.now(),
  };
}
const tippedEvent = parseAbiItem(
  "event Tipped(bytes32 indexed poolId,address indexed tipper,address indexed recipient,uint16 bps,uint256 amount)",
);
export async function readEvents(
  c: Config,
  to: bigint,
  onProgress: (events: TipEvent[], through: bigint) => void,
  signal: AbortSignal,
  p?: Provider,
) {
  const pc = clientFor(c, p);
  const events: TipEvent[] = [];
  let step = 2000n;
  for (let from = BigInt(c.deployment.deploymentBlock); from <= to; ) {
    if (signal.aborted) return;
    const end = from + step - 1n < to ? from + step - 1n : to;
    try {
      const logs = await pc.getLogs({
        address: c.hook.address,
        event: tippedEvent,
        args: { poolId: poolId(c) },
        fromBlock: from,
        toBlock: end,
        strict: true,
      });
      for (const l of logs)
        if (!l.removed)
          events.push({
            tipper: l.args.tipper,
            recipient: l.args.recipient,
            amount: l.args.amount,
            blockNumber: l.blockNumber,
            transactionHash: l.transactionHash,
          });
      onProgress([...events], end);
      from = end + 1n;
    } catch (e) {
      if (step > 100n) {
        step = step / 2n;
        continue;
      }
      throw e;
    }
  }
}
export type Quote = { out: bigint; minimum: bigint; at: number; trade: Trade };
export async function quote(
  c: Config,
  t: Trade,
  account: Address,
  p: Provider,
): Promise<Quote> {
  const pc = clientFor(c, p);
  const result = await pc.simulateContract({
    address: c.deployment.network.uniswapV4.quoter,
    abi: protocolAbi.quoter,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: poolKey(c),
        zeroForOne: t.side === "buy",
        exactAmount: t.amount,
        hookData: hookData(t),
      },
    ],
    account,
  });
  const out = result.result[0],
    minimum = minimumOut(out, t.slippageBps);
  if (minimum <= 0n || minimum >= 2n ** 128n)
    throw Error("Quote has no supported output. Try a different amount.");
  return { out, minimum, at: Date.now(), trade: t };
}
export type Action = "swap" | "approveToken" | "approveRouter" | "claim";
export async function transact(
  c: Config,
  p: Provider,
  account: Address,
  action: Action,
  q: Quote | undefined,
  onStatus: (text: string, hash?: Hex) => void,
) {
  const pc = clientFor(c, p),
    chain = chainFor(c),
    u = c.deployment.network.uniswapV4;
  async function guard() {
    if (Number(await p.request({ method: "eth_chainId" })) !== chain.id)
      throw Error(`Switch to ${chain.name} before continuing.`);
    const accounts = await p.request({ method: "eth_accounts" });
    if (accounts[0]?.toLowerCase() !== account.toLowerCase())
      throw Error("Wallet account changed. Reconnect and review the action.");
  }
  await guard();
  const live = await snapshot(c, account, p);
  if (action !== "claim" && !q) throw Error("Get a quote before continuing.");
  if (action === "swap" && q && Date.now() - q.at > 60000)
    throw Error("Quote expired. Get a new quote.");
  if (action === "claim" && live.claimable === 0n)
    throw Error("There are no tips to claim.");
  const wallet = createWalletClient({ chain, transport: custom(p), account });
  onStatus("Simulating transaction…");
  const now = Math.floor(Date.now() / 1000);
  const request =
    action === "claim"
      ? {
          address: c.hook.address,
          abi: c.abis[c.hook.name],
          functionName: "claim",
          args: [],
        }
      : action === "approveToken"
        ? {
            address: c.token.address,
            abi: c.abis[c.token.name],
            functionName: "approve",
            args: [u.permit2, q!.trade.amount],
          }
        : action === "approveRouter"
          ? {
              address: u.permit2,
              abi: protocolAbi.permit2,
              functionName: "approve",
              args: [
                c.token.address,
                u.universalRouter,
                q!.trade.amount,
                now + 1800,
              ],
            }
          : {
              address: u.universalRouter,
              abi: [...protocolAbi.router, ...c.abis[c.hook.name]],
              functionName: "execute",
              ...swapArguments(c, q!.trade, q!.minimum, BigInt(now + 300)),
            };
  const simulation = await pc.simulateContract({ ...request, account });
  await guard();
  if (action === "swap" && q && Date.now() - q.at > 60000)
    throw Error("Quote expired during simulation. Get a new quote.");
  onStatus("Confirm the transaction in your wallet.");
  const hash = await wallet.writeContract(simulation.request);
  onStatus("Transaction submitted. Waiting for confirmation…", hash);
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 120000 });
  if (receipt.status !== "success")
    throw Error("Transaction reverted. Refresh balances and try again.");
  onStatus("Transaction confirmed.", hash);
}
export const units = (n: bigint, decimals = 18, max = 6) => {
  const raw = formatUnits(n, decimals);
  if (n !== 0n && Math.abs(Number(raw)) < 10 ** -max) return `< ${10 ** -max}`;
  return Number(raw).toLocaleString("en-US", { maximumFractionDigits: max });
};
