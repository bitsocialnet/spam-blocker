/**
 * Check if a community address is a domain (not an IPNS address).
 *
 * Domain addresses cost money to acquire, making them resistant to sybil attacks.
 * IPNS addresses are free to create (just generate an ed25519 keypair).
 *
 * Examples:
 * - "example.eth" → true (ENS domain)
 * - "example.sol" → true (Solana domain)
 * - "example.com" → true (DNS domain)
 * - "12D3KooWExample..." → false (IPNS address)
 */
export function isDomainCommunityAddress(address: string): boolean {
    return address.includes(".");
}
