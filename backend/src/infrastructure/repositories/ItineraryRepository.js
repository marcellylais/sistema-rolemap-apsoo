import { Itinerary } from '../../domain/entities/Itinerary.js';
import { PermissionError, ValidationError } from '../../domain/errors/DomainError.js';

function toItinerary(row, placeIds) {
  return new Itinerary({
    id: row.id,
    title: row.title,
    description: row.description,
    ownerId: row.owner_id,
    placeIds,
  });
}

function copyItinerary(itinerary, ownerId = itinerary.ownerId) {
  // Reconstruct through the domain entity so duplicate IDs are rejected before persistence.
  return new Itinerary({
    id: itinerary.id,
    title: itinerary.title,
    description: itinerary.description,
    ownerId,
    placeIds: itinerary.placeIds,
  });
}

export class ItineraryRepository {
  constructor(database) {
    if (!database) throw new TypeError('ItineraryRepository requires a database connection.');
    this.database = database;
  }

  create(itinerary, authenticatedUserId) {
    this.#validateAuthenticatedUserId(authenticatedUserId);
    // The authenticated identity is authoritative; ignore ownerId from the submitted entity.
    const validatedItinerary = copyItinerary(itinerary, authenticatedUserId);
    const persist = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO itineraries (id, title, description, owner_id)
        VALUES (@id, @title, @description, @ownerId)
      `).run({
        id: validatedItinerary.id,
        title: validatedItinerary.title,
        description: validatedItinerary.description,
        ownerId: validatedItinerary.ownerId,
      });
      this.#insertPlaces(validatedItinerary);
    });
    persist();
    return validatedItinerary;
  }

  findById(id) {
    return this.#findItineraries('WHERE i.id = ?', [id])[0] ?? null;
  }

  findByOwnerId(ownerId) {
    return this.#findItineraries('WHERE i.owner_id = ?', [ownerId]);
  }

  update(itinerary, authenticatedUserId) {
    this.#validateAuthenticatedUserId(authenticatedUserId);
    const persist = this.database.transaction(() => {
      const ownerId = this.#authorizeOwner(itinerary.id, authenticatedUserId);
      if (ownerId === null) return false;
      const validatedItinerary = copyItinerary(itinerary, ownerId);
      return this.#persistExisting(validatedItinerary);
    });
    return persist();
  }

  addPlace(itineraryId, placeId, authenticatedUserId) {
    this.#validateAuthenticatedUserId(authenticatedUserId);
    const persist = this.database.transaction(() => {
      if (this.#authorizeOwner(itineraryId, authenticatedUserId) === null) return false;
      const itinerary = this.findById(itineraryId);
      itinerary.addPlace(placeId);
      this.#persistExisting(itinerary);
      return true;
    });
    return persist();
  }

  removePlace(itineraryId, placeId, authenticatedUserId) {
    this.#validateAuthenticatedUserId(authenticatedUserId);
    const persist = this.database.transaction(() => {
      if (this.#authorizeOwner(itineraryId, authenticatedUserId) === null) return false;
      const itinerary = this.findById(itineraryId);
      if (!itinerary.removePlace(placeId)) return false;
      this.#persistExisting(itinerary);
      return true;
    });
    return persist();
  }

  delete(id, authenticatedUserId) {
    this.#validateAuthenticatedUserId(authenticatedUserId);
    const persist = this.database.transaction(() => {
      const ownerId = this.#authorizeOwner(id, authenticatedUserId);
      if (ownerId === null) return false;
      const result = this.database.prepare('DELETE FROM itineraries WHERE id = ?').run(id);
      return result.changes > 0;
    });
    return persist();
  }

  #findItineraries(condition, parameters) {
    const rows = this.database.prepare(`
      SELECT i.id, i.title, i.description, i.owner_id, ip.place_id, ip.position
      FROM itineraries AS i
      LEFT JOIN itinerary_places AS ip ON ip.itinerary_id = i.id
      ${condition}
      ORDER BY i.created_at, i.id, ip.position
    `).all(...parameters);

    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.id)) grouped.set(row.id, { row, placeIds: [] });
      if (row.place_id !== null) grouped.get(row.id).placeIds.push(row.place_id);
    }
    return [...grouped.values()].map(({ row, placeIds }) => toItinerary(row, placeIds));
  }

  #persistExisting(itinerary) {
    const exists = this.database.prepare('SELECT 1 FROM itineraries WHERE id = ?').get(itinerary.id);
    if (!exists) return false;

    this.database.prepare(`
      UPDATE itineraries
      SET title = @title, description = @description
      WHERE id = @id
    `).run({
      id: itinerary.id,
      title: itinerary.title,
      description: itinerary.description,
    });
    this.database.prepare('DELETE FROM itinerary_places WHERE itinerary_id = ?').run(itinerary.id);
    this.#insertPlaces(itinerary);
    return true;
  }

  #insertPlaces(itinerary) {
    const insert = this.database.prepare(`
      INSERT INTO itinerary_places (itinerary_id, place_id, position)
      VALUES (?, ?, ?)
    `);
    itinerary.placeIds.forEach((placeId, position) => insert.run(itinerary.id, placeId, position));
  }

  #authorizeOwner(itineraryId, authenticatedUserId) {
    const row = this.database.prepare('SELECT owner_id FROM itineraries WHERE id = ?').get(itineraryId);
    if (!row) return null;
    if (row.owner_id !== authenticatedUserId) {
      throw new PermissionError('Only the itinerary owner may modify it.');
    }
    return row.owner_id;
  }

  #validateAuthenticatedUserId(authenticatedUserId) {
    if (typeof authenticatedUserId !== 'string' || authenticatedUserId.length === 0) {
      throw new ValidationError('An authenticated user id is required for this operation.');
    }
  }
}
