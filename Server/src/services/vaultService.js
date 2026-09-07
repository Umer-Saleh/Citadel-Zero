const vaultRepo = require('../repositories/vaultRepo');
const { AppError } = require('../errors/AppError');

/**
 * The most items one account may hold.
 *
 * WHY A CAP EXISTS AT ALL
 * -----------------------
 * There was none, and an item is capped only in SIZE — express.json's
 * 64 KB body limit puts the real ceiling at 65,455 base64 characters,
 * about 49 KB of ciphertext. Measured, that stores 1:1 on disk: TOAST
 * cannot compress high-entropy base64 and gives up, so 2,000 max-size
 * items occupy 130 MB. With apiLimiter at 300 requests per 15 minutes,
 * one address can write 28,800 items — 1.8 GB — in a day, and roughly
 * twenty addresses working in parallel fill a 40 GB disk before the
 * nightly wipe comes round.
 *
 * WHY 1,000
 * ---------
 * The seeded demo holds five. Real password-manager users cluster
 * around 60-120 credentials; a heavy user with a decade of accounts
 * reaches 300-500. So this is roughly 8x the plausible heavy user and
 * 200x the demo — generous enough that reaching it accidentally would
 * itself be a bug report, which is the test a limit like this has to
 * pass.
 *
 * It caps one account at 1,000 x 65.5 KB = 64 MB. That is the point:
 * it turns "unlimited per account" into "one account per 64 MB", and
 * account creation IS already limited, at 20 per 15 minutes per
 * address.
 *
 * Below about 200 this would be a defect — real people would hit it.
 * Above about 5,000 it stops bounding anything useful, since the
 * attacker simply makes fewer accounts.
 *
 * KEEP IN STEP. This number is also written into two places in the
 * client, because a person hitting the limit has to be told what it
 * is:
 *   Web/src/lib/errors.js   the shared VAULT_FULL sentence
 *   Web/src/screens/ItemDetail.jsx   the save handler's own line
 * Changing it here without changing both leaves the app quoting a
 * limit it does not enforce.
 */
const MAX_ITEMS_PER_USER = 1000;

/** Database row -> API shape. */
function toApiItem(row) {
  return {
    id: row.id,
    ciphertext: row.encrypted_data,
    nonce: row.nonce,
    authTag: row.auth_tag,
    updatedAt: row.updated_at
  };
}

async function list(userId) {
  const rows = await vaultRepo.listByUser(userId);
  return rows.map(toApiItem);
}

async function create(userId, blob) {
  const held = await vaultRepo.countByUser(userId);

  if (held >= MAX_ITEMS_PER_USER) {
    // 409, not 400: the payload is fine and the caller is authorised.
    // What forbids the write is the state of the resource.
    throw new AppError('VAULT_FULL', 409, 'vault item limit reached');
  }

  return vaultRepo.create(userId, blob);
}

async function update(userId, itemId, blob) {
  const updated = await vaultRepo.update(userId, itemId, blob);

  // 404 rather than 403: a 403 would confirm the item exists and
  // belongs to someone else.
  if (!updated) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }
}

async function remove(userId, itemId) {
  const removed = await vaultRepo.remove(userId, itemId);

  if (!removed) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }
}

/**
 * The count and the insert are deliberately NOT in one transaction.
 *
 * Two creates racing can both read 999 and both succeed, leaving 1,001.
 * That is accepted. The limit exists to bound a hostile bulk load, and
 * being one over does not weaken it by any amount worth measuring — an
 * attacker gains a single item, not a loophole. Taking a row lock on
 * every insert to close a one-item window would cost every legitimate
 * save a serialisation point, which is the worse trade.
 */
module.exports = { list, create, update, remove, MAX_ITEMS_PER_USER };