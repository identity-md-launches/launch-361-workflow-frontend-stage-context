import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  parseAbiParameters,
  keccak256,
  toHex,
} from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url)),
  dist = resolve(root, "dist");
const manifest = JSON.parse(
  await readFile(resolve(dist, "imd-deployment.json")),
);
const abis = Object.fromEntries(
  await Promise.all(
    manifest.contracts.map(async (c) => [
      c.name,
      JSON.parse(await readFile(resolve(dist, c.abiPath))),
    ]),
  ),
);
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const path = resolve(dist, p.replace(/^\/preview\//, "") || "index.html");
    if (!path.startsWith(dist + "/")) throw Error();
    const body = await readFile(path);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(path)] ?? "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((r) => server.listen(0, "0.0.0.0", r));
const url = `http://127.0.0.1:${server.address().port}/preview/index.html`;
if (process.argv.includes("--inspect")) {
  console.log(url);
  await new Promise((r) => {
    process.on("SIGINT", r);
    setTimeout(r, 600000);
  });
  server.close();
  process.exit();
}
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROMIUM_PATH ||
    "/opt/imd-worker/toolchains/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  args: ["--no-sandbox"],
});
const account = "0x1111111111111111111111111111111111111111",
  recipient = "0x2222222222222222222222222222222222222222";
const hook = manifest.contracts.find((x) => x.name === "SwapTipHook"),
  token = manifest.contracts.find((x) => x.name === "STIP"),
  u = manifest.network.uniswapV4;
const stateAbi = parseAbi([
  "function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32) view returns(uint128)",
]);
const permitAbi = parseAbi([
  "function allowance(address,address,address) view returns(uint160,uint48,uint48)",
  "function approve(address,address,uint160,uint48)",
]);
const routerAbi = parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)",
]);
const block = BigInt(manifest.deploymentBlock + 100),
  blockHash = "0x" + "ab".repeat(32),
  txHash = "0x" + "cd".repeat(32);
const eventAbi = parseAbi([
  "event Tipped(bytes32 indexed poolId,address indexed tipper,address indexed recipient,uint16 bps,uint256 amount)",
]);
const pool = keccak256(
  encodeAbiParameters(
    parseAbiParameters("(address,address,uint24,int24,address)"),
    [
      [
        manifest.pool.pairedCurrency,
        token.address,
        manifest.pool.fee,
        manifest.pool.tickSpacing,
        hook.address,
      ],
    ],
  ),
);
const results = [],
  consoleErrors = [],
  failures = [];
