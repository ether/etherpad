'use strict';

import {isIP} from 'node:net';

export type IpLogging = 'full' | 'truncated' | 'anonymous';

const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

const truncateIpv6 = (ip: string): string => {
  // Expand `::` to make a fixed 8-group representation, keep the first 3,
  // drop the remaining 5, then recompose with trailing `::`. Collapse trailing
  // zero groups in the kept prefix so `2001:db8:0::` becomes `2001:db8::`.
  const [head, tail] = ip.split('::');
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = tail == null ? [] : tail === '' ? [] : tail.split(':');
  const missing = 8 - headParts.length - tailParts.length;
  const full = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  const keep = full.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
  while (keep.length > 0 && keep[keep.length - 1] === '0') keep.pop();
  return `${keep.join(':')}::`;
};

export const anonymizeIp = (ip: string | null | undefined, mode: IpLogging): string => {
  if (ip == null || ip === '') return 'ANONYMOUS';
  if (mode === 'anonymous') return 'ANONYMOUS';
  if (mode === 'full') return ip;
  // truncated
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped != null) return `::ffff:${mapped[1].replace(/\.\d+$/, '.0')}`;
  switch (isIP(ip)) {
    case 4: return ip.replace(/\.\d+$/, '.0');
    case 6: return truncateIpv6(ip);
    default: return 'ANONYMOUS';
  }
};
