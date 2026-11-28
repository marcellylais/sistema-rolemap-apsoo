import { User } from '../../domain/entities/User.js';
import { DuplicateEmailError } from '../../domain/errors/DomainError.js';

function toUser(row) {
  if (!row) return null;
  return new User({
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
  });
}

function translateEmailConflict(error) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && error.message.includes('users.email')) {
    throw new DuplicateEmailError('A user with this email already exists.');
  }
  throw error;
}

export class UserRepository {
  constructor(database) {
    if (!database) throw new TypeError('UserRepository requires a database connection.');
    this.database = database;
  }

  create(user) {
    try {
      this.database.prepare(`
        INSERT INTO users (id, name, email, password_hash, role)
        VALUES (@id, @name, @email, @passwordHash, @role)
      `).run({
        id: user.id,
        name: user.name,
        email: user.email.trim().toLowerCase(),
        passwordHash: user.passwordHash,
        role: user.role,
      });
    } catch (error) {
      translateEmailConflict(error);
    }
    return user;
  }

  findById(id) {
    const row = this.database.prepare('SELECT id, name, email, password_hash, role FROM users WHERE id = ?').get(id);
    return toUser(row);
  }

  isAdmin(id) {
    return Boolean(this.database.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'admin'").get(id));
  }

  findByEmail(email) {
    const normalizedEmail = email.trim().toLowerCase();
    const row = this.database.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?').get(normalizedEmail);
    return toUser(row);
  }

  update(user) {
    try {
      const result = this.database.prepare(`
        UPDATE users
        SET name = @name, email = @email, role = @role
        WHERE id = @id
      `).run({
        id: user.id,
        name: user.name,
        email: user.email.trim().toLowerCase(),
        role: user.role,
      });
      return result.changes > 0;
    } catch (error) {
      translateEmailConflict(error);
    }
  }

  delete(id) {
    const result = this.database.prepare('DELETE FROM users WHERE id = ?').run(id);
    return result.changes > 0;
  }

  addFavorite(userId, placeId) {
    const result = this.database.prepare(`
      INSERT INTO favorites (user_id, place_id)
      VALUES (?, ?)
      ON CONFLICT (user_id, place_id) DO NOTHING
    `).run(userId, placeId);
    // Duplicate favorites are an idempotent no-op; foreign-key errors still propagate.
    return result.changes > 0;
  }

  removeFavorite(userId, placeId) {
    const result = this.database.prepare(`
      DELETE FROM favorites WHERE user_id = ? AND place_id = ?
    `).run(userId, placeId);
    return result.changes > 0;
  }

  findFavoritePlaceIds(userId) {
    return this.database.prepare(`
      SELECT place_id FROM favorites WHERE user_id = ? ORDER BY place_id
    `).all(userId).map(({ place_id: placeId }) => placeId);
  }

  hasFavorite(userId, placeId) {
    return Boolean(this.database.prepare(`
      SELECT 1 FROM favorites WHERE user_id = ? AND place_id = ?
    `).get(userId, placeId));
  }
}
