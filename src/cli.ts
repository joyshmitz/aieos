#!/usr/bin/env node
/**
 * aieos CLI — interactive wizard for registering and managing AIEOS agent profiles.
 * Usage:
 *   npx aieos register
 *   npx aieos update
 *   npx aieos lookup <identifier>
 *   npx aieos keygen
 *   npx aieos verify <entity-id-or-alias>
 */

import * as p from '@clack/prompts';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeypair, signProfile, verifyProfile } from './crypto.js';
import { AieosClient, AieosApiError } from './client.js';
import type { RegisterPayload, UpdatePayload } from './client.js';

const VERSION = '1.2.0';
const SCHEMA_VERSION = '1.2';
const DEFAULT_BASE_URL = 'https://api.aieos.org';

const cmd = process.argv[2];

async function main(): Promise<void> {
  switch (cmd) {
    case 'register': return cmdRegister();
    case 'update':   return cmdUpdate();
    case 'lookup':   return cmdLookup();
    case 'keygen':   return cmdKeygen();
    case 'verify':   return cmdVerify();
    default:         return cmdHelp();
  }
}

// ─── register ────────────────────────────────────────────────────────────────

async function cmdRegister(): Promise<void> {
  p.intro(`  aieos register  (v${VERSION})`);
  p.note(
    'This wizard will generate an Ed25519 keypair and register\n' +
    'your AI agent identity on the AIEOS network.\n\n' +
    'Your private key stays on your machine. Never share it.',
    'Welcome',
  );

  const baseUrl = resolveBaseUrl();
  const client = new AieosClient({ baseUrl });

  // ── Identity ────────────────────────────────────────────────────────────────
  const agentNameRaw = await p.text({
    message: 'Agent name',
    placeholder: 'e.g. Aria, EchoBot, ResearchAgent-7',
    validate: (v) => (v.trim().length < 1 ? 'Name is required.' : undefined),
  });
  if (p.isCancel(agentNameRaw)) return cancelled();
  const agentName = (agentNameRaw as string).trim();

  const agentTypeRaw = await p.select({
    message: 'Agent type',
    options: [
      { value: 'AI Assistant',     label: 'AI Assistant' },
      { value: 'Research Agent',   label: 'Research Agent' },
      { value: 'Coding Agent',     label: 'Coding Agent' },
      { value: 'Data Agent',       label: 'Data Agent' },
      { value: 'Creative Agent',   label: 'Creative Agent' },
      { value: 'Autonomous Agent', label: 'Autonomous Agent' },
      { value: 'Custom',           label: 'Custom (I\'ll type it)' },
    ],
  });
  if (p.isCancel(agentTypeRaw)) return cancelled();

  let agentType = agentTypeRaw as string;
  if (agentType === 'Custom') {
    const custom = await p.text({
      message: 'Describe your agent type',
      placeholder: 'e.g. Medical Diagnosis Assistant',
    });
    if (p.isCancel(custom)) return cancelled();
    agentType = (custom as string).trim();
  }

  const descRaw = await p.text({
    message: 'Short description  (optional)',
    placeholder: 'What does your agent do?',
  });
  if (p.isCancel(descRaw)) return cancelled();
  const description = descRaw ? (descRaw as string).trim() : '';

  // ── Alias ───────────────────────────────────────────────────────────────────
  const wantAlias = await p.confirm({
    message: 'Claim a custom alias? (e.g. @aria) Requires 2.00 USDC transaction fee on Base.',
    initialValue: false,
  });
  if (p.isCancel(wantAlias)) return cancelled();

  let alias: string | undefined;
  if (wantAlias) {
    const aliasRaw = await p.text({
      message: 'Desired alias  (letters, numbers, underscore — max 32 chars)',
      placeholder: 'aria',
      validate: (v) => {
        const t = v.trim();
        if (t.length < 1 || t.length > 32) return 'Must be 1–32 characters.';
        if (!/^[a-zA-Z0-9_]+$/.test(t)) return 'Letters, numbers, and underscore only.';
        return undefined;
      },
    });
    if (p.isCancel(aliasRaw)) return cancelled();
    alias = (aliasRaw as string).trim();

    // Check availability before proceeding
    const checkSpin = p.spinner();
    checkSpin.start(`Checking availability of @${alias}…`);
    try {
      const available = await client.checkAvailable(alias);
      if (available) {
        checkSpin.stop(`@${alias} is available.`);
      } else {
        checkSpin.stop(`@${alias} is already taken.`);
        alias = undefined;
      }
    } catch (err) {
      if (err instanceof AieosApiError && err.status === 429) {
        checkSpin.stop('Rate limited — please wait a minute and try again.');
        return cancelled();
      }
      checkSpin.stop('Could not check availability — continuing anyway.');
    }

    if (!alias) {
      const retry = await p.confirm({ message: 'Try a different alias?' });
      if (p.isCancel(retry) || !retry) {
        alias = undefined;
      } else {
        // Loop back — re-ask for alias
        const aliasRetry = await p.text({
          message: 'Desired alias  (letters, numbers, underscore — max 32 chars)',
          placeholder: 'myalias',
          validate: (v) => {
            const t = v.trim();
            if (t.length < 1 || t.length > 32) return 'Must be 1–32 characters.';
            if (!/^[a-zA-Z0-9_]+$/.test(t)) return 'Letters, numbers, and underscore only.';
            return undefined;
          },
        });
        if (p.isCancel(aliasRetry)) return cancelled();
        alias = (aliasRetry as string).trim();
      }
    }
  }

  // ── Contact email (optional, private) ─────────────────────────────────────
  const emailRaw = await p.text({
    message: 'Contact email  (optional — stored privately for AIEOS updates, never public)',
    placeholder: 'you@example.com',
    validate: (v) => {
      if (!v || v.trim() === '') return undefined;
      if (!v.includes('@')) return 'Enter a valid email address.';
      return undefined;
    },
  });
  if (p.isCancel(emailRaw)) return cancelled();
  const email = emailRaw ? (emailRaw as string).trim() || undefined : undefined;

  // ── Keypair ─────────────────────────────────────────────────────────────────
  const spin = p.spinner();
  spin.start('Generating Ed25519 keypair…');
  const keypair = generateKeypair();
  spin.stop('Keypair generated.');

  // ── Build profile ───────────────────────────────────────────────────────────
  const metadata: RegisterPayload['metadata'] = {
    public_key: keypair.publicKey,
    signature: '',
    ...(alias && { alias }),
  };

  const identity: RegisterPayload['identity'] = {
    names: [agentName],
    agent_type: agentType,
    ...(description && { description }),
  };

  const profile: RegisterPayload = {
    standard: {
      protocol: 'AIEOS',
      version: SCHEMA_VERSION,
      schema_url: `https://aieos.org/schema/v${SCHEMA_VERSION}/aieos.schema.json`,
    },
    metadata,
    identity,
  };

  // Sign
  spin.start('Signing profile…');
  const signature = signProfile(profile as unknown as Record<string, unknown>, keypair.privateKey);
  profile.metadata.signature = signature;
  spin.stop('Profile signed.');

  // ── If alias requested, preview price ────────────────────────────────────
  if (alias) {
    const price = await previewAliasPrice(client, alias);
    if (price) {
      const confirmPay = await p.confirm({
        message: `Process @${alias} registration fee on Base?`,
      });
      if (p.isCancel(confirmPay) || !confirmPay) {
        p.cancel('Alias skipped. You can claim one later with aieos claim-alias.');
        alias = undefined;
        delete profile.metadata.alias;
      }
    }
  }

  // ── If alias, collect tx_id ──────────────────────────────────────────────
  let txId: string | undefined;
  if (alias) {
    const txRaw = await p.text({
      message: 'Paste your USDC payment tx ID (0x…)',
      validate: (v) => (v.trim().length < 5 ? 'Enter a valid transaction ID.' : undefined),
    });
    if (p.isCancel(txRaw)) return cancelled();
    txId = (txRaw as string).trim();
  }

  // ── Register ────────────────────────────────────────────────────────────────
  spin.start('Registering with AIEOS…');
  try {
    const payload: RegisterPayload = {
      ...profile,
      ...(email && { email }),
      ...(txId  && { tx_id: txId }),
    };
    const result = await client.register(payload);
    spin.stop('Registered!');

    const outFile = resolve(`./${agentName.replace(/\s+/g, '-').toLowerCase()}-aieos.json`);
    const saved = {
      entity_id:   result.entity_id,
      alias:       result.alias,
      public_key:  keypair.publicKey,
      private_key: keypair.privateKey,
      registered:  new Date().toISOString(),
    };
    writeFileSync(outFile, JSON.stringify(saved, null, 2), { mode: 0o600 });

    p.outro(
      `\n  Agent registered!\n\n` +
      `  Entity ID : ${result.entity_id}\n` +
      (result.alias ? `  Alias     : @${result.alias}\n` : '') +
      `\n  Keypair saved to: ${outFile}\n` +
      `  Keep the private key secret. Back it up securely.\n\n` +
      `  Profile URL: https://aieos.org/${result.alias ?? result.entity_id}`,
    );
  } catch (err) {
    spin.stop('Registration failed.');
    printApiError(err);
  }
}

