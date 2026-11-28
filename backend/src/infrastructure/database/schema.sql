PRAGMA foreign_keys = ON;

-- Excluir um usuário remove seus lugares, avaliações, roteiros e favoritos.
-- Excluir um lugar remove avaliações, favoritos e posições em roteiros que o referenciam.
-- As tabelas de associação também são removidas ao excluir o roteiro correspondente.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (typeof(latitude) IN ('integer', 'real') AND latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (typeof(longitude) IN ('integer', 'real') AND longitude BETWEEN -180 AND 180),
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY NOT NULL,
  rating INTEGER NOT NULL CHECK (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS review_reports (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('rating', 'comment')),
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  moderated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TEXT,
  UNIQUE (review_id, target_type, reporter_id),
  CHECK ((status = 'pending' AND moderated_at IS NULL)
    OR (status IN ('approved', 'rejected') AND moderated_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS review_reports_status_created_at
  ON review_reports(status, created_at, id);

CREATE TABLE IF NOT EXISTS review_content_moderation (
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('rating', 'comment')),
  visibility_state TEXT NOT NULL CHECK (visibility_state IN ('auto_hidden', 'moderator_hidden')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  moderator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (review_id, target_type)
);

CREATE TABLE IF NOT EXISTS itineraries (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS itinerary_places (
  itinerary_id TEXT NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 0),
  PRIMARY KEY (itinerary_id, place_id),
  UNIQUE (itinerary_id, position)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS posts_created_at
  ON posts(created_at DESC, id DESC);