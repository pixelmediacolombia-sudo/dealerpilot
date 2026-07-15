-- Clean noisy Messenger UI rows imported before the Sales AI intake hardening.
-- Date: 2026-07-15
--
-- Safe scope: only conversation_messages content/role cleanup. This does not
-- delete conversations, leads, vehicles, listings, or Marketplace records.

BEGIN;

-- Outgoing Facebook/Messenger rows were previously stored as buyer/user rows.
-- Convert them to assistant/dealer rows and strip the Messenger chrome prefix.
UPDATE conversation_messages
SET role = 'assistant',
    content = trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            content,
            '^\s*Enter,\s*Message sent\s+\d{1,2}:\d{2}\s*(AM|PM)\s+by\s+You\s*:?\s*',
            '',
            'i'
          ),
          '^\s*[A-Za-z]+day\s+\d{1,2}:\d{2}\s*(AM|PM)\s+by\s+You\s*:?\s*',
          '',
          'i'
        ),
        '^\s*You sent\s*,?\s*',
        '',
        'i'
      )
    )
WHERE content ~* '^\s*(Enter,\s*)?Message sent\s+\d{1,2}:\d{2}\s*(AM|PM)\s+by\s+You'
   OR content ~* '^\s*[A-Za-z]+day\s+\d{1,2}:\d{2}\s*(AM|PM)\s+by\s+You'
   OR content ~* '^\s*You sent\s*,?';

-- Remove rows that are only Messenger UI controls or conversation chrome.
DELETE FROM conversation_messages
WHERE lower(trim(content)) IN (
    'aa',
    'active',
    'archive',
    'chat members',
    'close',
    'compose',
    'customize chat',
    'delete chat',
    'edit nicknames',
    'emoji',
    'enter',
    'esc',
    'mark as pending',
    'media, files and links',
    'message',
    'message...',
    'messenger',
    'more options',
    'mute',
    'notifications',
    'people',
    'privacy & support',
    'saved',
    'search',
    'search in conversation',
    'send',
    'view profile',
    'write to saved'
  )
  OR content ~* '^\s*(write to|saved|compose|mute|search|customize chat|chat members|mark as pending|more options)\b'
  OR content ~* '^\s*[A-Za-z][A-Za-z .''-]{1,60}\s+-\s+(19|20)\d{2}\s+';

-- Remove exact duplicate bubbles created by repeated polling.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY conversation_id, role, trim(content)
      ORDER BY id
    ) AS rn
  FROM conversation_messages
)
DELETE FROM conversation_messages cm
USING ranked r
WHERE cm.id = r.id
  AND r.rn > 1;

-- Recompute each conversation's last message timestamp after cleanup.
UPDATE conversations c
SET last_message_at = latest.last_message_at,
    updated_at = now()
FROM (
  SELECT conversation_id, max(created_at) AS last_message_at
  FROM conversation_messages
  GROUP BY conversation_id
) latest
WHERE c.id = latest.conversation_id;

COMMIT;
