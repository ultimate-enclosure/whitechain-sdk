<div align="center">
  <h1>WhiteChain SDK</h1>
  <p>
    <strong>A streamlined TypeScript SDK to interact with WhiteChain smart contracts.</strong>
  </p>
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
</div>

## 🌟 Overview

The WhiteChain SDK provides a minimal, typed, and future-friendly wrapper around WhiteChain contract actions and reads. Built on top of `viem`, it's designed to be lightweight and highly extensible.

## 📦 Installation

```bash
npm install whitechain-sdk viem
```

## 🚀 Quick Start

Initialize the client and start interacting with the network:

```ts
import { createWhiteChainClient } from 'whitechain-sdk'
import { http } from 'viem'
import { mainnet } from 'viem/chains'
import type { Abi, Address } from 'viem'

const client = createWhiteChainClient({
  chain: mainnet,
  transport: http('https://rpc.your.network'),
  addresses: { grant: '0xGrantContract' as Address },
  abis: { grant: /* your ABI */ {} as Abi },
  // account: yourAccount, // required for writes
})

// Read Operations
const round = await client.getGrantRound(1n)

// Write Operations (Requires account & ABI)
await client.submitApplication({ 
  grantId: 1n, 
  applicant: '0x...', 
  metadataUri: 'ipfs://...' 
})
```

## 🛠️ Supported Methods

- `createWhiteChainClient`
- `submitApplication`
- `approveApplication`
- `submitMilestoneEvidence`
- `approveMilestone`
- `releasePayout`
- `getGrantRound`
- `getGrantApplication`
- `getMilestones`

## 🔐 Crypto (secp256k1)

`whitechain-sdk/crypto` exposes low-level secp256k1 signing, verification, and public-key recovery, backed by a WebAssembly implementation (`tiny-secp256k1`) with an automatic, transparent fallback to a pure-JavaScript implementation (`@noble/curves`) in environments where WASM can't be loaded. The active backend is chosen lazily on first use and cached for the life of the process.

```ts
import { sign, verify, getPublicKey } from 'whitechain-sdk/crypto'

const publicKey = await getPublicKey(privateKey)
const signature = await sign(messageHash, privateKey) // { r, s, recovery }
const isValid = await verify(messageHash, signature, publicKey)
```

Both backends produce identical, low-S-normalized, RFC6979-deterministic output for the same input — the WASM path is purely a performance optimization, never a behavioral change.

## 🔒 Offline Transaction Signing (Cold Storage)

`whitechain-sdk/security` exposes `OfflineSigner`, a dedicated signer for **air-gapped** environments — machines with no network connection at all, such as a cold-storage laptop or hardware-adjacent signing device. It constructs and signs legacy and EIP-1559 transactions using only values you supply directly.

**Zero network dependencies, by construction:** `OfflineSigner` does not accept a provider, transport, public client, wallet client, RPC URL, chain RPC configuration, or SDK context of any kind — there is no parameter slot for one. It never calls `fetch`, `XMLHttpRequest`, `WebSocket`, an HTTP library, a viem client action, or a network-discovery function, and it never calls `getNetwork`, `getChainId`, `getTransactionCount`, `estimateGas`, `getGasPrice`, `estimateFeesPerGas`, `prepareTransactionRequest`, or any other helper that could silently fill in a missing field via RPC. Every field must come from you; a missing or invalid one fails immediately and locally with a `ValidationError`, never a network error.

### The three-stage air-gapped workflow

**1. Online preparation** *(internet-connected machine)*
- Fetch the account's next nonce, the current chain ID, an appropriate gas limit, and current fee data (`maxFeePerGas`/`maxPriorityFeePerGas`, or `gasPrice` for a legacy transaction).
- Assemble these into a plain, unsigned transaction object.
- Transfer **only this unsigned transaction data** to the offline environment (QR code, USB drive, manual entry) — never the private key in the other direction.

**2. Offline signing** *(air-gapped machine, no network connection)*
- Import or otherwise securely provide the private key to this machine.
- Construct an `OfflineSigner` with it.
- Call `signTransaction(...)`, passing only the manually supplied values from stage 1.
- Export the resulting raw signed transaction hex.
- The private key never leaves this machine — it is never transmitted, logged, or included in any error message.

**3. Online broadcast** *(internet-connected machine)*
- Transfer only the signed raw transaction hex back — never the private key.
- Broadcast it via `eth_sendRawTransaction` (or `publicClient.sendRawTransaction({ serializedTransaction })`) on any online node.
- A successfully *signed* transaction can still fail at this stage: if the nonce, fee levels, account balance, or other chain state changed between stage 1 and stage 3 (for example, another transaction from the same account was mined in between), the node may reject it. Re-run stage 1 with fresh values if that happens.

