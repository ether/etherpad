'use strict';

import padUtils from './pad_utils'

/**
 * Represents a chat message stored in the database and transmitted among users. Plugins can extend
 * the object with additional properties.
 *
 * Supports serialization to JSON.
 */
export class ChatMessage {
  customMetadata: any
  text: string|null
  public authorId: string|null
  displayName: string|null
  time: number|null
  static fromObject(obj: ChatMessage) {
    // The userId property was renamed to authorId, and userName was renamed to displayName. Accept
    // the old names in case the db record was written by an older version of Etherpad.
    obj = Object.assign({}, obj); // Don't mutate the caller's object.
    if ('userId' in obj && !('authorId' in obj)) { // @ts-ignore
      obj.authorId = obj.userId;
    }
    // @ts-ignore
    delete obj.userId;
    if ('userName' in obj && !('displayName' in obj)) { // @ts-ignore
      obj.displayName = obj.userName;
    }
    // @ts-ignore
    delete obj.userName;
    return Object.assign(new ChatMessage(), obj);
  }

  /**
   * @param {?string} [text] - Initial value of the `text` property.
   * @param {?string} [authorId] - Initial value of the `authorId` property.
   * @param {?number} [time] - Initial value of the `time` property.
   */
  constructor(text: string | null = null, authorId: string | null = null, time: number | null = null) {
    /**
     * The raw text of the user's chat message (before any rendering or processing).
     *
     * @type {?string}
     */
    this.text = text;

    /**
     * The user's author ID.
     *
     * @type {?string}
     */
    this.authorId = authorId;

    /**
     * The message's timestamp, as milliseconds since epoch.
     *
     * @type {?number}
     */
    this.time = time;

    /**
     * The user's display name.
     *
     * @type {?string}
     */
    this.displayName = null;
  }

  /**
   * Alias of `authorId`, for compatibility with old plugins.
   *
   * @deprecated Use `authorId` instead.
   * @type {string}
   */
  get userId() {
    padUtils.warnDeprecated('ChatMessage.userId property is deprecated; use .authorId instead');
    return this.authorId;
  }
  set userId(val) {
    padUtils.warnDeprecated('ChatMessage.userId property is deprecated; use .authorId instead');
    this.authorId = val;
  }

  /**
   * Alias of `displayName`, for compatibility with old plugins.
   *
   * @deprecated Use `displayName` instead.
   * @type {string}
   */
  get userName() {
    padUtils.warnDeprecated('ChatMessage.userName property is deprecated; use .displayName instead');
    return this.displayName;
  }
  set userName(val) {
    padUtils.warnDeprecated('ChatMessage.userName property is deprecated; use .displayName instead');
    this.displayName = val;
  }

  // TODO: Delete this method once users are unlikely to roll back to a version of Etherpad that
  // doesn't support authorId and displayName.
  toJSON() {
    const {authorId, displayName, ...obj} = this;
    // @ts-ignore
    obj.userId = authorId;
    // @ts-ignore
    obj.userName = displayName;
    return obj;
  }
}

export default ChatMessage
