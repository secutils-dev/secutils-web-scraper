/**
 * Describes external or inline resource.
 */
export interface WebPageResource {
  /**
   * The URL resources is loaded from.
   */
  url?: string;

  /**
   * Resource content descriptor (size and digest), if available.
   */
  content?: WebPageResourceContent;
}

/**
 * Describes resource content.
 */
export interface WebPageResourceContent {
  /**
   * Resource content data.
   */
  data: WebPageResourceContentData;

  /**
   * Size of the inline resource content, if available, in bytes.
   */
  size: number;
}

/**
 * Describes resource content data, it can either be the raw content data or a hash such as Trend Micro Locality
 * Sensitive Hash or simple SHA-1.
 */
export type WebPageResourceContentData = { raw: string } | { tlsh: string } | { sha1: string };
