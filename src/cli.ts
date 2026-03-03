#!/usr/bin/env node
/**
 * aieos CLI — interactive wizard for registering and managing AIEOS agent profiles.
 * Usage:
 *   npx aieos register
 *   npx aieos update
 *   npx aieos lookup <identifier>
 *   npx aieos keygen
 *   npx aieos verify <entity-id-or-username>
 */

import * as p from '@clack/prompts';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeypair, signProfile, verifyProfile } from './crypto.js';
import { AieosClient, AieosApiError } from './client.js';
import type { RegisterPayload, UpdatePayload } from './client.js';

const VERSION = '1.2.0';
const SCHEMA_VERSION = '1.2.1';
const SCHEMA_URL = 'https://aieos.org/schema/v1.2/aieos.schema.json';
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

  // ── Name ────────────────────────────────────────────────────────────────────
  const agentNameRaw = await p.text({
    message: 'Agent name  (letters and numbers, up to 16 chars)',
    placeholder: 'e.g. aria, echobot, agent7',
    validate: (v) => {
      const t = v.trim();
      if (t.length < 1) return 'Name is required.';
      if (!/^[a-zA-Z0-9]+$/.test(t)) return 'Letters and numbers only.';
      if (t.length > 16) return 'Maximum 16 characters.';
      return undefined;
    },
  });
  if (p.isCancel(agentNameRaw)) return cancelled();
  const agentName = (agentNameRaw as string).trim();

  // ── Email ───────────────────────────────────────────────────────────────────
  const emailRaw = await p.text({
    message: 'Recovery email  (optional — stored privately, never public)',
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
  p.note(
    `Public key  : ${keypair.publicKey}\nPrivate key : ${keypair.privateKey}`,
    'Your keypair — copy these now',
  );

  // ── Build profile ───────────────────────────────────────────────────────────
  const profile: RegisterPayload = {
    standard: {
      protocol: 'AIEOS',
      version: SCHEMA_VERSION,
      schema_url: SCHEMA_URL,
    },
    metadata: {
      public_key: keypair.publicKey,
      signature: '',
    },
    identity: {
      names: { first: agentName },
    },
  };

  // Sign (only profile keys: standard, metadata, identity)
  spin.start('Signing profile…');
  const signature = signProfile(profile as unknown as Record<string, unknown>, keypair.privateKey);
  profile.metadata.signature = signature;
  spin.stop('Profile signed.');

  // ── Register ────────────────────────────────────────────────────────────────
  spin.start('Registering with AIEOS…');
  try {
    const payload: RegisterPayload = {
      ...profile,
      name: agentName.toLowerCase(),
      ...(email && { email }),
    };
    const result = await client.register(payload);
    spin.stop('Registered!');

    const outFile = resolve(`./${result.entity_id}.json`);
    const saved = {
      entity_id:   result.entity_id,
      username:    result.username,
      public_key:  keypair.publicKey,
      private_key: keypair.privateKey,
      registered:  new Date().toISOString(),
    };
    writeFileSync(outFile, JSON.stringify(saved, null, 2), { mode: 0o600 });

    p.outro(
      `\n  Agent registered successfully!\n\n` +
      `  Entity ID : ${result.entity_id}\n` +
      (result.username ? `  Username  : @${result.username}\n` : '') +
      `\n  Keypair saved to: ${outFile}\n\n` +
      `\x1b[1;91m  ⚠️  DO NOT CLOSE THIS TERMINAL BEFORE SAVING YOUR PRIVATE KEY ⚠️\n` +
      `  🛑 THERE IS NO PASSWORD RESET. LOSS = PERMANENT LOCKOUT. 🛑\x1b[0m\n\n` +
      (result.username
        ? `  Profile URL: https://aieos.org/${result.username}\n\n`
        : `  Profile URL: https://aieos.org/${result.entity_id}\n\n`) +
      `  To claim a custom username use: aieos claim`,
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

  type SavedKeypair = { entity_id: string; public_key: string; private_key: string; username?: string };
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
  // Handle both old array format and new object format
  const currentNamesRaw = currentIdentity.names;
  const currentNamesObj = (
    Array.isArray(currentNamesRaw)
      ? { first: (currentNamesRaw as string[])[0] ?? '' }
      : (currentNamesRaw as Record<string, string> | undefined) ?? {}
  );
  const currentMeta = (current.metadata ?? {}) as Record<string, unknown>;

  const newNameRaw = await p.text({
    message: 'Agent display name  (first name)',
    initialValue: currentNamesObj.first ?? '',
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
    ...(currentMeta.username ? { username: currentMeta.username as string } : {}),
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
      names: { ...currentNamesObj, first: newName },
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
    p.outro(`Profile updated. View at: https://aieos.org/${saved.username ?? saved.entity_id}`);
  } catch (err) {
    spin.stop('Update failed.');
    printApiError(err);
  }
}

// ─── lookup ──────────────────────────────────────────────────────────────────

async function cmdLookup(): Promise<void> {
  const identifier = process.argv[3];
  if (!identifier) {
    console.error('Usage: aieos lookup <entity-id | public-key | username>');
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
    console.error('Usage: aieos verify <entity-id | public-key | username>');
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
    aieos lookup <identifier>   Look up an agent by entity_id, public key, or username
    aieos verify <identifier>   Fetch a profile and verify its Ed25519 signature
    aieos keygen                Generate a new Ed25519 keypair (prints JSON)

  Options:
    AIEOS_API_URL=<url>         Override API base URL (default: https://api.aieos.org)

  Examples:
    npx aieos register
    npx aieos lookup aria-7c40b7e2
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
  } else {
    p.log.error(String(err));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
