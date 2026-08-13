import { createPublicClient, createWalletClient, http, type Address, type Abi, type Hash } from 'viem'
import {
  WhiteChainConfig,
  ClientDeps,
  SubmitApplicationParams,
  ApproveApplicationParams,
  SubmitMilestoneEvidenceParams,
  ApproveMilestoneParams,
  ReleasePayoutParams,
  GrantRound,
  GrantApplication,
  Milestone,
} from './types.js'
import { WhiteChainError, ValidationError } from './errors/index.js'
import { parseContractError } from './utils/errorHandler.js'
import { formatBigIntToString } from './utils/formatters.js'
import { networks, type NetworkProfile } from './config/networks.js'
import { Eip1193Provider } from './providers/BrowserProvider.js'
import { withGasEstimation, type WithGasEstimation } from './core/TransactionHelper.js'
import { NetworkContext } from './core/NetworkContext.js'
import { Simulator } from './services/Simulator.js'
import type { SimulationResult, SimulationOptions } from './types/simulation.js'
import type { NetworkProfile } from './config/networks.js'
import { Eip1193Provider } from './providers/BrowserProvider.js'
import { withGasEstimation, type WithGasEstimation } from './core/TransactionHelper.js'
import { NetworkContext } from './core/NetworkContext.js'

const ensure = <T>(value: T | undefined, message: string): T => {
  if (value === undefined || value === null) throw new ValidationError(message)
  return value
}

/**
 * A configured client for reading and writing to WhiteChain's grant round
 * contract. Construct one with {@link createWhiteChainClient}.
 */
export type WhiteChainClient = {
  /** The currently active public client. Automatically updates on network switch. */
  get publicClient(): any
  /** The currently active wallet client. Automatically updates on network switch. */
  get walletClient(): any | undefined
  /** Contract addresses this client was configured with. */
  get addresses(): { grant: Address }
  /** Contract ABIs this client was configured with. */
  get abis(): { grant?: Abi }
  /** Optional network profile associated with this client instance. */
  get network(): NetworkProfile | undefined
  /** Standard block explorer URL associated with this client instance. */
  get blockExplorerUrl(): string | undefined

  /** Exposes the underlying reactive network context. */
  networkContext: NetworkContext

  /**
   * Switches the active network provider dynamically without destroying the client.
   *
   * @param chainId - Numeric chain identifier registered in `networks`.
   * @returns Resolves when the public and wallet clients have been rebuilt for the new network.
   * @throws {WhiteChainError} if the chainId is not found in the registry.
   *
   * @example
   * ```ts
   * await client.switchNetwork(11155111)
   * console.log(client.network?.name)
   * ```
   */
  switchNetwork(chainId: number): Promise<void>

  /**
   * Dry-runs a transaction against the node's current state to validate outcomes
   * before signing (e.g., checking for expected token transfers or revert reasons).
   *
   * @param tx - Transaction request to simulate.
   * @param options - Optional simulation controls such as state overrides.
   * @returns A decoded simulation result with success, gas, and revert metadata.
   *
   * @example
   * ```ts
   * const result = await client.simulateTransaction({
   *   to: client.addresses.grant,
   *   data: encodedCall,
   * })
   * if (!result.success) console.warn(result.error)
   * ```
   */
  simulateTransaction(
    tx: { to: Address; data: string; from?: Address; value?: bigint },
    options?: SimulationOptions
  ): Promise<SimulationResult>

  /**
   * Submits a new grant application on behalf of `applicant`.
   * @throws {WhiteChainError} if the client has no signing account, or no `abis.grant` was provided.
   * @returns The transaction hash.
   */
  submitApplication: WithGasEstimation<SubmitApplicationParams>

  /**
   * Approves a pending grant application.
   * @throws {WhiteChainError} if the client has no signing account, or no `abis.grant` was provided.
   * @returns The transaction hash.
   */
  approveApplication: WithGasEstimation<ApproveApplicationParams>

  /**
   * Submits evidence for a milestone.
   * @throws {WhiteChainError} if the client has no signing account, or no `abis.grant` was provided.
   * @returns The transaction hash.
   */
  submitMilestoneEvidence: WithGasEstimation<SubmitMilestoneEvidenceParams>

  /**
   * Approves previously submitted milestone evidence.
   * @throws {WhiteChainError} if the client has no signing account, or no `abis.grant` was provided.
   * @returns The transaction hash.
   */
  approveMilestone: WithGasEstimation<ApproveMilestoneParams>

  /**
   * Releases the payout for an approved milestone to its grantee.
   * @throws {WhiteChainError} if the client has no signing account, or no `abis.grant` was provided.
   * @returns The transaction hash.
   */
  releasePayout: WithGasEstimation<ReleasePayoutParams>

  /**
   * Reads a grant round's current status and application count.
   *
   * @param grantId - On-chain grant round identifier.
   * @returns The grant round status with bigint fields formatted as strings.
   * @throws {WhiteChainError} if no `abis.grant` was provided.
   *
   * @example
   * ```ts
   * const round = await client.getGrantRound(1n)
   * console.log(round.status, round.applicationsCount)
   * ```
   */
  getGrantRound(grantId: bigint): Promise<GrantRound>

  /**
   * Reads a grant application's current state.
   *
   * @param applicationId - On-chain grant application identifier.
   * @returns Applicant, status, and metadata URI for the application.
   * @throws {WhiteChainError} if no `abis.grant` was provided.
   *
   * @example
   * ```ts
   * const application = await client.getGrantApplication(42n)
   * if (application.status === 'approved') {
   *   console.log(application.applicant)
   * }
   * ```
   */
  getGrantApplication(applicationId: bigint): Promise<GrantApplication>

  /**
   * Reads all milestones defined for a grant application.
   *
   * @param applicationId - On-chain grant application identifier.
   * @returns Milestones with normalized status names and string IDs.
   * @throws {WhiteChainError} if no `abis.grant` was provided.
   *
   * @example
   * ```ts
   * const milestones = await client.getMilestones(42n)
   * for (const milestone of milestones) {
   *   console.log(milestone.id, milestone.status)
   * }
   * ```
   */
  getMilestones(applicationId: bigint): Promise<Milestone[]>
}

