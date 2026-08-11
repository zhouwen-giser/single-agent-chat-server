# P09 failed attempt: IPv4-mapped IPv6 normalization

- Date: 2026-08-11
- Gate: URL projection security regression
- Result: failed as required

The first mapped-address guard handled dotted `::ffff:127.0.0.1`, but Node's
URL parser normalized it to `::ffff:7f00:1`. The unit gate therefore observed a
second artifact reference instead of rejecting the loopback URL. The mapper now
parses the normalized two-hextet form into IPv4 octets before applying the
private/reserved-address policy. The complete unit and P09 gates then passed.