// ─── update ──────────────────────────────────────────────────────────────────

async function cmdUpdate(): Promise<void> {
  p.intro(`  aieos update  (v${VERSION})`);

  const keyFileRaw = await p.text({
    message: 'Path to your saved keypair JSON file',
    placeholder: './my-agent-aieos.json',
    validate: (v) => (!existsSync(v.trim()) ? 'File not found.' : undefined),
  });
  if (p.isCancel(keyFileRaw)) return cancelled();

  type SavedKeypair = { entity_id: string; public_key: string; private_key: string; alias?: string };
  let saved: SavedKeypair;
  try {
    saved = JSON.parse(readFileSync((keyFileRaw as string).trim(), 'utf8')) as SavedKeypair;
  } catch {
    p.cancel('Could not read keypair file.');
    process.exit(1);
  }

  const baseUrl = resolveBaseUrl();
  const client = new AieosClient({ baseUrl });

  const spin = p.spinner();
  spin.start('Fetching current profile…');
  let current: Record<string, unknown>;
  try {
    current = await client.lookup(saved.public_key);
    spin.stop('Profile loaded.');
  } catch (err) {
    spin.stop('Could not fetch profile.');
    printApiError(err);
    process.exit(1);
  }

  const currentIdentity = (current.identity ?? {}) as Record<string, unknown>;
  const currentNames = Array.isArray(currentIdentity.names)
    ? (currentIdentity.names as string[])
    : [];
  const currentMeta = (current.metadata ?? {}) as Record<string, unknown>;

  const newNameRaw = await p.text({
    message: 'Agent name',
    initialValue: currentNames[0] ?? '',
    validate: (v) => (v.trim().length < 1 ? 'Name is required.' : undefined),
  });
  if (p.isCancel(newNameRaw)) return cancelled();

  const newDescRaw = await p.text({
    message: 'Short description  (optional)',
    initialValue: (currentIdentity.description as string | undefined) ?? '',
  });
  if (p.isCancel(newDescRaw)) return cancelled();

  const updatedMetadata: UpdatePayload['metadata'] = {
    public_key: saved.public_key,
    signature: '',
    ...(currentMeta.alias ? { alias: currentMeta.alias as string } : {}),
  };

  const newName = (newNameRaw as string).trim();
  const newDesc = newDescRaw ? (newDescRaw as string).trim() : '';

  const updatedProfile: UpdatePayload = {
    standard: (current.standard as UpdatePayload['standard']) ?? {
      protocol: 'AIEOS',
      version: SCHEMA_VERSION,
    },
    metadata: updatedMetadata,
    identity: {
      ...currentIdentity,
      names: [newName],
      ...(newDesc && { description: newDesc }),
    },
    ...(current.capabilities !== undefined ? { capabilities: current.capabilities as Record<string, unknown> } : {}),
    ...(current.endpoints    !== undefined ? { endpoints:    current.endpoints    as Record<string, unknown> } : {}),
  };

  spin.start('Signing updated profile…');
  const signature = signProfile(updatedProfile as unknown as Record<string, unknown>, saved.private_key);
  updatedProfile.metadata.signature = signature;
  spin.stop('Signed.');

  spin.start('Updating profile…');
  try {
    await client.update(updatedProfile);
    spin.stop('Profile updated!');
    p.outro(`Profile updated. View at: https://aieos.org/${saved.alias ?? saved.entity_id}`);
  } catch (err) {
    spin.stop('Update failed.');
    printApiError(err);
  }
}

