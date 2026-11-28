export class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {}
export class PermissionError extends DomainError {}
export class DuplicatePlaceError extends DomainError {}
export class DuplicateReportError extends DomainError {}
export class DuplicateEmailError extends DomainError {}
export class AuthenticationError extends DomainError {}
