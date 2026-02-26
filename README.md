# AIEOS (AI Entity Object Specification)

> **Open-source identity, messaging, and settlement standard for the Agentic Web.**

<p align="left">
<a href="https://entitai.com"><img src="entitai-web-builder.svg" alt="Web Builder" style="margin-right: 20px;" /></a>
<a href="https://aieos.org"><img src="aieos-agent-gateway.svg" alt="Agent Gateway" /></a>
</p>

## Meet AIEOS v1.2

AIEOS is an open standard that defines a portable identity structure for AI agents, independent of any specific model. The specification externalizes an agent's capabilities, communication endpoints, and settlement credentials into a single machine-readable object. Discoverable, readable, and transactable by any agent, anywhere.

AIEOS enables a fully autonomous agent-to-agent workflow. Agents discover each other through published identity objects, evaluate capabilities and skill priorities, and establish direct communication channels without requiring a shared platform or human mediation.

Typical sequence: Agent A queries Agent B's identity, reads its available skills, initiates a task delegation, and upon completion, settles payment. The entire cycle is handled at the schema level by default.

## Core Structure

- **Metadata:** Unique entity identification via UUID v4, human-readable Alias, and Ed25519 key pair for cryptographic signing and verification.
- **Presence:** Network endpoints (IPv4/IPv6, webhooks), communication channels, and settlement wallets for autonomous value transfer.
- **Capabilities & Skills:** A modular agency layer for defining the standardized tools and executable functions available to an entity, utilizing a descending priority scale (1-10) for autonomous skill discovery and task orchestration.

## Human Interaction

- **Identity & Physicality:** Beyond basic bio data; defines the perceived physical presence, from somatotype to distinguishing facial features and aesthetic archetypes.
- **Psychology & Neural Matrix:** A multi-layered cognitive framework featuring a normalized Neural Matrix (0.0 - 1.0) for core drivers, alongside OCEAN traits and moral alignment.
- **Linguistics & Idiolect:** Fine-grained control over vocal acoustics, syntax, and verbal tics, allowing for consistent "voice" across both TTS and text-based interaction.
- **History & Motivations:** Structural mapping of origin stories, life events, and professional background to drive an agent's long-term goals and behavioral consistency.
- **Interests:** Preferences, hobbies, and lifestyle parameters for contextual behavior and personalization.

## Usage

To use the v1.2 schema in your project, reference the remote URI:
`https://aieos.org/schema/v1.2/aieos.schema.json`

## Contributing

AIEOS is an open standard. We welcome PRs for new identity primitives, protocol extensions, or architectural improvements.

---
© 2026 Entitai. Creative Commons Attribution 4.0.