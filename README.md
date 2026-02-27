# aieos

> Official SDK and CLI for the AIEOS identity registry — register, update, and manage AI agent profiles.

<p align="left">
<a href="https://entitai.com"><img src="entitai-web-builder.svg" alt="Web Builder" style="margin-right: 20px;" /></a>
<a href="https://aieos.org"><img src="aieos-agent-gateway.svg" alt="Agent Gateway" /></a>
</p>

[![npm version](https://img.shields.io/npm/v/aieos)](https://www.npmjs.com/package/aieos)
[![license](https://img.shields.io/npm/l/aieos)](LICENSE)

## Quickstart

Register your AI agent in 60 seconds:

```sh
npx aieos register
```

The interactive wizard will:
1. Ask for your agent's name and type
2. Generate an Ed25519 keypair (stays on your machine)
3. Sign and submit your identity to the AIEOS registry
4. Save your keypair to a local JSON file

---

## Install

```sh
npm install aieos
# or
bun add aieos
```

## CLI Commands

```sh
aieos register              # Register a new agent (interactive wizard)
aieos update                # Update your agent profile (interactive)
aieos lookup <identifier>   # Look up an agent by entity_id, public key, or alias
aieos verify <identifier>   # Fetch a profile and verify its Ed25519 signature
aieos keygen                # Generate a new Ed25519 keypair (prints JSON)
```

### Environment

```sh
AIEOS_API_URL=https://api.aieos.org   # Override API base URL (for self-hosting)
```

---

## Library Usage

```ts
import { generateKeypair, signProfile, verifyProfile, AieosClient } from 'aieos';

// Generate a keypair
const keypair = generateKeypair();
// { publicKey: '64-char hex', privateKey: '64-char hex' }

// Build and sign a profile
const profile = {
  standard: { protocol: 'AIEOS', version: '1.2' },
  metadata: { public_key: keypair.publicKey, signature: '' },
  identity:  { names: ['MyAgent'], agent_type: 'AI Assistant' },
};
profile.metadata.signature = signProfile(profile, keypair.privateKey);

// Register via API
const client = new AieosClient();
const result = await client.register(profile);
// { entity_id: '...', message: 'Agent registered successfully' }

// Lookup
const agentProfile = await client.lookup('stella');

// Verify signature
const valid = verifyProfile(agentProfile);
```

### CommonJS

```js
const { generateKeypair, AieosClient } = require('aieos');
```

---

## AIEOS Schema v1.2

The full identity schema is at:
`https://aieos.org/schema/v1.2/aieos.schema.json`

Core structure:
- **metadata** — `entity_id`, `public_key`, `signature`, `alias` (if claimed)
- **identity** — `names`, `agent_type`, `description`
- **presence** — `access` (email, website, social links), `settlement.wallets`
- **capabilities** — skills available for agent-to-agent discovery
- **endpoints** — API endpoints for direct communication

---

## Security Model

- Ed25519 keypairs are generated locally and **never transmitted**
- Your private key stays on your machine (saved in the output JSON file)
- The profile is signed before submission — the AIEOS registry verifies the signature
- Backups: keep your keypair JSON safe; it is required to update your profile

---

## About AIEOS

AIEOS (AI Entity Object Specification) is an open standard for portable AI agent identity, independent of any specific model or platform. Agents can discover each other, evaluate capabilities, and settle payments autonomously using their published AIEOS profiles.

- Website: [aieos.org](https://aieos.org)
- Registry API: [api.aieos.org](https://api.aieos.org)
- Issues: [github.com/entitai/aieos/issues](https://github.com/entitai/aieos/issues)

---

© 2026 Entitai. [Creative Commons Attribution 4.0](LICENSE).
