const vaultRepo = require('../repositories/vaultRepo');
const { AppError } = require('../errors/AppError');

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

module.exports = { list, create, update, remove };