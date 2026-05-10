import { keccak256, toBytes, type Hex } from 'viem'

export function settlementBucketCommitment(seed: string): Hex {
  const normalized = seed.trim()
  if (!normalized) {
    throw new Error('Settlement bucket seed is required.')
  }

  return keccak256(toBytes(`settlement-bucket:${normalized}`))
}
