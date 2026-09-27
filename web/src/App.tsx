import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { loadConfig, type Config } from "./config";
import {
  aggregate,
  message,
  parseTrade,
  type Side,
  type TipEvent,
} from "./domain";
import {
  quote,
  readEvents,
  snapshot,
  switchChain,
  transact,
  units,
  type Action,
  type Quote,
  type Snapshot,
} from "./chain";
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
function Mark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="12" fill="currentColor" />
      <path
        d="M12 16h15l-4-4m4 12H12l4 4"
        fill="none"
        stroke="var(--surface)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function AddressLink({ address, c }: { address: Address; c: Config }) {
  return (
    <a
      className="address"
      href={`${c.deployment.network.explorer}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
      aria-label={`View address ${address} on explorer`}
    >
      <bdi>{short(address)}</bdi> ↗
    </a>
  );
}
function Board({
  title,
  field,
  events,
  c,
  complete,
  loading,
}: {
  title: string;
  field: "tipper" | "recipient";
  events: TipEvent[];
  c: Config;
  complete: boolean;
  loading: boolean;
}) {
  const rows = aggregate(events, field).slice(0, 5);
  return (
    <section className="board" aria-label={title}>
      <div className="section-heading">
        <h3>{title}</h3>
        <span className="small">ETH tipped</span>
      </div>
      {rows.length ? (
        <ol>
          {rows.map((r, i) => (
            <li key={r.address}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <AddressLink address={r.address} c={c} />
              <strong>{units(r.amount)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty">
          <span aria-hidden="true">↗</span>
          <p>
            {loading
              ? "Reading tip history…"
              : complete
                ? "The first tip starts the story."
                : "Tip history is unavailable."}
          </p>
          <small>
            {complete
              ? "Add a tip to a swap to appear here."
              : "Use Refresh data to try again."}
          </small>
        </div>
      )}
    </section>
  );
}
export default function App() {
  const [c, setC] = useState<Config>(),
    [bootError, setBootError] = useState("");
  const [account, setAccount] = useState<Address>(),
    [chain, setChain] = useState<number>(),
    [walletBusy, setWalletBusy] = useState(false);
  const [data, setData] = useState<Snapshot>(),
    [readError, setReadError] = useState(""),
    [reading, setReading] = useState(false),
    [refreshKey, setRefreshKey] = useState(0);
  const [events, setEvents] = useState<TipEvent[]>([]),
    [history, setHistory] = useState("Waiting for pool data."),
    [historyComplete, setHistoryComplete] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false);
  const [side, setSide] = useState<Side>("buy"),
    [amount, setAmount] = useState(""),
    [tip, setTip] = useState(100),
    [recipient, setRecipient] = useState(""),
    [slippage, setSlippage] = useState("0.5");
  const [q, setQ] = useState<Quote>(),
    [quoting, setQuoting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [hash, setHash] = useState<Hex>(),
    [now, setNow] = useState(Date.now());
  const epoch = useRef(0),
    amountRef = useRef<HTMLInputElement>(null),
    recipientRef = useRef<HTMLInputElement>(null),
    slippageRef = useRef<HTMLInputElement>(null);
  const invalidate = useCallback(() => {
    epoch.current++;
    setQ(undefined);
    setError("");
  }, []);
  useEffect(() => {
    loadConfig()
      .then(setC)
      .catch((e) => setBootError(message(e)));
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const p = window.ethereum;
    if (!p) return;
    const onAccounts = (value: unknown) => {
      setAccount((value as Address[])[0]);
      setData(undefined);
      invalidate();
    };
    const onChain = (value: unknown) => {
      setChain(Number(value));
      setData(undefined);
      invalidate();
    };
    const onDisconnect = () => onAccounts([]);
    p.request({ method: "eth_accounts" })
      .then(onAccounts)
      .catch(() => {});
    p.request({ method: "eth_chainId" })
      .then(onChain)
      .catch(() => {});
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    p.on?.("disconnect", onDisconnect);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
      p.removeListener?.("disconnect", onDisconnect);
    };
  }, [invalidate]);
  useEffect(() => {
    if (!c) return;
    let active = true,
      running = false;
    const read = async () => {
      if (running) return;
      running = true;
      setReading(true);
      try {
        const result = await snapshot(c, account, window.ethereum);
        if (active) {
          setData(result);
          setReadError("");
        }
      } catch (e) {
        if (active) setReadError(message(e));
      } finally {
        running = false;
        if (active) setReading(false);
      }
    };
    void read();
    const id = setInterval(read, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [c, account, chain, refreshKey]);
  useEffect(() => {
    if (!c || !data) return;
    const controller = new AbortController();
    setHistoryComplete(false);
    setHistoryLoading(true);
    setEvents([]);
    readEvents(
      c,
      data.block,
      (ev, through) => {
        if (controller.signal.aborted) return;
        setEvents(ev);
        setHistory(
          `Indexed blocks ${c.deployment.deploymentBlock.toLocaleString()}–${through.toLocaleString()}.`,
        );
      },
      controller.signal,
      window.ethereum,
    )
      .then(() => {
        if (!controller.signal.aborted) {
          setHistoryComplete(true);
          setHistoryLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setHistory(`Partial history: ${message(e)} Refresh data to retry.`);
          setHistoryLoading(false);
        }
      });
    return () => controller.abort();
  }, [c, data?.block, refreshKey]);
  const correctChain = !!c && chain === c.deployment.chainId;
  const verified = !!data && !readError && now - data.timestamp < 90000;
  const ready = !!account && correctChain && verified && !busy && !walletBusy;
  const expired = !!q && now - q.at >= 60000;
  const freshQ = !!q && !expired;
  const needToken =
    !!q && side === "sell" && !!data && data.allowance < q.trade.amount;
  const needRouter =
    !!q &&
    side === "sell" &&
    !!data &&
    (data.permitAmount < q.trade.amount ||
      data.permitExpiry <= Math.floor(now / 1000) + 300);
  const inputSymbol = side === "buy" ? "ETH" : "STIP",
    outputSymbol = side === "buy" ? "STIP" : "ETH";
  const inputDecimals =
    side === "buy"
      ? 18
      : (data?.decimals ?? c?.deployment.token.decimals ?? 18);
  const outputDecimals = side === "buy" ? (data?.decimals ?? 18) : 18;
  async function connect() {
    if (!window.ethereum) {
      setError(
        "No browser wallet found. Open this page in an Ethereum wallet browser or install a browser wallet, then reload.",
      );
      return;
    }
    setWalletBusy(true);
    setError("");
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      setAccount(accounts[0]);
      setChain(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setWalletBusy(false);
    }
  }
  async function switchNetwork() {
    if (!c || !window.ethereum) return;
    setWalletBusy(true);
    setError("");
    try {
      await switchChain(c, window.ethereum);
      setChain(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
      invalidate();
    } catch (e) {
      setError(message(e));
    } finally {
      setWalletBusy(false);
    }
  }
  async function getQuote(event: React.FormEvent) {
    event.preventDefault();
    if (!c || !account || !window.ethereum || !ready) return;
    setError("");
    setQ(undefined);
    const ticket = ++epoch.current;
    try {
      const trade = parseTrade(
        c,
        side,
        amount,
        tip,
        recipient,
        slippage,
        inputDecimals,
      );
      if (
        data &&
        trade.amount > (side === "buy" ? data.ethBalance : data.tokenBalance)
      )
        throw Error(`Insufficient ${inputSymbol} balance. Reduce the amount.`);
      setQuoting(true);
      const result = await quote(c, trade, account, window.ethereum);
      if (epoch.current === ticket) setQ(result);
    } catch (e) {
      if (epoch.current === ticket) {
        setError(message(e));
        if (/recipient/.test(message(e))) recipientRef.current?.focus();
        else if (/slippage/.test(message(e))) slippageRef.current?.focus();
        else amountRef.current?.focus();
      }
    } finally {
      setQuoting(false);
    }
  }
  async function run(action: Action) {
    if (!c || !account || !window.ethereum || !ready) return;
    if (action !== "claim" && (!q || expired)) return;
    setBusy(true);
    setError("");
    setHash(undefined);
    setStatus("Checking current deployment and balances…");
    try {
      await transact(c, window.ethereum, account, action, q, (s, h) => {
        setStatus(s);
        if (h) setHash(h);
      });
      if (action === "swap") setQ(undefined);
      setRefreshKey((x) => x + 1);
    } catch (e) {
      setError(message(e));
      setStatus("Transaction was not completed.");
    } finally {
      setBusy(false);
    }
  }
  if (bootError)
    return (
      <main className="boot">
        <Mark />
        <h1>Deployment unavailable</h1>
        <p role="alert">{bootError}</p>
        <button onClick={() => location.reload()}>Reload configuration</button>
      </main>
    );
  if (!c)
    return (
      <main className="boot">
        <Mark />
        <h1>Swap Tip</h1>
        <p role="status">Verifying deployment configuration…</p>
      </main>
    );
  const explorer = c.deployment.network.explorer;
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div className="shell">
        <header>
          <a className="brand" href="#main" aria-label="Swap Tip home">
            <Mark />
            <span>
              swap<span className="brand-light">tip</span>
              <span className="brand-dot">.</span>
            </span>
          </a>
          <div className="header-actions">
            <span className="badge">
              <span className="dot" />
              {c.deployment.network.name} testnet
            </span>
            {account ? (
              <button
                className="wallet"
                onClick={() => {
                  setAccount(undefined);
                  invalidate();
                }}
                disabled={busy}
                title="Disconnect this page"
              >
                {short(account)} <span>Disconnect</span>
              </button>
            ) : (
              <button
                className="wallet"
                onClick={connect}
                disabled={walletBusy}
              >
                {walletBusy ? "Connecting…" : "Connect wallet"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
        </header>
        <main id="main">
          <div className="intro">
            <div>
              <p className="eyebrow">SMALL SWAPS. SHARED IMPACT.</p>
              <h1>
                A little goes
                <br /> a long way<span className="brand-dot">.</span>
              </h1>
              <p className="lead">
                Swap STIP. Add an ETH tip.
                <br /> Send a little appreciation to any address.
              </p>
            </div>
            <div className="intro-aside">
              <div className="seal" aria-hidden="true">
                <span>↗</span>
              </div>
              <p>
                Onchain kindness.
                <br />
                Entirely up to you.
              </p>
            </div>
          </div>
          <div className="workspace">
            <div className="overview">
              <section className="impact" aria-labelledby="impact-title">
                <div className="section-heading">
                  <h2 id="impact-title">A growing thank you</h2>
                  <span className="small">All-time pool tips</span>
                </div>
                <div className="total">
                  {data ? units(data.total) : "—"} <span>ETH</span>
                </div>
                <p>Sent to people, one swap at a time.</p>
                <div className="impact-footer">
                  <span>
                    <strong>
                      {historyComplete
                        ? aggregate(events, "tipper").length
                        : "—"}
                    </strong>{" "}
                    tippers
                  </span>
                  <span>
                    <strong>
                      {historyComplete
                        ? aggregate(events, "recipient").length
                        : "—"}
                    </strong>{" "}
                    recipients
                  </span>
                  <svg viewBox="0 0 144 66" aria-hidden="true">
                    <path d="M2 58h24V44h25V35h25V23h25V14h38" />
                    <path d="m129 4 10 10-10 10" />
                  </svg>
                </div>
              </section>
              <section className="price-strip" aria-label="Pool price">
                <div>
                  <span className="small">Pool spot price</span>
                  <p>
                    {data?.price
                      ? `1 ETH ≈ ${data.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} STIP`
                      : "Price unavailable"}
                  </p>
                </div>
                <span className="pill">ETH / STIP</span>
              </section>
              <section className="community" aria-labelledby="community-title">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">THE APPRECIATION BOARD</p>
                    <h2 id="community-title">Good things add up.</h2>
                  </div>
                  <span className="badge subtle">
                    {historyComplete
                      ? "Indexed history"
                      : historyLoading
                        ? "Indexing…"
                        : "History pending"}
                  </span>
                </div>
                <p className="small">
                  Ranked by ETH, from this pool’s Tipped events. Tipper
                  addresses are display labels, not verified identities.
                </p>
                <div className="boards">
                  <Board
                    title="Top tippers"
                    field="tipper"
                    events={events}
                    c={c}
                    complete={historyComplete}
                    loading={historyLoading}
                  />
                  <Board
                    title="Top recipients"
                    field="recipient"
                    events={events}
                    c={c}
                    complete={historyComplete}
                    loading={historyLoading}
                  />
                </div>
                <p className="index-status">
                  {history}{" "}
                  {!historyComplete && events.length > 0
                    ? "Rankings are partial."
                    : ""}
                </p>
              </section>
              <section className="how">
                <span className="how-mark" aria-hidden="true">
                  ✳
                </span>
                <div>
                  <h2>A tip, on your terms.</h2>
                  <p>
                    Choose 0–5% of the swap’s ETH leg. On a buy, the tip comes
                    out of your input. On a sell, it comes out of the ETH
                    proceeds. Recipients can claim their tips whenever they’re
                    ready.
                  </p>
                </div>
              </section>
            </div>
            <div className="actions-column">
              <section className="swap-card" aria-labelledby="swap-title">
                <div className="section-heading">
                  <h2 id="swap-title">Make a swap</h2>
                  <span className="small">Uniswap v4</span>
                </div>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Swap direction"
                >
                  {(["buy", "sell"] as const).map((s) => (
                    <button
                      type="button"
                      key={s}
                      aria-pressed={side === s}
                      disabled={busy}
                      onClick={() => {
                        setSide(s);
                        setAmount("");
                        invalidate();
                      }}
                    >
                      {s === "buy" ? "Buy STIP" : "Sell STIP"}
                    </button>
                  ))}
                </div>
                <form onSubmit={getQuote} noValidate>
                  <fieldset disabled={busy || quoting}>
                    <legend className="sr-only">Swap and tip settings</legend>
                    <div className="amount-box">
                      <div className="section-heading">
                        <label htmlFor="amount">You pay</label>
                        <span className="small">
                          Balance:{" "}
                          {account && data
                            ? units(
                                side === "buy"
                                  ? data.ethBalance
                                  : data.tokenBalance,
                                inputDecimals,
                              )
                            : "—"}
                        </span>
                      </div>
                      <div className="amount-entry">
                        <input
                          ref={amountRef}
                          id="amount"
                          name="amount"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => {
                            setAmount(e.target.value);
                            invalidate();
                          }}
                          aria-invalid={!!error && /amount|balance/.test(error)}
                          aria-describedby="form-error"
                        />
                        <span className="currency">
                          <span
                            className={side === "buy" ? "coin eth" : "coin"}
                            aria-hidden="true"
                          >
                            {side === "buy" ? "♦" : "S"}
                          </span>
                          {inputSymbol}
                        </span>
                      </div>
                    </div>
                    <div className="direction-arrow" aria-hidden="true">
                      ↓
                    </div>
                    <div className="receive-box">
                      <span className="small">You receive · estimated</span>
                      <div>
                        <strong>
                          {q ? units(q.out, outputDecimals) : "—"}
                        </strong>
                        <span>{outputSymbol}</span>
                      </div>
                    </div>
                    <div className="tip-box">
                      <div className="section-heading">
                        <label htmlFor="tip">Add a little appreciation</label>
                        <output htmlFor="tip">
                          {(tip / 100).toFixed(2).replace(/0$/, "")}%
                        </output>
                      </div>
                      <input
                        type="range"
                        id="tip"
                        min="0"
                        max="500"
                        step="25"
                        value={tip}
                        onChange={(e) => {
                          setTip(Number(e.target.value));
                          invalidate();
                        }}
                        aria-valuetext={`${tip / 100} percent tip`}
                      />
                      <div className="range-labels">
                        <span>No tip</span>
                        <span>5% maximum</span>
                      </div>
                    </div>
                    <label htmlFor="recipient" className="field-label">
                      Tip recipient <span>{tip ? "" : "(optional at 0%)"}</span>
                    </label>
                    <input
                      ref={recipientRef}
                      className="text-input mono"
                      id="recipient"
                      name="recipient"
                      placeholder="0x… recipient address"
                      value={recipient}
                      onChange={(e) => {
                        setRecipient(e.target.value);
                        invalidate();
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!!error && /recipient/.test(error)}
                      aria-describedby="recipient-help form-error"
                    />
                    <p id="recipient-help" className="hint">
                      Choose someone to thank. Double-check the address.
                    </p>
                    <div className="slippage-row">
                      <label htmlFor="slippage">Max. slippage</label>
                      <div>
                        <input
                          ref={slippageRef}
                          aria-invalid={!!error && /slippage/.test(error)}
                          id="slippage"
                          name="slippage"
                          inputMode="decimal"
                          value={slippage}
                          onChange={(e) => {
                            setSlippage(e.target.value);
                            invalidate();
                          }}
                          aria-describedby="slippage-help form-error"
                        />
                        <span>%</span>
                      </div>
                    </div>
                    <p id="slippage-help" className="sr-only">
                      Between 0.1 and 5 percent. The minimum output is enforced
                      onchain.
                    </p>
                  </fieldset>
                  {!account ? (
                    <button
                      type="button"
                      className="primary full"
                      onClick={connect}
                      disabled={walletBusy}
                    >
                      Connect wallet to swap <span aria-hidden="true">↗</span>
                    </button>
                  ) : !correctChain ? (
                    <button
                      type="button"
                      className="primary full"
                      onClick={switchNetwork}
                      disabled={walletBusy}
                    >
                      Switch to {c.deployment.network.name}
                    </button>
                  ) : (
                    <button
                      className={q && !expired ? "full" : "primary full"}
                      type="submit"
                      disabled={!ready || quoting || !data?.price}
                    >
                      {quoting
                        ? "Getting quote…"
                        : q
                          ? "Refresh quote"
                          : "Get quote"}{" "}
                      <span aria-hidden="true">↗</span>
                    </button>
                  )}
                  {account && !correctChain && (
                    <p className="warning">
                      Wrong network. Switch your wallet to{" "}
                      {c.deployment.network.name} to continue.
                    </p>
                  )}
                  {account && correctChain && !verified && (
                    <p className="hint">
                      A fresh deployment and balance check is required before a
                      transaction.
                    </p>
                  )}
                  {data && data.liquidity === 0n && (
                    <p className="warning">
                      No liquidity at the current price. A quote checks whether
                      liquidity is reachable.
                    </p>
                  )}
                  <p id="form-error" role="alert">
                    {error}
                  </p>
                </form>
                {q && (
                  <div className="quote-review">
                    <h3>Review your {side}</h3>
                    <dl>
                      <div>
                        <dt>Exact input</dt>
                        <dd>
                          {formatUnits(q.trade.amount, inputDecimals)}{" "}
                          {inputSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Minimum received</dt>
                        <dd>
                          {formatUnits(q.minimum, outputDecimals)}{" "}
                          {outputSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt>Tip</dt>
                        <dd>
                          {tip / 100}%{" "}
                          {tip
                            ? `to ${short(q.trade.recipient)}`
                            : "· no recipient"}
                        </dd>
                      </div>
                      <div>
                        <dt>Quote</dt>
                        <dd>
                          {expired
                            ? "Expired"
                            : `${Math.max(0, 60 - Math.floor((now - q.at) / 1000))}s remaining`}
                        </dd>
                      </div>
                    </dl>
                    {tip > 0 && (
                      <p className="small address-full">
                        Recipient: {q.trade.recipient}
                      </p>
                    )}
                    <p className="hint">
                      Network gas is extra.{" "}
                      {side === "buy"
                        ? "The tip is included in your ETH input."
                        : "The estimated ETH output is after the tip."}
                    </p>
                    {side === "sell" && (
                      <div className="approval-steps">
                        <p className="small">
                          Approve only{" "}
                          {formatUnits(q.trade.amount, inputDecimals)} STIP.
                          Router permission expires after 30 minutes.
                        </p>
                        <button
                          disabled={!ready || !freshQ || !needToken}
                          onClick={() => run("approveToken")}
                        >
                          {needToken
                            ? "1. Approve STIP for Permit2"
                            : "1. STIP approval ready"}
                        </button>
                        <button
                          disabled={
                            !ready || !freshQ || needToken || !needRouter
                          }
                          onClick={() => run("approveRouter")}
                        >
                          {needRouter
                            ? "2. Allow router spending"
                            : "2. Router approval ready"}
                        </button>
                      </div>
                    )}
                    <button
                      className="full confirm"
                      disabled={!ready || !freshQ || needToken || needRouter}
                      onClick={() => run("swap")}
                    >
                      {busy
                        ? "Transaction in progress…"
                        : `Confirm ${side === "buy" ? "buy" : "sell"} STIP`}
                    </button>
                    {expired && (
                      <p className="warning">
                        Quote expired. Refresh it before continuing.
                      </p>
                    )}
                  </div>
                )}
                <p className="swap-footnote">
                  Testnet tokens only · {c.deployment.pool.fee / 10000}% pool
                  fee
                </p>
              </section>
              <section className="claim-card" aria-labelledby="claim-title">
                <div className="section-heading">
                  <h2 id="claim-title">A thank you for you</h2>
                  <span aria-hidden="true">↙</span>
                </div>
                <p className="claim-amount">
                  {account && data ? units(data.claimable) : "—"}{" "}
                  <span>ETH to claim</span>
                </p>
                <p className="small">
                  {account
                    ? "Withdraw all tips owed to your connected address."
                    : "Connect your wallet to see your received tips."}
                </p>
                <button
                  className="full"
                  disabled={!ready || !data?.claimable}
                  onClick={() => run("claim")}
                >
                  {busy ? "Transaction in progress…" : "Claim ETH tips"}
                </button>
                {account && data && (
                  <div className="personal-stats">
                    <span>
                      Given <strong>{units(data.tipped)} ETH</strong>
                    </span>
                    <span>
                      Received <strong>{units(data.received)} ETH</strong>
                    </span>
                  </div>
                )}
              </section>
            </div>
          </div>
          <section
            className="feedback"
            aria-label="Connection and transaction status"
          >
            <div className="section-heading">
              <span className="small">
                {reading
                  ? "Refreshing pool data…"
                  : data
                    ? `Last read: block ${data.block.toLocaleString()} · ${Math.max(0, Math.floor((now - data.timestamp) / 1000))}s ago`
                    : "Pool data is not available yet."}
              </span>
              <button
                className="text-button"
                disabled={reading || busy}
                onClick={() => setRefreshKey((x) => x + 1)}
              >
                Refresh data ↻
              </button>
            </div>
            <p role="status">{status}</p>
            {hash && (
              <a
                href={`${explorer}/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction {short(hash)} ↗
              </a>
            )}
            {readError && (
              <p className="warning">{readError} Use Refresh data to retry.</p>
            )}
          </section>
          <details className="deployment-details">
            <summary>Pool & deployment details</summary>
            <div className="contract-links">
              {c.deployment.contracts.map((contract) => (
                <div key={contract.name}>
                  <span>{contract.name}</span>
                  <a
                    className="address-full"
                    href={`${explorer}/address/${contract.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {contract.address} ↗
                  </a>
                </div>
              ))}
              {(
                [
                  "poolManager",
                  "stateView",
                  "quoter",
                  "universalRouter",
                  "permit2",
                ] as const
              ).map((name) => (
                <div key={name}>
                  <span>{name}</span>
                  <a
                    className="address-full"
                    href={`${explorer}/address/${c.deployment.network.uniswapV4[name]}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {c.deployment.network.uniswapV4[name]} ↗
                  </a>
                </div>
              ))}
            </div>
            <p className="small">
              Quotes use the configured Uniswap quoter; swaps use Universal
              Router. Deployment code is checked before transactions. Tip
              recipients are supplied by the swapper and are not authenticated
              by the hook.
            </p>
            <a href="./imd-deployment.json">View deployment manifest ↗</a>
          </details>
        </main>
        <footer>
          <a className="brand" href="#main">
            <Mark />
            <span>swaptip.</span>
          </a>
          <p>A small gesture. An onchain record.</p>
          <a
            href={c.deployment.network.faucets[0]}
            target="_blank"
            rel="noreferrer"
          >
            Get test ETH ↗
          </a>
        </footer>
      </div>
    </>
  );
}