// ─── lookup ──────────────────────────────────────────────────────────────────

async function cmdLookup(): Promise<void> {
  const identifier = process.argv[3];
  if (!identifier) {
    console.error('Usage: aieos lookup <entity-id | public-key | alias>');
    process.exit(1);
  }

  const client = new AieosClient({ baseUrl: resolveBaseUrl() });
  try {
    const profile = await client.lookup(identifier);
    console.log(JSON.stringify(profile, null, 2));
  } catch (err) {
    printApiError(err);
    process.exit(1);
  }
}

// ─── keygen ──────────────────────────────────────────────────────────────────

function cmdKeygen(): void {
  const kp = generateKeypair();
  console.log(JSON.stringify(kp, null, 2));
}

// ─── verify ──────────────────────────────────────────────────────────────────

async function cmdVerify(): Promise<void> {
  const identifier = process.argv[3];
  if (!identifier) {
    console.error('Usage: aieos verify <entity-id | public-key | alias>');
    process.exit(1);
  }

  const client = new AieosClient({ baseUrl: resolveBaseUrl() });
  const spin = p.spinner();
  spin.start('Fetching profile…');
  try {
    const profile = await client.lookup(identifier);
    spin.stop('Profile fetched.');
    const ok = verifyProfile(profile);
    if (ok) {
      console.log('Signature valid');
    } else {
      console.error('Signature INVALID');
      process.exit(1);
    }
  } catch (err) {
    spin.stop('Failed.');
    printApiError(err);
    process.exit(1);
  }
}

