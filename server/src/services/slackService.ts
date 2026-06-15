/**
 * slackService — the only module that talks to Slack.
 *
 * `ensureTxnChannel` implements the plan's two-tier strategy:
 *   tier 1 — party is a workspace member (lookupByEmail succeeds) → invite.
 *   tier 2 — party can't be added → channel still created with consultant+bot;
 *            client is "notified by email"; nothing throws.
 *
 * Slack is notification, never the source of truth: posting failures are logged
 * and swallowed so they can never block or roll back a billing action (§6).
 */
import { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import { config, slugify } from '../config.js';
import { createLogger } from '../logger.js';
import { transactionStore } from '../stores/transactionStore.js';
import type { EnsureChannelResult, TransactionRecord } from '../types.js';
import { buildChannelOpened, buildNote } from './slack/blocks.js';

const log = createLogger('slackService');

const slack = new WebClient(config.slack.botToken);

/** Slack channel names: lowercase, [a-z0-9-_], ≤ 80 chars. */
function buildChannelName(consultantId: string, clientEmail: string): string {
  const clientSlug = slugify(clientEmail.split('@')[0] ?? clientEmail);
  const base = `txn-${consultantId}-${clientSlug}`;
  const seq = String(Date.now()).slice(-5); // short uniqueness suffix
  return `${base}-${seq}`.replace(/[^a-z0-9-_]/g, '').slice(0, 80);
}

/** Slack error codes carry a string `data.error`; narrow safely. */
function slackErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === 'string') return data.error;
  }
  return null;
}

/**
 * Resolve an email to a workspace user id, or null if not a member.
 * A "users_not_found" result is an expected tier-2 path, not an error.
 */
async function lookupUserId(email: string | null): Promise<string | null> {
  if (!email) return null;
  try {
    const res = await slack.users.lookupByEmail({ email });
    return res.user?.id ?? null;
  } catch (err) {
    const code = slackErrorCode(err);
    if (code === 'users_not_found') {
      log.info('Slack user not found (tier-2 email path)', { email });
      return null;
    }
    log.warn('Slack user lookup failed', { email, code, error: errMessage(err) });
    return null;
  }
}

async function inviteUser(channelId: string, userId: string): Promise<boolean> {
  try {
    await slack.conversations.invite({ channel: channelId, users: userId });
    return true;
  } catch (err) {
    const code = slackErrorCode(err);
    // Already in channel is success for our purposes.
    if (code === 'already_in_channel') return true;
    log.warn('Slack invite failed', { channelId, userId, code, error: errMessage(err) });
    return false;
  }
}

/**
 * Ensure a private channel exists for this consultant↔client pairing. Reuses the
 * stored channel if one already exists; otherwise creates + invites (two-tier).
 * Persists `channelId`/`channelName` back onto the transaction record.
 */
export async function ensureTxnChannel(txn: TransactionRecord): Promise<EnsureChannelResult> {
  // Reuse: the pairing already has a channel from a prior action.
  if (txn.channelId && txn.channelName) {
    log.info('Reusing existing transaction channel', {
      txnId: txn.txnId,
      channelId: txn.channelId,
    });
    return {
      channelId: txn.channelId,
      channelName: txn.channelName,
      created: false,
      consultantInvited: true,
      clientInvited: !txn.clientNotifiedByEmailOnly,
      notes: [],
    };
  }

  const notes: string[] = [];
  let channelId: string;
  let channelName = buildChannelName(txn.consultantId, txn.clientEmail);

  // Create the private channel (bot is added as creator).
  try {
    const res = await slack.conversations.create({ name: channelName, is_private: true });
    if (!res.channel?.id) {
      throw new Error('Slack conversations.create returned no channel id');
    }
    channelId = res.channel.id;
    channelName = res.channel.name ?? channelName;
    log.info('Created private channel', { txnId: txn.txnId, channelId, channelName });
  } catch (err) {
    const code = slackErrorCode(err);
    if (code === 'name_taken') {
      // Deterministic reuse path: look up the existing channel by name.
      const existing = await findChannelByName(channelName);
      if (existing) {
        channelId = existing.id;
        channelName = existing.name;
        notes.push('Reused existing channel (name already taken).');
        log.info('Reused channel after name_taken', { channelId, channelName });
      } else {
        log.error('Channel name taken but lookup failed', { channelName });
        throw err;
      }
    } else {
      log.error('Failed to create channel', { code, error: errMessage(err) });
      throw err;
    }
  }

  // Tier-1 invites where possible.
  const consultantConfig = config.consultants.find((c) => c.id === txn.consultantId);
  const consultantUserId = await lookupUserId(consultantConfig?.email ?? null);
  const clientUserId = await lookupUserId(txn.clientEmail);

  let consultantInvited = false;
  if (consultantUserId) {
    consultantInvited = await inviteUser(channelId, consultantUserId);
    if (!consultantInvited) notes.push('Consultant invite did not complete; they can be added manually.');
  } else {
    notes.push('Consultant is not a workspace member; not invited.');
  }

  let clientInvited = false;
  if (clientUserId) {
    clientInvited = await inviteUser(channelId, clientUserId);
    if (!clientInvited) notes.push('Client invite did not complete; client notified by email.');
  } else {
    notes.push('Client is not a workspace member; client notified by email.');
  }

  // Persist channel + invite outcome onto the transaction record.
  transactionStore.update(txn.txnId, {
    channelId,
    channelName,
    clientNotifiedByEmailOnly: !clientInvited,
  });

  // Opening narrative + any fallback notes.
  await postBlocks(channelId, buildChannelOpened({
    consultantName: txn.consultantName,
    clientName: txn.clientName,
    clientEmail: txn.clientEmail,
    type: txn.type,
  }), 'Transaction started');

  for (const note of notes) {
    await postBlocks(channelId, buildNote(note), note);
  }

  return {
    channelId,
    channelName,
    created: true,
    consultantInvited,
    clientInvited,
    notes,
  };
}

/** Look up a (private) channel by exact name via conversations.list. */
async function findChannelByName(
  name: string,
): Promise<{ id: string; name: string } | null> {
  try {
    let cursor: string | undefined;
    do {
      const res = await slack.conversations.list({
        types: 'private_channel',
        limit: 200,
        exclude_archived: true,
        ...(cursor ? { cursor } : {}),
      });
      const match = res.channels?.find((c) => c.name === name && c.id);
      if (match?.id) return { id: match.id, name: match.name ?? name };
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
  } catch (err) {
    log.warn('findChannelByName failed', { name, error: errMessage(err) });
  }
  return null;
}

/**
 * Post a Block Kit message. Failures are logged and swallowed — billing is the
 * source of truth and a Slack outage must never fail the HTTP response.
 * `fallbackText` is the notification/accessibility text.
 */
export async function postBlocks(
  channelId: string,
  blocks: KnownBlock[],
  fallbackText: string,
): Promise<boolean> {
  try {
    await slack.chat.postMessage({ channel: channelId, blocks, text: fallbackText });
    return true;
  } catch (err) {
    log.warn('Slack postMessage failed (non-fatal)', {
      channelId,
      code: slackErrorCode(err),
      error: errMessage(err),
    });
    return false;
  }
}

/** Boot-time health check: verify the bot token works. */
export async function slackHealthCheck(): Promise<boolean> {
  try {
    const res = await slack.auth.test();
    log.info('Slack auth ok', { team: res.team, user: res.user });
    return Boolean(res.ok);
  } catch (err) {
    log.error('Slack auth check failed', { error: errMessage(err) });
    return false;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
