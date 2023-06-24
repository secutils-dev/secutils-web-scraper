/**
 * Describes external or inline resource.
 */
export interface Resource {
  /**
   * The URL resources is loaded from.
   */
  url?: string;

  /**
   * Resource content descriptor (size and digest), if available.
   */
  content?: ResourceContent;
}

/**
 * Describes resource content.
 */
export interface ResourceContent {
  /**
   * SHA1 digest of the external resource content, if available.
   */
  digest: string;

  /**
   * Size of the inline resource content, if available, in bytes.
   */
  size: number;
}