const defaultTransport = http()

/**
 * Builds a {@link WhiteChainClient} for reading and writing to WhiteChain's
 * grant round contract.
 *
 * @param config - Network, transport, contract, ABI, and optional signing-account configuration.
 * @returns A configured WhiteChain client with read, write, simulation, and network-switch helpers.
 *
 * @example
 * ```ts
 * import { createWhiteChainClient } from 'whitechain-sdk'
 * import { http } from 'viem'
 *
 * const client = createWhiteChainClient({
 *   chain,
 *   transport: http('https://rpc.example'),
 *   addresses: { grant: grantAddress },
 *   abis: { grant: grantAbi },
 * })
 *
 * const round = await client.getGrantRound(1n)
 * ```
 *
 * Pass an `account` in `config` to enable write methods (submitting
 * applications, approving, releasing payouts); omit it to get a read-only
 * client — calling a write method on it throws a {@link WhiteChainError}.
 */
export function createWhiteChainClient(config: WhiteChainConfig & { provider?: any }): WhiteChainClient {
  const network = config.network
  const blockExplorerUrl = config.blockExplorerUrl ?? network?.blockExplorerUrl
  const initialNetwork = config.network
  const blockExplorerUrl = config.blockExplorerUrl ?? initialNetwork?.blockExplorerUrl
  const transport =
    config.transport ??
    (network
      ? http(network.rpcUrl)
  const initialNetwork = config.network
  const blockExplorerUrl = config.blockExplorerUrl ?? initialNetwork?.blockExplorerUrl
  const transport =
    config.transport ??
    (initialNetwork
      ? http(initialNetwork.rpcUrl)
      : config.provider
      ? (config.provider instanceof Eip1193Provider
          ? config.provider
          : new Eip1193Provider(config.provider)
        ).toTransport()
      : defaultTransport)
  const chain = config.chain ?? network?.chain
  const chain = config.chain ?? initialNetwork?.chain

  const initialPublicClient =
    config.clients?.publicClient ??
    createPublicClient({ chain: chain as any, transport })
  const initialWalletClient =
    config.clients?.walletClient ??
    (config.account
      ? createWalletClient({ chain: chain as any, transport, account: config.account })
      : undefined)

  const addresses = config.addresses
  const abis = config.abis ?? {}

  const networkContext = new NetworkContext({
    chainId: initialNetwork?.chainId,
    publicClient: initialPublicClient as any,
    walletClient: initialWalletClient as any,
    addresses: addresses as Record<string, Address>,
  })

  const getPublicClient = () => networkContext.getState().publicClient
  const getWalletClient = () => networkContext.getState().walletClient
  const getAddresses = () => networkContext.getState().addresses as { grant: Address }
  const getAbi = () => abis.grant as Abi

  const requireWallet = () => ensure(getWalletClient(), 'Wallet client is required for write actions')
  const requireGrantAbi = () => ensure(abis.grant, 'Grant contract ABI must be provided in config.abis.grant')

  return {
    networkContext,

    get publicClient() { return networkContext.getState().publicClient },
    get walletClient() { return networkContext.getState().walletClient },
    get addresses() { return networkContext.getState().addresses as { grant: Address } },
    get abis() { return abis as { grant?: Abi } },
    get network() {
      const currentChainId = networkContext.getState().chainId;
      return currentChainId ? Object.values(networks).find(n => n.chainId === currentChainId) : undefined;
    },
    get blockExplorerUrl() { return blockExplorerUrl },

    async switchNetwork(chainId: number) {
      const newNetwork = Object.values(networks).find(n => n.chainId === chainId);
      if (!newNetwork) throw new WhiteChainError(`Network with chainId ${chainId} not found in registry`);

      // Using generic http transport for the new network
      const newTransport = http(newNetwork.rpcUrl);
      const newPublicClient = createPublicClient({ chain: newNetwork.chain as any, transport: newTransport });
      
      let newWalletClient;
      if (config.account) {
        newWalletClient = createWalletClient({ chain: newNetwork.chain as any, transport: newTransport, account: config.account });
      }

      networkContext.setNetwork({
        chainId: newNetwork.chainId,
        publicClient: newPublicClient as any,
        walletClient: newWalletClient as any,
        addresses: networkContext.getState().addresses,
      });
    },

    async simulateTransaction(tx, options) {
      const simulator = new Simulator(networkContext.getState().publicClient);
      // We pass the grant contract ABI by default so it can decode grant errors natively
      return simulator.simulateTransaction(tx, abis.grant, options);
    async submitApplication({ grantId, applicant, metadataUri }) {
      const wc = requireWallet()
      const abi = requireGrantAbi()
      return (wc as any).writeContract({
        chain: config.chain as any,
        address: addresses.grant,
        abi,
        functionName: 'submitApplication',
        args: [grantId, applicant, metadataUri],
      } as any)
    },

    async approveApplication({ applicationId }) {
      const wc = requireWallet()
      const abi = requireGrantAbi()
      return (wc as any).writeContract({
        chain: config.chain as any,
        address: addresses.grant,
        abi,
        functionName: 'approveApplication',
        args: [applicationId],
      } as any)
    },

    async submitMilestoneEvidence({ milestoneId, evidenceUri }) {
      const wc = requireWallet()
      const abi = requireGrantAbi()
      return (wc as any).writeContract({
        chain: config.chain as any,
        address: addresses.grant,
        abi,
        functionName: 'submitMilestoneEvidence',
        args: [milestoneId, evidenceUri],
      } as any)
    },

    async approveMilestone({ milestoneId }) {
      const wc = requireWallet()
      const abi = requireGrantAbi()
      return (wc as any).writeContract({
        chain: config.chain as any,
        address: addresses.grant,
        abi,
        functionName: 'approveMilestone',
        args: [milestoneId],
      } as any)
    },

    async releasePayout({ milestoneId }) {
      const wc = requireWallet()
      const abi = requireGrantAbi()
      return (wc as any).writeContract({
        chain: config.chain as any,
        address: addresses.grant,
        abi,
        functionName: 'releasePayout',
        args: [milestoneId],
      } as any)
    },
    submitApplication: withGasEstimation(
      async ({ grantId, applicant, metadataUri }) => {
        const wc = requireWallet()
        const abi = requireGrantAbi()
        const addresses = getAddresses()
        try {
          return await (wc as any).writeContract({
            address: addresses.grant,
            abi,
            functionName: 'submitApplication',
            args: [grantId, applicant, metadataUri],
          } as any)
        } catch (err) {
          throw parseContractError(err, abi as Abi)
        }
      },
      getPublicClient,
      () => getAddresses().grant,
      getAbi,
      'submitApplication',
      (params) => [params.grantId, params.applicant, params.metadataUri]
    ),

    approveApplication: withGasEstimation(
      async ({ applicationId }) => {
        const wc = requireWallet()
        const abi = requireGrantAbi()
        const addresses = getAddresses()
        try {
          return await (wc as any).writeContract({
            address: addresses.grant,
            abi,
            functionName: 'approveApplication',
            args: [applicationId],
          } as any)
        } catch (err) {
          throw parseContractError(err, abi as Abi)
        }
      },
      getPublicClient,
      () => getAddresses().grant,
      getAbi,
      'approveApplication',
      (params) => [params.applicationId]
    ),

    submitMilestoneEvidence: withGasEstimation(
      async ({ milestoneId, evidenceUri }) => {
        const wc = requireWallet()
        const abi = requireGrantAbi()
        const addresses = getAddresses()
        try {
          return await (wc as any).writeContract({
            address: addresses.grant,
            abi,
            functionName: 'submitMilestoneEvidence',
            args: [milestoneId, evidenceUri],
          } as any)
        } catch (err) {
          throw parseContractError(err, abi as Abi)
        }
      },
      getPublicClient,
      () => getAddresses().grant,
      getAbi,
      'submitMilestoneEvidence',
      (params) => [params.milestoneId, params.evidenceUri]
    ),

    approveMilestone: withGasEstimation(
      async ({ milestoneId }) => {
        const wc = requireWallet()
        const abi = requireGrantAbi()
        const addresses = getAddresses()
        try {
          return await (wc as any).writeContract({
            address: addresses.grant,
            abi,
            functionName: 'approveMilestone',
            args: [milestoneId],
          } as any)
        } catch (err) {
          throw parseContractError(err, abi as Abi)
        }
      },
      getPublicClient,
      () => getAddresses().grant,
      getAbi,
      'approveMilestone',
      (params) => [params.milestoneId]
    ),

    releasePayout: withGasEstimation(
      async ({ milestoneId }) => {
        const wc = requireWallet()
        const abi = requireGrantAbi()
        const addresses = getAddresses()
        try {
          return await (wc as any).writeContract({
            address: addresses.grant,
            abi,
            functionName: 'releasePayout',
            args: [milestoneId],
          } as any)
        } catch (err) {
          throw parseContractError(err, abi as Abi)
        }
      },
      getPublicClient,
      () => getAddresses().grant,
      getAbi,
      'releasePayout',
      (params) => [params.milestoneId]
    ),

    async getGrantRound(grantId) {
      const abi = requireGrantAbi()
      const publicClient = getPublicClient()
      const addresses = getAddresses()
      let status, applicationsCount;
      try {
        [status, applicationsCount] = await (publicClient as any).readContract({
          address: addresses.grant,
          abi,
          functionName: 'getGrantRound',
          args: [grantId],
        }) as readonly [number, bigint]
      } catch (err) {
        throw parseContractError(err, abi as Abi)
      }
      const statusMap: Record<number, GrantRound['status']> = { 0: 'open', 1: 'closed', 2: 'archived' }
      return formatBigIntToString({
        id: grantId,
        status: statusMap[status] ?? 'open',
        applicationsCount,
      } satisfies { id: bigint; status: GrantRound['status']; applicationsCount: bigint })
    },

    async getGrantApplication(applicationId) {
      const abi = requireGrantAbi()
      const publicClient = getPublicClient()
      const addresses = getAddresses()
      let applicant, status, metadataUri;
      try {
        [applicant, status, metadataUri] = await (publicClient as any).readContract({
          address: addresses.grant,
          abi,
          functionName: 'getGrantApplication',
          args: [applicationId],
        }) as readonly [Address, number, string]
      } catch (err) {
        throw parseContractError(err, abi as Abi)
      }
      const statusMap: Record<number, 'submitted' | 'approved' | 'rejected'> = {
        0: 'submitted',
        1: 'approved',
        2: 'rejected',
      }
      return formatBigIntToString({
        id: applicationId,
        applicant,
        status: statusMap[status] ?? 'submitted',
        metadataUri,
      } satisfies {
        id: bigint
        applicant: Address
        status: GrantApplication['status']
        metadataUri: string
      })
    },

    async getMilestones(applicationId) {
      const abi = requireGrantAbi()
      const publicClient = getPublicClient()
      const addresses = getAddresses()
      let raw;
      try {
        raw = await (publicClient as any).readContract({
          address: addresses.grant,
          abi,
          functionName: 'getMilestones',
          args: [applicationId],
        }) as unknown as Array<readonly [bigint, number, string]>
      } catch (err) {
        throw parseContractError(err, abi as Abi)
      }

      const statusMap: Record<number, Milestone['status']> = {
        0: 'pending',
        1: 'evidence-submitted',
        2: 'approved',
        3: 'paid',
      }

      const milestones: Array<{
        id: bigint
        status: Milestone['status']
        evidenceUri: string | undefined
      }> = raw.map(([id, status, evidenceUri]) => ({
        id,
        status: statusMap[status] ?? 'pending',
        evidenceUri: evidenceUri || undefined,
      }))

      return formatBigIntToString(milestones)
    },
  }
}
