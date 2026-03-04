/**
 * Generates a random String with the given length. Is needed to generate the
 * Author, Group, readonly, session Ids
 */
import cryptoMod from 'crypto';

const randomString = (len: number) => cryptoMod.randomBytes(len).toString('hex');

export default randomString;