```ts
import { OfflineSigner } from 'whitechain-sdk/security'

// Stage 2 — air-gapped machine. `privateKey` never leaves this process.
const signer = new OfflineSigner(privateKey) // 0x-prefixed hex or Uint8Array

const signed = await signer.signTransaction({
  type: 'eip1559',
  chainId: 1,
  nonce: 12,                          // from stage 1, supplied by you
  to: '0xRecipient...',
  value: 1_000000000_000000000n,      // 1 ETH, in wei
  gas: 21_000n,                       // from stage 1, supplied by you
  maxFeePerGas: 30_000000000n,        // from stage 1, supplied by you
  maxPriorityFeePerGas: 2_000000000n, // required — no RPC to estimate a default from
})

// signed.raw is the payload for stage 3 — hand it to an online node:
// await publicClient.sendRawTransaction({ serializedTransaction: signed.raw })
console.log(signed.raw)   // 0x02...  (ready to broadcast)
console.log(signed.hash)  // keccak256(signed.raw) — matches eth_sendRawTransaction's return value
console.log(signed.from)  // the address that produced the signature
```

Legacy (pre-EIP-1559) transactions are supported the same way, priced with `gasPrice` instead of `maxFeePerGas`/`maxPriorityFeePerGas`:

```ts
const signed = await signer.signTransaction({
  chainId: 1,
  nonce: 12,
  to: '0xRecipient...',
  value: 0n,
  gas: 21_000n,
  gasPrice: 20_000000000n,
})
```

Contract creation is supported by omitting `to` (or passing `null`) alongside deployment `data` — this is only ever intentional, since a normal transfer or call always specifies `to`.

All fields are validated locally and strictly: private key format/length, `chainId`/`nonce` as safe integers, a positive `gas` limit, non-negative fee/value fields, `maxFeePerGas >= maxPriorityFeePerGas`, address format/checksum, and well-formed hex call data. Every failure throws `ValidationError` synchronously or via a rejected promise — never a network error, since no network call is ever made.

### ⚠️ Security warning

`OfflineSigner` guarantees that the **signing step itself** performs no network I/O — that guarantee is enforced in code and covered by tests. It **cannot** guarantee the security of anything around that step: the operating system on the air-gapped machine, the removable media used to move data across the gap, how or where the private key is generated and stored, or the physical transfer process. Those remain entirely your responsibility. Treat the offline machine as if it will eventually be compromised, and design your key-management practices accordingly.

## ✍️ EIP-712 Offline Signature Verification (Permits)

