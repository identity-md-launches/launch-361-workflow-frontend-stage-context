import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  type Address,
} from "viem";
import { abiHash, poolTuple, safePath, type Config } from "../src/config";
import {
  aggregate,
  hookData,
  minimumOut,
  parseTrade,
  poolId,
  swapArguments,
} from "../src/domain";
import { switchChain, type Provider } from "../src/chain";
const d = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const c: Config = {
  deployment: d,
  hook: d.contracts.find((x: { name: string }) => x.name === "SwapTipHook"),
  token: d.contracts.find((x: { name: string }) => x.name === "STIP"),
  abis: {},
};
const recipient = "0x1111111111111111111111111111111111111111" as Address;
test("each implementation ABI matches its attested canonical Keccak", () => {
  for (const contract of d.contracts) {
    const abi = JSON.parse(
      readFileSync(
        new URL("../../dist/" + contract.abiPath, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(abiHash(abi), contract.abiHash);
  }
});
test("input validation rejects dust rounding, negatives, excessive tips and invalid recipients", () => {
  for (const amount of ["0", "-1", "1e3", "1.0000000000000000001", "NaN"])
    assert.throws(() =>
      parseTrade(c, "buy", amount, 100, recipient, "0.5", 18),
    );
  for (const addr of [
    zeroAddress,
    c.hook.address,
    c.deployment.network.uniswapV4.poolManager,
    "bad",
  ])
    assert.throws(() => parseTrade(c, "buy", "1", 100, addr, "0.5", 18));
  assert.throws(() => parseTrade(c, "buy", "1", 501, recipient, "0.5", 18));
  assert.equal(
    parseTrade(c, "buy", "1", 0, "", "0.5", 18).recipient,
    zeroAddress,
  );
});
test("tip data is precisely two ABI words at 0, 1 and 500 bps", () => {
  for (const bps of [0, 1, 500]) {
    const t = parseTrade(c, "buy", "0.001", bps, recipient, "0.5", 18);
    const data = hookData(t);
    assert.equal(data.length, 130);
    assert.deepEqual(
      decodeAbiParameters(parseAbiParameters("uint16,address"), data),
      [bps, bps ? recipient : zeroAddress],
    );
  }
});
test("buy and sell use the attested pool and enforce minimum output in swap and take", () => {
  for (const side of ["buy", "sell"] as const) {
    const t = parseTrade(c, side, "0.1", 500, recipient, "0.5", 18),
      out = 123456n,
      min = minimumOut(out, 50);
    const built = swapArguments(c, t, min, 123n);
    assert.equal(built.args[0], "0x10");
    assert.equal(built.value, side === "buy" ? t.amount : 0n);
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      built.args[1][0],
    );
    assert.equal(actions, "0x060c0f");
    const [swap] = decodeAbiParameters(
      parseAbiParameters(
        `(${poolTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`,
      ),
      params[0],
    );
    assert.equal(swap.amountIn, t.amount);
    assert.equal(swap.amountOutMinimum, min);
    assert.equal(swap.zeroForOne, side === "buy");
    assert.equal(swap.poolKey.hooks.toLowerCase(), c.hook.address);
    assert.equal(swap.hookData, hookData(t));
    const [currency, minimum] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[2],
    );
    assert.equal(
      currency.toLowerCase(),
      side === "buy" ? c.token.address : zeroAddress,
    );
    assert.equal(minimum, min);
  }
  assert.match(poolId(c), /^0x[0-9a-f]{64}$/);
});
test("leaderboards aggregate by normalized address with exact integers", () => {
  const hash = "0x01" as const;
  const rows = aggregate(
    [
      {
        tipper: recipient,
        recipient,
        amount: 2n,
        blockNumber: 1n,
        transactionHash: hash,
      },
      {
        tipper: recipient,
        recipient,
        amount: 3n,
        blockNumber: 2n,
        transactionHash: hash,
      },
    ],
    "tipper",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 5n);
});
test("unknown wallet chain is added with exact handoff parameters, then switched again", async () => {
  const calls: unknown[] = [];
  let first = true;
  const p = {
    request: async (arg: { method: string }) => {
      calls.push(arg);
      if (first) {
        first = false;
        throw { code: 4902 };
      }
      return null;
    },
  } as unknown as Provider;
  await switchChain(c, p);
  assert.deepEqual(calls, [
    {
      method: "wallet_switchEthereumChain",
      params: [{ chainId: d.walletAddChain.chainId }],
    },
    { method: "wallet_addEthereumChain", params: [d.walletAddChain] },
    {
      method: "wallet_switchEthereumChain",
      params: [{ chainId: d.walletAddChain.chainId }],
    },
  ]);
});
test("user rejection does not trigger add-chain", async () => {
  let count = 0;
  await assert.rejects(
    switchChain(c, {
      request: async () => {
        count++;
        throw { code: 4001 };
      },
    } as unknown as Provider),
  );
  assert.equal(count, 1);
});
test("ABI paths reject URLs, parent traversal and absolute paths", () => {
  for (const p of [
    "https://x",
    "../abi/x.json",
    "/abi/x.json",
    "abi/../x",
    "abi//x",
  ])
    assert.equal(safePath(p), false);
  assert.equal(safePath("abi/STIP.json"), true);
});

test("slippage accepts exact hundredths without floating point rejection", () => {
  assert.equal(parseTrade(c, "buy", "1", 0, "", "0.29", 18).slippageBps, 29);
});