let browserPage;
async function step(name, fn) {
  await fn();
  results.push({ name, status: "passed" });
  console.log("PASS " + name);
}
async function context({
  wallet = true,
  missingCode = false,
  rpcFail = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await ctx.newPage();
  browserPage = page;
  const state = {
    approved: false,
    permitted: false,
    claimed: false,
    revert: false,
    quoteFail: false,
    sends: [],
    calls: [],
  };
  await ctx.route("**/*", async (route) => {
    if (route.request().url().startsWith(url.replace("index.html", ""))) {
      const relative = new URL(route.request().url()).pathname.replace(
        /^\/preview\//,
        "",
      );
      const path = resolve(dist, relative);
      if (!path.startsWith(dist + "/")) throw Error("Invalid static path");
      await route.fulfill({
        path,
        contentType: {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
        }[extname(path)],
      });
      return;
    }

    if (
      !manifest.network.rpcUrls.some((x) => route.request().url().startsWith(x))
    ) {
      await route.abort();
      return;
    }
    if (rpcFail) {
      await route.fulfill({ status: 503, body: "Unavailable" });
      return;
    }
    const payload = route.request().postDataJSON();
    async function rpc(req) {
      state.calls.push(req);
      let result;
      if (req.method === "eth_chainId") result = toHex(manifest.chainId);
      else if (req.method === "eth_blockNumber") result = toHex(block);
      else if (req.method === "eth_getCode")
        result = missingCode ? "0x" : "0x60016000";
      else if (req.method === "eth_getBalance") result = toHex(10n ** 19n);
      else if (req.method === "eth_getLogs")
        result = [
          {
            address: hook.address,
            blockNumber: toHex(block),
            blockHash,
            transactionHash: txHash,
            transactionIndex: "0x0",
            logIndex: "0x0",
            removed: false,
            topics: encodeEventTopics({
              abi: eventAbi,
              eventName: "Tipped",
              args: { poolId: pool, tipper: account, recipient },
            }),
            data: encodeAbiParameters(parseAbiParameters("uint16,uint256"), [
              100,
              10n ** 16n,
            ]),
          },
        ];
      else if (req.method === "eth_getTransactionReceipt")
        result = {
          transactionHash: req.params[0],
          transactionIndex: "0x0",
          blockHash,
          blockNumber: toHex(block),
          from: account,
          to: hook.address,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          contractAddress: null,
          logs: [],
          logsBloom: "0x" + "00".repeat(256),
          status: "0x1",
          type: "0x2",
        };
      else if (req.method === "eth_call") {
        const call = req.params[0],
          addr = call.to.toLowerCase();
        let abi =
          addr === hook.address
            ? abis.SwapTipHook
            : addr === token.address
              ? abis.STIP
              : addr === u.stateView
                ? stateAbi
                : addr === u.permit2
                  ? permitAbi
                  : addr === u.quoter
                    ? quoterAbi
                    : routerAbi;
        const decoded = decodeFunctionData({ abi, data: call.data }),
          fn = decoded.functionName;
        if (
          (state.revert && fn === "execute") ||
          (state.quoteFail && fn === "quoteExactInputSingle")
        )
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: {
              code: 3,
              message: "execution reverted: mocked pool failure",
              data: "0x",
            },
          };
        const outputs = {
          totalTipped: 10n ** 16n,
          poolManager: u.poolManager,
          decimals: 18,
          symbol: "STIP",
          getSlot0: [
            BigInt("791647387308859959733601586197955"),
            184200,
            0,
            3000,
          ],
          getLiquidity: 10n ** 22n,
          tippedBy: 10n ** 16n,
          receivedBy: 2n * 10n ** 16n,
          quoteExactInputSingle: [100n * 10n ** 18n, 150000n],
        };
        let value = outputs[fn];
        if (fn === "balanceOf")
          value =
            addr === token.address
              ? 1000n * 10n ** 18n
              : state.claimed
                ? 0n
                : 10n ** 16n;
        if (fn === "allowance")
          value =
            addr === token.address
              ? state.approved
                ? 10n ** 30n
                : 0n
              : [
                  state.permitted ? 10n ** 30n : 0n,
                  state.permitted ? Math.floor(Date.now() / 1000) + 3600 : 0,
                  0,
                ];
        if (fn === "approve") value = addr === token.address ? true : undefined;
        result = encodeFunctionResult({
          abi,
          functionName: fn,
          ...(value !== undefined ? { result: value } : {}),
        });
      } else throw Error("Unhandled RPC " + req.method);
      return { jsonrpc: "2.0", id: req.id, result };
    }
    try {
      const response = Array.isArray(payload)
        ? await Promise.all(payload.map(rpc))
        : await rpc(payload);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    } catch (e) {
      failures.push(e.message);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32603, message: e.message },
        }),
      });
    }
  });
  if (wallet) {
    await page.exposeFunction("recordSend", (tx) => {
      state.sends.push(tx);
      const addr = tx.to.toLowerCase();
      if (addr === token.address) state.approved = true;
      if (addr === u.permit2) state.permitted = true;
      if (addr === hook.address) state.claimed = true;
      return txHash;
    });
    await page.addInitScript(
      ({ account, chainId }) => {
        const listeners = {};
        window.mockWallet = {
          chain: "0x1",
          connected: false,
          reject: false,
          known: false,
          calls: [],
        };
        window.ethereum = {
          on: (name, fn) => (listeners[name] ??= []).push(fn),
          removeListener: (name, fn) => {
            listeners[name] = (listeners[name] ?? []).filter((f) => f !== fn);
          },
          request: async (args) => {
            const s = window.mockWallet;
            s.calls.push(args);
            if (args.method === "eth_accounts")
              return s.connected ? [account] : [];
            if (args.method === "eth_chainId") return s.chain;
            if (args.method === "eth_requestAccounts") {
              if (s.reject)
                throw { code: 4001, message: "User rejected request" };
              s.connected = true;
              return [account];
            }
            if (args.method === "wallet_switchEthereumChain") {
              if (!s.known) throw { code: 4902, message: "Unknown chain" };
              s.chain = chainId;
              (listeners.chainChanged ?? []).forEach((fn) => fn(s.chain));
              return null;
            }
            if (args.method === "wallet_addEthereumChain") {
              s.known = true;
              return null;
            }
            if (args.method === "eth_sendTransaction") {
              if (s.reject)
                throw { code: 4001, message: "User rejected request" };
              return window.recordSend(args.params[0]);
            }
            throw Error("Unhandled wallet " + args.method);
          },
        };
        window.changeAccount = () => {
          (listeners.accountsChanged ?? []).forEach((fn) => fn([]));
        };
      },
      { account, chainId: toHex(manifest.chainId) },
    );
  }
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Make a swap" }),
  ).toBeVisible();
  return { ctx, page, state };
}
try {
  let { ctx, page, state } = await context();
  await step(
    "Disconnected page loads relative assets, runtime manifest and event leaderboard",
    async () => {
      await expect(
        page.getByText("0.01", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Claim ETH tips" }),
      ).toBeDisabled();
      assert.equal(await page.locator("script[src]").count(), 1);
    },
  );
  await step(
    "Desktop, intermediate and mobile reflow; screenshots",
    async () => {
      for (const width of [1440, 900, 740, 390, 320]) {
        await page.setViewportSize({ width, height: 1080 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `overflow at ${width}`,
        );
        if ([1440, 390, 320].includes(width))
          await page.screenshot({
            path: resolve(root, `docs/frontend/${width}-disconnected.png`),
            fullPage: true,
          });
      }
      await page.setViewportSize({ width: 1440, height: 1080 });
    },
  );
  await step("Keyboard skip link and visible focus", async () => {
    await page.keyboard.press("Tab");
    await expect(page.getByText("Skip to content")).toBeFocused();
    assert.equal(
      await page
        .getByText("Skip to content")
        .evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
    );
    await page.keyboard.press("Enter");
  });
  await step(
    "Wallet rejection, recovery and unknown chain add/switch",
    async () => {
      await page.evaluate(() => (window.mockWallet.reject = true));
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("declined");
      await page.evaluate(() => (window.mockWallet.reject = false));
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch to Sepolia" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Switch to Sepolia" }).click();
      await expect(
        page.getByRole("button", { name: "Get quote", exact: true }),
      ).toBeEnabled();
      assert.deepEqual(
        await page.evaluate(
          () =>
            window.mockWallet.calls.find(
              (x) => x.method === "wallet_addEthereumChain",
            ).params[0],
        ),
        manifest.walletAddChain,
      );
    },
  );
  await step(
    "Invalid amount and recipient are rejected without quoting",
    async () => {
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("amount");
      await page.getByLabel("You pay", { exact: true }).fill("0.001");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("recipient");
      await expect(
        page.getByLabel("Tip recipient", { exact: false }),
      ).toBeFocused();
    },
  );
  await step("Quoter revert is shown and quote retry succeeds", async () => {
    await page.getByLabel("Tip recipient", { exact: false }).fill(recipient);
    state.quoteFail = true;
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await expect(page.getByRole("alert")).not.toBeEmpty();
    state.quoteFail = false;
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await expect(page.getByText("99.5 STIP", { exact: true })).toBeVisible();
  });
  await step(
    "Quote changes invalidate review and tip slider supports keyboard",
    async () => {
      await page.getByRole("slider").focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("button", { name: "Confirm buy STIP" }),
      ).toHaveCount(0);
      await expect(page.getByRole("slider")).toHaveValue("125");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
    },
  );
  await step("Swap simulation revert prevents wallet signature", async () => {
    state.revert = true;
    await page.getByRole("button", { name: "Confirm buy STIP" }).click();
    await expect(page.getByRole("alert")).not.toBeEmpty();
    assert.equal(state.sends.length, 0);
    state.revert = false;
  });
  await step(
    "Buy transaction uses network router, native value, minimum output and exact hook data",
    async () => {
      await page.getByRole("button", { name: "Confirm buy STIP" }).click();
      await expect(page.locator('.feedback [role="status"]')).toContainText(
        "Transaction confirmed",
      );
      assert.equal(state.sends.length, 1);
      const tx = state.sends[0];
      assert.equal(tx.to.toLowerCase(), u.universalRouter);
      assert.equal(BigInt(tx.value), 10n ** 15n);
      const decoded = decodeFunctionData({ abi: routerAbi, data: tx.data });
      assert.equal(decoded.args[0], "0x10");
    },
  );
  await step(
    "Sell requires separate token and router approval transactions",
    async () => {
      await page
        .getByRole("button", { name: "Sell STIP", exact: true })
        .click();
      await page.getByLabel("You pay", { exact: true }).fill("1");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Confirm sell STIP" }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "1. Approve STIP for Permit2" })
        .click();
      await expect(
        page.getByRole("button", { name: "2. Allow router spending" }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "2. Allow router spending" })
        .click();
      await expect(
        page.getByRole("button", { name: "Confirm sell STIP" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Confirm sell STIP" }).click();
      await expect(page.locator('.feedback [role="status"]')).toContainText(
        "Transaction confirmed",
      );
      await expect.poll(() => state.sends.length).toBe(4);
      assert.equal(state.sends[1].to.toLowerCase(), token.address);
      assert.equal(state.sends[2].to.toLowerCase(), u.permit2);
      assert.equal(state.sends[3].to.toLowerCase(), u.universalRouter);
      assert.equal(BigInt(state.sends[3].value ?? 0), 0n);
      const approved = decodeFunctionData({
        abi: abis.STIP,
        data: state.sends[1].data,
      });
      assert.equal(approved.args[0].toLowerCase(), u.permit2);
      assert.equal(approved.args[1], 10n ** 18n);
    },
  );
  await step(
    "Claim simulation and confirmation refresh claimable balance",
    async () => {
      await page.getByRole("button", { name: "Claim ETH tips" }).click();
      await expect(
        page.getByRole("button", { name: "Claim ETH tips" }),
      ).toBeDisabled();
      await expect(page.locator(".claim-amount")).toContainText("0 ETH");
      assert.equal(state.sends.at(-1).to.toLowerCase(), hook.address);
    },
  );
  await step(
    "Connected accessibility scan, text enlargement, contrast and screenshot",
    async () => {
      await page.screenshot({
        path: resolve(root, "docs/frontend/1440-connected.png"),
        fullPage: true,
      });
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      await writeFile(
        resolve(root, "docs/frontend/accessibility.json"),
        JSON.stringify(
          {
            violations: audit.violations,
            incomplete: audit.incomplete.map((x) => ({
              id: x.id,
              impact: x.impact,
              description: x.description,
            })),
            passes: audit.passes.map((x) => x.id),
          },
          null,
          2,
        ),
      );
      assert.deepEqual(
        audit.violations.map((x) => x.id),
        [],
      );
      const contrast = await page.evaluate(() => {
        function lum(c) {
          return c
            .match(/\d+/g)
            .slice(0, 3)
            .map(Number)
            .map((n) => n / 255)
            .map((n) =>
              n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
        }
        return [".lead", ".primary", ".impact h2", ".hint"].map((selector) => {
          const el = document.querySelector(selector);
          const cs = getComputedStyle(el);
          let bg = el;
          while (
            getComputedStyle(bg).backgroundColor === "rgba(0, 0, 0, 0)" &&
            bg.parentElement
          )
            bg = bg.parentElement;
          const background = getComputedStyle(bg).backgroundColor;
          const a = lum(cs.color),
            b = lum(background);
          return {
            selector,
            color: cs.color,
            background,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        });
      });
      await writeFile(
        resolve(root, "docs/frontend/contrast.json"),
        JSON.stringify(contrast, null, 2),
      );
      assert.ok(contrast.every((x) => x.ratio >= 4.5));
      await page.setViewportSize({ width: 740, height: 1000 });
      await page.addStyleTag({ content: "html{font-size:200%}" });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    },
  );
  await step("Account change clears personal balances and quote", async () => {
    await page.evaluate(() => window.changeAccount());
    await expect(
      page.getByRole("button", { name: "Connect wallet", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".claim-amount")).toContainText("—");
  });
  await ctx.close();
  ({ ctx, page, state } = await context({ wallet: false }));
  await step("Missing wallet has actionable recovery text", async () => {
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "No browser wallet found",
    );
  });
  await ctx.close();
  ({ ctx, page, state } = await context({ missingCode: true }));
  await step(
    "Missing deployed code blocks actions and reports the contract",
    async () => {
      await expect(page.getByText(/has no code on this network/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Claim ETH tips" }),
      ).toBeDisabled();
    },
  );
  await ctx.close();
  ({ ctx, page, state } = await context({ wallet: false, rpcFail: true }));
  await step(
    "RPC outage is displayed, never fabricated as zero data",
    async () => {
      await expect(
        page.getByText(/Use Refresh data to retry/).last(),
      ).toBeVisible({ timeout: 30000 });
      await expect(page.locator(".total")).toContainText("—");
    },
  );
  await ctx.close();
  assert.deepEqual(failures, []);
  assert.deepEqual(consoleErrors, []);
} catch (e) {
  results.push({ name: "failure", status: "failed", error: e.message });
  console.error(e);
  if (browserPage && !browserPage.isClosed())
    await browserPage.screenshot({
      path: resolve(root, "docs/frontend/test-failure.png"),
      fullPage: true,
    });
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(root, "docs/frontend/browser-results.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        url: "/preview/index.html",
        mode: "Mocked EIP-1193 wallet and JSON-RPC; no real transactions",
        results,
        consoleErrors,
        unexpectedRpc: failures,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
  server.close();
}
