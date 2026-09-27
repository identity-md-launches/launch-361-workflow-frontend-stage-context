import { readFile, writeFile } from "node:fs/promises";
import {
  createPublicClient,
  http,
  parseAbi,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
const d = JSON.parse(
  await readFile(new URL("../../dist/imd-deployment.json", import.meta.url)),
);
const report = {
  checkedAt: new Date().toISOString(),
  mode: "read-only; no wallet or broadcast",
  rpc: [],
  sourceCommit: d.sourceCommit,
};
for (const url of d.network.rpcUrls) {
  const entry = { url };
  report.rpc.push(entry);
  const c = createPublicClient({
    transport: http(url, { timeout: 12000, retryCount: 0 }),
  });
  try {
    entry.chainId = await c.getChainId();
    if (entry.chainId !== d.chainId) throw Error("Wrong chain");
    entry.block = String(await c.getBlockNumber());
    entry.code = {};
    const addresses = [
      ...d.contracts.map((x) => [x.name, x.address]),
      ...Object.entries(d.network.uniswapV4),
    ];
    for (const [name, address] of addresses) {
      const code = await c.getCode({ address });
      entry.code[name] = { address, bytes: code ? (code.length - 2) / 2 : 0 };
      if (!code || code === "0x") throw Error(`No code: ${name}`);
    }
    const token = d.contracts.find((c) => c.name === "STIP"),
      hook = d.contracts.find((c) => c.name === "SwapTipHook");
    const key = {
      currency0: d.pool.pairedCurrency,
      currency1: token.address,
      fee: d.pool.fee,
      tickSpacing: d.pool.tickSpacing,
      hooks: hook.address,
    };
    const id = keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
        ),
        [key],
      ),
    );
    entry.poolId = id;
    entry.slot0 = (
      await c.readContract({
        address: d.network.uniswapV4.stateView,
        abi: parseAbi([
          "function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)",
        ]),
        functionName: "getSlot0",
        args: [id],
      })
    ).map(String);
    entry.liquidity = String(
      await c.readContract({
        address: d.network.uniswapV4.stateView,
        abi: parseAbi(["function getLiquidity(bytes32) view returns(uint128)"]),
        functionName: "getLiquidity",
        args: [id],
      }),
    );
    entry.totalTipped = String(
      await c.readContract({
        address: hook.address,
        abi: JSON.parse(
          await readFile(
            new URL("../../dist/" + hook.abiPath, import.meta.url),
          ),
        ),
        functionName: "totalTipped",
        args: [id],
      }),
    );
    entry.quoteProbe = {
      inputWei: "1000000000000",
      tipBps: 0,
      broadcast: false,
    };
    try {
      const result = await c.simulateContract({
        address: d.network.uniswapV4.quoter,
        abi: parseAbi([
          "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)",
        ]),
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: key,
            zeroForOne: true,
            exactAmount: 1000000000000n,
            hookData: "0x",
          },
        ],
      });
      entry.quoteProbe.outputRaw = String(result.result[0]);
      entry.quoteProbe.gasEstimate = String(result.result[1]);
    } catch (e) {
      entry.quoteProbe.error = e.shortMessage ?? e.message;
    }
    entry.ok = true;
  } catch (e) {
    entry.ok = false;
    entry.error = (e.shortMessage ?? e.message).slice(0, 400);
  }
}
await writeFile(
  new URL("../../docs/frontend/live-check.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
