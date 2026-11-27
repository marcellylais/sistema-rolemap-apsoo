const GOOGLE_GEOCODING_URL = 'https://geocode.googleapis.com/v4/geocode/address';

export class GoogleGeocodingClient {
  #apiKey;
  #fetch;

  constructor({ apiKey, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('GoogleGeocodingClient requires a fetch implementation.');
    }
    this.#apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.#fetch = fetchImpl;
  }

  async geocode(address) {
    if (!this.#apiKey) throw new Error('GOOGLE_MAPS_API_KEY must be configured to geocode addresses.');
    if (typeof address !== 'string' || !address.trim()) {
      throw new TypeError('A non-empty address is required for geocoding.');
    }

    const url = new URL(`${GOOGLE_GEOCODING_URL}/${encodeURIComponent(address.trim())}`);
    let response;
    try {
      response = await this.#fetch(url, {
        headers: {
          'X-Goog-Api-Key': this.#apiKey,
          'X-Goog-FieldMask': 'results.location',
        },
      });
    } catch {
      throw new Error('Google Geocoding request failed.');
    }

    if (!response?.ok) throw new Error('Google Geocoding request failed.');

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Google Geocoding returned an invalid response.');
    }

    if (payload?.error) throw new Error('Google Geocoding request failed.');
    const location = payload?.results?.[0]?.location;
    if (!location) return null;
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      throw new Error('Google Geocoding returned invalid coordinates.');
    }
    return { latitude: location.latitude, longitude: location.longitude };
  }
}
