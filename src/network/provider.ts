import { http, type Transport } from 'viem'
import type { WhiteChainConfig, WhiteChainAddresses } from '../types.js'
import type { NetworkProfile } from '../config/networks.js'
import { TimeoutError, ValidationError } from '../errors/index.js'

type RateLimitListener = () => void
type JsonRpcResponse<T> = {
  result?: T
  error?: { message?: string }
}

export interface WaitForTransactionOptions {
  intervalMs?: number
  timeoutMs?: number
}

/**
 * Options for the HTTP {@link Provider}, including 429 retry behaviour.
 */
export interface ProviderOptions {
  /** Maximum number of retry attempts on HTTP 429 rate limit responses (default: 3). */
  maxRetries?: number
  /** Base delay in milliseconds for exponential backoff calculations (default: 100). */
  baseDelayMs?: number
  /** Custom fetch implementation for network requests or testing. */
  fetchFn?: typeof fetch
}

/**
 * JSON-RPC HTTP provider with rate-limit retry and transaction receipt polling.
 */
export class Provider {
  public readonly network: NetworkProfile
  public readonly chainId: number
  public readonly rpcUrl: string
  public readonly blockExplorerUrl: string
  public readonly transport: Transport
  public readonly maxRetries: number
  public readonly baseDelayMs: number

  private _listeners: RateLimitListener[] = []

  constructor(network: NetworkProfile, options?: ProviderOptions) {
    if (!network || typeof network.chainId !== 'number') {
      throw new ValidationError('Invalid network profile provided to Provider')
    }
    this.network = network
    this.chainId = network.chainId
    this.rpcUrl = network.rpcUrl
    this.blockExplorerUrl = network.blockExplorerUrl
    this.maxRetries = options?.maxRetries ?? 3
    this.baseDelayMs = options?.baseDelayMs ?? 100

    // Use a custom fetchFn to intercept 429 rate limits, emit rateLimit events, and retry with exponential backoff
    this.transport = http(network.rpcUrl, {
      fetchOptions: {},
      fetchFn: async (url: string | URL | Request, init?: RequestInit) => {
        let attempt = 0
        while (true) {
          const fetchImpl = options?.fetchFn ?? globalThis.fetch
          const response = await fetchImpl(url, init)
          if (response.status === 429) {
            this.emit('rateLimit')
            if (attempt < this.maxRetries) {
              const delay = Math.pow(2, attempt) * this.baseDelayMs
              await new Promise((resolve) => setTimeout(resolve, delay))
              attempt++
              continue
            }
            throw new Error(`HTTP 429 Rate limit exceeded after ${this.maxRetries} retries`)
          }
          return response
        }
      },
    })
  }

  public on(event: 'rateLimit', listener: RateLimitListener) {
    if (event === 'rateLimit') {
      this._listeners.push(listener)
    }
  }

  public emit(event: 'rateLimit') {
    if (event === 'rateLimit') {
      this._listeners.forEach((listener) => listener())
    }
  }

  public async request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    })

    if (response.status === 429) {
      this.emit('rateLimit')
    }

    const payload = await response.json() as JsonRpcResponse<T>
    if (payload.error) {
      throw new Error(payload.error.message || `RPC request failed: ${method}`)
    }

    return payload.result as T
  }

  public async waitForTransaction<T = unknown>(
    hash: string,
    options: WaitForTransactionOptions = {},
  ): Promise<T> {
    if (!hash || typeof hash !== 'string') {
      throw new ValidationError('Transaction hash is required')
    }

    const intervalMs = options.intervalMs ?? 4000
    const timeoutAt = options.timeoutMs === undefined ? null : Date.now() + options.timeoutMs

    while (true) {
      const receipt = await this.request<T | null>('eth_getTransactionReceipt', [hash])
      if (receipt !== null) {
        return receipt
      }

      if (timeoutAt !== null && Date.now() >= timeoutAt) {
        throw new TimeoutError(`Timed out waiting for transaction receipt: ${hash}`)
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  getClientConfig(addresses: WhiteChainAddresses, overrides?: Partial<WhiteChainConfig>): WhiteChainConfig {
    return {
      network: this.network,
      chain: this.network.chain,
      transport: this.transport,
      addresses,
      blockExplorerUrl: this.blockExplorerUrl,
      ...overrides,
    }
  }
}

export function createProvider(network: NetworkProfile, options?: ProviderOptions): Provider {
  return new Provider(network, options)
}
