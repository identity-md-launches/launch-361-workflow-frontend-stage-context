import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { poolTuple, type Config } from "./config";
export type Side = "buy" | "sell";
export type Trade = {
  side: Side;
  amount: bigint;
  tipBps: number;
  recipient: Address;
  slippageBps: number;
};
export function poolKey(c: Config) {
  const currencies = [c.deployment.pool.pairedCurrency, c.token.address].sort(
    (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return {
    currency0: currencies[0],
    currency1: currencies[1],
    fee: c.deployment.pool.fee,
    tickSpacing: c.deployment.pool.tickSpacing,
    hooks: c.hook.address,
  };
}
export const poolId = (c: Config) =>
  keccak256(encodeAbiParameters(parseAbiParameters(poolTuple), [poolKey(c)]));
export const hookData = (t: Trade) =>
  encodeAbiParameters(parseAbiParameters("uint16,address"), [
    t.tipBps,
    t.tipBps ? t.recipient : zeroAddress,
  ]);
export function parseTrade(
  c: Config,
  side: Side,
  amount: string,
  tipBps: number,
  recipient: string,
  slippage: string,
  decimals: number,
): Trade {
  if (
    !/^\d+(\.\d+)?$/.test(amount.trim()) ||
    (amount.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(`Enter an amount with at most ${decimals} decimal places.`);
  const input = parseUnits(amount.trim(), decimals);
  if (input <= 0n || input >= 2n ** 127n)
    throw Error("Enter a positive amount within the pool’s supported range.");
  if (!Number.isInteger(tipBps) || tipBps < 0 || tipBps > 500)
    throw Error("Choose a tip between 0% and 5%.");
  if (
    tipBps &&
    (!isAddress(recipient) ||
      [
        zeroAddress,
        c.hook.address,
        c.deployment.network.uniswapV4.poolManager,
      ].some((a) => a.toLowerCase() === recipient.toLowerCase()))
  )
    throw Error(
      "Enter a valid recipient address other than the hook or PoolManager.",
    );
  const slippageBps = /^\d+(\.\d{1,2})?$/.test(slippage)
    ? Number(parseUnits(slippage, 2))
    : NaN;
  if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500)
    throw Error("Choose slippage between 0.1% and 5%, in steps of 0.01%.");
  return {
    side,
    amount: input,
    tipBps,
    recipient: tipBps ? (recipient as Address) : zeroAddress,
    slippageBps,
  };
}
export function swapArguments(
  c: Config,
  t: Trade,
  minimum: bigint,
  deadline: bigint,
): { args: readonly [Hex, Hex[], bigint]; value: bigint } {
  const key = poolKey(c),
    zeroForOne = t.side === "buy";
  const params = [
    encodeAbiParameters(
      parseAbiParameters(
        `(${poolTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
      ),
      [
        {
          poolKey: key,
          zeroForOne,
          amountIn: t.amount,
          amountOutMinimum: minimum,
          hookData: hookData(t),
        },
      ],
    ),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      zeroForOne ? key.currency0 : key.currency1,
      t.amount,
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      zeroForOne ? key.currency1 : key.currency0,
      minimum,
    ]),
  ];
  return {
    args: [
      "0x10",
      [
        encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
          "0x060c0f",
          params,
        ]),
      ],
      deadline,
    ],
    value: zeroForOne ? t.amount : 0n,
  };
}
export type TipEvent = {
  tipper: Address;
  recipient: Address;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
};
export function aggregate(events: TipEvent[], field: "tipper" | "recipient") {
  const sums = new Map<string, bigint>();
  for (const e of events)
    sums.set(
      e[field].toLowerCase(),
      (sums.get(e[field].toLowerCase()) ?? 0n) + e.amount,
    );
  return [...sums]
    .map(([address, amount]) => ({ address: address as Address, amount }))
    .sort((a, b) =>
      a.amount > b.amount
        ? -1
        : a.amount < b.amount
          ? 1
          : a.address.localeCompare(b.address),
    );
}
export const minimumOut = (amount: bigint, bps: number) =>
  (amount * BigInt(10000 - bps)) / 10000n;
export function message(error: unknown): string {
  const e = error as {
    shortMessage?: string;
    message?: string;
    code?: number;
    cause?: unknown;
  };
  if (e?.code === 4001 || /rejected|denied/i.test(e?.message ?? ""))
    return "Request declined in your wallet. You can try again.";
  return (
    e?.shortMessage ??
    e?.message ??
    "Request failed. Check your connection and try again."
  ).slice(0, 500);
}
