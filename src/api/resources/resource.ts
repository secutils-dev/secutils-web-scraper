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
   * Resource content data.
   */
  data: ResourceContentData;

  /**
   * Size of the inline resource content, if available, in bytes.
   */
  size: number;
}

/**
 * Describes resource content data, it can either be the raw content data or a hash such as Trend Micro Locality
 * Sensitive Hash or simple SHA-1.
 */
export type ResourceContentData = { raw: string } | { tlsh: string } | { sha1: string };
