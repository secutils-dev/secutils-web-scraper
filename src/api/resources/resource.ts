/**
 * Describes external resource.
 */
export interface ExternalResource {
  /**
   * The URL resources is loaded from.
   */
  src: string;

  /**
   * SHA256 digest of the external resource content, if available.
   */
  digest?: string;

  /**
   * Size of the inline resource content, if available, in bytes.
   */
  size?: number;
}

/**
 * Describes inline resource.
 */
export interface InlineResource {
  /**
   * SHA256 digest of the inline resource content.
   */
  digest: string;
  /**
   * Size of the inline resource content, in bytes.
   */
  size: number;
}
