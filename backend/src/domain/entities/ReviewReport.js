import { ValidationError } from '../errors/DomainError.js';

const TARGET_TYPES = new Set(['rating', 'comment']);
const REPORT_STATUSES = new Set(['pending', 'approved', 'rejected']);

export class ReviewReport {
  constructor({
    id,
    reviewId,
    targetType,
    reporterId,
    status = 'pending',
    createdAt = new Date(),
    moderatedBy = null,
    moderatedAt = null,
  }) {
    if (!id || !reviewId || !reporterId) {
      throw new ValidationError('Review report requires id, review id and reporter id.');
    }
    if (!TARGET_TYPES.has(targetType)) {
      throw new ValidationError('Review report target must be rating or comment.');
    }
    if (!REPORT_STATUSES.has(status)) {
      throw new ValidationError('Review report status is invalid.');
    }
    const createdDate = new Date(createdAt);
    const moderatedDate = moderatedAt === null ? null : new Date(moderatedAt);
    if (Number.isNaN(createdDate.getTime())
      || (moderatedDate && Number.isNaN(moderatedDate.getTime()))) {
      throw new ValidationError('Review report dates must be valid.');
    }
    if ((status === 'pending' && moderatedDate)
      || (status !== 'pending' && !moderatedDate)) {
      throw new ValidationError('Review report moderation date does not match its status.');
    }

    this.id = id;
    this.reviewId = reviewId;
    this.targetType = targetType;
    this.reporterId = reporterId;
    this.status = status;
    this.createdAt = createdDate;
    this.moderatedBy = moderatedBy;
    this.moderatedAt = moderatedDate;
  }
}
