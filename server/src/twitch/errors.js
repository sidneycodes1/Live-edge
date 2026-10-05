// Twitch-specific error. Mirrors ../panta/errors.js PantaError shape. These are
// thrown only by the *internal* request helpers (so tests can assert on failure);
// the public getTopLiveStreams/getStreamByLogin wrappers catch them and degrade.
export class TwitchError extends Error {
  constructor(code, message, { status, details } = {}) {
    super(message);
    this.name = 'TwitchError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
