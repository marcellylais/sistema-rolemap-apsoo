import { Place } from '../../domain/entities/Place.js';
import { Review } from '../../domain/entities/Review.js';

const PLACE_COLUMNS = 'id, title, description, category, latitude, longitude, author_id';
const REVIEW_COLUMNS = 'r.id, r.rating, r.user_id, r.place_id, r.created_at, r.updated_at';
const PLACE_ID_BATCH_SIZE = 500;
const EARTH_RADIUS_KM = 6371.0088;

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function degrees(radians) { return radians * (180 / Math.PI); }
function radians(value) { return value * (Math.PI / 180); }

function distanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const latitudeARadians = radians(latitudeA);
  const latitudeBRadians = radians(latitudeB);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeARadians) * Math.cos(latitudeBRadians) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function proximityBounds(latitude, longitude, radiusKm) {
  const angularDistance = radiusKm / EARTH_RADIUS_KM;
  if (angularDistance >= Math.PI) return null;

  const latitudeDelta = degrees(angularDistance);
  const south = Math.max(-90, latitude - latitudeDelta);
  const north = Math.min(90, latitude + latitudeDelta);
  const bounds = { south, north };

  // When the circle touches a pole, every longitude can be within the radius.
  if (south <= -90 || north >= 90) return bounds;

  const longitudeDelta = degrees(Math.asin(
    Math.sin(angularDistance) / Math.cos(radians(latitude)),
  ));
  bounds.west = longitude - longitudeDelta;
  bounds.east = longitude + longitudeDelta;
  return bounds;
}

function addLongitudeClause(clauses, parameters, bounds) {
  if (bounds.west === undefined) return;
  if (bounds.west < -180) {
    clauses.push('(longitude >= @wrappedWest OR longitude <= @east)');
    parameters.wrappedWest = bounds.west + 360;
    parameters.east = bounds.east;
  } else if (bounds.east > 180) {
    clauses.push('(longitude >= @west OR longitude <= @wrappedEast)');
    parameters.west = bounds.west;
    parameters.wrappedEast = bounds.east - 360;
  } else {
    clauses.push('longitude BETWEEN @west AND @east');
    parameters.west = bounds.west;
    parameters.east = bounds.east;
  }
}

function toPlace(row) {
  return new Place({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    latitude: row.latitude,
    longitude: row.longitude,
    authorId: row.author_id,
  });
}

function loadReviews(database, places) {
  const placesById = new Map(places.map((place) => [place.id, place]));
  for (let offset = 0; offset < places.length; offset += PLACE_ID_BATCH_SIZE) {
    const batch = places.slice(offset, offset + PLACE_ID_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(', ');
    const reviews = database.prepare(`
      SELECT ${REVIEW_COLUMNS},
        CASE WHEN comment_moderation.review_id IS NULL THEN r.comment ELSE '' END AS comment
      FROM reviews AS r
      LEFT JOIN review_content_moderation AS rating_moderation
        ON rating_moderation.review_id = r.id AND rating_moderation.target_type = 'rating'
      LEFT JOIN review_content_moderation AS comment_moderation
        ON comment_moderation.review_id = r.id AND comment_moderation.target_type = 'comment'
      WHERE r.place_id IN (${placeholders})
        AND rating_moderation.review_id IS NULL
      ORDER BY r.created_at, r.id
    `).all(...batch.map((place) => place.id));

    for (const row of reviews) {
      const review = new Review({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        userId: row.user_id,
        placeId: row.place_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      placesById.get(row.place_id).addOrUpdateReview(review);
    }
  }
  return places;
}

export class PlaceRepository {
  constructor(database) {
    if (!database) throw new TypeError('PlaceRepository requires a database connection.');
    this.database = database;
  }

  create(place) {
    this.database.prepare(`
      INSERT INTO places (id, title, description, category, latitude, longitude, author_id)
      VALUES (@id, @title, @description, @category, @latitude, @longitude, @authorId)
    `).run({
      id: place.id,
      title: place.title,
      description: place.description,
      category: place.category,
      latitude: place.latitude,
      longitude: place.longitude,
      authorId: place.authorId,
    });
    return place;
  }

  findById(id) {
    const row = this.database.prepare(`SELECT ${PLACE_COLUMNS} FROM places WHERE id = ?`).get(id);
    if (!row) return null;
    return loadReviews(this.database, [toPlace(row)])[0];
  }

  findAll() {
    const rows = this.database.prepare(`SELECT ${PLACE_COLUMNS} FROM places ORDER BY created_at, id`).all();
    return loadReviews(this.database, rows.map(toPlace));
  }

  findByCategory(category) {
    const rows = this.database.prepare(`
      SELECT ${PLACE_COLUMNS} FROM places WHERE category = ? ORDER BY created_at, id
    `).all(category);
    return loadReviews(this.database, rows.map(toPlace));
  }

  search({ name, category, latitude, longitude, radiusKm } = {}) {
    const clauses = [];
    const parameters = {};
    const hasProximity = latitude !== undefined && longitude !== undefined && radiusKm !== undefined;

    if (name !== undefined) {
      clauses.push("title COLLATE NOCASE LIKE @name ESCAPE '\\'");
      parameters.name = `%${escapeLike(name)}%`;
    }
    if (category !== undefined) {
      clauses.push('category = @category');
      parameters.category = category;
    }

    if (hasProximity) {
      const bounds = proximityBounds(latitude, longitude, radiusKm);
      if (bounds) {
        clauses.push('latitude BETWEEN @south AND @north');
        parameters.south = bounds.south;
        parameters.north = bounds.north;
        addLongitudeClause(clauses, parameters, bounds);
      }
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database.prepare(`
      SELECT ${PLACE_COLUMNS}, created_at FROM places ${where}
      ORDER BY created_at, id
    `).all(parameters);
    const places = rows.map(toPlace);

    if (!hasProximity) return loadReviews(this.database, places);

    return loadReviews(this.database, places
      .map((place) => ({
        place,
        distance: distanceKm(latitude, longitude, place.latitude, place.longitude),
      }))
      .filter(({ distance }) => distance <= radiusKm + 1e-9)
      .sort((left, right) => left.distance - right.distance || left.place.id.localeCompare(right.place.id))
      .map(({ place }) => place));
  }

  update(place, user) {
    const row = this.database.prepare(`
      SELECT ${PLACE_COLUMNS} FROM places WHERE id = ?
    `).get(place.id);
    if (!row) return false;

    // Authorize against the persisted author id, not a possibly stale caller-supplied value.
    const persistedPlace = toPlace(row);
    persistedPlace.updateDescription({
      title: place.title,
      description: place.description,
      category: place.category,
    }, user);

    const result = this.database.prepare(`
      UPDATE places
      SET title = @title, description = @description, category = @category
      WHERE id = @id
    `).run({
      id: place.id,
      title: persistedPlace.title,
      description: persistedPlace.description,
      category: persistedPlace.category,
    });
    return result.changes > 0;
  }

  delete(id) {
    const result = this.database.prepare('DELETE FROM places WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
