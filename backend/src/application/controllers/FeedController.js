import {
  ValidationError,
} from '../../domain/errors/DomainError.js';

const INTERNAL_ERROR_RESPONSE = {
  error: 'Internal server error.',
};

export class FeedController {
  constructor(feedService) {
    if (
      !feedService
      || typeof feedService.findRecent !== 'function'
    ) {
      throw new TypeError(
        'FeedController requires a FeedService.',
      );
    }

    this.feedService = feedService;
    this.findRecent = this.findRecent.bind(this);
  }

  async findRecent(req, res) {
    try {
      const limit = req.query.limit === undefined
        ? 20
        : Number(req.query.limit);

      const feed = await this.feedService.findRecent(limit);

      return res.status(200).json(feed);
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({
          error: error.message,
        });
      }

      return res.status(500).json(INTERNAL_ERROR_RESPONSE);
    }
  }
}