# Hosted SpamBlocker Source Policy

This decision records why Bitsocial publishes the spam blocker's integration surface while keeping the official hosted service implementation private.

- **Status:** Accepted
- **Date:** 2026-08-12

## Decision

Bitsocial uses a public-integration, private-service model for its official hosted spam blocker.

The following surfaces remain public:

- the community challenge package;
- shared request and response schemas;
- the hosted service's API contract;
- high-level descriptions of risk signals and user-visible enforcement;
- documentation of what information the hosted service processes and exposes to communities.

The following surfaces remain private:

- the official hosted server implementation;
- fine-grained scoring weights, compound abuse heuristics, and operational thresholds that are not part of a user-facing guarantee;
- cross-community abuse analytics and operator investigation tooling;
- deployment, monitoring, and other service-operation details.

The public challenge package keeps `serverUrl` configurable so a community can use a compatible independent service. Compatibility with the public contract does not imply distribution of the official hosted implementation.

## Context

Bitsocial is an open protocol, but the official spam blocker is an optional centralized service. Centralized history lets the service detect patterns that a single community cannot observe reliably, including signer churn, ban evasion, coordinated accounts, and other cross-community abuse.

Publishing the integration contract is necessary for interoperability, independent implementations, and informed use. Publishing the complete adaptive abuse engine is not currently necessary for those goals and would disclose implementation details that can reduce the cost of testing evasion strategies. Keeping the service private also preserves the option for Bitsocial Forge to fund its operation through a managed offering while the long-term business model is still developing.

## Security Position

Private source code is not a primary security control. The hosted service must remain defensible even when attackers understand its endpoints and high-level design. Its security should rely on measures such as authenticated requests, strict validation, rate limiting, infrastructure-level denial-of-service protection, least privilege, monitoring, and responsive abuse operations.

Implementation confidentiality is an additional source of attacker friction, particularly for adaptive scoring and Sybil-detection logic. It must not be used to conceal user-affecting policies, data handling, or the existence of enforcement mechanisms. Those remain documented publicly at the level needed for informed participation and operator accountability.

## Why This Boundary

This model provides:

- **Interoperability:** communities and alternative services can integrate through public packages and schemas.
- **Transparency:** users can understand the categories of evidence, possible enforcement, and relevant data handling.
- **Abuse resistance:** the hosted operator does not publish every implementation detail needed to optimize attacks against the current engine.
- **Operational sustainability:** Bitsocial Forge retains flexibility to offer a managed anti-spam service without making it a protocol requirement.

## Reconsideration Triggers

This decision should be reviewed when one or more of the following becomes true:

1. Significant community demand emerges for a self-hostable official server.
2. A contributor and security-review community exists that can materially improve and maintain the implementation.
3. The service's defensible value has shifted from implementation details to data, operations, reliability, or support.
4. A sustainable open-core model is defined, such as a public reference server with the hosted adaptive risk engine and shared abuse intelligence remaining private.
5. Keeping the implementation private begins to impede protocol adoption, trustworthy independent review, or community choice more than it helps abuse resistance and sustainability.

Any future change should be deliberate, include a license review, separate secrets and production data from source, and preserve compatibility with the public integration contract.
