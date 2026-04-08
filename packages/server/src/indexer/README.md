# PKC Community Indexer Spec

## Overview

Add a background indexer to the Bitsocial spam blocker that:

1. Tracks communities and their posts/comments.
2. Follows `author.previousCommentCid` chains to discover new authors.
3. Tracks mod queue outcomes to measure acceptance and rejection patterns.
4. Detects bans and removals by watching comment update availability.
5. Feeds network-level reputation signals into risk scoring.

## Architecture

- Single Fastify process with background workers.
- One shared PKC client instance for all workers.
- Event-driven updates from community change notifications instead of periodic full scans.
- Queue-based page loading with bounded concurrency.

## Core Concepts

### Comment data

- `CommentIpfs` is immutable and mirrors `comment.raw.comment`.
- `CommentUpdate` is mutable and mirrors `comment.raw.commentUpdate`.
- Use `signature.publicKey` as the canonical author identity.
- `author.address` can be a domain and is not itself a trusted identity.

### Community data

- `communityAddress` identifies the community being indexed.
- `communityPublicKey` is the community signer public key when available.
- `author.community` data is used for reputation fields such as karma, bans, and flair.

## Database Shape

The indexer should keep its own tables for:

- tracked communities
- immutable comment snapshots
- mutable comment update snapshots
- mod queue snapshots
- previous-comment-cid crawl state

Suggested column naming:

- `communityAddress`
- `communityPublicKey`
- `lastCommunityUpdatedAt`
- `lastPostsPageCidNew`
- `indexed_communities`
- `indexed_comments_ipfs`
- `indexed_comments_update`
- `modqueue_comments_ipfs`
- `modqueue_comments_update`

## Files

```text
packages/server/src/indexer/
├── index.ts
├── community-manager.ts
├── page-queue.ts
├── types.ts
├── db/
│   └── queries.ts
└── workers/
    ├── community-indexer.ts
    ├── comment-fetcher.ts
    ├── modqueue-tracker.ts
    └── previous-cid-crawler.ts
```

## Implementation Notes

### Community manager

Create a singleton PKC client wrapper that exposes `getCommunity()` and `stopCommunity()`.

### Page queue

Use a bounded queue for page fetches so indexing does not overwhelm the process.

### Community indexer

- Load enabled communities from the database.
- Subscribe to community update events.
- When `updatedAt` or `posts.pageCids.new` changes, queue a page fetch.

### Comment fetcher

- Store `comment.raw.comment` in the immutable table.
- Store `comment.raw.commentUpdate` when present.
- Record a fetch failure when `commentUpdate` is unavailable.

### Mod queue tracker

- Iterate through the mod queue pages.
- Store immutable and mutable snapshots separately.
- When an item disappears from the mod queue, check whether it later resolves to a final update.

### Previous-CID crawler

- Follow `author.previousCommentCid` chains with a timeout.
- Update the community index when a new author chain is discovered.

## Risk Scoring Integration

The indexer should feed the following metrics into risk scoring:

- ban history across communities
- mod queue rejection rate
- removal rate
- pseudonymity mode signals

## Migration Checklist

1. Update DB schema and queries for the new community terminology.
2. Rename the indexer workers and manager to the PKC community surface.
3. Update tests and scenario generation to use community-aware fixtures.
4. Keep the Bitsocial-facing user text free of old product names.
