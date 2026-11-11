/** The one error for a ref that is not on the current page. Nothing was done when it is thrown. */
export class StaleRefError extends Error {
  public readonly ref: string;

  constructor(ref: string) {
    super(`stale [${ref}]: no longer on the page, nothing was done. Call look or find for current refs.`);
    this.name = 'StaleRefError';
    this.ref = ref;
  }
}