The protocol authenticates **gasless transactions** (ERC-20 permits) and **identity assertions** with [EIP-712](https://eips.ethereum.org/EIPS/eip-712) signed messages. Structuring these messages by hand is where integration bugs happen — a wrong domain separator, a mis-ordered type array, or a non-normalized signature all produce silent signature rejections on chain. The SDK's `src/utils/signatures.ts` module centralises the protocol's standard domain variables and provides native helpers to build, hash, and — critically — **independently verify** a permit signature before it is broadcast to the backend. Verification is fully offline: no provider, no RPC, no network I/O.

### Protocol-standard domain variables

`WHITECHAIN_EIP712` defines the domain the permit-enabled Whitelotus token contract expects. Every builder default derives from it; pass explicit overrides when targeting a different contract, chain, or version:

| Variable | Default | Meaning |
|---|---|---|
| `name` | `'Whitelotus'` | EIP-712 domain name |
| `version` | `'1'` | EIP-712 domain version |
| `chainId` | `1875` | WhiteChain mainnet |
| `testnetChainId` | `2625` | WhiteChain testnet |

### Building and verifying a permit

```ts
import { buildPermitPayload, verifySignature, recoverPermitSigner } from 'whitechain-sdk/utils'
// or from the root: import { buildPermitPayload, verifySignature } from 'whitechain-sdk'

// 1. Build the payload — matches what the contract recomputes in permit().
const payload = buildPermitPayload(
  owner,            // the signer
  spender,          // address granted the allowance
  1_000_000_000_000_000_000n, // 1 token, in wei
  deadline,         // unix seconds; the contract enforces expiry, not the builder
  nonce,            // current nonces(owner) from the token contract
  {
    verifyingContract: tokenAddress, // required — anchors the signature to the contract
    // name/version/chainId default to WHITECHAIN_EIP712; override per deployment:
    // chainId: WHITECHAIN_EIP712.testnetChainId,
  },
)

// 2. Have the owner sign it (any EIP-712 wallet or viem account).
const signature = await account.signTypedData(payload) // 0x + 130 hex chars

// 3. Verify before broadcasting — offline, returns true/false.
const valid = await verifySignature(payload, signature, owner)
if (!valid) throw new Error('Signature does not match the expected signer')

// Optional: recover the signer without knowing who to expect.
const recovered = await recoverPermitSigner(payload, signature) // → owner
```

`verifySignature` also accepts a split `{ r, s, v }` signature object (v as `27/28` or `0/1`, `number` or `bigint`, or via `yParity`), matching what viem, ethers, and EIP-1193 providers return.

### Debugging a rejected signature

`hashPermitPayload(payload)` returns the exact digest the contract recomputes in `permit()` — `keccak256("\x19\x01" ‖ domainSeparator ‖ structHash)`. Compare it against your backend's value to isolate whether a rejection comes from a payload mismatch or a bad signature:

```ts
import { hashPermitPayload } from 'whitechain-sdk/utils'
const digest = hashPermitPayload(payload)
```

### Anti-malleability

EIP-712 signatures on secp256k1 have two equivalent forms: low-s (what the protocol's contracts accept) and high-s. Accepting the high-s variant would let an attacker substitute an equivalent signature for the same digest. `verifySignature` and `recoverPermitSigner` therefore **reject high-s signatures outright** with a `ValidationError` (the exported `SECP256K1_HALF_ORDER` constant backs the check). Malformed payloads and malformed signatures (bad length, bad `v`, zero `r`/`s`) fail fast with a `ValidationError` as well — a well-formed signature that simply doesn't match returns `false`.

## 🌉 Cross-Chain State Proof Verifier

`whitechain-sdk/crypto` also exposes a local verifier for Ethereum [EIP-1186](https://eips.ethereum.org/EIPS/eip-1186) account and storage proofs — the Merkle Patricia Trie proofs a cross-chain bridge uses to prove "this account/storage slot had this value" against a specific chain state, without trusting the node that served the data.

**Verified against a `stateRoot`, never a block hash.** A block hash identifies a block; it is not itself a trie root. Callers must supply the block's trusted `stateRoot` explicitly (e.g. from a header they've already verified elsewhere) — this module never fetches a block header and has no parameter slot for a block hash in its place.

**Zero network dependencies, by construction, same as `OfflineSigner`:** verification runs entirely over the proof data you already have in hand (typically the result of an `eth_getProof` call made elsewhere). There is no RPC, HTTP, provider, transport, walletClient, or publicClient involved — never `fetch`, never a viem client action. This is enforced in code and covered by the same style of static + runtime network-stubbing tests as `OfflineSigner`.

```ts
import { verifyEIP1186Proof, isValidStateProof } from 'whitechain-sdk/crypto'

// `proof` is the (unmodified) result of an `eth_getProof` JSON-RPC call —
// fetched by your own RPC client, wherever that lives; this function never
// makes that call itself.
const proof = await publicClient.request({
  method: 'eth_getProof',
  params: [address, [storageSlot], blockNumber],
})

// `stateRoot` must come from a source you trust independently — e.g. a
// block header you've already validated (its `stateRoot` field), not from
// the same untrusted RPC response you're trying to verify.
const result = verifyEIP1186Proof(trustedStateRoot, proof)

if (result.valid) {
  // result.account and result.storageProofs[i].result each carry
  // `{ valid: true, kind: 'inclusion' | 'exclusion' }` — an exclusion
  // result proves the account/slot is *absent*, which is just as
  // meaningful to a bridge as a proven value.
}

// Or, if you only need a pass/fail:
const ok = isValidStateProof(trustedStateRoot, proof)
```

`verifyAccountProof`/`verifyStorageProof` are also exported individually for verifying just one half of a proof (e.g. an account proof with no storage slots requested). All four functions return a structured result rather than a plain boolean by default — `{ valid: false, reason }` tells you *why* a proof failed (hash mismatch, value mismatch, malformed encoding, oversized input) rather than collapsing everything to `false`.

## 🔌 Plugin System

The SDK ships a first-class plugin architecture so community developers can extend the `WhitechainSDK` instance with custom namespaces — NFT marketplace helpers, lending calculators, analytics modules — without forking the core SDK or adding bloat to the core bundle.

### Core concepts

| Concept | Description |
|---|---|
| `WhitechainSDK` | The extensible host class. Accepts plugins at construction time or dynamically via `.use()`. |
| `ISDKPlugin` | Interface every plugin must implement: `name`, `version`, and `onInitialize(ctx)`. |
| `SDKContext` | Read-only view of SDK internals (`publicClient`, `walletClient`, `network`, `logger`) passed to `onInitialize`. |
| `WhitechainSDKPlugins` | Open interface for TypeScript declaration merging — augment it to add IDE autocomplete for your plugin's namespace. |

### Quick start

```ts
import { WhitechainSDK, type ISDKPlugin, type SDKContext } from 'whitechain-sdk'
import { networks } from 'whitechain-sdk'

// 1. Define a plugin
const marketplacePlugin: ISDKPlugin = {
  name: 'marketplace',
  version: '1.0.0',
  onInitialize(ctx: SDKContext) {
    return {
      async buyNFT(tokenId: bigint) {
        ctx.logger.info(`Purchasing NFT #${tokenId}`)
        // use ctx.publicClient / ctx.walletClient to call contracts
      },
    }
  },
}

