import jwt from 'jsonwebtoken';
import { AuthenticationError, ValidationError } from '../../domain/errors/DomainError.js';

const TOKEN_LIFETIME = '1h';

export class TokenService {
  #secret;

  constructor(secret = process.env.JWT_SECRET) {
    if (typeof secret !== 'string' || !secret.trim()) {
      throw new TypeError('JWT_SECRET must be configured with a non-empty secret.');
    }
    this.#secret = secret;
  }

  generateToken(user) {
    if (!user || typeof user.id !== 'string' || !user.id.trim()
      || typeof user.role !== 'string' || !user.role.trim()) {
      throw new ValidationError('A valid user with id and role is required to generate a token.');
    }

    return jwt.sign(
      { sub: user.id, role: user.role },
      this.#secret,
      { algorithm: 'HS256', expiresIn: TOKEN_LIFETIME },
    );
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.#secret, { algorithms: ['HS256'] });
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Token is invalid, expired, or malformed.');
      }
      throw error;
    }
  }
}
