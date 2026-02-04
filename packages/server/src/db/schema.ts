/**
 * Database schema for EasyCommunitySpamBlocker.
 * Uses better-sqlite3 with SQLite.
 */

export const SCHEMA_SQL = `
-- Challenge sessions table (ephemeral) - stores pending challenges
-- Internal timestamps (completedAt, expiresAt, receivedChallengeRequestAt, authorAccessedIframeAt) are in milliseconds
CREATE TABLE IF NOT EXISTS challengeSessions (
  sessionId TEXT PRIMARY KEY,
  subplebbitPublicKey TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  completedAt INTEGER,
  expiresAt INTEGER NOT NULL,
  receivedChallengeRequestAt INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  authorAccessedIframeAt INTEGER,
  oauthIdentity TEXT,  -- format: "provider:userId" (e.g., "github:12345678")
  challengeTier TEXT CHECK (challengeTier IS NULL OR challengeTier IN ('oauth_sufficient', 'oauth_plus_more')),
  oauthCompleted INTEGER DEFAULT 0,  -- 1 if first OAuth completed (session may still need more verification)
  captchaCompleted INTEGER DEFAULT 0,  -- 1 if CAPTCHA portion completed
  riskScore REAL  -- The risk score at evaluation time (used for score adjustment after CAPTCHA/OAuth)
);

CREATE INDEX IF NOT EXISTS idx_challengeSessions_expiresAt ON challengeSessions(expiresAt);

-- Comments table - stores comment publications
-- Note: timestamp is from publication (seconds), receivedAt is internal (milliseconds)
CREATE TABLE IF NOT EXISTS comments (
  sessionId TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  subplebbitAddress TEXT NOT NULL,
  parentCid TEXT,
  content TEXT,
  link TEXT,
  linkWidth INTEGER,
  linkHeight INTEGER,
  postCid TEXT,
  signature TEXT NOT NULL,
  title TEXT,
  timestamp INTEGER NOT NULL,
  linkHtmlTagName TEXT,
  flair TEXT,
  spoiler INTEGER,
  protocolVersion TEXT NOT NULL,
  nsfw INTEGER,
  receivedAt INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  FOREIGN KEY (sessionId) REFERENCES challengeSessions(sessionId)
);

CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author);
CREATE INDEX IF NOT EXISTS idx_comments_subplebbitAddress ON comments(subplebbitAddress);
CREATE INDEX IF NOT EXISTS idx_comments_timestamp ON comments(timestamp);

-- Votes table - stores vote publications
-- Note: timestamp is from publication (seconds), receivedAt is internal (milliseconds)
CREATE TABLE IF NOT EXISTS votes (
  sessionId TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  subplebbitAddress TEXT NOT NULL,
  commentCid TEXT NOT NULL,
  signature TEXT NOT NULL,
  protocolVersion TEXT NOT NULL,
  vote INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  receivedAt INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  FOREIGN KEY (sessionId) REFERENCES challengeSessions(sessionId)
);

CREATE INDEX IF NOT EXISTS idx_votes_author ON votes(author);
CREATE INDEX IF NOT EXISTS idx_votes_commentCid ON votes(commentCid);

-- Comment edits table - stores comment edit publications
-- Note: timestamp is from publication (seconds), receivedAt is internal (milliseconds)
CREATE TABLE IF NOT EXISTS commentEdits (
  sessionId TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  subplebbitAddress TEXT NOT NULL,
  commentCid TEXT NOT NULL,
  signature TEXT NOT NULL,
  protocolVersion TEXT NOT NULL,
  content TEXT,
  reason TEXT,
  deleted INTEGER,
  flair TEXT,
  spoiler INTEGER,
  nsfw INTEGER,
  timestamp INTEGER NOT NULL,
  receivedAt INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  FOREIGN KEY (sessionId) REFERENCES challengeSessions(sessionId)
);

CREATE INDEX IF NOT EXISTS idx_commentEdits_author ON commentEdits(author);
CREATE INDEX IF NOT EXISTS idx_commentEdits_commentCid ON commentEdits(commentCid);

-- Comment moderations table - stores comment moderation publications
-- Note: timestamp is from publication (seconds), receivedAt is internal (milliseconds)
CREATE TABLE IF NOT EXISTS commentModerations (
  sessionId TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  subplebbitAddress TEXT NOT NULL,
  commentCid TEXT NOT NULL,
  commentModeration TEXT,
  signature TEXT NOT NULL,
  protocolVersion TEXT,
  timestamp INTEGER NOT NULL,
  receivedAt INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  FOREIGN KEY (sessionId) REFERENCES challengeSessions(sessionId)
);

CREATE INDEX IF NOT EXISTS idx_commentModerations_author ON commentModerations(author);
CREATE INDEX IF NOT EXISTS idx_commentModerations_commentCid ON commentModerations(commentCid);

-- IP records table - stores IP addresses associated with challenges
CREATE TABLE IF NOT EXISTS ipRecords (
  sessionId TEXT PRIMARY KEY,
  ipAddress TEXT NOT NULL,
  isVpn INTEGER,
  isProxy INTEGER,
  isTor INTEGER,
  isDatacenter INTEGER,
  countryCode TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (sessionId) REFERENCES challengeSessions(sessionId)
);

CREATE INDEX IF NOT EXISTS idx_ipRecords_ipAddress ON ipRecords(ipAddress);

-- ============================================================================
-- INDEXER TABLES
-- ============================================================================

-- Tracked subplebbits
-- Note: discoveredAt is internal (milliseconds), lastSubplebbitUpdatedAt is from subplebbit (seconds)
CREATE TABLE IF NOT EXISTS indexed_subplebbits (
    address TEXT PRIMARY KEY,
    publicKey TEXT,
    discoveredVia TEXT NOT NULL,  -- 'evaluate_api' | 'previous_comment_cid' | 'manual'
    discoveredAt INTEGER NOT NULL,
    indexingEnabled INTEGER DEFAULT 1,
    lastPostsPageCidNew TEXT,        -- To detect changes (pageCids.new)
    lastSubplebbitUpdatedAt INTEGER, -- subplebbit.updatedAt - skip if unchanged (seconds from protocol)
    consecutiveErrors INTEGER DEFAULT 0,
    lastError TEXT
);

CREATE INDEX IF NOT EXISTS idx_indexed_subplebbits_enabled ON indexed_subplebbits(indexingEnabled);

-- CommentIpfs data (immutable, from comment.raw.comment)
-- Note: timestamp is from publication (seconds), fetchedAt is internal (milliseconds)
CREATE TABLE IF NOT EXISTS indexed_comments_ipfs (
    cid TEXT PRIMARY KEY,
    subplebbitAddress TEXT NOT NULL,
    author TEXT NOT NULL,                  -- JSON: full author object
    signature TEXT NOT NULL,               -- JSON: full signature (publicKey inside)
    parentCid TEXT,                        -- null = post, set = reply
    content TEXT,
    title TEXT,
    link TEXT,
    timestamp INTEGER NOT NULL,
    depth INTEGER,                         -- 0 = post, >0 = reply
    protocolVersion TEXT,
    fetchedAt INTEGER NOT NULL,
    FOREIGN KEY (subplebbitAddress) REFERENCES indexed_subplebbits(address)
);

CREATE INDEX IF NOT EXISTS idx_comments_ipfs_author_pubkey ON indexed_comments_ipfs(
    (json_extract(signature, '$.publicKey'))
);
CREATE INDEX IF NOT EXISTS idx_comments_ipfs_sub ON indexed_comments_ipfs(subplebbitAddress);

-- CommentUpdate data (mutable, from comment.raw.commentUpdate)
-- Note: author only has subplebbit data, NOT author.address
-- Note: signature is from sub, not needed
-- Note: updatedAt is from protocol (seconds), fetchedAt/lastFetchFailedAt are internal (milliseconds)
CREATE TABLE IF NOT EXISTS indexed_comments_update (
    cid TEXT PRIMARY KEY,
    author TEXT,                           -- JSON: author.subplebbit data only
    upvoteCount INTEGER,
    downvoteCount INTEGER,
    replyCount INTEGER,
    removed INTEGER,
    deleted INTEGER,
    locked INTEGER,
    pinned INTEGER,
    approved INTEGER,                      -- true = approved, false = disapproved
    updatedAt INTEGER,                     -- for change detection from protocol (seconds, NULL if never fetched)
    lastRepliesPageCid TEXT,               -- replies.pageCids.new (or first) - skip re-fetching if unchanged
    fetchedAt INTEGER,                     -- last successful fetch (milliseconds, NULL if never succeeded)
    lastFetchFailedAt INTEGER,
    fetchFailureCount INTEGER DEFAULT 0,   -- reset to 0 on success
    FOREIGN KEY (cid) REFERENCES indexed_comments_ipfs(cid)
);

CREATE INDEX IF NOT EXISTS idx_comments_update_removed ON indexed_comments_update(removed) WHERE removed = 1;
CREATE INDEX IF NOT EXISTS idx_comments_update_approved ON indexed_comments_update(approved) WHERE approved IS NOT NULL;

-- ModQueue CommentIpfs (from modQueue page comment.comment)
-- Note: timestamp is from publication (seconds), firstSeenAt is internal (milliseconds)
CREATE TABLE IF NOT EXISTS modqueue_comments_ipfs (
    cid TEXT PRIMARY KEY,
    subplebbitAddress TEXT NOT NULL,
    author TEXT NOT NULL,                  -- JSON: full author object
    signature TEXT NOT NULL,               -- JSON: full signature (publicKey inside)
    parentCid TEXT,
    content TEXT,
    title TEXT,
    link TEXT,
    timestamp INTEGER NOT NULL,
    depth INTEGER,
    protocolVersion TEXT,
    firstSeenAt INTEGER NOT NULL,
    FOREIGN KEY (subplebbitAddress) REFERENCES indexed_subplebbits(address)
);

CREATE INDEX IF NOT EXISTS idx_modqueue_ipfs_author ON modqueue_comments_ipfs(
    (json_extract(signature, '$.publicKey'))
);

-- ModQueue CommentUpdate (CommentUpdateForChallengeVerification)
-- Note: signature is from sub, not needed. author only has subplebbit data.
-- Note: lastSeenAt and resolvedAt are internal (milliseconds)
CREATE TABLE IF NOT EXISTS modqueue_comments_update (
    cid TEXT PRIMARY KEY,
    author TEXT,                           -- JSON: author.subplebbit data only
    protocolVersion TEXT,
    number INTEGER,
    postNumber INTEGER,
    pendingApproval INTEGER NOT NULL,      -- always 1 while in modQueue
    lastSeenAt INTEGER NOT NULL,
    resolved INTEGER DEFAULT 0,
    resolvedAt INTEGER,
    accepted INTEGER,                      -- true if full CommentUpdate exists after resolution
    FOREIGN KEY (cid) REFERENCES modqueue_comments_ipfs(cid)
);

CREATE INDEX IF NOT EXISTS idx_modqueue_update_pending ON modqueue_comments_update(resolved) WHERE resolved = 0;

-- ============================================================================
-- OAUTH TABLES
-- ============================================================================

-- OAuth state table (ephemeral, for CSRF protection during OAuth flow)
-- Note: createdAt and expiresAt are internal (milliseconds)
CREATE TABLE IF NOT EXISTS oauthStates (
  state TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  provider TEXT NOT NULL,  -- 'github', 'google', 'facebook', 'apple', 'twitter'
  codeVerifier TEXT,       -- PKCE code verifier (required for google, twitter)
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  FOREIGN KEY (sessionId) REFERENCES challengeSessions(sessionId)
);

CREATE INDEX IF NOT EXISTS idx_oauthStates_sessionId ON oauthStates(sessionId);
CREATE INDEX IF NOT EXISTS idx_oauthStates_expiresAt ON oauthStates(expiresAt);
`;