// 2. Type-augment the SDK (in a .d.ts file or at the top of your plugin package)
declare module 'whitechain-sdk' {
  interface WhitechainSDKPlugins {
    marketplace: { buyNFT(tokenId: bigint): Promise<void> }
  }
}

// 3. Create the SDK — plugins are awaited before the factory resolves
const sdk = await WhitechainSDK.create(
  { network: networks.whitechainMainnet },
  [marketplacePlugin],
)

// 4. Call the plugin — fully typed, IDE autocomplete included
await sdk.marketplace.buyNFT(42n)
```

### Passing plugins at construction vs. dynamically

```ts
// At construction time (recommended)
const sdk = await WhitechainSDK.create(config, [pluginA, pluginB])

// Dynamically after construction
await sdk.use(pluginC)

// Chainable
await sdk.use(pluginD).then(s => s.use(pluginE))
```

### Accessing SDK internals from a plugin

`onInitialize` receives a frozen `SDKContext` object — the only surface plugins should interact with:

```ts
const myPlugin: ISDKPlugin = {
  name: 'myPlugin',
  version: '0.1.0',
  onInitialize({ publicClient, walletClient, network, logger }) {
    logger.info(`Plugin loaded on chain ${network?.chainId}`)
    return {
      getBalance: (addr: `0x${string}`) =>
        publicClient.getBalance({ address: addr }),
    }
  },
}
```

| Field | Type | Notes |
|---|---|---|
| `publicClient` | `PublicClient` | Always present. Use for reads and `eth_call`. |
| `walletClient` | `WalletClient \| undefined` | Present only when an `account` was provided to the SDK. |
| `network` | `NetworkProfile \| undefined` | Chain name, RPC URL, explorer URL, etc. |
| `logger` | `SDKLogger` | Structured logger — `info`, `warn`, `error`, `debug`. |

### Async initialization

Plugins may perform async work (fetch on-chain config, resolve ENS, etc.) in `onInitialize`. Use `WhitechainSDK.create()` to ensure all hooks are fully settled before the instance is returned:

```ts
const heavyPlugin: ISDKPlugin = {
  name: 'heavy',
  version: '1.0.0',
  async onInitialize(ctx) {
    const config = await ctx.publicClient.readContract({ /* ... */ })
    return { config }
  },
}