// ─── help ─────────────────────────────────────────────────────────────────────

function cmdHelp(): void {
  console.log(`
  aieos v${VERSION} — AIEOS identity registry CLI

  Commands:
    aieos register              Register a new AI agent (interactive wizard)
    aieos update                Update your agent profile (interactive)
    aieos lookup <identifier>   Look up an agent by entity_id, public key, or alias
    aieos verify <identifier>   Fetch a profile and verify its Ed25519 signature
    aieos keygen                Generate a new Ed25519 keypair (prints JSON)

  Options:
    AIEOS_API_URL=<url>         Override API base URL (default: https://api.aieos.org)

  Examples:
    npx aieos register
    npx aieos lookup stella
    npx aieos verify 3f9a1c2d-...
  `);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveBaseUrl(): string {
  return ((process.env['AIEOS_API_URL'] ?? DEFAULT_BASE_URL) as string).replace(/\/$/, '');
}

function cancelled(): void {
  p.cancel('Operation cancelled.');
  process.exit(0);
}

function printApiError(err: unknown): void {
  if (err instanceof AieosApiError) {
    p.log.error(`API error ${err.status}: ${err.message}`);
    const b = err.body;
    if (b.wallet_address) {
      p.log.info(
        `Payment required:\n` +
        `  Amount : ${b.amount} ${b.currency}\n` +
        `  To     : ${b.wallet_address}\n` +
        `  Chain  : ${b.chain}\n` +
        (b.instructions ? `  Note   : ${b.instructions}` : ''),
      );
    }
  } else {
    p.log.error(String(err));
  }
}

async function previewAliasPrice(client: AieosClient, alias: string): Promise<string | null> {
  try {
    await client.register({
      standard: { protocol: 'AIEOS', version: SCHEMA_VERSION },
      metadata: { public_key: '0'.repeat(64), signature: '0'.repeat(128), alias },
      identity: { names: ['_preview'] },
    });
  } catch (err) {
    if (err instanceof AieosApiError && err.status === 402 && err.body.amount) {
      return err.body.amount;
    }
  }
  return null;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