const sdk = await WhitechainSDK.create(config, [heavyPlugin])
// sdk.heavy.config is ready here — no race conditions
```

### Inspecting loaded plugins

```ts
console.log(sdk.getPlugins())
// [ { name: 'marketplace', version: '1.0.0' }, ... ]
```

### Plugin authoring guide

1. Export an object (or class instance) that satisfies `ISDKPlugin`.
2. Choose a unique `name` — it becomes the property key on the SDK instance. Avoid collisions with `publicClient`, `walletClient`, `network`, `logger`, `use`, and `getPlugins`.
3. Augment `WhitechainSDKPlugins` in your package's `index.d.ts` so consumers get full IDE support.
4. Keep the plugin self-contained. Do not import SDK internals directly — only use what `SDKContext` exposes.
5. The core bundle is **not affected** by external plugins; plugins are loaded lazily at runtime and contribute zero bytes to the base bundle.

## 🏗️ Design Philosophy

**Omitted By Design** to keep the SDK fast and secure:
- Extensive query abstractions
- Advanced metadata tooling
- Broad chain support (focused strictly on WhiteChain)
- Complex caching layers
- Large helper libraries

**Extending the SDK**:
- Keep the public API small and strongly typed.
- Add new actions/reads near the existing ones in `src/client.ts`.
- Reuse existing patterns: clean parameter objects, simple error messages.

## 💻 Development

Available scripts for local development:

- `npm run build` – Typecheck and emit ESM to `dist/`
- `npm run typecheck` – Typecheck only
- `npm run test` – Run unit tests via Vitest
- `npm run bench` – Benchmark the WASM vs JS secp256k1 signer (requires `npm run build` first)

### 🧪 Foundry Invariant & Stateful Fuzzing Suite

We utilize [Foundry](https://book.getfoundry.sh/) to perform deep stateful invariant testing on core AMM and Vault smart contracts. The fuzzing suite bombards contracts with random input sequences to ensure critical economic invariants hold true unconditionally across state space transitions.

To run the invariant test suite:

```bash
forge test --match-path "test/invariants/*"
```

#### Key Invariants Tested

- **Constant Product Formula (`x * y >= k`)**: Proves that AMM swaps (including 0.3% fee accrual) never decrease total pool constant $k$.
- **Vault Asset Solvency (`totalShares <= totalAssets`)**: Ensures share minting never exceeds underlying asset reserves.
- **User Balance Boundary (`userBalance <= totalSupply`)**: Verifies no single user's LP or Vault share balance exceeds overall contract total supply.
- **Graceful Revert Handling**: Ensures zero-amount swap attempts and invalid inputs revert gracefully without breaking stateful fuzz runs.

#### Configuration (`foundry.toml`)

- **Runs**: 10,000 random input sequences per invariant.
- **Depth**: 500 call transitions per run.
- **Revert Policy**: `fail_on_revert = false` (handled via stateful `Handler.sol`).

### 🧪 Foundry Invariant & Stateful Fuzzing Suite

We utilize [Foundry](https://book.getfoundry.sh/) to perform deep stateful invariant testing on core AMM and Vault smart contracts. The fuzzing suite bombards contracts with random input sequences to ensure critical economic invariants hold true unconditionally across state space transitions.

To run the invariant test suite:

```bash
forge test --match-path "test/invariants/*"
```

#### Key Invariants Tested

- **Constant Product Formula (`x * y >= k`)**: Proves that AMM swaps (including 0.3% fee accrual) never decrease total pool constant $k$.
- **Vault Asset Solvency (`totalShares <= totalAssets`)**: Ensures share minting never exceeds underlying asset reserves.
- **User Balance Boundary (`userBalance <= totalSupply`)**: Verifies no single user's LP or Vault share balance exceeds overall contract total supply.
- **Graceful Revert Handling**: Ensures zero-amount swap attempts and invalid inputs revert gracefully without breaking stateful fuzz runs.

#### Configuration (`foundry.toml`)

- **Runs**: 10,000 random input sequences per invariant.
- **Depth**: 500 call transitions per run.
- **Revert Policy**: `fail_on_revert = false` (handled via stateful `Handler.sol`).

### 🧪 Foundry Invariant & Stateful Fuzzing Suite

We utilize [Foundry](https://book.getfoundry.sh/) to perform deep stateful invariant testing on core AMM and Vault smart contracts. The fuzzing suite bombards contracts with random input sequences to ensure critical economic invariants hold true unconditionally across state space transitions.

To run the invariant test suite:

```bash
forge test --match-path "test/invariants/*"
```

#### Key Invariants Tested

- **Constant Product Formula (`x * y >= k`)**: Proves that AMM swaps (including 0.3% fee accrual) never decrease total pool constant $k$.
- **Vault Asset Solvency (`totalShares <= totalAssets`)**: Ensures share minting never exceeds underlying asset reserves.
- **User Balance Boundary (`userBalance <= totalSupply`)**: Verifies no single user's LP or Vault share balance exceeds overall contract total supply.
- **Graceful Revert Handling**: Ensures zero-amount swap attempts and invalid inputs revert gracefully without breaking stateful fuzz runs.

#### Configuration (`foundry.toml`)

- **Runs**: 10,000 random input sequences per invariant.
- **Depth**: 500 call transitions per run.
- **Revert Policy**: `fail_on_revert = false` (handled via stateful `Handler.sol`).

## 🤝 Contributing

We strongly believe in open-source and welcome contributions from the community!

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add some amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

Please review our [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.


## 🛡️ Security

For security policies and vulnerability reporting, please refer to [SECURITY.md](SECURITY.md).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## API Documentation

HTML API docs are generated from TypeScript sources with [TypeDoc](https://typedoc.org/):

```bash
npm run docs
# output ? ./docs (open docs/index.html)
```

On every release tag (`v*`), GitHub Actions rebuilds TypeDoc and deploys to **GitHub Pages**
(see `.github/workflows/docs.yml`).

